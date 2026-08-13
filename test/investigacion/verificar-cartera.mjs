// Verifica endpoints cartera (fnAjax) + POST cumplimiento grid + AV_CB sección resultado.
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, referer = "https://www.cmfchile.cl/institucional/estadisticas/", opts = {}) {
  const r = await fetch(url, { headers: { ...UA, Referer: referer }, signal: AbortSignal.timeout(90000), ...opts });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, loc: r.headers.get("location"), ct: r.headers.get("content-type") ?? "", cd: r.headers.get("content-disposition") ?? "", len: buf.length, buf };
}

const BASE = "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/";

// 1. Cartera JSON endpoints
for (const fn of ["per_u", "per_m", "per_a"]) {
  const g = await get(`${BASE}descarga_cartera_inv.php?tipoentidad=CSVID&fnAjax=${fn}`);
  console.log(`=== cartera fnAjax=${fn}: status=${g.status} ct=${g.ct} len=${g.len} ===`);
  console.log("body:", g.buf.toString("latin1").replace(/\s+/g, " ").slice(0, 400));
  await sleep(1200);
}

// 2. Cartera archi (exists?) para el último periodo conocido
{
  const g = await get(`${BASE}descarga_cartera_inv.php?tipoentidad=CSVID&fnAjax=archi&peri=202512`);
  console.log(`\n=== cartera fnAjax=archi peri=202512: status=${g.status} ct=${g.ct} len=${g.len} ===`);
  console.log("body:", g.buf.toString("latin1").replace(/\s+/g, " ").slice(0, 200));
  await sleep(1200);
}

// 3. Cartera descarga directa (sin captcha)
{
  const g = await get(`${BASE}descarga_cartera_inv.php?tipoentidad=CSVID&fnAjax=descarga&peri=202512`);
  console.log(`\n=== cartera fnAjax=descarga peri=202512: status=${g.status} ct=${g.ct} cd=${g.cd} len=${g.len} ===`);
  if (g.buf.length > 0) writeFileSync(join(DIR, "cartera_202512.bin"), g.buf);
  console.log("head:", g.buf.slice(0, 120).toString("latin1").replace(/[^\x20-\x7e]/g, "."));
  await sleep(1200);
}

// 4. POST al grid de cumplimiento (confirma fatal)
{
  const body = new URLSearchParams({
    cia: "2", tiposociedad: "A", mes1: "03", anno1: "2025", mes2: "0", anno2: "0",
    "sociedad[]": "0", xls: "n", anno_ini: "2010", mes_ini: "12", imageField: "Consultar",
  });
  const r = await fetch("https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento1grid.php?lang=es&vigente=", {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded", Referer: "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento_index.php" },
    body: body.toString(),
    signal: AbortSignal.timeout(90000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  console.log(`\n=== cumplimiento grid POST: status=${r.status} ct=${r.headers.get("content-type")} len=${buf.length} ===`);
  console.log("body:", buf.toString("utf8").replace(/\s+/g, " ").slice(0, 300));
  await sleep(1200);
}

// 5. AV_CB sección resultado
{
  const txt = readFileSync(join(DIR, "av_cb_ifrs_2025_03.html"), "latin1");
  const m = txt.match(/<!--\s*begin estadisticas\/valores_agentes_cuadro2[^>]*-->[\s\S]*?<!--\s*end estadisticas[^>]*-->/i);
  console.log(`\n=== av_cb resultado: ${m ? m[0].length : "NO"}` );
  if (m) {
    writeFileSync(join(DIR, "av_cb_resultado.html"), Buffer.from(m[0], "latin1"));
    console.log(m[0].replace(/\s+/g, " ").slice(0, 3000));
  }
}
