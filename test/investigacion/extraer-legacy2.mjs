// Extrae sección legacy de cumplimiento_index.html y cartera_inv_csvid.html
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");

for (const [nombre, reIni] of [
  ["cumplimiento_index", /<!--\s*begin estadisticas\/merc_seguros\/sv_cumplimientos[\s\S]*?<!--\s*end estadisticas\/merc_seguros\/sv_cumplimientos[^>]*-->/i],
  ["cartera_inv_csvid", /<!--\s*begin estadisticas\/merc_seguros\/cartera_inversiones[\s\S]*?<!--\s*end estadisticas\/merc_seguros\/cartera_inversiones[^>]*-->/i],
]) {
  const txt = readFileSync(join(DIR, `${nombre}.html`), "latin1");
  const m = txt.match(reIni);
  if (!m) {
    console.log(`=== ${nombre}: patrón no encontrado; buscando "begin" genérico ===`);
    const b = txt.match(/<!--\s*begin (?:estadisticas|web)\/[^>]*-->/i);
    console.log(b ? b[0] : "sin marcador");
    continue;
  }
  writeFileSync(join(DIR, `${nombre}.legacy.html`), Buffer.from(m[0], "latin1"));
  console.log(`=== ${nombre}: ${m[0].length} chars ===`);
  console.log(m[0].slice(0, 7000));
  console.log("\n...TAIL...\n");
  console.log(m[0].slice(-2500));
  console.log("\n\n");
}
