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
import { recortarValor, type Ejecutor, type Prestamos } from "../sandbox.js";

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

/**
 * Arma los préstamos que la caja le entrega al programa del modelo.
 *
 * Se exporta porque el puente del Worker necesita EXACTAMENTE el mismo
 * mapa de operaciones. Si cada lado armara el suyo, un día dejarían de
 * coincidir y el programa vería nombres que el puente no sabe llamar.
 */
export function prestamosDe(operaciones: Map<string, Operacion>): Prestamos {
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
    // Compacto. La sangría inflaba el pago un 12 por ciento sin
    // comprarle legibilidad a nadie.
    partes.push(recortarValor(typeof r.valor === "string" ? r.valor : JSON.stringify(r.valor)));
  }
  return partes.join("\n\n");
}

const CONTRATO = [
  "Escribe SOLO el cuerpo de una función async, y termina con return.",
  "Así sí. return catalogo.length",
  "Así no. async function main() { return catalogo.length }  (una función completa no se ejecuta)",
  "Nada de cercos de markdown. Manda el código pelado.",
];

const ESTRATEGIA = [
  "REGLA DE ORO. si vas a buscar varias veces sobre la misma fuente, BAJA EL UNIVERSO UNA VEZ y filtra en tu código.",
  "Cada búsqueda por texto es una consulta nueva al sitio de la CMF y tarda más de 1 segundo. Adivinar 20 términos",
  "cuesta 20 consultas, se queda sin tiempo, y encima solo encuentra lo que las palabras que se te ocurrieron alcanzan.",
  "Casi todas las operaciones aceptan limit y offset y devuelven total, así que puedes traer el listado completo.",
  "",
  "Así se hace un barrido exhaustivo de verdad, con 2 llamadas en vez de 20.",
  "  let todas = [], off = 0;",
  "  while (off !== null) {",
  "    const r = await cmf.seguros_deposito_polizas({ limit: 5000, offset: off });",
  "    todas.push(...r.polizas); off = r.next_offset;",
  "  }",
  "  const vocab = /vehiculo|automovil|motorizad|colision|perdida total/i;",
  "  const hit = todas.filter(p => vocab.test(JSON.stringify(p)));",
  "  return { universo: todas.length, encontradas: hit.length, aseguradoras: [...new Set(hit.map(p => p.entidad))] }",
  "",
  "Medido el 20 de agosto de 2026. el registro de pólizas tiene 5.956 filas, y ese barrido encuentra 444 pólizas",
  "vehiculares de 30 aseguradoras. Buscando por texto con 6 términos se encuentran 85 y unas pocas compañías.",
  "Y cuando no sepas los nombres de los campos de una fila, mira Object.keys(r.polizas[0]) antes de filtrar.",
];

const PRESUPUESTO = [
  "Presupuesto de un programa. hasta 60 llamadas a la CMF y 10 segundos de CPU propios.",
  "El reloj lo pone quien te llama, entre 60 y 180 segundos según el cliente, y cada llamada a la CMF tarda",
  "más de 1 segundo, así que un programa seguro hace 15 llamadas o menos. Si necesitas más, no adivines más",
  "términos. baja el universo con limit y offset, que son muchas menos llamadas para muchos más datos.",
  "Si necesitas más, parte el trabajo en varias llamadas a esta herramienta y devuelve el offset al que llegaste.",
  "Usa console.log antes de cada llamada. Si el programa muere, los registros son lo único que sobrevive.",
];

const DESC_BUSCAR = [
  "Descubre qué operaciones de la CMF existen, ejecutando código contra el catálogo.",
  ...CONTRATO,
  "",
  "Tienes la variable catalogo, un arreglo de { nombre, resumen, detalle, params }.",
  "detalle es la descripción completa de la operación, con los códigos y los casos de uso.",
  "params es un arreglo de { nombre, descripcion }, con los enums y los formatos de cada parámetro.",
  "El catálogo NO entra a tu contexto. Solo recibes lo que devuelvas, así que filtra y devuelve poco.",
  "",
  "Ejemplo. return catalogo.filter(o => /poliza|seguros/i.test(o.nombre + o.resumen)).map(o => o.nombre)",
  "Y después, para una sola. return catalogo.find(o => o.nombre === 'seguros_deposito_polizas')",
  "",
  "Esta herramienta NO llama operaciones ni toca la red. Solo filtra el catálogo.",
  "Úsala siempre antes de cmf_ejecutar, para saber el nombre exacto y qué acepta cada parámetro.",
].join(String.fromCharCode(10));

const DESC_EJECUTAR = [
  "Ejecuta operaciones de la CMF escribiendo código, y devuelve SOLO lo que tu código retorne.",
  ...CONTRATO,
  "",
  "Tienes cmf, con una función async por operación del catálogo, y también catalogo.",
  "Cada operación devuelve su JSON completo, con todos sus campos, incluida la url del documento.",
  "Un parámetro que no esté en params se RECHAZA con error. No inventes nombres, míralos con cmf_buscar.",
  "",
  ...PRESUPUESTO,
  "",
  ...ESTRATEGIA,
  "",
  "Para leer un PDF entero, recórrelo por tramos y filtra adentro.",
  "  let off = 0, hallazgos = [];",
  "  while (off !== null) {",
  "    const d = await cmf.documento_markdown({ url, offset_chars: off });",
  "    hallazgos.push(...d.markdown.split(String.fromCharCode(10)).filter(l => /deducible/i.test(l)));",
  "    off = d.siguiente_offset_chars;",
  "  }",
  "  return hallazgos.slice(0, 20)",
  "Nunca cortes con slice sin mirar siguiente_offset_chars. perderías el resto sin enterarte.",
  "",
  "Filtra ANTES de devolver. Devolver el resultado crudo puede gastar tu contexto entero en una respuesta.",
].join(String.fromCharCode(10));

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
      // `readOnlyHint` va en false a propósito. El cuerpo lo escribe el
      // modelo, y entre las 86 operaciones hay algunas que SI escriben
      // estado del servidor (el registro de captchas en KV, por ejemplo,
      // que además es de un solo uso). Una tool que corre código
      // arbitrario no puede prometer lectura pura para toda invocación
      // posible. `openWorldHint` se deja en su default true, que es lo
      // honesto para un servidor que sale a cmfchile.cl.
      annotations: { readOnlyHint: false, destructiveHint: false },
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
