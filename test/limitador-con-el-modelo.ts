/**
 * Lo que comparten las pruebas del limitador que corren con el modelo del
 * reloj de Cloudflare (test/reloj-de-cloudflare.ts).
 */
import assert from "node:assert/strict";
import type { Mundo } from "./reloj-de-cloudflare.js";

export type Cliente = typeof import("../src/client/cmf-client.js");

/**
 * Un cliente recién cargado, con su limitador sin usar. Cada prueba parte
 * limpia, aunque la anterior haya dejado consultas que no terminan nunca.
 */
export const clienteNuevo = async (caso: string) => (await import(`../src/client/cmf-client.js?caso=${caso}`)) as Cliente;

export const TOPE = 4;

/** La red. `?ms=N` tarda N en responder, con un temporizador de la petición que consulta. */
export function redSimulada() {
  const red = { enVuelo: 0, maximo: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    red.enVuelo++;
    red.maximo = Math.max(red.maximo, red.enVuelo);
    await new Promise((r) => setTimeout(r, Number(new URL(String(url)).searchParams.get("ms") ?? "0")));
    red.enVuelo--;
    return new Response("ok");
  }) as typeof fetch;
  return { red, devolver: () => void (globalThis.fetch = original) };
}

/** Junta lo que el cliente deja en el log mientras corre `fn`. */
export async function conAvisos(fn: (avisos: string[]) => Promise<void>): Promise<void> {
  const original = console.warn;
  const avisos: string[] = [];
  console.warn = (linea: unknown) => void avisos.push(String(linea));
  try {
    await fn(avisos);
  } finally {
    console.warn = original;
  }
}

export const recuperados = (avisos: string[]) => avisos.filter((a) => a.includes("cmf_cupo_recuperado"));

export const ENV = { CMF_RATE_LIMIT_MS: "0", CMF_ESPERA_CUPO_MS: "600000", CMF_UPSTREAM_TIMEOUT_MS: "600000" };

/** Lanza una consulta sin esperarla. Su resultado queda en `fin`. */
export function lanzar(cliente: Cliente, nombre: string, ms: number, env: Record<string, string> = ENV): { fin: string | undefined } {
  const estado: { fin: string | undefined } = { fin: undefined };
  cliente.fetchCmf(`https://api.sbif.cl/${nombre}?ms=${ms}`, {}, env).then(
    () => void (estado.fin = "ok"),
    (e: Error) => void (estado.fin = `error. ${e.message}`),
  );
  return estado;
}

/** Cuántas consultas de 100 ms, lanzadas juntas, alcanzan a estar en vuelo a la vez. */
export async function cuposLibres(m: Mundo, cliente: Cliente, red: { enVuelo: number; maximo: number }, rotulo: string): Promise<number> {
  const antes = red.enVuelo;
  red.maximo = antes;
  const fines = m.peticion(`cuenta-${rotulo}`, () => Array.from({ length: 6 }, (_, i) => lanzar(cliente, `cuenta-${rotulo}-${i}`, 100, { ...ENV, CMF_ESPERA_CUPO_MS: "1000" })));
  await m.avanzar(1500);
  assert.ok(fines.every((f) => f.fin !== undefined), `consultas sin terminar. ${rotulo}`);
  return red.maximo - antes;
}
