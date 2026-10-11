// Sonda de producción. Despliega el Worker de prueba como un Worker APARTE
// (sonda-limitador-cmf, sin rutas ni dominio), mide en Cloudflare de verdad lo
// que workerd local no reproduce, y lo borra.
//
// La sonda no consulta a la CMF. su red es una función del propio Worker
// (variable RED_INTERNA de sonda.wrangler.jsonc).
//
// Uso.
//   node herramientas/workerd/sonda-produccion.mjs desplegar
//   node herramientas/workerd/sonda-produccion.mjs medir <url> [experimento ...]
//   node herramientas/workerd/sonda-produccion.mjs borrar
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import http from "node:http";
import https from "node:https";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const CONFIG = `${AQUI}sonda.wrangler.jsonc`;
// El paquete no exporta su ejecutable, así que se ubica al lado de su package.json.
const WRANGLER = fileURLToPath(new URL("bin/wrangler.js", pathToFileURL(createRequire(import.meta.url).resolve("wrangler/package.json"))));
const [orden = "", url = "", ...pedidos] = process.argv.slice(2);

function wrangler(config, ...args) {
  console.error(`[sonda] wrangler ${args.join(" ")}. Puede tardar hasta 1 minuto.`);
  return spawnSync(process.execPath, [WRANGLER, ...args, "--config", config], { stdio: "inherit" }).status ?? 1;
}
if (orden === "desplegar") {
  // En 2 pasos. La sonda se llama a sí misma por un binding, y ese binding
  // no se puede declarar hasta que el Worker exista.
  const completa = readFileSync(CONFIG, "utf8");
  const sinComentarios = completa
    .split(/\r?\n/)
    .filter((linea) => !linea.trim().startsWith("//"))
    .join(" ");
  const { services: _services, ...sinYo } = JSON.parse(sinComentarios);
  const temporal = `${AQUI}.sonda-sin-yo.wrangler.json`;
  writeFileSync(temporal, JSON.stringify(sinYo));
  const primero = wrangler(temporal, "deploy");
  rmSync(temporal);
  process.exit(primero || wrangler(CONFIG, "deploy"));
}
if (orden === "borrar") process.exit(wrangler(CONFIG, "delete", "--force"));
if (orden !== "medir" || !url) {
  console.error("Uso. sonda-produccion.mjs desplegar | medir <url> [experimento ...] | borrar");
  process.exit(2);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const decir = (texto) => console.log(`${String(Date.now() - t0).padStart(6)} ms  ${texto}`);

/** Una petición a la sonda, con conexión propia, que se puede cortar. */
function pedir(ruta) {
  let req;
  const inicio = Date.now();
  const fin = new Promise((resolver) => {
    // Con http sirve para ensayar la sonda en local, con wrangler dev.
    req = (url.startsWith("http:") ? http : https).request(new URL(ruta, url), { agent: false }, (res) => {
      let cuerpo = "";
      res.on("data", (d) => (cuerpo += d));
      res.on("end", () => {
        try {
          resolver({ status: res.statusCode, pared_ms: Date.now() - inicio, ...JSON.parse(cuerpo) });
        } catch {
          resolver({ status: res.statusCode, pared_ms: Date.now() - inicio, texto: cuerpo.slice(0, 200) });
        }
      });
      res.on("error", (e) => resolver({ cortada: e.message }));
    });
    req.on("error", (e) => resolver({ cortada: e.message }));
    req.end();
  });
  return { fin, cortar: () => req.destroy() };
}
const pedirYa = (ruta) => pedir(ruta).fin;

/**
 * Corre varias peticiones dentro de UN aislado. Cloudflare reparte las
 * peticiones de afuera entre varios aislados (9 juntas cayeron en 3, medido
 * el 10 de octubre de 2026), y el limitador es uno por aislado. Las que la
 * sonda se hace a sí misma por su binding caen en el aislado de quien llama.
 * Entrega los resultados por nombre de paso, y dice si de verdad fue uno solo.
 */
async function enUnAislado(pasos) {
  const r = await pedirYa(`/yo?pasos=${encodeURIComponent(JSON.stringify(pasos))}`);
  if (!r.pasos) throw new Error(`la sonda no corrió los pasos. ${JSON.stringify(r).slice(0, 300)}`);
  const ids = [...new Set([r.aislado, ...r.pasos.map((p) => p.aislado)].filter(Boolean))];
  const por = (nombre) => r.pasos.filter((p) => p.paso === nombre);
  return { por, todos: r.pasos, ids, unSolo: ids.length === 1, pared_ms: r.pared_ms };
}
const aislados = (e) => (e.unSolo ? `un solo aislado (${e.ids[0]})` : `OJO. ${e.ids.length} aislados (${e.ids.join(", ")}), el experimento no vale`);

let porMs = 0;
/** Cuántas vueltas del bucle gastan `ms` de CPU en esta máquina de Cloudflare. */
async function vueltasPara(ms) {
  if (!porMs) {
    const r = await pedirYa("/cpu?iter=300000000");
    // Con el reloj de afuera. El de adentro no avanza durante la CPU en Cloudflare.
    porMs = 300000000 / Math.max(1, r.pared_ms - 570);
    decir(`calibrado. ${Math.round(porMs)} vueltas por ms (300 millones tardaron ${r.pared_ms} ms de pared, con 570 de esperas propias)`);
  }
  return Math.round(porMs * ms);
}

const VIVA = "cupo=60000&timeout=60000";

const EXPERIMENTOS = {
  // (a) ¿Avanza Date.now() mientras el Worker gasta CPU?
  async reloj() {
    for (const ms of [1000, 6000]) {
      const r = await pedirYa(`/cpu?iter=${await vueltasPara(ms)}`);
      decir(`CPU pedida ${ms} ms. pared ${r.pared_ms} ms. Date.now() dentro del bucle avanzó ${r.reloj_dentro_ms} ms y performance.now() ${r.performance_ms} ms. Después, Date.now() llevaba ${JSON.stringify(r.reloj_tras)}. Huecos que vio un temporizador de 100 ms nacido antes. ${JSON.stringify(r.huecos_del_intervalo_de_100)}`);
    }
  },

  // (a) ¿La CPU de una petición atrasa los temporizadores de otra petición del mismo aislado?
  async "latidos-con-cpu-ajena"() {
    const e = await enUnAislado([
      { a: 0, ruta: "/latidos?ms=12000" },
      { a: 2000, ruta: `/cpu?iter=${await vueltasPara(6000)}` },
    ]);
    const [l] = e.por("/latidos");
    decir(`temporizador de 100 ms durante 12 s de su reloj, con 6 s de CPU en OTRA petición. pared ${e.pared_ms} ms. corridas ${l.corridas}, hueco máximo ${l.hueco_maximo_ms} ms, huecos sobre 300 ms ${JSON.stringify(l.huecos_sobre_300)}. ${aislados(e)}`);
  },

  // (a) Lo mismo con UN solo temporizador pendiente por petición, que es la
  // forma de los temporizadores del limitador. Date.now() nunca pasa de la
  // hora del próximo temporizador pendiente, así que con 2 pendientes el
  // atraso se esconde solo. Con uno, se ve lo que de verdad dice el reloj.
  async "un-temporizador-con-cpu-ajena"() {
    const e = await enUnAislado([
      { a: 0, ruta: "/un-temporizador?forma=cadena&paso=50&n=180" },
      { a: 0, ruta: "/un-temporizador?forma=intervalo&paso=1000&n=12" },
      { a: 2000, ruta: `/cpu?iter=${await vueltasPara(6000)}` },
    ]);
    const [cadena, intervalo] = e.por("/un-temporizador");
    const [cpu] = e.por("/cpu");
    decir(`con 6 s de CPU en OTRA petición. cadena de temporizadores de 50 ms. hueco máximo ${cadena.hueco_maximo_ms} ms, huecos largos ${JSON.stringify(cadena.huecos_largos)}. intervalo de 1000 ms. hueco máximo ${intervalo.hueco_maximo_ms} ms, huecos largos ${JSON.stringify(intervalo.huecos_largos)}. ${aislados(e)}`);
    // Los 2 temporizadores piden 9 y 12 segundos. Si terminan a esa hora de
    // verdad, los atrasados se pusieron al día. Si terminan esa hora más lo
    // que duró la CPU, cada petición quedó con su reloj atrasado.
    decir(`hora de verdad en que terminó cada una. la CPU, que partió a los 2000, a los ${cpu.llego_a_los_ms} ms. la cadena de 9000 ms a los ${cadena.llego_a_los_ms}. el intervalo de 12000 ms a los ${intervalo.llego_a_los_ms}`);
  },

  // ¿Cuántos temporizadores por segundo despacha Cloudflare a UNA petición? En
  // workerd local sobre Windows son unos 70, y una petición con cientos de
  // temporizadores atrasa los suyos propios (séptima revisión adversarial).
  async "ritmo-de-temporizadores"() {
    for (const n of [10, 100, 400, 1000]) {
      const e = await enUnAislado([{ a: 0, ruta: `/cadenas?n=${n}&paso=50&ms=4000` }]);
      const [c] = e.por("/cadenas");
      decir(`${n} cadenas de 50 ms durante 4000 ms de su reloj. corridas ${c.corridas} (ideal ${c.ideal}). terminó a los ${c.llego_a_los_ms} ms de reloj real. latidos de 1000 ms vistos cada ${JSON.stringify(c.latidos_de_1000)}`);
    }
  },

  // (a) Qué ve el limitador. 4 consultas vivas, 2 en cola, 6 s de CPU en otra petición, y 3 llegadas después.
  async "limitador-con-detencion"(forma = "sueltas") {
    // «sueltas». 4 peticiones con 1 consulta cada una. «de-10». UNA petición con
    // 10 consultas, 4 con cupo y 6 en la cola, que deja muchos temporizadores atrasados.
    const vivas =
      forma === "sueltas"
        ? [0, 1, 2, 3].map((i) => ({ a: 100, ruta: `/c/viva${i}?ms=18000&${VIVA}` }))
        : [{ a: 100, ruta: `/multi/viva0?k=10&ms=6000&${VIVA}` }];
    const e = await enUnAislado([
      { a: 0, ruta: "/avisos?borrar=1" },
      ...vivas,
      ...[0, 1].map((i) => ({ a: 600, ruta: `/c/cola${i}?ms=4000&${VIVA}` })),
      { a: 2600, ruta: `/cpu?iter=${await vueltasPara(6000)}` },
      ...[0, 1, 2].map((i) => ({ a: 2700, ruta: `/c/despues${i}?ms=4000&${VIVA}&host=datosbanco.cmfchile.cl` })),
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ a: 13500 + i * 50, ruta: `/avisos?todo=1&medio=${i}` })),
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ a: 30000 + i * 50, ruta: `/avisos?todo=1&fin=${i}` })),
    ]);
    // Cloudflare puede mandar parte de las peticiones a otro aislado. Vale lo
    // que pasó en el aislado donde quedaron las 4 vivas.
    const principal = e.todos.find((p) => p.paso.endsWith("/viva0")).aislado;
    const otros = e.todos.filter((p) => p.aislado !== principal).map((p) => `${p.paso}→${p.aislado}`);
    const suyos = e.por("/avisos").filter((a) => a.aislado === principal && a.cuenta);
    const vale = e.por("/cpu")[0].aislado === principal && suyos.length > 1;
    decir(`${forma}. ${vale ? "la CPU cayó en el aislado de las vivas. el experimento vale" : "OJO. la CPU o los avisos cayeron en otro aislado. el experimento no vale"}. ${otros.length ? `en otro aislado. ${otros.join(" ")}` : "todas las peticiones en un aislado"}`);
    const [medio, fin] = [suyos[1], suyos.at(-1)];
    if (!vale) return;
    decir(`4,9 s después de 6 s de CPU. ${JSON.stringify(medio.cuenta)}. máximo en vuelo ${medio.red.maximo}, en vuelo ${medio.red.enVuelo}. al final. ${JSON.stringify(fin.cuenta)}. máximo en vuelo ${fin.red.maximo} (tope 4)`);
    for (const linea of fin.avisos.slice(0, 4)) decir(`   ${linea}`);
    decir(`estados de las consultas. ${e.todos.filter((p) => /^\/(c|multi)\//.test(p.paso)).map((r) => `${r.status}${r.ok !== undefined && typeof r.ok === "number" ? `(ok ${r.ok})` : ""}`).join(",")}`);
  },
  "limitador-con-detencion-de-10"() {
    return EXPERIMENTOS["limitador-con-detencion"]("de-10");
  },

  // (a) Una consulta que nace en el mismo turno en que termina la CPU, con los 4 cupos ocupados.
  async "nace-tras-la-cpu"() {
    for (const ms of [900, 6000]) {
      const e = await enUnAislado([
        { a: 0, ruta: "/avisos?borrar=1" },
        ...[0, 1, 2, 3].map((i) => ({ a: 100, ruta: `/c/viva${i}?ms=14000&${VIVA}` })),
        { a: 2600, ruta: `/cpu-y-consulta/nueva?iter=${await vueltasPara(ms)}&ms=200&${VIVA}&host=tasas.cmfchile.cl` },
        { a: 2600 + ms + 4500, ruta: "/avisos?todo=1" },
        { a: 24000, ruta: "/avisos?todo=1&fin=1" },
      ]);
      const [medio, fin] = e.por("/avisos").slice(1);
      const [nace] = e.por("/cpu-y-consulta/nueva");
      decir(`CPU de ${ms} ms y una consulta que nace en ese turno. su reloj al nacer decía ${nace.reloj_al_nacer_la_consulta_ms} ms. estado ${nace.status}. a los 4,5 s ${JSON.stringify(medio.cuenta)}, máximo en vuelo ${medio.red.maximo}. al final ${JSON.stringify(fin.cuenta)}, máximo ${fin.red.maximo}. ${aislados(e)}`);
      for (const linea of fin.avisos.slice(0, 4)) decir(`   ${linea}`);
    }
  },

  // (b) Quien pidió corta la petición con el cupo tomado. Acá corta otra petición del mismo aislado.
  async "corte-con-cupo"() {
    const e = await enUnAislado([
      { a: 0, ruta: "/avisos?borrar=1" },
      { a: 100, ruta: `/c/cortada?ms=20000&${VIVA}`, cortar: 1500 },
      { a: 4000, ruta: "/avisos?bitacora=8" },
      { a: 12000, ruta: "/avisos?bitacora=8&b=1" },
      { a: 23000, ruta: "/avisos?bitacora=8&c=1" },
      { a: 24000, ruta: `/multi/barre?k=8&ms=1500&${VIVA}` },
      { a: 29000, ruta: "/avisos?todo=1&bitacora=60&d=1" },
    ]);
    const [, a4, a12, a23, fin] = e.por("/avisos");
    const sin = (b) => b.map((l) => l.replace(/^[0-9]+ /, "")).join(" | ");
    decir(`la petición se cortó a los 1500 ms. ${JSON.stringify(e.por("/c/cortada")[0])}. ${aislados(e)}`);
    decir(`a los 4 s. en vuelo en la red ${a4.red.enVuelo}. bitácora. ${sin(a4.bitacora)}`);
    decir(`a los 12 s. en vuelo ${a12.red.enVuelo}. a los 23 s. en vuelo ${a23.red.enVuelo}. bitácora. ${sin(a23.bitacora)}`);
    const termino = fin.bitacora.some((l) => l.includes("consulta sale cortada"));
    decir(`tras una petición de 3 s que puede barrer. ${JSON.stringify(fin.cuenta)}. la consulta cortada ${termino ? "TERMINÓ sola a los 20 s y devolvió su cupo" : "no terminó nunca"}`);
    for (const linea of fin.avisos.slice(0, 3)) decir(`   ${linea}`);
  },

  // (b) El corte de verdad. el cliente de afuera cierra su conexión. No se puede
  // elegir el aislado, así que después se pregunta varias veces hasta dar con él.
  async "corte-desde-afuera"() {
    const marca = `afuera${Date.now() % 100000}`;
    const cortada = pedir(`/c/${marca}?ms=20000&${VIVA}`);
    await dormir(1500);
    cortada.cortar();
    decir(`el cliente cortó a los 1500 ms. ${JSON.stringify(await cortada.fin)}`);
    for (const espera of [3000, 22000]) {
      await dormir(espera);
      const vistos = new Map();
      for (let i = 0; i < 24 && ![...vistos.values()].some(Boolean); i++) {
        const av = await pedirYa("/avisos?bitacora=200");
        const suyas = (av.bitacora ?? []).filter((l) => l.includes(marca)).map((l) => l.replace(/^[0-9]+ /, ""));
        vistos.set(av.aislado, suyas.length ? `en vuelo en la red ${av.red.enVuelo}. ${suyas.join(" | ")}` : "");
      }
      const hallado = [...vistos.entries()].find(([, v]) => v);
      decir(`${Math.round((Date.now() - t0) / 1000)} s. ${hallado ? `aislado ${hallado[0]}. ${hallado[1]}` : `ninguno de los ${vistos.size} aislados que respondieron tiene rastro de la consulta`}`);
    }
  },

  // (b) Lo mismo con la consulta esperando en la cola.
  async "corte-en-la-cola"() {
    const e = await enUnAislado([
      { a: 0, ruta: "/avisos?borrar=1" },
      ...[0, 1, 2, 3].map((i) => ({ a: 100, ruta: `/c/ocupa${i}?ms=6000&${VIVA}` })),
      { a: 600, ruta: `/c/cortada-en-cola?ms=100&${VIVA}`, cortar: 1000 },
      { a: 9000, ruta: "/avisos?bitacora=40" },
    ]);
    const av = e.por("/avisos")[1];
    const salio = av.bitacora.some((l) => l.includes("red entra /cortada-en-cola"));
    decir(`una consulta cortada mientras hacía cola. ${salio ? "SIGUIÓ viva, tomó cupo y salió a la red" : "no salió a la red"}. en vuelo ${av.red.enVuelo}. ${aislados(e)}`);
  },

  // (a) y (c) con el reloj de verdad. ¿La CPU de otra petición, o la de un
  // programa de la caja aislada, detiene de verdad a una petición del Worker?
  async "detencion-real"() {
    for (const [quien, ruta] of [["otra petición del Worker", "/cpu"], ["un programa de la caja aislada", "/codigo"]]) {
      const e = await enUnAislado([
        { a: 0, ruta: "/reloj-real?ms=12000" },
        { a: 2000, ruta: `${ruta}?iter=${await vueltasPara(5000)}` },
      ]);
      const [r] = e.por("/reloj-real");
      const [c] = e.por(ruta);
      decir(`5 s de CPU en ${quien}${c.caja ? ` (${c.caja.slice(0, 60)})` : ""}. una petición que lee el reloj de verdad cada 50 ms vio un hueco máximo de ${r.hueco_maximo_ms} ms, huecos sobre 300 ms ${JSON.stringify(r.huecos_sobre_300)}, en ${r.vueltas} vueltas. ${aislados(e)}`);
    }
  },
};

const nombres = pedidos.length ? pedidos : Object.keys(EXPERIMENTOS);
const primera = await pedirYa("/id");
decir(`sonda viva. ${JSON.stringify(primera)}`);
if (primera.status !== 200) process.exit(1);
for (const nombre of nombres) {
  if (!EXPERIMENTOS[nombre]) {
    console.error(`experimento desconocido. ${nombre}. Los que hay. ${Object.keys(EXPERIMENTOS).join(", ")}`);
    process.exit(2);
  }
  decir(`=== ${nombre}`);
  try {
    await EXPERIMENTOS[nombre]();
  } catch (e) {
    decir(`el experimento lanzó. ${e.message}`);
  }
}
process.exit(0);
