/**
 * Paginación honesta para las tools que devuelven filas.
 *
 * El defecto que este módulo existe para cerrar. 43 operaciones cortaban
 * sus filas dentro del `structuredContent` con un `.slice(0, N)` clavado,
 * sin decir el total y sin ningún parámetro para pedir el resto. En el
 * modo clásico el conteo real al menos viajaba en el texto; en el modo
 * código, que lee el `structuredContent`, el programa recibía N filas y
 * no tenía cómo enterarse de que existían más. Medido el 20 de agosto de
 * 2026 con `cmf_empresa_directorio`. 299 filas reales, 100 entregadas,
 * cero señales.
 *
 * La regla del proyecto es que una herramienta jamás decide por el
 * agente qué parte del dato merece verse, y que si hay que cortar, el
 * corte SIEMPRE viaja con la forma exacta de pedir el resto, y ese
 * parámetro tiene que existir de verdad.
 *
 * Acá se cumplen las 3 cosas de una vez.
 *
 * 1. `paginacion(N)` agrega `offset` y `limit` al esquema de entrada, con
 *    N como valor por defecto, así que ninguna respuesta cambia de
 *    tamaño para quien ya usaba la tool.
 * 2. El techo de `limit` es 5000, así que quien quiera todo lo pide.
 * 3. `toolOkPaginado` publica `total` y `next_offset` en el
 *    `structuredContent` Y escribe el aviso de continuación en el TEXTO,
 *    que es lo único que un modelo ve.
 */
import * as z from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { toolOk } from "./errors.js";
import { paginar } from "./paginate.js";

/** Techo de filas por respuesta. Alto a propósito: el que pide, manda. */
const LIMITE_MAXIMO = 5000;

/**
 * Campos de paginación para el `inputSchema` de una tool que devuelve filas.
 * @param porDefecto El tope histórico de esa tool, para no cambiar su
 * comportamiento de fábrica.
 */
export function paginacion(porDefecto: number) {
  return {
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIMITE_MAXIMO)
      .default(porDefecto)
      .describe(
        `Cuántas filas devolver (máximo ${LIMITE_MAXIMO}, por defecto ${porDefecto}). La respuesta trae total y next_offset para pedir el resto. Ej: ${porDefecto}`,
      ),
  };
}

/**
 * Arma el resultado de una tool que devuelve filas, paginado y honesto.
 *
 * @param texto Resumen para el modelo. El aviso de continuación se le
 * agrega al final cuando quedan filas.
 * @param base El resto del `structuredContent` (rut, año, y lo que sea).
 * @param campo Nombre del campo que lleva las filas.
 * @param filas TODAS las filas que trajo la fuente, sin recortar.
 * @param offset Desde dónde, ya validado por el esquema.
 * @param limit Cuántas, ya validado por el esquema.
 * @param tool Nombre de la tool, para que el aviso diga a quién llamar.
 */
export function toolOkPaginado(
  texto: string,
  base: Record<string, unknown>,
  campo: string,
  filas: unknown[],
  offset: number,
  limit: number,
  tool: string,
): CallToolResult {
  const { filas: tramo, paginado } = paginar(filas, offset, limit);
  return toolOk(texto + avisoDeTramo(tramo.length, paginado, tool), {
    ...base,
    total: paginado.total,
    next_offset: paginado.next_offset,
    [campo]: tramo,
  });
}

/**
 * El aviso que va en el TEXTO. Sin esto el corte sería invisible para el
 * modelo, que no puede leer el `structuredContent`.
 */
export function avisoDeTramo(
  mostradas: number,
  paginado: { offset: number; total: number; next_offset: number | null },
  tool: string,
): string {
  if (paginado.next_offset === null) {
    return paginado.offset > 0
      ? `\n\n[Filas ${paginado.offset + 1} a ${paginado.offset + mostradas} de ${paginado.total}. No quedan más.]`
      : "";
  }
  return `\n\n[Mostrando ${mostradas} filas de ${paginado.total}. Para las siguientes, llama ${tool} con offset=${paginado.next_offset}. Para traer más de una vez, sube limit (máximo ${LIMITE_MAXIMO}).]`;
}
