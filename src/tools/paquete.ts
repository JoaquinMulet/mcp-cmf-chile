import * as z from "zod/v4";
import { paqueteSchema, paqueteDocumentosSchema, fondosPaqueteSchema } from "../util/schemas-output.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { getLegacy, postLegacy, getLegacyBinario, postLegacyBinario, fetchCmfBinarioCached, type CmfEnv } from "../client/cmf-client.js";
import { fixMojibake, decodificarEntidades, htmlTablaAJson, xlsAJson } from "../client/parsers.js";
import { fromError, toolOk, resumirTabla } from "../util/errors.js";
import { barrerPeriodos, conSemafotoGlobal, estimarTiempoS, mb } from "../util/paquete.js";
import { carpetaEmpresa, extensionDeContentType, rutaUnica, tipoDocumento } from "../util/nombres.js";
import { construirZip, zipABase64, bytesABase64 } from "../util/zip.js";
import { anioSchema, mesSchema, rutSchema } from "../util/schemas.js";

const FICHA_BASE = "/institucional/mercados/entidad.php";

function fichaUrl(rut: string, pestania: number): string {
  return `${FICHA_BASE}?mercado=V&rut=${rut}&grupo=&tipoentidad=RVEMI&row=&vig=VI&control=svs&pestania=${pestania}`;
}

/** Info del emisor (razón social, nemo) con caché en memoria. */
async function infoEmisor(env: CmfEnv, rut: string): Promise<{ razonSocial: string; nemo: string }> {
  const html = await getLegacy(fichaUrl(rut, 1), {}, env);
  const filas = htmlTablaAJson(html);
  const get = (k: string) => {
    const fila = filas.find((f) => Object.values(f).some((v) => v.toLowerCase().includes(k.toLowerCase())));
    return fila ? (Object.values(fila)[1] ?? "") : "";
  };
  const razonSocial = get("Razón Social") || get("Razon Social") || "";
  const nemo = get("Nombre de Fantasía") || "";
  return { razonSocial, nemo };
}

/** Historial EEFF: años disponibles + aviso IFRS, con caché. */
async function historialEEFF(env: CmfEnv, rut: string): Promise<{ anios: string[]; inicioIfrs?: string; modalidad?: string }> {
  const html = await getLegacy(fichaUrl(rut, 3), {}, env);
  const aviso = html.match(/a partir de <strong>([\d/]+)<\/strong> en modalidad '<strong>([^<]+)<\/strong>'/);
  const anios = [...html.matchAll(/<option value="?(\d{4})"?\s*>(\d{4})/g)].map((m) => m[1]);
  return { anios, inicioIfrs: aviso?.[1], modalidad: aviso?.[2]?.trim() };
}

export interface DocumentoEEFF {
  nombre: string;
  url: string;
  indice: number;
}

/** EEFF de un período: tablas resumidas + documentos (nunca exponer auth/send al modelo). */
async function eeffPeriodo(
  env: CmfEnv,
  rut: string,
  aa: string,
  mm: string,
  tipo: string,
  norma: string,
): Promise<{ tablas: { codigo: string; titulo: string }[]; documentos: DocumentoEEFF[] }> {
  const html = await postLegacy(fichaUrl(rut, 3), { forma: "F", mm, aa, tipo, tipo_norma: norma }, env);
  const tablas: { codigo: string; titulo: string }[] = [];
  const idx = html.indexOf("VISUALIZACION ESTADOS FINANCIEROS");
  if (idx >= 0) {
    for (const t of html.slice(idx).split("<table>").slice(1)) {
      const codigo = t.match(/\[(\d{6})\]/);
      if (!codigo) continue;
      const titulo = fixMojibake(
        t
          .slice(0, t.indexOf("</th>") + 5)
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/^\[\d{6}\]\s*/, ""),
      );
      tablas.push({ codigo: codigo[1], titulo });
    }
  }
  const documentos: DocumentoEEFF[] = [];
  const reDoc = /href="(\.\.\/inc\/inf_financiera\/ifrs\/safec_ifrs_verarchivo\.php\?auth=[^"]+&send=[^"]+)"[^>]*>\s*([^<]{2,60})/g;
  let dm: RegExpExecArray | null;
  while ((dm = reDoc.exec(html)) !== null) {
    documentos.push({
      nombre: fixMojibake(dm[2].replace(/\s+/g, " ").trim()),
      url: `https://www.cmfchile.cl${dm[1].replace("../", "/institucional/")}`,
      indice: documentos.length,
    });
  }
  return { tablas, documentos };
}

/** Filas de una tabla con el link ver_sgd capturado por fila (header robusto). */
function filasConLinks(html: string, columnas: string[]): { fila: Record<string, string>; url?: string }[] {
  const out: { fila: Record<string, string>; url?: string }[] = [];
  const reRow = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = reRow.exec(html)) !== null) {
    const celdas: string[] = [];
    const reCelda = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = reCelda.exec(rm[1])) !== null) {
      celdas.push(decodificarEntidades(fixMojibake(cm[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())));
    }
    if (celdas.length === 0) continue;
    // Skip de header robusto: primera columna sin dígitos cuando se espera una fecha/número
    const cab = celdas[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    const esperada = columnas[0].toLowerCase().replace(/_/g, "");
    if (cab === esperada || (esperada.startsWith("fecha") && !/\d/.test(celdas[0]))) continue;
    const fila: Record<string, string> = {};
    celdas.forEach((c, i) => {
      if (i < columnas.length) fila[columnas[i]] = c;
    });
    const link = rm[1].match(/href="(\/sitio\/aplic\/serdoc\/ver_sgd\.php\?s567=[^"]+)"/);
    out.push({ fila, url: link ? `https://www.cmfchile.cl${link[1]}` : undefined });
  }
  return out;
}

const SECCIONES = ["eeff", "hechos", "sanciones", "resoluciones", "memoria", "asg"] as const;

export function registrarToolsPaquete(server: McpServer, env: CmfEnv): void {
  // ---------- A. cmf_empresa_paquete ----------

  server.registerTool(
    "cmf_empresa_paquete",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: paqueteSchema,
      title: "Paquete completo de una empresa (plan de descarga)",
      description:
        "Arma en UNA llamada el plan completo de descarga de una empresa: árbol de directorio lógico + manifest de documentos (EEFF, hechos, sanciones, resoluciones, memoria, ASG) con nombres de archivo normalizados. Máximo 2 años por llamada (límite del worker); use ventanas de años sucesivas para más historia. No incluye bytes; para descargarlos use cmf_empresa_paquete_documentos.",
      inputSchema: z.object({
        rut: rutSchema,
        anio_inicio: anioSchema.optional(),
        anio_fin: anioSchema.optional(),
        tipo: z.enum(["C", "I"]).default("C"),
        norma: z.enum(["IFRS", "NCH"]).default("IFRS"),
        secciones: z.array(z.enum(SECCIONES)).default(["eeff", "hechos", "sanciones", "resoluciones", "memoria"]),
        incluir_tablas: z.boolean().default(false),
      }),
    },
    async ({ rut, anio_inicio, anio_fin, tipo, norma, secciones, incluir_tablas }) => {
      return conSemafotoGlobal(async () => {
        try {
          const anioAct = new Date().getFullYear();
          const aIni = anio_inicio ? parseInt(anio_inicio, 10) : anioAct - 1;
          const aFin = anio_fin ? parseInt(anio_fin, 10) : anioAct;
          if (aIni > aFin) {
            return { content: [{ type: "text", text: `Rango invertido: anio_inicio (${aIni}) > anio_fin (${aFin}).` }], isError: true };
          }
          if (aFin - aIni > 1) {
            return {
              content: [{ type: "text", text: `Rango de años máximo 2 por llamada (pidió ${aIni}-${aFin}). Use ventanas de 2 años: ${aFin - 1}-${aFin}, luego ${aFin - 3}-${aFin - 2}, etc.` }],
              isError: true,
            };
          }

          const info = await infoEmisor(env, rut);
          const hist = await historialEEFF(env, rut);
          const carpeta = carpetaEmpresa(info.nemo, rut, info.razonSocial);
          const usadas = new Set<string>();
          const manifest: Record<string, unknown>[] = [];
          const arbol: Record<string, unknown> = {};
          let requests = 2;
          let tablasTotal = 0;
          let docsTotal = 0;
          let periodosProcesados = 0;
          let periodosConDatos = 0;

          const specs: { clave: string; tarea: () => Promise<void> }[] = [];

          const aniosRango: string[] = [];
          for (let aa = aFin; aa >= aIni; aa--) aniosRango.push(String(aa));

          if (secciones.includes("eeff")) {
            for (const aa of aniosRango) {
              for (const mm of ["03", "06", "09", "12"]) {
                specs.push({
                  clave: `eeff_${aa}${mm}`,
                  tarea: async () => {
                    const r = await eeffPeriodo(env, rut, aa, mm, tipo, norma);
                    periodosProcesados++;
                    const periodo = `${aa}${mm}`;
                    const nodoEeff = (arbol[carpeta] as Record<string, unknown>) ?? {};
                    arbol[carpeta] = nodoEeff;
                    const nodoEeffPeriodos = (nodoEeff.eeff as Record<string, unknown>) ?? {};
                    nodoEeff.eeff = nodoEeffPeriodos;
                    const docsDelPeriodo: string[] = [];
                    if (r.tablas.length) {
                      periodosConDatos++;
                      tablasTotal += r.tablas.length;
                      nodoEeffPeriodos[periodo] = {
                        tablas: r.tablas.map((t) => `[${t.codigo}] ${t.titulo}`).slice(0, incluir_tablas ? 12 : 5),
                      };
                    }
                    for (const d of r.documentos) {
                      const ruta = rutaUnica(`${carpeta}/eeff/${periodo}/${tipoDocumento(d.nombre)}_${periodo}${extensionDeContentType("pdf")}`, usadas);
                      docsDelPeriodo.push(ruta);
                      manifest.push({ ruta, tipo: tipoDocumento(d.nombre), periodo, tamano_kb: null, estado: "ok" });
                      docsTotal++;
                    }
                    if (docsDelPeriodo.length) {
                      const nodo = (nodoEeffPeriodos[periodo] as Record<string, unknown>) ?? {};
                      nodo.documentos = docsDelPeriodo;
                      nodoEeffPeriodos[periodo] = nodo;
                    }
                  },
                });
              }
            }
          }

          const colsHechos = ["fecha_hora", "numero", "entidad", "materia"];
          if (secciones.includes("hechos")) {
            for (const aa of aniosRango) {
              specs.push({
                clave: `hechos_${aa}`,
                tarea: async () => {
                  const html = await postLegacy(
                    fichaUrl(rut, 25),
                    { dd: "01", mm: "01", aa, dd2: "31", mm2: "12", aa2: aa, rut, formulario: 1 },
                    env,
                  );
                  const filas = filasConLinks(html, colsHechos);
                  for (const { fila, url } of filas) {
                    if (!fila.fecha_hora || !url) continue;
                    const ruta = rutaUnica(`${carpeta}/hechos/${aa}/hechos_relevantes_${(fila.fecha_hora ?? "").replace(/[^\d]/g, "").slice(0, 12)}_${fila.numero || "s"}.pdf`, usadas);
                    manifest.push({ ruta, tipo: "hechos_relevantes", periodo: aa, tamano_kb: null, estado: "ok", materia: (fila.materia ?? "").slice(0, 60) });
                    docsTotal++;
                  }
                },
              });
            }
          }

          if (secciones.includes("sanciones")) {
            for (const aa of aniosRango) {
              specs.push({
                clave: `sanciones_${aa}`,
                tarea: async () => {
                  const html = await getLegacy(`${fichaUrl(rut, 36)}&fecha_inicio=01/01/${aa}&fecha_fin=31/12/${aa}&formulario=1`, {}, env);
                  const filas = filasConLinks(html, ["numero", "fecha", "materia"]);
                  for (const { fila, url } of filas) {
                    if (!fila.fecha || !url) continue;
                    const ruta = rutaUnica(`${carpeta}/sanciones/${aa}/sancion_${(fila.fecha ?? "").replace(/[^\d]/g, "").slice(0, 8)}_${fila.numero || "s"}.pdf`, usadas);
                    manifest.push({ ruta, tipo: "sancion", periodo: aa, tamano_kb: null, estado: "ok" });
                    docsTotal++;
                  }
                },
              });
            }
          }

          if (secciones.includes("resoluciones")) {
            for (const aa of aniosRango) {
              specs.push({
                clave: `resoluciones_${aa}`,
                tarea: async () => {
                  const html = await getLegacy(`${fichaUrl(rut, 37)}&fecha_inicio=01/01/${aa}&fecha_fin=31/12/${aa}&formulario=1`, {}, env);
                  const filas = filasConLinks(html, ["numero", "fecha", "materia"]);
                  for (const { fila, url } of filas) {
                    if (!fila.fecha || !url) continue;
                    const ruta = rutaUnica(`${carpeta}/resoluciones/${aa}/resolucion_${(fila.fecha ?? "").replace(/[^\d]/g, "").slice(0, 8)}_${fila.numero || "s"}.pdf`, usadas);
                    manifest.push({ ruta, tipo: "resolucion", periodo: aa, tamano_kb: null, estado: "ok" });
                    docsTotal++;
                  }
                },
              });
            }
          }

          if (secciones.includes("memoria")) {
            for (const aa of aniosRango) {
              specs.push({
                clave: `memoria_${aa}`,
                tarea: async () => {
                  const html = await postLegacy(fichaUrl(rut, 49), { aa }, env);
                  const filas = htmlTablaAJson(html);
                  if (filas.length) {
                    const ruta = rutaUnica(`${carpeta}/memorias/memoria_anual_${aa}.pdf`, usadas);
                    manifest.push({ ruta, tipo: "memoria_anual", periodo: aa, tamano_kb: null, estado: "ok" });
                    docsTotal++;
                  }
                },
              });
            }
          }

          if (secciones.includes("asg")) {
            for (const aa of aniosRango) {
              specs.push({
                clave: `asg_${aa}`,
                tarea: async () => {
                  const html = await postLegacy(fichaUrl(rut, 110), { aa, mm: "12", t_inf: "1" }, env);
                  const filas = htmlTablaAJson(html);
                  if (filas.length) {
                    const ruta = rutaUnica(`${carpeta}/asg/asg_memoria_integrada_${aa}.pdf`, usadas);
                    manifest.push({ ruta, tipo: "asg", periodo: aa, tamano_kb: null, estado: "ok" });
                    docsTotal++;
                  }
                },
              });
            }
          }

          requests += specs.length;
          const { ok, fallidos } = await barrerPeriodos(specs, 3);
          // Marcar fallos en el manifest (todas las claves: eeff_, hechos_, sanciones_, resoluciones_, memoria_, asg_)
          const clavesFallo = new Set(fallidos.map((f) => f.clave));
          for (const m of manifest) {
            const prefijo = ["hechos", "sanciones", "resoluciones", "memoria", "asg"].find((s) =>
              clavesFallo.has(`${s}_${m.periodo}`),
            );
            const tipo = String(m.tipo ?? "");
            const base = prefijo ? prefijo.replace("hechos", "hechos_relevantes").replace(/es$/, "") : "";
            if (prefijo && tipo.startsWith(base)) m.estado = "fallo";
            else if (clavesFallo.has(`eeff_${m.periodo}`)) m.estado = "fallo";
          }

          const lineas = [`Paquete de ${info.razonSocial || rut} (${carpeta}):`];
          if (secciones.includes("eeff")) {
            lineas.push(
              `- Períodos EEFF ${aIni}-${aFin} (${tipo}/${norma}): ${periodosProcesados} procesados, ${periodosConDatos} con datos, tablas: ${tablasTotal}`,
            );
          }
          lineas.push(
            `- Documentos en manifest: ${docsTotal}`,
            `- Requests CMF: ~${requests} (≈${estimarTiempoS(requests)}s)`,
            `- Fallidos: ${fallidos.length ? fallidos.map((f) => `${f.clave}: ${f.motivo}`).join("; ") : "ninguno"}`,
            `- Para descargar los ${docsTotal} documentos use cmf_empresa_paquete_documentos con el mismo rango.`,
          );
          const texto = lineas.join("\n");

          return toolOk(texto, {
            empresa: { razon_social: info.razonSocial, nemo: info.nemo, rut, carpeta, inicio_ifrs: hist.inicioIfrs, modalidad: hist.modalidad },
            arbol,
            manifest,
            resumen: {
              periodos_procesados: periodosProcesados,
              periodos_con_datos: periodosConDatos,
              tablas_eeff: tablasTotal,
              documentos: docsTotal,
              requests_cmf: requests,
              tiempo_estimado_s: estimarTiempoS(requests),
              ok: ok.length,
              fallidos,
            },
          });
        } catch (e) {
          return fromError(e);
        }
      });
    },
  );

  // ---------- B. cmf_empresa_paquete_documentos ----------

  server.registerTool(
    "cmf_empresa_paquete_documentos",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: paqueteDocumentosSchema,
      title: "Descargar documentos de una empresa (ZIP ordenado)",
      description:
        "Descarga los documentos de una empresa en un rango (EEFF por período; hechos, sanciones, resoluciones, memoria por año) devolviéndolos como ZIP en base64 con directorio lógico y nombres normalizados (incluye manifiesto.json). Límites por llamada: máx 3 períodos EEFF (los más recientes del rango, o la lista `periodos` AAAAMM) + 2 años para las demás secciones; max_documentos y max_mb agregados. Los tokens firmados se gestionan en el servidor (nunca se exponen).",
      inputSchema: z.object({
        rut: rutSchema,
        anio_inicio: anioSchema.optional(),
        anio_fin: anioSchema.optional(),
        periodos: z
          .array(z.string().regex(/^\d{6}$/, "Corte en formato AAAAMM"))
          .max(3)
          .optional()
          .describe("Cortes EEFF explícitos AAAAMM (máx 3). Si no se entregan, se usan los 3 períodos más recientes del rango"),
        secciones: z.array(z.enum(["eeff", "hechos", "sanciones", "resoluciones", "memoria"])).default(["eeff"]),
        tipo: z.enum(["C", "I"]).default("C"),
        norma: z.enum(["IFRS", "NCH"]).default("IFRS"),
        max_documentos: z.number().int().min(1).max(24).default(12),
        max_mb: z.number().min(1).max(50).default(10),
        incluir_zip: z.boolean().default(true),
      }),
    },
    async ({ rut, anio_inicio, anio_fin, periodos, secciones, tipo, norma, max_documentos, max_mb, incluir_zip }) => {
      return conSemafotoGlobal(async () => {
        try {
          const anioAct = new Date().getFullYear();
          const aIni = anio_inicio ? parseInt(anio_inicio, 10) : anioAct - 1;
          const aFin = anio_fin ? parseInt(anio_fin, 10) : anioAct;
          if (aIni > aFin) {
            return { content: [{ type: "text", text: `Rango invertido: anio_inicio (${aIni}) > anio_fin (${aFin}).` }], isError: true };
          }
          if (aFin - aIni > 1) {
            return {
              content: [{ type: "text", text: `Máximo 2 años por llamada (pidió ${aIni}-${aFin}). Use ventanas de 2 años.` }],
              isError: true,
            };
          }

          const info = await infoEmisor(env, rut);
          const carpeta = carpetaEmpresa(info.nemo, rut, info.razonSocial);
          const usadas = new Set<string>();
          const descargados: Record<string, unknown>[] = [];
          const bytesPorRuta = new Map<string, Uint8Array>();
          const faltantes: { ruta: string; motivo: string }[] = [];
          let totalBytes = 0;
          let omitidosPorTamano = 0;
          let omitidosPorLimite = 0;
          let requests = 1;
          const resumenExtra: { periodos_eeff_omitidos?: string[]; periodos_eeff_sin_datos?: string[] } = {};

          const aniosRango: string[] = [];
          for (let aa = aFin; aa >= aIni; aa--) aniosRango.push(String(aa));

          const specs: { clave: string; tarea: () => Promise<void> }[] = [];

          const bajarDoc = async (ruta: string, url: string, cacheClave: string, seccion: string) => {
            // Chequeo previo (fast path) y chequeo definitivo post-await (evita race entre workers)
            if (descargados.length >= max_documentos) {
              omitidosPorLimite++;
              return;
            }
            try {
              const { bytes, contentType } = await fetchCmfBinarioCached(url, cacheClave, env);
              requests++;
              const tam = bytes.length;
              if (descargados.length >= max_documentos) {
                omitidosPorLimite++;
                return;
              }
              if (totalBytes + tam > max_mb * 1024 * 1024) {
                omitidosPorTamano++;
                return;
              }
              totalBytes += tam;
              const ext = extensionDeContentType(contentType);
              const rutaFinal = rutaUnica(ruta + ext, usadas);
              bytesPorRuta.set(rutaFinal, bytes);
              const truncado = tam > 4 * 1024 * 1024;
              const base64 = bytesABase64(bytes.subarray(0, Math.min(bytes.length, 4 * 1024 * 1024)));
              descargados.push({
                ruta: rutaFinal,
                nombre: rutaFinal.split("/").pop(),
                tamano_kb: Math.round(tam / 1024),
                estado: "ok",
                base64,
                base64_truncado: truncado,
                seccion,
              });
            } catch {
              faltantes.push({ ruta, motivo: "descarga_fallida" });
            }
          };

          if (secciones.includes("eeff")) {
            // Cortes EEFF: lista explícita (máx 3) o barrido del rango descargando hasta 3 períodos con datos
            const rangoCompleto: string[] = [];
            for (let aa = aFin; aa >= aIni; aa--) {
              for (const mm of ["03", "06", "09", "12"]) rangoCompleto.push(`${aa}${mm}`);
            }
            const cortes = periodos && periodos.length ? periodos.slice(0, 3) : rangoCompleto;
            const cortesConDatos = new Set<string>();
            for (const corte of cortes) {
              const aa = corte.slice(0, 4);
              const mm = corte.slice(4, 6);
              specs.push({
                clave: `eeff_${corte}`,
                tarea: async () => {
                  const periodo = `${aa}${mm}`;
                  const { documentos } = await eeffPeriodo(env, rut, aa, mm, tipo, norma);
                  requests++;
                  if (documentos.length === 0) {
                    (resumenExtra.periodos_eeff_sin_datos ??= []).push(periodo);
                    return;
                  }
                  if (cortesConDatos.size >= 3) {
                    (resumenExtra.periodos_eeff_omitidos ??= []).push(periodo);
                    return;
                  }
                  cortesConDatos.add(periodo);
                  for (const d of documentos) {
                    await bajarDoc(
                      `${carpeta}/eeff/${periodo}/${tipoDocumento(d.nombre)}_${periodo}`,
                      d.url,
                      `doc:${rut}:${periodo}:${tipo}:${norma}:${d.indice}`,
                      "eeff",
                    );
                  }
                },
              });
            }
          }

          if (secciones.includes("hechos")) {
            for (const aa of aniosRango) {
              specs.push({
                clave: `hechos_${aa}`,
                tarea: async () => {
                  const html = await postLegacy(
                    fichaUrl(rut, 25),
                    { dd: "01", mm: "01", aa, dd2: "31", mm2: "12", aa2: aa, rut, formulario: 1 },
                    env,
                  );
                  requests++;
                  const filas = filasConLinks(html, ["fecha_hora", "numero", "entidad", "materia"]);
                  let i = 0;
                  for (const { fila, url } of filas) {
                    if (!fila.fecha_hora || !url) continue;
                    i++;
                    await bajarDoc(
                      `${carpeta}/hechos/${aa}/hechos_relevantes_${(fila.fecha_hora ?? "").replace(/[^\d]/g, "").slice(0, 12)}_${fila.numero || i}`,
                      url,
                      `doc:${rut}:hechos:${aa}:${i}`,
                      "hechos",
                    );
                  }
                },
              });
            }
          }

          if (secciones.includes("sanciones")) {
            for (const aa of aniosRango) {
              specs.push({
                clave: `sanciones_${aa}`,
                tarea: async () => {
                  const html = await getLegacy(`${fichaUrl(rut, 36)}&fecha_inicio=01/01/${aa}&fecha_fin=31/12/${aa}&formulario=1`, {}, env);
                  requests++;
                  const filas = filasConLinks(html, ["numero", "fecha", "materia"]);
                  let i = 0;
                  for (const { fila, url } of filas) {
                    if (!fila.fecha || !url) continue;
                    i++;
                    await bajarDoc(
                      `${carpeta}/sanciones/${aa}/sancion_${(fila.fecha ?? "").replace(/[^\d]/g, "").slice(0, 8)}_${fila.numero || i}`,
                      url,
                      `doc:${rut}:sanciones:${aa}:${i}`,
                      "sanciones",
                    );
                  }
                },
              });
            }
          }

          if (secciones.includes("resoluciones")) {
            for (const aa of aniosRango) {
              specs.push({
                clave: `resoluciones_${aa}`,
                tarea: async () => {
                  const html = await getLegacy(`${fichaUrl(rut, 37)}&fecha_inicio=01/01/${aa}&fecha_fin=31/12/${aa}&formulario=1`, {}, env);
                  requests++;
                  const filas = filasConLinks(html, ["numero", "fecha", "materia"]);
                  let i = 0;
                  for (const { fila, url } of filas) {
                    if (!fila.fecha || !url) continue;
                    i++;
                    await bajarDoc(
                      `${carpeta}/resoluciones/${aa}/resolucion_${(fila.fecha ?? "").replace(/[^\d]/g, "").slice(0, 8)}_${fila.numero || i}`,
                      url,
                      `doc:${rut}:resoluciones:${aa}:${i}`,
                      "resoluciones",
                    );
                  }
                },
              });
            }
          }

          if (secciones.includes("memoria")) {
            for (const aa of aniosRango) {
              specs.push({
                clave: `memoria_${aa}`,
                tarea: async () => {
                  const html = await postLegacy(fichaUrl(rut, 49), { aa }, env);
                  requests++;
                  const filas = filasConLinks(html, ["nombre", "fecha"]);
                  let i = 0;
                  for (const { url } of filas) {
                    if (!url) continue;
                    i++;
                    await bajarDoc(`${carpeta}/memorias/memoria_anual_${aa}_${i}`, url, `doc:${rut}:memoria:${aa}:${i}`, "memoria");
                  }
                },
              });
            }
          }

          const { fallidos: fallosSecciones } = await barrerPeriodos(specs, 2);
          faltantes.push(...fallosSecciones.map((f) => ({ ruta: f.clave, motivo: f.motivo })));

          let zip: { nombre: string; base64: string; tamano_mb: number; archivos: number; faltantes: number } | undefined;
          if (incluir_zip && descargados.length > 0) {
            const zipEntries: { ruta: string; bytes: Uint8Array }[] = [];
            for (const d of descargados) {
              const bytes = bytesPorRuta.get(d.ruta as string);
              if (bytes) zipEntries.push({ ruta: d.ruta as string, bytes });
              else faltantes.push({ ruta: d.ruta as string, motivo: "no_en_memoria" });
            }
            const manifiesto = JSON.stringify(
              { empresa: { rut, carpeta }, generado: new Date().toISOString(), descargados: descargados.map((d) => ({ ruta: d.ruta, tamano_kb: d.tamano_kb, seccion: d.seccion })), faltantes },
              null,
              2,
            );
            zipEntries.push({ ruta: `${carpeta}/manifiesto.json`, bytes: new TextEncoder().encode(manifiesto) });
            const zipBytes = construirZip(zipEntries);
            zip = {
              nombre: `${carpeta}_paquete.zip`,
              base64: zipABase64(zipBytes),
              tamano_mb: mb(zipBytes.length),
              archivos: zipEntries.length,
              faltantes: faltantes.length,
            };
          }

          const resumen = {
            ok: descargados.length,
            fallidos: faltantes,
            total_mb: mb(totalBytes),
            omitidos_por_tamano: omitidosPorTamano,
            omitidos_por_limite: omitidosPorLimite,
            requests_cmf: requests,
            tiempo_estimado_s: estimarTiempoS(requests),
            ...resumenExtra,
          };

          const texto = [
            `Documentos de ${info.razonSocial || rut}: ${descargados.length} descargados (${mb(totalBytes)}MB), ${faltantes.length} fallidos, ${omitidosPorLimite} omitidos por límite, ${omitidosPorTamano} por tamaño.`,
            zip ? `ZIP: ${zip.nombre} (${zip.tamano_mb}MB, ${zip.archivos} archivos, incluye manifiesto.json).` : "Sin ZIP.",
            `Requests CMF: ~${requests} (≈${estimarTiempoS(requests)}s).`,
            faltantes.length ? `Fallidos: ${faltantes.map((f) => `${f.ruta}: ${f.motivo}`).join("; ")}` : "",
          ].join("\n");

          return toolOk(texto, { empresa: { rut, carpeta }, descargados, resumen, zip });
        } catch (e) {
          return fromError(e);
        }
      });
    },
  );

  // ---------- C. cmf_fondos_paquete_mensual ----------

  server.registerTool(
    "cmf_fondos_paquete_mensual",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosPaqueteSchema,
      title: "Boletines mensuales del sistema de Fondos Mutuos",
      description:
        "Una sola llamada con los boletines del sistema de fondos mutuos de un mes: patrimonio/rentabilidad (BPR), costos TAC, comisiones e inversiones. Resumen por sección (use las tools individuales para el detalle completo).",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema,
        secciones: z
          .array(z.enum(["bpr", "costos", "comisiones", "inversiones_nacio", "inversiones_inter"]))
          .default(["bpr", "costos", "comisiones"]),
        max_filas: z.number().int().min(5).max(100).default(20),
      }),
    },
    async ({ anio, mes, secciones, max_filas }) => {
      return conSemafotoGlobal(async () => {
        try {
          const specs: { clave: string; tarea: () => Promise<{ nombre: string; filas: Record<string, unknown>[]; total: number }> }[] = [];

          const seccionDefs: Record<string, () => Promise<Record<string, unknown>[]>> = {
            bpr: async () => {
              const res = await getLegacyBinario(
                "/institucional/estadisticas/fm.fm_bpr.php",
                { out: "excel", admins: "0", tipofondo: "0", moneda: "0", mes_peri: mes, anio_peri: anio },
                env,
              );
              return xlsAJson(res);
            },
            costos: async () => {
              const res = await postLegacyBinario(
                "/institucional/estadisticas/fmdfm_excel2.php",
                { admins: "0", tipofondo: "0", moneda: "0", mes2: mes, anno2: anio },
                env,
                { lang: "es" },
              );
              return xlsAJson(res);
            },
            comisiones: async () => {
              const res = await getLegacyBinario(
                "/institucional/estadisticas/fm.fm_comision.php",
                { out: "excel", admins: "0", tipofondo: "0", moneda: "0", mes, anio },
                env,
              );
              return xlsAJson(res);
            },
            inversiones_nacio: async () => {
              const res = await getLegacyBinario(
                "/institucional/estadisticas/fm.inversiones_nacio.php",
                { out: "excel", consulta: "fondos", admins: "0", tipofondo: "0", moneda: "0", mes, anio },
                env,
              );
              return xlsAJson(res);
            },
            inversiones_inter: async () => {
              const res = await getLegacyBinario(
                "/institucional/estadisticas/fm.inversiones_inter.php",
                { out: "excel", consulta: "fondos", admins: "0", tipofondo: "0", moneda: "0", mes, anio },
                env,
              );
              return xlsAJson(res);
            },
          };

          for (const s of secciones) {
            specs.push({
              clave: s,
              tarea: async () => {
                const filas = await seccionDefs[s]();
                return { nombre: s, filas: filas.slice(0, max_filas), total: filas.length };
              },
            });
          }

          const { ok, fallidos } = await barrerPeriodos(specs, 2);
          const texto = [
            `Boletines FM ${anio}-${mes}:`,
            ...ok.map((s) =>
              s.total === 0
                ? `- ${s.nombre}: 0 filas (el boletín no trae datos para este mes o cambió su formato: verifícalo en cmfchile.cl)`
                : `- ${s.nombre}: ${s.total} filas (mostrando ${s.filas.length})`,
            ),
            fallidos.length ? `Fallidos: ${fallidos.map((f) => `${f.clave}: ${f.motivo}`).join("; ")}` : "",
          ].join("\n");

          return toolOk(texto, {
            anio,
            mes,
            secciones: ok.map((s) => ({ nombre: s.nombre, total: s.total, filas: s.filas })),
            fallidos,
            requests_cmf: ok.length + fallidos.length,
            tiempo_estimado_s: estimarTiempoS(ok.length + fallidos.length),
          });
        } catch (e) {
          return fromError(e);
        }
      });
    },
  );
}
