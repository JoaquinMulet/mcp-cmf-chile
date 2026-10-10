/**
 * Los estados financieros anuales de los bancos salen del portal, no de la ficha.
 *
 * Estas 3 herramientas vivieron en producción sin estar en el trunk. Se
 * desplegaron desde un árbol con cambios sin commitear, y el despliegue del 9
 * de octubre de 2026, hecho desde master, las sacó del servidor sin que
 * ninguna comprobación lo notara. Lección 40 del CLAUDE.md.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

const FIXTURE = join(import.meta.dirname, "fixtures", "bancos-eeff-portal-observed.html");

function conFetch(html: string) {
  const original = globalThis.fetch;
  const llamadas: string[] = [];
  globalThis.fetch = (async (entrada: string | URL | Request) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
    llamadas.push(url);
    if (url.includes("articles-110289_recurso_1.pdf")) {
      return new Response("%PDF-1.7 https://www.cmfchile.cl/bancos/estados_anuales/2025/Bancos-2025/202512-001.pdf", { status: 200, headers: { "Content-Type": "application/pdf" } });
    }
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
  }) as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

async function clienteConectado() {
  const server = createServer({ CMF_RATE_LIMIT_MS: "0" });
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" }, {});
  await client.connect(clientT);
  return client;
}

test("cmf_bancos_eeff_portal: lista los PDFs publicados en la sección bancaria del portal", async () => {
  const mock = conFetch(readFileSync(FIXTURE, "utf8"));
  try {
    const client = await clienteConectado();
    const respuesta = await client.callTool({ name: "cmf_bancos_eeff_portal", arguments: { anio: "2025" } });
    assert.equal(respuesta.isError ?? false, false, JSON.stringify(respuesta.content));
    const salida = respuesta.structuredContent as {
      documentos: Array<{ nombre: string; url: string; periodo?: string }>;
      documentos_originales: Array<{ codigo_sbif: string; url: string; periodo: string }>;
      fuente_portal: string;
    };
    assert.equal(salida.fuente_portal, "https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-43326.html");
    assert.equal(salida.documentos.length, 1);
    assert.match(salida.documentos[0].nombre, /Descargar 2025/);
    assert.equal(salida.documentos[0].periodo, "2025");
    assert.match(salida.documentos[0].url, /articles-110289_recurso_1\.pdf/);
    assert.equal(salida.documentos_originales.length, 1);
    assert.equal(salida.documentos_originales[0].codigo_sbif, "001");
    assert.equal(salida.documentos_originales[0].periodo, "202512");
    assert.match(salida.documentos_originales[0].url, /202512-001\.pdf/);
    const soloChile = await client.callTool({ name: "cmf_bancos_eeff_portal", arguments: { anio: "2025", codUnicoBank: "001" } });
    const filtrado = soloChile.structuredContent as { documentos_originales: Array<{ codigo_sbif: string }> };
    assert.deepEqual(filtrado.documentos_originales.map((d) => d.codigo_sbif), ["001"]);
    assert.ok(mock.llamadas.some((url) => url.includes("w4-propertyvalue-43326.html")));
  } finally {
    mock.restaurar();
  }
});

test("cmf_bancos_eeff_portal_descargar: entrega el PDF original por tramos", async () => {
  const original = globalThis.fetch;
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  globalThis.fetch = (async () => new Response(pdf, { status: 200, headers: { "Content-Type": "application/pdf" } })) as typeof fetch;
  try {
    const client = await clienteConectado();
    const respuesta = await client.callTool({
      name: "cmf_bancos_eeff_portal_descargar",
      arguments: { url: "https://www.cmfchile.cl/portal/estadisticas/626/articles-110289_recurso_1.pdf?ts=1778079744", max_chars: 1000 },
    });
    assert.equal(respuesta.isError ?? false, false, JSON.stringify(respuesta.content));
    const salida = respuesta.structuredContent as { formato: string; tamano: number; base64_completo: boolean };
    assert.equal(salida.formato, "pdf");
    assert.equal(salida.tamano, pdf.length);
    assert.equal(salida.base64_completo, true);
  } finally {
    globalThis.fetch = original;
  }
});
