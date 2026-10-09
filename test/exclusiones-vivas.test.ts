/**
 * Una exclusión que sobrevive a lo que excluía encoge la cobertura en silencio.
 *
 * El análisis de seguridad de la nube no mira todo el repositorio. Su archivo
 * de configuración lista carpetas que se saltan, y cada una de esas líneas es
 * un pedazo de código que NADIE revisa.
 *
 * Eso está bien mientras la carpeta exista y sea lo que la línea dice. El
 * problema es el día que la carpeta cambia de nombre, se borra, o se llena de
 * código que sí se despliega. La exclusión sigue ahí, sin fallar, y la
 * cobertura queda más chica de lo que cualquiera cree leyendo la config.
 *
 * Medido el 29 de agosto de 2026. `test/investigacion` estaba excluida porque
 * generaba 65 de las 74 alertas y su volumen tapaba las 3 que sí importaban.
 * La carpeta se borró entera, y sin esta comprobación la exclusión habría
 * quedado apuntando a la nada, esperando a que alguien creara otra carpeta con
 * ese nombre y la escribiera sin que nadie la revisara.
 *
 * La regla. toda exclusión tiene que apuntar a algo que EXISTE, o irse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const RAIZ = join(import.meta.dirname, "..");

/** Las carpetas de la config de CodeQL que se saltan del análisis. */
function exclusiones(): string[] {
  const yml = readFileSync(join(RAIZ, ".github", "codeql", "config.yml"), "utf8");
  const bloque = yml.split("paths-ignore:")[1] ?? "";
  return bloque
    .split("\n")
    .map((l) => l.match(/^\s*-\s+(\S+)\s*$/)?.[1])
    .filter((x): x is string => Boolean(x))
    .slice(0, 20);
}

/** Lo que se genera o se descarga, y por eso puede no estar en el disco. */
const GENERADAS = new Set(["dist", "node_modules", ".wrangler", ".wrangler-dist"]);

test("el análisis de seguridad no excluye carpetas que ya no existen", () => {
  const muertas = exclusiones().filter((p) => !GENERADAS.has(p) && !existsSync(join(RAIZ, p)));
  assert.deepEqual(
    muertas,
    [],
    `estas exclusiones apuntan a la nada. Quítalas, o la cobertura queda más chica de lo que dice la config:\n${muertas.join("\n")}`,
  );
});

test("la lista de exclusiones se lee de verdad", () => {
  // La prueba de la prueba. Si el archivo cambia de formato y el lector
  // devuelve una lista vacía, la comprobación de arriba pasa siempre y deja
  // de mirar nada. Un verde que no puede ponerse rojo es el peor resultado.
  const leidas = exclusiones();
  assert.ok(leidas.length > 0, "sin exclusiones leídas, la comprobación anterior no está midiendo nada");
  assert.ok(leidas.includes("node_modules"), `se esperaba node_modules entre las exclusiones, hay: ${leidas.join(", ")}`);
});

test("ninguna exclusión tapa el código que se despliega", () => {
  // El otro lado, y es el que de verdad duele. Excluir `src` dejaría al
  // Worker entero sin análisis, y la config seguiría viéndose razonable.
  const prohibidas = exclusiones().filter((p) => p === "src" || p.startsWith("src/"));
  assert.deepEqual(prohibidas, [], `el código del Worker no puede quedar fuera del análisis: ${prohibidas.join(", ")}`);
});

test("tampoco tapa el resto del código que corre ni las pruebas enteras", () => {
  // infra/ corre en una máquina del dueño y herramientas/ corre en la CI con
  // credenciales. De test/ solo se salta test/fixtures, que son datos.
  const CORRE = ["infra", "herramientas", ".github"];
  const prohibidas = exclusiones().filter((p) => p === "test" || CORRE.some((c) => p === c || p.startsWith(`${c}/`)));
  assert.deepEqual(prohibidas, [], `esto no puede quedar fuera del análisis: ${prohibidas.join(", ")}`);
});

/** Extensiones de datos capturados de la CMF. Todo lo demás es código nuestro. */
const SOLO_DATOS = new Set([".html", ".json", ".xls", ".xlsx", ".pdf", ".txt", ".csv", ".xml"]);

/** Los archivos de una lista que NO son datos capturados. */
function noSonDatos(nombres: string[]): string[] {
  return nombres.filter((n) => !SOLO_DATOS.has(extname(n).toLowerCase()));
}

test("test/fixtures está excluida del análisis y solo guarda datos capturados", () => {
  // La exclusión se sostiene mientras ahí no viva código nuestro. Son páginas
  // reales de la CMF, y el JavaScript que traen lo escribió la CMF y no corre
  // en ninguna prueba. El 9 de octubre de 2026 eran 26 de las 27 alertas
  // abiertas, y la única que importaba estaba en otra carpeta.
  assert.ok(exclusiones().includes("test/fixtures"), "se esperaba test/fixtures entre las exclusiones");
  const intrusos = noSonDatos(readdirSync(join(RAIZ, "test", "fixtures"), { recursive: true }).map(String));
  assert.deepEqual(intrusos, [], `test/fixtures no se analiza, así que no puede guardar código:\n${intrusos.join("\n")}`);
});

test("la comprobación anterior SÍ puede fallar", () => {
  assert.deepEqual(noSonDatos(["pagina.html", "ayuda.mjs", "tabla.XLS", "sub/carga.ts", "sinextension"]), [
    "ayuda.mjs",
    "sub/carga.ts",
    "sinextension",
  ]);
});
