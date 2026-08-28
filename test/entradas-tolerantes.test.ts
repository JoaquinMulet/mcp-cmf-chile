/**
 * Un número que llega como texto no es un error del que llama.
 *
 * La regla del proyecto está escrita en la cabecera de `src/util/schemas.ts`.
 * los esquemas de entrada aceptan lo que escriben personas y modelos, y
 * normalizan antes de validar. Por eso `anioSchema` acepta 2026 y "2026",
 * y `mesSchema` acepta 3 y "03".
 *
 * Los parámetros numéricos no seguían esa regla, y el que más duele es
 * `offset`. Medido el 28 de agosto de 2026 contra el servidor desplegado.
 * pedir la página siguiente del boletín con `offset: "50"` devolvía
 * «Invalid input: expected number, received string», así que la paginación
 * quedaba inalcanzable para un cliente que serializa sus argumentos como
 * texto. La función estaba construida y publicada, y aun así no se podía
 * usar. Eso se lee desde afuera como que la paginación no existe.
 *
 * Estas comprobaciones son de CLASE. No miran un parámetro, miran todos los
 * esquemas de entrada del servidor, así que el defecto no puede volver por
 * una operación nueva escrita con el patrón viejo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/v4";
import { paginacion } from "../src/util/tramos.js";
import { offsetSchema, limitSchema } from "../src/util/schemas.js";

test("offset y limit aceptan el número escrito como texto", () => {
  const esquema = z.object(paginacion(50));
  const r = esquema.parse({ offset: "50", limit: "10" });
  assert.equal(r.offset, 50, "y llega convertido a número, no como texto");
  assert.equal(r.limit, 10);
});

test("offset y limit siguen aceptando el número de verdad", () => {
  const r = z.object(paginacion(50)).parse({ offset: 50, limit: 10 });
  assert.equal(r.offset, 50);
  assert.equal(r.limit, 10);
});

test("los esquemas sueltos de offset y limit son igual de tolerantes", () => {
  assert.equal(offsetSchema.parse("120"), 120);
  assert.equal(limitSchema.parse("7"), 7);
});

test("lo que NO es un número sigue siendo un error", () => {
  // Tolerar el texto numérico no es tolerar cualquier cosa. Un `offset`
  // basura tiene que fallar fuerte, no convertirse en algo en silencio.
  const esquema = z.object(paginacion(50));
  assert.throws(() => esquema.parse({ offset: "abc" }), /offset/i);
  assert.throws(() => esquema.parse({ offset: "1.5" }), /offset/i, "un entero es un entero");
  assert.throws(() => esquema.parse({ offset: -1 }), /offset/i);
  assert.throws(() => esquema.parse({ limit: 0 }), /limit/i);
});

test("la cadena vacía se lee como el valor por defecto, y eso está elegido", () => {
  // La única concesión de `z.coerce.number()`. la cadena vacía se convierte
  // en 0 en vez de fallar. Se aceptó a propósito, midiendo la alternativa.
  // Un union de número y texto SÍ la rechaza, pero publica el parámetro como
  // `anyOf` y pierde en el esquema el valor por defecto y el mínimo, que es
  // justo lo que el modelo lee para saber qué mandar. Un esquema publicado
  // peor cuesta más que un `offset` vacío, que además significa lo mismo que
  // el default: empezar por el principio.
  assert.equal(z.object(paginacion(50)).parse({ offset: "" }).offset, 0);
});

/**
 * El barrido de clase sobre el código fuente.
 *
 * Se distingue el esquema de ENTRADA del de SALIDA por la última de las 2
 * palabras que apareció antes de la línea. Un `z.number()` en un
 * `outputSchema` describe lo que nosotros entregamos y ahí es correcto. En
 * un `inputSchema` describe lo que aceptamos, y ahí rechaza a quien manda
 * "50" en vez de 50.
 */
/** Los `z.number()` de ENTRADA de un archivo, con su número de línea. */
function numerosEstrictosDeEntrada(fuente: string): string[] {
  const culpables: string[] = [];
  let dentroDeEntrada = false;
  for (const [i, linea] of fuente.split("\n").entries()) {
    if (linea.includes("inputSchema")) dentroDeEntrada = true;
    else if (linea.includes("outputSchema")) dentroDeEntrada = false;
    const esComentario = /^\s*(\/\/|\*|\/\*)/.test(linea);
    if (dentroDeEntrada && !esComentario && /z\.number\(\)/.test(linea)) {
      culpables.push(`${i + 1} -> ${linea.trim().slice(0, 90)}`);
    }
  }
  return culpables;
}

test("ningún parámetro de entrada exige un número estricto", () => {
  const dirTools = join(import.meta.dirname, "..", "src", "tools");
  const culpables = readdirSync(dirTools)
    .filter((f) => f.endsWith(".ts"))
    .flatMap((archivo) =>
      numerosEstrictosDeEntrada(readFileSync(join(dirTools, archivo), "utf8")).map((c) => `${archivo}:${c}`),
    );
  assert.deepEqual(
    culpables,
    [],
    `estos parámetros de entrada rechazan el número escrito como texto. usa enteroSchema o numeroSchema de src/util/schemas.ts:\n${culpables.join("\n")}`,
  );
});

test("la comprobación anterior SÍ puede fallar", () => {
  // Una prueba que no puede fallar da confianza falsa. Esta es la prueba de
  // la prueba, con el patrón exacto que se está prohibiendo.
  const falso = "      inputSchema: z.object({\n        limite: z.number().int().min(1).default(5),\n      }),";
  assert.equal(numerosEstrictosDeEntrada(falso).length, 1, "el barrido tiene que ver un z.number() de entrada");
});

test("un z.number() de SALIDA no se marca como culpable", () => {
  // El otro lado. Un control que marca código correcto se termina ignorando
  // entero, y con él se pierden los hallazgos de verdad.
  const bueno = "      outputSchema: z.object({\n        total: z.number(),\n      }),";
  assert.deepEqual(numerosEstrictosDeEntrada(bueno), [], "un total de salida no es un parámetro de entrada");
});
