/**
 * Registro de operaciones de la CMF.
 *
 * Las 86 operaciones ya existen, escritas como tools MCP en `src/tools/`.
 * Este módulo las CAPTURA en vez de reescribirlas: le pasa a los mismos
 * `registrarToolsX(server, env)` un servidor de mentira que, en lugar de
 * registrar en MCP, guarda cada operación en un mapa.
 *
 * Por qué así y no un directorio de operaciones nuevo. porque una copia
 * a mano de 86 operaciones se desincroniza el primer día. Acá hay UNA
 * sola definición de cada operación y 2 formas de exponerla.
 *
 * - Modo clásico: 86 tools MCP, una por operación. Lo que existe hoy.
 * - Modo código: 2 tools (`cmf_buscar`, `cmf_ejecutar`) sobre este mismo
 *   registro. El catálogo se DERIVA de acá, nunca se escribe a mano.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import type { CmfEnv } from "./client/cmf-client.js";
import { registrarToolsApi } from "./tools/api-oficial.js";
import { registrarToolsEmpresas } from "./tools/empresas.js";
import { registrarToolsFondosMutuos } from "./tools/fondos-mutuos.js";
import { registrarToolsFondosInversion } from "./tools/fondos-inversion.js";
import { registrarToolsOtros } from "./tools/otros.js";
import { registrarToolsPaquete } from "./tools/paquete.js";

/** Una operación de la CMF, tal como quedó registrada por su módulo. */
export interface Operacion {
  /** Nombre público sin el prefijo `cmf_`, que es como se llama en el sandbox. */
  nombre: string;
  /** Nombre original de la tool MCP (`cmf_...`). */
  nombreTool: string;
  /** Descripción completa, la misma que ve el modelo en modo clásico. */
  descripcion: string;
  /** Nombres de los parámetros que acepta. */
  params: string[];
  /** Ejecuta la operación y devuelve el resultado MCP crudo. */
  ejecutar: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Saca los nombres de los campos de un esquema zod, sin romperse si cambia. */
function nombresDeParams(inputSchema: unknown): string[] {
  const forma = (inputSchema as { shape?: Record<string, unknown> } | undefined)?.shape;
  return forma ? Object.keys(forma) : [];
}

/**
 * Corre los registradores contra un servidor de captura y devuelve todas
 * las operaciones.
 * @param env Configuración del cliente de la CMF.
 */
export function construirRegistro(env: CmfEnv = {}): Map<string, Operacion> {
  const operaciones = new Map<string, Operacion>();

  const captor = {
    registerTool(
      nombreTool: string,
      meta: { description?: string; inputSchema?: unknown },
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) {
      const nombre = nombreTool.replace(/^cmf_/, "");
      if (operaciones.has(nombre)) {
        throw new Error(`registro: la operación "${nombre}" está declarada dos veces`);
      }
      operaciones.set(nombre, {
        nombre,
        nombreTool,
        descripcion: meta.description ?? "",
        params: nombresDeParams(meta.inputSchema),
        ejecutar: (args) => handler(args),
      });
      return undefined as never;
    },
    // Los registradores solo usan registerTool; el resto no se toca.
    registerResource() { return undefined as never; },
    registerPrompt() { return undefined as never; },
  } as unknown as McpServer;

  registrarToolsApi(captor, env);
  registrarToolsEmpresas(captor, env);
  registrarToolsFondosMutuos(captor, env);
  registrarToolsFondosInversion(captor, env);
  registrarToolsOtros(captor, env);
  registrarToolsPaquete(captor, env);

  return operaciones;
}

/** Una entrada del catálogo, que es lo que el modelo filtra con código. */
export interface EntradaCatalogo {
  nombre: string;
  resumen: string;
  params: string[];
}

/**
 * Deriva el catálogo del registro. **No se escribe a mano nunca.**
 *
 * El resumen es la primera frase de la descripción. La descripción
 * completa queda disponible con `detalle`, para que el modelo pueda
 * pedirla solo de las operaciones que le interesan.
 * @param operaciones Registro construido con `construirRegistro`.
 */
export function derivarCatalogo(operaciones: Map<string, Operacion>): EntradaCatalogo[] {
  return [...operaciones.values()]
    .map((op) => ({
      nombre: op.nombre,
      resumen: primeraFrase(op.descripcion),
      params: op.params,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Primera frase de un texto, para que el catálogo quepa en poco espacio. */
export function primeraFrase(texto: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  const corte = limpio.search(/\.\s|\. *$/);
  return corte > 0 ? limpio.slice(0, corte + 1) : limpio;
}
