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
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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
export interface CeldaTabla {
  texto: string;
  enlace: string;
}

/** Fila de tabla: celdas + si todas vienen de <th> (encabezado, nunca es dato). */
export interface FilaTabla {
  celdas: CeldaTabla[];
  esHeader: boolean;
}

/** Extrae todas las <table> de un HTML como arrays de filas (celdas decodificadas + enlace). */
function htmlTablas(html: string): FilaTabla[][] {
  const tablas: FilaTabla[][] = [];
  const reTabla = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = reTabla.exec(html)) !== null) {
    const filas: FilaTabla[] = [];
    const reFila = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = reFila.exec(tm[1])) !== null) {
      const celdas: CeldaTabla[] = [];
      let todasTh = true;
      const reCelda = /<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = reCelda.exec(rm[1])) !== null) {
        if (cm[1] !== "h") todasTh = false;
        const href = cm[2].match(/href="([^"]+)"/i)?.[1] ?? "";
        celdas.push({
          texto: fixMojibake(decodificarEntidades(cm[2].replace(/<[^>]+>/g, " "))),
          enlace: href.startsWith("/") ? `https://www.cmfchile.cl${href}` : href,
        });
      }
      if (celdas.length > 0) filas.push({ celdas, esHeader: todasTh });
    }
    if (filas.length > 0) tablas.push(filas);
  }
  return tablas;
}

/** Convierte una tabla HTML a JSON: primera fila = columnas (o columnas proporcionadas).
 *  Las filas de encabezado (<th>) nunca se devuelven como datos. */
export function htmlTablaAJson(html: string, columnas?: string[]): Record<string, string>[] {
  const tablas = htmlTablas(html);
  const out: Record<string, string>[] = [];
  for (const t of tablas) {
    if (t.length === 0) continue;
    const conColumnasExplicitas = columnas !== undefined;
    const primera = t.find((f) => !f.esHeader) ?? t[0];
    const cols = columnas ?? primera.celdas.map((c) => c.texto);
    for (const filaTabla of t) {
      if (filaTabla.esHeader) continue;
      // Sin columnas explícitas, la primera fila no-header define las columnas: no es dato.
      if (!conColumnasExplicitas && filaTabla === primera) continue;
      const fila: Record<string, string> = {};
      filaTabla.celdas.forEach((celda, j) => {
        if (j < cols.length) fila[cols[j]] = celda.texto;
      });
      const conEnlace = filaTabla.celdas.find((c) => c.enlace);
      fila.url = conEnlace ? conEnlace.enlace : "";
      out.push(fila);
    }
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
  const inicio = idxHeader >= 0 ? idxHeader + 1 : 1;
  const header = crudas[Math.max(0, idxHeader === -1 ? 0 : idxHeader)].map(limpiar);

  const out: Record<string, unknown>[] = [];
  for (let i = inicio; i < crudas.length; i++) {
    const fila = crudas[i];
    // Filas de encabezado de segundo nivel justo después del header real
    // (p.ej. "Rem. Fija | Rem. Var. | % | %" en costos): no son datos.
    if (i - idxHeader <= 3 && idxHeader >= 0 && esHeader(fila)) continue;
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
