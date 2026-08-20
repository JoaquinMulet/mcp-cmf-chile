import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server.js";
import type { CmfEnv } from "./client/cmf-client.js";
import { ejecutorDeWorker, type WorkerLoaderLike } from "./sandbox.js";
import pdfWasm from "../node_modules/@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm";

/** Debe coincidir con `compatibility_date` de wrangler.jsonc. */
const FECHA_COMPATIBILIDAD = "2026-07-28";

/** Entorno del Worker, con el binding de la caja aislada si existe. */
type EntornoWorker = CmfEnv & { CAJA?: WorkerLoaderLike };

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
  fetch(request: Request, env: EntornoWorker, ctx: ExecutionContext) {
    // Auth opcional: si CMF_HTTP_TOKEN está definido, exigir bearer
    const token = env.CMF_HTTP_TOKEN;
    if (token) {
      const auth = request.headers.get("Authorization") ?? "";
      if (auth !== `Bearer ${token}`) {
        return new Response("Unauthorized", { status: 401 });
      }
    }
    // Dos superficies sobre el MISMO registro de operaciones.
    //
    //   /          86 tools, una por operación. El contrato histórico, que
    //              otros consumidores ya usan y que no se rompe.
    //   /codigo    2 tools (cmf_buscar, cmf_ejecutar). Costo de contexto
    //              fijo, y el servidor deja de recortar por criterio propio.
    //
    // Van en rutas distintas a propósito. La norma MCP exige que el
    // conjunto de tools no varíe dentro de una conexión, así que cada
    // cliente elige su superficie al conectarse y nada cambia bajo sus pies.
    const ruta = new URL(request.url).pathname.replace(/\/+$/, "");
    const conf: CmfEnv = { ...env, __pdfModule: pdfWasm };

    if (ruta.endsWith("/codigo")) {
      const caja = env.CAJA;
      if (!caja) {
        // Fallo ruidoso. Sin caja aislada NO se ejecuta código del modelo.
        return new Response(
          "El modo código necesita el binding worker_loaders llamado CAJA. Revisa wrangler.jsonc y el acceso de la cuenta a Worker Loader.",
          { status: 501 },
        );
      }
      return createMcpHandler(() =>
        createServer(conf, { modo: "codigo", ejecutor: ejecutorDeWorker(caja, FECHA_COMPATIBILIDAD) }),
      )(request, env, ctx);
    }

    return createMcpHandler(() => createServer(conf))(request, env, ctx);
  },
} satisfies ExportedHandler<EntornoWorker>;
