/**
 * El modo código. 2 tools en vez de 86, y el modelo decide qué ve.
 *
 * Estas comprobaciones cubren las 3 promesas del rediseño.
 *
 * 1. Ninguna operación se pierde al pasar de 86 tools a 2.
 * 2. El catálogo se DERIVA del registro, así que no se puede desincronizar.
 * 3. El servidor no recorta. lo que la operación devuelve llega entero al
 *    programa, incluida la url del documento que antes se perdía.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createServer } from "../src/server.js";
import { construirRegistro, derivarCatalogo, primeraFrase } from "../src/registro.js";
import { datoDeOperacion } from "../src/tools/code-mode.js";
import { ejecutorLocalDePrueba } from "../src/sandbox.js";

const ENV = { CMF_RATE_LIMIT_MS: "0" };

/** Abre un cliente MCP contra un servidor en modo código. */
async function clienteEnModoCodigo() {
  const server = createServer(ENV, { modo: "codigo", ejecutor: ejecutorLocalDePrueba(true) });
  const [aCliente, aServidor] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({ name: "prueba", version: "1" });
  await Promise.all([server.connect(aServidor), cliente.connect(aCliente)]);
  return { cliente, cerrar: async () => { await cliente.close(); await server.close(); } };
}

/** Llama una tool y devuelve el texto que vería el modelo. */
async function llamar(cliente: Client, nombre: string, codigo: string): Promise<string> {
  const r = (await cliente.callTool({ name: nombre, arguments: { codigo } })) as {
    content: Array<{ type: string; text?: string }>;
  };
  return r.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

test("el registro captura TODAS las operaciones, ninguna se pierde", () => {
  const ops = construirRegistro(ENV);
  assert.ok(ops.size >= 80, `esperaba al menos 80 operaciones y hay ${ops.size}`);
  for (const op of ops.values()) {
    assert.ok(op.descripcion.length > 0, `${op.nombre} sin descripción`);
    assert.equal(typeof op.ejecutar, "function", `${op.nombre} sin función`);
  }
});

test("el modo código y el clásico exponen exactamente las mismas operaciones", async () => {
  // Si un día alguien agrega una tool solo al modo clásico, esto lo caza.
  const clasico = createServer(ENV);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "p", version: "1" });
  await Promise.all([clasico.connect(b), c.connect(a)]);
  const { tools } = await c.listTools();
  await c.close();
  await clasico.close();

  const enClasico = new Set(tools.map((t: { name: string }) => t.name.replace(/^cmf_/, "")));
  const enRegistro = new Set(construirRegistro(ENV).keys());
  const faltan = [...enClasico].filter((n) => !enRegistro.has(n));
  assert.deepEqual(faltan, [], `operaciones del modo clásico que el registro no ve: ${faltan.join(", ")}`);
});

test("el catálogo se deriva del registro y no puede desincronizarse", () => {
  const ops = construirRegistro(ENV);
  const catalogo = derivarCatalogo(ops);
  assert.equal(catalogo.length, ops.size, "el catálogo tiene que tener una entrada por operación");
  for (const entrada of catalogo) {
    assert.ok(ops.has(entrada.nombre), `${entrada.nombre} está en el catálogo pero no en el registro`);
    assert.ok(entrada.resumen.length > 0, `${entrada.nombre} sin resumen`);
  }
});

test("primeraFrase corta en el punto y no parte a la mitad", () => {
  assert.equal(primeraFrase("Hola mundo. Segunda frase."), "Hola mundo.");
  assert.equal(primeraFrase("Sin punto final"), "Sin punto final");
  assert.equal(primeraFrase("  Con   espacios  raros.  Y más. "), "Con espacios raros.");
});

test("el modo código expone SOLO 2 tools", async () => {
  const { cliente, cerrar } = await clienteEnModoCodigo();
  const { tools } = await cliente.listTools();
  const nombres = tools.map((t: { name: string }) => t.name).sort();
  assert.deepEqual(nombres, ["cmf_buscar", "cmf_ejecutar"]);
  await cerrar();
});

test("las 2 tools caben en el presupuesto de contexto", async () => {
  // El punto entero del rediseño. Si esto crece, el rediseño se perdió.
  const { cliente, cerrar } = await clienteEnModoCodigo();
  const { tools } = await cliente.listTools();
  const caracteres = JSON.stringify(tools).length;
  const tokensAprox = Math.round(caracteres / 3.5);
  await cerrar();
  assert.ok(tokensAprox < 1500, `las 2 tools cuestan ~${tokensAprox} tokens y el techo es 1500`);
});

test("cmf_buscar filtra el catálogo y devuelve solo lo pedido", async () => {
  const { cliente, cerrar } = await clienteEnModoCodigo();
  const texto = await llamar(
    cliente,
    "cmf_buscar",
    "return catalogo.filter(o => /deposito_polizas/.test(o.nombre)).map(o => o.nombre)",
  );
  assert.match(texto, /seguros_deposito_polizas/);
  // Y no arrastró el catálogo entero.
  assert.ok(texto.length < 500, `devolvió ${texto.length} caracteres, debía devolver solo el nombre`);
  await cerrar();
});

test("cmf_buscar no puede tocar la red, y lo dice con claridad", async () => {
  // La búsqueda solo ve el catálogo. Si el modelo intenta llamar una
  // operación desde ahí, el error tiene que enseñarle la salida.
  const { cliente, cerrar } = await clienteEnModoCodigo();
  const texto = await llamar(cliente, "cmf_buscar", "return await cmf.seguros_deposito_polizas({})");
  assert.match(texto, /ERROR del programa/);
  assert.match(texto, /cmf_ejecutar/, "el error debe decirle con cuál sí se llaman");
  await cerrar();
});

test("el proxy de operaciones no miente sobre lo que existe", async () => {
  const { cliente, cerrar } = await clienteEnModoCodigo();
  const texto = await llamar(
    cliente,
    "cmf_ejecutar",
    "return { existe: typeof cmf.seguros_deposito_polizas, inventada: typeof cmf.no_existe_esta }",
  );
  assert.match(texto, /"existe": "function"/);
  assert.match(texto, /"inventada": "undefined"/, "una operación inexistente no puede parecer función");
  await cerrar();
});

test("un error del programa vuelve como mensaje legible, no como caída", async () => {
  const { cliente, cerrar } = await clienteEnModoCodigo();
  const texto = await llamar(cliente, "cmf_ejecutar", "return await cmf.operacion_que_no_existe({})");
  assert.match(texto, /no existe/);
  assert.match(texto, /cmf_buscar/, "el error debe decirle cómo salir del problema");
  await cerrar();
});

test("console.log del programa llega al modelo", async () => {
  const { cliente, cerrar } = await clienteEnModoCodigo();
  const texto = await llamar(cliente, "cmf_buscar", "console.log('operaciones:', catalogo.length); return 'listo'");
  assert.match(texto, /operaciones: \d+/);
  assert.match(texto, /listo/);
  await cerrar();
});

test("el programa recibe el JSON COMPLETO de la operación, no el resumen en texto", () => {
  // Este es el defecto que costó un informe. La url viajaba en
  // structuredContent y el modelo solo veía la tabla de texto sin ella.
  const crudo = {
    content: [{ type: "text", text: "codigo | fecha | entidad\nPOL1 | hoy | CONSORCIO" }],
    structuredContent: { polizas: [{ codigo: "POL1", url: "https://cmfchile.cl/doc" }] },
  };
  const dato = datoDeOperacion("seguros_deposito_polizas", crudo) as { polizas: Array<{ url: string }> };
  assert.equal(dato.polizas[0]?.url, "https://cmfchile.cl/doc", "la url tiene que llegar al programa");
});

test("una operación que falla lanza con su mensaje, para que el programa lo capture", () => {
  const crudo = { content: [{ type: "text", text: "la CMF no respondió" }], isError: true };
  assert.throws(
    () => datoDeOperacion("cualquiera", crudo),
    /cualquiera falló.*la CMF no respondió/,
  );
});

test("el modo código se niega a arrancar sin caja aislada", () => {
  // Fallo ruidoso. Ejecutar código del modelo sin frontera no es una
  // degradación aceptable, es un agujero.
  assert.throws(() => createServer(ENV, { modo: "codigo" }), /exige un ejecutor/);
});

test("el ejecutor local se niega a correr si no se le pide a propósito", () => {
  assert.throws(() => ejecutorLocalDePrueba(false), /no aísla nada/);
});
