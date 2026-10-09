/**
 * Un 403 de la CMF tiene que dejar rastro de quién lo mandó.
 *
 * Medido el 9 de octubre de 2026. cmf_seguros_deposito_polizas y
 * cmf_documento_markdown respondieron 403 seis veces desde el Worker, y el
 * log no traía cabeceras ni cuerpo, así que no había forma de saber si la
 * CMF bloqueaba el origen de Cloudflare o el ritmo. Estas pruebas fijan lo
 * que ahora se registra, el reintento único ante 403, la clasificación de
 * las descargas binarias y las cabeceras de navegador por defecto.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CmfUpstreamError,
  fetchCmf,
  fetchCmfBinarioCached,
  getLegacy,
  getLegacyBinario,
} from "../src/client/cmf-client.js";

const env = { CMF_RATE_LIMIT_MS: "0", CMF_REINTENTO_403_MS: "0" };
const RELLENO = "x".repeat(200);

const CABECERAS_403 = {
  server: "cloudflare",
  "content-type": "text/html; charset=iso-8859-1",
  "content-length": "1234",
  "retry-after": "30",
  "cf-ray": "8f1a2b3c4d5e6f70-SCL",
  "x-cache": "MISS",
  via: "1.1 varnish",
  "set-cookie": "TS01c0ffee=VALOR_SECRETO_123; Path=/; Secure",
  "x-no-listada": "no debe aparecer en el log",
};

type Aviso = Record<string, unknown>;
type Llamada = { url: string; headers: Headers; hora: number };

/** Responde en orden con cada fábrica (la última se repite) y guarda cada llamada. */
async function conRespuestas<T>(
  fabricas: Array<() => Response>,
  fn: (llamadas: Llamada[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const llamadas: Llamada[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), headers: new Headers(init?.headers), hora: Date.now() });
    const fabrica = fabricas[Math.min(i, fabricas.length - 1)];
    i++;
    return fabrica();
  }) as typeof fetch;
  try {
    return await fn(llamadas);
  } finally {
    globalThis.fetch = original;
  }
}

/** Corre la llamada y captura el error que lanza, si lanza, y los avisos del log. */
async function capturar<T>(fn: () => Promise<T>): Promise<{ valor?: T; error?: unknown; avisos: Aviso[] }> {
  const avisos: Aviso[] = [];
  const original = console.warn;
  console.warn = (linea: unknown) => {
    try {
      avisos.push(JSON.parse(String(linea)) as Aviso);
    } catch {
      // otro aviso que no es el de la CMF
    }
  };
  try {
    return await fn().then(
      (valor) => ({ valor, avisos }),
      (error: unknown) => ({ error, avisos }),
    );
  } finally {
    console.warn = original;
  }
}

/** El bloque cmf_upstream del único aviso que deja una respuesta que no es datos. */
function avisoDe(avisos: Aviso[]): Aviso {
  const uno = avisos.find((a) => "cmf_upstream" in a);
  assert.ok(uno, "no quedó ningún aviso cmf_upstream en el log");
  return uno.cmf_upstream as Aviso;
}

test("un 403 registra cabeceras de diagnóstico y solo los NOMBRES de las cookies", async () => {
  const cuerpo = `<html><body>Acceso denegado ${RELLENO}</body></html>`;
  const r = await conRespuestas(
    [() => new Response(cuerpo, { status: 403, headers: CABECERAS_403 })],
    () => capturar(() => getLegacy("/institucional/x.php", { token: "SECRETO_EN_QUERY" }, env)),
  );
  assert.ok(r.error instanceof CmfUpstreamError);
  const aviso = avisoDe(r.avisos);
  assert.equal(aviso.status, 403);
  assert.equal(aviso.reintento_403, true);
  const cabeceras = aviso.cabeceras as Record<string, string>;
  assert.equal(cabeceras.server, "cloudflare");
  assert.equal(cabeceras["cf-ray"], "8f1a2b3c4d5e6f70-SCL");
  assert.equal(cabeceras["retry-after"], "30");
  assert.equal(cabeceras["x-no-listada"], undefined, "solo se registra el subconjunto fijo de cabeceras");
  assert.deepEqual(aviso.cookies, ["TS01c0ffee"]);
  assert.equal(aviso.inicio, cuerpo.slice(0, 160));
  assert.equal(aviso.ruta, "/institucional/x.php");
  const texto = JSON.stringify(r.avisos);
  assert.ok(!texto.includes("VALOR_SECRETO_123"), "el log no debe traer el valor de la cookie");
  assert.ok(!texto.includes("SECRETO_EN_QUERY"), "el log no debe traer la query de la URL");
});

test("un 403 en una descarga binaria registra cabeceras y los primeros 160 caracteres del cuerpo", async () => {
  const cuerpo = `Documento no disponible ${RELLENO}`;
  const r = await conRespuestas(
    [() => new Response(cuerpo, { status: 403, headers: CABECERAS_403 })],
    () => capturar(() => getLegacyBinario("/sitio/aplic/doc.php", { s567: "x" }, env)),
  );
  assert.equal((r.error as CmfUpstreamError).motivo, "http");
  const aviso = avisoDe(r.avisos);
  assert.equal(aviso.inicio, cuerpo.slice(0, 160));
  assert.equal((aviso.cabeceras as Record<string, string>).server, "cloudflare");
  assert.deepEqual(aviso.cookies, ["TS01c0ffee"]);
  assert.equal(aviso.ruta, "/sitio/aplic/doc.php");
});

test("fetchCmfBinarioCached registra cabeceras y cuerpo en su 403", async () => {
  const cuerpo = `Documento no disponible ${RELLENO}`;
  const r = await conRespuestas(
    [() => new Response(cuerpo, { status: 403, headers: CABECERAS_403 })],
    () => capturar(() => fetchCmfBinarioCached("https://www.cmfchile.cl/sitio/doc.php?s=1", "clave-diag-403", env)),
  );
  assert.equal((r.error as CmfUpstreamError).motivo, "http");
  const aviso = avisoDe(r.avisos);
  assert.equal(aviso.inicio, cuerpo.slice(0, 160));
  assert.equal((aviso.cabeceras as Record<string, string>)["cf-ray"], "8f1a2b3c4d5e6f70-SCL");
});

test("una descarga sana entrega sus bytes intactos y no deja aviso", async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0xe9]);
  const r = await conRespuestas(
    [() => new Response(bytes, { status: 200, headers: { "content-type": "application/pdf" } })],
    () => capturar(() => getLegacyBinario("/sitio/doc.php", {}, env)),
  );
  assert.deepEqual(Array.from(r.valor as Uint8Array), Array.from(bytes));
  assert.equal(r.avisos.length, 0);
});

test("un 403 binario con la página del cortafuegos sale como motivo cortafuegos", async () => {
  const cuerpo = "<html>The requested URL was rejected. Attack ID 4402</html>";
  const r = await conRespuestas(
    [() => new Response(cuerpo, { status: 403 })],
    () => capturar(() => getLegacyBinario("/sitio/doc.php", {}, env)),
  );
  assert.equal((r.error as CmfUpstreamError).motivo, "cortafuegos");
  assert.equal(avisoDe(r.avisos).cortafuegos, true);
});

test("fetchCmfBinarioCached con 403 y la marca del cortafuegos sale como cortafuegos", async () => {
  const cuerpo = "<html>Attack ID 9913 de la página de seguridad</html>";
  const r = await conRespuestas(
    [() => new Response(cuerpo, { status: 403 })],
    () => capturar(() => fetchCmfBinarioCached("https://www.cmfchile.cl/sitio/doc.php?s=2", "clave-diag-cortafuegos", env)),
  );
  assert.equal((r.error as CmfUpstreamError).motivo, "cortafuegos");
});

test("un 403 seguido de un 200 entrega el 200 tras un solo reintento", async () => {
  const texto = await conRespuestas(
    [() => new Response("bloqueado", { status: 403 }), () => new Response("<html>datos</html>", { status: 200 })],
    async (llamadas) => {
      const t = await getLegacy("/institucional/x.php", {}, env);
      assert.equal(llamadas.length, 2);
      return t;
    },
  );
  assert.equal(texto, "<html>datos</html>");
});

test("dos 403 seguidos devuelven el 403 tras exactamente dos llamadas, con reintento_403 en true", async () => {
  const r = await conRespuestas(
    [() => new Response("bloqueado", { status: 403 })],
    async (llamadas) => ({
      ...(await capturar(() => getLegacy("/institucional/x.php", {}, env))),
      llamadas: llamadas.length,
    }),
  );
  assert.equal(r.llamadas, 2);
  assert.equal((r.error as CmfUpstreamError).status, 403);
  assert.equal(avisoDe(r.avisos).reintento_403, true);
});

test("un 404 no se reintenta y deja reintento_403 en false", async () => {
  const r = await conRespuestas(
    [() => new Response("no existe", { status: 404 })],
    async (llamadas) => ({
      ...(await capturar(() => getLegacy("/institucional/x.php", {}, env))),
      llamadas: llamadas.length,
    }),
  );
  assert.equal(r.llamadas, 1);
  assert.equal((r.error as CmfUpstreamError).status, 404);
  assert.equal(avisoDe(r.avisos).reintento_403, false);
});

test("la espera antes del reintento 403 sale de CMF_REINTENTO_403_MS", async () => {
  await conRespuestas(
    [() => new Response("bloqueado", { status: 403 }), () => new Response("ok", { status: 200 })],
    async (llamadas) => {
      const r = await fetchCmf("https://www.cmfchile.cl/institucional/x.php", {}, {
        CMF_RATE_LIMIT_MS: "0",
        CMF_REINTENTO_403_MS: "200",
      });
      assert.equal(await r.text(), "ok");
      const brecha = llamadas[1].hora - llamadas[0].hora;
      assert.ok(brecha >= 190, `entre el 403 y el reintento pasaron ${brecha} ms, debían ser al menos 200`);
    },
  );
});

test("seis llamadas con 403 a la vez terminan todas: cada espera del limitador se libera", { timeout: 10000 }, async () => {
  await conRespuestas([() => new Response("bloqueado", { status: 403 })], async () => {
    const errores = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) =>
        getLegacy(`/institucional/x${i}.php`, {}, env).then(
          () => "sin error",
          (e: unknown) => e,
        ),
      ),
    );
    assert.equal(errores.filter((e) => e instanceof CmfUpstreamError).length, 6);
  });
});

test("sin cabeceras del llamador, fetchCmf manda Accept y Accept-Language de navegador y no manda Referer", async () => {
  await conRespuestas([() => new Response("ok", { status: 200 })], async (llamadas) => {
    await fetchCmf("https://www.cmfchile.cl/institucional/x.php", {}, env);
    const h = llamadas[0].headers;
    assert.equal(h.get("accept"), "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    assert.equal(h.get("accept-language"), "es-CL,es;q=0.9");
    assert.equal(h.get("referer"), null);
  });
});

test("una cabecera Accept que pone el llamador no se pisa", async () => {
  await conRespuestas([() => new Response("ok", { status: 200 })], async (llamadas) => {
    await fetchCmf("https://www.cmfchile.cl/institucional/x.php", { headers: { Accept: "application/json" } }, env);
    const h = llamadas[0].headers;
    assert.equal(h.get("accept"), "application/json");
    assert.equal(h.get("accept-language"), "es-CL,es;q=0.9");
  });
});

test("las cabeceras de navegador van solo a www.cmfchile.cl: la API de api.sbif.cl sigue sin Accept de página", async () => {
  // La API responde JSON o XML. Un Accept de página HTML ahí no se verificó
  // contra la API real, así que no se le manda lo que no pidió.
  await conRespuestas([() => new Response("{}", { status: 200 })], async (llamadas) => {
    await fetchCmf("https://api.sbif.cl/api-sbifv3/recursos_api/uf", {}, env);
    const h = llamadas[0].headers;
    assert.equal(h.get("accept"), null);
    assert.equal(h.get("accept-language"), null);
  });
});

test("el 403 dice que el MCP fue rechazado, que el dato puede existir y que el navegador suele abrirlo", async () => {
  const r = await conRespuestas(
    [() => new Response("bloqueado", { status: 403 })],
    () => capturar(() => getLegacy("/institucional/x.php", {}, env)),
  );
  const mensaje = (r.error as Error).message;
  assert.match(mensaje, /rechazó la consulta desde el servidor del MCP/);
  assert.match(mensaje, /dato puede existir/);
  assert.match(mensaje, /navegador/);
  assert.match(mensaje, /bloqueo o caída, no ausencia de datos/);
});
