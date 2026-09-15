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
    // Se mide desde la PRIMERA llamada, no entre vecinas. Con la máquina
    // cargada 2 temporizadores vencidos disparan seguidos (brecha de 1 ms) y
    // la prueba salía roja sin que el limitador fallara (14 de septiembre de
    // 2026, en el pre-push). Lo que no puede pasar es que la llamada i salga
    // antes de i × 120 ms desde la primera; la carga solo la puede atrasar.
    const desde = tiempos.map((t) => t - tiempos[0]);
    assert.ok(desde.every((d, i) => d >= i * 120 - 5), `desde la primera, en ms. ${desde.join(", ")}`);
  } finally {
    globalThis.fetch = original;
  }
});
