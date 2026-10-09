/**
 * El portón de alertas vigila TODO el código que corre, no solo el Worker.
 *
 * Medido el 9 de octubre de 2026. El portón bloqueaba las alertas altas y
 * críticas solo en `src/`. Ese día nació `infra/salida-chilena/proxy.mjs`, un
 * proxy que corre en una máquina del dueño, y CodeQL le abrió una alerta
 * crítica. El portón la contó como «en pruebas» y la dejó pasar como
 * informativa. Resultó un falso positivo, pero una crítica real en ese mismo
 * archivo habría pasado igual. El guardia medía una carpeta distinta de la que
 * se ejecuta.
 *
 * La regla. todo lo que no es prueba cuenta como código que corre. Una carpeta
 * nueva queda vigilada sin que nadie se acuerde de anotarla.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error herramienta en JavaScript sin tipos, corre sin compilar.
import { clasificar } from "../herramientas/alertas-clasificar.mjs";

const alerta = (ruta: string, severidad: string | null) => ({ ruta, severidad, regla: "js/x", linea: 1, url: "" });

test("una alerta crítica en infra/ bloquea, porque ese código corre en una máquina real", () => {
  const r = clasificar([alerta("infra/salida-chilena/proxy.mjs", "critical")]);
  assert.equal(r.bloqueantes.length, 1);
  assert.equal(r.enPruebas.length, 0);
});

test("una alerta alta en src/ sigue bloqueando", () => {
  const r = clasificar([alerta("src/client/cmf-client.ts", "high")]);
  assert.equal(r.bloqueantes.length, 1);
});

test("una carpeta que nadie anotó queda vigilada: falla cerrado", () => {
  const r = clasificar([alerta("carpeta-nueva/servidor.mjs", "high"), alerta("herramientas/alertas.mjs", "critical")]);
  assert.equal(r.bloqueantes.length, 2);
});

test("las alertas de test/ se informan y no bloquean, sea cual sea su severidad", () => {
  const r = clasificar([alerta("test/fixtures/pagina.html", "high"), alerta("test/verify-remote.ts", "critical")]);
  assert.equal(r.bloqueantes.length, 0);
  assert.equal(r.enPruebas.length, 2);
});

test("un aviso sin severidad de seguridad en código que corre se lista y no bloquea", () => {
  const r = clasificar([alerta("src/tools/otros.ts", null), alerta("infra/x.mjs", "medium")]);
  assert.equal(r.bloqueantes.length, 0);
  assert.equal(r.otrasProduccion.length, 2);
});

test("una carpeta que solo EMPIEZA con test no se cuela como prueba", () => {
  const r = clasificar([alerta("testigo/servidor.mjs", "high")]);
  assert.equal(r.bloqueantes.length, 1);
});
