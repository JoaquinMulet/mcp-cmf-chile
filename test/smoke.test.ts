import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import { createMcpHandler, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

const ENV = {};

async function clienteConectado() {
  const server = createServer(ENV);
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" }, {});
  await client.connect(clientT);
  return { server, client };
}

test("tools/list registra las tools del catálogo", async () => {
  const { client } = await clienteConectado();
  const res = await client.listTools();
  const names = res.tools.map((t) => t.name);
  for (const prefijo of [
    "cmf_api_",
    "cmf_buscar_entidad",
    "cmf_empresa_eeff",
    "cmf_empresa_hechos",
    "cmf_fondos_mutuos_catalogo",
    "cmf_fondos_mutuos_bpr",
    "cmf_fondos_comisiones_maximas",
    "cmf_fondos_inversion_eeff_ifrs",
    "cmf_normativa_buscar",
    "cmf_seguros_eeff",
    "cmf_seguros_rentas_vitalicias",
    "cmf_xbrl_taxonomias",
    "cmf_documento_descargar",
    "cmf_bancos_tasas",
    "cmf_empresa_paquete",
    "cmf_empresa_paquete_documentos",
    "cmf_fondos_paquete_mensual",
    "cmf_catalogo_entidades",
  ]) {
    assert.ok(
      names.some((n) => n.startsWith(prefijo) || n === prefijo),
      `falta tool con prefijo/nombre ${prefijo}`,
    );
  }
  assert.ok(names.length >= 82, `esperado >= 82 tools, hay ${names.length}`);
});

test("prompts/list registra los 3 prompts", async () => {
  const { client } = await clienteConectado();
  const res = await client.listPrompts();
  const names = res.prompts.map((p) => p.name);
  assert.deepEqual(
    names.sort(),
    ["cmf_analizar_empresa", "cmf_comparar_fondos", "cmf_indicadores_economicos"],
  );
});

test("resources/templates/list registra los templates cmf://", async () => {
  const { client } = await clienteConectado();
  const res = await client.listResourceTemplates();
  const uris = res.resourceTemplates.map((r) => r.uriTemplate);
  for (const tpl of [
    "cmf://entidades/{rut}",
    "cmf://indicadores/{serie}/{anio}/{mes}",
    "cmf://fondos/{run}",
    "cmf://norma/{id}",
    "cmf://documento/{id}",
    "cmf://captcha/{id}",
  ]) {
    assert.ok(uris.includes(tpl), `falta template ${tpl}`);
  }
});

test("tool sin red: cmf_xbrl_taxonomias responde OK", async () => {
  const { client } = await clienteConectado();
  const res = await client.callTool({ name: "cmf_xbrl_taxonomias", arguments: {} });
  const texto = res.content?.[0]?.text ?? "";
  assert.match(texto, /CL-CI/);
  assert.ok(!res.isError, "no debe ser error");
});

test("tool sin red: cmf_documento_info responde OK", async () => {
  const { client } = await clienteConectado();
  const res = await client.callTool({
    name: "cmf_documento_info",
    arguments: { s567: "abcdef0123456789" },
  });
  assert.ok(!res.isError);
});

test("validación de inputs: rut inválido devuelve isError (SEP-1303)", async () => {
  const { client } = await clienteConectado();
  const res = await client.callTool({
    name: "cmf_empresa_info",
    arguments: { rut: "abc" },
  });
  assert.ok(res.isError, "input inválido debe ser tool execution error");
});

test("HTTP stateless: server/discover + tools/call via createMcpHandler", async () => {
  const handler = createMcpHandler(() => createServer(ENV));
  const base = "http://localhost/mcp";
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
  };

  const discover = await handler.fetch(
    new Request(base, {
      method: "POST",
      headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "server/discover" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: meta } }),
    }),
  );
  assert.equal(discover.status, 200, `discover HTTP ${discover.status}`);
  const d = await discover.json();
  assert.ok(Array.isArray(d.result?.supportedVersions), "discover debe incluir supportedVersions");

  const call = await handler.fetch(
    new Request(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "cmf_xbrl_taxonomias",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "cmf_xbrl_taxonomias", arguments: {}, _meta: meta },
      }),
    }),
  );
  assert.equal(call.status, 200, `tools/call HTTP ${call.status}`);
  const c = await call.json();
  assert.ok(!c.error, `tools/call error: ${JSON.stringify(c.error ?? "").slice(0, 300)}`);
  const texto = c.result?.content?.[0]?.text ?? "";
  assert.match(texto, /CL-CI/);
});

/**
 * Los diccionarios del pie de las planillas de fondos mutuos.
 *
 * Antes vivían solo en la fila 266 de un Excel, mezclados con los datos.
 * Un agente que leyera el tipo de fondo como número no tenía cómo saber
 * que 1 es deuda de muy corto plazo y 5 es acciones, que es justo la
 * pregunta más común que se le hace a este servidor. Y el patrimonio no
 * viene en pesos, así que leerlo como pesos se equivoca por un factor de
 * un millón sin que nada avise.
 */
test("el recurso de tipos de fondo mutuo trae los 8 códigos y la unidad", async () => {
  const { client } = await clienteConectado();
  const lista = await client.listResources();
  const uris = lista.resources.map((r) => r.uri);
  assert.ok(uris.includes("cmf://fondos-mutuos/tipos"), `falta el recurso, hay: ${uris.join(", ")}`);

  const r = await client.readResource({ uri: "cmf://fondos-mutuos/tipos" });
  const texto = r.contents?.[0]?.text ?? "";
  const datos = JSON.parse(String(texto));
  assert.equal(datos.tipos.length, 8, "los 8 códigos de la CMF, del 1 al 8");
  assert.deepEqual(
    datos.tipos.map((t: { codigo: string }) => t.codigo),
    ["1", "2", "3", "4", "5", "6", "7", "8"],
  );
  assert.match(datos.tipos[4].nombre, /CAPITALIZACION/, "el 5 es el de instrumentos de capitalización");
  // La unidad NO es la misma en todos los informes. El boletín viene en
  // millones y las inversiones en miles, así que un único enunciado global
  // sería falso para la mitad de las tools.
  assert.match(JSON.stringify(datos.unidades), /millones/i);
  assert.match(JSON.stringify(datos.unidades), /miles/i);
  assert.match(JSON.stringify(datos), /notas/, "y tiene que decir dónde está la unidad exacta de cada respuesta");
});

test("las tools de fondos mutuos nombran el recurso de tipos", async () => {
  // Un recurso que ninguna tool nombra es letra muerta: nadie lo va a
  // encontrar en el momento en que lo necesita.
  const { client } = await clienteConectado();
  const tools = await client.listTools();
  for (const nombre of ["cmf_fondos_mutuos_catalogo", "cmf_fondos_mutuos_bpr"]) {
    const t = tools.tools.find((x) => x.name === nombre);
    assert.ok(t, `falta la tool ${nombre}`);
    assert.match(String(t.description), /cmf:\/\/fondos-mutuos\/tipos/, `${nombre} debe nombrar el recurso`);
  }
});

test("el recurso de uso dice cómo armar una serie histórica y cuál es la vía de escape", async () => {
  // Lo pidió una prueba externa el 28 de agosto de 2026. no hay tool que
  // entregue el valor cuota mes a mes, y quien la necesita tiene que
  // descubrir solo que la vía es repetir el boletín por cada mes. Sin eso
  // escrito, cada agente vuelve a perder el mismo rato.
  // Se lee por el cliente, no del archivo fuente, para probar lo que de
  // verdad recibe un agente y no lo que el código parece decir.
  const { client } = await clienteConectado();
  const r = await client.readResource({ uri: "cmf://skill/uso" });
  const skill = String(r.contents?.[0]?.text ?? "");
  assert.match(skill, /serie hist/i, "tiene que decir cómo se arma una serie de varios meses");
  assert.match(skill, /fm\.fm_bpr\.php/, "y nombrar el archivo original de la CMF como vía de escape");
  assert.match(skill, /cmf:\/\/fondos-mutuos\/tipos/, "y apuntar al diccionario de tipos");
  assert.match(skill, /notas/, "y decir dónde viaja la unidad de las cifras");
});
