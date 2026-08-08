import { test } from "node:test";
import assert from "node:assert/strict";
import { procesarTablasEEFF, textoVerificacion } from "../src/eeff-tables.js";

const BALANCE_FUSIONADO = `# Aguas Andinas

| Total de activos corrientes, Total de activos no corrientes | 1.234.567 | 8.765.433 | 1.100.000 | 8.900.000 |
| Total de activos | 10.000.000 |
| Total de pasivos corrientes, Total de pasivos no corrientes | 3.000.000 | 4.000.000 | 2.900.000 | 4.100.000 |
| Total de pasivos | 7.000.000 |
| Patrimonio atribuible a los propietarios de la controladora, Participaciones no controladoras | 2.800.000 | 200.000 | 2.700.000 | 100.000 |
| Patrimonio total | 3.000.000 |
| Total de pasivos y patrimonio | 10.000.000 |`;

test("des-fusión: N conceptos + N cifras se parten en orden", () => {
  const r = procesarTablasEEFF(BALANCE_FUSIONADO);
  assert.ok(r.filasSeparadas >= 3, `separadas: ${r.filasSeparadas}`);
  assert.equal(r.filasFusionadasPendientes, 0, "ninguna pendiente");
  // La fila fusionada de activos queda en dos filas ordenadas
  assert.match(r.markdown, /\| Total de activos corrientes \| 1.234.567 \| 1.100.000 \|/);
  assert.match(r.markdown, /\| Total de activos no corrientes \| 8.765.433 \| 8.900.000 \|/);
  assert.match(r.markdown, /\| Patrimonio atribuible a los propietarios de la controladora \| 2.800.000 \| 2.700.000 \|/);
  assert.match(r.markdown, /\| Participaciones no controladoras \| 200.000 \| 100.000 \|/);
});

test("nota al pie por posición: se descarta, no se suma como cifra", () => {
  // "22" es el número de nota al pie; no debe entrar en la cuadratura
  const md = `# Balance\n\n| Total de activos | 22 | 10.000.000 |\n| Total de pasivos y patrimonio | 10.000.000 |\n| Patrimonio atribuible a los propietarios de la controladora, Participaciones no controladoras | 22 | 2.800.000 | 200.000 | 2.700.000 | 100.000 |\n| Patrimonio total | 3.000.000 |`;
  const r = procesarTablasEEFF(md);
  assert.equal(r.cuadratura?.patrimonio.ok, true, JSON.stringify(r.cuadratura?.patrimonio));
  assert.equal(r.cuadratura?.balance.ok, true, JSON.stringify(r.cuadratura?.balance));
  assert.match(r.markdown, /\| Total de activos \| 10.000.000 \|/);
});

test("TOTALES consecutivos: 'PATRIMONIO TOTAL DE PASIVOS Y PATRIMONIO' son 2 conceptos", () => {
  // 3 conceptos × 2 períodos agrupados (actuales primero) + nota "12" a la izquierda = 7 cifras
  const md = `# Balance\n\n| Participaciones no controladoras TOTAL DE PATRIMONIO TOTAL DE PASIVOS Y PATRIMONIO | 12 | 3.000.000 | 200.000 | 10.000.000 | 2.800.000 | 200.000 | 3.000.000 |`;
  const r = procesarTablasEEFF(md);
  assert.equal(r.filasSeparadas, 1, "la fila debe separarse");
  assert.equal(r.filasFusionadasPendientes, 0, "ninguna pendiente");
  assert.match(r.markdown, /\| Participaciones no controladoras \| 3.000.000 \| 2.800.000 \|/);
  assert.match(r.markdown, /\| TOTAL DE PATRIMONIO \| 200.000 \| 200.000 \|/);
  assert.match(r.markdown, /\| TOTAL DE PASIVOS Y PATRIMONIO \| 10.000.000 \| 3.000.000 \|/);
});

test("nombres propios no se parten: 'Franco Suizo' es un solo concepto", () => {
  const md = `# Balance\n\n| Franco Suizo | 1.000 | 900 |`;
  const r = procesarTablasEEFF(md);
  assert.equal(r.filasSeparadas, 0, "no es fusión");
  assert.match(r.markdown, /\| Franco Suizo \| 1.000 \| 900 \|/);
});

test("códigos cortos no se parten: 'Bonos UF' es un solo concepto", () => {
  const md = `# Balance\n\n| Bonos UF | 1.000 | 900 | 800 | 700 | 600 | 500 | 400 | 300 | 200 | 100 |`;
  const r = procesarTablasEEFF(md);
  assert.equal(r.filasSeparadas, 0, "no es fusión");
  assert.match(r.markdown, /\| Bonos UF \| 1.000 \| 900 \|/);
});

test("cuadratura: las tres identidades cuadran tras la des-fusión", () => {
  const r = procesarTablasEEFF(BALANCE_FUSIONADO);
  assert.ok(r.cuadratura, "debe haber cuadratura");
  assert.equal(r.cuadratura?.activos.ok, true, `activos: ${JSON.stringify(r.cuadratura?.activos)}`);
  assert.equal(r.cuadratura?.balance.ok, true, `balance: ${JSON.stringify(r.cuadratura?.balance)}`);
  assert.equal(r.cuadratura?.patrimonio.ok, true, `patrimonio: ${JSON.stringify(r.cuadratura?.patrimonio)}`);
  assert.match(textoVerificacion(r), /cuadra/);
});

test("no estado financiero: sin cuadratura ni aviso", () => {
  const r = procesarTablasEEFF("# Circular 21-11\n\n## Disposiciones generales\nEl artículo 66 quáter...");
  assert.equal(r.esEstadoFinanciero, false);
  assert.equal(r.cuadratura, null);
  assert.equal(textoVerificacion(r), "");
});

test("balance roto a propósito: la verificación lo detecta con la diferencia exacta", () => {
  const md = `# Balance\n\n| Total de activos | 10.000.000 |\n| Total de activos corrientes | 1.234.567 |\n| Total de activos no corrientes | 5.765.433 |\n| Total de pasivos y patrimonio | 9.000.000 |`;
  const r = procesarTablasEEFF(md);
  assert.equal(r.cuadratura?.activos.ok, false, `activos: ${JSON.stringify(r.cuadratura?.activos)}`);
  assert.equal(r.cuadratura?.activos.diferencia, 3_000_000);
  assert.equal(r.cuadratura?.balance.ok, false);
  assert.match(textoVerificacion(r), /NO cuadra/);
  assert.match(textoVerificacion(r), /3000000/);
});

test("verificación incompleta: dice qué fila falta en vez de 'no cuadra'", () => {
  const md = `# Balance\n\n| Total de activos | 10.000.000 |\n| Total de activos corrientes | 1.234.567 |\n| Total de activos no corrientes | 8.765.433 |`;
  const r = procesarTablasEEFF(md);
  assert.equal(r.cuadratura?.activos.ok, true);
  assert.equal(r.cuadratura?.balance.ok, false, "sin tpy no puede verificar");
  assert.equal(r.cuadratura?.balance.diferencia, null);
  assert.equal(r.cuadratura?.balance.estado, "no_verificado");
  assert.match(textoVerificacion(r), /incompleta/);
  assert.match(textoVerificacion(r), /total de pasivos y patrimonio/);
});

test("las 3 identidades no verificables: el texto habla, nunca calla", () => {
  // Cencosud: todos los totales viven en filas fusionadas → nada que verificar,
  // pero el modelo debe saberlo y hacer el trabajo él.
  const md = `# Balance\n\n| Total de activos corrientes, Total de activos no corrientes | 1.234.567 | 8.765.433 |\n| Otra fila | 1.000 |`;
  const r = procesarTablasEEFF(md);
  assert.equal(r.cuadratura?.activos.estado, "no_verificado");
  assert.equal(r.cuadratura?.balance.estado, "no_verificado");
  assert.equal(r.cuadratura?.patrimonio.estado, "no_verificado");
  const txt = textoVerificacion(r);
  assert.ok(txt.length > 0, "debe hablar justo en este caso");
  assert.match(txt, /no pude verificar ninguna/);
});

test("cifra con varios números en una celda se parte", () => {
  const md = `| Total de activos | 1.234.567 8.765.433 |`;
  const r = procesarTablasEEFF(md);
  assert.match(r.markdown, /\| Total de activos \| 1.234.567 \| 8.765.433 \|/);
});

test("números chilenos: puntos de miles y coma decimal", () => {
  const md = `| Efectivo | 1.234.567,89 |
| Total de pasivos y patrimonio | 1.234.567,89 |`;
  const r = procesarTablasEEFF(`# Balance\n\n${md}`);
  assert.ok(r.cuadratura, "debe reconocer como estado financiero");
});
