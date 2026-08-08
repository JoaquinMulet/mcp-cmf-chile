/** Paginación estándar (patrón secedgar): la tool devuelve offset/next_offset/truncated/total. */

export interface Paginado {
  offset: number;
  limit: number;
  total: number;
  next_offset: number | null;
  truncated: boolean;
}

export function paginar<T>(rows: T[], offset: number, limit: number): { filas: T[]; paginado: Paginado } {
  const total = rows.length;
  const desde = Math.min(offset, total);
  const filas = rows.slice(desde, desde + limit);
  const next_offset = desde + filas.length < total ? desde + filas.length : null;
  return {
    filas,
    paginado: {
      offset: desde,
      limit,
      total,
      next_offset,
      truncated: filas.length < rows.length,
    },
  };
}

/** Recorta una respuesta para no saturar el contexto: preview + flag. */
export function truncarTexto(texto: string, maxChars = 12000): string {
  if (texto.length <= maxChars) return texto;
  return `${texto.slice(0, maxChars)}\n...[truncado ${texto.length - maxChars} caracteres]`;
}
