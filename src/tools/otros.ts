import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { normativaDescargaSchema, filasSchema, xbrlVisorSchema, xbrlConsultaSchema, xbrlTaxonomiasSchema, documentoInfoSchema, documentoDescargaSchema, documentoMarkdownSchema } from "../util/schemas-output.js";
import { getLegacy, postLegacy, getLegacyBinario, fetchCmfBinario, type CmfEnv } from "../client/cmf-client.js";
import { htmlTablaAJson, fechaLegacyCompleta, fechaLegacy, xlsAJson } from "../client/parsers.js";
import { fromError, toolError, toolOk, resumirTabla } from "../util/errors.js";
import { pdfAMarkdown } from "../pdf.js";
import { procesarTablasEEFF, textoVerificacion, textoAviso } from "../eeff-tables.js";
import { paginar } from "../util/paginate.js";
import { anioSchema, fechaSchema, mesSchema, offsetSchema, limitSchema, tipoNormaSchema } from "../util/schemas.js";

export function registrarToolsOtros(server: McpServer, env: CmfEnv): void {
  // ---------- Normativa ----------

  server.registerTool(
    "cmf_normativa_buscar",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Buscar normativa",
      description:
        "Busca normas de la CMF (circulares, oficios, normas de carácter general NCG) por tipo, número, rango de fechas, entidad o materia. Incluye la normativa del último mes.",
      inputSchema: z.object({
        tipo: tipoNormaSchema.default("ALL"),
        numero: z.string().optional().describe("Número de la norma"),
        desde: fechaSchema.optional(),
        hasta: fechaSchema.optional(),
        entidad: z.string().optional(),
        materia: z.string().optional(),
        offset: offsetSchema,
        limit: limitSchema,
      }),
      outputSchema: z.object({
        normas: z.array(z.record(z.string(), z.string())),
        total: z.number(),
        next_offset: z.number().nullable(),
      }),
    },
    async ({ tipo, numero, desde, hasta, entidad, materia, offset, limit }) => {
      try {
        const f1 = desde ? desde.split("-") : { 0: "01", 1: "01", 2: "2000" };
        const f2 = hasta ? hasta.split("-") : { 0: "31", 1: "12", 2: "2100" };
        const html = await getLegacy(
          "/institucional/legislacion_normativa/normativa2.php",
          {
            tiponorma: tipo,
            numero: numero ?? "",
            dd: f1[0],
            mm: f1[1],
            aa: f1[2],
            dd2: f2[0],
            mm2: f2[1],
            aa2: f2[2],
            buscar: "Buscar",
            entidad_web: entidad ?? "",
            materia: materia ?? "",
            enviado: 1,
          },
          env,
        );
        const filas = htmlTablaAJson(html);
        // Cuando el buscador falla o está caído, la página muestra la tabla de ayuda
        // (Entidad: Todas / nomenclatura) o un error del script: nunca entregar eso como normas.
        if (html.includes("ERROR Linea") || html.includes("No existen Normas")) {
          return toolError(
            "El buscador de normativa de la CMF (normativa2.php) no devolvió normas: el servicio está caído o devolvió un error interno. " +
              "Verifícalo en https://www.cmfchile.cl/institucional/legislacion_normativa/normativa2.php y reintenta más tarde.",
          );
        }
        const normasReales = filas.filter((f) => Object.values(f).some((v) => v && !/Entidad :|Nomenclatura|CIR :|OFC|NCG :/.test(v)));
        const { filas: normas, paginado } = paginar(normasReales, offset, limit);
        const texto = normas.length
          ? `Normativa ${tipo} (total ${paginado.total}):\n${resumirTabla(normas, Object.keys(normas[0] ?? {}).slice(0, 5))}`
          : "Sin normas que coincidan. Si esperabas resultados, el buscador de la CMF puede estar caído (verifica en cmfchile.cl).";
        return toolOk(texto, { normas, total: paginado.total, next_offset: paginado.next_offset });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_normativa_descargar",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: normativaDescargaSchema,
      title: "Descargar norma (PDF)",
      description:
        "Descarga el PDF de una norma del compendio. Devuelve el contenido base64 si es pequeño (<4MB) o el resource cmf://norma/{id}.",
      inputSchema: z.object({
        archivo: z.string().describe("Ruta del archivo del compendio (ej: /web/compendio/cir/cir_2343_2024.pdf)"),
      }),
    },
    async ({ archivo }) => {
      try {
        const res = await getLegacy("/institucional/mercados/ver_archivo.php", { archivo }, env);
        const esPdf = res.startsWith("%PDF") || res.includes("%PDF");
        if (!esPdf) {
          const filas = htmlTablaAJson(res);
          return toolOk(`El archivo no es un PDF directo (${res.length} bytes); puede requerir autenticación.`, { filas: filas.slice(0, 50) });
        }
        return toolOk(
          `Norma descargada (${Math.round(res.length / 1024)} KB). Consulte el resource cmf://norma para su contenido.`,
          { archivo, tamano_kb: Math.round(res.length / 1024), formato: "pdf" },
        );
      } catch (e) {
        return fromError(e);
      }
    },
  );

  // ---------- Seguros ----------

  server.registerTool(
    "cmf_seguros_eeff",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "EEFF de compañías de seguros",
      description: "Estados financieros (FECU) de compañías de seguros generales o de vida por período.",
      inputSchema: z.object({
        tipo: z.enum(["generales", "vida"]).default("generales"),
        sociedades: z.array(z.string()).default(["0"]),
        anio1: anioSchema,
        anio2: anioSchema,
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional(),
      }),
    },
    async ({ tipo, sociedades, anio1, anio2, mes1, mes2 }) => {
      try {
        const path =
          tipo === "generales"
            ? "/institucional/estadisticas/seg_gen_fecu_index.php"
            : "/institucional/estadisticas/seg_vida_fecu_index.php";
        const html = await postLegacy(
          path,
          {
            lang: "es",
            tiposociedad: "A",
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
          ? `EEFF seguros ${tipo} ${anio1}-${anio2} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin resultados de EEFF de seguros.";
        return toolOk(texto, { tipo, filas: filas.slice(0, 300) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_seguros_rentas_vitalicias",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Estadísticas de Rentas Vitalicias",
      description:
        "Estadísticas del mercado de rentas vitalicias previsionales por compañía (comisiones, primas, tasas de interés, rankings de asesores).",
      inputSchema: z.object({
        codigo: z
          .string()
          .describe("Código de estadística (ej: com_int_rvp, pri_uni_rvp, tas_int_med_rvp, rank_ases_prev)"),
        offset: offsetSchema,
        limit: limitSchema,
      }),
    },
    async ({ codigo, offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/estadisticas/svtas_param.php", { p: codigo }, env);
        const filas = htmlTablaAJson(html);
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = paginadas.length
          ? `RVP ${codigo} (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`
          : "Sin estadísticas para el código.";
        return toolOk(texto, { codigo, filas: paginadas, total: paginado.total });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_seguros_scomp",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Estadísticas SCOMP",
      description: "Estadísticas del Sistema de Consultas y Ofertas del Mercado de Pensiones (SCOMP).",
      inputSchema: z.object({ offset: offsetSchema, limit: limitSchema }),
    },
    async ({ offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/mercados/seguros_scomp_estadisticas.php", {}, env);
        const filas = htmlTablaAJson(html);
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = paginadas.length
          ? `SCOMP (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`
          : "Sin estadísticas SCOMP.";
        return toolOk(texto, { filas: paginadas, total: paginado.total });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_seguros_clasificacion_riesgo",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Clasificación de riesgo de seguros (RGCRI)",
      description: "Clasificación de riesgo de compañías de seguros y reseñas por período.",
      inputSchema: z.object({ anio: anioSchema, mes: mesSchema.optional() }),
    },
    async ({ anio, mes }) => {
      try {
        const html = await getLegacy(
          "/institucional/estadisticas/merc_seguros/rgcri/seg_rgcri_inf1.php",
          { anio, mes: mes ?? "12", via: "" },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `RGCRI ${anio}-${mes ?? "12"} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin clasificaciones de riesgo para el período.";
        return toolOk(texto, { anio, filas: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_seguros_satra",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Transacciones Art. 12 Ley 18.045",
      description: "Transacciones de compañías de seguros bajo el artículo 12 de la Ley 18.045.",
      inputSchema: z.object({ offset: offsetSchema, limit: limitSchema }),
    },
    async ({ offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/estadisticas/seguros_satra_art12v.php", {}, env);
        const filas = htmlTablaAJson(html);
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = paginadas.length
          ? `Transacciones Art. 12 (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`
          : "Sin transacciones.";
        return toolOk(texto, { filas: paginadas, total: paginado.total });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_seguros_siniestros",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Siniestros detectados no reportados",
      description: "Consulta de siniestros detectados no reportados por compañías de seguros.",
      inputSchema: z.object({ offset: offsetSchema, limit: limitSchema }),
    },
    async ({ offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/estadisticas/sgndr/consulta_siniestro.php", {}, env);
        const filas = htmlTablaAJson(html);
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = paginadas.length
          ? `Siniestros no reportados (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`
          : "Sin siniestros.";
        return toolOk(texto, { filas: paginadas, total: paginado.total });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_seguros_cumplimiento",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Cumplimiento de normativa de seguros",
      description: "Cumplimiento de la normativa por compañías de seguros (grid AJAX del sistema sv_cumplimientos).",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema.optional(),
        tipoentidad: z.string().optional(),
      }),
    },
    async ({ anio, mes, tipoentidad }) => {
      try {
        const html = await postLegacy(
          "/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento1grid.php",
          { anio, mes: mes ?? "12", tipoentidad: tipoentidad ?? "CSGEN" },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Cumplimiento ${anio}-${mes ?? "12"} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin datos de cumplimiento.";
        return toolOk(texto, { anio, filas: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_seguros_inversiones_vida",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Cartera de inversiones de seguros (C.1835)",
      description: "Cartera de inversiones de compañías de seguros de vida/reaseguradoras (Circular 1835).",
      inputSchema: z.object({
        tipoentidad: z.enum(["CSVID", "CSGEN"]).default("CSVID"),
        offset: offsetSchema,
        limit: limitSchema,
      }),
    },
    async ({ tipoentidad, offset, limit }) => {
      try {
        const html = await getLegacy(
          "/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/descarga_cartera_inv.php",
          { tipoentidad },
          env,
        );
        const filas = htmlTablaAJson(html);
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = paginadas.length
          ? `Cartera inversiones ${tipoentidad} (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`
          : "Sin cartera de inversiones.";
        return toolOk(texto, { tipoentidad, filas: paginadas, total: paginado.total });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_seguros_produccion_corredores",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Producción de corredores de seguros",
      description: "Producción de corredores de seguros (sistema ISPRO).",
      inputSchema: z.object({
        tipoentidad: z.enum(["CSJUR", "CSGEN", "CSVID"]).default("CSJUR"),
        offset: offsetSchema,
        limit: limitSchema,
      }),
    },
    async ({ tipoentidad, offset, limit }) => {
      try {
        const html = await getLegacy(
          "/institucional/estadisticas/merc_seguros/produccion/ispro/descarga_ispro.php",
          { tipoentidad },
          env,
        );
        const filas = htmlTablaAJson(html);
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = paginadas.length
          ? `Producción corredores ${tipoentidad} (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`
          : "Sin producción de corredores.";
        return toolOk(texto, { tipoentidad, filas: paginadas, total: paginado.total });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_seguros_sic",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Estadísticas Conoce tu seguro (SIC)",
      description: "Estadísticas del sistema 'Conoce tu seguro': consultas sobre pólizas de seguros por período.",
      inputSchema: z.object({ desde: fechaSchema, hasta: fechaSchema }),
    },
    async ({ desde, hasta }) => {
      try {
        const html = await getLegacy(
          "/institucional/estadisticas/sic/index.php",
          { fecha_ini: fechaLegacyCompleta(desde), fecha_fin: fechaLegacyCompleta(hasta) },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Estadísticas SIC (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Sin estadísticas SIC.";
        return toolOk(texto, { desde, hasta, filas: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  // ---------- XBRL ----------

  server.registerTool(
    "cmf_xbrl_taxonomias",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Taxonomías XBRL disponibles",
      description: "Lista las taxonomías XBRL del Mercado de Valores publicadas por la CMF (CL-CI, CL-CC, CL-BS, CL-EI, CL-HB, CL-HS).",
      inputSchema: z.object({}),
      outputSchema: xbrlTaxonomiasSchema,
    },
    async () => {
      const taxonomias = ["CL-CI", "CL-CC", "CL-BS", "CL-EI", "CL-HB", "CL-HS"];
      return toolOk(
        `Taxonomías XBRL Mercado de Valores: ${taxonomias.join(", ")} (versiones 2016-2026).`,
        { taxonomias },
      );
    },
  );

  server.registerTool(
    "cmf_xbrl_visor",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: xbrlVisorSchema,
      title: "Visor de taxonomía XBRL",
      description: "Navega una taxonomía XBRL de la CMF (estructura de etiquetas por taxonomía y fecha de versión).",
      inputSchema: z.object({
        taxonomia: z.enum(["cl-ci", "cl-cc", "cl-bs", "cl-ei", "cl-hb", "cl-hs"]),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha de versión (ej: 2021-01-04)"),
      }),
    },
    async ({ taxonomia, fecha }) => {
      try {
        const html = await getLegacy(
          `/institucional/estadisticas/xbrl_intranet/prototipo/displaytaxonomia/${taxonomia}_shell_${fecha}.html`,
          {},
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Taxonomía ${taxonomia} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 4))}`
          : `Visor de ${taxonomia} cargado (${html.length} bytes); estructura no tabular.`;
        return toolOk(texto, { taxonomia, fecha, filas: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_xbrl_consulta",
    {
      annotations: { readOnlyHint: false, destructiveHint: true },
      outputSchema: xbrlConsultaSchema,
      title: "Formulario de consulta XBRL",
      description: "Envía una consulta a la CMF sobre el uso de XBRL (soporte técnico).",
      inputSchema: z.object({
        mercado: z.enum(["V", "S"]).default("V"),
        nombre: z.string(),
        email: z.string().email(),
        empresa: z.string().optional(),
        pais: z.string().optional(),
      }),
    },
    async ({ mercado, nombre, email, empresa, pais }) => {
      try {
        const html = await postLegacy(
          "/institucional/mercados/xbrl_consulta.php",
          {
            mercado,
            xbrl_nombre: nombre,
            xbrl_apellido: "",
            xbrl_email_from: email,
            xbrl_empresa: empresa ?? "",
            xbrl_pais: pais ?? "Chile",
          },
          env,
        );
        const ok = html.includes("grac") || html.includes("Gracias") || html.includes("enviada");
        return toolOk(
          ok ? "Consulta XBRL enviada a la CMF." : "No se pudo confirmar el envío de la consulta.",
          { enviada: ok },
        );
      } catch (e) {
        return fromError(e);
      }
    },
  );

  // ---------- Documentos ----------

  server.registerTool(
    "cmf_documento_info",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: documentoInfoSchema,
      title: "Información de documento firmado",
      description:
        "Devuelve la metadata de un documento firmado de la CMF (hechos esenciales, sanciones, resoluciones, informes) a partir de su token s567. No descarga el contenido.",
      inputSchema: z.object({
        s567: z.string().min(10).describe("Token del documento (extraído de hechos/sanciones/resoluciones)"),
      }),
    },
    async ({ s567 }) => {
      return toolOk(
        `Documento ${s567.slice(0, 12)}… disponible. Use cmf_documento_descargar para obtenerlo o el resource cmf://documento/${s567.slice(0, 16)}.`,
        { s567, disponible: true },
      );
    },
  );

  server.registerTool(
    "cmf_documento_descargar",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: documentoDescargaSchema,
      title: "Descargar documento firmado",
      description:
        "Descarga un documento firmado de la CMF (PDF/XLS/XLSX) usando su token s567. El servidor gestiona el token; nunca se expone al modelo. Para documentos grandes use el resource cmf://documento/{id}.",
      inputSchema: z.object({
        s567: z.string().min(10).describe("Token del documento"),
      }),
    },
    async ({ s567 }) => {
      try {
        const url = `https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=${encodeURIComponent(s567)}&secuencia=-1&t=${Date.now()}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "mcp-cmf-chile/0.1" },
        });
        if (!res.ok) return toolOk(`Error HTTP ${res.status} al descargar el documento.`, { s567, error: res.status });
        const buf = await res.arrayBuffer();
        const tamano = buf.byteLength;
        const contentType = res.headers.get("Content-Type") ?? "";
        if (tamano > 4 * 1024 * 1024) {
          return toolOk(
            `Documento de ${Math.round(tamano / 1024 / 1024)}MB (${contentType}). Demasiado grande para inline; consulte el resource cmf://documento/${s567.slice(0, 16)}.`,
            { s567, tamano, contentType, resource: `cmf://documento/${s567.slice(0, 16)}` },
          );
        }
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        return toolOk(
          `Documento descargado (${Math.round(tamano / 1024)} KB, ${contentType}).`,
          { s567, tamano, contentType, base64 },
        );
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_documento_markdown",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: documentoMarkdownSchema,
      title: "Convertir documento PDF de la CMF a Markdown",
      description:
        "Descarga un documento firmado de la CMF (EEFF, hechos, sanciones, resoluciones, normas) y lo convierte a Markdown legible para el agente (tablas, encabezados, listas) usando pdf-inspector, sin OCR. Acepta el token s567 (de hechos/sanciones/resoluciones) o una URL de documento de la CMF. Si el PDF es escaneado, lo indica (no hay OCR).",
      inputSchema: z.object({
        token: z.string().min(10).optional().describe("Token s567 del documento (de hechos/sanciones/resoluciones)"),
        url: z.string().url().optional().describe("URL absoluta de un documento de la CMF (ej: ver_archivo.php del compendio)"),
        max_chars: z.number().int().min(1000).max(100000).default(30000).describe("Máximo de caracteres del markdown (recorta el resto)"),
        validar_contable: z.boolean().default(false).describe("true = verifica la cuadratura contable (experimental)"),
      }),
    },
    async ({ token, url, max_chars, validar_contable }) => {
      try {
        if (!token && !url) {
          return {
            content: [{ type: "text", text: "Indique un token s567 o una url de documento de la CMF." }],
            isError: true,
          };
        }
        const tokenFinal = token ?? "";
        const urlDoc = url ?? `https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=${encodeURIComponent(tokenFinal)}&secuencia=-1&t=${Date.now()}`;
        const { bytes, contentType } = await fetchCmfBinario(urlDoc, env);
        if (!contentType.includes("pdf") && !bytes.slice(0, 5).includes(0x25)) {
          return toolOk(`El documento no parece ser un PDF (content-type: ${contentType || "desconocido"}).`, {
            tamano_kb: Math.round(bytes.length / 1024),
            contentType,
          });
        }
        const { pdfType, markdown } = await pdfAMarkdown(env.__pdfModule, bytes);
        // Post-procesamiento de tablas: des-fusión, sospechosas y cuadratura contable
        const procesado = procesarTablasEEFF(markdown ?? "");
        const avisoFusion = textoAviso(procesado);
        const verificacion = validar_contable ? textoVerificacion(procesado) : "";
        const textoMd = procesado.markdown ?? "";
        const truncado = textoMd.length > max_chars;
        const textoFinal = truncado ? `${textoMd.slice(0, max_chars)}\n...[truncado: ${textoMd.length - max_chars} caracteres]` : textoMd;
        const tipoLimpio = pdfType.toLowerCase().replace("textbased", "text-based");
        return toolOk(
          `${verificacion}${avisoFusion}\n\nDocumento convertido a Markdown (tipo: ${tipoLimpio}, ${Math.round(bytes.length / 1024)} KB, ${textoMd.length} caracteres):\n\n${textoFinal.slice(0, 2000)}${textoFinal.length > 2000 ? `\n...[preview recortado; el markdown completo está en structuredContent]` : ""}`,
          {
            pdf_type: pdfType,
            tamano_kb: Math.round(bytes.length / 1024),
            markdown: textoFinal,
            markdown_truncado: truncado,
            escaneado: pdfType === "Scanned" || pdfType === "ImageBased",
            filas_separadas: procesado.filasSeparadas,
            filas_fusionadas_pendientes: procesado.filasFusionadasPendientes,
            ...(validar_contable ? { verificacion_contable: procesado.cuadratura } : {}),
            es_estado_financiero: procesado.esEstadoFinanciero,
            fuente: urlDoc.slice(0, 120),
          },
        );
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_seguros_deposito_polizas",
    {
      title: "Registro de Depósito de Pólizas (seguros)",
      description:
        "Busca en el Registro de Depósito de Pólizas de la CMF (mercado de seguros): pólizas y cláusulas depositadas por compañías de seguros, con código, fecha de depósito, aseguradora, texto depositado, temas y norma (NCG 124/349). Sin filtros devuelve el registro completo (~7.000 pólizas) — use filtros o paginación. Con exportar=true descarga el exportador XLSX oficial de la base.",
      inputSchema: z.object({
        poliza: z.string().optional().describe("Código de póliza (ej: POL107024)"),
        desde: fechaSchema.optional(),
        hasta: fechaSchema.optional(),
        norma: z.enum(["ALL", "124", "349"]).optional().describe("NCG 124 o 349; ALL=ambas"),
        tema: z.string().optional().describe("Tema (ej: 301=Accidentes Personales, 109=Agrícola, 205=APV, 208=APVC)"),
        texto: z.string().optional().describe("Texto depositado (búsqueda parcial)"),
        offset: offsetSchema,
        limit: limitSchema,
        exportar: z.boolean().default(false).describe("true = usa el exportador XLSX de toda la base (grande)"),
      }),
    },
    async ({ poliza, desde, hasta, norma, tema, texto, offset, limit, exportar }) => {
      try {
        if (!exportar && !texto && !tema && !poliza) {
          return {
            content: [{ type: "text", text: "El registro completo de pólizas tiene ~7.000 registros y es muy pesado. Use un filtro (texto, tema o poliza) o exportar=true para la base completa en XLSX." }],
            isError: true,
          };
        }
        const f1 = desde ? fechaLegacy(desde) : { dd: "01", mm: "01", aa: "2009" };
        const f2 = hasta ? fechaLegacy(hasta) : { dd: "31", mm: "12", aa: "2100" };
        const params = {
          poliza: poliza ?? "",
          dd: f1.dd, mm: f1.mm, aa: f1.aa,
          dd2: f2.dd, mm2: f2.mm, aa2: f2.aa,
          norma: norma ?? "ALL",
          texto: texto ?? "",
          tema: tema ?? "ALL",
          mercado: "S",
        };
        const envLento = { ...env, CMF_UPSTREAM_TIMEOUT_MS: "60000" };
        if (exportar) {
          const res = await getLegacyBinario("/institucional/inc/seguros_deposito_consulta2_excel.php", params, envLento);
          const filas = xlsAJson(res) as Record<string, unknown>[];
          const { filas: paginadas, paginado } = paginar(filas, offset, limit);
          const textoOut = paginadas.length
            ? `Exportador de pólizas depositadas (total ${paginado.total}):\n${resumirTabla(paginadas, ["Codigo", "Fecha", "Entidad", "Texto depositado", "Temas"])}`
            : "Sin pólizas en el exportador para los filtros.";
          return toolOk(textoOut, { total: paginado.total, filas: paginadas, exportador: "xlsx" });
        }
        const html = await getLegacy("/institucional/inc/seguros_deposito_consulta2.php", params, envLento);
        const filas = htmlTablaAJson(html, ["codigo", "fecha", "entidad", "texto", "polizas", "temas", "resolucion"]).filter(
          (f) => /^[A-Z]{3}\d+$/.test(f.codigo ?? ""),
        );
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const textoOut = paginadas.length
          ? `Pólizas depositadas (total ${paginado.total}):\n${resumirTabla(paginadas, ["codigo", "fecha", "entidad", "texto"])}`
          : "Sin pólizas que coincidan con los filtros.";
        return toolOk(textoOut, { total: paginado.total, next_offset: paginado.next_offset, polizas: paginadas });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          return {
            content: [{ type: "text", text: "La búsqueda es demasiado amplia (miles de pólizas) y excede el límite del servidor. Acote con: poliza específica, rango de fechas corto (desde/hasta) o un texto más específico. Alternativa: exportar=true con el mismo filtro acotado." }],
            isError: true,
          };
        }
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_seguros_polizas_resoluciones_prohibidas",
    {
      title: "Resoluciones que prohíben depósito de pólizas",
      description:
        "Lista de resoluciones de la CMF que prohíben a una aseguradora depositar pólizas (registro desde abril de 2009). Devuelve número, fecha, póliza afectada, materia y archivo.",
      inputSchema: z.object({ offset: offsetSchema, limit: limitSchema }),
    },
    async ({ offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/mercados/banner_resolucion_prohibe.php", {}, env);
        const filas = htmlTablaAJson(html, ["numero", "fecha", "poliza", "materia", "archivo"]).filter(
          (f) => /^\d+$/.test(f.numero ?? ""),
        );
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const textoOut = paginadas.length
          ? `Resoluciones de prohibición (total ${paginado.total}):\n${resumirTabla(paginadas, ["numero", "fecha", "poliza", "materia"])}`
          : "Sin resoluciones de prohibición.";
        return toolOk(textoOut, { total: paginado.total, next_offset: paginado.next_offset, resoluciones: paginadas });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  // ---------- Bancos (servlets legacy SBIF) ----------

  server.registerTool(
    "cmf_bancos_tasas",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Buscador de tasas bancarias",
      description: "Buscador de tasas de interés de instituciones financieras (servlet InfoFinanciera de la SBIF).",
      inputSchema: z.object({
        indice: z.string().default("4.1").describe("Índice del reporte"),
      }),
    },
    async ({ indice }) => {
      try {
        const html = await getLegacy(
          "/sbifweb/servlet/InfoFinanciera",
          { indice },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Tasas (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Formulario de tasas cargado (puede requerir navegación).";
        return toolOk(texto, { indice, filas: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_bancos_cronologia",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Cronología bancaria",
      description: "Cronología histórica del sistema bancario chileno (servlet CronologiaBancaria).",
      inputSchema: z.object({ indice: z.string().default("8.0") }),
    },
    async ({ indice }) => {
      try {
        const html = await getLegacy(
          "/sbifweb/servlet/CronologiaBancaria",
          { indice },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Cronología bancaria (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 5))}`
          : "Cronología cargada; contenido no tabular.";
        return toolOk(texto, { indice, filas: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_bancos_reportes",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Reportes de instituciones financieras (BaseDato)",
      description:
        "Reportes del sistema BaseDato de instituciones financieras (puede requerir resolver el challenge anti-bot de la CMF; si falla, reintente).",
      inputSchema: z.object({
        reporte: z.string().default("FIC").describe("Código del reporte"),
        indice: z.string().default("30.1"),
        periodo_inicial: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("AAAAMM o AAAA-MM"),
        periodo_final: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        institucion: z.string().optional().describe("Código de institución"),
      }),
    },
    async ({ reporte, indice, periodo_inicial, periodo_final, institucion }) => {
      try {
        const html = await getLegacy(
          "/sbifweb/servlet/BaseDato",
          {
            "instituciones-financieras": 1,
            reporte,
            indice,
            periodo_inicial_anio: periodo_inicial?.slice(0, 4),
            periodo_inicial_mes: periodo_inicial?.slice(5, 7),
            periodo_final_anio: periodo_final?.slice(0, 4),
            periodo_final_mes: periodo_final?.slice(5, 7),
            codUnicoBank: institucion ?? "",
          },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Reporte ${reporte} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : `Reporte ${reporte} cargado sin tablas parseables (${html.length} bytes).`;
        return toolOk(texto, { reporte, indice, filas: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );
}
