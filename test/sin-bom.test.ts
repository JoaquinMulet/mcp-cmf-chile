/**
 * Comprobación de clase. Ningún archivo versionado empieza con la marca BOM
 * (los 3 bytes EF BB BF).
 *
 * El 10 de octubre de 2026 la traían 20 archivos, 14 de ellos de `src`, desde
 * antes de que nadie lo notara. La marca no se ve en ningún editor. Para quien
 * lee el archivo como texto, la primera línea no empieza donde parece, y una
 * regla que mira esa primera línea (un import que tiene que ir primero, un
 * `#!`, un nombre de columna) falla sin que el archivo muestre nada raro.
 * Entra sola con herramientas de Windows, por ejemplo `Out-File -Encoding
 * utf8` de PowerShell 5.1.
 *
 * Queda fuera `test/fixtures`. Ahí van datos reales de la CMF, copiados byte
 * por byte, y si la fuente manda la marca, la marca es parte del dato.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..");
const DATOS_DE_LA_FUENTE = "test/fixtures/";

/** Dice si estos bytes empiezan con la marca BOM de UTF-8. */
const empiezaConBom = (bytes: Uint8Array) => bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

/** Los archivos versionados, por su ruta desde la raíz. */
function versionados(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: RAIZ, encoding: "utf8" })
    .split(String.fromCharCode(0))
    .filter((ruta) => ruta !== "" && !ruta.startsWith(DATOS_DE_LA_FUENTE));
}

test("ningún archivo versionado empieza con la marca BOM", () => {
  const rutas = versionados();
  // Si git no entregara nada, la prueba pasaría mirando el vacío.
  assert.ok(rutas.length > 100, `git entregó ${rutas.length} archivos`);
  assert.ok(rutas.includes("test/sin-bom.test.ts") || rutas.includes("package.json"), "la lista no trae los archivos del repositorio");
  const conMarca = rutas.filter((ruta) => {
    try {
      return empiezaConBom(readFileSync(join(RAIZ, ruta)));
    } catch {
      // Versionado y borrado del disco. No hay bytes que mirar.
      return false;
    }
  });
  assert.deepEqual(conMarca, []);
});

test("la comprobación sí puede fallar", () => {
  const texto = new TextEncoder().encode("import x from 'y';");
  assert.equal(empiezaConBom(texto), false);
  assert.equal(empiezaConBom(new Uint8Array([0xef, 0xbb, 0xbf, ...texto])), true);
  // La marca en cualquier otro lugar no es un BOM, es un carácter del texto.
  assert.equal(empiezaConBom(new Uint8Array([...texto, 0xef, 0xbb, 0xbf])), false);
  assert.equal(empiezaConBom(new Uint8Array([0xef, 0xbb])), false);
  assert.equal(empiezaConBom(new Uint8Array([])), false);
});
