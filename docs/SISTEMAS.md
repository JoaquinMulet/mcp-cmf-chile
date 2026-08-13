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
- **Sistemas legacy caídos/migrados**: normativa (buscador), dividendos, APV, clasificaciones de riesgo, SCOMP, SATRA, siniestros, cumplimiento, cartera C.1835, ISPRO, RVP por compañía, tasas (InfoFinanciera) y reportes BaseDato no entregan tablas parseables en la CMF. Las tools correspondientes lo reportan honestamente (error de fuente con la página oficial) — ver `verify-endpoints.ts` (categoría FUENTE).
- **Encoding**: los sistemas legacy sirven ISO-8859-1/windows-1252; el servidor decodifica y corrige mojibake.
- **Formatos**: HTML tabular, TXT (CSV `;`), XLS binarios (BIFF) y PDF firmados se convierten a JSON estructurado en el servidor.
- **Caducidad**: catálogos grandes (entidades, fondos) se cachean 24h en KV y se sirven paginados.
