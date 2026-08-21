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

/** Cuota por IP. Devuelve `success: false` cuando se pasó del techo. */
interface Cuota {
  limit(opciones: { key: string }): Promise<{ success: boolean }>;
}

/** Entorno del Worker, con el binding de la caja aislada si existe. */
type EntornoWorker = CmfEnv & { CAJA?: WorkerLoaderLike; CUOTA_CODIGO?: Cuota };

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
 * Aplica la cuota por IP de la ruta que ejecuta código.
 *
 * Devuelve una respuesta 429 cuando hay que cortar, o `undefined` para
 * seguir. Si el binding no existe (despliegue viejo o desarrollo local),
 * deja pasar. Es una protección de abuso, no un control de acceso, así
 * que fallar abierto acá no abre nada que no estuviera abierto.
 */
async function revisarCuota(request: Request, env: EntornoWorker): Promise<Response | undefined> {
  const cuota = env.CUOTA_CODIGO;
  if (!cuota) return undefined;
  const ip = request.headers.get("cf-connecting-ip") ?? "sin-ip";
  const { success } = await cuota.limit({ key: ip });
  if (success) return undefined;
  return new Response(
    "Demasiados programas por minuto desde esta dirección. El modo código admite 30 por minuto. Espera un momento y reintenta.",
    { status: 429, headers: { "retry-after": "60" } },
  );
}

/**
 * Worker Cloudflare: MCP server stateless (spec 2026-07-28 + compatibilidad legacy).
 * Patrón oficial de Cloudflare (ver docs handler-api): factory per-request, nunca
 * exportar el callable directo (wrangler lo trataría como WorkerEntrypoint).
 */
export default {
  async fetch(request: Request, env: EntornoWorker, ctx: ExecutionContext) {
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
    // Van en rutas distintas a propósito. Son 2 servidores MCP, cada uno
    // en su endpoint, porque la norma prohíbe que el conjunto de tools
    // varíe entre conexiones del mismo servidor.
    const ruta = new URL(request.url).pathname.replace(/\/+$/, "");
    const conf: CmfEnv = { ...env, __pdfModule: pdfWasm };

    if (ruta.endsWith("/codigo")) {
      // Cuota por IP. El servidor no lleva clave a propósito, es libre y
      // gratuito, pero esta ruta ejecuta código y sin techo una sola IP
      // puede usar la cuenta como cómputo propio. El límite se aplica
      // ANTES de tocar la caja.
      const respuestaCuota = await revisarCuota(request, env);
      if (respuestaCuota) return respuestaCuota;
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
