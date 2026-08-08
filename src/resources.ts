import { ResourceTemplate } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CmfEnv } from "./client/cmf-client.js";
import { obtenerCaptcha } from "./captcha.js";

/** Recursos MCP (URIs cmf://) — templates registrados en resources/templates/list. */

export function registrarResources(server: McpServer, env: CmfEnv): void {
  server.registerResource(
    "entidad",
    new ResourceTemplate("cmf://entidades/{rut}", {
      list: async () => ({ resources: [] }),
    }),
    {
      title: "Ficha de entidad supervisada CMF",
      description: "Ficha de identificación de una entidad supervisada por su RUT.",
      mimeType: "application/json",
    },
    async (uri: URL, variables: Record<string, unknown>) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({
            recurso: "cmf://entidades/{rut}",
            rut: String(variables.rut ?? ""),
            nota: "Consulte la tool cmf_empresa_info para obtener los datos completos de la ficha.",
          }),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "indicador",
    new ResourceTemplate("cmf://indicadores/{serie}/{anio}/{mes}", {
      list: async () => ({ resources: [] }),
    }),
    {
      title: "Valor de indicador económico",
      description: "Valor de un indicador (uf, dolar, euro, tab, utm, ipc, tip, tmc) para un período.",
      mimeType: "application/json",
    },
    async (uri: URL, variables: Record<string, unknown>) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({
            recurso: "cmf://indicadores/{serie}/{anio}/{mes}",
            serie: String(variables.serie ?? ""),
            anio: String(variables.anio ?? ""),
            mes: String(variables.mes ?? ""),
            nota: "Consulte la tool cmf_api_indicador_valor para obtener el valor.",
          }),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "fondo",
    new ResourceTemplate("cmf://fondos/{run}", {
      list: async () => ({ resources: [] }),
    }),
    {
      title: "Ficha de fondo mutuo",
      description: "Identificación de un fondo mutuo por su RUN.",
      mimeType: "application/json",
    },
    async (uri: URL, variables: Record<string, unknown>) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({
            recurso: "cmf://fondos/{run}",
            run: String(variables.run ?? ""),
            nota: "Consulte cmf_fondos_mutuos_catalogo para los datos del fondo.",
          }),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "norma",
    new ResourceTemplate("cmf://norma/{id}", {
      list: async () => ({ resources: [] }),
    }),
    {
      title: "Norma de la CMF",
      description: "Referencia a una norma del compendio (PDF). Use cmf_normativa_descargar para obtener el archivo.",
      mimeType: "application/pdf",
    },
    async (uri: URL, variables: Record<string, unknown>) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({
            recurso: "cmf://norma/{id}",
            id: String(variables.id ?? ""),
            nota: "El PDF se obtiene con la tool cmf_normativa_descargar.",
          }),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.registerResource(
    "documento",
    new ResourceTemplate("cmf://documento/{id}", {
      list: async () => ({ resources: [] }),
    }),
    {
      title: "Documento firmado de la CMF",
      description: "Metadata de un documento firmado (hechos, sanciones, resoluciones). Use cmf_documento_descargar para el contenido.",
      mimeType: "application/json",
    },
    async (uri: URL, variables: Record<string, unknown>) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({
            recurso: "cmf://documento/{id}",
            id: String(variables.id ?? ""),
            nota: "Consulte la tool cmf_documento_descargar con el token s567 completo.",
          }),
          mimeType: "application/json",
        },
      ],
    }),
  );

  // Skill de uso del servidor (formato Agent Skills, adelanto del SEP-2640 Skills Extension)
  server.registerResource(
    "skill-uso",
    "cmf://skill/uso",
    {
      title: "Skill: cómo usar el MCP de la CMF",
      description: "Instrucciones de uso del servidor MCP de la CMF de Chile (formato Agent Skills: name, description, procedimiento).",
      mimeType: "text/markdown",
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          text: `---
name: uso-mcp-cmf-chile
description: Procedimiento para consultar datos públicos de la CMF de Chile (empresas en bolsa, EEFF, fondos mutuos, indicadores, normativa) usando las tools de este servidor MCP.
---

# Uso del MCP de la CMF de Chile

## Análisis de una empresa

1. \`cmf_buscar_entidad\` con nombre, RUT o ticker para obtener el RUT canónico y el tipo de entidad.
2. \`cmf_empresa_info\` (rut): identificación.
3. \`cmf_empresa_eeff\` (rut, anio, mes 03/06/09/12, tipo C/I, norma IFRS/NCH): tablas estructuradas del período.
4. \`cmf_empresa_hechos\` (rut, desde, hasta): hechos esenciales.
5. \`cmf_empresa_sanciones\` y \`cmf_empresa_resoluciones\`: cumplimiento normativo.
6. \`cmf_empresa_asg\` (rut, anio): indicadores ESG si existen.

## Descarga completa (paquetes)

1. \`cmf_empresa_paquete\` (rut, anio_inicio, anio_fin): plan de descarga (árbol + manifest). Máx 2 años por llamada.
2. \`cmf_empresa_paquete_documentos\` (rut, anio_inicio, anio_fin, secciones, max_documentos, max_mb): ZIP en base64 con directorio lógico y manifiesto.json. Máx 3 períodos EEFF por llamada.

## Fondos mutuos

1. \`cmf_fondos_mutuos_catalogo\` (nombre): identificar el RUN del fondo.
2. \`cmf_fondos_mutuos_bpr\` (anio, mes): patrimonio, rentabilidad, partícipes, valor cuota.
3. \`cmf_fondos_mutuos_costos\` (anio, mes): TAC y remuneraciones.
4. \`cmf_fondos_comisiones_maximas\` (tipo fm/fi, circular 1951/1965, anio): comisiones máximas a fondos de pensiones.

## Indicadores y economía

- \`cmf_api_indicador_valor\` (serie: uf, dolar, euro, tab, utm, ipc, tip, tmc; anio, mes, dia opcional).
- \`cmf_api_indicador_serie\` (serie, desde, hasta).

## Reglas

- Fechas en formato YYYY-MM-DD; RUT numérico sin DV.
- \`cmf_hechos_globales\` y \`cmf_fondos_mutuos_cartola\` requieren captcha: si no se entrega, la tool lo solicita.
- Si una tool devuelve "sin datos", verifique período/norma antes de concluir que la información no existe (el inicio IFRS varía por empresa).
- No invente enlaces a documentos: los tokens firmados solo se resuelven en el servidor.
`,
          mimeType: "text/markdown",
        },
      ],
    }),
  );

  // Captcha: imagen para MRTR (sesión guardada en KV con TTL y single-use)
  server.registerResource(
    "captcha",
    new ResourceTemplate("cmf://captcha/{id}", {
      list: async () => ({ resources: [] }),
    }),
    {
      title: "Imagen captcha de la CMF",
      description: "Imagen captcha (6 caracteres) requerida por consultas protegidas de la CMF.",
      mimeType: "image/png",
    },
    async (uri: URL, variables: Record<string, unknown>) => {
      const reg = await obtenerCaptcha(env, String(variables.id ?? ""));
      if (!reg) {
        return {
          contents: [
            {
              uri: uri.href,
              text: "Captcha expirado o no existe. Solicite uno nuevo.",
              mimeType: "text/plain",
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            text: reg.assetUrl,
            mimeType: "image/png",
          },
        ],
      };
    },
  );
}
