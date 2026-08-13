// Guarda respuestas finales: cumplimiento POST, av_cb NCH, ispro 202606, y analiza cartera zip + resultado av_cb.
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body, referer) {
  const r = await fetch(url, {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded", Referer: referer },
    body: body.toString(),
    signal: AbortSignal.timeout(120000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct: r.headers.get("content-type") ?? "", len: buf.length, buf };
}
async function get(url) {
  const r = await fetch(url, { headers: { ...UA, Referer: "https://www.cmfchile.cl/institucional/estadisticas/" }, signal: AbortSignal.timeout(120000) });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct: r.headers.get("content-type") ?? "", cd: r.headers.get("content-disposition") ?? "", len: buf.length, buf };
}

// 1. Cumplimiento POST (guardar)
{
  const body = new URLSearchParams({
    cia: "2", tiposociedad: "A", mes1: "03", anno1: "2025", mes2: "0", anno2: "0",
    "sociedad[]": "0", xls: "n", anno_ini: "2010", mes_ini: "12", imageField: "Consultar",
  });
  const r = await post("https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento1grid.php?lang=es&vigente=", body, "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento_index.php?lang=es&tiposociedad=A");
  console.log(`=== cumplimiento POST: status=${r.status} ct=${r.ct} len=${r.len} ===`);
  writeFileSync(join(DIR, "cumplimiento_resultado.html"), r.buf);
  await sleep(1500);
}

// 2. AV_CB NCH
{
  const body = new URLSearchParams({ mm: "12", aa: "2010", norma: "NCH" });
  const r = await post("https://www.cmfchile.cl/institucional/estadisticas/valores_agentes_cuadro2.php", body, "https://www.cmfchile.cl/institucional/estadisticas/valores_agentes_cuadro.php");
  console.log(`\n=== av_cb POST NCH 12/2010: status=${r.status} ct=${r.ct} len=${r.len} ===`);
  writeFileSync(join(DIR, "av_cb_nch_2010_12.html"), r.buf);
  await sleep(1500);
}

// 3. ISPRO 202606
{
  const g = await get("https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/produccion/ispro/descarga_ispro2.php?peri=202606");
  console.log(`\n=== ispro2 peri=202606: status=${g.status} ct=${g.ct} cd=${g.cd} len=${g.len} ===`);
  if (g.buf.length > 0) writeFileSync(join(DIR, "ispro2_202606.bin"), g.buf);
  await sleep(1500);
}

// 4. ZIP cartera: listar entradas
{
  const buf = readFileSync(join(DIR, "cartera_202512.bin"));
  writeFileSync(join(DIR, "cartera_202512.zip"), buf);
  console.log("\n=== cartera zip guardado (entradas listadas por PS abajo) ===");
}
