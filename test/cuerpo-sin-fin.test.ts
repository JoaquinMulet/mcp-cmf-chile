/**
 * El plazo de una consulta cubre también el cuerpo de la respuesta.
 *
 * Lo demostró la revisión adversarial del 9 de octubre de 2026. El plazo de
 * fetchConTimeout se apagaba al llegar las cabeceras, y resolverChallenge lee
 * el cuerpo entero con el cupo del limitador tomado. Con 4 respuestas cuyo
 * cuerpo nunca terminaba, toda consulta posterior de la instancia quedaba
 * esperando cupo sin plazo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCmf } from "../src/client/cmf-client.js";

const TOPE = 4;

type Red = (url: string) => Response;

/**
 * Simula la red y entrega los cuerpos abiertos para cerrarlos al final. Sin
 * ese cierre, una prueba en rojo dejaría el proceso vivo y la suite colgada
 * en vez de roja.
 */
async function conRed(red: (abrir: () => ReadableStream<Uint8Array>) => Red, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const abiertos: ReadableStreamDefaultController<Uint8Array>[] = [];
  const abrir = () => new ReadableStream<Uint8Array>({ start: (c) => void abiertos.push(c) });
  const responder = red(abrir);
  globalThis.fetch = (async (url: string | URL | Request) => responder(String(url))) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
    for (const c of abiertos) {
      try {
        c.close();
      } catch {
        // Ya lo cerró o lo canceló el cliente, que es lo que se espera.
      }
    }
  }
}

const tras = <T>(ms: number, valor: T) => new Promise<T>((r) => setTimeout(() => r(valor), ms));

test(`${TOPE} cuerpos que nunca terminan devuelven su cupo al vencer el plazo, con un error que lo dice`, async () => {
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: "200" };
  let enVuelo = 0;
  let maximo = 0;
  await conRed(
    (abrir) => (url) => {
      if (url.includes("/colgada")) return new Response(abrir(), { status: 200 });
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(c) {
            await tras(120, null);
            enVuelo--;
            c.enqueue(new TextEncoder().encode("ok"));
            c.close();
          },
        }),
      );
    },
    async () => {
      const colgadas = Array.from({ length: TOPE }, (_, i) =>
        fetchCmf(`https://www.cmfchile.cl/colgada${i}`, {}, env).then(
          (r) => `devolvió ${r.status}`,
          (e) => `lanzó. ${(e as Error).message}`,
        ),
      );
      await tras(50, null);
      // A OTRO host, para que lo único que la pueda frenar sea el cupo.
      const sana = fetchCmf("https://api.sbif.cl/sana", {}, env).then((r) => r.text());
      assert.equal(await Promise.race([sana, tras(3000, "sigue esperando cupo")]), "ok");
      for (const fin of await Promise.race([Promise.all(colgadas), tras(5000, ["siguen colgadas"])])) {
        assert.match(fin, /^lanzó\. .*cuerpo.*200 ms.*www\.cmfchile\.cl\/colgada\d/);
      }
      // El cupo se devuelve exactamente una vez. De más, el máximo pasa del tope. De menos, no llega.
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => fetchCmf(`https://www.cmfchile.cl/lenta${i}`, {}, env).then((r) => r.text())),
      );
      assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
    },
  );
});

test("un cuerpo que tarda más que el plazo pero sigue llegando se entrega completo", async () => {
  // El plazo es de silencio, no del total. Un documento grande por un enlace
  // lento tarda más que el plazo y tiene que llegar (lección 36).
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: "400" };
  const TRAMOS = 8;
  await conRed(
    () => () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(c) {
            for (let i = 0; i < TRAMOS; i++) {
              await tras(60, null);
              c.enqueue(new TextEncoder().encode(`tramo${i};`));
            }
            c.close();
          },
        }),
      ),
    async () => {
      const inicio = Date.now();
      const res = await fetchCmf("https://www.cmfchile.cl/documento-grande", {}, env);
      const texto = await res.text();
      assert.equal(texto.split(";").length - 1, TRAMOS, texto);
      assert.ok(Date.now() - inicio > 400, "la descarga tiene que durar más que el plazo para probar algo");
    },
  );
});

test("la respuesta conserva estado, cabeceras y cada cookie por separado", async () => {
  // El anti-bot lee las cookies de set-cookie. Si el plazo del cuerpo las
  // fundiera en una sola línea, el desafío F5 dejaría de resolverse.
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conRed(
    () => () => {
      const headers = new Headers({ "content-type": "text/html; charset=iso-8859-1" });
      headers.append("set-cookie", "cookiesession1=AAAA; Path=/");
      headers.append("set-cookie", "PHPSESSID=BBBB; Path=/");
      return new Response("no encontrado", { status: 404, statusText: "Not Found", headers });
    },
    async () => {
      const res = await fetchCmf("https://www.cmfchile.cl/con-cookies", {}, env);
      assert.equal(res.status, 404);
      assert.equal(res.statusText, "Not Found");
      assert.equal(res.headers.get("content-type"), "text/html; charset=iso-8859-1");
      assert.deepEqual(res.headers.getSetCookie(), ["cookiesession1=AAAA; Path=/", "PHPSESSID=BBBB; Path=/"]);
      assert.equal(await res.text(), "no encontrado");
    },
  );
});
