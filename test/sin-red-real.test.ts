/**
 * Comprobación de clase. Toda prueba que carga código del servidor importa
 * primero el guardia que bloquea la red real. La razón está en
 * test/sin-red-real.ts.
 *
 * La regla mira lo que la prueba IMPORTA y no cómo reemplaza la red. La
 * primera versión buscaba el texto `globalThis.fetch`, y la revisión
 * adversarial del 9 de octubre de 2026 la burló de 5 formas (`global.fetch`,
 * `globalThis["fetch"]`, `Object.assign`, `mock.method` y un alias). Además
 * no miraba a la prueba más peligrosa, la que llama al cliente sin simular
 * nada. Quien importa de `../src/` puede llegar a la red, simule o no.
 *
 * Queda fuera a propósito test/salida-proxy.test.ts, que importa de
 * `../infra/` y habla con un servidor local por el fetch real.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CARPETA = import.meta.dirname;
const GUARDIA = 'import "./sin-red-real.js";';
const IMPORTA_DEL_SERVIDOR = /^import\s[^;]*["']\.\.\/src\//m;
const IMPORTA_DESPUES = /\bimport\s*\(\s*["']\.\.\/src\//;

/** Lo que le falta a una prueba, o null si está bien. */
function loQueFalta(fuente: string): string | null {
  if (!IMPORTA_DEL_SERVIDOR.test(fuente) && !IMPORTA_DESPUES.test(fuente)) return null;
  const lineas = fuente.split(/\r?\n/);
  const guardia = lineas.indexOf(GUARDIA);
  if (guardia < 0) return "carga código del servidor y no importa el guardia";
  const primerImport = lineas.findIndex((l) => l.startsWith("import "));
  return guardia === primerImport ? null : "importa el guardia, pero no como primer import";
}

test("toda prueba que carga código del servidor importa primero el guardia de la red real", () => {
  const faltas = readdirSync(CARPETA)
    .filter((nombre) => nombre.endsWith(".test.ts"))
    .map((nombre) => [nombre, loQueFalta(readFileSync(join(CARPETA, nombre), "utf8"))] as const)
    .filter(([, falta]) => falta !== null)
    .map(([nombre, falta]) => `${nombre}. ${falta}`);
  assert.deepEqual(faltas, []);
});

test("la comprobación sí puede fallar, simule la red o no la prueba", () => {
  const cliente = 'import { fetchCmf } from "../src/client/cmf-client.js";';
  const variasLineas = ["import {", "  createServer,", '} from "../src/server.js";'].join("\n");
  const diferido = 'const { fetchCmf } = await import("../src/client/cmf-client.js");';
  for (const carga of [cliente, variasLineas, diferido]) {
    assert.match(loQueFalta(carga) ?? "", /no importa el guardia/, carga);
  }
  assert.match(loQueFalta([cliente, GUARDIA].join("\n")) ?? "", /no como primer import/);
  assert.equal(loQueFalta([GUARDIA, cliente].join("\n")), null);
  // Una prueba que no carga nada del servidor no puede llegar a la CMF.
  assert.equal(loQueFalta('import { crearServidor } from "../infra/salida-chilena/proxy.mjs";'), null);
  assert.equal(loQueFalta("// habla de ../src/ y de globalThis.fetch en un comentario"), null);
});

test("el guardia lanza y nombra el destino sin query, sin ancla y sin credenciales", async () => {
  const sucia = "https://usuario:clave-secreta@www.cmfchile.cl/pagina.php?token=secreto#ancla";
  for (const destino of [sucia, new URL(sucia), new Request("https://www.cmfchile.cl/pagina.php?token=secreto#ancla")]) {
    await assert.rejects(fetch(destino), (e: Error) => {
      assert.match(e.message, /fuera de su red simulada, hacia https:\/\/www\.cmfchile\.cl\/pagina\.php$/);
      return true;
    });
  }
});
