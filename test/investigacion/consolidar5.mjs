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

// APV con tipo_e[]
const c = await post("https://www.cmfchile.cl/institucional/estadisticas/cuadros.php", "cuadro=1&tipo_e%5B%5D=todos&mes_desde=01&ano_desde=2025&mes_hasta=12&ano_hasta=2025");
console.log("APV cuadros v2:", c.status, c.len, "tablas:", (c.txt.match(/<table/g) ?? []).length, "|", c.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 130));
await espera();
const x = await get("https://www.cmfchile.cl/institucional/estadisticas/exportacion_excel_cuadros.php?cuadro=1&tipo_e%5B%5D=todos&mes_desde=01&ano_desde=2025&mes_hasta=12&ano_hasta=2025");
console.log("APV excel v2:", x.status, x.len, x.ct, x.txt.slice(0, 8));
await espera();

// DIVIDENDOS: todos los campos
const d = await post(
  "https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos1grid.php?lang=es",
  "sociedad%5B%5D=0&tipodiv=DIV&mes=01&anno=2025&mes2=12&anno2=2025&buscasoc=&enviar=Buscar",
  { Referer: "https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos_index.php?lang=es" },
);
console.log("DIV v3:", d.status, d.len, "dataAsJson:", d.txt.includes("dataAsJson"), "|", d.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 150));
await espera();
// GET variant
const dg = await get("https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos1grid.php?lang=es&sociedad%5B%5D=0&tipodiv=DIV&mes=01&anno=2025&mes2=12&anno2=2025");
console.log("DIV GET:", dg.status, dg.len, "dataAsJson:", dg.txt.includes("dataAsJson"), "|", dg.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 150));
await espera();
// resumen grid
const dr = await post("https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos2resumengrid.php?lang=es", "sociedad%5B%5D=0&tipodiv=DIV&mes=01&anno=2025&mes2=12&anno2=2025&enviar=Buscar");
console.log("DIV resumen:", dr.status, dr.len, "dataAsJson:", dr.txt.includes("dataAsJson"), "|", dr.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 150));
