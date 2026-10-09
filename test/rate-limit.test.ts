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
    // Llamada de calentamiento a OTRO host. La primera llamada del proceso
    // carga módulos entre que reserva su turno y que hace el fetch, y con la
    // suite completa esa carga llegó a 8 ms: la primera salía tarde, la
    // segunda a su hora, y la brecha medida daba 112 ms con el limitador sano
    // (9 de octubre de 2026). Con otro host no se toca el turno del medido.
    await fetchCmf("https://api.sbif.cl/calentamiento", {}, env);
    tiempos.length = 0;
    const lanzamiento = Date.now();
    await Promise.all(
      [1, 2, 3, 4, 5].map((i) => fetchCmf(`https://www.cmfchile.cl/institucional/estadisticas/x${i}.php`, {}, env)),
    );
    tiempos.sort((a, b) => a - b);
    // Se mide desde el LANZAMIENTO, no entre vecinas ni desde la primera
    // llamada. Entre vecinas, 2 temporizadores vencidos disparan seguidos con
    // la máquina cargada (14 de septiembre de 2026). Desde la primera, la que
    // se atrasa es la primera: reserva su turno a tiempo y sale tarde, y las
    // demás salen a su hora. Medido el 9 de octubre de 2026 con la máquina
    // cargada, en 48 corridas. la primera salió hasta 26 ms tarde, y esa vara
    // dio 2 rojos con el limitador sano. El lanzamiento es anterior a todo
    // turno, así que la carga solo puede atrasar una llamada respecto de él.
    // Lo que no puede pasar es que la llamada i salga antes de i × 120 ms.
    const desde = tiempos.map((t) => t - lanzamiento);
    assert.ok(desde.every((d, i) => d >= i * 120 - 5), `desde el lanzamiento, en ms. ${desde.join(", ")}`);
  } finally {
    globalThis.fetch = original;
  }
});
