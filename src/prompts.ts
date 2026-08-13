import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

/** Prompts MCP: plantillas para tareas típicas con datos de la CMF. */

export function registrarPrompts(server: McpServer): void {
  server.registerPrompt(
    "cmf_analizar_empresa",
    {
      title: "Análisis financiero de empresa",
      description:
        "Guía paso a paso para analizar una empresa que cotiza en bolsa usando los datos de la CMF: identificación, EEFF, hechos esenciales, sanciones, ASG y memoria anual.",
      argsSchema: z.object({
        rut: z.string().describe("RUT numérico de la empresa"),
      }),
    },
    ({ rut }: { rut: string }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Analiza la empresa con RUT ${rut} siguiendo estos pasos usando las tools del servidor MCP CMF Chile:

1. cmf_empresa_info: identificación (razón social, inscripción).
2. cmf_empresa_eeff_historial: períodos disponibles.
3. cmf_empresa_eeff: últimos estados financieros (situación financiera, resultados, flujo de efectivo) — explica evolución anual.
4. cmf_empresa_hechos: hechos esenciales del último año (materias relevantes).
5. cmf_empresa_sanciones y cmf_empresa_resoluciones: cumplimiento normativo.
6. cmf_empresa_asg: indicadores ASG si existen — prueba los tres tipo_informe (1=Memoria Integrada, 2=SASB, 3=XBRL SASB) y di cuáles existen.
7. cmf_empresa_memoria_anual: memoria del último año si está disponible.

Entrega un informe estructurado: perfil, salud financiera (indicadores derivados), riesgos (hechos/sanciones), gobernanza y conclusión. Cita siempre el período de los datos. Si una tool no devuelve datos, dilo explícitamente (no inventes).`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "cmf_comparar_fondos",
    {
      title: "Comparación de fondos mutuos",
      description:
        "Compara fondos mutuos (patrimonio, rentabilidad, partícipes, valor cuota, costos TAC) usando el catálogo y los boletines de la CMF.",
      argsSchema: z.object({
        anio: z.string().describe("Año (AAAA)"),
        mes: z.string().optional().describe("Mes (01-12)"),
      }),
    },
    ({ anio, mes }: { anio: string; mes?: string }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Compara fondos mutuos chilenos a ${mes ?? "12"}/${anio} usando las tools del MCP CMF Chile:

1. Si el usuario pide fondos específicos, primero cmf_fondos_mutuos_catalogo para identificarlos: anota el RUN de cada fondo y el RUT de su administradora (rut_admin).
2. cmf_fondos_mutuos_bpr (anio, mes; admin=rut_admin si buscas una administradora): patrimonio, rentabilidad nominal mensual, partícipes y valor cuota por serie.
3. cmf_fondos_mutuos_costos (anio, mes; admin=rut_admin): TAC y remuneraciones por serie.
4. cmf_fondos_mutuos_antecedentes: contexto del sistema.
5. Si comparas series específicas, filtra por su RUN dentro de las filas devueltas (bpr/costos filtran por administradora, no por RUN).

Entrega: ranking por patrimonio y por rentabilidad, tabla comparativa con costos TAC, y comentario de calidad (datos faltantes señalados explícitamente).`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "cmf_indicadores_economicos",
    {
      title: "Reporte de indicadores económicos",
      description:
        "Genera un reporte de indicadores económicos oficiales chilenos (UF, UTM, IPC, TMC, dólar) para un período. Requiere que el servidor tenga configurada la CMF_API_KEY (API oficial v3); si las tools responden 'CMF_API_KEY no configurada', la instancia no puede generar este reporte.",
      argsSchema: z.object({
        anio: z.string().describe("Año (AAAA)"),
        mes: z.string().optional().describe("Mes (01-12)"),
      }),
    },
    ({ anio, mes }: { anio: string; mes?: string }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Genera un reporte de indicadores económicos chilenos a ${mes ?? "12"}/${anio} usando el MCP CMF Chile:

1. cmf_api_indicador_valor: UF, UTM, IPC, TMC, dólar y euro (serie, anio, mes).
2. cmf_api_indicador_serie: tendencia de los últimos 6-12 meses.

Entrega una tabla con valores y una nota breve de tendencia. Señala los indicadores no disponibles.`,
          },
        },
      ],
    }),
  );
}
