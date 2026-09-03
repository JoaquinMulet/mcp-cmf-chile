/**
 * cmf_fondos_comisiones_maximas devolvía nombres de administradoras y un
 * conteo de archivos, sin ninguna forma de bajar esos archivos. Ahora cada
 * documento es una fila con su enlace firmado. Fixture real del 2 de
 * septiembre de 2026, recortado a 2 administradoras.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

test("cmf_fondos_comisiones_maximas: una fila por documento, con el enlace al XLS o el aviso de la administradora", async () => {
  const body = readFileSync(join(import.meta.dirname, "fixtures", "foppc-consultaFi1951-2025.html"), "utf-8");
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, { status: 200, headers: { "Content-Type": "text/html" } })) as typeof fetch;
  try {
    const server = createServer({ CMF_RATE_LIMIT_MS: "0" });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "test", version: "1.0.0" }, {});
    await client.connect(ct);
    const r = await client.callTool({ name: "cmf_fondos_comisiones_maximas", arguments: { tipo: "fi", anio: "2025" } });
    assert.equal(r.isError ?? false, false, JSON.stringify(r.content));
    const sc = r.structuredContent as { documentos: Array<Record<string, string>>; total: number; administradoras: string[] };
    assert.equal(sc.administradoras.length, 2);
    assert.equal(sc.total, 8);
    const security = sc.documentos.filter((d) => d.administradora === "Administradora General De Fondos Security S.A.");
    assert.equal(security.length, 4);
    assert.equal(security[0].periodo, "Marzo 2025");
    assert.equal(security[0].publicado, "28-05-2025");
    assert.match(security[0].url, /^https:\/\/www\.cmfchile\.cl\/sitio\/aplic\/serdoc\/ver_sgd\.php\?s567=/);
    const sura = sc.documentos.filter((d) => d.administradora === "Administradora General De Fondos Sura S.A.");
    assert.ok(sura.length >= 1);
    assert.equal(sura[0].url, "");
    assert.match(sura[0].estado, /no tuvieron/);
    const texto = (r.content as Array<{ text?: string }>)[0].text ?? "";
    assert.ok(texto.includes("ver_sgd.php"), "el enlace tiene que estar en el TEXTO que lee el modelo");
  } finally {
    globalThis.fetch = original;
  }
});
