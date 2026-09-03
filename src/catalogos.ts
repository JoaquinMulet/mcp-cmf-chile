/**
 * Los catálogos de códigos que las tools piden y ninguna entregaba.
 *
 * El informe de pruebas del MCP del 2 de septiembre de 2026 lo midió. para
 * pedir un balance bancario había que saber de memoria que 001 es Banco de
 * Chile, `cmf_seguros_eeff` pedía el RUT de la compañía sin decir de dónde
 * sacarlo, y la cartera de fondos mutuos entregaba columnas como
 * `ffm_6010100` cuyo significado vive en una circular de 1997 escaneada.
 *
 * Este módulo es la ÚNICA fuente de los 3 catálogos. La tool `cmf_codigos`
 * y los recursos `cmf://` los leen de acá, así que no pueden divergir.
 */
import { getLegacy, type CmfEnv } from "./client/cmf-client.js";
import { decodificarEntidades, fixMojibake } from "./client/parsers.js";
import { dvDeRut, rutCanonico } from "./util/rut.js";

// ---------------------------------------------------------------------
// Bancos. códigos de institución de la ex SBIF
// ---------------------------------------------------------------------

export interface CodigoBanco {
  codigo: string;
  nombre: string;
}

/**
 * Verificados uno por uno contra la API oficial v3 de la CMF el 3 de
 * septiembre de 2026, con `cmf_api_ficha_institucion` para los códigos 001
 * a 075 y 504, 507, 672, 729, 732 y 999. La API respondió la ficha de estos
 * 32 y «no hay datos» para el resto. El nombre es el que devuelve la API en
 * `NombreInstitucion`, textual. La lista incluye instituciones que ya no
 * operan con ese nombre (Corpbanca, Banco Penta, Banco París), porque sus
 * códigos siguen sirviendo para pedir sus balances históricos.
 *
 * El 999 no tiene ficha, así que la API respondió 404 al verificarlo; es el
 * agregado del sistema y funciona en balances, resultados y adecuación.
 */
const FECHA_VERIFICACION_BANCOS = "2026-09-03";

export const CODIGOS_BANCOS: readonly CodigoBanco[] = [
  { codigo: "001", nombre: "BANCO DE CHILE" },
  { codigo: "009", nombre: "BANCO INTERNACIONAL" },
  { codigo: "012", nombre: "BANCO DEL ESTADO DE CHILE" },
  { codigo: "014", nombre: "SCOTIABANK CHILE" },
  { codigo: "016", nombre: "BANCO DE CRÉDITO E INVERSIONES" },
  { codigo: "017", nombre: "BANCO DO BRASIL S.A." },
  { codigo: "027", nombre: "CORPBANCA" },
  { codigo: "028", nombre: "BANCO BICE" },
  { codigo: "031", nombre: "HSBC BANK CHILE" },
  { codigo: "033", nombre: "CITIBANK N.A." },
  { codigo: "037", nombre: "BANCO SANTANDER-CHILE" },
  { codigo: "039", nombre: "ITAÚ CHILE" },
  { codigo: "041", nombre: "JP MORGAN CHASE BANK" },
  { codigo: "043", nombre: "BANCO DE LA NACIÓN ARGENTINA" },
  { codigo: "045", nombre: "THE BANK OF TOKYO-MITSUBISHI UFJ, LTD." },
  { codigo: "046", nombre: "BANCO SUDAMERICANO" },
  { codigo: "049", nombre: "BANCO SECURITY" },
  { codigo: "051", nombre: "BANCO FALABELLA" },
  { codigo: "052", nombre: "DEUTSCHE BANK CHILE" },
  { codigo: "053", nombre: "BANCO RIPLEY" },
  { codigo: "054", nombre: "RABOBANK CHILE" },
  { codigo: "055", nombre: "BANCO CONSORCIO" },
  { codigo: "056", nombre: "BANCO PENTA" },
  { codigo: "057", nombre: "BANCO PARÍS" },
  { codigo: "058", nombre: "DNB BANK ASA" },
  { codigo: "059", nombre: "BANCO BTG PACTUAL CHILE" },
  { codigo: "060", nombre: "CHINA CONSTRUCTION BANK" },
  { codigo: "061", nombre: "BANK OF CHINA, AGENCIA EN CHILE" },
  { codigo: "062", nombre: "TANNER BANCO DIGITAL" },
  { codigo: "504", nombre: "BANCO BILBAO VIZCAYA ARGENTARIA CHILE" },
  { codigo: "507", nombre: "BANCO DEL DESARROLLO" },
  { codigo: "672", nombre: "COOPEUCH" },
  { codigo: "999", nombre: "SISTEMA FINANCIERO TOTAL (agregado, sin ficha propia)" },
];

export const NOTAS_BANCOS = [
  `Códigos verificados contra la API oficial v3 de la CMF (ficha institucional) el ${FECHA_VERIFICACION_BANCOS}, del 001 al 075 y 504, 507, 672, 729, 732 y 999. El nombre es textual de la API.`,
  "Se usan en el parámetro institucion de las tools cmf_api_* y en codUnicoBank de cmf_bancos_reportes. 999 es el sistema financiero total y sirve en balances, resultados y adecuación de capital.",
  "Incluye instituciones que ya no operan con ese nombre, porque el código sigue sirviendo para pedir sus cifras históricas.",
];

// ---------------------------------------------------------------------
// Seguros. las compañías que aceptan los formularios de EEFF de la CMF
// ---------------------------------------------------------------------

export interface CompaniaDeSeguros {
  /** RUT canónico, sin puntos ni DV. Es el valor que pide sociedades en cmf_seguros_eeff. */
  rut: string;
  rut_dv?: string;
  nombre: string;
  /** La página marca «(No vigente)» al final del nombre; sin marca es vigente. */
  estado: "Vigente" | "No vigente";
  segmento: "generales" | "vida";
  /** Subtipo del formulario. A=compañías, R=reaseguradoras, CR=seguros de crédito (solo generales). */
  tipo: "A" | "R" | "CR";
}

/**
 * Los 5 índices que llenan el select `sociedad[]`. El subtipo se elige con
 * el parámetro `tiposociedad` en la URL, que es lo que hace el onchange del
 * formulario real (`window.location='...&tiposociedad='+valor`).
 */
const INDICES_SEGUROS: ReadonlyArray<{ indice: string; segmento: CompaniaDeSeguros["segmento"]; tipo: CompaniaDeSeguros["tipo"] }> = [
  { indice: "/institucional/estadisticas/seg_gen_fecu_index.php", segmento: "generales", tipo: "A" },
  { indice: "/institucional/estadisticas/seg_gen_fecu_index.php", segmento: "generales", tipo: "R" },
  { indice: "/institucional/estadisticas/seg_gen_fecu_index.php", segmento: "generales", tipo: "CR" },
  { indice: "/institucional/estadisticas/seg_vida_fecu_index.php", segmento: "vida", tipo: "A" },
  { indice: "/institucional/estadisticas/seg_vida_fecu_index.php", segmento: "vida", tipo: "R" },
];

/**
 * Lee el select `sociedad[]` de un índice de EEFF de seguros.
 *
 * Cada opción es `<option value="99155000">99.155.000-3 ABN AMRO ...</option>`.
 * El value es el RUT sin DV, que es justo lo que el formulario reenvía, y
 * el texto trae el RUT con puntos y DV delante del nombre. La opción «0»
 * es «TODOS», un filtro y no una compañía, así que no se lista.
 */
export function companiasDeSegurosDelIndice(
  html: string,
  segmento: CompaniaDeSeguros["segmento"],
  tipo: CompaniaDeSeguros["tipo"],
): CompaniaDeSeguros[] {
  const select = /<select\b[^>]*name=["']?sociedad\[\]["']?[^>]*>([\s\S]*?)<\/select>/i.exec(html);
  if (!select) return [];
  const salida: CompaniaDeSeguros[] = [];
  const re = /<option\b[^>]*value=["']?([^"'>\s]*)["']?[^>]*>([\s\S]*?)<\/option>/gi;
  for (let m = re.exec(select[1]); m !== null; m = re.exec(select[1])) {
    const valor = m[1].trim();
    if (!/^\d{6,9}$/.test(valor)) continue;
    const texto = fixMojibake(decodificarEntidades(m[2])).replace(/\s+/g, " ").trim();
    // «99.155.000-3 ABN AMRO ... (No vigente)» → el RUT de adelante se separa
    // del nombre, y la marca de vigencia del final pasa a su propio campo. La
    // página solo marca a las no vigentes, así que sin marca es vigente.
    const noVigente = /\s*\(No vigente\)\s*$/i.test(texto);
    const sinMarca = texto.replace(/\s*\(No vigente\)\s*$/i, "");
    const conRut = /^([\d.]+-[\dkK])\s+(.*)$/.exec(sinMarca);
    const dv = conRut ? dvDeRut(conRut[1]) : undefined;
    salida.push({
      rut: rutCanonico(valor),
      ...(dv ? { rut_dv: dv } : {}),
      nombre: conRut ? conRut[2] : sinMarca,
      estado: noVigente ? "No vigente" : "Vigente",
      segmento,
      tipo,
    });
  }
  return salida;
}

/** Las compañías de los 5 índices, leídas de la CMF (los índices se cachean). */
export async function companiasDeSeguros(env: CmfEnv): Promise<CompaniaDeSeguros[]> {
  const listas = await Promise.all(
    INDICES_SEGUROS.map(async ({ indice, segmento, tipo }) => {
      const html = await getLegacy(indice, { lang: "es", tiposociedad: tipo }, env, `catalogo:seguros:v1:${indice}:${tipo}`);
      return companiasDeSegurosDelIndice(html, segmento, tipo);
    }),
  );
  return listas.flat();
}

export const NOTAS_SEGUROS = [
  "Leído en vivo del select sociedad[] de los formularios de EEFF de seguros de la CMF (seg_gen_fecu_index.php con tiposociedad A, R y CR; seg_vida_fecu_index.php con A y R). Incluye compañías no vigentes, porque sus cifras históricas siguen consultables.",
  "Para consultar una compañía en cmf_seguros_eeff se pegan 3 campos de su fila. rut en sociedades, segmento en tipo, y tipo (A, R o CR) en subtipo. Cada subtipo es un formulario distinto de la CMF con su propio universo de compañías, así que una reaseguradora (R) pedida con subtipo A responde vacío. rut_dv es el dígito verificador tal como lo publica la CMF.",
];

// ---------------------------------------------------------------------
// Fondos mutuos. los códigos de la Circular 1.333 de 1997 (FECU de fondos mutuos)
// ---------------------------------------------------------------------

export interface CodigoCircular1333 {
  /** Cartera de cmf_fondos_mutuos_cartera donde aparece. */
  cartera: "NACI" | "EXTR" | "OPCI" | "FUTU" | "OPLA";
  /** Código de la circular, con puntos. */
  codigo: string;
  /** Columnas REALES de la planilla que la CMF publica con ese código. Vacío si no se pudo leer del dato. */
  columnas: string[];
  nombre: string;
  detalle?: string;
  /** Codificación cerrada que la circular fija para el campo. */
  valores?: Record<string, string>;
  unidad?: string;
}

const SITUACION = {
  "1": "Instrumento no sujeto a restricciones",
  "2": "Instrumento sujeto a compromiso",
  "3": "Instrumento entregado como margen o garantía por operaciones en derivados",
  "4": "Instrumento sujeto a otra restricción",
};
const VALORIZACION = { "1": "TIR", "2": "Porcentaje del valor par", "3": "Valor relevante" };
const TIPO_INTERES = { NL: "Nominal lineal", NC: "Nominal compuesto", RL: "Real lineal", RC: "Real compuesto", NA: "No aplicable" };
const CLASIFICACION = "AAA, AA, A, BBB, BB, B, C, D y E para deuda de largo plazo; N-1 a N-5 para deuda de corto plazo; NA cuando el instrumento no está obligado a clasificarse. Se informa la menor categoría entre las clasificadoras.";
const EJERCICIO = { A: "Americana", E: "Europea" };
const COMPRA_VENTA = { C: "Compra", V: "Venta" };
const MILES = "miles de pesos, sin decimales";

/** Las variables que comparten las carteras nacional (6.01) y extranjera (6.02). */
function instrumentos(cartera: "NACI" | "EXTR"): CodigoCircular1333[] {
  const p = cartera === "NACI" ? "6.01" : "6.02";
  const c = cartera === "NACI" ? "601" : "602";
  const col = (sufijo: string) => `ffm_${c}${sufijo}`;
  const propias: CodigoCircular1333[] =
    cartera === "NACI"
      ? [
          { cartera, codigo: `${p}.01.00`, columnas: [col("0100")], nombre: "Nemotécnico del instrumento", detalle: "Código nemotécnico de la SVS, Circulares 1.085 de 1982 y 1.064 de 1992." },
          { cartera, codigo: `${p}.02.11`, columnas: [col("0211")], nombre: "RUT del emisor", detalle: "Sin dígito verificador. Para cuotas de fondos de inversión, el RUN asignado por la SVS (anexo 4 de la circular)." },
          { cartera, codigo: `${p}.02.12`, columnas: [col("0212")], nombre: "Dígito verificador del RUT del emisor" },
          { cartera, codigo: `${p}.08.00`, columnas: [col("0800")], nombre: "Código del grupo empresarial", detalle: "Según la Circular 1.030 de 1991 y el anexo 7 de la circular. 0000 cuando el emisor no pertenece a ningún grupo." },
        ]
      : [
          { cartera, codigo: `${p}.01.00`, columnas: [col("0100")], nombre: "Nemotécnico del instrumento", detalle: "El usado en la bolsa donde se transó, hasta 20 caracteres. La administradora elige uno y lo mantiene." },
          { cartera, codigo: `${p}.02.00`, columnas: [col("0200")], nombre: "Nombre del emisor", detalle: "Como se conoce al emisor en las bolsas extranjeras donde se transó." },
          { cartera, codigo: `${p}.08.00`, columnas: [col("0800")], nombre: "Nombre del grupo empresarial", detalle: "Razón social de la controladora del grupo. NA cuando el emisor no pertenece a ningún grupo." },
        ];
  return [
    ...propias,
    { cartera, codigo: `${p}.03.00`, columnas: [col("0300")], nombre: "Código país emisor", detalle: "Anexo 5 de la circular." },
    { cartera, codigo: `${p}.04.00`, columnas: [col("0400")], nombre: "Tipo de instrumento", detalle: "Anexo 6 de la circular." },
    { cartera, codigo: `${p}.05.00`, columnas: [col("0500")], nombre: "Fecha de vencimiento", detalle: "Fecha del pago final o último flujo. 99999999 cuando no corresponde." },
    { cartera, codigo: `${p}.06.00`, columnas: [col("0600")], nombre: "Situación del instrumento", valores: SITUACION },
    { cartera, codigo: `${p}.07.00`, columnas: [col("0700")], nombre: "Clasificación de riesgo", detalle: CLASIFICACION },
    { cartera, codigo: `${p}.09.00`, columnas: [col("0900")], nombre: "Cantidad de unidades", detalle: "Renta variable. número de unidades. Renta fija. unidades nominales a valor inicial o final según tenga amortizaciones. 2 decimales." },
    { cartera, codigo: `${p}.10.00`, columnas: [col("1000")], nombre: "Tipo de unidades", detalle: "Moneda o unidad de reajuste de la cantidad de unidades, anexo 8 de la circular." },
    { cartera, codigo: `${p}.11.11`, columnas: [`ffm_tir_${c}1111`, `ffm_par_${c}1111`, `ffm_rel_${c}1111`], nombre: "TIR, valor par o valor relevante", detalle: "La planilla lo parte en 3 columnas. tir (tasa interna de retorno de la renta fija), par (porcentaje del valor par de la tasa flotante) y rel (valor relevante de la renta variable). 2 decimales. En la cartera extranjera el valor relevante viene convertido a pesos según la Circular 1.218 de 1995." },
    { cartera, codigo: `${p}.11.12`, columnas: [col("1112")], nombre: "Código de valorización", valores: VALORIZACION },
    { cartera, codigo: `${p}.11.13`, columnas: [col("1113")], nombre: "Base tasa", detalle: "Días que cubre la tasa de valorización (30, 360, 365). 0 cuando no corresponde." },
    { cartera, codigo: `${p}.11.14`, columnas: [col("1114")], nombre: "Tipo de interés", valores: TIPO_INTERES },
    { cartera, codigo: `${p}.12.00`, columnas: [col("1200")], nombre: "Valorización al cierre", unidad: MILES },
    { cartera, codigo: `${p}.13.00`, columnas: [col("1300")], nombre: "Código moneda liquidación", detalle: "Anexo 8 de la circular." },
    { cartera, codigo: `${p}.14.00`, columnas: [col("1400")], nombre: "Código país transacción", detalle: "País donde se adquirió el instrumento, anexo 5 de la circular." },
    { cartera, codigo: `${p}.15.11`, columnas: [col("1511")], nombre: "Porcentaje del capital del emisor", detalle: "Acciones. porcentaje sobre las acciones pagadas. Cuotas. porcentaje sobre las cuotas pagadas. 3 decimales. 0 en renta fija." },
    { cartera, codigo: `${p}.15.12`, columnas: [col("1512")], nombre: "Porcentaje del total de activos del emisor", detalle: "Valorización al cierre sobre el total de activos del emisor. 3 decimales." },
    { cartera, codigo: `${p}.15.13`, columnas: [col("1513")], nombre: "Porcentaje del total de activos del fondo", detalle: "Valorización al cierre sobre el total de activos del fondo (variable 4.10.00.00 del balance). 3 decimales." },
  ];
}

const OPCIONES: CodigoCircular1333[] = [
  { cartera: "OPCI", codigo: "6.03.01.11", columnas: ["ffm_6030111"], nombre: "Activo objeto", detalle: "Sobre el que el fondo adquirió el derecho a comprar o vender." },
  { cartera: "OPCI", codigo: "6.03.01.12", columnas: ["ffm_6030112"], nombre: "Nemotécnico de la opción", detalle: "El de la bolsa donde se realizó el contrato." },
  { cartera: "OPCI", codigo: "6.03.01.13", columnas: ["ffm_6030113"], nombre: "Forma de ejercicio", valores: EJERCICIO },
  { cartera: "OPCI", codigo: "6.03.01.14", columnas: ["ffm_6030114"], nombre: "Fecha de expiración", detalle: "Último día en que la opción puede ejercerse." },
  { cartera: "OPCI", codigo: "6.03.01.15", columnas: ["ffm_6030115"], nombre: "Código moneda de liquidación", detalle: "Anexo 8 de la circular." },
  { cartera: "OPCI", codigo: "6.03.01.16", columnas: ["ffm_6030116"], nombre: "Código país", detalle: "Donde se suscribió el contrato, anexo 5 de la circular." },
  { cartera: "OPCI", codigo: "6.03.02.00", columnas: ["ffm_6030200"], nombre: "Tipo de opción", detalle: "Derecho a comprar o derecho a vender.", valores: COMPRA_VENTA },
  { cartera: "OPCI", codigo: "6.03.03.00", columnas: ["ffm_6030300"], nombre: "Valor de mercado unitario de la prima", unidad: "pesos, 2 decimales" },
  { cartera: "OPCI", codigo: "6.03.04.00", columnas: ["ffm_6030400"], nombre: "Número de contratos", detalle: "De una misma serie." },
  { cartera: "OPCI", codigo: "6.03.05.00", columnas: ["ffm_6030500"], nombre: "Precio de ejercicio", unidad: "pesos, 2 decimales" },
  { cartera: "OPCI", codigo: "6.03.06.00", columnas: ["ffm_6030600"], nombre: "Valor de mercado del activo objeto", unidad: "pesos, 2 decimales" },
  { cartera: "OPCI", codigo: "6.03.07.00", columnas: ["ffm_6030700"], nombre: "Número de unidades del activo objeto" },
  { cartera: "OPCI", codigo: "6.03.08.00", columnas: ["ffm_6030800"], nombre: "Inversión en primas", detalle: "Valor de mercado de las primas de una misma serie al cierre.", unidad: MILES },
  { cartera: "OPCI", codigo: "6.03.09.00", columnas: ["ffm_6030900"], nombre: "Valorización a precio de ejercicio", unidad: MILES },
  { cartera: "OPCI", codigo: "6.03.10.00", columnas: ["ffm_6031000"], nombre: "Valorización de mercado", detalle: "Unidades del activo objeto valorizadas a su precio de mercado al cierre.", unidad: MILES },
  { cartera: "OPCI", codigo: "6.03.11.00", columnas: ["ffm_6031100"], nombre: "Porcentaje invertido en primas respecto al activo total del fondo", detalle: "3 decimales." },
];

const FUTUROS: CodigoCircular1333[] = [
  { cartera: "FUTU", codigo: "6.04.01.11", columnas: ["ffm_6040111"], nombre: "Activo objeto" },
  { cartera: "FUTU", codigo: "6.04.01.12", columnas: ["ffm_6040112"], nombre: "Nemotécnico del contrato", detalle: "El de la bolsa del país donde se realizó. FORWARD para los contratos de forward." },
  { cartera: "FUTU", codigo: "6.04.01.13", columnas: ["ffm_6040113"], nombre: "Unidad de cotización", detalle: "Moneda o unidad del contrato, anexo 8 de la circular." },
  { cartera: "FUTU", codigo: "6.04.01.14", columnas: ["ffm_6040114"], nombre: "Fecha de vencimiento" },
  { cartera: "FUTU", codigo: "6.04.01.15", columnas: ["ffm_6040115"], nombre: "Moneda de liquidación", detalle: "Anexo 8 de la circular." },
  { cartera: "FUTU", codigo: "6.04.01.16", columnas: ["ffm_6040116"], nombre: "Código país", detalle: "Donde se suscribió el contrato, anexo 5 de la circular." },
  { cartera: "FUTU", codigo: "6.04.02.00", columnas: ["ffm_6040200"], nombre: "Posición compra o venta", valores: COMPRA_VENTA },
  { cartera: "FUTU", codigo: "6.04.03.00", columnas: ["ffm_6040300"], nombre: "Unidades nominales totales", detalle: "Comprometidas en los contratos sobre el mismo activo, precio y vencimiento." },
  { cartera: "FUTU", codigo: "6.04.04.00", columnas: ["ffm_6040400"], nombre: "Precio a futuro del contrato", unidad: "pesos, 2 decimales" },
  { cartera: "FUTU", codigo: "6.04.05.00", columnas: ["ffm_6040500"], nombre: "Monto comprometido", detalle: "Al precio futuro acordado.", unidad: MILES },
  { cartera: "FUTU", codigo: "6.04.06.00", columnas: ["ffm_6040600"], nombre: "Valorización de mercado del contrato", detalle: "Al precio de mercado del contrato.", unidad: MILES },
];

/**
 * Opciones en que el fondo actúa como lanzador (capítulo 7.01 de la
 * circular). La cartera OPLA no tenía filas en junio de 2026, así que sus
 * columnas no se pudieron leer del dato y van vacías. En las otras 4
 * carteras la columna es `ffm_` más los dígitos del código.
 */
const LANZADOR: CodigoCircular1333[] = [
  { cartera: "OPLA", codigo: "7.01.01.11", columnas: [], nombre: "Activo objeto", detalle: "Sobre el que el fondo lanzó la opción." },
  { cartera: "OPLA", codigo: "7.01.01.12", columnas: [], nombre: "Nemotécnico de la opción" },
  { cartera: "OPLA", codigo: "7.01.01.13", columnas: [], nombre: "Forma de ejercicio", valores: EJERCICIO },
  { cartera: "OPLA", codigo: "7.01.01.14", columnas: [], nombre: "Fecha de expiración" },
  { cartera: "OPLA", codigo: "7.01.01.15", columnas: [], nombre: "Código moneda de liquidación", detalle: "Anexo 8 de la circular." },
  { cartera: "OPLA", codigo: "7.01.01.16", columnas: [], nombre: "Código país", detalle: "Anexo 5 de la circular." },
  { cartera: "OPLA", codigo: "7.01.02.00", columnas: [], nombre: "Tipo de opción", valores: COMPRA_VENTA },
  { cartera: "OPLA", codigo: "7.01.03.00", columnas: [], nombre: "Número de contratos" },
  { cartera: "OPLA", codigo: "7.01.04.00", columnas: [], nombre: "Precio de ejercicio", unidad: "pesos, 2 decimales" },
  { cartera: "OPLA", codigo: "7.01.05.00", columnas: [], nombre: "Valor de mercado del activo objeto", unidad: "pesos, 2 decimales" },
  { cartera: "OPLA", codigo: "7.01.06.00", columnas: [], nombre: "Número de unidades del activo objeto", detalle: "Sobre las que el fondo tiene la obligación de comprar o vender." },
  { cartera: "OPLA", codigo: "7.01.07.00", columnas: [], nombre: "Valorización a precio de ejercicio", unidad: MILES },
  { cartera: "OPLA", codigo: "7.01.08.00", columnas: [], nombre: "Valorización de mercado", unidad: MILES },
  { cartera: "OPLA", codigo: "7.01.09.00", columnas: [], nombre: "Porcentaje monto comprometido sobre activo del fondo", detalle: "Valorización a precio de ejercicio sobre el activo total del fondo. 3 decimales." },
];

export const CODIGOS_CIRCULAR_1333: readonly CodigoCircular1333[] = [
  ...instrumentos("NACI"),
  ...instrumentos("EXTR"),
  ...OPCIONES,
  ...FUTUROS,
  ...LANZADOR,
];

const URL_CIRCULAR_1333 = "https://www.cmfchile.cl/normativa/cir_1333_1997.pdf";

export const NOTAS_CIRCULAR_1333 = [
  `Fuente. Circular 1.333 del 9 de julio de 1997 de la SVS, capítulos 6 y 7, ${URL_CIRCULAR_1333}. El PDF es una imagen escaneada, así que los textos se transcribieron a mano desde su OCR el 3 de septiembre de 2026; ante una duda manda el PDF.`,
  "columnas son los nombres REALES de la planilla que entrega cmf_fondos_mutuos_cartera, leídos de la respuesta de junio de 2026. La variable 11.11 viene partida en 3 columnas (tir, par, rel). OPLA no tenía filas ese mes y sus columnas no se pudieron leer.",
  "Los anexos 5 (países), 6 (tipos de instrumento), 7 (grupos empresariales) y 8 (monedas y unidades) no están transcritos. están en el PDF de la circular.",
];
