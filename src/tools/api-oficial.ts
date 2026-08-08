import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { apiSerieSchema, apiPeriodoSchema } from "../util/schemas-output.js";
import { apiV3, type CmfEnv } from "../client/cmf-client.js";
import { fromError, toolError, toolOk } from "../util/errors.js";
import { anioSchema, mesSchema, serieIndicadorSchema, diaSchema } from "../util/schemas.js";

/** Tools de la API oficial v3 (api.sbif.cl). Requieren CMF_API_KEY en el entorno del servidor. */

const SERIES_DESC: Record<string, string> = {
  uf: "Unidad de Fomento",
  dolar: "Dólar Observado",
  euro: "Euro",
  tab: "TAB (tasa bancaria 360 días)",
  utm: "UTM",
  ipc: "IPC",
  tip: "Tasa de interés promedio",
  tmc: "Tasa máxima convencional",
};

function nombreSerie(s: string): string {
  return `${s.toUpperCase()} (${SERIES_DESC[s] ?? ""})`;
}

export function registrarToolsApi(server: McpServer, env: CmfEnv): void {
  if (!env.CMF_API_KEY) {
    // Herramientas registradas pero que responden con error claro si no hay key
  }

  server.registerTool(
    "cmf_api_indicador_valor",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Valor de indicador (UF, dólar, UTM, IPC, TMC…)",
      description:
        "Valor de un indicador económico oficial (UF, Dólar Observado, Euro, TAB, UTM, IPC, TIP, TMC) para una fecha o período, desde la API oficial v3 de la CMF (SBIF).",
      inputSchema: z.object({
        serie: serieIndicadorSchema,
        anio: anioSchema,
        mes: mesSchema,
        dia: diaSchema.optional(),
      }),
      outputSchema: z.object({
        serie: z.string(),
        fecha: z.string(),
        valor: z.unknown(),
      }),
    },
    async ({ serie, anio, mes, dia }) => {
      try {
        const path = dia ? `/${serie}/${anio}/${mes}/dias/${dia}` : `/${serie}/${anio}/${mes}`;
        const data = await apiV3<unknown>(path, env);
        const fecha = dia ? `${anio}-${mes}-${dia}` : `${anio}-${mes}`;
        const valor = Array.isArray(data) && data.length > 0 ? data[0] : data;
        return toolOk(
          `${nombreSerie(serie)} a ${fecha}: ${JSON.stringify(valor)}`,
          { serie, fecha, valor },
        );
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_api_indicador_serie",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: apiSerieSchema,
      title: "Serie histórica de indicador",
      description:
        "Serie histórica de un indicador (UF, dólar, euro, TAB, UTM, IPC, TIP, TMC) en un rango de años/meses, incluyendo variantes anteriores/posteriores a una fecha.",
      inputSchema: z.object({
        serie: serieIndicadorSchema,
        desde: z.preprocess((v) => String(v ?? "").slice(0, 7), z.string().regex(/^\d{4}(-\d{2})?$/, "AAAA, AAAA-MM o AAAA-MM-DD")),
        hasta: z.preprocess((v) => String(v ?? "").slice(0, 7), z.string().regex(/^\d{4}(-\d{2})?$/, "AAAA, AAAA-MM o AAAA-MM-DD")),
      }),
    },
    async ({ serie, desde, hasta }) => {
      try {
        const [a1, m1] = desde.split("-");
        const [a2, m2] = hasta.split("-");
        const path = m1 && m2 ? `/${serie}/periodo/${a1}/${m1}/${a2}/${m2}` : `/${serie}/periodo/${a1}/${a2}`;
        const data = await apiV3<unknown[]>(path, env);
        const filas = Array.isArray(data) ? data : [];
        const texto = filas.length
          ? `Serie ${nombreSerie(serie)} ${desde} → ${hasta}: ${filas.length} registros. Ejemplo: ${JSON.stringify(filas[0])}`
          : `Sin registros para ${serie} entre ${desde} y ${hasta}.`;
        return toolOk(texto, { serie, desde, hasta, total: filas.length, registros: filas.slice(0, 100) });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_api_balance_institucion",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: apiPeriodoSchema,
      title: "Balance de institución financiera",
      description:
        "Balance mensual de instituciones financieras (bancos) de la API oficial v3. institucion=999 equivale al sistema financiero total. cuenta es el código de cuenta opcional.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema,
        institucion: z.string().optional().describe("Código de institución (999 = sistema total)"),
        cuenta: z.string().optional().describe("Código de cuenta (ej: 210000)"),
      }),
    },
    async ({ anio, mes, institucion, cuenta }) => {
      try {
        let path = `/balances/${anio}/${mes}`;
        if (cuenta) path += `/cuentas/${cuenta}`;
        if (institucion) path += `/instituciones/${institucion}`;
        const data = await apiV3<unknown>(path, env);
        return toolOk(
          `Balance ${anio}-${mes}${institucion ? ` institución ${institucion}` : ""}${cuenta ? ` cuenta ${cuenta}` : ""}: ${JSON.stringify(data).slice(0, 4000)}`,
          { anio, mes, institucion, cuenta, data },
        );
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_api_resultados_institucion",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: apiPeriodoSchema,
      title: "Estado de resultados de institución financiera",
      description:
        "Estado de resultados mensual de instituciones financieras de la API oficial v3. institucion=999 equivale al sistema financiero total.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema,
        institucion: z.string().optional(),
      }),
    },
    async ({ anio, mes, institucion }) => {
      try {
        let path = `/resultados/${anio}/${mes}`;
        if (institucion) path += `/instituciones/${institucion}`;
        const data = await apiV3<unknown>(path, env);
        return toolOk(
          `Resultados ${anio}-${mes}${institucion ? ` institución ${institucion}` : ""}: ${JSON.stringify(data).slice(0, 4000)}`,
          { anio, mes, institucion, data },
        );
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_api_adecuacion_capital",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: apiPeriodoSchema,
      title: "Adecuación de capital",
      description:
        "Componentes o indicadores de adecuación de capital de instituciones financieras (Activos ponderados, límites, patrimonio efectivo, IRE/IRS).",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema,
        institucion: z.string().describe("Código de institución (999 = sistema total)"),
        componente: z.enum(["activos", "limites", "patrimonioefectivo", "indicadores"]).describe("Componente a consultar"),
        indicador: z.enum(["ire", "irs"]).optional().describe("Indicador (solo si componente=indicadores)"),
      }),
    },
    async ({ anio, mes, institucion, componente, indicador }) => {
      try {
        let path = `/adecuacion/anhos/${anio}/meses/${mes}/instituciones/${institucion}`;
        if (componente === "indicadores" && indicador) path += `/indicadores/${indicador}`;
        else path += `/componentes/${componente}`;
        const data = await apiV3<unknown>(path, env);
        return toolOk(
          `Adecuación de capital ${componente}${indicador ? ` ${indicador}` : ""} ${anio}-${mes} inst. ${institucion}: ${JSON.stringify(data).slice(0, 4000)}`,
          { anio, mes, institucion, componente, indicador, data },
        );
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_api_ficha_institucion",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: apiPeriodoSchema,
      title: "Ficha de institución financiera",
      description: "Ficha de un banco/institución financiera: domicilio, filiales, ejecutivos (API oficial v3).",
      inputSchema: z.object({
        institucion: z.string(),
        anio: anioSchema,
        mes: mesSchema,
      }),
    },
    async ({ institucion, anio, mes }) => {
      try {
        const data = await apiV3<unknown>(`/perfil/instituciones/${institucion}/${anio}/${mes}`, env);
        return toolOk(`Ficha institución ${institucion} (${anio}-${mes}): ${JSON.stringify(data).slice(0, 4000)}`, {
          institucion,
          anio,
          mes,
          data,
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_api_accionistas_institucion",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: apiPeriodoSchema,
      title: "Accionistas de institución financiera",
      description: "Lista de accionistas de un banco/institución financiera (API oficial v3).",
      inputSchema: z.object({
        institucion: z.string(),
        anio: anioSchema,
        mes: mesSchema,
      }),
    },
    async ({ institucion, anio, mes }) => {
      try {
        const data = await apiV3<unknown>(`/accionistas/instituciones/${institucion}/anhos/${anio}/meses/${mes}/ficha`, env);
        return toolOk(`Accionistas institución ${institucion} (${anio}-${mes}): ${JSON.stringify(data).slice(0, 4000)}`, {
          institucion,
          anio,
          mes,
          data,
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_api_integrantes_institucion",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: apiPeriodoSchema,
      title: "Integrantes de directorio de institución financiera",
      description: "Integrantes del directorio de un banco/institución financiera (API oficial v3).",
      inputSchema: z.object({
        institucion: z.string(),
        anio: anioSchema,
        mes: mesSchema,
      }),
    },
    async ({ institucion, anio, mes }) => {
      try {
        const data = await apiV3<unknown>(`/integrantes/instituciones/${institucion}/anhos/${anio}/meses/${mes}`, env);
        return toolOk(`Directorio institución ${institucion} (${anio}-${mes}): ${JSON.stringify(data).slice(0, 4000)}`, {
          institucion,
          anio,
          mes,
          data,
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );
}
