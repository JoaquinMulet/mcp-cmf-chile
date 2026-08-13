// Captura redirects manuales + descarga function.js de ISPRO + headers de cumplimiento.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" };

async function get(url, opts = {}) {
  const r = await fetch(url, { headers: { ...UA, Referer: "https://www.cmfchile.cl/institucional/estadisticas/" }, signal: AbortSignal.timeout(60000), ...opts });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, loc: r.headers.get("location"), ct: r.headers.get("content-type") ?? "", buf };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. cartera_inv redirect
{
  const g = await get("https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/descarga_cartera_inv.php", { redirect: "manual" });
  console.log("=== cartera_inv (manual) ===");
  console.log("status:", g.status, "| location:", g.loc, "| ct:", g.ct, "| len:", g.buf.length);
  if (g.status >= 300 && g.loc) {
    const g2 = await get(new URL(g.loc, "https://www.cmfchile.cl").href, { redirect: "manual" });
    console.log("  -> status:", g2.status, "| location:", g2.loc, "| len:", g2.buf.length);
  }
  await sleep(1100);
}

// 2. ISPRO function.js
{
  const g = await get("https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/produccion/ispro/js/function.js");
  console.log("\n=== ispro js/function.js: status", g.status, "ct", g.ct, "len", g.buf.length, "===");
  if (g.status === 200 && g.buf.length > 50) {
    writeFileSync(join(DIR, "ispro.function.js"), g.buf);
    console.log(g.buf.toString("utf8").slice(0, 8000));
  } else {
    console.log(g.buf.toString("latin1").slice(0, 500));
  }
  await sleep(1100);
}

// 3. cumplimiento headers (evidencia de fatal error)
{
  const g = await get("https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento1grid.php");
  console.log("\n=== cumplimiento ===");
  console.log("status:", g.status, "| ct:", g.ct, "| len:", g.buf.length);
  console.log("body:", g.buf.toString("utf8").replace(/\s+/g, " ").slice(0, 300));
  await sleep(1100);
}
