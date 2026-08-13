const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126" };
async function get(u, opts = {}) {
  try {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000), ...opts });
    const buf = await r.arrayBuffer();
    return { status: r.status, len: buf.byteLength, ct: r.headers.get("content-type") ?? "", txt: new TextDecoder("latin1").decode(buf) };
  } catch (e) { return { status: 0, len: 0, ct: "", txt: String(e) }; }
}
async function post(u, body, headers = {}) {
  return get(u, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded", ...headers }, body });
}
const espera = () => new Promise((x) => setTimeout(x, 1100));

// APV: export y cuadros
const apv = await get("https://www.cmfchile.cl/institucional/estadisticas/valores_apv_enero2010.php");
const apvScripts = [...apv.txt.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).filter((s) => /apv|estad|js\//i.test(s));
console.log("APV scripts:", apvScripts.join(" | ") || "(solo inline)");
const inlineExport = apv.txt.match(/Exportar Excel[^}]{0,300}/)?.[0];
console.log("APV export ctx:", inlineExport?.replace(/\s+/g, " ").slice(0, 300));
const inlineCuadros = apv.txt.match(/cuadros\.php[\s\S]{0,300}/)?.[0];
console.log("APV cuadros ctx:", inlineCuadros?.replace(/\s+/g, " ").slice(0, 300));
// campos tipo_e options
const tipoE = [...new Set([...apv.txt.matchAll(/<input[^>]*name="tipo_e\[\]"[^>]*value="([^"]*)"/g)].map((m) => m[1]))];
console.log("APV tipo_e values:", tipoE.join(","));
// probar cuadros.php
const c = await post("https://www.cmfchile.cl/institucional/estadisticas/cuadros.php", "cuadro=1&tipo=1&mes_desde=01&ano_desde=2025&mes_hasta=12&ano_hasta=2025", { Referer: "https://www.cmfchile.cl/institucional/estadisticas/valores_apv_enero2010.php" });
console.log("APV cuadros.php:", c.status, c.len, "tablas:", (c.txt.match(/<table/g) ?? []).length, "|", c.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120));
await espera();

// DIVIDENDOS: con Referer y campos completos
const d = await post(
  "https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos1grid.php?lang=es",
  "sociedad%5B%5D=0&tipodiv=DIV&mes=01&anno=2025&mes2=12&anno2=2025&enviar=Buscar",
  { Referer: "https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos_index.php" },
);
console.log("DIV retry:", d.status, d.len, "dataAsJson:", d.txt.includes("dataAsJson"), "| tablas:", (d.txt.match(/<table/g) ?? []).length, "|", d.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 100));
await espera();

// CLASIF: POST con valores 0 y fechas
const cl = await post(
  "https://www.cmfchile.cl/institucional/inc/excel_busqueda_clasificaciones.php",
  "clasificadora=0&tipo_emisor=0&emisor=0&tipo_instrumento=0&insc_emisor=0&vig_instrumento=0&fecha_desde=&fecha_hasta=",
  { Referer: "https://www.cmfchile.cl/institucional/estadisticas/valores_clasificaciones_asignadas.php" },
);
console.log("CLASIF retry:", cl.status, cl.len, "|", cl.txt.slice(0, 200));
await espera();
