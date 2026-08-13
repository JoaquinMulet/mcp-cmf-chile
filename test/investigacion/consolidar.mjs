// Sonda de consolidación: verifica los endpoints de los lotes A, B y D.
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126" };
async function get(u, opts = {}) {
  try {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000), ...opts });
    const buf = await r.arrayBuffer();
    return { status: r.status, len: buf.byteLength, ct: r.headers.get("content-type") ?? "", txt: new TextDecoder("latin1").decode(buf), buf };
  } catch (e) { return { status: 0, len: 0, ct: "", txt: String(e), buf: new ArrayBuffer(0) }; }
}
async function post(u, body) {
  return get(u, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
}
const espera = () => new Promise((x) => setTimeout(x, 1100));

// A1. APV export excel
let r = await get("https://www.cmfchile.cl/institucional/estadisticas/exportacion_excel_cuadros.php?cuadro=T&tipo=T&mes_desde=01&ano_desde=2025&mes_hasta=12&ano_hasta=2025");
console.log("A1 APV excel:", r.status, r.len, r.ct, r.buf && new Uint8Array(r.buf)[0] === 0xd0 ? "OLE2!" : "?");
await espera();
// A2. Dividendos grid
r = await post("https://www.cmfchile.cl/institucional/estadisticas/divi/acc_dividendos1grid.php?lang=es", { "sociedad[]": "0", tipodiv: "DIV", mes: "01", anno: "2025", mes2: "12", anno2: "2025", enviar: "Buscar" });
console.log("A2 DIV grid:", r.status, r.len, "dataAsJson:", r.txt.includes("dataAsJson"), "| rows:", (r.txt.match(/\{c:/g) ?? []).length);
await espera();
// A3. Clasificaciones excel_busqueda
r = await post("https://www.cmfchile.cl/institucional/inc/excel_busqueda_clasificaciones.php", { clasificadora: "T", tipo_emisor: "T", emisor: "T", tipo_instrumento: "T", viginst: "VIG", insc_emisor: "T" });
console.log("A3 CLASIF step1:", r.status, r.len, "|", r.txt.slice(0, 160));
await espera();
// A4. Préstamos
r = await post("https://www.cmfchile.cl/institucional/estadisticas/informe_prestamos.php", { id_mes: "12", id_anio: "2025" });
console.log("A4 PRESTAMOS:", r.status, r.len, r.ct, r.buf && new Uint8Array(r.buf)[0] === 0xd0 ? "OLE2!" : "?", "|", r.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120));
await espera();
// B1. RVP grid
r = await post("https://www.cmfchile.cl/institucional/estadisticas/svtas_com_int_rvp.php", { p: "com_int_rvp", aaaa_ini: "2025", mm_ini: "01", aaaa_fin: "2025", mm_fin: "12" });
console.log("B1 RVP grid:", r.status, r.len, "tablas:", (r.txt.match(/<table/g) ?? []).length, "|", r.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120));
await espera();
// B2. SCOMP: leer JS de la página para nombres de informes
r = await get("https://www.cmfchile.cl/institucional/mercados/seguros_scomp_estadisticas.php");
const informes = [...new Set([...r.txt.matchAll(/informe[^'"]*['"]\s*:\s*['"]([^'"]+)['"]/gi)].map((m) => m[1]))];
const actionInc = [...new Set([...r.txt.matchAll(/action\s*=\s*['"]\.\.\/inc\/([^'"]+)['"]/gi)].map((m) => m[1]))];
console.log("B2 SCOMP informes:", JSON.stringify(informes.slice(0, 15)), "| action inc:", JSON.stringify(actionInc.slice(0, 10)));
await espera();
// B3. SATRA
r = await get("https://www.cmfchile.cl/institucional/inc/tra/art_12_val.php?soc=0&desde=01-01-2025&hasta=31-12-2025&dias=&mercado=S");
console.log("B3 SATRA:", r.status, r.len, "tablas:", (r.txt.match(/<table/g) ?? []).length, "|", r.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120));
await espera();
// B4. Siniestros
r = await get("https://www.cmfchile.cl/institucional/estadisticas/sgndr/consulta_siniestro.php?anno=2025");
console.log("B4 SINIESTROS:", r.status, r.len, "tablas:", (r.txt.match(/<table/g) ?? []).length, "td-th:", (r.txt.match(/<td[^>]*>.*<\/th>/g) ?? []).length);
await espera();
// D1. Tasas
r = await get("https://tasas.cmfchile.cl/sbifweb/servlet/InfoFinanciera?indice=4.2.1&FECHA=13/08/2026");
console.log("D1 TASAS:", r.status, r.len, "tablas:", (r.txt.match(/<table/g) ?? []).length, "|", r.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 140));
await espera();
// D2. Reportes BaseDato
r = await get("https://datosbanco.cmfchile.cl/sbifweb/servlet/BaseDato?instituciones-financieras=1&codUnicoBank=001&reporte=MR1&indice=30.1&month=6&year=2026");
console.log("D2 REPORTES:", r.status, r.len, "tablas:", (r.txt.match(/<table/g) ?? []).length, "|", r.txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 140));
await espera();
// D3. Inversiones FM
r = await get("https://www.cmfchile.cl/institucional/estadisticas/fm.inversiones_nacio.php?out=excel&lang=es&consulta=fondos&admins=0&tipofondo=0&moneda=0&mes=12&anio=2025&tipoinversion=naci&eminaci=0");
console.log("D3 INV_FM:", r.status, r.len, r.ct, r.buf && new Uint8Array(r.buf)[0] === 0xd0 ? "OLE2!" : "?");
await espera();
// D4. Normativa
r = await get("https://www.cmfchile.cl/institucional/legislacion_normativa/normativa2.php?tiponorma=CIR&numero=2343&enviado=1&hidden_mercado=%25");
console.log("D4 NORMATIVA:", r.status, r.len, "| No existen:", r.txt.includes("No existen Normas"), "| links:", (r.txt.match(/ver_archivo/g) ?? []).length);
