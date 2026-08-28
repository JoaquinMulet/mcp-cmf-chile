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
import type { CallToolResult } from "@modelcontextprotocol/server";
import { resumirTabla, toolOk } from "./errors.js";
import { enteroSchema } from "./schemas.js";
import { paginar } from "./paginate.js";

/**
 * Campos de paginación para el `inputSchema` de una tool que devuelve filas.
 * Sin techo a propósito. El servidor no decide cuántas filas mereces,
 * entrega lo que pidas y lo que la fuente tenga.
 * @param porDefecto El tope histórico de esa tool, para no cambiarle el
 * comportamiento a quien no pide nada.
 */
export function paginacion(porDefecto: number) {
  return {
    offset: enteroSchema()
      .min(0)
      .default(0)
      .describe("Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0"),
    limit: enteroSchema()
      .min(1)
      .default(porDefecto)
      .describe(
        `Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto ${porDefecto}. La respuesta trae total y next_offset. Ej: ${porDefecto}`,
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

/** Un campo del structuredContent que solo existe cuando tiene algo que decir. */
function soloSiHay<T>(nombre: string, valor: T[] | undefined): Record<string, T[]> {
  return valor && valor.length > 0 ? { [nombre]: valor } : {};
}

/**
 * Lo que va DESPUES de la tabla y del aviso de tramo.
 *
 * Los agregados y las notas pertenecen a la consulta entera y no al tramo,
 * asi que se repiten en todas las paginas. Quien pide el tramo 3 necesita
 * saber que el patrimonio va en millones tanto como quien pidio el tramo 1.
 */
function pieDeTabla(
  notas: string[] | undefined,
  totales: Record<string, unknown>[] | undefined,
  unidad: string,
): string {
  const agregados = totales?.length
    ? `\n\nFilas de agregado de la planilla, NO son ${unidad} y no entran en el total de arriba:\n${resumirTabla(totales, Object.keys(totales[0] ?? {}))}`
    : "";
  const alPie = notas?.length ? `\n\nNotas de la planilla de la CMF:\n${notas.join("\n")}` : "";
  return agregados + alPie;
}

/**
 * Arma el resultado de una tool que devuelve una TABLA, con el texto
 * renderizado DESPUES de paginar.
 *
 * Por que existe, y por que no basta con `toolOkPaginado`.
 *
 * `toolOkPaginado` recibe el texto ya escrito por quien llama, y 28
 * operaciones lo escribian asi.
 *
 *     resumirTabla(filas.slice(0, 10), Object.keys(filas[0]).slice(0, 6))
 *
 * O sea 10 filas y 6 columnas clavadas, sin mirar el `limit` que pidio
 * el agente. Medido el 21 de agosto de 2026 con `cmf_sanciones_cursadas`.
 * la fuente tenia 30 filas, los datos llevaban las 30, y al TEXTO
 * llegaban 10. Y sin ningun aviso, porque el aviso de continuacion solo
 * aparece cuando queda una pagina siguiente, y 30 cabian en el `limit`.
 * El modelo veia 10 de 30 y nada le decia que faltaban 20.
 *
 * Es peor que el recorte que ya habiamos cerrado, porque aquel al menos
 * publicaba el total. Este es mudo, y un agente lee el silencio como
 * "esto es todo lo que hay".
 *
 * La cura no es subir el 10. Es que el texto NO SE PUEDA escribir antes
 * de paginar. Aca el texto se renderiza desde el tramo ya paginado, asi
 * que decir una cantidad distinta de la que se entrega es imposible por
 * construccion, no por disciplina.
 *
 * Y las columnas van TODAS por defecto. Elegir 6 por orden de aparicion
 * es la misma decision que escondio la columna `url` durante semanas.
 * Quien llama puede fijarlas cuando de verdad conoce la tabla.
 */
export function toolOkTabla(opciones: {
  /** Encabezado del texto, sin el conteo. Ej. "Indicadores NCH SA". */
  titulo: string;
  /** Que decir cuando la fuente no devolvio nada. */
  vacio: string;
  /** El resto del `structuredContent` (rut, año, y lo que sea). */
  base: Record<string, unknown>;
  /** Nombre del campo que lleva las filas. */
  campo: string;
  /** TODAS las filas que trajo la fuente, sin recortar. */
  filas: Record<string, unknown>[];
  offset: number;
  limit: number;
  tool: string;
  /** Columnas a mostrar. Por defecto todas las que traiga la fila. */
  columnas?: string[];
  /** Como se llaman las filas en el texto. Ej. "registros". */
  unidad?: string;
  /**
   * Llamadas al pie de la planilla, ya separadas de las filas de datos con
   * `separarNotas`. Llevan la unidad de las cifras y el significado de los
   * códigos, así que se repiten en TODAS las páginas: quien pide el tramo
   * 3 necesita saber que el patrimonio va en millones tanto como quien
   * pidió el tramo 1.
   */
  notas?: string[];
  /**
   * Filas de AGREGADO, ya separadas de las de datos con `separarTotales`.
   * Van aparte porque sumarlas junto a las series contamina cualquier
   * conteo o promedio, y se muestran igual porque «Total Sistema» es el dato
   * con el que se compara un fondo contra el mercado. No se paginan. son 1 o
   * 2 filas y pertenecen a la consulta entera, no a este tramo.
   */
  totales?: Record<string, unknown>[];
}): CallToolResult {
  const { titulo, vacio, base, campo, filas, offset, limit, tool, columnas, unidad, notas, totales } = opciones;
  const conNotas = { ...base, ...soloSiHay("notas", notas), ...soloSiHay("totales", totales) };
  if (filas.length === 0) {
    return toolOkPaginado(vacio, conNotas, campo, filas, offset, limit, tool);
  }
  const { filas: tramo, paginado } = paginar(filas, offset, limit);
  const cols = columnas ?? Object.keys(tramo[0] ?? filas[0] ?? {});
  const pie = pieDeTabla(notas, totales, unidad ?? "filas");
  const texto =
    `${titulo} (${filas.length} ${unidad ?? "filas"}):\n`
    + resumirTabla(tramo as Record<string, unknown>[], cols);
  return toolOk(texto + avisoDeTramo(tramo.length, paginado, tool) + pie, {
    ...conNotas,
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
  return `\n\n[Mostrando ${mostradas} filas de ${paginado.total}. Para las siguientes, llama ${tool} con offset=${paginado.next_offset}. Para traer todo de una vez, sube limit, que no tiene máximo.]`;
}
