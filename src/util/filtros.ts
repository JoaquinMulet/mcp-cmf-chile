import * as z from "zod/v4";
import { fechaSchema } from "./schemas.js";

/**
 * Filtros LOCALES para las tablas que la CMF entrega enteras y sin ningún
 * filtro propio (tomas de control, comunicaciones, pólizas prohibidas,
 * producción de corredores, cartera de fondos mutuos). El 2 de septiembre
 * de 2026 la única forma de encontrar una sociedad en 261 tomas de control
 * o una compañía en 25.428 filas de producción era paginar. Se filtra
 * DESPUÉS de bajar la tabla entera, así que el total que se informa es el
 * de las filas que cumplen el filtro, y sin filtro nada cambia.
 */
export const filtrosLocales = {
  texto: z
    .string()
    .optional()
    .describe("Se queda con las filas donde algún campo contiene este texto (sin acentos ni mayúsculas importa). Ej: 'Parque Arauco'"),
  desde: fechaSchema.optional().describe("Fecha mínima en YYYY-MM-DD, comparada con el primer campo de la fila que tenga forma de fecha (dd/mm/aaaa o aaaa-mm-dd); una fila sin ningún campo de fecha queda fuera"),
  hasta: fechaSchema.optional().describe("Fecha máxima en YYYY-MM-DD, comparada con el mismo campo de fecha; una fila sin fecha queda fuera"),
};

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Una fecha de la CMF (dd/mm/aaaa, dd.mm.aaaa o aaaa-mm-dd) como aaaa-mm-dd, o undefined. */
export function fechaIso(valor: unknown): string | undefined {
  const s = String(valor ?? "").trim();
  const m = /^(\d{2})[/.](\d{2})[/.](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? iso[0] : undefined;
}

/** true si algún campo de la fila contiene el texto buscado, ya en plano. */
function cumpleTexto(fila: Record<string, unknown>, buscado: string): boolean {
  return plano(Object.values(fila).map((v) => String(v ?? "")).join(" ")).includes(buscado);
}

/** true si el primer campo con forma de fecha cae dentro del rango. Sin fecha, false. */
function cumpleFechas(fila: Record<string, unknown>, desde?: string, hasta?: string): boolean {
  const fecha = Object.values(fila).map(fechaIso).find((x) => x !== undefined);
  if (!fecha) return false;
  return (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
}

/** Aplica texto, desde y hasta sobre filas ya bajadas. El campo de fecha es el primero que parezca fecha. */
export function filtrarFilas<T extends Record<string, unknown>>(
  filas: T[],
  filtro: { texto?: string; desde?: string; hasta?: string },
): T[] {
  const { texto, desde, hasta } = filtro;
  const buscado = texto ? plano(texto) : "";
  const conFechas = Boolean(desde || hasta);
  if (!buscado && !conFechas) return filas;
  return filas.filter((f) => (!buscado || cumpleTexto(f, buscado)) && (!conFechas || cumpleFechas(f, desde, hasta)));
}
