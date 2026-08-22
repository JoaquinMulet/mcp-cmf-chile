/**
 * Las piezas puras de paquete.ts.
 *
 * Por que existe. el 21 de agosto de 2026 medimos la cobertura por
 * primera vez y paquete.ts salio con 15,7 por ciento de lineas y 11,1
 * por ciento de funciones, el peor del repo. Y es justo el archivo con
 * las 2 funciones mas complejas, que suman 174 puntos. Poco probado y
 * muy enredado es la peor combinacion posible.
 *
 * Lo que se prueba aca son sus piezas PURAS, las que no tocan la red.
 * `filasConLinks` es la que decide si el agente ve o no el enlace al
 * documento firmado, y esa columna ya se perdio una vez en el servidor,
 * asi que merece prueba propia en vez de llegar por casualidad.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fichaUrl, filasConLinks } from "../src/tools/paquete.js";

// --- fichaUrl ---------------------------------------------------------

test("fichaUrl arma la URL de la pestaña pedida", () => {
  const u = fichaUrl("90690000", 36);
  // RELATIVA a proposito. quien la usa es getLegacy, que le pone el
  // dominio. Mi primera version de esta prueba la esperaba absoluta y se
  // puso roja, que es la prueba haciendo su trabajo sobre una suposicion
  // mia y no sobre un defecto del codigo.
  assert.ok(u.startsWith("/institucional/"), "es relativa, getLegacy le pone el dominio");
  assert.ok(u.includes("rut=90690000"), "debe llevar el rut");
  assert.ok(u.includes("pestania=36"), "debe llevar la pestaña");
});

test("fichaUrl distingue una pestaña de otra", () => {
  assert.notEqual(fichaUrl("90690000", 36), fichaUrl("90690000", 37));
});

// --- filasConLinks ----------------------------------------------------

const COLS = ["fecha", "materia"];

test("convierte cada fila de la tabla en un objeto con sus columnas", () => {
  const html = `
    <table>
      <tr><th>Fecha</th><th>Materia</th></tr>
      <tr><td>01/03/2026</td><td>Junta de accionistas</td></tr>
      <tr><td>15/04/2026</td><td>Reparto de dividendos</td></tr>
    </table>`;
  const filas = filasConLinks(html, COLS);
  assert.equal(filas.length, 2, "el encabezado no cuenta como fila");
  assert.deepEqual(filas[0].fila, { fecha: "01/03/2026", materia: "Junta de accionistas" });
  assert.equal(filas[1].fila.materia, "Reparto de dividendos");
});

test("rescata el enlace al documento firmado cuando la fila lo trae", () => {
  const html = `
    <tr>
      <td>01/03/2026</td>
      <td><a href="/sitio/aplic/serdoc/ver_sgd.php?s567=abc123def">Ver</a> Junta</td>
    </tr>`;
  const [f] = filasConLinks(html, COLS);
  assert.equal(
    f.url,
    "https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=abc123def",
    "el enlace es el unico camino del agente hacia el documento, y ya se perdio una vez",
  );
});

test("una fila sin enlace deja la url sin definir, no una cadena vacía", () => {
  const html = `<tr><td>01/03/2026</td><td>Sin documento</td></tr>`;
  const [f] = filasConLinks(html, COLS);
  assert.equal(f.url, undefined);
});

test("descarta el encabezado aunque venga en celdas td en vez de th", () => {
  const html = `
    <tr><td>Fecha</td><td>Materia</td></tr>
    <tr><td>01/03/2026</td><td>Algo</td></tr>`;
  const filas = filasConLinks(html, COLS);
  assert.equal(filas.length, 1, "la fila cuyo primer campo no tiene digitos es el encabezado");
  assert.equal(filas[0].fila.fecha, "01/03/2026");
});

test("limpia el marcado de adentro de la celda y colapsa los espacios", () => {
  const html = `<tr><td>01/03/2026</td><td>  Junta   <b>de</b>\n  accionistas  </td></tr>`;
  const [f] = filasConLinks(html, COLS);
  assert.equal(f.fila.materia, "Junta de accionistas");
});

test("decodifica las entidades HTML de la celda", () => {
  const html = `<tr><td>01/03/2026</td><td>Compa&ntilde;&iacute;a de Seguros</td></tr>`;
  const [f] = filasConLinks(html, COLS);
  assert.equal(f.fila.materia, "Compañía de Seguros");
});

test("una celda de mas que no tiene columna se ignora en vez de romper", () => {
  const html = `<tr><td>01/03/2026</td><td>Algo</td><td>sobrante</td></tr>`;
  const [f] = filasConLinks(html, COLS);
  assert.deepEqual(Object.keys(f.fila), ["fecha", "materia"]);
});

test("un HTML sin filas devuelve una lista vacía, no una excepción", () => {
  assert.deepEqual(filasConLinks("<p>nada por aca</p>", COLS), []);
  assert.deepEqual(filasConLinks("", COLS), []);
});

test("una fila vacía no produce un objeto vacío", () => {
  const html = `<tr></tr><tr><td>01/03/2026</td><td>Algo</td></tr>`;
  assert.equal(filasConLinks(html, COLS).length, 1);
});
