import { test } from "node:test";
import assert from "node:assert/strict";
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

test("parser: filas sin enlaces tienen url vacía, no url inventada", () => {
  const filas = htmlTablaAJson(`<table><tr><td>A</td></tr><tr><td>B</td></tr></table>`);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].A, "B");
  assert.equal(filas[0].url, "", "url vacía y nada más");
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
