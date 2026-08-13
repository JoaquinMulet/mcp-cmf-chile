const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126" };
async function get(u, opts = {}) {
  try {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000), ...opts });
    const buf = await r.arrayBuffer();
    return { status: r.status, len: buf.byteLength, ct: r.headers.get("content-type") ?? "", txt: new TextDecoder("latin1").decode(buf), url: r.url };
  } catch (e) { return { status: 0, len: 0, ct: "", txt: String(e), url: String(e) }; }
}
async function post(u, body, headers = {}) {
  return get(u, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded", ...headers }, body, redirect: "manual" });
}
const espera = () => new Promise((x) => setTimeout(x, 1100));

// DIV: resto del form f1 (botones/inputs) y radio/checkbox
const div = await get("https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos_index.php");
const formDiv = div.txt.match(/<form name="f1"[\s\S]*?<\/form>/)?.[0] ?? "";
console.log("DIV f1 resto:", formDiv.replace(/\s+/g, " ").slice(1100, 2200));
await espera();

// DIV: POST a 1grid con redirect manual para ver qué redirige
const r = await post("https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos1grid.php?lang=es", "sociedad%5B%5D=0&tipodiv=DIV&mes=01&anno=2025&mes2=12&anno2=2025&enviar=Buscar");
console.log("DIV 1grid manual-redirect:", r.status, r.len, "| location:", r.txt.match(/Location: ([^\r\n]+)/)?.[1] ?? "n/a", "| dataAsJson:", r.txt.includes("dataAsJson"));
await espera();

// APV: POST al form mismo (action="") con radios
const a = await post("https://www.cmfchile.cl/institucional/estadisticas/valores_apv_enero2010.php", "cuadro=1&tipo_e%5B%5D=todos&opcion1=on&mes_desde=01&ano_desde=2025&mes_hasta=12&ano_hasta=2025");
console.log("APV self-post:", a.status, a.len, "tablas:", (a.txt.match(/<table/g) ?? []).length, "|", a.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 140));
