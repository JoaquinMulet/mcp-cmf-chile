/**
 * Las 2 únicas tools del modo código.
 *
 * En vez de exponer 86 esquemas que viajan en cada petición del modelo,
 * el servidor expone `cmf_buscar` y `cmf_ejecutar`. El catálogo y los
 * datos se quedan acá; el modelo manda código y recibe solo lo que su
 * código devuelve.
 *
 * Con esto desaparecen 2 defectos de raíz.
 *
 * 1. El costo de contexto deja de crecer con el número de operaciones.
 * 2. Nadie recorta por criterio del servidor. El modelo pide todas las
 *    filas y filtra él, así que ya no hay datos que se pierdan por un
 *    tope que él no eligió.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { CmfEnv } from "../client/cmf-client.js";
import { construirRegistro, derivarCatalogo, type Operacion } from "../registro.js";
import type { Ejecutor, Prestamos } from "../sandbox.js";

/** Resultado MCP crudo, tal como lo devuelven las operaciones existentes. */
interface ResultadoCrudo {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/**
 * Convierte el resultado MCP de una operación en el dato que verá el
 * programa. Dentro de la caja queremos el JSON COMPLETO, no el resumen en
 * texto: es justamente lo que el modelo no podía ver antes.
 */
export function datoDeOperacion(nombre: string, crudo: unknown): unknown {
  const r = crudo as ResultadoCrudo;
  const texto = (r?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  if (r?.isError) {
    throw new Error(`La operación ${nombre} falló. ${texto || "sin detalle"}`);
  }
  return r?.structuredContent !== undefined ? r.structuredContent : texto;
}

/** Arma los préstamos que la caja le entrega al programa del modelo. */
function prestamosDe(operaciones: Map<string, Operacion>): Prestamos {
  const cmf: Prestamos["cmf"] = {};
  for (const op of operaciones.values()) {
    cmf[op.nombre] = async (args) => datoDeOperacion(op.nombre, await op.ejecutar(args ?? {}));
  }
  return { catalogo: derivarCatalogo(operaciones), cmf };
}

/** Da formato al resultado de la caja para que el modelo lo lea en TEXTO. */
function textoDeResultado(r: { valor: unknown; registros: string[]; error?: string }): string {
  const partes: string[] = [];
  if (r.registros.length > 0) partes.push(r.registros.join("\n"));
  if (r.error) {
    partes.push(`ERROR del programa: ${r.error}`);
    partes.push("Corrige el código y vuelve a intentar. El catálogo está en la variable catalogo.");
  } else {
    partes.push(typeof r.valor === "string" ? r.valor : JSON.stringify(r.valor, null, 1));
  }
  return partes.join("\n\n");
}

const DESC_BUSCAR = [
  "Descubre qué operaciones de la CMF existen, ejecutando código contra el catálogo.",
  "El catálogo NO entra a tu contexto: lo filtras tú y solo recibes lo que devuelvas.",
  "",
  "Dentro del código tienes la variable `catalogo`, un arreglo de",
  "{ nombre, resumen, params }. Escribe el CUERPO de una función async y usa return.",
  "",
  "Ejemplo. return catalogo.filter(o => /poliza|seguros/i.test(o.nombre + o.resumen)).map(o => ({ nombre: o.nombre, params: o.params }))",
  "",
  "Úsala siempre antes de cmf_ejecutar, para saber el nombre exacto de la operación y sus parámetros.",
].join("\n");

const DESC_EJECUTAR = [
  "Ejecuta operaciones de la CMF escribiendo código, y devuelve SOLO lo que tu código retorne.",
  "",
  "Dentro del código tienes `cmf`, con una función async por operación del catálogo,",
  "y también `catalogo`. Cada operación devuelve su JSON COMPLETO, sin recortes:",
  "todas las filas que pediste y todos sus campos, incluida la url del documento cuando existe.",
  "Escribe el CUERPO de una función async y usa return. console.log también se te muestra.",
  "",
  "Ejemplo. const r = await cmf.seguros_deposito_polizas({ texto: 'vehiculos motorizados', limit: 500 });",
  "return r.polizas.filter(p => /VEHICULOS MOTORIZADOS/i.test(p.texto)).map(p => ({ codigo: p.codigo, entidad: p.entidad, url: p.url }))",
  "",
  "Para leer un PDF. const d = await cmf.documento_markdown({ url }); return d.markdown.slice(0, 20000)",
  "",
  "Filtra ANTES de devolver. Devolver todo desperdicia tu contexto; devolver de menos te obliga a repetir la llamada.",
].join("\n");

/**
 * Registra las 2 tools del modo código.
 * @param server Servidor MCP.
 * @param env Configuración del cliente de la CMF.
 * @param ejecutor Quien corre el código. En producción, la caja de Workers.
 */
export function registrarModoCodigo(server: McpServer, env: CmfEnv, ejecutor: Ejecutor): void {
  const operaciones = construirRegistro(env);
  const prestamos = prestamosDe(operaciones);

  server.registerTool(
    "cmf_buscar",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Buscar operaciones de la CMF",
      description: DESC_BUSCAR,
      inputSchema: z.object({
        codigo: z.string().describe("Cuerpo de una función async de JavaScript que filtra `catalogo` y hace return."),
      }),
      outputSchema: z.object({ valor: z.unknown().optional(), error: z.string().optional() }),
    },
    async ({ codigo }: { codigo: string }) => {
      // La búsqueda no toca la red: solo ve el catálogo.
      const r = await ejecutor.correr(codigo, { catalogo: prestamos.catalogo, cmf: {} });
      return {
        content: [{ type: "text" as const, text: textoDeResultado(r) }],
        structuredContent: { valor: r.valor, ...(r.error ? { error: r.error } : {}) },
        ...(r.error ? { isError: true } : {}),
      };
    },
  );

  server.registerTool(
    "cmf_ejecutar",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Ejecutar operaciones de la CMF con código",
      description: DESC_EJECUTAR,
      inputSchema: z.object({
        codigo: z.string().describe("Cuerpo de una función async de JavaScript que usa `cmf` y hace return."),
      }),
      outputSchema: z.object({ valor: z.unknown().optional(), error: z.string().optional() }),
    },
    async ({ codigo }: { codigo: string }) => {
      const r = await ejecutor.correr(codigo, prestamos);
      return {
        content: [{ type: "text" as const, text: textoDeResultado(r) }],
        structuredContent: { valor: r.valor, ...(r.error ? { error: r.error } : {}) },
        ...(r.error ? { isError: true } : {}),
      };
    },
  );
}
