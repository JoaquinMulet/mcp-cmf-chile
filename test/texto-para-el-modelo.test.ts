/**
 * El bloque de TEXTO es todo lo que ve un modelo.
 *
 * `structuredContent` sobrevive para quien llama por programa, no para el
 * agente. Estas comprobaciones fijan esa regla, porque romperla no falla
 * ruidoso: el servidor responde 200, el JSON trae el dato, y el agente
 * declara que la información no está disponible.
 *
 * Origen (20 de agosto de 2026). un informe sobre pólizas vehiculares
 * quedó con pendientes porque el enlace al documento viajaba solo en el
 * JSON, y porque el texto cortaba en 8 filas de las 100 pedidas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resumirTabla } from "../src/util/errors.js";

const FILA_CON_URL = {
  codigo: "POL120260128",
  fecha: "22/07/2026",
  entidad: "CONSORCIO NACIONAL DE SEGUROS S.A.",
  texto: "PÓLIZA DE SEGUROS PARA VEHÍCULOS MOTORIZADOS",
  url: "https://www.cmfchile.cl/sitio/seil/pagina/rgpol/muestra_documento.php?ABH89548=XYZ",
};

test("resumirTabla entrega el enlace al documento aunque no se lo pidan", () => {
  const texto = resumirTabla([FILA_CON_URL], ["codigo", "fecha", "entidad", "texto"]);
  assert.match(texto, /\| url/, "la cabecera debe incluir la columna url");
  assert.ok(texto.includes(FILA_CON_URL.url), "el enlace completo debe estar en el texto");
});

test("resumirTabla dice CÓMO leer el documento cuando hay enlace", () => {
  const texto = resumirTabla([FILA_CON_URL], ["codigo"]);
  assert.match(texto, /cmf_documento_markdown/, "debe nombrar la tool que convierte el PDF");
});

test("resumirTabla no inventa una columna url cuando las filas no la traen", () => {
  const texto = resumirTabla([{ rut: "96654180", nombre: "CONSORCIO" }], ["rut", "nombre"]);
  assert.ok(!texto.includes("url"), "sin enlace no debe aparecer la columna");
  assert.ok(!texto.includes("cmf_documento_markdown"), "ni la recomendación de lectura");
});

test("resumirTabla muestra 50 filas por defecto, no 8", () => {
  const filas = Array.from({ length: 60 }, (_, i) => ({ n: String(i) }));
  const lineas = resumirTabla(filas, ["n"]).split("\n");
  // 1 cabecera + 50 filas + 1 aviso de corte
  assert.equal(lineas.length, 52, `esperaba 52 líneas y llegaron ${lineas.length}`);
});

test("el aviso de corte dice con qué offset pedir el resto", () => {
  const filas = Array.from({ length: 60 }, (_, i) => ({ n: String(i) }));
  const texto = resumirTabla(filas, ["n"], 50, 100);
  assert.match(texto, /faltan 10 filas/, "debe decir cuántas faltan");
  assert.match(texto, /offset=150/, "debe decir el offset siguiente, contando el de esta página");
});

test("ninguna tool manda al modelo a leer structuredContent", () => {
  // Comprobación de CLASE, no de caso. Un texto que remite a
  // `structuredContent` le pide al agente que mire donde no puede, y ese
  // es exactamente el defecto que costó un informe incompleto.
  const dirTools = join(import.meta.dirname, "..", "src", "tools");
  const culpables: string[] = [];
  for (const archivo of readdirSync(dirTools).filter((f) => f.endsWith(".ts"))) {
    const fuente = readFileSync(join(dirTools, archivo), "utf8");
    for (const [i, linea] of fuente.split("\n").entries()) {
      // Solo el texto que se le entrega al modelo. Las declaraciones de
      // `outputSchema` y los comentarios no cuentan.
      const esComentario = /^\s*(\/\/|\*|\/\*)/.test(linea);
      if (esComentario) continue;
      if (/["`'][^"`']*structuredContent/.test(linea)) culpables.push(`${archivo}:${i + 1}`);
    }
  }
  assert.deepEqual(culpables, [], `estas líneas mandan al modelo a structuredContent: ${culpables.join(", ")}`);
});
