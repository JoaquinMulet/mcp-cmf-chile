/**
 * Las 7 tools de estados financieros e indicadores que la CMF sirve con un
 * grid de Google Charts.
 *
 * El 2 de septiembre de 2026 las 7 enviaban el formulario a la propia página
 * índice, así que la CMF devolvía el índice intacto y el parser de tablas
 * entregaba las etiquetas del formulario como si fueran datos, con total
 * mayor que cero y sin error. La página de resultados real es OTRA (la
 * declara el atributo action del formulario f1), a veces lleva un token en
 * la query, y los datos no viajan en una <table>: viajan en un objeto
 * `dataAsJson` dentro de un <script>.
 *
 * Los fixtures son páginas reales de la CMF recortadas en FILAS del grid,
 * nunca en columnas, con el HTML que las rodea.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gridDataAsJsonAJson, htmlTablaAJson } from "../src/client/parsers.js";
import { enviarFormularioLegacy } from "../src/client/cmf-client.js";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

const FIX = join(import.meta.dirname, "fixtures");
const leer = (n: string) => readFileSync(join(FIX, n), "utf-8");
const ENV = { CMF_RATE_LIMIT_MS: "0" };

/**
 * Mock de fetch que decide por URL, no por orden. el índice cacheado puede
 * ahorrarse la primera llamada y el orden dejaría de ser predecible.
 */
function conFetchPorUrl(respuestas: Array<{ si: (url: string) => boolean; body: string }>) {
  const original = globalThis.fetch;
  const llamadas: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
    llamadas.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    const r = respuestas.find((x) => x.si(url));
    if (!r) return new Response("<html>sin ruta</html>", { status: 404 });
    return new Response(r.body, { status: 200, headers: { "Content-Type": "text/html" } });
  }) as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

async function clienteConectado() {
  const server = createServer(ENV);
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" }, {});
  await client.connect(clientT);
  return client;
}

// ---------- parser ----------

test("gridDataAsJsonAJson: el grid de Copec sale como filas por cuenta con su valor numérico", () => {
  const g = gridDataAsJsonAJson(leer("sa_eeff_ifrs2grid-copec-2024-12.html"));
  assert.ok(g, "la página trae dataAsJson y el parser tiene que encontrarlo");
  assert.deepEqual(g.entidades, ["EMPRESAS COPEC S.A. 12 / 2024"]);
  const efectivo = g.filas.find((f) => f.cuenta === "Efectivo y equivalentes al efectivo");
  assert.ok(efectivo, `falta la cuenta de efectivo entre ${g.filas.map((f) => f.cuenta).join(" | ")}`);
  assert.equal(efectivo["EMPRESAS COPEC S.A. 12 / 2024"], "2070930000");
  const moneda = g.filas.find((f) => f.cuenta === "Moneda");
  assert.equal(moneda?.["EMPRESAS COPEC S.A. 12 / 2024"], "DOLAR");
  // La etiqueta viene con entidades HTML y sangría, y el dato las pierde.
  assert.ok(g.filas.some((f) => f.cuenta === "Estado de situación financiera [sinopsis]"));
});

test("gridDataAsJsonAJson: con porEntidad cada columna del grid es una fila y las cuentas son sus campos", () => {
  const g = gridDataAsJsonAJson(leer("intermediarios_indicadores-todas-2024-12.html"), { porEntidad: true });
  assert.ok(g);
  assert.equal(g.entidades.length, 33);
  assert.equal(g.filas.length, 33);
  const primera = g.filas[0];
  assert.ok(typeof primera.entidad === "string" && primera.entidad.length > 0);
  assert.ok("RUT" in primera, `campos: ${Object.keys(primera).join(", ")}`);
  assert.ok("Rentabilidad sobre el patrimonio" in primera);
});

test("gridDataAsJsonAJson: la nota de unidad de la página viaja con el grid", () => {
  const g = gridDataAsJsonAJson(leer("seg_gen_fecu1-todas-2024-12.html"));
  assert.ok(g);
  assert.equal(g.entidades.length, 26);
  assert.match(g.nota ?? "", /^Cifras en miles de pesos del periodo/);
});

test("gridDataAsJsonAJson: los decimales sin cero de la CMF («-.9771») no tumban el grid", () => {
  // La página de indicadores IFRS de SA escribe los ratios negativos menores
  // que 1 como -.9771, que JavaScript acepta y JSON no. Con eso el grid entero
  // se perdía y la tool decía «la fuente no devolvió datos parseables».
  const g = gridDataAsJsonAJson(leer("sa_indicadores_ifrs-todas-2024-12.html"), { porEntidad: true });
  assert.ok(g, "la página trae el grid y el parser tiene que leerlo");
  assert.equal(g.entidades.length, 303);
  const conNegativo = g.filas.find((f) => Object.values(f).includes("-0.9771"));
  assert.ok(conNegativo, "el -.9771 del grid tiene que salir como -0.9771");
});

test("gridDataAsJsonAJson: los números con cero adelante de la CMF («03») no tumban el grid", () => {
  // El grid de dividendos escribe el mes como {v:03}. JavaScript lo lee
  // como 3 y JSON lo rechaza, y con eso cmf_dividendos decía «sin
  // dividendos» para todo el mercado en 2025.
  const g = gridDataAsJsonAJson(leer("acc_dividendos1grid-todas-2025.html"));
  assert.ok(g, "la página trae el grid y el parser tiene que leerlo");
  assert.equal(g.entidades.length, 21);
  const numero = g.filas.find((f) => f.cuenta === "Número de dividendo");
  assert.ok(numero);
  assert.ok(Object.values(numero).includes("3"), "el 03 del grid tiene que salir como 3");
});

test("gridDataAsJsonAJson: los escapes de JavaScript y el cierre del literal no dependen de la forma exacta", () => {
  // Lo encontró la revisión adversarial del 2 de septiembre de 2026. \u00e1
  // salía como «u00e1», y un espacio después del ; dejaba el grid en null.
  const pagina = (literal: string) => `<html><script>var dataAsJson = \n${literal}\n;\n data = new google.visualization.DataTable(dataAsJson);</script></html>`;
  const g = gridDataAsJsonAJson(
    pagina("{cols:[{id:'A',label:'Cuentas',type:'string'},{id:'B',label:'<a href=\\'x.php?a=1&b=2\\'>Raz\\u00f3n \\x41</a> 12 / 2024',type:'number'}],rows:[{c:[{v:'l\\'s: a'},{v:-.5,f:'-0,5'}]},{c:[{v:'entidad'},{v:03,f:'3'}]},{c:[{v:''},{v:'',f:' '}]},{c:[{v:'cuenta'},{v:1e3,f:'1.000'}]}]}"),
  );
  assert.ok(g);
  assert.deepEqual(g.entidades, ["Razón A 12 / 2024"]);
  assert.deepEqual(g.filas, [
    { cuenta: "l's: a", "Razón A 12 / 2024": "-0.5" },
    { cuenta: "entidad", "Razón A 12 / 2024": "3" },
    { cuenta: "cuenta", "Razón A 12 / 2024": "1000" },
  ]);
  // Por entidad, una etiqueta que se llama como el campo reservado no lo pisa.
  const t = gridDataAsJsonAJson(pagina("{cols:[{id:'A',label:'Cuentas'},{id:'B',label:'X'}],rows:[{c:[{v:'entidad'},{v:'A'}]},{c:[{v:''},{v:'sin etiqueta'}]}]}"), { porEntidad: true });
  assert.deepEqual(t?.filas, [{ entidad: "X", "entidad (2)": "A", "(sin etiqueta 2)": "sin etiqueta" }]);
});

test("enviarFormularioLegacy: una respuesta 5xx del índice no se cachea", async () => {
  // Con la página de error cacheada, la tool seguía muerta todo el TTL
  // aunque la CMF ya hubiera vuelto. Lo encontró la revisión adversarial.
  const indice = "/institucional/estadisticas/prueba_5xx_index.php";
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = (async (entrada: string | URL | Request) => {
    const url = String(entrada);
    if (url.includes("prueba_5xx_index.php")) {
      llamadas++;
      return llamadas <= 3
        ? new Response("<html>error</html>", { status: 503 })
        : new Response(leer("seg_gen_fecu_index.html"), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response(leer("seg_gen_fecu1-todas-2024-12.html"), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(enviarFormularioLegacy({ indice, cuerpo: {} }, ENV), /formulario/);
    const html = await enviarFormularioLegacy({ indice, cuerpo: {} }, ENV);
    assert.ok(html.includes("var dataAsJson"), "la segunda llamada tiene que volver a pedir el índice y funcionar");
  } finally {
    globalThis.fetch = original;
  }
});

test("gridDataAsJsonAJson: una página SIN grid devuelve null, nunca filas", () => {
  assert.equal(gridDataAsJsonAJson(leer("seg_gen_fecu_index.html")), null);
  assert.equal(gridDataAsJsonAJson("<html><body>sin nada</body></html>"), null);
});

// ---------- cliente ----------

test("enviarFormularioLegacy: envía a la URL del action de f1, con el token que trae el índice", async () => {
  const mock = conFetchPorUrl([
    { si: (u) => u.includes("intermediarios_indicadoresfinancieros_index.php"), body: leer("intermediarios_indicadores_index.html") },
    { si: () => true, body: leer("intermediarios_indicadores-todas-2024-12.html") },
  ]);
  try {
    const html = await enviarFormularioLegacy(
      {
        indice: "/institucional/estadisticas/merc_valores/intermediarios_indicadores_ifrs/intermediarios_indicadoresfinancieros_index.php",
        parametrosIndice: { lang: "es" },
        cuerpo: { tiposociedad: "0", "sociedad[]": ["0"], anno1: "2024" },
      },
      ENV,
    );
    assert.ok(html.includes("var dataAsJson"));
    const post = mock.llamadas.find((l) => l.method === "POST");
    assert.ok(post, "tiene que haber un POST");
    assert.equal(
      post.url,
      "https://www.cmfchile.cl/institucional/estadisticas/merc_valores/intermediarios_indicadores_ifrs/intermediarios_indicadoresfinancieros.php?auth=&send=&lang=es&control=Berlin36",
    );
    assert.ok(post.body.includes("sociedad%5B%5D=0"));
  } finally {
    mock.restaurar();
  }
});

test("enviarFormularioLegacy: si el índice no trae el formulario, falla nombrando la página", async () => {
  const mock = conFetchPorUrl([{ si: () => true, body: "<html><body>portal cambiado</body></html>" }]);
  try {
    await assert.rejects(
      enviarFormularioLegacy({ indice: "/institucional/estadisticas/no_existe_index.php", cuerpo: {} }, ENV),
      /formulario/,
    );
  } finally {
    mock.restaurar();
  }
});

// ---------- tool de punta a punta ----------

test("cmf_seguros_eeff: entrega las cuentas del grid, no las etiquetas del formulario", async () => {
  const mock = conFetchPorUrl([
    { si: (u) => u.includes("seg_gen_fecu_index.php"), body: leer("seg_gen_fecu_index.html") },
    { si: (u) => u.includes("seg_gen_fecu1.php"), body: leer("seg_gen_fecu1-todas-2024-12.html") },
  ]);
  try {
    const client = await clienteConectado();
    const r = await client.callTool({ name: "cmf_seguros_eeff", arguments: { anio1: "2024", anio2: "2024" } });
    assert.equal(r.isError ?? false, false, JSON.stringify(r.content));
    const sc = r.structuredContent as { filas: Record<string, string>[]; total: number; notas?: string[] };
    assert.equal(sc.total, 12);
    const rut = sc.filas.find((f) => f.cuenta === "RUT");
    assert.ok(rut, JSON.stringify(sc.filas[0]));
    assert.equal(rut["BCI 12 / 2024"], "99.147.000-K");
    assert.ok(sc.filas.every((f) => !JSON.stringify(f).includes("Crear cartera")));
    assert.match(sc.notas?.[0] ?? "", /miles de pesos/);
    const texto = (r.content as Array<{ type: string; text?: string }>)[0].text ?? "";
    assert.ok(texto.includes("miles de pesos"), "la unidad tiene que estar en el TEXTO que lee el modelo");
  } finally {
    mock.restaurar();
  }
});

test("cmf_seguros_eeff: si la CMF devuelve una página sin grid, la respuesta es un error de fuente, no cero filas", async () => {
  const mock = conFetchPorUrl([{ si: () => true, body: leer("seg_gen_fecu_index.html") }]);
  try {
    const client = await clienteConectado();
    const r = await client.callTool({ name: "cmf_seguros_eeff", arguments: { anio1: "2024", anio2: "2024" } });
    assert.equal(r.isError, true);
    const texto = (r.content as Array<{ type: string; text?: string }>)[0].text ?? "";
    assert.match(texto, /no devolvió datos parseables/);
  } finally {
    mock.restaurar();
  }
});

// ---------- enlaces en onClick ----------

test("htmlTablaAJson: el enlace que la ficha esconde en onClick=\"ventana('...')\" sale en url", () => {
  // La pestaña de actas de junta deja href="#" y abre el documento por
  // JavaScript. Sin esto la tool entregaba url "#" y el agente no tenía
  // camino al PDF.
  const filas = htmlTablaAJson(leer("entidad-juntas-copec-78.html"));
  assert.equal(filas.length, 6);
  assert.equal(filas[0].FECHA, "23/04/2025");
  assert.match(filas[0].url, /^https:\/\/www\.cmfchile\.cl\/sitio\/aplic\/serdoc\/ver_sgd\.php\?s567=/);
});

test("htmlTablaAJson: un href sin comillas (buscador de sanciones) también sale en url", () => {
  const filas = htmlTablaAJson(leer("sanciones_mercados_entidad-2026.html"));
  assert.ok(filas.length >= 3);
  assert.equal(filas[0]["N&ordm;"] ?? filas[0]["Nº"], "8941");
  assert.match(filas[0].url, /^https:\/\/www\.cmfchile\.cl\/sitio\/aplic\/serdoc\/ver_sgd\.php\?s567=/);
});

test("cmf_empresa_juntas: envía los códigos de junta y documento que la ficha exige", async () => {
  const mock = conFetchPorUrl([{ si: () => true, body: leer("entidad-juntas-copec-78.html") }]);
  try {
    const client = await clienteConectado();
    const r = await client.callTool({ name: "cmf_empresa_juntas", arguments: { rut: "90690000", desde: "2020-01-01", hasta: "2025-12-31" } });
    assert.equal(r.isError ?? false, false);
    const post = mock.llamadas.find((l) => l.method === "POST");
    assert.ok(post);
    assert.ok(post.body.includes("tipo_junta=O") && post.body.includes("tipo_documento=A"), post.body);
    const sc = r.structuredContent as { actas: Array<Record<string, string>>; total: number };
    assert.equal(sc.total, 6);
    assert.match(sc.actas[0].url, /ver_sgd\.php/);
  } finally {
    mock.restaurar();
  }
});

// ---------- parámetros que la CMF sí exige ----------

test("cmf_empresa_registro_productos: lee la pestaña 100 del emisor y arrastra el número de inscripción a cada documento", async () => {
  // La pestaña 31 no es del emisor. la CMF devolvía el padrón de la Bolsa de
  // Productos, 471 filas iguales para Copec y para Colbún.
  const mock = conFetchPorUrl([{ si: () => true, body: leer("entidad-titulos-deuda-copec-100.html") }]);
  try {
    const client = await clienteConectado();
    const r = await client.callTool({ name: "cmf_empresa_registro_productos", arguments: { rut: "90690000" } });
    assert.equal(r.isError ?? false, false);
    assert.ok(mock.llamadas[0].url.includes("pestania=100"), mock.llamadas[0].url);
    const sc = r.structuredContent as { productos: Array<Record<string, string>>; total: number };
    assert.ok(sc.total >= 4);
    for (const p of sc.productos) {
      assert.equal(Object.values(p)[0], "1186", JSON.stringify(p));
      assert.match(p.url, /ver_sgd\.php/);
    }
  } finally {
    mock.restaurar();
  }
});

test("cmf_liquidez_intermediarios: arma rango_fechas con cada día del rango, como el JavaScript del formulario", async () => {
  const mock = conFetchPorUrl([{ si: () => true, body: leer("liquidez-cobol-2024-03.html") }]);
  try {
    const client = await clienteConectado();
    const r = await client.callTool({ name: "cmf_liquidez_intermediarios", arguments: { desde: "2024-03-01", hasta: "2024-03-04", intermediario: "COBOL" } });
    const url = decodeURIComponent(mock.llamadas[0].url);
    assert.ok(url.includes("rango_fechas=20240301%20240302%20240303%20240304%"), url);
    assert.ok(url.includes("sel_inter=COBOL") && url.includes("consulta=1"), url);
    // Una tabla por día. la fecha del título viaja en cada fila y la
    // cabecera real da las columnas.
    const sc = r.structuredContent as { filas: Array<Record<string, string>>; total: number };
    assert.equal(sc.total, 3);
    assert.equal(sc.filas[0].fecha, "01/03/2024");
    assert.equal(sc.filas[0].Intermediario, "BANCHILE CORREDORES DE BOLSA S.A.");
    assert.equal(sc.filas[0]["Liq. General (veces)"], "1,25");
    assert.equal(sc.filas[2].fecha, "04/03/2024");
    const largo = await client.callTool({ name: "cmf_liquidez_intermediarios", arguments: { desde: "2024-01-01", hasta: "2024-12-31" } });
    assert.equal(largo.isError, true, "más de 31 días tiene que ser un error dicho, no un cero mudo");
  } finally {
    mock.restaurar();
  }
});

// ---------- comprobación de clase ----------

const DIR = join(import.meta.dirname, "..", "src", "tools");
/** Un POST directo a una página índice (`..._index.php`) es el defecto. */
const POST_AL_INDICE = /postLegacy(?:Binario)?\(\s*\n?\s*"[^"]*_index\.php"/;

test("ninguna tool envía un POST a una página índice de la CMF", () => {
  const culpables: string[] = [];
  for (const archivo of readdirSync(DIR).filter((f) => f.endsWith(".ts"))) {
    const fuente = readFileSync(join(DIR, archivo), "utf-8");
    const m = POST_AL_INDICE.exec(fuente);
    if (m) culpables.push(`${archivo}:${fuente.slice(0, m.index).split("\n").length}`);
  }
  assert.deepEqual(
    culpables,
    [],
    `estas tools envían el formulario al índice y reciben el índice de vuelta; use enviarFormularioLegacy:\n${culpables.join("\n")}`,
  );
});

test("la comprobación anterior SÍ puede fallar", () => {
  const falso = 'const html = await postLegacy(\n  "/institucional/estadisticas/sa_fecu_index.php",\n  { lang: "es" },';
  assert.ok(POST_AL_INDICE.test(falso));
  assert.ok(!POST_AL_INDICE.test('await postLegacy("/institucional/estadisticas/sa_fecu1grid.php", {})'));
});
