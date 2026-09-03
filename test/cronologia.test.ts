/**
 * La Cronología Bancaria. Los fixtures son el `<div id="contenido">` REAL de
 * 6 páginas de cronologiabancaria.cmfchile.cl, bajadas el 3 de septiembre
 * de 2026 y sin cambios adentro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { eventoDeLaPagina, hitosDeLaTabla, institucionesDeLaLista, relacionadasDeLaPagina } from "../src/tools/cronologia.js";

const FIX = join(import.meta.dirname, "fixtures");
const leer = (n: string) => readFileSync(join(FIX, n), "utf-8");

function conFetchCronologia(estado = 200) {
  const original = globalThis.fetch;
  const llamadas: string[] = [];
  globalThis.fetch = (async (entrada: string | URL | Request) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
    llamadas.push(url);
    const q = new URL(url).searchParams;
    const ARCHIVOS: Record<string, string> = {
      "8.1": "cronologia-8.1-letra-A.html",
      "8.4": "cronologia-8.4-abn-amro.html",
      "8.3.1": "cronologia-8.3.1-2020.html",
      "8.9": "cronologia-8.9-evento.html",
      "8.2.3": "cronologia-8.2.3-relacionadas.html",
    };
    const archivo = ARCHIVOS[q.get("indice") ?? ""] ?? "cronologia-8.0-portada.html";
    if (estado !== 200) return new Response("<html><body>Attack ID</body></html>", { status: estado });
    return new Response(leer(archivo), { status: 200, headers: { "Content-Type": "text/html;charset=UTF-8" } });
  }) as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

async function cliente() {
  const server = createServer({ CMF_RATE_LIMIT_MS: "0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "1.0.0" }, {});
  await client.connect(ct);
  return client;
}

test("la lista por letra entrega cada institución con su id", () => {
  const filas = institucionesDeLaLista(leer("cronologia-8.1-letra-A.html"));
  assert.ok(filas.length >= 7, `${filas.length} instituciones`);
  assert.deepEqual(filas[0], { id: "7500000000000178", nombre: "ABN AMRO Bank (Chile)", pagina: "https://cronologiabancaria.cmfchile.cl/sbifweb/servlet/CronologiaBancaria?indice=8.4&idEntidad=7500000000000178&TIPO=pdf" });
  assert.ok(filas.some((f) => f.nombre === "Adelantos y Créditos Sociedad Anónima Financiera"), "las entidades HTML se decodifican");
});

test("la línea de tiempo de una institución entrega fecha, hito y evento_id", () => {
  const filas = hitosDeLaTabla(leer("cronologia-8.4-abn-amro.html"));
  assert.equal(filas.length, 4);
  assert.equal(filas[0].fecha, "15-Mar-1995");
  assert.equal(filas[0].evento_id, "7500000000000853");
  assert.match(filas[0].hito, /ex ABN Tanner Bank/);
  assert.match(filas[3].hito, /Royal Bank of Scotland/);
});

test("la línea de tiempo de un año completa la fecha con el año del título", () => {
  const filas = hitosDeLaTabla(leer("cronologia-8.3.1-2020.html"), "2020");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].fecha, "03-Sep-2020");
  assert.match(filas[0].hito, /Ley N° 21\.265/);
});

test("el evento trae la fecha, el relato en texto plano y sus documentos enlazados", () => {
  const filas = eventoDeLaPagina(leer("cronologia-8.9-evento.html"));
  assert.equal(filas.length, 1);
  assert.equal(filas[0].fecha, "15-Mar-1995");
  assert.match(filas[0].hito, /ABN AMRO Bank \(Chile\), ex ABN Tanner Bank/);
  assert.match(filas[0].texto, /Resolución N° 22/);
  assert.ok(!/<a |&oacute;/.test(filas[0].texto), "sin marcado ni entidades");
  assert.match(filas[0].documentos, /Resolución N° 22: http:\/\/www\.sbif\.cl\/sbifweb\/servlet\/ArchivoCB\?ID_IMAGEN=7500000000001299/);
});

test("las relacionadas separan predecesores de sucesores con las columnas de la tabla", () => {
  const filas = relacionadasDeLaPagina(leer("cronologia-8.2.3-relacionadas.html"));
  assert.ok(filas.length >= 1);
  assert.ok(filas.some((f) => f.relacion === "Predecesores"));
  const p = filas.find((f) => f.relacion === "Predecesores") ?? {};
  assert.ok("Predecesor" in p && "Hecho" in p, `columnas. ${Object.keys(p).join(",")}`);
  assert.match(String(p.Predecesor), /S\.A\. de Comercio y Finanzas/);
});

test("cmf_bancos_cronologia elige la vista por consulta y exige el id cuando hace falta", async () => {
  const { llamadas, restaurar } = conFetchCronologia();
  try {
    const client = await cliente();
    const inst = await client.callTool({ name: "cmf_bancos_cronologia", arguments: { consulta: "instituciones", letra: "a" } });
    assert.ok(!inst.isError, JSON.stringify(inst.content));
    assert.ok(llamadas.some((u) => u.includes("indice=8.1&letra=A")), "la letra viaja en mayúscula");
    const texto = (inst.content as Array<{ text: string }>)[0].text;
    assert.match(texto, /7500000000000178/, "el id va en el texto");

    const lt = await client.callTool({ name: "cmf_bancos_cronologia", arguments: { consulta: "institucion", id: "7500000000000178", texto: "royal" } });
    const sc = lt.structuredContent as { total: number; filas: Array<Record<string, string>> };
    assert.equal(sc.total, 1);
    assert.match(sc.filas[0].hito, /Royal Bank/);

    const sinId = await client.callTool({ name: "cmf_bancos_cronologia", arguments: { consulta: "institucion" } });
    assert.ok(sinId.isError);
    assert.match((sinId.content as Array<{ text: string }>)[0].text, /necesita id/);

    const ev = await client.callTool({ name: "cmf_bancos_cronologia", arguments: { consulta: "evento", evento_id: "7500000000000853" } });
    assert.match((ev.content as Array<{ text: string }>)[0].text, /Resolución N° 22/);
  } finally {
    restaurar();
  }
});

test("la página del cortafuegos de la CMF es un error de fuente, no cero instituciones", async () => {
  const { restaurar } = conFetchCronologia(500);
  try {
    const client = await cliente();
    const r = await client.callTool({ name: "cmf_bancos_cronologia", arguments: { consulta: "anio", anio: "2020" } });
    assert.ok(r.isError);
    assert.match((r.content as Array<{ text: string }>)[0].text, /HTTP 500/);
  } finally {
    restaurar();
  }
});
