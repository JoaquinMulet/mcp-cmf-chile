// Extrae la sección legacy (entre <!-- begin ... --> y <!-- end ... -->) de cada HTML guardado.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");

for (const nombre of ["cumplimiento", "cartera_inv", "ispro", "av_cb"]) {
  const txt = readFileSync(join(DIR, `${nombre}.html`), "latin1");
  const m = txt.match(/<!--\s*begin estadisticas[\s\S]*?end estadisticas[^>]*-->/i);
  if (!m) {
    console.log(`=== ${nombre}: NO hay sección "begin estadisticas" ===`);
    const b = txt.match(/<!--begin main-->/i);
    console.log("  begin main:", b ? "sí" : "no");
    continue;
  }
  const seccion = m[0];
  writeFileSync(join(DIR, `${nombre}.legacy.html`), Buffer.from(seccion, "latin1"));
  console.log(`=== ${nombre}: sección legacy ${seccion.length} chars ===`);
  console.log(seccion.slice(0, 6000));
  console.log("\n...TAIL...\n");
  console.log(seccion.slice(-3000));
  console.log("\n\n");
}
