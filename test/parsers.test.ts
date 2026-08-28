import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { htmlTablaAJson, xlsAJson } from "../src/client/parsers.js";
import * as XLSX from "xlsx";
import { getLegacyBinario, postLegacyBinario } from "../src/client/cmf-client.js";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

const ENV_LENTO = { CMF_RATE_LIMIT_MS: "0" };

/** Mockea global fetch devolviendo siempre el mismo body; restaura al final. */
function conFetchMock(body: string | Uint8Array): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(body, { status: 200, headers: { "Content-Type": "text/html" } })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function clienteConectado() {
  const server = createServer(ENV_LENTO);
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" }, {});
  await client.connect(clientT);
  return { client };
}

test("parser: celda con <a href> conserva el href en el campo url (no se borra al limpiar etiquetas)", () => {
  const html = `<table>
    <tr><td>01/01/2024</td><td><a href="/sitio/aplic/serdoc/ver_sgd.php?s567=abcd1234">Descargar</a></td></tr>
  </table>`;
  const filas = htmlTablaAJson(html, ["fecha", "documento"]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].fecha, "01/01/2024");
  assert.equal(filas[0].documento, "Descargar");
  assert.equal(filas[0].url, "https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=abcd1234");
});

test("parser: una tabla sin ningún enlace no trae la clave url", () => {
  // Antes la clave existía siempre, con cadena vacía. Como el texto para el
  // modelo dibuja todas las columnas de la fila, eso pintaba una columna
  // `url` vacía en las 1228 filas del reporte de bancos. Una columna que
  // nunca va a tener valor no es un dato, es ruido.
  const filas = htmlTablaAJson(`<table><tr><td>A</td></tr><tr><td>B</td></tr></table>`);
  assert.equal(filas.length, 1, "sin th, la primera fila sigue definiendo las columnas");
  assert.equal(filas[0].A, "B");
  assert.ok(!("url" in filas[0]), "sin enlaces en la tabla, la clave url no se inventa");
});

test("parser: la fila de encabezado (th) nunca es dato, ni con columnas explícitas", () => {
  const html = `<table>
    <tr><th>Fecha - Hora</th><th>Número de Documento</th></tr>
    <tr><td>02/01/2024</td><td><a href="/sitio/aplic/serdoc/ver_sgd.php?s567=AAA">111</a></td></tr>
    <tr><td>03/01/2024</td><td><a href="/sitio/aplic/serdoc/ver_sgd.php?s567=BBB">222</a></td></tr>
  </table>`;
  const filas = htmlTablaAJson(html, ["fecha_hora", "numero", "url"]);
  assert.equal(filas.length, 2, "el encabezado no es una fila de datos");
  assert.equal(filas[0].fecha_hora, "02/01/2024");
  assert.ok(filas[0].url.includes("AAA"), `url fila 1: ${filas[0].url}`);
  assert.ok(filas[1].url.includes("BBB"), `url fila 2: ${filas[1].url}`);
  assert.notEqual(filas[0].url, filas[1].url, "cada fila su propio enlace");
});

test("hechos: la url viene de la fila real de la tabla, no del primer enlace del documento", async () => {
  const html = `<html><body>
    <table>
      <tr>
        <td>02/01/2024 10:30</td>
        <td><a href="/sitio/aplic/serdoc/ver_sgd.php?s567=1111111111111111">111-2024</a></td>
        <td>EMPRESA A</td><td>Materia A</td>
      </tr>
      <tr>
        <td>03/01/2024 11:00</td>
        <td><a href="/sitio/aplic/serdoc/ver_sgd.php?s567=2222222222222222">222-2024</a></td>
        <td>EMPRESA B</td><td>Materia B</td>
      </tr>
      <tr>
        <td>04/01/2024 09:15</td>
        <td><a href="/sitio/aplic/serdoc/ver_sgd.php?s567=3333333333333333">333-2024</a></td>
        <td>EMPRESA C</td><td>Materia C</td>
      </tr>
    </table>
  </body></html>`;
  const restaurar = conFetchMock(html);
  try {
    const { client } = await clienteConectado();
    const res = await client.callTool({
      name: "cmf_empresa_hechos",
      arguments: { rut: "96553640", desde: "2024-01-01", hasta: "2024-01-31" },
    });
    assert.ok(!res.isError, "la tool no debe fallar");
    const sc = (res as { structuredContent?: { hechos?: Record<string, string>[] } }).structuredContent;
    assert.ok(sc && sc.hechos, "structuredContent.hechos debe estar presente");
    assert.ok(sc.hechos.length >= 3, `esperadas >= 3 filas, hay ${sc.hechos.length}`);
    assert.equal(sc.hechos[0].url, "https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=1111111111111111");
    assert.equal(sc.hechos[1].url, "https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=2222222222222222");
    assert.equal(sc.hechos[2].url, "https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=3333333333333333");
  } finally {
    restaurar();
  }
});

test("hechos: si hay menos enlaces que filas, las filas restantes quedan con url vacía", async () => {
  const html = `<table>
    <tr><td>02/01/2024 10:30</td><td><a href="/sitio/aplic/serdoc/ver_sgd.php?s567=1111111111111111">111-2024</a></td><td>EMPRESA A</td><td>Materia A</td></tr>
    <tr><td>03/01/2024 11:00</td><td>222-2024</td><td>EMPRESA B</td><td>Materia B</td></tr>
  </table>`;
  const restaurar = conFetchMock(html);
  try {
    const { client } = await clienteConectado();
    const res = await client.callTool({
      name: "cmf_empresa_hechos",
      arguments: { rut: "96553640", desde: "2024-01-01", hasta: "2024-01-31" },
    });
    const sc = (res as { structuredContent?: { hechos?: Record<string, string>[] } }).structuredContent;
    assert.ok(sc && sc.hechos, "structuredContent.hechos debe estar presente");
    assert.equal(sc.hechos[0].url, "https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=1111111111111111");
    assert.equal(sc.hechos[1].url, "", "fila sin enlace disponible debe quedar con url vacía");
  } finally {
    restaurar();
  }
});

test("xls: los helpers binarios devuelven los bytes crudos sin pasar por TextEncoder", async () => {
  const binario = new Uint8Array([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x08, 0xff, 0xfe, 0x80, 0x81, 0xc3, 0x96,
  ]);
  const restaurar = conFetchMock(binario);
  try {
    const bytes = await getLegacyBinario("/institucional/estadisticas/fm.fm_bpr.php", { anio: "2024" }, ENV_LENTO);
    assert.deepEqual([...bytes], [...binario], "GET binario debe preservar bytes >127");
    const bytesPost = await postLegacyBinario(
      "/institucional/estadisticas/fmdfm_excel2.php",
      { admins: "0", anno2: "2024" },
      ENV_LENTO,
    );
    assert.deepEqual([...bytesPost], [...binario], "POST binario debe preservar bytes >127");
  } finally {
    restaurar();
  }
});

test("xls: preámbulo se salta y el header real define las claves", () => {
  const aoa = [
    ["COMISIÓN PARA EL MERCADO FINANCIERO"],
    ["Informe de Patrimonio, Rentabilidad, Partícipes y Valor de la Cuota"],
    ["Administradora : TODAS"],
    ["Fecha : MARZO 2026"],
    [],
    ["", "RUN", "Nombre Fondo", "Patrimonio", "Partícipes"],
    ["", "12345-6", "Fondo Test A", "1.234.567", "12"],
    ["", "76543-2", "Fondo Test B", "9.876.543", "34"],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "BPR");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const filas = xlsAJson(bytes);
  assert.equal(filas.length, 2, "solo los datos, sin preámbulo");
  assert.equal(filas[0]["RUN"], "12345-6", `clave RUN: ${JSON.stringify(filas[0])}`);
  assert.equal(filas[0]["Nombre Fondo"], "Fondo Test A");
  assert.equal(filas[1]["Patrimonio"], "9.876.543");
  assert.ok(!Object.keys(filas[0]).some((k) => k.startsWith("__EMPTY") || k.includes("COMISIÓN")), "sin claves del preámbulo");
});

test("xls: archivo que ya empieza con header sigue funcionando", () => {
  const aoa = [
    ["Periodo", "Administradora", "Nombre Fondo"],
    [20260331, "Adm. Test", "Fondo X"],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "S1");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const filas = xlsAJson(bytes);
  assert.equal(filas.length, 1);
  assert.equal(filas[0]["Administradora"], "Adm. Test");
});

test("xls: mojibake en celdas se corrige", () => {
  const aoa = [
    ["RUN", "Nombre Fondo"],
    ["1", "COMISIÃN DE TEST"],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "S1");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const filas = xlsAJson(bytes);
  assert.equal(filas[0]["Nombre Fondo"], "COMISIÓN DE TEST");
});

/**
 * La cabecera <th> de la tabla se usa como nombre de las columnas.
 *
 * El defecto, medido el 28 de agosto de 2026 con el reporte MR1 de Banco de
 * Chile de junio de 2026. `htmlTablaAJson` buscaba la primera fila que NO
 * fuera cabecera y la usaba como definición de columnas. La tabla del
 * servlet BaseDato SÍ marca su cabecera con th, así que la función se
 * saltaba «Código Contable | Descripción | Total Monedas», bautizaba las
 * columnas con la primera fila de datos, y esa fila desaparecía.
 *
 * El resultado. las 1228 filas quedaban con nombres de campo que cambian en
 * cada llamada, un dato real se perdía, y el modelo leía como encabezado la
 * línea «411000000 | INGRESOS POR INTERESES | 1.376.398.163.187».
 *
 * El fixture es HTML real de la CMF, recortado a su cabecera y 5 filas, con
 * el marcado exacto.
 */
const HTML_BASEDATO = readFileSync(join(import.meta.dirname, "fixtures", "basedato-mr1-2026-06.html"), "utf8");

test("parser: la cabecera th da los nombres de columna, no la primera fila de datos", () => {
  const filas = htmlTablaAJson(HTML_BASEDATO);
  assert.deepEqual(
    Object.keys(filas[0]),
    ["Código Contable", "Descripción", "Total Monedas"],
    "los nombres salen de la cabecera real de la CMF",
  );
});

test("parser: la primera fila de datos NO se pierde cuando hay cabecera th", () => {
  const filas = htmlTablaAJson(HTML_BASEDATO);
  assert.equal(filas.length, 5, "las 5 filas de datos del fixture, ninguna comida");
  assert.equal(filas[0]["Código Contable"], "411000000");
  assert.equal(filas[0]["Descripción"], "INGRESOS POR INTERESES");
  assert.equal(filas[0]["Total Monedas"], "1.376.398.163.187");
});

test("parser: el reporte de bancos no trae una columna url vacía", () => {
  const filas = htmlTablaAJson(HTML_BASEDATO);
  for (const f of filas) assert.ok(!("url" in f), "ninguna fila de este reporte tiene enlace");
});

test("parser: sin cabecera th se conserva el comportamiento de siempre", () => {
  // Casi todas las tablas de la CMF vienen sin th, y ahí la primera fila SÍ
  // es la cabecera. Cambiar eso habría roto unas 40 tools de una vez.
  const html = `<table>
    <tr><td>Fecha</td><td>Materia</td></tr>
    <tr><td>02/01/2024</td><td>Citación a junta</td></tr>
  </table>`;
  const filas = htmlTablaAJson(html);
  assert.equal(filas.length, 1);
  assert.deepEqual(Object.keys(filas[0]), ["Fecha", "Materia"]);
  assert.equal(filas[0].Fecha, "02/01/2024");
});

test("parser: con cabecera th y enlaces, la url sigue viajando fila por fila", () => {
  // El lado opuesto del arreglo de la url. Donde SÍ hay documentos, el
  // enlace es el único camino del agente hacia el PDF y no se puede perder.
  const html = `<table>
    <tr><th>Fecha</th><th>Documento</th></tr>
    <tr><td>02/01/2024</td><td><a href="/sitio/x.php?s567=AAA">Ver</a></td></tr>
    <tr><td>03/01/2024</td><td>sin documento</td></tr>
  </table>`;
  const filas = htmlTablaAJson(html);
  assert.equal(filas.length, 2);
  assert.deepEqual(Object.keys(filas[0]), ["Fecha", "Documento", "url"]);
  assert.ok(filas[0].url.includes("AAA"));
  assert.equal(filas[1].url, "", "la fila sin documento conserva la columna, vacía");
});

/**
 * Una cabecera de 2 pisos deja columnas sin nombre.
 *
 * El cuadro de costos de la CMF trae su cabecera en 2 filas. La de arriba
 * agrupa y la de abajo detalla, como una planilla con celdas combinadas.
 * `xlsAJson` usaba solo la de arriba y descartaba la de abajo, así que las
 * columnas cuya celda de arriba viene vacía se quedaban sin nombre y salían
 * como `col_8`, `col_15` y `col_17`.
 *
 * La peor es `col_17`. lleva la comisión que te cobran si rescatas antes de
 * tiempo, y llegaba como un 1.19 suelto al lado de una columna que dice
 * «0 a 180». Sin nombre no se puede saber si ese número es un porcentaje, un
 * monto o un plazo.
 *
 * Y unir los 2 pisos arregla además una etiqueta que MENTÍA. la columna 14
 * se llamaba «Comisión de Colocación» y su valor es «0 a 180», que es la
 * condición, no la comisión. Su piso de abajo dice «Condición».
 *
 * Las 2 filas de abajo son la cabecera REAL del cuadro de costos de
 * diciembre de 2025, copiadas del Excel de la CMF.
 */
const CABECERA_COSTOS = [
  ["Cuadro estadístico de Costos"],
  [],
  ["Periodo", "Administradora", "Nombre Fondo", "Tipo Fondo", "Moneda", "Serie", "Caract.", "Remuneración", "", "Gastos OP.", "TAC Rem. Fija", "TAC Rem. Var.", "TAC Gastos Op.", "TAC Total", "Comisión de Colocación", "", "Comisión de Colocación Dif", ""],
  ["", "", "", "", "", "", "", "Rem. Fija", "Rem. Var.", "", "%", "%", "%", "%", "Condición", "Comisión", "Condición", "Comisión"],
  ["20251231", "Administradora General De Fondos Security S.A.", "Fondo Mutuo Fondo Activo 2", "6", "PESOS", "B", "Serie para constituir planes", "Hasta un 2,000 % anual", "NA", "2,5", "1.99", "NA", "0.18", "2.17", "NA", "NA", "0 a 180", "2.38%"],
];

function comoExcel(aoa: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Costos");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

test("xls: la cabecera de 2 pisos no deja ninguna columna sin nombre", () => {
  const [fila] = xlsAJson(comoExcel(CABECERA_COSTOS));
  const sinNombre = Object.keys(fila).filter((k) => /^col_\d+$/.test(k));
  assert.deepEqual(sinNombre, [], `estas columnas quedaron sin nombre: ${sinNombre.join(", ")}`);
});

test("xls: la comisión por rescate anticipado llega con su nombre", () => {
  const [fila] = xlsAJson(comoExcel(CABECERA_COSTOS));
  assert.equal(fila["Comisión de Colocación Dif Comisión"], "2.38%", "era col_17");
  assert.equal(fila["Comisión de Colocación Dif Condición"], "0 a 180", "y su condición al lado");
});

test("xls: los 2 pisos se unen y la etiqueta deja de mentir", () => {
  const [fila] = xlsAJson(comoExcel(CABECERA_COSTOS));
  assert.equal(fila["Remuneración Rem. Fija"], "Hasta un 2,000 % anual");
  assert.equal(fila["Remuneración Rem. Var."], "NA", "era col_8");
  assert.equal(fila["TAC Total %"], "2.17", "el piso de abajo dice que es un porcentaje");
});

test("xls: una cabecera de 1 solo piso queda exactamente igual", () => {
  // El lado opuesto. Casi todas las planillas de la CMF tienen 1 piso, y
  // cambiarles los nombres habría roto varias tools de una vez.
  const unPiso = [
    ["Informe"],
    [],
    ["RUN", "Nombre Fondo", "Patrimonio", "Partícipes"],
    ["12345-6", "Fondo Test A", "1.234.567", "12"],
  ];
  const [fila] = xlsAJson(comoExcel(unPiso));
  assert.deepEqual(Object.keys(fila), ["RUN", "Nombre Fondo", "Patrimonio", "Partícipes"]);
});
