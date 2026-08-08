import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server.js";
import type { CmfEnv } from "./client/cmf-client.js";
import pdfWasm from "../node_modules/@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm";

/** Tipos mínimos de Workers (sin depender de @cloudflare/workers-types). */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface ExportedHandler<E> {
  fetch(request: Request, env: E, ctx: ExecutionContext): Promise<Response> | Response;
}

/**
 * Worker Cloudflare: MCP server stateless (spec 2026-07-28 + compatibilidad legacy).
 * Patrón oficial de Cloudflare (ver docs handler-api): factory per-request, nunca
 * exportar el callable directo (wrangler lo trataría como WorkerEntrypoint).
 */
export default {
  fetch(request: Request, env: CmfEnv, ctx: ExecutionContext) {
    // Auth opcional: si CMF_HTTP_TOKEN está definido, exigir bearer
    const token = env.CMF_HTTP_TOKEN;
    if (token) {
      const auth = request.headers.get("Authorization") ?? "";
      if (auth !== `Bearer ${token}`) {
        return new Response("Unauthorized", { status: 401 });
      }
    }
    return createMcpHandler(() => createServer({ ...env, __pdfModule: pdfWasm }))(
      request,
      env,
      ctx,
    );
  },
} satisfies ExportedHandler<CmfEnv>;
