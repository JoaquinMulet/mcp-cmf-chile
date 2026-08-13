/**
 * Gate de calidad de definiciones de tools (TDQS de Glama + spec MCP).
 * Falla si: falta annotations, falta outputSchema, description corta o igual al
 * nombre, o algún parámetro sin .describe(). Nace verde; cualquier degradación
 * futura lo pone rojo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

const ENV = {};

async function clienteConectado() {
  const server = createServer(ENV);
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "tdqs-gate", version: "1.0.0" }, {});
  await client.connect(clientT);
  return { server, client };
}

function palabrasDe(descripcion: string): string[] {
  return descripcion
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z]+/g) ?? [];
}

const VERBOS_ESPERADOS = new Set([
  "devuelve", "lista", "busca", "descarga", "consulta", "obtiene", "entrega",
  "muestra", "genera", "arma", "navega", "envia", "calcula", "resume", "registra",
  "formatea", "convierte", "extrae", "verifica", "planifica",
]);

test("TDQS gate: toda tool con description robusta, annotations, outputSchema y parámetros descritos", async () => {
  const { client } = await clienteConectado();
  const res = await client.listTools();
  const tools = res.tools;

  assert.ok(tools.length >= 86, `esperadas >= 86 tools, hay ${tools.length}`);

  const nombres = tools.map((t) => t.name);
  assert.equal(new Set(nombres).size, nombres.length, "nombres de tools únicos");

  const descs = new Set<string>();
  for (const t of tools) {
    const ctx = `tool ${t.name}`;

    assert.ok(t.annotations, `${ctx}: sin annotations`);
    assert.ok(t.outputSchema, `${ctx}: sin outputSchema`);

    const desc = (t.description ?? "").trim();
    assert.ok(desc.length >= 60, `${ctx}: description muy corta (${desc.length} chars): "${desc}"`);

    const normalizada = desc.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const nombreNormalizado = t.name.toLowerCase().replace(/_/g, " ");
    assert.ok(
      normalizada.trim() !== nombreNormalizado.trim(),
      `${ctx}: description tautológica (repite el nombre)`,
    );
    assert.ok(!descs.has(desc), `${ctx}: description duplicada con otra tool`);
    descs.add(desc);

    const palabras = palabrasDe(desc);
    const indiceVerbo = palabras.findIndex((p) => VERBOS_ESPERADOS.has(p));
    assert.ok(indiceVerbo >= 0, `${ctx}: description sin verbo de acción inicial: "${desc}"`);
    assert.ok(indiceVerbo <= 2, `${ctx}: el verbo de acción debe ir en las primeras 3 palabras: "${palabras.slice(0, 4).join(" ")}..."`);

    const props = (t.inputSchema as any)?.properties ?? {};
    const nombresParam = Object.keys(props);
    for (const [nombre, schema] of Object.entries(props as Record<string, any>)) {
      assert.ok(
        schema && typeof schema.description === "string" && schema.description.trim().length >= 3,
        `${ctx}: parámetro ${nombre} sin .describe()`,
      );
    }
    if (nombresParam.length > 0) {
      const descMin = normalizada;
      assert.ok(
        nombresParam.some((p) => descMin.includes(p)),
        `${ctx}: la description no menciona ninguno de sus parámetros (${nombresParam.join(", ")})`,
      );
    }

    assert.ok(desc.endsWith(".") || desc.endsWith(")"), `${ctx}: description sin cierre de frase: "${desc.slice(-40)}"`);
  }
});

test("TDQS gate: tools/list en orden determinístico", async () => {
  const { client } = await clienteConectado();
  const a = (await client.listTools()).tools.map((t) => t.name);
  const b = (await client.listTools()).tools.map((t) => t.name);
  assert.deepEqual(a, b, "tools/list debe ser determinístico");
});
