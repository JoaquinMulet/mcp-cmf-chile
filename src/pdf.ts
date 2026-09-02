/**
 * Conversión de PDF → Markdown usando pdf-inspector (Firecrawl, MIT):
 * clasifica el PDF (text-based vs escaneado) y extrae Markdown estructurado
 * (tablas, encabezados, listas) sin OCR.
 *
 * El módulo WebAssembly se inyecta desde cada runtime:
 * - Cloudflare Workers: import directo del .wasm (wrangler lo convierte en módulo).
 * - Node/STDIO: cargado desde disco en index.ts (node:fs).
 */

export interface PdfResultado {
  pdfType: "TextBased" | "Scanned" | "ImageBased" | "Mixed" | string;
  markdown: string | null;
}

/**
 * Límite REAL de la conversión, en bytes.
 *
 * No es una decisión editorial sobre cuánto dato mereces. Es lo que el
 * wasm de pdf-inspector puede asignar dentro de un Worker, así que este
 * sí es un límite legítimo. El mensaje lo calcula desde acá, nunca
 * escrito a mano, para que no queden 2 cifras distintas.
 */
const LIMITE_PDF_BYTES = 4 * 1024 * 1024;

/** MB con 1 decimal y coma, como se escribe en español. */
function enMb(bytes: number): string {
  return (bytes / 1048576).toFixed(1).replace(".", ",");
}

/**
 * La salida que sirve para las 2 fallas. bajar el PDF y convertirlo
 * afuera. Estaba repetida 3 veces palabra por palabra.
 */
const COMO_SEGUIR =
  "Usa modo=documentos (devuelve la URL del PDF) y descárgalo tú. "
  + "Si tu modelo tiene visión, lee sus páginas como imagen: es la lectura más fiable. "
  + "Para pasarlo a Markdown localmente, recomendamos pdf-inspector (Firecrawl, MIT): "
  + "https://github.com/firecrawl/pdf-inspector — el mismo motor que usa este servidor. "
  + "Repositorio del proyecto: https://github.com/JoaquinMulet/mcp-cmf-chile";

/**
 * Resumen de una frase para las DESCRIPCIONES de las tools y las
 * instrucciones del servidor. El modelo lo lee ANTES de llamar, y ahí es
 * donde uno con visión puede elegir el PDF en vez del Markdown.
 */
export const RESUMEN_LIMITACIONES_PDF =
  "La conversión a Markdown es una aproximación: sin OCR, con tablas que pueden fusionar "
  + "conceptos o correr cifras de columna. Si el modelo tiene visión, lo más fiable es "
  + "descargar el PDF y leer sus páginas como imagen, usando el Markdown solo para ubicar la página.";

/**
 * Nota completa que viaja en CADA respuesta que convierte un PDF.
 *
 * Medido el 2 de septiembre de 2026 con los EEFF de Copec 2026-03: al
 * cambiar la versión del motor, las filas separadas pasaron de 181 a 107
 * y ninguna versión cuadró el balance. El texto es una aproximación y el
 * modelo tiene que saberlo antes de citar una cifra, no después.
 */
export function notaLimitacionesPdf(pdfType: string): string {
  const escaneado = pdfType === "Scanned" || pdfType === "ImageBased";
  const cabecera = escaneado
    ? "Este PDF es escaneado o de imágenes: el motor no tiene OCR y el texto extraído puede venir vacío o incompleto."
    : "LIMITACIONES DE LA CONVERSIÓN PDF A MARKDOWN.";
  return `${cabecera}
- El motor (pdf-inspector) extrae texto sin OCR: un PDF escaneado sale vacío.
- En tablas anchas puede fusionar varios conceptos en una celda, correr una cifra a la columna vecina o perder el encabezado de período. Las cifras son las del PDF, pero su posición puede estar equivocada.
- Cada versión del motor extrae distinto. El mismo PDF puede dar tablas distintas mañana, así que este texto no es una fuente estable para citar.
- Si tu modelo tiene visión, la lectura más fiable es descargar el PDF (modo=documentos o cmf_documento_descargar) y leer sus páginas como imagen. Usa este Markdown para ubicar la página y verifica cada cifra en la imagen antes de citarla.`;
}

/** El documento pesa más de lo que el motor puede cargar. Causa cierta. */
function errorPdfMuyGrande(bytes: Uint8Array): Error {
  return new Error(
    `El documento pesa ${enMb(bytes.length)} MB y supera el límite de conversión del servidor `
    + `(${enMb(LIMITE_PDF_BYTES)} MB): el motor de extracción no puede procesarlo acá. ${COMO_SEGUIR}`,
  );
}

/**
 * El motor falló con un documento que SÍ cabía.
 *
 * Antes este caso reusaba el mensaje de arriba, así que un PDF de 2 MB
 * recibía un error diciendo que superaba los 4 MB. Un mismo mensaje para
 * 2 causas distintas es una mentira, y quien lo lee elige la que le
 * conviene. Acá se dice lo que de verdad pasó.
 */
function errorMotorFallo(bytes: Uint8Array, causa: unknown): Error {
  const detalle = String((causa as Error)?.message ?? causa).slice(0, 200);
  return new Error(
    `El motor de extracción falló con un documento de ${enMb(bytes.length)} MB, que sí cabe en el `
    + `límite de ${enMb(LIMITE_PDF_BYTES)} MB. Suele pasar con PDF malformados o de estructura muy `
    + `pesada. Detalle del motor: ${detalle}. ${COMO_SEGUIR}`,
  );
}

let wasmInicializado = false;

export async function pdfAMarkdown(
  moduloWasm: WebAssembly.Module | undefined,
  bytes: Uint8Array,
): Promise<PdfResultado> {
  if (!moduloWasm) {
    throw new Error("Módulo pdf-inspector no disponible en este runtime");
  }
  if (bytes.length > LIMITE_PDF_BYTES) {
    throw errorPdfMuyGrande(bytes);
  }
  try {
    const mod = await import("@firecrawl/pdf-inspector-wasm");
    if (!wasmInicializado) {
      await mod.initSync({ module: moduloWasm });
      wasmInicializado = true;
    }
    const r = mod.processPdf(bytes);
    return { pdfType: String(r?.pdfType ?? "?"), markdown: (r?.markdown as string | null) ?? null };
  } catch (e) {
    // El motor puede fallar aunque el documento quepa (PDF malformados,
    // estructuras muy pesadas). Es una causa DISTINTA de pasarse del
    // límite, así que lleva su propio mensaje. Antes los 2 casos
    // compartían texto y un PDF de 2 MB recibía un error diciendo que
    // superaba los 4 MB.
    throw errorMotorFallo(bytes, e);
  }
}

/** Carga el módulo WebAssembly de pdf-inspector desde disco (solo Node/STDIO). */
export async function cargarPdfModuleDesdeDisco(): Promise<WebAssembly.Module> {
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const ruta = req.resolve("@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm");
  const buf = await readFile(ruta);
  return WebAssembly.compile(buf);
}
