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

// Con un plazo corto de cupo. El limitador es uno solo para todo el archivo,
// así que una prueba que pierde cupos deja sin cupo a las que siguen. Con este
// plazo esas pruebas salen rojas a los 3 segundos, en vez de esperar los 120
// de fábrica.
const lanzarLentas = (cuantas: number, env: Record<string, string>) =>
  Promise.all(
    Array.from({ length: cuantas }, (_, i) =>
      fetchCmf(`https://www.cmfchile.cl/institucional/lenta${i}.php`, {}, { CMF_ESPERA_CUPO_MS: "3000", ...env }),
    ),
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

// El tercer camino, de la revisión adversarial del 9 de octubre de 2026. Había
// un limitador por ritmo, y cada cambio de CMF_RATE_LIMIT_MS estrenaba uno con
// el contador en 0. Con 2 ritmos conviviendo quedaban 8 consultas en vuelo.
test(`2 ritmos distintos conviviendo comparten el tope de ${TOPE} en vuelo`, async () => {
  const maximo = await conRedLenta(
    () => undefined,
    () => Promise.all([lanzarLentas(10, { CMF_RATE_LIMIT_MS: "0" }), lanzarLentas(10, { CMF_RATE_LIMIT_MS: "1" })]).then(() => {}),
  );
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

// La espera de cupo tenía una cola sin plazo. Un cupo perdido por un defecto
// dejaba a toda consulta posterior esperando para siempre y en silencio.
test("una consulta que no alcanza cupo dentro del plazo falla con un error que lo dice, y no toca el contador", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  const maximo = await conRedLenta(
    () => undefined,
    async (avisos) => {
      const ocupadas = lanzarLentas(TOPE, env);
      // A OTRO host, para que lo único que la frene sea el cupo. Las 4 de
      // arriba tardan 120 ms, así que con 30 ms de plazo no lo alcanza.
      await assert.rejects(
        fetchCmf("https://api.sbif.cl/sin-cupo", {}, { ...env, CMF_ESPERA_CUPO_MS: "30" }),
        /4 consultas a la CMF ocupadas.*30 ms/,
      );
      assert.ok(avisos.some((a) => a.includes("cmf_cupo")), `sin aviso en el log. ${avisos.join(" | ")}`);
      await ocupadas;
      // La que no alcanzó cupo tampoco lo devuelve. Si lo devolviera, el máximo pasaría del tope.
      await lanzarLentas(10, env);
    },
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
    await lanzarLentas(10, { CMF_RATE_LIMIT_MS: "0" });
  });
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

// La otra mitad de «exactamente una vez». Si la consulta lanza, el cupo se
// devuelve en el catch. Sin esa devolución el máximo queda bajo el tope.
test("una consulta que falla en la red devuelve su cupo", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  const red: Respuesta = (url) => {
    if (url.includes("/sin-red")) throw new TypeError("fetch failed");
    return undefined;
  };
  const maximo = await conRedLenta(red, async () => {
    for (const i of [1, 2]) {
      await assert.rejects(fetchCmf(`https://www.cmfchile.cl/sin-red${i}`, {}, env), /fetch failed/);
    }
    await lanzarLentas(10, env);
  });
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

test("un proxy que falla en la red devuelve su cupo", async () => {
  const env = {
    CMF_RATE_LIMIT_MS: "0",
    CMF_REINTENTO_403_MS: "0",
    CMF_PROXY_URL: "https://salida-sin-red.example.cl/",
    CMF_PROXY_TOKEN: "token-de-prueba",
  };
  const red: Respuesta = (url) => {
    if (new URL(url).hostname.endsWith(".example.cl")) throw new TypeError("fetch failed");
    return url.includes("/bloqueada") ? new Response("<html><title>403 Forbidden</title></html>", { status: 403 }) : undefined;
  };
  const maximo = await conRedLenta(red, async () => {
    for (const i of [1, 2]) {
      const res = await fetchCmf(`https://www.cmfchile.cl/bloqueada${i}`, {}, env);
      assert.equal(res.status, 403);
    }
    await lanzarLentas(10, { CMF_RATE_LIMIT_MS: "0" });
  });
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});
