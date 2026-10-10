/**
 * Los defectos que encontro CodeQL, con su prueba de regresion.
 *
 * Por que existe este archivo aparte. el 21 de agosto de 2026 encendi
 * el analisis de seguridad, lei que el trabajo habia terminado en
 * verde, y no mire ni una alerta. Habia 3 de severidad alta en codigo
 * que se despliega. El dueno lo cazo y dijo la frase que ordena todo
 * esto. si no estan en el flujo de cada commit son invisibles.
 *
 * Un hallazgo de una herramienta en la nube que no baja a una prueba
 * local vive en una pagina web que nadie abre. Cada uno de estos
 * hallazgos queda aca, ejercitando la funcion de verdad, asi que el
 * defecto no puede volver aunque el analisis de la nube se apague.
 */
import "./sin-red-real.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { urlDocumentoCmf } from "../src/util/nombres.js";
import { decodificarEntidades, textoPlanoHtml } from "../src/client/parsers.js";

// --- js/incomplete-sanitization, alta, empresas.ts y paquete.ts ------

test("la URL de un documento resuelve TODOS los saltos, no solo el primero", () => {
  // El defecto. `href.replace("../", "/institucional/")` con un patron
  // de TEXTO cambia solo la PRIMERA aparicion, asi que `../../x` daba
  // `/institucional/../x`, una ruta que sale del prefijo recien puesto.
  assert.equal(
    urlDocumentoCmf("../doc/poliza.pdf"),
    "https://www.cmfchile.cl/institucional/doc/poliza.pdf",
  );
  assert.equal(
    urlDocumentoCmf("../../doc/poliza.pdf"),
    "https://www.cmfchile.cl/institucional/doc/poliza.pdf",
  );
  assert.equal(
    urlDocumentoCmf("../../../a/b/c.pdf"),
    "https://www.cmfchile.cl/institucional/a/b/c.pdf",
  );
});

test("una ruta con un salto EN MEDIO se rechaza en vez de resolverse mal", () => {
  // Un `..` que no esta al inicio no lo arregla ningun prefijo. La
  // respuesta correcta es negarse y decirlo, no devolver una ruta que
  // apunta a otra cosa.
  assert.throws(
    () => urlDocumentoCmf("../doc/../../secreto.pdf"),
    /salto de directorio/,
  );
});

test("un href que ya es absoluto no se toca", () => {
  assert.equal(urlDocumentoCmf("/institucional/x.pdf"), "https://www.cmfchile.cl/institucional/x.pdf");
});

// --- js/double-escaping, alta, parsers.ts ---------------------------

test("el ampersand se decodifica AL FINAL, para no desescapar 2 veces", () => {
  // El defecto. con `&amp;` decodificado ANTES que `&lt;`, un texto que
  // la fuente escapo 2 veces (`&amp;lt;`) terminaba convertido en un `<`
  // de verdad, indistinguible del marcado real.
  assert.equal(decodificarEntidades("&amp;lt;"), "&lt;");
  assert.equal(decodificarEntidades("&amp;amp;"), "&amp;");
  // Y lo normal sigue funcionando.
  assert.equal(decodificarEntidades("&lt;b&gt;"), "<b>");
  assert.equal(decodificarEntidades("Rentas &amp; Seguros"), "Rentas & Seguros");
  assert.equal(decodificarEntidades("Compa&ntilde;&iacute;a"), "Compañía");
});

// --- js/double-escaping, alta, otros.ts (9 de octubre de 2026) -------

test("el texto plano de un enlace tampoco desescapa 2 veces", () => {
  // El mismo defecto, en una función hermana que decodificaba por su
  // cuenta con `&amp;` ANTES que `&quot;`. Entró con las herramientas de
  // EEFF anuales de bancos, que se escribieron en septiembre sin pasar por
  // el trunk, y CodeQL lo marcó el día que llegaron.
  assert.equal(textoPlanoHtml("<a>Banco &amp;quot;X&amp;quot;</a>"), "Banco &quot;X&quot;");
  assert.equal(textoPlanoHtml("<b>Rentas &amp; Seguros</b>"), "Rentas & Seguros");
  assert.equal(textoPlanoHtml("<span>Descargar&nbsp;2025</span> <script>x()</script>"), "Descargar 2025");
  assert.equal(textoPlanoHtml("  dos   espacios \n y salto "), "dos espacios y salto");
});

/** Archivos de src que decodifican `&amp;` junto con otra entidad, fuera de parsers.ts. */
function decodificadoresPropios(archivos: Array<{ ruta: string; texto: string }>): string[] {
  const OTRA_ENTIDAD = /&(quot|lt|gt|nbsp|#39);/;
  return archivos
    .filter((a) => !a.ruta.endsWith("parsers.ts") && a.texto.includes("&amp;") && OTRA_ENTIDAD.test(a.texto))
    .map((a) => a.ruta);
}

test("nadie en src decodifica entidades por su cuenta: todo pasa por decodificarEntidades", () => {
  // La clase, no el caso. El orden de las entidades se arregló una vez en
  // parsers.ts y volvió a romperse en una copia. Una sola función lo decide.
  const SRC = join(import.meta.dirname, "..", "src");
  const archivos = readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((n) => n.endsWith(".ts"))
    .map((n) => ({ ruta: n.replaceAll("\\", "/"), texto: readFileSync(join(SRC, n), "utf8") }));
  assert.ok(archivos.length > 10, "sin archivos leídos, esta comprobación no mide nada");
  assert.deepEqual(decodificadoresPropios(archivos), []);
});

test("la comprobación anterior SÍ puede fallar", () => {
  const copia = { ruta: "tools/otro.ts", texto: 'x.replace(/&amp;/g, "&").replace(/&quot;/g, "x")' };
  const soloAmp = { ruta: "client/cmf-client.ts", texto: 'action.replace(/&amp;/g, "&")' };
  const oficial = { ruta: "client/parsers.ts", texto: "&amp; &quot; &lt;" };
  assert.deepEqual(decodificadoresPropios([copia, soloAmp, oficial]), ["tools/otro.ts"]);
});
