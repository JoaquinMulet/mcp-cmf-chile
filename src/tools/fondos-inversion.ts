import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { gridSchema, paginadoSchema, filasSchema } from "../util/schemas-output.js";
import { getLegacy, postLegacy, type CmfEnv } from "../client/cmf-client.js";
import { htmlTablaAJson, gridGoogleVisAJson } from "../client/parsers.js";
import { fromError, toolOk, resumirTabla } from "../util/errors.js";
import { paginar } from "../util/paginate.js";
import { avisoDeTramo, paginacion, toolOkPaginado } from "../util/tramos.js";
import {
  anioSchema, mesSchema, offsetSchema, limitSchema } from "../util/schemas.js";

export function registrarToolsFondosInversion(server: McpServer, env: CmfEnv): void {
  server.registerTool(
    "cmf_fondos_inversion_eeff_ifrs",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: gridSchema,
      title: "EEFF IFRS de Fondos de Inversión",
      description:
        "Devuelve los estados financieros IFRS de fondos de inversión como matriz de cuentas contables × fondos (grid Google Visualization convertido a JSON), desde el sitio de la CMF. Filtre la administradora con admins (RUT; 0 = todas) y los fondos con fondos (array de códigos; ['0'] = todos); defina el rango con anio1/anio2 (AAAA) y, si necesita cortes intermedios, mes1/mes2 (MM; sin mes se usa diciembre). La salida incluye hasta 200 filas y total_filas con el total real; si responde \"Sin resultados\" puede requerir re-solución del anti-bot, reintente. Use esta tool para comparar cuentas IFRS entre fondos; para obtener códigos de fondos use cmf_fondos_inversion_catalogo. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        admins: z.string().default("0").describe("RUT de la administradora (0=todas)"),
        fondos: z.array(z.string()).default(["0"]).describe("Códigos de fondos (['0']=todos)"),
        anio1: anioSchema,
        anio2: anioSchema,
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional(), ...paginacion(200) }),
    },
    async ({ admins, fondos, anio1, anio2, mes1, mes2, offset, limit }) => {
      try {
        const html = await postLegacy(
          "/institucional/estadisticas/merc_valores/fondos_ifrs/fondos_ifrs1.php",
          {
            tc1: "1",
            ifrs_sistema: "FIIFR",
            admins,
            "ffmm1[]": fondos,
            mes1: mes1 ?? "12",
            anno1: anio1,
            mes2: mes2 ?? "12",
            anno2: anio2,
          },
          env,
          { auth: "", send: "", lang: "es", control: "Berlin39", xls: "n" },
        );
        const { columnas, filas } = gridGoogleVisAJson(html);
        const texto = filas.length
          ? `EEFF IFRS FI ${anio1}-${mes1 ?? "12"} → ${anio2}-${mes2 ?? "12"}: ${filas.length} cuentas × ${Math.max(0, columnas.length - 1)} fondos.\n${resumirTabla(filas.slice(0, 8), columnas.slice(0, 6))}`
          : "Sin resultados de EEFF IFRS FI (puede requerir re-solución del anti-bot; reintente).";
        return toolOkPaginado(texto, { columnas, total_filas: filas.length }, "filas", filas, offset, limit, "cmf_fondos_inversion_eeff_ifrs");
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_inversion_catalogo",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: paginadoSchema("fondos"),
      title: "Catálogo de Fondos de Inversión",
      description:
        "Devuelve el catálogo de fondos de inversión supervisados por la CMF (RUT, nombre, tipo de entidad, inscripción y estado) con paginación. Busque con consulta (nombre o RUT; sin consulta lista fondos de inversión en general) y recorra el listado con offset y limit (sin máximo, default 100); la salida trae total y next_offset para continuar. Use esta tool para identificar códigos/RUT de fondos y administradoras que otras tools requieren, p. ej. cmf_fondos_inversion_eeff_ifrs. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        consulta: z.string().optional().describe("Nombre o RUT a buscar"),
        offset: offsetSchema,
        limit: limitSchema,
      }),
    },
    async ({ consulta, offset, limit }) => {
      try {
        const html = await getLegacy(
          "/institucional/mercados/consulta_busqueda.php",
          { valor: consulta ?? "FONDO DE INVERSION", entidad_web: "G", boton_busqueda: "Buscar" },
          env,
        );
        const filas = htmlTablaAJson(html, ["rut", "nombre", "tipo_entidad", "inscripcion", "estado"]);
        const { filas: fondos, paginado } = paginar(filas, offset, limit);
        const texto = fondos.length
          ? `Fondos de inversión (total ${paginado.total}):\n${resumirTabla(fondos, ["rut", "nombre", "estado"])}`
          : "Sin resultados de fondos de inversión.";
        return toolOk(texto + avisoDeTramo(fondos.length, paginado, "cmf_fondos_inversion_catalogo"), { fondos, total: paginado.total, next_offset: paginado.next_offset });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_inversion_comisiones_maximas",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Comisiones máximas de Fondos de Inversión",
      description: "Devuelve las filas del informe de comisiones máximas aplicables a fondos de inversión que publica la CMF (tabla HTML parseada; hasta 200 filas en filas). El informe es el vigente publicado. Si no hay filas parseables, el informe está disponible como PDF en el sitio de la CMF. Use esta tool para conocer los topes de comisiones; para las comisiones cobradas a fondos de pensiones use cmf_fondos_comisiones_maximas (tipo=fi). Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({ ...paginacion(200) }),
    },
    async ({ offset, limit }) => {
      try {
        const html = await getLegacy(
          "/institucional/estadisticas/valores_fondosinversion_informe_commax.php",
          {},
          env,
        );
        const filas = htmlTablaAJson(html);
        const texto = filas.length
          ? `Comisiones máximas FI (${filas.length} filas):\n${resumirTabla(filas.slice(0, 10), Object.keys(filas[0] ?? {}).slice(0, 6))}`
          : "Informe disponible sin tablas parseables (puede ser PDF).";
        return toolOkPaginado(texto, {  }, "filas", filas, offset, limit, "cmf_fondos_inversion_comisiones_maximas");
      } catch (e) {
        return fromError(e);
      }
    },
  );
}
