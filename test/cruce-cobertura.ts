import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { readFileSync } from "node:fs";

const server = createServer({});
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const c = new Client({ name: "x", version: "1" }, {});
await c.connect(b);
const tools = (await c.listTools()).tools.map((t) => t.name).sort();
const src = readFileSync(new URL("./verify-endpoints.ts", import.meta.url), "utf8");
const missing: string[] = [];
for (const t of tools) {
  if (!src.includes(t + ":")) missing.push(t);
}
console.log("tools totales:", tools.length);
console.log("NO cubiertas en verify-endpoints:", missing.length, missing.join(", ") || "NINGUNA");
await c.close();
