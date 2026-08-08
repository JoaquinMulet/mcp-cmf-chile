import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

async function main() {
  const srv = createServer({});
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await srv.connect(st);
  const client = new Client({ name: "verify", version: "1" }, {});
  await client.connect(ct);
  const t = await client.listTools();
  console.log("TOOLS TOTALES:", t.tools.length);
  const grupos: Record<string, number> = {};
  for (const tool of t.tools) {
    const g = tool.name.replace(/^cmf_/, "").split("_")[0];
    grupos[g] = (grupos[g] ?? 0) + 1;
  }
  console.log("POR GRUPO:", JSON.stringify(grupos));
  await client.close();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
