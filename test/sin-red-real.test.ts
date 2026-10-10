/**
 * Comprobación de clase. Toda prueba que carga código del servidor importa
 * primero el guardia que bloquea la red real. La razón está en
 * test/sin-red-real.ts.
 *
 * La regla mira si la prueba NOMBRA el código del servidor, de la forma que
 * sea, y no cómo lo carga ni cómo reemplaza la red. La primera versión
 * buscaba el texto `globalThis.fetch` y la tercera revisión adversarial la
 * burló de 5 formas. La segunda buscaba la sentencia `import ... "../src/"` y
 * la cuarta revisión la burló de 8 (require, import() con variable o con
 * plantilla, `./../src/`, `../dist/`, un ayudante intermedio, el guardia
 * dentro de un comentario y un import sin espacios). Las 2 veces el error fue
 * el mismo. la regla reconocía una forma de escribir, y hay muchas.
 *
 * Ahora basta con que el archivo, o un ayudante local que importe, nombre
 * una ruta que pase por `src/` o por `dist/`. Sobra alguna vez, por ejemplo
 * si una prueba solo lee un archivo de `src/` como texto, y ponerle el guardia
 * no le cuesta nada.
 *
 * Queda fuera a propósito test/salida-proxy.test.ts, que importa de
 * `../infra/` y habla con un servidor local por el fetch real.
 *
 * Lo que la regla no puede ver. una ruta armada en tiempo de ejecución sin
 * que aparezca `src/` en el texto, y una prueba que importa el guardia y
 * después repone a mano un fetch real.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CARPETA = import.meta.dirname;
const GUARDIA = 'import "./sin-red-real.js";';
const NOMBRA_AL_SERVIDOR = /\.\.\/(src|dist)\//;
const AYUDANTE_LOCAL = /["'`]\.\/([\w./-]+?)\.(?:js|ts|mjs)["'`]/g;

/** El código sin sus comentarios de bloque, donde un guardia escrito no cuenta. */
const sinComentariosDeBloque = (fuente: string) => fuente.replace(/\/\*[\s\S]*?\*\//g, "");

/** Lo que le falta a una prueba, o null si está bien. `leer` entrega el texto de un ayudante local. */
function loQueFalta(fuente: string, leer: (nombre: string) => string | null = () => null): string | null {
  const codigo = sinComentariosDeBloque(fuente);
  const ayudantes = [...codigo.matchAll(AYUDANTE_LOCAL)].map((m) => m[1]).filter((n) => n !== "sin-red-real");
  const porAyudante = ayudantes.find((n) => NOMBRA_AL_SERVIDOR.test(leer(n) ?? ""));
  if (!NOMBRA_AL_SERVIDOR.test(codigo) && !porAyudante) return null;
  const lineas = codigo.split(/\r?\n/).map((l) => l.trim());
  const guardia = lineas.indexOf(GUARDIA);
  const como = porAyudante ? `carga código del servidor por ./${porAyudante}` : "carga código del servidor";
  if (guardia < 0) return `${como} y no importa el guardia`;
  const primerImport = lineas.findIndex((l) => /^import\b/.test(l));
  return guardia === primerImport ? null : "importa el guardia, pero no como primer import";
}

function leerAyudante(nombre: string): string | null {
  const ruta = join(CARPETA, `${nombre}.ts`);
  return existsSync(ruta) ? readFileSync(ruta, "utf8") : null;
}

test("toda prueba que carga código del servidor importa primero el guardia de la red real", () => {
  const faltas = readdirSync(CARPETA)
    .filter((nombre) => nombre.endsWith(".test.ts"))
    .map((nombre) => [nombre, loQueFalta(readFileSync(join(CARPETA, nombre), "utf8"), leerAyudante)] as const)
    .filter(([, falta]) => falta !== null)
    .map(([nombre, falta]) => `${nombre}. ${falta}`);
  assert.deepEqual(faltas, []);
});

test("la comprobación sí puede fallar, se cargue el servidor de la forma que sea", () => {
  const formas = [
    'import { fetchCmf } from "../src/client/cmf-client.js";',
    ["import {", "  createServer,", '} from "../src/server.js";'].join("\n"),
    'import{fetchCmf}from"../src/client/cmf-client.js";',
    'const { fetchCmf } = await import("../src/client/cmf-client.js");',
    'const ruta = "../src/client/cmf-client.js";\nconst m = await import(ruta);',
    "const m = await import(`../src/client/${nombre}.js`);",
    'const m = createRequire(import.meta.url)("../src/server.js");',
    'import { fetchCmf } from "./../src/client/cmf-client.js";',
    'import { createServer } from "../dist/server.js";',
  ];
  for (const carga of formas) assert.match(loQueFalta(carga) ?? "", /no importa el guardia/, carga);
  const cliente = formas[0];
  // Un guardia escrito dentro de un comentario no protege a nadie.
  assert.match(loQueFalta(["/*", GUARDIA, "*/", cliente].join("\n")) ?? "", /no importa el guardia/);
  assert.match(loQueFalta([cliente, GUARDIA].join("\n")) ?? "", /no como primer import/);
  assert.equal(loQueFalta([GUARDIA, cliente].join("\n")), null);
  // Por un ayudante local que carga el servidor.
  const conAyudante = 'import { pedir } from "./ayudante.js";';
  const leer = (nombre: string) => (nombre === "ayudante" ? cliente : null);
  assert.match(loQueFalta(conAyudante, leer) ?? "", /por \.\/ayudante y no importa el guardia/);
  assert.equal(loQueFalta([GUARDIA, conAyudante].join("\n"), leer), null);
  // Una prueba que no nombra nada del servidor no puede llegar a la CMF.
  assert.equal(loQueFalta('import { crearServidor } from "../infra/salida-chilena/proxy.mjs";'), null);
  assert.equal(loQueFalta(conAyudante, () => "export const pedir = 1;"), null);
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
