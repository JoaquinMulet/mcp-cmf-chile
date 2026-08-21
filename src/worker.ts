import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server.js";
import type { CmfEnv } from "./client/cmf-client.js";
import { ejecutorDeWorker, type WorkerLoaderLike, type Prestamos } from "./sandbox.js";
import { WorkerEntrypoint } from "cloudflare:workers";
import { construirRegistro } from "./registro.js";
import { prestamosDe } from "./tools/code-mode.js";
import pdfWasm from "../node_modules/@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm";

/** Debe coincidir con `compatibility_date` de wrangler.jsonc. */
const FECHA_COMPATIBILIDAD = "2026-07-28";

/** Entorno del Worker, con el binding de la caja aislada si existe. */
type EntornoWorker = CmfEnv & { CAJA?: WorkerLoaderLike };

/** Tipos mínimos de Workers (sin depender de @cloudflare/workers-types). */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  /** Fábrica de stubs de los WorkerEntrypoint que este módulo exporta. */
  exports: { PuenteCmf(opciones: { props?: unknown }): unknown };
}
interface ExportedHandler<E> {
  fetch(request: Request, env: E, ctx: ExecutionContext): Promise<Response> | Response;
}

/**
 * El registro de operaciones no cambia dentro de un aislado, y armarlo
 * recorre las 86 registradoras. Se memoriza para no rehacerlo en cada
 * llamada del programa.
 */
let prestamosMemo: Prestamos | undefined;
function prestamosDelEntorno(env: CmfEnv): Prestamos {
  prestamosMemo ??= prestamosDe(construirRegistro({ ...env, __pdfModule: pdfWasm }));
  return prestamosMemo;
}

/**
 * El puente entre el programa del modelo y la CMF.
 *
 * Es la ÚNICA puerta de la caja hacia afuera: el Worker cargado al vuelo
 * corre con `globalOutbound: null`, así que no tiene internet y solo
 * puede llamar acá. Toda petición real sale por `src/client/`, con su
 * límite de velocidad, su caché y su anti-bot.
 *
 * Devuelve TEXTO JSON, no el objeto. El borde entre 2 aislados es un
 * borde de datos, y un texto no puede arrastrar referencias vivas al
 * proceso servidor.
 *
 * Tiene que ser un WorkerEntrypoint exportado del módulo principal:
 * `ctx.exports.PuenteCmf({})` produce el stub, y un stub SÍ viaja en el
 * `env` del Worker cargado.
 */
export class PuenteCmf extends WorkerEntrypoint<CmfEnv> {
  async llamar(nombre: string, args: Record<string, unknown>): Promise<string> {
    // La lista permitida viaja en los props del stub y se hace cumplir
    // ACA. No sirve filtrar el mapa que se le pasa al programa, porque
    // el programa tiene `env` en su alcance y puede llamar al puente
    // directo. Este es el único punto que el hijo no puede rodear, así
    // que es donde va a vivir la curación por corredora.
    const props = (this.ctx as { props?: { permitidas?: string[] } }).props;
    const permitidas = props?.permitidas;
    if (!Array.isArray(permitidas) || !permitidas.includes(nombre)) {
      throw new Error(`La operación "${nombre}" no está disponible por esta vía.`);
    }
    const { cmf } = prestamosDelEntorno(this.env);
    const fn = cmf[nombre];
    if (!fn) {
      throw new Error(`La operación "${nombre}" no existe. Búscala primero con cmf_buscar.`);
    }
    return JSON.stringify(await fn(args ?? {})) ?? "null";
  }
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
      // `createMcpHandler` enruta por la ruta y solo reconoce /mcp, así
      // que se le entrega la petición con la ruta reescrita. El sufijo
      // /codigo es nuestro, no suyo.
      const url = new URL(request.url);
      url.pathname = ruta.slice(0, -"/codigo".length) || "/mcp";
      const peticion = new Request(url, request);
      const ejecutor = ejecutorDeWorker(caja, FECHA_COMPATIBILIDAD, (permitidas) =>
        ctx.exports.PuenteCmf({ props: { permitidas } }),
      );
      return createMcpHandler(() => createServer(conf, { modo: "codigo", ejecutor }))(peticion, env, ctx);
    }

    return createMcpHandler(() => createServer(conf))(request, env, ctx);
  },
} satisfies ExportedHandler<EntornoWorker>;
