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

const TOPE = 4;
const INTENTOS = 3;

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
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: "200" };
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
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: "400" };
  const TRAMOS = 8;
  await conRed(
    () => () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async start(c) {
            for (let i = 0; i < TRAMOS; i++) {
              await tras(60, null);
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
      assert.ok(Date.now() - inicio > 400, "la descarga tiene que durar más que el plazo para probar algo");
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

test("un goteo por la salida chilena sale como plazo total, y el proxy no se da por caído", async () => {
  // El proxy está sano y es la CMF la que no termina. Tratarlo como proxy
  // caído entregaba un 403 y mandaba las consultas siguientes a la CMF
  // directa, que las rechaza.
  const env = {
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
  const env = { CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: "150" };
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
  const env = { CMF_RATE_LIMIT_MS: "0" };
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
  const env = { CMF_RATE_LIMIT_MS: "0" };
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
  const env = { CMF_RATE_LIMIT_MS: "0" };
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

test("quien deja de leer una respuesta corta su descarga", async () => {
  const env = { CMF_RATE_LIMIT_MS: "0" };
  let razon: unknown;
  await conRed(
    (abrir) => redConDesafio(conCookie, () => new Response(abrir({ primerTramo: "empieza", alCancelar: (r) => void (razon = r) }))),
    async () => {
      const res = await fetchCmf("https://www.cmfchile.cl/a-medias", {}, env);
      await res.body?.cancel("me voy");
      assert.equal(razon, "me voy");
    },
  );
});

test("un cuerpo que se cuelga por la salida chilena nombra la página de la CMF, no el proxy", async () => {
  const env = {
    CMF_RATE_LIMIT_MS: "0",
    CMF_REINTENTO_403_MS: "0",
    CMF_UPSTREAM_TIMEOUT_MS: "150",
    CMF_PROXY_URL: "https://salida-cuerpo.example.cl/ruta-interna/",
    CMF_PROXY_TOKEN: "token-de-prueba",
  };
  const marca = { "x-cmf-salida": "1" };
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
      const res = await fetchCmf("https://www.cmfchile.cl/por-proxy.php?token=secreto", {}, env);
      const fin = await res.text().then(
        (t) => `leyó ${t}`,
        (e) => `lanzó. ${(e as Error).message}`,
      );
      assert.match(fin, /^lanzó\. .*150 ms.*https:\/\/www\.cmfchile\.cl\/por-proxy\.php\)$/);
      assert.ok(!fin.includes("example.cl") && !fin.includes("secreto"), fin);
    },
  );
});
