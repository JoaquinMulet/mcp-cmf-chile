/**
 * Comprobación de clase. Toda prueba que simula la red importa el guardia
 * que bloquea la red real. La razón está en test/sin-red-real.ts.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CARPETA = import.meta.dirname;
const GUARDIA = 'import "./sin-red-real.js";';

/** Lo que le falta a una prueba, o null si está bien. */
function loQueFalta(fuente: string): string | null {
  if (!fuente.includes("globalThis.fetch")) return null;
  const lineas = fuente.split(/\r?\n/);
  const guardia = lineas.indexOf(GUARDIA);
  if (guardia < 0) return "reemplaza globalThis.fetch y no importa el guardia";
  const primerImport = lineas.findIndex((l) => l.startsWith("import "));
  return guardia === primerImport ? null : "importa el guardia, pero no como primer import";
}

test("toda prueba que simula la red importa primero el guardia de la red real", () => {
  const faltas = readdirSync(CARPETA)
    .filter((nombre) => nombre.endsWith(".test.ts"))
    .map((nombre) => [nombre, loQueFalta(readFileSync(join(CARPETA, nombre), "utf8"))] as const)
    .filter(([, falta]) => falta !== null)
    .map(([nombre, falta]) => `${nombre}. ${falta}`);
  assert.deepEqual(faltas, []);
});

test("la comprobación sí puede fallar", () => {
  const cliente = 'import { fetchCmf } from "../src/client/cmf-client.js";';
  const simula = "globalThis.fetch = (async () => new Response()) as typeof fetch;";
  assert.match(loQueFalta([cliente, simula].join("\n")) ?? "", /no importa el guardia/);
  assert.match(loQueFalta([cliente, GUARDIA, simula].join("\n")) ?? "", /no como primer import/);
  assert.equal(loQueFalta([GUARDIA, cliente, simula].join("\n")), null);
  assert.equal(loQueFalta(cliente), null);
});

test("el guardia lanza y nombra el destino sin su query", async () => {
  await assert.rejects(fetch("https://www.cmfchile.cl/pagina.php?token=secreto"), (e: Error) => {
    assert.match(e.message, /fuera de su red simulada, hacia https:\/\/www\.cmfchile\.cl\/pagina\.php$/);
    return true;
  });
});
