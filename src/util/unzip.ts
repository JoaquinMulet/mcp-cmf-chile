/**
 * Unzip mínimo para los ZIP públicos de la CMF (ISPRO, cartera C.1835).
 * Lee el directorio central y descomprime entradas con método 0 (store) y 8 (deflate)
 * usando DecompressionStream("deflate-raw") (disponible en Workers y Node ≥18).
 * Sin dependencias externas.
 */

export interface ZipEntrada {
  nombre: string;
  bytes: Uint8Array;
}

interface LocalHeader {
  nombre: string;
  metodo: number;
  inicioDatos: number;
  tamComp: number;
  tamSin: number;
}

const dec = new TextDecoder("latin1");

export async function unzip(bytes: Uint8Array): Promise<ZipEntrada[]> {
  const fin = findEOCD(bytes);
  if (!fin) throw new Error("ZIP inválido: no se encontró el directorio central");
  const total = fin.total;
  const entradas: ZipEntrada[] = [];
  let off = fin.cdOffset;
  for (let i = 0; i < total; i++) {
    if (bytes[off] !== 0x50 || bytes[off + 1] !== 0x4b || bytes[off + 2] !== 0x01 || bytes[off + 3] !== 0x02) {
      break;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const _metodo = view.getUint16(off + 10, true);
    const _tamComp = view.getUint32(off + 20, true);
    const tamSin = view.getUint32(off + 28, true);
    const largoNombre = view.getUint16(off + 28, true);
    const extra = view.getUint16(off + 30, true);
    const comentario = view.getUint16(off + 32, true);
    const nombre = dec.decode(bytes.subarray(off + 46, off + 46 + largoNombre));
    const localOff = view.getUint32(off + 42, true);
    const local = leerLocal(bytes, localOff);
    if (!local) {
      off += 46 + largoNombre + extra + comentario;
      continue;
    }
    const datos = bytes.subarray(local.inicioDatos, local.inicioDatos + local.tamComp);
    let contenido: Uint8Array;
    if (local.metodo === 0) {
      contenido = datos;
    } else if (local.metodo === 8) {
      contenido = await inflar(datos, tamSin);
    } else {
      throw new Error(`Método ZIP no soportado (${local.metodo}) en ${nombre}`);
    }
    entradas.push({ nombre, bytes: contenido });
    off += 46 + largoNombre + extra + comentario;
  }
  return entradas;
}

function findEOCD(bytes: Uint8Array): { total: number; cdOffset: number } | null {
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { total: view.getUint16(i + 10, true), cdOffset: view.getUint32(i + 16, true) };
    }
  }
  return null;
}

function leerLocal(bytes: Uint8Array, off: number): LocalHeader | null {
  if (bytes[off] !== 0x50 || bytes[off + 1] !== 0x4b || bytes[off + 2] !== 0x03 || bytes[off + 3] !== 0x04) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metodo = view.getUint16(off + 8, true);
  const tamComp = view.getUint32(off + 18, true);
  const largoNombre = view.getUint16(off + 26, true);
  const extra = view.getUint16(off + 28, true);
  const nombre = dec.decode(bytes.subarray(off + 30, off + 30 + largoNombre));
  return { nombre, metodo, inicioDatos: off + 30 + largoNombre + extra, tamComp, tamSin: 0 };
}

async function inflar(datos: Uint8Array, tamSin: number): Promise<Uint8Array> {
  const copia = datos.slice(); // Uint8Array<ArrayBuffer> para BlobPart
  const stream = new Blob([copia]).stream().pipeThrough(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>);
  const buf = await new Response(stream).arrayBuffer();
  if (tamSin && buf.byteLength !== tamSin) {
    // Algunos ZIPs (OLE2 internos) no inflan bien con deflate-raw; retry con "deflate"
    try {
      const s2 = new Blob([copia]).stream().pipeThrough(new DecompressionStream("deflate") as unknown as TransformStream<Uint8Array, Uint8Array>);
      const buf2 = await new Response(s2).arrayBuffer();
      if (buf2.byteLength === tamSin) return new Uint8Array(buf2);
    } catch {
      /* quedarse con el primero */
    }
  }
  return new Uint8Array(buf);
}
