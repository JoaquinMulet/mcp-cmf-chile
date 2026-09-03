import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { BEST_SITIO, bestJson, hoyEnChile, notaDeCache } from "../client/best.js";
import type { CmfEnv } from "../client/cmf-client.js";
import { decodificarEntidades } from "../client/parsers.js";
import { fromError } from "../util/errors.js";
import { filtrarFilas, filtrosLocales } from "../util/filtros.js";
import { filasSchema } from "../util/schemas-output.js";
import { enteroSchema, enumTolerante, fechaSchema } from "../util/schemas.js";
import { paginacion, toolOkTabla } from "../util/tramos.js";

/**
 * BEST, el sitio estadístico de la CMF. 5.180 cuadros y 34.023 series al 3
 * de septiembre de 2026 (catálogo CatalogoAPIBEST.csv). Bancos,
 * cooperativas, emisores de tarjetas, mutuarias, administradoras de fondos y
 * tasas de interés. Riesgo, actividad, red de atención, medios de pago,
 * clientes, desempeño, género y datos regionales.
 *
 * 3 tools. buscar en el catálogo, leer un cuadro, y las tasas TMC (que
 * vive en otros.ts desde antes y usa el mismo cliente).
 */

// ---------------------------------------------------------------------
// Tasas de interés corriente y máxima convencional
// ---------------------------------------------------------------------

interface TasaTmc {
  titulo: string;
  descripcion: string;
  tasa: number;
  tmc: number;
  tip: number;
  fechaPublicacion: string;
  fechaVigenciaHasta: string | null;
}

interface NotaTmc {
  nota: string;
  orden: string;
  ubicacionTmc: Array<{ tasa: number; tipo: string }>;
}

const PAGINA_TASAS = `${BEST_SITIO}/datos/tasas`;

/**
 * Las tasas y sus notas al pie, tal como las publica BEST para una fecha.
 * BEST entiende la fecha solo como AAAAMMDD; con guiones responde 500.
 */
export async function tasasTmcDeBest(fechaIso: string, env: CmfEnv): Promise<{ filas: Record<string, unknown>[]; notas: string[] }> {
  const aaaammdd = fechaIso.replace(/-/g, "");
  const que = "Tasas de interés";
  const [rTasas, rNotas] = await Promise.all([
    bestJson<{ result: TasaTmc[] }>(`/public/tmc/tasas/${aaaammdd}`, env, { que, paginaOficial: PAGINA_TASAS }),
    bestJson<{ result: NotaTmc[] }>(`/public/tmc/notas/${aaaammdd}`, env, { que, paginaOficial: PAGINA_TASAS }),
  ]);
  const tasas = rTasas.datos;
  const notas = rNotas.datos;
  const filas = (tasas.result ?? []).map((t) => ({ ...t }));
  // Cada nota dice a qué segmento y a qué tasa (tip o tmc) aplica. Eso se
  // escribe en la nota misma, porque el texto es lo único que lee el modelo.
  const textoNotas = (notas.result ?? []).map(
    (n) => `(${n.orden}) ${n.nota} Aplica a ${n.ubicacionTmc.map((u) => `la ${u.tipo} de la tasa ${u.tasa}`).join(" y ")}.`,
  );
  // Para una fecha futura BEST devuelve las tasas vigentes hoy, sin
  // decirlo. Se dice acá, porque una tasa «al 2027» que en realidad es la
  // de hoy es un dato engañoso.
  const hoy = hoyEnChile();
  const avisoFuturo = fechaIso > hoy ? [`La fecha ${fechaIso} es futura. BEST entrega las tasas vigentes hoy (${hoy}), publicadas en fechaPublicacion; no existe una publicación para esa fecha.`] : [];
  return { filas, notas: ["Tasas anuales, en porcentaje, publicadas en el Diario Oficial en fechaPublicacion.", ...avisoFuturo, ...textoNotas, ...notaDeCache(rTasas.cache)] };
}

// ---------------------------------------------------------------------
// Catálogo. el buscador del propio sitio (Azure AI Search)
// ---------------------------------------------------------------------

interface ResultadoBusqueda {
  Tipo: string;
  Url: string;
  Descripcion: string;
  Nombre: string;
  PalabrasClaves: string;
  EntidadSupervisada: string;
  NombreFrecuencia: string;
  Geografia: string;
  CategoriasConceptuales: string;
  FechaHoraUltimaVersion: string;
}

/** El texto de una sección «1.2 Unidad de medida» del HTML de la descripción, o vacío. */
function seccionDeDescripcion(html: string, titulo: RegExp): string {
  const m = new RegExp(`<h2>[^<]*${titulo.source}[^<]*</h2>\\s*<p>([\\s\\S]*?)</p>`, "i").exec(html);
  return m ? decodificarEntidades(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
}

/** Una fila plana por cuadro encontrado. El tag sale de la URL del resultado, que es lo único que lo trae. */
export function filaDeBusqueda(r: ResultadoBusqueda): Record<string, string> {
  const tag = /\/series\/cuadro\/([^/?#]+)/.exec(r.Url ?? "")?.[1] ?? "";
  return {
    tipo: r.Tipo ?? "",
    tag,
    nombre: decodificarEntidades(r.Nombre ?? ""),
    entidad: r.EntidadSupervisada ?? "",
    categoria: r.CategoriasConceptuales ?? "",
    frecuencia: r.NombreFrecuencia ?? "",
    unidad: seccionDeDescripcion(r.Descripcion ?? "", /Unidad de medida/),
    historico: seccionDeDescripcion(r.Descripcion ?? "", /Profundidad hist/),
    definicion: seccionDeDescripcion(r.Descripcion ?? "", /Definici/),
    palabras_clave: r.PalabrasClaves ?? "",
    actualizado: (r.FechaHoraUltimaVersion ?? "").slice(0, 10),
    url: `${BEST_SITIO}${r.Url ?? ""}`,
  };
}

// ---------------------------------------------------------------------
// Cuadros. la misma respuesta que dibuja el sitio
// ---------------------------------------------------------------------

interface SerieDeCuadro {
  codigo: string;
  descripcion: string;
  descripcionCorta?: string;
  descripcionDetallada?: string;
  observaciones: Array<{ fecha: number | string; valor: number | null }>;
  decimales?: number;
  notas?: Array<{ textoNota?: string } | string>;
  orden?: number;
}

interface Cuadro {
  tag: string;
  nombre: string;
  descripcion: string;
  series: SerieDeCuadro[];
  notas?: Array<{ textoNota?: string }>;
  fechasDisponibles?: Array<number | string>;
  rezago?: string;
  actualizacion?: string;
  nextUpdate?: string;
}

/** AAAAMMDD (número o texto) → AAAA-MM-DD. Las fechas de BEST vienen así. */
export function fechaDeBest(v: number | string): string {
  const s = String(v);
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

/**
 * El cuadro en formato largo. una fila por (fecha, serie). Un cuadro puede
 * tener 97 series, así que una fila por fecha con 97 columnas no cabe en
 * ningún texto; en formato largo cada fila es corta y se pagina igual.
 */
export function filasDeCuadro(c: Cuadro): Record<string, unknown>[] {
  const filas: Record<string, unknown>[] = [];
  for (const s of c.series ?? []) {
    for (const o of s.observaciones ?? []) {
      filas.push({ fecha: fechaDeBest(o.fecha), serie: s.codigo, descripcion: s.descripcion, valor: o.valor });
    }
  }
  return filas;
}

function notasDeCuadro(c: Cuadro): string[] {
  const notas = [
    `Cuadro ${c.tag}. ${c.nombre}. Unidad ${c.descripcion || "no declarada"}.`,
    ...(c.rezago || c.actualizacion ? [`Rezago ${c.rezago ?? "?"}; actualizado el ${c.actualizacion ?? "?"}; próxima actualización ${c.nextUpdate ?? "?"}.`] : []),
    ...(c.notas ?? []).map((n) => n.textoNota ?? "").filter(Boolean),
  ];
  const fechas = c.fechasDisponibles ?? [];
  if (fechas.length) notas.push(`Fechas disponibles en BEST. ${fechas.length}, desde ${fechaDeBest(fechas[0])} hasta ${fechaDeBest(fechas[fechas.length - 1])}.`);
  return notas;
}

/** La ruta del servicio para cada modo. Las fechas viajan como AAAAMMDD. */
function rutaDeCuadro(tag: string, modo: "ultimos" | "rango" | "completo", p: { periodos: number; desde?: string; hasta?: string }): string {
  const t = encodeURIComponent(tag);
  if (modo === "completo") return `/public/Cuadrosv3/tag/${t}`;
  if (modo === "rango") {
    if (!p.desde) throw new Error("El modo rango necesita desde (YYYY-MM-DD).");
    return `/public/Cuadrosv3?FechaInicio=${p.desde.replace(/-/g, "")}&FechaFin=${(p.hasta ?? hoyEnChile()).replace(/-/g, "")}&Tag=${t}`;
  }
  return `/public/Cuadrosv3?NumPeriodos=${p.periodos}&Tag=${t}`;
}

/** Unos endpoints envuelven el cuadro en `result` y otros no. */
function desenvolverCuadro(crudo: Cuadro | { result: Cuadro }, que: string, paginaOficial: string): Cuadro {
  const cuadro = "result" in crudo && crudo.result && !("series" in crudo) ? crudo.result : (crudo as Cuadro);
  if (!cuadro || !Array.isArray(cuadro.series)) {
    throw new Error(`${que}: la respuesta no trae series; el tag puede no existir. Verifique en ${paginaOficial}.`);
  }
  return cuadro;
}

function tituloDelTramo(modo: "ultimos" | "rango" | "completo", p: { periodos: number; desde?: string; hasta?: string }): string {
  if (modo === "completo") return "historia completa";
  if (modo === "rango") return `${p.desde} a ${p.hasta ?? hoyEnChile()}`;
  return `últimos ${p.periodos} periodos`;
}

export function registrarToolsBest(server: McpServer, env: CmfEnv): void {
  server.registerTool(
    "cmf_best_buscar",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Buscar cuadros en BEST, el sitio estadístico de la CMF",
      description:
        "Busca cuadros de datos en BEST, el sitio estadístico de la CMF (best.cmfchile.cl), con el mismo buscador que usa el sitio. BEST tiene 5.180 cuadros y 34.023 series sobre bancos, cooperativas, emisores de tarjetas, mutuarias hipotecarias, administradoras de fondos y tasas de interés, en 9 categorías. riesgo, actividad, red de atención, cuentas y medios de pago, clientes, tasas de interés, desempeño, género y regional. Escriba la pregunta en lenguaje natural con consulta (ej: 'colocaciones de vivienda por banco', 'cajeros automáticos por región', 'tasa de depósitos a plazo') y reciba hasta 1000 cuadros ordenados por relevancia, cada uno con su tag, nombre, entidad, categoría, frecuencia, unidad de medida y profundidad histórica. Acote con texto (entidad, categoría o palabra del nombre) y con offset y limit. Con el tag pida los datos a cmf_best_cuadro. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        consulta: z.string().min(2).describe("Qué busca, en lenguaje natural. Ej: colocaciones de vivienda por banco"),
        texto: filtrosLocales.texto.describe("Se queda con los resultados donde algún campo contiene este texto, por ejemplo la entidad 'Cooperativas' o la categoría 'Riesgo'. Se aplica en el servidor"),
        ...paginacion(50),
      }),
    },
    async ({ consulta, texto, offset, limit }) => {
      try {
        const { datos: resultados, cache } = await bestJson<ResultadoBusqueda[]>("/aisearch/aisearch", env, {
          que: "Buscador de BEST",
          paginaOficial: `${BEST_SITIO}/buscador`,
          // El buscador ignora `top` (medido el 3 de septiembre de 2026: pide 3 y
          // devuelve 1000). Se manda igual, que es lo que manda el sitio, y el
          // recorte lo hace la paginación de acá.
          cuerpo: { query: consulta, top: 200 },
        });
        const filas = filtrarFilas((resultados ?? []).map(filaDeBusqueda), { texto });
        return toolOkTabla({
          titulo: `Cuadros de BEST para «${consulta}»`,
          vacio: `El buscador de BEST no encontró cuadros para «${consulta}». Pruebe con otras palabras; el buscador entiende lenguaje natural.`,
          base: { consulta, texto },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_best_buscar",
          unidad: "cuadros",
          columnas: ["tipo", "tag", "nombre", "entidad", "categoria", "frecuencia", "unidad", "historico"],
          notas: [...notaDeCache(cache), "El buscador de BEST ordena por relevancia y devuelve hasta 1000 resultados; el tag es el identificador que pide cmf_best_cuadro. Las filas de tipo datos_reportes son informes PDF o Excel del sitio, no cuadros, y no tienen tag. El catálogo completo, en CSV, está en https://bestsbif.blob.core.windows.net/bestcontainer/CatalogoAPIBEST.csv."],
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_best_cuadro",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Datos de un cuadro de BEST",
      description:
        "Devuelve los datos de un cuadro de BEST, el sitio estadístico de la CMF, con una fila por fecha y serie (fecha, código de la serie, descripción y valor), más la unidad, el rezago, la fecha de actualización y las notas del cuadro. Identifique el cuadro con tag (lo entrega cmf_best_buscar; ej: SBIF_CONT_EPLME_ACTIV_COL_TOT_CART). Elija el tramo con modo. ultimos (default; los últimos periodos periodos, default 12), rango (desde y hasta en YYYY-MM-DD, sin tope de meses) o completo (toda la historia; un cuadro grande trae decenas de miles de filas, pida por tramos). Use serie para quedarse con una serie por su código o parte de su descripción. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        tag: z.string().min(3).describe("Tag del cuadro, como lo entrega cmf_best_buscar. Ej: SBIF_CONT_EPLME_ACTIV_COL_TOT_CART"),
        modo: enumTolerante(["ultimos", "rango", "completo"]).default("ultimos").describe("ultimos (default), rango (desde y hasta) o completo (toda la historia)"),
        periodos: enteroSchema().min(1).default(12).describe("Cuántos periodos traer en modo ultimos (default 12)"),
        desde: fechaSchema.optional().describe("Inicio del rango en YYYY-MM-DD (modo rango)"),
        hasta: fechaSchema.optional().describe("Fin del rango en YYYY-MM-DD (modo rango; default hoy)"),
        serie: filtrosLocales.texto.describe("Se queda con las filas cuya serie contiene este texto, en el código o en la descripción. Se aplica en el servidor"),
        ...paginacion(200),
      }),
    },
    async ({ tag, modo, periodos, desde, hasta, serie, offset, limit }) => {
      try {
        const paginaOficial = `${BEST_SITIO}/series/cuadro/${tag}`;
        const que = `Cuadro ${tag} de BEST`;
        const ruta = rutaDeCuadro(tag, modo as "ultimos" | "rango" | "completo", { periodos, desde, hasta });
        const respuesta = await bestJson<Cuadro | { result: Cuadro }>(ruta, env, { que, paginaOficial });
        const cuadro = desenvolverCuadro(respuesta.datos, que, paginaOficial);
        const filas = filtrarFilas(filasDeCuadro(cuadro), { texto: serie });
        return toolOkTabla({
          titulo: `${cuadro.nombre} ${cuadro.descripcion ?? ""} (${tituloDelTramo(modo as "ultimos" | "rango" | "completo", { periodos, desde, hasta })})`,
          vacio: `El cuadro ${tag} no trae observaciones para ese tramo y ese filtro de serie. Las fechas disponibles están en las notas.`,
          base: { tag, modo, periodos, desde, hasta, serie, nombre: cuadro.nombre, unidad: cuadro.descripcion, series: (cuadro.series ?? []).map((s) => ({ codigo: s.codigo, descripcion: s.descripcion })) },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_best_cuadro",
          unidad: "observaciones",
          notas: [...notasDeCuadro(cuadro), ...notaDeCache(respuesta.cache)],
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );
}
