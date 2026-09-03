import type { CallToolResult } from "@modelcontextprotocol/server";
import { enviarFormularioLegacy, type CmfEnv } from "../client/cmf-client.js";
import { gridDataAsJsonAJson } from "../client/parsers.js";
import { toolErrorFuente } from "./errors.js";
import { toolOkTabla } from "./tramos.js";

/**
 * Las estadísticas que la CMF sirve con un grid de Google Charts, de punta
 * a punta. lee el índice, envía el formulario a donde apunta, saca el grid
 * del <script> y lo pagina. Es el camino único de las 7 tools que el 2 de
 * septiembre de 2026 devolvían el formulario como si fuera dato.
 *
 * Distingue las 3 salidas que antes se veían iguales.
 * - la página no trae el grid → error de fuente, con la página oficial.
 * - el grid viene sin entidades → «sin resultados», que es un cero real.
 * - el grid trae datos → filas paginadas, con la nota de unidad si la
 *   página la declara.
 */
export async function toolDeGrid(
  opciones: {
    /** Qué se estaba consultando, para el mensaje de error. */
    que: string;
    indice: string;
    parametrosIndice?: Record<string, string>;
    /** Nombre del <form> del índice. En las estadísticas de la CMF es f1. */
    formulario?: string;
    cuerpo: Record<string, string | number | string[] | undefined>;
    /** true → una fila por entidad, con las cuentas como campos. */
    porEntidad?: boolean;
    /**
     * Cómo dice la página que NO hay datos. Cuando calza, la respuesta es
     * «sin resultados» con 0 filas, que es un cero real y no un error.
     */
    sinDatosSi?: RegExp;
    titulo: string;
    vacio: string;
    base: Record<string, unknown>;
    /** Campos del structuredContent que se calculan con el grid ya leído. */
    baseDeGrid?: (grid: { entidades: string[]; filas: Record<string, string>[] }) => Record<string, unknown>;
    offset: number;
    limit: number;
    tool: string;
    /** Notas fijas que la página NO declara pero el dato necesita. */
    notas?: string[];
  },
  env: CmfEnv,
): Promise<CallToolResult> {
  const { que, indice, parametrosIndice = { lang: "es" }, formulario, cuerpo, porEntidad, notas = [] } = opciones;
  const html = await enviarFormularioLegacy({ indice, parametrosIndice, formulario, cuerpo }, env);
  const grid = gridDataAsJsonAJson(html, { porEntidad }) ?? (opciones.sinDatosSi?.test(html) ? { entidades: [], filas: [] } : null);
  if (!grid) {
    const qs = new URLSearchParams(parametrosIndice).toString();
    return toolErrorFuente(que, `https://www.cmfchile.cl${indice}?${qs}`, "la página de resultados no trajo el grid de datos");
  }
  const todasLasNotas = [...("nota" in grid && grid.nota ? [grid.nota] : []), ...notas];
  return toolOkTabla({
    titulo: opciones.titulo,
    vacio: opciones.vacio,
    base: { ...opciones.base, entidades: grid.entidades, ...(opciones.baseDeGrid?.(grid) ?? {}) },
    campo: "filas",
    filas: grid.filas,
    offset: opciones.offset,
    limit: opciones.limit,
    tool: opciones.tool,
    unidad: porEntidad ? "entidades" : "cuentas",
    ...(todasLasNotas.length ? { notas: todasLasNotas } : {}),
  });
}

/** La página de la CMF no declara la escala de los grids IFRS de SA. */
export const NOTA_ESCALA_IFRS_SA =
  "La página de la CMF no declara la escala. Las cifras van en unidades de la moneda que indica la fila Moneda, no en miles (comprobado con el total de activos de Copec a 12/2024, 28.481.540.000 dólares).";
