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
- `tasas.cmfchile.cl` — servlet InfoFinanciera, tasas de interés.
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
- `src/util/tramos.ts` — paginación honesta. `paginacion()`, `toolOkPaginado` y `toolOkTabla`.
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

## Gotchas

- **La fuente se cae, y eso no es un defecto tuyo.** El servlet BaseDato devuelve a veces el
  desafío anti-bot en vez de la tabla. Un plazo agotado es evidencia sobre la CMF, no sobre el
  código. Reintenta antes de declarar un hallazgo.
- **2 tools piden captcha.** `cmf_hechos_globales` y `cmf_fondos_mutuos_cartola`. La imagen se
  sirve como recurso `cmf://captcha/{id}`, es de un solo uso y dura 10 minutos. Nunca hay OCR
  automático, el código lo lee la persona.
- **Las tools `cmf_api_*` necesitan `CMF_API_KEY`.** En local no está, y responden un error que
  lo dice. Eso es lo esperado y `verify-endpoints` lo cuenta como aprobado.
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
3. `npm run deploy`.
4. `npm run verificar-desplegado`. Habla con la instancia viva y es lo único que prueba el
   borde. Un servidor MCP ES un protocolo, y eso solo se prueba cruzándolo.
