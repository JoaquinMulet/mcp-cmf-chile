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
import { separarNotas } from "../src/client/parsers.js";

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

/**
 * Las notas al pie de la planilla NO son fondos.
 *
 * Las 5 planillas de fondos mutuos de la CMF terminan con sus llamadas al
 * pie, y `xlsAJson` las devuelve como filas más. Medido el 28 de agosto de
 * 2026: el boletín de Security de diciembre de 2025 trae 206 filas, y 14
 * son notas. Sin administradora trae 23 filas y 14 son notas, o sea más de
 * la mitad. Las otras planillas igual. costos 8 notas, comisiones 14,
 * antecedentes 2, inversiones 12.
 *
 * Hace 2 daños. El total miente sobre cuántas series hay, y quien suma la
 * columna de patrimonio suma texto.
 *
 * El criterio sale del dato real, no de una corazonada. Una fila de datos
 * del boletín trae 13 o 14 celdas con valor. Una nota trae exactamente 1,
 * y siempre en `col_0`. La separación mira cuántas celdas tienen valor, no
 * el texto de la fila, porque el texto de las notas cambia de planilla en
 * planilla y de mes en mes.
 */
/** Fila real del boletín de diciembre de 2025. */
const SERIE = {
  col_0: "SECURITY PLUS",
  RUN: "8253-8",
  "Tipo de fondo (2)": "1",
  Administradora: "ADMINISTRADORA GENERAL DE FONDOS SECURITY S.A.",
  "Serie de fondo": "A",
  Moneda: "PESOS",
  "Patrimonio (1)": "121,651.67",
  Participes: "7,877",
  "Valor cuota": "2,213.30",
};

/** Notas reales del pie de esa misma planilla. */
const NOTA_UNIDAD = { col_0: "(1) Cifras en millones de pesos o de la moneda que corresponda" };
const NOTA_TIPO = { col_0: "5: FM DE INVERSION EN INSTRUMENTOS DE CAPITALIZACION," };

test("las notas al pie no viajan como si fueran fondos", () => {
  const { datos, notas } = separarNotas([SERIE, NOTA_UNIDAD, NOTA_TIPO]);
  assert.equal(datos.length, 1, "una sola serie de verdad");
  assert.equal(datos[0].RUN, "8253-8");
  assert.deepEqual(notas, [NOTA_UNIDAD.col_0, NOTA_TIPO.col_0], "las notas salen aparte y con su texto");
});

test("una fila con 2 celdas con valor sigue siendo un dato", () => {
  // El riesgo del lado opuesto. Separar de más borra fondos reales, y esa
  // pérdida no se ve, porque el total baja sin decir por qué.
  const casiVacia = { col_0: "FONDO CHICO", RUN: "9999-9", Moneda: "", Participes: "" };
  const { datos, notas } = separarNotas([casiVacia]);
  assert.equal(datos.length, 1, "2 celdas con valor bastan para ser un fondo");
  assert.deepEqual(notas, []);
});

test("una fila entera vacía no es un dato ni una nota", () => {
  const { datos, notas } = separarNotas([{ col_0: "", RUN: "" }, SERIE]);
  assert.equal(datos.length, 1);
  assert.deepEqual(notas, [], "una nota sin texto no es una nota");
});

test("sin notas al pie la lista de datos queda intacta", () => {
  const { datos, notas } = separarNotas([SERIE, SERIE]);
  assert.equal(datos.length, 2);
  assert.deepEqual(notas, []);
});
