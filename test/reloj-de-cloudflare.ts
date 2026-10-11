/**
 * Modelo del reloj y de los temporizadores de Cloudflare Workers, para probar
 * en Node lo que solo pasa en producción.
 *
 * Lo que se midió en Cloudflare el 10 de octubre de 2026, con el Worker de
 * sonda de herramientas/workerd/sonda-produccion.mjs.
 *
 * 1. Date.now() no avanza mientras el Worker gasta CPU.
 * 2. Dentro de un temporizador, Date.now() dice la hora para la que estaba
 *    programado, no la hora en que corrió de verdad. Tras 6 segundos de CPU en
 *    otra petición del mismo aislado, una cadena de temporizadores de 50 ms vio
 *    huecos de 50 ms, y un intervalo de 1000 vio huecos de 1000.
 * 3. Los temporizadores atrasados corren apenas el hilo queda libre, uno tras
 *    otro, hasta ponerse al día. Una cadena que pedía 9000 ms terminó a los
 *    9000 de reloj real con 5 segundos de CPU en medio.
 * 4. Cada petición lleva su propio reloj y su propia fila de temporizadores, y
 *    el motor despacha un temporizador atrasado por petición y por turno. Una
 *    petición con muchos temporizadores avanza su reloj mucho más lento que
 *    una con un solo temporizador.
 *
 * Los puntos 1 a 3 están medidos directo. El punto 4 es el modelo que explica
 * la medición que lo motivó. una petición con 10 consultas perdió sus 4 cupos
 * frente al sondeo de otra petición, con «sin_senal_ms» de 5050, que es
 * exactamente 101 turnos de un sondeo de 50 ms.
 *
 * Lo que este modelo no tiene. una entrada o salida real (la respuesta de la
 * red) pone el reloj de su petición en la hora de verdad. Acá la red de las
 * pruebas responde con un temporizador, igual que la red interna de la sonda.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface Temporizador {
  id: number;
  cuando: number;
  /** Cada cuánto se repite, o 0 si corre una sola vez. */
  periodo: number;
  correr: () => void;
}

interface Peticion {
  nombre: string;
  reloj: number;
  viva: boolean;
  /** Ya respondió. Sigue viva solo mientras le queden promesas en waitUntil. */
  respondio: boolean;
  /** Las promesas que le pasaron a waitUntil y todavía no terminan. */
  pendientes: number;
  temporizadores: Map<number, Temporizador>;
}

export interface Mundo {
  /** Empieza una petición nueva. Lo que `cuerpo` lance y los temporizadores que cree son de ella. */
  peticion<T>(nombre: string, cuerpo: () => T): T;
  /** Pasa el tiempo con el hilo libre. Cada temporizador corre a su hora. */
  avanzar(ms: number): Promise<void>;
  /** El hilo gasta CPU. La hora de verdad avanza y ningún temporizador corre. */
  detener(ms: number): void;
  /**
   * La petición entrega su respuesta. Sus temporizadores y sus promesas
   * pendientes se abandonan, salvo que le queden promesas en waitUntil. en ese
   * caso sigue viva hasta que terminen.
   */
  terminar(nombre: string): void;
  /** El ctx.waitUntil de la petición en curso. Se llama desde adentro de una petición. */
  esperarHasta(promesa: Promise<unknown>): void;
  /** Dice si la petición sigue viva. */
  viva(nombre: string): boolean;
  /** Cuántos temporizadores tiene pendientes la petición. */
  temporizadores(nombre: string): number;
  /** La hora de verdad. */
  ahora(): number;
}

/** Deja correr todas las continuaciones pendientes antes de despachar el temporizador siguiente. */
async function drenar(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
}

/** El temporizador más antiguo de una petición que ya venció a la hora `real`, o undefined. */
function vencidoDe(p: Peticion, real: number): Temporizador | undefined {
  let primero: Temporizador | undefined;
  for (const t of p.temporizadores.values()) {
    if (t.cuando > real) continue;
    if (!primero || t.cuando < primero.cuando || (t.cuando === primero.cuando && t.id < primero.id)) primero = t;
  }
  return primero;
}

function morirSiCorresponde(p: Peticion): void {
  if (!p.respondio || p.pendientes > 0) return;
  p.viva = false;
  p.temporizadores.clear();
}

class RelojDeCloudflare implements Mundo {
  private enCurso = new AsyncLocalStorage<Peticion>();
  private peticiones = new Map<string, Peticion>();
  private siguienteId = 1;
  private turno = 0;
  constructor(private real: number) {}

  /** Lo que Date.now() dice. dentro de una petición, su reloj. Afuera, la hora de verdad. */
  reloj = (): number => this.enCurso.getStore()?.reloj ?? this.real;

  programar(correr: () => void, ms: number | undefined, periodo: number): number {
    const dueno = this.enCurso.getStore();
    if (!dueno) throw new Error("modelo. un temporizador creado fuera de toda petición");
    const id = this.siguienteId++;
    dueno.temporizadores.set(id, { id, cuando: dueno.reloj + Math.max(0, ms ?? 0), periodo, correr });
    return id;
  }

  cancelar = (id: unknown): void => {
    for (const p of this.peticiones.values()) p.temporizadores.delete(id as number);
  };

  /** Corre el temporizador vencido más antiguo de una petición, si lo tiene. */
  private async despacharUno(p: Peticion): Promise<void> {
    const t = p.viva ? vencidoDe(p, this.real) : undefined;
    if (!t) return;
    const programado = t.cuando;
    if (t.periodo > 0) t.cuando += t.periodo;
    else p.temporizadores.delete(t.id);
    // Dentro del temporizador, el reloj dice la hora para la que estaba programado.
    p.reloj = Math.max(p.reloj, programado);
    this.enCurso.run(p, t.correr);
    await drenar();
  }

  /** Un temporizador vencido por petición y por turno, hasta que no quede ninguno. */
  private async despachar(): Promise<void> {
    for (;;) {
      const vivas = [...this.peticiones.values()].filter((p) => p.viva && vencidoDe(p, this.real));
      if (vivas.length === 0) return;
      // El primero de cada vuelta rota, para que ninguna petición vaya siempre adelante.
      this.turno++;
      for (let i = 0; i < vivas.length; i++) await this.despacharUno(vivas[(i + this.turno) % vivas.length]);
    }
  }

  /** La hora del próximo temporizador de alguna petición viva. */
  private proximo(): number {
    let minimo = Number.POSITIVE_INFINITY;
    for (const p of this.peticiones.values()) {
      if (!p.viva) continue;
      for (const t of p.temporizadores.values()) minimo = Math.min(minimo, t.cuando);
    }
    return minimo;
  }

  peticion<T>(nombre: string, cuerpo: () => T): T {
    // La llegada de una petición es una entrada real. su reloj parte en la hora de verdad.
    const p: Peticion = { nombre, reloj: this.real, viva: true, respondio: false, pendientes: 0, temporizadores: new Map() };
    this.peticiones.set(nombre, p);
    return this.enCurso.run(p, cuerpo);
  }

  async avanzar(ms: number): Promise<void> {
    const hasta = this.real + ms;
    await drenar();
    await this.despachar();
    for (let cuando = this.proximo(); cuando <= hasta; cuando = this.proximo()) {
      this.real = Math.max(this.real, cuando);
      await this.despachar();
    }
    this.real = hasta;
  }

  detener(ms: number): void {
    this.real += ms;
  }

  terminar(nombre: string): void {
    const p = this.peticiones.get(nombre);
    if (!p) throw new Error(`modelo. no existe la petición ${nombre}`);
    p.respondio = true;
    morirSiCorresponde(p);
  }

  esperarHasta = (promesa: Promise<unknown>): void => {
    const p = this.enCurso.getStore();
    if (!p) throw new Error("modelo. waitUntil fuera de toda petición");
    p.pendientes++;
    const listo = () => {
      p.pendientes--;
      morirSiCorresponde(p);
    };
    promesa.then(listo, listo);
  };

  viva(nombre: string): boolean {
    return this.peticiones.get(nombre)?.viva ?? false;
  }

  temporizadores(nombre: string): number {
    return this.peticiones.get(nombre)?.temporizadores.size ?? 0;
  }

  ahora(): number {
    return this.real;
  }
}

/** Corre `fn` con el reloj y los temporizadores de Cloudflare, y después devuelve los de Node. */
export async function conRelojDeCloudflare<T>(fn: (mundo: Mundo) => Promise<T>): Promise<T> {
  const originales = {
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    clearTimeout: globalThis.clearTimeout,
    clearInterval: globalThis.clearInterval,
    ahora: Date.now,
  };
  const mundo = new RelojDeCloudflare(Date.now());
  globalThis.setTimeout = ((correr: () => void, ms?: number) => mundo.programar(correr, ms, 0)) as unknown as typeof setTimeout;
  globalThis.setInterval = ((correr: () => void, ms?: number) => mundo.programar(correr, ms, Math.max(1, ms ?? 1))) as unknown as typeof setInterval;
  globalThis.clearTimeout = mundo.cancelar as typeof clearTimeout;
  globalThis.clearInterval = mundo.cancelar as typeof clearInterval;
  Date.now = mundo.reloj;
  try {
    return await fn(mundo);
  } finally {
    globalThis.setTimeout = originales.setTimeout;
    globalThis.setInterval = originales.setInterval;
    globalThis.clearTimeout = originales.clearTimeout;
    globalThis.clearInterval = originales.clearInterval;
    Date.now = originales.ahora;
  }
}
