/**
 * Verificación del MCP hosteado en https://cmf-mcp.kumocloud.cl/mcp hablando el
 * protocolo Streamable HTTP a mano (fetch + SSE). Sin SDK de por medio.
 * Uso: npx tsx test/verify-remote.ts   → exit 1 si algún check falla.
 */

const URL_ = process.env.CMF_MCP_URL ?? "https://cmf-mcp.kumocloud.cl/mcp";
const fallos: string[] = [];
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fallos.push(msg);
}

interface Incoming {
  result?: any;
  error?: any;
}

async function post(body: unknown, headers: Record<string, string>): Promise<{ status: number; contentType: string; sessionId: string | null; messages: Incoming[]; raw: string }> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  const sessionId = res.headers.get("mcp-session-id");
  const messages: Incoming[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const evento of raw.split("\n\n")) {
      const lineas = evento.split("\n");
      for (const l of lineas) {
        if (l.startsWith("data:")) {
          try { messages.push(JSON.parse(l.slice(5).trim())); } catch { /* ignorar keepalive */ }
        }
      }
    }
  } else if (raw.trim()) {
    try { messages.push(JSON.parse(raw)); } catch { /* no-JSON */ }
  }
  return { status: res.status, contentType, sessionId, messages, raw };
}

async function main(): Promise<void> {
  // 1. initialize
  const init = await post(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "verify-remote", version: "1.0.0" } } },
    {},
  );
  check(init.status === 200, `initialize → HTTP ${init.status}`);
  check(init.contentType.includes("text/event-stream"), `initialize devuelve SSE (${init.contentType})`);
  const initMsg = init.messages.find((m) => m.result?.protocolVersion);
  check(!!initMsg?.result, "initialize devuelve result con protocolVersion");
  const negociada = initMsg?.result?.protocolVersion as string;
  console.log(`INFO  protocolo negociado: ${negociada}`);
  console.log(`INFO  serverInfo: ${JSON.stringify(initMsg?.result?.serverInfo)}`);
  const instructions: string = initMsg?.result?.instructions ?? "";
  check(!instructions.includes("\uFFFD"), "instructions sin caracteres de reemplazo (sin mojibake)");
  console.log(`INFO  instructions[0..90]: ${instructions.slice(0, 90)}`);
  check(initMsg?.result?.capabilities?.tools, "capabilities.tools presente");

  const sessionId = init.sessionId;

  // 2. initialized notification
  const notif = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId ? { "Mcp-Session-Id": sessionId, "MCP-Protocol-Version": negociada } : { "MCP-Protocol-Version": negociada });
  check(notif.status === 202 || notif.status === 200, `notifications/initialized → HTTP ${notif.status} (202 esperado)`);

  const hdrs = { "MCP-Protocol-Version": negociada, ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) };

  // 3. tools/list
  const lista = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, hdrs);
  const tools: any[] = lista.messages.find((m) => m.result?.tools)?.result?.tools ?? [];
  check(lista.status === 200, `tools/list → HTTP ${lista.status}`);
  check(tools.length >= 82, `tools/list devuelve ${tools.length} tools (esperado >= 82)`);
  const nombres = tools.map((t) => t.name);
  check(new Set(nombres).size === nombres.length, "nombres de tools únicos");
  const sinDesc = tools.filter((t) => !t.description || t.description.length < 10);
  check(sinDesc.length === 0, `toda tool tiene description >= 10 chars (${sinDesc.length} sin descripción)`);
  const sinSchema = tools.filter((t) => !t.inputSchema || !t.inputSchema.properties);
  check(sinSchema.length === 0, `toda tool tiene inputSchema.properties (${sinSchema.length} sin schema)`);
  const sinOutput = tools.filter((t) => !t.outputSchema);
  check(sinOutput.length === 0, `toda tool tiene outputSchema (${sinOutput.map((t) => t.name).join(", ") || "ninguna"})`);
  const paramsSinDesc: string[] = [];
  for (const t of tools) {
    for (const [k, s] of Object.entries((t.inputSchema as any)?.properties ?? {})) {
      if (!(s as any)?.description) paramsSinDesc.push(`${t.name}.${k}`);
    }
  }
  check(paramsSinDesc.length === 0, `todo parámetro tiene description (${paramsSinDesc.length} sin ella${paramsSinDesc.length ? `: ${paramsSinDesc.slice(0, 5).join(", ")}` : ""})`);
  const sinAnnot = tools.filter((t) => !t.annotations);
  check(sinAnnot.length === 0, `annotations presentes en las ${tools.length} tools (sin ellas: ${sinAnnot.map((t) => t.name).join(", ") || "ninguna"})`);

  // 4. tools/call reales
  async function call(name: string, args: Record<string, unknown>) {
    const r = await post({ jsonrpc: "2.0", id: 10 + fallos.length + Math.floor(Math.random() * 1000), method: "tools/call", params: { name, arguments: args } }, hdrs);
    const m = r.messages.find((x) => x.result || x.error);
    return { status: r.status, resultado: m?.result, error: m?.error };
  }

  const xbrl = await call("cmf_xbrl_taxonomias", {});
  const xbrlTexto: string = xbrl.resultado?.content?.[0]?.text ?? "";
  check(xbrl.status === 200 && !xbrl.error && /CL-CI/.test(xbrlTexto), `cmf_xbrl_taxonomias → taxonomías reales (CL-CI)`);

  const empresa = await call("cmf_empresa_info", { rut: "61808000" });
  const empTexto: string = empresa.resultado?.content?.[0]?.text ?? "";
  const empSc: any = empresa.resultado?.structuredContent;
  check(
    !empresa.error && !empresa.resultado?.isError && /Raz[oó]n Social|AGUAS ANDINAS/i.test(empTexto) && Array.isArray(empSc?.datos) && empSc.datos.length > 0,
    `cmf_empresa_info(61808000) → datos reales no vacíos (${empTexto.slice(0, 60)})`,
  );
  console.log(`INFO  cmf_empresa_info texto: ${empTexto.slice(0, 160)}`);

  const indicador = await call("cmf_api_indicador_valor", { serie: "uf", anio: "2025", mes: "12", dia: "31" });
  const indTexto: string = indicador.resultado?.content?.[0]?.text ?? "";
  console.log(`INFO  cmf_api_indicador_valor(uf 2025-12-31): isError=${indicador.resultado?.isError} ${indTexto.slice(0, 120)}`);

  const hechos = await call("cmf_hechos_globales", { mercado: "V", desde: "2026-08-01", hasta: "2026-08-12" });
  const hechosTexto: string = hechos.resultado?.content?.[0]?.text ?? "";
  check(!hechos.error && (!hechos.resultado?.isError || /captcha/i.test(hechosTexto)), `cmf_hechos_globales → datos o solicitud de captcha (MRTR) (${hechosTexto.slice(0, 90)})`);
  console.log(`INFO  cmf_hechos_globales: ${hechosTexto.slice(0, 140)}`);

  const malRut = await call("cmf_empresa_hechos", { rut: "abc", desde: "2026-01-01", hasta: "2026-01-31" });
  check(malRut.resultado?.isError === true, `input inválido (rut=abc) → isError=true (SEP-1303)`);

  // 5. resources/list y un read
  const recs = await post({ jsonrpc: "2.0", id: 30, method: "resources/list", params: {} }, hdrs);
  check(recs.status === 200 && !!recs.messages.find((m) => m.result?.resources), "resources/list responde");

  const templates = await post({ jsonrpc: "2.0", id: 31, method: "resources/templates/list", params: {} }, hdrs);
  const tpls: any[] = templates.messages.find((m) => m.result?.resourceTemplates)?.result?.resourceTemplates ?? [];
  const uris = tpls.map((t) => t.uriTemplate);
  for (const esperado of ["cmf://entidades/{rut}", "cmf://indicadores/{serie}/{anio}/{mes}", "cmf://documento/{id}", "cmf://captcha/{id}"]) {
    check(uris.includes(esperado), `template ${esperado} presente`);
  }

  // 6. prompts/list
  const prompts = await post({ jsonrpc: "2.0", id: 32, method: "prompts/list", params: {} }, hdrs);
  const pnames: string[] = prompts.messages.find((m) => m.result?.prompts)?.result?.prompts?.map((p: any) => p.name) ?? [];
  check(
    pnames.includes("cmf_analizar_empresa") && pnames.includes("cmf_comparar_fondos") && pnames.includes("cmf_indicadores_economicos"),
    `prompts/list con los 3 prompts (${pnames.join(", ")})`,
  );
}

await main().catch((e) => {
  check(false, `excepción: ${e instanceof Error ? e.message : String(e)}`);
});

console.log(`\n${checks - fallos.length}/${checks} checks pasaron`);
if (fallos.length) {
  console.log("FALLOS:");
  for (const f of fallos) console.log(`  - ${f}`);
  process.exit(1);
}
