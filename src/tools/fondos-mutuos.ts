import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { fondosSchema, comisionesMaximasSchema } from "../util/schemas-output.js";
import { postLegacy, postLegacyConCookies, getLegacyBinario, postLegacyBinario, type CmfEnv } from "../client/cmf-client.js";
import { pedirCaptchaCMF, obtenerCaptcha, ultimoCaptcha, consumirCaptcha } from "../captcha.js";
import { xlsAJson, txtCsvAJson, htmlTablaAJson } from "../client/parsers.js";
import { fromError, toolError, toolErrorFuente, toolOk, resumirTabla } from "../util/errors.js";
import { paginar } from "../util/paginate.js";
import { avisoDeTramo, paginacion, toolOkPaginado, toolOkTabla } from "../util/tramos.js";
import {
  anioSchema, carteraSchema, fechaSchema, mesSchema, offsetSchema, limitSchema, codigoSchema, enumTolerante } from "../util/schemas.js";

/** Descarga y parsea el catálogo completo de FM (fm_ident2) con caché en KV (24h) cuando está disponible. */
async function catalogoFondosMutuos(env: CmfEnv): Promise<Record<string, unknown>[]> {
  const clave = "catalogo:fm_ident_v1";
  if (env.CMF_KV) {
    const raw = await env.CMF_KV.get(clave);
    if (raw) {
      try {
        return JSON.parse(raw) as Record<string, unknown>[];
      } catch {
        /* re-descargar */
      }
    }
  }
  const res = await postLegacy("/institucional/estadisticas/fm_ident2.php", {}, env);
  const filas = txtCsvAJson(res) as unknown as Record<string, unknown>[];
  if (env.CMF_KV) {
    await env.CMF_KV.put(clave, JSON.stringify(filas), { expirationTtl: 86_400 });
  }
  return filas;
}

export function registrarToolsFondosMutuos(server: McpServer, env: CmfEnv): void {
  server.registerTool(
    "cmf_fondos_mutuos_catalogo",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      title: "Catálogo de Fondos Mutuos",
      description:
        "Devuelve el catálogo completo de fondos mutuos de la CMF (RUT administradora, RUN fondo, nombre, tipo de fondo, moneda, fechas de inicio/término), filtrable por nombre y tipo y paginado con offset/limit. Use esta tool para encontrar el RUN de un fondo antes de consultar su cartola (cmf_fondos_mutuos_cartola) o su cartera (cmf_fondos_mutuos_cartera). Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        nombre: z.string().optional().describe("Filtro por nombre del fondo (parcial)"),
        tipo: z.string().optional().describe("Filtro por tipo de fondo: compara el CÓDIGO numérico (0-8), no el nombre"),
        offset: offsetSchema,
        limit: limitSchema,
      }),
      outputSchema: z.object({
        fondos: z.array(z.record(z.string(), z.unknown())),
        total: z.number(),
        next_offset: z.number().nullable(),
      }).passthrough(),
    },
    async ({ nombre, tipo, offset, limit }) => {
      try {
        let filas = await catalogoFondosMutuos(env);
        if (nombre) {
          const q = nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          filas = filas.filter((f) =>
            String(f.nombre_fondo ?? "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .includes(q),
          );
        }
        if (tipo) filas = filas.filter((f) => String(f.tipo_fondo ?? "").includes(tipo));
        const { filas: fondos, paginado } = paginar(filas, offset, limit);
        const texto = fondos.length
          ? `Fondos mutuos (total ${paginado.total}):\n${resumirTabla(fondos, ["run_fondo", "nombre_fondo", "tipo_fondo", "moneda", "rut_admin"])}`
          : "Sin fondos mutuos que coincidan.";
        return toolOk(texto + avisoDeTramo(fondos.length, paginado, "cmf_fondos_mutuos_catalogo"), { fondos, total: paginado.total, next_offset: paginado.next_offset });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_cartera",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Cartera de inversiones de Fondos Mutuos",
      description:
        "Descarga la cartera de inversiones de fondos mutuos de la CMF para un mes: posiciones por instrumento de cada fondo (columnas con códigos de la Circular 1333). Requiere cartera (NACI=nacional, EXTR=extranjera, OPCI=opciones, FUTU=futuros, OPLA=opciones largo plazo), anio en AAAA y mes en MM; la salida trae total y las primeras 50 filas de ejemplo. Use esta tool para ver las posiciones que componen cada fondo; para agregados por emisor/país use cmf_fondos_mutuos_inversiones. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema,
        cartera: carteraSchema,
        ...paginacion(50),
      }),
    },
    async ({ anio, mes, cartera , offset, limit }) => {
      try {
        const res = await postLegacy(
          "/institucional/estadisticas/ffm_download.php",
          { aa: anio, mm: mes, cartera, enviar: "", btnConsulta: "GENERAR ARCHIVO" },
          env,
        );
        const filas = txtCsvAJson(res);
        return toolOkTabla({
          titulo: `Cartera ${cartera} ${anio}-${mes}`,
          vacio: `Sin cartera ${cartera} para ${anio}-${mes}.`,
          base: { anio, mes, cartera },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_fondos_mutuos_cartera",
          unidad: "fondos con posiciones",
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_comisiones",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Comisiones y remuneraciones de FM",
      description:
        "Descarga la estructura de comisiones de fondos mutuos de la CMF: comisión de colocación, remuneración de administración y gastos de operación por fondo/serie. Filtre por anio en AAAA, mes en MM (default 12), admin (RUT de administradora, 0=todas), tipo_fondo (0-8, 0=todos) y moneda (0=todas, $$, PROM o EUR). Use esta tool para comparar cobros entre fondos; para el costo total anual (TAC) use cmf_fondos_mutuos_costos. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema.optional(),
        admin: z.string().optional().describe("RUT de administradora (0=todas)"),
        tipo_fondo: z.string().optional().describe("Código de tipo de fondo (0=todos, 1-8 según la clasificación de la CMF)"),
        moneda: z.enum(["0", "$$", "PROM", "EUR"]).optional().describe("Moneda: 0=todas, $$=pesos chilenos, PROM=promedio, EUR=euros"),
        ...paginacion(50),
      }),
    },
    async ({ anio, mes, admin, tipo_fondo, moneda , offset, limit }) => {
      try {
        const res = await getLegacyBinario(
          "/institucional/estadisticas/fm.fm_comision.php",
          { out: "excel", admins: admin ?? "0", tipofondo: tipo_fondo ?? "0", moneda: moneda ?? "0", mes: mes ?? "12", anio },
          env,
        );
        const filas = xlsAJson(res);
        return toolOkTabla({
          titulo: `Comisiones FM ${anio}-${mes ?? "12"}`,
          vacio: `Sin comisiones para ${anio}-${mes}.`,
          base: { anio, mes },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_fondos_mutuos_comisiones",
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_inversiones",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Inversiones de Fondos Mutuos",
      description:
        "Descarga las inversiones de fondos mutuos de la CMF por período, en instrumentos nacionales o extranjeros, agregadas según el nivel pedido. Requiere anio en AAAA, tipo (nacio=nacionales, inter=extranjeros; default nacio) y consulta (fondos, default; emisores o pais_transaccion); mes en MM opcional (default 12). Use esta tool para agregados de inversión; para el detalle de la cartera por fondo use cmf_fondos_mutuos_cartera. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema.optional(),
        tipo: z.enum(["nacio", "inter"]).default("nacio").describe("Ámbito de inversión: nacio=nacionales, inter=extranjeros (default nacio)"),
        consulta: z.enum(["fondos", "emisores", "pais_transaccion"]).optional().describe("Nivel de agregación: fondos, emisores o pais_transaccion (default fondos)"),
        ...paginacion(50),
      }),
    },
    async ({ anio, mes, tipo, consulta , offset, limit }) => {
      try {
        const path =
          tipo === "nacio"
            ? "/institucional/estadisticas/fm.inversiones_nacio.php"
            : "/institucional/estadisticas/fm.inversiones_inter.php";
        const res = await getLegacyBinario(
          path,
          { out: "excel", lang: "es", consulta: consulta ?? "fondos", admins: "0", tipofondo: "0", moneda: "0", mes: mes ?? "12", anio, tipoinversion: tipo === "nacio" ? "naci" : "inter", ...(tipo === "nacio" ? { eminaci: "0" } : { eminter: "0" }) },
          env,
        );
        const filas = xlsAJson(res);
        if (filas.length === 0) {
          return toolErrorFuente(
            `Inversiones ${tipo} de fondos mutuos ${anio}-${mes ?? "12"}`,
            `https://www.cmfchile.cl/institucional/estadisticas/fm.inversiones_${tipo}.php`,
          );
        }
        return toolOkTabla({
          titulo: `Inversiones ${tipo} FM ${anio}-${mes ?? "12"}`,
          vacio: `Sin inversiones para ${anio}-${mes}.`,
          base: { anio, mes, tipo },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_fondos_mutuos_inversiones",
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_bpr",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Patrimonio, rentabilidad y partícipes de FM",
      description:
        "Descarga el Boletín de Patrimonio y Rentabilidad (BPR) de fondos mutuos de la CMF: patrimonio, variación, rentabilidad nominal mensual, número de partícipes y valor cuota por serie. Filtre por anio en AAAA, mes en MM (default 12) y admin (RUT de administradora; omitir = todas). Use esta tool para datos por serie; para el agregado del sistema use cmf_fondos_mutuos_antecedentes. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema.optional(),
        admin: z.string().optional().describe("RUT de administradora (omitir = todas)"),
        ...paginacion(50),
      }),
    },
    async ({ anio, mes, admin , offset, limit }) => {
      try {
        const res = await getLegacyBinario(
          "/institucional/estadisticas/fm.fm_bpr.php",
          { out: "excel", admins: admin ?? "0", tipofondo: "0", moneda: "0", mes_peri: mes ?? "12", anio_peri: anio },
          env,
        );
        const filas = xlsAJson(res);
        return toolOkTabla({
          titulo: `BPR FM ${anio}-${mes ?? "12"}`,
          vacio: `Sin BPR para ${anio}-${mes}.`,
          base: { anio, mes },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_fondos_mutuos_bpr",
          columnas: ["Run Fondo", "Nombre Fondo", "Patrimonio", "Valor cuota", "Partícipes", "Rentabilidad nominal mensual"],
          unidad: "series",
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_costos",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Cuadro de costos de FM (TAC)",
      description:
        "Descarga el cuadro estadístico de costos de fondos mutuos de la CMF: remuneración fija/variable, gastos de operación y TAC (costo total anual) por serie. Filtre por anio en AAAA, mes en MM (default 12) y admin (RUT de administradora; omitir = todas). Use esta tool para comparar el costo total anual entre series; para la estructura de comisiones de colocación use cmf_fondos_mutuos_comisiones. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez.",
      inputSchema: z.object({
        anio: anioSchema,
        mes: mesSchema.optional(),
        admin: z.string().optional().describe("RUT de administradora (omitir = todas)"),
        ...paginacion(50),
      }),
    },
    async ({ anio, mes, admin , offset, limit }) => {
      try {
        const res = await postLegacyBinario(
          "/institucional/estadisticas/fmdfm_excel2.php",
          { admins: admin ?? "0", tipofondo: "0", moneda: "0", mes2: mes ?? "12", anno2: anio },
          env,
          { lang: "es" },
        );
        const filas = xlsAJson(res);
        return toolOkTabla({
          titulo: `Costos FM ${anio}-${mes ?? "12"}`,
          vacio: `Sin costos para ${anio}-${mes}.`,
          base: { anio, mes },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_fondos_mutuos_costos",
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_antecedentes",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Antecedentes generales del sistema FM",
      description:
        "Devuelve los antecedentes generales del sistema de fondos mutuos de la CMF: número de administradoras y fondos, patrimonio total y partícipes (corte a diciembre de cada año). Filtre por anio en AAAA (opcional; default 2025). Use esta tool para la evolución agregada del sistema; para datos por fondo use cmf_fondos_mutuos_bpr. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez.",
      inputSchema: z.object({ anio: anioSchema.optional(), ...paginacion(50) }),
    },
    async ({ anio , offset, limit }) => {
      try {
        const res = await getLegacyBinario(
          "/institucional/estadisticas/fm.ffmm_agenerales.php",
          { out: "excel", lang: "es", filtertipofondo: "0", filtermoneda: "0", moneda: "0", mes: anio ? "12" : "12", anio: anio ?? "2025" },
          env,
        );
        const filas = xlsAJson(res);
        return toolOkTabla({
          titulo: `Antecedentes generales FM`,
          vacio: "Sin antecedentes.",
          base: {},
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_fondos_mutuos_antecedentes",
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_mutuos_cartola",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: fondosSchema("filas"),
      title: "Cartola diaria de Fondos Mutuos",
      description:
        "Devuelve la cartola diaria de un fondo mutuo de la CMF (valor cuota, patrimonio y partícipes por día) para un rango de fechas. Requiere el RUN del fondo (búsquelo con cmf_fondos_mutuos_catalogo) y captcha de la CMF: si no se entrega el código de 6 caracteres, la tool lo solicitará para reintentar. Use esta tool para la evolución diaria de un fondo; para datos mensuales por serie use cmf_fondos_mutuos_bpr. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.",
      inputSchema: z.object({
        fondo: codigoSchema.describe("RUN del fondo (búsquelo con cmf_fondos_mutuos_catalogo); acepta 8298 o '8298'"),
        desde: fechaSchema.describe("Fecha inicial en YYYY-MM-DD (acepta DD/MM/AAAA). Ej: 2026-01-01"),
        hasta: fechaSchema.describe("Fecha final en YYYY-MM-DD (acepta DD/MM/AAAA). Ej: 2026-01-31"),
        captcha: z.string().length(6).optional().describe("Código captcha de 6 caracteres (si no lo tiene, la tool le indicará dónde ver la imagen)"),
        captcha_id: z.string().optional().describe("Id del captcha que la tool le entregó en la respuesta previa (opcional; si no, usa el último captcha activo)"), ...paginacion(400) }),
    },
    async ({ fondo, desde, hasta, captcha, captcha_id, offset, limit }) => {
      try {
        if (!captcha) {
          const id = await pedirCaptchaCMF(env, "cartola");
          return {
            content: [
              {
                type: "text",
                text: `Esta consulta requiere un captcha de la CMF (imagen de 6 caracteres). Pida al usuario que lea la imagen del resource cmf://captcha/${id} (los hosts MCP pueden mostrarla directamente) y reintente con captcha=<código> y captcha_id=${id}.`,
              },
            ],
            isError: true,
          };
        }
        const reg = captcha_id
          ? await obtenerCaptcha(env, captcha_id)
          : ultimoCaptcha(env, "cartola");
        if (!reg) {
          return {
            content: [{ type: "text", text: "No se encontró el captcha asociado (expirado o ya consumido). Vuelva a llamar esta tool SIN captcha para obtener una imagen nueva y reintente." }],
            isError: true,
          };
        }
        const [a1, m1, d1] = desde.split("-");
        const [a2, m2, d2] = hasta.split("-");
        const params = {
          ffmm: fondo,
          txt_inicio: `${d1}/${m1}/${a1}`,
          txt_termino: `${d2}/${m2}/${a2}`,
          enviar: "Buscar",
          btnConsulta: "GENERAR ARCHIVO",
          captcha,
        };
        const html = reg
          ? await postLegacyConCookies("/institucional/estadisticas/fondos_cartola_diaria.php", params, reg.cookies, env)
          : await postLegacy("/institucional/estadisticas/fondos_cartola_diaria.php", params, env);
        if (reg) await consumirCaptcha(env, reg.id);
        const esFormulario = /captcha/i.test(html) && !/<table/i.test(html);
        if (esFormulario) {
          return toolError("Captcha inválido o expirado para la cartola (la CMF devolvió el formulario). Solicite un nuevo captcha y reintente; si el código era correcto, verifique el rango de fechas.");
        }
        const filas = htmlTablaAJson(html);
        return toolOkTabla({
          titulo: `Cartola diaria fondo ${fondo}`,
          vacio: "Sin cartola para el fondo en el rango.",
          base: { fondo, desde, hasta },
          campo: "filas",
          filas,
          offset,
          limit,
          tool: "cmf_fondos_mutuos_cartola",
          unidad: "días",
        });
      } catch (e) {
        return fromError(e);
      }
    },
  );

  server.registerTool(
    "cmf_fondos_comisiones_maximas",
    {
      annotations: { readOnlyHint: true, destructiveHint: false },
      outputSchema: comisionesMaximasSchema,
      title: "Comisiones máximas para fondos de pensiones/cesantía",
      description:
        "Devuelve las comisiones máximas que los fondos mutuos (fm) y fondos de inversión (fi) pueden cobrar a los Fondos de Pensiones (Circular 1951) y de Cesantía (Circular 1965), con las administradoras que reportaron y los documentos XLS mensuales disponibles. Filtre por tipo (fm o fi; default fm), circular (1951 o 1965; default 1951) y anio en AAAA. Use esta tool para los topes legales de comisiones; para las comisiones efectivas de cada fondo use cmf_fondos_mutuos_comisiones.",
      inputSchema: z.object({
        tipo: z.enum(["fm", "fi"]).default("fm").describe("Tipo de administradora: fm=mutuos, fi=inversión (default fm)"),
        circular: enumTolerante(["1951", "1965"]).default("1951").describe("Circular que fija el tope: 1951=pensiones, 1965=cesantía (default 1951; acepta 1951 o '1951')"),
        anio: anioSchema,
      }),
    },
    async ({ tipo, circular, anio }) => {
      try {
        const pagina = tipo === "fm" ? `consultaFm${circular}` : `consultaFi${circular}`;
        const html = await postLegacy(
          `/institucional/estadisticas/foppc/index.php?pagina=paginas.${pagina}`,
          { funcion: "obtener_datos_grilla", periodo: anio },
          env,
        );
        const administradoras = [...html.matchAll(/<legend>([\s\S]*?)<\/legend>/g)]
          .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
          .map((s) => s.replace(/\s*DOCUMENTOS\s*$/, "").trim())
          .filter(Boolean);
        const xlsCount = (html.match(/ver_sgd\.php\?s567=/g) ?? []).length;
        const texto = administradoras.length
          ? `Comisiones máximas ${tipo.toUpperCase()} Circular ${circular} ${anio}: ${administradoras.length} administradoras reportaron, ${xlsCount} documentos XLS disponibles. Administradoras: ${administradoras.slice(0, 10).join("; ")}`
          : `Sin reportes de comisiones máximas para ${anio}.`;
        return toolOk(texto, { tipo, circular, anio, administradoras, documentos_xls: xlsCount });
      } catch (e) {
        return fromError(e);
      }
    },
  );
}
