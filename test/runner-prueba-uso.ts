/**
 * Ejecuta las llamadas planeadas por agentes frescos (prueba de uso) contra el
 * servidor real (in-process, datos reales de la CMF) y emite un veredicto por tool.
 * Uso: npx tsx test/runner-prueba-uso.ts [--timeout-ms 120000]
 */
import { createServer } from "../src/server.js";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { readFileSync } from "node:fs";
import { cargarPdfModuleDesdeDisco } from "../src/pdf.js";

const pdfModule = await cargarPdfModuleDesdeDisco().catch(() => undefined);
const handler = createMcpHandler(() => createServer({ __pdfModule: pdfModule }));
// Transporte HTTP in-process: ejercita el MISMO camino del worker (headers, _meta, era moderna)
const transport = new StreamableHTTPClientTransport("http://localhost/mcp", {
  fetch: (u, i) => handler.fetch(new Request(u, i)),
});
const client = new Client({ name: "runner-prueba-uso", version: "1" }, {});
await client.connect(transport);

const archivos = ["test/prueba-uso-a.jsonl", "test/prueba-uso-b.jsonl", "test/prueba-uso-c.jsonl"];
const llamadas: any[] = [];
for (const f of archivos) {
  for (const linea of readFileSync(f, "utf8").split("\n")) {
    const t = linea.trim();
    if (!t) continue;
    llamadas.push(JSON.parse(t));
  }
}

let ok = 0, esperados = 0, fallos = 0, saltadas = 0;
const T0 = Date.now();
for (const l of llamadas) {
  if (l.skip) { saltadas++; console.log(`SKIP ${l.tool} (tarea ${l.tarea}): ${l.skip}`); continue; }
  const t0 = Date.now();
  try {
    const res = await client.callTool({ name: l.tool, arguments: l.args });
    const ms = Date.now() - t0;
    const texto = (res.content?.[0]?.text ?? "").replace(/\s+/g, " ").slice(0, 200);
    const esCaptcha = /captcha/i.test(texto) && res.isError;
    const esApiKey = /CMF_API_KEY no configurada/.test(texto);
    const esServicioCaido = /fuente de la CMF no devolvi[oó]|está caído o ya no se mantiene|demasiado amplia|excede el l[ií]mite/.test(texto);
    if (res.isError && (esCaptcha || esApiKey || esServicioCaido)) {
      esperados++;
      console.log(`ESPERADO ${l.tool} (t${l.tarea}, ${ms}ms): ${texto}`);
    } else if (res.isError) {
      fallos++;
      console.log(`FALLO ${l.tool} (t${l.tarea}, ${ms}ms): ${texto}`);
    } else {
      ok++;
      console.log(`OK ${l.tool} (t${l.tarea}, ${ms}ms): ${texto}`);
    }
  } catch (e) {
    fallos++;
    console.log(`FALLO ${l.tool} (t${l.tarea}): excepción ${(e as Error).message.slice(0, 140)}`);
  }
}
console.log(`\nTotal: ${llamadas.length} | OK ${ok} | errores esperados (captcha/api-key/servicio CMF) ${esperados} | saltadas ${saltadas} | FALLOS ${fallos} | ${((Date.now() - T0) / 1000).toFixed(0)}s`);
await client.close();
process.exit(fallos > 0 ? 1 : 0);
