const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126" };
async function get(u, opts = {}) {
  try {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000), ...opts });
    const buf = await r.arrayBuffer();
    return { status: r.status, len: buf.byteLength, ct: r.headers.get("content-type") ?? "", txt: new TextDecoder("latin1").decode(buf) };
  } catch (e) { return { status: 0, len: 0, ct: "", txt: String(e) }; }
}
const espera = () => new Promise((x) => setTimeout(x, 1100));

// APV: cómo arma la exportación el JS
const apv = await get("https://www.cmfchile.cl/institucional/estadisticas/valores_apv_enero2010.php");
const apvJs = apv.txt.match(/<script[^>]*>([\s\S]*?)<\/script>/g)?.filter((s) => /excel|export|post|ajax|cuadro/i.test(s)).map((s) => s.replace(/\s+/g, " ").slice(0, 600));
console.log("APV JS relevante:");
for (const s of apvJs ?? []) console.log("  >", s.slice(0, 500));
console.log("APV form:", apv.txt.match(/<form[^>]*>/)?.[0]);
console.log("APV selects:", [...new Set([...apv.txt.matchAll(/<select[^>]*name="([^"]+)"/g)].map((m) => m[1]))].join(","));
console.log("APV options tipo:", [...new Set([...apv.txt.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]{2,40})<\/option>/g)].map((m) => `${m[1]}=${m[2].trim()}`))].slice(0, 20).join(" | "));
await espera();

// DIVIDENDOS: form y valida()
const div = await get("https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos_index.php");
const divJs = div.txt.match(/function valida[\s\S]{0,900}/);
console.log("DIV valida():", divJs?.[0].replace(/\s+/g, " ").slice(0, 700));
console.log("DIV forms:", [...div.txt.matchAll(/<form[^>]*>/g)].map((m) => m[0]).slice(0, 4).join(" | "));
console.log("DIV hiddens:", [...new Set([...div.txt.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)].map((m) => `${m[1]}=${m[2]}`))].join(" | "));
await espera();

// CLASIF: valores de los selects
const cl = await get("https://www.cmfchile.cl/institucional/estadisticas/valores_clasificaciones_asignadas.php");
for (const sel of ["clasificadora", "tipo_emisor", "emisor", "tipo_instrumento", "insc_emisor", "vig_instrumento"]) {
  const re = new RegExp(`<select[^>]*name="${sel}"[\\s\\S]*?</select>`);
  const m = cl.txt.match(re);
  const opts = m ? [...m[0].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((x) => `${x[1]}=${x[2].trim()}`).slice(0, 10) : [];
  console.log(`CLASIF ${sel}:`, opts.join(" | "));
}
await espera();

// SCOMP inf1
const s1 = await get("https://www.cmfchile.cl/institucional/inc/inf1_num_ofer_ingr_tot_v3.php?via=W&dd=01&mm=01&aa=2025&dd2=31&mm2=12&aa2=2025");
console.log("SCOMP inf1:", s1.status, s1.len, "tablas:", (s1.txt.match(/<table/g) ?? []).length);
