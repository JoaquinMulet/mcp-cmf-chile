/**
 * Un archivo entero dentro de una respuesta MCP no cabe. El 2 de septiembre
 * de 2026 un PDF de 339 KB produjo 462.000 caracteres de base64 y desbordó
 * al cliente, la API oficial devolvía 308.000 caracteres sin filtro ni
 * paginación, y el paquete de documentos se desbordaba con 1 solo PDF y el
 * ZIP apagado. El servidor corre en un Worker sin disco, así que la salida
 * es la de siempre en esta casa. tramos, con el total y cómo pedir el resto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { tramoBase64, avisoDeTramoBase64 } from "../src/util/binario.js";
import { construirZip } from "../src/util/zip.js";

async function clienteConectado(env: Record<string, string> = {}) {
  const server = createServer({ CMF_RATE_LIMIT_MS: "0", ...env });
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" }, {});
  await client.connect(clientT);
  return client;
}

function conFetch(respuesta: () => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => respuesta()) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** Un PDF falso de 30.000 bytes con cabecera real, para que el tamaño mande. */
const PDF = new Uint8Array(30_000);
PDF.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
for (let i = 5; i < PDF.length; i++) PDF[i] = i % 251;

test("tramoBase64: los tramos pegados reconstruyen el base64 entero, y el último dice que es el último", () => {
  const partes: string[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const t = tramoBase64(PDF, offset, 7000);
    partes.push(t.base64);
    assert.equal(t.total_chars, 40_000);
    offset = t.siguiente_offset_chars;
  }
  assert.equal(partes.length, 6);
  assert.equal(partes.join(""), tramoBase64(PDF, 0, 1_000_000).base64);
  assert.equal(tramoBase64(PDF, 0, 1_000_000).base64_completo, true);
});

test("cmf_documento_descargar: entrega el binario por tramos y el texto dice cómo seguir, sin el base64 adentro", async () => {
  const restaurar = conFetch(() => new Response(PDF, { status: 200, headers: { "Content-Type": "application/pdf" } }));
  try {
    const client = await clienteConectado();
    const r = await client.callTool({ name: "cmf_documento_descargar", arguments: { s567: "abcdefghijklmnop", max_chars: 10000 } });
    assert.equal(r.isError ?? false, false, JSON.stringify(r.content));
    const sc = r.structuredContent as { base64: string; total_chars: number; siguiente_offset_chars: number | null; tamano: number };
    assert.equal(sc.tamano, 30_000);
    assert.equal(sc.total_chars, 40_000);
    assert.equal(sc.base64.length, 10_000);
    assert.equal(sc.siguiente_offset_chars, 10_000);
    const texto = (r.content as Array<{ text?: string }>)[0].text ?? "";
    assert.match(texto, /offset_chars=10000/);
    assert.ok(texto.length < 600, `el texto no lleva el base64: ${texto.length} caracteres`);
    const ultimo = await client.callTool({ name: "cmf_documento_descargar", arguments: { s567: "abcdefghijklmnop", offset_chars: 30_000, max_chars: 10000 } });
    const sc2 = ultimo.structuredContent as { base64: string; siguiente_offset_chars: number | null };
    assert.equal(sc2.siguiente_offset_chars, null);
    assert.equal(sc2.base64.length, 10_000);
  } finally {
    restaurar();
  }
});

test("tramoBase64: los cortes caen en múltiplos de 4 y un offset fuera del archivo se dice", () => {
  const t = tramoBase64(PDF, 0, 1001);
  assert.equal(t.base64.length % 4, 0);
  assert.equal(t.siguiente_offset_chars, 1000);
  const fuera = tramoBase64(PDF, 50_000, 1000);
  assert.equal(fuera.base64, "");
  assert.match(avisoDeTramoBase64(fuera, "x"), /fuera del archivo/);
});

test("el ZIP del paquete sale idéntico aunque las descargas terminen en otro orden", () => {
  const a = { ruta: "COPEC/eeff/a.pdf", bytes: new Uint8Array([1, 2, 3]) };
  const b = { ruta: "COPEC/eeff/b.pdf", bytes: new Uint8Array([4, 5, 6]) };
  const zip1 = construirZip([a, b].sort((x, y) => x.ruta.localeCompare(y.ruta)));
  const zip2 = construirZip([b, a].sort((x, y) => x.ruta.localeCompare(y.ruta)));
  assert.deepEqual(Buffer.from(zip1), Buffer.from(zip2));
  // Y sin ordenar salían distintos, que es lo que corrompía los tramos.
  assert.notDeepEqual(Buffer.from(construirZip([a, b])), Buffer.from(construirZip([b, a])));
});

test("cmf_api_accionistas_institucion: aplana los objetos anidados, toma la lista más larga y aparta solo los agregados exactos", async () => {
  const fila = (nombre: string, rut: string) => ({ Periodo: { mes: 6, anho: 2026 }, Institucion: { CodigoInstitucion: "001" }, DescripcionAccionista: { Periodo: "202606", Rut: rut, Nombre: nombre, Participacion: 1 } });
  const data = { Errores: [], Accionistas: [fila("LQ INV FINANCIERAS S.A.", "96929880"), fila("OTROS ACCIONISTAS MINORITARIOS", "0"), fila("SUBTOTAL", ""), fila("OTROS", ""), fila("TOTAL", "")] };
  const restaurar = conFetch(() => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }));
  try {
    const client = await clienteConectado({ CMF_API_KEY: "prueba" });
    const r = await client.callTool({ name: "cmf_api_accionistas_institucion", arguments: { institucion: "001", anio: "2026", mes: "06" } });
    assert.equal(r.isError ?? false, false, JSON.stringify(r.content));
    const sc = r.structuredContent as { filas: Array<Record<string, unknown>>; total: number; totales: Array<Record<string, unknown>> };
    assert.equal(sc.total, 2);
    assert.equal(sc.filas[0].Nombre, "LQ INV FINANCIERAS S.A.");
    assert.equal(sc.filas[0].CodigoInstitucion, "001");
    assert.equal(sc.filas[0]["DescripcionAccionista.Periodo"], "202606");
    assert.equal(sc.totales.length, 3);
    const texto = (r.content as Array<{ text?: string }>)[0].text ?? "";
    assert.ok(!texto.includes("[object Object]"), texto);
  } finally {
    restaurar();
  }
});

test("cmf_api_resultados_institucion: pagina las cuentas y filtra por prefijo de código", async () => {
  const cuentas = Array.from({ length: 700 }, (_, i) => ({
    CodigoCuenta: String(400_000 + i),
    DescripcionCuenta: `Cuenta ${i}`,
    CodigoInstitucion: "001",
    MonedaTotal: `${i * 1000},00`,
  }));
  const restaurar = conFetch(() => new Response(JSON.stringify({ CodigosResultados: cuentas }), { status: 200, headers: { "Content-Type": "application/json" } }));
  try {
    const client = await clienteConectado({ CMF_API_KEY: "prueba" });
    const r = await client.callTool({ name: "cmf_api_resultados_institucion", arguments: { anio: "2026", mes: "06", institucion: "001" } });
    assert.equal(r.isError ?? false, false, JSON.stringify(r.content));
    const sc = r.structuredContent as { filas: Array<Record<string, unknown>>; total: number; next_offset: number | null };
    assert.equal(sc.total, 700);
    assert.equal(sc.filas.length, 300);
    assert.equal(sc.next_offset, 300);
    const filtrado = await client.callTool({ name: "cmf_api_resultados_institucion", arguments: { anio: "2026", mes: "06", institucion: "001", cuenta: "4001" } });
    const sf = filtrado.structuredContent as { filas: Array<Record<string, unknown>>; total: number };
    assert.equal(sf.total, 100);
    assert.ok(sf.filas.every((f) => String(f.CodigoCuenta).startsWith("4001")));
  } finally {
    restaurar();
  }
});
