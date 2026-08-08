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
