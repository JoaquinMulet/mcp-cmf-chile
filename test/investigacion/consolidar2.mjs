const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126" };
async function get(u, opts = {}) {
  try {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000), ...opts });
    const buf = await r.arrayBuffer();
    return { status: r.status, len: buf.byteLength, ct: r.headers.get("content-type") ?? "", txt: new TextDecoder("latin1").decode(buf), buf };
  } catch (e) { return { status: 0, len: 0, ct: "", txt: String(e), buf: new ArrayBuffer(0) }; }
}
async function post(u, body) {
  return get(u, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
}
const espera = () => new Promise((x) => setTimeout(x, 1100));

// A2 dividendos: variantes
for (const [nombre, body] of [
  ["v1", { "sociedad[]": "0", tipodiv: "DIV", mes: "01", anno: "2025", mes2: "12", anno2: "2025", lang: "es", enviar: "Buscar" }],
  ["v2", { sociedad: "0", tipodiv: "DIV", mes: "01", anno: "2025", mes2: "12", anno2: "2025", lang: "es" }],
]) {
  const r = await post("https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos1grid.php?lang=es", body);
  console.log("A2", nombre, ":", r.status, r.len, "dataAsJson:", r.txt.includes("dataAsJson"), "| tablas:", (r.txt.match(/<table/g) ?? []).length);
  await espera();
}
// export xls
const rx = await post("https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos1grid.php?lang=es&xls=y", { "sociedad[]": "0", tipodiv: "DIV", mes: "01", anno: "2025", mes2: "12", anno2: "2025" });
console.log("A2 xls:", rx.status, rx.len, rx.ct, rx.buf && new Uint8Array(rx.buf)[0] === 0xd0 ? "OLE2!" : "?");
await espera();

// A3 clasificaciones: leer el form + JS para los params exactos
const f = await get("https://www.cmfchile.cl/institucional/estadisticas/valores_clasificaciones_asignadas.php");
const js = f.txt.match(/<script[^>]*src="([^"]+\.js[^"]*)"/g) ?? [];
console.log("A3 scripts:", js.join(" | "));
const m = f.txt.match(/excel_busqueda_clasificaciones[\s\S]{0,400}/);
console.log("A3 contexto excel_busqueda:", m ? m[0].replace(/\s+/g, " ").slice(0, 400) : "no encontrado");
await espera();

// B2 SCOMP: buscar nombres de informes
const s = await get("https://www.cmfchile.cl/institucional/mercados/seguros_scomp_estadisticas.php");
const nombres = [...new Set([...s.txt.matchAll(/(?:value|n_informe|informe)\s*=\s*"([A-Za-z0-9_]+)"/gi)].map((x) => x[1]))];
const selects = [...s.txt.matchAll(/<option[^>]*value="([^"]+)"[^>]*>([^<]{3,80})<\/option>/gi)].map((x) => `${x[1]}=${x[2].trim()}`);
console.log("B2 valores:", JSON.stringify(nombres.slice(0, 20)), "| options:", JSON.stringify(selects.slice(0, 16)));
await espera();
// probar un informe genérico
const informePrueba = selects[0]?.split("=")[0];
if (informePrueba) {
  const si = await get(`https://www.cmfchile.cl/institucional/inc/${informePrueba}.php?via=W&dd=01&mm=01&aa=2025&dd2=31&mm2=12&aa2=2025`);
  console.log("B2 prueba", informePrueba, ":", si.status, si.len, "tablas:", (si.txt.match(/<table/g) ?? []).length);
}

// A1 APV: params correctos para el XLS completo
const apv = await get("https://www.cmfchile.cl/institucional/estadisticas/exportacion_excel_cuadros.php?cuadro=1&tipo=1&mes_desde=01&ano_desde=2025&mes_hasta=12&ano_hasta=2025");
console.log("A1 APV v2:", apv.status, apv.len, apv.ct);
