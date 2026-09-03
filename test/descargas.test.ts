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
import { tramoBase64 } from "../src/util/binario.js";

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
