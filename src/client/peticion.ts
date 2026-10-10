import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Lo que el cliente necesita de la petición del Worker dentro de la que corre.
 *
 * En Cloudflare Workers, cuando una petición entrega su respuesta o su cliente
 * corta la conexión, todo lo que dejó pendiente se abandona. sus promesas no
 * siguen y sus temporizadores no corren más. Medido en producción el 10 de
 * octubre de 2026. una consulta cuyo cliente cortó a los 1500 ms no había
 * terminado 26 segundos después, y su cupo del limitador seguía tomado.
 *
 * `ctx.waitUntil` mantiene viva la petición hasta que una promesa termine,
 * con un máximo de 30 segundos después de la respuesta. Quien atiende la
 * petición lo deja acá, y el cliente lo usa sin que cada tool tenga que
 * pasarlo de mano en mano.
 */
export interface PeticionDelWorker {
  /** El `ctx.waitUntil` de la petición. */
  esperarHasta(promesa: Promise<unknown>): void;
}

/** La petición del Worker en curso. Fuera de un Worker (STDIO, pruebas) no hay ninguna. */
export const peticionEnCurso = new AsyncLocalStorage<PeticionDelWorker>();

const nada = () => {};

/**
 * Mantiene viva la petición en curso hasta que `promesa` termine, bien o mal.
 * Fuera de un Worker no hace nada, porque ahí nadie abandona una promesa.
 */
export function mantenerViva(promesa: Promise<unknown>): void {
  const peticion = peticionEnCurso.getStore();
  if (!peticion) return;
  try {
    peticion.esperarHasta(promesa.then(nada, nada));
  } catch {
    // La petición ya terminó y no admite más. Lo pendiente queda como antes de
    // existir esto. si su dueño murió, el limitador lo recupera solo.
  }
}
