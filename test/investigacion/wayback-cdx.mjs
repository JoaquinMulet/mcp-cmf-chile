// Consulta CDX de Wayback para las páginas muertas/redirigidas y baja snapshot del HTML original.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  return r.json();
}

const urls = [
  "www.cmfchile.cl/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/descarga_cartera_inv.php",
  "www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento1grid.php",
];

for (const u of urls) {
  console.log(`\n=== CDX ${u} ===`);
  try {
    const rows = await json(`http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(u)}&output=json&limit=15&filter=statuscode:200&collapse=digest`);
    for (const r of rows) console.log(r.join(" | "));
  } catch (e) {
    console.log("error:", e.message);
  }
  await sleep(1000);
}
