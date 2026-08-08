/**
 * ZIP minimalista modo "store" (sin compresión): CRC32 + headers locales/centrales.
 * Los PDF ya vienen comprimidos; store basta y evita una dependencia grande (jszip).
 * Compatible con Workers y Node (solo operaciones de bytes).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  ruta: string;
  bytes: Uint8Array;
}

function u16(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
}
function u32(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}

/** Construye un ZIP (método store) a partir de entradas {ruta, bytes}. */
export function construirZip(entradas: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entradas) {
    const nombre = new TextEncoder().encode(e.ruta);
    const crc = crc32(e.bytes);
    const tam = e.bytes.length;

    // Header local
    const local = new Uint8Array(30 + nombre.length);
    local.set(u32(0x04034b50), 0); // firma
    local.set(u16(20), 4); // versión
    local.set(u16(0), 6); // flags
    local.set(u16(0), 8); // método store
    local.set(u32(0), 10); // tiempo
    local.set(u32(crc), 14);
    local.set(u32(tam), 18); // tamaño comprimido
    local.set(u32(tam), 22); // tamaño original
    local.set(u16(nombre.length), 26);
    local.set(u16(0), 28);
    local.set(nombre, 30);
    chunks.push(local, e.bytes);

    // Entrada central
    const cen = new Uint8Array(46 + nombre.length);
    cen.set(u32(0x02014b50), 0); // firma
    cen.set(u16(20), 4); // versión creada
    cen.set(u16(20), 6); // versión necesaria
    cen.set(u16(0), 8); // flags
    cen.set(u16(0), 10); // método
    cen.set(u32(0), 12); // tiempo
    cen.set(u32(crc), 16);
    cen.set(u32(tam), 20);
    cen.set(u32(tam), 24);
    cen.set(u16(nombre.length), 28);
    cen.set(u16(0), 30);
    cen.set(u16(0), 32);
    cen.set(u16(0), 34);
    cen.set(u16(0), 36);
    cen.set(u32(0), 38);
    cen.set(u32(offset), 42);
    cen.set(nombre, 46);
    central.push(cen);

    offset += local.length + tam;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of central) {
    chunks.push(c);
    centralSize += c.length;
  }

  // Fin del archivo central
  const fin = new Uint8Array(22);
  fin.set(u32(0x06054b50), 0); // firma
  fin.set(u16(0), 4);
  fin.set(u16(0), 6);
  fin.set(u16(entradas.length), 8);
  fin.set(u16(entradas.length), 10);
  fin.set(u32(centralSize), 12);
  fin.set(u32(centralOffset), 16);
  fin.set(u16(0), 20);
  chunks.push(fin);

  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export function zipABase64(zip: Uint8Array): string {
  return bytesABase64(zip);
}

/** Bytes → base64 por chunks (evita límites de argumentos del spread). */
export function bytesABase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(bin);
}
