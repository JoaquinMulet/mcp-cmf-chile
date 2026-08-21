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
