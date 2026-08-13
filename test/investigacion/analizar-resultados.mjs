// Extrae la sección legacy del resultado de cumplimiento y de av_cb NCH; parsea la grid Google Vis.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");

function seccion(nombre, archivo) {
  const txt = readFileSync(join(DIR, archivo), "latin1");
  const m = txt.match(/<!--\s*begin estadisticas\/merc_seguros\/sv_cumplimientos\/seg_cumplimiento1grid[\s\S]*?<!--\s*end estadisticas\/merc_seguros\/sv_cumplimientos\/seg_cumplimiento1grid[^>]*-->/i);
  if (!m) { console.log(`=== ${nombre}: marcador no hallado ===`); return ""; }
  writeFileSync(join(DIR, `${nombre}.legacy.html`), Buffer.from(m[0], "latin1"));
  console.log(`=== ${nombre}: ${m[0].length} chars ===`);
  return m[0];
}

const cump = seccion("cumplimiento_resultado", "cumplimiento_resultado.html");
if (cump) {
  const vis = cump.match(/google\.visualization\.arrayToDataTable\(([\s\S]*?)\);/);
  console.log("google.visualization.arrayToDataTable:", vis ? "PRESENTE" : "ausente");
  if (vis) {
    const data = JSON.parse(vis[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":'));
    console.log("columnas:", data[0].map((c) => c.label ?? c).join(" | "));
    console.log("filas:", data.length - 1);
    console.log("fila 0:", JSON.stringify(data[1]?.map?.((v) => (v && typeof v === "object" ? v.v : v))));
    console.log("fila 1:", JSON.stringify(data[2]?.map?.((v) => (v && typeof v === "object" ? v.v : v))));
  }
  const xls = cump.match(/['"]([^'"]*xls[^'"]*)['"]/gi);
  console.log("menciones xls:", [...new Set(xls ?? [])].slice(0, 8).join(" | "));
  const xlsLinks = cump.match(/href=['"]([^'"]+)['"][^>]*>[\s\S]{0,60}(excel|Excel|EXCEL)/gi);
  console.log("links excel:", xlsLinks?.slice(0, 5).join(" || ") ?? "ninguno");
  console.log("form2/export:", [...new Set([...cump.matchAll(/<form[^>]*>/g)].map((m) => m[0]))].join("\n  "));
}

// AV_CB NCH
const txtN = readFileSync(join(DIR, "av_cb_nch_2010_12.html"), "latin1");
const mN = txtN.match(/<!--\s*begin estadisticas\/valores_agentes_cuadro2[^>]*-->[\s\S]*?<!--\s*end estadisticas[^>]*-->/i);
if (mN) {
  writeFileSync(join(DIR, "av_cb_nch_resultado.html"), Buffer.from(mN[0], "latin1"));
  console.log(`\n=== av_cb NCH resultado: ${mN[0].length} chars ===`);
  console.log(mN[0].replace(/\s+/g, " ").slice(0, 1800));
}
