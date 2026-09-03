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
import { registrarToolsCatalogos } from "./tools/catalogos.js";

/** Una operación de la CMF, tal como quedó registrada por su módulo. */
export interface Operacion {
  /** Nombre público sin el prefijo `cmf_`, que es como se llama en el sandbox. */
  nombre: string;
  /** Nombre original de la tool MCP (`cmf_...`). */
  nombreTool: string;
  /** Descripción completa, la misma que ve el modelo en modo clásico. */
  descripcion: string;
  /** Parámetros que acepta, con su descripción. */
  params: Param[];
  /**
   * Aplica el esquema de entrada a los argumentos, igual que hace MCP en
   * el modo clásico. Devuelve los argumentos ya validados y con sus
   * valores por defecto puestos.
   */
  prepararArgs: (args: Record<string, unknown>) => Record<string, unknown>;
  /** Ejecuta la operación y devuelve el resultado MCP crudo. */
  ejecutar: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Esquema zod visto por lo poco que necesitamos de él. */
interface EsquemaEntrada {
  shape?: Record<string, unknown>;
  parse?: (valor: unknown) => Record<string, unknown>;
}

/**
 * Construye el validador de entrada de una operación.
 *
 * Esto NO es un adorno. En el modo clásico, MCP parsea los argumentos con
 * el esquema antes de llamar al handler, y ahí es donde se aplican los
 * valores por defecto (por ejemplo `limit` y `offset`). Un camino que
 * llame el handler crudo recibe esos campos en `undefined` y devuelve
 * resultados distintos para la misma consulta. Los 2 caminos tienen que
 * pasar por la misma puerta.
 */
function validadorDe(nombre: string, esquema: EsquemaEntrada | undefined, params: Param[]) {
  return (args: Record<string, unknown>): Record<string, unknown> => {
    if (typeof esquema?.parse !== "function") return args;
    // Una clave desconocida se DESCARTA en silencio por defecto, y eso
    // produce el peor resultado posible. el modelo cree que filtró y
    // recibe datos sin filtrar. Pedí pólizas de una compañía y volvieron
    // 3 aseguradoras distintas, presentadas como si el filtro hubiera
    // corrido. Un error que enseña vale más que un dato corrupto.
    const validas = new Set(params.map((p) => p.nombre));
    const invento = Object.keys(args ?? {}).filter((k) => !validas.has(k));
    if (invento.length > 0) {
      throw new Error(
        `La operación ${nombre} no acepta ${invento.map((k) => `"${k}"`).join(", ")}. ` +
          `Sus parámetros son: ${[...validas].join(", ")}. ` +
          "Un parámetro que no existe se ignoraría y creerías haber filtrado.",
      );
    }
    try {
      return esquema.parse(args ?? {});
    } catch (e) {
      const detalle = (e as { issues?: Array<{ path?: unknown[]; message?: string }> }).issues
        ?.map((i) => `${(i.path ?? []).join(".") || "(raíz)"}: ${i.message ?? ""}`)
        .join("; ");
      throw new Error(
        `Argumentos inválidos para ${nombre}. ${detalle || String(e)}. Parámetros que acepta: ${params.map((p) => p.nombre).join(", ")}.`,
      );
    }
  };
}

/** Un parámetro de una operación, con lo que hay que saber para usarlo. */
interface Param {
  nombre: string;
  /** El `.describe()` del esquema zod. Trae enums, formatos y defaults. */
  descripcion: string;
}

/**
 * Saca los parámetros de un esquema zod con su descripción.
 *
 * La descripción viaja porque el catálogo NO entra al contexto del modelo.
 * Vive dentro de la caja y el modelo lo filtra con código, así que la
 * información de más ahí es gratis. Sin esto el modelo ve `["cartera"]` y
 * no tiene cómo saber que es un enum de 5 valores.
 */
function paramsDe(inputSchema: unknown): Param[] {
  const forma = (inputSchema as { shape?: Record<string, unknown> } | undefined)?.shape;
  if (!forma) return [];
  return Object.entries(forma).map(([nombre, campo]) => ({
    nombre,
    descripcion: descripcionDeCampo(campo),
  }));
}

/** Lee el `.describe()` de un campo zod, sin romperse si zod cambia por dentro. */
function descripcionDeCampo(campo: unknown): string {
  const c = campo as { description?: string; def?: { description?: string } } | undefined;
  return c?.description ?? c?.def?.description ?? "";
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
      const params = paramsDe(meta.inputSchema);
      const prepararArgs = validadorDe(nombre, meta.inputSchema as EsquemaEntrada | undefined, params);
      operaciones.set(nombre, {
        nombre,
        nombreTool,
        descripcion: meta.description ?? "",
        params,
        prepararArgs,
        ejecutar: (args) => handler(prepararArgs(args ?? {})),
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
  registrarToolsCatalogos(captor, env);

  return operaciones;
}

/** Una entrada del catálogo, que es lo que el modelo filtra con código. */
export interface EntradaCatalogo {
  nombre: string;
  /** Primera frase, para listar barato. */
  resumen: string;
  /**
   * Descripción COMPLETA. Incluye la frase final de casi todas las
   * operaciones que dice cuándo usar esta y cuándo usar su hermana, que
   * es justo lo que evita elegir mal.
   */
  detalle: string;
  params: Param[];
}

/**
 * Deriva el catálogo del registro. **No se escribe a mano nunca.**
 *
 * Cada entrada lleva el resumen (primera frase) y el `detalle` completo.
 * Las 2 cosas, porque el catálogo NO entra al contexto del modelo. vive
 * dentro de la caja y el modelo se lleva solo lo que su código devuelva.
 * Un catálogo pobre lo obliga a adivinar; uno completo no le cuesta nada.
 * @param operaciones Registro construido con `construirRegistro`.
 */
export function derivarCatalogo(operaciones: Map<string, Operacion>): EntradaCatalogo[] {
  return [...operaciones.values()]
    .map((op) => ({
      nombre: op.nombre,
      resumen: primeraFrase(op.descripcion),
      detalle: op.descripcion,
      params: op.params,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Primera frase de un texto, para que el catálogo quepa en poco espacio. */
export function primeraFrase(texto: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  // Un punto solo cierra la frase si lo sigue un espacio y una mayúscula,
  // o si es el final. Así "Ley 19.880, art. 45" no parte la frase en 2.
  const corte = limpio.search(/\.(?=\s+[A-ZÁÉÍÓÚÑ¿¡(])|\. *$/);
  return corte > 0 ? limpio.slice(0, corte + 1) : limpio;
}
