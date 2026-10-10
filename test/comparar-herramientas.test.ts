/**
 * El servidor desplegado publica exactamente las herramientas del repositorio.
 *
 * Medido el 9 de octubre de 2026. La verificación del desplegado solo pedía
 * «82 herramientas o más». Producción tenía 91, porque 3 herramientas de
 * bancos se habían desplegado desde un árbol con cambios sin commitear. El
 * despliegue de ese día salió de master, dejó 88, y la verificación pasó en
 * verde con 3 herramientas menos. Un piso no ve lo que se pierde por encima
 * del piso, ni lo que sobra.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compararHerramientas } from "./comparar-herramientas.js";

test("las mismas herramientas en otro orden no dejan diferencia", () => {
  assert.deepEqual(compararHerramientas(["a", "b", "c"], ["c", "a", "b"]), { faltan: [], sobran: [] });
});

test("una herramienta del repositorio que el servidor no publica aparece en faltan", () => {
  const d = compararHerramientas(["cmf_a", "cmf_bancos_eeff_portal", "cmf_b"], ["cmf_a", "cmf_b"]);
  assert.deepEqual(d, { faltan: ["cmf_bancos_eeff_portal"], sobran: [] });
});

test("una herramienta que el servidor publica y el repositorio no tiene aparece en sobran", () => {
  // El caso del 15 de septiembre de 2026: se desplegó lo que había en el disco.
  const d = compararHerramientas(["cmf_a"], ["cmf_a", "cmf_bancos_eeff_portal", "cmf_bancos_eeff_documentos"]);
  assert.deepEqual(d, { faltan: [], sobran: ["cmf_bancos_eeff_documentos", "cmf_bancos_eeff_portal"] });
});

test("un servidor con el mismo número de herramientas pero otras distintas no pasa", () => {
  const d = compararHerramientas(["cmf_a", "cmf_b"], ["cmf_a", "cmf_c"]);
  assert.deepEqual(d, { faltan: ["cmf_b"], sobran: ["cmf_c"] });
});
