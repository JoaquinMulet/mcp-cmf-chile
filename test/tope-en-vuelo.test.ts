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
import { mock, test } from "node:test";
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
function pegada(ms: number): Response {
  let fin: ReturnType<typeof setTimeout>;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        fin = setTimeout(() => c.close(), ms);
      },
      cancel() {
        clearTimeout(fin);
      },
    }),
  );
}

// Con un plazo de red largo. Estas respuestas no mandan ningún tramo hasta
// que terminan, y el plazo de silencio de fábrica las cortaría a los 12
// segundos.
const ocuparCupos = (ms: number, env: Record<string, string>) =>
  Promise.all(
    Array.from({ length: TOPE }, (_, i) =>
      fetchCmf(
        `https://tasas.cmfchile.cl/pegada${i}?ms=${ms}`,
        {},
        { CMF_ESPERA_CUPO_MS: "15000", CMF_UPSTREAM_TIMEOUT_MS: "60000", ...env },
      ).then((r) => r.text()),
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

/** Con los 4 cupos ocupados por consultas vivas, una quinta no entra y nadie fue dado por muerto. */
async function exigirCuposVivos(avisos: string[], env: Record<string, string>): Promise<void> {
  await assert.rejects(
    fetchCmf("https://api.sbif.cl/quinta", {}, { ...env, CMF_ESPERA_CUPO_MS: "300" }),
    /no alcanz. cupo en 300 ms/,
  );
  assert.ok(!avisos.some((a) => a.includes("cmf_cupo_recuperado")), `avisos. ${avisos.join(" | ")}`);
}

// Una consulta viva y lenta conserva su cupo. Quien tiene un cupo renueva su
// señal de vida cada segundo, y sin esa renovación el limitador la daría por
// muerta a los 5 segundos y dejaría pasar una quinta consulta.
test("una consulta viva que tarda más que la gracia conserva su cupo", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conRedLenta(
    redConPegadas(() => undefined),
    async (avisos) => {
      const ocupadas = ocuparCupos(9500, env);
      await yEsperar(ocupadas, async () => {
        await new Promise((r) => setTimeout(r, 6500));
        await exigirCuposVivos(avisos, env);
        // 6,5 segundos sin que llegue ninguna consulta no son un hilo detenido.
        // Una detención la delata un temporizador que corre atrasado, no el silencio.
        assert.ok(!avisos.some((a) => a.includes("cmf_hilo_detenido")), `aviso falso de detención. ${avisos.join(" | ")}`);
      });
    },
  );
});

// Un hilo detenido no es una consulta muerta. Mientras el hilo está detenido
// nadie puede renovar su señal de vida, ni los vivos. Medido por la cuarta
// revisión adversarial el 10 de octubre de 2026. una detención de 9,5
// segundos daba por muertas a las 4 consultas en vuelo y dejaba entrar a
// otras 4, y cada detención siguiente sumaba 4 más, sin techo. Convertir un
// PDF de 200 a 400 páginas detiene el hilo ese tiempo.
test("un hilo detenido 11 segundos no da por muerta a ninguna consulta viva", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conRedLenta(
    redConPegadas(() => undefined),
    async (avisos) => {
      const ocupadas = ocuparCupos(14500, env);
      await yEsperar(ocupadas, async () => {
        await new Promise((r) => setTimeout(r, 100));
        const hasta = Date.now() + 11000;
        while (Date.now() < hasta) {
          // El hilo no suelta el control. Ningún temporizador corre.
        }
        await exigirCuposVivos(avisos, env);
        assert.ok(avisos.some((a) => a.includes("cmf_hilo_detenido")), `sin aviso de la detención. ${avisos.join(" | ")}`);
      });
    },
  );
});

test("quien espera en la cola más de 2 segundos conserva su puesto", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_ESPERA_CUPO_MS: "15000" };
  const salidas: string[] = [];
  const anotar: Respuesta = (url) => {
    const m = /\/paciente-(\w)/.exec(url);
    if (m) salidas.push(m[1]);
    return undefined;
  };
  await conRedLenta(redConPegadas(anotar), async () => {
    const ocupadas = ocuparCupos(3000, env);
    await yEsperar(ocupadas, async () => {
      const a = fetchCmf("https://api.sbif.cl/paciente-a", {}, env);
      await new Promise((r) => setTimeout(r, 30));
      const b = fetchCmf("https://datosbanco.cmfchile.cl/paciente-b", {}, env);
      await Promise.all([a, b]);
    });
  });
  assert.deepEqual(salidas, ["a", "b"]);
});

// Cada consulta en cola mira la cola cada 50 ms, así que una cola enorme
// gasta el hilo en sondear. Medido por la misma revisión. con 10000 en cola
// el hilo quedaba ocupado más de 5 segundos seguidos y nadie entraba, aun con
// cupos libres. El tope es 1000. con 4 cupos y el ritmo de fábrica hacia los
// 13 hosts, en 120 segundos no alcanzan a pasar más de unas 1400.
//
// La que no cabe no falla al instante. Espera 2 segundos y medio, porque la
// cola puede estar llena de consultas muertas, y eso recién se sabe cuando
// pasa la gracia de sus puestos.
test("la cola de cupo tiene un tope de 1000, y la que no cabe falla tras esperar la gracia de la cola", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_ESPERA_CUPO_MS: "15000" };
  await conRedLenta(redConPegadas(() => undefined), async (avisos) => {
    const ocupadas = ocuparCupos(6000, env);
    // Las 1000 de la cola se rinden solas a los 5 segundos, para no tener que atenderlas.
    const enCola = Array.from({ length: 1000 }, (_, i) =>
      fetchCmf(`https://www.cmfchile.cl/en-cola${i}`, {}, { ...env, CMF_ESPERA_CUPO_MS: "5000" }),
    );
    await yEsperar(Promise.allSettled([ocupadas, ...enCola]), async () => {
      const inicio = Date.now();
      await assert.rejects(fetchCmf("https://api.sbif.cl/no-cabe", {}, env), /1000 consultas esperando/);
      const tardo = Date.now() - inicio;
      assert.ok(tardo >= 2400 && tardo < 4500, `tardó ${tardo} ms en rechazarla`);
      assert.ok(avisos.some((a) => a.includes("cola_llena")), `sin aviso. ${avisos.join(" | ")}`);
    });
  });
});

// Las 2 pruebas que siguen van al final a propósito. Dejan consultas que no
// terminan nunca, y eso es lo que simulan.
//
// En Cloudflare Workers el limitador es de módulo y lo comparten todas las
// peticiones de la instancia. Cuando una petición termina, sus promesas y sus
// temporizadores pendientes se abandonan. Medido en workerd por la revisión
// adversarial del 9 de octubre de 2026. una consulta abandonada con un cupo
// tomado, o con un puesto en la cola, lo perdía para siempre, y con 4 así la
// instancia quedaba sin cupos hasta que Cloudflare la reciclara.
//
// Acá «morir» es eso mismo. los temporizadores que la consulta creó dejan de
// correr (se crean con el reloj simulado de node:test y se descartan), y su
// consulta a la red no responde nunca.
const NUNCA = new Promise<Response>(() => {}) as unknown as Response;
const redConMuertas: Respuesta = (url) => (url.includes("/muerta") ? NUNCA : undefined);

/** Lanza consultas cuyos temporizadores no van a correr nunca. */
function lanzarMuertas(apis: ("setInterval" | "setTimeout")[], urls: string[], env: Record<string, string>): void {
  mock.timers.enable({ apis });
  try {
    for (const url of urls) void fetchCmf(url, {}, env).catch(() => {});
  } finally {
    mock.timers.reset();
  }
}

test("un cupo cuyo dueño murió vuelve solo, y queda un aviso en el log", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conRedLenta(redConMuertas, async (avisos) => {
    lanzarMuertas(
      ["setInterval"],
      Array.from({ length: TOPE }, (_, i) => `https://www.cmfchile.cl/muerta${i}`),
      env,
    );
    // Los 4 cupos están tomados por consultas muertas. Una consulta viva
    // tiene que entrar cuando su señal de vida se da por perdida.
    const res = await fetchCmf("https://api.sbif.cl/viva", {}, { ...env, CMF_ESPERA_CUPO_MS: "20000" });
    assert.equal(res.status, 200);
    // Los 4 cupos nacieron con 1 ms de diferencia, así que la viva puede
    // entrar cuando se barrieron 2 y los otros 2 caen un instante después.
    // Contar apenas entra daba rojo al azar. Se le da 3 segundos al barrido,
    // que corre cada vez que llega una consulta.
    const cuantos = () => avisos.filter((a) => a.includes("cmf_cupo_recuperado")).length;
    for (const limite = Date.now() + 3000; cuantos() < TOPE && Date.now() < limite; ) {
      await new Promise((r) => setTimeout(r, 100));
      await fetchCmf("https://api.sbif.cl/otra-viva", {}, { ...env, CMF_ESPERA_CUPO_MS: "20000" });
    }
    assert.equal(cuantos(), TOPE, `avisos. ${avisos.join(" | ")}`);
  });
  // Se recuperaron los 4, ni uno más ni uno menos.
  const maximo = await conRedLenta(
    () => undefined,
    () => lanzarLentas(10, env).then(() => {}),
  );
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

test("quien murió esperando en la cola no frena a los que vienen detrás, ni se lleva un cupo", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_ESPERA_CUPO_MS: "20000" };
  const salidas: string[] = [];
  const anotar: Respuesta = (url) => {
    if (url.includes("/muerta-en-cola")) salidas.push("la muerta salió a la red");
    return undefined;
  };
  await conRedLenta(anotar, async () => {
    const ocupadas = lanzarLentas(TOPE, env);
    // Entra a la cola primero y muere ahí. Su sondeo no corre nunca más.
    lanzarMuertas(["setTimeout"], ["https://www.cmfchile.cl/muerta-en-cola"], env);
    await yEsperar(ocupadas, async () => {
      const res = await fetchCmf("https://api.sbif.cl/detras-de-la-muerta", {}, { ...env, CMF_ESPERA_CUPO_MS: "8000" });
      assert.equal(res.status, 200);
    });
    assert.deepEqual(salidas, []);
  });
  const maximo = await conRedLenta(
    () => undefined,
    () => lanzarLentas(10, env).then(() => {}),
  );
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

// Lo encontró la quinta revisión adversarial el 10 de octubre de 2026, con el
// código ya desplegado. El limitador tomaba por hilo detenido todo silencio
// largo, y tras un silencio largo no barría a nadie durante 2 segundos. Pero
// un silencio largo también es lo que hay cuando no quedó nadie vivo. Con 4
// cupos y 200 puestos de consultas muertas, cada consulta nueva veía el
// silencio, no barría, encontraba la cola llena y fallaba al instante. Como
// no se quedaba a esperar, la siguiente repetía lo mismo, sin fin. Bastaban 4
// programas de /codigo que respondieran con sus llamadas pendientes.
test("una cola llena de consultas muertas no deja a la instancia rechazando todo", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conRedLenta(redConMuertas, async () => {
    lanzarMuertas(
      ["setInterval", "setTimeout"],
      Array.from({ length: TOPE + 1000 }, (_, i) => `https://www.cmfchile.cl/muerta${i}`),
      env,
    );
    // Llegan de a una y espaciadas, que es cuando el silencio se confundía.
    for (const i of [0, 1, 2]) {
      await new Promise((r) => setTimeout(r, 1700));
      const res = await fetchCmf(`https://api.sbif.cl/espaciada${i}`, {}, { ...env, CMF_ESPERA_CUPO_MS: "9000" });
      assert.equal(res.status, 200);
    }
  });
  const maximo = await conRedLenta(
    () => undefined,
    () => lanzarLentas(10, env).then(() => {}),
  );
  assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
});

// La misma confusión, sin cola. Con 3 cupos muertos y consultas que llegan de
// a una, cada una entraba directo por el cupo libre, veía el silencio y no
// barría. Los 3 muertos no volvían nunca y la instancia quedaba con 1 cupo.
test("3 cupos muertos vuelven aunque las consultas lleguen de a una y entren directo", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conRedLenta(redConMuertas, async (avisos) => {
    lanzarMuertas(
      ["setInterval"],
      [0, 1, 2].map((i) => `https://www.cmfchile.cl/muerta-suelta${i}`),
      env,
    );
    await new Promise((r) => setTimeout(r, 5300));
    for (const i of [0, 1]) {
      const res = await fetchCmf(`https://api.sbif.cl/de-a-una${i}`, {}, env);
      assert.equal(res.status, 200);
      await new Promise((r) => setTimeout(r, 1700));
    }
    assert.equal(avisos.filter((a) => a.includes("cmf_cupo_recuperado")).length, 3, `avisos. ${avisos.join(" | ")}`);
  });
});

// Una detención que cae justo mientras alguien espera en la cola. Su sondeo
// corre apenas termina la detención, antes que las señales de vida de los
// dueños de los cupos, que vencían un poco después. Si ese sondeo barriera,
// daría por muertos a los 4 vivos.
test("un sondeo que corre atrasado por una detención no barre a nadie", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conRedLenta(
    redConPegadas(() => undefined),
    async (avisos) => {
      const ocupadas = ocuparCupos(9500, env);
      await yEsperar(ocupadas, async () => {
        // Recién pasada una señal de vida, para que la próxima venza después del sondeo.
        await new Promise((r) => setTimeout(r, 1100));
        const enCola = fetchCmf("https://api.sbif.cl/esperando", {}, { ...env, CMF_ESPERA_CUPO_MS: "15000" });
        await new Promise((r) => setTimeout(r, 20));
        const hasta = Date.now() + 6500;
        while (Date.now() < hasta) {
          // El hilo no suelta el control.
        }
        await new Promise((r) => setTimeout(r, 400));
        assert.ok(!avisos.some((a) => a.includes("cmf_cupo_recuperado")), `dio por muerto a un vivo. ${avisos.join(" | ")}`);
        assert.ok(avisos.some((a) => a.includes("cmf_hilo_detenido")), `sin aviso de la detención. ${avisos.join(" | ")}`);
        await enCola;
      });
    },
  );
});

// Lo mismo para el barrido que deja quien entra directo, sin pasar por la cola.
test("el barrido de quien entra directo tampoco barre si corre atrasado por una detención", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_ESPERA_CUPO_MS: "15000", CMF_UPSTREAM_TIMEOUT_MS: "60000" };
  await conRedLenta(
    redConPegadas(() => undefined),
    async (avisos) => {
      // 3 cupos ocupados por consultas vivas, y 1 libre.
      const ocupadas = Promise.all(
        [0, 1, 2].map((i) => fetchCmf(`https://tasas.cmfchile.cl/pegada${i}?ms=9500`, {}, env).then((r) => r.text())),
      );
      await yEsperar(ocupadas, async () => {
        await new Promise((r) => setTimeout(r, 1100));
        const directa = fetchCmf("https://tasas.cmfchile.cl/pegada3?ms=8500", {}, env).then((r) => r.text());
        const hasta = Date.now() + 6500;
        while (Date.now() < hasta) {
          // El hilo no suelta el control.
        }
        await new Promise((r) => setTimeout(r, 400));
        assert.ok(!avisos.some((a) => a.includes("cmf_cupo_recuperado")), `dio por muerto a un vivo. ${avisos.join(" | ")}`);
        await directa;
      });
    },
  );
});

// Quien llega con la cola llena espera afuera hasta que pase la gracia de los
// puestos. Si en ese rato el hilo se detiene, su sondeo corre atrasado, y un
// sondeo atrasado no barrió. Decidir ahí es decidir sin saber si la cola está
// llena de vivos o de muertos.
test("tras una detención, quien espera fuera de una cola llena de muertas no se rinde con su sondeo atrasado", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  await conRedLenta(redConMuertas, async () => {
    lanzarMuertas(
      ["setInterval", "setTimeout"],
      Array.from({ length: TOPE + 1000 }, (_, i) => `https://www.cmfchile.cl/muerta${i}`),
      env,
    );
    const afuera = fetchCmf("https://api.sbif.cl/afuera", {}, { ...env, CMF_ESPERA_CUPO_MS: "12000" });
    // Más larga que la espera de afuera, que es de 2 segundos y medio.
    const hasta = Date.now() + 3200;
    while (Date.now() < hasta) {
      // El hilo no suelta el control.
    }
    assert.equal((await afuera).status, 200);
  });
});

// Lo encontró la sexta revisión adversarial el 10 de octubre de 2026. El
// diseño anterior dejaba barrer a cualquier temporizador que corriera a
// tiempo, con el argumento de que entonces todos los anteriores ya habían
// corrido. Es falso. Una consulta que nace justo al terminar una detención
// crea su temporizador de 50 ms ahí, y ese temporizador corre a tiempo ANTES
// que las señales de vida vencidas de los dueños de los cupos. En Node quedaban
// 7 en vuelo con tope de 4, y en workerd 8, sin ninguna consulta muerta.
test("una consulta que nace al terminar una detención no da por muertos a los vivos", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_ESPERA_CUPO_MS: "20000" };
  await conRedLenta(
    redConPegadas(() => undefined),
    async (avisos) => {
      const ocupadas = ocuparCupos(11000, env);
      const enCola = [0, 1].map((i) => fetchCmf(`https://api.sbif.cl/ya-esperaba${i}`, {}, env));
      await yEsperar(Promise.allSettled([ocupadas, ...enCola]), async () => {
        await new Promise((r) => setTimeout(r, 1100));
        const ocupar = (ms: number) => {
          for (const hasta = Date.now() + ms; Date.now() < hasta; ) {
            // El hilo no suelta el control.
          }
        };
        ocupar(6000);
        // Nace en el mismo turno en que termina la detención, y el hilo sigue ocupado un poco más.
        const recienNacida = fetchCmf("https://datosbanco.cmfchile.cl/recien-nacida", {}, env);
        ocupar(120);
        await new Promise((r) => setTimeout(r, 700));
        assert.ok(!avisos.some((a) => a.includes("cmf_cupo_recuperado")), `dio por muerto a un vivo. ${avisos.join(" | ")}`);
        await recienNacida;
      });
    },
  );
});
