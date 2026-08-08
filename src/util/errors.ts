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
