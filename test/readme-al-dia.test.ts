/**
 * El README no puede quedar viejo respecto del código.
 *
 * Por qué existe. el dueño preguntó el 21 de agosto de 2026 cuáles son
 * las herramientas con captcha, porque el README decía «no uses modo
 * código si necesitas captcha» sin nombrar ni una. La respuesta correcta
 * son 2 de 86, y la escribí en el README.
 *
 * Pero una lista escrita a mano envejece en silencio. Si mañana una
 * tercera tool gana captcha, el README seguiría diciendo 2 y nadie se
 * enteraría hasta que un agente eligiera mal el modo.
 *
 * Regla del proyecto. un valor que vive en el código Y en la prosa se
 * cambia en los 2 lugares, o se calcula desde una sola fuente. Acá el
 * código es la fuente y esta prueba obliga a que la prosa lo siga.
 *
 * Ojo con el metodo. NO se leen los archivos fuente buscando la palabra
 * captcha, porque `cmf_empresa_hechos` la menciona en su cuerpo y NO la
 * acepta como parametro. Se le pregunta al registro cuales tools tienen
 * de verdad un parametro que empiece con captcha, que es el efecto y no
 * la presencia.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { construirRegistro } from "../src/registro.js";

const README = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");

/** Las tools que de verdad aceptan un parámetro de captcha. */
function conCaptcha(): string[] {
  const salida: string[] = [];
  for (const op of construirRegistro({ CMF_RATE_LIMIT_MS: "0" } as never).values()) {
    if (op.params.some((p: { nombre: string }) => p.nombre.startsWith("captcha"))) {
      salida.push(`cmf_${op.nombre}`);
    }
  }
  return salida.sort();
}

test("el README nombra TODAS las tools que piden captcha", () => {
  const faltan = conCaptcha().filter((n) => !README.includes(n));
  assert.deepEqual(
    faltan,
    [],
    `Estas tools piden captcha y el README no las nombra, así que un agente no puede saber`
      + ` cuándo el modo código no le sirve:\n  ${faltan.join("\n  ")}`,
  );
});

test("el README no nombra como de captcha una tool que ya no lo pide", () => {
  const reales = new Set(conCaptcha());
  // La tabla de captcha del README, solo esa región.
  const ini = README.indexOf("| Herramienta | Qué trae | Por qué la CMF le pone captcha |");
  assert.notEqual(ini, -1, "no encontré la tabla de captcha en el README");
  const tabla = README.slice(ini, README.indexOf("\n\n", ini));
  const nombrados = [...tabla.matchAll(/`(cmf_[a-z_]+)`/g)].map((m) => m[1]);
  const sobran = nombrados.filter((n) => !reales.has(n));
  assert.deepEqual(sobran, [], `El README dice que estas piden captcha y ya no lo hacen:\n  ${sobran.join("\n  ")}`);
});

test("el conteo escrito en el README coincide con el real", () => {
  const n = conCaptcha().length;
  assert.ok(
    README.includes(`las ${n} herramientas con captcha`) || README.includes(`Son estas ${n}`),
    `El README debería decir que son ${n}. Un número viejo en la prosa es peor que no ponerlo,`
      + ` porque el agente elige leyendo la descripción.`,
  );
});
