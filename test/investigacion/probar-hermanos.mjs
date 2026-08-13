// Sondea páginas hermanas descubiertas en Wayback sobre el sitio VIVO.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, opts = {}) {
  const r = await fetch(url, {
    headers: { ...UA, Referer: "https://www.cmfchile.cl/institucional/estadisticas/" },
    signal: AbortSignal.timeout(90000),
    ...opts,
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, loc: r.headers.get("location"), ct: r.headers.get("content-type") ?? "", len: buf.length, buf };
}

// 1. cumplimiento index vivo
{
  const g = await get("https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento_index.php?lang=es&tiposociedad=");
  console.log("=== seg_cumplimiento_index.php (vivo) ===");
  console.log("status:", g.status, "| ct:", g.ct, "| len:", g.len);
  if (g.buf.length > 0) writeFileSync(join(DIR, "cumplimiento_index.html"), g.buf);
  const txt = g.buf.toString("latin1");
  console.log("head:", txt.replace(/\s+/g, " ").slice(0, 800));
  await sleep(1200);
}

// 2. cartera_inv con tipoentidad
{
  const g = await get("https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/descarga_cartera_inv.php?tipoentidad=CSVID", { redirect: "manual" });
  console.log("\n=== cartera_inv?tipoentidad=CSVID (vivo) ===");
  console.log("status:", g.status, "| loc:", g.loc, "| ct:", g.ct, "| len:", g.len);
  if (g.buf.length > 0) writeFileSync(join(DIR, "cartera_inv_csvid.html"), g.buf);
  console.log("head:", g.buf.toString("latin1").replace(/\s+/g, " ").slice(0, 500));
  await sleep(1200);
}
