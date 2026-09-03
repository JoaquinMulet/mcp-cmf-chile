import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { CmfEnv } from "../client/cmf-client.js";
import {
  CODIGOS_BANCOS,
  CODIGOS_CIRCULAR_1333,
  NOTAS_BANCOS,
  NOTAS_CIRCULAR_1333,
  NOTAS_SEGUROS,
  companiasDeSeguros,
} from "../catalogos.js";
import { fromError } from "../util/errors.js";
import { filtrarFilas, filtrosLocales } from "../util/filtros.js";
import { conRutCanonico } from "../util/rut.js";
import { filasSchema } from "../util/schemas-output.js";
import { enumTolerante } from "../util/schemas.js";
import { paginacion, toolOkTabla } from "../util/tramos.js";

/**
 * Los catálogos de códigos, como tool.
 *
 * Existen también como recursos `cmf://`, pero un recurso no lo lee ningún
 * modelo que no lo pida a propósito, y un cliente MCP puede ni ofrecerlos.
 * La tool es lo que el modelo ve en su lista, y las 2 caras leen la misma
 * fuente en `src/catalogos.ts`.
 */
export function registrarToolsCatalogos(server: McpServer, env: CmfEnv): void {
  server.registerTool(
    "cmf_codigos",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Catálogos de códigos (bancos, seguros, circular 1333)",
      description:
        "Devuelve los catálogos de códigos que otras tools piden como parámetro. catalogo=bancos entrega el código SBIF de cada institución financiera (el parámetro institucion de las tools cmf_api_* y codUnicoBank de cmf_bancos_reportes; 999 = sistema total), verificado contra la API oficial. catalogo=seguros entrega las compañías de seguros generales y de vida con su RUT sin dígito verificador, que es lo que pide sociedades en cmf_seguros_eeff, leído en vivo de los formularios de la CMF. catalogo=cartera_fondos_mutuos explica cada columna ffm_60xxxxx de cmf_fondos_mutuos_cartera con el nombre, el detalle, la unidad y los valores posibles de la Circular 1.333 de 1997. Filtre con texto (se aplica en el servidor, sobre cualquier campo). Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        catalogo: enumTolerante(["bancos", "seguros", "cartera_fondos_mutuos"]).describe(
          "Qué catálogo. bancos (código SBIF → institución), seguros (RUT → compañía, con segmento generales o vida) o cartera_fondos_mutuos (columna ffm_ → variable de la Circular 1.333)",
        ),
        texto: filtrosLocales.texto.describe(
          "Se queda con las filas donde algún campo contiene este texto, por ejemplo el nombre de un banco, el RUT de una aseguradora o el nombre de una columna ffm_. Se aplica en el servidor",
        ),
        ...paginacion(200),
      }),
    },
    async ({ catalogo, texto, offset, limit }) => {
      try {
        const { filas, notas, titulo, unidad } = await catalogoPedido(catalogo as Catalogo, env);
        return toolOkTabla({
          titulo,
          vacio: `El catálogo ${catalogo} no tiene filas que contengan «${texto ?? ""}».`,
          base: { catalogo, texto },
          campo: "filas",
          filas: filtrarFilas(filas, { texto }),
          offset,
          limit,
          tool: "cmf_codigos",
          unidad,
          notas,
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );
}

export type Catalogo = "bancos" | "seguros" | "cartera_fondos_mutuos";

/** Las filas y las notas de cada catálogo. Es lo que comparten la tool y los recursos. */
export async function catalogoPedido(
  catalogo: Catalogo,
  env: CmfEnv,
): Promise<{ filas: Record<string, unknown>[]; notas: string[]; titulo: string; unidad: string }> {
  if (catalogo === "bancos") {
    return { filas: CODIGOS_BANCOS.map((c) => ({ ...c })), notas: NOTAS_BANCOS, titulo: "Códigos SBIF de instituciones financieras", unidad: "instituciones" };
  }
  if (catalogo === "seguros") {
    const filas = (await companiasDeSeguros(env)).map((f) => conRutCanonico({ ...f }));
    return { filas, notas: NOTAS_SEGUROS, titulo: "Compañías de seguros (RUT para sociedades de cmf_seguros_eeff)", unidad: "compañías" };
  }
  const filas = CODIGOS_CIRCULAR_1333.map((c) => ({
    cartera: c.cartera,
    codigo: c.codigo,
    columnas: c.columnas.join(", "),
    nombre: c.nombre,
    detalle: c.detalle ?? "",
    unidad: c.unidad ?? "",
    valores: c.valores ? Object.entries(c.valores).map(([k, v]) => `${k}=${v}`).join("; ") : "",
  }));
  return { filas, notas: NOTAS_CIRCULAR_1333, titulo: "Variables de la cartera de fondos mutuos (Circular 1.333)", unidad: "variables" };
}
