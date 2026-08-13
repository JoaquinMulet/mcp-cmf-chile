/**
 * Genera docs/catalogo-agentes.md: exactamente lo que un agente recibe del MCP
 * (instructions + tools + prompts + resource templates), en texto plano.
 * Uso: npx tsx test/dump-catalogo.ts
 */
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { writeFileSync } from "node:fs";

const server = createServer({});
const [serverT, clientT] = InMemoryTransport.createLinkedPair();
await server.connect(serverT);
const client = new Client({ name: "dump", version: "1" }, {});
await client.connect(clientT);

const lines: string[] = [];
lines.push("# Catálogo del MCP mcp-cmf-chile (lo que ve el agente)");
lines.push("");
lines.push(`- serverInfo: ${JSON.stringify(client.getServerVersion())}`);
lines.push("");
lines.push("## INSTRUCTIONS (InitializeResult.instructions)");
lines.push("");
lines.push("```");
lines.push(client.getInstructions() ?? "");
lines.push("```");

const tools = (await client.listTools()).tools;
lines.push("");
lines.push(`## TOOLS (${tools.length})`);
for (const t of tools) {
  lines.push("");
  lines.push(`### ${t.name}`);
  if (t.title) lines.push(`- title: ${t.title}`);
  lines.push(`- description: ${t.description}`);
  const props = (t.inputSchema as any)?.properties ?? {};
  const required = (t.inputSchema as any)?.required ?? [];
  if (Object.keys(props).length) {
    lines.push("- parámetros:");
    for (const [k, s] of Object.entries(props as Record<string, any>)) {
      const req = required.includes(k) ? " (REQUERIDO)" : "";
      const extra = s.enum ? ` enum=[${s.enum.join("|")}]` : s.default !== undefined ? ` default=${JSON.stringify(s.default)}` : "";
      lines.push(`  - ${k}${req}${extra}: ${s.description ?? ""}`);
    }
  } else {
    lines.push("- parámetros: ninguno");
  }
  lines.push(`- annotations: ${JSON.stringify(t.annotations ?? null)}`);
  if (t.outputSchema) {
    const outKeys = Object.keys((t.outputSchema as any)?.properties ?? {});
    lines.push(`- outputSchema: ${outKeys.length ? `{${outKeys.join(", ")}}` : JSON.stringify(t.outputSchema)}`);
  }
}

const prompts = (await client.listPrompts()).prompts;
lines.push("");
lines.push(`## PROMPTS (${prompts.length})`);
const argsDePrompt: Record<string, Record<string, unknown>> = {
  cmf_analizar_empresa: { rut: "90690000" },
  cmf_comparar_fondos: { anio: "2026", mes: "01" },
  cmf_indicadores_economicos: { anio: "2026", mes: "01" },
};
for (const p of prompts) {
  const full = await client.getPrompt({ name: p.name, arguments: argsDePrompt[p.name] ?? {} });
  lines.push("");
  lines.push(`### ${p.name} — ${p.description ?? ""}`);
  lines.push("```");
  for (const m of full.messages) {
    if (m.content.type === "text") lines.push(m.content.text);
  }
  lines.push("```");
}

const tpls = (await client.listResourceTemplates()).resourceTemplates;
lines.push("");
lines.push("## RESOURCE TEMPLATES");
for (const r of tpls) {
  lines.push(`- ${r.uriTemplate}: ${r.description ?? ""}`);
}

const recs = (await client.listResources()).resources;
lines.push("");
lines.push("## RESOURCES ESTÁTICOS");
for (const r of recs) {
  lines.push(`- ${r.uri}: ${r.description ?? ""}`);
}
lines.push("");
lines.push("> Nota: este catálogo se genera con argumentos de ejemplo para los prompts (npx tsx test/dump-catalogo.ts). Los placeholders reales son los argsSchema de cada prompt.");

writeFileSync(new URL("../docs/catalogo-agentes.md", import.meta.url), lines.join("\n") + "\n", "utf8");
console.log(`Escrito docs/catalogo-agentes.md (${lines.length} líneas, ${tools.length} tools, ${prompts.length} prompts)`);
await client.close();
