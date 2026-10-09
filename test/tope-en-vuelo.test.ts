/**
 * El limitador nunca deja más de 4 consultas en vuelo a la vez.
 *
 * Visto por lectura el 9 de octubre de 2026. fetchCmf liberaba su cupo justo
 * después de recibir la respuesta, y si esa respuesta era una redirección a
 * un host fuera de la lista o a http, la validación lanzaba dentro del mismo
 * try y el catch liberaba otra vez. El contador quedaba en -1 y el tope
 * pasaba a 5 para toda la instancia, sin ningún aviso.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCmf } from "../src/client/cmf-client.js";

const LENTA_MS = 120;
const TOPE = 4;

type Respuesta = (url: string) => Response | undefined;

/**
 * Simula la red. `especial` responde las consultas que elige, y el resto son
 * consultas lentas que cuentan cuántas hay en vuelo. Devuelve el máximo visto.
 */
async function conRedLenta(especial: Respuesta, fn: (avisos: string[]) => Promise<void>): Promise<number> {
  const original = globalThis.fetch;
  const avisoOriginal = console.warn;
  const avisos: string[] = [];
  let enVuelo = 0;
  let maximo = 0;
  console.warn = (linea: unknown) => {
    avisos.push(String(linea));
  };
  globalThis.fetch = (async (url: string | URL | Request) => {
    const propia = especial(String(url));
    if (propia) return propia;
    enVuelo++;
    maximo = Math.max(maximo, enVuelo);
    await new Promise((r) => setTimeout(r, LENTA_MS));
    enVuelo--;
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    await fn(avisos);
    return maximo;
  } finally {
    globalThis.fetch = original;
    console.warn = avisoOriginal;
  }
}

/**
 * Corre `fn` y espera a las consultas de fondo aunque `fn` falle. Sin esa
 * espera, una prueba en rojo deja consultas vivas con los cupos tomados, y
 * la prueba siguiente parte sin cupo y falla por contagio.
 */
async function yEsperar(deFondo: Promise<unknown>, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } finally {
    await deFondo.catch(() => {});
  }
}

const redireccionA = (destino: string): Respuesta => (url) =>
  url.includes("/redirige") ? new Response(null, { status: 302, headers: { location: destino } }) : undefined;

// Con un plazo corto de cupo. El limitador es uno solo para todo el archivo,
// así que una prueba que pierde cupos deja sin cupo a las que siguen. Con este
// plazo esas pruebas salen rojas a los 15 segundos, en vez de esperar los 120
// de fábrica. Con 3 segundos la prueba de los 2 ritmos dio rojo con la máquina
// cargada, porque sus 20 consultas tardaron 3,3 segundos.
const lanzarLentas = (cuantas: number, env: Record<string, string>) =>
  Promise.all(
    Array.from({ length: cuantas }, (_, i) =>
      fetchCmf(`https://www.cmfchile.cl/institucional/lenta${i}.php`, {}, { CMF_ESPERA_CUPO_MS: "15000", ...env }),
    ),
  );

for (const [nombre, destino] of [
  ["un host fuera de la lista", "https://otro-sitio.example.com/pagina"],
  ["http sin cifrar", "http://www.cmfchile.cl/pagina"],
] as const) {
  test(`una redirección a ${nombre} se rechaza y no afloja el tope de ${TOPE} en vuelo`, async () => {
    // Sin espera entre turnos, para que el cupo se revise y se anote en el
    // mismo paso y lo único que pueda aflojar el tope sea la doble liberación.
    const env = { CMF_RATE_LIMIT_MS: "0" };
    const maximo = await conRedLenta(redireccionA(destino), async () => {
      await assert.rejects(
        fetchCmf("https://www.cmfchile.cl/redirige", {}, env),
        /Host no permitido|Solo se permiten URLs HTTPS/,
      );
      await lanzarLentas(10, env);
    });
    assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
  });
}

// El segundo camino al mismo daño, que apareció al escribir esta prueba. El
// cupo se revisaba antes de esperar el turno y se anotaba después, así que
// las consultas lanzadas juntas pasaban todas la revisión con el contador en 0.
test(`10 consultas lanzadas juntas, con espera entre turnos, nunca pasan de ${TOPE} en vuelo`, async () => {
  const env = { CMF_RATE_LIMIT_MS: "5" };
  const maximo = await conRedLenta(
    () => undefined,
    () => lanzarLentas(10, env).then(() => {}),
  );
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

// El tercer camino, de la revisión adversarial del 9 de octubre de 2026. Había
// un limitador por ritmo, y cada cambio de CMF_RATE_LIMIT_MS estrenaba uno con
// el contador en 0. Con 2 ritmos conviviendo quedaban 8 consultas en vuelo.
test(`2 ritmos distintos conviviendo comparten el tope de ${TOPE} en vuelo`, async () => {
  const maximo = await conRedLenta(
    () => undefined,
    () => Promise.all([lanzarLentas(10, { CMF_RATE_LIMIT_MS: "0" }), lanzarLentas(10, { CMF_RATE_LIMIT_MS: "1" })]).then(() => {}),
  );
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

// La espera de cupo tenía una cola sin plazo. Un cupo perdido por un defecto
// dejaba a toda consulta posterior esperando para siempre y en silencio.
test("una consulta que no alcanza cupo dentro del plazo falla con un error que lo dice, y no toca el contador", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conRedLenta(
    () => undefined,
    async (avisos) => {
      const ocupadas = lanzarLentas(TOPE, env);
      // A OTRO host, para que lo único que la frene sea el cupo. Las 4 de
      // arriba tardan 120 ms, así que con 30 ms de plazo no lo alcanza.
      await yEsperar(ocupadas, async () => {
        await assert.rejects(
          fetchCmf("https://api.sbif.cl/sin-cupo", {}, { ...env, CMF_ESPERA_CUPO_MS: "30" }),
          /4 consultas a la CMF ocupadas.*30 ms/,
        );
        const aviso = avisos.find((a) => a.includes("cmf_cupo"));
        assert.ok(aviso, `sin aviso en el log. ${avisos.join(" | ")}`);
        assert.deepEqual(JSON.parse(aviso), { cmf_cupo: { en_vuelo: TOPE, en_cola: 0, espera_ms: 30, host: "api.sbif.cl" } });
      });
    },
  );
  // El máximo se mide en una red aparte, después. En la misma red ya llegó a
  // 4 con las ocupadas, y un cupo que quedara tomado no lo bajaría. Así se
  // ven las 2 direcciones. 5 es un cupo devuelto de más, y 3 es uno perdido.
  const maximo = await conRedLenta(
    () => undefined,
    () => lanzarLentas(10, env).then(() => {}),
  );
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

// La cola de cupo era un sondeo cada 100 ms, sin orden. Una cadena que pide
// una consulta tras otra devuelve su cupo y lo vuelve a tomar en el mismo
// paso, así que quien sondeaba nunca lo veía libre. Medido por la revisión
// adversarial del 9 de octubre de 2026. en 3 segundos se liberaron cupos 12
// veces y la consulta que esperaba no tomó ninguno.
test("la cola de cupo respeta el orden de llegada, aunque otras consultas encadenen las suyas", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conRedLenta(
    () => undefined,
    async () => {
      const cadenas = Array.from({ length: TOPE }, async (_, c) => {
        for (let i = 0; i < 6; i++) {
          await fetchCmf(`https://www.cmfchile.cl/cadena${c}-${i}.php`, {}, { ...env, CMF_ESPERA_CUPO_MS: "15000" });
        }
      });
      await new Promise((r) => setTimeout(r, 20));
      // Llegó después de las 4 primeras y antes que todas las demás. En orden,
      // toma el primer cupo que se libera, a los 120 ms.
      await yEsperar(Promise.all(cadenas), async () => {
        const res = await fetchCmf("https://api.sbif.cl/en-orden", {}, { ...env, CMF_ESPERA_CUPO_MS: "400" });
        assert.equal(res.status, 200);
      });
    },
  );
});

/** Una respuesta que ocupa su cupo `ms`, porque el cliente lee el cuerpo con el cupo tomado. */
const pegada = (ms: number) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        setTimeout(() => c.close(), ms);
      },
    }),
  );

const ocuparCupos = (ms: number, env: Record<string, string>) =>
  Promise.all(
    Array.from({ length: TOPE }, (_, i) =>
      fetchCmf(`https://tasas.cmfchile.cl/pegada${i}?ms=${ms}`, {}, { CMF_ESPERA_CUPO_MS: "15000", ...env }).then((r) => r.text()),
    ),
  );

const redConPegadas =
  (otra: Respuesta): Respuesta =>
  (url) => {
    const m = /\/pegada\d\?ms=(\d+)/.exec(url);
    return m ? pegada(Number(m[1])) : otra(url);
  };

// Si un reintento no alcanza cupo, lo que ya se sabía de la CMF no se pierde.
test("tras un 500, un reintento sin cupo conserva el 500 en el error", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conRedLenta(
    redConPegadas((url) => (url.includes("/cae") ? new Response("caída", { status: 500 }) : undefined)),
    async () => {
      // El primer intento responde 500 al instante y el reintento parte 500 ms
      // después. Para entonces los 4 cupos están ocupados por 900 ms.
      const caida = fetchCmf("https://www.cmfchile.cl/cae", {}, { ...env, CMF_ESPERA_CUPO_MS: "100" });
      await new Promise((r) => setTimeout(r, 50));
      const ocupadas = ocuparCupos(900, env);
      await yEsperar(ocupadas, () => assert.rejects(caida, /no alcanzó cupo en 100 ms.*HTTP 500/));
    },
  );
});

test("tras un bloqueo directo, un reintento por el proxy sin cupo entrega el bloqueo original", async () => {
  const env = {
    CMF_RATE_LIMIT_MS: "0",
    CMF_REINTENTO_403_MS: "0",
    CMF_ESPERA_CUPO_MS: "100",
    CMF_PROXY_URL: "https://salida-sin-cupo.example.cl/",
    CMF_PROXY_TOKEN: "token-de-prueba",
  };
  await conRedLenta(
    redConPegadas((url) =>
      new URL(url).hostname.endsWith(".example.cl")
        ? // El proxy pide esperar 1500 ms. Durante esa espera se ocupan los cupos.
          new Response("cola llena", { status: 429, headers: { "x-cmf-salida-cola": "1" } })
        : url.includes("/bloqueada")
          ? new Response("<html><title>403 Forbidden</title></html>", { status: 403 })
          : undefined,
    ),
    async () => {
      const bloqueada = fetchCmf("https://www.cmfchile.cl/bloqueada", {}, env);
      await new Promise((r) => setTimeout(r, 300));
      const ocupadas = ocuparCupos(1800, { CMF_RATE_LIMIT_MS: "0" });
      await yEsperar(ocupadas, async () => assert.equal((await bloqueada).status, 403));
    },
  );
});

test("las consultas que esperan cupo salen en el orden en que llegaron", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_ESPERA_CUPO_MS: "15000" };
  const salidas: string[] = [];
  const anotar: Respuesta = (url) => {
    const m = /\/orden-(\w)/.exec(url);
    if (m) salidas.push(m[1]);
    return undefined;
  };
  await conRedLenta(anotar, async () => {
    const ocupadas = lanzarLentas(TOPE, env);
    // A hosts distintos, para que el turno por host no las ordene.
    const enCola = ["api.sbif.cl", "tasas.cmfchile.cl", "datosbanco.cmfchile.cl", "acreencias.cmfchile.cl"].map((host, i) =>
      fetchCmf(`https://${host}/orden-${"abcd"[i]}`, {}, env),
    );
    await Promise.all([ocupadas, ...enCola]);
  });
  assert.deepEqual(salidas, ["a", "b", "c", "d"]);
});

test("una redirección no permitida que llega por la salida chilena es un error de destino, no un proxy caído", async () => {
  const env = {
    CMF_RATE_LIMIT_MS: "0",
    CMF_REINTENTO_403_MS: "0",
    CMF_PROXY_URL: "https://salida-tope.example.cl/",
    CMF_PROXY_TOKEN: "token-de-prueba",
  };
  const red: Respuesta = (url) =>
    new URL(url).hostname.endsWith(".example.cl")
      ? new Response(null, { status: 302, headers: { "x-cmf-salida": "1", location: "https://otro-sitio.example.com/" } })
      : url.includes("/bloqueada")
        ? new Response("<html><title>403 Forbidden</title></html>", { status: 403 })
        : undefined;
  const maximo = await conRedLenta(red, async (avisos) => {
    await assert.rejects(fetchCmf("https://www.cmfchile.cl/bloqueada", {}, env), /Host no permitido/);
    assert.ok(!avisos.some((a) => a.includes("proxy_fallo")), `no debe anotar un proxy caído. ${avisos.join(" | ")}`);
    await lanzarLentas(10, { CMF_RATE_LIMIT_MS: "0" });
  });
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

// La otra mitad de «exactamente una vez». Si la consulta lanza, el cupo se
// devuelve en el catch. Sin esa devolución el máximo queda bajo el tope.
test("una consulta que falla en la red devuelve su cupo", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  const red: Respuesta = (url) => {
    if (url.includes("/sin-red")) throw new TypeError("fetch failed");
    return undefined;
  };
  const maximo = await conRedLenta(red, async () => {
    for (const i of [1, 2]) {
      await assert.rejects(fetchCmf(`https://www.cmfchile.cl/sin-red${i}`, {}, env), /fetch failed/);
    }
    await lanzarLentas(10, env);
  });
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

test("un proxy que falla en la red devuelve su cupo", async () => {
  const env = {
    CMF_RATE_LIMIT_MS: "0",
    CMF_REINTENTO_403_MS: "0",
    CMF_PROXY_URL: "https://salida-sin-red.example.cl/",
    CMF_PROXY_TOKEN: "token-de-prueba",
  };
  const red: Respuesta = (url) => {
    if (new URL(url).hostname.endsWith(".example.cl")) throw new TypeError("fetch failed");
    return url.includes("/bloqueada") ? new Response("<html><title>403 Forbidden</title></html>", { status: 403 }) : undefined;
  };
  const maximo = await conRedLenta(red, async () => {
    for (const i of [1, 2]) {
      const res = await fetchCmf(`https://www.cmfchile.cl/bloqueada${i}`, {}, env);
      assert.equal(res.status, 403);
    }
    await lanzarLentas(10, { CMF_RATE_LIMIT_MS: "0" });
  });
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});
