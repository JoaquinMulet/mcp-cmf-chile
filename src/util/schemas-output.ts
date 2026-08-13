import * as z from "zod/v4";

/**
 * Output schemas por patrón de respuesta (SEP-2106: JSON Schema 2020-12).
 * Tolerantes: `.passthrough()` para no romper tools si el structuredContent crece.
 * Habilitan progressive discovery / programmatic tool calling en los hosts.
 */

const rec = () => z.record(z.string(), z.unknown());

/** Listado con filas genéricas */
export const filasSchema = z
  .object({ filas: z.array(rec()).optional() })
  .passthrough();

/** Listado paginado con total y next_offset */
export const paginadoSchema = (campo: string) =>
  z
    .object({
      [campo]: z.array(rec()).optional(),
      total: z.number().optional(),
      next_offset: z.number().nullable().optional(),
    })
    .passthrough();

/** Respuestas de la API oficial v3 (data genérico) */
export const apiSerieSchema = z
  .object({
    serie: z.string().optional(),
    desde: z.string().optional(),
    hasta: z.string().optional(),
    total: z.number().optional(),
    registros: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const apiPeriodoSchema = z
  .object({
    anio: z.string().optional(),
    mes: z.string().optional(),
    institucion: z.string().optional(),
    cuenta: z.string().optional(),
    componente: z.string().optional(),
    indicador: z.string().optional(),
    data: z.unknown().optional(),
  })
  .passthrough();

/** Ficha de entidad y pestanías con un array de datos */
export const empresaArraySchema = (campo: string) =>
  z
    .object({
      rut: z.string().optional(),
      anio: z.string().optional(),
      mes: z.string().optional(),
      tipo: z.string().optional(),
      [campo]: z.array(rec()).optional(),
    })
    .passthrough();

/** Historial de EEFF */
export const historialSchema = z
  .object({
    rut: z.string().optional(),
    inicio_ifrs: z.string().optional(),
    modalidad: z.string().optional(),
    anios: z.array(z.string()).optional(),
  })
  .passthrough();

/** EEFF de empresa */
export const eeffSchema = z
  .object({
    periodo: z.string().optional(),
    tipo_balance: z.string().optional(),
    tablas: z.array(rec()).optional(),
    documentos: z.array(rec()).optional(),
    aviso: z.string().optional(),
  })
  .passthrough();

/** Globales por mercado (hechos/sanciones/resoluciones) */
export const globalesSchema = (campo: string) =>
  z
    .object({
      mercado: z.string().optional(),
      desde: z.string().optional(),
      hasta: z.string().optional(),
      [campo]: z.array(rec()).optional(),
    })
    .passthrough();

/** Fondos mutuos: boletín con filas */
export const fondosSchema = (campo: string) =>
  z
    .object({
      anio: z.string().optional(),
      mes: z.string().optional(),
      total: z.number().optional(),
      [campo]: z.array(rec()).optional(),
    })
    .passthrough();

/** Comisiones máximas foppc */
export const comisionesMaximasSchema = z
  .object({
    tipo: z.string().optional(),
    circular: z.string().optional(),
    anio: z.string().optional(),
    administradoras: z.array(z.string()).optional(),
    documentos_xls: z.number().optional(),
  })
  .passthrough();

/** Grid Google Visualization (fondos IFRS) */
export const gridSchema = z
  .object({
    columnas: z.array(z.string()).optional(),
    filas: z.array(rec()).optional(),
    total_filas: z.number().optional(),
  })
  .passthrough();

/** Documentos */
export const documentoInfoSchema = z
  .object({ s567: z.string().optional(), sin_verificar: z.boolean().optional(), url: z.string().optional() })
  .passthrough();

export const documentoDescargaSchema = z
  .object({
    s567: z.string().optional(),
    tamano: z.number().optional(),
    tamano_kb: z.number().optional(),
    contentType: z.string().optional(),
    base64: z.string().optional(),
  })
  .passthrough();

export const documentoMarkdownSchema = z
  .object({
    pdf_type: z.string().optional(),
    tamano_kb: z.number().optional(),
    markdown: z.string().optional(),
    markdown_truncado: z.boolean().optional(),
    escaneado: z.boolean().optional(),
    fuente: z.string().optional(),
  })
  .passthrough();

/** Normativa */
export const normativaDescargaSchema = z
  .object({ archivo: z.string().optional(), tamano_kb: z.number().optional(), formato: z.string().optional() })
  .passthrough();

/** XBRL */
export const xbrlTaxonomiasSchema = z.object({ taxonomias: z.array(z.string()).optional() }).passthrough();
export const xbrlVisorSchema = z
  .object({ taxonomia: z.string().optional(), fecha: z.string().optional(), filas: z.array(rec()).optional() })
  .passthrough();
export const xbrlConsultaSchema = z.object({ enviada: z.boolean().optional() }).passthrough();

/** Paquetes */
export const paqueteSchema = z
  .object({
    empresa: rec().optional(),
    arbol: rec().optional(),
    manifest: z.array(rec()).optional(),
    resumen: rec().optional(),
  })
  .passthrough();

export const paqueteDocumentosSchema = z
  .object({
    empresa: rec().optional(),
    descargados: z.array(rec()).optional(),
    resumen: rec().optional(),
    zip: rec().optional(),
  })
  .passthrough();

export const fondosPaqueteSchema = z
  .object({
    anio: z.string().optional(),
    mes: z.string().optional(),
    secciones: z.array(rec()).optional(),
    fallidos: z.array(rec()).optional(),
    requests_cmf: z.number().optional(),
    tiempo_estimado_s: z.number().optional(),
  })
  .passthrough();
