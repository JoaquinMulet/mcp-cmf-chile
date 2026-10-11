// Arnés de workerd. Empaqueta un Worker de prueba con el cliente del servidor,
// lo levanta en miniflare y atiende TODA la salida del Worker con una función
// local, que además cuenta desde afuera cuántas consultas hay en vuelo.
// Ninguna consulta sale a internet.
//
// miniflare y esbuild llegan por wrangler, que es la dependencia declarada.
import { createRequire } from "node:module";
import http from "node:http";
import { fileURLToPath } from "node:url";

const deWrangler = createRequire(createRequire(import.meta.url).resolve("wrangler/package.json"));
const { Miniflare, Response, convertV4MiniflareOptions } = deWrangler("miniflare");
const esbuild = deWrangler("esbuild");

export const AQUI = fileURLToPath(new URL(".", import.meta.url));
const t0 = Date.now();
const reloj = () => `${String(Date.now() - t0).padStart(6)} ms`;
export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
export const decir = (texto) => console.log(`${reloj()}  ${texto}`);

/** El Worker empaquetado, como texto. `entrada` es un archivo de esta carpeta. */
export async function empaquetar(entrada) {
  const paquete = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(entrada, import.meta.url))],
    bundle: true,
    format: "esm",
    write: false,
    logLevel: "silent",
    // Los módulos del propio motor, que workerd entrega con nodejs_compat.
    external: ["cloudflare:workers", "node:async_hooks"],
  });
  return paquete.outputFiles[0].text;
}

/**
 * Levanta el Worker de entrada.ts. La salida simulada responde así.
 * `?ms=N` tarda N. `?gotas=G&cada=C` manda G tramos, uno cada C ms.
 * `?mb=M` manda un documento de M megabytes.
 */
export async function levantar({ entrada = "./entrada.ts", atender, variables = {} } = {}) {
  const red = { enVuelo: 0, maximo: 0, total: 0, cortadas: 0, llegadas: [] };
  const porDefecto = async (request) => {
    const u = new URL(request.url);
    const ms = Number(u.searchParams.get("ms") ?? "0");
    const gotas = Number(u.searchParams.get("gotas") ?? "0");
    const cada = Number(u.searchParams.get("cada") ?? "0");
    // Una consulta que el escenario abandona a propósito se llama «muerta». Su
    // petición no termina nunca desde afuera, así que no cuenta como en vuelo.
    const muerta = u.pathname.includes("muerta");
    red.total++;
    if (!muerta) red.enVuelo++;
    red.maximo = Math.max(red.maximo, red.enVuelo);
    red.llegadas.push(`${reloj()} ${u.hostname}${u.pathname} (en vuelo ${red.enVuelo})`);
    let cerrada = muerta;
    const cerrar = () => {
      if (cerrada) return;
      cerrada = true;
      red.enVuelo--;
    };
    request.signal?.addEventListener("abort", () => {
      red.cortadas++;
      cerrar();
    });
    if (ms > 0) await dormir(ms);
    if (gotas > 0) {
      let i = 0;
      const cuerpo = new ReadableStream({
        async pull(c) {
          if (i >= gotas) {
            c.close();
            cerrar();
            return;
          }
          await dormir(cada);
          c.enqueue(new TextEncoder().encode(`gota${i++} `));
        },
        cancel: cerrar,
      });
      return new Response(cuerpo);
    }
    cerrar();
    return new Response(`cuerpo de ${u.pathname}`);
  };
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      name: "prueba",
      modules: true,
      script: await empaquetar(entrada),
      compatibilityDate: "2026-07-28",
      compatibilityFlags: ["nodejs_compat"],
      workerLoaders: { CAJA: {} },
      bindings: variables,
      serviceBindings: { YO: "prueba" },
      // TODA consulta que sale del Worker cae acá. Nunca se reenvía a la red.
      outboundService: (request) => (atender ? atender(request, Response) : porDefecto(request)),
    }),
  );
  const base = await mf.ready;

  /** Una petición al Worker, con conexión propia, que se puede cortar. */
  function pedir(ruta) {
    let req;
    const fin = new Promise((resolver) => {
      req = http.request(new URL(ruta, base), { agent: false }, (res) => {
        let cuerpo = "";
        res.on("data", (d) => (cuerpo += d));
        res.on("end", () => resolver(leer(res.statusCode, cuerpo)));
        res.on("error", (e) => resolver({ cortada: e.message }));
      });
      req.on("error", (e) => resolver({ cortada: e.message }));
      req.end();
    });
    return { fin, cortar: () => req.destroy() };
  }
  const pedirYa = (ruta) => pedir(ruta).fin;
  return { mf, red, pedir, pedirYa, pid: process.pid };
}

function leer(status, cuerpo) {
  try {
    return { status, ...JSON.parse(cuerpo) };
  } catch {
    return { status, texto: cuerpo.slice(0, 300) };
  }
}
