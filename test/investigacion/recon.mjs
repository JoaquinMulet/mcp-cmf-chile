// Recon pasivo de las 4 páginas legacy (lote-c). Guarda HTML crudo y lista forms/scripts.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "evidencia");
mkdirSync(OUT, { recursive: true });

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" };

const paginas = [
  ["cumplimiento", "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento1grid.php"],
  ["cartera_inv", "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv/descarga_cartera_inv.php"],
  ["ispro", "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/produccion/ispro/descarga_ispro.php"],
  ["av_cb", "https://www.cmfchile.cl/institucional/estadisticas/valores_agentes_cuadro.php"],
];

async function get(url) {
  const r = await fetch(url, { headers: { ...UA, Referer: "https://www.cmfchile.cl/institucional/estadisticas/" }, signal: AbortSignal.timeout(60000) });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct: r.headers.get("content-type") ?? "", len: buf.length, buf };
}

for (const [nombre, url] of paginas) {
  const g = await get(url);
  const txt = g.buf.toString("latin1");
  writeFileSync(join(OUT, `${nombre}.html`), g.buf);
  console.log(`\n=== ${nombre} | status=${g.status} ct=${g.ct} len=${g.len} ===`);
  const forms = [...txt.matchAll(/<form[^>]*>/gi)].map((m) => m[0]);
  console.log("forms:", forms.length ? forms.join("\n  ") : "ninguno");
  const scripts = [...new Set([...txt.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]))];
  console.log("scripts:", scripts.length ? scripts.join("\n  ") : "ninguno");
  const inline = txt.match(/<script(?![^>]*src)[^>]*>([\s\S]{0,20000}?)<\/script>/gi) ?? [];
  console.log("inline-scripts:", inline.length);
  // URLs .php/.json/.xml/.xls referenciadas en el HTML
  const refs = [...new Set([...txt.matchAll(/["']([^"']+\.(?:php|json|xml|xls|xlsx|csv)[^"']*)["']/gi)].map((m) => m[1]))];
  console.log("refs-datos:", refs.length ? refs.slice(0, 30).join("\n  ") : "ninguno");
  await new Promise((r) => setTimeout(r, 1100));
}
console.log("\nGuardado en", OUT);
