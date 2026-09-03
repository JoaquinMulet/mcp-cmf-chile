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
  desde: fechaSchema.optional().describe("Fecha mínima en YYYY-MM-DD, comparada con el campo de fecha de la fila (dd/mm/aaaa o aaaa-mm-dd)"),
  hasta: fechaSchema.optional().describe("Fecha máxima en YYYY-MM-DD, comparada con el campo de fecha de la fila"),
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

/** Aplica texto, desde y hasta sobre filas ya bajadas. El campo de fecha es el primero que parezca fecha. */
export function filtrarFilas<T extends Record<string, unknown>>(
  filas: T[],
  filtro: { texto?: string; desde?: string; hasta?: string },
): T[] {
  const { texto, desde, hasta } = filtro;
  if (!texto && !desde && !hasta) return filas;
  const buscado = texto ? plano(texto) : "";
  return filas.filter((f) => {
    if (buscado && !plano(Object.values(f).map((v) => String(v ?? "")).join(" ")).includes(buscado)) return false;
    if (desde || hasta) {
      const fecha = Object.values(f).map(fechaIso).find((x) => x !== undefined);
      if (!fecha) return false;
      if (desde && fecha < desde) return false;
      if (hasta && fecha > hasta) return false;
    }
    return true;
  });
}
