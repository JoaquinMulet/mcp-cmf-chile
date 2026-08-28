/**
 * El bloque de TEXTO es todo lo que ve un modelo.
 *
 * `structuredContent` sobrevive para quien llama por programa, no para el
 * agente. Estas comprobaciones fijan esa regla, porque romperla no falla
 * ruidoso: el servidor responde 200, el JSON trae el dato, y el agente
 * declara que la información no está disponible.
 *
 * Origen (20 de agosto de 2026). un informe sobre pólizas vehiculares
 * quedó con pendientes porque el enlace al documento viajaba solo en el
 * JSON, y porque el texto cortaba en 8 filas de las 100 pedidas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resumirTabla, paginarTexto } from "../src/util/errors.js";
import { toolOkTabla } from "../src/util/tramos.js";

const FILA_CON_URL = {
  codigo: "POL120260128",
  fecha: "22/07/2026",
  entidad: "CONSORCIO NACIONAL DE SEGUROS S.A.",
  texto: "PÓLIZA DE SEGUROS PARA VEHÍCULOS MOTORIZADOS",
  url: "https://www.cmfchile.cl/sitio/seil/pagina/rgpol/muestra_documento.php?ABH89548=XYZ",
};

test("resumirTabla entrega el enlace al documento aunque no se lo pidan", () => {
  const texto = resumirTabla([FILA_CON_URL], ["codigo", "fecha", "entidad", "texto"]);
  assert.match(texto, /\| url/, "la cabecera debe incluir la columna url");
  assert.ok(texto.includes(FILA_CON_URL.url), "el enlace completo debe estar en el texto");
});

test("resumirTabla dice CÓMO leer el documento cuando hay enlace", () => {
  const texto = resumirTabla([FILA_CON_URL], ["codigo"]);
  assert.match(texto, /cmf_documento_markdown/, "debe nombrar la tool que convierte el PDF");
});

test("resumirTabla no inventa una columna url cuando las filas no la traen", () => {
  const texto = resumirTabla([{ rut: "96654180", nombre: "CONSORCIO" }], ["rut", "nombre"]);
  assert.ok(!texto.includes("url"), "sin enlace no debe aparecer la columna");
  assert.ok(!texto.includes("cmf_documento_markdown"), "ni la recomendación de lectura");
});

test("resumirTabla NO recorta filas: muestra todas las que recibe", () => {
  // La regla del dueño: el servidor jamás decide qué parte del dato
  // merece verse. Quien pidió `limit` ya decidió el tamaño de la página.
  const filas = Array.from({ length: 500 }, (_, i) => ({ n: String(i) }));
  const lineas = resumirTabla(filas, ["n"]).split("\n");
  assert.equal(lineas.length, 501, "1 cabecera + las 500 filas, sin recorte");
  assert.ok(lineas.includes("499"), "la última fila debe estar presente");
});

test("resumirTabla nunca inventa un aviso de corte", () => {
  const filas = Array.from({ length: 200 }, (_, i) => ({ n: String(i) }));
  const texto = resumirTabla(filas, ["n"]);
  assert.ok(!/filas más|faltan/.test(texto), "no debe hablar de filas omitidas: no omite ninguna");
});

test("paginarTexto deja leer un documento entero, por grande que sea", () => {
  // La regla del proyecto: no decidimos por el agente qué parte del
  // documento le sirve. Un tope duro sin salida hace justo eso.
  const doc = "x".repeat(250_000);
  let offset = 0;
  let leido = 0;
  let vueltas = 0;
  for (;;) {
    const p = paginarTexto(doc, offset, 100_000);
    leido += p.hasta - p.desde;
    vueltas += 1;
    if (p.siguiente === null) break;
    offset = p.siguiente;
    assert.ok(vueltas < 10, "no debe entrar en bucle infinito");
  }
  assert.equal(leido, doc.length, "recorriendo los tramos se lee el 100% del documento");
  assert.equal(vueltas, 3, "250 mil caracteres en tramos de 100 mil son 3 vueltas");
});

test("el aviso de tramo dice el offset siguiente y no miente sobre el total", () => {
  const p = paginarTexto("y".repeat(1000), 0, 400);
  assert.match(p.tramo, /tramo 0-400 de 1000/);
  assert.match(p.tramo, /offset_chars=400/);
  assert.equal(p.siguiente, 400);
});

test("el último tramo se marca como fin y no ofrece un offset que no existe", () => {
  const p = paginarTexto("z".repeat(1000), 800, 400);
  assert.equal(p.siguiente, null, "no hay tramo siguiente");
  assert.match(p.tramo, /fin del documento/);
  assert.ok(!/offset_chars=/.test(p.tramo), "no debe ofrecer continuar cuando ya terminó");
});

test("un offset más allá del final no rompe ni inventa contenido", () => {
  const p = paginarTexto("abc", 9999, 100);
  assert.equal(p.desde, 3);
  assert.equal(p.hasta, 3);
  assert.equal(p.siguiente, null);
});

test("ninguna tool manda al modelo a leer structuredContent", () => {
  // Comprobación de CLASE, no de caso. Un texto que remite a
  // `structuredContent` le pide al agente que mire donde no puede, y ese
  // es exactamente el defecto que costó un informe incompleto.
  const dirTools = join(import.meta.dirname, "..", "src", "tools");
  const culpables: string[] = [];
  for (const archivo of readdirSync(dirTools).filter((f) => f.endsWith(".ts"))) {
    const fuente = readFileSync(join(dirTools, archivo), "utf8");
    for (const [i, linea] of fuente.split("\n").entries()) {
      // Solo el texto que se le entrega al modelo. Las declaraciones de
      // `outputSchema` y los comentarios no cuentan.
      const esComentario = /^\s*(\/\/|\*|\/\*)/.test(linea);
      if (esComentario) continue;
      if (/["`'][^"`']*structuredContent/.test(linea)) culpables.push(`${archivo}:${i + 1}`);
    }
  }
  assert.deepEqual(culpables, [], `estas líneas mandan al modelo a structuredContent: ${culpables.join(", ")}`);
});

/**
 * Una columna FANTASMA es una celda vacía que no significa "vacío".
 *
 * `String(f[c] ?? "")` trata igual "la columna no existe" y "la columna
 * está vacía". Quien escribe la lista de columnas a mano se equivoca de
 * nombre y el resultado no es un error: es una tabla en blanco que se ve
 * bien formada. Medido el 28 de agosto de 2026 en `cmf_fondos_mutuos_bpr`,
 * que pedía `Run Fondo`, `Nombre Fondo`, `Patrimonio` y `Partícipes`
 * mientras el dato traía `col_0`, `RUN`, `Patrimonio (1)` y `Participes`.
 * 4 columnas de 6 salían vacías, con el dato completo en el JSON.
 *
 * La cura no es corregir esos 4 nombres. Es que la lista escrita a mano
 * NO PUEDA producir una tabla en blanco: si nombra una columna que ningún
 * dato tiene, esa lista está probada como equivocada y se descarta entera
 * a favor de las columnas reales. El error degrada hacia MÁS información,
 * nunca hacia menos.
 */
const FILA_BPR = {
  col_0: "SECURITY PLUS",
  RUN: "8253-8",
  "Patrimonio (1)": "121,651.67",
  Participes: "7,877",
  "Valor cuota": "2,213.30",
};

test("resumirTabla no imprime una columna que ninguna fila trae", () => {
  const texto = resumirTabla([FILA_BPR], ["Run Fondo", "Patrimonio", "Valor cuota"]);
  assert.ok(!texto.includes("Run Fondo"), "una columna que no existe no se anuncia en la cabecera");
  assert.ok(!/\|\s*\|/.test(texto), "ninguna celda queda vacía por un nombre equivocado");
});

test("resumirTabla cae de vuelta a las columnas REALES cuando la lista miente", () => {
  const texto = resumirTabla([FILA_BPR], ["Run Fondo", "Patrimonio", "Valor cuota"]);
  for (const real of Object.keys(FILA_BPR)) {
    assert.ok(texto.includes(real), `la columna real ${real} debe llegar al modelo`);
  }
  assert.ok(texto.includes("SECURITY PLUS"), "y su dato también");
});

test("una lista de columnas correcta se respeta tal cual", () => {
  // El lado opuesto. Quien conoce la tabla puede acotarla, y el rescate
  // solo se dispara cuando la lista nombra algo que no existe.
  const texto = resumirTabla([FILA_BPR], ["col_0", "Valor cuota"]);
  assert.equal(texto.split("\n")[0], "col_0 | Valor cuota");
  assert.ok(!texto.includes("Participes"), "no se agregan columnas que no pidieron");
});

test("una columna vacía DE VERDAD se sigue mostrando", () => {
  // El riesgo del rescate es tapar el vacío legítimo. Una columna que
  // existe y viene sin valor es un dato, y tiene que verse.
  const texto = resumirTabla([{ rut: "96639280", nombre: "" }], ["rut", "nombre"]);
  assert.equal(texto.split("\n")[0], "rut | nombre");
  assert.ok(texto.includes("96639280 | "), "la celda vacía se imprime, la columna no desaparece");
});

/*
 * Por qué acá NO hay una comprobación de clase sobre el fuente.
 *
 * La tentación era barrer `src/tools` buscando listas de columnas escritas
 * a mano y marcarlas. No sirve: un nombre correcto de planilla y uno
 * equivocado se ven idénticos en el texto. `Valor cuota` existe y
 * `Nombre Fondo` no, y ninguna regla sobre mayúsculas o espacios los
 * separa. Ese control marcaría código bueno, y un control con falsos
 * positivos se termina ignorando entero.
 *
 * El instrumento que SÍ distingue es el dato real, y vive en
 * `test/verify-endpoints.ts`, que llama cada tool contra la CMF. Ahí la
 * comprobación compara la lista pedida contra las claves que llegaron.
 */

/**
 * Las notas al pie de la planilla tienen que LLEGAR al modelo.
 *
 * Separarlas de las filas de datos arregla el total y la suma de montos,
 * pero botarlas sería peor que el defecto original. Esas notas llevan la
 * unidad de las cifras y el significado de los códigos, o sea lo único que
 * permite leer la tabla sin equivocarse por un factor de un millón. Y como
 * el modelo solo ve el texto, publicarlas nada más en el
 * `structuredContent` es lo mismo que botarlas.
 */
test("las notas al pie de la planilla llegan al texto, no solo al JSON", () => {
  const r = toolOkTabla({
    titulo: "BPR FM 2025-12",
    vacio: "sin datos",
    base: {},
    campo: "filas",
    filas: [{ fondo: "SECURITY PLUS", patrimonio: "121,651.67" }],
    notas: ["(1) Cifras en millones de pesos", "5: FM DE INVERSION EN INSTRUMENTOS DE CAPITALIZACION,"],
    offset: 0,
    limit: 10,
    tool: "cmf_fondos_mutuos_bpr",
  });
  const texto = r.content[0].type === "text" ? r.content[0].text : "";
  assert.match(texto, /Cifras en millones de pesos/, "la unidad tiene que verse");
  assert.match(texto, /INSTRUMENTOS DE CAPITALIZACION/, "y el significado del código también");
  const sc = r.structuredContent as Record<string, unknown>;
  assert.equal(sc.total, 1, "el total cuenta solo las filas de datos");
  assert.equal((sc.notas as string[]).length, 2, "y las notas viajan aparte en el JSON");
});

test("sin notas no se inventa una sección de notas", () => {
  const r = toolOkTabla({
    titulo: "BPR FM 2025-12",
    vacio: "sin datos",
    base: {},
    campo: "filas",
    filas: [{ fondo: "SECURITY PLUS" }],
    offset: 0,
    limit: 10,
    tool: "cmf_fondos_mutuos_bpr",
  });
  const texto = r.content[0].type === "text" ? r.content[0].text : "";
  assert.ok(!/Notas de la planilla/.test(texto), "sin notas el texto no cambia");
});
