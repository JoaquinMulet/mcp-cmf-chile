/**
 * El código no acumula cadáveres.
 *
 * Regla del dueño, del 21 de agosto de 2026. cada vez que se toca el
 * sistema hay que dejarlo más limpio que antes, y eso no puede depender
 * de que alguien se acuerde. Esta comprobación lo hace cumplir sola.
 *
 * Qué caza. una función, constante o clase declarada y que no aparece
 * en ninguna otra parte, ni siquiera en su propio archivo. Eso es código
 * muerto, y el problema no es que ocupe espacio. es que alguien lo va a
 * volver a usar sin saber por qué se dejó de usar.
 *
 * Encontró 4 el día que se escribió, entre ellas una capa entera de
 * caché sin usar y un `truncarTexto` que cortaba a 12.000 caracteres sin
 * decir cómo pedir el resto, justo el patrón que este servidor prohíbe.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");

/** Nombres que se resuelven en tiempo de EJECUCIÓN, no por import. */
const VIVOS_POR_NOMBRE = new Set([
  // Cloudflare lo alcanza con ctx.exports.PuenteCmf, por texto.
  "PuenteCmf",
]);

/** Todos los .ts de src y de test, con su contenido. */
function fuentes(): Map<string, string> {
  const salida = new Map<string, string>();
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (entrada.name.endsWith(".ts")) salida.set(ruta, readFileSync(ruta, "utf-8"));
    }
  };
  recorrer(SRC);
  recorrer(join(import.meta.dirname));
  return salida;
}

const DECLARACION = /^(?:export )?(?:async )?(?:function|const|class) ([A-Za-z_][A-Za-z0-9_]*)/gm;

/** Declaraciones que no aparecen en ninguna parte, ni en su propio archivo. */
export function declaracionesMuertas(archivos: Map<string, string>): string[] {
  const muertas: string[] = [];
  for (const [archivo, fuente] of archivos) {
    if (!archivo.includes(`${"src"}`)) continue;
    DECLARACION.lastIndex = 0;
    for (let m = DECLARACION.exec(fuente); m !== null; m = DECLARACION.exec(fuente)) {
      const nombre = m[1] ?? "";
      if (VIVOS_POR_NOMBRE.has(nombre)) continue;
      const suyo = new RegExp(`\\b${nombre}\\b`, "g");
      const enSuArchivo = (fuente.match(suyo) ?? []).length;
      const enOtros = [...archivos].some(([otro, s]) => otro !== archivo && suyo.test(s));
      if (enSuArchivo <= 1 && !enOtros) {
        muertas.push(`${archivo.split(/[\\/]/).slice(-2).join("/")} -> ${nombre}`);
      }
    }
  }
  return muertas;
}

test("no queda código muerto en src", () => {
  const muertas = declaracionesMuertas(fuentes());
  assert.deepEqual(
    muertas,
    [],
    `esto está declarado y no lo usa nadie. bórralo o úsalo: ${muertas.join(" | ")}`,
  );
});

test("y ese detector SÍ puede fallar", () => {
  // La prueba de la prueba, sobre la MISMA función que usa el control.
  const falso = new Map<string, string>([
    ["src/x.ts", "export function nadieMeLlama() { return 1 }\n"],
    ["test/y.ts", "const otra = 2\n"],
  ]);
  assert.deepEqual(declaracionesMuertas(falso), ["src/x.ts -> nadieMeLlama"]);

  const vivo = new Map<string, string>([
    ["src/x.ts", "export function siMeLlaman() { return 1 }\n"],
    ["test/y.ts", "siMeLlaman()\n"],
  ]);
  assert.deepEqual(declaracionesMuertas(vivo), []);
});
