import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { apiSerieSchema, apiPeriodoSchema } from "../util/schemas-output.js";
import { apiV3, type CmfEnv } from "../client/cmf-client.js";
import { fromError, toolOk } from "../util/errors.js";
import { anioSchema, mesSchema, serieIndicadorSchema, diaSchema, codigoSchema } from "../util/schemas.js";
import { paginacion, toolOkPaginado, toolOkTabla } from "../util/tramos.js";

/** Tools de la API oficial v3 (api.sbif.cl). Requieren CMF_API_KEY en el entorno del servidor. */

/**
 * La API v3 envuelve las filas en un objeto con una sola lista
 * (`{CodigosBalances: [...]}`, `{CodigosResultados: [...]}`). Se toma la
 * primera lista que traiga, sea cual sea su nombre, para que el nombre no
 * se escriba de memoria.
 */
/**
 * Aparta las filas cuyo nombre es EXACTAMENTE un agregado (SUBTOTAL, OTROS,
 * TOTAL, TOTALES). «OTROS ACCIONISTAS MINORITARIOS» o «TOTAL S.A.» siguen
 * siendo accionistas.
 */
function separarAgregados(filas: Record<string, unknown>[]): { datos: Record<string, unknown>[]; totales: Record<string, unknown>[] } {
  const esAgregado = (f: Record<string, unknown>) => Object.values(f).some((v) => /^(SUB)?TOTAL(ES)?$|^OTROS$/i.test(String(v ?? "").trim()));
  return { datos: filas.filter((f) => !esAgregado(f)), totales: filas.filter(esAgregado) };
}

/**
 * Una fila de la API con sus objetos anidados aplanados. la API envuelve
 * cada accionista en {Periodo, Institucion, DescripcionAccionista: {...}},
 * y una tabla no puede mostrar un objeto. Los campos del objeto interior
 * suben al nivel de la fila, con el nombre del objeto adelante solo cuando
 * el nombre ya estaba ocupado.
 */
function aplanar(fila: Record<string, unknown>): Record<string, unknown> {
  const plana: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fila)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) plana[sk in plana || sk in fila ? `${k}.${sk}` : sk] = sv;
    } else {
      plana[k] = v;
    }
  }
  return plana;
}

/** La lista más larga del objeto, aplanada. `{Errores: [], CodigosBalances: [...]}` da los balances. */
function filasDeLaApi(data: unknown): Record<string, unknown>[] {
  let lista: unknown[] = Array.isArray(data) ? data : [];
  if (!Array.isArray(data) && data && typeof data === "object") {
    for (const v of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length > lista.length) lista = v;
    }
  }
  return lista.map((f) => aplanar((f ?? {}) as Record<string, unknown>));
}

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
        "Devuelve el valor de un indicador económico oficial (UF, Dólar Observado, Euro, TAB, UTM, IPC, TIP, TMC) para un día o un mes, desde la API oficial v3 de la CMF (api.sbif.cl). Identifique la serie con serie (ej: uf) y el período con anio (AAAA) y mes (MM); agregue dia (DD) para el valor del día exacto, sin dia devuelve el registro del mes. Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para valores puntuales; para la evolución en un rango use cmf_api_indicador_serie.",
      inputSchema: z.object({
        serie: serieIndicadorSchema.describe("Indicador a consultar: uf, dolar, euro, tab, utm, ipc, tip o tmc. Ej: uf"),
        anio: anioSchema,
        mes: mesSchema,
        dia: diaSchema.optional(),
      }),
      outputSchema: z.object({
        serie: z.string(),
        fecha: z.string(),
        valor: z.unknown(),
      }).passthrough(),
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
        "Devuelve la serie histórica mensual de un indicador económico (UF, dólar, euro, TAB, UTM, IPC, TIP, TMC) en un rango de períodos, desde la API oficial v3 de la CMF. Defina el rango con desde/hasta en AAAA o AAAA-MM (ej: desde=2023-01, hasta=2024-12; el día se ignora); si algún extremo no trae mes, la consulta se hace por año completo. La salida incluye total y hasta 100 registros; \"Sin registros\" indica que el rango no tiene datos, verifique el período. Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para evoluciones históricas; para un valor puntual use cmf_api_indicador_valor. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        serie: serieIndicadorSchema.describe("Indicador a consultar: uf, dolar, euro, tab, utm, ipc, tip o tmc. Ej: uf"),
        desde: z.coerce.string().transform((v) => v.slice(0, 7)).pipe(z.string().regex(/^\d{4}(-\d{2})?$/, "AAAA o AAAA-MM")).describe("Inicio del rango en AAAA o AAAA-MM. Ej: 2023-01"),
        hasta: z.coerce.string().transform((v) => v.slice(0, 7)).pipe(z.string().regex(/^\d{4}(-\d{2})?$/, "AAAA o AAAA-MM")).describe("Fin del rango en AAAA o AAAA-MM. Ej: 2024-12"), ...paginacion(100) }),
    },
    async ({ serie, desde, hasta, offset, limit }) => {
      try {
        const [a1, m1] = desde.split("-");
        const [a2, m2] = hasta.split("-");
        const path = m1 && m2 ? `/${serie}/periodo/${a1}/${m1}/${a2}/${m2}` : `/${serie}/periodo/${a1}/${a2}`;
        const data = await apiV3<unknown>(path, env);
        // La API de períodos devuelve un objeto con una clave por serie ({"UFs":[...], ...});
        // la de valores puntuales, un objeto similar. Se extrae la lista de la serie pedida.
        const CLAVES_SERIE: Record<string, string> = {
          uf: "UFs", dolar: "Dolares", euro: "Euros", tab: "TABs",
          utm: "UTMs", ipc: "IPCs", tip: "TIPs", tmc: "TMCs",
        };
        let filas: unknown[] = [];
        if (Array.isArray(data)) {
          filas = data;
        } else if (data && typeof data === "object") {
          const obj = data as Record<string, unknown>;
          const directa = obj[CLAVES_SERIE[serie]];
          if (Array.isArray(directa)) filas = directa;
          else filas = Object.values(obj).find((v) => Array.isArray(v)) ?? [];
        }
        const texto = filas.length
          ? `Serie ${nombreSerie(serie)} ${desde} → ${hasta}: ${filas.length} registros. Ejemplo: ${JSON.stringify(filas[0])}`
          : `Sin registros para ${serie} entre ${desde} y ${hasta}.`;
        return toolOkPaginado(texto, { serie, desde, hasta }, "registros", filas, offset, limit, "cmf_api_indicador_serie");
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
        "Devuelve el balance mensual de instituciones financieras (bancos) supervisadas, desde la API oficial v3 de la CMF. Filtre el período con anio (AAAA) y mes (MM); use institucion para un banco específico (999 = sistema financiero total) y cuenta para una sola cuenta contable (ej: 210000), sin ellos devuelve los datos completos del período, con una fila por cuenta (código, descripción, institución y montos por moneda). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para activos y pasivos contables; para ingresos y gastos del mismo período use cmf_api_resultados_institucion. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema,
        institucion: codigoSchema.optional().describe("Código SBIF de la institución (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; 999=sistema total; vea el resource cmf://bancos/codigos; acepta 999 o '999')"),
        cuenta: codigoSchema.optional().describe("Código de cuenta (ej: 210000)"), ...paginacion(300) }),
    },
    async ({ anio, mes, institucion, cuenta, offset, limit }) => {
      try {
        let path = `/balances/${anio}/${mes}`;
        if (cuenta) path += `/cuentas/${cuenta}`;
        if (institucion) path += `/instituciones/${institucion}`;
        const data = await apiV3<unknown>(path, env);
        return toolOkTabla({
          titulo: `Balance ${anio}-${mes}${institucion ? ` institución ${institucion}` : ""}${cuenta ? ` cuenta ${cuenta}` : ""}`,
          vacio: "La API no devolvió cuentas para ese período.",
          base: { anio, mes, institucion, cuenta },
          campo: "filas",
          filas: filasDeLaApi(data),
          offset,
          limit,
          tool: "cmf_api_balance_institucion",
          unidad: "cuentas",
        });
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
        "Devuelve el estado de resultados mensual de instituciones financieras (bancos), desde la API oficial v3 de la CMF, con una fila por cuenta (código, descripción, institución y montos por moneda). Filtre el período con anio (AAAA) y mes (MM); use institucion para un banco específico (999 = sistema financiero total), sin institucion devuelve los datos del período completo; use cuenta para quedarse con las cuentas cuyo código EMPIEZA con ese prefijo (ej: 4 = ingresos, 41 = intereses). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para ingresos y gastos del mes; para el balance contable use cmf_api_balance_institucion. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema,
        institucion: codigoSchema.optional().describe("Código SBIF de la institución (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; 999=sistema total; vea el resource cmf://bancos/codigos; acepta 999 o '999')"),
        cuenta: codigoSchema.optional().describe("Prefijo del código de cuenta (ej: 4, 41, 410100)"), ...paginacion(300) }),
    },
    async ({ anio, mes, institucion, cuenta, offset, limit }) => {
      try {
        let path = `/resultados/${anio}/${mes}`;
        if (institucion) path += `/instituciones/${institucion}`;
        const data = await apiV3<unknown>(path, env);
        // La API de resultados no filtra por cuenta, así que el filtro es
        // local, por prefijo del código, sobre las filas ya bajadas.
        const filas = filasDeLaApi(data).filter((f) => !cuenta || String(f.CodigoCuenta ?? "").startsWith(cuenta));
        return toolOkTabla({
          titulo: `Resultados ${anio}-${mes}${institucion ? ` institución ${institucion}` : ""}${cuenta ? ` cuentas ${cuenta}*` : ""}`,
          vacio: "La API no devolvió cuentas para ese período y ese filtro.",
          base: { anio, mes, institucion, cuenta },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_api_resultados_institucion",
          unidad: "cuentas",
        });
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
        "Devuelve componentes o indicadores de adecuación de capital (activos ponderados por riesgo, límites, patrimonio efectivo, IRE/IRS) de una institución financiera, desde la API oficial v3 de la CMF. Indique el período con anio (AAAA) y mes (MM), la institución con institucion (999 = sistema total) y la vista con componente (activos, limites, patrimonioefectivo o indicadores); con componente=indicadores agregue indicador=ire o irs. Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para supervisar la solvencia bancaria; para el balance o resultados contables use cmf_api_balance_institucion o cmf_api_resultados_institucion.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema,
        institucion: codigoSchema.describe("Código SBIF de la institución (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; 999=sistema total; vea el resource cmf://bancos/codigos; acepta 999 o '999')"),
        componente: z.enum(["activos", "limites", "patrimonioefectivo", "indicadores"]).describe("Componente a consultar: activos, limites, patrimonioefectivo o indicadores"),
        indicador: z.enum(["ire", "irs"]).optional().describe("Indicador a consultar: ire o irs (solo si componente=indicadores)"),
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
      description: "Devuelve la ficha de una institución financiera (domicilio, filiales, ejecutivos y antecedentes) para un período, desde la API oficial v3 de la CMF. Identifique la institución con institucion (ej: 001) y el período con anio (AAAA) y mes (MM). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para datos generales de un banco; para sus cifras contables use cmf_api_balance_institucion o cmf_api_resultados_institucion.",
      inputSchema: z.object({
        institucion: codigoSchema.describe("Código SBIF de la institución financiera (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; vea cmf://bancos/codigos)"),
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
      description: "Devuelve la lista de accionistas de una institución financiera para un período, desde la API oficial v3 de la CMF, con una fila por accionista; las filas SUBTOTAL, OTROS y TOTAL que la API agrega al final viajan aparte en totales, así que sumar la columna no las cuenta 2 veces. Identifique la institución con institucion (ej: 001) y el período con anio (AAAA) y mes (MM). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para la estructura de propiedad de un banco; para su directorio use cmf_api_integrantes_institucion. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        institucion: codigoSchema.describe("Código SBIF de la institución financiera (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; vea cmf://bancos/codigos)"),
        anio: anioSchema,
        mes: mesSchema, ...paginacion(300) }),
    },
    async ({ institucion, anio, mes, offset, limit }) => {
      try {
        const data = await apiV3<unknown>(`/accionistas/instituciones/${institucion}/anhos/${anio}/meses/${mes}/ficha`, env);
        // La API cierra la lista con SUBTOTAL, OTROS y TOTAL. Son agregados,
        // y sumarlos con los accionistas daba casi el doble.
        const { datos, totales } = separarAgregados(filasDeLaApi(data));
        return toolOkTabla({
          titulo: `Accionistas institución ${institucion} (${anio}-${mes})`,
          vacio: "La API no devolvió accionistas para ese período.",
          base: { institucion, anio, mes },
          campo: "filas",
          filas: datos,
          totales,
          offset,
          limit,
          tool: "cmf_api_accionistas_institucion",
          unidad: "accionistas",
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
      description: "Devuelve los integrantes del directorio de una institución financiera para un período, desde la API oficial v3 de la CMF. Identifique la institución con institucion (ej: 001) y el período con anio (AAAA) y mes (MM). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para el gobierno corporativo de un banco; para su estructura de propiedad use cmf_api_accionistas_institucion.",
      inputSchema: z.object({
        institucion: codigoSchema.describe("Código SBIF de la institución financiera (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; vea cmf://bancos/codigos)"),
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
