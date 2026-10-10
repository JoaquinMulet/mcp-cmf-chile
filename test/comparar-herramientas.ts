/**
 * Compara las herramientas que publica el servidor desplegado con las del
 * repositorio. Vive aparte para probarse sin red (comparar-herramientas.test.ts)
 * y la usa test/verify-remote.ts contra la instancia viva.
 */
export interface Diferencia {
  /** Están en el repositorio y el servidor desplegado no las publica. */
  faltan: string[];
  /** El servidor desplegado las publica y el repositorio no las tiene. */
  sobran: string[];
}

export function compararHerramientas(delRepositorio: string[], desplegadas: string[]): Diferencia {
  const repo = new Set(delRepositorio);
  const vivo = new Set(desplegadas);
  return {
    faltan: [...repo].filter((n) => !vivo.has(n)).sort(),
    sobran: [...vivo].filter((n) => !repo.has(n)).sort(),
  };
}
