/**
 * El plazo de una consulta cubre también el cuerpo de la respuesta.
 *
 * Lo demostró la revisión adversarial del 9 de octubre de 2026. El plazo de
 * fetchConTimeout se apagaba al llegar las cabeceras, y resolverChallenge lee
 * el cuerpo entero con el cupo del limitador tomado. Con 4 respuestas cuyo
 * cuerpo nunca terminaba, toda consulta posterior de la instancia quedaba
 * esperando cupo sin plazo.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCmf } from "../src/client/cmf-client.js";
import { conCookiesDelJar, crearCookieJar } from "../src/client/anti-bot.js";

const TOPE = 4;
const INTENTOS = 3;
/**
 * Con un plazo corto de cupo. El limitador es uno solo para todo el archivo,
 * así que una prueba que pierde un cupo deja sin cupo a las que siguen. Con el
 * plazo de fábrica cada una de esas esperaba 120 segundos antes de dar rojo,
 * y el archivo entero pasaba de media hora. Así cada una da rojo a los 5
 * segundos. Ninguna prueba de este archivo espera cupo más de 2.
 */
const ESPERA_CORTA = { CMF_ESPERA_CUPO_MS: "5000" };

type Red = (url: string, init: RequestInit) => Response;
/** Abre un cuerpo que no termina. Puede traer un primer tramo, y avisa si el cliente lo cancela. */
type Abrir = (opciones?: { primerTramo?: string; alCancelar?: () => void }) => ReadableStream<Uint8Array>;

/**
 * Simula la red y entrega los cuerpos abiertos para cerrarlos al final. Sin
 * ese cierre, una prueba en rojo dejaría el proceso vivo y la suite colgada
 * en vez de roja.
 */
async function conRed(red: (abrir: Abrir) => Red, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const abiertos: ReadableStreamDefaultController<Uint8Array>[] = [];
  const abrir: Abrir = ({ primerTramo, alCancelar } = {}) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        abiertos.push(c);
        if (primerTramo) c.enqueue(new TextEncoder().encode(primerTramo));
      },
      cancel: alCancelar,
    });
  const responder = red(abrir);
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => responder(String(url), init ?? {})) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
    for (const c of abiertos) {
      try {
        c.close();
      } catch {
        // Ya lo cerró o lo canceló el cliente, que es lo que se espera.
      }
    }
  }
}

const tras = <T>(ms: number, valor: T) => new Promise<T>((r) => setTimeout(() => r(valor), ms));

/** La página del desafío anti-bot F5, con la forma que reconoce resolverChallenge. */
const DESAFIO = '<script>var fwb_dat="QUJD";location="?cookiesession8341=0123456789abcdef0123456789abcdef"</script>';

/**
 * Una red que responde el desafío F5. `post` es la respuesta al envío del
 * desafío, que el cliente no lee, y `final` es la de la consulta repetida,
 * que el cliente entrega sin leer. Son las 2 respuestas que no pasan por la
 * lectura completa de resolverChallenge.
 */
const redConDesafio =
  (post: () => Response, final: () => Response, cabeceras: Record<string, string> = {}): Red =>
  (_url, init) => {
    if (init.method === "POST") return post();
    const resuelto = new Headers(init.headers).get("cookie")?.includes("cookiesession1");
    return resuelto ? final() : new Response(DESAFIO, { headers: cabeceras });
  };

const conCookie = () => new Response("ok", { headers: { "set-cookie": "cookiesession1=AAAA; Path=/" } });

test(`${TOPE} cuerpos que nunca terminan devuelven su cupo al vencer el plazo, con un error que lo dice`, async () => {
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: "200" };
  let enVuelo = 0;
  let maximo = 0;
  let cancelados = 0;
  const senales: AbortSignal[] = [];
  await conRed(
    (abrir) => (url, init) => {
      if (url.includes("/colgada")) {
        if (init.signal) senales.push(init.signal);
        return new Response(abrir({ alCancelar: () => void cancelados++ }), { status: 200 });
      }
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(c) {
            await tras(120, null);
            enVuelo--;
            c.enqueue(new TextEncoder().encode("ok"));
            c.close();
          },
        }),
      );
    },
    async () => {
      const colgadas = Array.from({ length: TOPE }, (_, i) =>
        fetchCmf(`https://www.cmfchile.cl/colgada${i}`, {}, env).then(
          (r) => `devolvió ${r.status}`,
          (e) => `lanzó. ${(e as Error).message}`,
        ),
      );
      await tras(50, null);
      // A OTRO host, para que lo único que la pueda frenar sea el cupo.
      const sana = fetchCmf("https://api.sbif.cl/sana", {}, env).then((r) => r.text());
      assert.equal(await Promise.race([sana, tras(3000, "sigue esperando cupo")]), "ok");
      for (const fin of await Promise.race([Promise.all(colgadas), tras(5000, ["siguen colgadas"])])) {
        assert.match(fin, /^lanzó\. .*cuerpo.*200 ms.*www\.cmfchile\.cl\/colgada\d/);
      }
      // Un cuerpo colgado se reintenta igual que una consulta sin respuesta. 3 intentos, ni más ni menos.
      assert.equal(senales.length, TOPE * INTENTOS, "consultas a las páginas colgadas");
      // Cada intento vencido corta su consulta y suelta su cuerpo. Sin eso la conexión queda abierta.
      assert.ok(senales.every((s) => s.aborted), "cada consulta vencida queda abortada");
      assert.equal(cancelados, TOPE * INTENTOS, "cuerpos cancelados");
      // El cupo se devuelve exactamente una vez. De más, el máximo pasa del tope. De menos, no llega.
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => fetchCmf(`https://www.cmfchile.cl/lenta${i}`, {}, env).then((r) => r.text())),
      );
      assert.equal(maximo, TOPE, `máximo en vuelo. ${maximo}`);
    },
  );
});

test("un cuerpo que tarda más que el plazo pero sigue llegando se entrega completo", async () => {
  // El plazo es de silencio, no del total. Un documento grande por un enlace
  // lento tarda más que el plazo y tiene que llegar (lección 36).
  //
  // Con plazo de 1500 ms y un tramo cada 300. Con 400 y 60 esta prueba dio
  // rojo con la máquina al 100 por ciento, porque la descarga entera pasó de
  // los 4 segundos del plazo total (10 de octubre de 2026). Ahora el silencio
  // tolera 5 veces la separación, y el total es de 15 segundos.
  const PLAZO_MS = 1500;
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: String(PLAZO_MS) };
  const TRAMOS = 6;
  await conRed(
    () => () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(c) {
            for (let i = 0; i < TRAMOS; i++) {
              await tras(300, null);
              c.enqueue(new TextEncoder().encode(`tramo${i};`));
            }
            c.close();
          },
        }),
      ),
    async () => {
      const inicio = Date.now();
      const res = await fetchCmf("https://www.cmfchile.cl/documento-grande", {}, env);
      const texto = await res.text();
      assert.equal(texto.split(";").length - 1, TRAMOS, texto);
      assert.ok(Date.now() - inicio > PLAZO_MS, "la descarga tiene que durar más que el plazo para probar algo");
    },
  );
});

/** Un cuerpo que manda un tramo cada 40 ms mientras `sigue()` diga que sí. */
const goteo = (sigue: () => boolean, alCancelar?: () => void) =>
  new ReadableStream<Uint8Array>({
    async pull(c) {
      await tras(40, null);
      if (sigue()) c.enqueue(new TextEncoder().encode("gota;"));
      else c.close();
    },
    cancel: alCancelar,
  });

test("un TimeoutError ajeno que viene del proxy sigue contando como proxy caído", async () => {
  // El plazo total del cuerpo sube tal cual, y se reconoce por una marca
  // propia. Si se reconociera por su nombre, cualquier TimeoutError que
  // lanzara la red hacia el proxy se saltaría el manejo del proxy caído.
  const env = {
    ...ESPERA_CORTA,
    CMF_RATE_LIMIT_MS: "0",
    CMF_REINTENTO_403_MS: "0",
    CMF_PROXY_URL: "https://salida-ajeno.example.cl/",
    CMF_PROXY_TOKEN: "token-de-prueba",
  };
  const avisos: string[] = [];
  const avisoOriginal = console.warn;
  console.warn = (linea: unknown) => void avisos.push(String(linea));
  try {
    await conRed(
      () => (url) => {
        if (new URL(url).hostname.endsWith(".example.cl")) throw new DOMException("The operation timed out", "TimeoutError");
        return new Response("<html><title>403 Forbidden</title></html>", { status: 403 });
      },
      async () => {
        const res = await fetchCmf("https://www.cmfchile.cl/ajeno.php", {}, env);
        assert.equal(res.status, 403);
        assert.ok(avisos.some((a) => a.includes("proxy_fallo")), `no anotó el proxy caído. ${avisos.join(" | ")}`);
      },
    );
  } finally {
    console.warn = avisoOriginal;
  }
});

test("un goteo por la salida chilena sale como plazo total, y el proxy no se da por caído", async () => {
  // El proxy está sano y es la CMF la que no termina. Tratarlo como proxy
  // caído entregaba un 403 y mandaba las consultas siguientes a la CMF
  // directa, que las rechaza.
  const env = {
    ...ESPERA_CORTA,
    CMF_RATE_LIMIT_MS: "0",
    CMF_REINTENTO_403_MS: "0",
    CMF_UPSTREAM_TIMEOUT_MS: "100",
    CMF_PROXY_URL: "https://salida-goteo.example.cl/",
    CMF_PROXY_TOKEN: "token-de-prueba",
  };
  const avisos: string[] = [];
  const avisoOriginal = console.warn;
  console.warn = (linea: unknown) => void avisos.push(String(linea));
  let gotea = true;
  const idas: string[] = [];
  try {
    await conRed(
      () => (url) => {
        const host = new URL(url).hostname;
        idas.push(host);
        return host.endsWith(".example.cl")
          ? new Response(goteo(() => gotea), { headers: { "x-cmf-salida": "1" } })
          : new Response("<html><title>403 Forbidden</title></html>", { status: 403 });
      },
      async () => {
        const fin = await fetchCmf("https://www.cmfchile.cl/goteo-proxy.pdf", {}, env).then(
          (r) => `devolvió ${r.status}`,
          (e) => `lanzó. ${(e as Error).message}`,
        );
        assert.match(fin, /^lanzó\. .*no terminó.*1000 ms.*https:\/\/www\.cmfchile\.cl\/goteo-proxy\.pdf\)$/);
        assert.ok(!avisos.some((a) => a.includes("proxy_fallo")), `anotó un proxy caído. ${avisos.join(" | ")}`);
        gotea = false;
        idas.length = 0;
        await fetchCmf("https://www.cmfchile.cl/siguiente.php", {}, env).then((r) => r.text());
        assert.equal(idas[0], "salida-goteo.example.cl", "la consulta siguiente tiene que partir por el proxy");
      },
    );
  } finally {
    gotea = false;
    console.warn = avisoOriginal;
  }
});

test("un cuerpo que gotea sin terminar nunca se corta al plazo total, sin reintento", async () => {
  // El plazo de silencio no lo ve, porque siempre llega un tramo a tiempo.
  // El plazo total es 10 veces el de silencio. Acá, 1500 ms.
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: "150" };
  let consultas = 0;
  let cancelado = false;
  let gotea = true;
  try {
    await conRed(
      () => (url) => {
        if (url.includes("/sana")) return new Response("ok");
        consultas++;
        return new Response(goteo(() => gotea, () => void (cancelado = true)));
      },
      async () => {
        const inicio = Date.now();
        const fin = await Promise.race([
          fetchCmf("https://www.cmfchile.cl/gotea.php?token=secreto", {}, env).then(
            (r) => `devolvió ${r.status}`,
            (e) => `lanzó. ${(e as Error).message}`,
          ),
          tras(6000, "sigue goteando"),
        ]);
        assert.match(fin, /^lanzó\. .*no terminó.*1500 ms.*https:\/\/www\.cmfchile\.cl\/gotea\.php\)$/);
        assert.ok(Date.now() - inicio >= 1495, `cortó antes del plazo total, a los ${Date.now() - inicio} ms`);
        assert.equal(consultas, 1, "un goteo no se reintenta. cada intento ocuparía el cupo otro plazo total");
        assert.ok(cancelado, "el cuerpo que goteaba quedó abierto");
        // El plazo total devuelve su cupo. Con 4 goteos a la vez, si cada uno
        // se lo quedara, la consulta siguiente no encontraría ninguno.
        await Promise.all(
          Array.from({ length: TOPE }, (_, i) => fetchCmf(`https://www.cmfchile.cl/gotea${i}.php`, {}, env).catch(() => {})),
        );
        const sana = await fetchCmf("https://api.sbif.cl/sana", {}, { ...env, CMF_ESPERA_CUPO_MS: "300" });
        assert.equal(await sana.text(), "ok");
      },
    );
  } finally {
    gotea = false;
  }
});

test("la respuesta conserva estado, cabeceras y cada cookie por separado", async () => {
  // El anti-bot lee las cookies de set-cookie. Si el plazo del cuerpo las
  // fundiera en una sola línea, el desafío F5 dejaría de resolverse.
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0" };
  await conRed(
    () => () => {
      const headers = new Headers({ "content-type": "text/html; charset=iso-8859-1" });
      headers.append("set-cookie", "cookiesession1=AAAA; Path=/");
      headers.append("set-cookie", "PHPSESSID=BBBB; Path=/");
      return new Response("no encontrado", { status: 404, statusText: "Not Found", headers });
    },
    async () => {
      const res = await fetchCmf("https://www.cmfchile.cl/con-cookies", {}, env);
      assert.equal(res.status, 404);
      assert.equal(res.statusText, "Not Found");
      assert.equal(res.headers.get("content-type"), "text/html; charset=iso-8859-1");
      assert.deepEqual(res.headers.getSetCookie(), ["cookiesession1=AAAA; Path=/", "PHPSESSID=BBBB; Path=/"]);
      assert.equal(await res.text(), "no encontrado");
    },
  );
});

// Lo que sigue lo encontró la revisión adversarial del propio arreglo, el 9 de
// octubre de 2026, con un servidor HTTP real.

test("un estado HTTP que Response no sabe construir se entrega tal como llegó", async () => {
  // La red entrega estados fuera de 200 a 599 y `new Response` los rechaza
  // con RangeError. Envolver esa respuesta la cambiaba por un error ilegible.
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0" };
  await conRed(
    () => () => Object.defineProperty(new Response("cuerpo de 600"), "status", { value: 600 }),
    async () => {
      const res = await fetchCmf("https://www.cmfchile.cl/estado-raro", {}, env);
      assert.equal(res.status, 600);
      assert.equal(await res.text(), "cuerpo de 600");
    },
  );
});

test("la respuesta al desafío anti-bot, que nadie lee, se suelta", async () => {
  // Con el cuerpo envuelto, una respuesta sin leer ya no la suelta el
  // recolector de basura. Medido con un servidor real. 6 conexiones abiertas
  // tras 6 desafíos, y seguían ahí 18 segundos después.
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0" };
  let soltada = false;
  await conRed(
    (abrir) =>
      redConDesafio(
        () => new Response(abrir({ alCancelar: () => void (soltada = true) }), { headers: { "set-cookie": "cookiesession1=AAAA; Path=/" } }),
        () => new Response("datos"),
      ),
    async () => {
      const res = await fetchCmf("https://www.cmfchile.cl/con-desafio", {}, env);
      assert.equal(await res.text(), "datos");
      assert.ok(soltada, "el cuerpo de la respuesta al desafío quedó abierto");
    },
  );
});

// Hasta el 10 de octubre de 2026 la respuesta que sigue al desafío llegaba a
// quien llama sin leer, y un cuerpo colgado ahí le reventaba en la mano, sin
// reintento. Ahora esa respuesta se lee dentro de la consulta, con el cupo
// tomado, igual que una primera respuesta. Las 2 pruebas que siguen fijan lo
// que eso cambia.
test("tras el desafío, un cuerpo que se cuelga vence dentro de la consulta, se reintenta y se suelta", async () => {
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: "150" };
  let colgados = 0;
  let soltados = 0;
  await conRed(
    (abrir) =>
      redConDesafio(conCookie, () => {
        colgados++;
        return new Response(abrir({ primerTramo: "empieza", alCancelar: () => void soltados++ }));
      }),
    async () => {
      const fin = await fetchCmf("https://www.cmfchile.cl/a-medias.php?token=secreto", {}, env).then(
        (r) => `devolvió ${r.status}`,
        (e) => `lanzó. ${(e as Error).message}`,
      );
      assert.match(fin, /^lanzó\. .*150 ms.*https:\/\/www\.cmfchile\.cl\/a-medias\.php\)$/);
      // El desafío ya quedó resuelto en el jar, así que los reintentos van directo a la consulta.
      assert.equal(colgados, INTENTOS, "intentos");
      assert.equal(soltados, INTENTOS, "cuerpos soltados");
    },
  );
});

test("tras el desafío, un cuerpo que se cuelga por la salida chilena cuenta como proxy caído", async () => {
  const env = {
    ...ESPERA_CORTA,
    CMF_RATE_LIMIT_MS: "0",
    CMF_REINTENTO_403_MS: "0",
    CMF_UPSTREAM_TIMEOUT_MS: "150",
    CMF_PROXY_URL: "https://salida-cuerpo.example.cl/ruta-interna/",
    CMF_PROXY_TOKEN: "token-de-prueba",
  };
  const marca = { "x-cmf-salida": "1" };
  const avisos: string[] = [];
  const avisoOriginal = console.warn;
  console.warn = (linea: unknown) => void avisos.push(String(linea));
  try {
    await conRed(
      (abrir) => {
        const porProxy = redConDesafio(
          () => new Response("ok", { headers: { ...marca, "set-cookie": "cookiesession1=AAAA; Path=/" } }),
          () => new Response(abrir({ primerTramo: "empieza" }), { headers: marca }),
          marca,
        );
        return (url, init) =>
          new URL(url).hostname.endsWith(".example.cl")
            ? porProxy(url, init)
            : new Response("<html><title>403 Forbidden</title></html>", { status: 403 });
      },
      async () => {
        // Igual que un proxy que se cuelga en su primera respuesta. se entrega el bloqueo original.
        const res = await fetchCmf("https://www.cmfchile.cl/por-proxy.php?token=secreto", {}, env);
        assert.equal(res.status, 403);
        assert.ok(avisos.some((a) => a.includes("proxy_fallo")), `no anotó el proxy caído. ${avisos.join(" | ")}`);
      },
    );
  } finally {
    console.warn = avisoOriginal;
  }
});

test("tras el desafío, las cookies de la respuesta final quedan en el jar", async () => {
  // El flujo del captcha baja la imagen con un jar y después usa su cookie de
  // sesión para enviar el código. Si la imagen llegaba tras un desafío, esa
  // cookie se perdía.
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0" };
  const jar = crearCookieJar();
  await conRed(
    () => redConDesafio(conCookie, () => new Response("imagen", { headers: { "set-cookie": "SVS_HE=sesion123; Path=/" } })),
    async () => {
      const res = await fetchCmf("https://www.cmfchile.cl/captcha.php", {}, env, jar);
      assert.equal(await res.text(), "imagen");
      assert.match(jar.cabeceraCompleta(), /SVS_HE=sesion123/);
    },
  );
});

// Anterior a todo el trabajo del limitador. Lo midió la cuarta revisión
// adversarial el 10 de octubre de 2026. Tras el desafío anti-bot,
// resolverChallenge entregaba la respuesta de la consulta repetida sin leer
// su cuerpo. fetchCmf devolvía el cupo ahí, y el cuerpo se bajaba después,
// fuera del tope. Con 12 consultas juntas había 12 cuerpos bajando a la vez.
test(`tras el desafío anti-bot, el cuerpo se baja con el cupo tomado. nunca más de ${TOPE} a la vez`, async () => {
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0" };
  let bajando = 0;
  let maximo = 0;
  const cuerpoLento = () => {
    bajando++;
    maximo = Math.max(maximo, bajando);
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(c) {
          await tras(150, null);
          bajando--;
          c.enqueue(new TextEncoder().encode("documento"));
          c.close();
        },
      }),
    );
  };
  await conRed(
    () => redConDesafio(conCookie, cuerpoLento),
    async () => {
      const textos = await Promise.all(
        Array.from({ length: 12 }, (_, i) => fetchCmf(`https://www.cmfchile.cl/con-desafio${i}.pdf`, {}, env).then((r) => r.text())),
      );
      assert.deepEqual([...new Set(textos)], ["documento"]);
    },
  );
  assert.equal(maximo, TOPE, `máximo de cuerpos bajando a la vez. ${maximo}`);
});

// Los 2 que siguen los encontró la quinta revisión adversarial, el 10 de
// octubre de 2026, y son anteriores a todo el trabajo del limitador.
test("si la consulta repetida vuelve a ser el desafío, es un error y no un dato", async () => {
  // La CMF no aceptó la cookie. Antes la página del desafío llegaba a la tool
  // como si fuera la respuesta, y el parser la leía como una página sin datos.
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0" };
  await conRed(
    () => redConDesafio(conCookie, () => new Response(DESAFIO)),
    async () => {
      const fin = await fetchCmf("https://www.cmfchile.cl/insiste.php?token=secreto", {}, env).then(
        (r) => r.text().then((t) => `devolvió ${r.status} con ${t.length} caracteres`),
        (e) => `lanzó. ${(e as Error).message}`,
      );
      assert.match(fin, /^lanzó\. .*desafío anti-bot.*https:\/\/www\.cmfchile\.cl\/insiste\.php\)/);
      assert.ok(!fin.includes("secreto"), fin);
    },
  );
});

test("tras el desafío, la consulta repetida conserva las cookies que traía quien llama", async () => {
  // El envío del código del captcha lleva la cookie de sesión de la imagen.
  // La consulta repetida la reemplazaba por la del desafío, y la CMF
  // respondía «captcha incorrecto».
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0" };
  const cookiesQueLlegan: string[] = [];
  await conRed(
    () => (url, init) => {
      cookiesQueLlegan.push(`${init.method ?? "GET"} ${new Headers(init.headers).get("cookie") ?? ""}`);
      return redConDesafio(conCookie, () => new Response("datos"))(url, init);
    },
    async () => {
      const res = await fetchCmf("https://www.cmfchile.cl/enviar-codigo.php", { headers: { Cookie: "SVS_HE=sesion123" } }, env);
      assert.equal(await res.text(), "datos");
    },
  );
  assert.deepEqual(cookiesQueLlegan, [
    "GET SVS_HE=sesion123",
    "POST SVS_HE=sesion123",
    "GET SVS_HE=sesion123; cookiesession1=AAAA",
  ]);
});

// Los 4 que siguen los encontró la sexta revisión adversarial, el 10 de
// octubre de 2026, sobre los arreglos de la quinta.
test("las cookies de quien llama viajan tal como venían, y las del jar se agregan al final", async () => {
  // Unirlas rearmando la cabecera par por par cambiaba lo que mandó quien
  // llama. un nombre repetido perdía su primer valor, una cookie sin valor
  // desaparecía, y un valor entre comillas con un punto y coma salía cortado.
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0" };
  const deQuienLlama = 'a=1; a=2; sinvalor; q="x;y"; cookiesession1=VIEJA; b=2';
  const cookiesQueLlegan: string[] = [];
  await conRed(
    () => (url, init) => {
      cookiesQueLlegan.push(new Headers(init.headers).get("cookie") ?? "");
      return redConDesafio(conCookie, () => new Response("datos"))(url, init);
    },
    async () => {
      // Con una cookie del desafío vieja, la CMF responde otra vez el desafío. Acá la red simulada mira solo que exista.
      const res = await fetchCmf("https://www.cmfchile.cl/tal-cual.php", { headers: { Cookie: 'a=1; a=2; sinvalor; q="x;y"; b=2' } }, env);
      assert.equal(await res.text(), "datos");
    },
  );
  assert.equal(cookiesQueLlegan[0], 'a=1; a=2; sinvalor; q="x;y"; b=2');
  assert.equal(cookiesQueLlegan[2], 'a=1; a=2; sinvalor; q="x;y"; b=2; cookiesession1=AAAA');
  // La del jar reemplaza a la del mismo nombre que traía quien llama, y nada más.
  const jar = crearCookieJar();
  jar.setFromHeaders(new Headers({ "set-cookie": "cookiesession1=NUEVA; Path=/" }));
  const headers = new Headers({ Cookie: deQuienLlama });
  conCookiesDelJar(headers, jar, new URL("https://www.cmfchile.cl/"));
  assert.equal(headers.get("Cookie"), 'a=1; a=2; sinvalor; q="x;y"; b=2; cookiesession1=NUEVA');
});

test("una página chica y legítima que llega tras el desafío no se toma por otro desafío", async () => {
  // La primera respuesta es un desafío solo si además trae su dato fwb_dat.
  // La repetida se miraba con menos exigencia, y una página chica con un
  // script empaquetado se volvía un error.
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0" };
  const paginaChica = "<html><script>eval(function(p,a,c,k,e,d){return p}('menu',1,1,''))</script>Sin resultados</html>";
  await conRed(
    () => redConDesafio(conCookie, () => new Response(paginaChica)),
    async () => {
      const res = await fetchCmf("https://www.cmfchile.cl/chica.php", {}, env);
      assert.equal(await res.text(), paginaChica);
    },
  );
});

test("un desafío de 3000 caracteres se reconoce igual", async () => {
  // El desafío mide menos de 4000 caracteres. El corte por tamaño que evita
  // convertir a texto los documentos grandes no puede dejarlo pasar como dato.
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0" };
  const relleno = " ".repeat(3000 - DESAFIO.length);
  await conRed(
    () => (_url, init) => {
      if (init.method === "POST") return conCookie();
      const resuelto = new Headers(init.headers).get("cookie")?.includes("cookiesession1");
      return new Response(resuelto ? "datos" : DESAFIO + relleno);
    },
    async () => {
      const res = await fetchCmf("https://www.cmfchile.cl/desafio-largo.php", {}, env);
      assert.equal(await res.text(), "datos");
    },
  );
});

test("el desafío repetido por la salida chilena es un error de la CMF, y el proxy no se da por caído", async () => {
  const env = {
    ...ESPERA_CORTA,
    CMF_RATE_LIMIT_MS: "0",
    CMF_REINTENTO_403_MS: "0",
    CMF_PROXY_URL: "https://salida-insiste.example.cl/",
    CMF_PROXY_TOKEN: "token-de-prueba",
  };
  const marca = { "x-cmf-salida": "1" };
  const avisos: string[] = [];
  const avisoOriginal = console.warn;
  console.warn = (linea: unknown) => void avisos.push(String(linea));
  const idas: string[] = [];
  try {
    await conRed(
      () => {
        const porProxy = redConDesafio(
          () => new Response("ok", { headers: { ...marca, "set-cookie": "cookiesession1=AAAA; Path=/" } }),
          () => new Response(DESAFIO, { headers: marca }),
          marca,
        );
        return (url, init) => {
          idas.push(new URL(url).hostname);
          return new URL(url).hostname.endsWith(".example.cl")
            ? porProxy(url, init)
            : new Response("<html><title>403 Forbidden</title></html>", { status: 403 });
        };
      },
      async () => {
        await assert.rejects(fetchCmf("https://www.cmfchile.cl/insiste-por-proxy.php", {}, env), /desafío anti-bot 2 veces/);
        assert.ok(!avisos.some((a) => a.includes("proxy_fallo")), `anotó un proxy caído. ${avisos.join(" | ")}`);
        // 1 directa que da el bloqueo, y después solo el proxy. Ninguna consulta más a la CMF directa.
        assert.equal(idas.filter((h) => h === "www.cmfchile.cl").length, 1, idas.join(", "));
      },
    );
  } finally {
    console.warn = avisoOriginal;
  }
});

// Lo que sigue lo encontró la séptima revisión adversarial, el 10 de octubre
// de 2026, sobre conCookiesDelJar.

/** La cabecera Cookie que sale de juntar `deQuienLlama` con las cookies del jar. */
function unir(deQuienLlama: string, ...delJar: string[]): string {
  const jar = crearCookieJar();
  const cabeceras = new Headers();
  for (const cookie of delJar) cabeceras.append("set-cookie", `${cookie}; Path=/`);
  jar.setFromHeaders(cabeceras);
  const headers = new Headers(deQuienLlama === "" ? {} : { Cookie: deQuienLlama });
  conCookiesDelJar(headers, jar, new URL("https://www.cmfchile.cl/"));
  return headers.get("Cookie") ?? "";
}

test("una comilla sin cerrar en las cookies de quien llama no deja la cookie vieja ni repite la del jar", () => {
  // Con la comilla abierta, todo lo que seguía se tomaba por un solo valor. La
  // cookie vieja quedaba delante de la nueva, y cada pasada agregaba la del
  // jar otra vez. Tras una redirección viajaba 2 veces.
  const casos: [string, string][] = [
    ['a="x; cookiesession1=VIEJA; b=2', 'a="x; b=2; cookiesession1=NUEVA'],
    ['cookiesession1=VIEJA; q=5"; z=9', 'q=5"; z=9; cookiesession1=NUEVA'],
    ['q=5"; cookiesession1=VIEJA; z=9', 'q=5"; z=9; cookiesession1=NUEVA'],
  ];
  for (const [entra, sale] of casos) {
    const primera = unir(entra, "cookiesession1=NUEVA");
    assert.equal(primera, sale, entra);
    assert.equal(unir(primera, "cookiesession1=NUEVA"), sale, `segunda pasada de ${entra}`);
  }
});

test("las cookies del jar reemplazan a las del mismo nombre, se escriban como se escriban", () => {
  // Con 2 cookies en el jar, las 2 reemplazan a las suyas.
  assert.equal(unir("cookiesession1=V1; csb1=V2; z=9", "cookiesession1=N1", "csb1=N2"), "z=9; cookiesession1=N1; csb1=N2");
  // Con espacios alrededor del nombre.
  assert.equal(unir("cookiesession1 = VIEJA; z=9", "cookiesession1=NUEVA"), "z=9; cookiesession1=NUEVA");
  // Una cookie sin valor que se llama igual que la del jar.
  assert.equal(unir("cookiesession1; z=9", "cookiesession1=NUEVA"), "z=9; cookiesession1=NUEVA");
  // Quien no traía cookies recibe solo las del jar, sin un punto y coma suelto.
  assert.equal(unir("", "cookiesession1=NUEVA"), "cookiesession1=NUEVA");
  assert.equal(unir("; ;", "cookiesession1=NUEVA"), "cookiesession1=NUEVA");
});

// Un mutante que la sexta revisión dejó vivo. leer el cuerpo de la respuesta
// repetida solo cuando es un 200. Una respuesta de error también trae cuerpo y
// cookies, y su cuerpo también se baja con el cupo tomado.
test("tras el desafío, una respuesta final de error también se lee entera, con el cupo tomado, y deja sus cookies", async () => {
  const env = { ...ESPERA_CORTA, CMF_RATE_LIMIT_MS: "0" };
  let bajando = 0;
  let maximo = 0;
  const errorLento = () => {
    bajando++;
    maximo = Math.max(maximo, bajando);
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(c) {
          await tras(150, null);
          bajando--;
          c.enqueue(new TextEncoder().encode("no está"));
          c.close();
        },
      }),
      { status: 404, headers: { "set-cookie": "SVS_HE=sesion404; Path=/" } },
    );
  };
  const jar = crearCookieJar();
  await conRed(
    () => redConDesafio(conCookie, errorLento),
    async () => {
      const primera = await fetchCmf("https://www.cmfchile.cl/no-esta.php", {}, env, jar);
      assert.equal(primera.status, 404);
      assert.equal(await primera.text(), "no está");
      assert.match(jar.cabeceraCompleta(), /SVS_HE=sesion404/);
      const estados = await Promise.all(
        Array.from({ length: 12 }, (_, i) => fetchCmf(`https://www.cmfchile.cl/no-esta${i}.php`, {}, env).then((r) => r.status)),
      );
      assert.deepEqual([...new Set(estados)], [404]);
    },
  );
  assert.equal(maximo, TOPE, `máximo de cuerpos bajando a la vez. ${maximo}`);
});
