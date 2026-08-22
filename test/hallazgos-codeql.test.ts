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
import { test } from "node:test";
import assert from "node:assert/strict";
import { urlDocumentoCmf } from "../src/util/nombres.js";
import { decodificarEntidades } from "../src/client/parsers.js";

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
