# Lote C — Sistemas legacy de seguros e intermediarios (CMF)

Verificado el 2026-08-13 sobre el sitio vivo (`www.cmfchile.cl`), metodología js-reverse pasiva
(Observe → Capture → Evidencia). Solo páginas públicas y endpoints que el propio JS del sitio invoca.
Rate limit 1 req/s. Script consolidado de verificación: `node test/investigacion/lote-c.mjs`
(todas las comprobaciones reproducibles; evidencia binaria en `test/investigacion/evidencia/`).

**Veredicto: 4/4 SOLUCION.** Ningún sistema está muerto; dos requieren parámetros
obligatorios que la URL "desnuda" no lleva (por eso parecían muertos).

---

## S1. CUMPLIMIENTO (Cias. de Seguros de Vida) — SOLUCION

- **Entrada**: `GET /institucional/estadisticas/merc_seguros/sv_cumplimientos/seg_cumplimiento_index.php?lang=es&tiposociedad=A`
  (form `f1` con catálogo de ~40 compañías de vida; `tiposociedad`: `A`=Vida, `R`=Reaseguradoras, `0`=Todos).
- **Endpoints de datos** (descubiertos en el `action` del form y en los links de la grid):
  - Grid HTML: `GET seg_cumplimiento1grid.php?lang=es&vigente=&cia=2&tiposociedad=A&sociedad[]=<RUT|0>&anno_ini=2010&mes_ini=12&mes1=03&anno1=2025&mes2=12&anno2=2025&xls=n`
    (también acepta POST con los mismos campos del form: `cia`, `tiposociedad`, `mes1/anno1`, `mes2/anno2`,
    `sociedad[]`, `anno_ini=2010`, `mes_ini=12`, `xls`).
  - Export Excel: misma URL con `xls=y`. Con `&vsn=2` devuelve **XLSX** limpio
    (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment`),
    parseable con `xlsAJson` de `src/client/parsers.ts` → 32 filas (31 compañías + TOTAL).
    Sin `vsn=2` devuelve BIFF `.xls` (143 KB, `application/x-msexcel`) con preámbulo.
- **Formato grid**: el HTML embebe el DataTable de Google Visualization inline:
  `var dataAsJson = {cols:[{id:'A',label:'...',type:'number'},...], rows:[{c:[{v:…,f:'…'},...]},...]};`
  (literal JS, no JSON estricto: números como `.09`). La primera columna de cada fila es el nombre
  de la métrica ("Patrimonio de riesgo", "Endeudamiento total", …).
- **Trampa verificada**: `GET seg_cumplimiento1grid.php` SIN `lang=es` → HTTP 200 con
  `Fatal error: Call to undefined function lang() in .../seg_cumplimiento1grid.php on line 76`.
  Con `lang=es` responde normalmente. Evidencia: `test/investigacion/recon2.mjs`.
- **Salida real**: `evidencia/cumplimiento_resultado.html` (grid, POST), `evidencia/cumplimiento_202503.xls`
  (XLSX parseado: 4LIFE Patrimonio de riesgo = 55.428.244, etc.), `evidencia/cumplimiento_index.legacy.html`.
- **Alcance**: información desde Dic-2010 hasta Mar-2026 (selects del index).

## S2. CARTERA DE INVERSIONES SEGUROS DE VIDA (Circular 1835) — SOLUCION

- **Trampa verificada**: `GET descarga_cartera_inv.php` sin parámetros → **302 a la portada**
  (`http://www.cmfchile.cl/` → 301 → `https://www.cmfchile.cl/`). Con `tipoentidad` el sistema vive.
  Evidencia: `recon2.mjs` / `lote-c.mjs`.
- **Entrada**: `GET .../dcisgv/descarga_cartera_inv.php?tipoentidad=CSVID` (vida) o `tipoentidad=CSGEN`
  (generales; verificado con `fnAjax=per_u`).
- **Endpoints AJAX** (documentados en su propio `js/function.js`, descargado en `evidencia/cartera.function.js`),
  todos sobre `descarga_cartera_inv.php` con `tipoentidad`:
  - `fnAjax=per_u` → JSON `[{"u_agno":"2026","u_vmes":"07","u_nmes":"Julio"},…]` (último periodo: Jul 2026).
  - `fnAjax=per_m` → JSON meses `[{"vmes":"01","nmes":"Enero"},…]`.
  - `fnAjax=per_a` → JSON años `[{"agno":"2026"},…]` (desde 2016).
  - `fnAjax=archi&peri=YYYYMM` → `1` si el periodo existe.
  - `fnAjax=descarga&peri=YYYYMM` → **ZIP** (`application/octet-stream`,
    `Content-Disposition: attachment; filename=YYYYMMv.zip`). Ej.: `peri=202512` → 16,4 MB.
- **Formato del ZIP**: una entrada por compañía y tipo de archivo: `<prefijo>YYYYMMv.<rut>`
  (prefijos `a,b,c,d,e,f,g,i,o,p,t,x` = tipos de inversión del reporte C-1835), archivos TXT de
  ancho fijo: línea 1 = RUT + nombre + periodo; filas de datos de largo fijo.
  Diseño documentado en `/sitio/seil/software-manual/sgsci/SGSCI_circ_1835.doc` (link en la propia página).
- **Captcha**: la UI exige captcha (`/sitio/biblioteca/captcha2/captcha.php`, `accion=valida`), pero
  **el servidor NO lo valida en `fnAjax=descarga`** (descarga directa verificada sin session de captcha).
- **Salida real**: `evidencia/cartera_202512.zip` (16,4 MB, listado de entradas en la bitácora).

## S3. ISPRO (Producción de Corredores de Seguros) — SOLUCION

- **Entrada**: `GET .../produccion/ispro/descarga_ispro.php` (form con `s_agno` 2017-2025, `hid_maxp=202606`).
- **Endpoint de descarga** (descubierto en su `js/function.js`, `evidencia/ispro.function.js`):
  `GET descarga_ispro2.php?peri=YYYYMM` (la UI arma `peri=<año>12`; el "último periodo" usa `hid_maxp`).
  Verificado `peri=202512` y `peri=202606` → **ZIP** `application/zip`,
  `Content-Disposition: attachment; filename=descarga_ispro_<ts>.zip`.
- **Captcha**: igual que S2 — exigido por la UI, **no validado por el servidor** en `descarga_ispro2.php`.
- **Formato del ZIP**: 3 TXT de ancho fijo (encoding latin1) + manual de diseño:
  - `identifi_<ts>.txt` (2.963 líneas en 202512): cod_corredor(10) + nombre(75) + RUT + dirección + comuna/región.
  - `prodramo_<ts>.txt` (62.250 líneas): `periodo(6) corredor(10) <n> ramo(3) importe(+/-11)`
    — ej. `202512 0022206850 1 001+0000004440`.
  - `intercia_<ts>.txt` (25.999 líneas): `periodo(6) corredor(10) <n> tipo(2) rut_cia(10) nombre_cia(20) importe(+/-11)`
    — ej. `202512 0022206850 1 00 0990170002SURAMERICANA G      +0000005085`.
  - `ISPRO_circ_1266.doc` (152 KB): documento descriptivo de los archivos.
- **Salida real**: `evidencia/ispro2_202512.bin` (687 KB) y `evidencia/ispro2_202606.bin` (20 KB),
  `evidencia/ISPRO_circ_1266.doc`.
- **Nota**: el link de la página al "documento descriptivo" apunta a `ISPRO_circ_1266.doc` relativo,
  pero el doc vive dentro de cada ZIP.

## S4. CUADRO DE RESULTADOS AV/CB — SOLUCION

- **Entrada**: `GET .../valores_agentes_cuadro.php` (form `form1`, JS `valida()` elige el action).
- **Endpoints** (descubiertos en `valida()` del inline JS de la propia página):
  - `POST /institucional/estadisticas/valores_agentes_cuadro2_ifrs.php` con
    `mm=03|06|09|12`, `aa=2001..2026`, `norma=IFRS` (habilitado para aa>2010; verificado `mm=03&aa=2025&norma=IFRS`).
  - `POST /institucional/estadisticas/valores_agentes_cuadro2.php` con `norma=NCH`
    (verificado `mm=12&aa=2010&norma=NCH`; para aa≤2010 la norma queda deshabilitada en la UI).
- **Formato**: HTML con dos tablas inline — `<table id="tabla_corredores">` (Corredores de Bolsa) y
  `<table id="tabla_agentes">` (Agentes de Valores), valores en miles de $, columnas = periodo y periodo
  del año anterior. Parseable con `htmlTablaAJson` de `src/client/parsers.ts`. No hay export a Excel/CSV.
- **Trampa verificada**: POST con body mal formado (p. ej. `[object Object]`) devuelve el estado por defecto
  "RESULTADOS AL 1 DE Enero de 2001 Y 2000" con tablas vacías — hay que enviar `mm/aa/norma` bien formados.
- **Salida real**: `evidencia/av_cb_ifrs_2025_03.html` (127 KB, "RESULTADOS AL 31 DE Marzo de 2025 Y 2024";
  ej. BANCHILE S.A. CB = 11.492.415 miles de $) y `evidencia/av_cb_nch_2010_12.html`
  ("RESULTADOS AL 31 DE Diciembre de 2010 Y 2009"; BANCHILE = 23.448.966).

---

## Notas transversales

- Todas las páginas legacy llegan embebidas dentro del template del portal (Newtenberg) entre
  `<!-- begin estadisticas/... -->` y `<!-- end estadisticas/... -->`; el contenido viene en latin1/UTF-8
  mixto con entidades HTML.
- Los catálogos/descargas con captcha (S2, S3) validan el captcha solo en la UI: los endpoints de
  descarga no exigen session de captcha (verificado con GETs directos sin cookies).
- Trampas de URL documentadas para los clientes: (a) cumplimiento exige `lang=es`, (b) cartera exige
  `tipoentidad`, (c) ISPRO/AV-CB funcionan con la URL directa pero requieren los parámetros exactos.
- Evidencia reproducible: `node test/investigacion/lote-c.mjs` re-ejecuta las 15 comprobaciones.
  Binarios de prueba guardados en `test/investigacion/evidencia/` (HTML, ZIP, XLSX, DOC).
