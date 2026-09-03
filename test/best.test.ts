/**
 * BEST, el sitio estadístico de la CMF, con 5.180 cuadros que el MCP no
 * servía. Los fixtures son respuestas REALES del servicio del sitio, del 3
 * de septiembre de 2026, sin recortar. el buscador para «colocaciones
 * vivienda por banco» y el cuadro de colocaciones en 2 tramos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { fechaDeBest, filaDeBusqueda, filasDeCuadro } from "../src/tools/best.js";
import { horasDeCache } from "../src/client/best.js";

const FIX = join(import.meta.dirname, "fixtures");
const leer = (n: string) => readFileSync(join(FIX, n), "utf-8");

function conFetchBest() {
  const original = globalThis.fetch;
  const llamadas: Array<{ url: string; method: string; body: string; apikey: string | null }> = [];
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
    llamadas.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? ""), apikey: new Headers(init?.headers).get("x-apikey") });
    let cuerpo: string;
    if (url.includes("/aisearch/aisearch")) cuerpo = leer("best-aisearch-colocaciones-vivienda.json");
    else if (url.includes("FechaInicio=")) cuerpo = leer("best-cuadro-colocaciones-rango-2024.json");
    else if (url.includes("NumPeriodos=")) cuerpo = leer("best-cuadro-colocaciones-ultimos2.json");
    else return new Response("<html>no</html>", { status: 404 });
    return new Response(cuerpo, { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

async function cliente() {
  const server = createServer({ CMF_RATE_LIMIT_MS: "0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "1.0.0" }, {});
  await client.connect(ct);
  return client;
}

test("filaDeBusqueda saca el tag de la URL y la unidad y el histórico del HTML de la descripción", () => {
  const r = JSON.parse(leer("best-aisearch-colocaciones-vivienda.json"))[0];
  const f = filaDeBusqueda(r);
  assert.equal(f.tag, "SBIF_CONT_EPLME_ACTIV_CHV_AGIFI");
  assert.match(f.nombre, /Colocaciones cartera de vivienda por instituci/);
  assert.equal(f.unidad, "millones de pesos");
  assert.match(f.historico, /desde enero de 1990/);
  assert.equal(f.entidad, "Bancos");
  assert.equal(f.categoria, "Actividad");
  assert.equal(f.url, "https://best.cmfchile.cl/series/cuadro/SBIF_CONT_EPLME_ACTIV_CHV_AGIFI");
});

test("cmf_best_buscar manda la consulta al buscador del sitio y entrega cuadros con tag", async () => {
  const { llamadas, restaurar } = conFetchBest();
  try {
    const client = await cliente();
    const r = await client.callTool({ name: "cmf_best_buscar", arguments: { consulta: "colocaciones vivienda por banco" } });
    assert.ok(!r.isError, JSON.stringify(r.content));
    const sc = r.structuredContent as { total: number; filas: Array<Record<string, string>> };
    assert.ok(sc.total > 0);
    assert.ok(sc.filas.filter((f) => f.tipo === "serie").every((f) => /^[A-Z0-9_$]+$/.test(f.tag)), "todo cuadro trae su tag");
    assert.ok(sc.filas.some((f) => f.tipo === "datos_reportes" && f.tag === ""), "los informes del sitio vienen marcados y sin tag");
    const texto = (r.content as Array<{ text: string }>)[0].text;
    assert.match(texto, /SBIF_CONT_EPLME_ACTIV_CHV_AGIFI/, "el tag va en el TEXTO, que es lo que lee el modelo");
    assert.match(texto, /millones de pesos/, "y la unidad también");
    const b = llamadas.find((l) => l.url.includes("/aisearch/aisearch"));
    assert.ok(b && b.method === "POST", "va por POST");
    assert.equal(JSON.parse(b?.body ?? "{}").query, "colocaciones vivienda por banco");
    // El filtro local por texto se queda con lo que dice el campo.
    const f = await client.callTool({ name: "cmf_best_buscar", arguments: { consulta: "colocaciones", texto: "leasing" } });
    const scf = f.structuredContent as { filas: Array<Record<string, string>> };
    assert.ok(scf.filas.length > 0 && scf.filas.every((x) => /leasing/i.test(JSON.stringify(x))));
  } finally {
    restaurar();
  }
});

test("fechaDeBest y filasDeCuadro pasan un cuadro a formato largo con la fecha legible", () => {
  assert.equal(fechaDeBest(20240101), "2024-01-01");
  assert.equal(fechaDeBest("20250801"), "2025-08-01");
  const c = JSON.parse(leer("best-cuadro-colocaciones-ultimos2.json"));
  const cuadro = c.result ?? c;
  const filas = filasDeCuadro(cuadro);
  // 6 series × 2 periodos.
  assert.equal(filas.length, 12);
  assert.deepEqual(Object.keys(filas[0]), ["fecha", "serie", "descripcion", "valor"]);
  assert.equal(filas[0].serie, "SBIF_CONT_EPLME_ACTIV_COL_MM$_STO_MONT");
  assert.match(String(filas[0].fecha), /^\d{4}-\d{2}-\d{2}$/);
});

test("cmf_best_cuadro: últimos periodos por defecto, rango con fechas AAAAMMDD, y las notas del cuadro en el texto", async () => {
  const { llamadas, restaurar } = conFetchBest();
  try {
    const client = await cliente();
    const r = await client.callTool({ name: "cmf_best_cuadro", arguments: { tag: "SBIF_CONT_EPLME_ACTIV_COL_TOT_CART", periodos: 2 } });
    assert.ok(!r.isError, JSON.stringify(r.content));
    const sc = r.structuredContent as { total: number; filas: Array<Record<string, unknown>>; notas: string[]; series: Array<{ codigo: string }>; unidad: string };
    assert.equal(sc.total, 12);
    assert.equal(sc.series.length, 6);
    assert.equal(sc.unidad, "(millones de pesos)");
    const texto = (r.content as Array<{ text: string }>)[0].text;
    assert.match(texto, /millones de pesos/);
    assert.match(texto, /posterior a diciembre del 2021 no disponible/, "la nota de la CMF sobre el corte de la serie llega al texto");
    assert.match(texto, /Fechas disponibles en BEST\. 439/);
    assert.ok(llamadas.some((l) => l.url.includes("NumPeriodos=2&Tag=SBIF_CONT_EPLME_ACTIV_COL_TOT_CART")));
    assert.ok(llamadas.every((l) => l.apikey), "toda llamada lleva x-apikey");

    const rango = await client.callTool({ name: "cmf_best_cuadro", arguments: { tag: "SBIF_CONT_EPLME_ACTIV_COL_TOT_CART", modo: "rango", desde: "2024-01-01", hasta: "2024-03-01", serie: "vivienda" } });
    const scr = rango.structuredContent as { total: number; filas: Array<Record<string, unknown>> };
    assert.ok(llamadas.some((l) => l.url.includes("FechaInicio=20240101&FechaFin=20240301")), "las fechas viajan como AAAAMMDD");
    assert.equal(scr.total, 3, "3 meses de la serie de vivienda");
    assert.ok(scr.filas.every((f) => /vivienda/i.test(String(f.descripcion))));

    const sinDesde = await client.callTool({ name: "cmf_best_cuadro", arguments: { tag: "X", modo: "rango" } });
    assert.ok(sinDesde.isError);
  } finally {
    restaurar();
  }
});

test("un tag que BEST no conoce es un error que nombra la página oficial, no cero filas", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
  try {
    const client = await cliente();
    const r = await client.callTool({ name: "cmf_best_cuadro", arguments: { tag: "NO_EXISTE" } });
    assert.ok(r.isError);
    assert.match((r.content as Array<{ text: string }>)[0].text, /best\.cmfchile\.cl\/series\/cuadro\/NO_EXISTE/);
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * La caché por demanda. La primera consulta va a BEST y se guarda en KV con
 * vencimiento; la segunda no toca BEST y lo dice en las notas. Los términos
 * de BEST piden no extraer en masa, y esta es la forma de cumplirlos sin
 * bajar nada por adelantado.
 */
function kvDeMentira() {
  const mapa = new Map<string, { v: string; ttl?: number }>();
  return {
    mapa,
    get: async (k: string) => mapa.get(k)?.v ?? null,
    put: async (k: string, v: string, o?: { expirationTtl?: number }) => {
      mapa.set(k, { v, ttl: o?.expirationTtl });
    },
  };
}

async function clienteConKv(kv: ReturnType<typeof kvDeMentira>) {
  const server = createServer({ CMF_RATE_LIMIT_MS: "0", CMF_KV: kv } as never);
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "1.0.0" }, {});
  await client.connect(ct);
  return client;
}

test("con KV, la segunda consulta del mismo cuadro no toca BEST y las notas dicen cuándo se guardó", async () => {
  const { llamadas, restaurar } = conFetchBest();
  try {
    const kv = kvDeMentira();
    const client = await clienteConKv(kv);
    const args = { tag: "SBIF_CONT_EPLME_ACTIV_COL_TOT_CART", periodos: 2 };
    const primera = await client.callTool({ name: "cmf_best_cuadro", arguments: args });
    assert.ok(!primera.isError, JSON.stringify(primera.content));
    const idas = llamadas.filter((l) => l.url.includes("NumPeriodos=2")).length;
    assert.equal(idas, 1);
    assert.ok(!(primera.content as Array<{ text: string }>)[0].text.includes("guardada en la caché"), "la primera vez no viene de la caché");
    const [clave, guardado] = [...kv.mapa.entries()][0];
    assert.match(clave, /^best:v1:\/public\/Cuadrosv3\?NumPeriodos=2/);
    assert.equal(guardado.ttl, 24 * 3600, "un cuadro mensual dura 24 horas");

    const segunda = await client.callTool({ name: "cmf_best_cuadro", arguments: args });
    assert.equal(llamadas.filter((l) => l.url.includes("NumPeriodos=2")).length, idas, "BEST no se volvió a consultar");
    const texto = (segunda.content as Array<{ text: string }>)[0].text;
    assert.match(texto, /guardada en la caché del servidor el .* BEST se vuelve a consultar 24 horas después/);
    assert.equal((segunda.structuredContent as { total: number }).total, 12, "y los datos son los mismos");

    // Un cuadro diario y las tasas duran 6 horas, como recomienda BEST.
    assert.equal(horasDeCache("/public/Cuadrosv3?NumPeriodos=22&Tag=SBIF_CCO_MTO_DAYL"), 6);
    assert.equal(horasDeCache("/public/tmc/tasas/20260901"), 6);
    assert.equal(horasDeCache("/public/Cuadrosv3/tag/SBIF_CONT_EPLME_ACTIV_COL_TOT_CART"), 24);
  } finally {
    restaurar();
  }
});

test("un error de BEST no se guarda en la caché", async () => {
  const original = globalThis.fetch;
  let veces = 0;
  globalThis.fetch = (async () => {
    veces++;
    return new Response("", { status: 503 });
  }) as typeof fetch;
  try {
    const kv = kvDeMentira();
    const client = await clienteConKv(kv);
    const a = await client.callTool({ name: "cmf_best_cuadro", arguments: { tag: "TAG_CAIDO" } });
    const trasLaPrimera = veces;
    const b = await client.callTool({ name: "cmf_best_cuadro", arguments: { tag: "TAG_CAIDO" } });
    assert.ok(a.isError && b.isError);
    assert.equal(kv.mapa.size, 0, "nada guardado");
    // El cliente reintenta un 5xx, así que se mide que la segunda llamada
    // volvió a salir a la red, no cuántas veces.
    assert.ok(trasLaPrimera >= 1 && veces > trasLaPrimera, `la segunda vez se volvió a intentar (${trasLaPrimera} → ${veces})`);
  } finally {
    globalThis.fetch = original;
  }
});
