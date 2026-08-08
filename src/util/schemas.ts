import * as z from "zod/v4";

/**
 * Schemas de entrada flexibles: aceptan lo que escriben personas y modelos
 * y normalizan antes de validar. Los mensajes de error son accionables.
 */

/** Fecha canónica YYYY-MM-DD; acepta también DD/MM/YYYY y DD-MM-YYYY. */
export const fechaSchema = z.preprocess(
  (v) => {
    const s = String(v ?? "").trim();
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return s;
  },
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA)"),
);

/** Año: acepta número o string ("2026" o 2026). */
export const anioSchema = z.preprocess(
  (v) => (typeof v === "number" ? String(v) : String(v ?? "").trim()),
  z.string().regex(/^\d{4}$/, "Año en formato AAAA (acepta 2026 o '2026')"),
);

/** Mes: acepta número o string; 3 → "03". */
export const mesSchema = z.preprocess(
  (v) => (typeof v === "number" ? String(v).padStart(2, "0") : String(v ?? "").trim()),
  z.string().regex(/^(0[1-9]|1[0-2])$/, "Mes en formato MM (01-12; acepta 3 o '03')"),
);

/** Mes de corte trimestral de EEFF: solo 03/06/09/12; acepta número (3 → "03"). */
export const mesCorteSchema = z.preprocess(
  (v) => (typeof v === "number" ? String(v).padStart(2, "0") : String(v ?? "").trim()),
  z.enum(["03", "06", "09", "12"], {
    message: "Mes de corte trimestral: 03, 06, 09 o 12 (acepta 3 o '03')",
  }),
);

/** Día: acepta número o string; 1 → "01". */
export const diaSchema = z.preprocess(
  (v) => (typeof v === "number" ? String(v).padStart(2, "0") : String(v ?? "").trim()),
  z.string().regex(/^(0[1-9]|[12]\d|3[01])$/, "Día en formato DD (acepta 1 o '01')"),
);

/** RUT: acepta 90749000, 90.749.000, 90749000-0, 90.749.000-0. Normaliza a dígitos. */
export const rutSchema = z.preprocess(
  (v) => String(v ?? "").replace(/[.\s]/g, "").replace(/-.*$/, ""),
  z.string().regex(/^\d{6,9}$/, "RUT inválido. Acepto: 90749000, 90.749.000, 90749000-0 o 90.749.000-0"),
);

/** Serie de indicador: acepta mayúsculas y minúsculas; normaliza a minúsculas. */
export const serieIndicadorSchema = z.preprocess(
  (v) => String(v ?? "").trim().toLowerCase(),
  z.enum(["uf", "dolar", "euro", "tab", "utm", "ipc", "tip", "tmc"], {
    message: "Serie inválida. Use: uf, dolar, euro, tab, utm, ipc, tip o tmc (mayúsculas ok)",
  }),
);

export const mercadoSchema = z.preprocess(
  (v) => String(v ?? "").trim().toUpperCase(),
  z.enum(["V", "O", "S"], { message: "Mercado inválido. Use V (valores), O (otros) o S (seguros)" }),
);

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
