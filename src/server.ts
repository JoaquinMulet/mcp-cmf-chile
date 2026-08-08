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

/**
 * Factory per-request: crea un McpServer fresco con todas las tools/resources/prompts.
 * Los caches, rate limiters y cookie jars viven en módulos (singletons), no aquí.
 */
export function createServer(env: CmfEnv = {}): McpServer {
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
        "server/discover": { ttlMs: 600_000, cacheScope: "public" },
      },
      instructions: [
        "Servidor MCP con los datos públicos de la Comisión para el Mercado Financiero de Chile (CMF).",
        "Uso recomendado:",
        "1. Para analizar una empresa: cmf_empresa_por_ticker (ticker de bolsa, ej: COPEC, SQM-B; los RUTs provienen del catálogo de empresas en bolsa en github.com/JoaquinMulet/empresas-cmf-chile) o cmf_buscar_entidad (nombre o RUT) para obtener el RUT canónico → cmf_empresa_info → cmf_empresa_eeff (estados financieros IFRS/NCH por período; use modo=markdown para leer el PDF auditado convertido a Markdown) → cmf_empresa_hechos → cmf_empresa_sanciones/resoluciones.",
        "2. Para descargar todo de una empresa: cmf_empresa_paquete (plan de descarga, máx 2 años por llamada) y cmf_empresa_paquete_documentos (ZIP ordenado, máx 3 períodos por llamada).",
        "3. Fondos mutuos: cmf_fondos_mutuos_catalogo para identificar fondos → cmf_fondos_mutuos_bpr (patrimonio/rentabilidad) → cmf_fondos_mutuos_costos (TAC).",
        "4. Indicadores económicos: cmf_api_indicador_valor (serie: uf, dolar, euro, tab, utm, ipc, tip, tmc).",
        "5. Normativa y seguros: cmf_normativa_buscar y cmf_seguros_*.",
        "Límites y notas:",
        "- Captchas: cmf_hechos_globales y cmf_fondos_mutuos_cartola requieren el código de la imagen captcha (se solicita automáticamente).",
        "- Fechas en formato YYYY-MM-DD; RUT numérico sin DV.",
        "- Los documentos firmados se gestionan en el servidor; los enlaces no son accesibles fuera de las tools. Para leer el contenido de un PDF: cmf_documento_markdown (token s567 o url) lo convierte a Markdown.",
        "- Si una consulta devuelve 'sin datos', verifique el período o la norma (IFRS vs NCH) antes de concluir que la información no existe.",
      ].join("\n"),
    },
  );

  registrarToolsApi(server, env);
  registrarToolsEmpresas(server, env);
  registrarToolsFondosMutuos(server, env);
  registrarToolsFondosInversion(server, env);
  registrarToolsOtros(server, env);
  registrarToolsPaquete(server, env);
  registrarResources(server, env);
  registrarPrompts(server);

  return server;
}
