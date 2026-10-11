/** Caché LRU con TTL por clave (singleton de módulo — seguro para factory per-request). */

interface Entrada<T> {
  valor: T;
  expiraEn: number;
  peso: number;
}

/** Cuánto puede pesar lo guardado. Sin esto, una caché solo cuenta sus entradas. */
interface Presupuesto<T> {
  /** El peso de un valor, en la unidad que sea. */
  pesoDe: (valor: T) => number;
  /** Lo más que pesan todas las entradas juntas. */
  pesoMaximo: number;
  /** Un valor que pesa más que esto no se guarda. */
  pesoMaximoPorEntrada: number;
}

export class CacheLRU<T> {
  private mapa = new Map<string, Entrada<T>>();
  private peso = 0;
  constructor(
    private max = 200,
    private ttlMs = 900_000,
    private presupuesto?: Presupuesto<T>,
  ) {}

  get(clave: string): T | undefined {
    const e = this.mapa.get(clave);
    if (!e) return undefined;
    if (Date.now() > e.expiraEn) {
      this.borrar(clave);
      return undefined;
    }
    this.mapa.delete(clave);
    this.mapa.set(clave, e); // LRU touch
    return e.valor;
  }

  set(clave: string, valor: T, ttlMs = this.ttlMs): void {
    // La que se reemplaza sale primero, para que su lugar y su peso queden libres.
    this.borrar(clave);
    const peso = this.presupuesto?.pesoDe(valor) ?? 0;
    // Lo que no cabe ni solo no se guarda, y no saca a nadie.
    if (this.presupuesto && peso > this.presupuesto.pesoMaximoPorEntrada) return;
    const pesoMaximo = this.presupuesto?.pesoMaximo ?? Number.POSITIVE_INFINITY;
    // Salen las que hace más tiempo nadie usa, hasta que la nueva quepa.
    while (this.mapa.size > 0 && (this.mapa.size >= this.max || this.peso + peso > pesoMaximo)) {
      this.borrar(this.mapa.keys().next().value as string);
    }
    this.mapa.set(clave, { valor, expiraEn: Date.now() + ttlMs, peso });
    this.peso += peso;
  }

  private borrar(clave: string): void {
    const e = this.mapa.get(clave);
    if (!e) return;
    this.mapa.delete(clave);
    this.peso -= e.peso;
  }

  has(clave: string): boolean {
    return this.get(clave) !== undefined;
  }

  size(): number {
    return this.mapa.size;
  }

  /** Lo que pesan todas las entradas guardadas. */
  pesoTotal(): number {
    return this.peso;
  }
}

const MB = 1024 * 1024;

/**
 * Caché de respuestas HTTP crudas (HTML/TXT) con TTL. El peso es el largo del
 * texto. Hoy guarda páginas índice de unos 150.000 caracteres, y el
 * presupuesto está para que una página enorme no se quede guardada.
 */
export const cacheHttp = new CacheLRU<string>(500, 900_000, {
  pesoDe: (texto) => texto.length,
  pesoMaximo: 16 * MB,
  pesoMaximoPorEntrada: 4 * MB,
});

/**
 * Caché de binarios (PDF/XLS) con TTL corto (15 min) para paquetes.
 *
 * Guarda a lo más 16 MB en total, y no guarda un documento de más de 8. Un
 * Worker tiene 128 MB de memoria, y sin presupuesto esta caché guardaba hasta
 * 100 documentos sin mirar su peso. Medido en workerd el 11 de octubre de
 * 2026. con 12 documentos de 3 MB guardados, bajar uno de 20 MB dejaba el
 * proceso en 158 MB. Los números con el presupuesto están en el CLAUDE.md.
 *
 * El costo. un documento de más de 8 MB se vuelve a bajar de la CMF en cada
 * pedido, y un paquete de más de 16 MB no queda entero en la caché.
 */
export const cacheBinario = new CacheLRU<{ bytes: Uint8Array; contentType: string }>(100, 900_000, {
  pesoDe: (documento) => documento.bytes.byteLength,
  pesoMaximo: 16 * MB,
  pesoMaximoPorEntrada: 8 * MB,
});
