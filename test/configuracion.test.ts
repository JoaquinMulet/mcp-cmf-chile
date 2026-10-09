/**
 * Un valor ilegible de configuración no apaga una protección en silencio.
 *
 * Lo midió la revisión adversarial del 9 de octubre de 2026 con
 * CMF_RATE_LIMIT_MS. parseInt de un texto da NaN, NaN nunca es igual a sí
 * mismo, y el cliente estrenaba un limitador en cada llamada: sin tope en
 * vuelo y sin espera entre consultas. Las otras variables numéricas caían
 * igual. un plazo NaN vence al milisegundo y ninguna consulta llegaba.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCmf } from "../src/client/cmf-client.js";

const TOPE = 4;
const RITMO_DE_FABRICA_MS = 1100;

/** Simula una red donde cada consulta tarda `ms`. Entrega el máximo en vuelo, las horas de salida y los avisos. */
async function conRedLenta(ms: number, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  const avisoOriginal = console.warn;
  const avisos: string[] = [];
  const salidas: number[] = [];
  let enVuelo = 0;
  let maximo = 0;
  console.warn = (linea: unknown) => {
    avisos.push(String(linea));
  };
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    salidas.push(Date.now());
    enVuelo++;
    maximo = Math.max(maximo, enVuelo);
    await new Promise((r) => setTimeout(r, ms));
    enVuelo--;
    // Como la red de verdad. una consulta abortada por su plazo no responde.
    if (init?.signal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    await fn();
    return { maximo, salidas, avisos };
  } finally {
    globalThis.fetch = original;
    console.warn = avisoOriginal;
  }
}

test("un plazo ilegible vale el de fábrica, no un plazo que vence al instante", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: "doce segundos" };
  await conRedLenta(60, async () => {
    const res = await fetchCmf("https://www.cmfchile.cl/plazo-ilegible", {}, env);
    assert.equal(await res.text(), "ok");
  });
});

test(`un ritmo ilegible no afloja el tope de ${TOPE} en vuelo`, async () => {
  const env = { CMF_RATE_LIMIT_MS: "rapido" };
  // A 6 hosts distintos, para que la espera entre consultas al mismo host no
  // las separe y lo único que las contenga sea el tope. Ninguno se repite en
  // otra prueba de este archivo, porque el limitador recuerda el último turno
  // de cada host y el ritmo de fábrica haría esperar a la consulta repetida.
  const hosts = ["best-cmf.cl", "api.sbif.cl", "tasas.cmfchile.cl", "datosbanco.cmfchile.cl", "acreencias.cmfchile.cl", "conocetuseguro.cl"];
  const { maximo } = await conRedLenta(120, async () => {
    await Promise.all(hosts.map((h) => fetchCmf(`https://${h}/ritmo-ilegible`, {}, env)));
  });
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

test("un ritmo ilegible vale el de fábrica, y el aviso sale una sola vez con la variable y el valor", async () => {
  const env = { CMF_RATE_LIMIT_MS: "muy rapido" };
  let lanzamiento = 0;
  const { salidas, avisos } = await conRedLenta(1, async () => {
    lanzamiento = Date.now();
    await Promise.all([1, 2].map((i) => fetchCmf(`https://cronologiabancaria.cmfchile.cl/ritmo${i}`, {}, env)));
  });
  const segunda = Math.max(...salidas) - lanzamiento;
  assert.ok(segunda >= RITMO_DE_FABRICA_MS - 5, `la segunda consulta salió a los ${segunda} ms`);
  const propios = avisos.filter((a) => a.includes("cmf_config"));
  assert.equal(propios.length, 1, `avisos. ${avisos.join(" | ")}`);
  assert.deepEqual(JSON.parse(propios[0]), {
    cmf_config: { variable: "CMF_RATE_LIMIT_MS", valor: "muy rapido", usado: RITMO_DE_FABRICA_MS },
  });
});

// Los valores que la revisión adversarial del arreglo mostró que seguían
// pasando. Un plazo de 0, negativo, de solo espacios o mayor que lo que
// admite un temporizador (2147483647) vence al milisegundo, y ninguna
// consulta llega. La prueba mira el EFECTO, que la consulta llegue, y no solo
// que exista el aviso.
for (const valor of ["-5", "0.5", " ", "0", "3000000000", "1e2", "0x40", "12000ms"]) {
  test(`un plazo «${valor}» no se usa. la consulta llega y queda el aviso`, async () => {
    const env = { CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: valor };
    const { avisos } = await conRedLenta(150, async () => {
      const res = await fetchCmf("https://www.cmfchile.cl/otro-plazo", {}, env);
      assert.equal(await res.text(), "ok");
    });
    assert.equal(avisos.filter((a) => a.includes("CMF_UPSTREAM_TIMEOUT_MS")).length, 1, `avisos. ${avisos.join(" | ")}`);
  });
}

test("un valor que llega como número y no como texto no revienta la consulta", async () => {
  // En wrangler.jsonc basta escribir el valor sin comillas.
  const env = { CMF_RATE_LIMIT_MS: 0, CMF_REINTENTO_403_MS: 1.5 } as unknown as Record<string, string>;
  const { avisos } = await conRedLenta(1, async () => {
    const res = await fetchCmf("https://www.cmfchile.cl/valor-numerico", {}, env);
    assert.equal(await res.text(), "ok");
  });
  assert.equal(avisos.filter((a) => a.includes("cmf_config")).length, 1, `avisos. ${avisos.join(" | ")}`);
});
