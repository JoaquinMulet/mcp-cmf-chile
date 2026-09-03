import { resolverChallenge, crearCookieJar, UA_DEFAULT } from "./anti-bot.js";
import { cacheHttp, cacheBinario } from "./cache.js";

/** Entorno del servidor (Workers env o vacío en STDIO). */
export interface CmfEnv {
  /** Interno: módulo wasm de pdf-inspector (solo worker; Node usa el paquete) */
  __pdfModule?: WebAssembly.Module;
  CMF_API_KEY?: string;
  CMF_HTTP_TOKEN?: string;
  CMF_KV?: { get: (k: string) => Promise<string | null>; put: (k: string, v: string, o?: { expirationTtl?: number }) => Promise<void> };
  CMF_RATE_LIMIT_MS?: string;
  CMF_CACHE_TTL_S?: string;
  CMF_MAX_ROWS?: string;
  CMF_UPSTREAM_TIMEOUT_MS?: string;
}

const HOSTS_ALLOWLIST = new Set([
  "www.cmfchile.cl",
  "api.sbif.cl",
  "best-cmf.cl",
  "www.best-cmf.cl",
  "tasas.cmfchile.cl",
  "datosbanco.cmfchile.cl",
  "cronologiabancaria.cmfchile.cl",
  "conocetudeuda.cmfchile.cl",
  "conocetuseguro.cl",
  "www.conocetuseguro.cl",
  "acreencias.cmfchile.cl",
  "raw.githubusercontent.com", // catálogo de empresas (tickers/RUTs): JoaquinMulet/empresas-cmf-chile
]);

const configDefault = {
  rateLimitMs: 1100,
  cacheTtlS: 900,
  maxRows: 500,
  upstreamTimeoutMs: 12000,
};

function config(env: CmfEnv) {
  return {
    rateLimitMs: env.CMF_RATE_LIMIT_MS ? parseInt(env.CMF_RATE_LIMIT_MS, 10) : configDefault.rateLimitMs,
    cacheTtlS: env.CMF_CACHE_TTL_S ? parseInt(env.CMF_CACHE_TTL_S, 10) : configDefault.cacheTtlS,
    maxRows: env.CMF_MAX_ROWS ? parseInt(env.CMF_MAX_ROWS, 10) : configDefault.maxRows,
    upstreamTimeoutMs: env.CMF_UPSTREAM_TIMEOUT_MS
      ? parseInt(env.CMF_UPSTREAM_TIMEOUT_MS, 10)
      : configDefault.upstreamTimeoutMs,
  };
}

/** Rate limiter por host: cola con timeout y max in-flight (singleton de módulo). */
class RateLimiter {
  private ultimo = new Map<string, number>();
  private inflight = 0;
  constructor(private minMs: number, private maxInflight = 4) {}

  async esperar(host: string): Promise<void> {
    while (this.inflight >= this.maxInflight) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const ultimo = this.ultimo.get(host) ?? 0;
    const falta = ultimo + this.minMs - Date.now();
    if (falta > 0) await new Promise((r) => setTimeout(r, falta));
    this.ultimo.set(host, Date.now());
    this.inflight++;
  }
  liberar(): void {
    this.inflight--;
  }
}

let limiter: RateLimiter | null = null;
let limiterMs = 0;
function getLimiter(minMs: number): RateLimiter {
  if (!limiter || limiterMs !== minMs) {
    limiter = new RateLimiter(minMs);
    limiterMs = minMs;
  }
  return limiter;
}

function validarUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Solo se permiten URLs HTTPS hacia la CMF");
  if (!HOSTS_ALLOWLIST.has(u.hostname)) throw new Error(`Host no permitido: ${u.hostname}`);
  return u;
}

async function fetchConTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = configDefault.upstreamTimeoutMs,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Núcleo: request HTTP hacia la CMF con allowlist, UA, cookie jar, anti-bot,
 * rate limit, retry con backoff y manejo de redirects validados.
 */
export async function fetchCmf(
  url: string,
  init: RequestInit = {},
  env: CmfEnv = {},
  jar = crearCookieJar(),
): Promise<Response> {
  const u = validarUrl(url);
  const cfg = config(env);
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("User-Agent")) headers.set("User-Agent", UA_DEFAULT);
  const cookie = jar.header(u);
  if (cookie) headers.set("Cookie", cookie);

  const rl = getLimiter(cfg.rateLimitMs);
  // El timeout configurado (env) debe aplicar también a los intentos del anti-bot
  const fetchConCfg = (u: string, i: RequestInit) => fetchConTimeout(u, i, cfg.upstreamTimeoutMs);

  let ultimoError: unknown = null;
  for (let intento = 0; intento < 3; intento++) {
    if (intento > 0) await new Promise((r) => setTimeout(r, 500 * 2 ** (intento - 1)));
    await rl.esperar(u.hostname);
    try {
      const res = await resolverChallenge(fetchConCfg, url, { ...init, headers }, jar);
      rl.liberar();
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        // Redirect manual validado (allowlist)
        const next = new URL(res.headers.get("location")!, url).toString();
        validarUrl(next);
        return fetchCmf(next, { ...init, headers }, env, jar);
      }
      if (res.status >= 500 && intento < 2) {
        ultimoError = new Error(`HTTP ${res.status} de la CMF (intento ${intento + 1})`);
        continue;
      }
      return res;
    } catch (e) {
      rl.liberar();
      ultimoError = e;
      if (intento < 2 && e instanceof DOMException && e.name === "AbortError") continue;
      throw e;
    }
  }
  throw ultimoError instanceof Error
    ? new Error(`La red de la CMF rechazó la conexión tras 3 intentos (algunos hosts, como datosbanco, bloquean IPs de datacenter): ${ultimoError.message}`)
    : new Error("Fallo de red hacia la CMF");
}

/** Decodifica el body de una respuesta legacy: UTF-8 si es válido, si no windows-1252. */
function decodificarBody(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** GET legacy con query params; cachea la respuesta cruda por clave. */
export async function getLegacy(
  path: string,
  params: Record<string, string | number | undefined> = {},
  env: CmfEnv = {},
  cacheClave?: string,
): Promise<string> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const url = `https://www.cmfchile.cl${path}${qs.size ? `?${qs}` : ""}`;
  if (cacheClave) {
    const cacheado = cacheHttp.get(cacheClave);
    if (cacheado) return cacheado;
  }
  const res = await fetchCmf(url, {}, env);
  const bytes = await res.arrayBuffer();
  const texto = decodificarBody(bytes);
  // Una página de error 5xx cacheada deja la tool muerta todo el TTL aunque
  // la CMF ya se haya recuperado. Solo se guarda lo que respondió bien.
  if (cacheClave && res.ok) cacheHttp.set(cacheClave, texto, config(env).cacheTtlS * 1000);
  return texto;
}

/** GET legacy con cookies explícitas (flujo captcha: reutiliza la sesión PHP de la imagen). */
export async function getLegacyConCookies(
  path: string,
  cookies: string,
  env: CmfEnv = {},
): Promise<string> {
  const url = `https://www.cmfchile.cl${path}`;
  const res = await fetchCmf(url, { headers: { Cookie: cookies } }, env);
  return decodificarBody(await res.arrayBuffer());
}

/** POST form-urlencoded con cookies explícitas (flujo captcha). */
export async function postLegacyConCookies(
  path: string,
  body: Record<string, string | number | string[] | undefined>,
  cookies: string,
  env: CmfEnv = {},
): Promise<string> {
  const url = `https://www.cmfchile.cl${path}`;
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => form.append(k, String(x)));
    else form.set(k, String(v));
  }
  const res = await fetchCmf(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
      body: form.toString(),
    },
    env,
  );
  return decodificarBody(await res.arrayBuffer());
}

/** POST form-urlencoded hacia sistemas legacy. */
export async function postLegacy(
  path: string,
  body: Record<string, string | number | string[] | undefined>,
  env: CmfEnv = {},
  extraParams: Record<string, string> = {},
): Promise<string> {
  const url = `https://www.cmfchile.cl${path}`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => form.append(k, String(x)));
    else form.set(k, String(v));
  }
  const res = await fetchCmf(
    url + (qs.size ? `?${qs}` : ""),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    env,
  );
  const bytes = await res.arrayBuffer();
  return decodificarBody(bytes);
}

/**
 * Envía un formulario legacy A DONDE APUNTA DE VERDAD.
 *
 * Las páginas índice de estadísticas (`..._index.php`) muestran el
 * formulario, pero el atributo action de ese formulario apunta a OTRA
 * página (`sa_eeff_ifrs2grid.php`, `seg_gen_fecu1.php`, ...) y a veces
 * lleva en la query un token que solo existe en el índice
 * (`control=Berlin36`). Enviar el POST al índice devuelve el índice
 * intacto, con total mayor que cero y sin ningún error, y eso pasó en 7
 * tools el 2 de septiembre de 2026. Por eso acá se lee el índice, se
 * busca el formulario y se envía a su action, resuelto contra el índice.
 *
 * El índice se cachea por su ruta y sus parámetros, así que el costo de
 * la segunda petición se paga una vez por TTL, no por consulta.
 */
export async function enviarFormularioLegacy(
  opciones: {
    /** Ruta de la página índice, la que muestra el formulario. */
    indice: string;
    parametrosIndice?: Record<string, string>;
    /** Nombre del <form>. En las estadísticas de la CMF es f1. */
    formulario?: string;
    /** Campos del formulario. Un array se envía repetido (`sociedad[]`). */
    cuerpo: Record<string, string | number | string[] | undefined>;
  },
  env: CmfEnv = {},
): Promise<string> {
  const { indice, parametrosIndice = {}, formulario = "f1", cuerpo } = opciones;
  const qs = new URLSearchParams(parametrosIndice).toString();
  const html = await getLegacy(indice, parametrosIndice, env, `formulario:v1:${indice}?${qs}`);
  const action = accionDeFormulario(html, formulario);
  if (!action) {
    throw new Error(
      `La página índice de la CMF ${indice} no trae el formulario ${formulario}; la CMF pudo cambiar la página. Verifique en https://www.cmfchile.cl${indice}`,
    );
  }
  // El action puede venir con &amp; en vez de &, y así el token viajaría
  // como clave «amp;control» y la CMF devolvería el grid vacío.
  const destino = new URL(action.replace(/&amp;/g, "&"), `https://www.cmfchile.cl${indice}`);
  return postLegacy(destino.pathname, cuerpo, env, Object.fromEntries(destino.searchParams));
}

/** El atributo action del <form name="..."> pedido, o undefined si no está. */
function accionDeFormulario(html: string, nombre: string): string | undefined {
  const re = /<form\b[^>]*>/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const tag = m[0];
    const n = /\bname\s*=\s*["']?([^"'\s>]+)/i.exec(tag);
    if (!n || n[1] !== nombre) continue;
    const a = /\baction\s*=\s*["']([^"']*)["']/i.exec(tag);
    return a?.[1] ?? undefined;
  }
  return undefined;
}

/** GET legacy binario (XLS/BIFF): bytes crudos, sin pasar por texto (TextEncoder corrompe bytes >127). */
export async function getLegacyBinario(
  path: string,
  params: Record<string, string | number | undefined> = {},
  env: CmfEnv = {},
): Promise<Uint8Array> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const url = `https://www.cmfchile.cl${path}${qs.size ? `?${qs}` : ""}`;
  const res = await fetchCmf(url, {}, env);
  return new Uint8Array(await res.arrayBuffer());
}

/** POST form-urlencoded binario: igual que postLegacy pero devuelve los bytes crudos. */
export async function postLegacyBinario(
  path: string,
  body: Record<string, string | number | string[] | undefined>,
  env: CmfEnv = {},
  extraParams: Record<string, string> = {},
): Promise<Uint8Array> {
  const url = `https://www.cmfchile.cl${path}`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => form.append(k, String(x)));
    else form.set(k, String(v));
  }
  const res = await fetchCmf(
    url + (qs.size ? `?${qs}` : ""),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    env,
  );
  return new Uint8Array(await res.arrayBuffer());
}
export async function apiV3<T = unknown>(
  path: string,
  env: CmfEnv,
  formato: "json" | "xml" = "json",
): Promise<T> {
  const key = env.CMF_API_KEY;
  if (!key) throw new Error("CMF_API_KEY no configurada: no se puede consultar la API oficial v3");
  const url = `https://api.sbif.cl/api-sbifv3/recursos_api${path}?apikey=${encodeURIComponent(key)}&formato=${formato}`;
  const res = await fetchCmf(url, {}, env);
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`API v3 error HTTP ${res.status}: ${cuerpo.slice(0, 200)}`);
  }
  const text = await res.text();
  if (formato === "xml") {
    // XML mínimo a JSON (wrapper genérico)
    const re = /<(\w+)>([^<]+)<\/\1>/g;
    const items: Record<string, string>[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      items.push({ [m[1]]: m[2] });
    }
    return items as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/** Lee un resource cmf:// (imagen/documento) con validación de host. */
export async function fetchCmfBinario(url: string, env: CmfEnv = {}): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetchCmf(url, {}, env);
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), contentType: res.headers.get("Content-Type") ?? "application/octet-stream" };
}

/** Descarga binaria con caché LRU por clave (para paquetes: re-descargas sin golpear a la CMF). */
export async function fetchCmfBinarioCached(
  url: string,
  cacheClave: string,
  env: CmfEnv = {},
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const cacheado = cacheBinario.get(cacheClave);
  if (cacheado) return { bytes: cacheado.bytes, contentType: cacheado.contentType };
  const res = await fetchCmf(url, {}, env);
  const buf = await res.arrayBuffer();
  const contentType = res.headers.get("Content-Type") ?? "application/octet-stream";
  cacheBinario.set(cacheClave, { bytes: new Uint8Array(buf), contentType }, config(env).cacheTtlS * 1000);
  return { bytes: new Uint8Array(buf), contentType };
}

