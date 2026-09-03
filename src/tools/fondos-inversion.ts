import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { gridSchema, paginadoSchema, filasSchema } from "../util/schemas-output.js";
import { getLegacy, postLegacyBinario, type CmfEnv } from "../client/cmf-client.js";
import { htmlTablaAJson, xlsAJson } from "../client/parsers.js";
import { fromError, toolOk, resumirTabla } from "../util/errors.js";
import { paginar } from "../util/paginate.js";
import { toolDeGrid } from "../util/grid.js";
import { avisoDeTramo, paginacion, toolOkTabla } from "../util/tramos.js";
import {
  anioSchema, mesSchema, offsetSchema, limitSchema, rutOTodosSchema } from "../util/schemas.js";
import { conRutCanonico } from "../util/rut.js";

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
        admins: rutOTodosSchema.default("0").describe("RUT de la administradora, en cualquier formato (0=todas)"),
        fondos: z.array(z.string()).default(["0"]).describe("Códigos de fondos (['0']=todos)"),
        anio1: anioSchema,
        anio2: anioSchema,
        mes1: mesSchema.optional(),
        mes2: mesSchema.optional(), ...paginacion(200) }),
    },
    async ({ admins, fondos, anio1, anio2, mes1, mes2, offset, limit }) => {
      try {
        // El índice trae 2 formularios. f1_ifrs consulta por fondo (tc1=1,
        // ffmm1[]) y f3_ifrs por administradora (tc1=3, admins). Los 2
        // apuntan a fondos_ifrs1.php con un token en la query.
        const porAdministradora = admins !== "0";
        const rango = { mes1: mes1 ?? "12", anno1: anio1, mes2: mes2 ?? "12", anno2: anio2 };
        return await toolDeGrid(
          {
            que: "EEFF IFRS FI",
            indice: "/institucional/estadisticas/merc_valores/fondos_ifrs/fondos_ifrs_index.php",
            formulario: porAdministradora ? "f3_ifrs" : "f1_ifrs",
            cuerpo: porAdministradora
              ? { tc1: "3", ifrs_sistema: "FIIFR", admins, ...rango }
              : { tc1: "1", ifrs_sistema: "FIIFR", "ffmm1[]": fondos, ...rango },
            titulo: `EEFF IFRS FI ${anio1}-${mes1 ?? "12"} → ${anio2}-${mes2 ?? "12"}`,
            vacio: "Sin resultados de EEFF IFRS FI para esa selección y ese rango.",
            base: { admins, fondos, anio1, anio2 },
            // columnas y total_filas los declara el outputSchema de esta tool,
            // así que sacarlos rompe su contrato. Lo caza verify-endpoints.
            baseDeGrid: (g) => ({ columnas: ["cuenta", ...g.entidades], total_filas: g.filas.length }),
            offset,
            limit,
            tool: "cmf_fondos_inversion_eeff_ifrs",
          },
          env,
        );
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
        const { filas: fondos, paginado } = paginar(filas.map(conRutCanonico), offset, limit);
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
      description: "Devuelve el informe de comisiones máximas de fondos de inversión (TGCA, tasa de gastos y comisiones anualizada, con la remuneración fija, los gastos y la base de cálculo por fondo en miles de pesos) que la CMF genera como planilla Excel para un período. Fije mes en MM y anio en AAAA, y fondo por RUN (default % = todos). COBERTURA, verificada el 2 de septiembre de 2026: la CMF respondió 'Sin Información' para todos los períodos probados entre 2023 y 2025, tanto para todos los fondos como para uno solo; si eso le pasa, el informe no está publicado para ese período. Use esta tool para conocer los topes de comisiones; para las comisiones cobradas a fondos de pensiones use cmf_fondos_comisiones_maximas (tipo=fi). Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        mes: mesSchema.describe("Mes del informe en MM"),
        anio: anioSchema.describe("Año del informe en AAAA"),
        fondo: z.string().default("%").describe("RUN del fondo (default % = todos)"), ...paginacion(200) }),
    },
    async ({ mes, anio, fondo, offset, limit }) => {
      try {
        // La página HTML solo trae el formulario. el botón «GENERAR ARCHIVO»
        // envía por JavaScript a la ruta _excel.php y baja una planilla BIFF.
        const bytes = await postLegacyBinario(
          "/institucional/estadisticas/valores_fondosinversion_informe_commax_excel.php",
          { mes, anno: anio, fondo },
          env,
          { lang: "es" },
        );
        const todas = xlsAJson(bytes);
        const sinInformacion = todas.some((f) => Object.values(f).includes("Sin Información"));
        const filas = sinInformacion ? [] : todas;
        return toolOkTabla({
          titulo: `Comisiones máximas FI ${anio}-${mes}`,
          vacio: `La CMF no tiene informe de comisiones máximas para ${anio}-${mes} (la planilla dice 'Sin Información').`,
          base: { mes, anio, fondo },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_fondos_inversion_comisiones_maximas",
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );
}
