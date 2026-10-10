/**
 * En Workers, lo que una petición deja pendiente al responder se abandona.
 * Estas pruebas miran lo que cambia cuando el Worker le deja al cliente su
 * waitUntil (src/client/peticion.ts). Corren con el modelo del reloj de
 * Cloudflare, donde una petición puede terminar con cosas pendientes.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { conRelojDeCloudflare, type Mundo } from "./reloj-de-cloudflare.js";
import { clienteNuevo, conAvisos, cuposLibres, ENV, lanzar, recuperados, redSimulada, TOPE } from "./limitador-con-el-modelo.js";
import { peticionEnCurso } from "../src/client/peticion.js";

/** Corre `cuerpo` como lo hace el Worker. con su waitUntil al alcance del cliente. */
const conWaitUntil =
  <T>(m: Mundo, cuerpo: () => T) =>
  () =>
    peticionEnCurso.run({ esperarHasta: m.esperarHasta }, cuerpo);

// Medido en producción el 10 de octubre de 2026. una consulta cuyo cliente
// cortó la conexión a los 1500 ms no había terminado 26 segundos después, y su
// cupo seguía tomado hasta que otra petición lo barrió.
test("una consulta cuya petición ya respondió sigue hasta terminar y devuelve su cupo, si el Worker dejó su waitUntil", async () => {
  const cliente = await clienteNuevo("consulta-con-waituntil");
  const { red, devolver } = redSimulada();
  try {
    await conAvisos((avisos) =>
      conRelojDeCloudflare(async (m) => {
        const conEl = m.peticion("con", conWaitUntil(m, () => lanzar(cliente, "sigue", 5000)));
        // El control. sin el waitUntil, la consulta queda abandonada con su cupo.
        const sinEl = m.peticion("sin", () => lanzar(cliente, "abandonada", 5000));
        await m.avanzar(100);
        m.terminar("con");
        m.terminar("sin");
        assert.equal(m.viva("con"), true, "la petición con waitUntil tiene que seguir viva");
        assert.equal(m.viva("sin"), false);
        await m.avanzar(6000);
        assert.equal(conEl.fin, "ok");
        assert.equal(sinEl.fin, undefined, "la abandonada no termina nunca");
        assert.equal(m.viva("con"), false, "terminada la consulta, la petición se va");
        assert.deepEqual(recuperados(avisos), []);
        // De los 4 cupos, 1 sigue tomado por la abandonada.
        assert.equal(await cuposLibres(m, cliente, red, "tras-las-2"), 3);
      }),
    );
  } finally {
    devolver();
  }
});

// Medido en workerd el 10 de octubre de 2026. con 3 cupos muertos y 8
// consultas cortas que llegaban de a una, cada una en su petición, volvieron 0
// cupos. El vigía que deja quien entra directo necesita 2 segundos y medio, y
// moría con su petición a los 300 ms.
test("3 cupos muertos vuelven con consultas cortas que llegan de a una, porque el vigía sobrevive a su petición", async () => {
  const cliente = await clienteNuevo("vigia-con-waituntil");
  const { red, devolver } = redSimulada();
  const env = { ...ENV, CMF_GRACIA_CUPO_MS: "5000" };
  try {
    await conAvisos((avisos) =>
      conRelojDeCloudflare(async (m) => {
        m.peticion("abandona", () => void [0, 1, 2].map((i) => lanzar(cliente, `muerta${i}`, 600_000, env)));
        await m.avanzar(100);
        m.terminar("abandona");
        await m.avanzar(6000);
        for (const i of [0, 1, 2]) {
          const corta = m.peticion(`corta${i}`, conWaitUntil(m, () => lanzar(cliente, `corta${i}`, 300, env)));
          await m.avanzar(400);
          assert.equal(corta.fin, "ok");
          m.terminar(`corta${i}`);
          await m.avanzar(1200);
        }
        assert.equal(recuperados(avisos).length, 3, `avisos. ${avisos.join(" | ")}`);
        // El vigía se apaga y suelta a su petición. no la deja viva para siempre.
        await m.avanzar(6000);
        for (const i of [0, 1, 2]) assert.equal(m.viva(`corta${i}`), false, `la petición corta${i} sigue viva`);
        assert.equal(await cuposLibres(m, cliente, red, "tras-el-vigia"), TOPE);
      }),
    );
  } finally {
    devolver();
  }
});

// Los detalles del vigía que ninguna prueba sostenía (séptima revisión
// adversarial, 10 de octubre de 2026).

test("sin cupos sospechosos nadie deja un vigía, y una consulta corta no retiene a su petición", async () => {
  const cliente = await clienteNuevo("sin-sospechosos");
  const { devolver } = redSimulada();
  try {
    await conRelojDeCloudflare(async (m) => {
      // Otra consulta viva tiene un cupo y renueva su señal. No es sospechosa.
      // Pasan 6 segundos, más que el plazo de un vigía, para que si alguien
      // dejó uno al entrar ya no esté ocupando el turno.
      m.peticion("viva", conWaitUntil(m, () => void lanzar(cliente, "viva", 60_000)));
      await m.avanzar(6000);
      const corta = m.peticion("corta", conWaitUntil(m, () => lanzar(cliente, "corta", 300)));
      await m.avanzar(400);
      assert.equal(corta.fin, "ok");
      assert.equal(m.temporizadores("corta"), 0, "temporizadores que dejó la consulta corta");
      m.terminar("corta");
      assert.equal(m.viva("corta"), false, "la petición quedó retenida sin que hubiera nada que vigilar");
    });
  } finally {
    devolver();
  }
});

test("hay un solo vigía a la vez, y al terminar no deja ningún temporizador", async () => {
  const cliente = await clienteNuevo("un-solo-vigia");
  const { devolver } = redSimulada();
  const env = { ...ENV, CMF_GRACIA_CUPO_MS: "5000" };
  try {
    await conAvisos((avisos) =>
      conRelojDeCloudflare(async (m) => {
        m.peticion("abandona", () => void lanzar(cliente, "muerta", 600_000, env));
        await m.avanzar(100);
        m.terminar("abandona");
        await m.avanzar(6000);
        // 3 consultas entran directo, en la misma petición, y ven el cupo sospechoso.
        let retenciones = 0;
        const contar = { esperarHasta: (p: Promise<unknown>) => (retenciones++, m.esperarHasta(p)) };
        m.peticion("tres", () => peticionEnCurso.run(contar, () => void [0, 1, 2].map((i) => lanzar(cliente, `directa${i}`, 300, env))));
        await m.avanzar(400);
        // Una retención por consulta, y una sola por el vigía.
        assert.equal(retenciones, 4, "veces que el cliente retuvo a la petición");
        assert.equal(m.temporizadores("tres"), 1, "con las 3 consultas terminadas queda solo el vigía");
        await m.avanzar(3000);
        assert.equal(recuperados(avisos).length, 1, `avisos. ${avisos.join(" | ")}`);
        assert.equal(m.temporizadores("tres"), 0, "el vigía barrió y no se apagó");
      }),
    );
  } finally {
    devolver();
  }
});

test("si el vigía muere con su petición, pasado su plazo otra consulta deja el suyo", async () => {
  const cliente = await clienteNuevo("vigia-muerto");
  const { devolver } = redSimulada();
  const env = { ...ENV, CMF_GRACIA_CUPO_MS: "5000" };
  try {
    await conAvisos((avisos) =>
      conRelojDeCloudflare(async (m) => {
        m.peticion("abandona", () => void lanzar(cliente, "muerta", 600_000, env));
        await m.avanzar(100);
        m.terminar("abandona");
        await m.avanzar(6000);
        // Sin waitUntil. deja el vigía y muere con él a los 400 ms.
        m.peticion("sin", () => void lanzar(cliente, "sin", 300, env));
        await m.avanzar(400);
        m.terminar("sin");
        await m.avanzar(2000);
        assert.equal(recuperados(avisos).length, 0, "el vigía muerto no pudo barrer");
        // Antes del plazo del vigía muerto, 5 segundos, nadie deja otro.
        m.peticion("temprana", conWaitUntil(m, () => void lanzar(cliente, "temprana", 300, env)));
        await m.avanzar(400);
        m.terminar("temprana");
        assert.equal(m.viva("temprana"), false, "dejó un segundo vigía antes de que venciera el primero");
        await m.avanzar(3000);
        m.peticion("tardia", conWaitUntil(m, () => void lanzar(cliente, "tardia", 300, env)));
        await m.avanzar(400);
        m.terminar("tardia");
        await m.avanzar(3000);
        assert.equal(recuperados(avisos).length, 1, `avisos. ${avisos.join(" | ")}`);
      }),
    );
  } finally {
    devolver();
  }
});

// El Worker tiene 2 entradas. la petición HTTP y cada llamada que un programa
// de /codigo hace por el puente. Las 2 tienen que dejar su waitUntil, o las
// consultas que entran por la que falte vuelven a quedar abandonadas.
test("el Worker deja su waitUntil al alcance del cliente en sus 2 entradas", () => {
  const fuente = readFileSync(join(import.meta.dirname, "..", "src", "worker.ts"), "utf8");
  const puente = fuente.slice(fuente.indexOf("export class PuenteCmf"), fuente.indexOf("async function revisarCuota"));
  const porDefecto = fuente.slice(fuente.lastIndexOf("export default {"));
  assert.match(puente, /peticionEnCurso[.]run[(]peticion, async [(][)] => JSON[.]stringify[(]await fn[(]/, "la llamada del puente");
  assert.match(porDefecto, /peticionEnCurso[.]run[(][{] esperarHasta: [(]p[)] => ctx[.]waitUntil[(]p[)] [}], [(][)] => atencion[.]fetch[(]request, env, ctx[)][)]/, "la petición HTTP");
  // Y no queda otra entrada exportada que no pase por ahí.
  assert.equal(fuente.split("export default").length - 1, 1);
  assert.equal(fuente.split("extends WorkerEntrypoint").length - 1, 1);
});
