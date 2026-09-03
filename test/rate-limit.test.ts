/**
 * El rate limiter separa las llamadas a un mismo host aunque salgan juntas.
 *
 * Lo encontró la revisión adversarial del 3 de septiembre de 2026. el
 * limiter leía la hora de la última llamada, calculaba la espera y recién
 * después anotaba la suya, así que 5 llamadas lanzadas en paralelo leían la
 * misma hora vieja y salían en ráfaga (4 peticiones en 7 ms con un mínimo de
 * 400 ms). El catálogo de seguros fue el primer sitio que lanzó 5 llamadas
 * juntas al host real de la CMF, y esa ráfaga es justo lo que la CMF bloquea.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCmf } from "../src/client/cmf-client.js";

test("5 llamadas simultáneas al mismo host salen separadas por el mínimo", async () => {
  const original = globalThis.fetch;
  const tiempos: number[] = [];
  globalThis.fetch = (async () => {
    tiempos.push(Date.now());
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    const env = { CMF_RATE_LIMIT_MS: "120" };
    await Promise.all(
      [1, 2, 3, 4, 5].map((i) => fetchCmf(`https://www.cmfchile.cl/institucional/estadisticas/x${i}.php`, {}, env)),
    );
    tiempos.sort((a, b) => a - b);
    const brechas = tiempos.slice(1).map((t, i) => t - tiempos[i]);
    // El temporizador puede adelantarse 1 o 2 ms; lo que no puede pasar es
    // una brecha de 7 ms.
    assert.ok(brechas.every((b) => b >= 100), `brechas en ms. ${brechas.join(", ")}`);
  } finally {
    globalThis.fetch = original;
  }
});
