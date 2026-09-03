#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";
import { cargarPdfModuleDesdeDisco } from "./pdf.js";

/**
 * Entrypoint local (STDIO): `node dist/index.js` o bin `mcp-cmf-chile`.
 * Nunca escribir a stdout (corrompe el protocolo) — usar console.error.
 */
const pdfModule = await cargarPdfModuleDesdeDisco().catch(() => undefined);

const env = {
  CMF_API_KEY: process.env.CMF_API_KEY,
  CMF_BEST_KEY: process.env.CMF_BEST_KEY,
  CMF_HTTP_TOKEN: process.env.CMF_HTTP_TOKEN,
  CMF_RATE_LIMIT_MS: process.env.CMF_RATE_LIMIT_MS,
  CMF_CACHE_TTL_S: process.env.CMF_CACHE_TTL_S,
  CMF_MAX_ROWS: process.env.CMF_MAX_ROWS,
  CMF_UPSTREAM_TIMEOUT_MS: process.env.CMF_UPSTREAM_TIMEOUT_MS,
  CMF_KV: undefined,
  __pdfModule: pdfModule,
};

serveStdio(() => createServer(env));
console.error(
  pdfModule
    ? "mcp-cmf-chile server corriendo (STDIO) — datos públicos de la CMF de Chile, PDF→Markdown activo"
    : "mcp-cmf-chile server corriendo (STDIO) — datos públicos de la CMF de Chile (PDF→Markdown no disponible)",
);
