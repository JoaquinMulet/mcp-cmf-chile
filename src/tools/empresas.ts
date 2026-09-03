import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { empresaArraySchema, historialSchema, globalesSchema, paginadoSchema, filasSchema } from "../util/schemas-output.js";
import { getLegacy, postLegacy, postLegacyBinario, getLegacyBinario, fetchCmf, fetchCmfBinario, getLegacyConCookies, type CmfEnv } from "../client/cmf-client.js";
import { htmlTablaAJson, xlsAJson, fechaLegacy, fechaLegacyCompleta, fixMojibake, txtCsvAJson, separarTotales } from "../client/parsers.js";
import { pedirCaptchaCMF, obtenerCaptcha, ultimoCaptcha, consumirCaptcha } from "../captcha.js";
import { fromError, toolOk, toolError, toolErrorFuente, sinDatosOFuente, resumirTabla, paginarTexto } from "../util/errors.js";
import { paginar } from "../util/paginate.js";
import { urlDocumentoCmf } from "../util/nombres.js";
import { bytesABase64 } from "../util/zip.js";
import { pdfAMarkdown, notaLimitacionesPdf, RESUMEN_LIMITACIONES_PDF } from "../pdf.js";
import { procesarTablasEEFF, textoVerificacion, textoAviso } from "../eeff-tables.js";
import { toolDeGrid, NOTA_ESCALA_IFRS_SA } from "../util/grid.js";
import { avisoDeTramo, paginacion, toolOkPaginado, toolOkTabla } from "../util/tramos.js";
import { enteroSchema,
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

/** Los 2 registros de la CMF entre los que eligen las estadísticas de SA. */
const registroSchema = z
  .enum(["RVEMI", "RGEIN"])
  .default("RVEMI")
  .describe("RVEMI = Registro de Valores, emisores (default); RGEIN = Registro de Entidades Informantes");

/**
 * Las 9 casillas tipo_estado[] del formulario sa_eeff_ifrs_index.php. Sin
 * ellas el grid trae solo la cabecera (moneda, tipo de balance y fechas).
 */
const TIPOS_DE_ESTADO_IFRS = ["esf", "er", "efe", "cla", "liq", "fuc", "nar", "dir", "ind"];

const OPERACIONES_DE_CAPITAL = {
  reparto: { path: "/institucional/estadisticas/acc_reparto1.php", titulo: "Repartos", plural: "repartos" },
  canje: { path: "/institucional/estadisticas/acc_canje1.php", titulo: "Canjes", plural: "canjes" },
  liberadas: { path: "/institucional/estadisticas/acc_liberadaspago1.php", titulo: "Liberadas", plural: "acciones liberadas" },
} as const;

/**
 * El campo rango_fechas del formulario de liquidez, tal como lo arma su
 * JavaScript. cada día del rango como AAAAMMDD% pegado, con tope de 31 días.
 * Devuelve el mensaje de error cuando el rango no cabe.
 */
function rangoFechasLiquidez(inicio: Date, fin: Date): { rango: string } | { error: string } {
  const dias = Math.round((fin.getTime() - inicio.getTime()) / 86_400_000);
  if (dias < 0 || dias > 31) {
    return { error: `El rango va de ${dias} días y el formulario de la CMF acepta entre 0 y 31. Pida tramos de un mes.` };
  }
  const rango = Array.from({ length: dias + 1 }, (_, i) => {
    const d = new Date(inicio.getTime() + i * 86_400_000);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}%`;
  }).join("");
  return { rango };
}

/**
 * La CMF arma UNA tabla por día, con una primera fila de título
 * «Fecha: dd/mm/aaaa» en un th que abarca las 5 columnas y recién después
 * la cabecera real. Se saca esa fecha y se pega a cada fila.
 */
function filasDeLiquidez(html: string): Record<string, string>[] {
  const filas: Record<string, string>[] = [];
  for (const tabla of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const fecha = /Fecha:\s*([0-9/]+)/.exec(tabla)?.[1];
    if (!fecha) continue;
    const sinTitulo = tabla.replace(/<tr>\s*<th[^>]*colspan[\s\S]*?<\/tr>/i, "");
    for (const f of htmlTablaAJson(sinTitulo)) filas.push({ fecha, ...f });
  }
  return filas;
}

/**
 * Pega a los nombres de columna las filas de cabecera que el lector de XLS
 * dejó como datos. Una fila es cabecera mientras no traiga la columna
 * `clave` (la de la entidad), y su texto se suma al nombre de cada columna.
 * «Número de» + «Prestamos» + «(1)» → «Número de Prestamos (1)».
 */
function unirCabeceraPartida(filas: Record<string, string>[], clave: string): Record<string, string>[] {
  // Si ninguna fila trae la clave, la planilla tiene otra forma y no hay
  // nada que pegar. devolverla tal cual es mejor que vaciarla en silencio.
  const primera = filas.findIndex((f) => clave in f);
  if (primera < 0) return filas;
  const nombres = new Map<string, string>();
  for (const fila of filas.slice(0, primera)) {
    for (const [k, v] of Object.entries(fila)) nombres.set(k, `${nombres.get(k) ?? k} ${v}`.trim());
  }
  return filas.slice(primera).map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [nombres.get(k) ?? k, v])));
}

/** Compara sin acentos ni mayúsculas, como escribe una persona un nombre. */
function contieneTexto(texto: string, buscado: string): boolean {
  const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return plano(texto).includes(plano(buscado));
}

export function registrarToolsEmpresas(server: McpServer, env: CmfEnv): void {
  // ---------- Búsqueda y catálogos ----------

  server.registerTool(
    "cmf_empresa_por_ticker",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Buscar empresa por ticker (NEMO)",
      description:
        "Busca una empresa chilena por su ticker de bolsa usando el catálogo de empresas en bolsa del proyecto empresas-cmf-chile (github.com/JoaquinMulet/empresas-cmf-chile). Identifique la empresa con consulta (NEMO como COPEC, SQM-B o LTM, o nombre parcial) y acote los resultados con limite (1-10, default 5). Devuelve el RUT (que puede incluir el dígito verificador), razón social, ISIN, tipo de entidad, norma e inicio IFRS. Use esta tool para traducir tickers a RUT antes de consultar EEFF o hechos; las demás tools aceptan el RUT con o sin DV.",
      inputSchema: z.object({
        consulta: z.string().min(2).describe("Ticker (NEMO) o nombre de la empresa"),
        term: z.string().optional().describe("Alias legacy de consulta (use consulta)"),
        limite: enteroSchema().min(1).max(10).default(5).describe("Máximo de resultados (1-10, default 5)"),
      }),
      outputSchema: z.object({
        resultados: z.array(z.record(z.string(), z.unknown())),
        total: z.number(),
        fuente: z.enum(["kv", "red"]),
      }).passthrough(),
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
        limite: enteroSchema().min(1).max(20).default(5).describe("Máximo de resultados (1-20, default 5)"),
      }),
      outputSchema: z.object({
        resultados: z.array(z.record(z.string(), z.string())),
        total: z.number(),
      }).passthrough(),
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
        return toolOk(texto + avisoDeTramo(resultados.length, paginado, "cmf_buscar_entidad"), { resultados, total: paginado.total, next_offset: paginado.next_offset });
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
        "Lista las entidades supervisadas de un tipo (tipoentidad, ej: RVEMI=emisores de valores) y mercado, paginado con offset/limit, sin máximo. Filtre por estado=VI (vigentes, default) o NV y mercado=V (default), O u S. Use esta tool para enumerar un segmento completo; para buscar por nombre o RUT use cmf_buscar_entidad y para el catálogo completo cmf_catalogo_entidades. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
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
      }).passthrough(),
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
        return toolOk(texto + avisoDeTramo(entidades.length, paginado, "cmf_listar_entidades"), { entidades, total: paginado.total, next_offset: paginado.next_offset });
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
        "Devuelve los datos de identificación de un emisor (razón social, RUT, inscripción y actividad) desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para confirmar identidad y estado de una empresa; para cifras use cmf_empresa_eeff y para gobierno corporativo cmf_empresa_directorio. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ rut: rutSchema, ...paginacion(50) }),
    },
    async ({ rut, offset, limit }) => {
      try {
        const html = await getLegacy(fichaUrl(rut, 1), {}, env);
        // La ficha es una tabla de 2 columnas sin cabecera, campo y valor.
        // Sin nombres explícitos el parser tomaba la primera fila («RUT» y
        // «90690000 - 9») como nombres de columna, así que el RUT consultado
        // pasaba a ser el nombre del campo y la ficha cambiaba de forma con
        // cada RUT.
        const filas = htmlTablaAJson(html, ["campo", "valor"]);
        return sinDatosOFuente(
          html,
          filas,
          `Identificación de la empresa ${rut}`,
          `https://www.cmfchile.cl/institucional/mercados/entidad.php?mercado=V&rut=${rut}&pestania=1`,
          () => toolOk(`Sin datos de identificación para RUT ${rut}.`, { rut, total: 0, next_offset: null, datos: [] }),
          () =>
            toolOkTabla({
              titulo: `Ficha identificación RUT ${rut}`,
              vacio: `Sin datos de identificación para RUT ${rut}.`,
              base: { rut },
              campo: "datos",
              filas,
              offset,
              limit,
              tool: "cmf_empresa_info",
            }),
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
        `Devuelve los estados financieros de un emisor (pestanía 3) para un período, consolidado o individual, IFRS o NCH, con los PDFs oficiales del período. modo=documentos: lista de PDFs (EEFF, análisis razonado, declaración, XBRL) con su url — para leer uno pase esa url completa a cmf_documento_markdown. modo=markdown: convierte además el PDF auditado de los EEFF a Markdown para leer las cifras directamente (el HTML de la CMF viene sin líneas: la fuente real de las cifras son los PDFs). ${RESUMEN_LIMITACIONES_PDF} Verifique los períodos disponibles con cmf_empresa_eeff_historial; para el sistema agregado de todas las SA use cmf_eeff_ifrs_sa.`,
      inputSchema: z.object({
        rut: rutSchema.optional(),
        query: rutSchema.optional().describe("Alias legacy de rut (use rut)"),
        anio: anioSchema,
        mes: mesCorteSchema.describe("Mes de corte trimestral (03/06/09/12)"),
        tipo: tipoBalanceSchema,
        norma: tipoNormaContableSchema,
        modo: z.enum(["documentos", "markdown"]).default("documentos").describe("documentos = lista de PDFs del período; markdown = PDF auditado convertido a Markdown"),
        max_chars: enteroSchema().min(1000).default(30000).describe("Tamaño del tramo en caracteres (modo markdown). Sin máximo: pide el documento entero de una vez. Por defecto 30000. Ej: 1000000"),
        offset_chars: enteroSchema().min(0).default(0).describe("Carácter donde empieza el tramo; use el que indique la respuesta anterior para seguir leyendo"),
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
      }).passthrough(),
    },
    async ({ rut, query, anio, mes, tipo, norma, modo, max_chars, offset_chars, validar_contable }) => {
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
            url: urlDocumentoCmf(dm[1]),
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
        // Paginado, no truncado. El corte a 1500 caracteres que había
        // antes remitía a `structuredContent`, que un modelo no puede
        // leer, así que entregaba la portada del PDF auditado y nada más.
        const pagina = paginarTexto(textoMd, offset_chars, max_chars);
        const truncado = pagina.siguiente !== null;
        const textoFinal = pagina.tramo;
        const texto = `${notaLimitacionesPdf(pdfType)}${verificacion}${avisoFusion}\n\nEEFF ${rutFinal} período ${periodo} (${tipo === "C" ? "Consolidado" : "Individual"}, ${norma}) — PDF auditado convertido a Markdown (${pdfType}, ${Math.round(bytes.length / 1024)} KB, ${textoMd.length} caracteres):\n\n${textoFinal}`;
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
        "Devuelve los hechos esenciales publicados por un emisor (fecha/hora, número, materia y enlace al documento) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); fije desde/hasta en YYYY-MM-DD y pagine con offset/limit, sin máximo. Use esta tool para hechos de un emisor específico; para el flujo de todo el mercado use cmf_hechos_globales (requiere captcha). Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
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
      }).passthrough(),
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
        return toolOk(texto + avisoDeTramo(hechos.length, paginado, "cmf_empresa_hechos"), { hechos, total: paginado.total, next_offset: paginado.next_offset });
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
        "Devuelve los 12 mayores accionistas de un emisor (nombre, RUT y participación) para un período, desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA y mes opcional en MM (default 12). Use esta tool para analizar la concentración accionaria; para el directorio use cmf_empresa_directorio. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ rut: rutSchema, anio: anioSchema, mes: mesSchema.optional(), ...paginacion(50) }),
    },
    async ({ rut, anio, mes, offset, limit }) => {
      try {
        const html = await postLegacy(fichaUrl(rut, 5), { mm: mes ?? "12", aa: anio }, env);
        // La pestaña trae 2 tablas. una de 1 celda con «Período: 12 / 2025»
        // y la de accionistas. La primera no es un accionista.
        const filas = htmlTablaAJson(html).filter((f) => Object.keys(f).length > 1);
        const texto = filas.length
          ? `Accionistas ${rut} período ${anio}-${mes ?? "12"} (total ${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 6))}`
          : `Sin accionistas publicados para ${rut} en ${anio}.`;
        return toolOkPaginado(texto, { rut, anio, mes }, "accionistas", filas, offset, limit, "cmf_empresa_accionistas");
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
        "Devuelve los directores y gerentes de un emisor (nombre y cargo; la ficha de la CMF no publica fechas de designación ni de cese) desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para gobierno corporativo; para la composición accionaria use cmf_empresa_accionistas. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ rut: rutSchema, ...paginacion(100) }),
    },
    async ({ rut, offset, limit }) => {
      try {
        const html = await getLegacy(fichaUrl(rut, 4), {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Directorio ${rut} (${filas.length} registros):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 5))}`
          : `Sin datos de administración para ${rut}.`;
        return toolOkPaginado(texto, { rut }, "directorio", filas, offset, limit, "cmf_empresa_directorio");
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
        "Devuelve las sanciones aplicadas por la CMF a un emisor (número, fecha y materia) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta opcionales en YYYY-MM-DD (default 01/01/2000 a 31/12/2100). Use esta tool para el historial sancionatorio de un emisor; para sanciones de todo un mercado use cmf_sanciones_globales. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ rut: rutSchema, desde: fechaSchema.optional(), hasta: fechaSchema.optional(), ...paginacion(100) }),
    },
    async ({ rut, desde, hasta, offset, limit }) => {
      try {
        const url = `${fichaUrl(rut, 36)}&fecha_inicio=${desde ? fechaLegacyCompleta(desde) : "01/01/2000"}&fecha_fin=${hasta ? fechaLegacyCompleta(hasta) : "31/12/2100"}&formulario=1`;
        const html = await getLegacy(url, {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Sanciones ${rut} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin sanciones para ${rut} en el período.`;
        return toolOkPaginado(texto, { rut }, "sanciones", filas, offset, limit, "cmf_empresa_sanciones");
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
        "Devuelve las resoluciones de la CMF sobre un emisor (número, fecha y materia) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta opcionales en YYYY-MM-DD (default 01/01/2000 a 31/12/2100). Use esta tool para resoluciones dirigidas a un emisor; para resoluciones generales publicadas use cmf_dictamenes o cmf_resoluciones_globales. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ rut: rutSchema, desde: fechaSchema.optional(), hasta: fechaSchema.optional(), ...paginacion(100) }),
    },
    async ({ rut, desde, hasta, offset, limit }) => {
      try {
        const url = `${fichaUrl(rut, 37)}&fecha_inicio=${desde ? fechaLegacyCompleta(desde) : "01/01/2000"}&fecha_fin=${hasta ? fechaLegacyCompleta(hasta) : "31/12/2100"}&formulario=1`;
        const html = await getLegacy(url, {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Resoluciones ${rut} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin resoluciones para ${rut} en el período.`;
        return toolOkPaginado(texto, { rut }, "resoluciones", filas, offset, limit, "cmf_empresa_resoluciones");
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
        "Devuelve las actas de juntas de accionistas de un emisor (ordinarias, extraordinarias o de reforma de estatutos) en un rango de fechas, con enlace al documento. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta en YYYY-MM-DD y tipo=ordinaria (default), extraordinaria o reforma. Use esta tool para la historia societaria y de gobernanza de un emisor. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        rut: rutSchema,
        desde: fechaSchema,
        hasta: fechaSchema,
        tipo: z.enum(["ordinaria", "extraordinaria", "reforma"]).default("ordinaria").describe("Tipo de junta: ordinaria (default), extraordinaria o reforma de estatutos"), ...paginacion(100) }),
    },
    async ({ rut, desde, hasta, tipo, offset, limit }) => {
      try {
        // Los códigos salen de los enlaces de la propia ficha. pestaña 78 lleva
        // tipo_junta=O y tipo_documento=A, la 79 lleva E y A, y la 80 (reforma
        // de estatutos) solo tipo_documento=R. Con los 2 campos vacíos la CMF
        // responde la lista vacía, y eso se leía como «sin actas».
        const [pestania, tipoJunta, tipoDocumento] =
          tipo === "ordinaria" ? [78, "O", "A"] : tipo === "extraordinaria" ? [79, "E", "A"] : [80, "", "R"];
        const html = await postLegacy(
          fichaUrl(rut, pestania),
          { fecha_desde: fechaLegacyCompleta(desde), fecha_hasta: fechaLegacyCompleta(hasta), tipo_documento: tipoDocumento, tipo_junta: tipoJunta },
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Actas juntas ${tipo} ${rut} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin actas de juntas ${tipo} para ${rut} en el período.`;
        return toolOkPaginado(texto, { rut, tipo }, "actas", filas, offset, limit, "cmf_empresa_juntas");
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
        "Devuelve los documentos de la memoria anual de un emisor para un año (memoria, EEFF anuales e informes de auditores). Identifique el emisor por rut (numérico; se acepta con o sin DV) y fije anio en AAAA (ej: 2024). Use esta tool para el contexto anual completo; para cifras trimestrales use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ rut: rutSchema, anio: anioSchema, ...paginacion(50) }),
    },
    async ({ rut, anio, offset, limit }) => {
      try {
        const html = await postLegacy(fichaUrl(rut, 49), { aa: anio }, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Memoria anual ${anio} de ${rut} (${filas.length} documentos):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 3))}`
          : `Sin memoria anual ${anio} para ${rut}.`;
        return toolOkPaginado(texto, { rut, anio }, "documentos", filas, offset, limit, "cmf_empresa_memoria_anual");
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
        "Devuelve los indicadores ASG (ambientales, sociales y de gobernanza) de un emisor para un período: memoria integrada, SASB o XBRL SASB. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA, mes opcional en MM (default 12) y tipo_informe=1 (Memoria Integrada), 2 (SASB) o 3 (XBRL SASB). Use esta tool para datos de sostenibilidad; para datos financieros use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        rut: rutSchema,
        anio: anioSchema,
        mes: mesSchema.optional(),
        tipo_informe: enumTolerante(["1", "2", "3"]).default("1").describe("1=Memoria Integrada, 2=SASB, 3=XBRL SASB (acepta 1 o '1')"), ...paginacion(100) }),
    },
    async ({ rut, anio, mes, tipo_informe, offset, limit }) => {
      try {
        const html = await postLegacy(fichaUrl(rut, 110), { aa: anio, mm: mes ?? "12", t_inf: tipo_informe }, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Indicadores ASG ${anio} de ${rut} (${filas.length} registros):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin indicadores ASG ${anio} para ${rut}.`;
        return toolOkPaginado(texto, { rut, anio, tipo_informe }, "indicadores", filas, offset, limit, "cmf_empresa_asg");
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
        "Devuelve los estados financieros de las filiales de un emisor para un período, desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA y mes opcional en MM (default 12). Use esta tool para la operación del grupo consolidado; para EEFF de la matriz use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ rut: rutSchema, anio: anioSchema, mes: mesSchema.optional(), ...paginacion(100) }),
    },
    async ({ rut, anio, mes, offset, limit }) => {
      try {
        const html = await postLegacy(fichaUrl(rut, 33), { aa: anio, mm: mes ?? "12" }, env);
        // Una fila por filial, con 1 celda de texto («Descarga X - Periodo
        // :202412 - Descargar Archivo PDF - (13/03/2025)») y su enlace. Sin
        // nombre explícito la primera filial se volvía el nombre de la
        // columna y se perdía. El texto se parte en sus 3 partes.
        const filas = htmlTablaAJson(html, ["descarga"]).map((f) => {
          const m = /^Descarga\s+(.*?)\s+-\s+Periodo\s*:\s*(\d{6})\s+-.*?\((\d{2}\/\d{2}\/\d{4})\)/.exec(f.descarga);
          return m ? { filial: m[1], periodo: m[2], fecha_publicacion: m[3], url: f.url } : f;
        });
        const texto = filas.length
          ? `EEFF filiales ${rut} ${anio}-${mes ?? "12"} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]))}`
          : `Sin EEFF de filiales para ${rut} en ${anio}.`;
        return toolOkPaginado(texto, { rut, anio }, "filiales", filas, offset, limit, "cmf_empresa_eeff_filiales");
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
        "Devuelve los títulos de deuda inscritos por un emisor ante la CMF (pestaña 'Inscripción títulos de deuda' de su ficha), con una fila por documento de cada inscripción: número de inscripción, fecha, tipo de documento (acta de directorio, certificado de clasificación de riesgo, prospecto, entre otros) y enlace al archivo. Identifique la entidad por rut (numérico; se acepta con o sin DV, ej: 90690000). Use esta tool para ver qué bonos y efectos de comercio tiene inscritos un emisor; para identificarlo primero use cmf_buscar_entidad, y para los prospectos de bonos use la pestaña 42 con cmf_empresa_info. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ rut: rutSchema, ...paginacion(200) }),
    },
    async ({ rut, offset, limit }) => {
      try {
        // La pestaña 31 que se leía antes no pertenece a la ficha del emisor.
        // la CMF respondía el padrón de la Bolsa de Productos (maíz, trigo,
        // vino) para cualquier RUT, 471 filas idénticas. La pestaña 100 sí es
        // del emisor. Su tabla trae el número de inscripción en una fila sola
        // y los documentos debajo, así que el número se arrastra a cada uno.
        const html = await getLegacy(fichaUrl(rut, 100), {}, env);
        const crudas = htmlTablaAJson(html);
        const colNumero = Object.keys(crudas[0] ?? {})[0] ?? "N° Inscripción";
        let inscripcion = "";
        const filas: Record<string, string>[] = [];
        for (const f of crudas) {
          const valores = Object.entries(f).filter(([k]) => k !== colNumero && k !== "url").map(([, v]) => v);
          if (valores.every((v) => v === "")) {
            inscripcion = f[colNumero].replace(/^-\s*/, "");
            continue;
          }
          filas.push({ ...f, [colNumero]: inscripcion });
        }
        const texto = filas.length
          ? `Títulos de deuda inscritos ${rut} (${filas.length} documentos):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 6))}`
          : `Sin títulos de deuda inscritos para ${rut}.`;
        return toolOkPaginado(texto, { rut }, "productos", filas, offset, limit, "cmf_empresa_registro_productos");
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
        "Devuelve los hechos esenciales de todo el mercado (o de un tipo de entidad) en un rango de fechas, con fecha/hora, número, entidad y materia. Fije mercado (V=valores, O=otros, S=seguros), tipoentidad opcional (ej: RVEMI) y desde/hasta en YYYY-MM-DD. REQUIERE captcha de la CMF (imagen de 6 caracteres): si no entrega captcha, la tool responde pidiéndoselo al usuario y debe reintentar con el código; si el captcha es inválido o expiró, devuelve error y hay que solicitar uno nuevo. Use esta tool para el flujo completo del mercado; para hechos de un emisor use cmf_empresa_hechos (sin captcha). Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        mercado: mercadoSchema.describe("Mercado: V=valores, O=otros, S=seguros"),
        tipoentidad: z.string().optional().describe("Tipo de entidad (ej: RVEMI; default RVEMI)"),
        desde: fechaSchema,
        hasta: fechaSchema,
        captcha: z.string().length(6).optional().describe("Código captcha de 6 caracteres (si no lo tiene, la tool le indicará dónde ver la imagen)"),
        captcha_id: z.string().optional().describe("Id del captcha que la tool le entregó en la respuesta previa (opcional; si no, usa el último captcha activo)"), ...paginacion(200) }),
    },
    async ({ mercado, tipoentidad, desde, hasta, captcha, captcha_id, offset, limit }) => {
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
        return toolOkTabla({
          titulo: `Hechos esenciales ${mercado}`,
          vacio: "Sin hechos en el período.",
          base: { mercado, desde, hasta },
          campo: "hechos",
          filas,
          offset,
          limit,
          tool: "cmf_hechos_globales",
          columnas: ["fecha_hora", "numero", "entidad", "materia"],
        });
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
        "Devuelve las sanciones aplicadas en todo un mercado (V=valores, O=otros, S=seguros, B=bancos) en un rango de fechas, con número, fecha, materia y enlace. Fije desde/hasta opcionales en YYYY-MM-DD (default 01/01/2020 a 31/12/2100), tipoentidad opcional (ej: RVEMI; default ALL=todas) y texto opcional para quedarse solo con las filas cuya materia lo contiene (ej: 'BANCO DE CHILE'; sin acentos ni mayúsculas importa). Verificado el 2 de septiembre de 2026: las multas a bancos (Banco de Chile, Santander) salen bajo mercado O, y bajo B salen las fintech; use texto para encontrar una entidad. Use esta tool para tendencias sancionatorias del mercado y para las sanciones de un banco o una aseguradora, porque cmf_empresa_sanciones solo cubre la ficha de emisores de valores. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        mercado: mercadoSchema.describe("Mercado: V=valores, O=otros, S=seguros, B=bancos"),
        desde: fechaSchema.optional(),
        hasta: fechaSchema.optional(),
        tipoentidad: z.string().optional().describe("Tipo de entidad (ej: RVEMI; default ALL=todas)"),
        texto: z.string().optional().describe("Filtro por texto en la materia (ej: 'BANCO DE CHILE')"), ...paginacion(200) }),
    },
    async ({ mercado, desde, hasta, tipoentidad, texto: filtro, offset, limit }) => {
      try {
        const url = `/institucional/sanciones/sanciones_mercados_entidad.php?mercado=${mercado}&entidad=${tipoentidad ?? "ALL"}&nom_entidad=&desde=${desde ? fechaLegacyCompleta(desde) : "01/01/2020"}&hasta=${hasta ? fechaLegacyCompleta(hasta) : "31/12/2100"}`;
        const html = await getLegacy(url, {}, env);
        const filas = htmlTablaAJson(html).filter((f) => !filtro || contieneTexto(Object.values(f).join(" "), filtro));
        const texto = filas.length
          ? `Sanciones mercado ${mercado} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin sanciones en mercado ${mercado}.`;
        return toolOkPaginado(texto, { mercado }, "sanciones", filas, offset, limit, "cmf_sanciones_globales");
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
        "Devuelve las resoluciones de la CMF sobre todo un mercado (V=valores, O=otros, S=seguros) en un rango de fechas. Fije desde/hasta opcionales en YYYY-MM-DD (default 01/01/2020 a 31/12/2100) y tipoentidad opcional (ej: RVEMI; default ALL=todas). Use esta tool para resoluciones de alcance de mercado; para resoluciones sobre un emisor use cmf_empresa_resoluciones. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        mercado: mercadoSchema.describe("Mercado: V=valores, O=otros, S=seguros"),
        desde: fechaSchema.optional(),
        hasta: fechaSchema.optional(),
        tipoentidad: z.string().optional().describe("Tipo de entidad (ej: RVEMI; default ALL=todas)"), ...paginacion(200) }),
    },
    async ({ mercado, desde, hasta, tipoentidad, offset, limit }) => {
      try {
        const url = `/institucional/resoluciones/resoluciones_mercados_entidad.php?mercado=${mercado}&entidad=${tipoentidad ?? "ALL"}&nom_entidad=&fecha_inicio=${desde ? fechaLegacyCompleta(desde) : "01/01/2020"}&fecha_fin=${hasta ? fechaLegacyCompleta(hasta) : "31/12/2100"}`;
        const html = await getLegacy(url, {}, env);
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Resoluciones mercado ${mercado} (${filas.length}):\n${resumirTabla(filas, Object.keys(filas[0]).slice(0, 4))}`
          : `Sin resoluciones en mercado ${mercado}.`;
        return toolOkPaginado(texto, { mercado }, "resoluciones", filas, offset, limit, "cmf_resoluciones_globales");
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
        "Lista las comunicaciones publicadas por los emisores de valores (fecha, número, sociedad, entidad informante y descripción) con paginación offset/limit, sin máximo. No tiene filtro de fecha (la CMF entrega el listado completo): itere las páginas con next_offset para llegar al período buscado. Use esta tool para monitorear comunicados del mercado; para hechos esenciales use cmf_hechos_globales o cmf_empresa_hechos. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
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
        return toolOk(texto + avisoDeTramo(comunicaciones.length, paginado, "cmf_comunicaciones_emisores"), { comunicaciones, total: paginado.total, next_offset: paginado.next_offset });
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
        "Devuelve las clasificaciones de riesgo asignadas a emisores e instrumentos por las clasificadoras (XLSX oficial de la CMF), paginado con offset/limit, sin máximo. El sistema usa un flujo en 2 pasos: la tool genera el archivo (POST a excel_busqueda_clasificaciones) y descarga el XLSX resultante, que luego se parsea a filas. Filtre opcionalmente por emisor, clasificadora o tipo_instrumento (los filtros se aplican sobre las filas descargadas). Use esta tool para evaluar calidad crediticia de instrumentos; para el historial financiero del emisor use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
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
        // La generación del XLSX en la CMF puede tardar: timeout ampliado para estos 2 pasos.
        const envLento = { ...env, CMF_UPSTREAM_TIMEOUT_MS: "90000" };
        // Paso 1: generar el archivo (el endpoint devuelve {estado, hash}; claves exactas del JS de la CMF)
        const paso1 = await postLegacy(
          "/institucional/inc/excel_busqueda_clasificaciones.php",
          {
            clasificadora: "0",
            tipo_emisor: "0",
            emisor: "0",
            tipo_instrumento: "0",
            fecha_desde: "",
            fecha_hasta: "",
            fecha_corte: "",
            insc_emisor: "0",
            viginst: "S",
          },
          envLento,
        );
        const hash = /"hash"\s*:\s*"([0-9a-f]+)"/i.exec(paso1)?.[1];
        if (!hash) {
          return toolErrorFuente(
            "Clasificaciones de riesgo",
            "https://www.cmfchile.cl/institucional/estadisticas/valores_clasificaciones_asignadas.php",
            "el generador de clasificaciones no devolvió hash",
          );
        }
        // Paso 2: descargar el XLSX generado
        const bytes = await getLegacyBinario(
          `/institucional/estadisticas/clasificaciones_asignadas_excel_fcorte_descargar.php?hash=${hash}`,
          {},
          envLento,
        );
        let filas = xlsAJson(bytes) as Record<string, unknown>[];
        if (filas.length === 0) {
          return toolErrorFuente(
            "Clasificaciones de riesgo",
            "https://www.cmfchile.cl/institucional/estadisticas/valores_clasificaciones_asignadas.php",
            "el XLSX generado no trajo filas",
          );
        }
        if (emisor || clasificadora || tipo_instrumento) {
          const fEmisor = emisor?.toLowerCase() ?? "";
          const fClasif = clasificadora?.toLowerCase() ?? "";
          const fTipo = tipo_instrumento?.toLowerCase() ?? "";
          filas = filas.filter((f) => {
            const textoFila = Object.values(f).join(" ").toLowerCase();
            return (!fEmisor || textoFila.includes(fEmisor)) && (!fClasif || textoFila.includes(fClasif)) && (!fTipo || textoFila.includes(fTipo));
          });
        }
        const { filas: clasificaciones, paginado } = paginar(filas, offset, limit);
        const texto = `Clasificaciones de riesgo (total ${paginado.total}):\n${resumirTabla(clasificaciones, Object.keys(clasificaciones[0] ?? {}).slice(0, 5))}`;
        return toolOk(texto + avisoDeTramo(clasificaciones.length, paginado, "cmf_clasificaciones_riesgo"), { clasificaciones, total: paginado.total, next_offset: paginado.next_offset });
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
        "Devuelve los estados financieros IFRS completos (situación financiera, resultados y flujo de efectivo, con sus 500 y tantas cuentas de la taxonomía) de sociedades anónimas y otras entidades, para un rango de períodos. Cada fila es una cuenta y cada columna una sociedad en un período (la lista entidades trae esas columnas); las cifras van en unidades de la moneda de la fila Moneda, no en miles. Seleccione sociedades por RUT sin DV (array; default ['0']=todas, que devuelve cientos de columnas), registro (RVEMI = emisores de valores, default; RGEIN = otras entidades informantes), anio1/anio2 en AAAA (ej: 2024) y mes1/mes2 opcionales en MM (default 12; solo 03, 06, 09 y 12). Use esta tool para cifras comparables entre SA; para EEFF de un emisor con PDFs auditados use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        registro: registroSchema,
        anio1: anioSchema,
        anio2: anioSchema.describe("Año final del rango en AAAA (ej: 2025)"),
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional().describe("Mes final del rango en MM (default 12)"), ...paginacion(300) }),
    },
    async ({ sociedades, registro, anio1, anio2, mes1, mes2, offset, limit }) => {
      try {
        return await toolDeGrid(
          {
            que: "EEFF IFRS SA",
            indice: "/institucional/estadisticas/merc_valores/sa_eeff_ifrs/sa_eeff_ifrs_index.php",
            parametrosIndice: { lang: "es", rg_rf: registro },
            cuerpo: {
              "sociedad[]": sociedades,
              anno1: anio1,
              anno2: anio2,
              mes1: mes1 ?? "12",
              mes2: mes2 ?? "12",
              indcon: "0",
              "tipo_estado[]": TIPOS_DE_ESTADO_IFRS,
            },
            titulo: `EEFF IFRS SA ${anio1}-${mes1 ?? "12"} → ${anio2}-${mes2 ?? "12"}`,
            vacio: "Sin resultados EEFF IFRS SA para esas sociedades y ese rango.",
            base: { sociedades, registro, anio1, anio2 },
            offset,
            limit,
            tool: "cmf_eeff_ifrs_sa",
            notas: [NOTA_ESCALA_IFRS_SA],
          },
          env,
        );
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
        "Devuelve los indicadores financieros IFRS calculados de sociedades anónimas (rentabilidad, liquidez, endeudamiento, capital de trabajo) para un corte. Cada fila es una sociedad en ese corte, con un campo por indicador y su unidad en el nombre del campo. Fije fecha_max en formato AAAAMM (ej: 202512; solo meses 03, 06, 09 y 12), sociedades por RUT sin DV (array; default ['0']=todas) y registro (RVEMI = emisores de valores, default; RGEIN = otras entidades informantes). Use esta tool para comparar ratios entre SA; para los EEFF detallados use cmf_eeff_ifrs_sa y para ratios bajo norma local use cmf_indicadores_financieros_nch. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        fecha_max: z.string().regex(/^\d{6}$/, "AAAAMM").describe("Corte en formato AAAAMM (ej: 202512)"),
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        registro: registroSchema, ...paginacion(300) }),
    },
    async ({ fecha_max, sociedades, registro, offset, limit }) => {
      try {
        const anno = fecha_max.slice(0, 4);
        const mes = fecha_max.slice(4, 6);
        return await toolDeGrid(
          {
            que: `Indicadores IFRS SA corte ${fecha_max}`,
            indice: "/institucional/estadisticas/merc_valores/sa_indicadores_ifrs/sa_indicadoresfinancieros_index.php",
            parametrosIndice: { lang: "es", rg_rf: registro },
            cuerpo: { "sociedad[]": sociedades, anno1: anno, anno2: anno, mes1: mes, mes2: mes, indcon: "0" },
            porEntidad: true,
            titulo: `Indicadores IFRS SA corte ${fecha_max}`,
            vacio: "Sin indicadores IFRS para ese corte y esas sociedades.",
            base: { fecha_max, sociedades, registro },
            offset,
            limit,
            tool: "cmf_indicadores_financieros_sa",
          },
          env,
        );
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
        "Devuelve la FECU resumida bajo norma chilena (NCH, anterior a IFRS, o sea hasta 2009 para la mayoría) de sociedades anónimas para un rango de períodos, en miles de pesos o de la moneda que corresponda. Cada fila es una sociedad en un período, con un campo por partida (RUT, razón social, moneda, activos, pasivos, resultados). Seleccione sociedades por RUT sin DV (array; default ['0']=todas), registro (RVEMI = emisores de valores, default; RGEIN = otras entidades informantes), indcon (0 = todos, I = individual, C = consolidado; default 0), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para períodos pre-IFRS; para los EEFF IFRS con PDF auditado de UN emisor use cmf_empresa_eeff (norma=IFRS); para el sistema IFRS de todas las SA use cmf_eeff_ifrs_sa. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        registro: registroSchema,
        indcon: z.enum(["0", "I", "C"]).default("0").describe("0 = todos, I = individual, C = consolidado"),
        anio1: anioSchema,
        anio2: anioSchema.describe("Año final del rango en AAAA (ej: 2009)"),
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional().describe("Mes final del rango en MM (default 12)"), ...paginacion(300) }),
    },
    async ({ sociedades, registro, indcon, anio1, anio2, mes1, mes2, offset, limit }) => {
      try {
        return await toolDeGrid(
          {
            que: "EEFF NCH SA",
            indice: "/institucional/estadisticas/sa_fecu_index.php",
            parametrosIndice: { lang: "es", rg_rf: registro },
            cuerpo: {
              "sociedad[]": sociedades,
              anno1: anio1,
              anno2: anio2,
              mes1: mes1 ?? "12",
              mes2: mes2 ?? "12",
              indcon,
              rg_rf: registro,
              xls: "n",
            },
            porEntidad: true,
            titulo: `EEFF NCH SA ${anio1}-${mes1 ?? "12"} → ${anio2}-${mes2 ?? "12"}`,
            vacio: "Sin resultados EEFF NCH para esas sociedades y ese rango.",
            base: { sociedades, registro, indcon, anio1, anio2 },
            offset,
            limit,
            tool: "cmf_empresa_eeff_nch",
          },
          env,
        );
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
        "Devuelve los indicadores financieros calculados bajo norma chilena (NCH, anterior a IFRS, o sea hasta 2009 para la mayoría) de sociedades anónimas para un rango de períodos. Cada fila es una sociedad en un período, con un campo por partida e indicador (activo total, patrimonio, ingresos, rentabilidad, liquidez, endeudamiento). Seleccione sociedades por RUT sin DV (array; default ['0']=todas), registro (RVEMI = emisores de valores, default; RGEIN = otras entidades informantes), indcon (0 = todos, I = individual, C = consolidado; default 0), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para ratios NCH; para indicadores IFRS use cmf_indicadores_financieros_sa. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        registro: registroSchema,
        indcon: z.enum(["0", "I", "C"]).default("0").describe("0 = todos, I = individual, C = consolidado"),
        anio1: anioSchema,
        anio2: anioSchema.describe("Año final del rango en AAAA (ej: 2009)"),
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional().describe("Mes final del rango en MM (default 12)"), ...paginacion(300) }),
    },
    async ({ sociedades, registro, indcon, anio1, anio2, mes1, mes2, offset, limit }) => {
      try {
        return await toolDeGrid(
          {
            que: "Indicadores NCH SA",
            indice: "/institucional/estadisticas/sa_indicadoresfinancieros_index.php",
            parametrosIndice: { lang: "es", rg_rf: registro },
            cuerpo: {
              "sociedad[]": sociedades,
              anno1: anio1,
              anno2: anio2,
              mes1: mes1 ?? "12",
              mes2: mes2 ?? "12",
              anual: "n",
              actual: "n",
              indcon,
              rg_rf: registro,
              xls: "n",
            },
            porEntidad: true,
            titulo: `Indicadores NCH SA ${anio1}-${mes1 ?? "12"} → ${anio2}-${mes2 ?? "12"}`,
            vacio: "Sin indicadores NCH para esas sociedades y ese rango.",
            base: { sociedades, registro, indcon, anio1, anio2 },
            offset,
            limit,
            tool: "cmf_indicadores_financieros_nch",
          },
          env,
        );
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
        "Devuelve los dividendos declarados que la CMF publica en su estadística de dividendos, con una fila por dividendo (sociedad y fecha de pago) y sus campos: RUT, razón social, número y tipo de dividendo, fechas de acuerdo, cierre, límite y pago, moneda, dividendo por acción, número de acciones y montos. COBERTURA, verificada el 2 de septiembre de 2026: el formulario de la CMF solo ofrece 176 sociedades, casi todas concesionarias y sanitarias (aeropuertos, Aguas Araucanía, autopistas); las sociedades de bolsa como Copec NO están y para ellas los dividendos se leen en sus hechos esenciales con cmf_empresa_hechos. Seleccione sociedades por RUT sin DV (array; ['0'] = todas), anio en AAAA, anio2 opcional para rangos, mes/mes2 opcionales en MM (default 01-12) y tipodiv (0=dividendos, default 0). Si una sociedad no tiene dividendos en el período, la CMF lo dice y la tool lo reporta como ausencia real. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        anio: anioSchema,
        anio2: anioSchema.optional().describe("Año final del rango en AAAA (default: igual a anio)"),
        mes: mesSchema.optional().describe("Mes inicial en MM (default 01)"),
        mes2: mesSchema.optional().describe("Mes final en MM (default 12)"),
        tipodiv: z.string().default("0").describe("Tipo de dividendo (0=dividendos, default)"), ...paginacion(300) }),
    },
    async ({ sociedades, anio, anio2, mes, mes2, tipodiv, offset, limit }) => {
      try {
        return await toolDeGrid(
          {
            que: `Dividendos ${anio}`,
            indice: "/institucional/estadisticas/divi/acc_dividendos_index.php",
            cuerpo: {
              anno: anio,
              anno2: anio2 ?? anio,
              mes: mes ?? "01",
              mes2: mes2 ?? "12",
              tipodiv,
              "sociedad[]": sociedades,
            },
            // Cada columna del grid es un dividendo (sociedad y fecha), así
            // que la fila natural es el dividendo con sus campos.
            porEntidad: true,
            sinDatosSi: /no se encuentran datos/i,
            titulo: `Dividendos ${anio}${anio2 && anio2 !== anio ? `-${anio2}` : ""}`,
            vacio: `Sin dividendos para las sociedades seleccionadas en el período ${anio} (la CMF no encontró datos).`,
            base: { anio, sociedades },
            offset,
            limit,
            tool: "cmf_dividendos",
          },
          env,
        );
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
        "Devuelve las operaciones de capital de sociedades anónimas: repartos de capital, canjes de acciones o acciones liberadas de pago, con una fila por operación (sociedad y año) y sus campos (RUT, razón social, número, serie, fechas de acuerdo, límite y pago, moneda, monto por acción, acciones y totales en miles). Elija tipo=reparto, canje o liberadas; seleccione sociedades por RUT sin DV (array; ['0'] = todas) y fije anio en AAAA, o anio='0' para todos los años, que es lo más útil porque estas operaciones son pocas por año. Use esta tool para eventos corporativos sobre el capital; para dividendos use cmf_dividendos. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        tipo: z.enum(["reparto", "canje", "liberadas"]).describe("Operación: reparto=repartos de capital, canje=canjes de acciones, liberadas=acciones liberadas de pago"),
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        anio: z.union([z.literal("0"), z.literal(0), anioSchema]).transform(String).describe("Año en AAAA, o '0' para todos los años"), ...paginacion(300) }),
    },
    async ({ tipo, sociedades, anio, offset, limit }) => {
      try {
        const operacion = OPERACIONES_DE_CAPITAL[tipo];
        // Estas páginas son índice y resultado a la vez. su formulario f5
        // se envía a la misma ruta, y el grid viene en dataAsJson. La opción
        // «Todas» del select vale "" y no "0". con "0" la CMF no encuentra nada.
        return await toolDeGrid(
          {
            que: `${operacion.titulo} ${anio === "0" ? "todos los años" : anio}`,
            indice: operacion.path,
            formulario: "f5",
            cuerpo: { "sociedad[]": sociedades.map((s) => (s === "0" ? "" : s)), anno3: anio },
            porEntidad: true,
            sinDatosSi: /no se encuentran datos/i,
            titulo: `${operacion.titulo} ${anio === "0" ? "todos los años" : anio}`,
            vacio: `Sin ${operacion.plural} de capital para ${anio === "0" ? "ningún año" : anio} (la CMF no encontró datos).`,
            base: { tipo, anio, sociedades },
            offset,
            limit,
            tool: "cmf_operaciones_capital",
          },
          env,
        );
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
        "Devuelve los valores de ahorro previsional voluntario (APV) que publica la CMF (Circular 1981): depósitos, traspasos, cuentas y bonificaciones por tipo de entidad y mes. Elija el cuadro (1=Depósitos APV, 2=Depósitos Convenidos, 3=APV Colectivo, 4=Bonificación APV/APVC, 5-10=Traspasos, 11+=Cuentas y desgloses), el rango (anio_desde/anio_hasta en AAAA, mes_desde/mes_hasta en MM) y los tipos de entidad (FI=fondos de inversión, FM=mutuos, FV=seguros de vida, IV, SV, SA). Con exportar=true devuelve además el XLS oficial del cuadro (base64). Use esta tool para estadísticas de APV; para fondos mutuos use las tools cmf_fondos_mutuos_*. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        anio_desde: anioSchema,
        anio_hasta: anioSchema.describe("Año final del rango en AAAA (ej: 2025)"),
        mes_desde: mesSchema.optional().describe("Mes inicial en MM (default 01)"),
        mes_hasta: mesSchema.optional().describe("Mes final en MM (default 12)"),
        cuadro: z.string().default("1").describe("Cuadro estadístico: 1=Depósitos APV, 2=Depósitos Convenidos, 3=APV Colectivo, 4=Bonificación APV/APVC, 5-10=Traspasos, 11+=Cuentas y desgloses (default 1)"),
        tipo_e: z.array(z.enum(["FI", "FM", "FV", "IV", "SV", "SA"])).default(["FI", "FM", "FV"]).describe("Tipos de entidad a incluir (default FI,FM,FV)"),
        tipo: z.enum(["entidad", "agregado"]).default("entidad").describe("Vista: entidad o agregado (default entidad)"),
        exportar: z.boolean().default(false).describe("true = además descarga el XLS oficial del cuadro (base64 en xls_base64)"), ...paginacion(300) }),
    },
    async ({ anio_desde, anio_hasta, mes_desde, mes_hasta, cuadro, tipo_e, tipo, exportar, offset, limit }) => {
      try {
        const params = {
          cuadro,
          tipo,
          mes_desde: mes_desde ?? "01",
          ano_desde: anio_desde,
          mes_hasta: mes_hasta ?? "12",
          ano_hasta: anio_hasta,
          "tipo_e[]": tipo_e,
        };
        const envLento = { ...env, CMF_UPSTREAM_TIMEOUT_MS: "90000" };
        const html = await postLegacy("/institucional/estadisticas/cuadros.php", params, envLento);
        const filas = htmlTablaAJson(html);
        if (filas.length === 0 && !/<table/i.test(html)) {
          return toolErrorFuente(
            `Valores APV ${anio_desde}-${anio_hasta} cuadro ${cuadro}`,
            "https://www.cmfchile.cl/institucional/estadisticas/valores_apv_enero2010.php",
          );
        }
        let xlsBase64: string | undefined;
        if (exportar) {
          const qs = new URLSearchParams();
          for (const [k, v] of Object.entries(params)) {
            if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
            else qs.set(k, String(v));
          }
          const bytes = await getLegacyBinario(`/institucional/estadisticas/exportacion_excel_cuadros.php?${qs}`, {}, env);
          if (bytes.length > 5000) xlsBase64 = bytesABase64(bytes);
        }
        return toolOkTabla({
          titulo: `Valores APV cuadro ${cuadro} ${anio_desde}-${anio_hasta}`,
          vacio: `Sin información para el cuadro ${cuadro} en el período (la CMF no tiene datos para la combinación pedida).`,
          base: { anio_desde, anio_hasta, cuadro, ...(xlsBase64 ? { xls_base64: xlsBase64 } : {}) },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_apv",
        });
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
        "Devuelve la información de tomas de control de emisores de valores publicada por la CMF (operación, fechas y sociedades involucradas), con hasta 300 filas. Elija el criterio de ordenamiento del listado con orden (1-5, default 1). Use esta tool para cambios de control accionario; para la composición accionaria actual use cmf_empresa_accionistas. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ orden: enteroSchema().min(1).max(5).optional().describe("Criterio de ordenamiento del listado (1-5, default 1)"), ...paginacion(300) }),
    },
    async ({ orden, offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/mercados/tomas_detalle.php", { tipo: "TDC", orden: orden ?? 1 }, env);
        const filas = htmlTablaAJson(html);
        return toolOkTabla({
          titulo: `Tomas de control`,
          vacio: "Sin tomas de control.",
          base: {  },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_tomas_control",
        });
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
        "Devuelve los listados de empresas que presentan EEFF bajo IFRS: listado general, Circular 556 u oficios 457/485. Elija tipo_listado=general (default), c556, ofc457 u ofc485. Use esta tool para verificar obligaciones de reporte IFRS de empresas; para los EEFF mismos use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        tipo_listado: z.enum(["general", "c556", "ofc457", "ofc485"]).default("general").describe("Listado: general (default), c556=Circular 556, ofc457/ofc485=respuestas a oficios"), ...paginacion(300) }),
    },
    async ({ tipo_listado, offset, limit }) => {
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
        return toolOkTabla({
          titulo: `Listado EEFF IFRS ${tipo_listado}`,
          vacio: "Sin listado.",
          base: { tipo_listado },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_listados_eeff_ifrs",
        });
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
        "Devuelve el calendario de fechas de divulgación de estados financieros de los emisores para un año. Fije anio en AAAA (ej: 2026). Use esta tool para anticipar la publicación de resultados; para los EEFF ya publicados use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ anio: anioSchema, ...paginacion(300) }),
    },
    async ({ anio, offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/mercados/novedades_envio_fechas_eeff.php", { aaaa: anio }, env);
        const filas = htmlTablaAJson(html);
        return toolOkTabla({
          titulo: `Fechas divulgación EEFF ${anio}`,
          vacio: `Sin fechas para ${anio}.`,
          base: { anio },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_fechas_divulgacion_eeff",
        });
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
        "Devuelve los estados financieros IFRS de intermediarios de valores (corredores de bolsa y agentes de valores) para un rango de períodos, en miles de pesos. Cada fila es una cuenta (con su código, ej. 11.01.00 Efectivo) y cada columna un intermediario en un período (la lista entidades trae esas columnas). Seleccione tipo (0 = todos, 1 = corredores, 2 = agentes; default 0), sociedades por RUT sin DV (array; default ['0']=todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12; solo 03, 06, 09 y 12). Use esta tool para EEFF de intermediarios; para sociedades anónimas use cmf_eeff_ifrs_sa. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        tipo: z.enum(["0", "1", "2"]).default("0").describe("0 = todos, 1 = corredores de bolsa, 2 = agentes de valores"),
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        anio1: anioSchema,
        anio2: anioSchema.describe("Año final del rango en AAAA (ej: 2025)"),
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional().describe("Mes final del rango en MM (default 12)"), ...paginacion(300) }),
    },
    async ({ tipo, sociedades, anio1, anio2, mes1, mes2, offset, limit }) => {
      try {
        return await toolDeGrid(
          {
            que: "EEFF IFRS intermediarios",
            indice: "/institucional/estadisticas/merc_valores/intermediarios_fecu_ifrs/intermediarios_ifrs_index.php",
            cuerpo: {
              tiposociedad: tipo,
              "sociedad[]": sociedades,
              estimado: "2",
              cuenta: "",
              ag: "",
              anno1: anio1,
              anno2: anio2,
              mes1: mes1 ?? "12",
              mes2: mes2 ?? "12",
              xls: "n",
            },
            titulo: `EEFF IFRS intermediarios ${anio1}-${mes1 ?? "12"} → ${anio2}-${mes2 ?? "12"}`,
            vacio: "Sin resultados de intermediarios para ese rango.",
            base: { tipo, sociedades, anio1, anio2 },
            offset,
            limit,
            tool: "cmf_intermediarios_eeff_ifrs",
          },
          env,
        );
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
        "Devuelve los indicadores financieros IFRS de intermediarios de valores (corredores de bolsa y agentes de valores) para un rango de períodos. Cada fila es un intermediario en un período, con un campo por indicador (rentabilidad sobre el patrimonio, comisiones sobre resultado, resultado por intermediación) y los saldos con que se calculan. Seleccione tipo (0 = todos, 1 = corredores, 2 = agentes; default 0), sociedades por RUT sin DV (array; default ['0']=todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12; solo 03, 06, 09 y 12). Use esta tool para ratios de intermediarios; para sus EEFF use cmf_intermediarios_eeff_ifrs. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        tipo: z.enum(["0", "1", "2"]).default("0").describe("0 = todos, 1 = corredores de bolsa, 2 = agentes de valores"),
        sociedades: z.array(z.string()).default(["0"]).describe("RUTs de sociedades sin DV (['0'] = todas)"),
        anio1: anioSchema,
        anio2: anioSchema.describe("Año final del rango en AAAA (ej: 2025)"),
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional().describe("Mes final del rango en MM (default 12)"), ...paginacion(300) }),
    },
    async ({ tipo, sociedades, anio1, anio2, mes1, mes2, offset, limit }) => {
      try {
        return await toolDeGrid(
          {
            que: "Indicadores IFRS intermediarios",
            indice: "/institucional/estadisticas/merc_valores/intermediarios_indicadores_ifrs/intermediarios_indicadoresfinancieros_index.php",
            cuerpo: {
              tiposociedad: tipo,
              "sociedad[]": sociedades,
              estimado: "4",
              dia1: "0",
              dia2: "0",
              cuenta: "",
              ag: "",
              anno1: anio1,
              anno2: anio2,
              mes1: mes1 ?? "12",
              mes2: mes2 ?? "12",
              xls: "n",
            },
            porEntidad: true,
            titulo: `Indicadores IFRS intermediarios ${anio1}-${mes1 ?? "12"} → ${anio2}-${mes2 ?? "12"}`,
            vacio: "Sin indicadores de intermediarios para ese rango.",
            base: { tipo, sociedades, anio1, anio2 },
            offset,
            limit,
            tool: "cmf_intermediarios_indicadores_ifrs",
          },
          env,
        );
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
        "Devuelve los cuadros de resultados de agentes de valores y corredores de bolsa (tipo=av_cb, norma IFRS) o de emisores bajo norma NCH (tipo=emisores_nch), para un período. Fije anio en AAAA y mes en MM (03/06/09/12 para IFRS; 12 para NCH); la respuesta trae la tabla de corredores y la de agentes. Use esta tool para estados de resultados agregados del mercado; para EEFF de un emisor individual use cmf_empresa_eeff o cmf_empresa_eeff_nch. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        tipo: z.enum(["av_cb", "emisores_nch"]).default("av_cb").describe("av_cb=agentes/corredores IFRS (default), emisores_nch=emisores bajo NCH"),
        anio: anioSchema.optional().describe("Año del período en AAAA (default 2025)"),
        mes: mesCorteSchema.optional().describe("Mes de corte (03/06/09/12; default 12)"), ...paginacion(300) }),
    },
    async ({ tipo, anio, mes, offset, limit }) => {
      try {
        const aa = anio ?? "2025";
        const mm = mes ?? (tipo === "av_cb" ? "12" : "12");
        const path =
          tipo === "av_cb"
            ? "/institucional/estadisticas/valores_agentes_cuadro2_ifrs.php"
            : "/institucional/estadisticas/valores_agentes_cuadro2.php";
        const html = await postLegacy(
          path,
          { mm, aa, norma: tipo === "av_cb" ? "IFRS" : "NCH", enviar: "Buscar" },
          env,
        );
        const filas: Record<string, unknown>[] = [];
        for (const id of ["tabla_corredores", "tabla_agentes"]) {
          const m = html.match(new RegExp(`<table[^>]*id="${id}"[\\s\\S]*?<\\/table>`, "i"));
          if (m) {
            filas.push(...htmlTablaAJson(m[0]).map((f) => ({ ...f, tabla: id.replace("tabla_", "") })));
          }
        }
        if (filas.length === 0) {
          return toolErrorFuente(
            `Cuadros de resultados ${tipo} ${aa}-${mm}`,
            "https://www.cmfchile.cl/institucional/estadisticas/valores_agentes_cuadro.php",
          );
        }
        // La unidad está en el párrafo de arriba de las tablas («Miles de $»).
        const unidad = /Miles de \$/.test(html) ? ["Cifras en miles de pesos"] : [];
        return toolOkTabla({
          titulo: `Cuadro ${tipo} ${aa}-${mm}, tablas corredores y agentes`,
          vacio: "Sin resultados.",
          base: { tipo, anio: aa, mes: mm },
          campo: "filas",
          filas,
          notas: unidad,
          offset,
          limit,
          tool: "cmf_resultados_av_cb",
        });
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
        "Devuelve los índices diarios de liquidez y solvencia de los intermediarios de valores, con una fila por intermediario y día. Filtre por intermediario (TODOS, COBOL = todos los corredores de bolsa, AGVAL = todos los agentes de valores, o el código de uno; default TODOS) y por rango desde/hasta en YYYY-MM-DD con a lo más 31 días de diferencia entre los 2 (o sea hasta 32 días de datos), que es el tope del formulario de la CMF (default: los últimos 7 días, contados en hora de Chile). Use esta tool para monitorear la salud financiera de intermediarios; para sus EEFF use cmf_intermediarios_eeff_ifrs. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        intermediario: z.string().default("TODOS").describe("TODOS, COBOL (corredores), AGVAL (agentes) o el código de un intermediario"),
        desde: fechaSchema.optional().describe("Inicio del rango en YYYY-MM-DD (default: hace 7 días)"),
        hasta: fechaSchema.optional().describe("Fin del rango en YYYY-MM-DD (default: hoy; a lo más 31 días desde el inicio)"), ...paginacion(300) }),
    },
    async ({ intermediario, desde, hasta, offset, limit }) => {
      try {
        // El formulario de la CMF no usa las fechas sueltas. su JavaScript
        // arma rango_fechas con cada día del rango como AAAAMMDD% pegado, y
        // rechaza rangos de más de 31 días. Acá se hace lo mismo.
        // «Hoy» es el de Chile, no el de UTC. a las 22:30 de Santiago el UTC
        // ya va en mañana y la CMF no tiene ese día.
        const hoyChile = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
        const fin = new Date(`${hasta ?? hoyChile}T12:00:00Z`);
        const inicio = desde ? new Date(`${desde}T12:00:00Z`) : new Date(fin.getTime() - 6 * 86_400_000);
        const rango = rangoFechasLiquidez(inicio, fin);
        if ("error" in rango) return toolError(rango.error);
        const f1 = fechaLegacy(inicio.toISOString().slice(0, 10));
        const f2 = fechaLegacy(fin.toISOString().slice(0, 10));
        const html = await getLegacy(
          "/institucional/mercados/liquidez.php",
          {
            sel_inter: intermediario,
            rango_fechas: rango.rango,
            dd_ini: f1.dd,
            mm_ini: f1.mm,
            aaaa_ini: f1.aa,
            dd_fin: f2.dd,
            mm_fin: f2.mm,
            aaaa_fin: f2.aa,
            consulta: "1",
          },
          env,
        );
        const filas = filasDeLiquidez(html);
        return toolOkTabla({
          titulo: `Índices liquidez/solvencia ${intermediario} ${inicio.toISOString().slice(0, 10)} → ${fin.toISOString().slice(0, 10)}`,
          vacio: "Sin índices para ese intermediario y ese rango.",
          base: { intermediario, desde: inicio.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_liquidez_intermediarios",
        });
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
        "Devuelve el reporte mensual de préstamos otorgados en el mercado de valores publicado por la CMF (XLS oficial), con detalle por entidad y hasta 300 filas. Fije anio (2016-2026) y mes (01-12), ambos opcionales (default año y mes actuales); si el mes no tiene reporte, la CMF devuelve solo el título y la tool lo indica. Use esta tool para estadísticas de préstamos del mercado; para reportes de la banca use cmf_bancos_reportes. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        anio: anioSchema.optional().describe("Año del reporte en AAAA (2016-2026; default año actual)"),
        mes: mesSchema.optional().describe("Mes del reporte en MM (default mes actual)"), ...paginacion(300) }),
    },
    async ({ anio, mes, offset, limit }) => {
      try {
        const ahora = new Date();
        const aa = anio ?? String(ahora.getFullYear());
        const mm = mes ?? String(ahora.getMonth() + 1).padStart(2, "0");
        const bytes = await postLegacyBinario(
          "/institucional/estadisticas/informe_prestamos.php",
          { id_mes: mm, id_anio: aa },
          env,
        );
        const crudas = xlsAJson(bytes) as Record<string, string>[];
        if (crudas.length === 0) {
          return toolOk(
            `La CMF no publicó reporte de préstamos para ${aa}-${mm} (meses sin reporte devuelven solo el título).`,
            { anio: aa, mes: mm, filas: [] },
          );
        }
        // La planilla trae una cabecera de 3 pisos («Número de» / «Prestamos»
        // / «(1)») que el lector de XLS entrega como 2 filas de datos. Los
        // pisos se pegan al nombre de la columna y esas filas dejan de contar.
        const { datos, totales } = separarTotales(unirCabeceraPartida(crudas, "ASEGURADORA"));
        return toolOkTabla({
          titulo: `Préstamos otorgados por compañías de seguros ${aa}-${mm}`,
          vacio: "Sin resultados.",
          base: { anio: aa, mes: mm },
          campo: "filas",
          filas: datos,
          totales,
          offset,
          limit,
          tool: "cmf_prestamos_otorgados",
        });
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
        "Lista los actos administrativos y resoluciones publicados por la CMF (tabla de publicidad de actos según Ley 19.880, art. 45 y siguientes): tipo de acto, denominación, número, fecha de publicación, medio de comunicación, efectos generales o particulares y vínculo al documento. Fije el rango con desde/hasta opcionales en YYYY-MM-DD (default 2000-01-01 al año actual; solo se usa el año de cada fecha); la tool consulta los últimos 5 años del rango. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas. Use esta tool para resoluciones generales publicadas; para sanciones a un emisor específico use cmf_empresa_sanciones y para resoluciones del mercado cmf_resoluciones_globales.",
      inputSchema: z.object({
        desde: fechaSchema.optional(),
        hasta: fechaSchema.optional(),
        ...paginacion(300),
      }),
    },
    async ({ desde, hasta, offset, limit }) => {
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
        // Antes esto era `todas.slice(0, 300)` y devolvia un toolOk sin
        // paginacion, o sea un techo duro sin ninguna forma de pedir el
        // resto. Ahora 300 es solo el valor por defecto del limit.
        return toolOkTabla({
          titulo: `Actos y resoluciones publicados, años ${anios.slice(-5).join("/")}`,
          vacio: "Sin actos publicados en el rango.",
          base: {},
          campo: "filas",
          filas: todas,
          offset,
          limit,
          tool: "cmf_dictamenes",
        });
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
        "Devuelve las sanciones cursadas del mes en curso y la portada de sanciones (la CMF entrega la portada completa, sin filtro por mercado). Use esta tool para las sanciones más recientes; para rangos históricos use cmf_sanciones_globales; para las de un emisor use cmf_empresa_sanciones. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ ...paginacion(300) }),
    },
    async ({ offset, limit }) => {
      try {
        const html = await getLegacy("/institucional/sanciones/sanciones_cursadas_mes.php", {}, env);
        const filas = htmlTablaAJson(html);
        return toolOkTabla({
          titulo: `Sanciones cursadas`,
          vacio: "Sin sanciones cursadas.",
          base: {  },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_sanciones_cursadas",
        });
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
        "Devuelve las resoluciones cursadas recientes (historico=false, default) o el listado completo de meses anteriores (historico=true, respuesta grande). Use esta tool para resoluciones recientes de la CMF; para resoluciones filtradas por mercado use cmf_resoluciones_globales. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ historico: z.boolean().default(false).describe("true = listado histórico completo (grande)"), ...paginacion(300) }),
    },
    async ({ historico, offset, limit }) => {
      try {
        const path = historico
          ? "/institucional/resoluciones/resoluciones_cursadas_meses_anteriores.php"
          : "/institucional/resoluciones/resoluciones_cursadas.php";
        const html = await getLegacy(path, {}, env);
        const filas = htmlTablaAJson(html);
        return toolOkTabla({
          titulo: `Resoluciones cursadas`,
          vacio: "Sin resoluciones.",
          base: { historico },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_resoluciones_cursadas",
        });
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
        "Devuelve el catálogo completo de entidades supervisadas de la CMF filtrable por nombre (parcial), tipo de entidad (descripción o código como RVEMI/FMT/FIP) y estado (VI=vigentes, NV=no vigentes), con paginación offset/limit, sin máximo. El catálogo se cachea 24h en KV; la primera carga sin caché puede exceder el límite de CPU del plan free de Workers. Use esta tool para búsquedas masivas o filtradas; para una entidad puntual use cmf_buscar_entidad. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
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
      }).passthrough(),
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
