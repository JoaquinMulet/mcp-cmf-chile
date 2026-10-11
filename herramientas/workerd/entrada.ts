// Worker de prueba del limitador. Usa el cliente del servidor tal cual
// (src/client/cmf-client.ts) y el ejecutor de la caja aislada (src/sandbox.ts).
//
// Corre de 2 formas, con el mismo código.
// - En local, dentro de miniflare. Toda salida del Worker la atiende la
//   función outboundService del arnés, que cuenta desde afuera.
// - Desplegado como sonda, con la variable RED_INTERNA. Ahí la red es una
//   función de este mismo archivo, y ninguna consulta sale del Worker.
import { fetchCmf } from "../../src/client/cmf-client.ts";
import { ejecutorDeWorker } from "../../src/sandbox.ts";
import { peticionEnCurso } from "../../src/client/peticion.ts";

type Env = Record<string, unknown> & { CAJA?: unknown; RED_INTERNA?: string; YO?: { fetch: typeof fetch } };
type Ctx = { waitUntil(p: Promise<unknown>): void };

const bitacora: string[] = [];
const avisos: string[] = [];
const red = { enVuelo: 0, maximo: 0, total: 0 };
let aislado = "";
let nacio = 0;
let redInstalada = false;

const anotar = (texto: string) => {
  bitacora.push(`${Date.now()} ${texto}`);
  if (bitacora.length > 4000) bitacora.splice(0, 1000);
};

console.warn = (linea: unknown) => {
  avisos.push(`${Date.now()} ${String(linea)}`);
};

/** La red interna de la sonda. `?ms=N` tarda N en responder. Nada sale del Worker. */
const redInterna = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const u = new URL(entrada instanceof Request ? entrada.url : String(entrada));
  const ms = Number(u.searchParams.get("ms") ?? "0");
  red.total++;
  red.enVuelo++;
  red.maximo = Math.max(red.maximo, red.enVuelo);
  anotar(`red entra ${u.pathname} (en vuelo ${red.enVuelo})`);
  await new Promise<void>((listo, cortar) => {
    const t = setTimeout(listo, ms);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(t);
      red.enVuelo--;
      anotar(`red cortada ${u.pathname}`);
      cortar(new DOMException("This operation was aborted", "AbortError"));
    });
  });
  red.enVuelo--;
  anotar(`red sale ${u.pathname}`);
  return new Response(`cuerpo de ${u.pathname}`);
}) as typeof fetch;

/**
 * Gasta CPU `iter` vueltas. En 2 bucles, para que el contador no pase de un
 * millón. un contador sobre mil millones deja de ser un entero chico para el
 * motor, y cada vuelta cuesta 3 veces más (medido en Cloudflare el 10 de
 * octubre de 2026).
 */
function quemar(iter: number): number {
  let x = 0;
  for (let bloque = Math.ceil(iter / 1e6); bloque > 0; bloque--) {
    for (let i = 0; i < 1e6; i++) x += Math.sqrt(i % 1000);
  }
  return x;
}

/** Detiene el hilo `ms` según el reloj. Solo sirve donde el reloj avanza durante la CPU. */
function detener(ms: number): number {
  const hasta = Date.now() + ms;
  let x = 0;
  while (Date.now() < hasta) x += Math.sqrt(x + 1);
  return x;
}

function envDe(q: URLSearchParams): Record<string, string> {
  return {
    CMF_RATE_LIMIT_MS: q.get("ritmo") ?? "0",
    CMF_ESPERA_CUPO_MS: q.get("cupo") ?? "60000",
    CMF_UPSTREAM_TIMEOUT_MS: q.get("timeout") ?? "60000",
    // Sin `gracia` vale la de fábrica, que es de 45 segundos.
    ...(q.has("gracia") ? { CMF_GRACIA_CUPO_MS: q.get("gracia") as string } : {}),
  };
}

async function consultar(nombre: string, q: URLSearchParams): Promise<string> {
  const paso = new URLSearchParams();
  for (const k of ["ms", "gotas", "cada"]) if (q.has(k)) paso.set(k, q.get(k) as string);
  const host = q.get("host") ?? "api.sbif.cl";
  anotar(`consulta entra ${nombre}`);
  try {
    const res = await fetchCmf(`https://${host}/${nombre}?${paso}`, {}, envDe(q));
    const texto = await res.text();
    anotar(`consulta sale ${nombre}`);
    return texto;
  } catch (e) {
    anotar(`consulta falla ${nombre}. ${(e as Error).message.slice(0, 90)}`);
    throw e;
  }
}

const estado = () => ({ aislado, edad_ms: Date.now() - nacio, red: { ...red } });

const atencion = {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (!aislado) {
      aislado = crypto.randomUUID().slice(0, 8);
      nacio = Date.now();
    }
    if (env.RED_INTERNA && !redInstalada) {
      globalThis.fetch = redInterna;
      redInstalada = true;
    }
    // Desplegado, sin la red interna no se atiende nada. Así ninguna consulta
    // puede salir de la sonda hacia un host de verdad.
    if (env.RED_INTERNA && globalThis.fetch !== redInterna) return new Response("la red interna no quedó instalada", { status: 500 });
    const u = new URL(req.url);
    const q = u.searchParams;
    const [ruta, nombre = "sin-nombre"] = u.pathname.split("/").filter(Boolean);
    const inicio = Date.now();
    const responder = (datos: Record<string, unknown>, status = 200) =>
      new Response(JSON.stringify({ ruta, nombre, ...datos, ms: Date.now() - inicio, ...estado() }), { status, headers: { "content-type": "application/json" } });
    try {
      if (ruta === "id") return responder({});
      if (ruta === "c") return responder({ ok: await consultar(nombre, q) });
      if (ruta === "multi") {
        const k = Number(q.get("k") ?? "4");
        const r = await Promise.allSettled(Array.from({ length: k }, (_, i) => consultar(`${nombre}-${i}`, q)));
        const errores = r.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason?.message).slice(0, 80));
        return responder({ ok: r.length - errores.length, errores: errores.length, clases: [...new Set(errores)] });
      }
      // k consultas lanzadas sin esperar, y la petición termina. Con ?sin_wu=1 mueren todas.
      if (ruta === "suelta") {
        const k = Number(q.get("k") ?? "1");
        for (let i = 0; i < k; i++) void consultar(k === 1 ? nombre : `${nombre}-${i}`, q).catch(() => {});
        return responder({ soltadas: k });
      }
      // Detiene el hilo por cantidad de vueltas, que sirve aunque el reloj no avance.
      // Además entrega lo que ve del reloj un temporizador de 100 ms que nació
      // antes de la detención, que es lo que ven los temporizadores del limitador.
      if (ruta === "cpu") {
        const p0 = performance.now();
        const huecos: number[] = [];
        let ultimo = Date.now();
        const t = setInterval(() => {
          const ahora = Date.now();
          huecos.push(ahora - ultimo);
          ultimo = ahora;
        }, 100);
        await new Promise((r) => setTimeout(r, 250));
        const antes = Date.now() - inicio;
        quemar(Number(q.get("iter") ?? "1e8"));
        const dentro = Date.now() - inicio - antes;
        const perf = Math.round(performance.now() - p0);
        const tras: Record<string, number> = {};
        for (const ms of [0, 20, 300]) {
          await new Promise((r) => setTimeout(r, ms));
          tras[`temporizador_de_${ms}`] = Date.now() - inicio - antes;
        }
        clearInterval(t);
        return responder({ reloj_dentro_ms: dentro, performance_ms: perf, reloj_tras: tras, huecos_del_intervalo_de_100: huecos });
      }
      // Detenciones seguidas del hilo según el reloj. p=6000,1400 con una pausa entre cada una.
      if (ruta === "patron") {
        const reales: number[] = [];
        for (const ms of (q.get("p") ?? "3000").split(",").map(Number)) {
          const a = Date.now();
          detener(ms);
          reales.push(Date.now() - a);
          await new Promise((r) => setTimeout(r, Number(q.get("pausa") ?? "1")));
        }
        return responder({ reales });
      }
      // Detiene el hilo según el reloj, lanza k consultas en ese mismo turno, y sigue ocupado `resto` ms.
      if (ruta === "nace") {
        detener(Number(q.get("larga") ?? "6000"));
        const k = Number(q.get("k") ?? "1");
        const nuevas = Array.from({ length: k }, (_, i) => consultar(`${nombre}-${i}`, q).catch((e) => `error. ${(e as Error).message.slice(0, 60)}`));
        detener(Number(q.get("resto") ?? "120"));
        return responder({ ok: await Promise.all(nuevas) });
      }
      // Detiene el hilo y, en el mismo turno, lanza una consulta. Lo que el
      // limitador ve del reloj en ese momento viaja en la respuesta.
      if (ruta === "cpu-y-consulta") {
        quemar(Number(q.get("iter") ?? "1e8"));
        const relojAlNacer = Date.now() - inicio;
        const texto = await consultar(nombre, q).catch((e) => `error. ${(e as Error).message.slice(0, 90)}`);
        return responder({ reloj_al_nacer_la_consulta_ms: relojAlNacer, ok: texto });
      }
      // UN solo temporizador pendiente a la vez, como el sondeo de quien hace
      // cola (forma=cadena) o el latido de un cupo (forma=intervalo). Entrega
      // los huecos que vio entre corridas, para saber si ve una detención ajena.
      if (ruta === "un-temporizador") {
        const n = Number(q.get("n") ?? "20");
        const paso = Number(q.get("paso") ?? "50");
        const huecos: number[] = [];
        let ultimo = Date.now();
        const anotarHueco = () => {
          const ahora = Date.now();
          huecos.push(ahora - ultimo);
          ultimo = ahora;
        };
        if (q.get("forma") === "intervalo") {
          await new Promise<void>((listo) => {
            const t = setInterval(() => {
              anotarHueco();
              if (huecos.length < n) return;
              clearInterval(t);
              listo();
            }, paso);
          });
        } else {
          while (huecos.length < n) {
            await new Promise((r) => setTimeout(r, paso));
            anotarHueco();
          }
        }
        return responder({ corridas: huecos.length, hueco_maximo_ms: Math.max(0, ...huecos), huecos_largos: huecos.filter((h) => h > paso * 2) });
      }
      // `n` cadenas de temporizadores de `paso` ms en UNA petición, durante `ms`
      // de su reloj, y un intervalo de 1000 ms al lado. Dice cuántas corridas
      // hubo. Sirve para saber cuántos temporizadores por segundo despacha el
      // motor a una sola petición.
      if (ruta === "cadenas") {
        const n = Number(q.get("n") ?? "100");
        const paso = Number(q.get("paso") ?? "50");
        const dura = Number(q.get("ms") ?? "4000");
        let corridas = 0;
        const latidos: number[] = [];
        let ultimo = Date.now();
        const t = setInterval(() => {
          const ahora = Date.now();
          latidos.push(ahora - ultimo);
          ultimo = ahora;
        }, 1000);
        await Promise.all(
          Array.from({ length: n }, async () => {
            while (Date.now() - inicio < dura) {
              await new Promise((r) => setTimeout(r, paso));
              corridas++;
            }
          }),
        );
        clearInterval(t);
        return responder({ corridas, ideal: Math.round((n * dura) / paso), latidos_de_1000: latidos });
      }
      // El reloj de verdad. En Cloudflare Date.now() solo se pone al día con
      // una entrada o salida real, y un temporizador no lo es. Acá cada vuelta
      // hace una lectura del caché local, que sí lo es, y anota los huecos.
      // Así se ve una detención que los temporizadores no ven.
      if (ruta === "reloj-real") {
        const dura = Number(q.get("ms") ?? "12000");
        const cache = (caches as unknown as { default: { match(u: string): Promise<unknown> } }).default;
        const huecos: number[] = [];
        let vueltas = 0;
        let ultimo = Date.now();
        while (ultimo - inicio < dura && vueltas < 600) {
          await new Promise((r) => setTimeout(r, 50));
          await cache.match("https://sonda.invalid/reloj");
          const ahora = Date.now();
          huecos.push(ahora - ultimo);
          ultimo = ahora;
          vueltas++;
        }
        return responder({ vueltas, hueco_maximo_ms: Math.max(0, ...huecos), huecos_sobre_300: huecos.filter((h) => h > 300) });
      }
      // Un temporizador cada 100 ms durante `ms`. Entrega los huecos entre corridas.
      if (ruta === "latidos") {
        const dura = Number(q.get("ms") ?? "5000");
        const huecos: number[] = [];
        let ultimo = Date.now();
        const t = setInterval(() => {
          const ahora = Date.now();
          huecos.push(ahora - ultimo);
          ultimo = ahora;
        }, 100);
        await new Promise((r) => setTimeout(r, dura));
        clearInterval(t);
        return responder({ corridas: huecos.length, hueco_maximo_ms: Math.max(0, ...huecos), huecos_sobre_300: huecos.filter((h) => h > 300) });
      }
      // Un programa en la caja aislada, como los de /codigo, que solo gasta CPU.
      if (ruta === "codigo") {
        if (!env.CAJA) return responder({ error: "sin binding CAJA" }, 501);
        // En 2 bucles, por la misma razón que quemar().
        const bloques = Math.ceil(Number(q.get("iter") ?? "1e8") / 1e6);
        const programa = `let x = 0; for (let b = ${bloques}; b > 0; b--) for (let i = 0; i < 1e6; i++) x += Math.sqrt(i % 1000); return x;`;
        const ejecutor = ejecutorDeWorker(env.CAJA as never, "2026-07-28", () => null);
        const r = await ejecutor.correr(programa, { catalogo: [], cmf: {} });
        return responder({ caja: JSON.stringify(r).slice(0, 300) });
      }
      // Varias peticiones a este mismo Worker, cada una a su hora, por el
      // binding YO. Cloudflare reparte las peticiones de afuera entre varios
      // aislados, y las que entran por un binding caen en el de quien llama.
      // `cortar` corta la petición a esos ms, como un cliente que se va.
      if (ruta === "yo") {
        const yo = env.YO;
        if (!yo) return responder({ error: "sin binding YO" }, 501);
        const pasos = JSON.parse(q.get("pasos") ?? "[]") as { a: number; ruta: string; cortar?: number }[];
        const hechos = await Promise.all(
          pasos.map(async (p) => {
            await new Promise((r) => setTimeout(r, p.a));
            const ctrl = new AbortController();
            if (p.cortar) setTimeout(() => ctrl.abort(), p.cortar);
            try {
              const res = await yo.fetch(`https://yo.invalid${p.ruta}`, { signal: ctrl.signal });
              const datos = (await res.json()) as Record<string, unknown>;
              // La respuesta de otra petición es una entrada real, así que acá el reloj dice la hora de verdad.
              return { paso: p.ruta.split("?")[0], status: res.status, ...datos, llego_a_los_ms: Date.now() - inicio };
            } catch (e) {
              return { paso: p.ruta.split("?")[0], cortada: (e as Error).name };
            }
          }),
        );
        return responder({ pasos: hechos });
      }
      if (ruta === "avisos") {
        const clases = ["cmf_hilo_detenido", "cmf_cupo_recuperado", "cola_llena", "cmf_cupo"];
        const cuenta = Object.fromEntries(clases.map((c) => [c, avisos.filter((a) => a.includes(`"${c}"`)).length]));
        const datos = { cuenta, avisos: q.has("todo") ? avisos.slice(-400) : avisos.slice(-12), bitacora: q.has("bitacora") ? bitacora.slice(-Number(q.get("bitacora") || "60")) : undefined };
        if (q.has("borrar")) {
          avisos.length = 0;
          bitacora.length = 0;
          red.maximo = red.enVuelo;
          red.total = 0;
        }
        return responder(datos);
      }
      return responder({ error: "ruta desconocida" }, 404);
    } catch (e) {
      return responder({ error: `${(e as Error).name}. ${(e as Error).message}` }, 500);
    }
  },
};

export default {
  // Como src/worker.ts. cada petición deja su waitUntil al alcance del cliente,
  // y lo que deja pendiente al responder sigue hasta terminar. Con ?sin_wu=1 no
  // lo deja, y lo pendiente muere con la petición. así fabrican los escenarios
  // sus consultas muertas.
  fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (new URL(req.url).searchParams.get("sin_wu") === "1") return atencion.fetch(req, env, ctx);
    return peticionEnCurso.run({ esperarHasta: (p) => ctx.waitUntil(p) }, () => atencion.fetch(req, env, ctx));
  },
};
