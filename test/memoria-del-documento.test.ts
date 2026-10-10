/**
 * Un documento se lee una sola vez, y el que no cabe en memoria se rechaza con
 * un error que dice su tamaño.
 *
 * Medido el 10 de octubre de 2026 con herramientas/workerd/memoria.mjs. El
 * cliente leía el cuerpo sobre un clone() para mirar si era el desafío
 * anti-bot, y quien llamaba lo leía otra vez. Un documento de 40 MB ocupaba
 * 174 MB en workerd, y un Worker tiene 128 en total. No había ningún tope, así
 * que un documento grande mataba al Worker sin decir nada.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { createServer } from "../src/server.js";
import { bytesDe, fetchCmf, fetchCmfBinario } from "../src/client/cmf-client.js";

const MB = 1024 * 1024;
const TOPE = 4;
const DESAFIO = '<script>var fwb_dat="QUJD";location="?cookiesession8341=0123456789abcdef0123456789abcdef"</script>';

type Red = (url: string, init: RequestInit) => Response;

async function conRed(red: Red, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => red(String(url), init ?? {})) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** Bytes con todos los valores de 0 a 255, que un paso por texto rompería. */
const documento = (largo: number) => Uint8Array.from({ length: largo }, (_, i) => (i * 7 + (i >> 8)) % 256);

/** Un cuerpo que entrega `bytes` en tramos. Los largos de `tramos` se van repitiendo. */
const porTramos = (bytes: Uint8Array, ...tramos: number[]) => {
  let i = 0;
  let vuelta = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) c.close();
      else c.enqueue(bytes.slice(i, (i += tramos[vuelta++ % tramos.length])));
    },
  });
};

/**
 * Exige que 2 bloques de bytes sean iguales. Sin deepEqual, que con 300.000
 * bytes distintos tarda minutos en armar el mensaje y la prueba parece colgada.
 */
function exigirIguales(recibidos: Uint8Array, esperados: Uint8Array, rotulo: string): void {
  assert.equal(recibidos.length, esperados.length, `${rotulo}. largo`);
  const primero = recibidos.findIndex((b, i) => b !== esperados[i]);
  assert.equal(primero, -1, `${rotulo}. el primer byte distinto está en ${primero}`);
}

/** Responde el desafío anti-bot la primera vez, y `final` cuando ya viene la cookie. */
const conDesafio =
  (final: () => Response): Red =>
  (_url, init) => {
    if (init.method === "POST") return new Response("ok", { headers: { "set-cookie": "cookiesession1=AAAA; Path=/" } });
    return new Headers(init.headers).get("cookie")?.includes("cookiesession1") ? final() : new Response(DESAFIO);
  };

/** Cuenta las veces que alguien duplica una respuesta mientras corre `fn`. */
async function contandoCopias(fn: () => Promise<void>): Promise<number> {
  const original = Response.prototype.clone;
  let copias = 0;
  Response.prototype.clone = function (this: Response) {
    copias++;
    return original.call(this);
  };
  try {
    await fn();
    return copias;
  } finally {
    Response.prototype.clone = original;
  }
}

const env = { CMF_RATE_LIMIT_MS: "0" };

for (const [caso, red] of [
  ["directo", (cuerpo: () => Response): Red => () => cuerpo()],
  ["tras el desafío anti-bot", conDesafio],
] as const) {
  test(`${caso}. el cuerpo llega igual byte por byte, y nadie duplica la respuesta para leerlo`, async () => {
    const bytes = documento(300_000);
    // Sin largo declarado, con el largo justo, y con un largo que no es el
    // real. más corto (como el de un cuerpo comprimido) y más largo. Con
    // 10000 declarados, el primer tramo cabe en el bloque, el segundo no, y el
    // tercero cabría en lo que sobra. tiene que ir detrás del segundo.
    for (const largoDeclarado of [undefined, bytes.length, 1000, 10_000, 400_000]) {
      const rotulo = `largo declarado ${largoDeclarado}`;
      const cabeceras = { "content-type": "application/pdf", ...(largoDeclarado === undefined ? {} : { "content-length": String(largoDeclarado) }) };
      const copias = await contandoCopias(() =>
        conRed(
          red(() => new Response(porTramos(bytes, 7001, 9000, 500), { headers: cabeceras })),
          async () => {
            const res = await fetchCmf("https://www.cmfchile.cl/documento.pdf", {}, env);
            assert.equal(res.headers.get("content-type"), "application/pdf");
            const sinCopia = await bytesDe(res);
            exigirIguales(sinCopia, bytes, rotulo);
            // El bloque es del largo justo, para quien use `bytes.buffer`.
            assert.equal(sinCopia.buffer.byteLength, bytes.length, rotulo);
            // Quien llama a fetchCmf directo puede seguir leyendo la respuesta como siempre.
            exigirIguales(new Uint8Array(await res.arrayBuffer()), bytes, rotulo);
          },
        ),
      );
      assert.equal(copias, 0, `respuestas duplicadas. ${rotulo}`);
    }
  });
}

test("un documento que declara más de 20 MB se rechaza sin bajar un solo byte, con su tamaño en el error", async () => {
  let pedidos = 0;
  let leido = false;
  let soltado = false;
  await conRed(
    () => {
      pedidos++;
      // Sin reserva propia, para que el cuerpo no se pida hasta que alguien lo lea.
      const cuerpo = new ReadableStream<Uint8Array>(
        {
          pull(c) {
            // Un solo tramo y se cierra. Si alguien lo lee, la prueba da rojo en vez de colgarse.
            if (leido) return c.close();
            leido = true;
            c.enqueue(new Uint8Array(1000));
          },
          cancel() {
            soltado = true;
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(cuerpo, { headers: { "content-length": String(30 * MB) } });
    },
    async () => {
      const fin = await fetchCmfBinario("https://www.cmfchile.cl/grande.pdf?token=secreto", env).then(
        () => "lo entregó",
        (e) => `${(e as Error).name}. ${(e as Error).message}`,
      );
      assert.match(fin, /^RespuestaDemasiadoGrande\. .*pesa 30,0 MB.*más de 20,0 MB.*\(https:\/\/www\.cmfchile\.cl\/grande\.pdf\)/);
      assert.ok(!fin.includes("secreto"), fin);
    },
  );
  assert.equal(leido, false, "bajó parte del documento");
  assert.equal(soltado, true, "dejó el cuerpo abierto");
  assert.equal(pedidos, 1, "repetir la consulta trae el mismo documento");
});

test("un documento sin largo declarado se corta al pasar de 20 MB, se suelta, no se reintenta y devuelve su cupo", async () => {
  let pedidos = 0;
  let entregado = 0;
  let soltado = false;
  await conRed(
    (url) => {
      if (!url.includes("/sin-fin")) return new Response("ok");
      pedidos++;
      return new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(c) {
              // 48 MB en total. Si nadie lo corta, termina solo y la prueba da rojo en vez de colgarse.
              if (entregado >= 48 * MB) return c.close();
              entregado += 4 * MB;
              c.enqueue(new Uint8Array(4 * MB));
            },
            cancel() {
              soltado = true;
            },
          },
          // Sin reserva propia. cada tramo sale recién cuando el cliente lo pide.
          { highWaterMark: 0 },
        ),
        // Un largo declarado que miente no salva al documento.
        { headers: { "content-length": "1000" } },
      );
    },
    async () => {
      const lanzar = () =>
        fetchCmf("https://www.cmfchile.cl/sin-fin.pdf", {}, env).then(
          () => "lo entregó",
          (e) => `${(e as Error).name}. ${(e as Error).message}`,
        );
      assert.match(await lanzar(), /^RespuestaDemasiadoGrande\. .*pesa más de 2[0-4],0 MB.*más de 20,0 MB/);
      assert.equal(pedidos, 1, "consultas");
      assert.ok(soltado, "dejó el cuerpo abierto");
      assert.ok(entregado <= 24 * MB, `siguió bajando. ${entregado / MB} MB`);
      // El cupo se devuelve. Con 4 documentos así, una consulta sana encuentra cupo.
      await Promise.all(Array.from({ length: TOPE }, lanzar));
      const sana = await fetchCmf("https://api.sbif.cl/sana", {}, { ...env, CMF_ESPERA_CUPO_MS: "300" });
      assert.equal(await sana.text(), "ok");
    },
  );
});

test("cmf_documento_descargar: un documento que no cabe en memoria es un error de la tool, y dice su tamaño", async () => {
  const server = createServer(env);
  const [ladoServidor, ladoCliente] = InMemoryTransport.createLinkedPair();
  await server.connect(ladoServidor);
  const cliente = new Client({ name: "test", version: "1.0.0" }, {});
  await cliente.connect(ladoCliente);
  await conRed(
    () => new Response("x", { headers: { "content-type": "application/pdf", "content-length": String(30 * MB) } }),
    async () => {
      const r = await cliente.callTool({ name: "cmf_documento_descargar", arguments: { s567: "abcdefghijklmnop" } });
      assert.equal(r.isError, true, JSON.stringify(r.content));
      assert.match((r.content as Array<{ text?: string }>)[0].text ?? "", /pesa 30,0 MB.*más de 20,0 MB/);
    },
  );
});

test("un documento de 20 MB justos pasa", async () => {
  const bytes = new Uint8Array(20 * MB).fill(37);
  await conRed(
    () => new Response(porTramos(bytes, MB), { headers: { "content-length": String(bytes.length) } }),
    async () => {
      const { bytes: recibidos } = await fetchCmfBinario("https://www.cmfchile.cl/justo.pdf", env);
      assert.equal(recibidos.length, bytes.length);
      assert.equal(recibidos[recibidos.length - 1], 37);
    },
  );
});

test("un documento demasiado grande por la salida chilena es un error del documento, y el proxy no se da por caído", async () => {
  const conProxy = {
    ...env,
    CMF_REINTENTO_403_MS: "0",
    CMF_PROXY_URL: "https://salida-grande.example.cl/",
    CMF_PROXY_TOKEN: "token-de-prueba",
  };
  const avisos: string[] = [];
  const avisoOriginal = console.warn;
  console.warn = (linea: unknown) => void avisos.push(String(linea));
  try {
    await conRed(
      (url) =>
        new URL(url).hostname.endsWith(".example.cl")
          ? new Response("x", { headers: { "x-cmf-salida": "1", "content-length": String(60 * MB) } })
          : new Response("<html><title>403 Forbidden</title></html>", { status: 403 }),
      async () => {
        await assert.rejects(fetchCmf("https://www.cmfchile.cl/grande-por-proxy.pdf", {}, conProxy), /pesa 60,0 MB/);
        assert.ok(!avisos.some((a) => a.includes("proxy_fallo")), `anotó un proxy caído. ${avisos.join(" | ")}`);
      },
    );
  } finally {
    console.warn = avisoOriginal;
  }
});
