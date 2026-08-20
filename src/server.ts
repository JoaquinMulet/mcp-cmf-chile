import { McpServer } from "@modelcontextprotocol/server";
import type { CmfEnv } from "./client/cmf-client.js";
import { registrarToolsApi } from "./tools/api-oficial.js";
import { registrarToolsEmpresas } from "./tools/empresas.js";
import { registrarToolsFondosMutuos } from "./tools/fondos-mutuos.js";
import { registrarToolsFondosInversion } from "./tools/fondos-inversion.js";
import { registrarToolsOtros } from "./tools/otros.js";
import { registrarToolsPaquete } from "./tools/paquete.js";
import { registrarResources } from "./resources.js";
import { registrarPrompts } from "./prompts.js";
import { registrarModoCodigo } from "./tools/code-mode.js";
import type { Ejecutor } from "./sandbox.js";

/**
 * Factory per-request: crea un McpServer fresco con todas las tools/resources/prompts.
 * Los caches, rate limiters y cookie jars viven en módulos (singletons), no aquí.
 */
/**
 * Guía que la norma MCP deja poner en `server/discover` para el modelo.
 * En modo código es corta a propósito. el catálogo se descubre con
 * `cmf_buscar`, no se enumera acá.
 */
const INSTRUCCIONES_CODIGO = [
  "Datos públicos de la Comisión para el Mercado Financiero de Chile (CMF).",
  "Este servidor tiene 2 herramientas y se usan siempre en el mismo orden.",
  "1. cmf_buscar. escribe código que filtra el catálogo y devuelve las operaciones que necesitas.",
  "2. cmf_ejecutar. escribe código que llama esas operaciones, filtra el resultado y devuelve solo lo útil.",
  "Las operaciones devuelven su JSON completo, sin recortes. El servidor nunca decide qué parte del dato ves, lo decides tú en el código.",
  "Fechas en formato YYYY-MM-DD. Los RUT se aceptan con o sin dígito verificador.",
  "Si una consulta viene vacía, revisa el período o la norma antes de concluir que el dato no existe.",
].join("\n");

/** Cómo expone el servidor sus operaciones. */
export interface OpcionesServidor {
  /**
   * "clasico" = 86 tools, una por operación. Es el contrato histórico.
   * "codigo" = 2 tools (cmf_buscar, cmf_ejecutar) sobre el mismo registro.
   * El modo código NO cambia la lista de tools durante la conexión, así que
   * cumple la norma MCP, que prohíbe que ese conjunto varíe como efecto
   * secundario de otra petición.
   */
  modo?: "clasico" | "codigo";
  /** Quien corre el código del modelo. Obligatorio en modo código. */
  ejecutor?: Ejecutor;
}

export function createServer(env: CmfEnv = {}, opciones: OpcionesServidor = {}): McpServer {
  const modo = opciones.modo ?? "clasico";
  const server = new McpServer(
    {
      name: "mcp-cmf-chile",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      cacheHints: {
        "tools/list": { ttlMs: 600_000, cacheScope: "public" },
        "prompts/list": { ttlMs: 600_000, cacheScope: "public" },
        "resources/list": { ttlMs: 600_000, cacheScope: "public" },
        "resources/templates/list": { ttlMs: 600_000, cacheScope: "public" },
        "server/discover": { ttlMs: 600_000, cacheScope: "public" },
      },
      instructions: modo === "codigo" ? INSTRUCCIONES_CODIGO : [
        "Servidor MCP con los datos públicos de la Comisión para el Mercado Financiero de Chile (CMF).",
        "Uso recomendado:",
        "1. Para analizar una empresa: cmf_empresa_por_ticker (ticker de bolsa, ej: COPEC, SQM-B; los RUTs provienen del catálogo de empresas en bolsa en github.com/JoaquinMulet/empresas-cmf-chile) o cmf_buscar_entidad (una palabra clave o RUT) para obtener el RUT canónico → cmf_empresa_info → cmf_empresa_eeff_historial (períodos disponibles) → cmf_empresa_eeff (estados financieros IFRS/NCH por período; use modo=markdown para leer el PDF auditado convertido a Markdown) → cmf_empresa_hechos → cmf_empresa_sanciones/resoluciones.",
        "2. Para descargar todo de una empresa: cmf_empresa_paquete (plan de descarga, máx 2 años por llamada) y cmf_empresa_paquete_documentos (ZIP ordenado, máx 3 períodos por llamada).",
        "3. Fondos mutuos: cmf_fondos_mutuos_catalogo para identificar fondos → cmf_fondos_mutuos_bpr (patrimonio/rentabilidad) → cmf_fondos_mutuos_costos (TAC).",
        "4. Indicadores económicos: cmf_api_indicador_valor (serie: uf, dolar, euro, tab, utm, ipc, tip, tmc). Para balances bancarios, identifique la institución por su código SBIF (ej: 001=Banco de Chile, 037=Banco Santander-Chile; 999=el sistema total; la lista completa está en el resource cmf://bancos/codigos).",
        "5. Normativa y seguros: cmf_normativa_buscar y cmf_seguros_*.",
        "Límites y notas:",
        "- Captchas (cmf_hechos_globales y cmf_fondos_mutuos_cartola): al llamarlas sin código, la tool descarga la imagen captcha de la CMF y le entrega un resource cmf://captcha/{id}; pida al usuario que lea los 6 caracteres y reintente con captcha=<código> y captcha_id=<id>.",
        "- Fechas en formato YYYY-MM-DD; los RUTs se aceptan con o sin dígito verificador (ej: 90690000 o 90690000-5).",
        "- Resultados paginados: las tools con offset/limit devuelven next_offset/total; itere para ver todas las filas (nunca asuma que la primera página es el total).",
        "- Los documentos firmados se gestionan en el servidor; para leer el contenido de un PDF: cmf_documento_markdown (token s567 o url completa del documento).",
        "- Si una consulta devuelve 'sin datos', verifique el período o la norma (IFRS vs NCH) antes de concluir que la información no existe; si el error menciona que la fuente de la CMF no devolvió datos, es una condición del sistema de la CMF (verifique la página oficial indicada) y no implica ausencia de datos.",
      ].join("\n"),
    },
  );

  if (modo === "codigo") {
    if (!opciones.ejecutor) {
      // Fallo ruidoso. Sin caja aislada no se ejecuta código del modelo,
      // ni siquiera "provisoriamente": sería ejecución sin frontera.
      throw new Error("createServer: el modo código exige un ejecutor (caja aislada)");
    }
    registrarModoCodigo(server, env, opciones.ejecutor);
  } else {
    registrarToolsApi(server, env);
    registrarToolsEmpresas(server, env);
    registrarToolsFondosMutuos(server, env);
    registrarToolsFondosInversion(server, env);
    registrarToolsOtros(server, env);
    registrarToolsPaquete(server, env);
  }
  registrarResources(server, env);
  registrarPrompts(server);

  return server;
}
