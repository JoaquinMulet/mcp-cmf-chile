/**
 * Los 3 catálogos de códigos que ninguna tool entregaba.
 *
 * El informe de pruebas del 2 de septiembre de 2026 lo midió. para pedir un
 * balance bancario había que saber de memoria que 001 es Banco de Chile,
 * `cmf_seguros_eeff` pedía el RUT de la compañía sin decir de dónde sacarlo,
 * y la cartera de fondos mutuos entregaba columnas como `ffm_6010100` cuyo
 * significado vive en una circular de 1997 escaneada.
 *
 * Los fixtures de seguros son el formulario f1 REAL de los índices de la CMF,
 * recortados en bloques y sin tocar por dentro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { CODIGOS_BANCOS, CODIGOS_CIRCULAR_1333, companiasDeSegurosDelIndice } from "../src/catalogos.js";

const FIX = join(import.meta.dirname, "fixtures");
const leerUtf8 = (n: string) => readFileSync(join(FIX, n), "utf-8");

/** Mock de fetch que decide por URL. El índice de cada segmento es una página distinta. */
function conFetchDeIndices() {
  const original = globalThis.fetch;
  const llamadas: string[] = [];
  globalThis.fetch = (async (entrada: string | URL | Request) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
    llamadas.push(url);
    const u = new URL(url);
    const tipo = u.searchParams.get("tiposociedad") ?? "A";
    const archivo = u.pathname.includes("seg_vida") ? "seg_vida_fecu_index-A.html" : `seg_gen_fecu_index-${tipo}.html`;
    return new Response(readFileSync(join(FIX, archivo)), { status: 200, headers: { "Content-Type": "text/html; charset=iso-8859-1" } });
  }) as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

async function cliente() {
  const server = createServer({ CMF_RATE_LIMIT_MS: "0", CMF_CACHE_TTL_S: "0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "1.0.0" }, {});
  await client.connect(ct);
  return client;
}

test("companiasDeSegurosDelIndice lee el select sociedad[] del formulario real: RUT sin DV, DV aparte y nombre limpio", () => {
  const filas = companiasDeSegurosDelIndice(leerUtf8("seg_gen_fecu_index-A.html"), "generales", "A");
  // 51 opciones en la página, y la primera es «TODOS», que es un filtro y no una compañía.
  assert.equal(filas.length, 50);
  assert.deepEqual(filas[0], {
    rut: "99155000",
    rut_dv: "3",
    nombre: "ABN AMRO (CHILE) SEGUROS GENERALES S.A.",
    estado: "No vigente",
    segmento: "generales",
    tipo: "A",
  });
  // La página marca 25 de las 50 como «(No vigente)»; el resto queda vigente.
  assert.equal(filas.filter((f) => f.estado === "No vigente").length, 25);
  assert.ok(filas.some((f) => f.estado === "Vigente" && f.nombre.startsWith("BCI SEGUROS GENERALES")));
  assert.ok(filas.every((f) => !/vigente/i.test(f.nombre)), "la marca de vigencia no se queda en el nombre");
  // La página viene en UTF-8 aunque no lo declare, y la Ñ tiene que llegar como Ñ.
  assert.ok(filas.some((f) => f.nombre.startsWith("ALLIANZ COMPAÑIA")), filas[1].nombre);
  assert.ok(filas.every((f) => /^\d{6,9}$/.test(f.rut)), "todo rut canónico");
  assert.ok(filas.every((f) => !f.nombre.includes(".") || !/^\d/.test(f.nombre)), "el nombre no arrastra el RUT");
});

test("cmf_codigos seguros junta generales y vida con sus subtipos, y filtra por texto", async () => {
  const { llamadas, restaurar } = conFetchDeIndices();
  try {
    const client = await cliente();
    const r = await client.callTool({ name: "cmf_codigos", arguments: { catalogo: "seguros", limit: 500 } });
    const sc = r.structuredContent as { total: number; filas: Array<Record<string, string>> };
    // 50 generales + 2 reaseguradoras + 9 de crédito + 60 vida + 2 reaseguradoras vida
    // (los fixtures de vida sirven la misma página para A y R, así que son 60 + 60).
    assert.ok(sc.total >= 50 + 2 + 9 + 60, `total ${sc.total}`);
    assert.ok(sc.filas.some((f) => f.segmento === "vida" && f.nombre.startsWith("4 LIFE")));
    assert.ok(sc.filas.some((f) => f.segmento === "generales" && f.tipo === "CR"));
    const texto = (r.content as Array<{ text: string }>)[0].text;
    assert.match(texto, /sociedades/, "el texto dice en qué parámetro se usa el código");
    assert.ok(llamadas.length >= 5, `lee los 5 índices, hizo ${llamadas.length} llamadas`);

    const f = await client.callTool({ name: "cmf_codigos", arguments: { catalogo: "seguros", texto: "bci" } });
    const scf = f.structuredContent as { total: number; filas: Array<Record<string, string>> };
    assert.ok(scf.total >= 2 && scf.filas.every((x) => /BCI/.test(x.nombre)), JSON.stringify(scf.filas));
  } finally {
    restaurar();
  }
});

test("cmf_codigos bancos entrega el mapa código SBIF → banco sin tocar la red", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("no debe salir a la red"); }) as typeof fetch;
  try {
    const client = await cliente();
    const r = await client.callTool({ name: "cmf_codigos", arguments: { catalogo: "bancos" } });
    const sc = r.structuredContent as { total: number; filas: Array<Record<string, string>>; notas?: string[] };
    assert.equal(sc.total, CODIGOS_BANCOS.length);
    assert.ok(sc.filas.some((f) => f.codigo === "001" && /BANCO DE CHILE/i.test(f.nombre)));
    assert.ok(sc.filas.some((f) => f.codigo === "999"), "el 999 es el sistema total");
    assert.ok(sc.filas.every((f) => /^\d{3}$/.test(f.codigo)), "códigos de 3 dígitos");
    assert.ok(JSON.stringify(sc.notas).includes("API oficial"), "dice contra qué se verificó y cuándo");
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * Columnas REALES de la cartera de fondos mutuos, copiadas de la respuesta de
 * cmf_fondos_mutuos_cartera para junio de 2026 (una fila de cada cartera).
 * OPLA no tenía filas ese mes, así que sus columnas no se pudieron leer.
 */
const COLUMNAS_REALES: Record<string, string[]> = {
  NACI: ["ffm_6010100", "ffm_6010211", "ffm_6010212", "ffm_6010300", "ffm_6010400", "ffm_6010500", "ffm_6010600", "ffm_6010700", "ffm_6010800", "ffm_6010900", "ffm_6011000", "ffm_tir_6011111", "ffm_par_6011111", "ffm_rel_6011111", "ffm_6011112", "ffm_6011113", "ffm_6011114", "ffm_6011200", "ffm_6011300", "ffm_6011400", "ffm_6011511", "ffm_6011512", "ffm_6011513"],
  EXTR: ["ffm_6020100", "ffm_6020200", "ffm_6020300", "ffm_6020400", "ffm_6020500", "ffm_6020600", "ffm_6020700", "ffm_6020800", "ffm_6020900", "ffm_6021000", "ffm_tir_6021111", "ffm_par_6021111", "ffm_rel_6021111", "ffm_6021112", "ffm_6021113", "ffm_6021114", "ffm_6021200", "ffm_6021300", "ffm_6021400", "ffm_6021511", "ffm_6021512", "ffm_6021513"],
  OPCI: ["ffm_6030111", "ffm_6030112", "ffm_6030113", "ffm_6030114", "ffm_6030115", "ffm_6030116", "ffm_6030200", "ffm_6030300", "ffm_6030400", "ffm_6030500", "ffm_6030600", "ffm_6030700", "ffm_6030800", "ffm_6030900", "ffm_6031000", "ffm_6031100"],
  FUTU: ["ffm_6040111", "ffm_6040112", "ffm_6040113", "ffm_6040114", "ffm_6040115", "ffm_6040116", "ffm_6040200", "ffm_6040300", "ffm_6040400", "ffm_6040500", "ffm_6040600"],
};

test("la circular 1333 explica TODAS las columnas reales de la cartera", () => {
  const porColumna = new Map(CODIGOS_CIRCULAR_1333.flatMap((c) => c.columnas.map((col) => [col, c] as const)));
  const sinExplicar: string[] = [];
  for (const [cartera, columnas] of Object.entries(COLUMNAS_REALES)) {
    for (const col of columnas) {
      const c = porColumna.get(col);
      if (!c || c.cartera !== cartera || !c.nombre) sinExplicar.push(`${cartera}:${col}`);
    }
  }
  assert.deepEqual(sinExplicar, []);
  // Y las 3 mitades de la 11.11 se distinguen entre sí.
  assert.match(porColumna.get("ffm_tir_6011111")?.nombre ?? "", /TIR|tasa interna/i);
  assert.match(porColumna.get("ffm_6011200")?.nombre ?? "", /Valorizaci/);
  assert.match(porColumna.get("ffm_6011200")?.unidad ?? "", /miles de pesos/);
});

test("cmf_codigos cartera_fondos_mutuos entrega el código, la columna y los valores posibles", async () => {
  const client = await cliente();
  const r = await client.callTool({ name: "cmf_codigos", arguments: { catalogo: "cartera_fondos_mutuos", texto: "6011114" } });
  const sc = r.structuredContent as { total: number; filas: Array<Record<string, unknown>> };
  assert.equal(sc.total, 1);
  assert.equal(sc.filas[0].codigo, "6.01.11.14");
  assert.match(String(sc.filas[0].valores), /RC/);
  const texto = (r.content as Array<{ text: string }>)[0].text;
  assert.match(texto, /Tipo de inter/);
  assert.match(texto, /cir_1333_1997\.pdf/, "el texto apunta a la circular original");
});

test("los recursos cmf:// de códigos leen la misma fuente que la tool", async () => {
  const { restaurar } = conFetchDeIndices();
  try {
    const client = await cliente();
    const lista = await client.listResources();
    const uris = lista.resources.map((r) => r.uri);
    for (const uri of ["cmf://bancos/codigos", "cmf://seguros/codigos", "cmf://fondos-mutuos/cartera-codigos"]) {
      assert.ok(uris.includes(uri), `falta ${uri}`);
      const r = await client.readResource({ uri });
      const datos = JSON.parse(String(r.contents?.[0]?.text ?? ""));
      assert.ok(Array.isArray(datos.filas) && datos.filas.length > 0, uri);
    }
    const bancos = JSON.parse(String((await client.readResource({ uri: "cmf://bancos/codigos" })).contents[0].text));
    assert.equal(bancos.filas.length, CODIGOS_BANCOS.length);
  } finally {
    restaurar();
  }
});
