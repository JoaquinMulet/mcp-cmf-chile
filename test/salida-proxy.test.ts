/**
 * El proxy de la salida chilena no es un proxy abierto.
 *
 * Corre en una máquina con IP doméstica chilena y consulta a la CMF por el
 * Worker (ver test/salida-chilena.test.ts). Estas pruebas levantan el servidor
 * real en un puerto libre, con la red hacia la CMF reemplazada, y fijan sus 3
 * cerrojos: secreto, destino y ritmo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
// @ts-expect-error el proxy es JavaScript sin tipos, a propósito: corre sin compilar.
import { crearServidor, destinoPermitido } from "../infra/salida-chilena/proxy.mjs";

const TOKEN = "t".repeat(48);
const DESTINO = "https://www.cmfchile.cl/institucional/mercados/entidad.php?rut=90749000";

type Pedido = { url: string; init: RequestInit };

async function conProxy(
  opciones: Record<string, unknown>,
  fn: (base: string, pedidos: Pedido[]) => Promise<void>,
): Promise<void> {
  const pedidos: Pedido[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    return new Response("<html>ficha</html>", {
      status: 200,
      headers: [
        ["content-type", "text/html; charset=iso-8859-1"],
        ["set-cookie", "a=1; Path=/"],
        ["set-cookie", "b=2; Path=/"],
        ["x-interna", "no se reenvia"],
      ],
    });
  };
  const original = console.log;
  console.log = () => {};
  const servidor = crearServidor({ token: TOKEN, fetchFn, minMs: 0, ...opciones });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const { port } = servidor.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}/`, pedidos);
  } finally {
    console.log = original;
    await new Promise((r) => servidor.close(r));
  }
}

const cabeceras = (extra: Record<string, string> = {}) => ({ "X-Cmf-Token": TOKEN, "X-Cmf-Destino": DESTINO, ...extra });

test("reenvía a la CMF y marca la respuesta", () =>
  conProxy({}, async (base, pedidos) => {
    const res = await fetch(base, { headers: cabeceras({ "User-Agent": "Mozilla/5.0 prueba", Cookie: "s=1", "X-Otra": "no" }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-cmf-salida"), "1");
    assert.equal(res.headers.get("x-interna"), null);
    assert.deepEqual(res.headers.getSetCookie(), ["a=1; Path=/", "b=2; Path=/"]);
    assert.equal(await res.text(), "<html>ficha</html>");
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0].url, DESTINO);
    const ida = pedidos[0].init.headers as Record<string, string>;
    assert.equal(ida["user-agent"], "Mozilla/5.0 prueba");
    assert.equal(ida.cookie, "s=1");
    assert.equal(ida["x-otra"], undefined);
    assert.equal(ida["x-cmf-token"], undefined, "el secreto no viaja a la CMF");
    assert.equal(pedidos[0].init.redirect, "manual");
  }));

test("sin el secreto correcto responde 401 y no consulta a la CMF", () =>
  conProxy({}, async (base, pedidos) => {
    for (const token of ["", "x".repeat(48), TOKEN.slice(1)]) {
      const res = await fetch(base, { headers: { "X-Cmf-Token": token, "X-Cmf-Destino": DESTINO } });
      assert.equal(res.status, 401);
      assert.equal(res.headers.get("x-cmf-salida"), null);
    }
    assert.equal(pedidos.length, 0);
  }));

test("solo acepta destinos https de www.cmfchile.cl", () => {
  const malos = [
    "http://www.cmfchile.cl/x",
    "https://cmfchile.cl/x",
    "https://www.cmfchile.cl.evil.cl/x",
    "https://evil.cl/?u=https://www.cmfchile.cl/",
    "https://www.cmfchile.cl@evil.cl/x",
    "https://www.cmfchile.cl:8443/x",
    "https://192.168.0.1/",
    "file:///etc/passwd",
    "",
    undefined,
  ];
  for (const malo of malos) assert.equal(destinoPermitido(malo), null, String(malo));
  assert.equal(destinoPermitido(DESTINO)?.hostname, "www.cmfchile.cl");
});

test("un destino ajeno responde 400 y no sale ninguna consulta", () =>
  conProxy({}, async (base, pedidos) => {
    const res = await fetch(base, { headers: cabeceras({ "X-Cmf-Destino": "https://192.168.0.1/admin" }) });
    assert.equal(res.status, 400);
    assert.equal(pedidos.length, 0);
  }));

test("el cuerpo de un POST llega a la CMF", () =>
  conProxy({}, async (base, pedidos) => {
    const res = await fetch(base, {
      method: "POST",
      headers: cabeceras({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: "aa=2026&mm=03",
    });
    assert.equal(res.status, 200);
    assert.equal(pedidos[0].init.method, "POST");
    assert.equal(String(pedidos[0].init.body), "aa=2026&mm=03");
  }));

test("respeta la separación mínima entre consultas a la CMF", () =>
  conProxy({ minMs: 150 }, async (base, pedidos) => {
    const horas: number[] = [];
    const originalPush = pedidos.push.bind(pedidos);
    pedidos.push = (...p: Pedido[]) => {
      horas.push(Date.now());
      return originalPush(...p);
    };
    await Promise.all([1, 2, 3].map(() => fetch(base, { headers: cabeceras() }).then((r) => r.text())));
    assert.equal(horas.length, 3);
    assert.ok(horas[1] - horas[0] >= 120, `brecha 1 de ${horas[1] - horas[0]} ms`);
    assert.ok(horas[2] - horas[1] >= 120, `brecha 2 de ${horas[2] - horas[1]} ms`);
  }));

test("con la cola llena responde 429 sin la marca de la CMF", () =>
  conProxy({ minMs: 300, colaMaxima: 1 }, async (base) => {
    const respuestas = await Promise.all([1, 2, 3].map(() => fetch(base, { headers: cabeceras() })));
    const rechazadas = respuestas.filter((r) => r.status === 429);
    assert.ok(rechazadas.length >= 1);
    for (const r of rechazadas) assert.equal(r.headers.get("x-cmf-salida"), null);
    await Promise.all(respuestas.map((r) => r.text()));
  }));

test("un token corto no arranca el servidor", () => {
  assert.throws(() => crearServidor({ token: "corto" }), /32 caracteres/);
});

// Lo que sigue lo encontró la revisión adversarial del 9 de octubre de 2026.

/** Una respuesta cuyo cuerpo llega en 2 tramos, con una pausa entre ellos. */
function respuestaLenta(pausaMs: number, alCancelar: () => void = () => {}): Response {
  const cuerpo = new ReadableStream<Uint8Array>({
    async start(c) {
      c.enqueue(new TextEncoder().encode("primero-"));
      await new Promise((r) => setTimeout(r, pausaMs));
      try {
        c.enqueue(new TextEncoder().encode("segundo"));
        c.close();
      } catch {
        // el lector ya cortó
      }
    },
    cancel() {
      alCancelar();
    },
  });
  return new Response(cuerpo, { status: 200, headers: { "content-type": "application/pdf", "cache-control": "public, max-age=900" } });
}

test("las cabeceras salen antes de que termine el cuerpo, y nunca se cachea ni se transforma", () =>
  conProxy({ fetchFn: async () => respuestaLenta(400) }, async (base) => {
    const inicio = Date.now();
    const res = await fetch(base, { headers: cabeceras() });
    assert.ok(Date.now() - inicio < 300, `las cabeceras tardaron ${Date.now() - inicio} ms`);
    assert.equal(res.headers.get("cache-control"), "no-store, no-transform");
    assert.equal(await res.text(), "primero-segundo");
  }));

test("el cupo sigue ocupado mientras baja el cuerpo, y la cola llena lleva su marca", () =>
  conProxy({ colaMaxima: 1, fetchFn: async () => respuestaLenta(400) }, async (base) => {
    const primera = await fetch(base, { headers: cabeceras() });
    const segunda = await fetch(base, { headers: cabeceras() });
    assert.equal(segunda.status, 429);
    assert.equal(segunda.headers.get("x-cmf-salida-cola"), "1");
    assert.equal(segunda.headers.get("x-cmf-salida"), null);
    await segunda.text();
    assert.equal(await primera.text(), "primero-segundo");
    const tercera = await fetch(base, { headers: cabeceras() });
    assert.equal(tercera.status, 200, "al terminar el cuerpo, el cupo se libera");
    await tercera.text();
  }));

test("si quien llama corta mientras espera turno, la consulta no sale a la CMF", () =>
  conProxy({ minMs: 400 }, async (base, pedidos) => {
    await fetch(base, { headers: cabeceras() }).then((r) => r.text());
    const corte = new AbortController();
    const pendiente = fetch(base, { headers: cabeceras(), signal: corte.signal }).catch(() => "cortada");
    await new Promise((r) => setTimeout(r, 100));
    corte.abort();
    assert.equal(await pendiente, "cortada");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(pedidos.length, 1, "solo la primera consulta llegó a la CMF");
  }));

test("si quien llama corta a mitad del cuerpo, la descarga desde la CMF se cancela", async () => {
  let cancelada = false;
  await conProxy({ fetchFn: async () => respuestaLenta(2000, () => { cancelada = true; }) }, async (base) => {
    const corte = new AbortController();
    const res = await fetch(base, { headers: cabeceras(), signal: corte.signal });
    assert.equal(res.status, 200);
    corte.abort();
    await res.text().catch(() => "");
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(cancelada, "el cuerpo de la CMF se dejó de leer");
  });
});

test("una falla de red hacia la CMF responde 502 sin la marca y libera el cupo", () =>
  conProxy({ colaMaxima: 1, fetchFn: async () => { throw new TypeError("fetch failed"); } }, async (base) => {
    const original = console.error;
    console.error = () => {};
    try {
      for (let i = 0; i < 2; i++) {
        const res = await fetch(base, { headers: cabeceras() });
        assert.equal(res.status, 502);
        assert.equal(res.headers.get("x-cmf-salida"), null);
        await res.text();
      }
    } finally {
      console.error = original;
    }
  }));

test("una redirección de la CMF pasa sin seguirse", () =>
  conProxy({ fetchFn: async () => new Response(null, { status: 302, headers: { location: "/otra.php" } }) }, async (base) => {
    const res = await fetch(base, { headers: cabeceras(), redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/otra.php");
    assert.equal(res.headers.get("x-cmf-salida"), "1");
  }));
