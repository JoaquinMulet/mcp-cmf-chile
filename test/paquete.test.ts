import { test } from "node:test";
import assert from "node:assert/strict";
import {
  carpetaEmpresa,
  extensionDeContentType,
  nombreArchivoSeguro,
  rutaUnica,
  tipoDocumento,
} from "../src/util/nombres.js";
import { construirZip, crc32, zipABase64 } from "../src/util/zip.js";
import { barrerPeriodos, conSemafotoGlobal } from "../src/util/paquete.js";

test("nombres: normalización y tipos de documento", () => {
  assert.equal(nombreArchivoSeguro("Análisis de Resultados 2025"), "Analisis_de_Resultados_2025");
  assert.equal(tipoDocumento("Estados Financieros Consolidados 202512.pdf"), "eeff");
  assert.equal(tipoDocumento("XBRL 202512.zip"), "eeff_xbrl");
  assert.equal(tipoDocumento("Análisis Razonado 2025.pdf"), "analisis_razonado");
  assert.equal(tipoDocumento("Declaración de Responsabilidad.pdf"), "declaracion_responsabilidad");
  assert.equal(tipoDocumento("Hechos Relevantes.pdf"), "hechos_relevantes");
});

test("nombres: carpeta de empresa y dedupe", () => {
  assert.equal(carpetaEmpresa("COPEC", "90690000", "EMPRESAS COPEC S.A."), "COPEC_90690000");
  assert.equal(carpetaEmpresa("", "90690000", "EMPRESAS COPEC S.A."), "EMPRESAS_COPEC_S.A._90690000");
  const usadas = new Set<string>();
  assert.equal(rutaUnica("eeff/202512/eeff_202512.pdf", usadas), "eeff/202512/eeff_202512.pdf");
  assert.equal(rutaUnica("eeff/202512/eeff_202512.pdf", usadas), "eeff/202512/eeff_202512_2.pdf");
  assert.equal(extensionDeContentType("application/pdf"), ".pdf");
  assert.equal(extensionDeContentType("application/zip"), ".zip");
});

test("zip: construye un ZIP store válido con CRC32", () => {
  const bytes = new TextEncoder().encode("hola mundo");
  const zip = construirZip([
    { ruta: "empresa_123/eeff/202512/eeff_202512.pdf", bytes },
    { ruta: "empresa_123/manifiesto.json", bytes: new TextEncoder().encode("{}") },
  ]);
  // Magic del ZIP: PK\x03\x04
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  assert.equal(zip[2], 0x03);
  assert.equal(zip[3], 0x04);
  // CRC correcto para "hola mundo"
  assert.equal(crc32(bytes), 0xacdf4206);
  // base64 decodifica de vuelta al mismo tamaño
  const b64 = zipABase64(zip);
  assert.equal(atob(b64).length, zip.length);
});

test("barrerPeriodos: fallos parciales se reportan y no detienen el resto", async () => {
  const { ok, fallidos } = await barrerPeriodos(
    [
      { clave: "a", tarea: async () => 1 },
      { clave: "b", tarea: async () => Promise.reject(new Error("anti_bot")) },
      { clave: "c", tarea: async () => 3 },
    ],
    2,
  );
  assert.deepEqual(ok, [1, 3]);
  assert.equal(fallidos.length, 1);
  assert.equal(fallidos[0].clave, "b");
  assert.match(fallidos[0].motivo, /anti_bot/);
});

test("conSemafotoGlobal: serializa jobs pesados", async () => {
  let activos = 0;
  let max = 0;
  const job = async () => {
    activos++;
    max = Math.max(max, activos);
    await new Promise((r) => setTimeout(r, 30));
    activos--;
  };
  await Promise.all([conSemafotoGlobal(job), conSemafotoGlobal(job), conSemafotoGlobal(job)]);
  assert.equal(max, 1, "solo un job pesado a la vez");
});
