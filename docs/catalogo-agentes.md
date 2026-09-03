# Catálogo del MCP mcp-cmf-chile (lo que ve el agente)

- serverInfo: {"name":"mcp-cmf-chile","version":"0.1.0"}

## INSTRUCTIONS (InitializeResult.instructions)

```
Servidor MCP con los datos públicos de la Comisión para el Mercado Financiero de Chile (CMF).
Uso recomendado:
1. Para analizar una empresa: cmf_empresa_por_ticker (ticker de bolsa, ej: COPEC, SQM-B; los RUTs provienen del catálogo de empresas en bolsa en github.com/JoaquinMulet/empresas-cmf-chile) o cmf_buscar_entidad (una palabra clave o RUT) para obtener el RUT canónico → cmf_empresa_info → cmf_empresa_eeff_historial (períodos disponibles) → cmf_empresa_eeff (estados financieros IFRS/NCH por período; use modo=markdown para leer el PDF auditado convertido a Markdown) → cmf_empresa_hechos → cmf_empresa_sanciones/resoluciones.
2. Para descargar todo de una empresa: cmf_empresa_paquete (plan de descarga, máx 2 años por llamada) y cmf_empresa_paquete_documentos (ZIP ordenado, máx 3 períodos por llamada).
3. Fondos mutuos: cmf_fondos_mutuos_catalogo para identificar fondos → cmf_fondos_mutuos_bpr (patrimonio/rentabilidad) → cmf_fondos_mutuos_costos (TAC).
4. Indicadores económicos: cmf_api_indicador_valor (serie: uf, dolar, euro, tab, utm, ipc, tip, tmc). Para balances bancarios, identifique la institución por su código SBIF (ej: 001=Banco de Chile, 037=Banco Santander-Chile; 999=el sistema total; la lista completa la entrega cmf_codigos con catalogo=bancos). Los RUT de las compañías de seguros que pide cmf_seguros_eeff los entrega cmf_codigos con catalogo=seguros, y el significado de las columnas ffm_ de la cartera de fondos mutuos, cmf_codigos con catalogo=cartera_fondos_mutuos.
5. Normativa y seguros: cmf_normativa_buscar y cmf_seguros_*.
Límites y notas:
- Captchas (cmf_hechos_globales y cmf_fondos_mutuos_cartola): al llamarlas sin código, la tool descarga la imagen captcha de la CMF y le entrega un resource cmf://captcha/{id}; pida al usuario que lea los 6 caracteres y reintente con captcha=<código> y captcha_id=<id>.
- Fechas en formato YYYY-MM-DD. Los RUT se aceptan en cualquier formato (90690000, 90690000-5 o 90.690.000-5) y el servidor los deja sin dígito verificador, que es lo que pide la CMF. Todo catálogo entrega el campo rut en ese mismo formato, sin puntos ni DV, y si la fuente traía el DV viaja en rut_dv; así lo que sale de un catálogo se pega tal cual en cualquier tool. Ojo. en los catálogos de fondos (mutuos y de inversión) la CMF usa como identificador un número de registro de 4 dígitos (run_fondo, o rut en el de fondos de inversión), no un RUT.
- Resultados paginados: las tools con offset/limit devuelven next_offset/total; itere para ver todas las filas (nunca asuma que la primera página es el total).
- Los documentos firmados se gestionan en el servidor; para leer el contenido de un PDF: cmf_documento_markdown (token s567 o url completa del documento).
- La conversión a Markdown es una aproximación: sin OCR, con tablas que pueden fusionar conceptos o correr cifras de columna. Si el modelo tiene visión, lo más fiable es descargar el PDF y leer sus páginas como imagen, usando el Markdown solo para ubicar la página.
- Si una consulta devuelve 'sin datos', verifique el período o la norma (IFRS vs NCH) antes de concluir que la información no existe; si el error menciona que la fuente de la CMF no devolvió datos, es una condición del sistema de la CMF (verifique la página oficial indicada) y no implica ausencia de datos.
```

## TOOLS (88)

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
- description: Devuelve la serie histórica de un indicador económico (UF, dólar, euro, TAB, UTM, IPC, TIP, TMC) en un rango de períodos, desde la API oficial v3 de la CMF, con la granularidad que la API publica para cada uno: la UF, el dólar y el euro vienen DIARIOS (un registro por día del rango), la UTM y el IPC mensuales. Defina el rango con desde/hasta en AAAA o AAAA-MM (ej: desde=2023-01, hasta=2024-12; el día se ignora); si algún extremo no trae mes, la consulta se hace por año completo. La salida incluye total y hasta 100 registros; "Sin registros" indica que el rango no tiene datos, verifique el período. Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para evoluciones históricas; para un valor puntual use cmf_api_indicador_valor. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - serie (REQUERIDO): Indicador a consultar: uf, dolar, euro, tab, utm, ipc, tip o tmc. Ej: uf
  - desde (REQUERIDO): Inicio del rango en AAAA o AAAA-MM. Ej: 2023-01
  - hasta (REQUERIDO): Fin del rango en AAAA o AAAA-MM. Ej: 2024-12
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 100. La respuesta trae total y next_offset. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {serie, desde, hasta, total, registros}

### cmf_api_balance_institucion
- title: Balance de institución financiera
- description: Devuelve el balance mensual de instituciones financieras (bancos) supervisadas, desde la API oficial v3 de la CMF. Filtre el período con anio (AAAA) y mes (MM); use institucion para un banco específico (999 = sistema financiero total) y cuenta para una sola cuenta contable (ej: 210000), sin ellos devuelve los datos completos del período, con una fila por cuenta (código, descripción, institución y montos por moneda). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para activos y pasivos contables; para ingresos y gastos del mismo período use cmf_api_resultados_institucion. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - institucion: Código SBIF de la institución (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; 999=sistema total; vea el resource cmf://bancos/codigos; acepta 999 o '999')
  - cuenta: Código de cuenta (ej: 210000)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, institucion, cuenta, componente, indicador, data}

### cmf_api_resultados_institucion
- title: Estado de resultados de institución financiera
- description: Devuelve el estado de resultados mensual de instituciones financieras (bancos), desde la API oficial v3 de la CMF, con una fila por cuenta (código, descripción, institución y montos por moneda). Filtre el período con anio (AAAA) y mes (MM); use institucion para un banco específico (999 = sistema financiero total), sin institucion devuelve los datos del período completo; use cuenta para quedarse con las cuentas cuyo código EMPIEZA con ese prefijo (ej: 4 = ingresos, 41 = intereses). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para ingresos y gastos del mes; para el balance contable use cmf_api_balance_institucion. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - institucion: Código SBIF de la institución (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; 999=sistema total; vea el resource cmf://bancos/codigos; acepta 999 o '999')
  - cuenta: Prefijo del código de cuenta (ej: 4, 41, 410100)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, institucion, cuenta, componente, indicador, data}

### cmf_api_adecuacion_capital
- title: Adecuación de capital
- description: Devuelve componentes o indicadores de adecuación de capital (activos ponderados por riesgo, límites, patrimonio efectivo, IRE/IRS) de una institución financiera, desde la API oficial v3 de la CMF. Indique el período con anio (AAAA) y mes (MM), la institución con institucion (999 = sistema total) y la vista con componente (activos, limites, patrimonioefectivo o indicadores); con componente=indicadores agregue indicador=ire o irs. Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para supervisar la solvencia bancaria; para el balance o resultados contables use cmf_api_balance_institucion o cmf_api_resultados_institucion.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - institucion (REQUERIDO): Código SBIF de la institución (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; 999=sistema total; vea el resource cmf://bancos/codigos; acepta 999 o '999')
  - componente (REQUERIDO) enum=[activos|limites|patrimonioefectivo|indicadores]: Componente a consultar: activos, limites, patrimonioefectivo o indicadores
  - indicador enum=[ire|irs]: Indicador a consultar: ire o irs (solo si componente=indicadores)
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
- description: Devuelve la lista de accionistas de una institución financiera para un período, desde la API oficial v3 de la CMF, con una fila por accionista; las filas SUBTOTAL, OTROS y TOTAL que la API agrega al final viajan aparte en totales, así que sumar la columna no las cuenta 2 veces. Identifique la institución con institucion (ej: 001) y el período con anio (AAAA) y mes (MM). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para la estructura de propiedad de un banco; para su directorio use cmf_api_integrantes_institucion. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - institucion (REQUERIDO): Código SBIF de la institución financiera (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; vea cmf://bancos/codigos)
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, institucion, cuenta, componente, indicador, data}

### cmf_api_integrantes_institucion
- title: Integrantes de directorio de institución financiera
- description: Devuelve los integrantes de la administración de una institución financiera que la API oficial v3 de la CMF informa para un período (nombre, cargo, fecha de asunción). Verificado el 2 de septiembre de 2026: para Banco de Chile la API entrega solo al gerente general, no al directorio completo. Identifique la institución con institucion (ej: 001) y el período con anio (AAAA) y mes (MM). Requiere la API key oficial configurada en el servidor (CMF_API_KEY). Use esta tool para el gobierno corporativo de un banco; para su estructura de propiedad use cmf_api_accionistas_institucion.
- parámetros:
  - institucion (REQUERIDO): Código SBIF de la institución financiera (ej: 001=Banco de Chile, 037=Banco Santander-Chile, 012=Banco Estado; vea cmf://bancos/codigos)
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, institucion, cuenta, componente, indicador, data}

### cmf_empresa_por_ticker
- title: Buscar empresa por ticker (NEMO)
- description: Busca una empresa chilena por su ticker de bolsa usando el catálogo de empresas en bolsa del proyecto empresas-cmf-chile (github.com/JoaquinMulet/empresas-cmf-chile). Identifique la empresa con consulta (NEMO como COPEC, SQM-B o LTM, o nombre parcial) y acote los resultados con limite (1-10, default 5). Devuelve el RUT (que puede incluir el dígito verificador), razón social, ISIN, tipo de entidad, norma e inicio IFRS. Use esta tool para traducir tickers a RUT antes de consultar EEFF o hechos; las demás tools aceptan el RUT con o sin DV.
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
- description: Lista las entidades supervisadas de un tipo (tipoentidad, ej: RVEMI=emisores de valores) y mercado, paginado con offset/limit, sin máximo. Filtre por estado=VI (vigentes, default) o NV y mercado=V (default), O u S. Use esta tool para enumerar un segmento completo; para buscar por nombre o RUT use cmf_buscar_entidad y para el catálogo completo cmf_catalogo_entidades. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - tipoentidad (REQUERIDO): Tipo de entidad supervisada (ej: RVEMI = emisores de valores)
  - mercado: Mercado: V=valores (default), O=otros, S=seguros
  - estado enum=[VI|NV]: VI=vigentes, NV=no vigentes
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {entidades, total, next_offset}

### cmf_empresa_info
- title: Identificación de empresa
- description: Devuelve los datos de identificación de un emisor (razón social, RUT, inscripción y actividad) desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para confirmar identidad y estado de una empresa; para cifras use cmf_empresa_eeff y para gobierno corporativo cmf_empresa_directorio. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, datos}

### cmf_empresa_eeff
- title: Estados financieros (EEFF) de empresa
- description: Devuelve los estados financieros de un emisor (pestanía 3) para un período, consolidado o individual, IFRS o NCH, con los PDFs oficiales del período. modo=documentos: lista de PDFs (EEFF, análisis razonado, declaración, XBRL) con su url — para leer uno pase esa url completa a cmf_documento_markdown. modo=markdown: convierte además el PDF auditado de los EEFF a Markdown para leer las cifras directamente (el HTML de la CMF viene sin líneas: la fuente real de las cifras son los PDFs). La conversión a Markdown es una aproximación: sin OCR, con tablas que pueden fusionar conceptos o correr cifras de columna. Si el modelo tiene visión, lo más fiable es descargar el PDF y leer sus páginas como imagen, usando el Markdown solo para ubicar la página. Verifique los períodos disponibles con cmf_empresa_eeff_historial; para el sistema agregado de todas las SA use cmf_eeff_ifrs_sa.
- parámetros:
  - rut: RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - query: Alias legacy de rut (use rut)
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes de corte trimestral (03/06/09/12)
  - tipo enum=[C|I]: Tipo de balance: C=Consolidado (default), I=Individual
  - norma enum=[IFRS|NCH]: Norma contable: IFRS (default) o NCH (Chilean GAAP)
  - modo enum=[documentos|markdown]: documentos = lista de PDFs del período; markdown = PDF auditado convertido a Markdown
  - max_chars default=30000: Tamaño del tramo en caracteres (modo markdown). Sin máximo: pide el documento entero de una vez. Por defecto 30000. Ej: 1000000
  - offset_chars default=0: Carácter donde empieza el tramo; use el que indique la respuesta anterior para seguir leyendo
  - validar_contable default=false: true = verifica la cuadratura contable (experimental: puede dar falsos negativos en algunos formatos)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {periodo, tipo_balance, documentos, aviso, pdf_type, markdown, markdown_truncado, escaneado, filas_separadas, filas_fusionadas_pendientes, verificacion_contable}

### cmf_empresa_eeff_historial
- title: Historial de EEFF disponibles
- description: Lista los años para los que un emisor tiene estados financieros publicados, junto con su modalidad contable y la fecha de inicio IFRS. Identifique el emisor por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para verificar qué períodos existen o desde cuándo aplica IFRS antes de llamar cmf_empresa_eeff.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, inicio_ifrs, modalidad, anios}

### cmf_empresa_hechos
- title: Hechos esenciales de empresa
- description: Devuelve los hechos esenciales publicados por un emisor (fecha/hora, número, materia y enlace al documento) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); fije desde/hasta en YYYY-MM-DD y pagine con offset/limit, sin máximo. Use esta tool para hechos de un emisor específico; para el flujo de todo el mercado use cmf_hechos_globales (requiere captcha). Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - desde (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {hechos, total, next_offset}

### cmf_empresa_accionistas
- title: 12 mayores accionistas
- description: Devuelve los 12 mayores accionistas de un emisor (nombre, RUT y participación) para un período, desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA y mes opcional en MM (default 12). Use esta tool para analizar la concentración accionaria; para el directorio use cmf_empresa_directorio. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, accionistas}

### cmf_empresa_directorio
- title: Directorio y administración
- description: Devuelve los directores y gerentes de un emisor (nombre y cargo; la ficha de la CMF no publica fechas de designación ni de cese) desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV, ej: 61808000). Use esta tool para gobierno corporativo; para la composición accionaria use cmf_empresa_accionistas. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 100. La respuesta trae total y next_offset. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, directorio}

### cmf_empresa_sanciones
- title: Sanciones de la entidad
- description: Devuelve las sanciones aplicadas por la CMF a un emisor (número, fecha y materia) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta opcionales en YYYY-MM-DD (default 01/01/2000 a 31/12/2100). Use esta tool para el historial sancionatorio de un emisor; para sanciones de todo un mercado use cmf_sanciones_globales. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 100. La respuesta trae total y next_offset. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, sanciones}

### cmf_empresa_resoluciones
- title: Resoluciones de la entidad
- description: Devuelve las resoluciones de la CMF sobre un emisor (número, fecha y materia) en un rango de fechas. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta opcionales en YYYY-MM-DD (default 01/01/2000 a 31/12/2100). Use esta tool para resoluciones dirigidas a un emisor; para resoluciones generales publicadas use cmf_dictamenes o cmf_resoluciones_globales. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 100. La respuesta trae total y next_offset. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, resoluciones}

### cmf_empresa_juntas
- title: Actas de juntas de accionistas
- description: Devuelve las actas de juntas de accionistas de un emisor (ordinarias, extraordinarias o de reforma de estatutos) en un rango de fechas, con enlace al documento. Identifique el emisor por rut (numérico; se acepta con o sin DV); desde/hasta en YYYY-MM-DD y tipo=ordinaria (default), extraordinaria o reforma. Use esta tool para la historia societaria y de gobernanza de un emisor. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - desde (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - tipo enum=[ordinaria|extraordinaria|reforma]: Tipo de junta: ordinaria (default), extraordinaria o reforma de estatutos
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 100. La respuesta trae total y next_offset. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, actas}

### cmf_empresa_memoria_anual
- title: Memoria anual
- description: Devuelve los documentos de la memoria anual de un emisor para un año (memoria, EEFF anuales e informes de auditores). Identifique el emisor por rut (numérico; se acepta con o sin DV) y fije anio en AAAA (ej: 2024). Use esta tool para el contexto anual completo; para cifras trimestrales use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, documentos}

### cmf_empresa_asg
- title: Indicadores ASG (ESG)
- description: Devuelve los indicadores ASG (ambientales, sociales y de gobernanza) de un emisor para un período: memoria integrada, SASB o XBRL SASB. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA, mes opcional en MM (default 12) y tipo_informe=1 (Memoria Integrada), 2 (SASB) o 3 (XBRL SASB). Use esta tool para datos de sostenibilidad; para datos financieros use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - tipo_informe default="1": 1=Memoria Integrada, 2=SASB, 3=XBRL SASB (acepta 1 o '1')
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 100. La respuesta trae total y next_offset. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, indicadores}

### cmf_empresa_eeff_filiales
- title: EEFF de filiales
- description: Devuelve los estados financieros de las filiales de un emisor para un período, desde la ficha de la CMF. Identifique el emisor por rut (numérico; se acepta con o sin DV); anio en AAAA y mes opcional en MM (default 12). Use esta tool para la operación del grupo consolidado; para EEFF de la matriz use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 100. La respuesta trae total y next_offset. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, filiales}

### cmf_empresa_registro_productos
- title: Registro de productos
- description: Devuelve los títulos de deuda inscritos por un emisor ante la CMF (pestaña 'Inscripción títulos de deuda' de su ficha), con una fila por documento de cada inscripción: número de inscripción, fecha, tipo de documento (acta de directorio, certificado de clasificación de riesgo, prospecto, entre otros) y enlace al archivo. Identifique la entidad por rut (numérico; se acepta con o sin DV, ej: 90690000). Use esta tool para ver qué bonos y efectos de comercio tiene inscritos un emisor; para identificarlo primero use cmf_buscar_entidad, y para los prospectos de bonos use la pestaña 42 con cmf_empresa_info. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - rut (REQUERIDO): RUT del emisor o entidad, en cualquier formato (acepta 90749000, 90.749.000 o 90749000-0; el servidor lo deja sin dígito verificador, que es lo que pide la CMF). Ej: 61808000
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {rut, anio, mes, tipo, productos}

### cmf_hechos_globales
- title: Hechos esenciales globales
- description: Devuelve los hechos esenciales de todo el mercado (o de un tipo de entidad) en un rango de fechas, con fecha/hora, número, entidad y materia. Fije mercado (V=valores, O=otros, S=seguros), tipoentidad opcional (ej: RVEMI) y desde/hasta en YYYY-MM-DD. REQUIERE captcha de la CMF (imagen de 6 caracteres): si no entrega captcha, la tool responde pidiéndoselo al usuario y debe reintentar con el código; si el captcha es inválido o expiró, devuelve error y hay que solicitar uno nuevo. Use esta tool para el flujo completo del mercado; para hechos de un emisor use cmf_empresa_hechos (sin captcha). Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - mercado (REQUERIDO): Mercado: V=valores, O=otros, S=seguros
  - tipoentidad: Tipo de entidad (ej: RVEMI; default RVEMI)
  - desde (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - captcha: Código captcha de 6 caracteres (si no lo tiene, la tool le indicará dónde ver la imagen)
  - captcha_id: Id del captcha que la tool le entregó en la respuesta previa (opcional; si no, usa el último captcha activo)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {mercado, desde, hasta, hechos}

### cmf_sanciones_globales
- title: Sanciones globales por mercado
- description: Devuelve las sanciones aplicadas en todo un mercado (V=valores, O=otros, S=seguros, B=bancos) en un rango de fechas, con número, fecha, materia y enlace. Fije desde/hasta opcionales en YYYY-MM-DD (default 01/01/2020 a 31/12/2100), tipoentidad opcional (ej: RVEMI; default ALL=todas) y texto opcional para quedarse solo con las filas cuya materia lo contiene (ej: 'BANCO DE CHILE'; sin acentos ni mayúsculas importa). Verificado el 2 de septiembre de 2026: las multas a bancos (Banco de Chile, Santander) salen bajo mercado O, y bajo B salen las fintech; use texto para encontrar una entidad. Use esta tool para tendencias sancionatorias del mercado y para las sanciones de un banco o una aseguradora, porque cmf_empresa_sanciones solo cubre la ficha de emisores de valores. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - mercado (REQUERIDO): Mercado: V=valores, O=otros, S=seguros, B=bancos
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - tipoentidad: Tipo de entidad (ej: RVEMI; default ALL=todas)
  - texto: Filtro por texto en la materia (ej: 'BANCO DE CHILE')
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {mercado, desde, hasta, sanciones}

### cmf_resoluciones_globales
- title: Resoluciones globales por mercado
- description: Devuelve las resoluciones de la CMF sobre todo un mercado (V=valores, O=otros, S=seguros) en un rango de fechas. Fije desde/hasta opcionales en YYYY-MM-DD (default 01/01/2020 a 31/12/2100) y tipoentidad opcional (ej: RVEMI; default ALL=todas). Use esta tool para resoluciones de alcance de mercado; para resoluciones sobre un emisor use cmf_empresa_resoluciones. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - mercado (REQUERIDO): Mercado: V=valores, O=otros, S=seguros
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - tipoentidad: Tipo de entidad (ej: RVEMI; default ALL=todas)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {mercado, desde, hasta, resoluciones}

### cmf_comunicaciones_emisores
- title: Comunicaciones de emisores
- description: Lista las comunicaciones publicadas por los emisores de valores (fecha, número, sociedad, entidad informante y descripción) con paginación offset/limit, sin máximo. La CMF entrega el listado completo sin filtro; texto (sociedad o descripción) y desde/hasta se filtran en el servidor sobre ese listado. Use esta tool para monitorear comunicados del mercado; para hechos esenciales use cmf_hechos_globales o cmf_empresa_hechos. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - texto: Se queda con las filas donde algún campo contiene este texto (sin acentos ni mayúsculas importa). Ej: 'Parque Arauco'
  - desde: Fecha mínima en YYYY-MM-DD, comparada con el primer campo de la fila que tenga forma de fecha (dd/mm/aaaa o aaaa-mm-dd); una fila sin ningún campo de fecha queda fuera
  - hasta: Fecha máxima en YYYY-MM-DD, comparada con el mismo campo de fecha; una fila sin fecha queda fuera
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {comunicaciones, total, next_offset}

### cmf_clasificaciones_riesgo
- title: Clasificaciones de riesgo
- description: Devuelve las clasificaciones de riesgo asignadas a emisores e instrumentos por las clasificadoras (XLSX oficial de la CMF), paginado con offset/limit, sin máximo. El sistema usa un flujo en 2 pasos: la tool genera el archivo (POST a excel_busqueda_clasificaciones) y descarga el XLSX resultante, que luego se parsea a filas. Filtre opcionalmente por emisor, clasificadora o tipo_instrumento (los filtros se aplican sobre las filas descargadas). Use esta tool para evaluar calidad crediticia de instrumentos; para el historial financiero del emisor use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - emisor: Filtro por nombre o RUT del emisor (texto libre, opcional)
  - clasificadora: Filtro por clasificadora (texto libre, opcional)
  - tipo_instrumento: Filtro por tipo de instrumento (texto libre, opcional)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {clasificaciones, total, next_offset}

### cmf_eeff_ifrs_sa
- title: EEFF IFRS de sociedades anónimas
- description: Devuelve los estados financieros IFRS completos (situación financiera, resultados y flujo de efectivo, con sus 500 y tantas cuentas de la taxonomía) de sociedades anónimas y otras entidades, para un rango de períodos. Cada fila es una cuenta y cada columna una sociedad en un período (la lista entidades trae esas columnas); las cifras van en unidades de la moneda de la fila Moneda, no en miles. Seleccione sociedades por RUT sin DV (array; default ['0']=todas, que devuelve cientos de columnas), registro (RVEMI = emisores de valores, default; RGEIN = otras entidades informantes), anio1/anio2 en AAAA (ej: 2024) y mes1/mes2 opcionales en MM (default 12; solo 03, 06, 09 y 12). Use esta tool para cifras comparables entre SA; para EEFF de un emisor con PDFs auditados use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - sociedades: RUT de las sociedades, en cualquier formato (con o sin puntos, con o sin dígito verificador; el servidor lo deja sin DV, que es lo que pide la CMF). ['0'] = todas
  - registro enum=[RVEMI|RGEIN]: RVEMI = Registro de Valores, emisores (default); RGEIN = Registro de Entidades Informantes
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año final del rango en AAAA (ej: 2025)
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes final del rango en MM (default 12)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_indicadores_financieros_sa
- title: Indicadores financieros IFRS de SA
- description: Devuelve los indicadores financieros IFRS calculados de sociedades anónimas (rentabilidad, liquidez, endeudamiento, capital de trabajo) para un corte. Cada fila es una sociedad en ese corte, con un campo por indicador y su unidad en el nombre del campo. Fije fecha_max en formato AAAAMM (ej: 202512; solo meses 03, 06, 09 y 12), sociedades por RUT sin DV (array; default ['0']=todas) y registro (RVEMI = emisores de valores, default; RGEIN = otras entidades informantes). Use esta tool para comparar ratios entre SA; para los EEFF detallados use cmf_eeff_ifrs_sa y para ratios bajo norma local use cmf_indicadores_financieros_nch. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - fecha_max (REQUERIDO): Corte en formato AAAAMM (ej: 202512)
  - sociedades: RUT de las sociedades, en cualquier formato (con o sin puntos, con o sin dígito verificador; el servidor lo deja sin DV, que es lo que pide la CMF). ['0'] = todas
  - registro enum=[RVEMI|RGEIN]: RVEMI = Registro de Valores, emisores (default); RGEIN = Registro de Entidades Informantes
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_empresa_eeff_nch
- title: EEFF NCH de sociedades anónimas
- description: Devuelve la FECU resumida bajo norma chilena (NCH, anterior a IFRS, o sea hasta 2009 para la mayoría) de sociedades anónimas para un rango de períodos, en miles de pesos o de la moneda que corresponda. Cada fila es una sociedad en un período, con un campo por partida (RUT, razón social, moneda, activos, pasivos, resultados). Seleccione sociedades por RUT sin DV (array; default ['0']=todas), registro (RVEMI = emisores de valores, default; RGEIN = otras entidades informantes), indcon (0 = todos, I = individual, C = consolidado; default 0), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para períodos pre-IFRS; para los EEFF IFRS con PDF auditado de UN emisor use cmf_empresa_eeff (norma=IFRS); para el sistema IFRS de todas las SA use cmf_eeff_ifrs_sa. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - sociedades: RUT de las sociedades, en cualquier formato (con o sin puntos, con o sin dígito verificador; el servidor lo deja sin DV, que es lo que pide la CMF). ['0'] = todas
  - registro enum=[RVEMI|RGEIN]: RVEMI = Registro de Valores, emisores (default); RGEIN = Registro de Entidades Informantes
  - indcon enum=[0|I|C]: 0 = todos, I = individual, C = consolidado
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año final del rango en AAAA (ej: 2009)
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes final del rango en MM (default 12)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_indicadores_financieros_nch
- title: Indicadores financieros NCH de SA
- description: Devuelve los indicadores financieros calculados bajo norma chilena (NCH, anterior a IFRS, o sea hasta 2009 para la mayoría) de sociedades anónimas para un rango de períodos. Cada fila es una sociedad en un período, con un campo por partida e indicador (activo total, patrimonio, ingresos, rentabilidad, liquidez, endeudamiento). Seleccione sociedades por RUT sin DV (array; default ['0']=todas), registro (RVEMI = emisores de valores, default; RGEIN = otras entidades informantes), indcon (0 = todos, I = individual, C = consolidado; default 0), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12). Use esta tool para ratios NCH; para indicadores IFRS use cmf_indicadores_financieros_sa. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - sociedades: RUT de las sociedades, en cualquier formato (con o sin puntos, con o sin dígito verificador; el servidor lo deja sin DV, que es lo que pide la CMF). ['0'] = todas
  - registro enum=[RVEMI|RGEIN]: RVEMI = Registro de Valores, emisores (default); RGEIN = Registro de Entidades Informantes
  - indcon enum=[0|I|C]: 0 = todos, I = individual, C = consolidado
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año final del rango en AAAA (ej: 2009)
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes final del rango en MM (default 12)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_dividendos
- title: Dividendos de sociedades
- description: Devuelve los dividendos declarados que la CMF publica en su estadística de dividendos, con una fila por dividendo (sociedad y fecha de pago) y sus campos: RUT, razón social, número y tipo de dividendo, fechas de acuerdo, cierre, límite y pago, moneda, dividendo por acción, número de acciones y montos. COBERTURA, verificada el 2 de septiembre de 2026: el formulario de la CMF solo ofrece 176 sociedades, casi todas concesionarias y sanitarias (aeropuertos, Aguas Araucanía, autopistas); las sociedades de bolsa como Copec NO están y para ellas los dividendos se leen en sus hechos esenciales con cmf_empresa_hechos. Seleccione sociedades por RUT sin DV (array; ['0'] = todas), anio en AAAA, anio2 opcional para rangos, mes/mes2 opcionales en MM (default 01-12) y tipodiv (0=dividendos, default 0). Si una sociedad no tiene dividendos en el período, la CMF lo dice y la tool lo reporta como ausencia real. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - sociedades: RUT de las sociedades, en cualquier formato (con o sin puntos, con o sin dígito verificador; el servidor lo deja sin DV, que es lo que pide la CMF). ['0'] = todas
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2: Año final del rango en AAAA (default: igual a anio)
  - mes: Mes inicial en MM (default 01)
  - mes2: Mes final en MM (default 12)
  - tipodiv default="0": Tipo de dividendo (0=dividendos, default)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_operaciones_capital
- title: Operaciones de capital (repartos, canjes, liberadas)
- description: Devuelve las operaciones de capital de sociedades anónimas: repartos de capital, canjes de acciones o acciones liberadas de pago, con una fila por operación (sociedad y año) y sus campos (RUT, razón social, número, serie, fechas de acuerdo, límite y pago, moneda, monto por acción, acciones y totales en miles). Elija tipo=reparto, canje o liberadas; seleccione sociedades por RUT sin DV (array; ['0'] = todas) y fije anio en AAAA, o anio='0' para todos los años, que es lo más útil porque estas operaciones son pocas por año. Use esta tool para eventos corporativos sobre el capital; para dividendos use cmf_dividendos. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - tipo (REQUERIDO) enum=[reparto|canje|liberadas]: Operación: reparto=repartos de capital, canje=canjes de acciones, liberadas=acciones liberadas de pago
  - sociedades: RUT de las sociedades, en cualquier formato (con o sin puntos, con o sin dígito verificador; el servidor lo deja sin DV, que es lo que pide la CMF). ['0'] = todas
  - anio (REQUERIDO): Año en AAAA, o '0' para todos los años
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_apv
- title: Valores APV
- description: Devuelve los valores de ahorro previsional voluntario (APV) que publica la CMF (Circular 1981): depósitos, traspasos, cuentas y bonificaciones por tipo de entidad y mes. Elija el cuadro (1=Depósitos APV, 2=Depósitos Convenidos, 3=APV Colectivo, 4=Bonificación APV/APVC, 5-10=Traspasos, 11+=Cuentas y desgloses), el rango (anio_desde/anio_hasta en AAAA, mes_desde/mes_hasta en MM) y los tipos de entidad (FI=fondos de inversión, FM=mutuos, FV=seguros de vida, IV, SV, SA). Con exportar=true devuelve además el XLS oficial del cuadro (base64). Use esta tool para estadísticas de APV; para fondos mutuos use las tools cmf_fondos_mutuos_*. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - anio_desde (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio_hasta (REQUERIDO): Año final del rango en AAAA (ej: 2025)
  - mes_desde: Mes inicial en MM (default 01)
  - mes_hasta: Mes final en MM (default 12)
  - cuadro default="1": Cuadro estadístico: 1=Depósitos APV, 2=Depósitos Convenidos, 3=APV Colectivo, 4=Bonificación APV/APVC, 5-10=Traspasos, 11+=Cuentas y desgloses (default 1)
  - tipo_e default=["FI","FM","FV"]: Tipos de entidad a incluir (default FI,FM,FV)
  - tipo enum=[entidad|agregado]: Vista: entidad o agregado (default entidad)
  - exportar default=false: true = además descarga el XLS oficial del cuadro (base64 en xls_base64)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_tomas_control
- title: Tomas de control de emisores
- description: Devuelve la información de tomas de control de emisores de valores publicada por la CMF (fecha, número, sociedad, entidad informante, descripción y enlace al documento). La CMF entrega el listado completo; texto (nombre de la sociedad o del informante) y desde/hasta se filtran en el servidor. Elija el criterio de ordenamiento del listado con orden (1-5, default 1). Use esta tool para cambios de control accionario; para la composición accionaria actual use cmf_empresa_accionistas. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - orden: Criterio de ordenamiento del listado (1-5, default 1)
  - texto: Se queda con las filas donde algún campo contiene este texto (sin acentos ni mayúsculas importa). Ej: 'Parque Arauco'
  - desde: Fecha mínima en YYYY-MM-DD, comparada con el primer campo de la fila que tenga forma de fecha (dd/mm/aaaa o aaaa-mm-dd); una fila sin ningún campo de fecha queda fuera
  - hasta: Fecha máxima en YYYY-MM-DD, comparada con el mismo campo de fecha; una fila sin fecha queda fuera
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_listados_eeff_ifrs
- title: Listados de EEFF IFRS
- description: Devuelve el registro HISTÓRICO de recepción de los primeros EEFF bajo IFRS, de la transición de 2008 y 2009 (fecha de recepción, RUT, razón social y archivo): listado general, Circular 556 u oficios 457/485. No es un listado vigente de quién reporta bajo IFRS hoy; verificado el 2 de septiembre de 2026, las 248 filas del listado general son de 2008 y 2009. Elija tipo_listado=general (default), c556, ofc457 u ofc485. Para los EEFF actuales de una empresa use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - tipo_listado enum=[general|c556|ofc457|ofc485]: Listado: general (default), c556=Circular 556, ofc457/ofc485=respuestas a oficios
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_fechas_divulgacion_eeff
- title: Fechas de divulgación de EEFF
- description: Devuelve el calendario de fechas de divulgación de estados financieros de los emisores para un año. Fije anio en AAAA (ej: 2026). Use esta tool para anticipar la publicación de resultados; para los EEFF ya publicados use cmf_empresa_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_intermediarios_eeff_ifrs
- title: EEFF IFRS de intermediarios (AV/CB/CBP)
- description: Devuelve los estados financieros IFRS de intermediarios de valores (corredores de bolsa y agentes de valores) para un rango de períodos, en miles de pesos. Cada fila es una cuenta (con su código, ej. 11.01.00 Efectivo) y cada columna un intermediario en un período (la lista entidades trae esas columnas). Seleccione tipo (0 = todos, 1 = corredores, 2 = agentes; default 0), sociedades por RUT sin DV (array; default ['0']=todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12; solo 03, 06, 09 y 12). Use esta tool para EEFF de intermediarios; para sociedades anónimas use cmf_eeff_ifrs_sa. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - tipo enum=[0|1|2]: 0 = todos, 1 = corredores de bolsa, 2 = agentes de valores
  - sociedades: RUT de las sociedades, en cualquier formato (con o sin puntos, con o sin dígito verificador; el servidor lo deja sin DV, que es lo que pide la CMF). ['0'] = todas
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año final del rango en AAAA (ej: 2025)
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes final del rango en MM (default 12)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_intermediarios_indicadores_ifrs
- title: Indicadores IFRS de intermediarios
- description: Devuelve los indicadores financieros IFRS de intermediarios de valores (corredores de bolsa y agentes de valores) para un rango de períodos. Cada fila es un intermediario en un período, con un campo por indicador (rentabilidad sobre el patrimonio, comisiones sobre resultado, resultado por intermediación) y los saldos con que se calculan. Seleccione tipo (0 = todos, 1 = corredores, 2 = agentes; default 0), sociedades por RUT sin DV (array; default ['0']=todas), anio1/anio2 en AAAA y mes1/mes2 opcionales en MM (default 12; solo 03, 06, 09 y 12). Use esta tool para ratios de intermediarios; para sus EEFF use cmf_intermediarios_eeff_ifrs. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - tipo enum=[0|1|2]: 0 = todos, 1 = corredores de bolsa, 2 = agentes de valores
  - sociedades: RUT de las sociedades, en cualquier formato (con o sin puntos, con o sin dígito verificador; el servidor lo deja sin DV, que es lo que pide la CMF). ['0'] = todas
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año final del rango en AAAA (ej: 2025)
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes final del rango en MM (default 12)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_resultados_av_cb
- title: Cuadros de resultados (AV/CB y emisores NCH)
- description: Devuelve los cuadros de resultados de agentes de valores y corredores de bolsa (tipo=av_cb, norma IFRS) o de emisores bajo norma NCH (tipo=emisores_nch), para un período. Fije anio en AAAA y mes en MM (03/06/09/12 para IFRS; 12 para NCH); la respuesta trae la tabla de corredores y la de agentes. Use esta tool para estados de resultados agregados del mercado; para EEFF de un emisor individual use cmf_empresa_eeff o cmf_empresa_eeff_nch. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - tipo enum=[av_cb|emisores_nch]: av_cb=agentes/corredores IFRS (default), emisores_nch=emisores bajo NCH
  - anio: Año del período en AAAA (default 2025)
  - mes: Mes de corte (03/06/09/12; default 12)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_liquidez_intermediarios
- title: Índices de liquidez/solvencia de intermediarios
- description: Devuelve los índices diarios de liquidez y solvencia de los intermediarios de valores, con una fila por intermediario y día. Filtre por intermediario (TODOS, COBOL = todos los corredores de bolsa, AGVAL = todos los agentes de valores, o el código de uno; default TODOS) y por rango desde/hasta en YYYY-MM-DD con a lo más 31 días de diferencia entre los 2 (o sea hasta 32 días de datos), que es el tope del formulario de la CMF (default: los últimos 7 días, contados en hora de Chile). Use esta tool para monitorear la salud financiera de intermediarios; para sus EEFF use cmf_intermediarios_eeff_ifrs. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - intermediario default="TODOS": TODOS, COBOL (corredores), AGVAL (agentes) o el código de un intermediario
  - desde: Inicio del rango en YYYY-MM-DD (default: hace 7 días)
  - hasta: Fin del rango en YYYY-MM-DD (default: hoy; a lo más 31 días desde el inicio)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_prestamos_otorgados
- title: Préstamos otorgados
- description: Devuelve el reporte mensual de préstamos otorgados en el mercado de valores publicado por la CMF (XLS oficial), con detalle por entidad y hasta 300 filas. Fije anio (2016-2026) y mes (01-12), ambos opcionales (default año y mes actuales); si el mes no tiene reporte, la CMF devuelve solo el título y la tool lo indica. Use esta tool para estadísticas de préstamos del mercado; para reportes de la banca use cmf_bancos_reportes. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - anio: Año del reporte en AAAA (2016-2026; default año actual)
  - mes: Mes del reporte en MM (default mes actual)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_dictamenes
- title: Actos y resoluciones publicados (dictámenes)
- description: Lista los actos administrativos y resoluciones publicados por la CMF (tabla de publicidad de actos según Ley 19.880, art. 45 y siguientes): tipo de acto, denominación, número, fecha de publicación, medio de comunicación, efectos generales o particulares y vínculo al documento. Fije el rango con desde/hasta opcionales en YYYY-MM-DD (default 2000-01-01 al año actual; solo se usa el año de cada fecha); la tool consulta los últimos 5 años del rango. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas. Use esta tool para resoluciones generales publicadas; para sanciones a un emisor específico use cmf_empresa_sanciones y para resoluciones del mercado cmf_resoluciones_globales.
- parámetros:
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_sanciones_cursadas
- title: Sanciones cursadas del mes
- description: Devuelve las sanciones cursadas del mes en curso y la portada de sanciones (la CMF entrega la portada completa, sin filtro por mercado). Use esta tool para las sanciones más recientes; para rangos históricos use cmf_sanciones_globales; para las de un emisor use cmf_empresa_sanciones. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_resoluciones_cursadas
- title: Resoluciones cursadas
- description: Devuelve las resoluciones cursadas recientes (historico=false, default) o el listado completo de meses anteriores (historico=true, respuesta grande). Use esta tool para resoluciones recientes de la CMF; para resoluciones filtradas por mercado use cmf_resoluciones_globales. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - historico default=false: true = listado histórico completo (grande)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_catalogo_entidades
- title: Catálogo completo de entidades supervisadas
- description: Devuelve el catálogo completo de entidades supervisadas de la CMF filtrable por nombre (parcial), tipo de entidad (descripción o código como RVEMI/FMT/FIP) y estado (VI=vigentes, NV=no vigentes), con paginación offset/limit, sin máximo. El catálogo se cachea 24h en KV; la primera carga sin caché puede exceder el límite de CPU del plan free de Workers. Use esta tool para búsquedas masivas o filtradas; para una entidad puntual use cmf_buscar_entidad. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - nombre: Filtro por nombre (parcial, insensible a acentos)
  - tipo_entidad: Filtro por tipo de entidad: texto parcial del tipo (ej: 'Emisores de Valores', 'Fondos Mutuos') o código (RVEMI, FMT, FIP, CSVID, CSGEN)
  - estado enum=[VI|NV]: VI=vigentes, NV=no vigentes (acepta VI/NV)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {entidades, total, next_offset, cache, advertencia}

### cmf_fondos_mutuos_catalogo
- title: Catálogo de Fondos Mutuos
- description: Devuelve el catálogo completo de fondos mutuos de la CMF (RUT administradora, RUN fondo, nombre, tipo de fondo, moneda, fechas de inicio/término), filtrable por nombre y tipo y paginado con offset/limit. Use esta tool para encontrar el RUN de un fondo antes de consultar su cartola (cmf_fondos_mutuos_cartola) o su cartera (cmf_fondos_mutuos_cartera). Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset. El significado de los codigos de tipo de fondo esta en el recurso cmf://fondos-mutuos/tipos.
- parámetros:
  - nombre: Filtro por nombre del fondo (parcial)
  - tipo: Filtro por tipo de fondo: compara el CÓDIGO numérico (0-8), no el nombre
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {fondos, total, next_offset}

### cmf_fondos_mutuos_cartera
- title: Cartera de inversiones de Fondos Mutuos
- description: Descarga la cartera de inversiones de fondos mutuos de la CMF para un mes: posiciones por instrumento de cada fondo (columnas con códigos de la Circular 1333). Requiere cartera (NACI=nacional, EXTR=extranjera, OPCI=opciones, FUTU=futuros, OPLA=opciones largo plazo), anio en AAAA y mes en MM; la salida trae total y las primeras 50 filas de ejemplo. Use esta tool para ver las posiciones que componen cada fondo; para agregados por emisor/país use cmf_fondos_mutuos_inversiones. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes (REQUERIDO): Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - cartera (REQUERIDO) enum=[NACI|EXTR|OPCI|FUTU|OPLA]: Tipo de cartera: NACI=nacional, EXTR=extranjera, OPCI=opciones, FUTU=futuros, OPLA=opciones largo plazo
  - texto: Se queda con las filas donde algún campo contiene este texto, por ejemplo el RUN del fondo o el nombre del instrumento. La CMF entrega la cartera del mes entera (unas 30.000 filas) sin filtro propio; este se aplica en el servidor
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, notas, totales, filas}

### cmf_fondos_mutuos_comisiones
- title: Comisiones y remuneraciones de FM
- description: Descarga la estructura de comisiones de fondos mutuos de la CMF: comisión de colocación, remuneración de administración y gastos de operación por fondo/serie. Filtre por anio en AAAA, mes en MM (default 12), admin (RUT de administradora, 0=todas), tipo_fondo (0-8, 0=todos) y moneda (0=todas, $$, PROM o EUR). Use esta tool para comparar cobros entre fondos; para el costo total anual (TAC) use cmf_fondos_mutuos_costos. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez. El significado de los codigos de tipo de fondo esta en el recurso cmf://fondos-mutuos/tipos.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - admin: RUT de administradora (0=todas)
  - tipo_fondo: Código de tipo de fondo (0=todos, 1-8 según la clasificación de la CMF)
  - moneda enum=[0|$$|PROM|EUR]: Moneda: 0=todas, $$=pesos chilenos, PROM=promedio, EUR=euros
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, notas, totales, filas}

### cmf_fondos_mutuos_inversiones
- title: Inversiones de Fondos Mutuos
- description: Descarga las inversiones de fondos mutuos de la CMF por período, en instrumentos nacionales o extranjeros, agregadas según el nivel pedido. Requiere anio en AAAA, tipo (nacio=nacionales, inter=extranjeros; default nacio) y consulta (fondos, default; emisores o pais_transaccion); mes en MM opcional (default 12). Use esta tool para agregados de inversión; para el detalle de la cartera por fondo use cmf_fondos_mutuos_cartera. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez. El significado de los codigos de tipo de fondo esta en el recurso cmf://fondos-mutuos/tipos. Las cifras NO vienen en pesos: la unidad esta en el recurso cmf://fondos-mutuos/tipos y el pie exacto de la planilla viaja en el campo notas de la respuesta.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - tipo enum=[nacio|inter]: Ámbito de inversión: nacio=nacionales, inter=extranjeros (default nacio)
  - consulta enum=[fondos|emisores|pais_transaccion]: Nivel de agregación: fondos, emisores o pais_transaccion (default fondos)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, notas, totales, filas}

### cmf_fondos_mutuos_bpr
- title: Patrimonio, rentabilidad y partícipes de FM
- description: Descarga el Boletín de Patrimonio y Rentabilidad (BPR) de fondos mutuos de la CMF: patrimonio, variación, rentabilidad nominal mensual, número de partícipes y valor cuota por serie. Filtre por anio en AAAA, mes en MM (default 12) y admin (RUT de administradora; omitir = todas). Use esta tool para datos por serie; para el agregado del sistema use cmf_fondos_mutuos_antecedentes. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez. El significado de los codigos de tipo de fondo esta en el recurso cmf://fondos-mutuos/tipos. Las cifras NO vienen en pesos: el Patrimonio va en millones de la moneda que dice la columna Moneda de cada fila (pesos, dólares o euros), así que sumar la columna sin convertir mezcla monedas; solo la fila Total Sistema, que viaja aparte en totales, viene convertida a moneda nacional al tipo de cambio que declara el pie. La unidad esta en el recurso cmf://fondos-mutuos/tipos y el pie exacto de la planilla viaja en el campo notas de la respuesta.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - admin: RUT de administradora (omitir = todas)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, notas, totales, filas}

### cmf_fondos_mutuos_costos
- title: Cuadro de costos de FM (TAC)
- description: Descarga el cuadro estadístico de costos de fondos mutuos de la CMF: remuneración fija/variable, gastos de operación y TAC (costo total anual) por serie. Filtre por anio en AAAA, mes en MM (default 12) y admin (RUT de administradora; omitir = todas). Use esta tool para comparar el costo total anual entre series; para la estructura de comisiones de colocación use cmf_fondos_mutuos_comisiones. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - admin: RUT de administradora (omitir = todas)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, notas, totales, filas}

### cmf_fondos_mutuos_antecedentes
- title: Antecedentes generales del sistema FM
- description: Devuelve los antecedentes generales del sistema de fondos mutuos de la CMF: número de administradoras y fondos, patrimonio total y partícipes (corte a diciembre de cada año). Filtre por anio en AAAA (opcional; default 2025). Use esta tool para la evolución agregada del sistema; para datos por fondo use cmf_fondos_mutuos_bpr. La respuesta trae total y next_offset; sube limit, que no tiene máximo, para traer todas las filas de una vez.
- parámetros:
  - anio: Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, notas, totales, filas}

### cmf_fondos_mutuos_cartola
- title: Cartola diaria de Fondos Mutuos
- description: Devuelve la cartola diaria de un fondo mutuo de la CMF (valor cuota, patrimonio y partícipes por día) para un rango de fechas. Requiere el RUN del fondo (búsquelo con cmf_fondos_mutuos_catalogo) y captcha de la CMF: si no se entrega el código de 6 caracteres, la tool lo solicitará para reintentar. Use esta tool para la evolución diaria de un fondo; para datos mensuales por serie use cmf_fondos_mutuos_bpr. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - fondo (REQUERIDO): RUN del fondo (búsquelo con cmf_fondos_mutuos_catalogo); acepta 8298 o '8298'
  - desde (REQUERIDO): Fecha inicial en YYYY-MM-DD (acepta DD/MM/AAAA). Ej: 2026-01-01
  - hasta (REQUERIDO): Fecha final en YYYY-MM-DD (acepta DD/MM/AAAA). Ej: 2026-01-31
  - captcha: Código captcha de 6 caracteres (si no lo tiene, la tool le indicará dónde ver la imagen)
  - captcha_id: Id del captcha que la tool le entregó en la respuesta previa (opcional; si no, usa el último captcha activo)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=400: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 400. La respuesta trae total y next_offset. Ej: 400
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {anio, mes, total, notas, totales, filas}

### cmf_fondos_comisiones_maximas
- title: Comisiones máximas para fondos de pensiones/cesantía
- description: Devuelve las comisiones máximas que los fondos mutuos (fm) y fondos de inversión (fi) pueden cobrar a los Fondos de Pensiones (Circular 1951) y de Cesantía (Circular 1965), con una fila por documento: administradora, período, fecha de publicación, estado y el enlace firmado al XLS, que se baja con cmf_documento_descargar o se lee con cmf_documento_markdown; cuando la administradora informó que no tuvo fondos afectos, la fila trae ese aviso en estado y sin enlace. Filtre por tipo (fm o fi; default fm), circular (1951 o 1965; default 1951) y anio en AAAA. Use esta tool para los topes legales de comisiones; para las comisiones efectivas de cada fondo use cmf_fondos_mutuos_comisiones. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - tipo enum=[fm|fi]: Tipo de administradora: fm=mutuos, fi=inversión (default fm)
  - circular default="1951": Circular que fija el tope: 1951=pensiones, 1965=cesantía (default 1951; acepta 1951 o '1951')
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {tipo, circular, anio, administradoras, documentos, total, next_offset}

### cmf_fondos_inversion_eeff_ifrs
- title: EEFF IFRS de Fondos de Inversión
- description: Devuelve los estados financieros IFRS de fondos de inversión como matriz de cuentas contables × fondos (grid Google Visualization convertido a JSON), desde el sitio de la CMF. Filtre la administradora con admins (RUT; 0 = todas) y los fondos con fondos (array de códigos; ['0'] = todos); defina el rango con anio1/anio2 (AAAA) y, si necesita cortes intermedios, mes1/mes2 (MM; sin mes se usa diciembre). La salida incluye hasta 200 filas y total_filas con el total real; si responde "Sin resultados" puede requerir re-solución del anti-bot, reintente. Use esta tool para comparar cuentas IFRS entre fondos; para obtener códigos de fondos use cmf_fondos_inversion_catalogo. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - admins: RUT de la administradora, en cualquier formato (0=todas)
  - fondos default=["0"]: Códigos de fondos (['0']=todos)
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {columnas, filas, total_filas}

### cmf_fondos_inversion_catalogo
- title: Catálogo de Fondos de Inversión
- description: Devuelve el catálogo de fondos de inversión supervisados por la CMF (RUT, nombre, tipo de entidad, inscripción y estado) con paginación. Busque con consulta (nombre o RUT; sin consulta lista fondos de inversión en general) y recorra el listado con offset y limit (sin máximo, default 100); la salida trae total y next_offset para continuar. Use esta tool para identificar códigos/RUT de fondos y administradoras que otras tools requieren, p. ej. cmf_fondos_inversion_eeff_ifrs. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - consulta: Nombre o RUT a buscar
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {fondos, total, next_offset}

### cmf_normativa_buscar
- title: Buscar normativa
- description: Busca normas de la CMF (circulares CIR, oficios OFC, normas de carácter general NCG) por NÚMERO en el buscador legacy (verificado: solo devuelve resultados por número; las búsquedas por fechas sin número no funcionan en el sistema de la CMF). Use tipo (CIR/OFC/NCG/ALL) y numero (ej: 2343); los filtros desde/hasta y materia se envían pero el sistema legacy los ignora. Para descargar el PDF use cmf_normativa_descargar con la ruta del compendio. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - tipo enum=[ALL|CIR|OFC|NCG]: Tipo de norma: ALL=todos, CIR=circular, OFC=oficio, NCG=norma de carácter general
  - numero: Número de la norma
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - entidad: Entidad supervisada emisora de la norma (texto libre)
  - materia: Materia de la norma (texto libre)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {normas, total, next_offset}

### cmf_normativa_descargar
- title: Descargar norma (PDF)
- description: Descarga el PDF de una norma del compendio de la CMF y devuelve su tamaño, su URL directa y el binario en base64 por TRAMOS (max_chars es el tamaño del tramo, default 200000 caracteres, y offset_chars dónde empieza; la respuesta trae total_chars y siguiente_offset_chars, o suba max_chars para traerlo entero). Requiere la ruta exacta del archivo dentro del compendio (ej: /web/compendio/cir/cir_2343_2024.pdf). Si la respuesta no es un PDF directo (puede requerir autenticación), lo indica. Use esta tool cuando conozca la ruta del documento; para encontrar normas use cmf_normativa_buscar; para leer el PDF como texto use cmf_documento_markdown con la URL. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - archivo (REQUERIDO): Ruta del archivo del compendio (ej: /web/compendio/cir/cir_2343_2024.pdf)
  - offset_chars default=0: Carácter del base64 donde empieza el tramo (default 0)
  - max_chars default=200000: Tamaño del tramo de base64 en caracteres (default 200000, unos 150 KB de archivo). Sin máximo: un número grande trae el archivo entero. En modo código pídalo entero, porque se queda dentro del programa.
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {archivo, tamano_kb, formato}

### cmf_seguros_eeff
- title: EEFF de compañías de seguros
- description: Devuelve los estados financieros IFRS de compañías de seguros generales o de vida de la CMF para un rango de períodos, en miles de pesos y con las cifras de resultado acumuladas del año a cada corte. Cada fila es una cuenta y cada columna una compañía en un período (la lista entidades trae esas columnas). Requiere anio1/anio2 en AAAA; mes1/mes2 en MM opcionales (default 12; solo 03, 06, 09 y 12). Filtre por tipo (generales o vida; default generales), subtipo (A=compañías, R=reaseguradoras, CR=seguros de crédito; default A) y sociedades (RUT de las compañías en cualquier formato; ['0']=todas). Los RUT y el subtipo de cada compañía los entrega cmf_codigos con catalogo=seguros. Use esta tool para balances de aseguradoras; para su clasificación de riesgo use cmf_seguros_clasificacion_riesgo. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - tipo enum=[generales|vida]: Segmento de seguros: generales o vida (default generales)
  - sociedades: RUT de las sociedades, en cualquier formato (con o sin puntos, con o sin dígito verificador; el servidor lo deja sin DV, que es lo que pide la CMF). ['0'] = todas
  - subtipo default="A": Subtipo del formulario de la CMF. A=compañías de seguros (default), R=reaseguradoras, CR=compañías de seguros de crédito (solo en generales). Cada subtipo es un universo distinto de compañías; el catálogo cmf_codigos con catalogo=seguros trae el subtipo de cada una en su campo tipo
  - anio1 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - anio2 (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes1: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - mes2: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=300: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 300. La respuesta trae total y next_offset. Ej: 300
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_rentas_vitalicias
- title: Estadísticas de Rentas Vitalicias
- description: Devuelve estadísticas del mercado de rentas vitalicias previsionales por compañía (grid oficial de la CMF): comisiones de intermediación (com_int_rvp), primas únicas (pri_uni_rvp) y tasas de interés promedio (tas_int_med_rvp). Fije el rango desde/hasta en YYYY-MM-DD (default: año actual completo) y pagine con offset/limit. Use esta tool para estadísticas RVP por compañía; para estadísticas agregadas del sistema SCOMP use cmf_seguros_scomp. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - codigo (REQUERIDO) enum=[com_int_rvp|pri_uni_rvp|tas_int_med_rvp]: Estadística: com_int_rvp=comisiones de intermediación, pri_uni_rvp=primas únicas, tas_int_med_rvp=tasas de interés promedio
  - desde: Inicio del rango en YYYY-MM-DD (default 01-01 del año actual)
  - hasta: Fin del rango en YYYY-MM-DD (default 31-12 del año actual)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_scomp
- title: Estadísticas SCOMP
- description: Devuelve las estadísticas del SCOMP (Sistema de Consultas y Ofertas del Mercado de Pensiones) publicadas por la CMF. Elija el informe (solicitudes=inf1, certificados emitidos=inf22, aceptaciones según vía=inf28), el rango desde/hasta en YYYY-MM-DD y la granularidad (D=día, M=mes, A=año). Use esta tool para el mercado de pensiones a nivel sistema; para estadísticas por compañía use cmf_seguros_rentas_vitalicias. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - informe enum=[inf1|inf22|inf28]: Informe: inf1=solicitudes de oferta ingresadas, inf22=certificados de ofertas emitidos, inf28=aceptaciones según vía de ingreso (default inf1)
  - desde (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - granularidad enum=[D|M|A]: Granularidad: D=día, M=mes, A=año (default D)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_clasificacion_riesgo
- title: Clasificación de riesgo de seguros (RGCRI)
- description: Devuelve la clasificación de riesgo de las compañías de seguros (RGCRI) publicada por la CMF, con las reseñas de las clasificadoras por período. Filtre por anio en AAAA y mes en MM (opcional; default 12). Use esta tool para evaluar la solvencia de aseguradoras; para sus estados financieros use cmf_seguros_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes en formato MM (01-12; acepta 3 o '03'). Ej: 03
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_satra
- title: Transacciones Art. 12 Ley 18.045
- description: Devuelve las transacciones de compañías de seguros informadas conforme al artículo 12 de la Ley 18.045 (Ley de Mercado de Valores), publicadas por la CMF, filtrables por sociedad (RUT) y rango de fechas. Fije desde/hasta en YYYY-MM-DD y soc opcional (RUT sin DV; omitir = todas). Use esta tool para transacciones del mercado de seguros; para los estados financieros de aseguradoras use cmf_seguros_eeff. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - soc: RUT de la sociedad (sin DV; omitir = todas)
  - desde (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_siniestros
- title: Siniestros detectados no reportados
- description: Devuelve los siniestros detectados por la CMF que no fueron reportados por las compañías de seguros dentro del plazo, por año. Fije anio en AAAA y pagine con offset/limit. Use esta tool para fiscalización de aseguradoras; para el cumplimiento normativo general use cmf_seguros_cumplimiento. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - anio: Año del listado en AAAA (default año actual)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_cumplimiento
- title: Cumplimiento de normativa de seguros
- description: Devuelve el estado de cumplimiento de la normativa por compañías de seguros de la CMF (sistema sv_cumplimientos, XLSX oficial), con hasta 200 filas. Fije anio en AAAA, mes opcional en MM (default 12) y tipoentidad (CSVID=seguros de vida, default; CSGEN=seguros generales; R=reaseguradoras). Use esta tool para supervisar cumplimiento; para siniestros no reportados use cmf_seguros_siniestros. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - anio (REQUERIDO): Año en formato AAAA (acepta 2026 o '2026'). Ej: 2025
  - mes: Mes final en MM (default 12)
  - tipoentidad: Tipo de entidad: CSVID=seguros de vida (default), CSGEN=seguros generales, R=reaseguradoras
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_inversiones_vida
- title: Cartera de inversiones de seguros (C.1835)
- description: Devuelve la cartera de inversiones de compañías de seguros de la CMF (Circular 1835). Sin peri: devuelve los períodos disponibles (JSON oficial). Con peri (AAAAMM): descarga el ZIP oficial del período y devuelve sus entradas (un TXT de ancho fijo por compañía y tipo de inversión) con tamaño y primeras líneas de cada una (el detalle completo se sirve como base64 del ZIP en zip_base64 si max_entradas no lo limita). Filtre por tipoentidad (CSVID=seguros de vida, CSGEN=seguros generales). Use esta tool para ver en qué invierten las aseguradoras; para la cartera de fondos mutuos use cmf_fondos_mutuos_cartera.
- parámetros:
  - tipoentidad enum=[CSVID|CSGEN]: Tipo de entidad: CSVID=seguros de vida (default), CSGEN=seguros generales
  - peri: Período AAAAMM (ej: 202512); sin él, la tool lista los períodos disponibles
  - max_entradas default=10: Cuántas entradas describir. Sin máximo. Por defecto 10
  - incluir_zip default=false: true = incluye el ZIP completo en base64 (zip_base64; puede ser ~16MB)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_produccion_corredores
- title: Producción de corredores de seguros
- description: Devuelve la producción de corredores de seguros publicada por la CMF (sistema ISPRO) para un período AAAAMM: descarga el ZIP oficial y parsea los archivos de ancho fijo (identifi=catálogo de corredores, prodramo=producción por ramo, intercia=producción por compañía). Fije peri en AAAAMM (ej: 202512; los períodos disponibles van del año 2017 al actual, corte diciembre) y elija sección. Use esta tool para la intermediación del mercado de seguros; para la cartera de las compañías use cmf_seguros_inversiones_vida. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - peri (REQUERIDO): Período AAAAMM (ej: 202512)
  - seccion enum=[identifi|prodramo|intercia]: Sección: identifi=catálogo de corredores (default), prodramo=producción por ramo, intercia=producción por compañía
  - texto: Se queda con las filas donde algún campo contiene este texto (código del corredor, RUT o nombre de la compañía). El ZIP de la CMF trae el mes entero; el filtro es del servidor
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_seguros_sic
- title: Estadísticas Conoce tu seguro (SIC)
- description: Devuelve las estadísticas del sistema 'Conoce tu seguro' (SIC) de la CMF: consultas de usuarios sobre pólizas de seguros en un rango de fechas, con hasta 200 filas. Requiere desde y hasta en YYYY-MM-DD (acepta DD/MM/AAAA). Use esta tool para la demanda de información del mercado de seguros; para el registro de pólizas depositadas use cmf_seguros_deposito_polizas. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - desde (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta (REQUERIDO): Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
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
- description: Navega la estructura de una taxonomía XBRL de la CMF: etiquetas y conceptos según taxonomía y fecha de versión. Requiere taxonomia (cl-ci, cl-cc, cl-bs, cl-ei, cl-hb o cl-hs) y fecha de versión en YYYY-MM-DD (ej: 2021-01-04). Use esta tool para explorar el detalle de una taxonomía; para listar las disponibles use cmf_xbrl_taxonomias. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - taxonomia (REQUERIDO) enum=[cl-ci|cl-cc|cl-bs|cl-ei|cl-hb|cl-hs]: Taxonomía a navegar: cl-ci, cl-cc, cl-bs, cl-ei, cl-hb o cl-hs
  - fecha (REQUERIDO): Fecha de versión (ej: 2021-01-04)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
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
- description: Descarga un documento firmado de la CMF (PDF/XLS/XLSX) usando su token s567 (el token viaja en la URL de la CMF; se devuelve en la salida solo como eco del input). El binario vuelve en base64 por TRAMOS, nunca recortado sin salida: max_chars es el tamaño del tramo (default 200000 caracteres, unos 150 KB) y offset_chars dónde empieza; la respuesta trae total_chars y siguiente_offset_chars para pedir el resto, o suba max_chars para traerlo entero. Use esta tool para obtener el archivo original; para leer un PDF como texto use cmf_documento_markdown, que es lo que un modelo necesita.
- parámetros:
  - s567 (REQUERIDO): Token del documento (de hechos/sanciones/resoluciones)
  - offset_chars default=0: Carácter del base64 donde empieza el tramo (default 0)
  - max_chars default=200000: Tamaño del tramo de base64 en caracteres (default 200000, unos 150 KB de archivo). Sin máximo: un número grande trae el archivo entero. En modo código pídalo entero, porque se queda dentro del programa.
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {s567, tamano, tamano_kb, contentType, base64}

### cmf_documento_markdown
- title: Convertir documento PDF de la CMF a Markdown
- description: Descarga un documento firmado de la CMF (EEFF, hechos, sanciones, resoluciones, normas) y lo convierte a Markdown legible para el agente (tablas, encabezados, listas) usando pdf-inspector; los PDFs escaneados se indican porque no hay OCR. La conversión a Markdown es una aproximación: sin OCR, con tablas que pueden fusionar conceptos o correr cifras de columna. Si el modelo tiene visión, lo más fiable es descargar el PDF y leer sus páginas como imagen, usando el Markdown solo para ubicar la página. Acepte el documento con token (s567 de hechos/sanciones/resoluciones) o url (URL absoluta de la CMF). El documento se entrega PAGINADO, nunca recortado sin salida: max_chars es el tamaño del tramo (default 30000) y offset_chars el punto donde empieza; si queda más, la respuesta dice con qué offset_chars pedir el tramo siguiente, así que cualquier documento se puede leer entero. Use esta tool para leer el contenido de un PDF; para el binario original use cmf_documento_descargar y para inspeccionar solo un token cmf_documento_info.
- parámetros:
  - token: Token s567 del documento (de hechos/sanciones/resoluciones)
  - url: URL absoluta de un documento de la CMF (ej: ver_archivo.php del compendio)
  - max_chars default=30000: Tamaño del tramo en caracteres. Sin máximo: pide el documento entero de una vez con un número grande y el servidor lo entrega completo. Por defecto 30000, que es lo prudente cuando el texto entra al contexto del modelo; en modo código el texto se queda dentro de tu programa, así que pídelo entero. Ej: 1000000
  - offset_chars default=0: Carácter donde empieza el tramo; use el que indique la respuesta anterior para seguir leyendo
  - validar_contable default=false: true = verifica la cuadratura contable (experimental)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {pdf_type, tamano_kb, markdown, markdown_truncado, escaneado, fuente}

### cmf_seguros_deposito_polizas
- title: Registro de Depósito de Pólizas (seguros)
- description: Busca en el Registro de Depósito de Pólizas de la CMF (mercado de seguros): pólizas y cláusulas depositadas por compañías de seguros, con código, fecha de depósito, aseguradora, texto depositado, temas y norma (NCG 124/349). Sin filtros devuelve el registro completo (~7.000 pólizas) — use filtros o paginación. Con exportar=true descarga el exportador XLSX oficial de la base. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - poliza: Código de póliza (ej: POL107024)
  - desde: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - hasta: Fecha en formato YYYY-MM-DD (acepta también DD/MM/AAAA). Ej: 2026-01-31
  - norma enum=[124|349|ALL]: NCG 124 o 349; ALL=ambas
  - tema: Tema (ej: 301=Accidentes Personales, 109=Agrícola, 205=APV, 208=APVC)
  - texto: Texto depositado (búsqueda parcial)
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
  - exportar default=false: true = usa el exportador XLSX de toda la base (grande)
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {total, next_offset, polizas, filas, exportador}

### cmf_seguros_polizas_resoluciones_prohibidas
- title: Resoluciones que prohíben depósito de pólizas
- description: Devuelve las resoluciones de la CMF que prohíben a una aseguradora depositar pólizas (registro desde abril de 2009), con número, fecha, póliza afectada, materia y archivo. Sin filtros; use offset/limit para paginar. Use esta tool para saber qué aseguradoras tienen restringido el depósito; para buscar pólizas depositadas use cmf_seguros_deposito_polizas. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - texto: Se queda con las filas donde algún campo contiene este texto (sin acentos ni mayúsculas importa). Ej: 'Parque Arauco'
  - offset default=0: Desplazamiento para paginación
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites. Por defecto 100. La respuesta trae total y next_offset para pedir el resto. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {total, next_offset, resoluciones}

### cmf_bancos_tasas
- title: Tasa máxima convencional y tasa de interés corriente
- description: Devuelve la tasa de interés corriente (tip) y la tasa máxima convencional (tmc) que la CMF publica para cada segmento de operaciones de crédito de dinero (13 segmentos. no reajustables en moneda nacional por plazo y monto, reajustables, y en moneda extranjera), vigentes a una fecha, con la fecha de publicación en el Diario Oficial y hasta cuándo rigen. Son tasas anuales, en porcentaje. Las notas al pie dicen qué tasa rige para el artículo 16 de la Ley 18.010. Fuente. el sitio estadístico BEST de la CMF (best.cmfchile.cl/datos/tasas), que reemplazó al servlet InfoFinanciera; el histórico llega al menos hasta 2015. Fije fecha en YYYY-MM-DD (default hoy en Chile). Use esta tool para la TMC y el interés corriente; para reportes contables de un banco use cmf_bancos_reportes. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - fecha: Fecha a la que rigen las tasas, en YYYY-MM-DD (default hoy en Chile). Ej: 2026-09-01
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_bancos_reportes
- title: Reportes de instituciones financieras (BaseDato)
- description: Devuelve reportes del sistema BaseDato de instituciones financieras de la CMF (ex SBIF, host datosbanco.cmfchile.cl): MR1=información contable mensual (default), ADC=adecuación de capital, ADC2=adecuación de capital (v2), HEC=hechos económicos y MB1. Fije codUnicoBank (código SBIF, ej: 001; vea cmf://bancos/codigos), reporte, indice (default 30.1) y período (periodo_inicial AAAA-MM, default período actual; solo se usan mes y año). La salida trae hasta 200 filas; si la CMF devuelve el challenge anti-bot en vez de tablas, la tool lo indica. Use esta tool para reportes históricos de la banca; para tasas de interés use cmf_bancos_tasas. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - reporte enum=[MR1|MB1|ADC|ADC2|HEC]: Código del reporte: MR1=información contable mensual (default), ADC=adecuación de capital, ADC2=adecuación (v2), HEC=hechos económicos, MB1
  - indice default="30.1": Índice del reporte (default 30.1)
  - codUnicoBank: Código SBIF de la institución (ej: 001=Banco de Chile; default 001)
  - periodo_inicial: Período en AAAA-MM (ej: 2026-06; default período actual)
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
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
- description: Descarga los documentos de una empresa (EEFF por período; hechos, sanciones, resoluciones, memoria por año) y los devuelve como ZIP con directorio lógico, nombres normalizados y manifiesto.json. El base64 del ZIP viaja por TRAMOS (max_chars, default 200000 caracteres, y offset_chars; la respuesta trae total_chars y siguiente_offset_chars), y el ZIP se arma igual en cada llamada, así que los tramos se pueden pegar; con incluir_archivos_base64=true cada archivo suelto trae además su base64 (hasta 4MB cada uno). Parámetros clave: rut (ej: 61808000), anio_inicio/anio_fin (máx 2 años por llamada), periodos AAAAMM explícitos (máx 3) o los 3 más recientes del rango, secciones (eeff|hechos|sanciones|resoluciones|memoria), tipo C/I, norma IFRS/NCH, y límites max_documentos (1-24) y max_mb (1-50). Use esta tool para bajar los bytes del plan de cmf_empresa_paquete; los tokens firmados se gestionan en el servidor y nunca se exponen.
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
  - incluir_archivos_base64 default=false: true = cada archivo suelto trae además su base64 (hasta 4 MB cada uno; la respuesta crece mucho). Default false: los archivos viajan solo dentro del ZIP
  - offset_chars default=0: Carácter del base64 donde empieza el tramo (default 0)
  - max_chars default=200000: Tamaño del tramo de base64 en caracteres (default 200000, unos 150 KB de archivo). Sin máximo: un número grande trae el archivo entero. En modo código pídalo entero, porque se queda dentro del programa.
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

### cmf_codigos
- title: Catálogos de códigos (bancos, seguros, circular 1333)
- description: Devuelve los catálogos de códigos que otras tools piden como parámetro. catalogo=bancos entrega el código SBIF de cada institución financiera (el parámetro institucion de las tools cmf_api_* y codUnicoBank de cmf_bancos_reportes; 999 = sistema total), verificado contra la API oficial. catalogo=seguros entrega las compañías de seguros generales y de vida con su RUT sin dígito verificador, que es lo que pide sociedades en cmf_seguros_eeff, leído en vivo de los formularios de la CMF. catalogo=cartera_fondos_mutuos explica cada columna ffm_60xxxxx de cmf_fondos_mutuos_cartera con el nombre, el detalle, la unidad y los valores posibles de la Circular 1.333 de 1997. Filtre con texto (se aplica en el servidor, sobre cualquier campo). Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - catalogo (REQUERIDO): Qué catálogo. bancos (código SBIF → institución), seguros (RUT → compañía, con segmento generales o vida) o cartera_fondos_mutuos (columna ffm_ → variable de la Circular 1.333)
  - texto: Se queda con las filas donde algún campo contiene este texto, por ejemplo el nombre de un banco, el RUT de una aseguradora o el nombre de una columna ffm_. Se aplica en el servidor
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_best_buscar
- title: Buscar cuadros en BEST, el sitio estadístico de la CMF
- description: Busca cuadros de datos en BEST, el sitio estadístico de la CMF (best.cmfchile.cl), con el mismo buscador que usa el sitio. BEST tiene 5.180 cuadros y 34.023 series sobre bancos, cooperativas, emisores de tarjetas, mutuarias hipotecarias, administradoras de fondos y tasas de interés, en 9 categorías. riesgo, actividad, red de atención, cuentas y medios de pago, clientes, tasas de interés, desempeño, género y regional. Escriba la pregunta en lenguaje natural con consulta (ej: 'colocaciones de vivienda por banco', 'cajeros automáticos por región', 'tasa de depósitos a plazo') y reciba hasta 1000 cuadros ordenados por relevancia, cada uno con su tag, nombre, entidad, categoría, frecuencia, unidad de medida y profundidad histórica. Acote con texto (entidad, categoría o palabra del nombre) y con offset y limit. Con el tag pida los datos a cmf_best_cuadro. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - consulta (REQUERIDO): Qué busca, en lenguaje natural. Ej: colocaciones de vivienda por banco
  - texto: Se queda con los resultados donde algún campo contiene este texto, por ejemplo la entidad 'Cooperativas' o la categoría 'Riesgo'. Se aplica en el servidor
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=50: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 50. La respuesta trae total y next_offset. Ej: 50
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_best_cuadro
- title: Datos de un cuadro de BEST
- description: Devuelve los datos de un cuadro de BEST, el sitio estadístico de la CMF, con una fila por fecha y serie (fecha, código de la serie, descripción y valor), más la unidad, el rezago, la fecha de actualización y las notas del cuadro. Identifique el cuadro con tag (lo entrega cmf_best_buscar; ej: SBIF_CONT_EPLME_ACTIV_COL_TOT_CART). Elija el tramo con modo. ultimos (default; los últimos periodos periodos, default 12), rango (desde y hasta en YYYY-MM-DD, sin tope de meses) o completo (toda la historia; un cuadro grande trae decenas de miles de filas, pida por tramos). Use serie para quedarse con una serie por su código o parte de su descripción. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - tag (REQUERIDO): Tag del cuadro, como lo entrega cmf_best_buscar. Ej: SBIF_CONT_EPLME_ACTIV_COL_TOT_CART
  - modo default="ultimos": ultimos (default), rango (desde y hasta) o completo (toda la historia)
  - periodos default=12: Cuántos periodos traer en modo ultimos (default 12)
  - desde: Inicio del rango en YYYY-MM-DD (modo rango)
  - hasta: Fin del rango en YYYY-MM-DD (modo rango; default hoy)
  - serie: Se queda con las filas cuya serie contiene este texto, en el código o en la descripción. Se aplica en el servidor
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=200: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 200. La respuesta trae total y next_offset. Ej: 200
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

### cmf_bancos_cronologia
- title: Cronología bancaria de Chile
- description: Devuelve la Cronología Bancaria de la CMF (ex SBIF). la historia de cada banco e institución financiera de Chile desde 1743, con sus hitos, predecesores, sucesores y documentos. Elija la vista con consulta. instituciones (las que empiezan con letra, con su id), institucion (la línea de tiempo de un id, fecha por fecha), anio (todos los hitos de un año), evento (el texto completo de un hito por su evento_id, con los documentos enlazados) y relacionadas (predecesores y sucesores de un id). El flujo típico es instituciones → institucion → evento. Los ids salen de las propias respuestas; el de ABN AMRO Bank (Chile) es 7500000000000178. Las filas vienen paginadas. usa offset y limit para recorrerlas todas, porque la respuesta trae total y next_offset.
- parámetros:
  - consulta default="instituciones": instituciones (por letra), institucion (línea de tiempo por id), anio (hitos de un año), evento (texto de un hito por evento_id) o relacionadas (predecesores y sucesores por id)
  - letra: Para instituciones. la letra inicial del nombre (default A)
  - id: Para institucion y relacionadas. el id de la institución
  - anio: Para anio. el año en AAAA
  - evento_id: Para evento. el evento_id del hito
  - texto: Se queda con las filas donde algún campo contiene este texto, por ejemplo parte del nombre de un banco. Se aplica en el servidor
  - offset default=0: Fila desde la que empezar. Pásale el next_offset de la respuesta anterior. Ej: 0
  - limit default=100: Cuántas filas devolver. Sin máximo: pide todas las que necesites y el servidor entrega lo que la fuente tenga. Por defecto 100. La respuesta trae total y next_offset. Ej: 100
- annotations: {"readOnlyHint":true,"destructiveHint":false}
- outputSchema: {filas}

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
- cmf://fondos-mutuos/tipos: Significado de los 8 códigos de tipo de fondo mutuo de la CMF y en qué unidad vienen las cifras de cada informe. Use estos códigos en el parámetro tipo de cmf_fondos_mutuos_catalogo y en tipo_fondo de cmf_fondos_mutuos_comisiones.
- cmf://bancos/codigos: Mapa código SBIF → institución financiera, verificado contra la API oficial v3 de la CMF. Use estos códigos en institucion para las tools cmf_api_* y en codUnicoBank de cmf_bancos_reportes. La tool cmf_codigos entrega lo mismo con filtro y paginación.
- cmf://seguros/codigos: Compañías de seguros generales y de vida con su RUT sin dígito verificador, leídas de los formularios de EEFF de la CMF. Es el valor que pide sociedades en cmf_seguros_eeff. La tool cmf_codigos entrega lo mismo con filtro y paginación.
- cmf://fondos-mutuos/cartera-codigos: Qué significa cada columna ffm_60xxxxx de cmf_fondos_mutuos_cartera, según la Circular 1.333 de 1997. nombre, detalle, unidad y valores posibles. La tool cmf_codigos entrega lo mismo con filtro y paginación.

> Nota: este catálogo se genera con argumentos de ejemplo para los prompts (npx tsx test/dump-catalogo.ts). Los placeholders reales son los argsSchema de cada prompt.
