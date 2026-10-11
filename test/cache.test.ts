/**
 * La caché tiene un presupuesto de bytes, no solo un máximo de entradas.
 *
 * Visto el 10 de octubre de 2026 al medir la memoria de los documentos. La
 * caché de binarios guardaba hasta 100 documentos por 15 minutos sin mirar
 * cuánto pesaban. Cada respuesta sola no pasa de 20 MB, pero varios
 * documentos grandes seguidos quedaban todos guardados, y un Worker tiene
 * 128 MB en total. Medido en workerd el 11 de octubre de 2026, con
 * `npm run workerd:memoria`. tras bajar 10 documentos de 7 MB quedaban 86 MB
 * retenidos, y tras 5 de 18 MB, 111.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CacheLRU } from "../src/client/cache.js";
import { fetchCmfBinarioCached, getLegacy } from "../src/client/cmf-client.js";

const MB = 1024 * 1024;

/** Una caché de bloques de bytes con 10 de presupuesto y 4 por entrada. */
const cacheChica = () => new CacheLRU<Uint8Array>(100, 60_000, { pesoDe: (b) => b.byteLength, pesoMaximo: 10, pesoMaximoPorEntrada: 4 });
const bloque = (bytes: number) => new Uint8Array(bytes);

test("lo que pesa más que el tope por entrada no se guarda, y no saca a nadie", () => {
  const cache = cacheChica();
  cache.set("a", bloque(3));
  cache.set("grande", bloque(5));
  assert.equal(cache.get("grande"), undefined);
  assert.equal(cache.get("a")?.byteLength, 3);
  assert.equal(cache.pesoTotal(), 3);
  // Justo en el tope sí entra.
  cache.set("justa", bloque(4));
  assert.equal(cache.get("justa")?.byteLength, 4);
});

test("al pasar el presupuesto salen primero las que hace más tiempo nadie usa, y el total nunca lo pasa", () => {
  const cache = cacheChica();
  cache.set("a", bloque(4));
  cache.set("b", bloque(3));
  cache.set("c", bloque(3));
  assert.equal(cache.pesoTotal(), 10);
  // Se usa «a», así que la más vieja pasa a ser «b».
  assert.ok(cache.get("a"));
  cache.set("d", bloque(2));
  assert.equal(cache.get("b"), undefined, "tenía que salir b");
  assert.deepEqual(["a", "c", "d"].map((k) => cache.get(k)?.byteLength), [4, 3, 2]);
  assert.equal(cache.pesoTotal(), 9);
  // Una que obliga a sacar a varias.
  cache.set("e", bloque(4));
  assert.ok(cache.pesoTotal() <= 10, `peso ${cache.pesoTotal()}`);
  assert.equal(cache.get("e")?.byteLength, 4);
  assert.equal(cache.size(), 3);
});

test("reemplazar una clave descuenta lo que pesaba antes", () => {
  const cache = cacheChica();
  cache.set("a", bloque(4));
  cache.set("a", bloque(2));
  assert.equal(cache.pesoTotal(), 2);
  cache.set("b", bloque(4));
  cache.set("c", bloque(4));
  assert.equal(cache.pesoTotal(), 10);
  assert.deepEqual(["a", "b", "c"].map((k) => cache.get(k)?.byteLength), [2, 4, 4]);
  // Reemplazarla por una que no cabe la saca, y no deja la vieja.
  cache.set("a", bloque(5));
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.pesoTotal(), 8);
});

test("una entrada vencida deja de pesar cuando alguien la pide", async () => {
  const cache = cacheChica();
  cache.set("corta", bloque(4), 20);
  cache.set("larga", bloque(4));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(cache.get("corta"), undefined);
  assert.equal(cache.pesoTotal(), 4);
  assert.equal(cache.size(), 1);
});

test("sin presupuesto, la caché sigue limitada solo por su número de entradas", () => {
  const cache = new CacheLRU<string>(3, 60_000);
  for (const k of ["a", "b", "c", "d"]) cache.set(k, k.repeat(1000));
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.size(), 3);
  // Reemplazar una clave que ya está no saca a otra.
  cache.set("d", "nueva");
  assert.deepEqual(["b", "c", "d"].map((k) => cache.get(k)?.length), [1000, 1000, 5]);
});

/** Simula la red. cada documento pesa lo que dice su URL, y se cuenta cada descarga. */
async function conDocumentos(fn: (descargas: string[]) => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const descargas: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    descargas.push(u.pathname);
    const bytes = new Uint8Array(Number(u.searchParams.get("mb")) * MB).fill(37);
    return new Response(bytes, { headers: { "content-type": "application/pdf", "content-length": String(bytes.byteLength) } });
  }) as typeof fetch;
  try {
    await fn(descargas);
  } finally {
    globalThis.fetch = original;
  }
}

test("la caché de documentos guarda a lo más 16 MB, y no guarda un documento de más de 8", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  const bajar = (nombre: string, mb: number) => fetchCmfBinarioCached(`https://www.cmfchile.cl/${nombre}.pdf?mb=${mb}`, `prueba:${nombre}`, env);
  await conDocumentos(async (descargas) => {
    // 3 documentos de 6 MB. Los 2 últimos caben juntos, y el primero tiene que salir.
    for (const nombre of ["a", "b", "c"]) assert.equal((await bajar(nombre, 6)).bytes.byteLength, 6 * MB);
    assert.deepEqual(descargas, ["/a.pdf", "/b.pdf", "/c.pdf"]);
    await bajar("c", 6);
    await bajar("b", 6);
    assert.deepEqual(descargas, ["/a.pdf", "/b.pdf", "/c.pdf"], "b y c tenían que estar guardados");
    await bajar("a", 6);
    assert.equal(descargas.at(-1), "/a.pdf", "a ya no cabía, y hay que bajarlo de nuevo");
    // Uno de 9 MB se entrega bien y no se guarda. cada pedido lo baja.
    descargas.length = 0;
    for (const _vez of [1, 2]) assert.equal((await bajar("grande", 9)).bytes.byteLength, 9 * MB);
    assert.deepEqual(descargas, ["/grande.pdf", "/grande.pdf"]);
    // Y no sacó a los que sí cabían.
    descargas.length = 0;
    await bajar("a", 6);
    assert.deepEqual(descargas, [], "el documento grande sacó de la caché a uno que cabía");
  });
});

test("la caché de páginas no guarda una página de más de 4 millones de caracteres", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conDocumentos(async (descargas) => {
    // Una página normal se baja 1 vez y después sale de la caché.
    for (const _vez of [1, 2]) assert.equal((await getLegacy("/pagina-normal.php", { mb: 1 }, env, "prueba:pagina-normal")).length, MB);
    assert.deepEqual(descargas, ["/pagina-normal.php"]);
    // Una de 5 millones se entrega bien, y cada pedido la baja de nuevo.
    descargas.length = 0;
    for (const _vez of [1, 2]) assert.equal((await getLegacy("/pagina-enorme.php", { mb: 5 }, env, "prueba:pagina-enorme")).length, 5 * MB);
    assert.deepEqual(descargas, ["/pagina-enorme.php", "/pagina-enorme.php"]);
  });
});
