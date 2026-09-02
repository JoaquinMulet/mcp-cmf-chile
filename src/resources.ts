import { ResourceTemplate } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CmfEnv } from "./client/cmf-client.js";
import { obtenerCaptcha } from "./captcha.js";
import { RESUMEN_LIMITACIONES_PDF } from "./pdf.js";

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
    "cmf://skill/uso",    {
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
3. \`cmf_empresa_eeff\` (rut, anio, mes 03/06/09/12, tipo C/I, norma IFRS/NCH): documentos del período; use modo=markdown para leer el PDF auditado convertido a Markdown (el HTML de la CMF no trae las cifras). ${RESUMEN_LIMITACIONES_PDF}
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

### Qué significan los códigos y en qué unidad vienen las cifras

- El tipo de fondo es un código de 1 a 8. Su significado está en el resource \`cmf://fondos-mutuos/tipos\`.
- Las cifras NO vienen en pesos. El boletín viene en millones y las inversiones en miles.
- La unidad exacta de cada respuesta viaja en su campo \`notas\`, copiada del pie de esa planilla, y también en el texto. Esa es la fuente, el resource es la guía.
- Las filas de agregado («Total consulta», «Total Sistema») viajan en el campo \`totales\`, fuera de las filas de datos. No las sume junto a las series.

### Serie histórica de varios meses

No hay una tool que entregue el valor cuota mes a mes. La cartola diaria (\`cmf_fondos_mutuos_cartola\`) sí lo tiene, pero pide captcha, así que no sirve para recorrer muchos períodos.

La vía es repetir la tool mensual, una llamada por mes, y unir los resultados. Para volatilidad o rentabilidad acumulada, \`cmf_fondos_mutuos_bpr\` con el mismo \`admin\` y el \`mes\` cambiando.

Vía de escape cuando necesita muchos períodos o todas las filas de una vez: baje el archivo original de la CMF y procéselo usted. Son estas rutas, bajo \`https://www.cmfchile.cl\`.

- Boletín BPR: \`/institucional/estadisticas/fm.fm_bpr.php?out=excel&admins=0&tipofondo=0&moneda=0&mes_peri=MM&anio_peri=AAAA\`
- Costos (TAC): \`/institucional/estadisticas/fmdfm_excel2.php\` (POST con admins, tipofondo, moneda, mes2, anno2)
- Catálogo de fondos: \`/institucional/estadisticas/fm_ident2.php\` (POST, devuelve CSV con punto y coma)
- Cartera de inversiones: \`/institucional/estadisticas/ffm_download.php\` (POST con aa, mm, cartera)

Ojo con 2 cosas al procesarlos a mano, porque el servidor ya las corrige y usted no las tendría. el catálogo repite cada fondo hasta 3 veces, y las planillas traen sus notas al pie como si fueran filas de datos.

## Indicadores y economía

- \`cmf_api_indicador_valor\` (serie: uf, dolar, euro, tab, utm, ipc, tip, tmc; anio, mes, dia opcional).
- \`cmf_api_indicador_serie\` (serie, desde, hasta).

## Reglas

- Fechas en formato YYYY-MM-DD; RUT numérico (con o sin DV).
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
            blob: reg.imagenBase64,
            mimeType: reg.contentType,
          },
        ],
      };
    },
  );

  /**
   * Tipos de fondo mutuo y unidad de las cifras.
   *
   * Los 8 nombres están copiados textuales del pie de la planilla del
   * Boletín de Patrimonio y Rentabilidad de diciembre de 2025. Hasta el 28
   * de agosto de 2026 ese diccionario solo existía ahí, revuelto con las
   * filas de datos, así que un agente leía el tipo como un número sin
   * significado. Es la pregunta más común que se le hace a este servidor,
   * porque separa la renta fija corta de las acciones.
   *
   * La unidad NO es la misma en todos los informes: el boletín viene en
   * millones y las inversiones en miles. Por eso acá no hay un enunciado
   * global, y la unidad exacta de cada respuesta viaja en su campo `notas`.
   */
  server.registerResource(
    "fondos-mutuos-tipos",
    "cmf://fondos-mutuos/tipos",
    {
      title: "Tipos de fondo mutuo y unidad de las cifras (CMF)",
      description:
        "Significado de los 8 códigos de tipo de fondo mutuo de la CMF y en qué unidad vienen las cifras de cada informe. Use estos códigos en el parámetro tipo de cmf_fondos_mutuos_catalogo y en tipo_fondo de cmf_fondos_mutuos_comisiones.",
      mimeType: "application/json",
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(
            {
              nota: "Nombres copiados textuales del pie de la planilla del Boletín de Patrimonio y Rentabilidad de la CMF. Como filtro, 0 significa todos los tipos y no es un tipo de fondo.",
              tipos: [
                { codigo: "1", nombre: "FM DE INV.EN INST.DE DEUDA DE C/P CON DURACION <= 90 DIAS" },
                { codigo: "2", nombre: "FM DE INV.EN INST.DE DEUDA DE C/P CON DURACION <= 365 DIAS" },
                { codigo: "3", nombre: "FM DE INV.EN INST.DE DEUDA DE MEDIANO Y LARGO PLAZO" },
                { codigo: "4", nombre: "FM MIXTO" },
                { codigo: "5", nombre: "FM DE INVERSION EN INSTRUMENTOS DE CAPITALIZACION" },
                { codigo: "6", nombre: "FM DE LIBRE INVERSION" },
                { codigo: "7", nombre: "FM ESTRUCTURADO" },
                { codigo: "8", nombre: "FM DIRIGIDO A INVERSIONISTAS CALIFICADOS" },
              ],
              unidades: {
                advertencia:
                  "La unidad cambia según el informe, así que no hay una sola. Leer un patrimonio en millones como si fueran pesos se equivoca por un factor de un millón y nada avisa.",
                cmf_fondos_mutuos_bpr:
                  "Millones de pesos, o de la moneda que corresponda al fondo. Los fondos que llevan contabilidad en moneda extranjera se convierten al tipo de cambio de la fecha de la estadística.",
                cmf_fondos_mutuos_inversiones: "Miles de pesos.",
                donde_confirmarla:
                  "El pie exacto de cada planilla viaja en el campo notas de la respuesta de esa tool, y también en su texto. Esa es la fuente, y esta ficha es solo la guía.",
              },
            },
            null,
            2,
          ),
          mimeType: "application/json",
        },
      ],
    }),
  );

  // Códigos SBIF de instituciones financieras (verificados contra la API oficial v3 de la CMF)
  server.registerResource(
    "bancos-codigos",
    "cmf://bancos/codigos",
    {
      title: "Códigos SBIF de instituciones financieras",
      description: "Mapa código SBIF → nombre de institución financiera (verificado contra la API oficial v3 de la CMF). Use estos códigos en institucion para las tools cmf_api_*.",
      mimeType: "application/json",
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(
            {
              nota: "Códigos verificados contra la API oficial v3 de la CMF (ficha institucional). 999 = sistema financiero total.",
              instituciones: [
                { codigo: "001", nombre: "Banco de Chile" },
                { codigo: "009", nombre: "Banco Internacional" },
                { codigo: "012", nombre: "Banco del Estado de Chile" },
                { codigo: "014", nombre: "Scotiabank Chile" },
                { codigo: "016", nombre: "Banco de Crédito e Inversiones" },
                { codigo: "017", nombre: "Banco do Brasil S.A." },
                { codigo: "027", nombre: "Corpbanca" },
                { codigo: "028", nombre: "Banco Bice" },
                { codigo: "037", nombre: "Banco Santander-Chile" },
                { codigo: "049", nombre: "Banco Security" },
                { codigo: "051", nombre: "Banco Falabella" },
                { codigo: "053", nombre: "Banco Ripley" },
                { codigo: "055", nombre: "Banco Consorcio" },
                { codigo: "999", nombre: "Sistema financiero total" },
              ],
            },
            null,
            2,
          ),
          mimeType: "application/json",
        },
      ],
    }),
  );
}
