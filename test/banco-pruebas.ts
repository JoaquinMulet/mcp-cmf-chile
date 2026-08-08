/**
 * Banco de pruebas de cmf_empresa_eeff — emisores elegidos a propósito:
 *   - Aguas Andinas (61808000): balance sano, PDF de tamaño medio
 *   - Falabella (90749000): holding con banco consolidado (identidades distintas)
 *   - CCU (90413000): PDF grande (5+ MB, 140+ páginas) → debe dar el error didáctico
 *   - Cencosud (93834000): muchos conceptos fusionados (pendientes altos)
 *   - Assurant (76212519): aseguradora (formato de EEFF distinto al IFRS corporativo)
 *
 * Uso: npx tsx test/banco-pruebas.ts [--solo=<rut>]
 */
import { createServer } from "../src/server.js";
import { cargarPdfModuleDesdeDisco } from "../src/pdf.js";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { fetchCmfBinario } from "../src/client/cmf-client.js";

const EMISORES = [
  { rut: "61808000", label: "Aguas Andinas (sano)" },
  { rut: "90749000", label: "Falabella (banco consolidado)" },
  { rut: "90413000", label: "CCU (PDF grande)" },
  { rut: "93834000", label: "Cencosud (fusiones)" },
  { rut: "76212519", label: "Assurant (aseguradora)" },
];

async function main() {
  const solo = process.argv.find((a) => a.startsWith("--solo="))?.split("=")[1];
  const pdfModule = await cargarPdfModuleDesdeDisco();
  const handler = createMcpHandler(() => createServer({ __pdfModule: pdfModule }));
  const transport = new StreamableHTTPClientTransport("http://localhost/mcp", {
    fetch: (u, i) => handler.fetch(new Request(u, i)),
  });
  const client = new Client({ name: "banco", version: "1" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);

  for (const e of EMISORES) {
    if (solo && e.rut !== solo) continue;
    console.log(`\n=== ${e.label} (${e.rut}) ===`);
    try {
      const docs = await client.callTool({
        name: "cmf_empresa_eeff",
        arguments: { rut: e.rut, anio: "2026", mes: "03", tipo: "C", modo: "documentos" },
      });
      const docPdf = (docs.structuredContent?.documentos ?? []).find((d: { nombre: string }) =>
        /estados financieros/i.test(d.nombre) && !/xbrl/i.test(d.nombre),
      );
      if (!docPdf) {
        console.log("  documentos: OK (sin PDF principal en el listado)", docs.isError ? "ERROR" : "");
        continue;
      }
      let bytes = 0;
      try {
        const b = await fetchCmfBinario(docPdf.url, {});
        bytes = b.bytes.length;
      } catch (err) {
        console.log("  (no pude medir el PDF:", String((err as Error).message).slice(0, 120), ")");
      }
      console.log(`  pdf: ${(bytes / 1048576).toFixed(1)} MB`);

      const md = await client.callTool({
        name: "cmf_empresa_eeff",
        arguments: { rut: e.rut, anio: "2026", mes: "03", tipo: "C", norma: "IFRS", modo: "markdown", max_chars: 1000, validar_contable: true },
      });
      const sc = md.structuredContent ?? {};
      if (md.isError) {
        console.log("  markdown: ERROR →", String(md.content?.[0]?.text ?? "").replace(/\n/g, " ").slice(0, 300));
        continue;
      }
      const v = sc.verificacion_contable;
      const txt = String(md.content?.[0]?.text ?? "");
      const idx = txt.indexOf("Verificación contable");
      console.log(
        `  markdown: separadas=${sc.filas_separadas} pendientes=${sc.filas_fusionadas_pendientes} | ` +
          `activos=${v?.activos?.estado} balance=${v?.balance?.estado} patrimonio=${v?.patrimonio?.estado}`,
      );
      if (idx >= 0) console.log("  " + txt.slice(idx, idx + 280).replace(/\n/g, " "));
    } catch (err) {
      console.log("  FALLO de la llamada:", String((err as Error).message).slice(0, 300));
    }
  }
  await client.close();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
