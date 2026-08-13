# Sistemas de la CMF: cubiertos y excluidos

El servidor expone los sistemas públicos de datos de la CMF listados abajo. Esta tabla resume la cobertura por sistema.

## Cubiertos (86 tools)

> El conteo vivo (86) se verifica con `npx tsx test/verify-tools.ts`; no lo edites a mano.

| Sistema | Host | Tools |
|---|---|---|
| API oficial v3 (indicadores, balances, resultados, adecuación, fichas) | api.sbif.cl | 8 (`cmf_api_*`) |
| Ficha de entidad (pestanías 1-115) | www.cmfchile.cl | 14 (`cmf_empresa_*`) |
| Catálogo/búsqueda de entidades | www.cmfchile.cl | 3 (`cmf_buscar_entidad`, `cmf_listar_entidades`, `cmf_catalogo_entidades`) |
| Hechos/sanciones/resoluciones (entidad y globales) | www.cmfchile.cl | 8 |
| EEFF IFRS SA + indicadores (NCH e IFRS) | www.cmfchile.cl | 6 |
| Dividendos, APV, operaciones de capital, comunicaciones, tomas de control | www.cmfchile.cl | 6 |
| Clasificaciones de riesgo, listados IFRS, calendario divulgación, intermediarios, liquidez, préstamos, dictámenes | www.cmfchile.cl | 9 |
| Fondos mutuos (catálogo, cartera, comisiones, inversiones, BPR, costos, cartola) | www.cmfchile.cl | 9 |
| Fondos de inversión (catálogo, EEFF IFRS grid, comisiones máx.) | www.cmfchile.cl | 3 |
| Normativa (buscador + descarga) | www.cmfchile.cl | 2 |
| Seguros (EEFF FECU, RVP, SCOMP, RGCRI, SATRA, siniestros, ISPRO, SIC, **Depósito de Pólizas**, resoluciones de prohibición) | www.cmfchile.cl | 12 |
| XBRL (taxonomías, visor, consulta) | www.cmfchile.cl | 3 |
| Documentos firmados (ver_sgd) | www.cmfchile.cl | 3 (`cmf_documento_info`, `cmf_documento_descargar`, `cmf_documento_markdown`) |
| Bancos (tasas, cronología, BaseDato) | tasas/cronologiabancaria.cmfchile.cl | 3 |
| **Paquetes de alto nivel** (plan empresa, documentos ZIP, boletines FM) | www.cmfchile.cl | 3 (ver `PAQUETES.md`) |

## Excluidos (con motivo, documentados aquí)

| Sistema | Host | Motivo de exclusión |
|---|---|---|
| BEST (estadísticas bancarias) | best-cmf.cl | SPA Angular con XHR internos sin API pública estable; su funcionalidad de tasas está cubierta por `cmf_bancos_tasas`. |
| Conoce tu deuda | conocetudeuda.cmfchile.cl | Datos personales por RUT del usuario: no se exponen en un server público sin identidad. |
| Conoce tu seguro | conocetuseguro.cl | Datos personales por RUT del usuario: mismo motivo. |
| CMF Supervisa | supervisa.cmfchile.cl | Requiere login de supervisados (acceso restringido). |
| ClaveÚnica | www.cmfchile.cl/sitio/clave_unica | Flujo de identidad ciudadana; fuera del alcance read-only. |
| SIAC4 (atención ciudadana) | www.cmfchile.cl/sitio/siac4 | Trámites personales con login; fuera del alcance. |

## Notas operativas

- **Anti-bot F5**: los sistemas legacy (`/institucional/...`) pueden exigir el challenge `cookiesession1`. El servidor lo resuelve automáticamente.
- **Captchas**: hechos globales y cartola diaria exigen captcha: el servidor descarga la imagen real y la sirve como resource `cmf://captcha/{id}`; el agente pide el código al usuario y reintenta (single-use, TTL 10 min). Nunca OCR automático.
- **Endpoints vivos redescubiertos** (investigación js-reverse pasiva, 2026-08-13; evidencia en `docs/investigacion/` y `test/investigacion/`): APV→`cuadros.php`+`exportacion_excel_cuadros.php`; dividendos→`acc_dividendos1grid.php?lang=es` (dataAsJson); clasificaciones→flujo hash `excel_busqueda_clasificaciones.php`→`clasificaciones_asignadas_excel_fcorte_descargar.php`; préstamos→`informe_prestamos.php`; RVP→`svtas_<codigo>.php` (POST); SCOMP→`/institucional/inc/inf1|inf22|inf28_*.php`; SATRA→`inc/tra/art_12_val.php`; siniestros→`consulta_siniestro.php?anno=` (HTML con tags desanidados, normalizado); cumplimiento→`seg_cumplimiento1grid.php` con `xls=y&vsn=2`; C.1835→`descarga_cartera_inv.php?fnAjax=per_u|descarga` (ZIP, unzip propio); ISPRO→`descarga_ispro2.php?peri=` (ZIP, TXT ancho fijo parseado); AV/CB→`valores_agentes_cuadro2_ifrs.php`/`_cuadro2.php`; tasas→`tasas.cmfchile.cl/…InfoFinanciera?indice=4.2.1&FECHA=`; reportes→`datosbanco.cmfchile.cl/…BaseDato?reporte=MR1…`; inversiones FM→param `tipoinversion`; normativa→`normativa2.php` SOLO por número (`hidden_mercado=%`, sin `buscar`/`materia` vacíos).
- **Encoding**: los sistemas legacy sirven ISO-8859-1/windows-1252; el servidor decodifica y corrige mojibake.
- **Formatos**: HTML tabular, TXT (CSV `;`), XLS/BIFF, XLSX, ZIP con TXT de ancho fijo y PDF firmados se convierten a JSON estructurado en el servidor.
- **Caducidad**: catálogos grandes (entidades, fondos) se cachean 24h en KV y se sirven paginados.
