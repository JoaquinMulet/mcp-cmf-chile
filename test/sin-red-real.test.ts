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
 * La quinta revisión la burló de 6 formas más, y 5 quedaron cerradas. un
 * ayudante `.mjs`, un ayudante que carga a otro ayudante, un ayudante nombrado
 * como `../test/x.js`, la ruta `.././src/`, y el import escondido entre 2
 * cadenas con las marcas de un comentario de bloque.
 *
 * Lo que la regla no puede ver. una ruta armada en tiempo de ejecución sin
 * que aparezca `src/` en el texto, una prueba que importa el guardia y
 * después repone a mano un fetch real, y la línea del guardia escrita dentro
 * de una plantilla de texto antes del primer import. Es una regla para que
 * nadie se olvide del guardia, no una defensa contra quien quiere saltárselo.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CARPETA = import.meta.dirname;
const GUARDIA = 'import "./sin-red-real.js";';
// Cualquier ruta que suba o baje con puntos y termine pasando por src/ o
// dist/. `../src/`, `./../src/` y `.././src/` son la misma carpeta.
const NOMBRA_AL_SERVIDOR = /(?:\.{1,2}\/)+(?:src|dist)\//;
// Una ruta relativa a un archivo de código, entre comillas de cualquier tipo.
const AYUDANTE_LOCAL = /["'`]((?:\.{1,2}\/)+[\w./-]+?)\.(?:js|ts|mjs|mts)["'`]/g;

/** El código sin sus comentarios de bloque, donde un guardia escrito no cuenta. */
const sinComentariosDeBloque = (fuente: string) => fuente.replace(/\/\*[\s\S]*?\*\//g, "");

/** Los ayudantes locales que un archivo nombra, sin el guardia. */
const ayudantesDe = (fuente: string) =>
  [...fuente.matchAll(AYUDANTE_LOCAL)].map((m) => m[1]).filter((ruta) => !ruta.endsWith("sin-red-real"));

/**
 * El ayudante por el que un archivo llega al servidor, o null. Sigue la cadena
 * entera. un ayudante puede cargar al servidor por otro ayudante.
 */
function ayudanteQueLlegaAlServidor(fuente: string, leer: (ruta: string) => string | null, vistos = new Set<string>()): string | null {
  for (const ruta of ayudantesDe(fuente)) {
    if (vistos.has(ruta)) continue;
    vistos.add(ruta);
    const texto = leer(ruta);
    if (texto === null) continue;
    if (NOMBRA_AL_SERVIDOR.test(texto) || ayudanteQueLlegaAlServidor(texto, leer, vistos)) return ruta;
  }
  return null;
}

/** Lo que le falta a una prueba, o null si está bien. `leer` entrega el texto de un ayudante local. */
function loQueFalta(fuente: string, leer: (ruta: string) => string | null = () => null): string | null {
  // Si nombra al servidor se mira sobre el texto CRUDO. Mirarlo sin los
  // comentarios dejaba esconder el import entre 2 cadenas con las marcas de
  // un comentario de bloque.
  const porAyudante = ayudanteQueLlegaAlServidor(fuente, leer);
  if (!NOMBRA_AL_SERVIDOR.test(fuente) && !porAyudante) return null;
  // Dónde está el guardia se mira sin los comentarios, donde no protege a nadie.
  const lineas = sinComentariosDeBloque(fuente)
    .split(/\r?\n/)
    .map((l) => l.trim());
  const guardia = lineas.indexOf(GUARDIA);
  const como = porAyudante ? `carga código del servidor por ${porAyudante}` : "carga código del servidor";
  if (guardia < 0) return `${como} y no importa el guardia`;
  const primerImport = lineas.findIndex((l) => /^import\b/.test(l));
  return guardia === primerImport ? null : "importa el guardia, pero no como primer import";
}

function leerAyudante(ruta: string): string | null {
  for (const extension of [".ts", ".mts", ".mjs", ".js"]) {
    const archivo = join(CARPETA, `${ruta}${extension}`);
    if (existsSync(archivo)) return readFileSync(archivo, "utf8");
  }
  return null;
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
    'import { fetchCmf } from ".././src/client/cmf-client.js";',
    'import { createServer } from "../dist/server.js";',
    // El import escondido entre 2 cadenas con las marcas de un comentario.
    ['const a = "/*";', 'import { fetchCmf } from "../src/client/cmf-client.js";', 'const b = "*/";'].join("\n"),
  ];
  for (const carga of formas) assert.match(loQueFalta(carga) ?? "", /no importa el guardia/, carga);
  const cliente = formas[0];
  // Un guardia escrito dentro de un comentario no protege a nadie.
  assert.match(loQueFalta(["/*", GUARDIA, "*/", cliente].join("\n")) ?? "", /no importa el guardia/);
  assert.match(loQueFalta([cliente, GUARDIA].join("\n")) ?? "", /no como primer import/);
  assert.equal(loQueFalta([GUARDIA, cliente].join("\n")), null);
  // Por un ayudante local que carga el servidor.
  const conAyudante = 'import { pedir } from "./ayudante.js";';
  const leer = (ruta: string) => (ruta === "./ayudante" ? cliente : null);
  assert.match(loQueFalta(conAyudante, leer) ?? "", /por \.\/ayudante y no importa el guardia/);
  assert.equal(loQueFalta([GUARDIA, conAyudante].join("\n"), leer), null);
  // Por una cadena de ayudantes, de cualquier extensión y nombrados de cualquier forma.
  const cadena: Record<string, string> = {
    "./uno": 'export * from "../test/dos.mjs";',
    "../test/dos": cliente,
  };
  assert.match(loQueFalta('import { pedir } from "./uno.mjs";', (ruta) => cadena[ruta] ?? null) ?? "", /por \.\/uno y no importa el guardia/);
  // 2 ayudantes que se cargan entre sí no dejan la regla dando vueltas.
  const circulo: Record<string, string> = { "./a": 'import "./b.js";', "./b": 'import "./a.js";' };
  assert.equal(loQueFalta('import "./a.js";', (ruta) => circulo[ruta] ?? null), null);
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
