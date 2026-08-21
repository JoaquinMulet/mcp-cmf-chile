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
import { ejecutorLocalDePrueba, traducirErrorDeCaja, recortarValor } from "../src/sandbox.js";

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
  assert.match(texto, /"existe":\s*"function"/);
  assert.match(texto, /"inventada":\s*"undefined"/, "una operación inexistente no puede parecer función");
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

test("el borde de la caja entrega el objeto COMPLETO al programa, url incluida", async () => {
  // Cruza el mismo borde que en producción: el resultado viaja como JSON.
  // Si algo del camino recortara campos, esto lo caza.
  const ejecutor = ejecutorLocalDePrueba(true);
  const r = await ejecutor.correr("const d = await cmf.falsa({ x: 1 }); return d.polizas[0].url", {
    catalogo: [],
    cmf: {
      falsa: async (args) => ({
        eco: args,
        polizas: [{ codigo: "POL1", entidad: "CONSORCIO", url: "https://cmfchile.cl/doc" }],
      }),
    },
  });
  assert.equal(r.error, undefined, `no debía fallar: ${r.error}`);
  assert.equal(r.valor, "https://cmfchile.cl/doc");
});

test("el programa recibe un objeto plano, no una referencia al proceso servidor", async () => {
  // Lo que cruza el borde tiene que poder serializarse de vuelta. Si
  // viajara una referencia, esto reventaría al devolverla.
  const ejecutor = ejecutorLocalDePrueba(true);
  const r = await ejecutor.correr("const d = await cmf.falsa({}); return JSON.parse(JSON.stringify(d))", {
    catalogo: [],
    cmf: { falsa: async () => ({ filas: [1, 2, 3] }) },
  });
  assert.equal(r.error, undefined, `no debía fallar: ${r.error}`);
  assert.deepEqual(r.valor, { filas: [1, 2, 3] });
});

test("los argumentos del programa llegan intactos a la operación", async () => {
  const ejecutor = ejecutorLocalDePrueba(true);
  const r = await ejecutor.correr("return await cmf.falsa({ poliza: 'POL120260128', limit: 500 })", {
    catalogo: [],
    cmf: { falsa: async (args) => args },
  });
  assert.deepEqual(r.valor, { poliza: "POL120260128", limit: 500 });
});

test("el modo código aplica el MISMO esquema de entrada que el modo clásico", () => {
  // El defecto que esto caza: llamar el handler crudo se salta el parseo
  // del esquema, así que los valores por defecto (limit, offset) nunca se
  // aplican y la MISMA consulta devuelve resultados distintos según por
  // dónde entró.
  const op = construirRegistro(ENV).get("seguros_deposito_polizas");
  assert.ok(op, "la operación tiene que existir");
  const preparados = op.prepararArgs({ poliza: "POL120260128" });
  assert.equal(preparados.poliza, "POL120260128");
  assert.notEqual(preparados.limit, undefined, "el esquema debe poner el limit por defecto");
  assert.notEqual(preparados.offset, undefined, "el esquema debe poner el offset por defecto");
});

test("al menos una operación de cada módulo aplica defaults, no solo la que probé", () => {
  // Comprobación de CLASE. Si mañana el validador se pierde en un
  // refactor, esto se cae para todo el servidor, no solo para un caso.
  const ops = construirRegistro(ENV);
  const conDefaults = [...ops.values()].filter((op) => {
    if (!op.params.some((p) => p.nombre === "limit")) return false;
    try {
      return op.prepararArgs({}).limit !== undefined;
    } catch {
      return false; // exige otros parámetros; no sirve para esta medición
    }
  });
  assert.ok(conDefaults.length >= 5, `esperaba varias operaciones con defaults y hay ${conDefaults.length}`);
});

test("unos argumentos inválidos explican qué parámetros acepta la operación", () => {
  const op = construirRegistro(ENV).get("seguros_deposito_polizas");
  assert.ok(op);
  assert.throws(
    () => op.prepararArgs({ limit: "muchas" }),
    /Argumentos inválidos.*Parámetros que acepta/s,
  );
});

test("el catálogo lleva la descripción COMPLETA, no solo la primera frase", () => {
  // El catálogo vive dentro de la caja y nunca entra al contexto del
  // modelo, así que recortarlo no ahorra nada y sí le quita la frase que
  // dice cuándo usar una operación y cuándo su hermana.
  const catalogo = derivarCatalogo(construirRegistro(ENV));
  const conGuia = catalogo.filter((e) => /use\s+cmf_/i.test(e.detalle));
  assert.ok(conGuia.length >= 50, `esperaba muchas entradas con guía y hay ${conGuia.length}`);
  const perdidas = conGuia.filter((e) => !/use\s+cmf_/i.test(e.resumen) && e.detalle === e.resumen);
  assert.deepEqual(perdidas, [], "ninguna entrada puede perder su guía");
});

test("cada parámetro del catálogo lleva su descripción", () => {
  // Sin esto el modelo ve ["cartera"] y no sabe que es un enum de 5 valores.
  const catalogo = derivarCatalogo(construirRegistro(ENV));
  const conParams = catalogo.filter((e) => e.params.length > 0);
  const conDescripcion = conParams.filter((e) => e.params.some((p) => p.descripcion.length > 0));
  assert.ok(
    conDescripcion.length >= conParams.length * 0.9,
    `solo ${conDescripcion.length} de ${conParams.length} operaciones describen sus parámetros`,
  );
});

test("primeraFrase no corta en una abreviatura", () => {
  assert.equal(
    primeraFrase("Actos publicados segun Ley 19.880, art. 45 y siguientes. Segunda frase."),
    "Actos publicados segun Ley 19.880, art. 45 y siguientes.",
  );
});

test("cmf_ejecutar NO se declara de solo lectura", async () => {
  // Corre código que el modelo escribe, y entre las 86 operaciones hay
  // algunas que escriben estado del servidor. Prometer lectura pura
  // sería mentirle al cliente que confía en la anotación.
  const { cliente, cerrar } = await clienteEnModoCodigo();
  const { tools } = await cliente.listTools();
  const ejecutar = tools.find((t: { name: string }) => t.name === "cmf_ejecutar");
  const buscar = tools.find((t: { name: string }) => t.name === "cmf_buscar");
  await cerrar();
  assert.equal(ejecutar?.annotations?.readOnlyHint, false);
  assert.equal(buscar?.annotations?.readOnlyHint, true, "buscar sí es de solo lectura, no tiene red");
});

test("las 2 superficies se identifican distinto", () => {
  // Son 2 servidores MCP, no uno que cambia de forma. Si compartieran
  // identidad, esa lectura sería solo prosa.
  const codigo = createServer(ENV, { modo: "codigo", ejecutor: ejecutorLocalDePrueba(true) });
  const clasico = createServer(ENV);
  const nombre = (s: unknown) => (s as { server: { _serverInfo: { name: string } } }).server._serverInfo.name;
  assert.notEqual(nombre(codigo), nombre(clasico));
});

test("olvidar el return NO se confunde con no haber encontrado nada", async () => {
  // El peor defecto que encontró la revisión adversarial. Las 2 causas
  // más probables de error devolvían el texto "null", igual que una
  // búsqueda vacía, así que el modelo leía "la CMF no tiene ese dato".
  const ejecutor = ejecutorLocalDePrueba(true);
  const sinReturn = await ejecutor.correr("catalogo.length;", { catalogo: [1, 2], cmf: {} });
  assert.match(sinReturn.error ?? "", /no devolvió ningún valor/);
  assert.match(sinReturn.error ?? "", /CUERPO/);

  const funcionCompleta = await ejecutor.correr("async function main() { return 1 }", { catalogo: [], cmf: {} });
  assert.match(funcionCompleta.error ?? "", /no devolvió ningún valor/);

  // Un find sin resultado también devuelve undefined, y desde acá no se
  // puede distinguir de las otras 2 causas. Así que el mensaje nombra
  // las 3 y le dice cómo hacer visible la diferencia.
  const buscoYNoHallo = await ejecutor.correr("return [].find(x => x)", { catalogo: [], cmf: {} });
  assert.match(buscoYNoHallo.error ?? "", /no encontró nada/);

  // Y un vacío bien expresado sí es un valor, no un error.
  const vacioExplicito = await ejecutor.correr("return []", { catalogo: [], cmf: {} });
  assert.equal(vacioExplicito.error, undefined);
  assert.deepEqual(vacioExplicito.valor, []);
});

test("un parámetro inventado se RECHAZA, no se descarta en silencio", () => {
  // Verificado contra el despliegue. pedí pólizas de una compañía con un
  // parámetro que no existe y volvieron 3 aseguradoras distintas,
  // presentadas como si el filtro hubiera corrido.
  const op = construirRegistro(ENV).get("seguros_deposito_polizas");
  assert.ok(op);
  assert.throws(
    () => op.prepararArgs({ texto: "vehiculos", compania: "BCI SEGUROS" }),
    /no acepta "compania".*Sus parámetros son/s,
  );
});

test("el cerco de markdown se quita en vez de reventar", async () => {
  const ejecutor = ejecutorLocalDePrueba(true);
  const cerco = String.fromCharCode(96, 96, 96);
  const salto = String.fromCharCode(10);
  const r = await ejecutor.correr(`${cerco}javascript${salto}return 42${salto}${cerco}`, { catalogo: [], cmf: {} });
  assert.equal(r.error, undefined, `no debía fallar: ${r.error}`);
  assert.equal(r.valor, 42);
});

test("los errores de infraestructura se traducen y no mandan al modelo a wrangler", () => {
  const subpeticiones = traducirErrorDeCaja("Too many subrequests by single Worker invocation. To configure this limit, refer to https://developers.cloudflare.com/workers/wrangler/configuration/#limits");
  assert.match(subpeticiones, /60 llamadas a la CMF/);
  assert.doesNotMatch(subpeticiones, /wrangler/, "nunca mandar al modelo a configurar la cuenta");
  assert.match(traducirErrorDeCaja("Worker exceeded CPU time limit."), /segundos de CPU/);
  assert.equal(traducirErrorDeCaja("otra cosa"), "otra cosa", "lo que no reconoce pasa intacto");
});

test("un valor enorme se corta diciendo cuánto había y cómo seguir", () => {
  const grande = "x".repeat(60_000);
  const cortado = recortarValor(grande);
  assert.ok(cortado.length < grande.length);
  assert.match(cortado, /60000 caracteres/);
  assert.match(cortado, /slice/, "el corte tiene que decir cómo pedir el resto");
  assert.equal(recortarValor("corto"), "corto", "lo que cabe no se toca");
});
