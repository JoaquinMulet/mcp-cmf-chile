import * as XLSX from "xlsx";

/** Decodifica entidades HTML básicas. El input ya viene decodificado a UTF-8 por el cliente. */
export function decodificarEntidades(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&uuml;/g, "ü")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // El ampersand va AL FINAL, siempre. Si se decodifica antes, un texto
    // que la fuente escapo 2 veces (&amp;lt;) termina convertido en un <
    // de verdad, y ahi ya no se puede distinguir del marcado real. Lo
    // encontro CodeQL con js/double-escaping el 21 de agosto de 2026.
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fix de mojibake doble-codificado (algunos sistemas legacy sirven UTF-8 sobre UTF-8). */
export function fixMojibake(s: string): string {
  if (!s.includes("Ã") && !s.includes("Â")) return s;
  return s
    .replace(/Ã±/g, "ñ")
    .replace(/Ã¡/g, "á")
    .replace(/Ã©/g, "é")
    .replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó")
    .replace(/Ãº/g, "ú")
    .replace(/Ã¼/g, "ü")
    .replace(/Ã/g, "Ñ")
    .replace(/Ã/g, "Á")
    .replace(/Ã/g, "É")
    .replace(/Ã/g, "Í")
    .replace(/Ã/g, "Ó")
    .replace(/Ã/g, "Ú")
    .replace(/Ã(?=[A-ZÁÉÍÓÚÑ])/g, "Ó")
    .replace(/Ã/g, "")
    .replace(/Â/g, "");
}

/** Celda de tabla: texto visible + enlace del primer <a> (si existe), para no perder los href al limpiar etiquetas. */
interface CeldaTabla {
  texto: string;
  enlace: string;
}

/** Fila de tabla: celdas + si todas vienen de <th> (encabezado, nunca es dato). */
interface FilaTabla {
  celdas: CeldaTabla[];
  esHeader: boolean;
}

/**
 * Saca de un HTML lo que el usuario ELIGE, que nunca es lo que el servidor
 * RESPONDE.
 *
 * Las páginas legacy de la CMF meten sus controles dentro de una `<table>`, y
 * como el lector borra las etiquetas y se queda con el texto, las 400
 * opciones de un desplegable terminaban pegadas en una sola celda, y esa
 * celda pasaba a ser un nombre de columna. Medido el 28 de agosto de 2026. 6
 * operaciones respondían el formulario de búsqueda como si fueran datos,
 * decían «total 2», gastaban unos 45 mil caracteres y no entregaban ni una
 * cifra. Entre ellas los estados financieros de sociedades anónimas y los de
 * las aseguradoras.
 *
 * Sin las opciones la fila queda vacía y la tool responde que no hay datos,
 * que es la verdad. El script y el estilo se van por lo mismo. son texto que
 * el navegador nunca muestra.
 */
function sinControles(html: string): string {
  return html
    .replace(/<select[\s\S]*?<\/select>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
}

/** Las celdas de un `<tr>`, con su texto limpio y el enlace de su primer `<a>`. */
function celdasDeUnaFila(tr: string): FilaTabla {
  const celdas: CeldaTabla[] = [];
  let todasTh = true;
  const reCelda = /<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = reCelda.exec(tr)) !== null) {
    if (cm[1] !== "h") todasTh = false;
    const href = cm[2].match(/href="([^"]+)"/i)?.[1] ?? "";
    celdas.push({
      texto: fixMojibake(decodificarEntidades(cm[2].replace(/<[^>]+>/g, " "))),
      enlace: href.startsWith("/") ? `https://www.cmfchile.cl${href}` : href,
    });
  }
  return { celdas, esHeader: todasTh };
}

/** Las filas de una `<table>`, sin las que no tienen ninguna celda. */
function filasDeUnTable(tabla: string): FilaTabla[] {
  const filas: FilaTabla[] = [];
  const reFila = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = reFila.exec(tabla)) !== null) {
    const fila = celdasDeUnaFila(rm[1]);
    if (fila.celdas.length > 0) filas.push(fila);
  }
  return filas;
}

/** Extrae todas las <table> de un HTML como arrays de filas (celdas decodificadas + enlace). */
function htmlTablas(htmlCrudo: string): FilaTabla[][] {
  const html = sinControles(htmlCrudo);
  const tablas: FilaTabla[][] = [];
  const reTabla = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = reTabla.exec(html)) !== null) {
    const filas = filasDeUnTable(tm[1]);
    if (filas.length > 0) tablas.push(filas);
  }
  return tablas;
}

/**
 * Convierte una tabla HTML a JSON.
 *
 * De dónde salen los nombres de las columnas, en este orden.
 *
 * 1. Las que entrega quien llama, si las entrega.
 * 2. La fila de encabezado `<th>`, cuando la tabla la trae.
 * 3. La primera fila de datos, que entonces deja de ser un dato.
 *
 * El paso 2 faltaba, y ese era el defecto. La función buscaba la primera
 * fila que NO fuera encabezado y la usaba como definición de columnas,
 * saltándose el `<th>` real. Medido el 28 de agosto de 2026 con el reporte
 * MR1 de Banco de Chile. la tabla del servlet BaseDato marca su cabecera
 * bien, «Código Contable | Descripción | Total Monedas», y aun así las 1228
 * filas salían con las claves «411000000», «INGRESOS POR INTERESES» y
 * «1.376.398.163.187», que son los valores de la primera fila de datos. Esa
 * fila además se perdía, y ningún programa podía escribir un selector
 * estable, porque los nombres cambian en cada llamada.
 *
 * El paso 3 se conserva tal cual, y es a propósito. Casi todas las tablas
 * de la CMF vienen sin `<th>`, y ahí la primera fila SÍ es la cabecera.
 * Cambiar esa parte habría roto unas 40 operaciones de una vez.
 */
export function htmlTablaAJson(html: string, columnas?: string[]): Record<string, string>[] {
  return htmlTablas(html).flatMap((t) => filasDeUnaTabla(t, columnas));
}

/** De dónde salen los nombres, y qué fila deja de ser dato por prestarlos. */
function nombresDeColumna(
  t: FilaTabla[],
  columnas: string[] | undefined,
): { cols: string[]; prestada: FilaTabla | undefined } {
  const cabecera = t.find((f) => f.esHeader);
  // Solo se sacrifica una fila de datos cuando NO hay cabecera de verdad.
  const prestada = columnas ?? cabecera ? undefined : (t.find((f) => !f.esHeader) ?? t[0]);
  const cols = columnas ?? (cabecera ?? prestada)?.celdas.map((c) => c.texto) ?? [];
  return { cols, prestada };
}

function filasDeUnaTabla(t: FilaTabla[], columnas?: string[]): Record<string, string>[] {
  if (t.length === 0) return [];
  const { cols, prestada } = nombresDeColumna(t, columnas);
  // Una clave `url` vacía en todas las filas no es un dato, es una columna de
  // ruido que el texto para el modelo igual dibuja. Solo existe cuando esta
  // tabla tiene al menos un enlace que valga la pena entregar.
  const conEnlaces = t.some((f) => f.celdas.some((c) => c.enlace));
  const out: Record<string, string>[] = [];
  for (const filaTabla of t) {
    if (filaTabla.esHeader || filaTabla === prestada) continue;
    const fila: Record<string, string> = {};
    filaTabla.celdas.forEach((celda, j) => {
      if (j < cols.length) fila[cols[j]] = celda.texto;
    });
    if (conEnlaces) fila.url = filaTabla.celdas.find((c) => c.enlace)?.enlace ?? "";
    out.push(fila);
  }
  return out;
}

/** Parsea TXT/CSV separado por ';' (catálogos legacy: fm_ident2, ffm_download). Header normalizado a snake_case. */
export function txtCsvAJson(texto: string, sep = ";"): Record<string, string>[] {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lineas.length < 2) return [];
  const header = lineas[0].split(sep).map((h) => normalizarClave(h));
  const out: Record<string, string>[] = [];
  for (const l of lineas.slice(1)) {
    const celdas = l.split(sep);
    const fila: Record<string, string> = {};
    header.forEach((h, i) => {
      fila[h] = fixMojibake((celdas[i] ?? "").trim());
    });
    out.push(fila);
  }
  return out;
}

/**
 * Separa las llamadas al pie de una planilla de la CMF de sus filas de datos.
 *
 * Las planillas de la CMF terminan con sus notas, y el parser las devuelve
 * como filas más, con la misma forma que un dato. Medido el 28 de agosto de
 * 2026 en las 5 planillas de fondos mutuos: el boletín de una
 * administradora trae 206 filas y 14 son notas, y el del sistema completo
 * trae 23 filas de las que 14 son notas. Costos 8, comisiones 14,
 * antecedentes 2, inversiones 12.
 *
 * Hace 2 daños silenciosos. El total miente sobre cuántos registros hay, y
 * quien suma una columna de montos suma texto.
 *
 * El criterio sale del dato real. Una fila de datos del boletín trae 13 o
 * 14 celdas con valor y una nota trae exactamente 1. Se cuenta cuántas
 * celdas tienen valor, y NO se mira el texto, porque el texto de las notas
 * cambia de planilla en planilla y de mes en mes.
 *
 * Las notas no se botan. Llevan la unidad de las cifras y el significado de
 * los códigos, que es justo lo que el modelo necesita para leer la tabla.
 */
export function separarNotas<T extends Record<string, unknown>>(filas: T[]): { datos: T[]; notas: string[] } {
  const datos: T[] = [];
  const notas: string[] = [];
  for (const fila of filas) {
    const conValor = Object.values(fila)
      .map((v) => String(v ?? "").trim())
      .filter((v) => v !== "");
    if (conValor.length > 1) {
      datos.push(fila);
      continue;
    }
    // Una fila entera vacía no es una nota: no tiene nada que decir.
    if (conValor.length === 1) notas.push(conValor[0]);
  }
  return { datos, notas };
}

/**
 * Separa las filas de AGREGADO de las filas de datos.
 *
 * El boletín de fondos mutuos termina con «Total consulta» y «Total
 * Sistema», que son sumas de las filas anteriores y vienen mezcladas con
 * ellas. Quien promedia rentabilidades o cuenta fondos sobre esa lista se
 * contamina y no tiene cómo notarlo. Lo tapaba el corte por defecto en 50
 * filas, porque los totales van al final y casi nadie llegaba.
 *
 * Medido el 28 de agosto de 2026 contra el servidor desplegado. el boletín
 * de una administradora trae 2, el del sistema completo trae 1, las
 * inversiones traen 1, y costos, comisiones y antecedentes no traen ninguna.
 *
 * El criterio es que la PRIMERA columna empiece con «Total». Se midió el
 * riesgo del lado opuesto antes de elegirlo. de los 1350 fondos del
 * catálogo, 0 tienen un nombre que empiece con esa palabra, aunque varios la
 * lleven adentro, como «FONDO MUTUO EUROAMERICA RETORNO TOTAL».
 *
 * No se mira el campo `RUN`, que en estas filas viene con un guion, porque
 * la planilla de inversiones no tiene esa columna y la de fondos del sistema
 * la trae con guion en TODAS sus filas, que sí son datos.
 */
export function separarTotales<T extends Record<string, unknown>>(filas: T[]): { datos: T[]; totales: T[] } {
  const datos: T[] = [];
  const totales: T[] = [];
  for (const fila of filas) {
    const primera = String(Object.values(fila)[0] ?? "").trim();
    if (/^total\b/i.test(primera)) totales.push(fila);
    else datos.push(fila);
  }
  return { datos, totales };
}

/**
 * Une los 2 pisos de una cabecera en un nombre por columna.
 *
 * Cuando el piso de arriba viene vacío, la columna pertenece al grupo que
 * abrió la última celda no vacía a su izquierda, que es como se leen las
 * celdas combinadas de una planilla. Con un solo piso el nombre queda
 * exactamente igual que antes, y eso importa. casi todas las planillas de la
 * CMF tienen 1 solo piso, así que tocar ese camino habría cambiado los
 * nombres de columna de varias operaciones de una vez.
 */
function unirPisos(arriba: string[], abajo: string[]): string[] {
  if (abajo.length === 0) return arriba;
  const largo = Math.max(arriba.length, abajo.length);
  const nombres: string[] = [];
  let grupo = "";
  for (let j = 0; j < largo; j++) {
    const a = arriba[j] ?? "";
    const b = abajo[j] ?? "";
    if (a !== "") grupo = a;
    nombres.push([a !== "" ? a : grupo, b].filter((x) => x !== "").join(" "));
  }
  return nombres;
}

/** Normaliza una clave de columna a snake_case (quita tildes, espacios y caracteres especiales). */
function normalizarClave(h: string): string {
  return fixMojibake(h)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Parsea un archivo XLS/BIFF o XLSX a JSON (SheetJS).
 *  Los Excel de la CMF traen un preámbulo (título, administradora, fecha…) antes del
 *  encabezado real: se detecta la primera fila con nombres de columna plausibles
 *  (3+ celdas de texto sin ":" ni números sueltos) y se usa como header. */
export function xlsAJson(bytes: ArrayBuffer | Uint8Array): Record<string, unknown>[] {
  const wb = XLSX.read(bytes, { type: "array" });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  if (!hoja) return [];
  const crudas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: "", raw: false }) as unknown[][];

  const limpiar = (v: unknown): string => {
    const s = fixMojibake(decodificarEntidades(String(v ?? "").replace(/\s+/g, " "))).trim();
    return s;
  };
  const esHeader = (fila: unknown[]): boolean => {
    const vals = fila.map(limpiar).filter((v) => v.length > 0);
    if (vals.length < 3) return false;
    return vals.every(
      (v) =>
        v.length <= 80 &&
        !v.includes(":") &&
        !/^\d+(\.\d+)?$/.test(v) &&
        !/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(v) &&
        /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 °&/.,'()%*#+-]+$/.test(v),
    );
  };

  const lim = Math.min(crudas.length, 15);
  let idxHeader = -1;
  for (let i = 0; i < lim; i++) {
    if (esHeader(crudas[i])) {
      idxHeader = i;
      break;
    }
  }
  const fila1 = crudas[Math.max(0, idxHeader === -1 ? 0 : idxHeader)].map(limpiar);
  // Cabecera de 2 pisos, como una planilla con celdas combinadas. El piso de
  // arriba agrupa y el de abajo detalla, y usar solo el de arriba dejaba sin
  // nombre a toda columna cuya celda de arriba viene vacía. Medido el 28 de
  // agosto de 2026 en el cuadro de costos. `col_8`, `col_15` y `col_17`, y la
  // última es la comisión por rescate anticipado, que llegaba como un número
  // suelto sin decir si era un porcentaje, un monto o un plazo. Unir los 2
  // pisos arregla además una etiqueta que mentía. la columna que se llamaba
  // «Comisión de Colocación» trae la CONDICIÓN, y así lo dice su piso de abajo.
  // Un segundo piso de cabecera existe para LLENAR LOS HUECOS del primero.
  // Si la fila no pone nombre en ninguna columna que arriba venga vacía, no
  // es un segundo piso. es un dato que se le parece.
  const llenaHuecos = (fila: unknown[]): boolean =>
    fila.some((celda, j) => limpiar(celda) !== "" && limpiar(fila1[j]) === "");
  const candidata = crudas[idxHeader + 1] ?? [];
  const haySegundoPiso = idxHeader >= 0 && esHeader(candidata) && llenaHuecos(candidata);
  const fila2 = haySegundoPiso ? (crudas[idxHeader + 1] ?? []).map(limpiar) : [];
  const header = unirPisos(fila1, fila2);
  // Los datos empiezan justo después de la cabecera, contando sus 2 pisos si
  // los tiene. Antes acá había una ventana. se descartaba como segundo piso
  // CUALQUIER fila que pareciera cabecera dentro de las 3 siguientes, y una
  // fila de datos sin ningún número puro cumple ese criterio, así que se
  // perdía entera, sin error y sin aviso. Medido el 28 de agosto de 2026
  // sobre las 6 planillas reales de fondos mutuos. el único segundo piso
  // legítimo estaba a distancia 1, y las 2 filas de datos que se perdían
  // estaban a distancia 3. Una era el segundo tramo de rescate de un fondo en
  // el cuadro de costos, y la otra la serie de patrimonio del sistema entera.
  const inicio = idxHeader >= 0 ? idxHeader + (haySegundoPiso ? 2 : 1) : 1;

  const out: Record<string, unknown>[] = [];
  for (let i = inicio; i < crudas.length; i++) {
    const fila = crudas[i];
    const filaObj: Record<string, unknown> = {};
    let alguna = false;
    for (let j = 0; j < Math.min(header.length, fila.length); j++) {
      const v = limpiar(fila[j]);
      if (v.length === 0) continue;
      alguna = true;
      const clave = header[j] || `col_${j}`;
      filaObj[clave] = v;
    }
    if (alguna) out.push(filaObj);
  }
  return out;
}

/** Extrae el JSON de Google Visualization (grid fondos_ifrs FI): formato {c:[{v,f}]}. */
export function gridGoogleVisAJson(html: string): {
  columnas: string[];
  filas: Record<string, string>[];
} {
  const re = /google\.visualization\.arrayToDataTable\(([\s\S]*?)\);/;
  const m = html.match(re);
  if (!m) return { columnas: [], filas: [] };
  try {
    const data = JSON.parse(m[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":'));
    if (!Array.isArray(data) || data.length === 0) return { columnas: [], filas: [] };
    const columnas = (data[0] as string[]).map((c) => decodificarEntidades(c));
    const filas = (data.slice(1) as unknown[][]).map((fila) => {
      const obj: Record<string, string> = {};
      columnas.forEach((c, i) => {
        const v = fila[i];
        if (Array.isArray(v)) obj[c] = String(v[0] ?? "");
        else if (v && typeof v === "object") obj[c] = String((v as { v?: unknown }).v ?? "");
        else obj[c] = String(v ?? "");
      });
      return obj;
    });
    return { columnas, filas };
  } catch {
    return { columnas: [], filas: [] };
  }
}

/** Convierte fecha YYYY-MM-DD a dd/mm/aaaa (legacy) o a partes. */
export function fechaLegacy(iso: string): { dd: string; mm: string; aa: string } {
  const [y, m, d] = iso.split("-");
  return { dd: d, mm: m, aa: y };
}

export function fechaLegacyCompleta(iso: string): string {
  const { dd, mm, aa } = fechaLegacy(iso);
  return `${dd}/${mm}/${aa}`;
}
