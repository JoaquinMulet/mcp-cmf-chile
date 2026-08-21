/** Caché LRU con TTL por clave (singleton de módulo — seguro para factory per-request). */

interface Entrada<T> {
  valor: T;
  expiraEn: number;
}

class CacheLRU<T> {
  private mapa = new Map<string, Entrada<T>>();
  constructor(
    private max = 200,
    private ttlMs = 900_000,
  ) {}

  get(clave: string): T | undefined {
    const e = this.mapa.get(clave);
    if (!e) return undefined;
    if (Date.now() > e.expiraEn) {
      this.mapa.delete(clave);
      return undefined;
    }
    this.mapa.delete(clave);
    this.mapa.set(clave, e); // LRU touch
    return e.valor;
  }

  set(clave: string, valor: T, ttlMs = this.ttlMs): void {
    if (this.mapa.size >= this.max) {
      const primero = this.mapa.keys().next().value;
      if (primero !== undefined) this.mapa.delete(primero);
    }
    this.mapa.set(clave, { valor, expiraEn: Date.now() + ttlMs });
  }

  has(clave: string): boolean {
    return this.get(clave) !== undefined;
  }

  size(): number {
    return this.mapa.size;
  }
}

/** Caché de respuestas HTTP crudas (HTML/TXT) con TTL. */
export const cacheHttp = new CacheLRU<string>(500, 900_000);

/** Caché de binarios (PDF/XLS) con TTL corto (15 min) para paquetes. */
export const cacheBinario = new CacheLRU<{ bytes: Uint8Array; contentType: string }>(100, 900_000);
