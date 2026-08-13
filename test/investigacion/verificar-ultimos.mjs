// Últimas verificaciones: av_cb tablas IFRS, cartera CSGEN, ispro doc extraído.
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Tablas del resultado IFRS de AV_CB
{
  const txt = readFileSync(join(DIR, "av_cb_resultado.html"), "latin1");
  const ids = [...new Set([...txt.matchAll(/<table[^>]*id="([^"]+)"/g)].map((m) => m[1]))];
  const h3s = [...new Set([...txt.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map((m) => m[1].trim()))];
  const fuertes = [...new Set([...txt.matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((m) => m[1].trim()))].filter((s) => s.length < 120);
  console.log("=== av_cb IFRS: ids de tabla:", ids.join(", "));
  console.log("h3:", h3s.join(" | "));
  console.log("strong:", fuertes.slice(0, 6).join(" | "));
}

// 2. cartera tipoentidad=CSGEN
{
  const r = await fetch("https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/descarga_cartera_inv.php?tipoentidad=CSGEN&fnAjax=per_u", {
    headers: { ...UA, Referer: "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/descarga_cartera_inv.php?tipoentidad=CSGEN" },
    signal: AbortSignal.timeout(90000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  console.log("\n=== cartera CSGEN per_u: status", r.status, "len", buf.length, "===");
  console.log(buf.toString("latin1").slice(0, 300));
  await sleep(1200);
}

// 3. Extraer ISPRO_circ_1266.doc del zip (evidencia)
{
  const { default: yauzl } = await import("yauzl");
  console.log("\n(extracción doc via PowerShell en bash siguiente)");
}
