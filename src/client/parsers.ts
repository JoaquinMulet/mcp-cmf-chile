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
  /** Cuántas columnas abarca (colspan). 1 casi siempre. */
  ancho: number;
  /** Cuántas filas abarca (rowspan). 1 casi siempre. */
  alto: number;
}

/** Fila de tabla: celdas + si todas vienen de <th> (encabezado, nunca es dato). */
interface FilaTabla {
  celdas: CeldaTabla[];
  esHeader: boolean;
  /**
   * Una sola celda que abarca varias columnas (colspan). Es el título de la
   * tabla o una nota («Período: 12 / 2025», «Ir a más sanciones»), nunca un
   * dato, y por eso no cuenta para el total ni para la paginación.
   */
  esTitulo: boolean;
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
  return ["select", "script", "style"].reduce((texto, tag) => texto.replace(bloqueDe(tag), " "), html);
}

/**
 * Un bloque `<tag …> … </tag>`, tolerando lo que el HTML de verdad permite.
 *
 * La primera versión pedía `</script>` exacto y CodeQL la marcó como
 * `js/bad-tag-filter` de severidad alta, con razón. El HTML acepta
 * `</script >`, `</script\n>`, `</ script>` y `</SCRIPT>`, y cualquiera de
 * esas 4 formas dejaba la etiqueta adentro con todo su texto, que es justo lo
 * que la función existe para sacar. No es teórico acá. la CMF sirve HTML
 * legacy escrito a mano durante 20 años.
 *
 * La cura no es agregarle un espacio al patrón. Es que el patrón se arme en
 * UN solo lugar, para las 3 etiquetas, y que las variantes estén cubiertas
 * por construcción. `\b` evita que `select` coma un `<selection>`.
 */
function bloqueDe(tag: string): RegExp {
  return new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/\\s*${tag}\\b[^>]*>`, "gi");
}

/** Las celdas de un `<tr>`, con su texto limpio y el enlace de su primer `<a>`. */
function celdasDeUnaFila(tr: string): FilaTabla {
  const celdas: CeldaTabla[] = [];
  let todasTh = true;
  const reCelda = /<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/gi;
  let cm: RegExpExecArray | null;
  let abarcaVarias = false;
  const medida = (attrs: string, nombre: string) => Number(new RegExp(`\\b${nombre}\\s*=\\s*["']?(\\d+)`, "i").exec(attrs)?.[1] ?? 1) || 1;
  while ((cm = reCelda.exec(tr)) !== null) {
    if (cm[1] !== "h") todasTh = false;
    const ancho = medida(cm[2], "colspan");
    const alto = medida(cm[2], "rowspan");
    if (ancho > 1) abarcaVarias = true;
    cm[2] = cm[3];
    // Las fichas de emisor abren el documento con onClick="ventana('/sitio/...')"
    // y dejan href="#", así que el enlace real vive en el onClick.
    // El href puede venir sin comillas (buscador de sanciones), con comillas
    // dobles o simples. Las 3 formas son la misma clase.
    const h = cm[2].match(/href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const hrefAttr = h?.[1] ?? h?.[2] ?? h?.[3] ?? "";
    const ventana = cm[2].match(/ventana\('([^']+)'\)/i)?.[1];
    const href = (hrefAttr === "#" || hrefAttr === "") && ventana ? ventana : hrefAttr;
    celdas.push({
      texto: fixMojibake(decodificarEntidades(cm[2].replace(/<[^>]+>/g, " "))),
      enlace: href.startsWith("/") ? `https://www.cmfchile.cl${href}` : href,
      ancho,
      alto,
    });
  }
  return { celdas, esHeader: todasTh, esTitulo: celdas.length === 1 && abarcaVarias };
}

/** Las filas de una `<table>`, sin las que no tienen ninguna celda. */
function filasDeUnTable(tabla: string): FilaTabla[] {
  const filas: FilaTabla[] = [];
  // Un <thead> con sus <th> sueltos, sin <tr> (cuadros de agentes y
  // corredores), es la cabecera aunque ningún <tr> la contenga.
  const thead = /<thead[^>]*>([\s\S]*?)<\/thead\s*>/i.exec(tabla);
  if (thead && !/<tr\b/i.test(thead[1])) {
    const fila = celdasDeUnaFila(thead[1]);
    if (fila.celdas.length > 0) filas.push({ ...fila, esHeader: true });
  }
  const reFila = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  // Un título (1 celda con colspan) solo se descarta ARRIBA de la tabla,
  // antes de la primera fila con varias celdas. Más abajo, la misma forma
  // puede ser una fila de total o un aviso, y eso sí es información.
  let arriba = true;
  while ((rm = reFila.exec(tabla)) !== null) {
    const fila = celdasDeUnaFila(rm[1]);
    if (fila.celdas.length === 0) continue;
    if (fila.esTitulo && arriba) continue;
    if (fila.celdas.length > 1) arriba = false;
    filas.push(fila);
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
): { cols: string[]; prestadas: FilaTabla[] } {
  const cabecera = t.find((f) => f.esHeader);
  if (columnas) return { cols: columnas, prestadas: [] };
  if (cabecera) return { cols: cabecera.celdas.map((c) => c.texto), prestadas: [] };
  const dosPisos = cabeceraDeDosPisos(t);
  if (dosPisos) return { cols: dosPisos.cols, prestadas: t.slice(0, 2) };
  // Solo se sacrifica una fila de datos cuando NO hay cabecera de verdad.
  const primera = t[0];
  return { cols: primera?.celdas.map((c) => c.texto) ?? [], prestadas: primera ? [primera] : [] };
}

/**
 * Una cabecera de 2 pisos hecha con <td>. la primera fila tiene celdas que
 * abarcan varias columnas (colspan) o varias filas (rowspan) y la segunda
 * trae los nombres de abajo. Es la tabla de clasificación de riesgo de
 * seguros («Compañías» con rowspan, «Sociedades Clasificadoras» con colspan
 * 4, y debajo Feller-Rate, Fitch, Humphreys y Moody's). Sin esto, la segunda
 * fila salía como dato. Devuelve los nombres por columna y cuántas filas
 * dejan de ser dato, o undefined si la tabla no tiene esa forma.
 */
function cabeceraDeDosPisos(t: FilaTabla[]): { cols: string[] } | undefined {
  const [arriba, abajo] = t;
  if (!arriba || !abajo || arriba.esHeader || abajo.esHeader) return undefined;
  // Hace falta un colspan de verdad. un rowspan solo también aparece en
  // filas de DATOS, y con eso 2 filas de datos se consumían como cabecera.
  if (!arriba.celdas.some((c) => c.ancho > 1)) return undefined;
  const cols: string[] = [];
  let j = 0;
  for (const c of arriba.celdas) {
    if (c.alto > 1) {
      cols.push(c.texto);
      continue;
    }
    for (let k = 0; k < c.ancho; k++) {
      const sub = abajo.celdas[j++]?.texto ?? "";
      cols.push([c.texto, sub].filter((x) => x !== "").join(" "));
    }
  }
  // Si la segunda fila no calza con los huecos, no era una cabecera.
  return j === abajo.celdas.length ? { cols } : undefined;
}

function filasDeUnaTabla(t: FilaTabla[], columnas?: string[]): Record<string, string>[] {
  if (t.length === 0) return [];
  const { cols, prestadas } = nombresDeColumna(t, columnas);
  // Una clave `url` vacía en todas las filas no es un dato, es una columna de
  // ruido que el texto para el modelo igual dibuja. Solo existe cuando esta
  // tabla tiene al menos un enlace que valga la pena entregar.
  const conEnlaces = t.some((f) => f.celdas.some((c) => c.enlace));
  const out: Record<string, string>[] = [];
  for (const filaTabla of t) {
    if (filaTabla.esHeader || prestadas.includes(filaTabla)) continue;
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

/**
 * Convierte el literal JavaScript de un objeto (claves sin comillas, strings
 * con comilla simple y escapes `\'`) al JSON equivalente. Es un recorrido
 * carácter a carácter y no una expresión regular, porque las etiquetas del
 * grid traen enlaces con comillas escapadas y dos puntos adentro, y un
 * reemplazo global los rompe en silencio.
 */
function literalJsAJson(src: string): string {
  const CLAVE = /([A-Za-z_$][\w$]*)\s*:/y;
  // Un número tal como lo escribe JavaScript. La CMF emite «-.9771», «.5»
  // y «03», que JavaScript acepta y JSON rechaza. Se normaliza con Number.
  const NUMERO = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"') {
      const cadena = leerCadenaJs(src, i);
      out += JSON.stringify(cadena.texto);
      i = cadena.fin;
      continue;
    }
    CLAVE.lastIndex = i;
    const clave = CLAVE.exec(src);
    if (clave) {
      out += `"${clave[1]}":`;
      i = CLAVE.lastIndex;
      continue;
    }
    NUMERO.lastIndex = i;
    const numero = NUMERO.exec(src);
    if (numero && numero[0] !== "-") {
      out += String(Number(numero[0]));
      i = NUMERO.lastIndex;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** La cadena JS que empieza en `src[desde]` (una comilla), ya sin escapes. */
function leerCadenaJs(src: string, desde: number): { texto: string; fin: number } {
  const comilla = src[desde];
  let texto = "";
  let i = desde + 1;
  while (i < src.length && src[i] !== comilla) {
    if (src[i] !== "\\") {
      texto += src[i++];
      continue;
    }
    const n = src[i + 1] ?? "";
    const hex = n === "u" ? src.slice(i + 2, i + 6) : n === "x" ? src.slice(i + 2, i + 4) : "";
    if (hex && /^[0-9a-fA-F]+$/.test(hex)) {
      texto += String.fromCharCode(Number.parseInt(hex, 16));
      i += 2 + hex.length;
      continue;
    }
    texto += ESCAPES_JS[n] ?? n;
    i += 2;
  }
  return { texto, fin: i + 1 };
}

const ESCAPES_JS: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "0": "\0" };

/** Fin (exclusivo) del objeto que abre en `src[abre]`, saltando las cadenas. */
function finDelObjetoJs(src: string, abre: number): number {
  let profundidad = 0;
  let i = abre;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"') {
      i = leerCadenaJs(src, i).fin;
      continue;
    }
    if (ch === "{" || ch === "[") profundidad++;
    if (ch === "}" || ch === "]") profundidad--;
    i++;
    if (profundidad === 0) return i;
  }
  return -1;
}

/** Texto de una celda o etiqueta del grid, sin marcado, entidades ni sangría. */
function textoDeGrid(s: unknown): string {
  if (s === null || s === undefined) return "";
  if (typeof s === "number") return String(s);
  return decodificarEntidades(String(s).replace(/<[^>]+>/g, " "));
}

/** Nombre único dentro de un objeto. la segunda «Otros» pasa a «Otros (2)». */
function claveUnica(nombre: string, usadas: Map<string, number>): string {
  const n = (usadas.get(nombre) ?? 0) + 1;
  usadas.set(nombre, n);
  return n === 1 ? nombre : `${nombre} (${n})`;
}

interface CeldaGrid { v?: unknown; f?: unknown }
interface GridGoogle { cols: Array<{ label?: string }>; rows: Array<{ c: Array<CeldaGrid | null> }> }

/**
 * Lee el grid de Google Charts con que la CMF sirve los estados financieros
 * e indicadores (sa_eeff_ifrs2grid, seg_*_fecu1, sa_fecu1grid,
 * intermediarios_*). Los datos NO viajan en una <table>: van en un objeto
 * `var dataAsJson = {cols:[...], rows:[...]}` dentro de un <script>, y en
 * la página hay una <table> de adorno que no lleva nada.
 *
 * La columna 0 es la etiqueta de la fila (la cuenta o el indicador) y cada
 * columna siguiente es una entidad en un período («EMPRESAS COPEC S.A.
 * 12 / 2024»). Por defecto cada fila del grid es una fila de salida, con
 * el campo `cuenta` y un campo por entidad. Con `porEntidad` se traspone.
 * cada entidad es una fila, con el campo `entidad` y un campo por cuenta.
 *
 * Devuelve null cuando la página no trae el grid, que es distinto de un
 * grid sin columnas. lo primero es «no pude leer la fuente» y lo segundo
 * es «la fuente no tiene datos para esta consulta».
 */
export function gridDataAsJsonAJson(
  html: string,
  opciones: { porEntidad?: boolean } = {},
): { entidades: string[]; filas: Record<string, string>[]; nota?: string } | null {
  const inicio = html.indexOf("var dataAsJson");
  if (inicio < 0) return null;
  const abre = html.indexOf("{", inicio);
  const cierre = abre < 0 ? -1 : finDelObjetoJs(html, abre);
  if (cierre < 0) return null;
  let grid: GridGoogle;
  try {
    grid = JSON.parse(literalJsAJson(html.slice(abre, cierre))) as GridGoogle;
  } catch {
    return null;
  }
  if (!Array.isArray(grid.cols) || !Array.isArray(grid.rows)) return null;
  // Los nombres reservados de la fila (`entidad`, `cuenta`) ya cuentan como
  // usados, así que una etiqueta real que se llame igual sale como «(2)»
  // en vez de pisar el campo.
  const nombresCol = new Map<string, number>([["cuenta", 1]]);
  const entidades = grid.cols.slice(1).map((c) => claveUnica(textoDeGrid(c.label), nombresCol));
  const celda = (r: { c: Array<CeldaGrid | null> }, j: number) => textoDeGrid(r.c?.[j]?.v);
  const etiquetas = grid.rows.map((r) => celda(r, 0));
  const conDatos = grid.rows.map((_, i) => entidades.some((_e, k) => celda(grid.rows[i], k + 1) !== ""));
  // Una fila sin etiqueta y sin valores es un separador visual del grid.
  const filasUtiles = grid.rows.map((_, i) => etiquetas[i] !== "" || conDatos[i]);
  const m = /Cifras en [^<]{5,300}/.exec(html);
  const nota = m ? decodificarEntidades(m[0]) : undefined;
  let filas: Record<string, string>[];
  if (opciones.porEntidad) {
    const nombresFila = new Map<string, number>([["entidad", 1]]);
    const claves = etiquetas.map((e, i) => claveUnica(e === "" ? `(sin etiqueta ${i + 1})` : e, nombresFila));
    filas = entidades.map((entidad, k) => {
      const fila: Record<string, string> = { entidad };
      grid.rows.forEach((r, i) => {
        if (filasUtiles[i]) fila[claves[i]] = celda(r, k + 1);
      });
      return fila;
    });
  } else {
    filas = grid.rows
      .map((r, i) => {
        const fila: Record<string, string> = { cuenta: etiquetas[i] };
        entidades.forEach((e, k) => {
          fila[e] = celda(r, k + 1);
        });
        return fila;
      })
      .filter((_, i) => filasUtiles[i]);
  }
  return { entidades, filas, ...(nota ? { nota } : {}) };
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
