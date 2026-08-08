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

/** Límite defensivo: el wasm de pdf-inspector no puede asignar buffers muy grandes
 *  en un Worker (memoria limitada) y su error crudo no enseña nada. */
export const LIMITE_PDF_BYTES = 4 * 1024 * 1024;

export function errorPdfMuyGrande(bytes: Uint8Array): Error {
  const mb = (bytes.length / 1048576).toFixed(1).replace(".", ",");
  return new Error(
    `El documento pesa ${mb} MB y supera el límite de conversión del servidor (4 MB): el motor de extracción no puede procesarlo acá. ` +
      `Usa modo=documentos (devuelve la URL del PDF) y descárgalo tú. ` +
        `Para pasarlo a Markdown localmente, recomendamos pdf-inspector (Firecrawl, MIT): https://github.com/firecrawl/pdf-inspector — el mismo motor que usa este servidor. ` +
      `Repositorio del proyecto: https://github.com/JoaquinMulet/mcp-cmf-chile`,
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
    // El motor puede fallar por memoria aunque el tamaño sea menor al límite
    // (PDFs malformados, estructuras pesadas): convertir el error crudo en didáctico.
    if (bytes.length > 1024 * 1024) throw errorPdfMuyGrande(bytes);
    throw new Error(
      `El motor de extracción del PDF falló (${String((e as Error)?.message ?? e).slice(0, 200)}). ` +
        `Usa modo=documentos (devuelve la URL del PDF) y descárgalo tú. ` +
      `Para pasarlo a Markdown localmente, recomendamos pdf-inspector (Firecrawl, MIT): https://github.com/firecrawl/pdf-inspector — el mismo motor que usa este servidor. ` +
        `Repositorio del proyecto: https://github.com/JoaquinMulet/mcp-cmf-chile`,
    );
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
