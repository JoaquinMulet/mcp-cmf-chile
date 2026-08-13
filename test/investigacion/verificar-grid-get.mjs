// Verifica el GET de la grid de cumplimiento (sin POST) con params en query.
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" };

const url = "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento1grid.php?lang=es&vigente=&cia=2&tiposociedad=A&sociedad%5B%5D=76418751&anno_ini=2010&mes_ini=12&mes1=03&anno1=2025&mes2=12&anno2=2025&xls=n";
const r = await fetch(url, {
  headers: { ...UA, Referer: "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento_index.php" },
  signal: AbortSignal.timeout(90000),
});
const buf = Buffer.from(await r.arrayBuffer());
const txt = buf.toString("latin1");
console.log("status:", r.status, "| ct:", r.headers.get("content-type"), "| len:", buf.length);
console.log("tiene dataAsJson:", txt.includes("dataAsJson"), "| tiene cols:", txt.includes("cols:"), "| fatal:", txt.includes("Fatal error"));
const m = txt.match(/var dataAsJson = \s*({[\s\S]*?})\s*;/);
if (m) {
  try {
    const json = JSON.parse(m[1].replace(/'/g, '"').replace(/([{,]\s*)(\w+):/g, '$1"$2":'));
    console.log("cols:", json.cols.length, "| rows:", json.rows.length);
    console.log("fila 0 primer valor:", JSON.stringify(json.rows[0].c[0]));
    console.log("fila 0 completo:", JSON.stringify(json.rows[0].c.map((c) => (c ? c.v : null))));
  } catch (e) {
    console.log("parse error:", e.message);
  }
} else {
  console.log("no se halló dataAsJson; head:", txt.replace(/\s+/g, " ").slice(0, 300));
}
