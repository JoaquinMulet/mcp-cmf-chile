/**
 * El limitador con el reloj de Cloudflare, que no es el de Node.
 *
 * Medido en producción el 10 de octubre de 2026 con el Worker de sonda. En
 * Cloudflare Date.now() no avanza mientras el Worker gasta CPU, y un
 * temporizador que corre atrasado ve la hora para la que estaba programado.
 * El limitador no puede ver una detención. Después de 6 segundos de CPU en
 * otra petición, una petición con 10 consultas perdió sus 4 cupos, con todas
 * sus consultas vivas, y quedaron 8 en vuelo con tope de 4 (3 corridas de 3).
 *
 * workerd local no lo reproduce, porque ahí el reloj sí avanza. Estas pruebas
 * usan el modelo de test/reloj-de-cloudflare.ts, que con el código de ese día
 * da el mismo resultado que producción, cifra por cifra.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { conRelojDeCloudflare, type Mundo } from "./reloj-de-cloudflare.js";
import { type Cliente, clienteNuevo, conAvisos, cuposLibres, ENV, lanzar, recuperados, redSimulada, TOPE } from "./limitador-con-el-modelo.js";

/** La carga que falló en producción. una petición con 10 consultas, y 2 peticiones más haciendo cola. */
async function armarCarga(m: Mundo, cliente: Cliente): Promise<void> {
  m.peticion("de-10", () => void Array.from({ length: 10 }, (_, i) => lanzar(cliente, `viva${i}`, 300_000)));
  await m.avanzar(500);
  for (const i of [0, 1]) m.peticion(`cola${i}`, () => void lanzar(cliente, `cola${i}`, 300_000));
  await m.avanzar(2000);
}

test("un cupo de una petición que terminó vuelve solo a los 45 segundos, y no antes", async () => {
  const cliente = await clienteNuevo("gracia-de-fabrica");
  const { red, devolver } = redSimulada();
  try {
    await conAvisos((avisos) =>
      conRelojDeCloudflare(async (m) => {
        // 2 consultas que su petición abandona con el cupo tomado.
        m.peticion("abandona", () => void [0, 1].map((i) => lanzar(cliente, `muerta${i}`, 600_000)));
        await m.avanzar(100);
        m.terminar("abandona");
        // Una consulta viva y larga, para que haya quien barra.
        m.peticion("viva", () => void lanzar(cliente, "viva", 600_000));
        await m.avanzar(40_000);
        assert.deepEqual(recuperados(avisos), [], "a los 40 segundos");
        assert.equal(await cuposLibres(m, cliente, red, "a-los-40"), 1, "cupos libres a los 40 segundos");
        await m.avanzar(8000);
        assert.equal(recuperados(avisos).length, 2, `a los 50 segundos. ${avisos.join(" | ")}`);
        assert.equal(await cuposLibres(m, cliente, red, "a-los-50"), 3, "cupos libres a los 50 segundos");
      }),
    );
  } finally {
    devolver();
  }
});

test("cada cupo se da por muerto con la gracia de quien lo tomó", async () => {
  const cliente = await clienteNuevo("gracia-por-cupo");
  const { devolver } = redSimulada();
  try {
    await conAvisos((avisos) =>
      conRelojDeCloudflare(async (m) => {
        m.peticion("corta", () => void lanzar(cliente, "muerta-corta", 600_000, { ...ENV, CMF_GRACIA_CUPO_MS: "5000" }));
        m.peticion("de-fabrica", () => void lanzar(cliente, "muerta-de-fabrica", 600_000));
        await m.avanzar(100);
        m.terminar("corta");
        m.terminar("de-fabrica");
        m.peticion("viva", () => void lanzar(cliente, "viva", 600_000));
        // A los 5100 ms corre el primer latido que la ve vencida. Con 6500 queda margen, y un barrido que corriera cada 5 segundos no llega.
        await m.avanzar(6500);
        assert.equal(recuperados(avisos).length, 1, `a los 6,5 segundos. ${avisos.join(" | ")}`);
        await m.avanzar(42_500);
        assert.equal(recuperados(avisos).length, 2, `a los 49 segundos. ${avisos.join(" | ")}`);
      }),
    );
  } finally {
    devolver();
  }
});

test("la gracia también vale para el cupo que se toma después de hacer cola", async () => {
  const cliente = await clienteNuevo("gracia-desde-la-cola");
  const { devolver } = redSimulada();
  try {
    await conAvisos((avisos) =>
      conRelojDeCloudflare(async (m) => {
        // 4 consultas ocupan los cupos 1 segundo. La quinta hace cola, toma el
        // primero que se libera, y su petición la abandona.
        m.peticion("ocupan", () => void Array.from({ length: TOPE }, (_, i) => lanzar(cliente, `ocupa${i}`, 1000)));
        await m.avanzar(100);
        m.peticion("abandona", () => void lanzar(cliente, "muerta-tras-la-cola", 600_000));
        await m.avanzar(1500);
        m.terminar("abandona");
        m.peticion("viva", () => void lanzar(cliente, "viva", 600_000));
        await m.avanzar(40_000);
        assert.deepEqual(recuperados(avisos), [], "a los 40 segundos");
        await m.avanzar(8000);
        assert.equal(recuperados(avisos).length, 1, `a los 50 segundos. ${avisos.join(" | ")}`);
      }),
    );
  } finally {
    devolver();
  }
});

for (const valor of ["1000", "4999", "cinco segundos", "0"]) {
  test(`una gracia de cupo «${valor}» no se usa. vale la de fábrica y queda el aviso`, async () => {
    const cliente = await clienteNuevo(`gracia-${valor.length}-${valor.charCodeAt(0)}`);
    const { red, devolver } = redSimulada();
    const env = { ...ENV, CMF_GRACIA_CUPO_MS: valor };
    try {
      await conAvisos((avisos) =>
        conRelojDeCloudflare(async (m) => {
          m.peticion("de-10", () => void Array.from({ length: 10 }, (_, i) => lanzar(cliente, `viva${i}`, 300_000, env)));
          await m.avanzar(500);
          m.peticion("cola0", () => void lanzar(cliente, "cola0", 300_000, env));
          await m.avanzar(2000);
          m.detener(6000);
          await m.avanzar(10_000);
          // El efecto. con una gracia corta de verdad, esta detención da por muertos a los 4 vivos.
          assert.deepEqual(recuperados(avisos), [], "vivos dados por muertos");
          assert.equal(red.maximo, TOPE);
          assert.equal(avisos.filter((a) => a.includes("CMF_GRACIA_CUPO_MS")).length, 1, `avisos. ${avisos.join(" | ")}`);
        }),
      );
    } finally {
      devolver();
    }
  });
}

for (const detencionMs of [6000, 30_000]) {
  test(`una petición con 10 consultas no pierde sus cupos por ${detencionMs / 1000} segundos de CPU que el reloj no muestra`, async () => {
    const cliente = await clienteNuevo(`cpu-${detencionMs}`);
    const { red, devolver } = redSimulada();
    try {
      await conAvisos((avisos) =>
        conRelojDeCloudflare(async (m) => {
          await armarCarga(m, cliente);
          assert.equal(red.maximo, TOPE, "antes de la detención");
          m.detener(detencionMs);
          // Llegan 3 consultas nuevas apenas termina. Su reloj parte en la hora de verdad.
          for (const i of [0, 1, 2]) m.peticion(`despues${i}`, () => void lanzar(cliente, `despues${i}`, 300_000));
          await m.avanzar(10_000);
          assert.deepEqual(recuperados(avisos), [], "vivos dados por muertos");
          assert.equal(red.maximo, TOPE, "máximo en vuelo");
        }),
      );
    } finally {
      devolver();
    }
  });
}

// Un mutante que la sexta revisión dejó vivo. el barrido que saca un puesto de
// la cola sin marcarlo. Su dueño, si estaba vivo, cree que sigue en la cola, no
// vuelve a entrar y no recibe cupo nunca.
test("un puesto vivo que otra petición barrió por error vuelve a la cola, y su consulta termina", async () => {
  const cliente = await clienteNuevo("puesto-barrido-por-error");
  const { red, devolver } = redSimulada();
  try {
    await conRelojDeCloudflare(async (m) => {
      // 4 consultas con cupo y 6 en la cola, de una sola petición. Y otra
      // petición con una consulta en la cola, que tras la detención se
      // adelanta más de 2 segundos y barre los 6 puestos, que están vivos.
      const deDiez = m.peticion("de-10", () => Array.from({ length: 10 }, (_, i) => lanzar(cliente, `corta${i}`, 2000)));
      await m.avanzar(500);
      const sola = m.peticion("sola", () => lanzar(cliente, "sola", 2000));
      await m.avanzar(500);
      m.detener(3000);
      await m.avanzar(20_000);
      assert.deepEqual([...deDiez, sola].map((c) => c.fin), Array.from({ length: 11 }, () => "ok"));
      assert.equal(red.maximo, TOPE);
    });
  } finally {
    devolver();
  }
});

// La línea de cola llena sale 1 segundo después del primer rechazo, cuando la
// ráfaga se cierra. Tiene que contar cómo estaba el limitador en ese primer
// rechazo. Con la máquina cargada la cola ya se había vaciado al salir la
// línea, y decía «en_cola 0» para una cola que estuvo llena (10 de octubre de
// 2026, 1 corrida roja de 3 con la CPU ocupada).
test("la línea de cola llena cuenta la cola del momento del primer rechazo, aunque después se vacíe", async () => {
  const cliente = await clienteNuevo("linea-de-cola-llena");
  const { devolver } = redSimulada();
  try {
    await conAvisos((avisos) =>
      conRelojDeCloudflare(async (m) => {
        // 4 con cupo y 1000 en la cola, que se rinden a los 3 segundos.
        m.peticion("llena", () => {
          for (let i = 0; i < TOPE; i++) lanzar(cliente, `ocupa${i}`, 600_000);
          for (let i = 0; i < 1000; i++) lanzar(cliente, `en-cola${i}`, 100, { ...ENV, CMF_ESPERA_CUPO_MS: "3000" });
        });
        await m.avanzar(100);
        // 3 que no caben. Las rechazan a los 2,6 segundos, con la cola todavía llena.
        const rechazadas = m.peticion("no-caben", () => [0, 1, 2].map((i) => lanzar(cliente, `no-cabe${i}`, 100)));
        await m.avanzar(2800);
        for (const r of rechazadas) assert.match(r.fin ?? "sigue esperando", /1000 consultas esperando/);
        assert.deepEqual(avisos.filter((a) => a.includes("cola_llena")), [], "la línea no sale antes de que cierre la ráfaga");
        // A los 3 segundos la cola se vacía. La línea sale a los 3,6.
        await m.avanzar(1200);
        const lineas = avisos.filter((a) => a.includes("cola_llena"));
        assert.equal(lineas.length, 1, lineas.join(" | "));
        assert.deepEqual(JSON.parse(lineas[0]), { cmf_cupo: { motivo: "cola_llena", rechazadas: 3, en_vuelo: TOPE, en_cola: 1000, host: "api.sbif.cl" } });
      }),
    );
  } finally {
    devolver();
  }
});
