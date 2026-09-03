/**
 * Un solo formato de RUT para todo lo que entra y sale del servidor.
 *
 * La CMF escribe el RUT de 4 formas según la página. «76598625-7» en la
 * lista de entidades, «99155000» en el catálogo, «90690000-9» en el
 * catálogo de tickers y «76.212.519-6» en los grids. Y TODAS sus páginas de
 * consulta lo piden sin puntos y sin dígito verificador. El formato
 * canónico de este servidor es ese, el que la CMF acepta.
 *
 * El dígito verificador no se bota. viaja aparte, en `rut_dv`, solo cuando
 * la fuente lo traía. Inventarlo sería calcularlo, y un catálogo no debe
 * fabricar datos que la fuente no publicó.
 */

/** Solo los dígitos del cuerpo del RUT. «76.212.519-6» → «76212519». */
export function rutCanonico(valor: unknown): string {
  return String(valor ?? "")
    .replace(/[.\s]/g, "")
    .replace(/-.*$/, "");
}

/** El dígito verificador en mayúscula, o undefined si la fuente no lo traía. */
export function dvDeRut(valor: unknown): string | undefined {
  const m = /-\s*([0-9kK])\s*$/.exec(String(valor ?? ""));
  return m ? m[1].toUpperCase() : undefined;
}

/**
 * La fila de un catálogo con su `rut` canónico y el DV aparte.
 *
 * Se aplica al SALIR de cada catálogo, después de leer la fuente, para que
 * lo que el agente pega en la tool siguiente sea siempre lo que esa tool
 * acepta. Una fila sin `rut` vuelve tal cual.
 */
export function conRutCanonico<T extends Record<string, unknown>>(fila: T): T & { rut_dv?: string } {
  if (fila.rut === undefined || fila.rut === null) return fila;
  const dv = dvDeRut(fila.rut);
  return { ...fila, rut: rutCanonico(fila.rut), ...(dv ? { rut_dv: dv } : {}) };
}
