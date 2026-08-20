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
 * @param filas Filas ya paginadas por el llamador.
 * @param columnas Columnas a mostrar. `url` se agrega sola si las filas la traen.
 * @param max Tope de filas del texto.
 * @param offset Offset de esta página, para poder indicar el siguiente.
 */
export function resumirTabla<T extends Record<string, unknown>>(
  filas: T[],
  columnas: string[],
  max = 50,
  offset = 0,
): string {
  if (filas.length === 0) return "(sin datos)";
  // El enlace es el único camino del agente hacia el documento original,
  // así que nunca se omite cuando la fila lo trae.
  const conUrl = filas.some((f) => typeof f["url"] === "string" && f["url"] !== "");
  const cols = conUrl && !columnas.includes("url") ? [...columnas, "url"] : columnas;
  const header = cols.join(" | ");
  const body = filas
    .slice(0, max)
    .map((f) => cols.map((c) => String(f[c] ?? "")).join(" | "))
    .join("\n");
  const faltan = filas.length - max;
  // Decir CÓMO pedir el resto. "y N filas más" a secas se lee como un
  // límite del dato y no como una página, y el agente se rinde.
  const extra = faltan > 0
    ? `\n... faltan ${faltan} filas de esta página; pida las siguientes con offset=${offset + max}`
    : "";
  const comoLeer = conUrl
    ? "\nPara leer el texto de un documento, pase su url a cmf_documento_markdown."
    : "";
  return `${header}\n${body}${extra}${comoLeer}`;
}
