import { enteroSchema } from "./schemas.js";
import { bytesABase64 } from "./zip.js";

/**
 * Un archivo entero dentro de una respuesta MCP no cabe. El 2 de septiembre
 * de 2026 un PDF de 339 KB produjo 462.000 caracteres de base64 y desbordó
 * al cliente, y el servidor corre en un Worker sin disco donde guardarlo.
 * Así que el binario se entrega en TRAMOS de base64, con el total y el
 * offset del siguiente, igual que el texto de un documento. Nunca se
 * recorta sin decir cómo pedir el resto.
 */
const TRAMO_BASE64_POR_DEFECTO = 200_000;

export const paginacionBase64 = {
  offset_chars: enteroSchema().min(0).default(0).describe("Carácter del base64 donde empieza el tramo (default 0)"),
  max_chars: enteroSchema()
    .min(1000)
    .default(TRAMO_BASE64_POR_DEFECTO)
    .describe(
      `Tamaño del tramo de base64 en caracteres (default ${TRAMO_BASE64_POR_DEFECTO}, unos 150 KB de archivo). Sin máximo: un número grande trae el archivo entero. En modo código pídalo entero, porque se queda dentro del programa.`,
    ),
};

export interface TramoBase64 {
  base64: string;
  offset_chars: number;
  siguiente_offset_chars: number | null;
  total_chars: number;
  /** true cuando este tramo trae el archivo de punta a punta. */
  base64_completo: boolean;
}

/** El tramo pedido del base64 de `bytes`, con lo que hace falta para pedir el resto. */
export function tramoBase64(bytes: Uint8Array, offsetChars: number, maxChars: number): TramoBase64 {
  const todo = bytesABase64(bytes);
  // Los cortes caen en múltiplos de 4, así que cada tramo se decodifica
  // solo, y un tramo nunca es vacío mientras quede archivo.
  const paso = Math.max(4, maxChars - (maxChars % 4));
  const desde = Math.min(Math.max(offsetChars - (offsetChars % 4), 0), todo.length);
  const hasta = Math.min(desde + paso, todo.length);
  return {
    base64: todo.slice(desde, hasta),
    offset_chars: desde,
    siguiente_offset_chars: hasta < todo.length ? hasta : null,
    total_chars: todo.length,
    base64_completo: desde === 0 && hasta === todo.length,
  };
}

/** La frase que le dice al modelo qué tramo recibió y cómo sigue. */
export function avisoDeTramoBase64(t: TramoBase64, tool: string): string {
  if (t.base64_completo) return `El base64 viene completo (${t.total_chars} caracteres) en structuredContent para llamadores programáticos.`;
  if (t.base64 === "") return `offset_chars=${t.offset_chars} está fuera del archivo: el base64 tiene ${t.total_chars} caracteres.`;
  return t.siguiente_offset_chars === null
    ? `Último tramo del base64: caracteres ${t.offset_chars}-${t.total_chars} de ${t.total_chars}.`
    : `Tramo ${t.offset_chars}-${t.siguiente_offset_chars} de ${t.total_chars} caracteres de base64. El archivo SIGUE: llame ${tool} con offset_chars=${t.siguiente_offset_chars}, o suba max_chars para traerlo entero.`;
}
