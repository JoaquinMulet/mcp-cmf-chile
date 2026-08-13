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

/** Resumen de tabla para el texto (primeras N filas). */
export function resumirTabla<T extends Record<string, unknown>>(
  filas: T[],
  columnas: string[],
  max = 8,
): string {
  if (filas.length === 0) return "(sin datos)";
  const header = columnas.join(" | ");
  const body = filas
    .slice(0, max)
    .map((f) => columnas.map((c) => String(f[c] ?? "")).join(" | "))
    .join("\n");
  const extra = filas.length > max ? `\n... y ${filas.length - max} filas más` : "";
  return `${header}\n${body}${extra}`;
}
