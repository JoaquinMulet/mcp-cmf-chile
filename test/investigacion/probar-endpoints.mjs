// Pruebas de endpoints descubiertos: descarga_ispro2.php y valores_agentes_cuadro2.php + sondas cumplimiento.
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
  return { status: r.status, loc: r.headers.get("location"), ct: r.headers.get("content-type") ?? "", cd: r.headers.get("content-disposition") ?? "", len: buf.length, buf };
}

// 1. ISPRO descarga directa sin captcha
{
  const g = await get("https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/produccion/ispro/descarga_ispro2.php?peri=202512");
  console.log("=== ispro2 peri=202512 ===");
  console.log("status:", g.status, "| ct:", g.ct, "| cd:", g.cd, "| len:", g.len);
  if (g.buf.length > 0) writeFileSync(join(DIR, "ispro2_202512.bin"), g.buf);
  console.log("head:", g.buf.slice(0, 300).toString("latin1").replace(/\s+/g, " "));
  await sleep(1200);
}

// 2. AV_CB POST
{
  const body = new URLSearchParams({ mm: "03", aa: "2025", norma: "IFRS" });
  const r = await fetch("https://www.cmfchile.cl/institucional/estadisticas/valores_agentes_cuadro2_ifrs.php", {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded", Referer: "https://www.cmfchile.cl/institucional/estadisticas/valores_agentes_cuadro.php" },
    body: body.toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(90000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  console.log("\n=== av_cb POST ifrs mm=03 aa=2025 ===");
  console.log("status:", r.status, "| loc:", r.headers.get("location"), "| ct:", r.headers.get("content-type"), "| cd:", r.headers.get("content-disposition"), "| len:", buf.length);
  writeFileSync(join(DIR, "av_cb_ifrs_2025_03.html"), buf);
  const txt = buf.toString("latin1");
  console.log(txt.replace(/\s+/g, " ").slice(0, 1500));
  await sleep(1200);
}

// 3. Cumplimiento: sondas de hermanos
for (const cand of [
  "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento1.php",
  "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento.php",
]) {
  const g = await get(cand, { redirect: "manual" });
  console.log(`\n=== ${cand.split("/").pop()} ===`);
  console.log("status:", g.status, "| loc:", g.loc, "| ct:", g.ct, "| len:", g.len);
  if (g.len < 2000) console.log("body:", g.buf.toString("utf8").replace(/\s+/g, " ").slice(0, 250));
  else console.log("head:", g.buf.toString("latin1").replace(/\s+/g, " ").slice(0, 250));
  await sleep(1200);
}
