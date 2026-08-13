import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { empresaArraySchema, historialSchema, globalesSchema, paginadoSchema, filasSchema } from "../util/schemas-output.js";
import { getLegacy, postLegacy, fetchCmf, fetchCmfBinario, getLegacyConCookies, type CmfEnv } from "../client/cmf-client.js";
import { gridGoogleVisAJson, htmlTablaAJson, fechaLegacy, fechaLegacyCompleta, fixMojibake, txtCsvAJson } from "../client/parsers.js";
import { pedirCaptchaCMF, obtenerCaptcha, ultimoCaptcha, consumirCaptcha } from "../captcha.js";
import { fromError, toolOk, toolError, toolErrorFuente, sinDatosOFuente, resumirTabla } from "../util/errors.js";
import { paginar } from "../util/paginate.js";
import { pdfAMarkdown } from "../pdf.js";
import { procesarTablasEEFF, textoVerificacion, textoAviso } from "../eeff-tables.js";
import {
  anioSchema,
  enumTolerante,
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
        "Busca una empresa chilena por su ticker de bolsa (NEMO: COPEC, SQM-B, LTM, BCI…) usando el catálogo de empresas en bolsa del proyecto empresas-cmf-chile (github.com/JoaquinMulet/empresas-cmf-chile). Devuelve el RUT (que puede incluir el dígito verificador), razón social, ISIN, tipo de entidad, norma e inicio IFRS. Ideal para traducir tickers a RUT antes de consultar EEFF, hechos, etc.; las demás tools aceptan el RUT con o sin DV.",
      inputSchema: z.object({
        consulta: z.string().min(2).describe("Ticker (NEMO) o nombre de la empresa"),
        term: z.string().optional().describe("Alias legacy de consulta (use consulta)"),
        limite: z.number().int().min(1).max(10).default(5).describe("Máximo de resultados (1-10, default 5)"),
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
        "Busca una entidad supervisada por nombre, RUT o ticker y devuelve el RUT canónico, la razón social, el tipo de entidad y su estado. El buscador de la CMF acepta una sola palabra (prefijo) o un RUT numérico: si consulta con varias palabras sin resultados, la tool reintenta con la más discriminante y lo indica. Es el primer paso recomendado antes de consultar EEFF, hechos, etc.; para búsquedas filtradas masivas use cmf_catalogo_entidades.",
      inputSchema: z.object({
        consulta: z.string().min(1).describe("Nombre, RUT o ticker a buscar (una sola palabra clave o RUT numérico)"),
        term: z.string().optional().describe("Alias legacy de consulta (use consulta)"),
        limite: z.number().int().min(1).max(20).default(5).describe("Máximo de resultados (1-20, default 5)"),
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
        const buscar = async (valor: string): Promise<{ filas: Record<string, string>[]; conTabla: boolean }> => {
          const html = await getLegacy("/institucional/mercados/consulta_busqueda.php", {
            valor,
            entidad_web: "G",
            boton_busqueda: "Buscar",
          });
          return {
            filas: htmlTablaAJson(html, ["rut", "nombre", "tipo_entidad", "inscripcion", "estado"])
              .filter((f) => /^\d{6,9}$/.test(f.rut ?? ""))
              // El HTML trae la columna "Estado Actual" después de una columna "Inscripción" vacía:
              // el parser puede dejarla en `inscripcion`; normalizar a `estado`.
              .map((f) => ({ ...f, estado: f.estado || f.inscripcion || "" })),
            conTabla: /<table/i.test(html),
          };
        };
        let { filas, conTabla } = await buscar(consultaFinal);
        let intentoAlternativo = "";
        // El buscador de la CMF solo soporta consultas de un token: ante una frase sin
        // resultados, reintenta con la palabra más discriminante (la de menos resultados).
        if (filas.length === 0 && /\s/.test(consultaFinal.trim())) {
          const tokens = consultaFinal.split(/\s+/).filter((t) => t.length >= 3);
          let mejor: { token: string; filas: Record<string, string>[] } | null = null;
          for (const t of tokens) {
            const r = await buscar(t);
            if (r.filas.length && (!mejor || r.filas.length < mejor.filas.length)) mejor = { token: t, filas: r.filas };
          }
          if (mejor) {
            filas = mejor.filas;
            intentoAlternativo = ` (el buscador de la CMF solo acepta una palabra: usé "${mejor.token}")`;
          }
        }
        if (filas.length === 0 && !conTabla) {
          return toolErrorFuente(
            `Búsqueda de entidades "${consultaFinal}"`,
            "https://www.cmfchile.cl/institucional/mercados/entidades.php",
          );
        }
        const { filas: resultados, paginado } = paginar(filas, 0, limite);
        const texto = resultados.length
          ? `Resultados para "${consultaFinal}"${intentoAlternativo} (${paginado.total}):\n${resumirTabla(resultados, ["rut", "nombre", "tipo_entidad", "estado"])}`
          : `Sin resultados para "${consultaFinal}". El buscador de la CMF acepta una sola palabra (prefijo) o un RUT numérico; pruebe con una palabra clave (ej: "SANTANDER") o con cmf_catalogo_entidades para búsquedas filtradas.`;
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
        "Lista las entidades supervisadas de un tipo (tipoentidad, ej: RVEMI=emisores de valores) y mercado, paginado con offset/limit (máx 500). Filtre por estado=VI (vigentes, default) o NV y mercado=V (default), O u S. Use esta tool para enumerar un segmento completo; para buscar por nombre o RUT use cmf_buscar_entidad y para el catálogo completo cmf_catalogo_entidades.",
      inputSchema: z.object({
        tipoentidad: tipoEntidadSchema,
        mercado: mercadoSchema.optional().describe("Mercado: V=valores (default), O=otros, S=seguros"),
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
        const filas = htmlTablaAJson(html, ["rut", "nombre", "estado"]);
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
      description:
        "Devuelve los datos de identificación de un emisor (razón social, RUT, inscripción y actividad) desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para confirmar identidad y estado de una empresa; para cifras use cmf_empresa_eeff y para gobierno corporativo cmf_empresa_directorio.",
      inputSchema: z.object({ rut: rutSchema }),
    },
    async ({ rut }) => {
      try {
        const html = await getLegacy(fichaUrl(rut, 1), {}, env);
        const filas = htmlTablaAJson(html);
        return sinDatosOFuente(
          html,
          filas,
          `Identificación de la empresa ${rut}`,
          `https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&rut=${rut}&pestania=1`,
          () => toolOk(`Sin datos de identificación para RUT ${rut}.`, { rut, datos: [] }),
          () => toolOk(`Ficha identificación RUT ${rut}:\n${resumirTabla(filas.slice(0, 3), Object.keys(filas[0]))}`, { rut, datos: filas.slice(0, 50) }),
        );
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
        "Devuelve los estados financieros de un emisor (pestanía 3) para un período, consolidado o individual, IFRS o NCH, con los PDFs oficiales del período. modo=documentos: lista de PDFs (EEFF, análisis razonado, declaración, XBRL) con su url — para leer uno pase esa url completa a cmf_documento_markdown. modo=markdown: convierte además el PDF auditado de los EEFF a Markdown para leer las cifras directamente (el HTML de la CMF viene sin líneas: la fuente real de las cifras son los PDFs). Verifique los períodos disponibles con cmf_empresa_eeff_historial; para el sistema agregado de todas las SA use cmf_eeff_ifrs_sa.",
      inputSchema: z.object({
        rut: rutSchema.optional(),
        query: rutSchema.optional().describe("Alias legacy de rut (use rut)"),
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
      description:
        "Lista los años para los que un emisor tiene estados financieros publicados, junto con su modalidad contable y la fecha de inicio IFRS. Identifique el emisor por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para verificar qué períodos existen o desde cuándo aplica IFRS antes de llamar cmf_empresa_eeff.",
      inputSchema: z.object({ rut: rutSchema }),
    },
    async ({ rut }) => {
      try {
        const html = await getLegacy(fichaUrl(rut, 3), {}, env);
        const aviso = html.match(/a partir de <strong>([\d/]+)<\/strong> en modalidad '<strong>([^<]+)<\/strong>'/);
        const anios = [...html.matchAll(/<option value="?(\d{4})"?\s*>(\d{4})/g)].map((m) => m[1]);
        if (anios.length === 0 && !/<table/i.test(html)) {
          return toolErrorFuente(
            `Historial de EEFF de ${rut}`,
            `https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&rut=${rut}&pestania=3`,
          );
        }
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
      description:
        "Devuelve los hechos esenciales publicados por un emisor (fecha/hora, número, materia y enlace al documento) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); fije desde/hasta en YYYY-MM-DD y pagine con offset/limit (máx 500). Use esta tool para hechos de un emisor específico; para el flujo de todo el mercado use cmf_hechos_globales (requiere captcha).",
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
        if (filas.length === 0 && !/<table/i.test(html)) {
          return toolErrorFuente(
            `Hechos esenciales de ${rut}`,
            `https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&rut=${rut}&pestania=25`,
          );
        }
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
      description:
        "Devuelve los 12 mayores accionistas de un emisor (nombre, RUT y participación) para un período, desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA y mes opcional en MM (default 12). Use esta tool para analizar la concentración accionaria; para el directorio use cmf_empresa_directorio.",
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
      description:
        "Devuelve los directores y gerentes de un emisor (nombre, cargo y fechas de designación/cese) desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para gobierno corporativo; para la composición accionaria use cmf_empresa_accionistas.",
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
      description:
        "Devuelve las sanciones aplicadas por la CMF a un emisor (número, fecha y materia) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta opcionales en YYYY-MM-DD (default 01/01/2000 a 31/12/2100). Use esta tool para el historial sancionatorio de un emisor; para sanciones de todo un mercado use cmf_sanciones_globales.",
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
      description:
        "Devuelve las resoluciones de la CMF sobre un emisor (número, fecha y materia) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta opcionales en YYYY-MM-DD (default 01/01/2000 a 31/12/2100). Use esta tool para resoluciones dirigidas a un emisor; para resoluciones generales publicadas use cmf_dictamenes o cmf_resoluciones_globales.",
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
      description:
        "Devuelve las actas de juntas de accionistas de un emisor (ordinarias, extraordinarias o de reforma de estatutos) en un rango de fechas, con enlace al documento. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta en YYYY-MM-DD y tipo=ordinaria (default), extraordinaria o reforma. Use esta tool para la historia societaria y de gobernanza de un emisor.",
      inputSchema: z.object({
        rut: rutSchema,
        desde: fechaSchema,
        hasta: fechaSchema,
        tipo: z.enum(["ordinaria", "extraordinaria", "reforma"]).default("ordinaria").describe("Tipo de junta: ordinaria (default), extraordinaria o reforma de estatutos"),
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
      description:
        "Devuelve los documentos de la memoria anual de un emisor para un año (memoria, EEFF anuales e informes de auditores). Identifique el emisor por rut (numérico; se acepta con o sin DV) y fije anio en AAAA (ej: 2024). Use esta tool para el contexto anual completo; para cifras trimestrales use cmf_empresa_eeff.",
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
      description:
        "Devuelve los indicadores ASG (ambientales, sociales y de gobernanza) de un emisor para un período: memoria integrada, SASB o XBRL SASB. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA, mes opcional en MM (default 12) y tipo_informe=1 (Memoria Integrada), 2 (SASB) o 3 (XBRL SASB). Use esta tool para datos de sostenibilidad; para datos financieros use cmf_empresa_eeff.",
      inputSchema: z.object({
        rut: rutSchema,
        anio: anioSchema,
        mes: mesSchema.optional(),
        tipo_informe: enumTolerante(["1", "2", "3"]).default("1").describe("1=Memoria Integrada, 2=SASB, 3=XBRL SASB (acepta 1 o '1')"),
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
      description:
        "Devuelve los estados financieros de las filiales de un emisor para un período, desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA y mes opcional en MM (default 12). Use esta tool para la operación del grupo consolidado; para EEFF de la matriz use cmf_empresa_eeff.",
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
      description:
        "Devuelve el registro de productos inscritos de una entidad ante la CMF: valores, cuotas y series. Identifique la entidad por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para ver qué instrumentos tiene inscritos una entidad; para identificarla primero use cmf_buscar_entidad.",
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
        "Devuelve los hechos esenciales de todo el mercado (o de un tipo de entidad) en un rango de fechas, con fecha/hora, número, entidad y materia. Fije mercado (V=valores, O=otros, S=seguros), tipoentidad opcional (ej: RVEMI) y desde/hasta en YYYY-MM-DD. REQUIERE captcha de la CMF (imagen de 6 caracteres): si no entrega captcha, la tool responde pidiéndoselo al usuario y debe reintentar con el código; si el captcha es inválido o expiró, devuelve error y hay que solicitar uno nuevo. Use esta tool para el flujo completo del mercado; para hechos de un emisor use cmf_empresa_hechos (sin captcha).",
      inputSchema: z.object({
        mercado: mercadoSchema.describe("Mercado: V=valores, O=otros, S=seguros"),
        tipoentidad: z.string().optional().describe("Tipo de entidad (ej: RVEMI; default RVEMI)"),
        desde: fechaSchema,
        hasta: fechaSchema,
        captcha: z.string().length(6).optional().describe("Código captcha de 6 caracteres (si no lo tiene, la tool le indicará dónde ver la imagen)"),
        captcha_id: z.string().optional().describe("Id del captcha que la tool le entregó en la respuesta previa (opcional; si no, usa el último captcha activo)"),
      }),
    },
    async ({ mercado, tipoentidad, desde, hasta, captcha, captcha_id }) => {
      try {
        if (!captcha) {
          const id = await pedirCaptchaCMF(env, "hechos");
          return toolError(
            `Esta consulta requiere un captcha de la CMF (imagen de 6 caracteres). Pida al usuario que lea la imagen del resource ` +
              `cmf://captcha/${id} (los hosts MCP pueden mostrarla directamente) y reintente esta misma tool con ` +
              `captcha=<código> y captcha_id=${id}.`,
          );
        }
        const reg = captcha_id
          ? await obtenerCaptcha(env, captcha_id)
          : ultimoCaptcha(env, "hechos");
        if (!reg) {
          return toolError(
            "No se encontró el captcha asociado (expirado o ya consumido). Vuelva a llamar esta tool SIN captcha para obtener una imagen nueva y reintente.",
          );
        }
        const f1 = fechaLegacy(desde);
        const f2 = fechaLegacy(hasta);
        const url = `/institucional/hechos/hechos2.php?entidad=${tipoentidad ?? "RVEMI"}&tipoentidad=${tipoentidad ?? "RVEMI"}&mercado=${mercado}&materia=ALL&p_fecha_desde=${f1.dd}/${f1.mm}/${f1.aa}&p_fecha_hasta=${f2.dd}/${f2.mm}/${f2.aa}&dias=&captcha=${captcha}&consultar=Buscar`;
        const html = reg
          ? await getLegacyConCookies(url, reg.cookies, env)
          : await getLegacy(url, {}, env);
        if (reg) await consumirCaptcha(env, reg.id);
        // Captcha inválido: la CMF redirige al formulario de hechos (contiene la imagen
        // captcha y NO trae la tabla de resultados). Nunca confundirlo con "sin hechos".
        const esFormulario = /captcha_hechos|name="form1"|hechos\.php\?/.test(html) && !/<table/i.test(html);
        if (esFormulario || (html.includes("captcha") && !/<table/i.test(html))) {
          return toolError("Captcha inválido o expirado (la CMF devolvió el formulario, no los resultados). Solicite un nuevo captcha y reintente; si el código era correcto, verifique el período de la consulta.");
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
      description:
        "Devuelve las sanciones aplicadas en todo un mercado (V=valores, O=otros, S=seguros) en un rango de fechas. Fije desde/hasta opcionales en YYYY-MM-DD (default 01/01/2020 a 31/12/2100) y tipoentidad opcional (ej: RVEMI; default ALL=todas). Use esta tool para tendencias sancionatorias del mercado; para sanciones de un emisor específico use cmf_empresa_sanciones.",
      inputSchema: z.object({
        mercado: mercadoSchema.describe("Mercado: V=valores, O=otros, S=seguros"),
        desde: fechaSchema.optional(),
        hasta: fechaSchema.optional(),
        tipoentidad: z.string().optional().describe("Tipo de entidad (ej: RVEMI; default ALL=todas)"),
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
      description:
        "Devuelve las resoluciones de la CMF sobre todo un mercado (V=valores, O=otros, S=seguros) en un rango de fechas. Fije desde/hasta opcionales en YYYY-MM-DD (default 01/01/2020 a 31/12/2100) y tipoentidad opcional (ej: RVEMI; default ALL=todas). Use esta tool para resoluciones de alcance de mercado; para resoluciones sobre un emisor use cmf_empresa_resoluciones.",
      inputSchema: z.object({
        mercado: mercadoSchema.describe("Mercado: V=valores, O=otros, S=seguros"),
        desde: fechaSchema.optional(),
        hasta: fechaSchema.optional(),
        tipoentidad: z.string().optional().describe("Tipo de entidad (ej: RVEMI; default ALL=todas)"),
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
      description:
        "Lista las comunicaciones publicadas por los emisores de valores (fecha, número, sociedad, entidad informante y descripción) con paginación offset/limit (máx 500). No tiene filtro de fecha (la CMF entrega el listado completo): itere las páginas con next_offset para llegar al período buscado. Use esta tool para monitorear comunicados del mercado; para hechos esenciales use cmf_hechos_globales o cmf_empresa_hechos.",
      inputSchema: z.object({ offset: offsetSchema, limit: limitSchema }),
    },
    async ({ offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/mercados/comunicaciones_detalle2.php", { entidad: "RVEMI" }, env);
        const filas = htmlTablaAJson(html, ["fecha", "numero", "sociedad", "entidad", "descripcion"]);
        if (filas.length === 0 && !/<table/i.test(html)) {
          return toolErrorFuente(
            "Comunicaciones de emisores",
            "https://www.cmfchile.cl/institucional/mercados/comunicaciones_detalle2.php",
          );
        }
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
      description:
        "Devuelve las clasificaciones de riesgo vigentes (corte a hoy) asignadas a emisores e instrumentos por las clasificadoras. Filtre opcionalmente por emisor, clasificadora o tipo_instrumento (texto libre); pagine con offset/limit (máx 500). Use esta tool para evaluar calidad crediticia de instrumentos; para el historial financiero del emisor use cmf_empresa_eeff.",
      inputSchema: z.object({
        emisor: z.string().optional().describe("Filtro por nombre o RUT del emisor (texto libre, opcional)"),
        clasificadora: z.string().optional().describe("Filtro por clasificadora (texto libre, opcional)"),
        tipo_instrumento: z.string().optional().describe("Filtro por tipo de instrumento (texto libre, opcional)"),
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
        if (filas.length === 0) {
          return toolErrorFuente(
            "Clasificaciones de riesgo",
            "https://www.cmfchile.cl/institucional/estadisticas/valores_clasificaciones_asignadas.php",
          );
        }
        const { filas: clasificaciones, paginado } = paginar(filas, offset, limit);
        const texto = `Clasificaciones (total ${paginado.total}):\n${resumirTabla(clasificaciones, Object.keys(clasificaciones[0] ?? {}).slice(0, 5))}`;
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
      description:
        "Devuelve los estados financieros IFRS de sociedades anónimas y otras entidades (sistema sa_eeff_ifrs) para un rango de períodos. Seleccione sociedades por RUT (array; default ['0']=todas), anio1/anio2 en AAAA (ej: 2024) y mes1/mes2 opcionales en MM (default 12). Use esta tool para cifras agregadas de SA; para EEFF de un emisor con PDFs auditados use cmf_empresa_eeff.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        anio1: anioSchema,
        anio2: anioSchema.describe("Año final del rango en AAAA (ej: 2025)"),
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional().describe("Mes final del rango en MM (default 12)"),
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
      description:
        "Devuelve los indicadores financieros IFRS calculados de sociedades anónimas (liquidez, endeudamiento, rentabilidad) para un corte. Fije fecha_max en formato AAAAMM (ej: 202512). Use esta tool para comparar ratios entre SA; para EEFF detallados use cmf_eeff_ifrs_sa.",
      inputSchema: z.object({
        fecha_max: z.string().regex(/^\d{6}$/, "AAAAMM").describe("Corte en formato AAAAMM (ej: 202512)"),
      }),
    },
    async ({ fecha_max }) => {
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
      description:
        "Devuelve los estados financieros bajo norma chilena (NCH/FECU) de sociedades anónimas para un rango de períodos. Seleccione sociedades por RUT (array; default todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para períodos pre-IFRS o agregados bajo norma local; para los EEFF IFRS con PDF auditado de UN emisor use cmf_empresa_eeff (norma=IFRS); para el sistema IFRS de todas las SA use cmf_eeff_ifrs_sa.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        anio1: anioSchema,
        anio2: anioSchema.describe("Año final del rango en AAAA (ej: 2025)"),
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional().describe("Mes final del rango en MM (default 12)"),
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
      description:
        "Devuelve los indicadores financieros calculados bajo norma chilena (NCH) de sociedades anónimas para un rango de períodos. Seleccione sociedades por RUT (array; default todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para ratios NCH; para indicadores IFRS use cmf_indicadores_financieros_sa.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        anio1: anioSchema,
        anio2: anioSchema.describe("Año final del rango en AAAA (ej: 2025)"),
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional().describe("Mes final del rango en MM (default 12)"),
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
      description:
        "Devuelve los dividendos declarados por sociedades anónimas (detalle y resumen por acción) para un período. Seleccione sociedades por RUT (array; default todas), anio en AAAA, anio2 opcional para rangos, mes/mes2 opcionales en MM (default 01-12) y tipodiv (default DIV). Use esta tool para historial de dividendos; para operaciones de capital use cmf_operaciones_capital.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        anio: anioSchema,
        anio2: anioSchema.optional().describe("Año final del rango en AAAA (default: igual a anio)"),
        mes: mesSchema.optional(),
        mes2: mesSchema.optional().describe("Mes final del rango en MM (default 12)"),
        tipodiv: z.string().optional().describe("Tipo de dividendo (default DIV)"),
      }),
    },
    async ({ sociedades, anio, anio2, mes, mes2, tipodiv }) => {
      try {
        const html = await postLegacy(
          "/institucional/estadisticas/divi/acc_dividendos1grid.php",
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
        if (filas.length === 0) {
          return toolErrorFuente(
            `Dividendos ${anio}`,
            "https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos_index.php",
          );
        }
        const texto = `Dividendos ${anio} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`;
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
      description:
        "Devuelve las operaciones de capital de sociedades anónimas para un año: repartos de capital, canjes de acciones o acciones liberadas de pago. Elija tipo=reparto, canje o liberadas; seleccione sociedades por RUT (array; default todas) y fije anio en AAAA. Use esta tool para eventos corporativos sobre el capital; para dividendos use cmf_dividendos.",
      inputSchema: z.object({
        tipo: z.enum(["reparto", "canje", "liberadas"]).describe("Operación: reparto=repartos de capital, canje=canjes de acciones, liberadas=acciones liberadas de pago"),
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
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
      description:
        "Devuelve los valores de ahorro previsional voluntario (APV) del mercado por tipo de fondo y cuadro, para un rango de períodos. Fije anio_desde/anio_hasta en AAAA y mes_desde/mes_hasta opcionales en MM (default 01-12); tipo y cuadro opcionales. Use esta tool para estadísticas de APV; para fondos mutuos use las tools cmf_fondos_mutuos_*.",
      inputSchema: z.object({
        anio_desde: anioSchema,
        anio_hasta: anioSchema.describe("Año final del rango en AAAA (ej: 2025)"),
        mes_desde: mesSchema.optional(),
        mes_hasta: mesSchema.optional().describe("Mes final del rango en MM (default 12)"),
        tipo: z.string().optional().describe("Tipo de APV (texto libre, opcional)"),
        cuadro: z.string().optional().describe("Cuadro (texto libre, opcional)"),
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
        if (filas.length === 0) {
          return toolErrorFuente(
            `Valores APV ${anio_desde}-${anio_hasta}`,
            "https://www.cmfchile.cl/institucional/estadisticas/valores_apv_enero2010.php",
          );
        }
        const texto = `Valores APV ${anio_desde}-${anio_hasta} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`;
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
      description:
        "Devuelve la información de tomas de control de emisores de valores publicada por la CMF (operación, fechas y sociedades involucradas). Elija el orden del listado con orden (1-5, default 1). Use esta tool para cambios de control accionario; para la composición accionaria actual use cmf_empresa_accionistas.",
      inputSchema: z.object({ orden: z.number().int().min(1).max(5).optional().describe("Orden del listado (1-5, default 1)") }),
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
      description:
        "Devuelve los listados de empresas que presentan EEFF bajo IFRS: listado general, Circular 556 u oficios 457/485. Elija tipo_listado=general (default), c556, ofc457 u ofc485. Use esta tool para verificar obligaciones de reporte IFRS de empresas; para los EEFF mismos use cmf_empresa_eeff.",
      inputSchema: z.object({
        tipo_listado: z.enum(["general", "c556", "ofc457", "ofc485"]).default("general").describe("Listado: general (default), c556=Circular 556, ofc457/ofc485=respuestas a oficios"),
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
      description:
        "Devuelve el calendario de fechas de divulgación de estados financieros de los emisores para un año. Fije anio en AAAA (ej: 2026). Use esta tool para anticipar la publicación de resultados; para los EEFF ya publicados use cmf_empresa_eeff.",
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
      description:
        "Devuelve los estados financieros IFRS de intermediarios de valores (agentes de valores, corredores de bolsa y corredores de bolsa de productos) para un rango de períodos. Seleccione sociedades por RUT (array; default todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para EEFF de intermediarios; para sociedades anónimas use cmf_eeff_ifrs_sa.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        anio1: anioSchema,
        anio2: anioSchema.describe("Año final del rango en AAAA (ej: 2025)"),
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional().describe("Mes final del rango en MM (default 12)"),
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
      description:
        "Devuelve los indicadores financieros IFRS de intermediarios de valores (agentes de valores y corredores de bolsa) para un rango de períodos. Seleccione sociedades por RUT (array; default todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para ratios de intermediarios; para sus EEFF use cmf_intermediarios_eeff_ifrs.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        anio1: anioSchema,
        anio2: anioSchema.describe("Año final del rango en AAAA (ej: 2025)"),
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional().describe("Mes final del rango en MM (default 12)"),
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
      description:
        "Devuelve los cuadros de resultados de agentes de valores y corredores de bolsa (tipo=av_cb, default) o de emisores bajo norma NCH (tipo=emisores_nch). Use esta tool para estados de resultados agregados del mercado; para EEFF de un emisor individual use cmf_empresa_eeff o cmf_empresa_eeff_nch.",
      inputSchema: z.object({
        tipo: z.enum(["av_cb", "emisores_nch"]).default("av_cb").describe("av_cb=agentes/corredores (default), emisores_nch=emisores bajo NCH"),
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
        if (filas.length === 0) {
          return toolErrorFuente(
            `Cuadros de resultados ${tipo}`,
            tipo === "av_cb"
              ? "https://www.cmfchile.cl/institucional/estadisticas/valores_agentes_cuadro.php"
              : "https://www.cmfchile.cl/institucional/estadisticas/valores_sociedades_cuadroresultados.php",
          );
        }
        const texto = `Cuadro ${tipo} (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`;
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
      description:
        "Devuelve los índices de liquidez y solvencia de los intermediarios de valores. Filtre opcionalmente por intermediario (texto libre; default todos) y por rango desde/hasta en YYYY-MM-DD (default 01/01/2024 a 31/12/2026). Use esta tool para monitorear la salud financiera de intermediarios; para sus EEFF use cmf_intermediarios_eeff_ifrs.",
      inputSchema: z.object({
        intermediario: z.string().optional().describe("Nombre o código del intermediario (texto libre, opcional; default todos)"),
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
      description:
        "Devuelve el reporte de préstamos otorgados del mercado de valores publicado por la CMF (el sistema legacy entrega el reporte completo, sin filtro de fechas). Use esta tool para estadísticas de préstamos del mercado.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const html = await getLegacy("/institucional/estadisticas/reporte_prestamos.php", {}, env);
        const filas = htmlTablaAJson(html);
        if (filas.length === 0) {
          return toolErrorFuente(
            "Préstamos otorgados",
            "https://www.cmfchile.cl/institucional/estadisticas/reporte_prestamos.php",
          );
        }
        const texto = `Préstamos otorgados (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`;
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
      title: "Actos y resoluciones publicados (dictámenes)",
      description:
        "Lista los actos administrativos y resoluciones publicados por la CMF (tabla de publicidad de actos según Ley 19.880, art. 45 y siguientes): tipo de acto, denominación, número, fecha de publicación, medio de comunicación, efectos generales o particulares y vínculo al documento. Consulte años completos con desde/hasta (YYYY-MM-DD; se consulta el año de cada fecha). Use esta tool para resoluciones generales publicadas; para sanciones a un emisor específico use cmf_empresa_sanciones y para resoluciones del mercado cmf_resoluciones_globales.",
      inputSchema: z.object({ desde: fechaSchema.optional(), hasta: fechaSchema.optional() }),
    },
    async ({ desde, hasta }) => {
      try {
        const anioDesde = Number((desde ?? "2000-01-01").slice(0, 4));
        const anioHasta = Number((hasta ?? String(new Date().getFullYear())).slice(0, 4));
        const anios: number[] = [];
        for (let aa = anioDesde; aa <= Math.min(anioHasta, new Date().getFullYear()); aa++) anios.push(aa);
        const todas: Record<string, string>[] = [];
        for (const aa of anios.slice(-5)) {
          const html = await getLegacy("/institucional/inc/dictamenes.php", { aa: String(aa) }, env);
          const filas = htmlTablaAJson(html);
          if (filas.length) todas.push(...filas.map((f) => ({ ...f, anio: String(aa) })));
        }
        if (todas.length === 0) {
          return toolError(
            "El servicio de actos publicados de la CMF no devolvió filas para el rango pedido (dictamenes.php?aa=AAAA). " +
              "Verifique el año en https://www.cmfchile.cl/institucional/inc/dictamenes_consulta.php y reintente.",
          );
        }
        const filas = todas.slice(0, 300);
        const texto = `Actos y resoluciones publicados (${filas.length} filas, años ${anios.slice(-5).join("/")}):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 5))}`;
        return toolOk(texto, { filas });
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
      description:
        "Devuelve las sanciones cursadas del mes en curso y la portada de sanciones (la CMF entrega la portada completa, sin filtro por mercado). Use esta tool para las sanciones más recientes; para rangos históricos use cmf_sanciones_globales; para las de un emisor use cmf_empresa_sanciones.",
      inputSchema: z.object({}),
    },
    async () => {
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
      description:
        "Devuelve las resoluciones cursadas recientes (historico=false, default) o el listado completo de meses anteriores (historico=true, respuesta grande). Use esta tool para resoluciones recientes de la CMF; para resoluciones filtradas por mercado use cmf_resoluciones_globales.",
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
        "Devuelve el catálogo completo de entidades supervisadas de la CMF filtrable por nombre (parcial), tipo de entidad (descripción o código como RVEMI/FMT/FIP) y estado (VI=vigentes, NV=no vigentes), con paginación offset/limit (máx 500). El catálogo se cachea 24h en KV; la primera carga sin caché puede exceder el límite de CPU del plan free de Workers. Use esta tool para búsquedas masivas o filtradas; para una entidad puntual use cmf_buscar_entidad.",
      inputSchema: z.object({
        nombre: z.string().optional().describe("Filtro por nombre (parcial, insensible a acentos)"),
        tipo_entidad: z.string().optional().describe("Filtro por tipo de entidad: texto parcial del tipo (ej: 'Emisores de Valores', 'Fondos Mutuos') o código (RVEMI, FMT, FIP, CSVID, CSGEN)"),
        estado: z.enum(["VI", "NV"]).optional().describe("VI=vigentes, NV=no vigentes (acepta VI/NV)"),
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
            filas = htmlTablaAJson(html, ["rut", "nombre", "tipo_entidad", "inscripcion", "estado"])
              // "Estado Actual" puede caer en `inscripcion` (columna intermedia vacía): normalizar.
              .map((f) => ({ ...f, estado: f.estado || f.inscripcion || "" }));
            await env.CMF_KV.put(claveKV, JSON.stringify(filas), { expirationTtl: 86_400 });
          }
        } else {
          const html = await getLegacy(
            "/institucional/mercados/consulta_busqueda.php",
            { valor: "%", entidad_web: "G", boton_busqueda: "Buscar" },
            env,
            "catalogo_entidades_raw",
          );
          filas = htmlTablaAJson(html, ["rut", "nombre", "tipo_entidad", "inscripcion", "estado"])
            .map((f) => ({ ...f, estado: f.estado || f.inscripcion || "" }));
        }
        if (nombre) {
          const q = nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          filas = filas.filter((f) =>
            (f.nombre ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q),
          );
        }
        if (tipo_entidad) {
          // El catálogo de la CMF trae el tipo como descripción ("Emisores de Valores de Oferta Pública").
          // Se aceptan también los códigos usuales, traducidos a su descripción.
          const CODIGOS_TIPO: Record<string, string> = {
            rvemi: "emisores de valores",
            fmt: "fondos mutuos",
            fip: "fondos de inversion",
            fic: "fondos de inversion",
            csvid: "seguros de vida",
            csgen: "seguros generales",
            av: "agentes de valores",
            cb: "corredores de bolsa",
            bancos: "bancos",
          };
          const q = (CODIGOS_TIPO[tipo_entidad.toLowerCase().trim()] ?? tipo_entidad).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          filas = filas.filter((f) =>
            (f.tipo_entidad ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q),
          );
        }
        if (estado) {
          const q = estado === "VI" ? "vigente" : "no vigente";
          filas = filas.filter((f) => (f.estado ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q));
        }
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
