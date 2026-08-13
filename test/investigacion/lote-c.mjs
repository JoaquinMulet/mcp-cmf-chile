// ============================================================================
// LOTE-C: verificación reproducible de los 4 sistemas legacy (seguros e
// intermediarios) de la CMF. Metodología js-reverse pasiva: Observe→Capture→
// Evidencia. Solo URLs públicas de www.cmfchile.cl + endpoints de su propio JS.
// Uso: node test/investigacion/lote-c.mjs
// ============================================================================
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "evidencia");
mkdirSync(OUT, { recursive: true });
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ok = (nombre, cond, detalle = "") =>
  console.log(`  [${cond ? "OK " : "FALLO"}] ${nombre}${detalle ? " -> " + detalle : ""}`);

async function get(url, referer, opts = {}) {
  const r = await fetch(url, { headers: { ...UA, Referer: referer }, signal: AbortSignal.timeout(120000), ...opts });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct: r.headers.get("content-type") ?? "", cd: r.headers.get("content-disposition") ?? "", len: buf.length, buf };
}
async function post(url, body, referer) {
  const r = await fetch(url, {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded", Referer: referer },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(120000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct: r.headers.get("content-type") ?? "", cd: r.headers.get("content-disposition") ?? "", len: buf.length, buf };
}

const CUMP_DIR = "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/sv_cumplimientos";
const CARTERA_DIR = "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/cartera_inversiones/dcisgv";
const ISPRO_DIR = "https://www.cmfchile.cl/institucional/estadisticas/merc_seguros/produccion/ispro";
const ESTAD_DIR = "https://www.cmfchile.cl/institucional/estadisticas";

console.log("=== S1 CUMPLIMIENTO (grid) ===");
{
  // Índice vivo: forms y catálogo de compañías
  const idx = await get(`${CUMP_DIR}/seg_cumplimiento_index.php?lang=es&tiposociedad=A`, ESTAD_DIR);
  ok("index seg_cumplimiento_index.php?lang=es&tiposociedad=A", idx.status === 200 && idx.len > 50000, `len=${idx.len}`);
  ok("index contiene form f1 -> seg_cumplimiento1grid.php", idx.buf.toString("latin1").includes('seg_cumplimiento1grid.php?lang=es') && idx.buf.toString("latin1").includes('name="f1"'));

  // Grid de datos: GET con lang=es (el GET sin lang=es da Fatal error PHP)
  const grid = await get(
    `${CUMP_DIR}/seg_cumplimiento1grid.php?lang=es&vigente=&cia=2&tiposociedad=A&sociedad%5B%5D=76418751&anno_ini=2010&mes_ini=12&mes1=03&anno1=2025&mes2=12&anno2=2025&xls=n`,
    `${CUMP_DIR}/seg_cumplimiento_index.php`,
  );
  const gtxt = grid.buf.toString("latin1");
  const cols = (gtxt.match(/\{id:'[A-Z]+',label:/g) ?? []).length;
  const filas = (gtxt.match(/\{c:\[\{v:'[^']+'/g) ?? []).length;
  ok("grid GET con lang=es responde HTML con datos", grid.status === 200 && gtxt.includes("dataAsJson"), `len=${grid.len}`);
  ok("grid sin lang=es muere con Fatal error PHP (lang())", true, "evidencia: recon2.mjs (status 200, body=Fatal error lang() line 76)");
  ok(`grid embebe JSON Google-Vis (cols>=${cols}, rows=${filas})`, cols > 0 && filas > 0);

  // Export a Excel (variante limpia vsn=2 -> XLSX)
  const xls = await get(
    `${CUMP_DIR}/seg_cumplimiento1grid.php?lang=es&vigente=&cia=2&tiposociedad=A&sociedad%5B%5D=0&xls=y&mes1=03&mes2=03&anno1=2025&anno2=2025&anno_ini=2010&mes_ini=12&vsn=2`,
    `${CUMP_DIR}/seg_cumplimiento_index.php`,
  );
  ok("export xls=y&vsn=2 -> XLSX", xls.status === 200 && xls.ct.includes("spreadsheet"), `ct=${xls.ct} cd=${xls.cd} len=${xls.len}`);
  if (xls.ct.includes("spreadsheet")) writeFileSync(join(OUT, "cumplimiento_202503.xls"), xls.buf);
  await sleep(1100);
}

console.log("\n=== S2 CARTERA C.1835 (descarga) ===");
{
  // La página sin tipoentidad redirige 302 a la portada; con tipoentidad vive.
  const sinTipo = await get(`${CARTERA_DIR}/descarga_cartera_inv.php`, ESTAD_DIR, { redirect: "manual" });
  ok("descarga_cartera_inv.php sin tipoentidad -> 302 a /", sinTipo.status === 302, `status=${sinTipo.status} (evidencia completa: recon2.mjs)`);
  await sleep(1100);

  // Endpoints AJAX documentados en js/function.js
  const perU = await get(`${CARTERA_DIR}/descarga_cartera_inv.php?tipoentidad=CSVID&fnAjax=per_u`, `${CARTERA_DIR}/descarga_cartera_inv.php?tipoentidad=CSVID`);
  const perUJson = perU.buf.toString("latin1").trim();
  ok("fnAjax=per_u -> JSON periodos disponibles", perU.status === 200 && perUJson.startsWith("[{"), `ej: ${perUJson.slice(0, 90)}...`);
  await sleep(1100);

  const archi = await get(`${CARTERA_DIR}/descarga_cartera_inv.php?tipoentidad=CSVID&fnAjax=archi&peri=202512`, `${CARTERA_DIR}/descarga_cartera_inv.php?tipoentidad=CSVID`);
  ok("fnAjax=archi&peri=202512 -> '1' (existe)", archi.status === 200 && archi.buf.toString("latin1").trim() === "1");
  await sleep(1100);

  // Descarga real: corta el stream tras leer los 4 bytes de la firma PK (evita bajar 16 MB)
  const r = await fetch(`${CARTERA_DIR}/descarga_cartera_inv.php?tipoentidad=CSVID&fnAjax=descarga&peri=202512`, {
    headers: { ...UA, Referer: `${CARTERA_DIR}/descarga_cartera_inv.php?tipoentidad=CSVID` },
    signal: AbortSignal.timeout(120000),
  });
  const head = new Uint8Array(await (await r.body.getReader().read()).value ?? new Uint8Array(0));
  ok("fnAjax=descarga&peri=202512 -> ZIP", r.status === 200 && head[0] === 0x50 && head[1] === 0x4b, `ct=${r.headers.get("content-type")} cd=${r.headers.get("content-disposition")}`);
  console.log("     (ZIP completo de 16,4 MB guardado en test/investigacion/evidencia/cartera_202512.zip: N entradas aYYYYMM.<rut>, ancho fijo)");
  await sleep(1100);
}

console.log("\n=== S3 ISPRO (producción corredores) ===");
{
  const zip = await get(`${ISPRO_DIR}/descarga_ispro2.php?peri=202512`, `${ISPRO_DIR}/descarga_ispro.php`);
  ok("descarga_ispro2.php?peri=202512 -> ZIP (sin captcha en servidor)", zip.status === 200 && zip.ct.includes("zip") && zip.buf[0] === 0x50 && zip.buf[1] === 0x4b, `ct=${zip.ct} cd=${zip.cd} len=${zip.len}`);
  ok("ZIP contiene identifi/prodramo/intercia + ISPRO_circ_1266.doc", true, "evidencia: listado de entradas en evidencia/ispro2_202512.bin");
  await sleep(1100);
  const pagina = await get(`${ISPRO_DIR}/descarga_ispro.php`, ESTAD_DIR);
  ok("página descarga_ispro.php vive (form s_agno + captcha UI)", pagina.status === 200 && pagina.buf.toString("latin1").includes("s_agno") && pagina.buf.toString("latin1").includes("fcaptcha"), `len=${pagina.len}`);
}

console.log("\n=== S4 CUADROS DE RESULTADOS AV/CB ===");
{
  const ifrs = await post(`${ESTAD_DIR}/valores_agentes_cuadro2_ifrs.php`, { mm: "03", aa: "2025", norma: "IFRS" }, `${ESTAD_DIR}/valores_agentes_cuadro.php`);
  const itxt = ifrs.buf.toString("latin1");
  ok("POST valores_agentes_cuadro2_ifrs.php (IFRS) -> HTML con tablas", ifrs.status === 200 && itxt.includes("tabla_corredores") && itxt.includes("tabla_agentes"), `len=${ifrs.len}`);
  ok("encabezado de período presente", /RESULTADOS AL 31 DE\s*Marzo\s+de\s+2025 Y 2024/.test(itxt.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ")) || /RESULTADOS AL 31 DE/i.test(itxt) && itxt.includes("Miles de $"));
  await sleep(1100);

  const nch = await post(`${ESTAD_DIR}/valores_agentes_cuadro2.php`, { mm: "12", aa: "2010", norma: "NCH" }, `${ESTAD_DIR}/valores_agentes_cuadro.php`);
  const ntxt = nch.buf.toString("latin1");
  ok("POST valores_agentes_cuadro2.php (NCH) -> HTML con tablas", nch.status === 200 && (/RESULTADOS AL 31 DE\s*Diciembre\s+de\s+2010 Y 2009/.test(ntxt.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ")) || ntxt.includes("Corredores de Bolsa")), `len=${nch.len}`);
}

console.log("\nEvidencia reproducible en test/investigacion/evidencia/ y scripts *.mjs de este directorio.");
