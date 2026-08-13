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

// APV: dump del form completo (cuadro options + opcion radios + valida completo)
const apv = await get("https://www.cmfchile.cl/institucional/estadisticas/valores_apv_enero2010.php");
const formApv = apv.txt.match(/<form name="fm"[\s\S]*?<\/form>/)?.[0] ?? "";
console.log("APV form completo:", formApv.replace(/\s+/g, " ").slice(0, 1400));
await espera();

// DIV: dump form f1
const div = await get("https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos_index.php");
const formDiv = div.txt.match(/<form name="f1"[\s\S]*?<\/form>/)?.[0] ?? "";
console.log("DIV form f1:", formDiv.replace(/\s+/g, " ").slice(0, 1200));
