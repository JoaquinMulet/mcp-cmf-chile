/**
 * Las redirecciones tienen un tope de saltos.
 *
 * Lo demostró la revisión adversarial del 9 de octubre de 2026. fetchCmf se
 * llamaba a sí misma por cada 3xx, sin contador. Un 302 hacia la misma URL
 * dio 201 saltos seguidos, y lo cortó la prueba, no el cliente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCmf } from "../src/client/cmf-client.js";

const TOPE_SALTOS = 5;
const ENV = { CMF_RATE_LIMIT_MS: "0" };

/** Simula la red y cuenta las consultas que salen. */
async function conRed(red: (url: string, n: number) => Response, fn: () => Promise<void>): Promise<number> {
  const original = globalThis.fetch;
  let consultas = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    consultas++;
    // El corte de la prueba. Si se llega acá, el cliente no tiene tope.
    if (consultas > 50) throw new Error("corte de la prueba a las 50 consultas");
    return red(String(url), consultas);
  }) as typeof fetch;
  try {
    await fn();
    return consultas;
  } finally {
    globalThis.fetch = original;
  }
}

const redirige = (destino: string) => new Response(null, { status: 302, headers: { location: destino } });

test(`una redirección en círculo se corta a los ${TOPE_SALTOS} saltos, con un error que nombra la URL sin su query`, async () => {
  const consultas = await conRed(
    () => redirige("/vuelta.php?apikey=secreta"),
    async () => {
      const fin = await fetchCmf("https://www.cmfchile.cl/vuelta.php?apikey=secreta", {}, ENV).then(
        (r) => `devolvió ${r.status}`,
        (e) => `lanzó. ${(e as Error).message}`,
      );
      assert.match(fin, /^lanzó\. .*5 redirecciones.*https:\/\/www\.cmfchile\.cl\/vuelta\.php/);
      assert.ok(!fin.includes("secreta"), `la query no viaja en el error. ${fin}`);
    },
  );
  // La consulta original más los saltos permitidos. Ni una más.
  assert.equal(consultas, 1 + TOPE_SALTOS);
});

test("un círculo entre 2 páginas también se corta", async () => {
  const consultas = await conRed(
    (url) => redirige(url.includes("/a.php") ? "/b.php" : "/a.php"),
    async () => {
      await assert.rejects(fetchCmf("https://www.cmfchile.cl/a.php", {}, ENV), /5 redirecciones/);
    },
  );
  assert.equal(consultas, 1 + TOPE_SALTOS);
});

test(`una cadena de ${TOPE_SALTOS} saltos que sí termina llega a su destino`, async () => {
  const consultas = await conRed(
    (_url, n) => (n <= TOPE_SALTOS ? redirige(`/paso${n}.php`) : new Response("destino", { status: 200 })),
    async () => {
      const res = await fetchCmf("https://www.cmfchile.cl/paso0.php", {}, ENV);
      assert.equal(await res.text(), "destino");
    },
  );
  assert.equal(consultas, 1 + TOPE_SALTOS);
});
