import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { fondosSchema, comisionesMaximasSchema } from "../util/schemas-output.js";
import { postLegacy, getLegacyBinario, postLegacyBinario, type CmfEnv } from "../client/cmf-client.js";
import { xlsAJson, txtCsvAJson, htmlTablaAJson } from "../client/parsers.js";
import { fromError, toolOk, resumirTabla } from "../util/errors.js";
import { paginar } from "../util/paginate.js";
import { anioSchema, carteraSchema, mesSchema, offsetSchema, limitSchema } from "../util/schemas.js";

const COLS_IDENT = [
  "rut_admin",
  "razon_admin",
  "run_fondo",
  "nombre_fondo",
  "nombre_corto",
  "fecha_res_ri",
  "nro_res_ri",
  "tipo_fondo",
  "fecha_inicio",
  "fecha_termino",
  "moneda",
];

/** Descarga y parsea el catálogo completo de FM (fm_ident2) con caché en KV (24h) cuando está disponible. */
async function catalogoFondosMutuos(env: CmfEnv): Promise<Record<string, unknown>[]> {
  const clave = "catalogo:fm_ident_v1";
  if (env.CMF_KV) {
    const raw = await env.CMF_KV.get(clave);
    if (raw) {
      try {
        return JSON.parse(raw) as Record<string, unknown>[];
      } catch {
        /* re-descargar */
      }
    }
  }
  const res = await postLegacy("/institucional/estadisticas/fm_ident2.php", {}, env);
  const filas = txtCsvAJson(res) as unknown as Record<string, unknown>[];
  if (env.CMF_KV) {
    await env.CMF_KV.put(clave, JSON.stringify(filas), { expirationTtl: 86_400 });
  }
  return filas;
}

export function registrarToolsFondosMutuos(server: McpServer, env: CmfEnv): void {
  server.registerTool(
    "cmf_fondos_mutuos_catalogo",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Catálogo de Fondos Mutuos",
      description:
        "Catálogo completo de fondos mutuos de la CMF (RUT administradora, RUN fondo, nombre, tipo de fondo, moneda, fechas de inicio/término). Filtrable por nombre y paginado.",
      inputSchema: z.object({
        nombre: z.string().optional().describe("Filtro por nombre del fondo (parcial)"),
        tipo: z.string().optional().describe("Filtro por tipo de fondo"),
        offset: offsetSchema,
        limit: limitSchema,
      }),
      outputSchema: z.object({
        fondos: z.array(z.record(z.string(), z.unknown())),
        total: z.number(),
        next_offset: z.number().nullable(),
      }),
    },
    async ({ nombre, tipo, offset, limit }) => {
      try {
        let filas = await catalogoFondosMutuos(env);
        if (nombre) {
          const q = nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          filas = filas.filter((f) =>
            String(f.nombre_fondo ?? "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .includes(q),
          );
        }
        if (tipo) filas = filas.filter((f) => String(f.tipo_fondo ?? "").includes(tipo));
        const { filas: fondos, paginado } = paginar(filas, offset, limit);
        const texto = fondos.length
          ? `Fondos mutuos (total ${paginado.total}):\n${resumirTabla(fondos, ["run_fondo", "nombre_fondo", "tipo_fondo", "moneda", "rut_admin"])}`
          : "Sin fondos mutuos que coincidan.";
        return toolOk(texto, { fondos, total: paginado.total, next_offset: paginado.next_offset });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_cartera",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Cartera de inversiones de Fondos Mutuos",
      description:
        "Cartera de inversiones de fondos mutuos por mes (nacional, extranjera, opciones, futuros, opciones largo plazo). Columnas con códigos de la Circular 1333.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema,
        cartera: carteraSchema,
      }),
    },
    async ({ anio, mes, cartera }) => {
      try {
        const res = await postLegacy(
          "/institucional/estadisticas/ffm_download.php",
          { aa: anio, mm: mes, cartera, enviar: "", btnConsulta: "GENERAR ARCHIVO" },
          env,
        );
        const filas = txtCsvAJson(res);
        const { filas: paginadas, paginado } = paginar(filas, 0, 50);
        const texto = paginadas.length
          ? `Cartera ${cartera} ${anio}-${mes}: ${paginado.total} fondos con posiciones. Ejemplo:\n${resumirTabla(paginadas.slice(0, 5), Object.keys(paginadas[0] ?? {}).slice(0, 6))}`
          : `Sin cartera ${cartera} para ${anio}-${mes}.`;
        return toolOk(texto, { anio, mes, cartera, total: paginado.total, filas: paginadas });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_comisiones",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Comisiones y remuneraciones de FM",
      description:
        "Estructura de comisiones de colocación, remuneraciones de administración y gastos de operación por fondo/serie de fondos mutuos.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema.optional(),
        admin: z.string().optional().describe("RUT de administradora (0=todas)"),
        tipo_fondo: z.string().optional().describe("0-8"),
        moneda: z.enum(["0", "$$", "PROM", "EUR"]).optional(),
      }),
    },
    async ({ anio, mes, admin, tipo_fondo, moneda }) => {
      try {
        const res = await getLegacyBinario(
          "/institucional/estadisticas/fm.fm_comision.php",
          { out: "excel", admins: admin ?? "0", tipofondo: tipo_fondo ?? "0", moneda: moneda ?? "0", mes: mes ?? "12", anio },
          env,
        );
        const filas = xlsAJson(res);
        const { filas: paginadas, paginado } = paginar(filas, 0, 50);
        const texto = paginadas.length
          ? `Comisiones FM ${anio}-${mes ?? "12"} (${paginado.total} filas):\n${resumirTabla(paginadas.slice(0, 5), Object.keys(paginadas[0] ?? {}).slice(0, 8))}`
          : `Sin comisiones para ${anio}-${mes}.`;
        return toolOk(texto, { anio, mes, total: paginado.total, filas: paginadas });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_inversiones",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Inversiones de Fondos Mutuos",
      description: "Inversiones de fondos mutuos en instrumentos nacionales o extranjeros por período.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema.optional(),
        tipo: z.enum(["nacio", "inter"]).default("nacio"),
        consulta: z.enum(["fondos", "emisores", "pais_transaccion"]).optional(),
      }),
    },
    async ({ anio, mes, tipo, consulta }) => {
      try {
        const path =
          tipo === "nacio"
            ? "/institucional/estadisticas/fm.inversiones_nacio.php"
            : "/institucional/estadisticas/fm.inversiones_inter.php";
        const res = await getLegacyBinario(
          path,
          { out: "excel", lang: "es", consulta: consulta ?? "fondos", admins: "0", tipofondo: "0", moneda: "0", mes: mes ?? "12", anio },
          env,
        );
        const filas = xlsAJson(res);
        const { filas: paginadas, paginado } = paginar(filas, 0, 50);
        const texto = paginadas.length
          ? `Inversiones ${tipo} FM ${anio}-${mes ?? "12"} (${paginado.total} filas):\n${resumirTabla(paginadas.slice(0, 5), Object.keys(paginadas[0] ?? {}).slice(0, 8))}`
          : `Sin inversiones ${tipo} para ${anio}-${mes}.`;
        return toolOk(texto, { anio, mes, tipo, total: paginado.total, filas: paginadas });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_bpr",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Patrimonio, rentabilidad y partícipes de FM",
      description:
        "Patrimonio, variación, rentabilidad nominal mensual, número de partícipes y valor cuota por serie de fondos mutuos (Boletín de Patrimonio y Rentabilidad).",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema.optional(),
        admin: z.string().optional(),
      }),
    },
    async ({ anio, mes, admin }) => {
      try {
        const res = await getLegacyBinario(
          "/institucional/estadisticas/fm.fm_bpr.php",
          { out: "excel", admins: admin ?? "0", tipofondo: "0", moneda: "0", mes_peri: mes ?? "12", anio_peri: anio },
          env,
        );
        const filas = xlsAJson(res);
        const { filas: paginadas, paginado } = paginar(filas, 0, 50);
        const texto = paginadas.length
          ? `BPR FM ${anio}-${mes ?? "12"} (${paginado.total} series):\n${resumirTabla(paginadas.slice(0, 5), ["Run Fondo", "Nombre Fondo", "Patrimonio", "Valor cuota", "Partícipes", "Rentabilidad nominal mensual"])}`
          : `Sin BPR para ${anio}-${mes}.`;
        return toolOk(texto, { anio, mes, total: paginado.total, filas: paginadas });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_costos",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Cuadro de costos de FM (TAC)",
      description:
        "Cuadro estadístico de costos de fondos mutuos: remuneración fija/variable, gastos de operación y TAC (costo total anual) por serie.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema.optional(),
        admin: z.string().optional(),
      }),
    },
    async ({ anio, mes, admin }) => {
      try {
        const res = await postLegacyBinario(
          "/institucional/estadisticas/fmdfm_excel2.php",
          { admins: admin ?? "0", tipofondo: "0", moneda: "0", mes2: mes ?? "12", anno2: anio },
          env,
          { lang: "es" },
        );
        const filas = xlsAJson(res);
        const { filas: paginadas, paginado } = paginar(filas, 0, 50);
        const texto = paginadas.length
          ? `Costos FM ${anio}-${mes ?? "12"} (${paginado.total} filas):\n${resumirTabla(paginadas.slice(0, 5), Object.keys(paginadas[0] ?? {}).slice(0, 8))}`
          : `Sin costos para ${anio}-${mes}.`;
        return toolOk(texto, { anio, mes, total: paginado.total, filas: paginadas });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_antecedentes",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Antecedentes generales del sistema FM",
      description:
        "Serie histórica de antecedentes generales del sistema de fondos mutuos: número de administradoras, fondos, patrimonio total y partícipes por diciembre de cada año.",
      inputSchema: z.object({ anio: anioSchema.optional() }),
    },
    async ({ anio }) => {
      try {
        const res = await getLegacyBinario(
          "/institucional/estadisticas/fm.ffmm_agenerales.php",
          { out: "excel", lang: "es", filtertipofondo: "0", filtermoneda: "0", moneda: "0", mes: anio ? "12" : "12", anio: anio ?? "2025" },
          env,
        );
        const filas = xlsAJson(res);
        const { filas: paginadas, paginado } = paginar(filas, 0, 50);
        const texto = paginadas.length
          ? `Antecedentes generales FM (${paginado.total} filas):\n${resumirTabla(paginadas.slice(0, 10), Object.keys(paginadas[0] ?? {}).slice(0, 5))}`
          : "Sin antecedentes.";
        return toolOk(texto, { total: paginado.total, filas: paginadas });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_cartola",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Cartola diaria de Fondos Mutuos",
      description:
        "Cartola diaria (valor cuota, patrimonio, partícipes por día) de un fondo mutuo en un rango de fechas. Requiere captcha de la CMF: si no se entrega, la tool lo solicitará.",
      inputSchema: z.object({
        fondo: z.string().describe("RUN del fondo (búsquelo con cmf_fondos_mutuos_catalogo)"),
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        captcha: z.string().length(6).optional(),
      }),
    },
    async ({ fondo, desde, hasta, captcha }) => {
      try {
        if (!captcha) {
          return {
            content: [
              {
                type: "text",
                text: "Esta consulta requiere un captcha de la CMF. Pida al usuario el código de 6 caracteres de la imagen captcha (resource cmf://captcha/{id}) y reintente con el parámetro captcha.",
              },
            ],
            isError: true,
          };
        }
        const [a1, m1, d1] = desde.split("-");
        const [a2, m2, d2] = hasta.split("-");
        const html = await postLegacy(
          "/institucional/estadisticas/fondos_cartola_diaria.php",
          {
            ffmm: fondo,
            txt_inicio: `${d1}/${m1}/${a1}`,
            txt_termino: `${d2}/${m2}/${a2}`,
            enviar: "Buscar",
            btnConsulta: "GENERAR ARCHIVO",
            captcha,
          },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Cartola diaria fondo ${fondo} (${filas.length} días):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin cartola para el fondo en el rango (o captcha inválido).";
        return toolOk(texto, { fondo, desde, hasta, filas: filas.slice(0, 400) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_comisiones_maximas",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: comisionesMaximasSchema,
      title: "Comisiones máximas para fondos de pensiones/cesantía",
      description:
        "Comisiones máximas que los fondos mutuos y fondos de inversión pueden cobrar a los Fondos de Pensiones (Circular 1951) y de Cesantía (Circular 1965), con los documentos XLS mensuales por administradora.",
      inputSchema: z.object({
        tipo: z.enum(["fm", "fi"]).default("fm"),
        circular: z.enum(["1951", "1965"]).default("1951"),
        anio: anioSchema,
      }),
    },
    async ({ tipo, circular, anio }) => {
      try {
        const pagina = tipo === "fm" ? `consultaFm${circular}` : `consultaFi${circular}`;
        const html = await postLegacy(
          `/institucional/estadisticas/foppc/index.php?pagina=paginas.${pagina}`,
          { funcion: "obtener_datos_grilla", periodo: anio },
          env,
        );
        const administradoras = [...html.matchAll(/<legend>\s*<strong>?([^<]+)/g)].map((m) =>
          m[1].replace(/\s+/g, " ").trim(),
        );
        const xlsCount = (html.match(/ver_sgd\.php\?s567=/g) ?? []).length;
        const texto = administradoras.length
          ? `Comisiones máximas ${tipo.toUpperCase()} Circular ${circular} ${anio}: ${administradoras.length} administradoras reportaron, ${xlsCount} documentos XLS disponibles. Administradoras: ${administradoras.slice(0, 10).join("; ")}`
          : `Sin reportes de comisiones máximas para ${anio}.`;
        return toolOk(texto, { tipo, circular, anio, administradoras, documentos_xls: xlsCount });
      } catch (e) {
        return fromError(e);
      }
    },
  );
}
