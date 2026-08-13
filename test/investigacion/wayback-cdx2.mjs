// CDX prefix search en dominios candidatos (cmfchile.cl, svs.cl, sif.cl).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
  return r.json();
}

const queries = [
  ["svs.cl", "institucional/estadisticas/merc_seguros/sv_cumplimientos"],
  ["svs.cl", "institucional/estadisticas/merc_seguros/cartera_inversiones"],
  ["www.svs.cl", "institucional/estadisticas/merc_seguros/sv_cumplimientos"],
  ["www.svs.cl", "institucional/estadisticas/merc_seguros/cartera_inversiones"],
  ["cmfchile.cl", "institucional/estadisticas/merc_seguros/cartera_inversiones"],
  ["cmfchile.cl", "institucional/estadisticas/merc_seguros/sv_cumplimientos"],
];

for (const [host, path] of queries) {
  console.log(`\n=== CDX ${host}/${path} (prefix) ===`);
  try {
    const rows = await json(
      `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(host + "/" + path)}&matchType=prefix&output=json&limit=40&collapse=urlkey&filter=statuscode:200`,
    );
    if (rows.length <= 1) { console.log("(sin resultados)"); }
    for (const r of rows) console.log(r.join(" | "));
  } catch (e) {
    console.log("error:", e.message);
  }
  await sleep(1000);
}
