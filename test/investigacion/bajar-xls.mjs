// Descarga el Excel de cumplimiento (xls=y) y lo parsea con xlsAJson del proyecto.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" };

const url = "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento1grid.php?lang=es&vigente=&cia=2&tiposociedad=A&sociedad%5B%5D=0&xls=y&mes1=03&mes2=03&anno1=2025&anno2=2025&anno_ini=2010&mes_ini=12&vsn=2";
const r = await fetch(url, {
  headers: { ...UA, Referer: "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento_index.php" },
  signal: AbortSignal.timeout(120000),
});
const buf = Buffer.from(await r.arrayBuffer());
console.log("status:", r.status, "| ct:", r.headers.get("content-type"), "| cd:", r.headers.get("content-disposition"), "| len:", buf.length);
writeFileSync(join(DIR, "cumplimiento_202503.xls"), buf);
console.log("head:", buf.slice(0, 16).toString("latin1").replace(/[^\x20-\x7e]/g, "."));
