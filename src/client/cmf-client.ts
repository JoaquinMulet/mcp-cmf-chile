import { resolverChallenge, crearCookieJar, conCookiesDelJar, UA_DEFAULT } from "./anti-bot.js";
import { cacheHttp, cacheBinario } from "./cache.js";

/** Entorno del servidor (Workers env o vacío en STDIO). */
export interface CmfEnv {
  /** Interno: módulo wasm de pdf-inspector (solo worker; Node usa el paquete) */
  __pdfModule?: WebAssembly.Module;
  CMF_API_KEY?: string;
  /** Clave para el servicio de BEST (tasas). Si falta, se usa la clave web pública del propio sitio. */
  CMF_BEST_KEY?: string;
  CMF_HTTP_TOKEN?: string;
  CMF_KV?: { get: (k: string) => Promise<string | null>; put: (k: string, v: string, o?: { expirationTtl?: number }) => Promise<void> };
  CMF_RATE_LIMIT_MS?: string;
  CMF_CACHE_TTL_S?: string;
  CMF_MAX_ROWS?: string;
  CMF_UPSTREAM_TIMEOUT_MS?: string;
  /** Cuánto espera una consulta por un cupo del limitador antes de fallar. */
  CMF_ESPERA_CUPO_MS?: string;
  /** Espera antes del único reintento tras un 403 de la CMF. 0 en pruebas. */
  CMF_REINTENTO_403_MS?: string;
  /** Salida chilena: URL https del proxy propio que consulta a www.cmfchile.cl desde Chile. */
  CMF_PROXY_URL?: string;
  /** Secreto compartido con ese proxy. Sin los 2 valores, la salida chilena no existe. */
  CMF_PROXY_TOKEN?: string;
}

/** Cabeceras de un navegador real. Solo se ponen si el llamador no trae las suyas. */
const ACCEPT_NAVEGADOR = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const IDIOMA_NAVEGADOR = "es-CL,es;q=0.9";

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
  "best-sbif-api.azurewebsites.net", // el servicio que alimenta best.cmfchile.cl, el sitio estadístico nuevo de la CMF
]);

const configDefault = {
  rateLimitMs: 1100,
  cacheTtlS: 900,
  maxRows: 500,
  upstreamTimeoutMs: 12000,
  reintento403Ms: 6000,
  // Lo que una consulta espera en la cola antes de recibir «servidor ocupado».
  // No es el máximo que un cupo puede estar ocupado. un documento lento lo
  // ocupa hasta 132 segundos por intento (12 de cabeceras y 120 de cuerpo), y
  // una consulta de 90000 mucho más. Con los 4 cupos así, las demás fallan a
  // los 120 segundos sin que haya ningún cupo perdido.
  esperaCupoMs: 120000,
};

/** Valores ilegibles ya avisados, para no repetir el aviso en cada consulta. */
const ilegiblesAvisados = new Set<string>();

/** Lo más que admite un temporizador. Un valor mayor se baja solo a 1 ms. */
const MAX_ENTERO_DE_ENV = 2147483647;
/**
 * Lo más que vale una pausa entre consultas. Estas pausas corren con el cupo
 * tomado, y el ritmo además reserva el turno siguiente del host. Un ritmo de
 * 2147483647 dejaba ese turno a 24,8 días y congelaba el proceso (medido el 9
 * de octubre de 2026).
 */
const MAX_PAUSA_MS = 60000;

/**
 * Un entero de configuración. Solo vale si es puros dígitos y cae entre
 * `minimo` y lo que admite un temporizador. Cualquier otro valor no se usa.
 * vale el de fábrica, y queda un aviso en el log. Con parseInt, un texto daba
 * NaN y apagaba la protección en silencio. un ritmo NaN estrenaba limitador en
 * cada llamada, sin tope ni espera, y un plazo NaN vencía al milisegundo
 * (medido el 9 de octubre de 2026).
 *
 * El valor puede llegar como número, si en wrangler.jsonc va sin comillas.
 */
function enteroDeEnv(
  variable: keyof CmfEnv,
  crudo: string | number | undefined,
  deFabrica: number,
  minimo = 0,
  maximo = MAX_ENTERO_DE_ENV,
): number {
  if (crudo === undefined || crudo === "") return deFabrica;
  const texto = String(crudo).trim();
  const n = /^[0-9]+$/.test(texto) ? Number(texto) : Number.NaN;
  if (n >= minimo && n <= maximo) return n;
  const clave = `${variable}=${texto}`;
  if (!ilegiblesAvisados.has(clave)) {
    ilegiblesAvisados.add(clave);
    console.warn(JSON.stringify({ cmf_config: { variable, valor: texto.slice(0, 40), usado: deFabrica } }));
  }
  return deFabrica;
}

function config(env: CmfEnv) {
  return {
    reintento403Ms: enteroDeEnv("CMF_REINTENTO_403_MS", env.CMF_REINTENTO_403_MS, configDefault.reintento403Ms, 0, MAX_PAUSA_MS),
    rateLimitMs: enteroDeEnv("CMF_RATE_LIMIT_MS", env.CMF_RATE_LIMIT_MS, configDefault.rateLimitMs, 0, MAX_PAUSA_MS),
    cacheTtlS: enteroDeEnv("CMF_CACHE_TTL_S", env.CMF_CACHE_TTL_S, configDefault.cacheTtlS),
    maxRows: enteroDeEnv("CMF_MAX_ROWS", env.CMF_MAX_ROWS, configDefault.maxRows),
    esperaCupoMs: enteroDeEnv("CMF_ESPERA_CUPO_MS", env.CMF_ESPERA_CUPO_MS, configDefault.esperaCupoMs, 1),
    // Un plazo de 0 vence antes de que nada responda, así que parte en 1.
    upstreamTimeoutMs: enteroDeEnv("CMF_UPSTREAM_TIMEOUT_MS", env.CMF_UPSTREAM_TIMEOUT_MS, configDefault.upstreamTimeoutMs, 1),
  };
}

/** Un cupo tomado. `visto` es la última señal de vida de su dueño. */
interface Cupo {
  visto: number;
  latido?: ReturnType<typeof setInterval>;
}

/** Un puesto en la cola. `fuera` queda en true si alguien lo barrió. */
interface Puesto {
  visto: number;
  fuera: boolean;
}

/** Cada cuánto renueva su señal de vida quien tiene un cupo. */
const LATIDO_MS = 1000;
/** Sin señal de vida por este tiempo, el dueño de un cupo se da por muerto. */
const GRACIA_CUPO_MS = 5000;
/** Cada cuánto mira la cola quien espera un cupo, y renueva su señal. */
const SONDEO_COLA_MS = 50;
/** Sin señal de vida por este tiempo, quien esperaba en la cola se da por muerto. */
const GRACIA_COLA_MS = 2000;
/**
 * Un temporizador que corre con más atraso que este vio el hilo detenido, y no
 * barre. Tiene que ser bastante menor que las 2 gracias. un temporizador que
 * corre a tiempo garantiza que todo temporizador que vencía antes ya corrió,
 * y los que vencían después llevan a lo más este atraso.
 */
const ATRASO_MAXIMO_MS = 1000;
/**
 * Cuántas consultas pueden esperar cupo. Con 4 cupos y el ritmo de fábrica
 * hacia los 13 hosts, en los 120 segundos de espera no alcanzan a pasar más
 * de unas 1400. Sin tope, con 10000 en cola el hilo quedaba ocupado más de 5
 * segundos seguidos solo en sondear, y nadie entraba (medido el 10 de octubre
 * de 2026).
 */
const MAX_COLA = 1000;

/**
 * Rate limiter por host: cola con plazo y max in-flight. Hay UNO por proceso.
 * El ritmo llega en cada espera, porque el tope en vuelo es de la instancia y
 * no de un valor de configuración. Con un limitador por ritmo, 2 valores de
 * CMF_RATE_LIMIT_MS conviviendo dejaban 8 consultas en vuelo (medido el 9 de
 * octubre de 2026).
 *
 * NADIE LE ENTREGA NADA A OTRA PETICIÓN. En Cloudflare Workers este objeto lo
 * comparten todas las peticiones de la instancia, y cuando una petición
 * termina, sus promesas y sus temporizadores pendientes se abandonan. Una
 * consulta abandonada no llega nunca a liberar(). Medido en workerd el 9 de
 * octubre de 2026. con un contador simple, una consulta abandonada con el
 * cupo tomado lo perdía para siempre. Y con una cola que entregaba el cupo al
 * primero, el cupo iba a parar a consultas ya muertas. 4 cupos así dejaban la
 * instancia sin poder consultar a la CMF hasta que Cloudflare la reciclara.
 *
 * Por eso cada cupo y cada puesto en la cola llevan una señal de vida, `visto`,
 * que renueva su propio dueño con sus propios temporizadores. Si el dueño
 * muere, sus temporizadores mueren con él y la señal envejece. Cada consulta
 * toma su cupo ella misma, en su propio contexto.
 *
 * SOLO BARRE UN TEMPORIZADOR QUE CORRIÓ A TIEMPO. Una señal vieja puede ser un
 * dueño muerto o un hilo que estuvo detenido, por ejemplo convirtiendo un PDF
 * de 300 páginas. Mientras el hilo está detenido nadie renueva su señal,
 * tampoco los vivos (medido el 10 de octubre de 2026. una detención de 9,5
 * segundos daba por muertas a las 4 consultas en vuelo). Quien puede
 * distinguir los 2 casos es un temporizador, porque sabe a qué hora le tocaba
 * correr. Si corrió a tiempo, el hilo no estuvo detenido, y todo temporizador
 * de un vivo que vencía antes ya corrió. Una consulta que recién llega no
 * sabe nada de eso, así que no barre. deja un temporizador y barre él.
 *
 * La versión anterior medía el silencio entre 2 eventos cualesquiera, y un
 * silencio largo también es lo que hay cuando no quedó nadie vivo. Con 4
 * cupos y 200 puestos de consultas muertas, cada consulta nueva veía el
 * silencio, no barría, encontraba la cola llena y fallaba al instante, sin
 * fin (medido el 10 de octubre de 2026, por la quinta revisión adversarial).
 */
class RateLimiter {
  private ultimo = new Map<string, number>();
  private tomados = new Set<Cupo>();
  /** Quienes esperan cupo, en orden de llegada. */
  private cola: Puesto[] = [];
  private ultimoBarrido = 0;
  private ultimoAvisoDeDetencion = 0;
  constructor(private maxInflight = 4) {}

  /**
   * Espera cupo y turno, y entrega el cupo, que después se pasa a liberar().
   * Si pasan `esperaCupoMs` sin cupo, lanza. Quien recibe ese error no tomó
   * cupo.
   */
  async esperar(host: string, minMs: number, esperaCupoMs: number): Promise<Cupo> {
    // El cupo se toma en el mismo paso en que se revisa, antes de esperar el
    // turno. Anotarlo después de la espera dejaba pasar la revisión a todas
    // las llamadas lanzadas juntas, con el contador todavía en 0 (10 en vuelo
    // con tope de 4, medido el 9 de octubre de 2026). Y con gente en la cola
    // nadie entra directo, aunque haya un cupo libre.
    let cupo: Cupo;
    if (this.tomados.size < this.maxInflight && this.cola.length === 0) {
      cupo = this.tomar();
      // Quien entra directo no pasa por la cola, así que deja su propio
      // barrido. Sin él, los cupos de consultas muertas no volvían mientras
      // las consultas llegaran de a una.
      this.barrerDespues();
    } else {
      cupo = await this.hacerCola(host, esperaCupoMs);
    }
    // El turno se RESERVA antes de esperar. Si se calculara la espera y
    // recién después se anotara la hora, 5 llamadas lanzadas juntas
    // leerían la misma hora vieja, esperarían lo mismo y saldrían en
    // ráfaga, que es justo lo que los hosts de la CMF bloquean. Medido el
    // 3 de septiembre de 2026 por la revisión adversarial. 4 peticiones en
    // 7 ms con un mínimo de 400 ms.
    const ultimo = this.ultimo.get(host) ?? 0;
    const turno = Math.max(Date.now(), ultimo + minMs);
    this.ultimo.set(host, turno);
    const falta = turno - Date.now();
    if (falta > 0) await new Promise((r) => setTimeout(r, falta));
    return cupo;
  }

  /** Devuelve un cupo. Devolver 2 veces el mismo, o uno que ya se barrió, no hace nada. */
  liberar(cupo: Cupo): void {
    clearInterval(cupo.latido);
    this.tomados.delete(cupo);
  }

  private tomar(): Cupo {
    const cupo: Cupo = { visto: Date.now() };
    cupo.latido = setInterval(() => {
      const ahora = Date.now();
      const aTiempo = this.corrioATiempo(ahora, cupo.visto + LATIDO_MS);
      cupo.visto = ahora;
      if (aTiempo) this.barrer(ahora);
    }, LATIDO_MS);
    // En Node, para que un cupo sin devolver no deje vivo el proceso. En
    // Workers un temporizador es un número y no tiene unref.
    (cupo.latido as { unref?: () => void }).unref?.();
    this.tomados.add(cupo);
    return cupo;
  }

  /**
   * Dice si un temporizador que vencía en `vencia` corrió a tiempo. Si no, el
   * hilo estuvo detenido, y queda un aviso en el log, uno por detención.
   */
  private corrioATiempo(ahora: number, vencia: number): boolean {
    const atraso = ahora - vencia;
    if (atraso <= ATRASO_MAXIMO_MS) return true;
    if (ahora - this.ultimoAvisoDeDetencion > ATRASO_MAXIMO_MS) {
      this.ultimoAvisoDeDetencion = ahora;
      console.warn(JSON.stringify({ cmf_hilo_detenido: { ms: atraso, en_vuelo: this.tomados.size, en_cola: this.cola.length } }));
    }
    return false;
  }

  /** Deja un barrido para dentro de un sondeo, con un temporizador propio. */
  private barrerDespues(): void {
    const vence = Date.now() + SONDEO_COLA_MS;
    const t = setTimeout(() => {
      const ahora = Date.now();
      if (this.corrioATiempo(ahora, vence)) this.barrer(ahora);
    }, SONDEO_COLA_MS);
    (t as { unref?: () => void }).unref?.();
  }

  /**
   * Saca los cupos y los puestos de la cola cuyo dueño dejó de dar señales de
   * vida. Solo lo llama un temporizador que corrió a tiempo.
   */
  private barrer(ahora: number): void {
    // Con muchos en cola, todos sondean en el mismo instante. Basta un barrido.
    if (ahora - this.ultimoBarrido < SONDEO_COLA_MS / 2) return;
    this.ultimoBarrido = ahora;
    for (const cupo of this.tomados) {
      if (ahora - cupo.visto <= GRACIA_CUPO_MS) continue;
      this.liberar(cupo);
      console.warn(JSON.stringify({ cmf_cupo_recuperado: { sin_senal_ms: ahora - cupo.visto, en_vuelo: this.tomados.size } }));
    }
    if (!this.cola.some((puesto) => ahora - puesto.visto > GRACIA_COLA_MS)) return;
    this.cola = this.cola.filter((puesto) => {
      puesto.fuera = ahora - puesto.visto > GRACIA_COLA_MS;
      return !puesto.fuera;
    });
  }

  /**
   * Espera en la cola, en orden de llegada, y toma el cupo cuando es el
   * primero y hay uno libre. Quien espera mira la cola cada SONDEO_COLA_MS con
   * su propio temporizador. Antes de la cola el sondeo no tenía orden, y una
   * cadena de consultas seguidas devolvía su cupo y lo volvía a tomar en el
   * mismo paso, así que quien sondeaba podía no entrar nunca.
   *
   * El plazo existe porque sin él una instancia sin cupos dejaba a toda
   * consulta esperando para siempre y sin rastro.
   */
  private async hacerCola(host: string, esperaCupoMs: number): Promise<Cupo> {
    const limite = Date.now() + esperaCupoMs;
    const puesto: Puesto = { visto: Date.now(), fuera: false };
    // Con la cola llena no entra todavía, pero tampoco se va al instante. La
    // cola puede estar llena de muertos, y un puesto muerto recién se puede
    // barrer cuando pasa su gracia. Espera eso y un poco más.
    const finAntesala = Date.now() + GRACIA_COLA_MS + 10 * SONDEO_COLA_MS;
    let enCola = this.cola.length < MAX_COLA;
    if (enCola) this.cola.push(puesto);
    for (;;) {
      const pausa = Math.max(1, Math.min(SONDEO_COLA_MS, limite - Date.now()));
      const vence = Date.now() + pausa;
      await new Promise((r) => setTimeout(r, pausa));
      const ahora = Date.now();
      const aTiempo = this.corrioATiempo(ahora, vence);
      puesto.visto = ahora;
      if (aTiempo) this.barrer(ahora);
      if (!enCola) {
        // Tras una detención todavía no se barrió, así que no se decide nada.
        if (!aTiempo) continue;
        if (this.cola.length >= MAX_COLA) {
          if (ahora < finAntesala && ahora < limite) continue;
          console.warn(JSON.stringify({ cmf_cupo: { motivo: "cola_llena", en_vuelo: this.tomados.size, en_cola: this.cola.length, host } }));
          throw new Error(
            `El servidor tiene ${this.cola.length} consultas esperando su turno hacia la CMF y no recibe más por ahora. Reintente en unos minutos.`,
          );
        }
        this.cola.push(puesto);
        enCola = true;
      } else if (puesto.fuera) {
        // Otro lo barrió mientras este hilo estaba detenido. Vuelve al final.
        puesto.fuera = false;
        this.cola.push(puesto);
      }
      if (this.cola[0] === puesto && this.tomados.size < this.maxInflight) {
        this.cola.shift();
        return this.tomar();
      }
      if (ahora < limite) continue;
      this.cola = this.cola.filter((otro) => otro !== puesto);
      console.warn(
        JSON.stringify({ cmf_cupo: { en_vuelo: this.tomados.size, en_cola: this.cola.length, espera_ms: esperaCupoMs, host } }),
      );
      throw new Error(
        `El servidor tiene sus ${this.maxInflight} consultas a la CMF ocupadas y esta no alcanzó cupo en ${esperaCupoMs} ms. Reintente en unos minutos.`,
      );
    }
  }
}

const limitador = new RateLimiter();

/** Pone las cabeceras de navegador que el llamador no trajo. Sin Referer, a propósito. */
function cabecerasDeNavegador(headers: Headers): void {
  if (!headers.has("Accept")) headers.set("Accept", ACCEPT_NAVEGADOR);
  if (!headers.has("Accept-Language")) headers.set("Accept-Language", IDIOMA_NAVEGADOR);
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
  /** La página de la CMF que se consulta, cuando `url` es la del proxy. Es la que nombra el error. */
  destino: string = url,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
  return conPlazoDeCuerpo(res, destino, ctrl, timeoutMs);
}

/**
 * El plazo sigue corriendo mientras se lee el cuerpo. Es un plazo de SILENCIO
 * (tiempo sin que llegue un tramo), no del total, para que un documento grande
 * que avanza por un enlace lento termine. Sin esto, una respuesta que mandaba
 * las cabeceras y dejaba el cuerpo abierto retenía su cupo del limitador para
 * siempre, porque resolverChallenge lee el cuerpo con el cupo tomado (medido
 * el 9 de octubre de 2026. 4 respuestas así dejaban la instancia sin cupos).
 *
 * El reloj corre solo mientras alguien lee. Una respuesta que nadie lee no
 * vence, y tampoco la suelta el recolector de basura, así que quien no va a
 * leer una respuesta cancela su cuerpo (lo hace resolverChallenge).
 *
 * Hay además un plazo TOTAL, de PLAZOS_POR_CUERPO veces el de silencio. Sin
 * él, un cuerpo que gotea un tramo antes de cada plazo no vence nunca. Al
 * vencer no se reintenta, porque cada intento ocuparía el cupo otro plazo
 * total. Este sí corre aunque nadie lea. parte con la primera lectura y no
 * se detiene, así que quien recibe una respuesta la lee de corrido.
 */
const PLAZOS_POR_CUERPO = 10;
/** Los errores de plazo total que creó este cliente. fetchCmf los reconoce por acá. */
const plazosTotalesVencidos = new WeakSet<object>();

function conPlazoDeCuerpo(res: Response, url: string, ctrl: AbortController, timeoutMs: number): Response {
  // La red entrega estados que `new Response` rechaza con RangeError. Esas
  // respuestas pasan sin envolver.
  if (!res.body || res.status < 200 || res.status > 599) return res;
  const lector = res.body.getReader();
  const totalMs = timeoutMs * PLAZOS_POR_CUERPO;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finTotal: number | undefined;
  const cuerpo = new ReadableStream<Uint8Array>(
    {
      async pull(salida) {
        // El plazo total parte con la primera lectura.
        finTotal ??= Date.now() + totalMs;
        const restoTotal = Math.max(0, finTotal - Date.now());
        const venceElTotal = restoTotal <= timeoutMs;
        const silencio = new Promise<never>((_, rechazar) => {
          timer = setTimeout(
            () => {
              // Sin la query, que puede llevar una clave.
              const u = new URL(url);
              const pagina = `${u.origin}${u.pathname}`;
              if (!venceElTotal) {
                rechazar(new DOMException(`La CMF dejó de enviar el cuerpo de la respuesta por más de ${timeoutMs} ms (${pagina})`, "AbortError"));
                return;
              }
              // No es AbortError a propósito, para que fetchCmf no lo reintente.
              const total = new DOMException(`La CMF no terminó de enviar el cuerpo de la respuesta en ${totalMs} ms (${pagina})`, "TimeoutError");
              plazosTotalesVencidos.add(total);
              rechazar(total);
            },
            venceElTotal ? restoTotal : timeoutMs,
          );
        });
        try {
          const { done, value } = await Promise.race([lector.read(), silencio]);
          if (done) salida.close();
          else salida.enqueue(value);
        } catch (e) {
          ctrl.abort();
          void lector.cancel(e).catch(() => {});
          throw e;
        } finally {
          clearTimeout(timer);
        }
      },
      cancel(razon) {
        clearTimeout(timer);
        return lector.cancel(razon);
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(cuerpo, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/**
 * Salida chilena. www.cmfchile.cl rechaza las IP de salida de Cloudflare con
 * 403 o 520, corra el Worker en Río o en Santiago (medido el 9 de octubre de
 * 2026 con placement azure:chilecentral). El respaldo es un proxy propio en
 * Chile, que recibe el destino en una cabecera y marca lo que reenvía con
 * x-cmf-salida. Una respuesta sin esa marca es del túnel, no de la CMF.
 */
const HOST_CON_SALIDA = "www.cmfchile.cl";
const CABECERA_DESTINO = "X-Cmf-Destino";
const CABECERA_TOKEN = "X-Cmf-Token";
const MARCA_SALIDA = "x-cmf-salida";
/** El 429 del propio proxy, cuando su cola está llena. No viene de la CMF. */
const MARCA_COLA = "x-cmf-salida-cola";
const ESPERA_COLA_MS = 1500;
const MEMORIA_BLOQUEO_MS = 10 * 60 * 1000;

/** Hasta cuándo se da por bloqueado el camino directo, por URL de proxy. */
const directoBloqueadoHasta = new Map<string, number>();

const esBloqueoDeOrigen = (status: number) => status === 403 || status === 520;

/** Saltos que se siguen por consulta. La CMF encadena 1 o 2, y un círculo no termina nunca. */
const MAX_REDIRECCIONES = 5;

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** El fetch que sale por el proxy, o null si no aplica a este host o no está configurado. */
function salidaChilena(env: CmfEnv, destino: URL, timeoutMs: number): { clave: string; fetchFn: FetchFn } | null {
  if (destino.hostname !== HOST_CON_SALIDA || !env.CMF_PROXY_URL || !env.CMF_PROXY_TOKEN) return null;
  // Una URL mal escrita apaga la salida, no el camino directo.
  if (!URL.canParse(env.CMF_PROXY_URL)) return null;
  const proxy = new URL(env.CMF_PROXY_URL);
  if (proxy.protocol !== "https:") return null;
  const token = env.CMF_PROXY_TOKEN;
  return {
    clave: proxy.toString(),
    fetchFn: (url, init) => {
      const headers = new Headers(init.headers ?? {});
      // Normalizada: una cabecera no admite caracteres fuera de latin1.
      headers.set(CABECERA_DESTINO, new URL(url).toString());
      headers.set(CABECERA_TOKEN, token);
      return fetchConTimeout(proxy.toString(), { ...init, headers }, timeoutMs, url);
    },
  };
}

/** Deja rastro de cada cambio de camino. Nunca lleva el token ni la query. */
function registrarSalida(motivo: "directo_bloqueado" | "proxy_fallo", status: number, destino: URL): void {
  console.warn(JSON.stringify({ cmf_salida: { motivo, status, ruta: destino.pathname } }));
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
  /** Interno. Redirecciones ya seguidas para llegar a esta URL. */
  saltos = 0,
): Promise<Response> {
  const u = validarUrl(url);
  const cfg = config(env);
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("User-Agent")) headers.set("User-Agent", UA_DEFAULT);
  // Solo el sitio web: la API (api.sbif.cl) y los demás hosts no reciben un
  // Accept de página que nadie verificó contra ellos.
  if (u.hostname === "www.cmfchile.cl") cabecerasDeNavegador(headers);
  // Se suman a las que trae quien llama, no las reemplazan. Tras una
  // redirección el jar ya trae la cookie del desafío, y reemplazar acá
  // borraba la cookie de sesión de la consulta.
  conCookiesDelJar(headers, jar, u);

  // El timeout configurado (env) debe aplicar también a los intentos del anti-bot
  const fetchConCfg = (u: string, i: RequestInit) => fetchConTimeout(u, i, cfg.upstreamTimeoutMs);

  let ultimoError: unknown = null;
  // Un 403 de la CMF puede ser de ritmo: se reintenta UNA vez tras una espera.
  // La espera va fuera del turno del limitador (ya se liberó), y el turno
  // siguiente se vuelve a reservar con esperar().
  let reintentado403 = false;
  let trasEspera403 = false;
  // La salida chilena. Si el camino directo ya dio bloqueo hace poco, se parte
  // por el proxy y la CMF directa no recibe otra consulta que va a rechazar.
  let salida = salidaChilena(env, u, cfg.upstreamTimeoutMs);
  let porProxy = salida !== null && (directoBloqueadoHasta.get(salida.clave) ?? 0) > Date.now();
  // El rechazo directo de esta misma consulta. Si después el proxy falla, es
  // lo que se entrega: la verdad sigue siendo «la CMF rechazó al servidor».
  let bloqueoDirecto: Response | null = null;
  for (let intento = 0; intento < 3; intento++) {
    if (intento > 0 && !trasEspera403) await new Promise((r) => setTimeout(r, 500 * 2 ** (intento - 1)));
    trasEspera403 = false;
    let cupo: Cupo;
    try {
      cupo = await limitador.esperar(u.hostname, cfg.rateLimitMs, cfg.esperaCupoMs);
    } catch (sinCupo) {
      // Un reintento que no alcanza cupo no borra lo que ya se sabía de la
      // CMF. El bloqueo directo se entrega, y el error anterior viaja en el
      // mensaje.
      if (bloqueoDirecto) return bloqueoDirecto;
      if (sinCupo instanceof Error && ultimoError instanceof Error) {
        throw new Error(`${sinCupo.message} Antes de eso, ${ultimoError.message}.`);
      }
      throw sinCupo;
    }
    // El try cubre SOLO la consulta, para que el cupo se libere exactamente
    // una vez por cada esperar(). Lo que lanza después (una redirección a un
    // destino no permitido) no vuelve a pasar por el catch.
    let res: Response;
    try {
      res = await resolverChallenge(porProxy && salida ? salida.fetchFn : fetchConCfg, url, { ...init, headers }, jar);
    } catch (e) {
      limitador.liberar(cupo);
      // El plazo total del cuerpo. Quien no terminó es la CMF, venga directa o
      // por el proxy, que seguía entregando tramos. No se reintenta y el proxy
      // no se da por caído. Se reconoce por su marca y no por su nombre, para
      // que un TimeoutError ajeno que venga del proxy siga contando como proxy
      // caído.
      if (plazosTotalesVencidos.has(e as object)) throw e;
      if (porProxy && salida) {
        // Un proxy colgado o sin red es un proxy caído. No se le insiste.
        registrarSalida("proxy_fallo", 0, u);
        directoBloqueadoHasta.delete(salida.clave);
        salida = null;
        porProxy = false;
        if (bloqueoDirecto) return bloqueoDirecto;
        trasEspera403 = true;
        intento--;
        continue;
      }
      ultimoError = e;
      if (intento < 2 && e instanceof DOMException && e.name === "AbortError") continue;
      throw e;
    }
    limitador.liberar(cupo);
    if (porProxy && salida && res.headers.has(MARCA_COLA) && intento < 2) {
      // El proxy está sano y pide esperar. Mandar esto a la CMF directa
      // sería sumar consultas justo cuando hay que bajar el ritmo.
      trasEspera403 = true;
      await new Promise((r) => setTimeout(r, ESPERA_COLA_MS));
      continue;
    }
    if (porProxy && salida && !res.headers.has(MARCA_SALIDA) && !res.headers.has(MARCA_COLA)) {
      // El proxy no contestó como proxy: se olvida y se vuelve al directo.
      registrarSalida("proxy_fallo", res.status, u);
      directoBloqueadoHasta.delete(salida.clave);
      salida = null;
      porProxy = false;
      if (bloqueoDirecto) return bloqueoDirecto;
      trasEspera403 = true;
      intento--;
      continue;
    }
    if (!porProxy && salida && esBloqueoDeOrigen(res.status)) {
      // El cambio de camino no gasta un intento: pasa a lo más 1 vez por consulta.
      registrarSalida("directo_bloqueado", res.status, u);
      directoBloqueadoHasta.set(salida.clave, Date.now() + MEMORIA_BLOQUEO_MS);
      porProxy = true;
      bloqueoDirecto = res;
      trasEspera403 = true;
      intento--;
      continue;
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      // Redirect manual validado (allowlist)
      const next = new URL(res.headers.get("location")!, url).toString();
      const destino = validarUrl(next);
      if (saltos >= MAX_REDIRECCIONES) {
        // Sin la query, que puede llevar una clave.
        throw new Error(
          `La CMF respondió más de ${MAX_REDIRECCIONES} redirecciones seguidas y la consulta se cortó. La última apunta a ${destino.origin}${destino.pathname}`,
        );
      }
      return fetchCmf(next, { ...init, headers }, env, jar, saltos + 1);
    }
    if (res.status >= 500 && intento < 2) {
      ultimoError = new Error(`HTTP ${res.status} de la CMF (intento ${intento + 1})`);
      continue;
    }
    if (res.status === 403 && !reintentado403 && intento < 2) {
      reintentado403 = true;
      trasEspera403 = true;
      await new Promise((r) => setTimeout(r, cfg.reintento403Ms));
      continue;
    }
    if (reintentado403) trasReintento403.add(res);
    return res;
  }
  throw ultimoError instanceof Error
    ? new Error(`La red de la CMF rechazó la conexión tras 3 intentos (algunos hosts, como datosbanco, bloquean IPs de datacenter): ${ultimoError.message}`)
    : new Error("Fallo de red hacia la CMF");
}

/**
 * La CMF respondió, pero no con datos: 4xx, 5xx o la página «Attack ID» del
 * cortafuegos F5. Hasta el 14 de septiembre de 2026 estas páginas seguían
 * al parser y salían como «sin datos» o «Sin ZIP», y el cliente quemaba sus
 * intentos contra un origen que lo estaba rechazando. El estado HTTP se
 * lleva en el error para que quien llama distinga bloqueo de dato ausente.
 */
export class CmfUpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly host: string,
    readonly motivo: "http" | "cortafuegos" | "no_binario",
  ) {
    super(
      motivo === "cortafuegos"
        ? `La CMF (${host}) devolvió la página del cortafuegos (HTTP ${status}, «Attack ID»): bloqueo, no ausencia de datos`
        : motivo === "no_binario"
          ? `La CMF (${host}) devolvió una página HTML donde iba un documento (HTTP ${status}): bloqueo o error, no ausencia de datos`
          : status === 403
            ? `La CMF (${host}) rechazó la consulta desde el servidor del MCP (HTTP 403). El dato puede existir, y la misma URL suele abrir desde un navegador. Es bloqueo o caída, no ausencia de datos.`
            : `La CMF (${host}) respondió HTTP ${status} en vez de datos: bloqueo o caída, no ausencia de datos`,
    );
    this.name = "CmfUpstreamError";
  }
}

const MARCA_CORTAFUEGOS = /Attack ID|The requested URL was rejected/i;

/** Respuestas que llegaron tras el reintento de 403, para dejarlo escrito en el log. */
const trasReintento403 = new WeakSet<Response>();

/** Subconjunto fijo de cabeceras que sirve para leer un bloqueo en Workers Logs. */
const CABECERAS_DIAGNOSTICO = ["server", "content-type", "content-length", "retry-after", "cf-ray", "x-cache", "via"];

function cabecerasDeDiagnostico(res: Response): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const nombre of CABECERAS_DIAGNOSTICO) {
    const valor = res.headers.get(nombre);
    if (valor !== null) salida[nombre] = valor;
  }
  return salida;
}

/** Solo los NOMBRES de las cookies de set-cookie. Un valor de sesión no va al log. */
function nombresDeCookies(res: Response): string[] {
  const lineas = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return lineas.map((linea) => linea.split(";")[0].split("=")[0].trim()).filter(Boolean);
}

/**
 * Deja en el log la respuesta que no fue datos. La query de la URL no se
 * registra (lleva tokens); solo el host y la ruta. El cuerpo se corta a 160.
 */
function registrarRespuestaInutil(
  res: Response,
  url: string,
  cuerpo: string,
  marcas: { cortafuegos?: boolean; no_binario?: boolean },
): void {
  const u = new URL(url);
  console.warn(
    JSON.stringify({
      cmf_upstream: {
        host: u.hostname,
        status: res.status,
        ...marcas,
        reintento_403: trasReintento403.has(res),
        ruta: u.pathname,
        cabeceras: cabecerasDeDiagnostico(res),
        cookies: nombresDeCookies(res),
        inicio: cuerpo.slice(0, 160),
      },
    }),
  );
}

/**
 * Lanza CmfUpstreamError si la respuesta no es datos. El cuerpo solo se lee
 * en el camino de error (o cuando ya viene como texto), así que una descarga
 * sana no pasa por aquí y sus bytes quedan intactos.
 */
async function exigirRespuestaUtil(res: Response, url: string, texto?: string): Promise<void> {
  if (res.ok && texto === undefined) return;
  const host = new URL(url).hostname;
  const cuerpo = texto ?? decodificarBody(await res.arrayBuffer());
  const cortafuegos = MARCA_CORTAFUEGOS.test(cuerpo.slice(0, 4000));
  if (res.ok && !cortafuegos) return;
  registrarRespuestaInutil(res, url, cuerpo, { cortafuegos });
  throw new CmfUpstreamError(res.status, host, cortafuegos ? "cortafuegos" : "http");
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
  await exigirRespuestaUtil(res, url, texto);
  if (cacheClave) cacheHttp.set(cacheClave, texto, config(env).cacheTtlS * 1000);
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
  const texto = decodificarBody(bytes);
  await exigirRespuestaUtil(res, url, texto);
  return texto;
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
  await exigirRespuestaUtil(res, url);
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
  await exigirRespuestaUtil(res, url);
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
  await exigirRespuestaUtil(res, url);
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), contentType: res.headers.get("Content-Type") ?? "application/octet-stream" };
}

/** Un documento que llega como HTML es una página de error o de bloqueo, no el documento. */
function exigirBinario(res: Response, url: string, bytes: Uint8Array): void {
  const contentType = res.headers.get("Content-Type") ?? "";
  const inicio = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512));
  if (!/text\/html/i.test(contentType) && !/^\s*<(!doctype|html)/i.test(inicio)) return;
  const host = new URL(url).hostname;
  registrarRespuestaInutil(res, url, inicio, { no_binario: true });
  throw new CmfUpstreamError(res.status, host, MARCA_CORTAFUEGOS.test(inicio) ? "cortafuegos" : "no_binario");
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
  await exigirRespuestaUtil(res, url);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Antes se cacheaba sin mirar el estado: una página de error quedaba 15
  // minutos como si fuera el PDF.
  exigirBinario(res, url, bytes);
  const contentType = res.headers.get("Content-Type") ?? "application/octet-stream";
  cacheBinario.set(cacheClave, { bytes, contentType }, config(env).cacheTtlS * 1000);
  return { bytes, contentType };
}

