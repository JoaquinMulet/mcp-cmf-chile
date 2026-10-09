/**
 * Cuando la CMF rechaza al Worker, la consulta sale por una IP chilena.
 *
 * Medido el 9 de octubre de 2026. www.cmfchile.cl respondió 403 y 520 a toda
 * consulta que salía del Worker, corriera en Río de Janeiro (GIG) o en
 * Santiago (SCL, con placement azure:chilecentral). Desde una IP doméstica
 * chilena las mismas consultas pasaban. El bloqueo es por la IP de salida de
 * Cloudflare, así que el respaldo es un proxy propio en Chile. Estas pruebas
 * fijan cuándo se usa, qué viaja hacia él y qué pasa cuando no responde.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CmfUpstreamError, fetchCmf, getLegacy } from "../src/client/cmf-client.js";

const RUTA = "/institucional/mercados/entidad.php";
const DESTINO = `https://www.cmfchile.cl${RUTA}?rut=90749000&pestania=1`;
const PAGINA = `<html><table><tr><td>Rut</td><td>90749000</td></tr></table>${"x".repeat(200)}</html>`;

type Llamada = { url: string; method: string; headers: Headers; body: string };

/** Cada prueba usa su propio proxy, porque el cliente recuerda el bloqueo por proxy. */
function entorno(n: number, extra: Record<string, string> = {}) {
  return {
    CMF_RATE_LIMIT_MS: "0",
    CMF_REINTENTO_403_MS: "0",
    CMF_PROXY_URL: `https://salida-${n}.example.cl/`,
    CMF_PROXY_TOKEN: "token-de-prueba",
    ...extra,
  };
}

/** La CMF directa responde `directo`; el proxy responde `proxy`. Guarda cada llamada. */
async function conRed<T>(
  directo: () => Response,
  proxy: () => Response,
  fn: (llamadas: Llamada[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const avisoOriginal = console.warn;
  const llamadas: Llamada[] = [];
  console.warn = () => {};
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    llamadas.push({ url: u, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    return new URL(u).hostname.endsWith(".example.cl") ? proxy() : directo();
  }) as typeof fetch;
  try {
    return await fn(llamadas);
  } finally {
    globalThis.fetch = original;
    console.warn = avisoOriginal;
  }
}

const bloqueo403 = () => new Response("<html><title>403 Forbidden</title></html>", { status: 403 });
const bloqueo520 = () => new Response("error code: 520\n", { status: 520 });
const delProxy = (cuerpo: string, status = 200) => () =>
  new Response(cuerpo, { status, headers: { "x-cmf-salida": "1", "content-type": "text/html" } });

const alProxy = (llamadas: Llamada[]) => llamadas.filter((l) => new URL(l.url).hostname.endsWith(".example.cl"));
const alDirecto = (llamadas: Llamada[]) => llamadas.filter((l) => !new URL(l.url).hostname.endsWith(".example.cl"));

test("un 403 directo se resuelve por la salida chilena, sin esperar el reintento", () =>
  conRed(bloqueo403, delProxy(PAGINA), async (llamadas) => {
    const env = entorno(1, { CMF_REINTENTO_403_MS: "5000" });
    const inicio = Date.now();
    const texto = await getLegacy(RUTA, { rut: "90749000", pestania: 1 }, env);
    assert.equal(texto, PAGINA);
    assert.ok(Date.now() - inicio < 2000, "no debe pagar la espera del reintento de 403");
    assert.equal(alDirecto(llamadas).length, 1);
    const [p] = alProxy(llamadas);
    assert.equal(p.url, "https://salida-1.example.cl/");
    assert.equal(p.headers.get("x-cmf-destino"), DESTINO);
    assert.equal(p.headers.get("x-cmf-token"), "token-de-prueba");
    assert.match(p.headers.get("user-agent") ?? "", /Mozilla/);
    assert.match(p.headers.get("accept-language") ?? "", /es-CL/);
  }));

test("un 520 directo también es bloqueo de origen y sale por el proxy", () =>
  conRed(bloqueo520, delProxy(PAGINA), async (llamadas) => {
    const texto = await getLegacy(RUTA, { rut: "90749000", pestania: 1 }, entorno(2));
    assert.equal(texto, PAGINA);
    assert.equal(alDirecto(llamadas).length, 1);
    assert.equal(alProxy(llamadas).length, 1);
  }));

test("el método y el cuerpo de un POST viajan intactos al proxy", () =>
  conRed(bloqueo403, delProxy(PAGINA), async (llamadas) => {
    const res = await fetchCmf(
      DESTINO,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "aa=2026&mm=03" },
      entorno(3),
    );
    assert.equal(res.status, 200);
    const [p] = alProxy(llamadas);
    assert.equal(p.method, "POST");
    assert.equal(p.body, "aa=2026&mm=03");
    assert.equal(p.headers.get("content-type"), "application/x-www-form-urlencoded");
  }));

test("el bloqueo se recuerda: la consulta siguiente va directo al proxy", () =>
  conRed(bloqueo403, delProxy(PAGINA), async (llamadas) => {
    const env = entorno(4);
    await getLegacy(RUTA, { rut: "90749000", pestania: 1 }, env);
    await getLegacy(RUTA, { rut: "90749000", pestania: 1 }, env);
    assert.equal(alDirecto(llamadas).length, 1, "la segunda consulta no vuelve a golpear a la CMF directa");
    assert.equal(alProxy(llamadas).length, 2);
  }));

test("sin proxy configurado, el 403 sigue subiendo como bloqueo", () =>
  conRed(bloqueo403, delProxy(PAGINA), async (llamadas) => {
    const env = { CMF_RATE_LIMIT_MS: "0", CMF_REINTENTO_403_MS: "0" };
    await assert.rejects(
      getLegacy(RUTA, { rut: "90749000", pestania: 1 }, env),
      (e: unknown) => e instanceof CmfUpstreamError && e.status === 403,
    );
    assert.equal(alProxy(llamadas).length, 0);
  }));

test("la salida chilena solo sirve a www.cmfchile.cl", () =>
  conRed(bloqueo403, delProxy(PAGINA), async (llamadas) => {
    const res = await fetchCmf("https://api.sbif.cl/api-sbifv3/recursos_api/uf?formato=json", {}, entorno(5));
    assert.equal(res.status, 403);
    assert.equal(alProxy(llamadas).length, 0);
  }));

test("si el proxy no responde como proxy, sube el bloqueo original y no se recuerda", () =>
  // Un 502 sin la marca x-cmf-salida es del túnel o de Cloudflare, no de la CMF.
  conRed(bloqueo403, () => new Response("error code: 1033", { status: 530 }), async (llamadas) => {
    const env = entorno(6);
    await assert.rejects(
      getLegacy(RUTA, { rut: "90749000", pestania: 1 }, env),
      (e: unknown) => e instanceof CmfUpstreamError && e.status === 403,
    );
    assert.equal(alProxy(llamadas).length, 1);
    const antes = alDirecto(llamadas).length;
    await assert.rejects(getLegacy(RUTA, { rut: "90749000", pestania: 1 }, env));
    assert.ok(alDirecto(llamadas).length > antes, "con el proxy caído, la consulta siguiente vuelve a probar directo");
  }));

test("un error que la CMF manda por el proxy sigue siendo un error de la CMF", () =>
  conRed(bloqueo403, delProxy("<html>No encontrado</html>", 404), async () => {
    await assert.rejects(
      getLegacy(RUTA, { rut: "90749000", pestania: 1 }, entorno(7)),
      (e: unknown) => e instanceof CmfUpstreamError && e.status === 404,
    );
  }));

test("el token de la salida no aparece en el log", () =>
  conRed(bloqueo403, () => new Response("no", { status: 530 }), async () => {
    const lineas: string[] = [];
    console.warn = (l: unknown) => lineas.push(String(l));
    await assert.rejects(getLegacy(RUTA, { rut: "90749000", pestania: 1 }, entorno(8)));
    assert.ok(lineas.some((l) => l.includes("cmf_salida")), "el cambio de salida deja rastro");
    assert.ok(!lineas.some((l) => l.includes("token-de-prueba")));
  }));

// Lo que sigue lo encontró la revisión adversarial del 9 de octubre de 2026.

test("un proxy que cuelga o falla de red entrega el bloqueo original y se olvida", async () => {
  const original = globalThis.fetch;
  const avisoOriginal = console.warn;
  const lineas: string[] = [];
  const orden: string[] = [];
  console.warn = (l: unknown) => lineas.push(String(l));
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (new URL(String(url)).hostname.endsWith(".example.cl")) {
      orden.push("P");
      throw new DOMException("The operation was aborted", "AbortError");
    }
    orden.push("D");
    return bloqueo403();
  }) as typeof fetch;
  try {
    const env = entorno(9);
    await assert.rejects(
      getLegacy(RUTA, { rut: "90749000", pestania: 1 }, env),
      (e: unknown) => e instanceof CmfUpstreamError && e.status === 403,
    );
    assert.deepEqual(orden, ["D", "P"], "un solo intento por el proxy, sin repetirlo 3 veces");
    assert.ok(lineas.some((l) => l.includes("proxy_fallo")), "la caída del proxy deja rastro");
    orden.length = 0;
    await assert.rejects(getLegacy(RUTA, { rut: "90749000", pestania: 1 }, env));
    assert.equal(orden[0], "D", "el bloqueo no quedó recordado con el proxy caído");
  } finally {
    globalThis.fetch = original;
    console.warn = avisoOriginal;
  }
});

test("una URL con un carácter fuera de latin1 viaja codificada al proxy", () =>
  conRed(bloqueo403, delProxy(PAGINA), async (llamadas) => {
    const res = await fetchCmf("https://www.cmfchile.cl/x.php?nombre=Memoria – 2025", {}, entorno(10));
    assert.equal(res.status, 200);
    const [p] = alProxy(llamadas);
    assert.equal(p.headers.get("x-cmf-destino"), "https://www.cmfchile.cl/x.php?nombre=Memoria%20%E2%80%93%202025");
  }));

test("la cola llena del proxy se espera y se reintenta por el proxy, sin golpear a la CMF directa", async () => {
  let n = 0;
  const cola = () => new Response("cola llena", { status: 429, headers: { "x-cmf-salida-cola": "1" } });
  await conRed(bloqueo403, () => (n++ === 1 ? cola() : delProxy(PAGINA)()), async (llamadas) => {
    const env = entorno(11);
    await getLegacy(RUTA, { rut: "90749000", pestania: 1 }, env);
    const directas = alDirecto(llamadas).length;
    const texto = await getLegacy(RUTA, { rut: "90749000", pestania: 1 }, env);
    assert.equal(texto, PAGINA);
    assert.equal(alDirecto(llamadas).length, directas, "ninguna consulta nueva a la CMF directa");
    assert.equal(alProxy(llamadas).length, 3);
  });
});

test("un bloqueo que aparece en el tercer intento directo también sale por el proxy", async () => {
  let n = 0;
  await conRed(
    () => (n++ < 2 ? new Response("caída", { status: 500 }) : bloqueo403()),
    delProxy(PAGINA),
    async (llamadas) => {
      const texto = await getLegacy(RUTA, { rut: "90749000", pestania: 1 }, entorno(12));
      assert.equal(texto, PAGINA);
      assert.equal(alDirecto(llamadas).length, 3);
      assert.equal(alProxy(llamadas).length, 1);
    },
  );
});

test("una CMF_PROXY_URL mal escrita no tumba el camino directo", () =>
  conRed(() => new Response(PAGINA, { status: 200 }), delProxy("no"), async (llamadas) => {
    const env = { ...entorno(13), CMF_PROXY_URL: "cmf-salida.kumocloud.cl" };
    const texto = await getLegacy(RUTA, { rut: "90749000", pestania: 1 }, env);
    assert.equal(texto, PAGINA);
    assert.equal(alDirecto(llamadas).length, 1);
  }));

test("una redirección que llega por el proxy se sigue por el proxy", async () => {
  let n = 0;
  const redireccion = () =>
    new Response("", { status: 302, headers: { "x-cmf-salida": "1", location: "/institucional/otra.php?a=1" } });
  await conRed(bloqueo403, () => (n++ === 0 ? redireccion() : delProxy(PAGINA)()), async (llamadas) => {
    const res = await fetchCmf(DESTINO, {}, entorno(14));
    assert.equal(await res.text(), PAGINA);
    assert.equal(alDirecto(llamadas).length, 1);
    assert.equal(alProxy(llamadas)[1].headers.get("x-cmf-destino"), "https://www.cmfchile.cl/institucional/otra.php?a=1");
  });
});
