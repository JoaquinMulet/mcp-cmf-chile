/**
 * El catálogo de fondos mutuos, contra filas REALES de la CMF.
 *
 * Los 2 defectos que estas comprobaciones existen para cerrar, medidos el
 * 28 de agosto de 2026 contra el servidor desplegado.
 *
 * 1. El archivo `fm_ident2.php` de la CMF repite sus filas. Trae 3421 y
 *    solo 1350 son distintas: 741 vienen 3 veces y 589 vienen 2 veces. El
 *    servidor las pasaba tal cual, así que `total` decía 3421 y quien
 *    contaba fondos contaba mal por un factor cercano a 2,5.
 *
 * 2. El filtro por tipo comparaba el campo `tipo_fondo`, que no existe. El
 *    parser normaliza la columna «Tipo de Fondo Mutuo» a
 *    `tipo_de_fondo_mutuo`, así que `String(f.tipo_fondo ?? "")` daba
 *    siempre la cadena vacía y el filtro devolvía 0 fondos para cualquier
 *    tipo. Pedir tipo 5 sobre el catálogo entero devolvía `total: 0`.
 *
 * Los 2 fallan en silencio. El servidor responde 200, el JSON tiene forma
 * correcta, y nada avisa. Por eso las filas de abajo son reales, copiadas
 * de una descarga de la CMF, con los nombres de campo que produce
 * `txtCsvAJson`. Un fixture inventado habría heredado el mismo error de
 * memoria que causó el defecto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sinRepetidas, filtrarCatalogo } from "../src/tools/fondos-mutuos.js";

/** Fila real de la descarga del 28 de agosto de 2026. Tipo 6. */
const DIVERSIFICACION = {
  rut_administradora: "96639280",
  raz_social_administradora: "ADMINISTRADORA GENERAL DE FONDOS  SECURITY S.A.",
  run_fondo: "8298",
  nombre_fondo: "FONDO MUTUO SECURITY DIVERSIFICACION",
  nombre_corto: "DIVERSIFICACION",
  fecha_res_aprobacion_del_ri: "07/05/2004",
  nro_res_aprobacion_del_ri: "236",
  tipo_de_fondo_mutuo: "6",
  fecha_inicio_operaciones: "31/05/2004",
  fecha_termino_operaciones: "02/10/2015",
  moneda: "$$",
};

/** Fila real de la misma descarga. Tipo 5. */
const GLOBAL_INVESTMENT = {
  rut_administradora: "96639280",
  raz_social_administradora: "ADMINISTRADORA GENERAL DE FONDOS  SECURITY S.A.",
  run_fondo: "8095",
  nombre_fondo: "FONDO MUTUO SECURITY GLOBAL INVESTMENT",
  nombre_corto: "GLOBAL INVESTMENT",
  fecha_res_aprobacion_del_ri: "01/10/1996",
  nro_res_aprobacion_del_ri: "235",
  tipo_de_fondo_mutuo: "5",
  fecha_inicio_operaciones: "29/10/1996",
  fecha_termino_operaciones: "21/02/2005",
  moneda: "PROM",
};

test("el catálogo no entrega la misma fila 3 veces", () => {
  const crudo = [DIVERSIFICACION, DIVERSIFICACION, DIVERSIFICACION, GLOBAL_INVESTMENT, GLOBAL_INVESTMENT];
  const limpio = sinRepetidas(crudo);
  assert.equal(limpio.length, 2, "2 fondos distintos, aunque la CMF los mande 5 veces");
  assert.deepEqual(
    limpio.map((f) => f.run_fondo),
    ["8298", "8095"],
    "se conserva la primera aparición y el orden de la fuente",
  );
});

test("2 fondos distintos nunca se colapsan en uno", () => {
  // El riesgo del lado opuesto. Deduplicar de más borra datos reales, y
  // eso es peor que repetirlos, porque el faltante no se ve.
  const otroFondo = { ...DIVERSIFICACION, run_fondo: "9999", nombre_fondo: "OTRO FONDO" };
  assert.equal(sinRepetidas([DIVERSIFICACION, otroFondo]).length, 2);
});

test("el filtro por tipo encuentra los fondos de ese tipo", () => {
  const filas = [DIVERSIFICACION, GLOBAL_INVESTMENT];
  const tipo5 = filtrarCatalogo(filas, { tipo: "5" });
  assert.equal(tipo5.length, 1, "un fondo es tipo 5");
  assert.equal(tipo5[0].run_fondo, "8095");
});

test("el filtro por tipo distingue el tipo 5 del tipo 6", () => {
  const filas = [DIVERSIFICACION, GLOBAL_INVESTMENT];
  assert.equal(filtrarCatalogo(filas, { tipo: "6" })[0].run_fondo, "8298");
  assert.equal(filtrarCatalogo(filas, { tipo: "1" }).length, 0, "nadie es tipo 1");
});

test("el filtro por nombre no distingue tildes ni mayúsculas", () => {
  const filas = [DIVERSIFICACION, GLOBAL_INVESTMENT];
  assert.equal(filtrarCatalogo(filas, { nombre: "diversificacion" }).length, 1);
  assert.equal(filtrarCatalogo(filas, { nombre: "global" })[0].run_fondo, "8095");
});

test("sin filtros el catálogo sale entero", () => {
  const filas = [DIVERSIFICACION, GLOBAL_INVESTMENT];
  assert.equal(filtrarCatalogo(filas, {}).length, 2);
});
