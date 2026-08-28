import type { CallToolResult } from "@modelcontextprotocol/server";

/** Resultado de tool estandarizado: error accionable para el modelo (SEP-1303). */
export function toolError(mensaje: string): CallToolResult {
  return {
    content: [{ type: "text", text: `ERROR: ${mensaje}` }],
    isError: true,
  };
}

/** Resultado OK estándar: texto resumen + structuredContent JSON (datos CMF = no confiables). */
export function toolOk(
  texto: string,
  structuredContent: Record<string, unknown>,
  extra: { isError?: boolean } = {},
): CallToolResult {
  return {
    content: [{ type: "text", text: texto }],
    structuredContent,
    ...extra,
  };
}

/** Convierte una excepción de red/parseo en tool execution error. */
export function fromError(e: unknown): CallToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  return toolError(msg);
}

/**
 * Error honesto cuando la fuente legacy de la CMF no devolvió datos parseables.
 * No dice "no hay datos" (podría ser falso): dice que la fuente no entregó nada,
 * distingue causas probables y da la página oficial para verificar.
 */
export function toolErrorFuente(
  que: string,
  paginaOficial: string,
  extra = "el sistema legacy de la CMF puede estar caído o migrado",
): CallToolResult {
  return toolError(
    `${que}: la fuente de la CMF no devolvió datos parseables (${extra}). ` +
      `Esto NO significa necesariamente que no existan datos para la consulta. ` +
      `Verifique directamente en ${paginaOficial} y reintente más tarde si corresponde.`,
  );
}

/**
 * Distingue "sin datos" real (la página trajo su tabla, vacía) de "la fuente no
 * respondió" (la página no trajo tabla alguna: bloqueo temporal o challenge anti-bot).
 * Si la página no tiene <table> y no hay filas, reporta error de fuente, nunca "sin datos".
 */
export function sinDatosOFuente(
  html: string,
  filas: Record<string, unknown>[],
  que: string,
  paginaOficial: string,
  cuandoVacio: () => CallToolResult,
  cuandoHayDatos: () => CallToolResult,
): CallToolResult {
  if (filas.length === 0 && !/<table/i.test(html)) {
    return toolErrorFuente(que, paginaOficial, "la página de la CMF no trajo la tabla (posible bloqueo temporal o challenge anti-bot)");
  }
  return filas.length ? cuandoHayDatos() : cuandoVacio();
}

/**
 * Pagina un texto largo (un PDF convertido) sin perder nada.
 *
 * Regla del proyecto: **nunca cortamos por nuestro criterio sin dejarle
 * al agente la forma de leer el resto.** Un tope duro decide por él qué
 * parte del documento importa, y eso no lo podemos saber nosotros. Por
 * eso esto pagina en vez de truncar: el aviso dice siempre con qué
 * `offset_chars` continuar, así que cualquier documento se puede leer
 * completo, por grande que sea.
 *
 * @param texto Texto completo ya convertido.
 * @param offset Carácter donde empieza el tramo.
 * @param tamano Tamaño del tramo.
 * @returns El tramo con su aviso, y los datos de la paginación.
 */
export function paginarTexto(
  texto: string,
  offset: number,
  tamano: number,
): { tramo: string; desde: number; hasta: number; total: number; siguiente: number | null } {
  const total = texto.length;
  const desde = Math.min(Math.max(offset, 0), total);
  const hasta = Math.min(desde + tamano, total);
  const siguiente = hasta < total ? hasta : null;
  const aviso = siguiente !== null
    ? `\n\n...[tramo ${desde}-${hasta} de ${total} caracteres. El documento SIGUE: pida el resto con offset_chars=${hasta}, y suba max_chars si quiere tramos mayores. No se descarta nada.]`
    : desde > 0
      ? `\n\n...[fin del documento: caracteres ${desde}-${hasta} de ${total}]`
      : "";
  return { tramo: `${texto.slice(desde, hasta)}${aviso}`, desde, hasta, total, siguiente };
}

/**
 * Resumen de tabla para el bloque de TEXTO de una respuesta MCP.
 *
 * Regla que gobierna esta función: **el bloque de texto es todo lo que ve
 * un modelo.** `structuredContent` sobrevive para quien llama por
 * programa, no para el agente. Lo que no esté aquí, para el agente no
 * existe.
 *
 * Dos defectos reales que esto corrige (20 de agosto de 2026). Un informe
 * sobre pólizas vehiculares quedó con pendientes porque el enlace al
 * documento viajaba solo en el JSON estructurado, y porque el texto
 * cortaba en 8 filas de las 100 que el llamador había pedido. El agente
 * declaró "no puedo acceder al texto de las condiciones" y era cierto
 * para él.
 *
 * **El servidor NO recorta filas.** `filas` ya viene paginada por el
 * llamador con su propio `limit`, así que un segundo corte aquí sería el
 * servidor decidiendo, por criterio propio, qué parte de lo que el agente
 * pidió merece verse. Antes había un tope de 8 filas: el agente pedía 100
 * y recibía 8, sin saber que el recorte era nuestro. Quien decide cuánto
 * ver es quien llama, con `limit` y `offset`.
 *
 * @param filas Filas ya paginadas por el llamador. Se muestran TODAS.
 * @param columnas Columnas a mostrar. `url` se agrega sola si las filas la traen.
 */
export function resumirTabla<T extends Record<string, unknown>>(
  filas: T[],
  columnas: string[],
): string {
  if (filas.length === 0) return "(sin datos)";
  // Una columna que ninguna fila trae imprimiría una celda vacía, y esa
  // celda no significa "vacío": significa que el nombre está equivocado.
  // Los 2 casos se ven idénticos, así que el defecto es mudo. Cuando la
  // lista pedida nombra algo que el dato no tiene, esa lista queda
  // probada como equivocada y se descarta ENTERA a favor de las columnas
  // reales. El error degrada hacia más información, nunca hacia menos.
  const reales = new Set<string>();
  for (const f of filas) for (const k of Object.keys(f)) reales.add(k);
  const pedidas = columnas.some((c) => !reales.has(c)) ? [...reales] : columnas;
  // El enlace es el único camino del agente hacia el documento original,
  // así que nunca se omite cuando la fila lo trae.
  const conUrl = filas.some((f) => typeof f["url"] === "string" && f["url"] !== "");
  const cols = conUrl && !pedidas.includes("url") ? [...pedidas, "url"] : pedidas;
  const header = cols.join(" | ");
  const body = filas
    .map((f) => cols.map((c) => String(f[c] ?? "")).join(" | "))
    .join("\n");
  const comoLeer = conUrl
    ? "\nPara leer el texto de un documento, pase su url a cmf_documento_markdown."
    : "";
  return `${header}\n${body}${comoLeer}`;
}
