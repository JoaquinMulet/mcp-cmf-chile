import * as z from "zod/v4";

/**
 * Schemas de entrada flexibles: aceptan lo que escriben personas y modelos
 * y normalizan antes de validar. Los mensajes de error son accionables.
 *
 * IMPORTANTE: nada de z.preprocess — zod 4.4.3 lo excluye del array `required`
 * del JSON Schema servido (camino ~standard.jsonSchema). transform/pipe/refine
 * sí lo preservan (verificado en test/tdqs.test.ts).
 */

/** Fecha canónica YYYY-MM-DD; acepta también DD/MM/YYYY y DD-MM-YYYY. */
export const fechaSchema = z
  .union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha en formato YYYY-MM-DD"),
    z.string().regex(/^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}$/, "Fecha en formato DD/MM/AAAA"),
  ])
  .transform((s) => {
    const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
  })
  .describe("Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31");

/** Año: acepta número o string ("2026" o 2026). */
export const anioSchema = z
  .coerce.string()
  .regex(/^\d{4}$/, "Año en formato AAAA (acepta 2026 o '2026')")
  .describe("Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025");

/** Mes: acepta número o string; 3 → "03". */
export const mesSchema = z
  .coerce.string()
  .regex(/^\d{1,2}$/, "Mes en formato MM (01-12; acepta 3 o '03')")
  .transform((s) => s.padStart(2, "0"))
  .pipe(z.string().regex(/^(0[1-9]|1[0-2])$/, "Mes en formato MM (01-12; acepta 3 o '03')"))
  .describe("Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03");

/** Mes de corte trimestral de EEFF: solo 03/06/09/12; acepta número (3 → "03"). */
export const mesCorteSchema = z
  .coerce.string()
  .transform((s) => s.padStart(2, "0"))
  .pipe(z.enum(["03", "06", "09", "12"], { message: "Mes de corte trimestral: 03, 06, 09 o 12 (acepta 3 o '03')" }))
  .describe("Mes de corte trimestral de EEFF: 03, 06, 09 o 12 (acepta 3 o '03')");

/** Día: acepta número o string; 1 → "01". */
export const diaSchema = z
  .coerce.string()
  .regex(/^\d{1,2}$/, "Día en formato DD (acepta 1 o '01')")
  .transform((s) => s.padStart(2, "0"))
  .pipe(z.string().regex(/^(0[1-9]|[12]\d|3[01])$/, "Día en formato DD (acepta 1 o '01')"))
  .describe("Día en formato DD (acepta 1 o '01'). Ej: 15");

/** RUT: acepta 90749000, 90.749.000, 90749000-0, 90.749.000-0. Normaliza a dígitos (recorta el DV). */
export const rutSchema = z
  .coerce.string()
  .transform((s) => s.replace(/[.\s]/g, "").replace(/-.*$/, ""))
  .pipe(z.string().regex(/^\d{6,9}$/, "RUT inválido. Acepto: 90749000, 90.749.000, 90749000-0 o 90.749.000-0"))
  .describe("RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000");

/** Serie de indicador: acepta mayúsculas y minúsculas; normaliza a minúsculas. */
export const serieIndicadorSchema = z
  .coerce.string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.enum(["uf", "dolar", "euro", "tab", "utm", "ipc", "tip", "tmc"], {
    message: "Serie inválida. Use: uf, dolar, euro, tab, utm, ipc, tip o tmc (mayúsculas ok)",
  }))
  .describe("Serie de indicador: uf, dolar, euro, tab, utm, ipc, tip o tmc (mayúsculas ok)");

export const mercadoSchema = z
  .coerce.string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.enum(["V", "O", "S"], { message: "Mercado inválido. Use V (valores), O (otros) o S (seguros)" }))
  .describe("Mercado: V (valores), O (otros) o S (seguros)");

export const tipoEntidadSchema = z
  .string()
  .describe("Tipo de entidad supervisada (ej: RVEMI = emisores de valores)");

export const offsetSchema = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe("Desplazamiento para paginación");

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(500)
  .default(100)
  .describe("Límite de filas (máx 500)");

export const carteraSchema = z
  .enum(["NACI", "EXTR", "OPCI", "FUTU", "OPLA"])
  .describe("Tipo de cartera: NACI=nacional, EXTR=extranjera, OPCI=opciones, FUTU=futuros, OPLA=opciones largo plazo");

export const tipoNormaSchema = z
  .enum(["ALL", "CIR", "OFC", "NCG"])
  .describe("Tipo de norma: ALL=todos, CIR=circular, OFC=oficio, NCG=norma de carácter general");

export const tipoBalanceSchema = z
  .enum(["C", "I"])
  .default("C")
  .describe("Tipo de balance: C=Consolidado (default), I=Individual");

export const tipoNormaContableSchema = z
  .enum(["IFRS", "NCH"])
  .default("IFRS")
  .describe("Norma contable: IFRS (default) o NCH (Chilean GAAP)");

/** Código (institución, fondo, cuenta): acepta número o string; normaliza a string. */
export const codigoSchema = z
  .coerce.string()
  .pipe(z.string().min(1, "Código requerido"))
  .describe("Código (institución, fondo o cuenta); acepta 8298 o '8298'");

/** Enum de strings que además acepta números ("1951" o 1951). */
export function enumTolerante<T extends readonly [string, ...string[]]>(valores: T) {
  return z
    .coerce.string()
    .pipe(z.enum(valores))
    .describe(`Uno de: ${valores.join(", ")} (acepta número o string)`);
}
