import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { normativaDescargaSchema, filasSchema, xbrlVisorSchema, xbrlConsultaSchema, xbrlTaxonomiasSchema, documentoInfoSchema, documentoDescargaSchema, documentoMarkdownSchema } from "../util/schemas-output.js";
import { getLegacy, postLegacy, getLegacyBinario, fetchCmf, fetchCmfBinario, type CmfEnv } from "../client/cmf-client.js";
import { htmlTablaAJson, fechaLegacyCompleta, fechaLegacy, xlsAJson } from "../client/parsers.js";
import { fromError, toolError, toolErrorFuente, toolOk, resumirTabla } from "../util/errors.js";
import { bytesABase64 } from "../util/zip.js";
import { pdfAMarkdown } from "../pdf.js";
import { procesarTablasEEFF, textoVerificacion, textoAviso } from "../eeff-tables.js";
import { paginar } from "../util/paginate.js";
import {
  anioSchema, fechaSchema, mesSchema, offsetSchema, limitSchema, tipoNormaSchema } from "../util/schemas.js";

export function registrarToolsOtros(server: McpServer, env: CmfEnv): void {
  // ---------- Normativa ----------

  server.registerTool(
    "cmf_normativa_buscar",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Buscar normativa",
      description:
        "Busca normas de la CMF (circulares, oficios, normas de carácter general NCG) por tipo, número, rango de fechas, entidad o materia, paginado con offset/limit. Usa el buscador legacy de la CMF, que puede estar caído (la CMF migró al portal nuevo): si no devuelve resultados, use cmf_normativa_descargar si conoce la ruta, o el portal cmfchile.cl. Use esta tool para encontrar normas por materia; para descargar el PDF de una norma ya identificada use cmf_normativa_descargar.",
      inputSchema: z.object({
        tipo: tipoNormaSchema.default("ALL"),
        numero: z.string().optional().describe("Número de la norma"),
        desde: fechaSchema.optional(),
        hasta: fechaSchema.optional(),
        entidad: z.string().optional().describe("Entidad supervisada emisora de la norma (texto libre)"),
        materia: z.string().optional().describe("Materia de la norma (texto libre)"),
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
        // desde/hasta vienen en YYYY-MM-DD: el buscador legacy espera dd/mm/aa por separado.
        const f1 = desde ? { dd: desde.slice(8, 10), mm: desde.slice(5, 7), aa: desde.slice(0, 4) } : { dd: "01", mm: "01", aa: "2000" };
        const f2 = hasta ? { dd: hasta.slice(8, 10), mm: hasta.slice(5, 7), aa: hasta.slice(0, 4) } : { dd: "31", mm: "12", aa: "2100" };
        const html = await getLegacy(
          "/institucional/legislacion_normativa/normativa2.php",
          {
            tiponorma: tipo,
            numero: numero ?? "",
            dd: f1.dd,
            mm: f1.mm,
            aa: f1.aa,
            dd2: f2.dd,
            mm2: f2.mm,
            aa2: f2.aa,
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
            "El buscador de normativa legacy de la CMF (normativa2.php) no devolvió resultados: está caído o ya no se mantiene " +
              "(la CMF migró su normativa al portal nuevo). Alternativas: (1) use cmf_normativa_descargar con la ruta del compendio " +
              "(ej: /web/compendio/cir/cir_2343_2024.pdf) si conoce el documento, o (2) consulte el portal de normativa de la CMF en " +
              "https://www.cmfchile.cl/portal/normativa/624/w4-propertyname-916.html y reintente más tarde.",
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
        "Descarga el PDF de una norma del compendio de la CMF y lo devuelve en base64 si es pequeño (<4MB) o con la URL directa si es más grande. Requiere la ruta exacta del archivo dentro del compendio (ej: /web/compendio/cir/cir_2343_2024.pdf). Si la respuesta no es un PDF directo (puede requerir autenticación), lo indica. Use esta tool cuando conozca la ruta del documento; para encontrar normas use cmf_normativa_buscar; para leer el PDF como texto use cmf_documento_markdown con la URL.",
      inputSchema: z.object({
        archivo: z.string().describe("Ruta del archivo del compendio (ej: /web/compendio/cir/cir_2343_2024.pdf)"),
      }),
    },
    async ({ archivo }) => {
      try {
        const bytes = await getLegacyBinario("/institucional/mercados/ver_archivo.php", { archivo }, env);
        const esPdf = bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
        if (!esPdf) {
          const texto = new TextDecoder("windows-1252").decode(bytes);
          const filas = htmlTablaAJson(texto);
          return toolOk(`El archivo no es un PDF directo (${bytes.length} bytes); puede requerir autenticación.`, { filas: filas.slice(0, 50) });
        }
        const tamano = bytes.length;
        const urlPdf = `https://www.cmfchile.cl/institucional/mercados/ver_archivo.php?archivo=${encodeURIComponent(archivo)}`;
        if (tamano > 4 * 1024 * 1024) {
          return toolOk(
            `Norma descargada (${Math.round(tamano / 1024 / 1024)}MB): demasiado grande para inline. Use cmf_documento_markdown con la URL ${urlPdf} para leerla como texto.`,
            { archivo, tamano_kb: Math.round(tamano / 1024), formato: "pdf", url: urlPdf },
          );
        }
        let bin = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
        return toolOk(
          `Norma descargada (${Math.round(tamano / 1024)} KB). El contenido base64 está en structuredContent.base64; para leerla como texto use cmf_documento_markdown con la URL ${urlPdf}.`,
          { archivo, tamano_kb: Math.round(tamano / 1024), formato: "pdf", base64: btoa(bin), url: urlPdf },
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
      description:
        "Devuelve los estados financieros (FECU) de compañías de seguros generales o de vida de la CMF para un rango de períodos. Requiere anio1/anio2 en AAAA (rango de años); mes1/mes2 en MM opcionales (default 12). Filtre por tipo (generales o vida; default generales) y sociedades (array de códigos de compañía; ['0']=todas). Use esta tool para balances de aseguradoras; para su clasificación de riesgo use cmf_seguros_clasificacion_riesgo.",
      inputSchema: z.object({
        tipo: z.enum(["generales", "vida"]).default("generales").describe("Segmento de seguros: generales o vida (default generales)"),
        sociedades: z.array(z.string()).default(["0"]).describe("Códigos de compañías (array; ['0']=todas)"),
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
        "Devuelve estadísticas del mercado de rentas vitalicias previsionales por compañía (comisiones, primas, tasas de interés, rankings de asesores). Elija la estadística con codigo (ej: com_int_rvp=comisiones intermediación, pri_uni_rvp=primas únicas, tas_int_med_rvp=tasas de interés promedio, rank_ases_prev=ranking de asesores); resultados paginados con offset/limit (máx 500). Use cmf_seguros_scomp para estadísticas agregadas del sistema SCOMP.",
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
        if (filas.length === 0) {
          return toolErrorFuente(
            `Estadísticas de rentas vitalicias ${codigo}`,
            `https://www.cmfchile.cl/institucional/estadisticas/svtas_param.php?p=${codigo}`,
          );
        }
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = `RVP ${codigo} (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`;
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
      description:
        "Devuelve las estadísticas del SCOMP (Sistema de Consultas y Ofertas del Mercado de Pensiones) publicadas por la CMF. Sin parámetros de filtro; use offset/limit para paginar el listado. Use esta tool para el mercado de pensiones a nivel sistema; para estadísticas por compañía use cmf_seguros_rentas_vitalicias.",
      inputSchema: z.object({ offset: offsetSchema, limit: limitSchema }),
    },
    async ({ offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/mercados/seguros_scomp_estadisticas.php", {}, env);
        const filas = htmlTablaAJson(html);
        if (filas.length === 0) {
          return toolErrorFuente(
            "Estadísticas SCOMP",
            "https://www.cmfchile.cl/institucional/mercados/seguros_scomp_estadisticas.php",
          );
        }
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = `SCOMP (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`;
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
      description:
        "Devuelve la clasificación de riesgo de las compañías de seguros (RGCRI) publicada por la CMF, con las reseñas de las clasificadoras por período. Filtre por anio en AAAA y mes en MM (opcional; default 12). Use esta tool para evaluar la solvencia de aseguradoras; para sus estados financieros use cmf_seguros_eeff.",
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
      description:
        "Devuelve las transacciones de compañías de seguros informadas conforme al artículo 12 de la Ley 18.045 (Ley de Mercado de Valores), publicadas por la CMF. Sin parámetros de filtro; use offset/limit para paginar el listado. Use esta tool para transacciones del mercado de seguros; para los estados financieros de aseguradoras use cmf_seguros_eeff.",
      inputSchema: z.object({ offset: offsetSchema, limit: limitSchema }),
    },
    async ({ offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/estadisticas/seguros_satra_art12v.php", {}, env);
        const filas = htmlTablaAJson(html);
        if (filas.length === 0) {
          return toolErrorFuente(
            "Transacciones Art. 12 Ley 18.045",
            "https://www.cmfchile.cl/institucional/estadisticas/seguros_satra_art12v.php",
          );
        }
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = `Transacciones Art. 12 (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`;
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
      description:
        "Devuelve los siniestros detectados por la CMF que no fueron reportados por las compañías de seguros dentro del plazo. Sin parámetros de filtro; use offset/limit para paginar el listado. Use esta tool para fiscalización de aseguradoras; para el cumplimiento normativo general use cmf_seguros_cumplimiento.",
      inputSchema: z.object({ offset: offsetSchema, limit: limitSchema }),
    },
    async ({ offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/estadisticas/sgndr/consulta_siniestro.php", {}, env);
        const filas = htmlTablaAJson(html);
        if (filas.length === 0) {
          return toolErrorFuente(
            "Siniestros detectados no reportados",
            "https://www.cmfchile.cl/institucional/estadisticas/sgndr/consulta_siniestro.php",
          );
        }
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = `Siniestros no reportados (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`;
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
      description:
        "Devuelve el estado de cumplimiento de la normativa por compañías de seguros de la CMF (sistema sv_cumplimientos). Filtre por anio en AAAA, mes en MM (opcional; default 12) y tipoentidad (CSGEN=seguros generales, CSVID=seguros de vida; default CSGEN). Use esta tool para supervisar cumplimiento; para siniestros no reportados use cmf_seguros_siniestros.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema.optional(),
        tipoentidad: z.string().optional().describe("Tipo de entidad: CSGEN=seguros generales (default), CSVID=seguros de vida"),
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
        if (filas.length === 0) {
          return toolErrorFuente(
            `Cumplimiento de aseguradoras ${anio}-${mes ?? "12"}`,
            "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento1grid.php",
          );
        }
        const texto = `Cumplimiento ${anio}-${mes ?? "12"} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`;
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
      description:
        "Devuelve la cartera de inversiones de compañías de seguros de la CMF (Circular 1835), con detalle de instrumentos por entidad. Filtre por tipoentidad (CSVID=seguros de vida, CSGEN=seguros generales; default CSVID) y pagine con offset/limit. Use esta tool para ver en qué invierten las aseguradoras; para la cartera de fondos mutuos use cmf_fondos_mutuos_cartera.",
      inputSchema: z.object({
        tipoentidad: z.enum(["CSVID", "CSGEN"]).default("CSVID").describe("Tipo de entidad: CSVID=seguros de vida (default), CSGEN=seguros generales"),
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
        if (filas.length === 0) {
          return toolErrorFuente(
            `Cartera de inversiones (C.1835) ${tipoentidad}`,
            "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/descarga_cartera_inv.php",
          );
        }
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = `Cartera inversiones ${tipoentidad} (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`;
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
      description:
        "Devuelve la producción de corredores de seguros publicada por la CMF (sistema ISPRO). Filtre por tipoentidad (CSJUR=corredores, CSGEN=seguros generales, CSVID=seguros de vida; default CSJUR) y pagine con offset/limit. Use esta tool para la intermediación del mercado de seguros; para la cartera de las compañías use cmf_seguros_inversiones_vida.",
      inputSchema: z.object({
        tipoentidad: z.enum(["CSJUR", "CSGEN", "CSVID"]).default("CSJUR").describe("Tipo de entidad: CSJUR=corredores (default), CSGEN=seguros generales, CSVID=seguros de vida"),
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
        if (filas.length === 0) {
          return toolErrorFuente(
            `Producción de corredores (ISPRO) ${tipoentidad}`,
            "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/produccion/ispro/descarga_ispro.php",
          );
        }
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = `Producción corredores ${tipoentidad} (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`;
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
      description:
        "Devuelve las estadísticas del sistema 'Conoce tu seguro' (SIC) de la CMF: consultas de usuarios sobre pólizas de seguros en un rango de fechas. Requiere desde y hasta en YYYY-MM-DD (acepta DD/MM/AAAA). Use esta tool para la demanda de información del mercado de seguros; para el registro de pólizas depositadas use cmf_seguros_deposito_polizas.",
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
      description:
        "Lista las taxonomías XBRL del Mercado de Valores publicadas por la CMF (CL-CI, CL-CC, CL-BS, CL-EI, CL-HB, CL-HS). No requiere parámetros. Use esta tool para conocer las taxonomías disponibles; para navegar la estructura de una use cmf_xbrl_visor.",
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
      description:
        "Navega la estructura de una taxonomía XBRL de la CMF: etiquetas y conceptos según taxonomía y fecha de versión. Requiere taxonomia (cl-ci, cl-cc, cl-bs, cl-ei, cl-hb o cl-hs) y fecha de versión en YYYY-MM-DD (ej: 2021-01-04). Use esta tool para explorar el detalle de una taxonomía; para listar las disponibles use cmf_xbrl_taxonomias.",
      inputSchema: z.object({
        taxonomia: z.enum(["cl-ci", "cl-cc", "cl-bs", "cl-ei", "cl-hb", "cl-hs"]).describe("Taxonomía a navegar: cl-ci, cl-cc, cl-bs, cl-ei, cl-hb o cl-hs"),
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
      description:
        "Envía un formulario de consulta sobre XBRL al soporte técnico de la CMF; es la única tool que envía información a la CMF (no es de solo lectura: úsela solo si el usuario lo pide explícitamente). Requiere nombre y email válido; mercado (V=valores, S=seguros; default V), empresa y pais son opcionales (pais default Chile). Para consultar taxonomías sin enviar nada, use cmf_xbrl_visor.",
      inputSchema: z.object({
        mercado: z.enum(["V", "S"]).default("V").describe("Mercado de la consulta: V=valores (default), S=seguros"),
        nombre: z.string().describe("Nombre de la persona que consulta"),
        email: z.string().email().describe("Email de contacto válido"),
        empresa: z.string().optional().describe("Empresa que consulta (opcional)"),
        pais: z.string().optional().describe("País (opcional; default Chile)"),
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
        "Formatea la metadata de un documento firmado de la CMF a partir de su token s567 (URL del documento y campos derivados); NO descarga el contenido ni verifica su existencia en la CMF — para eso use cmf_documento_descargar (devuelve error si el token no es válido). Use esta tool solo para inspeccionar un token; para obtener el contenido use cmf_documento_descargar (binario) o cmf_documento_markdown (PDF a Markdown).",      inputSchema: z.object({
        s567: z.string().min(10).describe("Token del documento (extraído de hechos/sanciones/resoluciones)"),
      }),
    },
    async ({ s567 }) => {
      return toolOk(
        `Token ${s567.slice(0, 12)}… formateado (URL de la CMF derivada). ADVERTENCIA: esta tool NO verifica que el documento exista; use cmf_documento_descargar para descargarlo (devuelve error si el token no es válido).`,
        { s567, url: `https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=${encodeURIComponent(s567)}&secuencia=-1`, sin_verificar: true },
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
        "Descarga un documento firmado de la CMF (PDF/XLS/XLSX) usando su token s567 (el token viaja en la URL de la CMF; se devuelve en la salida solo como eco del input). Documentos de hasta 4MB vuelven en base64 inline; los más grandes indican usar cmf_documento_markdown (para PDFs) o las tools de paquetes. Use esta tool para obtener el archivo original; para leer un PDF como texto use cmf_documento_markdown.",
      inputSchema: z.object({
        s567: z.string().min(10).describe("Token del documento (de hechos/sanciones/resoluciones)"),
      }),
    },
    async ({ s567 }) => {
      try {
        const url = `https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=${encodeURIComponent(s567)}&secuencia=-1&t=${Date.now()}`;
        const res = await fetchCmf(url, {}, env);
        if (!res.ok) return toolError(`La CMF respondió HTTP ${res.status} al descargar el documento (token inválido o expirado).`);
        const buf = await res.arrayBuffer();
        const tamano = buf.byteLength;
        const contentType = res.headers.get("Content-Type") ?? "";
        const esHtml = /text\/html/i.test(contentType) || (tamano > 0 && new Uint8Array(buf)[0] === 0x3c); // "<"
        if (esHtml) {
          return toolError(
            "La CMF devolvió una página HTML en vez del documento: el token s567 probablemente es inválido o expiró. " +
              "Obtenga un token fresco de las tools de hechos/sanciones/resoluciones y reintente.",
          );
        }
        if (tamano > 4 * 1024 * 1024) {
          return toolError(
            `Documento de ${Math.round(tamano / 1024 / 1024)}MB (${contentType}): demasiado grande para inline. ` +
              `Si es un PDF, use cmf_documento_markdown con el mismo token; para descargas masivas use cmf_empresa_paquete_documentos.`,
          );
        }
        const base64 = bytesABase64(new Uint8Array(buf));
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
      annotations: { readOnlyHint: true, destructiveHint: false },
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
      outputSchema: z.object({
        total: z.number().describe("Total de registros que coinciden con los filtros"),
        next_offset: z.number().nullable().optional().describe("Offset para la siguiente página (null si no hay más)"),
        polizas: z.array(z.record(z.string(), z.unknown())).optional().describe("Filas del registro de pólizas"),
        filas: z.array(z.record(z.string(), z.unknown())).optional().describe("Filas del exportador XLSX"),
        exportador: z.enum(["xlsx"]).optional().describe("Presente si se usó el exportador XLSX"),
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
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Resoluciones que prohíben depósito de pólizas",
      description:
        "Devuelve las resoluciones de la CMF que prohíben a una aseguradora depositar pólizas (registro desde abril de 2009), con número, fecha, póliza afectada, materia y archivo. Sin filtros; use offset/limit para paginar. Use esta tool para saber qué aseguradoras tienen restringido el depósito; para buscar pólizas depositadas use cmf_seguros_deposito_polizas.",
      inputSchema: z.object({ offset: offsetSchema, limit: limitSchema }),
      outputSchema: z.object({
        total: z.number().describe("Total de resoluciones de prohibición"),
        next_offset: z.number().nullable().describe("Offset para la siguiente página (null si no hay más)"),
        resoluciones: z.array(z.record(z.string(), z.unknown())).describe("Filas de resoluciones de prohibición"),
      }),
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
      description:
        "Devuelve las tasas de interés de instituciones financieras chilenas publicadas por la CMF (servlet InfoFinanciera de la ex SBIF) para el índice solicitado. Si el índice corresponde a un formulario, la respuesta puede no traer tablas parseables. Use esta tool para tasas bancarias; para reportes de instituciones use cmf_bancos_reportes.",
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
        if (filas.length === 0) {
          return toolErrorFuente(
            `Tasas de interés (índice ${indice})`,
            "https://www.cmfchile.cl/institucional/bancos/estadisticas_financieras.html",
            "el servlet InfoFinanciera de la ex SBIF devolvió el formulario sin tablas parseables",
          );
        }
        const texto = `Tasas (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`;
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
      description:
        "Devuelve la cronología histórica del sistema bancario chileno publicada por la CMF (servlet CronologiaBancaria de la ex SBIF). Use indice para seleccionar el capítulo (default 8.0); si el contenido no es tabular, lo indica. Use esta tool para hitos de la banca chilena; para tasas de interés use cmf_bancos_tasas.",
      inputSchema: z.object({ indice: z.string().default("8.0").describe("Índice del capítulo de la cronología (default 8.0)") }),
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
        "Devuelve reportes del sistema BaseDato de instituciones financieras de la CMF (ex SBIF). Use reporte (default FIC) e indice (default 30.1); acote con periodo_inicial/periodo_final en AAAA-MM e institucion (código de institución). Puede requerir resolver el challenge anti-bot de la CMF; si falla, reintente. Use esta tool para reportes históricos de la banca; para tasas de interés use cmf_bancos_tasas.",
      inputSchema: z.object({
        reporte: z.string().default("FIC").describe("Código del reporte"),
        indice: z.string().default("30.1").describe("Índice del reporte (default 30.1)"),
        periodo_inicial: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("Período inicial en AAAA-MM (ej: 2025-01)"),
        periodo_final: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("Período final en AAAA-MM (ej: 2025-12)"),
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
        if (filas.length === 0) {
          return toolErrorFuente(
            `Reporte ${reporte} (índice ${indice})`,
            "https://www.cmfchile.cl/institucional/bancos/estadisticas_financieras.html",
            `el servlet BaseDato devolvió una respuesta sin tablas parseables (${html.length} bytes; puede ser el challenge anti-bot)`,
          );
        }
        const texto = `Reporte ${reporte} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`;
        return toolOk(texto, { reporte, indice, filas: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );
}
