/**
 * El servicio de PDF a Markdown tiene límites, y el modelo tiene que
 * conocerlos ANTES de citar una cifra.
 *
 * Origen (2 de septiembre de 2026). Al subir pdf-inspector de 1.15.0 a
 * 1.17.0, el mismo PDF de Copec dio 181 filas separadas contra 107, y
 * ninguna de las 2 versiones cuadró el balance. El motor no es una fuente
 * estable ni completa, y el servidor lo decía en ninguna parte. La regla
 * del dueño: cada tool que transforma una fuente le declara al modelo
 * qué pierde en la transformación, y le ofrece el camino más fiable, que
 * para un modelo con visión es leer el PDF como imagen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { notaLimitacionesPdf, RESUMEN_LIMITACIONES_PDF } from "../src/pdf.js";

test("la nota de limitaciones dice qué pierde la conversión", () => {
  const nota = notaLimitacionesPdf("TextBased");
  assert.match(nota, /sin OCR/i, "que un PDF escaneado sale vacío");
  assert.match(nota, /celda/i, "que puede fusionar conceptos en una celda");
  assert.match(nota, /versi[oó]n/i, "que cada versión del motor extrae distinto");
});

test("la nota recomienda leer el PDF como imagen si el modelo tiene visión", () => {
  const nota = notaLimitacionesPdf("TextBased");
  assert.match(nota, /imagen/i);
  assert.match(nota, /visi[oó]n/i);
  assert.match(nota, /modo=documentos|cmf_documento_descargar/, "y dice cómo conseguir el PDF");
});

test("con un PDF escaneado la nota lo dice primero y no promete texto", () => {
  const nota = notaLimitacionesPdf("Scanned");
  assert.match(nota.split("\n")[0], /escaneado/i, "la primera línea nombra el problema real");
  assert.match(nota, /imagen/i, "y la salida es la misma: leerlo como imagen");
});

test("toda tool que convierte un PDF entrega la nota de limitaciones al modelo", () => {
  // Comprobación de CLASE. Una tool nueva que llame a pdfAMarkdown sin
  // pasar la nota compila, corre y responde 200 con un texto que calla.
  const dirTools = join(import.meta.dirname, "..", "src", "tools");
  const culpables: string[] = [];
  for (const archivo of readdirSync(dirTools).filter((f) => f.endsWith(".ts"))) {
    const fuente = readFileSync(join(dirTools, archivo), "utf8");
    const llamadas = fuente.split("pdfAMarkdown(").length - 1;
    const notas = fuente.split("notaLimitacionesPdf(").length - 1;
    if (llamadas > 0 && notas < llamadas) culpables.push(`${archivo}: ${llamadas} conversiones, ${notas} notas`);
  }
  assert.deepEqual(culpables, [], `convierten PDF sin declarar las limitaciones: ${culpables.join("; ")}`);
});

test("las descripciones y las instrucciones del servidor llevan el resumen de limitaciones", () => {
  // Las descripciones se leen ANTES de llamar. Ahí el modelo con visión
  // puede elegir descargar el PDF en vez de pedir el Markdown.
  assert.match(RESUMEN_LIMITACIONES_PDF, /imagen/i);
  const raiz = join(import.meta.dirname, "..", "src");
  for (const archivo of ["server.ts", "tools/otros.ts", "tools/empresas.ts", "resources.ts"]) {
    const fuente = readFileSync(join(raiz, archivo), "utf8");
    assert.ok(fuente.includes("RESUMEN_LIMITACIONES_PDF"), `${archivo} no usa RESUMEN_LIMITACIONES_PDF`);
  }
});
