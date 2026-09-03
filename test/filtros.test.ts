/**
 * Filtros locales para las tablas que la CMF entrega enteras y sin filtro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarFilas, fechaIso } from "../src/util/filtros.js";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

test("fechaIso lee las 3 formas de fecha de la CMF y rechaza lo que no es fecha", () => {
  assert.equal(fechaIso("11/06/2026"), "2026-06-11");
  assert.equal(fechaIso("25.08.2026"), "2026-08-25");
  assert.equal(fechaIso("2026-06-01"), "2026-06-01");
  assert.equal(fechaIso("2026060392963"), undefined);
  assert.equal(fechaIso("PARQUE ARAUCO S.A."), undefined);
});

test("filtrarFilas: texto sin acentos ni mayúsculas, y desde/hasta sobre el campo de fecha", () => {
  const filas = [
    { fecha: "11/06/2026", sociedad: "PARQUE ARAUCO S.A.", numero: "2026060392963" },
    { fecha: "09/03/2026", sociedad: "SOCIEDAD DE INVERSIONES CAMPOS CHILENOS S.A.", numero: "2026030164306" },
    { fecha: "12/02/2026", sociedad: "TELEFÓNICA CHILE S.A.", numero: "2026020109420" },
  ];
  assert.deepEqual(filtrarFilas(filas, {}), filas);
  assert.equal(filtrarFilas(filas, { texto: "telefonica" }).length, 1);
  assert.equal(filtrarFilas(filas, { texto: "parque arauco" })[0].numero, "2026060392963");
  assert.deepEqual(filtrarFilas(filas, { desde: "2026-03-01" }).map((f) => f.fecha), ["11/06/2026", "09/03/2026"]);
  assert.deepEqual(filtrarFilas(filas, { desde: "2026-03-01", hasta: "2026-03-31" }).map((f) => f.fecha), ["09/03/2026"]);
  assert.equal(filtrarFilas(filas, { texto: "chile", hasta: "2026-02-28" }).length, 1);
});

test("cmf_fondos_mutuos_cartera: texto filtra en el servidor y el total es el de las filas que cumplen", async () => {
  const csv = ["run_fondo;nombre_fondo;ffm_6010100", "8298;FONDO MUTUO SECURITY DIVERSIFICACION;100", "8095;FONDO MUTUO SECURITY GLOBAL;200", "9690;BI LIQUIDEZ;300"].join("\r\n");
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(csv, { status: 200, headers: { "Content-Type": "text/plain" } })) as typeof fetch;
  try {
    const server = createServer({ CMF_RATE_LIMIT_MS: "0" });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "test", version: "1.0.0" }, {});
    await client.connect(ct);
    const todas = await client.callTool({ name: "cmf_fondos_mutuos_cartera", arguments: { anio: "2026", mes: "06", cartera: "NACI" } });
    assert.equal((todas.structuredContent as { total: number }).total, 3);
    const r = await client.callTool({ name: "cmf_fondos_mutuos_cartera", arguments: { anio: "2026", mes: "06", cartera: "NACI", texto: "security" } });
    const sc = r.structuredContent as { filas: Array<Record<string, string>>; total: number };
    assert.equal(sc.total, 2);
    assert.ok(sc.filas.every((f) => f.nombre_fondo.includes("SECURITY")));
  } finally {
    globalThis.fetch = original;
  }
});
