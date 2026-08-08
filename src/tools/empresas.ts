import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { empresaArraySchema, historialSchema, globalesSchema, paginadoSchema, filasSchema } from "../util/schemas-output.js";
import { getLegacy, postLegacy, fetchCmf, fetchCmfBinario, type CmfEnv } from "../client/cmf-client.js";
import { gridGoogleVisAJson, htmlTablaAJson, fechaLegacy, fechaLegacyCompleta, fixMojibake, txtCsvAJson } from "../client/parsers.js";
import { fromError, toolOk, toolError, resumirTabla } from "../util/errors.js";
import { paginar } from "../util/paginate.js";
import { pdfAMarkdown } from "../pdf.js";
import { procesarTablasEEFF, textoVerificacion, textoAviso } from "../eeff-tables.js";
import {
  anioSchema,
  fechaSchema,
  limitSchema,
  mercadoSchema,
  mesCorteSchema,
  mesSchema,
  offsetSchema,
  rutSchema,
  tipoBalanceSchema,
  tipoEntidadSchema,
  tipoNormaContableSchema,
} from "../util/schemas.js";

const FICHA_BASE = "/institucional/mercados/entidad.php";

function fichaUrl(rut: string, pestania: number): string {
  return `${FICHA_BASE}?mercado=V&rut=${rut}&grupo=&tipoentidad=RVEMI&row=&vig=VI&control=svs&pestania=${pestania}`;
}

/** Columnas típicas de hechos esenciales */
const COLS_HECHOS = ["fecha_hora", "numero", "entidad", "materia", "url"];

export function registrarToolsEmpresas(server: McpServer, env: CmfEnv): void {
  // ---------- Búsqueda y catálogos ----------

  server.registerTool(
    "cmf_empresa_por_ticker",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Buscar empresa por ticker (NEMO)",
      description:
        "Busca una empresa chilena por su ticker de bolsa (NEMO: COPEC, SQM-B, LTM, BCI…) usando el catálogo de empresas en bolsa del proyecto empresas-cmf-chile (github.com/JoaquinMulet/empresas-cmf-chile). Devuelve el RUT (con DV), razón social, ISIN, tipo de entidad, norma e inicio IFRS. Ideal para traducir tickers a RUT antes de consultar EEFF, hechos, etc.",
      inputSchema: z.object({
        consulta: z.string().min(2).optional().describe("Ticker (NEMO) o nombre de la empresa"),
        term: z.string().optional().describe("Alias de consulta"),
        limite: z.number().int().min(1).max(10).default(5),
      }),
      outputSchema: z.object({
        resultados: z.array(z.record(z.string(), z.unknown())),
        total: z.number(),
        fuente: z.enum(["kv", "red"]),
      }),
    },
    async ({ consulta, term, limite }) => {
      try {
        const consultaFinal = consulta ?? term;
        if (!consultaFinal) {
          return { content: [{ type: "text", text: "Indique un ticker o nombre, o use term como alias." }], isError: true };
        }
        // Catálogo de tickers (empresas-cmf-chile) con caché en KV 24h
        const claveKV = "catalogo:tickers_v1";
        let filas: Record<string, string>[] | null = null;
        let fuente: "kv" | "red" = "red";
        if (env.CMF_KV) {
          const raw = await env.CMF_KV.get(claveKV);
          if (raw) {
            filas = JSON.parse(raw) as Record<string, string>[];
            fuente = "kv";
          }
        }
        if (!filas) {
          const res = await fetchCmf(
            "https://raw.githubusercontent.com/JoaquinMulet/empresas-cmf-chile/master/empresas_chile.csv",
            {},
            env,
          );
          const csv = new TextDecoder("utf-8").decode(await res.arrayBuffer());
          filas = txtCsvAJson(csv, ";");
          if (env.CMF_KV) {
            await env.CMF_KV.put(claveKV, JSON.stringify(filas), { expirationTtl: 86_400 });
          }
        }
        const q = consultaFinal.toLowerCase().trim();
        const normalizar = (s: string) =>
          s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const lista = filas ?? [];
        const coincidencias = lista
          .filter((f) => {
            const nemo = (f.nemo ?? "").toLowerCase();
            const razon = normalizar(f.razon_social ?? "");
            return (
              nemo === q ||
              nemo.startsWith(q) ||
              nemo.replace(/-[a-z]$/, "") === q ||
              razon.includes(normalizar(consultaFinal))
            );
          })
          .slice(0, limite)
          .map((f) => ({
            nemo: f.nemo ?? "",
            razon_social: f.razon_social ?? "",
            rut: f.rut ?? "",
            isin: f.isin ?? "",
            tipo_entidad: f.tipo_entidad ?? "",
            norma: f.norma ?? "",
            fecha_inicio_ifrs: f.fecha_inicio_ifrs ?? "",
            url_cmf: f.url_cmf ?? "",
          }));
        const texto = coincidencias.length
          ? `Empresas para "${consultaFinal}" (fuente ${fuente}, ${coincidencias.length}):\n${resumirTabla(coincidencias, ["nemo", "razon_social", "rut", "tipo_entidad"])}`
          : `Sin ticker/nombre "${consultaFinal}" en el catálogo. Pruebe con cmf_buscar_entidad (nombre/RUT) contra la CMF.`;
        return toolOk(texto, { resultados: coincidencias, total: coincidencias.length, fuente });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_buscar_entidad",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Buscar entidad supervisada",
      description:
        "Busca una entidad supervisada por nombre, RUT o ticker. Devuelve el RUT canónico, la razón social, el tipo de entidad y su estado. Es el primer paso recomendado antes de consultar EEFF, hechos, etc.",
      inputSchema: z.object({
        consulta: z.string().min(1).optional().describe("Nombre, RUT o ticker a buscar"),
        term: z.string().optional().describe("Alias de consulta"),
        limite: z.number().int().min(1).max(20).default(5),
      }),
      outputSchema: z.object({
        resultados: z.array(z.record(z.string(), z.string())),
        total: z.number(),
      }),
    },
    async ({ consulta, term, limite }) => {
      try {
        const consultaFinal = consulta ?? term;
        if (!consultaFinal) {
          return { content: [{ type: "text", text: "Indique una consulta (nombre, RUT o ticker) o use term como alias." }], isError: true };
        }
        const html = await getLegacy("/institucional/mercados/consulta_busqueda.php", {
          valor: consultaFinal,
          entidad_web: "G",
          boton_busqueda: "Buscar",
        });
        const filas = htmlTablaAJson(html, ["rut", "nombre", "tipo_entidad", "inscripcion", "estado"]).filter(
          (f) => /^\d{6,9}$/.test(f.rut ?? ""),
        );
        const { filas: resultados, paginado } = paginar(filas, 0, limite);
        const texto = resultados.length
          ? `Resultados para "${consultaFinal}" (${paginado.total}):\n${resumirTabla(resultados, ["rut", "nombre", "tipo_entidad", "estado"])}`
          : `Sin resultados para "${consultaFinal}". Pruebe con un RUT numérico.`;
        return toolOk(texto, { resultados, total: paginado.total });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_listar_entidades",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Listar entidades por tipo",
      description:
        "Lista las entidades supervisadas de un tipo (tipoentidad, ej: RVEMI=emisores de valores) y mercado. Usa el motor de listados de la CMF. Para el catálogo completo use cmf_buscar_entidad con consulta='%'.",
      inputSchema: z.object({
        tipoentidad: tipoEntidadSchema,
        mercado: mercadoSchema.optional(),
        estado: z.enum(["VI", "NV"]).optional().describe("VI=vigentes, NV=no vigentes"),
        offset: offsetSchema,
        limit: limitSchema,
      }),
      outputSchema: z.object({
        entidades: z.array(z.record(z.string(), z.string())),
        total: z.number(),
        next_offset: z.number().nullable(),
      }),
    },
    async ({ tipoentidad, mercado, estado, offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/mercados/consulta.php", {
          mercado: mercado ?? "V",
          entidad: tipoentidad,
          Estado: estado ?? "VI",
          entidadT: "",
          consulta: "",
        });
        const filas = htmlTablaAJson(html, ["rut", "nombre", "inscripcion", "estado"]);
        const { filas: entidades, paginado } = paginar(filas, offset, limit);
        const texto = `Entidades ${tipoentidad} (total ${paginado.total}):\n${resumirTabla(entidades, ["rut", "nombre", "estado"])}`;
        return toolOk(texto, { entidades, total: paginado.total, next_offset: paginado.next_offset });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  // ---------- Ficha y pestanías de solo lectura ----------

  server.registerTool(
    "cmf_empresa_info",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: empresaArraySchema("datos"),
      title: "Identificación de empresa",
      description: "Datos de identificación de un emisor (razón social, RUT, inscripción, actividad) desde la ficha de la CMF (pestanía 1).",
      inputSchema: z.object({ rut: rutSchema }),
    },
    async ({ rut }) => {
      try {
        const html = await getLegacy(fichaUrl(rut, 1), {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Ficha identificación RUT ${rut}:\n${resumirTabla(filas.slice(0, 3), Object.keys(filas[0]))}`
          : `Sin datos de identificación para RUT ${rut}.`;
        return toolOk(texto, { rut, datos: filas.slice(0, 50) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_eeff",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Estados financieros (EEFF) de empresa",
      description:
        "Estados financieros de un emisor (pestanía 3) para un período, consolidado o individual, IFRS o NCH. modo=documentos: devuelve los PDFs oficiales del período (EEFF, análisis razonado, declaración, XBRL). modo=markdown: además convierte el PDF original auditado de los EEFF a Markdown (pdf-inspector) para leer las cifras directamente. El HTML de la CMF viene sin líneas: la fuente real de las cifras son los PDFs.",
      inputSchema: z.object({
        rut: rutSchema.optional(),
        query: rutSchema.optional().describe("Alias de rut"),
        anio: anioSchema,
        mes: mesCorteSchema.describe("Mes de corte trimestral (03/06/09/12)"),
        tipo: tipoBalanceSchema,
        norma: tipoNormaContableSchema,
        modo: z.enum(["documentos", "markdown"]).default("documentos").describe("documentos = lista de PDFs del período; markdown = PDF auditado convertido a Markdown"),
        max_chars: z.number().int().min(1000).max(100000).default(30000).describe("Máximo de caracteres del markdown (modo markdown)"),
        validar_contable: z.boolean().default(false).describe("true = verifica la cuadratura contable (experimental: puede dar falsos negativos en algunos formatos)"),
      }),
      outputSchema: z.object({
        periodo: z.string(),
        tipo_balance: z.string(),
        documentos: z.array(z.record(z.string(), z.string())).optional(),
        aviso: z.string().optional(),
        pdf_type: z.string().optional(),
        markdown: z.string().optional(),
        markdown_truncado: z.boolean().optional(),
        escaneado: z.boolean().optional(),
        filas_separadas: z.number().optional(),
        filas_fusionadas_pendientes: z.number().optional(),
        verificacion_contable: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    async ({ rut, query, anio, mes, tipo, norma, modo, max_chars, validar_contable }) => {
        const rutFinal = rut ?? query;
        if (!rutFinal) {
          return { content: [{ type: "text", text: "Indique un RUT (acepta 90749000, 90.749.000, 90749000-0 o 90.749.000-0) o use query como alias." }], isError: true };
        }
      try {
        const html = await postLegacy(fichaUrl(rutFinal, 3), { forma: "F", mm: mes, aa: anio, tipo, tipo_norma: norma }, env);
        const documentos: Record<string, string>[] = [];
        const reDoc = /href="(\.\.\/inc\/inf_financiera\/ifrs\/safec_ifrs_verarchivo\.php\?auth=[^"]+&send=[^"]+)"[^>]*>\s*([^<]{2,60})/g;
        let dm: RegExpExecArray | null;
        while ((dm = reDoc.exec(html)) !== null) {
          documentos.push({
            nombre: fixMojibake(dm[2].replace(/\s+/g, " ").trim()),
            url: `https://www.cmfchile.cl${dm[1].replace("../", "/institucional/")}`,
          });
        }
        const periodo = `${anio}${mes}`;
        const base = {
          periodo,
          tipo_balance: tipo,
          documentos,
          aviso:
            "Las cifras de los EEFF están en los PDFs auditados del período (el HTML de la CMF no trae las líneas). Para descargar todos en ZIP: cmf_empresa_paquete_documentos.",
        };
        if (documentos.length === 0) {
          return toolOk(
            `Sin EEFF disponibles para ${rutFinal} período ${periodo} (${tipo}/${norma}). Verifique con cmf_empresa_eeff_historial el inicio IFRS.`,
            base,
          );
        }
        if (modo === "documentos") {
          const texto = `EEFF ${rutFinal} período ${periodo} (${tipo === "C" ? "Consolidado" : "Individual"}, ${norma}): ${documentos.length} documentos disponibles:\n${documentos
            .map((d) => `- ${d.nombre}`)
            .join("\n")}\n\n${base.aviso}\nPara leer un documento use cmf_documento_markdown con el token de su url, o cmf_empresa_eeff con modo=markdown para el PDF auditado de los EEFF.`;
          return toolOk(texto, base);
        }
        // modo=markdown: convertir el PDF auditado principal (EEFF, no XBRL/análisis/declaración)
        const principal =
          documentos.find((d) => /estados financieros/i.test(d.nombre ?? "") && !/xbrl/i.test(d.nombre ?? "")) ??
          documentos[0];
        if (!principal?.url || !env.__pdfModule) {
          return toolOk(
            `Documentos del período disponibles pero no se pudo convertir a Markdown en este runtime. Use cmf_documento_markdown con el token de: ${principal?.url ?? "los documentos"}.`,
            base,
          );
        }
        const { bytes } = await fetchCmfBinario(principal.url, env);
        const { pdfType, markdown } = await pdfAMarkdown(env.__pdfModule, bytes);
        // Des-fusión de tablas, sospechosas y cuadratura contable
        const procesado = procesarTablasEEFF(markdown ?? "");
        const avisoFusion = textoAviso(procesado);
        const verificacion = validar_contable ? textoVerificacion(procesado) : "";
        const textoMd = procesado.markdown ?? "";
        const truncado = textoMd.length > max_chars;
        const textoFinal = truncado ? `${textoMd.slice(0, max_chars)}\n...[truncado: ${textoMd.length - max_chars} caracteres]` : textoMd;
        const texto = `${verificacion}${avisoFusion}\n\nEEFF ${rutFinal} período ${periodo} (${tipo === "C" ? "Consolidado" : "Individual"}, ${norma}) — PDF auditado convertido a Markdown (${pdfType}, ${Math.round(bytes.length / 1024)} KB, ${textoMd.length} caracteres):\n\n${textoFinal.slice(0, 1500)}${textoFinal.length > 1500 ? "\n...[preview; markdown completo en structuredContent]" : ""}`;
        return toolOk(texto, {
          ...base,
          pdf_type: pdfType,
          markdown: textoFinal,
          markdown_truncado: truncado,
          escaneado: pdfType === "Scanned" || pdfType === "ImageBased",
          filas_separadas: procesado.filasSeparadas,
          filas_fusionadas_pendientes: procesado.filasFusionadasPendientes,
          ...(validar_contable ? { verificacion_contable: procesado.cuadratura } : {}),
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          return {
            content: [{ type: "text", text: "La descarga del PDF auditado excedió el límite del servidor. Use modo=documentos y cmf_documento_markdown para convertir un documento a la vez." }],
            isError: true,
          };
        }
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_eeff_historial",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: historialSchema,
      title: "Historial de EEFF disponibles",
      description: "Lista los períodos (años y cortes) para los que un emisor tiene estados financieros publicados, y su modalidad IFRS (aviso de inicio).",
      inputSchema: z.object({ rut: rutSchema }),
    },
    async ({ rut }) => {
      try {
        const html = await getLegacy(fichaUrl(rut, 3), {}, env);
        const aviso = html.match(/a partir de <strong>([\d/]+)<\/strong> en modalidad '<strong>([^<]+)<\/strong>'/);
        const anios = [...html.matchAll(/<option value="?(\d{4})"?\s*>(\d{4})/g)].map((m) => m[1]);
        const texto = `Emisor ${rut}: modalidad '${aviso?.[2] ?? "?"}' desde ${aviso?.[1] ?? "?"}. Años disponibles: ${anios.join(", ") || "ninguno"}.`;
        return toolOk(texto, { rut, inicio_ifrs: aviso?.[1], modalidad: aviso?.[2]?.trim(), anios });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_hechos",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Hechos esenciales de empresa",
      description: "Hechos esenciales publicados por un emisor (pestanía 25) en un rango de fechas. Incluye número de documento y enlace de descarga.",
      inputSchema: z.object({
        rut: rutSchema,
        desde: fechaSchema,
        hasta: fechaSchema,
        offset: offsetSchema,
        limit: limitSchema,
      }),
      outputSchema: z.object({
        hechos: z.array(z.record(z.string(), z.string())),
        total: z.number(),
        next_offset: z.number().nullable(),
      }),
    },
    async ({ rut, desde, hasta, offset, limit }) => {
      try {
        const f1 = fechaLegacy(desde);
        const f2 = fechaLegacy(hasta);
        const html = await postLegacy(
          fichaUrl(rut, 25),
          { dd: f1.dd, mm: f1.mm, aa: f1.aa, dd2: f2.dd, mm2: f2.mm, aa2: f2.aa, rut, formulario: 1 },
          env,
        );
        const filas = htmlTablaAJson(html, COLS_HECHOS);
        const { filas: hechos, paginado } = paginar(filas, offset, limit);
        const texto = hechos.length
          ? `Hechos esenciales ${rut} (${desde} → ${hasta}, total ${paginado.total}):\n${resumirTabla(hechos, ["fecha_hora", "numero", "materia"])}`
          : `Sin hechos esenciales para ${rut} en el período.`;
        return toolOk(texto, { hechos, total: paginado.total, next_offset: paginado.next_offset });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_accionistas",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: empresaArraySchema("accionistas"),
      title: "12 mayores accionistas",
      description: "Los 12 mayores accionistas de un emisor para un período (pestanías 5/21).",
      inputSchema: z.object({ rut: rutSchema, anio: anioSchema, mes: mesSchema.optional() }),
    },
    async ({ rut, anio, mes }) => {
      try {
        const html = await postLegacy(fichaUrl(rut, 5), { mm: mes ?? "12", aa: anio }, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Accionistas ${rut} período ${anio}-${mes ?? "12"} (total ${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 6))}`
          : `Sin accionistas publicados para ${rut} en ${anio}.`;
        return toolOk(texto, { rut, anio, mes, accionistas: filas.slice(0, 50) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_directorio",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: empresaArraySchema("directorio"),
      title: "Directorio y administración",
      description: "Directores y gerentes de un emisor (pestanía 4).",
      inputSchema: z.object({ rut: rutSchema }),
    },
    async ({ rut }) => {
      try {
        const html = await getLegacy(fichaUrl(rut, 4), {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Directorio ${rut} (${filas.length} registros):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 5))}`
          : `Sin datos de administración para ${rut}.`;
        return toolOk(texto, { rut, directorio: filas.slice(0, 100) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_sanciones",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: empresaArraySchema("sanciones"),
      title: "Sanciones de la entidad",
      description: "Sanciones aplicadas a un emisor (pestanía 36) en un rango de fechas.",
      inputSchema: z.object({ rut: rutSchema, desde: fechaSchema.optional(), hasta: fechaSchema.optional() }),
    },
    async ({ rut, desde, hasta }) => {
      try {
        const url = `${fichaUrl(rut, 36)}&fecha_inicio=${desde ? fechaLegacyCompleta(desde) : "01/01/2000"}&fecha_fin=${hasta ? fechaLegacyCompleta(hasta) : "31/12/2100"}&formulario=1`;
        const html = await getLegacy(url, {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Sanciones ${rut} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin sanciones para ${rut} en el período.`;
        return toolOk(texto, { rut, sanciones: filas.slice(0, 100) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_resoluciones",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: empresaArraySchema("resoluciones"),
      title: "Resoluciones de la entidad",
      description: "Resoluciones de la CMF sobre un emisor (pestanía 37) en un rango de fechas.",
      inputSchema: z.object({ rut: rutSchema, desde: fechaSchema.optional(), hasta: fechaSchema.optional() }),
    },
    async ({ rut, desde, hasta }) => {
      try {
        const url = `${fichaUrl(rut, 37)}&fecha_inicio=${desde ? fechaLegacyCompleta(desde) : "01/01/2000"}&fecha_fin=${hasta ? fechaLegacyCompleta(hasta) : "31/12/2100"}&formulario=1`;
        const html = await getLegacy(url, {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Resoluciones ${rut} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin resoluciones para ${rut} en el período.`;
        return toolOk(texto, { rut, resoluciones: filas.slice(0, 100) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_juntas",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: empresaArraySchema("actas"),
      title: "Actas de juntas de accionistas",
      description: "Actas de juntas de accionistas (ordinarias, extraordinarias, reforma de estatutos) de un emisor (pestanías 78-80).",
      inputSchema: z.object({
        rut: rutSchema,
        desde: fechaSchema,
        hasta: fechaSchema,
        tipo: z.enum(["ordinaria", "extraordinaria", "reforma"]).default("ordinaria"),
      }),
    },
    async ({ rut, desde, hasta, tipo }) => {
      try {
        const pestania = tipo === "ordinaria" ? 78 : tipo === "extraordinaria" ? 79 : 80;
        const html = await postLegacy(
          fichaUrl(rut, pestania),
          { fecha_desde: fechaLegacyCompleta(desde), fecha_hasta: fechaLegacyCompleta(hasta), tipo_documento: "", tipo_junta: "" },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Actas juntas ${tipo} ${rut} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin actas de juntas ${tipo} para ${rut} en el período.`;
        return toolOk(texto, { rut, tipo, actas: filas.slice(0, 100) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_memoria_anual",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: empresaArraySchema("documentos"),
      title: "Memoria anual",
      description: "Memoria anual de un emisor (pestanía 49) para un año.",
      inputSchema: z.object({ rut: rutSchema, anio: anioSchema }),
    },
    async ({ rut, anio }) => {
      try {
        const html = await postLegacy(fichaUrl(rut, 49), { aa: anio }, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Memoria anual ${anio} de ${rut} (${filas.length} documentos):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 3))}`
          : `Sin memoria anual ${anio} para ${rut}.`;
        return toolOk(texto, { rut, anio, documentos: filas.slice(0, 50) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_asg",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: empresaArraySchema("indicadores"),
      title: "Indicadores ASG (ESG)",
      description: "Indicadores ambientales, sociales y de gobernanza de un emisor (pestanía 110): memoria integrada, SASB o XBRL SASB.",
      inputSchema: z.object({
        rut: rutSchema,
        anio: anioSchema,
        mes: mesSchema.optional(),
        tipo_informe: z.enum(["1", "2", "3"]).default("1").describe("1=Memoria Integrada, 2=SASB, 3=XBRL SASB"),
      }),
    },
    async ({ rut, anio, mes, tipo_informe }) => {
      try {
        const html = await postLegacy(fichaUrl(rut, 110), { aa: anio, mm: mes ?? "12", t_inf: tipo_informe }, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Indicadores ASG ${anio} de ${rut} (${filas.length} registros):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin indicadores ASG ${anio} para ${rut}.`;
        return toolOk(texto, { rut, anio, tipo_informe, indicadores: filas.slice(0, 100) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_eeff_filiales",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: empresaArraySchema("filiales"),
      title: "EEFF de filiales",
      description: "Estados financieros de filiales de un emisor (pestanía 33) para un período.",
      inputSchema: z.object({ rut: rutSchema, anio: anioSchema, mes: mesSchema.optional() }),
    },
    async ({ rut, anio, mes }) => {
      try {
        const html = await postLegacy(fichaUrl(rut, 33), { aa: anio, mm: mes ?? "12" }, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `EEFF filiales ${rut} ${anio}-${mes ?? "12"} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin EEFF de filiales para ${rut} en ${anio}.`;
        return toolOk(texto, { rut, anio, filiales: filas.slice(0, 100) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_registro_productos",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: empresaArraySchema("productos"),
      title: "Registro de productos",
      description: "Registro de productos inscritos de la entidad (pestanía 31): valores, cuotas, series. Se sirve por GET directo.",
      inputSchema: z.object({ rut: rutSchema }),
    },
    async ({ rut }) => {
      try {
        const html = await getLegacy(fichaUrl(rut, 31), {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Registro de productos ${rut} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 6))}`
          : `Sin productos registrados para ${rut}.`;
        return toolOk(texto, { rut, productos: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  // ---------- Globales (mercado) ----------

  server.registerTool(
    "cmf_hechos_globales",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: globalesSchema("hechos"),
      title: "Hechos esenciales globales",
      description:
        "Hechos esenciales de todo el mercado (o de un tipo de entidad). Requiere captcha de la CMF: si no se entrega captcha, la tool responde con una solicitud de input (el agente la pide al usuario). El captcha es una imagen de 6 caracteres.",
      inputSchema: z.object({
        mercado: mercadoSchema,
        tipoentidad: z.string().optional(),
        desde: fechaSchema,
        hasta: fechaSchema,
        captcha: z.string().length(6).optional().describe("Código captcha de 6 caracteres (si no lo tiene, la tool lo solicitará)"),
      }),
    },
    async ({ mercado, tipoentidad, desde, hasta, captcha }) => {
      try {
        if (!captcha) {
          return toolError(
            "Esta consulta requiere un captcha de la CMF. Solicite al usuario el código de 6 caracteres de la imagen (consulte el resource cmf://captcha/{id} o la imagen que se le mostrará) y reintente con el parámetro captcha.",
          );
        }
        const f1 = fechaLegacy(desde);
        const f2 = fechaLegacy(hasta);
        const url = `/institucional/hechos/hechos2.php?entidad=${tipoentidad ?? "RVEMI"}&tipoentidad=${tipoentidad ?? "RVEMI"}&mercado=${mercado}&materia=ALL&p_fecha_desde=${f1.dd}/${f1.mm}/${f1.aa}&p_fecha_hasta=${f2.dd}/${f2.mm}/${f2.aa}&dias=&captcha=${captcha}&consultar=Buscar`;
        const html = await getLegacy(url, {}, env);
        if (html.includes("hechos.php?") && html.length < 5000) {
          return toolError("Captcha inválido o expirado. Solicite un nuevo captcha y reintente.");
        }
        const filas = htmlTablaAJson(html, COLS_HECHOS);
        const texto = filas.length
          ? `Hechos esenciales ${mercado} (${filas.length}):\n${resumirTabla(filas.slice(0, 10), ["fecha_hora", "numero", "entidad", "materia"])}`
          : "Sin hechos en el período.";
        return toolOk(texto, { mercado, desde, hasta, hechos: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_sanciones_globales",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: globalesSchema("sanciones"),
      title: "Sanciones globales por mercado",
      description: "Sanciones de todo un mercado (V=valores, O=otros, S=seguros) en un rango de fechas.",
      inputSchema: z.object({
        mercado: mercadoSchema,
        desde: fechaSchema.optional(),
        hasta: fechaSchema.optional(),
        tipoentidad: z.string().optional(),
      }),
    },
    async ({ mercado, desde, hasta, tipoentidad }) => {
      try {
        const url = `/institucional/sanciones/sanciones_mercados_entidad.php?mercado=${mercado}&entidad=${tipoentidad ?? "ALL"}&nom_entidad=&desde=${desde ? fechaLegacyCompleta(desde) : "01/01/2020"}&hasta=${hasta ? fechaLegacyCompleta(hasta) : "31/12/2100"}`;
        const html = await getLegacy(url, {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Sanciones mercado ${mercado} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin sanciones en mercado ${mercado}.`;
        return toolOk(texto, { mercado, sanciones: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_resoluciones_globales",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: globalesSchema("resoluciones"),
      title: "Resoluciones globales por mercado",
      description: "Resoluciones de todo un mercado en un rango de fechas.",
      inputSchema: z.object({
        mercado: mercadoSchema,
        desde: fechaSchema.optional(),
        hasta: fechaSchema.optional(),
        tipoentidad: z.string().optional(),
      }),
    },
    async ({ mercado, desde, hasta, tipoentidad }) => {
      try {
        const url = `/institucional/resoluciones/resoluciones_mercados_entidad.php?mercado=${mercado}&entidad=${tipoentidad ?? "ALL"}&nom_entidad=&fecha_inicio=${desde ? fechaLegacyCompleta(desde) : "01/01/2020"}&fecha_fin=${hasta ? fechaLegacyCompleta(hasta) : "31/12/2100"}`;
        const html = await getLegacy(url, {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Resoluciones mercado ${mercado} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin resoluciones en mercado ${mercado}.`;
        return toolOk(texto, { mercado, resoluciones: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_comunicaciones_emisores",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: paginadoSchema("comunicaciones"),
      title: "Comunicaciones de emisores",
      description: "Comunicaciones de los emisores de valores (fecha, número, sociedad, entidad informante, descripción).",
      inputSchema: z.object({ offset: offsetSchema, limit: limitSchema }),
    },
    async ({ offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/mercados/comunicaciones_detalle2.php", { entidad: "RVEMI" }, env);
        const filas = htmlTablaAJson(html, ["fecha", "numero", "sociedad", "entidad", "descripcion"]);
        const { filas: comunicaciones, paginado } = paginar(filas, offset, limit);
        const texto = comunicaciones.length
          ? `Comunicaciones de emisores (total ${paginado.total}):\n${resumirTabla(comunicaciones, ["fecha", "numero", "sociedad", "descripcion"])}`
          : "Sin comunicaciones.";
        return toolOk(texto, { comunicaciones, total: paginado.total, next_offset: paginado.next_offset });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_clasificaciones_riesgo",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: paginadoSchema("clasificaciones"),
      title: "Clasificaciones de riesgo",
      description: "Clasificaciones de riesgo asignadas a emisores e instrumentos por clasificadoras.",
      inputSchema: z.object({
        emisor: z.string().optional(),
        clasificadora: z.string().optional(),
        tipo_instrumento: z.string().optional(),
        offset: offsetSchema,
        limit: limitSchema,
      }),
    },
    async ({ emisor, clasificadora, tipo_instrumento, offset, limit }) => {
      try {
        const html = await getLegacy(
          "/institucional/estadisticas/valores_clasificaciones_asignadas.php",
          { clasificadora, emisor, tipo_instrumento, vig_instrumento: "VIG", fecha_corte: "hoy" },
          env,
        );
        const filas = htmlTablaAJson(html);
        const { filas: clasificaciones, paginado } = paginar(filas, offset, limit);
        const texto = clasificaciones.length
          ? `Clasificaciones (total ${paginado.total}):\n${resumirTabla(clasificaciones, Object.keys(clasificaciones[0] ?? {}).slice(0, 5))}`
          : "Sin clasificaciones.";
        return toolOk(texto, { clasificaciones, total: paginado.total, next_offset: paginado.next_offset });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  // ---------- IFRS SA / otras entidades ----------

  server.registerTool(
    "cmf_eeff_ifrs_sa",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "EEFF IFRS de sociedades anónimas",
      description: "Estados financieros IFRS de sociedades anónimas y otras entidades (sistema sa_eeff_ifrs). Seleccione sociedades por RUT (0=todas).",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades (['0'] = todas)"),
        anio1: anioSchema,
        anio2: anioSchema,
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional(),
      }),
    },
    async ({ sociedades, anio1, anio2, mes1, mes2 }) => {
      try {
        const html = await postLegacy(
          "/institucional/estadisticas/merc_valores/sa_eeff_ifrs/sa_eeff_ifrs_index.php",
          {
            lang: "es",
            rg_rf: "RGEIN",
            "sociedad[]": sociedades,
            anno1: anio1,
            anno2: anio2,
            mes1: mes1 ?? "12",
            mes2: mes2 ?? "12",
            indcon: "C",
            buscasoc: "",
            xls: "n",
            enviar: "Buscar",
          },
          env,
        );
        const tablas = htmlTablaAJson(html);
        const texto = tablas.length
          ? `EEFF IFRS SA ${anio1}-${mes1 ?? "12"} → ${anio2}-${mes2 ?? "12"} (${tablas.length} filas):\n${resumirTabla(tablas.slice(0, 10), Object.keys(tablas[0] ?? {}).slice(0, 6))}`
          : "Sin resultados EEFF IFRS SA.";
        return toolOk(texto, { sociedades, anio1, anio2, filas: tablas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_indicadores_financieros_sa",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Indicadores financieros IFRS de SA",
      description: "Indicadores financieros calculados IFRS de sociedades anónimas (liquidez, endeudamiento, rentabilidad, etc.) para un corte.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]),
        fecha_max: z.string().regex(/^\d{6}$/, "AAAAMM").describe("Corte en formato AAAAMM"),
      }),
    },
    async ({ sociedades, fecha_max }) => {
      try {
        const html = await getLegacy(
          "/institucional/estadisticas/merc_valores/sa_indicadores_ifrs/sa_indicadoresfinancieros.php",
          { auth: "", send: "", lang: "es", rg_rf: "RGEIN", fecha_max },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Indicadores IFRS SA corte ${fecha_max} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin indicadores para el corte.";
        return toolOk(texto, { fecha_max, filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_empresa_eeff_nch",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "EEFF NCH de sociedades anónimas",
      description: "Estados financieros bajo norma chilena (NCH/FECU) de sociedades anónimas.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]),
        anio1: anioSchema,
        anio2: anioSchema,
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional(),
      }),
    },
    async ({ sociedades, anio1, anio2, mes1, mes2 }) => {
      try {
        const html = await postLegacy(
          "/institucional/estadisticas/sa_fecu_index.php",
          {
            lang: "es",
            rg_rf: "RGEIN",
            "sociedad[]": sociedades,
            anno1: anio1,
            anno2: anio2,
            mes1: mes1 ?? "12",
            mes2: mes2 ?? "12",
            indcon: "C",
            xls: "n",
            enviar: "Buscar",
          },
          env,
        );
        const tablas = htmlTablaAJson(html);
        const texto = tablas.length
          ? `EEFF NCH SA ${anio1}-${mes1 ?? "12"} → ${anio2}-${mes2 ?? "12"} (${tablas.length} filas):\n${resumirTabla(tablas.slice(0, 10), Object.keys(tablas[0] ?? {}).slice(0, 6))}`
          : "Sin resultados EEFF NCH.";
        return toolOk(texto, { sociedades, anio1, anio2, filas: tablas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_indicadores_financieros_nch",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Indicadores financieros NCH de SA",
      description: "Indicadores financieros bajo norma chilena de sociedades anónimas.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]),
        anio1: anioSchema,
        anio2: anioSchema,
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional(),
      }),
    },
    async ({ sociedades, anio1, anio2, mes1, mes2 }) => {
      try {
        const html = await postLegacy(
          "/institucional/estadisticas/sa_indicadoresfinancieros_index.php",
          {
            lang: "es",
            rg_rf: "RGEIN",
            "sociedad[]": sociedades,
            anno1: anio1,
            anno2: anio2,
            mes1: mes1 ?? "12",
            mes2: mes2 ?? "12",
            indcon: "C",
            xls: "n",
            enviar: "Buscar",
          },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Indicadores NCH SA (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin indicadores NCH.";
        return toolOk(texto, { filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_dividendos",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Dividendos de sociedades",
      description: "Dividendos declarados por sociedades anónimas (detalle y resumen).",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]),
        anio: anioSchema,
        anio2: anioSchema.optional(),
        mes: mesSchema.optional(),
        mes2: mesSchema.optional(),
        tipodiv: z.string().optional(),
      }),
    },
    async ({ sociedades, anio, anio2, mes, mes2, tipodiv }) => {
      try {
        const html = await postLegacy(
          "/institucional/estadisticas/divi/acc_dividendos_index.php",
          {
            lang: "es",
            anno: anio,
            anno2: anio2 ?? anio,
            mes: mes ?? "01",
            mes2: mes2 ?? "12",
            tipodiv: tipodiv ?? "DIV",
            "sociedad[]": sociedades,
            enviar: "Buscar",
          },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Dividendos ${anio} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin dividendos para el período.";
        return toolOk(texto, { anio, filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_operaciones_capital",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Operaciones de capital (repartos, canjes, liberadas)",
      description: "Repartos de capital, canje de acciones y acciones liberadas de pago de sociedades anónimas.",
      inputSchema: z.object({
        tipo: z.enum(["reparto", "canje", "liberadas"]),
        sociedades: z.array(z.string()).default(["0"]),
        anio: anioSchema,
      }),
    },
    async ({ tipo, sociedades, anio }) => {
      try {
        const path =
          tipo === "reparto"
            ? "/institucional/estadisticas/acc_reparto1.php"
            : tipo === "canje"
              ? "/institucional/estadisticas/acc_canje1.php"
              : "/institucional/estadisticas/acc_liberadaspago1.php";
        const html = await postLegacy(path, { "sociedad[]": sociedades, anno3: anio, enviar: "Buscar" }, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `${tipo === "reparto" ? "Repartos" : tipo === "canje" ? "Canjes" : "Liberadas"} ${anio} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : `Sin ${tipo}s de capital para ${anio}.`;
        return toolOk(texto, { tipo, anio, filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_apv",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Valores APV",
      description: "Valores de ahorro previsional voluntario (APV) por tipo y cuadro.",
      inputSchema: z.object({
        anio_desde: anioSchema,
        anio_hasta: anioSchema,
        mes_desde: mesSchema.optional(),
        mes_hasta: mesSchema.optional(),
        tipo: z.string().optional(),
        cuadro: z.string().optional(),
      }),
    },
    async ({ anio_desde, anio_hasta, mes_desde, mes_hasta, tipo, cuadro }) => {
      try {
        const html = await postLegacy(
          "/institucional/estadisticas/valores_apv_enero2010.php",
          {
            ano_desde: anio_desde,
            ano_hasta: anio_hasta,
            mes_desde: mes_desde ?? "01",
            mes_hasta: mes_hasta ?? "12",
            tipo: tipo ?? "",
            cuadro: cuadro ?? "",
            enviar: "Buscar",
          },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Valores APV ${anio_desde}-${anio_hasta} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin valores APV para el período.";
        return toolOk(texto, { anio_desde, anio_hasta, filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_tomas_control",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Tomas de control de emisores",
      description: "Información sobre tomas de control de emisores de valores.",
      inputSchema: z.object({ orden: z.number().int().min(1).max(5).optional() }),
    },
    async ({ orden }) => {
      try {
        const html = await getLegacy("/institucional/mercados/tomas_detalle.php", { tipo: "TDC", orden: orden ?? 1 }, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Tomas de control (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin tomas de control.";
        return toolOk(texto, { filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_listados_eeff_ifrs",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Listados de EEFF IFRS",
      description: "Listados de empresas que presentan EEFF IFRS (listado general, Circular 556, oficios 457/485).",
      inputSchema: z.object({
        tipo_listado: z.enum(["general", "c556", "ofc457", "ofc485"]).default("general"),
      }),
    },
    async ({ tipo_listado }) => {
      try {
        const path =
          tipo_listado === "general"
            ? "/institucional/mercados/efifr_listado.php"
            : tipo_listado === "c556"
              ? "/institucional/mercados/efifr_listado_C556.php"
              : tipo_listado === "ofc457"
                ? "/institucional/mercados/ifrs_resp_ofc457.php"
                : "/institucional/mercados/ifrs_resp_ofc485.php";
        const html = await getLegacy(path, tipo_listado === "ofc485" ? { mercado: "V" } : {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Listado EEFF IFRS ${tipo_listado} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 5))}`
          : "Sin listado.";
        return toolOk(texto, { tipo_listado, filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fechas_divulgacion_eeff",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Fechas de divulgación de EEFF",
      description: "Calendario de fechas de divulgación de estados financieros por año.",
      inputSchema: z.object({ anio: anioSchema }),
    },
    async ({ anio }) => {
      try {
        const html = await getLegacy("/institucional/mercados/novedades_envio_fechas_eeff.php", { aaaa: anio }, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Fechas divulgación EEFF ${anio} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 5))}`
          : `Sin fechas para ${anio}.`;
        return toolOk(texto, { anio, filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  // ---------- B.2 Intermediarios y misceláneos ----------

  server.registerTool(
    "cmf_intermediarios_eeff_ifrs",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "EEFF IFRS de intermediarios (AV/CB/CBP)",
      description: "Estados financieros IFRS de agentes de valores, corredores de bolsa y corredores de bolsa de productos.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]),
        anio1: anioSchema,
        anio2: anioSchema,
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional(),
      }),
    },
    async ({ sociedades, anio1, anio2, mes1, mes2 }) => {
      try {
        const html = await postLegacy(
          "/institucional/estadisticas/merc_valores/intermediarios_fecu_ifrs/intermediarios_ifrs_index.php",
          {
            lang: "es",
            tiposociedad: "0",
            "sociedad[]": sociedades,
            anno1: anio1,
            anno2: anio2,
            mes1: mes1 ?? "12",
            mes2: mes2 ?? "12",
            indcon: "C",
            xls: "n",
            enviar: "Buscar",
          },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `EEFF IFRS intermediarios ${anio1}-${anio2} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin resultados de intermediarios.";
        return toolOk(texto, { sociedades, anio1, anio2, filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_intermediarios_indicadores_ifrs",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Indicadores IFRS de intermediarios",
      description: "Indicadores financieros IFRS de agentes de valores y corredores de bolsa.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]),
        anio1: anioSchema,
        anio2: anioSchema,
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional(),
      }),
    },
    async ({ sociedades, anio1, anio2, mes1, mes2 }) => {
      try {
        const html = await postLegacy(
          "/institucional/estadisticas/merc_valores/intermediarios_indicadores_ifrs/intermediarios_indicadoresfinancieros_index.php",
          {
            tiposociedad: "0",
            "sociedad[]": sociedades,
            anno1: anio1,
            anno2: anio2,
            mes1: mes1 ?? "12",
            mes2: mes2 ?? "12",
            indcon: "C",
            xls: "n",
            enviar: "Buscar",
          },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Indicadores IFRS intermediarios (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin indicadores de intermediarios.";
        return toolOk(texto, { filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_resultados_av_cb",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Cuadros de resultados (AV/CB y emisores NCH)",
      description: "Cuadros de resultados de agentes de valores/corredores de bolsa y de emisores bajo NCH.",
      inputSchema: z.object({
        tipo: z.enum(["av_cb", "emisores_nch"]).default("av_cb"),
      }),
    },
    async ({ tipo }) => {
      try {
        const path =
          tipo === "av_cb"
            ? "/institucional/estadisticas/valores_agentes_cuadro.php"
            : "/institucional/estadisticas/valores_sociedades_cuadroresultados.php";
        const html = await getLegacy(path, {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Cuadro ${tipo} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin resultados.";
        return toolOk(texto, { tipo, filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_liquidez_intermediarios",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Índices de liquidez/solvencia de intermediarios",
      description: "Índices de liquidez y solvencia de intermediarios de valores.",
      inputSchema: z.object({
        intermediario: z.string().optional(),
        desde: fechaSchema.optional(),
        hasta: fechaSchema.optional(),
      }),
    },
    async ({ intermediario, desde, hasta }) => {
      try {
        const f1 = desde ? fechaLegacy(desde) : { dd: "01", mm: "01", aa: "2024" };
        const f2 = hasta ? fechaLegacy(hasta) : { dd: "31", mm: "12", aa: "2026" };
        const html = await getLegacy(
          "/institucional/mercados/liquidez.php",
          {
            sel_inter: intermediario ?? "0",
            rango_fechas: "0",
            dd_ini: f1.dd,
            mm_ini: f1.mm,
            aaaa_ini: f1.aa,
            dd_fin: f2.dd,
            mm_fin: f2.mm,
            aaaa_fin: f2.aa,
            consulta: "Buscar",
          },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Índices liquidez/solvencia (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin índices.";
        return toolOk(texto, { filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_prestamos_otorgados",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Préstamos otorgados",
      description: "Consulta de préstamos otorgados (información del mercado de valores).",
      inputSchema: z.object({ desde: fechaSchema.optional(), hasta: fechaSchema.optional() }),
    },
    async ({ desde, hasta }) => {
      try {
        const html = await getLegacy("/institucional/estadisticas/reporte_prestamos.php", {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Préstamos otorgados (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin préstamos.";
        return toolOk(texto, { filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_dictamenes",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Consulta de dictámenes",
      description: "Consulta de dictámenes de la CMF.",
      inputSchema: z.object({ desde: fechaSchema.optional(), hasta: fechaSchema.optional() }),
    },
    async ({ desde, hasta }) => {
      try {
        const html = await getLegacy("/institucional/inc/dictamenes_consulta.php", {}, env);
        const filas = htmlTablaAJson(html);
        if (filas.length === 0) {
          // El servicio de dictámenes no devuelve tabla desde este endpoint (cambió o está caído)
          return toolError(
            "El servicio de dictámenes de la CMF no devolvió datos desde este endpoint: la página ya no expone la tabla de consulta. " +
              "Revisa https://www.cmfchile.cl/institucional/inc/dictamenes_consulta.php en el navegador.",
          );
        }
        const texto = `Dictámenes (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 5))}`;
        return toolOk(texto, { filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_sanciones_cursadas",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Sanciones cursadas del mes",
      description: "Sanciones cursadas del mes y portada de sanciones por mercado.",
      inputSchema: z.object({ mercado: mercadoSchema.optional() }),
    },
    async ({ mercado }) => {
      try {
        const html = await getLegacy("/institucional/sanciones/sanciones_cursadas_mes.php", {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Sanciones cursadas (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 5))}`
          : "Sin sanciones cursadas.";
        return toolOk(texto, { filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_resoluciones_cursadas",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Resoluciones cursadas",
      description: "Resoluciones cursadas recientes e históricas (meses anteriores).",
      inputSchema: z.object({ historico: z.boolean().default(false).describe("true = listado histórico completo (grande)") }),
    },
    async ({ historico }) => {
      try {
        const path = historico
          ? "/institucional/resoluciones/resoluciones_cursadas_meses_anteriores.php"
          : "/institucional/resoluciones/resoluciones_cursadas.php";
        const html = await getLegacy(path, {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Resoluciones cursadas (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 5))}`
          : "Sin resoluciones.";
        return toolOk(texto, { historico, filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  // ---------- Grids Google Visualization (fondos IFRS reutilizado por empresas) ----------
  server.registerTool(
    "cmf_catalogo_entidades",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Catálogo completo de entidades supervisadas",
      description:
        "Catálogo de todas las entidades supervisadas de la CMF (11.401 registros) con filtros por nombre, tipo de entidad y estado. Cacheado 24h en KV. Paginado: nunca devuelve el dump crudo.",
      inputSchema: z.object({
        nombre: z.string().optional(),
        tipo_entidad: z.string().optional(),
        estado: z.enum(["VI", "NV"]).optional(),
        offset: offsetSchema,
        limit: limitSchema,
      }),
      outputSchema: z.object({
        entidades: z.array(z.record(z.string(), z.string())),
        total: z.number(),
        next_offset: z.number().nullable(),
        cache: z.enum(["kv", "red"]),
        advertencia: z.string().optional(),
      }),
    },
    async ({ nombre, tipo_entidad, estado, offset, limit }) => {
      try {
        let filas: Record<string, string>[];
        let cache: "kv" | "red" = "red";
        const claveKV = "catalogo:entidades_v1";
        if (env.CMF_KV) {
          const raw = await env.CMF_KV.get(claveKV);
          if (raw) {
            filas = JSON.parse(raw) as Record<string, string>[];
            cache = "kv";
          } else {
            const html = await getLegacy(
              "/institucional/mercados/consulta_busqueda.php",
              { valor: "%", entidad_web: "G", boton_busqueda: "Buscar" },
              env,
              "catalogo_entidades_raw",
            );
            filas = htmlTablaAJson(html, ["rut", "nombre", "tipo_entidad", "inscripcion", "estado"]);
            await env.CMF_KV.put(claveKV, JSON.stringify(filas), { expirationTtl: 86_400 });
          }
        } else {
          const html = await getLegacy(
            "/institucional/mercados/consulta_busqueda.php",
            { valor: "%", entidad_web: "G", boton_busqueda: "Buscar" },
            env,
            "catalogo_entidades_raw",
          );
          filas = htmlTablaAJson(html, ["rut", "nombre", "tipo_entidad", "inscripcion", "estado"]);
        }
        if (nombre) {
          const q = nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          filas = filas.filter((f) =>
            (f.nombre ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q),
          );
        }
        if (tipo_entidad) filas = filas.filter((f) => (f.tipo_entidad ?? "").toLowerCase().includes(tipo_entidad.toLowerCase()));
        if (estado) filas = filas.filter((f) => (f.estado ?? "").toUpperCase() === estado);
        const { filas: entidades, paginado } = paginar(filas, offset, limit);
        const advertencia =
          cache === "red"
            ? "Primera carga del catálogo (~5.4MB HTML): puede exceder el límite de CPU del plan free de Workers; use plan paid o espere al cacheado (24h)."
            : undefined;
        const texto = entidades.length
          ? `Catálogo de entidades (total ${paginado.total}, cache ${cache})${advertencia ? " — ADVERTENCIA: " + advertencia : ""}:\n${resumirTabla(entidades, ["rut", "nombre", "tipo_entidad", "estado"])}`
          : "Sin entidades que coincidan.";
        return toolOk(texto, { entidades, total: paginado.total, next_offset: paginado.next_offset, cache, advertencia });
      } catch (e) {
        return fromError(e);
      }
    },
  );
}
