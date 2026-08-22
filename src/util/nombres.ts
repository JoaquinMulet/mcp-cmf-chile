/**
 * Normalización de nombres de archivo y carpetas para los paquetes de descarga.
 * Convención (validada en docs/PAQUETES.md): carpeta `<nemo|slug_razon>_<RUT>`,
 * archivos `<tipo>_<periodo>.<ext>` con sufijos únicos (fecha+número) cuando hay repetición.
 */
import { fixMojibake } from "../client/parsers.js";

/** Normaliza un nombre a solo caracteres seguros para nombres de archivo. */
export function nombreArchivoSeguro(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Clasifica un documento CMF por su nombre (portado del proyecto original; corrige mojibake primero). */
export function tipoDocumento(nombreDoc: string): string {
  const n = fixMojibake(nombreDoc).toLowerCase();
  if (n.includes("xbrl")) return "eeff_xbrl";
  if (n.includes("estados financieros")) return "eeff";
  if (n.includes("analisis") || n.includes("análisis")) return "analisis_razonado";
  if (n.includes("declaracion") || n.includes("declaración")) return "declaracion_responsabilidad";
  if (n.includes("hechos")) return "hechos_relevantes";
  return nombreArchivoSeguro(nombreDoc).toLowerCase() || "documento";
}

/** Extensión a partir del content-type. */
export function extensionDeContentType(contentType: string): string {
  const t = contentType.toLowerCase();
  if (t.includes("pdf")) return ".pdf";
  if (t.includes("zip") || t.includes("octet-stream")) return ".zip";
  if (t.includes("excel") || t.includes("spreadsheet")) return ".xlsx";
  if (t.includes("csv") || t.includes("text/plain")) return ".csv";
  return ".bin";
}

/** Carpeta de la empresa: `<nemo|slug>_<RUT>`. */
export function carpetaEmpresa(nemo: string, rut: string, razonSocial?: string): string {
  const base = nemo || nombreArchivoSeguro(razonSocial ?? "").toUpperCase() || "ENTIDAD";
  return `${base}_${rut}`;
}

/** Dedupe: si la ruta ya existe en el set, agrega sufijo _2, _3... */
export function rutaUnica(ruta: string, usadas: Set<string>): string {
  if (!usadas.has(ruta)) {
    usadas.add(ruta);
    return ruta;
  }
  const extIdx = ruta.lastIndexOf(".");
  const base = extIdx > 0 ? ruta.slice(0, extIdx) : ruta;
  const ext = extIdx > 0 ? ruta.slice(extIdx) : "";
  for (let i = 2; i < 100; i++) {
    const candidata = `${base}_${i}${ext}`;
    if (!usadas.has(candidata)) {
      usadas.add(candidata);
      return candidata;
    }
  }
  return ruta;
}

/**
 * Arma la URL absoluta de un documento a partir del href relativo que
 * publica la CMF.
 *
 * Por que existe. antes esto era `href.replace("../", "/institucional/")`
 * repetido en 2 archivos, y `String.replace` con un patron de TEXTO
 * cambia solo la PRIMERA aparicion. Con un href como `../../doc/x.pdf`
 * quedaba `/institucional/../doc/x.pdf`, o sea una ruta que sube un nivel
 * y sale del prefijo que acabamos de poner. Lo encontro CodeQL con la
 * regla js/incomplete-sanitization el 21 de agosto de 2026.
 *
 * La cura no es poner la bandera global. Con `g` un `../../x` daria
 * `/institucional//institucional/x`, que tampoco es la ruta. Lo correcto
 * es anclar al inicio y despues NEGARSE a devolver una ruta que todavia
 * contenga un salto de directorio, porque esa ruta ya no significa lo
 * que dice.
 */
export function urlDocumentoCmf(href: string): string {
  const ruta = href.replace(/^(?:\.\.\/)+/, "/institucional/");
  if (ruta.includes("../")) {
    throw new Error(`Ruta de documento con salto de directorio, no se puede resolver: ${href}`);
  }
  return `https://www.cmfchile.cl${ruta}`;
}
