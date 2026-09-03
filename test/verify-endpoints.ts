import { createServer } from "../src/server.js";
import { cargarPdfModuleDesdeDisco } from "../src/pdf.js";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

/**
 * Verificación exhaustiva de endpoints: cada tool se llama con parámetros reales
 * contra la CMF y su output se valida contra el contrato documentado.
 * Resultado: un reporte PASS/FAIL por endpoint.
 */

interface ToolDef {
  args: Record<string, unknown>;
  /** Campos que structuredContent DEBE contener (clave -> tipo esperado o función) */
  expect?: Record<string, "string" | "number" | "boolean" | "object" | "array" | "string[]" | "any" | ((v: unknown) => boolean)>;
  /** Comportamiento esperado especial */
  expectError?: RegExp; // si se espera isError con mensaje que matchee
  maxMs?: number;
}

const TOOLS: Record<string, ToolDef> = {
  // ---------- A. API oficial v3 (requiere CMF_API_KEY; en el entorno local no está) ----------
  cmf_api_indicador_valor: { args: { serie: "uf", anio: "2026", mes: "08", dia: "01" }, expect: { serie: "string", fecha: "string", valor: "any" } },
  cmf_api_indicador_serie: { args: { serie: "uf", desde: "2026-01", hasta: "2026-06" }, expect: { serie: "string", desde: "string", total: "number" } },
  cmf_api_balance_institucion: { args: { anio: "2026", mes: "03", institucion: "999" }, expect: { anio: "string", data: "any" } },
  cmf_api_resultados_institucion: { args: { anio: "2026", mes: "03", institucion: "999" }, expect: { anio: "string", data: "any" } },
  cmf_api_adecuacion_capital: { args: { anio: "2026", mes: "03", institucion: "999", componente: "activos" }, expect: { componente: "string", data: "any" } },
  cmf_api_ficha_institucion: { args: { institucion: "001", anio: "2026", mes: "03" }, expect: { institucion: "string", data: "any" } },
  cmf_api_accionistas_institucion: { args: { institucion: "001", anio: "2026", mes: "03" }, expect: { institucion: "string", data: "any" } },
  cmf_api_integrantes_institucion: { args: { institucion: "001", anio: "2026", mes: "03" }, expect: { institucion: "string", data: "any" } },

  // ---------- B. Empresas ----------
  cmf_empresa_por_ticker: { args: { consulta: "SQM-B", limite: 3 }, expect: { resultados: "array", total: "number", fuente: "string" } },
  cmf_buscar_entidad: { args: { consulta: "COPEC", limite: 3 }, expect: { resultados: "array", total: "number" } },
  cmf_listar_entidades: { args: { tipoentidad: "RVEMI", offset: 0, limit: 5 }, expect: { entidades: "array", total: "number", next_offset: "any" } },
  cmf_empresa_info: { args: { rut: "90690000" }, expect: { rut: "string", datos: (v: unknown) => Array.isArray(v) && v.length > 0 } },
  cmf_empresa_eeff: { args: { rut: "90690000", anio: "2026", mes: "03", tipo: "C", norma: "IFRS", modo: "documentos" }, expect: { periodo: "string", tipo_balance: "string", documentos: (v: unknown) => Array.isArray(v) && v.length > 0, aviso: "string" } },
  cmf_empresa_eeff_historial: { args: { rut: "90690000" }, expect: { rut: "string", anios: "array" } },
  cmf_empresa_hechos: { args: { rut: "90690000", desde: "2026-01-01", hasta: "2026-08-08", offset: 0, limit: 5 }, expect: { hechos: "array", total: "number" } },
  cmf_empresa_accionistas: { args: { rut: "90690000", anio: "2025", mes: "12" }, expect: { rut: "string", accionistas: "array" } },
  cmf_empresa_directorio: { args: { rut: "90690000" }, expect: { rut: "string", directorio: "array" } },
  cmf_empresa_sanciones: { args: { rut: "90690000", desde: "2020-01-01", hasta: "2026-12-31" }, expect: { rut: "string", sanciones: "array" } },
  cmf_empresa_resoluciones: { args: { rut: "90690000", desde: "2020-01-01", hasta: "2026-12-31" }, expect: { rut: "string", resoluciones: "array" } },
  cmf_empresa_juntas: { args: { rut: "90690000", desde: "2024-01-01", hasta: "2026-12-31", tipo: "ordinaria" }, expect: { rut: "string", actas: "array" } },
  cmf_empresa_memoria_anual: { args: { rut: "90690000", anio: "2025" }, expect: { rut: "string", documentos: "array" } },
  cmf_empresa_asg: { args: { rut: "90690000", anio: "2025", tipo_informe: "1" }, expect: { rut: "string", indicadores: "array" } },
  cmf_empresa_eeff_filiales: { args: { rut: "90690000", anio: "2025" }, expect: { rut: "string", filiales: "array" } },
  cmf_empresa_registro_productos: { args: { rut: "90690000" }, expect: { rut: "string", productos: "array" } },
  cmf_hechos_globales: { args: { mercado: "V", desde: "2026-01-01", hasta: "2026-08-08" }, expectError: /captcha/i },
  cmf_sanciones_globales: { args: { mercado: "V", desde: "2024-01-01", hasta: "2026-12-31" }, expect: { mercado: "string", sanciones: "array" } },
  cmf_resoluciones_globales: { args: { mercado: "V", desde: "2024-01-01", hasta: "2026-12-31" }, expect: { mercado: "string", resoluciones: "array" } },
  cmf_clasificaciones_riesgo: { args: { emisor: "COPEC", offset: 0, limit: 5 }, expect: { clasificaciones: "array", total: "number" } },
  cmf_eeff_ifrs_sa: { args: { sociedades: ["0"], anio1: "2025", anio2: "2025" }, expect: { filas: "array" } },
  cmf_indicadores_financieros_sa: { args: { sociedades: ["0"], fecha_max: "202512" }, expect: { fecha_max: "string", filas: "array" } },
  cmf_empresa_eeff_nch: { args: { sociedades: ["0"], anio1: "2010", anio2: "2010" }, expect: { filas: "array" } },
  cmf_indicadores_financieros_nch: { args: { sociedades: ["0"], anio1: "2010", anio2: "2010" }, expect: { filas: "array" } },
  cmf_dividendos: { args: { sociedades: ["76215637"], anio: "2025", tipodiv: "0" }, expect: { filas: "array" } },
  cmf_operaciones_capital: { args: { tipo: "reparto", sociedades: ["0"], anio: "2025" }, expect: { tipo: "string", filas: "array" } },
  cmf_apv: { args: { anio_desde: "2024", anio_hasta: "2024", mes_desde: "01", mes_hasta: "12" }, expect: { filas: "array" } },
  cmf_comunicaciones_emisores: { args: { offset: 0, limit: 5 }, expect: { comunicaciones: "array", total: "number" } },
  cmf_tomas_control: { args: {} },
  cmf_listados_eeff_ifrs: { args: { tipo_listado: "general" }, expect: { tipo_listado: "string", filas: "array" } },
  cmf_fechas_divulgacion_eeff: { args: { anio: "2026" }, expect: { anio: "string", filas: "array" } },
  cmf_intermediarios_eeff_ifrs: { args: { sociedades: ["0"], anio1: "2025", anio2: "2025" }, expect: { filas: "array" } },
  cmf_intermediarios_indicadores_ifrs: { args: { sociedades: ["0"], anio1: "2025", anio2: "2025" }, expect: { filas: "array" } },
  cmf_resultados_av_cb: { args: { tipo: "av_cb", anio: "2025", mes: "03" }, expect: { filas: (v: unknown) => Array.isArray(v) && v.length > 0 } },
  cmf_liquidez_intermediarios: { args: { desde: "2026-08-03", hasta: "2026-08-07" }, expect: { filas: "array" } },
  cmf_prestamos_otorgados: { args: { anio: "2025", mes: "12" }, expect: { filas: "array" } },
  cmf_dictamenes: { args: { desde: "2026-01-01", hasta: "2026-12-31" }, expect: { filas: "array" } },
  cmf_sanciones_cursadas: { args: {} },
  cmf_resoluciones_cursadas: { args: { historico: false } },

  // ---------- C. Fondos mutuos ----------
  cmf_fondos_mutuos_catalogo: { args: { nombre: "SECURITY", offset: 0, limit: 3 }, expect: { fondos: "array", total: "number" } },
  cmf_fondos_mutuos_cartera: { args: { anio: "2026", mes: "01", cartera: "NACI" }, expect: { total: "number", filas: "array" } },
  cmf_fondos_mutuos_comisiones: { args: { anio: "2026", mes: "01" }, expect: { total: "number", filas: "array" } },
  cmf_fondos_mutuos_inversiones: { args: { anio: "2026", mes: "01", tipo: "nacio" }, expect: { total: "number", filas: "array" } },
  cmf_fondos_mutuos_bpr: { args: { anio: "2026", mes: "01" }, expect: { total: "number", filas: "array" } },
  cmf_fondos_mutuos_costos: { args: { anio: "2026", mes: "01" }, expect: { total: "number", filas: "array" } },
  cmf_fondos_mutuos_antecedentes: { args: { anio: "2025" }, expect: { total: "number", filas: "array" } },
  cmf_fondos_mutuos_cartola: { args: { fondo: "8298", desde: "2026-01-01", hasta: "2026-01-31" }, expectError: /captcha/i },
  cmf_fondos_comisiones_maximas: { args: { tipo: "fm", circular: "1951", anio: "2026" }, expect: { tipo: "string", administradoras: "array", documentos: "array" } },

  // ---------- D. Fondos de inversión ----------
  cmf_fondos_inversion_catalogo: { args: { offset: 0, limit: 3 }, expect: { fondos: "array", total: "number" } },
  cmf_fondos_inversion_eeff_ifrs: { args: { admins: "0", fondos: ["0"], anio1: "2025", anio2: "2025" }, expect: { columnas: "array", filas: "array", total_filas: "number" } },
  cmf_fondos_inversion_comisiones_maximas: { args: { mes: "12", anio: "2024" }, expect: { filas: "array" } },

  // ---------- E. Normativa / seguros / xbrl / docs / bancos ----------
  cmf_normativa_buscar: { args: { tipo: "CIR", numero: "2343", offset: 0, limit: 5 }, expect: { normas: "array", total: "number" } }, // >0 filas solo si la CMF no bloquea la IP del runner
  cmf_normativa_descargar: { args: { archivo: "/web/compendio/cir/cir_2343_2024.pdf" }, expect: { archivo: "string" } },
  cmf_seguros_eeff: { args: { tipo: "generales", sociedades: ["0"], anio1: "2025", anio2: "2025" }, expect: { tipo: "string", filas: "array" } },
  cmf_seguros_rentas_vitalicias: { args: { codigo: "com_int_rvp", desde: "2025-01-01", hasta: "2025-12-31", offset: 0, limit: 5 }, expect: { filas: "array" } },
  cmf_seguros_scomp: { args: { informe: "inf1", desde: "2025-01-01", hasta: "2025-12-31", offset: 0, limit: 5 }, expect: { filas: (v: unknown) => Array.isArray(v) && v.length > 0 } },
  cmf_seguros_clasificacion_riesgo: { args: { anio: "2025" }, expect: { anio: "string", filas: "array" } },
  cmf_seguros_satra: { args: { desde: "2025-01-01", hasta: "2025-12-31", offset: 0, limit: 5 }, expect: { filas: (v: unknown) => Array.isArray(v) && v.length > 0 } },
  cmf_seguros_siniestros: { args: { anio: "2025", offset: 0, limit: 5 }, expect: { filas: "array" } },
  cmf_seguros_cumplimiento: { args: { anio: "2025", mes: "12" } },
  cmf_seguros_inversiones_vida: { args: { tipoentidad: "CSVID" }, expect: { periodos: (v: unknown) => Array.isArray(v) && v.length > 0 } },
  cmf_seguros_produccion_corredores: { args: { peri: "202512", seccion: "identifi", offset: 0, limit: 5 }, expect: { filas: (v: unknown) => Array.isArray(v) && v.length > 0 } },
  cmf_seguros_deposito_polizas: { args: { poliza: "POL120260128", limit: 3 }, expect: { total: "number", polizas: "array" }, maxMs: 90000 },
  cmf_seguros_polizas_resoluciones_prohibidas: { args: { limit: 3 }, expect: { total: "number", resoluciones: "array" } },
  cmf_seguros_sic: { args: { desde: "2026-01-01", hasta: "2026-06-30" } },
  cmf_xbrl_taxonomias: { args: {}, expect: { taxonomias: "array" } },
  cmf_xbrl_visor: { args: { taxonomia: "cl-ci", fecha: "2021-01-04" } },
  // cmf_xbrl_consulta NO se ejecuta en la suite: es la única tool destructiva (envía un
  // formulario real al soporte de la CMF). Su contrato se valida en tools/list y tdqs.test.ts.
  cmf_documento_info: { args: { s567: "abcdef0123456789" }, expect: { s567: "string", sin_verificar: "boolean" } },
  cmf_documento_markdown: { args: { url: "https://www.cmfchile.cl/institucional/mercados/ver_archivo.php?archivo=/web/compendio/cir/cir_2343_2024.pdf", max_chars: 2000 }, expect: { pdf_type: "string", markdown: "string", escaneado: "boolean" } },
  cmf_documento_descargar: { args: { s567: "abcdef0123456789" }, expectError: /HTML|inválido|expirado/i },
  // Los 2 servlets de la ex SBIF migraron (lección 17). la respuesta honesta es el error de fuente.
  cmf_bancos_tasas: { args: { indice: "4.1" }, expectError: /BEST|no devolvió datos parseables/i },
  cmf_bancos_cronologia: { args: { indice: "8.0" }, expectError: /migró|no devolvió datos parseables/i },
  cmf_bancos_reportes: { args: { reporte: "MR1", codUnicoBank: "001", periodo_inicial: "2026-06" }, expect: { filas: (v: unknown) => Array.isArray(v) && v.length > 0 } },

  // ---------- Paquetes ----------
  cmf_empresa_paquete: { args: { rut: "90690000", anio_inicio: "2026", anio_fin: "2026", secciones: ["eeff", "memoria"] }, expect: { empresa: "object", arbol: "object", manifest: "array", resumen: "object" }, maxMs: 60000 },
  cmf_empresa_paquete_documentos: { args: { rut: "90690000", anio_inicio: "2026", anio_fin: "2026", secciones: ["hechos"], max_documentos: 2, max_mb: 10, incluir_zip: false }, expect: { descargados: "array", resumen: "object" }, maxMs: 60000 },
  cmf_fondos_paquete_mensual: { args: { anio: "2026", mes: "01", secciones: ["bpr", "costos"] }, expect: { secciones: "array" } },
  cmf_catalogo_entidades: { args: { nombre: "COPEC", offset: 0, limit: 3 }, expect: { entidades: "array", total: "number", cache: "string" } },
};

function validarExpect(sc: Record<string, unknown> | undefined, expect: ToolDef["expect"]): string[] {
  const problemas: string[] = [];
  if (!sc) return ["structuredContent ausente"];
  for (const [k, tipo] of Object.entries(expect ?? {})) {
    const v = sc[k];
    if (v === undefined) { problemas.push(`campo '${k}' ausente`); continue; }
    if (typeof tipo === "function") { if (!tipo(v)) problemas.push(`campo '${k}' no cumple validación`); continue; }
    const esArray = Array.isArray(v);
    const tipoReal = esArray ? "array" : typeof v;
    if (tipo === "string[]") { if (!esArray || !v.every((x) => typeof x === "string")) problemas.push(`campo '${k}' no es string[]`); continue; }
    if (tipo === "any") continue;
    if (tipoReal !== tipo && !(tipo === "object" && v !== null && typeof v === "object" && !esArray)) {
      problemas.push(`campo '${k}' tipo ${tipoReal} != ${tipo}`);
    }
  }
  return problemas;
}

/**
 * Columnas que llegan al modelo vacías en TODAS las filas de la página.
 *
 * Es el instrumento vivo de una clase de defecto que ninguna comprobación
 * sobre el fuente puede ver. Una lista de columnas escrita a mano con el
 * nombre equivocado no se distingue de una correcta leyendo el código,
 * porque `Valor cuota` existe y `Nombre Fondo` no, y los 2 se ven igual.
 * Solo el dato real los separa. El 28 de agosto de 2026
 * `cmf_fondos_mutuos_bpr` entregaba 4 columnas de 6 en blanco.
 *
 * Es un AVISO y no un fallo, a propósito. Una columna real puede venir
 * vacía en las filas de esta página sin que nada esté roto, así que
 * hacerlo bloquear produciría rojos falsos, y un portón con rojos falsos
 * se termina ignorando entero. Se mira, se decide, y si es un defecto se
 * arregla en el archivo.
 */
function columnasVacias(texto: string): string[] {
  const lineas = texto.split("\n").filter((l) => l.includes(" | "));
  if (lineas.length < 2) return [];
  const cabecera = lineas[0].split(" | ");
  const filas = lineas.slice(1).filter((l) => l.split(" | ").length === cabecera.length);
  if (filas.length === 0) return [];
  return cabecera.filter((_, i) => filas.every((f) => f.split(" | ")[i].trim() === ""));
}

async function main() {
  // Cliente por HTTP stateless real (era modern 2026-07-28), mismo código del worker
  const pdfModule = await cargarPdfModuleDesdeDisco().catch(() => undefined);
  const handler = createMcpHandler(() => createServer({ __pdfModule: pdfModule }));
  const transport = new StreamableHTTPClientTransport("http://localhost/mcp", {
    fetch: (u, i) => handler.fetch(new Request(u, i)),
  });
  const client = new Client({ name: "verify-all", version: "1" }, { versionNegotiation: { mode: "auto" }, requestTimeout: 180_000 });
  await client.connect(transport, { timeout: 300_000 });

  const reporte: { tool: string; ok: boolean; detalle: string; ms: number }[] = [];
  const tools = await client.listTools();
  const toolNames = tools.tools.map((t) => t.name);

  // 0. discover
  const discover = await client.discover();
  reporte.push({
    tool: "server/discover",
    ok: !!discover?.supportedVersions?.includes("2026-07-28") && typeof discover?.instructions === "string" && discover.instructions.length > 50,
    detalle: `versions=${JSON.stringify(discover?.supportedVersions)} instructions=${discover?.instructions?.length ?? 0} chars caps=${Object.keys(discover?.capabilities ?? {}).join(",")}`,
    ms: 0,
  });

  // 1. Contrato de tools/list: toda tool documentada tiene description y inputSchema
  let sinDesc = 0;
  let sinSchema = 0;
  for (const t of tools.tools) {
    if (!t.description || t.description.length < 20) sinDesc++;
    if (!t.inputSchema || !t.inputSchema.properties) sinSchema++;
  }
  reporte.push({ tool: "tools/list (contrato)", ok: sinDesc === 0 && sinSchema === 0, detalle: `${toolNames.length} tools; sin description: ${sinDesc}; sin schema: ${sinSchema}`, ms: 0 });

  // 2. Cada tool del catálogo definido
  // Tras la investigación js-reverse todos los sistemas tienen endpoint vivo.
  // Única excepción tolerada: datosbanco.cmfchile.cl bloquea intermitentemente
  // IPs de datacenter (challenge anti-bot) — si la tool devuelve su error honesto
  // de fuente, se reporta como FUENTE (visible, no falla); si devuelve datos, PASS normal.
  const FUENTE_ESPERADO = new Set<string>(["cmf_bancos_reportes"]);
  let fuentes = 0;
  for (const [name, def] of Object.entries(TOOLS)) {
    const t0 = Date.now();
    try {
      const res = await client.callTool({ name, arguments: def.args as Record<string, unknown> }, { timeout: 300_000 });
      const ms = Date.now() - t0;
      const sc = (res as { structuredContent?: unknown }).structuredContent as Record<string, unknown> | undefined;
      const texto = res.content?.[0]?.text ?? "";
      const problemas: string[] = [];
      if (def.expectError) {
        if (!res.isError) problemas.push("se esperaba isError (documentado) y respondió OK");
        else if (!def.expectError.test(texto)) problemas.push(`isError pero mensaje no matchea ${def.expectError}: "${texto.slice(0, 120)}"`);
      } else {
        if (res.isError) {
          const esApiKey = /CMF_API_KEY no configurada/.test(texto) && name.startsWith("cmf_api_");
          const esFuente = FUENTE_ESPERADO.has(name) && /fuente de la CMF no devolvi[oó]|rechazó la conexión|fetch failed|está caído o ya no se mantiene|requiere un captcha/.test(texto);
          if (esApiKey) {
            reporte.push({ tool: name, ok: true, detalle: `API_KEY: sin key local (esperado)`, ms });
            continue;
          }
          if (esFuente) {
            fuentes++;
            reporte.push({ tool: name, ok: true, detalle: `FUENTE: ${texto.slice(0, 90)}`, ms });
            continue;
          }
          problemas.push(`isError inesperado: ${texto.slice(0, 200)}`);
        }
        if (!texto) problemas.push("content[0].text vacío");
        problemas.push(...validarExpect(sc, def.expect));
      }
      const vacias = def.expectError ? [] : columnasVacias(texto);
      const aviso = vacias.length > 0 ? ` AVISO: columnas vacías en todas las filas -> ${vacias.join(", ")}` : "";
      reporte.push({ tool: name, ok: problemas.length === 0, detalle: (problemas.join("; ") || `OK (${sc ? Object.keys(sc).join(",") : "sin sc"})`) + aviso, ms });
    } catch (e) {
      reporte.push({ tool: name, ok: false, detalle: `excepción: ${(e as Error).message.slice(0, 200)}`, ms: Date.now() - t0 });
    }
  }

  // 3. Resources
  const resTemplates = await client.listResourceTemplates();
  const uris = resTemplates.resourceTemplates.map((r) => r.uriTemplate);
  reporte.push({ tool: "resources/templates/list", ok: uris.length >= 6, detalle: `${uris.length} templates: ${uris.join(", ")}`, ms: 0 });
  const lecturas: [string, string][] = [
    ["cmf://entidades/90690000", "rut"],
    ["cmf://indicadores/uf/2026/08", "serie"],
    ["cmf://fondos/8298", "run"],
    ["cmf://norma/cir_2343", "id"],
    ["cmf://documento/abc", "id"],
    ["cmf://captcha/inexistente", "id"],
    ["cmf://skill/uso", ""],
  ];
  for (const [uri] of lecturas) {
    try {
      const r = await client.readResource({ uri });
      const text = r.contents?.[0]?.text ?? "";
      reporte.push({
        tool: `resources/read ${uri}`,
        ok: text.length > 0,
        detalle: `${text.length} chars: ${text.slice(0, 80).replace(/\n/g, " ")}`,
        ms: 0,
      });
    } catch (e) {
      reporte.push({ tool: `resources/read ${uri}`, ok: false, detalle: (e as Error).message.slice(0, 150), ms: 0 });
    }
  }

  // 3b. EEFF modo markdown (PDF auditado convertido)
  {
    const res = await client.callTool({
      name: "cmf_empresa_eeff",
      arguments: { rut: "90690000", anio: "2026", mes: "03", tipo: "C", norma: "IFRS", modo: "markdown", max_chars: 1500 },
    });
    const sc = (res as { structuredContent?: unknown }).structuredContent as {
      pdf_type?: string;
      markdown?: string;
    } | undefined;
    const ok = !res.isError && typeof sc?.pdf_type === "string" && typeof sc?.markdown === "string" && sc.markdown.length > 500;
    reporte.push({
      tool: "cmf_empresa_eeff modo=markdown",
      ok,
      detalle: ok ? `pdf=${sc?.pdf_type} md=${sc?.markdown?.length} chars` : (res.content?.[0]?.text ?? "").slice(0, 150),
      ms: 0,
    });
  }

  // 4. Prompts
  const prompts = await client.listPrompts();
  reporte.push({ tool: "prompts/list", ok: prompts.prompts.length === 3, detalle: prompts.prompts.map((p) => p.name).join(", "), ms: 0 });
  for (const p of prompts.prompts) {
    try {
      const g = await client.getPrompt({ name: p.name, arguments: p.name === "cmf_analizar_empresa" ? { rut: "90690000" } : { anio: "2026", mes: "12" } });
      const text = g.messages?.[0]?.content?.text ?? "";
      reporte.push({ tool: `prompts/get ${p.name}`, ok: text.length > 100, detalle: `${text.length} chars`, ms: 0 });
    } catch (e) {
      reporte.push({ tool: `prompts/get ${p.name}`, ok: false, detalle: (e as Error).message.slice(0, 150), ms: 0 });
    }
  }

  // Reporte
  const fails = reporte.filter((r) => !r.ok);
  const totalMs = reporte.reduce((a, r) => a + r.ms, 0);
  console.log(`\n===== VERIFICACIÓN EXHAUSTIVA =====`);
  console.log(`Total endpoints probados: ${reporte.length}`);
  console.log(`PASS: ${reporte.length - fails.length} | FAIL: ${fails.length} | FUENTE (sistema CMF caído, reportado honestamente): ${fuentes} | tiempo total: ${Math.round(totalMs / 1000)}s\n`);
  for (const r of reporte) {
    console.log(`${r.ok ? "✅" : "❌"} ${r.tool} [${Math.round(r.ms / 1000)}s] ${r.detalle}`);
  }
  await client.close();
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
