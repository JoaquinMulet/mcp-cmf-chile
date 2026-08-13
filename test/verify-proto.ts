/**
 * Verificación de protocolo Streamable HTTP contra la instancia hosteada.
 * TODOS los checks son aserciones: exit 1 si alguno falla.
 * Uso: npx tsx test/verify-proto.ts  (CMF_MCP_URL opcional)
 *
 * Cubre (spec 2026-07-28): era moderna (_meta + headers), era legacy (initialize),
 * resultType/ttlMs/cacheScope, orden determinístico, errores JSON-RPC (-32601/-32602),
 * validación de headers (-32020), Origin (403), _meta obligatorio (400),
 * subscriptions/listen con ack y subscriptionId, resources/read de recurso inexistente (-32602).
 */
const URL_ = process.env.CMF_MCP_URL || "https://cmf-mcp.kumocloud.cl/mcp";

const fallos: string[] = [];
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fallos.push(msg);
}

const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "verify-proto", version: "1.0.0" },
};
const H = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28" };

async function post(method: string, params: unknown, headers: Record<string, string> = {}, rawBody?: unknown, sinVersion = false): Promise<{ status: number; contentType: string; body: any }> {
  const h = { ...H, "Mcp-Method": method, ...headers };
  if (sinVersion) delete h["MCP-Protocol-Version"];
  const res = await fetch(URL_, {
    method: "POST",
    headers: h,
    body: JSON.stringify(rawBody ?? { jsonrpc: "2.0", id: 99, method, params }),
  });
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  let body: any = text;
  if (contentType.includes("json")) {
    try { body = JSON.parse(text); } catch { /* raw */ }
  } else if (contentType.includes("text/event-stream")) {
    body = { sse: text, eventos: [] as any[] };
    for (const ev of text.split("\n\n")) {
      for (const l of ev.split("\n")) {
        if (l.startsWith("data:")) { try { (body as any).eventos.push(JSON.parse(l.slice(5).trim())); } catch { /* keepalive */ } }
      }
    }
  }
  return { status: res.status, contentType, body };
}

async function main(): Promise<void> {
  // 1. era moderna: server/discover con _meta y headers
  const discover = await post("server/discover", { _meta: meta });
  check(discover.status === 200, `server/discover (moderno) → HTTP 200 (${discover.status})`);
  check(Array.isArray(discover.body?.result?.supportedVersions) && discover.body.result.supportedVersions.includes("2026-07-28"), `supportedVersions incluye 2026-07-28: ${JSON.stringify(discover.body?.result?.supportedVersions)}`);
  check(discover.body?.result?.resultType === "complete", `DiscoverResult.resultType=complete`);
  check(typeof discover.body?.result?.ttlMs === "number", `DiscoverResult.ttlMs numérico (${discover.body?.result?.ttlMs})`);
  check(discover.body?.result?.cacheScope === "public", `DiscoverResult.cacheScope=public`);

  // 2. era legacy: initialize (sin MCP-Protocol-Version: el handshake legacy no lo lleva)
  const init = await post("initialize", { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "verify-proto", version: "1" } }, {}, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "verify-proto", version: "1" } } }, true);
  const initResult = init.body?.result?.protocolVersion
    ? init.body.result
    : init.body?.eventos?.find((m: any) => m.result?.protocolVersion)?.result;
  check(!!initResult?.protocolVersion && !!initResult?.capabilities?.tools, `initialize (legacy) → protocolVersion=${initResult?.protocolVersion}, tools cap presente`);

  // 3. tools/list: resultType/ttlMs/cacheScope + orden determinístico + contrato de definiciones
  const l1 = await post("tools/list", { _meta: meta });
  const t1 = l1.body?.result ?? l1.body?.eventos?.find((m: any) => m.result)?.result;
  const l2 = await post("tools/list", { _meta: meta });
  const t2 = l2.body?.result ?? l2.body?.eventos?.find((m: any) => m.result)?.result;
  check(t1?.resultType === "complete" && typeof t1?.ttlMs === "number" && t1?.cacheScope === "public", `tools/list resultType/ttlMs/cacheScope: ${t1?.resultType}/${t1?.ttlMs}/${t1?.cacheScope}`);
  const n1 = (t1?.tools ?? []).map((t: any) => t.name);
  const n2 = (t2?.tools ?? []).map((t: any) => t.name);
  check(n1.length >= 86, `tools/list devuelve ${n1.length} tools`);
  check(JSON.stringify(n1) === JSON.stringify(n2), "orden determinístico entre llamadas");
  const sinDesc = (t1?.tools ?? []).filter((t: any) => !t.description || t.description.length < 10);
  const sinOutput = (t1?.tools ?? []).filter((t: any) => !t.outputSchema);
  const sinAnnot = (t1?.tools ?? []).filter((t: any) => !t.annotations);
  const paramsSinDesc: string[] = [];
  for (const t of t1?.tools ?? []) for (const [k, s] of Object.entries((t.inputSchema as any)?.properties ?? {})) if (!(s as any)?.description) paramsSinDesc.push(`${t.name}.${k}`);
  check(sinDesc.length === 0 && sinOutput.length === 0 && sinAnnot.length === 0 && paramsSinDesc.length === 0, `contrato TDQS: sin description=${sinDesc.length}, sin outputSchema=${sinOutput.length}, sin annotations=${sinAnnot.length}, params sin desc=${paramsSinDesc.length}`);

  // 4. subscriptions/listen: SSE con ack + subscriptionId (lee el stream incremental)
  {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { ...H, "Mcp-Method": "subscriptions/listen" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 77, method: "subscriptions/listen", params: { _meta: meta, notifications: { toolsListChanged: true } } }),
    });
    check(res.status === 200 && (res.headers.get("content-type") ?? "").includes("text/event-stream"), `subscriptions/listen → SSE (${res.status})`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const eventos: any[] = [];
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && eventos.length === 0) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const ev of buffer.split("\n\n")) {
        const l = ev.split("\n").find((x) => x.startsWith("data:"));
        if (l) { try { eventos.push(JSON.parse(l.slice(5).trim())); } catch {} }
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
    }
    const ack = eventos.find((m) => m.method === "notifications/subscriptions/acknowledged");
    check(!!ack, "primer mensaje del stream es subscriptions/acknowledged");
    check(ack?.params?._meta?.["io.modelcontextprotocol/subscriptionId"] === 77, `ack lleva subscriptionId (= id del request): ${ack?.params?._meta?.["io.modelcontextprotocol/subscriptionId"]}`);
    await reader.cancel().catch(() => {});
  }

  // 5. errores JSON-RPC
  const m404 = await post("metodo_inexistente", { _meta: meta });
  check(m404.status === 404 && m404.body?.error?.code === -32601, `método inexistente → HTTP 404 + -32601 (${m404.status}/${m404.body?.error?.code})`);
  const c404 = await post("tools/call", { _meta: meta, name: "no_existe", arguments: {} }, { "Mcp-Name": "no_existe" });
  check(c404.body?.error?.code === -32602, `tools/call inexistente → -32602`);
  const rread = await post("resources/read", { _meta: meta, uri: "cmf://noexiste/1" }, { "Mcp-Name": "cmf://noexiste/1" });
  check(rread.body?.error?.code === -32602, `resources/read inexistente → -32602 (no contents[])`);

  // 6. validaciones del transport
  const sinMeta = await fetch(URL_, {
    method: "POST",
    headers: { ...H, "Mcp-Method": "tools/list" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list", params: {} }),
  });
  check(sinMeta.status === 400, `request sin _meta → HTTP 400 (${sinMeta.status})`);
  const mismatch = await fetch(URL_, {
    method: "POST",
    headers: { ...H, "MCP-Protocol-Version": "2025-03-26", "Mcp-Method": "tools/list" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list", params: { _meta: meta } }),
  });
  check(mismatch.status === 400, `header vs _meta mismatch → HTTP 400 (${mismatch.status})`);
  const originBad = await fetch(URL_, {
    method: "POST",
    headers: { ...H, "Mcp-Method": "server/discover", Origin: "https://evil.example.com" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "server/discover", params: { _meta: meta } }),
  });
  check(originBad.status === 403, `Origin inválido → HTTP 403 (${originBad.status})`);

  // 7. GET al endpoint → 405 (era legacy)
  const get405 = await fetch(URL_, { method: "GET", headers: { Accept: "text/event-stream" } });
  check(get405.status === 405, `GET al endpoint → 405 (${get405.status})`);

  // 8. herramientas sin red: datos reales
  const xbrl = await post("tools/call", { _meta: meta, name: "cmf_xbrl_taxonomias", arguments: {} }, { "Mcp-Name": "cmf_xbrl_taxonomias" });
  const xbrlTexto: string = xbrl.body?.result?.content?.[0]?.text ?? "";
  check(/CL-CI/.test(xbrlTexto), "cmf_xbrl_taxonomias devuelve taxonomías reales");
}

await main().catch((e) => check(false, `excepción: ${e instanceof Error ? e.message : String(e)}`));

console.log(`\n${checks - fallos.length}/${checks} checks pasaron`);
if (fallos.length) {
  console.log("FALLOS:");
  for (const f of fallos) console.log(`  - ${f}`);
  process.exit(1);
}
