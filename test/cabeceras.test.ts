/**
 * Las cabeceras y las notas de las tablas de la CMF vienen de 4 formas que
 * el parser no conocía, y en las 4 el resultado era el mismo. una fila que
 * no es dato contaba para el total y para la paginación, o la primera fila
 * de datos se perdía por prestar los nombres de columna. Fixtures reales
 * del 2 de septiembre de 2026, recortados en filas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { htmlTablaAJson } from "../src/client/parsers.js";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

const leer = (n: string) => readFileSync(join(import.meta.dirname, "fixtures", n), "utf-8");

function conFetch(body: string) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, { status: 200, headers: { "Content-Type": "text/html" } })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function clienteConectado() {
  const server = createServer({ CMF_RATE_LIMIT_MS: "0" });
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" }, {});
  await client.connect(clientT);
  return client;
}

test("un <thead> con sus <th> sueltos, sin <tr>, es la cabecera y la primera fila de datos no se pierde", () => {
  const filas = htmlTablaAJson(leer("valores_agentes_cuadro2-2025-12.html"));
  assert.ok(filas.length >= 4, `filas: ${filas.length}`);
  assert.deepEqual(Object.keys(filas[0]), ["Corredores de Bolsa", "Diciembre 2025", "Diciembre 2024"]);
  assert.equal(filas[0]["Corredores de Bolsa"], "BANCHILE S.A. CB");
  assert.equal(filas[0]["Diciembre 2025"], "37,523,886");
});

test("una cabecera de 2 pisos hecha con <td>, colspan y rowspan da un nombre por columna y no deja el piso 2 como dato", () => {
  const filas = htmlTablaAJson(leer("seg_rgcri-2025-12.html"));
  assert.equal(filas[0]["Compañías"], "ASSURANT", JSON.stringify(filas[0]));
  assert.ok("Sociedades Clasificadoras de Riesgo Feller-Rate" in filas[0], Object.keys(filas[0]).join(" | "));
  assert.ok(filas.every((f) => f["Compañías"] !== "Feller-Rate"), "el piso 2 no es un dato");
});

test("las filas de título con colspan (una sola celda) no cuentan como datos", () => {
  const filas = htmlTablaAJson(leer("sanciones_cursadas_mes-2026-08.html"));
  assert.ok(filas.length >= 3);
  assert.ok(filas.every((f) => Object.keys(f).length >= 4), JSON.stringify(filas[0]));
  assert.equal(filas[0]["N&ordm;"] ?? filas[0]["Nº"], "8941");
  assert.ok(!JSON.stringify(filas).includes("Ir a más sanciones"));
});

test("un título con colspan ABAJO de la tabla (un total, un aviso) sigue siendo una fila", () => {
  // Lo encontró la revisión adversarial. la regla del título se comía la
  // fila «Total: 20 acciones (100%)» del final de una tabla sin <th>.
  const html = `<table><tr><td>Nombre</td><td>Acciones</td></tr><tr><td>A</td><td>10</td></tr><tr><td>B</td><td>10</td></tr><tr><td colspan="2">Total: 20 acciones (100%)</td></tr></table>`;
  const filas = htmlTablaAJson(html);
  assert.equal(filas.length, 3);
  assert.equal(filas[2].Nombre, "Total: 20 acciones (100%)");
});

test("una tabla sin <th> cuya primera fila de datos trae rowspan no pierde 2 filas como cabecera", () => {
  const html = `<table><tr><td rowspan="2">G1</td><td>i1</td></tr><tr><td>i2</td></tr><tr><td>G2</td><td>i3</td></tr></table>`;
  const filas = htmlTablaAJson(html);
  assert.equal(filas.length, 2, JSON.stringify(filas));
});

test("cmf_empresa_info: campo y valor con nombres fijos, y el RUT es un dato y no un nombre de columna", async () => {
  const restaurar = conFetch(leer("entidad-identificacion-copec-1.html"));
  try {
    const client = await clienteConectado();
    const r = await client.callTool({ name: "cmf_empresa_info", arguments: { rut: "90690000" } });
    assert.equal(r.isError ?? false, false, JSON.stringify(r.content));
    const sc = r.structuredContent as { datos: Array<{ campo: string; valor: string }> };
    assert.equal(sc.datos[0].campo, "RUT");
    assert.equal(sc.datos[0].valor, "90690000 - 9");
    assert.ok(sc.datos.some((d) => d.campo === "Razón Social" && d.valor === "EMPRESAS COPEC S.A."), JSON.stringify(sc.datos));
  } finally {
    restaurar();
  }
});

test("cmf_empresa_eeff_filiales: cada filial es una fila con su nombre, su período y su enlace, la primera incluida", async () => {
  const restaurar = conFetch(leer("entidad-eeff-filiales-copec-33.html"));
  try {
    const client = await clienteConectado();
    const r = await client.callTool({ name: "cmf_empresa_eeff_filiales", arguments: { rut: "90690000", anio: "2024" } });
    assert.equal(r.isError ?? false, false, JSON.stringify(r.content));
    const sc = r.structuredContent as { filiales: Array<Record<string, string>>; total: number };
    assert.equal(sc.total, 3);
    assert.equal(sc.filiales[0].filial, "EC INVESTRADE INC.");
    assert.equal(sc.filiales[0].periodo, "202412");
    assert.match(sc.filiales[0].url, /ver_filial\.php\?archivo=fil_90690000_202412/);
  } finally {
    restaurar();
  }
});
