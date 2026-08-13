# Catálogo del MCP mcp-cmf-chile (lo que ve el agente)

- serverInfo: {"name":"mcp-cmf-chile","version":"0.1.0"}

## INSTRUCTIONS (InitializeResult.instructions)

```
Servidor MCP con los datos públicos de la Comisión para el Mercado Financiero de Chile (CMF).
Uso recomendado:
1. Para analizar una empresa: cmf_empresa_por_ticker (ticker de bolsa, ej: COPEC, SQM-B; los RUTs provienen del catálogo de empresas en bolsa en github.com/JoaquinMulet/empresas-cmf-chile) o cmf_buscar_entidad (una palabra clave o RUT) para obtener el RUT canónico → cmf_empresa_info → cmf_empresa_eeff_historial (períodos disponibles) → cmf_empresa_eeff (estados financieros IFRS/NCH por período; use modo=markdown para leer el PDF auditado convertido a Markdown) → cmf_empresa_hechos → cmf_empresa_sanciones/resoluciones.
2. Para descargar todo de una empresa: cmf_empresa_paquete (plan de descarga, máx 2 años por llamada) y cmf_empresa_paquete_documentos (ZIP ordenado, máx 3 períodos por llamada).
3. Fondos mutuos: cmf_fondos_mutuos_catalogo para identificar fondos → cmf_fondos_mutuos_bpr (patrimonio/rentabilidad) → cmf_fondos_mutuos_costos (TAC).
4. Indicadores económicos: cmf_api_indicador_valor (serie: uf, dolar, euro, tab, utm, ipc, tip, tmc). Para balances bancarios, identifique la institución por su código SBIF (ej: 001=Banco de Chile, 037=Banco Santander-Chile; 999=el sistema total; la lista completa está en el resource cmf://bancos/codigos).
5. Normativa y seguros: cmf_normativa_buscar y cmf_seguros_*.
Límites y notas:
- Captchas (cmf_hechos_globales y cmf_fondos_mutuos_cartola): al llamarlas sin código, la tool descarga la imagen captcha de la CMF y le entrega un resource cmf://captcha/{id}; pida al usuario que lea los 6 caracteres y reintente con captcha=<código> y captcha_id=<id>.
- Fechas en formato YYYY-MM-DD; los RUTs se aceptan con o sin dígito verificador (ej: 90690000 o 90690000-5).
- Resultados paginados: las tools con offset/limit devuelven next_offset/total; itere para ver todas las filas (nunca asuma que la primera página es el total).
- Los documentos firmados se gestionan en el servidor; para leer el contenido de un PDF: cmf_documento_markdown (token s567 o url completa del documento).
- Si una consulta devuelve 'sin datos', verifique el período o la norma (IFRS vs NCH) antes de concluir que la información no existe; si el error menciona que la fuente de la CMF no devolvió datos, es una condición del sistema de la CMF (verifique la página oficial indicada) y no implica ausencia de datos.
- Sistemas legacy de la CMF actualmente sin datos parseables (las tools lo reportan como error de fuente, no como ausencia): normativa (buscador), dividendos, APV, clasificaciones de riesgo, SCOMP, SATRA, siniestros, cumplimiento de aseguradoras, cartera C.1835, producción de corredores (ISPRO), rentas vitalicias por compañía, tasas bancarias (InfoFinanciera), reportes BaseDato, inversiones agregadas de fondos mutuos y cuadros de resultados AV/CB.
```

## TOOLS (86)

### cmf_api_indicador_valor
- title: Valor de indicador (UF, dólar, UTM, IPC, TMC…)
- description: Devuelve el valor de un indicador económico oficial (UF, Dólar Observado, Euro, TAB, UTM, IPC, TIP, TMC) para un día o un mes, desde la API oficial v3 de la CMF (api.sbif.cl). Identifique la serie con serie (ej: uf) y el período con anio (AAAA) y mes (MM); agregue dia (DD) para el valor del día exacto, sin dia devuelve el registro del mes. Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para valores puntuales; para la evolución en un rango use cmf_api_indicador_serie.
- parámetros:
  - serie (REQUERIDO): Indicador a consultar: uf, dolar, euro, tab, utm, ipc, tip o tmc. Ej: uf
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - dia: Día en formato DD (acepta 1 o '01'). Ej: 15
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {serie, fecha, valor}

### cmf_api_indicador_serie
- title: Serie histórica de indicador
- description: Devuelve la serie histórica mensual de un indicador económico (UF, dólar, euro, TAB, UTM, IPC, TIP, TMC) en un rango de períodos, desde la API oficial v3 de la CMF. Defina el rango con desde/hasta en AAAA o AAAA-MM (ej: desde=2023-01, hasta=2024-12; el día se ignora); si algún extremo no trae mes, la consulta se hace por año completo. La salida incluye total y hasta 100 registros; "Sin registros" indica que el rango no tiene datos, verifique el período. Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para evoluciones históricas; para un valor puntual use cmf_api_indicador_valor.
- parámetros:
  - serie (REQUERIDO): Indicador a consultar: uf, dolar, euro, tab, utm, ipc, tip o tmc. Ej: uf
  - desde (REQUERIDO): Inicio del rango en AAAA o AAAA-MM. Ej: 2023-01
  - hasta (REQUERIDO): Fin del rango en AAAA o AAAA-MM. Ej: 2024-12
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {serie, desde, hasta, total, registros}

### cmf_api_balance_institucion
- title: Balance de institución financiera
- description: Devuelve el balance mensual de instituciones financieras (bancos) supervisadas, desde la API oficial v3 de la CMF. Filtre el período con anio (AAAA) y mes (MM); use institucion para un banco específico (999 = sistema financiero total) y cuenta para una sola cuenta contable (ej: 210000), sin ellos devuelve los datos completos del período. Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para activos y pasivos contables; para ingresos y gastos del mismo período use cmf_api_resultados_institucion.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - institucion: Código SBIF de la institución (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; 999=sistema total; vea el resource cmf://bancos/codigos; acepta 999 o '999')
  - cuenta: Código de cuenta (ej: 210000)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, institucion, cuenta, componente, indicador, data}

### cmf_api_resultados_institucion
- title: Estado de resultados de institución financiera
- description: Devuelve el estado de resultados mensual de instituciones financieras (bancos), desde la API oficial v3 de la CMF. Filtre el período con anio (AAAA) y mes (MM); use institucion para un banco específico (999 = sistema financiero total), sin institucion devuelve los datos del período completo. Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para ingresos y gastos del mes; para el balance contable use cmf_api_balance_institucion.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - institucion: Código SBIF de la institución (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; 999=sistema total; vea el resource cmf://bancos/codigos; acepta 999 o '999')
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, institucion, cuenta, componente, indicador, data}

### cmf_api_adecuacion_capital
- title: Adecuación de capital
- description: Devuelve componentes o indicadores de adecuación de capital (activos ponderados por riesgo, límites, patrimonio efectivo, IRE/IRS) de una institución financiera, desde la API oficial v3 de la CMF. Indique el período con anio (AAAA) y mes (MM), la institución con institucion (999 = sistema total) y la vista con componente (activos, limites, patrimonioefectivo o indicadores); con componente=indicadores agregue indicador=ire o irs. Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para supervisar la solvencia bancaria; para el balance o resultados contables use cmf_api_balance_institucion o cmf_api_resultados_institucion.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - institucion (REQUERIDO): Código SBIF de la institución (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; 999=sistema total; vea el resource cmf://bancos/codigos; acepta 999 o '999')
  - componente (REQUERIDO) enum=[activos|limites|patrimonioefectivo|indicadores]: Componente a consultar
  - indicador enum=[ire|irs]: Indicador (solo si componente=indicadores)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, institucion, cuenta, componente, indicador, data}

### cmf_api_ficha_institucion
- title: Ficha de institución financiera
- description: Devuelve la ficha de una institución financiera (domicilio, filiales, ejecutivos y antecedentes) para un período, desde la API oficial v3 de la CMF. Identifique la institución con institucion (ej: 001) y el período con anio (AAAA) y mes (MM). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para datos generales de un banco; para sus cifras contables use cmf_api_balance_institucion o cmf_api_resultados_institucion.
- parámetros:
  - institucion (REQUERIDO): Código SBIF de la institución financiera (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; vea cmf://bancos/codigos)
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, institucion, cuenta, componente, indicador, data}

### cmf_api_accionistas_institucion
- title: Accionistas de institución financiera
- description: Devuelve la lista de accionistas de una institución financiera para un período, desde la API oficial v3 de la CMF. Identifique la institución con institucion (ej: 001) y el período con anio (AAAA) y mes (MM). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para la estructura de propiedad de un banco; para su directorio use cmf_api_integrantes_institucion.
- parámetros:
  - institucion (REQUERIDO): Código SBIF de la institución financiera (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; vea cmf://bancos/codigos)
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, institucion, cuenta, componente, indicador, data}

### cmf_api_integrantes_institucion
- title: Integrantes de directorio de institución financiera
- description: Devuelve los integrantes del directorio de una institución financiera para un período, desde la API oficial v3 de la CMF. Identifique la institución con institucion (ej: 001) y el período con anio (AAAA) y mes (MM). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para el gobierno corporativo de un banco; para su estructura de propiedad use cmf_api_accionistas_institucion.
- parámetros:
  - institucion (REQUERIDO): Código SBIF de la institución financiera (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; vea cmf://bancos/codigos)
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, institucion, cuenta, componente, indicador, data}

### cmf_empresa_por_ticker
- title: Buscar empresa por ticker (NEMO)
- description: Busca una empresa chilena por su ticker de bolsa (NEMO: COPEC, SQM-B, LTM, BCI…) usando el catálogo de empresas en bolsa del proyecto empresas-cmf-chile (github.com/JoaquinMulet/empresas-cmf-chile). Devuelve el RUT (que puede incluir el dígito verificador), razón social, ISIN, tipo de entidad, norma e inicio IFRS. Ideal para traducir tickers a RUT antes de consultar EEFF, hechos, etc.; las demás tools aceptan el RUT con o sin DV.
- parámetros:
  - consulta (REQUERIDO): Ticker (NEMO) o nombre de la empresa
  - term: Alias legacy de consulta (use consulta)
  - limite default=5: Máximo de resultados (1-10, default 5)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {resultados, total, fuente}

### cmf_buscar_entidad
- title: Buscar entidad supervisada
- description: Busca una entidad supervisada por nombre, RUT o ticker y devuelve el RUT canónico, la razón social, el tipo de entidad y su estado. El buscador de la CMF acepta una sola palabra (prefijo) o un RUT numérico: si consulta con varias palabras sin resultados, la tool reintenta con la más discriminante y lo indica. Es el primer paso recomendado antes de consultar EEFF, hechos, etc.; para búsquedas filtradas masivas use cmf_catalogo_entidades.
- parámetros:
  - consulta (REQUERIDO): Nombre, RUT o ticker a buscar (una sola palabra clave o RUT numérico)
  - term: Alias legacy de consulta (use consulta)
  - limite default=5: Máximo de resultados (1-20, default 5)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {resultados, total}

### cmf_listar_entidades
- title: Listar entidades por tipo
- description: Lista las entidades supervisadas de un tipo (tipoentidad, ej: RVEMI=emisores de valores) y mercado, paginado con offset/limit (máx 500). Filtre por estado=VI (vigentes, default) o NV y mercado=V (default), O u S. Use esta tool para enumerar un segmento completo; para buscar por nombre o RUT use cmf_buscar_entidad y para el catálogo completo cmf_catalogo_entidades.
- parámetros:
  - tipoentidad (REQUERIDO): Tipo de entidad supervisada (ej: RVEMI = emisores de valores)
  - mercado: Mercado: V=valores (default), O=otros, S=seguros
  - estado enum=[VI|NV]: VI=vigentes, NV=no vigentes
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {entidades, total, next_offset}

### cmf_empresa_info
- title: Identificación de empresa
- description: Devuelve los datos de identificación de un emisor (razón social, RUT, inscripción y actividad) desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para confirmar identidad y estado de una empresa; para cifras use cmf_empresa_eeff y para gobierno corporativo cmf_empresa_directorio.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, datos}

### cmf_empresa_eeff
- title: Estados financieros (EEFF) de empresa
- description: Devuelve los estados financieros de un emisor (pestanía 3) para un período, consolidado o individual, IFRS o NCH, con los PDFs oficiales del período. modo=documentos: lista de PDFs (EEFF, análisis razonado, declaración, XBRL) con su url — para leer uno pase esa url completa a cmf_documento_markdown. modo=markdown: convierte además el PDF auditado de los EEFF a Markdown para leer las cifras directamente (el HTML de la CMF viene sin líneas: la fuente real de las cifras son los PDFs). Verifique los períodos disponibles con cmf_empresa_eeff_historial; para el sistema agregado de todas las SA use cmf_eeff_ifrs_sa.
- parámetros:
  - rut: RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
  - query: Alias legacy de rut (use rut)
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes de corte trimestral (03/06/09/12)
  - tipo enum=[C|I]: Tipo de balance: C=Consolidado (default), I=Individual
  - norma enum=[IFRS|NCH]: Norma contable: IFRS (default) o NCH (Chilean GAAP)
  - modo enum=[documentos|markdown]: documentos = lista de PDFs del período; markdown = PDF auditado convertido a Markdown
  - max_chars default=30000: Máximo de caracteres del markdown (modo markdown)
  - validar_contable default=false: true = verifica la cuadratura contable (experimental: puede dar falsos negativos en algunos formatos)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {periodo, tipo_balance, documentos, aviso, pdf_type, markdown, markdown_truncado, escaneado, filas_separadas, filas_fusionadas_pendientes, verificacion_contable}

### cmf_empresa_eeff_historial
- title: Historial de EEFF disponibles
- description: Lista los años para los que un emisor tiene estados financieros publicados, junto con su modalidad contable y la fecha de inicio IFRS. Identifique el emisor por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para verificar qué períodos existen o desde cuándo aplica IFRS antes de llamar cmf_empresa_eeff.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, inicio_ifrs, modalidad, anios}

### cmf_empresa_hechos
- title: Hechos esenciales de empresa
- description: Devuelve los hechos esenciales publicados por un emisor (fecha/hora, número, materia y enlace al documento) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); fije desde/hasta en YYYY-MM-DD y pagine con offset/limit (máx 500). Use esta tool para hechos de un emisor específico; para el flujo de todo el mercado use cmf_hechos_globales (requiere captcha).
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
  - desde (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {hechos, total, next_offset}

### cmf_empresa_accionistas
- title: 12 mayores accionistas
- description: Devuelve los 12 mayores accionistas de un emisor (nombre, RUT y participación) para un período, desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA y mes opcional en MM (default 12). Use esta tool para analizar la concentración accionaria; para el directorio use cmf_empresa_directorio.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, accionistas}

### cmf_empresa_directorio
- title: Directorio y administración
- description: Devuelve los directores y gerentes de un emisor (nombre, cargo y fechas de designación/cese) desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para gobierno corporativo; para la composición accionaria use cmf_empresa_accionistas.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, directorio}

### cmf_empresa_sanciones
- title: Sanciones de la entidad
- description: Devuelve las sanciones aplicadas por la CMF a un emisor (número, fecha y materia) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta opcionales en YYYY-MM-DD (default 01/01/2000 a 31/12/2100). Use esta tool para el historial sancionatorio de un emisor; para sanciones de todo un mercado use cmf_sanciones_globales.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, sanciones}

### cmf_empresa_resoluciones
- title: Resoluciones de la entidad
- description: Devuelve las resoluciones de la CMF sobre un emisor (número, fecha y materia) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta opcionales en YYYY-MM-DD (default 01/01/2000 a 31/12/2100). Use esta tool para resoluciones dirigidas a un emisor; para resoluciones generales publicadas use cmf_dictamenes o cmf_resoluciones_globales.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, resoluciones}

### cmf_empresa_juntas
- title: Actas de juntas de accionistas
- description: Devuelve las actas de juntas de accionistas de un emisor (ordinarias, extraordinarias o de reforma de estatutos) en un rango de fechas, con enlace al documento. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta en YYYY-MM-DD y tipo=ordinaria (default), extraordinaria o reforma. Use esta tool para la historia societaria y de gobernanza de un emisor.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
  - desde (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - tipo enum=[ordinaria|extraordinaria|reforma]: Tipo de junta: ordinaria (default), extraordinaria o reforma de estatutos
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, actas}

### cmf_empresa_memoria_anual
- title: Memoria anual
- description: Devuelve los documentos de la memoria anual de un emisor para un año (memoria, EEFF anuales e informes de auditores). Identifique el emisor por rut (numérico; se acepta con o sin DV) y fije anio en AAAA (ej: 2024). Use esta tool para el contexto anual completo; para cifras trimestrales use cmf_empresa_eeff.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, documentos}

### cmf_empresa_asg
- title: Indicadores ASG (ESG)
- description: Devuelve los indicadores ASG (ambientales, sociales y de gobernanza) de un emisor para un período: memoria integrada, SASB o XBRL SASB. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA, mes opcional en MM (default 12) y tipo_informe=1 (Memoria Integrada), 2 (SASB) o 3 (XBRL SASB). Use esta tool para datos de sostenibilidad; para datos financieros use cmf_empresa_eeff.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - tipo_informe default="1": 1=Memoria Integrada, 2=SASB, 3=XBRL SASB (acepta 1 o '1')
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, indicadores}

### cmf_empresa_eeff_filiales
- title: EEFF de filiales
- description: Devuelve los estados financieros de las filiales de un emisor para un período, desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA y mes opcional en MM (default 12). Use esta tool para la operación del grupo consolidado; para EEFF de la matriz use cmf_empresa_eeff.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, filiales}

### cmf_empresa_registro_productos
- title: Registro de productos
- description: Devuelve el registro de productos inscritos de una entidad ante la CMF: valores, cuotas y series. Identifique la entidad por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para ver qué instrumentos tiene inscritos una entidad; para identificarla primero use cmf_buscar_entidad.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad (acepta 90749000, 90.749.000 o 90749000-0; el dígito verificador se recorta). Ej: 61808000
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, productos}

### cmf_hechos_globales
- title: Hechos esenciales globales
- description: Devuelve los hechos esenciales de todo el mercado (o de un tipo de entidad) en un rango de fechas, con fecha/hora, número, entidad y materia. Fije mercado (V=valores, O=otros, S=seguros), tipoentidad opcional (ej: RVEMI) y desde/hasta en YYYY-MM-DD. REQUIERE captcha de la CMF (imagen de 6 caracteres): si no entrega captcha, la tool responde pidiéndoselo al usuario y debe reintentar con el código; si el captcha es inválido o expiró, devuelve error y hay que solicitar uno nuevo. Use esta tool para el flujo completo del mercado; para hechos de un emisor use cmf_empresa_hechos (sin captcha).
- parámetros:
  - mercado (REQUERIDO): Mercado: V=valores, O=otros, S=seguros
  - tipoentidad: Tipo de entidad (ej: RVEMI; default RVEMI)
  - desde (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - captcha: Código captcha de 6 caracteres (si no lo tiene, la tool le indicará dónde ver la imagen)
  - captcha_id: Id del captcha que la tool le entregó en la respuesta previa (opcional; si no, usa el último captcha activo)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {mercado, desde, hasta, hechos}

### cmf_sanciones_globales
- title: Sanciones globales por mercado
- description: Devuelve las sanciones aplicadas en todo un mercado (V=valores, O=otros, S=seguros) en un rango de fechas. Fije desde/hasta opcionales en YYYY-MM-DD (default 01/01/2020 a 31/12/2100) y tipoentidad opcional (ej: RVEMI; default ALL=todas). Use esta tool para tendencias sancionatorias del mercado; para sanciones de un emisor específico use cmf_empresa_sanciones.
- parámetros:
  - mercado (REQUERIDO): Mercado: V=valores, O=otros, S=seguros
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - tipoentidad: Tipo de entidad (ej: RVEMI; default ALL=todas)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {mercado, desde, hasta, sanciones}

### cmf_resoluciones_globales
- title: Resoluciones globales por mercado
- description: Devuelve las resoluciones de la CMF sobre todo un mercado (V=valores, O=otros, S=seguros) en un rango de fechas. Fije desde/hasta opcionales en YYYY-MM-DD (default 01/01/2020 a 31/12/2100) y tipoentidad opcional (ej: RVEMI; default ALL=todas). Use esta tool para resoluciones de alcance de mercado; para resoluciones sobre un emisor use cmf_empresa_resoluciones.
- parámetros:
  - mercado (REQUERIDO): Mercado: V=valores, O=otros, S=seguros
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - tipoentidad: Tipo de entidad (ej: RVEMI; default ALL=todas)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {mercado, desde, hasta, resoluciones}

### cmf_comunicaciones_emisores
- title: Comunicaciones de emisores
- description: Lista las comunicaciones publicadas por los emisores de valores (fecha, número, sociedad, entidad informante y descripción) con paginación offset/limit (máx 500). No tiene filtro de fecha (la CMF entrega el listado completo): itere las páginas con next_offset para llegar al período buscado. Use esta tool para monitorear comunicados del mercado; para hechos esenciales use cmf_hechos_globales o cmf_empresa_hechos.
- parámetros:
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {comunicaciones, total, next_offset}

### cmf_clasificaciones_riesgo
- title: Clasificaciones de riesgo
- description: Devuelve las clasificaciones de riesgo vigentes (corte a hoy) asignadas a emisores e instrumentos por las clasificadoras. Filtre opcionalmente por emisor, clasificadora o tipo_instrumento (texto libre); pagine con offset/limit (máx 500). Use esta tool para evaluar calidad crediticia de instrumentos; para el historial financiero del emisor use cmf_empresa_eeff.
- parámetros:
  - emisor: Filtro por nombre o RUT del emisor (texto libre, opcional)
  - clasificadora: Filtro por clasificadora (texto libre, opcional)
  - tipo_instrumento: Filtro por tipo de instrumento (texto libre, opcional)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {clasificaciones, total, next_offset}

### cmf_eeff_ifrs_sa
- title: EEFF IFRS de sociedades anónimas
- description: Devuelve los estados financieros IFRS de sociedades anónimas y otras entidades (sistema sa_eeff_ifrs) para un rango de períodos. Seleccione sociedades por RUT (array; default ['0']=todas), anio1/anio2 en AAAA (ej: 2024) y mes1/mes2 opcionales en MM (default 12). Use esta tool para cifras agregadas de SA; para EEFF de un emisor con PDFs auditados use cmf_empresa_eeff.
- parámetros:
  - sociedades default=["0"]: RUTs de sociedades sin DV (['0'] = todas)
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año final del rango en AAAA (ej: 2025)
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes final del rango en MM (default 12)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_indicadores_financieros_sa
- title: Indicadores financieros IFRS de SA
- description: Devuelve los indicadores financieros IFRS calculados de sociedades anónimas (liquidez, endeudamiento, rentabilidad) para un corte. Fije fecha_max en formato AAAAMM (ej: 202512). Use esta tool para comparar ratios entre SA; para EEFF detallados use cmf_eeff_ifrs_sa.
- parámetros:
  - fecha_max (REQUERIDO): Corte en formato AAAAMM (ej: 202512)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_empresa_eeff_nch
- title: EEFF NCH de sociedades anónimas
- description: Devuelve los estados financieros bajo norma chilena (NCH/FECU) de sociedades anónimas para un rango de períodos. Seleccione sociedades por RUT (array; default todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para períodos pre-IFRS o agregados bajo norma local; para los EEFF IFRS con PDF auditado de UN emisor use cmf_empresa_eeff (norma=IFRS); para el sistema IFRS de todas las SA use cmf_eeff_ifrs_sa.
- parámetros:
  - sociedades default=["0"]: RUTs de sociedades sin DV (['0'] = todas)
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año final del rango en AAAA (ej: 2025)
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes final del rango en MM (default 12)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_indicadores_financieros_nch
- title: Indicadores financieros NCH de SA
- description: Devuelve los indicadores financieros calculados bajo norma chilena (NCH) de sociedades anónimas para un rango de períodos. Seleccione sociedades por RUT (array; default todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para ratios NCH; para indicadores IFRS use cmf_indicadores_financieros_sa.
- parámetros:
  - sociedades default=["0"]: RUTs de sociedades sin DV (['0'] = todas)
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año final del rango en AAAA (ej: 2025)
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes final del rango en MM (default 12)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_dividendos
- title: Dividendos de sociedades
- description: Devuelve los dividendos declarados por sociedades anónimas (detalle y resumen por acción) para un período. Seleccione sociedades por RUT (array; default todas), anio en AAAA, anio2 opcional para rangos, mes/mes2 opcionales en MM (default 01-12) y tipodiv (default DIV). Use esta tool para historial de dividendos; para operaciones de capital use cmf_operaciones_capital.
- parámetros:
  - sociedades default=["0"]: RUTs de sociedades sin DV (['0'] = todas)
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2: Año final del rango en AAAA (default: igual a anio)
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes final del rango en MM (default 12)
  - tipodiv: Tipo de dividendo (default DIV)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_operaciones_capital
- title: Operaciones de capital (repartos, canjes, liberadas)
- description: Devuelve las operaciones de capital de sociedades anónimas para un año: repartos de capital, canjes de acciones o acciones liberadas de pago. Elija tipo=reparto, canje o liberadas; seleccione sociedades por RUT (array; default todas) y fije anio en AAAA. Use esta tool para eventos corporativos sobre el capital; para dividendos use cmf_dividendos.
- parámetros:
  - tipo (REQUERIDO) enum=[reparto|canje|liberadas]: Operación: reparto=repartos de capital, canje=canjes de acciones, liberadas=acciones liberadas de pago
  - sociedades default=["0"]: RUTs de sociedades sin DV (['0'] = todas)
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_apv
- title: Valores APV
- description: Devuelve los valores de ahorro previsional voluntario (APV) del mercado por tipo de fondo y cuadro, para un rango de períodos. Fije anio_desde/anio_hasta en AAAA y mes_desde/mes_hasta opcionales en MM (default 01-12); tipo y cuadro opcionales. Use esta tool para estadísticas de APV; para fondos mutuos use las tools cmf_fondos_mutuos_*.
- parámetros:
  - anio_desde (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio_hasta (REQUERIDO): Año final del rango en AAAA (ej: 2025)
  - mes_desde: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes_hasta: Mes final del rango en MM (default 12)
  - tipo: Tipo de APV (texto libre, opcional)
  - cuadro: Cuadro (texto libre, opcional)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_tomas_control
- title: Tomas de control de emisores
- description: Devuelve la información de tomas de control de emisores de valores publicada por la CMF (operación, fechas y sociedades involucradas). Elija el orden del listado con orden (1-5, default 1). Use esta tool para cambios de control accionario; para la composición accionaria actual use cmf_empresa_accionistas.
- parámetros:
  - orden: Orden del listado (1-5, default 1)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_listados_eeff_ifrs
- title: Listados de EEFF IFRS
- description: Devuelve los listados de empresas que presentan EEFF bajo IFRS: listado general, Circular 556 u oficios 457/485. Elija tipo_listado=general (default), c556, ofc457 u ofc485. Use esta tool para verificar obligaciones de reporte IFRS de empresas; para los EEFF mismos use cmf_empresa_eeff.
- parámetros:
  - tipo_listado enum=[general|c556|ofc457|ofc485]: Listado: general (default), c556=Circular 556, ofc457/ofc485=respuestas a oficios
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_fechas_divulgacion_eeff
- title: Fechas de divulgación de EEFF
- description: Devuelve el calendario de fechas de divulgación de estados financieros de los emisores para un año. Fije anio en AAAA (ej: 2026). Use esta tool para anticipar la publicación de resultados; para los EEFF ya publicados use cmf_empresa_eeff.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_intermediarios_eeff_ifrs
- title: EEFF IFRS de intermediarios (AV/CB/CBP)
- description: Devuelve los estados financieros IFRS de intermediarios de valores (agentes de valores, corredores de bolsa y corredores de bolsa de productos) para un rango de períodos. Seleccione sociedades por RUT (array; default todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para EEFF de intermediarios; para sociedades anónimas use cmf_eeff_ifrs_sa.
- parámetros:
  - sociedades default=["0"]: RUTs de sociedades sin DV (['0'] = todas)
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año final del rango en AAAA (ej: 2025)
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes final del rango en MM (default 12)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_intermediarios_indicadores_ifrs
- title: Indicadores IFRS de intermediarios
- description: Devuelve los indicadores financieros IFRS de intermediarios de valores (agentes de valores y corredores de bolsa) para un rango de períodos. Seleccione sociedades por RUT (array; default todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para ratios de intermediarios; para sus EEFF use cmf_intermediarios_eeff_ifrs.
- parámetros:
  - sociedades default=["0"]: RUTs de sociedades sin DV (['0'] = todas)
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año final del rango en AAAA (ej: 2025)
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes final del rango en MM (default 12)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_resultados_av_cb
- title: Cuadros de resultados (AV/CB y emisores NCH)
- description: Devuelve los cuadros de resultados de agentes de valores y corredores de bolsa (tipo=av_cb, default) o de emisores bajo norma NCH (tipo=emisores_nch). Use esta tool para estados de resultados agregados del mercado; para EEFF de un emisor individual use cmf_empresa_eeff o cmf_empresa_eeff_nch.
- parámetros:
  - tipo enum=[av_cb|emisores_nch]: av_cb=agentes/corredores (default), emisores_nch=emisores bajo NCH
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_liquidez_intermediarios
- title: Índices de liquidez/solvencia de intermediarios
- description: Devuelve los índices de liquidez y solvencia de los intermediarios de valores. Filtre opcionalmente por intermediario (texto libre; default todos) y por rango desde/hasta en YYYY-MM-DD (default 01/01/2024 a 31/12/2026). Use esta tool para monitorear la salud financiera de intermediarios; para sus EEFF use cmf_intermediarios_eeff_ifrs.
- parámetros:
  - intermediario: Nombre o código del intermediario (texto libre, opcional; default todos)
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_prestamos_otorgados
- title: Préstamos otorgados
- description: Devuelve el reporte de préstamos otorgados del mercado de valores publicado por la CMF (el sistema legacy entrega el reporte completo, sin filtro de fechas). Use esta tool para estadísticas de préstamos del mercado.
- parámetros: ninguno
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_dictamenes
- title: Actos y resoluciones publicados (dictámenes)
- description: Lista los actos administrativos y resoluciones publicados por la CMF (tabla de publicidad de actos según Ley 19.880, art. 45 y siguientes): tipo de acto, denominación, número, fecha de publicación, medio de comunicación, efectos generales o particulares y vínculo al documento. Consulte años completos con desde/hasta (YYYY-MM-DD; se consulta el año de cada fecha). Use esta tool para resoluciones generales publicadas; para sanciones a un emisor específico use cmf_empresa_sanciones y para resoluciones del mercado cmf_resoluciones_globales.
- parámetros:
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_sanciones_cursadas
- title: Sanciones cursadas del mes
- description: Devuelve las sanciones cursadas del mes en curso y la portada de sanciones (la CMF entrega la portada completa, sin filtro por mercado). Use esta tool para las sanciones más recientes; para rangos históricos use cmf_sanciones_globales; para las de un emisor use cmf_empresa_sanciones.
- parámetros: ninguno
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_resoluciones_cursadas
- title: Resoluciones cursadas
- description: Devuelve las resoluciones cursadas recientes (historico=false, default) o el listado completo de meses anteriores (historico=true, respuesta grande). Use esta tool para resoluciones recientes de la CMF; para resoluciones filtradas por mercado use cmf_resoluciones_globales.
- parámetros:
  - historico default=false: true = listado histórico completo (grande)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_catalogo_entidades
- title: Catálogo completo de entidades supervisadas
- description: Devuelve el catálogo completo de entidades supervisadas de la CMF filtrable por nombre (parcial), tipo de entidad (descripción o código como RVEMI/FMT/FIP) y estado (VI=vigentes, NV=no vigentes), con paginación offset/limit (máx 500). El catálogo se cachea 24h en KV; la primera carga sin caché puede exceder el límite de CPU del plan free de Workers. Use esta tool para búsquedas masivas o filtradas; para una entidad puntual use cmf_buscar_entidad.
- parámetros:
  - nombre: Filtro por nombre (parcial, insensible a acentos)
  - tipo_entidad: Filtro por tipo de entidad: texto parcial del tipo (ej: 'Emisores de Valores', 'Fondos Mutuos') o código (RVEMI, FMT, FIP, CSVID, CSGEN)
  - estado enum=[VI|NV]: VI=vigentes, NV=no vigentes (acepta VI/NV)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {entidades, total, next_offset, cache, advertencia}

### cmf_fondos_mutuos_catalogo
- title: Catálogo de Fondos Mutuos
- description: Devuelve el catálogo completo de fondos mutuos de la CMF (RUT administradora, RUN fondo, nombre, tipo de fondo, moneda, fechas de inicio/término), filtrable por nombre y tipo y paginado con offset/limit. Use esta tool para encontrar el RUN de un fondo antes de consultar su cartola (cmf_fondos_mutuos_cartola) o su cartera (cmf_fondos_mutuos_cartera).
- parámetros:
  - nombre: Filtro por nombre del fondo (parcial)
  - tipo: Filtro por tipo de fondo: compara el CÓDIGO numérico (0-8), no el nombre
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {fondos, total, next_offset}

### cmf_fondos_mutuos_cartera
- title: Cartera de inversiones de Fondos Mutuos
- description: Descarga la cartera de inversiones de fondos mutuos de la CMF para un mes: posiciones por instrumento de cada fondo (columnas con códigos de la Circular 1333). Requiere cartera (NACI=nacional, EXTR=extranjera, OPCI=opciones, FUTU=futuros, OPLA=opciones largo plazo), anio en AAAA y mes en MM. Use esta tool para ver las posiciones que componen cada fondo; para agregados por emisor/país use cmf_fondos_mutuos_inversiones.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - cartera (REQUERIDO) enum=[NACI|EXTR|OPCI|FUTU|OPLA]: Tipo de cartera: NACI=nacional, EXTR=extranjera, OPCI=opciones, FUTU=futuros, OPLA=opciones largo plazo
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, filas}

### cmf_fondos_mutuos_comisiones
- title: Comisiones y remuneraciones de FM
- description: Descarga la estructura de comisiones de fondos mutuos de la CMF: comisión de colocación, remuneración de administración y gastos de operación por fondo/serie. Filtre por anio en AAAA, mes en MM (default 12), admin (RUT de administradora, 0=todas), tipo_fondo (0-8, 0=todos) y moneda (0=todas, $$, PROM o EUR). Use esta tool para comparar cobros entre fondos; para el costo total anual (TAC) use cmf_fondos_mutuos_costos.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - admin: RUT de administradora (0=todas)
  - tipo_fondo: Código de tipo de fondo (0=todos, 1-8 según la clasificación de la CMF)
  - moneda enum=[0|$$|PROM|EUR]: Moneda: 0=todas, $$=pesos chilenos, PROM=promedio, EUR=euros
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, filas}

### cmf_fondos_mutuos_inversiones
- title: Inversiones de Fondos Mutuos
- description: Descarga las inversiones de fondos mutuos de la CMF por período, en instrumentos nacionales o extranjeros, agregadas según el nivel pedido. Requiere anio en AAAA, tipo (nacio=nacionales, inter=extranjeros; default nacio) y consulta (fondos, emisores o pais_transaccion); mes en MM opcional (default 12). Use esta tool para agregados de inversión; para el detalle de la cartera por fondo use cmf_fondos_mutuos_cartera.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - tipo enum=[nacio|inter]: Ámbito de inversión: nacio=nacionales, inter=extranjeros (default nacio)
  - consulta enum=[fondos|emisores|pais_transaccion]: Nivel de agregación: fondos, emisores o pais_transaccion (default fondos)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, filas}

### cmf_fondos_mutuos_bpr
- title: Patrimonio, rentabilidad y partícipes de FM
- description: Descarga el Boletín de Patrimonio y Rentabilidad (BPR) de fondos mutuos de la CMF: patrimonio, variación, rentabilidad nominal mensual, número de partícipes y valor cuota por serie. Filtre por anio en AAAA, mes en MM (default 12) y admin (RUT de administradora; omitir = todas). Use esta tool para datos por serie; para el agregado del sistema use cmf_fondos_mutuos_antecedentes.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - admin: RUT de administradora (omitir = todas)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, filas}

### cmf_fondos_mutuos_costos
- title: Cuadro de costos de FM (TAC)
- description: Descarga el cuadro estadístico de costos de fondos mutuos de la CMF: remuneración fija/variable, gastos de operación y TAC (costo total anual) por serie. Filtre por anio en AAAA, mes en MM (default 12) y admin (RUT de administradora; omitir = todas). Use esta tool para comparar el costo total anual entre series; para la estructura de comisiones de colocación use cmf_fondos_mutuos_comisiones.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - admin: RUT de administradora (omitir = todas)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, filas}

### cmf_fondos_mutuos_antecedentes
- title: Antecedentes generales del sistema FM
- description: Devuelve los antecedentes generales del sistema de fondos mutuos de la CMF: número de administradoras y fondos, patrimonio total y partícipes (corte a diciembre de cada año). Filtre por anio en AAAA (opcional; default 2025). Use esta tool para la evolución agregada del sistema; para datos por fondo use cmf_fondos_mutuos_bpr.
- parámetros:
  - anio: Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, filas}

### cmf_fondos_mutuos_cartola
- title: Cartola diaria de Fondos Mutuos
- description: Devuelve la cartola diaria de un fondo mutuo de la CMF (valor cuota, patrimonio y partícipes por día) para un rango de fechas. Requiere el RUN del fondo (búsquelo con cmf_fondos_mutuos_catalogo) y captcha de la CMF: si no se entrega el código de 6 caracteres, la tool lo solicitará para reintentar. Use esta tool para la evolución diaria de un fondo; para datos mensuales por serie use cmf_fondos_mutuos_bpr.
- parámetros:
  - fondo (REQUERIDO): RUN del fondo (búsquelo con cmf_fondos_mutuos_catalogo); acepta 8298 o '8298'
  - desde (REQUERIDO): Fecha inicial en YYYY-MM-DD (acepta DD/MM/AAAA). Ej: 2026-01-01
  - hasta (REQUERIDO): Fecha final en YYYY-MM-DD (acepta DD/MM/AAAA). Ej: 2026-01-31
  - captcha: Código captcha de 6 caracteres (si no lo tiene, la tool le indicará dónde ver la imagen)
  - captcha_id: Id del captcha que la tool le entregó en la respuesta previa (opcional; si no, usa el último captcha activo)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, filas}

### cmf_fondos_comisiones_maximas
- title: Comisiones máximas para fondos de pensiones/cesantía
- description: Devuelve las comisiones máximas que los fondos mutuos (fm) y fondos de inversión (fi) pueden cobrar a los Fondos de Pensiones (Circular 1951) y de Cesantía (Circular 1965), con las administradoras que reportaron y los documentos XLS mensuales disponibles. Filtre por tipo (fm o fi; default fm), circular (1951 o 1965; default 1951) y anio en AAAA. Use esta tool para los topes legales de comisiones; para las comisiones efectivas de cada fondo use cmf_fondos_mutuos_comisiones.
- parámetros:
  - tipo enum=[fm|fi]: Tipo de administradora: fm=mutuos, fi=inversión (default fm)
  - circular default="1951": Circular que fija el tope: 1951=pensiones, 1965=cesantía (default 1951; acepta 1951 o '1951')
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {tipo, circular, anio, administradoras, documentos_xls}

### cmf_fondos_inversion_eeff_ifrs
- title: EEFF IFRS de Fondos de Inversión
- description: Devuelve los estados financieros IFRS de fondos de inversión como matriz de cuentas contables × fondos (grid Google Visualization convertido a JSON), desde el sitio de la CMF. Filtre la administradora con admins (RUT; 0 = todas) y los fondos con fondos (array de códigos; ['0'] = todos); defina el rango con anio1/anio2 (AAAA) y, si necesita cortes intermedios, mes1/mes2 (MM; sin mes se usa diciembre). La salida incluye hasta 200 filas y total_filas con el total real; si responde "Sin resultados" puede requerir re-solución del anti-bot, reintente. Use esta tool para comparar cuentas IFRS entre fondos; para obtener códigos de fondos use cmf_fondos_inversion_catalogo.
- parámetros:
  - admins default="0": RUT de la administradora (0=todas)
  - fondos default=["0"]: Códigos de fondos (['0']=todos)
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {columnas, filas, total_filas}

### cmf_fondos_inversion_catalogo
- title: Catálogo de Fondos de Inversión
- description: Devuelve el catálogo de fondos de inversión supervisados por la CMF (RUT, nombre, tipo de entidad, inscripción y estado) con paginación. Busque con consulta (nombre o RUT; sin consulta lista fondos de inversión en general) y recorra el listado con offset y limit (máx 500, default 100); la salida trae total y next_offset para continuar. Use esta tool para identificar códigos/RUT de fondos y administradoras que otras tools requieren, p. ej. cmf_fondos_inversion_eeff_ifrs.
- parámetros:
  - consulta: Nombre o RUT a buscar
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {fondos, total, next_offset}

### cmf_fondos_inversion_comisiones_maximas
- title: Comisiones máximas de Fondos de Inversión
- description: Devuelve las filas del informe de comisiones máximas aplicables a fondos de inversión que publica la CMF (tabla HTML parseada; hasta 200 filas en filas). El informe es el vigente publicado. Si no hay filas parseables, el informe está disponible como PDF en el sitio de la CMF. Use esta tool para conocer los topes de comisiones; para las comisiones cobradas a fondos de pensiones use cmf_fondos_comisiones_maximas (tipo=fi).
- parámetros: ninguno
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_normativa_buscar
- title: Buscar normativa
- description: Busca normas de la CMF (circulares, oficios, normas de carácter general NCG) por tipo, número, rango de fechas, entidad o materia, paginado con offset/limit. Usa el buscador legacy de la CMF, que puede estar caído (la CMF migró al portal nuevo): si no devuelve resultados, use cmf_normativa_descargar si conoce la ruta, o el portal cmfchile.cl. Use esta tool para encontrar normas por materia; para descargar el PDF de una norma ya identificada use cmf_normativa_descargar.
- parámetros:
  - tipo enum=[ALL|CIR|OFC|NCG]: Tipo de norma: ALL=todos, CIR=circular, OFC=oficio, NCG=norma de carácter general
  - numero: Número de la norma
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - entidad: Entidad supervisada emisora de la norma (texto libre)
  - materia: Materia de la norma (texto libre)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {normas, total, next_offset}

### cmf_normativa_descargar
- title: Descargar norma (PDF)
- description: Descarga el PDF de una norma del compendio de la CMF y lo devuelve en base64 si es pequeño (<4MB) o con la URL directa si es más grande. Requiere la ruta exacta del archivo dentro del compendio (ej: /web/compendio/cir/cir_2343_2024.pdf). Si la respuesta no es un PDF directo (puede requerir autenticación), lo indica. Use esta tool cuando conozca la ruta del documento; para encontrar normas use cmf_normativa_buscar; para leer el PDF como texto use cmf_documento_markdown con la URL.
- parámetros:
  - archivo (REQUERIDO): Ruta del archivo del compendio (ej: /web/compendio/cir/cir_2343_2024.pdf)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {archivo, tamano_kb, formato}

### cmf_seguros_eeff
- title: EEFF de compañías de seguros
- description: Devuelve los estados financieros (FECU) de compañías de seguros generales o de vida de la CMF para un rango de períodos. Requiere anio1/anio2 en AAAA (rango de años); mes1/mes2 en MM opcionales (default 12). Filtre por tipo (generales o vida; default generales) y sociedades (array de códigos de compañía; ['0']=todas). Use esta tool para balances de aseguradoras; para su clasificación de riesgo use cmf_seguros_clasificacion_riesgo.
- parámetros:
  - tipo enum=[generales|vida]: Segmento de seguros: generales o vida (default generales)
  - sociedades default=["0"]: Códigos de compañías (array; ['0']=todas)
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_rentas_vitalicias
- title: Estadísticas de Rentas Vitalicias
- description: Devuelve estadísticas del mercado de rentas vitalicias previsionales por compañía (comisiones, primas, tasas de interés, rankings de asesores). Elija la estadística con codigo (ej: com_int_rvp=comisiones intermediación, pri_uni_rvp=primas únicas, tas_int_med_rvp=tasas de interés promedio, rank_ases_prev=ranking de asesores); resultados paginados con offset/limit (máx 500). Use cmf_seguros_scomp para estadísticas agregadas del sistema SCOMP.
- parámetros:
  - codigo (REQUERIDO): Código de estadística (ej: com_int_rvp, pri_uni_rvp, tas_int_med_rvp, rank_ases_prev)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_scomp
- title: Estadísticas SCOMP
- description: Devuelve las estadísticas del SCOMP (Sistema de Consultas y Ofertas del Mercado de Pensiones) publicadas por la CMF. Sin parámetros de filtro; use offset/limit para paginar el listado. Use esta tool para el mercado de pensiones a nivel sistema; para estadísticas por compañía use cmf_seguros_rentas_vitalicias.
- parámetros:
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_clasificacion_riesgo
- title: Clasificación de riesgo de seguros (RGCRI)
- description: Devuelve la clasificación de riesgo de las compañías de seguros (RGCRI) publicada por la CMF, con las reseñas de las clasificadoras por período. Filtre por anio en AAAA y mes en MM (opcional; default 12). Use esta tool para evaluar la solvencia de aseguradoras; para sus estados financieros use cmf_seguros_eeff.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_satra
- title: Transacciones Art. 12 Ley 18.045
- description: Devuelve las transacciones de compañías de seguros informadas conforme al artículo 12 de la Ley 18.045 (Ley de Mercado de Valores), publicadas por la CMF. Sin parámetros de filtro; use offset/limit para paginar el listado. Use esta tool para transacciones del mercado de seguros; para los estados financieros de aseguradoras use cmf_seguros_eeff.
- parámetros:
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_siniestros
- title: Siniestros detectados no reportados
- description: Devuelve los siniestros detectados por la CMF que no fueron reportados por las compañías de seguros dentro del plazo. Sin parámetros de filtro; use offset/limit para paginar el listado. Use esta tool para fiscalización de aseguradoras; para el cumplimiento normativo general use cmf_seguros_cumplimiento.
- parámetros:
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_cumplimiento
- title: Cumplimiento de normativa de seguros
- description: Devuelve el estado de cumplimiento de la normativa por compañías de seguros de la CMF (sistema sv_cumplimientos). Filtre por anio en AAAA, mes en MM (opcional; default 12) y tipoentidad (CSGEN=seguros generales, CSVID=seguros de vida; default CSGEN). Use esta tool para supervisar cumplimiento; para siniestros no reportados use cmf_seguros_siniestros.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - tipoentidad: Tipo de entidad: CSGEN=seguros generales (default), CSVID=seguros de vida
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_inversiones_vida
- title: Cartera de inversiones de seguros (C.1835)
- description: Devuelve la cartera de inversiones de compañías de seguros de la CMF (Circular 1835), con detalle de instrumentos por entidad. Filtre por tipoentidad (CSVID=seguros de vida, CSGEN=seguros generales; default CSVID) y pagine con offset/limit. Use esta tool para ver en qué invierten las aseguradoras; para la cartera de fondos mutuos use cmf_fondos_mutuos_cartera.
- parámetros:
  - tipoentidad enum=[CSVID|CSGEN]: Tipo de entidad: CSVID=seguros de vida (default), CSGEN=seguros generales
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_produccion_corredores
- title: Producción de corredores de seguros
- description: Devuelve la producción de corredores de seguros publicada por la CMF (sistema ISPRO). Filtre por tipoentidad (CSJUR=corredores, CSGEN=seguros generales, CSVID=seguros de vida; default CSJUR) y pagine con offset/limit. Use esta tool para la intermediación del mercado de seguros; para la cartera de las compañías use cmf_seguros_inversiones_vida.
- parámetros:
  - tipoentidad enum=[CSJUR|CSGEN|CSVID]: Tipo de entidad: CSJUR=corredores (default), CSGEN=seguros generales, CSVID=seguros de vida
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_sic
- title: Estadísticas Conoce tu seguro (SIC)
- description: Devuelve las estadísticas del sistema 'Conoce tu seguro' (SIC) de la CMF: consultas de usuarios sobre pólizas de seguros en un rango de fechas. Requiere desde y hasta en YYYY-MM-DD (acepta DD/MM/AAAA). Use esta tool para la demanda de información del mercado de seguros; para el registro de pólizas depositadas use cmf_seguros_deposito_polizas.
- parámetros:
  - desde (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_xbrl_taxonomias
- title: Taxonomías XBRL disponibles
- description: Lista las taxonomías XBRL del Mercado de Valores publicadas por la CMF (CL-CI, CL-CC, CL-BS, CL-EI, CL-HB, CL-HS). No requiere parámetros. Use esta tool para conocer las taxonomías disponibles; para navegar la estructura de una use cmf_xbrl_visor.
- parámetros: ninguno
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {taxonomias}

### cmf_xbrl_visor
- title: Visor de taxonomía XBRL
- description: Navega la estructura de una taxonomía XBRL de la CMF: etiquetas y conceptos según taxonomía y fecha de versión. Requiere taxonomia (cl-ci, cl-cc, cl-bs, cl-ei, cl-hb o cl-hs) y fecha de versión en YYYY-MM-DD (ej: 2021-01-04). Use esta tool para explorar el detalle de una taxonomía; para listar las disponibles use cmf_xbrl_taxonomias.
- parámetros:
  - taxonomia (REQUERIDO) enum=[cl-ci|cl-cc|cl-bs|cl-ei|cl-hb|cl-hs]: Taxonomía a navegar: cl-ci, cl-cc, cl-bs, cl-ei, cl-hb o cl-hs
  - fecha (REQUERIDO): Fecha de versión (ej: 2021-01-04)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {taxonomia, fecha, filas}

### cmf_xbrl_consulta
- title: Formulario de consulta XBRL
- description: Envía un formulario de consulta sobre XBRL al soporte técnico de la CMF; es la única tool que envía información a la CMF (no es de solo lectura: úsela solo si el usuario lo pide explícitamente). Requiere nombre y email válido; mercado (V=valores, S=seguros; default V), empresa y pais son opcionales (pais default Chile). Para consultar taxonomías sin enviar nada, use cmf_xbrl_visor.
- parámetros:
  - mercado enum=[V|S]: Mercado de la consulta: V=valores (default), S=seguros
  - nombre (REQUERIDO): Nombre de la persona que consulta
  - email (REQUERIDO): Email de contacto válido
  - empresa: Empresa que consulta (opcional)
  - pais: País (opcional; default Chile)
- annotations: {"readOnlyHint":false,"destructiveHint":true}
- outputSchema: {enviada}

### cmf_documento_info
- title: Información de documento firmado
- description: Formatea la metadata de un documento firmado de la CMF a partir de su token s567 (URL del documento y campos derivados); NO descarga el contenido ni verifica su existencia en la CMF — para eso use cmf_documento_descargar (devuelve error si el token no es válido). Use esta tool solo para inspeccionar un token; para obtener el contenido use cmf_documento_descargar (binario) o cmf_documento_markdown (PDF a Markdown).
- parámetros:
  - s567 (REQUERIDO): Token del documento (extraído de hechos/sanciones/resoluciones)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {s567, sin_verificar, url}

### cmf_documento_descargar
- title: Descargar documento firmado
- description: Descarga un documento firmado de la CMF (PDF/XLS/XLSX) usando su token s567 (el token viaja en la URL de la CMF; se devuelve en la salida solo como eco del input). Documentos de hasta 4MB vuelven en base64 inline; los más grandes indican usar cmf_documento_markdown (para PDFs) o las tools de paquetes. Use esta tool para obtener el archivo original; para leer un PDF como texto use cmf_documento_markdown.
- parámetros:
  - s567 (REQUERIDO): Token del documento (de hechos/sanciones/resoluciones)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {s567, tamano, tamano_kb, contentType, base64}

### cmf_documento_markdown
- title: Convertir documento PDF de la CMF a Markdown
- description: Descarga un documento firmado de la CMF (EEFF, hechos, sanciones, resoluciones, normas) y lo convierte a Markdown legible para el agente (tablas, encabezados, listas) usando pdf-inspector, sin OCR. Acepta el token s567 (de hechos/sanciones/resoluciones) o una URL de documento de la CMF. Si el PDF es escaneado, lo indica (no hay OCR).
- parámetros:
  - token: Token s567 del documento (de hechos/sanciones/resoluciones)
  - url: URL absoluta de un documento de la CMF (ej: ver_archivo.php del compendio)
  - max_chars default=30000: Máximo de caracteres del markdown (recorta el resto)
  - validar_contable default=false: true = verifica la cuadratura contable (experimental)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {pdf_type, tamano_kb, markdown, markdown_truncado, escaneado, fuente}

### cmf_seguros_deposito_polizas
- title: Registro de Depósito de Pólizas (seguros)
- description: Busca en el Registro de Depósito de Pólizas de la CMF (mercado de seguros): pólizas y cláusulas depositadas por compañías de seguros, con código, fecha de depósito, aseguradora, texto depositado, temas y norma (NCG 124/349). Sin filtros devuelve el registro completo (~7.000 pólizas) — use filtros o paginación. Con exportar=true descarga el exportador XLSX oficial de la base.
- parámetros:
  - poliza: Código de póliza (ej: POL107024)
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - norma enum=[124|349|ALL]: NCG 124 o 349; ALL=ambas
  - tema: Tema (ej: 301=Accidentes Personales, 109=Agrícola, 205=APV, 208=APVC)
  - texto: Texto depositado (búsqueda parcial)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
  - exportar default=false: true = usa el exportador XLSX de toda la base (grande)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {total, next_offset, polizas, filas, exportador}

### cmf_seguros_polizas_resoluciones_prohibidas
- title: Resoluciones que prohíben depósito de pólizas
- description: Devuelve las resoluciones de la CMF que prohíben a una aseguradora depositar pólizas (registro desde abril de 2009), con número, fecha, póliza afectada, materia y archivo. Sin filtros; use offset/limit para paginar. Use esta tool para saber qué aseguradoras tienen restringido el depósito; para buscar pólizas depositadas use cmf_seguros_deposito_polizas.
- parámetros:
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Límite de filas (máx 500)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {total, next_offset, resoluciones}

### cmf_bancos_tasas
- title: Buscador de tasas bancarias
- description: Devuelve las tasas de interés de instituciones financieras chilenas publicadas por la CMF (servlet InfoFinanciera de la ex SBIF) para el índice solicitado. Si el índice corresponde a un formulario, la respuesta puede no traer tablas parseables. Use esta tool para tasas bancarias; para reportes de instituciones use cmf_bancos_reportes.
- parámetros:
  - indice default="4.1": Índice del reporte
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_bancos_cronologia
- title: Cronología bancaria
- description: Devuelve la cronología histórica del sistema bancario chileno publicada por la CMF (servlet CronologiaBancaria de la ex SBIF). Use indice para seleccionar el capítulo (default 8.0); si el contenido no es tabular, lo indica. Use esta tool para hitos de la banca chilena; para tasas de interés use cmf_bancos_tasas.
- parámetros:
  - indice default="8.0": Índice del capítulo de la cronología (default 8.0)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_bancos_reportes
- title: Reportes de instituciones financieras (BaseDato)
- description: Devuelve reportes del sistema BaseDato de instituciones financieras de la CMF (ex SBIF). Use reporte (default FIC) e indice (default 30.1); acote con periodo_inicial/periodo_final en AAAA-MM e institucion (código de institución). Puede requerir resolver el challenge anti-bot de la CMF; si falla, reintente. Use esta tool para reportes históricos de la banca; para tasas de interés use cmf_bancos_tasas.
- parámetros:
  - reporte default="FIC": Código del reporte
  - indice default="30.1": Índice del reporte (default 30.1)
  - periodo_inicial: Período inicial en AAAA-MM (ej: 2025-01)
  - periodo_final: Período final en AAAA-MM (ej: 2025-12)
  - institucion: Código de institución
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_empresa_paquete
- title: Paquete completo de una empresa (plan de descarga)
- description: Planifica en UNA llamada la descarga completa de una empresa y devuelve el plan: árbol de directorio lógico y manifest de documentos (EEFF, hechos, sanciones, resoluciones, memoria, ASG) con nombres de archivo normalizados. Parámetros clave: rut (ej: 61808000), anio_inicio/anio_fin (máx 2 años por llamada; use ventanas sucesivas para más historia), tipo C/I, norma IFRS/NCH, secciones a incluir (eeff|hechos|sanciones|resoluciones|memoria|asg) e incluir_tablas; los EEFF se barren en cortes trimestrales 03/06/09/12. Use esta tool primero para dimensionar la descarga; no devuelve bytes, para descargar los documentos use cmf_empresa_paquete_documentos con el mismo rango.
- parámetros:
  - rut (REQUERIDO): RUT del emisor, sin dígito verificador (acepta 90749000, 90.749.000, 90749000-0 o 90.749.000-0)
  - anio_inicio: Año inicial AAAA del rango (default: año actual - 1). Máx 2 años por llamada
  - anio_fin: Año final AAAA del rango (default: año actual). Máx 2 años por llamada
  - tipo enum=[C|I]: Tipo de balance: C=Consolidado (default), I=Individual
  - norma enum=[IFRS|NCH]: Norma contable: IFRS (default) o NCH (Chilean GAAP)
  - secciones default=["eeff","hechos","sanciones","resoluciones","memoria"]: Secciones a incluir: eeff|hechos|sanciones|resoluciones|memoria|asg (los EEFF se barren en cortes trimestrales 03/06/09/12)
  - incluir_tablas default=false: true = lista hasta 12 tablas por período EEFF (false: solo 5)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {empresa, arbol, manifest, resumen}

### cmf_empresa_paquete_documentos
- title: Descargar documentos de una empresa (ZIP ordenado)
- description: Descarga los documentos de una empresa (EEFF por período; hechos, sanciones, resoluciones, memoria por año) y los devuelve como ZIP en base64 con directorio lógico, nombres normalizados y manifiesto.json (cada archivo además en base64, truncado a 4MB). Parámetros clave: rut (ej: 61808000), anio_inicio/anio_fin (máx 2 años por llamada), periodos AAAAMM explícitos (máx 3) o los 3 más recientes del rango, secciones (eeff|hechos|sanciones|resoluciones|memoria), tipo C/I, norma IFRS/NCH, y límites max_documentos (1-24) y max_mb (1-50). Use esta tool para bajar los bytes del plan de cmf_empresa_paquete; los tokens firmados se gestionan en el servidor y nunca se exponen.
- parámetros:
  - rut (REQUERIDO): RUT del emisor, sin dígito verificador (acepta 90749000, 90.749.000, 90749000-0 o 90.749.000-0)
  - anio_inicio: Año inicial AAAA del rango (default: año actual - 1). Máx 2 años por llamada
  - anio_fin: Año final AAAA del rango (default: año actual). Máx 2 años por llamada
  - periodos: Cortes EEFF explícitos AAAAMM (máx 3). Si no se entregan, se usan los 3 períodos más recientes del rango
  - secciones default=["eeff"]: Secciones a incluir: eeff|hechos|sanciones|resoluciones|memoria (default: solo eeff)
  - tipo enum=[C|I]: Tipo de balance: C=Consolidado (default), I=Individual
  - norma enum=[IFRS|NCH]: Norma contable: IFRS (default) o NCH (Chilean GAAP)
  - max_documentos default=12: Máximo de documentos descargados (1-24, default 12); el resto se omite y se reporta
  - max_mb default=10: Máximo total de MB descargados (1-50, default 10)
  - incluir_zip default=true: true = arma el ZIP en base64 (default); false = solo devuelve los archivos sueltos
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {empresa, descargados, resumen, zip}

### cmf_fondos_paquete_mensual
- title: Boletines mensuales del sistema de Fondos Mutuos
- description: Devuelve en UNA llamada los boletines mensuales del sistema de fondos mutuos de un mes: patrimonio/rentabilidad (bpr), costos TAC (costos), comisiones e inversiones nacional/extranjera, con total y hasta max_filas filas por sección. Parámetros: anio AAAA (ej: 2025), mes MM (ej: 03) y secciones a incluir (bpr|costos|comisiones|inversiones_nacio|inversiones_inter). Use esta tool para un resumen del mes; para el detalle completo de una sección use las tools individuales de fondos mutuos.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - secciones default=["bpr","costos","comisiones"]: Secciones a incluir: bpr|costos|comisiones|inversiones_nacio|inversiones_inter
  - max_filas default=20: Máximo de filas por sección (5-100, default 20)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, secciones, fallidos, requests_cmf, tiempo_estimado_s}

## PROMPTS (3)

### cmf_analizar_empresa — Guía paso a paso para analizar una empresa que cotiza en bolsa usando los datos de la CMF: identificación, EEFF, hechos esenciales, sanciones, ASG y memoria anual.
```
Analiza la empresa con RUT 90690000 siguiendo estos pasos usando las tools del servidor MCP CMF Chile:

1. cmf_empresa_info: identificación (razón social, inscripción).
2. cmf_empresa_eeff_historial: períodos disponibles.
3. cmf_empresa_eeff: últimos estados financieros (situación financiera, resultados, flujo de efectivo) — explica evolución anual.
4. cmf_empresa_hechos: hechos esenciales del último año (materias relevantes).
5. cmf_empresa_sanciones y cmf_empresa_resoluciones: cumplimiento normativo.
6. cmf_empresa_asg: indicadores ASG si existen — prueba los tres tipo_informe (1=Memoria Integrada, 2=SASB, 3=XBRL SASB) y di cuáles existen.
7. cmf_empresa_memoria_anual: memoria del último año si está disponible.

Entrega un informe estructurado: perfil, salud financiera (indicadores derivados), riesgos (hechos/sanciones), gobernanza y conclusión. Cita siempre el período de los datos. Si una tool no devuelve datos, dilo explícitamente (no inventes).
```

### cmf_comparar_fondos — Compara fondos mutuos (patrimonio, rentabilidad, partícipes, valor cuota, costos TAC) usando el catálogo y los boletines de la CMF.
```
Compara fondos mutuos chilenos a 01/2026 usando las tools del MCP CMF Chile:

1. Si el usuario pide fondos específicos, primero cmf_fondos_mutuos_catalogo para identificarlos: anota el RUN de cada fondo y el RUT de su administradora (rut_admin).
2. cmf_fondos_mutuos_bpr (anio, mes; admin=rut_admin si buscas una administradora): patrimonio, rentabilidad nominal mensual, partícipes y valor cuota por serie.
3. cmf_fondos_mutuos_costos (anio, mes; admin=rut_admin): TAC y remuneraciones por serie.
4. cmf_fondos_mutuos_antecedentes: contexto del sistema.
5. Si comparas series específicas, filtra por su RUN dentro de las filas devueltas (bpr/costos filtran por administradora, no por RUN).

Entrega: ranking por patrimonio y por rentabilidad, tabla comparativa con costos TAC, y comentario de calidad (datos faltantes señalados explícitamente).
```

### cmf_indicadores_economicos — Genera un reporte de indicadores económicos oficiales chilenos (UF, UTM, IPC, TMC, dólar) para un período. Requiere que el servidor tenga configurada la CMF_API_KEY (API oficial v3); si las tools responden 'CMF_API_KEY no configurada', la instancia no puede generar este reporte.
```
Genera un reporte de indicadores económicos chilenos a 01/2026 usando el MCP CMF Chile:

1. cmf_api_indicador_valor: UF, UTM, IPC, TMC, dólar y euro (serie, anio, mes).
2. cmf_api_indicador_serie: tendencia de los últimos 6-12 meses.

Entrega una tabla con valores y una nota breve de tendencia. Señala los indicadores no disponibles.
```

## RESOURCE TEMPLATES
- cmf://entidades/{rut}: Ficha de identificación de una entidad supervisada por su RUT.
- cmf://indicadores/{serie}/{anio}/{mes}: Valor de un indicador (uf, dolar, euro, tab, utm, ipc, tip, tmc) para un período.
- cmf://fondos/{run}: Identificación de un fondo mutuo por su RUN.
- cmf://norma/{id}: Referencia a una norma del compendio (PDF). Use cmf_normativa_descargar para obtener el archivo.
- cmf://documento/{id}: Metadata de un documento firmado (hechos, sanciones, resoluciones). Use cmf_documento_descargar para el contenido.
- cmf://captcha/{id}: Imagen captcha (6 caracteres) requerida por consultas protegidas de la CMF.

## RESOURCES ESTÁTICOS
- cmf://skill/uso: Instrucciones de uso del servidor MCP de la CMF de Chile (formato Agent Skills: name, description, procedimiento).
- cmf://bancos/codigos: Mapa código SBIF → nombre de institución financiera (verificado contra la API oficial v3 de la CMF). Use estos códigos en institucion para las tools cmf_api_*.

> Nota: este catálogo se genera con argumentos de ejemplo para los prompts (npx tsx test/dump-catalogo.ts). Los placeholders reales son los argsSchema de cada prompt.
