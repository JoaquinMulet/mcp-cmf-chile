/**
 * El limitador nunca deja más de 4 consultas en vuelo a la vez.
 *
 * Visto por lectura el 9 de octubre de 2026. fetchCmf liberaba su cupo justo
 * después de recibir la respuesta, y si esa respuesta era una redirección a
 * un host fuera de la lista o a http, la validación lanzaba dentro del mismo
 * try y el catch liberaba otra vez. El contador quedaba en -1 y el tope
 * pasaba a 5 para toda la instancia, sin ningún aviso.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCmf } from "../src/client/cmf-client.js";

const LENTA_MS = 120;
const TOPE = 4;

type Respuesta = (url: string) => Response | undefined;

/**
 * Simula la red. `especial` responde las consultas que elige, y el resto son
 * consultas lentas que cuentan cuántas hay en vuelo. Devuelve el máximo visto.
 */
async function conRedLenta(especial: Respuesta, fn: (avisos: string[]) => Promise<void>): Promise<number> {
  const original = globalThis.fetch;
  const avisoOriginal = console.warn;
  const avisos: string[] = [];
  let enVuelo = 0;
  let maximo = 0;
  console.warn = (linea: unknown) => {
    avisos.push(String(linea));
  };
  globalThis.fetch = (async (url: string | URL | Request) => {
    const propia = especial(String(url));
    if (propia) return propia;
    enVuelo++;
    maximo = Math.max(maximo, enVuelo);
    await new Promise((r) => setTimeout(r, LENTA_MS));
    enVuelo--;
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    await fn(avisos);
    return maximo;
  } finally {
    globalThis.fetch = original;
    console.warn = avisoOriginal;
  }
}

const redireccionA = (destino: string): Respuesta => (url) =>
  url.includes("/redirige") ? new Response(null, { status: 302, headers: { location: destino } }) : undefined;

const lanzarLentas = (cuantas: number, env: Record<string, string>) =>
  Promise.all(
    Array.from({ length: cuantas }, (_, i) => fetchCmf(`https://www.cmfchile.cl/institucional/lenta${i}.php`, {}, env)),
  );

for (const [nombre, destino] of [
  ["un host fuera de la lista", "https://otro-sitio.example.com/pagina"],
  ["http sin cifrar", "http://www.cmfchile.cl/pagina"],
] as const) {
  test(`una redirección a ${nombre} se rechaza y no afloja el tope de ${TOPE} en vuelo`, async () => {
    // Sin espera entre turnos, para que el cupo se revise y se anote en el
    // mismo paso y lo único que pueda aflojar el tope sea la doble liberación.
    const env = { CMF_RATE_LIMIT_MS: "0" };
    const maximo = await conRedLenta(redireccionA(destino), async () => {
      await assert.rejects(
        fetchCmf("https://www.cmfchile.cl/redirige", {}, env),
        /Host no permitido|Solo se permiten URLs HTTPS/,
      );
      await lanzarLentas(10, env);
    });
    assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
  });
}

// El segundo camino al mismo daño, que apareció al escribir esta prueba. El
// cupo se revisaba antes de esperar el turno y se anotaba después, así que
// las consultas lanzadas juntas pasaban todas la revisión con el contador en 0.
test(`10 consultas lanzadas juntas, con espera entre turnos, nunca pasan de ${TOPE} en vuelo`, async () => {
  const env = { CMF_RATE_LIMIT_MS: "5" };
  const maximo = await conRedLenta(
    () => undefined,
    () => lanzarLentas(10, env).then(() => {}),
  );
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

test("una redirección no permitida que llega por la salida chilena es un error de destino, no un proxy caído", async () => {
  const env = {
    CMF_RATE_LIMIT_MS: "0",
    CMF_REINTENTO_403_MS: "0",
    CMF_PROXY_URL: "https://salida-tope.example.cl/",
    CMF_PROXY_TOKEN: "token-de-prueba",
  };
  const red: Respuesta = (url) =>
    new URL(url).hostname.endsWith(".example.cl")
      ? new Response(null, { status: 302, headers: { "x-cmf-salida": "1", location: "https://otro-sitio.example.com/" } })
      : url.includes("/bloqueada")
        ? new Response("<html><title>403 Forbidden</title></html>", { status: 403 })
        : undefined;
  const maximo = await conRedLenta(red, async (avisos) => {
    await assert.rejects(fetchCmf("https://www.cmfchile.cl/bloqueada", {}, env), /Host no permitido/);
    assert.ok(!avisos.some((a) => a.includes("proxy_fallo")), `no debe anotar un proxy caído. ${avisos.join(" | ")}`);
    // El proxy quedó recordado para esta instancia: estas van al host de
    // prueba de la CMF directa solo si el cliente lo olvidó por error.
    await lanzarLentas(10, { CMF_RATE_LIMIT_MS: "0" });
  });
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});
