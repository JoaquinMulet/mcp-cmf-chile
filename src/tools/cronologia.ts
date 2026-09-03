import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { fetchCmf, type CmfEnv } from "../client/cmf-client.js";
import { decodificarEntidades, htmlTablaAJson } from "../client/parsers.js";
import { fromError, toolErrorFuente } from "../util/errors.js";
import { filtrarFilas, filtrosLocales } from "../util/filtros.js";
import { filasSchema } from "../util/schemas-output.js";
import { anioSchema, enumTolerante } from "../util/schemas.js";
import { paginacion, toolOkTabla } from "../util/tramos.js";

/**
 * La Cronología Bancaria de la CMF (ex SBIF). la historia de cada banco e
 * institución financiera de Chile desde 1743, con sus predecesores,
 * sucesores, hitos y documentos.
 *
 * El 2 de septiembre de 2026 la tool leía `indice=8.0`, que es la portada,
 * buscaba una `<table>` y no la encontraba, así que respondía «la CMF migró
 * la página». La página sí existe y sí trae los datos. van en listas `<ul>`
 * y en tablas sin cabecera, repartidos en 5 vistas que se eligen con el
 * `indice` de la URL.
 *
 * - 8.1&letra=A  → instituciones cuyo nombre empieza con esa letra, con su id.
 * - 8.4&idEntidad=ID → línea de tiempo de una institución (fecha, hito, id del evento).
 * - 8.3.1&ANIOS=AAAA → línea de tiempo de un año, todas las instituciones.
 * - 8.9&Eventoid=ID  → el texto completo de un hito, con sus documentos.
 * - 8.2.3&idEntidad=ID → predecesores y sucesores de una institución.
 *
 * 8.2.1 (vigentes por año) y 8.5 responden 500 con la página del cortafuegos
 * de la CMF, aun con el cliente anti-bot; no se ofrecen. El mismo cortafuegos
 * bloquea algunas letras de 8.1 (la B el 3 de septiembre de 2026, con B o b)
 * y deja pasar las demás; la tool lo dice como error de fuente.
 */
const HOST = "https://cronologiabancaria.cmfchile.cl";
const SERVLET = `${HOST}/sbifweb/servlet/CronologiaBancaria`;

async function paginaCronologia(query: string, env: CmfEnv): Promise<{ html: string; status: number }> {
  const res = await fetchCmf(`${SERVLET}?${query}`, {}, env);
  return { html: new TextDecoder("utf-8").decode(await res.arrayBuffer()), status: res.status };
}

/** El bloque `<div id="contenido">` de la página, o la página entera si no está. */
function contenido(html: string): string {
  const i = html.indexOf('id="contenido"');
  const j = html.indexOf('id="footer"', i);
  return i === -1 ? html : html.slice(i, j === -1 ? undefined : j);
}

function textoPlano(html: string): string {
  return decodificarEntidades(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function tituloDe(html: string): string {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? textoPlano(m[1]) : "";
}

/** 8.1. `<li class="post-listas"><a href="...idEntidad=ID&TIPO=pdf">Nombre</a>` */
export function institucionesDeLaLista(html: string): Record<string, string>[] {
  const salida: Record<string, string>[] = [];
  const re = /<li[^>]*>\s*<a[^>]*href="[^"]*idEntidad=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    salida.push({ id: m[1], nombre: textoPlano(m[2]), pagina: `${SERVLET}?indice=8.4&idEntidad=${m[1]}&TIPO=pdf` });
  }
  return salida;
}

/**
 * 8.4 y 8.3.1. filas `<tr><td><p class="fecha">15 - Mar -1995</p></td><td><p><a href="...Eventoid=ID">hito</a>`.
 * La fecha viene como «15 - Mar -1995» en la vista por institución y como
 * «03 - Sep » en la vista por año (el año está en el título).
 */
export function hitosDeLaTabla(html: string, anio?: string): Record<string, string>[] {
  const salida: Record<string, string>[] = [];
  const re = /<p class="fecha">([\s\S]*?)<\/p>[\s\S]*?<a[^>]*href="[^"]*Eventoid=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const cruda = textoPlano(m[1]).replace(/\s*-\s*/g, "-");
    const fecha = anio && !/\d{4}$/.test(cruda) ? `${cruda}-${anio}` : cruda;
    salida.push({ fecha, hito: textoPlano(m[3]), evento_id: m[2], pagina: `${SERVLET}?indice=8.9&Eventoid=${m[2]}` });
  }
  return salida;
}

/** 8.9. el título es el hito, `<p class="dia">` la fecha, y el resto el relato con sus documentos enlazados. */
export function eventoDeLaPagina(html: string): Record<string, string>[] {
  const bloque = /<div class="post fecha">([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? "";
  const fecha = /<p class="dia">([\s\S]*?)<\/p>/i.exec(bloque)?.[1] ?? "";
  const cuerpo = bloque.replace(/<p class="dia">[\s\S]*?<\/p>/i, "");
  const documentos: string[] = [];
  const re = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(cuerpo); m !== null; m = re.exec(cuerpo)) {
    documentos.push(`${textoPlano(m[2])}: ${decodificarEntidades(m[1])}`);
  }
  if (!bloque) return [];
  return [{ fecha: textoPlano(fecha).replace(/\s*-\s*/g, "-"), hito: tituloDe(html), texto: textoPlano(cuerpo), documentos: documentos.join(" | ") }];
}

/** 8.2.3. 2 tablas con cabecera en la primera fila, bajo «Predecesores» y «Sucesores». */
export function relacionadasDeLaPagina(html: string): Record<string, string>[] {
  const salida: Record<string, string>[] = [];
  const partes = html.split(/<h2>/i);
  for (const parte of partes.slice(1)) {
    const relacion = textoPlano(parte.slice(0, parte.indexOf("</h2>")));
    for (const f of htmlTablaAJson(parte)) {
      // El enlace de la tabla es relativo y apunta a una página HTML, no a un
      // documento; por eso se llama pagina y no url.
      const { url, ...resto } = f;
      salida.push({ relacion, ...resto, ...(url ? { pagina: new URL(url, SERVLET).toString() } : {}) });
    }
  }
  return salida;
}

type Consulta = "instituciones" | "institucion" | "anio" | "evento" | "relacionadas";

/** Qué página pedir y con qué lector leerla, según la vista. Falla con un mensaje que nombra el parámetro que falta. */
function planDeConsulta(
  consulta: Consulta,
  p: { letra?: string; id?: string; anio?: string; evento_id?: string },
): { query: string; leer: (html: string) => Record<string, string>[] } {
  const exige = (valor: string | undefined, nombre: string, origen: string): string => {
    if (!valor) throw new Error(`La consulta ${consulta} necesita ${nombre} (${origen}).`);
    return valor;
  };
  const planes: Record<Consulta, () => { query: string; leer: (html: string) => Record<string, string>[] }> = {
    instituciones: () => ({ query: `indice=8.1&letra=${(p.letra ?? "A").toUpperCase()}`, leer: institucionesDeLaLista }),
    institucion: () => ({ query: `indice=8.4&idEntidad=${exige(p.id, "id", "lo entrega la consulta instituciones")}&TIPO=pdf`, leer: (h) => hitosDeLaTabla(h) }),
    relacionadas: () => ({ query: `indice=8.2.3&idEntidad=${exige(p.id, "id", "lo entrega la consulta instituciones")}`, leer: relacionadasDeLaPagina }),
    anio: () => {
      const a = exige(p.anio, "anio", "AAAA");
      return { query: `indice=8.3.1&ANIOS=${a}&TIPO=pdf`, leer: (h) => hitosDeLaTabla(h, a) };
    },
    evento: () => ({ query: `indice=8.9&Eventoid=${exige(p.evento_id, "evento_id", "lo entrega la consulta institucion o anio")}`, leer: eventoDeLaPagina }),
  };
  return planes[consulta]();
}

export function registrarToolsCronologia(server: McpServer, env: CmfEnv): void {
  server.registerTool(
    "cmf_bancos_cronologia",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: filasSchema,
      title: "Cronología bancaria de Chile",
      description:
        "Devuelve la Cronología Bancaria de la CMF (ex SBIF). la historia de cada banco e institución financiera de Chile desde 1743, con sus hitos, predecesores, sucesores y documentos. Elija la vista con consulta. instituciones (las que empiezan con letra, con su id), institucion (la línea de tiempo de un id, fecha por fecha), anio (todos los hitos de un año), evento (el texto completo de un hito por su evento_id, con los documentos enlazados) y relacionadas (predecesores y sucesores de un id). El flujo típico es instituciones → institucion → evento. Los ids salen de las propias respuestas; el de ABN AMRO Bank (Chile) es 7500000000000178. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        consulta: enumTolerante(["instituciones", "institucion", "anio", "evento", "relacionadas"]).default("instituciones").describe(
          "instituciones (por letra), institucion (línea de tiempo por id), anio (hitos de un año), evento (texto de un hito por evento_id) o relacionadas (predecesores y sucesores por id)",
        ),
        letra: z.string().regex(/^[A-Za-z]$/, "Una letra, de la A a la Z").optional().describe("Para instituciones. la letra inicial del nombre (default A)"),
        id: z.coerce.string().regex(/^\d+$/, "Id numérico, como lo entrega la vista instituciones").optional().describe("Para institucion y relacionadas. el id de la institución"),
        anio: anioSchema.optional().describe("Para anio. el año en AAAA"),
        evento_id: z.coerce.string().regex(/^\d+$/, "Id numérico, como lo entrega la vista institucion").optional().describe("Para evento. el evento_id del hito"),
        texto: filtrosLocales.texto.describe("Se queda con las filas donde algún campo contiene este texto, por ejemplo parte del nombre de un banco. Se aplica en el servidor"),
        ...paginacion(100),
      }),
    },
    async ({ consulta, letra, id, anio, evento_id, texto, offset, limit }) => {
      try {
        const { query, leer } = planDeConsulta(consulta as Consulta, { letra, id, anio, evento_id });
        const { html, status } = await paginaCronologia(query, env);
        const bloque = contenido(html);
        if (status !== 200 || !/id="contenido"/.test(html)) {
          return toolErrorFuente(`Cronología bancaria (${consulta})`, `${SERVLET}?${query}`, `la página respondió HTTP ${status} sin su bloque de contenido; puede ser el cortafuegos de la CMF`);
        }
        const filas = filtrarFilas(leer(bloque), { texto });
        return toolOkTabla({
          titulo: tituloDe(bloque) || `Cronología bancaria (${consulta})`,
          vacio: `La vista ${consulta} no trae filas para esos parámetros. Verifique en ${SERVLET}?${query}`,
          base: { consulta, letra, id, anio, evento_id, texto, fuente: `${SERVLET}?${query}` },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_bancos_cronologia",
          unidad: consulta === "instituciones" ? "instituciones" : consulta === "relacionadas" ? "relaciones" : "hitos",
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );
}
