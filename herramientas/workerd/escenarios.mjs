// Escenarios del limitador en workerd de verdad (miniflare), con el cliente
// del árbol de trabajo. Cada escenario levanta su propio Worker, así el
// limitador parte limpio, y termina con un veredicto.
//
// Lo que la suite de Node no puede ver. en Workers una petición que termina
// abandona sus promesas y sus temporizadores, y los temporizadores atrasados
// se despachan en otro orden que en Node.
//
// Uso. node herramientas/workerd/escenarios.mjs [escenario ...]
// Sin argumentos corre todos. Sale con 1 si alguno queda ROTO.
import { levantar, decir, dormir } from "./arnes.mjs";

const TOPE = 4;
// Las consultas VIVAS de los escenarios de detención llevan una gracia de 5
// segundos. Con los 45 de fábrica ninguna detención de estos escenarios podría
// dar por muerto a un vivo, y no probarían la racha, que es lo que protege
// donde el reloj sí avanza.
const GRACIA_CORTA = "gracia=5000";
// Una consulta que su petición abandona. Sin waitUntil, para que muera con ella, y con
// una gracia de 5 segundos en vez de los 45 de fábrica, para que el escenario no los espere.
const MUERTA = "ms=600000&cupo=120000&timeout=600000&sin_wu=1&gracia=5000";

/** Cuántos avisos de cada clase dejó el limitador dentro del Worker. */
const cuenta = async (w) => (await w.pedirYa("/avisos?todo=1")).cuenta;

/** Lanza `n` consultas juntas de 300 ms y entrega el máximo en vuelo visto desde afuera. */
async function maximoConJuntas(w, n = 10) {
  w.red.maximo = w.red.enVuelo;
  const r = await w.pedirYa(`/multi/juntas?k=${n}&ms=300&cupo=60000`);
  return { maximo: w.red.maximo, ok: r.ok };
}

const ESCENARIOS = {
  // Una petición que termina con consultas pendientes las abandona con el cupo tomado.
  async "abandonadas-con-cupo"(w, fallas) {
    for (let i = 0; i < TOPE; i++) await w.pedirYa(`/suelta/muerta${i}?${MUERTA}`);
    const a = Date.now();
    const viva = await w.pedirYa("/c/viva?ms=0&cupo=30000");
    decir(`con los 4 cupos de consultas muertas, una viva entró a los ${Date.now() - a} ms. ${JSON.stringify(viva.ok ?? viva.error)}`);
    if (viva.status !== 200) fallas.push(`la consulta viva no entró. ${viva.error}`);
    if (Date.now() - a > 12000) fallas.push(`la consulta viva esperó ${Date.now() - a} ms`);
    // Los 4 cupos nacieron con milisegundos de diferencia, y la viva entra
    // apenas vuelve el primero. Una petición de 3 segundos barre los demás.
    await w.pedirYa("/multi/barre?k=8&ms=1500&cupo=60000");
    const juntas = await maximoConJuntas(w);
    const c = await cuenta(w);
    decir(`10 juntas. ok ${juntas.ok}, máximo en vuelo ${juntas.maximo}. cupos recuperados ${c.cmf_cupo_recuperado}`);
    if (juntas.maximo !== TOPE) fallas.push(`máximo en vuelo ${juntas.maximo}, y se esperaba ${TOPE}`);
    if (c.cmf_cupo_recuperado !== TOPE) fallas.push(`cupos recuperados ${c.cmf_cupo_recuperado}, y se esperaban ${TOPE}`);
  },

  // Lo mismo con un puesto en la cola. La muerta no puede frenar a las que vienen detrás ni salir a la red.
  async "abandonadas-en-cola"(w, fallas) {
    const ocupan = Array.from({ length: TOPE }, (_, i) => w.pedir(`/c/ocupa${i}?ms=2500&cupo=90000`));
    await dormir(500);
    for (let i = 0; i < 6; i++) await w.pedirYa(`/suelta/muerta-en-cola${i}?ms=0&cupo=90000&sin_wu=1`);
    await Promise.all(ocupan.map((p) => p.fin));
    const a = Date.now();
    const nueva = await w.pedirYa("/c/nueva?ms=0&cupo=30000");
    decir(`cupos libres y 6 puestos muertos en la cola. una nueva entró a los ${Date.now() - a} ms`);
    if (nueva.status !== 200) fallas.push(`la consulta nueva no entró. ${nueva.error}`);
    if (Date.now() - a > 6000) fallas.push(`la consulta nueva esperó ${Date.now() - a} ms`);
    await dormir(1500);
    const salieron = w.red.llegadas.filter((l) => l.includes("muerta-en-cola"));
    if (salieron.length) fallas.push(`${salieron.length} consultas muertas en la cola salieron a la red`);
    const juntas = await maximoConJuntas(w);
    if (juntas.maximo !== TOPE) fallas.push(`máximo en vuelo ${juntas.maximo}, y se esperaba ${TOPE}`);
  },

  // Una consulta viva y lenta conserva su cupo, pendiente de la red o bajando el cuerpo por tramos.
  async "viva-lenta"(w, fallas) {
    for (const [forma, consulta] of [["esperando la respuesta", "ms=13000"], ["bajando el cuerpo por tramos", "gotas=13&cada=1000"]]) {
      const vivas = Array.from({ length: TOPE }, (_, i) => w.pedir(`/c/lenta${i}?${consulta}&cupo=90000&timeout=90000&${GRACIA_CORTA}`));
      await dormir(8500);
      const sonda = await w.pedirYa("/c/sonda?ms=0&cupo=1500");
      decir(`4 vivas ${forma}. a los 8,5 s una quinta ${sonda.status === 200 ? "ENTRÓ" : "no alcanzó cupo"}`);
      if (sonda.status === 200) fallas.push(`con 4 vivas ${forma}, una quinta consulta entró`);
      await Promise.all(vivas.map((p) => p.fin));
    }
    const c = await cuenta(w);
    if (c.cmf_cupo_recuperado !== 0) fallas.push(`${c.cmf_cupo_recuperado} vivas dadas por muertas`);
    if (w.red.maximo > TOPE) fallas.push(`máximo en vuelo ${w.red.maximo}`);
  },

  // Un hilo detenido no es una consulta muerta. 4 en vuelo, 6 en cola, y llegadas nuevas durante la detención.
  async "hilo-detenido"(w, fallas, { larga = 6000 } = {}) {
    const comun = `ms=${larga + 14000}&cupo=150000&timeout=150000&${GRACIA_CORTA}`;
    for (let i = 0; i < TOPE; i++) w.pedir(`/c/viva${i}?${comun}`);
    await dormir(600);
    for (let i = 0; i < 6; i++) {
      w.pedir(`/c/cola${i}?${comun}`);
      await dormir(30);
    }
    await dormir(1500);
    const p = w.pedir(`/patron?p=${larga}`);
    const hasta = Date.now() + larga + 1500;
    for (let n = 0; Date.now() < hasta; n++) {
      w.pedir(`/c/nueva${n}?${comun}`);
      await dormir(350);
    }
    const detencion = await p.fin;
    await dormir(3500);
    const c = await cuenta(w);
    decir(`detención de ${detencion.reales} ms. máximo en vuelo ${w.red.maximo}. ${JSON.stringify(c)}`);
    if (w.red.maximo > TOPE) fallas.push(`máximo en vuelo ${w.red.maximo}`);
    if (c.cmf_cupo_recuperado !== 0) fallas.push(`${c.cmf_cupo_recuperado} vivas dadas por muertas`);
    if (c.cmf_hilo_detenido < 1) fallas.push("la detención no dejó aviso");
  },

  // Detenciones seguidas, cada una con una pausa corta.
  async "detenciones-seguidas"(w, fallas) {
    const patron = "6000,1400,1400,1400";
    const comun = "ms=24000&cupo=150000&timeout=150000&${GRACIA_CORTA}";
    for (let i = 0; i < TOPE; i++) w.pedir(`/c/viva${i}?${comun}`);
    await dormir(600);
    for (let i = 0; i < 6; i++) w.pedir(`/c/cola${i}?${comun}`);
    await dormir(1500);
    const p = w.pedir(`/patron?p=${patron}&pausa=1`);
    const hasta = Date.now() + 11700;
    for (let n = 0; Date.now() < hasta; n++) {
      w.pedir(`/c/nueva${n}?${comun}`);
      await dormir(350);
    }
    await p.fin;
    await dormir(3000);
    const c = await cuenta(w);
    decir(`patrón ${patron}. máximo en vuelo ${w.red.maximo}. ${JSON.stringify(c)}`);
    if (w.red.maximo > TOPE) fallas.push(`máximo en vuelo ${w.red.maximo}`);
    if (c.cmf_cupo_recuperado !== 0) fallas.push(`${c.cmf_cupo_recuperado} vivas dadas por muertas`);
  },

  // Una petición con 10 consultas, otra en la cola, y una detención. En workerd
  // los temporizadores atrasados de una petición se despachan de a uno, y un
  // temporizador recién creado corre antes que ellos.
  async "detenido-con-peticion-de-10"(w, fallas) {
    const comun = "ms=20000&cupo=150000&timeout=150000&${GRACIA_CORTA}";
    w.pedir(`/multi/junta?k=10&${comun}`);
    await dormir(600);
    w.pedir(`/c/cola0?${comun}`);
    await dormir(1500);
    await w.pedirYa("/patron?p=6000");
    for (let i = 0; i < 3; i++) {
      w.pedir(`/c/despues${i}?${comun}&host=datosbanco.cmfchile.cl`);
      await dormir(20);
    }
    await dormir(3500);
    const c = await cuenta(w);
    decir(`máximo en vuelo ${w.red.maximo}. ${JSON.stringify(c)}`);
    if (w.red.maximo > TOPE) fallas.push(`máximo en vuelo ${w.red.maximo}`);
    if (c.cmf_cupo_recuperado !== 0) fallas.push(`${c.cmf_cupo_recuperado} vivas dadas por muertas`);
  },

  // Consultas que nacen en el mismo turno en que termina la detención.
  async "nace-al-terminar-la-detencion"(w, fallas) {
    const comun = "ms=20000&cupo=150000&timeout=150000&${GRACIA_CORTA}";
    for (let i = 0; i < TOPE; i++) w.pedir(`/c/viva${i}?${comun}`);
    await dormir(600);
    for (let i = 0; i < 2; i++) w.pedir(`/c/cola${i}?${comun}`);
    await dormir(1500);
    w.pedir(`/nace/nueva?larga=6000&resto=120&k=2&${comun}&host=tasas.cmfchile.cl`);
    await dormir(6120 + 3500 + 3500);
    const c = await cuenta(w);
    decir(`máximo en vuelo ${w.red.maximo}. ${JSON.stringify(c)}`);
    if (w.red.maximo > TOPE) fallas.push(`máximo en vuelo ${w.red.maximo}`);
    if (c.cmf_cupo_recuperado !== 0) fallas.push(`${c.cmf_cupo_recuperado} vivas dadas por muertas`);
  },

  // Lo encontró la séptima revisión adversarial. Tras una detención larga, 4
  // ráfagas de CPU de 900 ms casi seguidas. En cada hueco workerd le despacha a
  // cada petición UN temporizador atrasado. La petición chica corre siempre «a
  // tiempo» y junta su racha, y los latidos de la petición de 10 consultas
  // pasan más de 9 segundos sin correr. Con una gracia de 5 segundos perdía sus
  // 4 cupos. La racha no protege de esto. protege la gracia de fábrica.
  async "rafagas-de-cpu"(w, fallas, { gracia = "" } = {}) {
    const comun = `ms=40000&cupo=150000&timeout=150000${gracia ? `&gracia=${gracia}` : ""}`;
    w.pedir(`/multi/junta?k=10&${comun}`);
    await dormir(600);
    w.pedir(`/c/chica0?${comun}`);
    await dormir(1500);
    const r = await w.pedirYa("/patron?p=6000,900,900,900,900&pausa=0");
    await dormir(14000);
    const c = await cuenta(w);
    decir(`ráfagas de ${r.reales} ms. máximo en vuelo ${w.red.maximo}. ${JSON.stringify(c)}`);
    if (w.red.maximo > TOPE) fallas.push(`máximo en vuelo ${w.red.maximo}`);
    if (c.cmf_cupo_recuperado !== 0) fallas.push(`${c.cmf_cupo_recuperado} vivas dadas por muertas`);
  },

  // El control del anterior. con la gracia de 5 segundos SÍ tiene que romperse.
  // Si un día resiste, el escenario dejó de medir lo que dice.
  async "rafagas-de-cpu-con-gracia-corta-se-rompe"(w, fallas) {
    const propias = [];
    await ESCENARIOS["rafagas-de-cpu"](w, propias, { gracia: "5000" });
    if (propias.length === 0) fallas.push("con una gracia de 5 segundos las ráfagas ya no dan por muerto a nadie. el escenario no mide nada");
  },

  // Un cupo abandonado con la gracia de fábrica. No vuelve a los 40 segundos, y sí a los 52.
  async "abandonada-con-la-gracia-de-fabrica"(w, fallas) {
    await w.pedirYa("/suelta/muerta0?ms=600000&cupo=120000&timeout=600000&sin_wu=1");
    w.pedir("/c/viva-larga?ms=58000&cupo=120000&timeout=120000");
    await dormir(40000);
    const a40 = await cuenta(w);
    await dormir(12000);
    const a52 = await cuenta(w);
    decir(`cupos recuperados a los 40 s. ${a40.cmf_cupo_recuperado}. a los 52 s. ${a52.cmf_cupo_recuperado}`);
    if (a40.cmf_cupo_recuperado !== 0) fallas.push(`a los 40 segundos ya había ${a40.cmf_cupo_recuperado} recuperados`);
    if (a52.cmf_cupo_recuperado !== 1) fallas.push(`a los 52 segundos había ${a52.cmf_cupo_recuperado} recuperados, y se esperaba 1`);
  },

  // Una consulta cuya petición se corta sigue sola hasta terminar y devuelve su cupo.
  async "peticion-cortada-termina-sola"(w, fallas) {
    const cortada = w.pedir("/c/cortada?ms=4000&cupo=60000");
    await dormir(1000);
    cortada.cortar();
    await dormir(5000);
    const av = await w.pedirYa("/avisos?bitacora=20");
    const termino = av.bitacora.some((l) => l.includes("consulta sale cortada"));
    decir(`la consulta de una petición cortada ${termino ? "terminó sola" : "no terminó"}. ${JSON.stringify(av.cuenta)}`);
    if (!termino) fallas.push("la consulta cortada quedó abandonada");
    const juntas = await maximoConJuntas(w);
    if (juntas.maximo !== TOPE) fallas.push(`máximo en vuelo ${juntas.maximo}, y se esperaba ${TOPE}`);
  },

  // 4 cupos y 1000 puestos de consultas muertas. La instancia no puede quedar rechazando todo.
  async "cola-llena-de-muertas"(w, fallas) {
    const r = await w.pedirYa(`/suelta/muerta?k=1004&${MUERTA}`);
    decir(`una petición lanzó ${r.soltadas} consultas y terminó. pasan 7 s sin tráfico`);
    await dormir(7000);
    let entraron = 0;
    for (let i = 0; i < 4; i++) {
      const a = Date.now();
      const s = await w.pedirYa(`/c/espaciada${i}?ms=0&cupo=20000`);
      decir(`espaciada ${i}. ${s.status === 200 ? "entró" : `falló. ${s.error}`} a los ${Date.now() - a} ms`);
      if (s.status === 200) entraron++;
      await dormir(1600);
    }
    if (entraron !== 4) fallas.push(`de 4 consultas espaciadas entraron ${entraron}`);
    const juntas = await maximoConJuntas(w);
    if (juntas.maximo !== TOPE) fallas.push(`máximo en vuelo ${juntas.maximo}, y se esperaba ${TOPE}`);
  },

  // Entre 1 y 3 cupos muertos, y consultas cortas que llegan de a una, cada una en su petición.
  async "cupos-muertos-con-poco-trafico"(w, fallas, { muertos = 3, consultas = 8 } = {}) {
    for (let i = 0; i < muertos; i++) await w.pedirYa(`/suelta/muerta${i}?${MUERTA}`);
    await dormir(6000);
    let recuperadosTras = -1;
    for (let i = 0; i < consultas; i++) {
      const s = await w.pedirYa("/c/corta?ms=300&cupo=20000");
      if (s.status !== 200) fallas.push(`la consulta corta ${i} falló. ${s.error}`);
      await dormir(1300);
      const c = await cuenta(w);
      if (recuperadosTras < 0 && c.cmf_cupo_recuperado === muertos) recuperadosTras = i + 1;
    }
    const c = await cuenta(w);
    decir(`${muertos} cupos muertos. tras ${consultas} consultas cortas de a una, recuperados ${c.cmf_cupo_recuperado}${recuperadosTras > 0 ? ` (ya estaban tras la consulta ${recuperadosTras})` : ""}`);
    if (c.cmf_cupo_recuperado !== muertos) fallas.push(`recuperados ${c.cmf_cupo_recuperado} de ${muertos} cupos muertos`);
    const juntas = await maximoConJuntas(w);
    if (juntas.maximo !== TOPE) fallas.push(`máximo en vuelo ${juntas.maximo}, y se esperaba ${TOPE}`);
  },
};

/** Los escenarios que levantan el Worker con variables propias. */
const VARIABLES = { "la-sonda-no-sale-a-la-red": { RED_INTERNA: "1" } };

// La sonda de producción usa una red que vive dentro del Worker. Acá se
// comprueba desde afuera que con esa red ninguna consulta sale.
ESCENARIOS["la-sonda-no-sale-a-la-red"] = async (w, fallas) => {
  const r = await w.pedirYa("/multi/interna?k=6&ms=200&cupo=20000");
  const caja = await w.pedirYa("/codigo?iter=1000");
  decir(`con la red interna. ok ${r.ok} de 6, máximo en vuelo adentro ${r.red?.maximo}. salieron del Worker ${w.red.total}. caja. ${caja.caja ?? caja.error}`);
  if (r.ok !== 6) fallas.push(`entraron ${r.ok} de 6 consultas`);
  if (r.red?.maximo !== TOPE) fallas.push(`máximo en vuelo adentro ${r.red?.maximo}`);
  if (w.red.total !== 0) fallas.push(`${w.red.total} consultas salieron del Worker`);
  if (!String(caja.caja).includes('"valor"')) fallas.push(`la caja aislada no corrió. ${caja.caja ?? caja.error}`);
};

const pedidos = process.argv.slice(2);
const nombres = pedidos.length ? pedidos : Object.keys(ESCENARIOS);
const desconocidos = nombres.filter((n) => !ESCENARIOS[n]);
if (desconocidos.length) {
  console.error(`escenario desconocido. ${desconocidos.join(", ")}. Los que hay. ${Object.keys(ESCENARIOS).join(", ")}`);
  process.exit(2);
}
console.error(`[workerd] ${nombres.length} escenarios en miniflare. Cada uno tarda entre 10 y 30 segundos, y no imprime nada mientras espera.`);
const rotos = [];
for (const nombre of nombres) {
  decir(`=== ${nombre}`);
  const w = await levantar({ variables: VARIABLES[nombre] });
  const fallas = [];
  const plazo = setTimeout(() => {
    console.log(`ROTO. ${nombre}. el escenario no terminó en 150 segundos`);
    process.exit(1);
  }, 150000);
  try {
    await ESCENARIOS[nombre](w, fallas);
  } catch (e) {
    fallas.push(`el escenario lanzó. ${e.message}`);
  }
  clearTimeout(plazo);
  await w.mf.dispose();
  if (fallas.length) rotos.push(nombre);
  console.log(fallas.length ? `ROTO. ${nombre}. ${fallas.join(". ")}` : `RESISTE. ${nombre}`);
}
console.log(rotos.length ? `ROTOS ${rotos.length} de ${nombres.length}. ${rotos.join(", ")}` : `RESISTEN los ${nombres.length} escenarios`);
process.exit(rotos.length ? 1 : 0);
