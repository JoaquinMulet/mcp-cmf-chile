# mcp-cmf-chile — CLAUDE.md

> ⚠️ **LEE ESTE ARCHIVO COMPLETO ANTES DE ACTUAR.** Crece con cada sesión (efecto compounding)
> y puede exceder el límite de una sola lectura. **Si tu Read se trunca, continúa con `offset=`
> hasta el final.** No respondas ni actúes desde una página parcial.

Guía operativa del repo. Describe el estado ACTUAL del sistema, no su historia.

**Estándar de la casa (OBLIGATORIO).** Este proyecto sigue la skill `desarrollo-riguroso`.
LÉELA antes de escribir o corregir código o diseñar tests. Este archivo la CONCRETA, no la
repite, y sus términos (IDENTIFY→VERIFY-REAL, preflight, oráculo duro o blando, trunk) vienen
definidos allá. Al cerrar una sesión sustantiva, corre `retrospectiva-de-sesion`.

## Qué es esto

Servidor MCP que expone los datos públicos de la Comisión para el Mercado Financiero de Chile.
Corre como Cloudflare Worker y es gratuito y sin clave, así que cualquiera puede apuntarle su
agente. Lo consumen agentes que analizan empresas chilenas, fondos y seguros.

Fuentes de datos, todas externas y ninguna bajo nuestro control.

- `www.cmfchile.cl` — el grueso. Páginas legacy en PHP que devuelven HTML, XLS o CSV
  separado por punto y coma. Sin API, sin contrato, sin versionado.
- `api.sbif.cl` — la única API oficial de verdad (v3). Indicadores económicos y balances de
  bancos. Necesita `CMF_API_KEY` en el entorno del Worker. En local no está, y las tools
  `cmf_api_*` responden un error que lo dice.
- `datosbanco.cmfchile.cl` — servlet BaseDato, reportes contables de la banca.
- `best-sbif-api.azurewebsites.net` — el servicio que alimenta `best.cmfchile.cl`, el sitio
  estadístico nuevo de la CMF. Tasas de interés corriente y máxima convencional. Pide la
  cabecera `x-apikey`; sin `CMF_BEST_KEY` se usa la clave web pública del propio sitio. Ver la
  lección 27. El servlet InfoFinanciera de `tasas.cmfchile.cl` que lo antecedía ya no entrega
  la tabla.
- `github.com/JoaquinMulet/empresas-cmf-chile` — catálogo de tickers de bolsa a RUT, que
  alimenta `cmf_empresa_por_ticker`. Es nuestro, no de la CMF.

El servidor expone 2 modos, que son 2 servidores MCP distintos armados por el mismo
`createServer` de [src/server.ts](src/server.ts).

- **clásico**, en la ruta `/mcp`. El catálogo completo de tools.
- **código**, en la ruta `/codigo`. Solo 2 tools, y el modelo escribe un programa que corre
  dentro de una caja aislada (binding `CAJA`, Worker Loader, sin salida a internet). Si la
  cuenta no tiene Worker Loader, `/codigo` responde 501 y `/mcp` sigue funcionando.

## Build y comandos

- build: `npm run build` (es `tsc`)
- dev local del Worker: `npm start` (es `wrangler dev`)
- test (suite completa): `npm test` (es `tsx --test test/*.test.ts`)
- correr UN archivo de test: `npx tsx --test test/parsers.test.ts`
- verificación contra la CMF REAL: `npm run verify` (es `tsx test/verify-endpoints.ts`).
  Llama todas las tools contra la fuente y valida su contrato de salida. Tarda entre 3 y 8
  minutos. **Es el único instrumento que atrapa los errores de esquema y de nombres de campo.**
- verificación de lo YA DESPLEGADO: `npm run verificar-desplegado`. Habla con la instancia
  viva, así que va DESPUÉS de `npm run deploy`, nunca antes.
- **preflight.** No hay que acordarse. Los hooks lo hacen cumplir, y se instalan una vez con
  `npm run preparar-hooks` (es `git config core.hooksPath .githooks`).
  - `.githooks/pre-commit` corre build, suite, biome y knip.
  - `.githooks/pre-push` corre build, suite, `verify-endpoints` contra la CMF real, el
    trinquete, las alertas y la bandeja de hallazgos. **Es exactamente lo que corre el CI.**
- higiene a mano: `npm run trinquete`, `npm run limpieza`, `npm run lint`, `npm run hallazgos`,
  `npm run semgrep`.

**NUNCA recortes un portón porque tarda.** Está escrito adentro de los 2 hooks y es una regla
del dueño. Si molesta, se hace más rápido, no más corto.

## Ramas y deploy

- **trunk. `master`.** Es la rama viva. Commitea y branchea desde ahí, con ramas cortas.
- deploy a producción. `npm run deploy` (es `wrangler deploy`). **Se corre SIEMPRE desde el
  trunk y desde el árbol de trabajo limpio.**
- **CRÍTICO. `wrangler deploy` empaqueta lo que hay EN EL DISCO, no el commit.** El
  `main` de [wrangler.jsonc](wrangler.jsonc) apunta a `src/worker.ts`, así que producción
  queda igual a la carpeta en la que estás parado, aunque no hayas commiteado nada.
- **NO hay despliegue automático.** `.github/workflows/` tiene `ci.yml` y `seguridad.yml`, y
  ninguno despliega. Por eso el servidor desplegado puede quedar más viejo que el repositorio,
  y ya pasó. Ver la lección 1.
- destinos. `https://mcp-cmf-chile.joaquin-mulet.workers.dev` y el dominio propio
  `cmf-mcp.kumocloud.cl`, declarado como ruta con `custom_domain` en `wrangler.jsonc`.

## Arquitectura

- `src/worker.ts` — punto de entrada del Worker. Resuelve la ruta y separa `/mcp` de `/codigo`.
- `src/index.ts` — punto de entrada STDIO, para correr el servidor como proceso local.
- `src/server.ts` — arma el servidor MCP. Decide el modo, escribe las instrucciones que lee el
  agente, y registra tools, recursos y prompts.
- `src/registro.ts` — el registro de operaciones. Quién se registra y en qué orden.
- `src/resources.ts` — los recursos `cmf://`. Plantillas y fichas estáticas.
- `src/prompts.ts` — plantillas MCP para tareas típicas.
- `src/captcha.ts` — el flujo de captcha en 2 pasadas.
- `src/sandbox.ts` — la caja aislada donde corre el código que escribe el modelo.
- `src/pdf.ts` y `src/eeff-tables.ts` — PDF a Markdown, y el arreglo de las tablas de estados
  financieros que salen partidas del PDF.
- `src/client/cmf-client.ts` — todas las llamadas salen por acá. Rate limit, timeout y caché.
- `src/client/anti-bot.ts` — resuelve el desafío anti-bot F5 de los sistemas legacy.
- `src/client/cache.ts` — caché LRU con TTL por clave.
- `src/client/parsers.ts` — **el corazón frágil.** HTML, XLS y CSV a filas. Un cambio acá es
  un cambio en decenas de tools a la vez. Cuenta cuántas antes de tocarlo, con
  `grep -rhoE "(htmlTablaAJson|xlsAJson|txtCsvAJson)\(" src/ | wc -l`.
- `src/tools/` — las operaciones, agrupadas por dominio. `empresas.ts`, `fondos-mutuos.ts`,
  `fondos-inversion.ts`, `otros.ts` (seguros, normativa, bancos), `api-oficial.ts`,
  `paquete.ts` (descargas masivas) y `code-mode.ts`.
- `src/catalogos.ts` — la ÚNICA fuente de los 3 catálogos de códigos (bancos, compañías de
  seguros, variables de la Circular 1.333). La tool `cmf_codigos` de `src/tools/catalogos.ts` y
  los recursos `cmf://bancos/codigos`, `cmf://seguros/codigos` y
  `cmf://fondos-mutuos/cartera-codigos` leen de acá. Ver la lección 28.
- `src/util/rut.ts` — `rutCanonico`, la única regla del formato de RUT. La usan `rutSchema` en
  la entrada y `conRutCanonico` en la salida de todo catálogo. Ver la lección 29.
- `src/util/tramos.ts` — paginación honesta. `paginacion()`, `toolOkPaginado` y `toolOkTabla`.
- `src/util/grid.ts` — `toolDeGrid`, el camino único de las estadísticas que la CMF sirve con
  un grid de Google Charts (EEFF e indicadores de SA, seguros e intermediarios). Lee el índice,
  envía el formulario a donde apunta y saca el grid del `<script>`. Ver la lección 16.
- `src/util/errors.ts` — el resultado estándar de una tool, y `resumirTabla`, que escribe el
  texto que de verdad lee el modelo.
- `src/util/schemas.ts` y `src/util/schemas-output.ts` — contratos de entrada y de salida.
- `herramientas/` — trinquete, oportunidades, alertas y bandeja de hallazgos.

## Invariantes de dominio y oráculo de verdad

**ORÁCULO. Duro, y es el archivo original de la CMF.** El XLS, el CSV o el HTML que sirve la
fuente es la verdad, y cualquier diferencia es un defecto nuestro. Nunca al revés. Por eso la
verificación que vale es `npm run verify`, que baja el archivo real, y no la suite, que corre
sobre fixtures.

Cuidado con una trampa del oráculo. **la fuente también trae basura, y esa basura es fiel.**
Las filas repetidas del catálogo de fondos mutuos y las notas al pie de las planillas vienen
así desde la CMF. Espejarlas al pie de la letra es tan incorrecto como corregir un dato.

Las verdades que el código NUNCA puede violar.

1. **Una tool jamás decide por el agente qué parte del dato merece verse.** Si hay que cortar,
   el corte viaja con la forma exacta de pedir el resto, y ese parámetro tiene que existir de
   verdad. Lo hace cumplir `test/sin-recortes.test.ts`, que es una comprobación de clase sobre
   el código fuente entero.
2. **El TEXTO es lo único que ve el modelo.** El `structuredContent` sirve a quien llama por
   programa. Un dato que viaja solo en el JSON, para el agente, no existe. Lo hace cumplir
   `test/texto-para-el-modelo.test.ts`.
3. **Un nombre de campo se lee del dato, nunca se escribe de memoria.** Ver la lección 2.
4. **Ninguna tool manda al modelo a leer `structuredContent`.** Es pedirle que mire donde no
   puede.
5. El enlace de un documento nunca se omite. Es el único camino del agente hacia el PDF.

## Bug-fix workflow

Los 6 pasos del estándar, con los comandos de acá.

1. **IDENTIFY.** Nombra la función y la condición que rompe, en una frase.
2. **REPLICATE con la forma de los datos REALES.** Baja el archivo de la CMF y míralo. Los
   casos borde de este dominio son mojibake, latin1, entidades HTML, CRLF, celdas vacías que no
   son cero, y tablas con o sin cabecera `<th>`.
3. **FAILING TEST.** `npx tsx --test test/<archivo>.test.ts`, y confirma que falla por la razón
   correcta. Los fixtures van en `test/fixtures/`, con HTML o XLS REAL, recortado pero con el
   marcado exacto.
4. **FIX.** Cambio mínimo, en la capa dueña del invariante.
5. **CONFIRM.** `npm test` verde, y el `pre-commit` completo.
6. **VERIFY-REAL, y acá es OBLIGATORIO.** `npm run verify`, o un script propio que llame la
   tool contra la CMF. **Nunca despliegues sin haber confrontado la fuente real.** Un servidor
   que traduce una fuente ajena no se puede validar solo con fixtures.

Para medir un antes y un después con el MISMO instrumento, `git stash push <archivo>` deja
correr la medición vieja en un minuto. Si tocas el instrumento entre las 2 tomas, la
comparación no vale.

## Testing

Los tests viven en `test/` y terminan en `.test.ts`. Todo lo demás en esa carpeta es un
script, no una prueba, y `npm test` no lo levanta.

Hay 3 clases y conviene saber cuál estás escribiendo.

- **De caso.** Ejercitan una función con un fixture. `parsers.test.ts`, `fondos-mutuos.test.ts`.
- **De clase.** Leen el código fuente entero como texto y fallan si aparece un patrón que ya
  causó daño una vez. `sin-recortes.test.ts`, `sin-codigo-muerto.test.ts`, `tdqs.test.ts`. Son
  las que atrapan el defecto que nadie ha escrito todavía.
- **Contra la fuente real.** `verify-endpoints.ts`, `verify-proto.ts`, `verify-remote.ts`. No
  son `.test.ts` a propósito, porque necesitan red.

Reglas.

- Un test tiene que fallar ANTES del arreglo, y por la razón correcta. Si pasa con y sin el
  fix, no prueba nada.
- Una comprobación de clase lleva al lado su prueba de que SÍ puede fallar, con el patrón
  exacto que prohíbe. Copia el estilo de `sin-recortes.test.ts`.
- Los fixtures son datos REALES de la CMF. Un fixture inventado hereda el mismo error de
  memoria que causó el defecto.

## Patterns to Follow

- **Toda tool que devuelve filas usa `toolOkTabla` de `src/util/tramos.ts`.** Ahí el texto se
  arma DESPUÉS de paginar, así que decir una cantidad y entregar otra es imposible por
  construcción, no por disciplina.
- **Las columnas se dejan en su valor por defecto, que son todas.** Fijar una lista a mano solo
  se hace conociendo la tabla, y aun así `resumirTabla` la descarta entera si nombra una
  columna que el dato no tiene.
- **Cada llamada a la CMF sale por `src/client/cmf-client.ts`.** Nunca `fetch` directo desde una
  tool. Ahí viven el rate limit, el timeout y el anti-bot.
- **Un error se explica y se acciona.** `toolErrorFuente` nombra la fuente que falló y su URL,
  para que el agente pueda ir a mirar.
- **La clave de la caché KV lleva versión.** Si cambia la FORMA de lo guardado, sube la versión.
  Cambiar el código no cambia lo que ya quedó guardado, y un TTL de 24 horas sirve el valor
  viejo como si nada. Ejemplo vivo, `catalogo:fm_ident_v2_sin_repetidas`.
- **Un hallazgo se arregla, se marca falso positivo o se acepta como deuda, con su razón
  escrita.** No hay cuarta opción, y `herramientas/hallazgos.mjs` bloquea el push si queda algo
  sin triar.

## Lessons Learned

**1. El servidor desplegado puede estar más viejo que el repositorio (28 de agosto de 2026).**
Qué falló. Una sesión diagnosticó como defecto de código que el boletín no aceptaba `offset`,
y el repositorio ya lo tenía arreglado hacía una semana. Causa raíz. No hay despliegue
automático, así que la deriva entre `master` y producción es lo normal, no la excepción.
Prescripción. Antes de auditar código por un defecto que ves en el servidor remoto, compara el
esquema de entrada que publica el servidor contra el que declara el repositorio. Si un
parámetro está en el código y no en la respuesta remota, la cura es `npm run deploy`.

**2. Un nombre de campo escrito de memoria falla en silencio (28 de agosto de 2026).**
Qué falló. El filtro del catálogo comparaba `tipo_fondo` y el dato trae `tipo_de_fondo_mutuo`,
así que devolvía 0 fondos para cualquier tipo. Y la lista de columnas del boletín nombraba
`Run Fondo` y `Patrimonio` cuando el dato trae `col_0` y `Patrimonio (1)`, así que 4 de 6
columnas del texto salían vacías. Causa raíz. `String(f[c] ?? "")` trata igual «la columna no
existe» y «la columna está vacía». Prescripción. El nombre se saca de una llamada real o de un
fixture, jamás de la cabeza. Y ya no se puede hacer daño. `resumirTabla` descarta la lista
entera cuando nombra un campo inexistente y entrega las columnas reales.

**3. Las planillas de la CMF traen sus notas al pie como filas de datos (28 de agosto de
2026).** Qué falló. El boletín del sistema completo devolvía 23 filas y 14 eran notas, o sea
más de la mitad. El total mentía y quien sumaba la columna de patrimonio sumaba texto. Causa
raíz. La fuente las manda dentro de la tabla, y el parser no tiene por qué saberlo.
Prescripción. Las 5 planillas de fondos mutuos pasan por `separarNotas` de
`src/client/parsers.ts`. El criterio es cuántas celdas tienen valor, nunca el texto de la fila,
porque el texto cambia de planilla en planilla. Las notas no se botan. Llevan la unidad de las
cifras y el significado de los códigos, y viajan en el campo `notas` y también en el texto. Si
aparece una planilla nueva, mídela antes de suponer. La cartera y la cartola no tienen notas.

**4. Casi ninguna tabla de la CMF marca su cabecera, y por eso el parser es intocable a ciegas
(28 de agosto de 2026).** Qué falló. `htmlTablaAJson` se saltaba la cabecera `<th>` real y
usaba la primera fila de datos como nombres de columna, que además se perdía. En el reporte de
bancos las 1228 filas salían con claves como `411000000`. Causa raíz. La función buscaba la
primera fila que NO fuera cabecera, o sea justo la equivocada. Prescripción. El orden de los
nombres de columna es. lo que entrega quien llama, después el `<th>`, y recién después la
primera fila. El último paso se conserva porque casi todas las tablas de la CMF vienen sin
`<th>` y ahí la primera fila sí es la cabecera. Antes de tocar `parsers.ts`, mide el antes y el
después con `columnasVacias` de `test/verify-endpoints.ts` sobre las tools reales.

**5. El esquema que ve un cliente es una copia, y envejece aparte del servidor (28 de
agosto de 2026).** Qué falló. Una prueba externa concluyó que la paginación del boletín
seguía rota, con el servidor ya arreglado y desplegado. Su sesión tenía guardada la lista de
tools de antes, así que mandaba los argumentos con la forma vieja. Causa raíz. Un cliente MCP
guarda el esquema al conectarse y no lo vuelve a pedir. Desplegar no le llega a nadie que ya
esté conectado. Prescripción. Un informe sobre el comportamiento del servidor no se acepta sin
saber cuándo se conectó esa sesión. La forma de zanjarlo en 10 segundos es preguntarle al
servidor directo, sin pasar por ningún cliente.

```bash
curl -s -X POST https://cmf-mcp.kumocloud.cl/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

**6. Una función publicada pero inalcanzable es peor que una que falta (28 de agosto de
2026).** Qué falló. `offset` y `limit` estaban construidos, desplegados y declarados en el
esquema como `integer`, y aun así pedir `offset: "50"` devolvía «expected number, received
string». Desde afuera se lee igual que si la paginación no existiera, pero adentro no hay nada
que arreglar, así que nadie lo busca donde está. Causa raíz. Los parámetros numéricos eran los
únicos que no seguían la regla de la casa de aceptar lo que escriben personas y modelos.
Prescripción. Todo parámetro numérico de entrada sale de `enteroSchema` o `numeroSchema` de
`src/util/schemas.ts`, y `test/entradas-tolerantes.test.ts` falla si vuelve a aparecer un
`z.number()` de entrada.

**7. Un defecto puede estar tapado por otro (28 de agosto de 2026).** Qué falló. El boletín
mezclaba «Total consulta» y «Total Sistema» con las series, así que cualquier promedio o
conteo se contaminaba. Nadie lo había visto en decenas de usos. Causa raíz. Los agregados van
al final de la planilla y el corte por defecto en 50 filas los dejaba fuera, así que arreglar
la paginación fue lo que los hizo visibles. Prescripción. Después de arreglar un corte, un
filtro o un límite, vuelve a mirar el dato completo. Lo que aparece ahí lleva tiempo estando
mal, y el arreglo anterior es lo que te dejó verlo.

**8. Un fixture en miniatura no reproduce el defecto, y miente en las 2 direcciones (28 de
agosto de 2026).** Qué falló. Al arreglar el descarte de filas de `xlsAJson`, 2 fixtures
inventados me hicieron creer que el arreglo estaba mal. Uno tenía un segundo piso de cabecera
con 2 celdas, y `esHeader` exige 3. El otro usaba años pelados como nombres de columna, y un
año es un número puro, así que esa fila ni siquiera se elegía como cabecera. Causa raíz. Los
umbrales de `esHeader` dependen de la ANCHURA y del contenido de la fila, así que una tabla
achicada cae en otra rama del código. Prescripción. El fixture se copia de la planilla real,
con su número de columnas y su forma, y se recorta en FILAS, nunca en columnas. Bajar el
archivo y volcar sus primeras filas cuesta un minuto, y sin eso el test mide otro caso.

**9. Un conteo no sirve para decidir si algo se descarta bien (28 de agosto de 2026).** Qué
falló. Para medir el descarte de filas, la pregunta no era cuántas se descartan sino CUÁLES.
Un conteo no distingue una cabecera de segundo piso, que se descarta bien, de una fila de
datos, que es la pérdida. Causa raíz. El instrumento medía la magnitud de algo cuya
corrección es cualitativa. Prescripción. Cuando el criterio a evaluar es «esto es un X o un
Y», el instrumento IMPRIME los casos y los mira una persona. El patrón apareció solo al
verlos: el único segundo piso legítimo estaba a distancia 1 de la cabecera, y las 2 filas
perdidas estaban a distancia 3.

**10. El portón local corría MENOS que el CI, y por eso el rojo llegó tarde (29 de agosto de
2026).** Qué falló. Un commit pasó el `pre-push` completo y el flujo de Seguridad de GitHub lo
rechazó. CodeQL marcó `js/bad-tag-filter` de severidad alta en una expresión regular que ese
mismo commit estrenaba. Causa raíz. CodeQL corre en la nube y solo analiza lo ya empujado, así
que una alerta NUEVA es invisible antes de empujar. El `pre-push` corre `alertas.mjs --listar`,
que informa y no bloquea, y esa decisión es correcta por sí sola. una alerta refleja el último
commit analizado, así que bloquear con ella impediría empujar justamente el commit que la
arregla. Prescripción. La clase se cubre localmente con una regla propia de semgrep, que sí
entiende el código nuevo y sí bloquea el push desde la bandeja de hallazgos. Cada vez que
CodeQL encuentre una clase que el portón local no vio, la respuesta no es aceptar la demora, es
escribir la regla en `.semgrep/reglas-propias.yml` y probarla en las 2 direcciones.

**11. Un patrón con barras invertidas no se escribe por un heredoc de python (29 de agosto de
2026).** Qué falló. Al escribir esa regla de semgrep con `python - <<EOF`, el `
` del patrón
llegó al archivo como un salto de línea de verdad, y partió el YAML en 2. La regla quedó
truncada, semgrep la cargó sin error, y el portón dio verde con el defecto puesto delante.
Causa raíz. Es la regla que el `CLAUDE.md` global ya tiene escrita para LaTeX, y que aquí volví
a pisar. el heredoc de python se come una capa de escapes. Prescripción. Todo contenido con
barras invertidas se escribe con el tool Edit. Y la señal que lo delató no fue leer el archivo,
fue **probar el portón con el defecto puesto**. Un portón que no se prueba cerrando es un
portón que ya podría estar roto.

**12. Excluir del análisis es esconder, no resolver (29 de agosto de 2026).** Qué falló.
`test/investigacion` generaba 65 de las 74 alertas de seguridad y tapaba las 3 que sí
importaban, y la respuesta de su día fue excluirla de CodeQL. La carpeta siguió ahí un mes,
sin que nadie la revisara, con 48 archivos que nadie ejecutaba. Causa raíz. Una exclusión
resuelve el síntoma, que es el ruido en la lista, y deja el objeto intacto y fuera de vista.
Prescripción. Cuando la razón para excluir algo es «no se despliega y no se va a arreglar», lo
que corresponde es borrarlo. Con la carpeta fuera, la exclusión sobra y el análisis vuelve a
cubrir todo. Lo vigila `test/exclusiones-vivas.test.ts`, que se pone rojo si una exclusión
apunta a una carpeta que ya no existe, porque esa puerta abierta deja que alguien cree otra con
ese nombre y nadie la revise.

**13. Una exclusión que parece muerta puede ser un rodeo legítimo. Mídela antes de quitarla (29
de agosto de 2026).** Qué falló. `knip.json` ignoraba `cloudflare` y `yauzl`, y ninguna de las
2 estaba en `package.json`. Parecían las 2 restos viejos. Causa raíz. `cloudflare:workers` es
un módulo del runtime de Workers y knip lee el prefijo como si fuera un paquete sin declarar,
así que esa línea es la cura de un falso positivo, no basura. Prescripción. Quitar la exclusión
y CORRER la herramienta antes de dar por muerta ninguna. Al quitarla, knip pasó a reportar
«Unlisted dependencies (1) cloudflare». La razón queda escrita acá porque `knip.json` es JSON y
no admite comentarios.

**14. Un cambio de versión del motor de PDF pasa verde en la CI y cambia las cifras que el
servidor entrega (2 de septiembre de 2026).** Qué falló. Dependabot subió pdf-inspector de
1.15.0 a 1.17.0 con toda la CI en verde y la interfaz del módulo idéntica. Sobre el mismo PDF
de Copec 2026-03, las filas separadas por `eeff-tables` pasaron de 181 a 107 y las fusionadas
pendientes de 55 a 7. Ninguna de las 2 versiones cuadró el balance. Causa raíz. La CI prueba
que la conversión devuelve texto, no qué texto. Y `eeff-tables` está calibrado al orden en que
una versión concreta del motor entrega los períodos. Prescripción. Antes de aceptar un cambio
de versión del motor, instala las 2 versiones en la carpeta de borradores, corre `processPdf`
sobre un estado financiero real y pasa los 2 Markdown por `procesarTablasEEFF`. Compara filas
separadas, fusionadas pendientes y cuadratura. Y la regla del dueño que salió de acá. **una tool
que transforma una fuente le declara al modelo qué pierde en la transformación**, y le ofrece
el camino más fiable, que para un modelo con visión es leer el PDF como imagen. El texto vive
en `notaLimitacionesPdf` y `RESUMEN_LIMITACIONES_PDF` de `src/pdf.ts`, y
`test/limitaciones-pdf.test.ts` falla si una tool convierte un PDF sin entregarlo.

**15. Un push que termina en 0 no es una CI verde (2 de septiembre de 2026).** Qué falló.
Acepté 2 PR, empujé 2 commits, desplegué y declaré todo terminado. Los 3 flujos de Seguridad
de esos commits estaban en rojo en GitHub, y lo vio el dueño en su correo, no yo. Causa raíz.
Doble. Primero, `npm audit` corre solo en la nube y una vulnerabilidad publicada después del
último commit es invisible para el `pre-push`. Segundo, yo leí el código de salida del push
como si fuera el veredicto del remoto, y el push solo dice que el commit llegó. Prescripción.
El `pre-push` corre ahora el mismo `npm audit --omit=dev --audit-level=high` que la CI. Y
`npm run deploy` lleva un `predeploy` que es `herramientas/ci-remoto.mjs`: espera los flujos de
GitHub del commit actual y se niega a desplegar si alguno está rojo o si el commit no se
empujó. **Después de aceptar un PR o de empujar, el trabajo no está terminado hasta leer la
conclusión de la CI remota**, con `gh run list --commit <sha>` o con `npm run ci-remoto`. Y la
clase la vigila `test/porton-local-igual-ci.test.ts`: lee los flujos de `.github/workflows`
con el parser YAML real y falla si algún comando de la CI no está en un hook ni en un script
local, y falla si `deploy` pierde su `predeploy`. Con el hook viejo se puso roja por las 2
razones exactas antes de aplicar el arreglo.

**16. Un POST a la página índice devuelve el índice, y el parser lo entrega como dato (2 de
septiembre de 2026).** Qué falló. 7 tools de EEFF e indicadores (`cmf_seguros_eeff`,
`cmf_eeff_ifrs_sa`, `cmf_indicadores_financieros_sa`, `cmf_empresa_eeff_nch`,
`cmf_indicadores_financieros_nch`, `cmf_intermediarios_eeff_ifrs`,
`cmf_intermediarios_indicadores_ifrs`) devolvían filas como «Crear cartera de sociedades» y
«Limpiar búsqueda», con total mayor que cero y sin error. Causa raíz. Triple. El formulario
`f1` de cada `..._index.php` apunta con su `action` a OTRA página (`sa_eeff_ifrs2grid.php`,
`seg_gen_fecu1.php`, `sa_fecu1grid.php`, `intermediarios_ifrs1.php`) y a veces con un token
en la query (`control=Berlin36`, sin el cual el grid viene vacío); las tools enviaban el POST
al índice. Además los datos de esas páginas NO viajan en una `<table>`, van en un literal
JavaScript `var dataAsJson = {cols, rows}` dentro de un `<script>`, con claves sin comillas y
números como `-.9771` que JSON rechaza. Y `htmlTablaAJson` no distingue una tabla de datos de
la tabla de adorno del formulario. Prescripción. Las 7 pasan por `toolDeGrid` de
`src/util/grid.ts`, que usa `enviarFormularioLegacy` (lee el índice, cacheado, y envía a
donde apunta `f1`) y `gridDataAsJsonAJson` (tokenizador propio, nunca un `replace` global).
Cuando la página no trae el grid, la respuesta es `toolErrorFuente`, que es distinto de «sin
resultados». Lo vigila `test/grid-formulario.test.ts`, con una comprobación de clase que
prohíbe cualquier `postLegacy` a una ruta `_index.php`. Verificado contra la CMF real. la
escala de los grids IFRS de SA no está declarada en la página, y el total de activos de Copec
a 12/2024 sale 28.481.540.000 con Moneda DOLAR, o sea unidades, no miles; esa nota viaja en
`NOTA_ESCALA_IFRS_SA`. Seguros, NCH e intermediarios sí declaran «Cifras en miles de pesos» y
esa frase viaja en `notas`. Para leer el formulario real de una página de la CMF.
`getLegacy` del índice y buscar `<form name="f1"` con su `action` y sus `<select>`; los
campos `tipo_estado[]` del grid IFRS son obligatorios o el grid trae solo la cabecera.

**17. Un cero sin causa es un defecto hasta que la fuente diga lo contrario (2 de septiembre de
2026).** Qué falló. 8 tools devolvían 0 filas donde sí hay datos, cada una por una razón
distinta, y ninguna lo decía. Causas, una por tool, todas leídas de la página real de la CMF.
`cmf_dividendos` y `cmf_fondos_inversion_eeff_ifrs` buscaban el grid en el formato
`arrayToDataTable` y la CMF lo sirve como `dataAsJson`. `cmf_empresa_juntas` enviaba
`tipo_junta` y `tipo_documento` vacíos, y la ficha exige O/E y A, o R para reforma (los códigos
están en los enlaces de las pestañas 78, 79 y 80). `cmf_operaciones_capital` enviaba
`sociedad[]=0` y la opción «Todas» de esas páginas vale `""`. `cmf_empresa_sanciones` solo
cubre la ficha de emisores de valores, y las multas a bancos salen en
`sanciones_mercados_entidad.php` bajo mercado O, no B. `cmf_bancos_cronologia` y
`cmf_bancos_tasas` leían servlets de la ex SBIF que ya no entregan la tabla (la cronología
migró a cronologiabancaria.cmfchile.cl y devuelve la carcasa del portal; las tasas viven en
el sitio nuevo BEST, best.cmfchile.cl, cuya API sí existe y se lee desde el 3 de septiembre
de 2026, ver la lección 27).
`cmf_fondos_inversion_comisiones_maximas` leía una página que solo trae el formulario; el
dato se genera como planilla Excel en `..._commax_excel.php`, y la CMF respondió «Sin
Información» para todos los períodos probados de 2023 a 2025. Y `cmf_dividendos` tiene una
cobertura que nadie había medido. el formulario ofrece 176 sociedades, casi todas
concesionarias y sanitarias, y Copec no está. Prescripción. Un total en cero se explica o se
convierte en error. `toolDeGrid` distingue «la página no trae el grid» (error de fuente) de
«la CMF dice que no hay datos» (`sinDatosSi`), y las 2 tools de servlets muertos responden
`toolErrorFuente` con la página nueva. La cobertura real de una fuente va en la descripción
de la tool con su fecha de verificación. Y antes de declarar un cero como ausencia, la prueba
es la del reporte de pruebas del MCP. buscar el mismo dato por otra tool (el hecho esencial
del dividendo de Copec existía mientras `cmf_dividendos` decía que no hubo dividendos en 2025).

**18. El enlace puede vivir en el onClick y no en el href (2 de septiembre de 2026).** Qué
falló. Las actas de junta salían con `url: "#"`, porque la ficha abre el PDF con
`onClick="ventana('/sitio/aplic/serdoc/ver_sgd.php?...')"`. Prescripción.
`celdasDeUnaFila` de `src/client/parsers.ts` toma el enlace del `ventana(...)` cuando el
`href` es `#` o está vacío. Es un arreglo de clase. vale para toda tabla de la CMF.

**19. Una revisión adversarial de contexto fresco encuentra lo que el autor no ve (2 de
septiembre de 2026).** Qué falló. El arreglo de la lección 16 pasó suite, trinquete y
verificación real, y un revisor fresco encontró 6 defectos con prueba. una página 5xx del
índice quedaba cacheada 15 minutos y dejaba la tool muerta, los escapes `á` salían como
«u00e1», el cierre del literal dependía de una cadena exacta, `porEntidad` fabricaba campos
« (2)» con los separadores, una etiqueta llamada «entidad» pisaba el campo reservado, y un
`action` con `&amp;` mandaba el token como clave `amp;control`. Prescripción. `getLegacy`
solo cachea respuestas `ok`, el tokenizador traduce `\u`, `\x` y `\r`, el fin del literal se
encuentra balanceando llaves, y los nombres reservados nacen ocupados en `claveUnica`. Todo
está en `test/grid-formulario.test.ts`. La regla del estándar se confirma. antes de integrar
un lote al trunk, un escéptico que lea SOLO el diff.

**20. Una tool que ignora su parámetro principal se descubre comparando 2 entradas (2 de
septiembre de 2026).** Qué falló. `cmf_empresa_registro_productos` devolvía las mismas 471
filas para Copec y para Colbún (maíz, trigo, vino), y `cmf_liquidez_intermediarios` aceptaba
un rango de 2024 y respondía con el corte de hoy. Causa raíz. La pestaña 31 no existe en la
ficha de un emisor (la lista de pestañas está en los enlaces `pestania=N` de la propia ficha),
así que la CMF respondía una página genérica, el padrón de la Bolsa de Productos. Y el
formulario de liquidez no usa las fechas sueltas. su JavaScript arma `rango_fechas` pegando
cada día del rango como `AAAAMMDD%`, con tope de 31 días, y `sel_inter` vale TODOS, COBOL,
AGVAL o un código, nunca 0. Prescripción. La tool de productos lee la pestaña 100, «Inscripción
títulos de deuda», y arrastra el número de inscripción a cada documento. La de liquidez arma
`rango_fechas` como el JavaScript y rechaza con error los rangos de más de 31 días. Y como
regla de prueba. toda tool con un parámetro que selecciona (RUT, fecha, código) se prueba con
2 valores distintos y se compara la respuesta; si sale igual, el parámetro no llega.

**21. Un archivo entero dentro de la respuesta no cabe, y el Worker no tiene disco (2 de
septiembre de 2026).** Qué falló. Un PDF de 339 KB produjo 462.000 caracteres de base64 y
desbordó al cliente; la API oficial de resultados devolvía 308.000 caracteres sin filtro ni
paginación; el paquete de documentos se desbordaba con 1 solo PDF y el ZIP apagado, porque
cada archivo suelto viajaba además en base64. Causa raíz. Las tools de descarga trataban el
binario como un valor más del JSON, sin tramos, y la promesa «hasta 4 MB inline» era
inmanejable desde medio megabyte. Prescripción. `tramoBase64` de `src/util/binario.ts`. el
base64 se entrega por tramos con `offset_chars`, `max_chars` (default 200.000), `total_chars`
y `siguiente_offset_chars`, igual que el texto de un documento, y el TEXTO nunca lleva el
base64, solo el tamaño y cómo seguir. Los archivos sueltos del paquete solo traen base64 con
`incluir_archivos_base64=true`. Y las 3 tools de la API oficial que devolvían el JSON crudo
(`balance`, `resultados`, `accionistas`) pasan por `toolOkTabla` con `filasDeLaApi`, que
toma la primera lista del objeto sin escribir su nombre de memoria; `resultados` filtra por
prefijo de cuenta en local porque la API no lo hace, y `accionistas` aparta SUBTOTAL, OTROS y
TOTAL en `totales`. Lo vigila `test/descargas.test.ts`.

**22. Las cabeceras de la CMF vienen de 4 formas más, y en las 4 el total mentía (2 de
septiembre de 2026).** Qué falló. `cmf_sanciones_cursadas` entregaba el título de la página y
«Ir a más sanciones» como filas; `cmf_seguros_clasificacion_riesgo` entregaba «Feller-Rate,
Fitch Chile» como si fuera una compañía; `cmf_resultados_av_cb` perdía a Banchile por
prestarlo como cabecera; `cmf_empresa_info` devolvía el RUT consultado como nombre de campo;
`cmf_empresa_eeff_filiales` perdía la primera filial; `cmf_prestamos_otorgados` traía 2 filas
de cabecera y la de totales como datos; `cmf_empresa_accionistas` metía «Período: 12 / 2025»
entre los accionistas. Causa raíz, por forma. una fila de 1 celda con `colspan` es un título;
un `<thead>` con sus `<th>` sueltos y sin `<tr>` es una cabecera que el bucle de `<tr>` no
veía; una cabecera de 2 pisos hecha con `<td>`, `rowspan` y `colspan` no tiene ningún `<th>`;
una tabla de 2 columnas sin cabecera (campo y valor) presta su primera fila; y una planilla
con cabecera de 3 pisos llega del lector de XLS como 2 filas de datos. Prescripción. En
`src/client/parsers.ts`, `celdasDeUnaFila` mide `colspan` y `rowspan`, `filasDeUnTable`
descarta los títulos y lee el `<thead>` suelto, y `cabeceraDeDosPisos` arma un nombre por
columna. Las tablas de campo y valor se leen con nombres explícitos (`["campo", "valor"]`),
que es lo que evita prestar la primera fila. Y `unirCabeceraPartida` pega los pisos que el
XLS dejó como filas. Lo vigila `test/cabeceras.test.ts`. La regla de prueba. el total que
dice la tool se compara con las filas que una persona cuenta en la página; si difieren en 1
o 2, hay una cabecera o una nota contando como dato.

**23. Cuando la fuente no filtra, el servidor filtra en local y lo dice (2 de septiembre de
2026).** Qué falló. Para encontrar una sociedad entre 261 tomas de control o un fondo entre
28.971 filas de cartera había que paginar, porque la página de la CMF no tiene ningún filtro.
Prescripción. `filtrarFilas` y `filtrosLocales` de `src/util/filtros.ts`. texto (sin acentos
ni mayúsculas) y desde/hasta sobre el primer campo que parezca fecha, aplicados DESPUÉS de
bajar la tabla entera, con el total de las filas que cumplen. La descripción de cada tool
dice que el filtro es del servidor y no de la CMF, porque el costo de red es el mismo con o
sin filtro. Y el patrimonio de los fondos mutuos. la columna Moneda ya viajaba en la
planilla pero el texto no la mostraba, y sin ella sumar Patrimonio mezcla pesos con dólares;
ahora está entre las columnas visibles y la descripción lo advierte.

**24. El pre-push juzga el ÁRBOL DE TRABAJO, no el commit que empuja (2 de septiembre de
2026).** Qué falló. 3 push seguidos terminaron en «failed to push some refs» con el commit
sano. En uno el árbol tenía un archivo nuevo sin usar todavía (knip, trinquete rojo), en otro
un `import` recién quitado dejó una función sin llamadores (`sin-codigo-muerto`), y en el
tercero `verify-endpoints` llamó una tool con los argumentos viejos porque su tabla de
argumentos no se actualizó junto con el esquema. Causa raíz. Los 3 portones del hook leen el
disco, y el disco tenía trabajo a medias. Prescripción. Empujar con el árbol limpio, y cuando
cambia el esquema de entrada de una tool, cambiar en el mismo commit su fila en
`test/verify-endpoints.ts`. Y la salida del hook se lee ENTERA. filtrar el `✔` de la suite con
`grep -v` también esconde el `✖` que explica el rechazo, que fue lo que pasó 2 veces.

**25. Un ZIP que se arma en cada llamada tiene que armarse igual (2 de septiembre de 2026).**
Qué falló, y lo encontró la revisión adversarial. el base64 del paquete se entrega por tramos,
y cada tramo se pide en una llamada que vuelve a bajar los documentos y a armar el ZIP; las
descargas terminan en cualquier orden y el manifiesto llevaba la hora, así que 2 tramos
pegados venían de 2 ZIP distintos y el archivo salía corrupto con el mismo `total_chars`.
Prescripción. Las entradas del ZIP van ordenadas por ruta y el manifiesto no lleva la hora.
Regla general. todo lo que se entrega por tramos y se reconstruye por llamada tiene que ser
una función pura de la entrada. La misma revisión encontró que la regla del título con
`colspan` se comía la fila «Total» del final de una tabla (ahora solo se descarta arriba de la
tabla), que un `rowspan` en datos disparaba la cabecera de 2 pisos (ahora exige `colspan`), que
`unirCabeceraPartida` vaciaba la planilla si ninguna fila traía la clave (ahora la devuelve tal
cual), que `separarAgregados` mandaba a totales a «OTROS ACCIONISTAS MINORITARIOS» (ahora
exige el nombre exacto), que las filas de la API oficial vienen ANIDADAS y una tabla no puede
mostrar un objeto (ahora se aplanan), y que «hoy» en UTC ya es mañana a las 22:30 de Chile
(ahora se calcula en America/Santiago).

**26. Un nombre de columna arrastra lo que la celda tenía adentro (2 de septiembre de 2026).**
Qué falló. `cmf_tomas_control` entregaba «Fecha vineta» y la pestaña 42 «Fecha Fecha (orden
inverso)», porque las cabeceras ordenables traen un segundo `<a class="ordena_ascendente">`
con el texto del botón; `cmf_sanciones_cursadas` entregaba «N&ordm;» porque el decodificador
de entidades no conocía `&ordm;`; y el cuadro APV corría los valores una columna porque su
`<thead>` tiene 2 filas de `<th>` con `colspan` y solo se leía la primera. Prescripción.
`celdasDeUnaFila` quita los enlaces `ordena_ascendente`, `decodificarEntidades` conoce
`&ordm;`, `&ordf;`, `&deg;` y toda entidad numérica, `cabeceraDeDosPisos` también une 2 filas
de `<th>`, y `fixMojibake` deja «ï¿½» como un solo signo. Lo vigila `test/cabeceras.test.ts`.

**27. Un sitio «sin API visible» lleva su API en el código que le manda al navegador (3 de
septiembre de 2026).** Qué falló. `cmf_bancos_tasas` respondía que la CMF había migrado las
tasas al sitio BEST, «una aplicación Angular sin API visible», y la lección 17 lo dejó escrito
así. Nadie había abierto el código de esa aplicación. Causa raíz. Una aplicación de una sola
página no puede esconder su API. la baja el navegador. Prescripción. Bajar `main-*.js` y los
`chunk-*.js` que referencia, buscar la constante con la URL base (`API_URL_BASE`), las
llamadas `http.get(` y la cabecera que el interceptor agrega a cada petición. En BEST eso da
`https://best-sbif-api.azurewebsites.net/public/tmc/tasas/AAAAMMDD` y
`/public/tmc/notas/AAAAMMDD`, con la cabecera `x-apikey` y una clave `web-...` que viaja en el
propio bundle, o sea pública. Sin cabecera responde 401 y con la fecha con guiones responde
500. La CMF ofrece además una API oficial con clave personal (`apibest.cmfchile.cl/api/v1/...`,
se pide en `best.cmfchile.cl/api`); si el dueño consigue una, va en `CMF_BEST_KEY` y reemplaza
a la del sitio. El histórico llega al menos a 2015. Los fixtures de `test/tasas-best.test.ts`
son las 2 respuestas reales del 1 de septiembre de 2026.

**28. Un catálogo que ninguna tool entrega vive en el `<select>` del formulario que lo usa, y
si no vive en ninguna página, se verifica código por código (3 de septiembre de 2026).** Qué
falló. 3 catálogos que las tools pedían como parámetro y ninguna publicaba. Prescripción, una
por catálogo, porque las 3 fuentes son distintas. Las compañías de seguros están en el select
`sociedad[]` de `seg_gen_fecu_index.php` y `seg_vida_fecu_index.php`; el subtipo se elige con
`tiposociedad` en la URL (A, R y CR en generales, A y R en vida), el value es el RUT sin DV y
el texto trae «99.155.000-3 NOMBRE (No vigente)», así que el DV y la vigencia se separan en
sus campos. Los códigos de banco no están en ninguna página alcanzable (el índice de BaseDato
redirige a una página de error por http y el cliente rechaza http a propósito), así que se
verificaron uno por uno con `cmf_api_ficha_institucion` contra el servidor desplegado, del 001
al 075 más 504, 507, 672, 729, 732 y 999; respondieron 32 y el 999 no tiene ficha. La lista
lleva la fecha de verificación en sus notas. Y la Circular 1.333 es un PDF escaneado de 65
páginas. se pasó por OCR (`page.get_textpage_ocr` de pymupdf con el tesseract instalado, que
solo trae el modelo inglés) y las variables de los capítulos 6 y 7 se transcribieron a mano;
las columnas reales (`ffm_6010100`, y la 11.11 partida en `ffm_tir_`, `ffm_par_` y `ffm_rel_`)
se leyeron de la respuesta de `cmf_fondos_mutuos_cartera`, nunca se dedujeron del código, y
OPLA quedó sin columnas porque no tenía filas. `test/codigos.test.ts` exige que cada columna
real tenga su explicación. La regla. lo transcrito a mano lleva su fuente, su fecha y su
límite en las notas que viajan con el dato, no en un comentario del código. Y lo que encontró
la revisión adversarial de este lote. `cmf_seguros_eeff` clavaba `tiposociedad: "A"`, así que
el catálogo prometía RUT de reaseguradoras y de seguros de crédito que la tool no podía
consultar. Verificado en vivo. AVLA (seguros de crédito) responde 222 cuentas con
`subtipo: "CR"` y «la página no trajo el grid» con `A`. **Toda opción de un formulario que la
tool deja clavada en un valor es un universo que el modelo no puede ver.** Hoy `subtipo` es un
parámetro, y el catálogo dice qué subtipo tiene cada compañía.

**30. Un rate limiter que calcula la espera antes de reservar su turno deja pasar ráfagas (3
de septiembre de 2026).** Qué falló, y lo midió la revisión adversarial. `RateLimiter.esperar`
leía la hora de la última llamada, esperaba, y recién después anotaba la suya. 5 llamadas
lanzadas juntas con `Promise.all` leían la misma hora vieja y salían 4 en 7 ms con un mínimo
de 400. Nadie lo había visto porque ninguna tool lanzaba llamadas paralelas al mismo host
hasta el catálogo de seguros. Prescripción. El turno se reserva ANTES de esperar
(`ultimo = max(ahora, ultimo + minMs)`), y `test/rate-limit.test.ts` lanza 5 llamadas juntas y
mide las brechas. La regla. un defecto latente aparece cuando una pieza nueva usa una vieja
de una forma que nadie había usado, y por eso el revisor de contexto fresco lee el diff
completo y no solo lo nuevo.

**29. Un formato de identificador se unifica en la SALIDA de los catálogos y en la ENTRADA de
las tools, con la MISMA función en los 2 lados (3 de septiembre de 2026).** Qué falló. El RUT
viajaba en 4 formatos según la tool que lo entregara («76598625-7», «99155000», «90690000-9» y
«76.212.519-6»), y las listas `sociedades` eran `z.array(z.string())`, así que un RUT copiado
de un grid con puntos llegaba a la CMF tal cual y la CMF respondía vacío, sin error.
Prescripción. `rutCanonico` de `src/util/rut.ts` es la única regla (dígitos, sin puntos ni
DV, que es lo que toda página de la CMF acepta). `rutSchema` la usa en la entrada,
`sociedadesSchema` y `rutOTodosSchema` en las listas, y `conRutCanonico` en la salida de cada
catálogo, con el DV aparte en `rut_dv` solo cuando la fuente lo traía. Verificado contra la
CMF real. `cmf_seguros_eeff` con `["99.147.000-K"]` devuelve las 222 cuentas de BCI. Lo
vigilan 2 comprobaciones de clase en `test/rut.test.ts`. ninguna tool declara una lista de RUT
cruda, y todo catálogo con `rut` pasa por `conRutCanonico`. La excepción se declara en vez de
esconderse. los catálogos de fondos usan un número de registro de 4 dígitos que la CMF llama
`rut` en su propia URL, y las instrucciones del servidor lo dicen.

## Gotchas

- **La fuente se cae, y eso no es un defecto tuyo.** El servlet BaseDato devuelve a veces el
  desafío anti-bot en vez de la tabla. Un plazo agotado es evidencia sobre la CMF, no sobre el
  código. Reintenta antes de declarar un hallazgo.
- **2 tools piden captcha.** `cmf_hechos_globales` y `cmf_fondos_mutuos_cartola`. La imagen se
  sirve como recurso `cmf://captcha/{id}`, es de un solo uso y dura 10 minutos. Nunca hay OCR
  automático, el código lo lee la persona.
- **Las tools `cmf_api_*` necesitan `CMF_API_KEY`.** En local no está, y responden un error que
  lo dice. Eso es lo esperado y `verify-endpoints` lo cuenta como aprobado.
- **`cmf_bancos_tasas` usa la clave web pública de BEST si no hay `CMF_BEST_KEY`.** Si BEST
  responde 401, la CMF rotó esa clave. se lee de nuevo del bundle de `best.cmfchile.cl` (lección
  27) y se cambia `BEST_CLAVE_WEB` en `src/tools/otros.ts`.
- **El HTML legacy viene en latin1.** Hay que decodificarlo a mano. Y trae mojibake y entidades
  HTML, así que una búsqueda de texto sin normalizar da cero y parece ausencia.
- **El texto del modelo se corta en el ancho de la terminal de quien lee**, no en la tuya.
- **La deuda de complejidad está aceptada, no arreglada.** El linter reporta funciones sobre el
  límite y todas están triadas en `hallazgos-descartados.json`. El trinquete solo exige que no
  crezca.
- Si el linter se pone rojo por deuda vieja en un archivo que tocaste, arréglala en su propio
  commit. Saltarse el portón una vez es saltárselo siempre.

## Deploy

1. Trabaja y commitea en `master`, con el árbol limpio.
2. `git push`. El `pre-push` corre lo mismo que el CI, incluida la verificación contra la CMF
   real, y bloquea si algo está rojo o si queda un hallazgo sin triar.
3. `npm run ci-remoto`. Espera los flujos de GitHub del commit y falla si alguno está rojo. El
   push que termina bien solo dice que el commit llegó, no que el remoto lo aprobó. Lo mismo
   vale después de aceptar un PR de dependabot: se lee la CI del merge.
4. `npm run deploy`. Su `predeploy` vuelve a correr `ci-remoto`, así que con la CI en rojo o
   con un commit sin empujar el deploy se niega.
5. `npm run verificar-desplegado`. Habla con la instancia viva y es lo único que prueba el
   borde. Un servidor MCP ES un protocolo, y eso solo se prueba cruzándolo.
