/**
 * Las tasas de interés viven en el sitio BEST de la CMF.
 *
 * El servlet InfoFinanciera de tasas.cmfchile.cl dejó de entregar la tabla y
 * el 2 de septiembre de 2026 la tool respondía «la fuente migró». El sitio
 * nuevo, best.cmfchile.cl, es una aplicación Angular, y su código público
 * declara el servicio que la alimenta.
 * `https://best-sbif-api.azurewebsites.net/public/tmc/tasas/AAAAMMDD` y
 * `/public/tmc/notas/AAAAMMDD`, con la clave web que el propio sitio envía
 * en la cabecera `x-apikey`. Los fixtures son las 2 respuestas reales del
 * 1 de septiembre de 2026, sin recortar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

const FIX = join(import.meta.dirname, "fixtures");
const leer = (n: string) => readFileSync(join(FIX, n), "utf-8");

function conFetchBest(opciones: { estado?: number } = {}) {
  const original = globalThis.fetch;
  const llamadas: Array<{ url: string; apikey: string | null }> = [];
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
    const headers = new Headers(init?.headers);
    llamadas.push({ url, apikey: headers.get("x-apikey") });
    if (opciones.estado) return new Response("", { status: opciones.estado });
    const cuerpo = url.includes("/tmc/notas/") ? leer("best-tmc-notas-20260901.json") : leer("best-tmc-tasas-20260901.json");
    return new Response(cuerpo, { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

async function cliente(env: Record<string, string> = {}) {
  const server = createServer({ CMF_RATE_LIMIT_MS: "0", ...env });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "1.0.0" }, {});
  await client.connect(ct);
  return client;
}

test("cmf_bancos_tasas lee BEST: 13 segmentos con TMC y TIP, la vigencia y las notas al pie", async () => {
  const { llamadas, restaurar } = conFetchBest();
  try {
    const client = await cliente();
    const r = await client.callTool({ name: "cmf_bancos_tasas", arguments: { fecha: "2026-09-01" } });
    assert.ok(!r.isError, JSON.stringify(r.content));
    const sc = r.structuredContent as { total: number; fecha: string; filas: Array<Record<string, unknown>>; notas: string[] };
    assert.equal(sc.fecha, "2026-09-01");
    assert.equal(sc.total, 13);
    assert.deepEqual(sc.filas.map((f) => f.tasa), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    assert.equal(sc.filas[0].tmc, 51);
    assert.equal(sc.filas[0].tip, 34);
    assert.equal(sc.filas[0].fechaPublicacion, "2026-08-14");
    // La primera nota es nuestra (unidad de las cifras) y las 5 siguientes son
    // las de BEST, que explican qué tasa rige para la Ley 18.010 y a qué
    // segmento aplican.
    assert.equal(sc.notas.length, 6, JSON.stringify(sc.notas));
    assert.match(sc.notas[0], /anuales/);
    assert.match(sc.notas[1], /Ley 18\.010/);
    assert.match(sc.notas[1], /tip de la tasa 2/);
    const texto = (r.content as Array<{ text: string }>)[0].text;
    assert.match(texto, /Operaciones no reajustables/);
    assert.match(texto, /Ley 18\.010/, "las notas llegan al TEXTO, que es lo único que lee el modelo");
    assert.match(texto, /anual/i, "dice que las tasas son anuales");
    // La fecha viaja como AAAAMMDD, que es lo que BEST entiende (con guiones responde 500).
    assert.ok(llamadas.some((l) => l.url.endsWith("/public/tmc/tasas/20260901")), JSON.stringify(llamadas));
    assert.ok(llamadas.some((l) => l.url.endsWith("/public/tmc/notas/20260901")));
    assert.ok(llamadas.every((l) => l.apikey && l.apikey.length > 10), "toda llamada lleva la cabecera x-apikey");
  } finally {
    restaurar();
  }
});

test("una clave propia en el entorno reemplaza a la clave web del sitio", async () => {
  const { llamadas, restaurar } = conFetchBest();
  try {
    const client = await cliente({ CMF_BEST_KEY: "mi-clave" });
    await client.callTool({ name: "cmf_bancos_tasas", arguments: { fecha: "2026-09-01" } });
    assert.ok(llamadas.every((l) => l.apikey === "mi-clave"));
  } finally {
    restaurar();
  }
});

test("si BEST rechaza la clave, la respuesta es error de fuente con la página oficial, nunca cero tasas", async () => {
  const { restaurar } = conFetchBest({ estado: 401 });
  try {
    const client = await cliente();
    const r = await client.callTool({ name: "cmf_bancos_tasas", arguments: { fecha: "2026-09-01" } });
    assert.ok(r.isError);
    const texto = (r.content as Array<{ text: string }>)[0].text;
    assert.match(texto, /best\.cmfchile\.cl\/datos\/tasas/);
    assert.match(texto, /401/);
  } finally {
    restaurar();
  }
});

test("un 200 con HTML en vez de JSON es error de fuente con la página oficial, no un «Unexpected token»", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("<html><body>Mantencion</body></html>", { status: 200, headers: { "Content-Type": "text/html" } })) as typeof fetch;
  try {
    const client = await cliente();
    const r = await client.callTool({ name: "cmf_bancos_tasas", arguments: { fecha: "2026-09-01" } });
    assert.ok(r.isError);
    const texto = (r.content as Array<{ text: string }>)[0].text;
    assert.match(texto, /best\.cmfchile\.cl\/datos\/tasas/);
    assert.match(texto, /sin JSON/);
    assert.doesNotMatch(texto, /Unexpected token/);
  } finally {
    globalThis.fetch = original;
  }
});

test("una fecha futura avisa en las notas que BEST entrega las tasas vigentes hoy", async () => {
  const { restaurar } = conFetchBest();
  try {
    const client = await cliente();
    const r = await client.callTool({ name: "cmf_bancos_tasas", arguments: { fecha: "2031-01-01" } });
    const sc = r.structuredContent as { notas: string[] };
    assert.ok(sc.notas.some((n) => /futura/.test(n) && /vigentes hoy/.test(n)), JSON.stringify(sc.notas));
    assert.match((r.content as Array<{ text: string }>)[0].text, /futura/);
    const hoy = await client.callTool({ name: "cmf_bancos_tasas", arguments: { fecha: "2026-09-01" } });
    assert.ok(!(hoy.structuredContent as { notas: string[] }).notas.some((n) => /futura/.test(n)), "una fecha pasada no lleva el aviso");
  } finally {
    restaurar();
  }
});

test("sin fecha se consulta el día de hoy en Chile, en formato AAAAMMDD", async () => {
  const { llamadas, restaurar } = conFetchBest();
  try {
    const client = await cliente();
    await client.callTool({ name: "cmf_bancos_tasas", arguments: {} });
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date()).replace(/-/g, "");
    assert.ok(llamadas.some((l) => l.url.endsWith(`/public/tmc/tasas/${hoy}`)), JSON.stringify(llamadas));
  } finally {
    restaurar();
  }
});
