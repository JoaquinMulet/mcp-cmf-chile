import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { normativaDescargaSchema, filasSchema, xbrlVisorSchema, xbrlConsultaSchema, xbrlTaxonomiasSchema, documentoInfoSchema, documentoDescargaSchema, documentoMarkdownSchema } from "../util/schemas-output.js";
import { getLegacy, postLegacy, getLegacyBinario, fetchCmf, fetchCmfBinario, type CmfEnv } from "../client/cmf-client.js";
import { htmlTablaAJson, fechaLegacyCompleta, fechaLegacy, xlsAJson } from "../client/parsers.js";
import { fromError, toolError, toolErrorFuente, toolOk, resumirTabla, paginarTexto } from "../util/errors.js";
import { bytesABase64 } from "../util/zip.js";
import { unzip, type ZipEntrada } from "../util/unzip.js";

/** Decodifica páginas legacy (latin1) de los hosts de datos bancarios. */
function decodificarLatin1(bytes: ArrayBuffer): string {
  return new TextDecoder("latin1").decode(bytes);
}
import { pdfAMarkdown } from "../pdf.js";
import { procesarTablasEEFF, textoVerificacion, textoAviso } from "../eeff-tables.js";
import { paginar } from "../util/paginate.js";
import {
  anioSchema, codigoSchema, fechaSchema, mesSchema, offsetSchema, limitSchema, rutSchema, tipoNormaSchema } from "../util/schemas.js";

export function registrarToolsOtros(server: McpServer, env: CmfEnv): void {
  // ---------- Normativa ----------

  server.registerTool(
    "cmf_normativa_buscar",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Buscar normativa",
      description:
        "Busca normas de la CMF (circulares CIR, oficios OFC, normas de carácter general NCG) por NÚMERO en el buscador legacy (verificado: solo devuelve resultados por número; las búsquedas por fechas sin número no funcionan en el sistema de la CMF). Use tipo (CIR/OFC/NCG/ALL) y numero (ej: 2343); los filtros desde/hasta y materia se envían pero el sistema legacy los ignora. Para descargar el PDF use cmf_normativa_descargar con la ruta del compendio.",
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
        // El buscador legacy solo resuelve búsquedas por número; además, enviar
        // `buscar` o `materia` (aunque vacíos) rompe la búsqueda por número
        // (verificado contra la CMF). Solo se envían los params imprescindibles.
        const params: Record<string, string | undefined> = {
          tiponorma: tipo,
          numero: numero ?? "",
          enviado: "1",
          hidden_mercado: "%",
          ...(materia ? { materia } : {}),
          ...(desde || hasta
            ? {
                dd: desde ? desde.slice(8, 10) : "01",
                mm: desde ? desde.slice(5, 7) : "01",
                aa: desde ? desde.slice(0, 4) : "2000",
                dd2: hasta ? hasta.slice(8, 10) : "31",
                mm2: hasta ? hasta.slice(5, 7) : "12",
                aa2: hasta ? hasta.slice(0, 4) : "2100",
              }
            : {}),
        };
        void entidad;
        const html = await getLegacy("/institucional/legislacion_normativa/normativa2.php", params, env);
        const filas = htmlTablaAJson(html, ["tipo", "numero", "fecha", "titulo", "hojas", "informe"]);
        // Verificado contra la CMF (2026-08): normativa2.php SOLO devuelve resultados
        // por número de norma; las búsquedas por rango de fechas sin número devuelven
        // "No existen Normas" aunque existan normas en el período.
        if (html.includes("ERROR Linea") || html.includes("No existen Normas")) {
          if (numero) {
            return toolOk(`La CMF no tiene la norma ${tipo} ${numero} en el rango consultado.`, { normas: [], total: 0, next_offset: null });
          }
          return toolError(
            "El buscador legacy de normativa de la CMF solo devuelve resultados por NÚMERO de norma (use numero, ej: 2343). " +
              "La búsqueda por fechas sin número no funciona en el sistema de la CMF. " +
              "Alternativas: (1) use cmf_normativa_descargar si conoce la ruta del compendio (ej: /web/compendio/cir/cir_2343_2024.pdf), " +
              "o (2) consulte el portal nuevo en https://www.cmfchile.cl/portal/normativa/624/w4-propertyname-916.html.",
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
          `Norma descargada (${Math.round(tamano / 1024)} KB). Para LEERLA como texto use cmf_documento_markdown con la URL ${urlPdf}. El binario en base64 queda disponible para llamadores programáticos.`,
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
        "Devuelve estadísticas del mercado de rentas vitalicias previsionales por compañía (grid oficial de la CMF): comisiones de intermediación (com_int_rvp), primas únicas (pri_uni_rvp) y tasas de interés promedio (tas_int_med_rvp). Fije el rango desde/hasta en YYYY-MM-DD (default: año actual completo) y pagine con offset/limit. Use esta tool para estadísticas RVP por compañía; para estadísticas agregadas del sistema SCOMP use cmf_seguros_scomp.",
      inputSchema: z.object({
        codigo: z
          .enum(["com_int_rvp", "pri_uni_rvp", "tas_int_med_rvp"])
          .describe("Estadística: com_int_rvp=comisiones de intermediación, pri_uni_rvp=primas únicas, tas_int_med_rvp=tasas de interés promedio"),
        desde: fechaSchema.optional().describe("Inicio del rango en YYYY-MM-DD (default 01-01 del año actual)"),
        hasta: fechaSchema.optional().describe("Fin del rango en YYYY-MM-DD (default 31-12 del año actual)"),
        offset: offsetSchema,
        limit: limitSchema,
      }),
    },
    async ({ codigo, desde, hasta, offset, limit }) => {
      try {
        const anioActual = String(new Date().getFullYear());
        const aaaaIni = (desde ?? `${anioActual}-01-01`).slice(0, 4);
        const mmIni = (desde ?? `${anioActual}-01-01`).slice(5, 7);
        const aaaaFin = (hasta ?? `${anioActual}-12-31`).slice(0, 4);
        const mmFin = (hasta ?? `${anioActual}-12-31`).slice(5, 7);
        const html = await postLegacy(
          `/institucional/estadisticas/svtas_${codigo}.php`,
          { p: codigo, aaaa_ini: aaaaIni, mm_ini: mmIni, aaaa_fin: aaaaFin, mm_fin: mmFin },
          env,
        );
        const filas = htmlTablaAJson(html);
        if (filas.length === 0 && !/<table/i.test(html)) {
          return toolErrorFuente(
            `Estadísticas de rentas vitalicias ${codigo}`,
            `https://www.cmfchile.cl/institucional/estadisticas/svtas_param.php?p=${codigo}`,
          );
        }
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = filas.length
          ? `RVP ${codigo} ${aaaaIni}-${mmIni} a ${aaaaFin}-${mmFin} (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`
          : `Sin estadísticas RVP ${codigo} para el rango (la CMF no devolvió filas).`;
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
        "Devuelve las estadísticas del SCOMP (Sistema de Consultas y Ofertas del Mercado de Pensiones) publicadas por la CMF. Elija el informe (solicitudes=inf1, certificados emitidos=inf22, aceptaciones según vía=inf28), el rango desde/hasta en YYYY-MM-DD y la granularidad (D=día, M=mes, A=año). Use esta tool para el mercado de pensiones a nivel sistema; para estadísticas por compañía use cmf_seguros_rentas_vitalicias.",
      inputSchema: z.object({
        informe: z.enum(["inf1", "inf22", "inf28"]).default("inf1").describe("Informe: inf1=solicitudes de oferta ingresadas, inf22=certificados de ofertas emitidos, inf28=aceptaciones según vía de ingreso (default inf1)"),
        desde: fechaSchema,
        hasta: fechaSchema,
        granularidad: z.enum(["D", "M", "A"]).default("D").describe("Granularidad: D=día, M=mes, A=año (default D)"),
        offset: offsetSchema,
        limit: limitSchema,
      }),
    },
    async ({ informe, desde, hasta, granularidad, offset, limit }) => {
      try {
        const ARCHIVOS: Record<string, string> = {
          inf1: "inf1_num_ofer_ingr_tot_v3.php",
          inf22: "inf22_num_cert_ofert_emit_pension.php",
          inf28: "inf28_num_acep_segun_via_ingreso_v2.php",
        };
        const via = granularidad === "D" ? "W" : granularidad === "M" ? "W" : "W";
        const f1 = fechaLegacy(desde);
        const f2 = fechaLegacy(hasta);
        const html = await getLegacy(
          `/institucional/inc/${ARCHIVOS[informe]}?via=${via}&dd=${f1.dd}&mm=${f1.mm}&aa=${f1.aa}&dd2=${f2.dd}&mm2=${f2.mm}&aa2=${f2.aa}`,
          {},
          env,
        );
        const filas = htmlTablaAJson(html);
        if (filas.length === 0 && !/<table/i.test(html)) {
          return toolErrorFuente(
            `Estadísticas SCOMP ${informe}`,
            "https://www.cmfchile.cl/institucional/mercados/seguros_scomp_estadisticas.php",
          );
        }
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = filas.length
          ? `SCOMP ${informe} (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`
          : `Sin estadísticas SCOMP ${informe} para el rango.`;
        return toolOk(texto, { informe, filas: paginadas, total: paginado.total });
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
        "Devuelve las transacciones de compañías de seguros informadas conforme al artículo 12 de la Ley 18.045 (Ley de Mercado de Valores), publicadas por la CMF, filtrables por sociedad (RUT) y rango de fechas. Fije desde/hasta en YYYY-MM-DD y soc opcional (RUT sin DV; omitir = todas). Use esta tool para transacciones del mercado de seguros; para los estados financieros de aseguradoras use cmf_seguros_eeff.",
      inputSchema: z.object({
        soc: rutSchema.optional().describe("RUT de la sociedad (sin DV; omitir = todas)"),
        desde: fechaSchema,
        hasta: fechaSchema,
        offset: offsetSchema,
        limit: limitSchema,
      }),
    },
    async ({ soc, desde, hasta, offset, limit }) => {
      try {
        const f1 = fechaLegacy(desde);
        const f2 = fechaLegacy(hasta);
        const html = await getLegacy(
          "/institucional/inc/tra/art_12_val.php",
          {
            soc: soc ?? "0",
            desde: `${f1.dd}-${f1.mm}-${f1.aa}`,
            hasta: `${f2.dd}-${f2.mm}-${f2.aa}`,
            dias: "",
            mercado: "S",
          },
          env,
        );
        const filas = htmlTablaAJson(html);
        if (filas.length === 0 && !/<table/i.test(html)) {
          return toolErrorFuente(
            "Transacciones Art. 12 Ley 18.045",
            "https://www.cmfchile.cl/institucional/estadisticas/seguros_satra_art12v.php",
          );
        }
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = filas.length
          ? `Transacciones Art. 12 (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`
          : `Sin transacciones Art. 12 para el rango.`;
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
        "Devuelve los siniestros detectados por la CMF que no fueron reportados por las compañías de seguros dentro del plazo, por año. Fije anio en AAAA y pagine con offset/limit. Use esta tool para fiscalización de aseguradoras; para el cumplimiento normativo general use cmf_seguros_cumplimiento.",
      inputSchema: z.object({
        anio: anioSchema.optional().describe("Año del listado en AAAA (default año actual)"),
        offset: offsetSchema,
        limit: limitSchema,
      }),
    },
    async ({ anio, offset, limit }) => {
      try {
        const aa = anio ?? String(new Date().getFullYear());
        const html = await getLegacy(
          "/institucional/estadisticas/sgndr/consulta_siniestro.php",
          { anno: aa },
          env,
        );
        // La página trae celdas con tags desanidados (<td>…</th>): normalizar antes de parsear.
        const normalizado = html.replace(/(<td[^>]*>[\s\S]*?)<\/th>/gi, "$1</td>");
        const filas = htmlTablaAJson(normalizado);
        if (filas.length === 0 && !/<table/i.test(normalizado)) {
          return toolErrorFuente(
            `Siniestros detectados no reportados ${aa}`,
            "https://www.cmfchile.cl/institucional/estadisticas/sgndr/consulta_siniestro.php",
          );
        }
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = filas.length
          ? `Siniestros no reportados ${aa} (total ${paginado.total}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}).slice(0, 6))}`
          : `Sin siniestros no reportados para ${aa}.`;
        return toolOk(texto, { anio: aa, filas: paginadas, total: paginado.total });
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
        "Devuelve el estado de cumplimiento de la normativa por compañías de seguros de la CMF (sistema sv_cumplimientos, XLSX oficial), con hasta 200 filas. Fije anio en AAAA, mes opcional en MM (default 12) y tipoentidad (CSVID=seguros de vida, default; CSGEN=seguros generales; R=reaseguradoras). Use esta tool para supervisar cumplimiento; para siniestros no reportados use cmf_seguros_siniestros.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema.optional().describe("Mes final en MM (default 12)"),
        tipoentidad: z.string().optional().describe("Tipo de entidad: CSVID=seguros de vida (default), CSGEN=seguros generales, R=reaseguradoras"),
      }),
    },
    async ({ anio, mes, tipoentidad }) => {
      try {
        const tiposociedad = tipoentidad === "CSGEN" ? "G" : tipoentidad === "R" ? "R" : "A";
        const bytes = await getLegacyBinario(
          "/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento1grid.php",
          {
            lang: "es",
            vigente: "",
            cia: "2",
            tiposociedad,
            "sociedad[]": "0",
            anno_ini: "2010",
            mes_ini: "12",
            mes1: "12",
            anno1: anio,
            mes2: mes ?? "12",
            anno2: anio,
            xls: "y",
            vsn: "2",
          },
          env,
        );
        const filas = xlsAJson(bytes) as Record<string, unknown>[];
        if (filas.length === 0) {
          return toolErrorFuente(
            `Cumplimiento de aseguradoras ${anio}-${mes ?? "12"}`,
            "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento_index.php",
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
        "Devuelve la cartera de inversiones de compañías de seguros de la CMF (Circular 1835). Sin peri: devuelve los períodos disponibles (JSON oficial). Con peri (AAAAMM): descarga el ZIP oficial del período y devuelve sus entradas (un TXT de ancho fijo por compañía y tipo de inversión) con tamaño y primeras líneas de cada una (el detalle completo se sirve como base64 del ZIP en zip_base64 si max_entradas no lo limita). Filtre por tipoentidad (CSVID=seguros de vida, CSGEN=seguros generales). Use esta tool para ver en qué invierten las aseguradoras; para la cartera de fondos mutuos use cmf_fondos_mutuos_cartera.",
      inputSchema: z.object({
        tipoentidad: z.enum(["CSVID", "CSGEN"]).default("CSVID").describe("Tipo de entidad: CSVID=seguros de vida (default), CSGEN=seguros generales"),
        peri: z.string().regex(/^\d{6}$/, "AAAAMM").optional().describe("Período AAAAMM (ej: 202512); sin él, la tool lista los períodos disponibles"),
        max_entradas: z.number().int().min(1).max(500).default(10).describe("Máximo de entradas a describir (default 10)"),
        incluir_zip: z.boolean().default(false).describe("true = incluye el ZIP completo en base64 (zip_base64; puede ser ~16MB)"),
      }),
    },
    async ({ tipoentidad, peri, max_entradas, incluir_zip }) => {
      try {
        const base = "/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/descarga_cartera_inv.php";
        if (!peri) {
          const periodos = await getLegacy(base, { tipoentidad, fnAjax: "per_u" }, env);
          try {
            const lista = JSON.parse(periodos) as Record<string, unknown>[];
            const texto = `Períodos disponibles de cartera de inversiones ${tipoentidad} (${lista.length}):\n${resumirTabla(lista.slice(0, 10), Object.keys(lista[0] ?? {}))}`;
            return toolOk(texto, { tipoentidad, periodos: lista });
          } catch {
            return toolErrorFuente(
              `Períodos de cartera de inversiones ${tipoentidad}`,
              "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/descarga_cartera_inv.php",
            );
          }
        }
        const bytes = await getLegacyBinario(base, { tipoentidad, fnAjax: "descarga", peri }, env);
        if (bytes.length < 1000 || !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
          return toolErrorFuente(
            `Cartera de inversiones ${tipoentidad} ${peri}`,
            "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/descarga_cartera_inv.php",
            "la CMF no devolvió el ZIP del período (¿período inexistente?)",
          );
        }
        const entradas = await unzip(bytes);
        const resumen = entradas.slice(0, max_entradas).map((e) => ({
          archivo: e.nombre,
          tamano_kb: Math.round(e.bytes.length / 1024),
          primeras_lineas: new TextDecoder("latin1").decode(e.bytes.subarray(0, 800)).replace(/\r/g, ""),
        }));
        const texto = `Cartera de inversiones ${tipoentidad} ${peri}: ${entradas.length} archivos en el ZIP oficial.\n${resumen
          .map((r) => `- ${r.archivo} (${r.tamano_kb} KB): ${r.primeras_lineas.split("\n")[0]?.slice(0, 90)}`)
          .join("\n")}`;
        return toolOk(texto, {
          tipoentidad,
          peri,
          total_archivos: entradas.length,
          entradas: resumen,
          ...(incluir_zip ? { zip_base64: bytesABase64(bytes) } : {}),
        });
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
        "Devuelve la producción de corredores de seguros publicada por la CMF (sistema ISPRO) para un período AAAAMM: descarga el ZIP oficial y parsea los archivos de ancho fijo (identifi=catálogo de corredores, prodramo=producción por ramo, intercia=producción por compañía). Fije peri en AAAAMM (ej: 202512; los períodos disponibles van del año 2017 al actual, corte diciembre) y elija sección. Use esta tool para la intermediación del mercado de seguros; para la cartera de las compañías use cmf_seguros_inversiones_vida.",
      inputSchema: z.object({
        peri: z.string().regex(/^\d{6}$/, "AAAAMM").describe("Período AAAAMM (ej: 202512)"),
        seccion: z.enum(["identifi", "prodramo", "intercia"]).default("identifi").describe("Sección: identifi=catálogo de corredores (default), prodramo=producción por ramo, intercia=producción por compañía"),
        offset: offsetSchema,
        limit: limitSchema,
      }),
    },
    async ({ peri, seccion, offset, limit }) => {
      try {
        const bytes = await getLegacyBinario(
          "/institucional/estadisticas/merc_seguros/produccion/ispro/descarga_ispro2.php",
          { peri },
          env,
        );
        if (bytes.length < 1000 || !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
          return toolErrorFuente(
            `Producción de corredores (ISPRO) ${peri}`,
            "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/produccion/ispro/descarga_ispro.php",
            "la CMF no devolvió el ZIP del período",
          );
        }
        const entradas = await unzip(bytes);
        const objetivo = entradas.find((e) => e.nombre.toLowerCase().includes(seccion) && e.nombre.toLowerCase().endsWith(".txt"));
        if (!objetivo) {
          return toolError(`No se encontró la sección ${seccion} en el ZIP del período ${peri}. Secciones: ${entradas.map((e) => e.nombre).join(", ")}`);
        }
        const lineas = new TextDecoder("latin1").decode(objetivo.bytes).split(/\r?\n/).filter((l) => l.trim().length > 0);
        const filas: Record<string, unknown>[] = lineas.slice(1).map((l, i) => {
          if (seccion === "identifi") {
            return { cod_corredor: l.slice(0, 10).trim(), nombre: l.slice(10, 85).trim(), detalle: l.slice(85).trim() };
          }
          if (seccion === "prodramo") {
            return { periodo: l.slice(0, 6).trim(), cod_corredor: l.slice(6, 16).trim(), ramo: l.slice(17, 20).trim(), importe: l.slice(20).trim() };
          }
          return { periodo: l.slice(0, 6).trim(), cod_corredor: l.slice(6, 16).trim(), tipo: l.slice(17, 19).trim(), rut_cia: l.slice(19, 29).trim(), nombre_cia: l.slice(29, 49).trim(), importe: l.slice(49).trim() };
        });
        const { filas: paginadas, paginado } = paginar(filas, offset, limit);
        const texto = `ISPRO ${seccion} ${peri} (${filas.length} filas; cabecera del archivo: ${lineas[0]?.slice(0, 80)}):\n${resumirTabla(paginadas, Object.keys(paginadas[0] ?? {}))}`;
        return toolOk(texto, { peri, seccion, filas: paginadas, total: paginado.total });
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
        "Devuelve las estadísticas del sistema 'Conoce tu seguro' (SIC) de la CMF: consultas de usuarios sobre pólizas de seguros en un rango de fechas, con hasta 200 filas. Requiere desde y hasta en YYYY-MM-DD (acepta DD/MM/AAAA). Use esta tool para la demanda de información del mercado de seguros; para el registro de pólizas depositadas use cmf_seguros_deposito_polizas.",
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
        "Descarga un documento firmado de la CMF (EEFF, hechos, sanciones, resoluciones, normas) y lo convierte a Markdown legible para el agente (tablas, encabezados, listas) usando pdf-inspector; los PDFs escaneados se indican porque no hay OCR. Acepte el documento con token (s567 de hechos/sanciones/resoluciones) o url (URL absoluta de la CMF). El documento se entrega PAGINADO, nunca recortado sin salida: max_chars es el tamaño del tramo (default 30000) y offset_chars el punto donde empieza; si queda más, la respuesta dice con qué offset_chars pedir el tramo siguiente, así que cualquier documento se puede leer entero. Use esta tool para leer el contenido de un PDF; para el binario original use cmf_documento_descargar y para inspeccionar solo un token cmf_documento_info.",
      inputSchema: z.object({
        token: z.string().min(10).optional().describe("Token s567 del documento (de hechos/sanciones/resoluciones)"),
        url: z.string().url().optional().describe("URL absoluta de un documento de la CMF (ej: ver_archivo.php del compendio)"),
        max_chars: z.number().int().min(1000).max(100000).default(30000).describe("Tamaño del tramo en caracteres (default 30000)"),
        offset_chars: z.number().int().min(0).default(0).describe("Carácter donde empieza el tramo; use el que indique la respuesta anterior para seguir leyendo"),
        validar_contable: z.boolean().default(false).describe("true = verifica la cuadratura contable (experimental)"),
      }),
    },
    async ({ token, url, max_chars, offset_chars, validar_contable }) => {
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
        // Paginado, no truncado. Antes había 2 cortes: uno a `max_chars`
        // sin salida más allá de 100000, y otro a 2000 caracteres en el
        // texto que remitía a `structuredContent`, que un modelo no puede
        // leer. Los 2 decidían por el agente qué parte del documento le
        // servía. Ahora cualquier documento se lee entero por tramos.
        const pagina = paginarTexto(textoMd, offset_chars, max_chars);
        const textoFinal = pagina.tramo;
        const tipoLimpio = pdfType.toLowerCase().replace("textbased", "text-based");
        return toolOk(
          `${verificacion}${avisoFusion}\n\nDocumento convertido a Markdown (tipo: ${tipoLimpio}, ${Math.round(bytes.length / 1024)} KB, ${textoMd.length} caracteres):\n\n${textoFinal}`,
          {
            pdf_type: pdfType,
            tamano_kb: Math.round(bytes.length / 1024),
            markdown: textoFinal,
            markdown_truncado: pagina.siguiente !== null,
            offset_chars: pagina.desde,
            siguiente_offset_chars: pagina.siguiente,
            total_chars: pagina.total,
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
        "Devuelve las tasas de interés de instituciones financieras chilenas publicadas por la CMF (servlet InfoFinanciera de la ex SBIF, host tasas.cmfchile.cl). El índice 4.2.1 trae las tasas de interés corriente y máxima convencional por segmento para una fecha; otros índices: 4.2.2=certificados de tasas (por año) y 4.2.3=tasas por período (POST). Use esta tool para tasas bancarias; para reportes de instituciones use cmf_bancos_reportes.",
      inputSchema: z.object({
        indice: z.string().default("4.2.1").describe("Índice del reporte (default 4.2.1=tasas por fecha)"),
        fecha: fechaSchema.optional().describe("Fecha de las tasas en YYYY-MM-DD (default hoy)"),
      }),
    },
    async ({ indice, fecha }) => {
      try {
        const f = fecha ? fechaLegacy(fecha) : (() => { const d = new Date(); return { dd: String(d.getDate()).padStart(2, "0"), mm: String(d.getMonth() + 1).padStart(2, "0"), aa: String(d.getFullYear()) }; })();
        const url = `https://tasas.cmfchile.cl/sbifweb/servlet/InfoFinanciera?indice=${indice}&FECHA=${f.dd}/${f.mm}/${f.aa}`;
        const res = await fetchCmf(url, {}, env);
        const textoRaw = decodificarLatin1(await res.arrayBuffer());
        const filas = htmlTablaAJson(textoRaw);
        if (filas.length === 0 && !/<table/i.test(textoRaw)) {
          return toolErrorFuente(
            `Tasas de interés (índice ${indice})`,
            "https://tasas.cmfchile.cl/",
            "el servlet InfoFinanciera no devolvió tablas para esa combinación",
          );
        }
        const texto = filas.length
          ? `Tasas (${filas.length} filas, índice ${indice}, fecha ${f.dd}/${f.mm}/${f.aa}):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : `El índice ${indice} no devolvió tablas parseables (puede ser un formulario o un PDF).`;
        return toolOk(texto, { indice, fecha: `${f.aa}-${f.mm}-${f.dd}`, filas: filas.slice(0, 200) });
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
        "Devuelve la cronología histórica del sistema bancario chileno publicada por la CMF (servlet CronologiaBancaria de la ex SBIF), con hasta 200 filas. Elija el capítulo con indice (default 8.0); si el contenido no es tabular, la tool lo indica. Use esta tool para hitos de la banca chilena; para tasas de interés use cmf_bancos_tasas.",
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
        "Devuelve reportes del sistema BaseDato de instituciones financieras de la CMF (ex SBIF, host datosbanco.cmfchile.cl): MR1=información contable mensual (default), ADC=adecuación de capital, ADC2=adecuación de capital (v2), HEC=hechos económicos y MB1. Fije codUnicoBank (código SBIF, ej: 001; vea cmf://bancos/codigos), reporte, indice (default 30.1) y período (periodo_inicial AAAA-MM, default período actual; solo se usan mes y año). La salida trae hasta 200 filas; si la CMF devuelve el challenge anti-bot en vez de tablas, la tool lo indica. Use esta tool para reportes históricos de la banca; para tasas de interés use cmf_bancos_tasas.",
      inputSchema: z.object({
        reporte: z.enum(["MR1", "MB1", "ADC", "ADC2", "HEC"]).default("MR1").describe("Código del reporte: MR1=información contable mensual (default), ADC=adecuación de capital, ADC2=adecuación (v2), HEC=hechos económicos, MB1"),
        indice: z.string().default("30.1").describe("Índice del reporte (default 30.1)"),
        codUnicoBank: codigoSchema.optional().describe("Código SBIF de la institución (ej: 001=Banco de Chile; default 001)"),
        periodo_inicial: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("Período en AAAA-MM (ej: 2026-06; default período actual)"),
      }),
    },
    async ({ reporte, indice, codUnicoBank, periodo_inicial }) => {
      try {
        const ahora = new Date();
        const per = periodo_inicial ?? `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`;
        const url = `https://datosbanco.cmfchile.cl/sbifweb/servlet/BaseDato?instituciones-financieras=1&codUnicoBank=${codUnicoBank ?? "001"}&reporte=${reporte}&indice=${indice}&month=${per.slice(5, 7)}&year=${per.slice(0, 4)}`;
        const res = await fetchCmf(url, {}, env);
        const textoRaw = decodificarLatin1(await res.arrayBuffer());
        const filas = htmlTablaAJson(textoRaw);
        if (filas.length === 0 && !/<table/i.test(textoRaw)) {
          return toolErrorFuente(
            `Reporte ${reporte} (índice ${indice})`,
            "https://datosbanco.cmfchile.cl/",
            `el servlet BaseDato no devolvió tablas (${textoRaw.length} bytes; puede ser el challenge anti-bot)`,
          );
        }
        const texto = filas.length
          ? `Reporte ${reporte} ${per} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : `El reporte ${reporte} no devolvió tablas parseables para ${per}.`;
        return toolOk(texto, { reporte, indice, periodo: per, filas: filas.slice(0, 200) });
      } catch (e) {
        return fromError(e);
      }
    },
  );
}
