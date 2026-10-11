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
  estadístico de la CMF. 5.180 cuadros y 34.023 series (bancos, cooperativas, emisores de
  tarjetas, mutuarias, administradoras de fondos, tasas) más las tasas de interés corriente y
  máxima convencional. Pide la cabecera `x-apikey`; sin `CMF_BEST_KEY` se usa la clave web
  pública del propio sitio. Ver las lecciones 27 y 32. El servlet InfoFinanciera de
  `tasas.cmfchile.cl` que lo antecedía ya no entrega la tabla.
- `cronologiabancaria.cmfchile.cl` — la Cronología Bancaria (ex SBIF), la historia de cada
  banco desde 1743. Páginas HTML con listas y tablas sin cabecera. Ver la lección 31.
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
- el limitador en workerd de verdad: `npm run workerd`. Corre los escenarios de
  `herramientas/workerd/escenarios.mjs` en miniflare y sale con 1 si alguno queda ROTO. Tarda
  unos 5 minutos. Un solo escenario: `npm run workerd -- hilo-detenido`.
- memoria de un documento en workerd: `npm run workerd:memoria`.
- la sonda en Cloudflare de verdad: `npm run sonda -- desplegar`, `npm run sonda -- medir <url>`
  y `npm run sonda -- borrar`. Ver la sección «Pruebas en workerd y en Cloudflare».

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
- `infra/salida-chilena/` — el proxy que consulta a `www.cmfchile.cl` desde una IP chilena, con
  sus 2 unidades de systemd. Corre en el servidor Floki, no en Cloudflare. Ver la lección 36.
- `src/client/peticion.ts` — el `waitUntil` de la petición del Worker en curso, al alcance del
  cliente. Sin él, lo que una petición deja pendiente al responder se abandona. Ver la lección 44.
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
- `src/client/best.ts` — `bestJson`, la única puerta hacia el servicio de BEST. Clave, cabeceras
  y los 3 errores (HTTP, 200 sin JSON, red) viven acá. `src/tools/best.ts` tiene el buscador
  del catálogo y los cuadros; las tasas TMC siguen en `otros.ts` y usan el mismo cliente.
- `src/tools/cronologia.ts` — la Cronología Bancaria, con un lector por vista (listas por letra,
  tablas de hitos, relato de un evento, tablas de relacionadas).
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
7. **Si el cambio toca el limitador, los temporizadores o la lectura del cuerpo, el motor
   también es una fuente real.** Antes de desplegar pasa por los 3 instrumentos de la sección
   «Pruebas en workerd y en Cloudflare». el modelo en la suite, `npm run workerd`, y la sonda
   con `npm run sonda`. Una frase sobre cómo se comporta el motor se mide en el motor de
   producción, no solo en el local (lección 43).

Para medir un antes y un después con el MISMO instrumento, copia el archivo arreglado fuera del
repo, escribe el viejo con `git show HEAD:<archivo> > <archivo>`, mide, y devuelve la copia
comprobándola con `cmp`. **Nunca `git stash`.** Este repo se trabaja con árboles hermanos en
`C:\dev`, y la lista de stash es una sola para todos. Si tocas el instrumento entre las 2 tomas,
la comparación no vale.

## Testing

Los tests viven en `test/` y terminan en `.test.ts`. Todo lo demás en esa carpeta es un
script, no una prueba, y `npm test` no lo levanta.

Hay 4 clases y conviene saber cuál estás escribiendo.

- **De caso.** Ejercitan una función con un fixture. `parsers.test.ts`, `fondos-mutuos.test.ts`.
- **Con el modelo de un motor.** Corren el cliente con el reloj y los temporizadores de
  Cloudflare, que Node no tiene. `reloj-de-cloudflare.test.ts`, `peticion-del-worker.test.ts`.
  Cada una carga un cliente nuevo con `clienteNuevo`, para partir con el limitador limpio.
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
- Una prueba nueva se corre contra el mutante de su cláusula antes de darla por buena, y con
  el mutante puesto tiene que dar rojo, no colgarse. Los cuerpos de prueba son finitos, y 2
  bloques grandes de bytes no se comparan con `deepEqual` (lección 46).
- Una prueba de tiempos se corre 6 veces con la CPU ocupada antes de integrarla. La de la cola
  llena dio rojo 2 veces así, por 2 razones distintas, con la suite normal siempre en verde.

## Pruebas en workerd y en Cloudflare

La suite corre en Node, y hay 3 cosas del cliente HTTP que Node no puede mostrar. En Workers
una petición que termina abandona sus promesas y sus temporizadores. workerd despacha los
temporizadores atrasados en otro orden. Y en Cloudflare de verdad el reloj no avanza durante
la CPU. Para cada una hay un instrumento, y todos viven en `herramientas/workerd/`.

**Todo cambio en el limitador, en los temporizadores o en la lectura del cuerpo pasa por los 3
antes de desplegarse.**

1. **El modelo del reloj de Cloudflare, dentro de la suite.** `test/reloj-de-cloudflare.ts`
   reemplaza `Date.now()` y los temporizadores por los de Cloudflare. cada petición lleva su
   reloj, un temporizador atrasado ve la hora para la que estaba programado, y se despacha uno
   por petición y por turno. Lo usan `test/reloj-de-cloudflare.test.ts` y
   `test/peticion-del-worker.test.ts`. Corre con `npm test`, en milisegundos.
2. **workerd local.** `npm run workerd`. `arnes.mjs` empaqueta `entrada.ts` con el cliente del
   árbol de trabajo y lo levanta en miniflare. Toda salida del Worker la atiende una función
   local, que además cuenta desde afuera cuántas consultas hay en vuelo. Cada escenario termina
   con RESISTE o ROTO. Los que hay. peticiones abandonadas con cupo y en la cola, consulta viva
   y lenta, hilo detenido (una detención, varias seguidas, ráfagas de CPU, una petición de 10
   consultas, consultas que nacen al terminar la detención), cola llena de consultas muertas,
   cupos muertos con poco tráfico, petición cortada, y la gracia de fábrica. Una consulta
   «muerta» se fabrica con `sin_wu=1`, que le quita el waitUntil a su petición.
3. **La sonda en Cloudflare.** `npm run sonda -- desplegar` publica `entrada.ts` como un Worker
   APARTE, `sonda-limitador-cmf`, sin rutas ni dominio. No consulta a la CMF. su red es una
   función del propio Worker (variable `RED_INTERNA`), y el escenario `la-sonda-no-sale-a-la-red`
   lo comprueba desde afuera. `npm run sonda -- medir https://sonda-limitador-cmf.<cuenta>.workers.dev`
   corre los experimentos, y `npm run sonda -- borrar` la quita. **Se borra al terminar.** Un
   experimento vale solo si todas sus peticiones cayeron en un mismo aislado, y la sonda lo
   dice. Cloudflare reparte las peticiones entre aislados, así que las que tienen que
   encontrarse se piden por la ruta `/yo`, que usa un binding del Worker hacia sí mismo.

La memoria se mide con `npm run workerd:memoria`. Levanta un workerd por medición y entrega
cuánto subió la memoria del proceso sobre su base. `--por=fetch`, `--por=binario` o
`--por=descargar` eligen el camino, y `--sin-largo` quita el largo declarado.

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

**31. «La CMF migró la página» era la portada de un sitio que sí tiene los datos (3 de
septiembre de 2026).** Qué falló. `cmf_bancos_cronologia` pedía `indice=8.0`, que es la
portada, buscaba una `<table>` y como no la encontraba respondía que la fuente había migrado.
La Cronología Bancaria funciona y trae la historia de cada banco desde 1743. Los datos viven
en 5 vistas que se eligen con el `indice` de la URL (`8.1&letra=A`, `8.4&idEntidad=ID`,
`8.3.1&ANIOS=AAAA`, `8.9&Eventoid=ID`, `8.2.3&idEntidad=ID`) y vienen como `<ul><li>` con el
id en el `href`, como tablas de 2 columnas con `<p class="fecha">`, o como un
`<div class="post fecha">`. Prescripción. Antes de declarar migrada una fuente, seguir sus
propios enlaces. la portada enlazaba las 5 vistas. Y el cortafuegos F5 de la CMF responde 500
con la página «Attack ID» para algunas consultas sin patrón visible (`8.2.1&anio=2020` sí,
`anio=2019` no; `letra=B` sí, `letra=C` no), aun con el cliente anti-bot. La tool lo dice como
error de fuente con la URL, y la descripción no promete lo que el cortafuegos bloquea.

**32. BEST tiene 5.180 cuadros y el MCP servía 1 (3 de septiembre de 2026).** Qué pasó. Al
abrir el bundle de best.cmfchile.cl para las tasas (lección 27) apareció el resto. la API
oficial APIBEST (`apibest.cmfchile.cl/api/v1/series/data/{codigo}` y `/cuadros/data/{tag}`,
clave personal por formulario, cuota de 10 por minuto, 100 al día y 3.000 al mes, rango
máximo de 12 meses), el servicio interno del sitio (`/public/Cuadrosv3?NumPeriodos=N&Tag=`,
`?FechaInicio=AAAAMMDD&FechaFin=&Tag=`, `/public/Cuadrosv3/tag/{tag}` para la historia
completa, sin tope de rango ni cuota declarada), su buscador (`POST /aisearch/aisearch` con
`{query, top}`, sin clave, que IGNORA `top` y devuelve hasta 1000 por relevancia) y el
catálogo completo en CSV (`bestsbif.blob.core.windows.net/bestcontainer/CatalogoAPIBEST.csv`,
10 MB, columnas categoría, entidad, cuadro, tag, serie). Decisión. la cuota de la API oficial
no sirve para un servidor compartido, así que `cmf_best_buscar` y `cmf_best_cuadro` usan el
servicio del sitio con la clave web. Los cuadros salen en formato largo (fecha, serie,
descripción, valor), porque un cuadro puede tener 97 series y una fila por fecha no cabe en
ningún texto. Unos endpoints envuelven el cuadro en `result` y otros no. Y la respuesta trae
notas de la CMF que cambian la lectura («información posterior a diciembre de 2021 no
disponible en BEST»), así que viajan en `notas` y en el texto.

**33. Una fuente muerta en la CMF se borra, no se explica (3 de septiembre de 2026).** Qué
pasó. `cmf_fondos_inversion_comisiones_maximas` leía `..._commax_excel.php`, y la planilla
vuelve con solo la cabecera para todo período probado (2019, 2024, 2025, junio y diciembre,
todos los fondos o uno solo, con y sin cookie del índice). El formulario de la CMF hace
exactamente el mismo POST, así que no es un defecto nuestro. la CMF no publica el dato.
Regla del dueño. si la fuente no tiene arreglo, la tool se elimina, porque una tool que
siempre responde vacío enseña al modelo a desconfiar de las demás. La misma información, para
fondos de inversión, la entrega `cmf_fondos_comisiones_maximas` con `tipo=fi` y `circular=1965`.

**34. BEST se guarda por demanda en KV, no se baja por adelantado (3 de septiembre de
2026).** Qué se decidió, y por qué. El dueño preguntó si convenía bajar los 5.180 cuadros
una vez al día. No. la API oficial permite 100 llamadas al día, los términos de uso de BEST
prohíben la extracción masiva, casi todos los cuadros cambian una vez al mes, y el plan gratis
de Workers limita cada ejecución a 50 llamadas de salida. Prescripción. `bestJson` guarda
cada respuesta en `CMF_KV` con la clave `best:v1:<ruta>` y vence a las 24 horas, o a las 6
para los cuadros diarios (`DAYL` en el tag) y las tasas TMC, que es lo que BEST recomienda en
su documentación. Un error nunca se guarda, y una respuesta servida desde la caché lo dice en
sus notas con la hora de Chile en que se guardó, porque un dato viejo sin fecha es un dato
engañoso. Si cambia la FORMA de lo guardado, sube la versión de la clave. Una copia completa
mensual en R2 es posible, pero exige el plan pagado y una clave de la CMF con cuota mayor.

**35. Un 403 de www.cmfchile.cl desde el Worker se lee en Workers Logs, no se adivina (9 de octubre de 2026).** Qué falló. `cmf_seguros_deposito_polizas` y `cmf_documento_markdown` respondieron 403 seis veces, y el log no traía cabeceras ni cuerpo, así que no se podía saber si la CMF bloqueaba el origen de Cloudflare o el ritmo. Causa raíz. El log solo guardaba el estado HTTP, y las descargas binarias ni siquiera leían el cuerpo. Prescripción. Cada respuesta que no es datos deja en `cmf_upstream` el estado, `reintento_403`, un subconjunto fijo de cabeceras (`server`, `content-type`, `content-length`, `retry-after`, `cf-ray`, `x-cache`, `via`), solo los NOMBRES de las cookies de `set-cookie` y los primeros 160 caracteres del cuerpo, también en las rutas binarias. La query de la URL no se registra porque lleva tokens. Un 403 se reintenta una vez tras `CMF_REINTENTO_403_MS` (6000 por defecto). Para leerlo en Workers Logs se filtra por `cmf_upstream` y se compara `cf-ray` con el de la petición fallida: si el cuerpo trae la marca «Attack ID» es el cortafuegos F5; si no la trae, el log solo dice que el origen fue rechazado, y eso no separa bloqueo de ritmo por sí mismo. Lo vigilan `test/diagnostico-403.test.ts` y `test/bloqueo-upstream.test.ts`.

**36. La CMF bloquea las IP de salida de Cloudflare, y correr el Worker en Chile no lo arregla
(9 de octubre de 2026).** Qué falló. `www.cmfchile.cl` respondió 403 o 520 a toda consulta que
salía del Worker. Las tools de `api.sbif.cl` y de BEST no se vieron afectadas. Evidencia, toda
medida ese día. La CMF NO está detrás de Cloudflare: resuelve a `152.230.198.86` y responde
`Server: XXXXXX`. Las cabeceras `server: cloudflare` y `cf-ray` del log `cmf_upstream` las pone
Cloudflare en toda respuesta que recibe un Worker, y el código al final del `cf-ray` dice dónde
corrió el Worker, no quién respondió. El 403 es la página de Apache de la CMF (362 bytes) y el
520 es Cloudflare avisando que el origen cortó la conexión («error code: 520», 16 bytes). Los
usuarios chilenos (Telefónica, Entel) entran al Worker por Río de Janeiro, `colo=GIG`, aunque
`cloudflare.com/cdn-cgi/trace` les diga `SCL`. Un Worker de prueba con
`"placement": { "region": "azure:chilecentral" }` corrió en Santiago (`Cf-Placement:
remote-SCL`, `cf-ray` terminado en `-SCL`) y recibió 520, 520 y 403 en 3 consultas. En el mismo
minuto, la misma URL con las mismas cabeceras dio 200 desde una IP doméstica chilena. Causa
raíz. El bloqueo es por la IP de salida de Cloudflare, no por el país, el ritmo ni las
cabeceras. Prescripción. `fetchCmf` de `src/client/cmf-client.ts` tiene una salida chilena.
Cuando `www.cmfchile.cl` responde 403 o 520 y existen `CMF_PROXY_URL` (variable) y
`CMF_PROXY_TOKEN` (secreto), repite la consulta por el proxy de `infra/salida-chilena`, que
corre en Floki detrás de un túnel de Cloudflare propio. El bloqueo se recuerda 10 minutos por
instancia, para no golpear a la CMF directa con consultas que va a rechazar. Lo que el proxy
reenvía lleva la cabecera `x-cmf-salida`. Una respuesta sin esa marca es del túnel o del proxy,
y ahí el cliente vuelve al camino directo y entrega el bloqueo original. Cada cambio de camino
deja una línea `cmf_salida` en Workers Logs, con `directo_bloqueado` o `proxy_fallo`. Lo vigilan
`test/salida-chilena.test.ts` y `test/salida-proxy.test.ts`. Lo que NO sirve, para no volver a
probarlo. `placement` (fija dónde corre, no con qué IP sale) y Smart Placement. La página de
`placement` de la documentación de Cloudflare no ofrece ninguna forma de elegir la IP de
salida. Y el costo que hay que conocer. toda consulta a
`www.cmfchile.cl` del servidor público sale ahora por la IP de la casa del dueño, así que el
proxy tiene su propio ritmo máximo (1 consulta cada 600 ms, 12 en curso) y solo acepta ese host.
Si Floki se apaga, se cuelga o pierde la red, las tools de `www.cmfchile.cl` vuelven a responder
el 403 de siempre. Un 403 que la CMF da por la consulta misma, y no por la IP, también se repite
por el proxy, porque el estado no los distingue. Lo que encontró la revisión adversarial antes
de integrar, 6 defectos con prueba. El proxy juntaba el documento entero en memoria antes de
responder, así que el plazo del Worker cubría la descarga completa y un PDF grande nunca
llegaba; ahora reenvía en tramos, el cupo dura hasta el último byte y la consulta a la CMF se
corta si el Worker corta. Un proxy colgado dejaba al cliente pegado 10 minutos sin rastro;
ahora cualquier falla por el proxy lo descarta y entrega el bloqueo original. Una URL con un
carácter fuera de latin1 reventaba al ponerla en la cabecera; ahora viaja normalizada. El 429
de cola llena del proxy se leía como proxy caído y mandaba más consultas a la CMF directa;
ahora lleva la marca `x-cmf-salida-cola` y el cliente espera y reintenta por el proxy. Y
medido, no supuesto. Cloudflare reescribía el HTML al pasar por el túnel: la misma ficha
pesaba 149.895 bytes por el túnel y 136.299 en la CMF. Con `cache-control: no-store,
no-transform` en la respuesta del proxy llega idéntica, 136.299 bytes. Regla. un proxy propio
detrás de Cloudflare responde siempre `no-transform`, y la prueba es comparar los bytes por el
túnel contra los bytes en el origen. Para
leer Workers Logs sin el panel. `cf observability telemetry query --body '{...}'` con
`view: "events"`, un filtro `$metadata.service` igual a `mcp-cmf-chile` y la ventana en
milisegundos. El log solo guarda fallas, así que no sirve para saber cuándo una consulta
funcionó.

**37. Un contador que se suma en un lugar y se resta en 2 se descuadra en silencio (9 de
octubre de 2026).** Qué falló, por 2 caminos. `fetchCmf` liberaba su cupo dentro del `try` y
otra vez en el `catch`, así que una redirección a un host fuera de `HOSTS_ALLOWLIST`, a http o
con un `location` ilegible (las 3 lanzan después de la primera liberación) dejaba `inflight` en
-1 y el tope de 4 pasaba a 5 para toda la instancia. Y `RateLimiter.esperar` revisaba el cupo
antes de esperar el turno y lo anotaba después, así que con un ritmo mayor que 0, que es el de
producción, 10 consultas lanzadas juntas pasaban todas la revisión con el contador en 0 y
quedaban las 10 en vuelo. El segundo camino apareció al escribir la prueba del primero.
Causa raíz. La revisión y la anotación de un cupo estaban separadas por un `await`, y la
liberación vivía en 2 ramas que no se excluían. Prescripción. En `fetchCmf` el `try` cubre SOLO
la consulta, con un `liberar()` en el `catch` y otro justo después del `try`. En `esperar`, el
cupo se toma en el mismo paso síncrono en que se revisa. Código nuevo que lance entre la
respuesta y el `return` no necesita cuidar el cupo, porque ya está liberado. El costo que hay
que conocer. una consulta que espera su turno ya ocupa cupo, así que 4 consultas en cola hacia
`www.cmfchile.cl` hacen esperar a una quinta hacia otro host. La misma lectura encontró que una
redirección rechazada que llegaba por la salida chilena se anotaba como `proxy_fallo` y
entregaba el 403 original; ahora sube como «Host no permitido». Lo vigila
`test/tope-en-vuelo.test.ts`, que cuenta las consultas en vuelo dentro del `fetch` simulado y
exige el máximo EXACTO. un máximo de 5 delata una liberación de más, y uno de 2 delata un cupo
que no se devolvió. La revisión adversarial mostró que la primera versión de esa prueba solo
miraba una dirección: pasaba verde con el `liberar()` del `catch` borrado. Regla. una prueba de
un contador se corre contra los 2 mutantes, el que resta de más y el que resta de menos. Los 2
defectos que esa revisión dejó abiertos están en la lección 38.

**38. Un plazo que se apaga al llegar las cabeceras no cubre la respuesta (9 de octubre de
2026).** Qué falló, por 3 caminos que demostró la revisión adversarial de la lección 37.
`fetchConTimeout` apagaba su temporizador al llegar las cabeceras, y `resolverChallenge` lee el
cuerpo entero con el cupo tomado, así que 4 respuestas con el cuerpo abierto dejaban a toda la
instancia esperando cupo para siempre. `fetchCmf` seguía cada 3xx sin contar, y un 302 hacia la
misma URL dio 201 saltos. Y `config()` leía sus 5 enteros con `parseInt` sin revisar: un texto
daba NaN, un ritmo NaN estrenaba limitador en cada llamada (sin tope ni espera) y un plazo NaN
vencía al milisegundo. Causa raíz. Las 3 protecciones existían y tenían una entrada que las
apagaba sin aviso. Prescripción. `conPlazoDeCuerpo` envuelve el cuerpo con un plazo de SILENCIO,
que vence si pasan `CMF_UPSTREAM_TIMEOUT_MS` sin que llegue un tramo. No es un plazo del total a
propósito: un documento grande por la salida chilena tarda más que el plazo y tiene que llegar
(lección 36). Al vencer lanza un `AbortError`, así que pasa por el `catch` y los reintentos de
siempre. `fetchCmf` corta a los 5 saltos (`MAX_REDIRECCIONES`). Y `enteroDeEnv` cambia un valor
ilegible por el de fábrica y deja una línea `cmf_config` en el log. Los 2 errores nombran la URL
SIN su query, porque la de `api.sbif.cl` lleva la clave y ese texto llega al modelo. Lo vigilan
`test/cuerpo-sin-fin.test.ts`, `test/redirecciones.test.ts` y `test/configuracion.test.ts`.
Verificado en los 2 motores, porque el envoltorio arma un `Response` nuevo y eso podía perder
cookies. Con un servidor HTTP local que deja el cuerpo abierto, en Node y en workerd
(`wrangler dev`), las conexiones colgadas se cierran, 2 `set-cookie` llegan separadas, el gzip
se lee bien, 204 y 304 pasan y 3 MB en 960 ms llegan enteros con plazo de 400. Para probar el
cliente contra un servidor local sin tocar `HOSTS_ALLOWLIST`, se reemplaza `globalThis.fetch`
por uno que reescribe el host y llama al `fetch` real. Regla. un plazo se prueba con la
respuesta que empieza y no termina, no solo con la que no empieza. Lo que encontró la revisión
adversarial del propio arreglo antes de integrar, 6 puntos con prueba. La red entrega estados
fuera de 200 a 599 y `new Response` los rechaza con RangeError, así que esas respuestas pasan sin
envolver. Una respuesta envuelta que nadie lee ya no la suelta el recolector de basura (6
conexiones abiertas tras 6 desafíos F5, medidas con un servidor real), así que
`resolverChallenge` cancela el cuerpo de la respuesta al desafío. Regla. **quien no va a leer
una respuesta cancela su cuerpo.** El error de un cuerpo colgado por la salida chilena nombraba
la URL del proxy, y ahora nombra la página de la CMF. `enteroDeEnv` dejaba pasar un valor de
solo espacios, un plazo de 0 y un valor mayor que 2147483647, que un temporizador baja a 1 ms, y
reventaba con un valor escrito sin comillas en `wrangler.jsonc`. Ahora solo acepta puros
dígitos, con mínimo y máximo. Y 4 mutantes pasaban las pruebas en verde. La prueba del aviso
miraba que el aviso existiera y no que el valor malo dejara de usarse. Regla. una prueba de una
protección mira el EFECTO protegido, no la señal que la acompaña. Lo que conviene saber. Un
cuerpo colgado se reintenta 3 veces, igual que una consulta sin respuesta, así que un POST se
envía 3 veces y el error tarda 3 plazos. Los 3 puntos que esta lección dejó abiertos en su
primera versión se cerraron el mismo día, en este orden, porque cada uno habilita al siguiente.
La espera de cupo vence a los `CMF_ESPERA_CUPO_MS` (120000 de fábrica), con un error que dice
que las 4 consultas están ocupadas y una línea `cmf_cupo` en el log, con cuántas hay en vuelo y
en cola. **Esa línea dice «servidor ocupado», y no prueba por sí sola un cupo perdido.** Un cupo
puede estar ocupado de forma legítima más que el plazo de espera: un documento lento lo ocupa
hasta 132 segundos por intento, así que 4 documentos lentos a la vez hacen fallar a las demás
consultas a los 120 segundos. Un cupo perdido se reconoce porque `cmf_cupo` sigue saliendo con
`en_vuelo` en 4 cuando ya no hay tráfico. Con ese plazo, una prueba que pierde cupos sale roja en vez de colgar la suite, y eso
permitió dejar UN solo limitador por proceso, con el ritmo como parámetro de `esperar()`. Antes
había uno por valor de ritmo y 2 ritmos conviviendo dejaban 8 consultas en vuelo. Y el cuerpo
tiene además un plazo TOTAL de 10 veces el de silencio (`PLAZOS_POR_CUERPO`), para el cuerpo que
gotea un tramo antes de cada plazo. Al vencer lanza `TimeoutError` y no se reintenta. Los costos
que hay que conocer. Un documento que tarde más de 120 segundos en bajar, con el plazo de
fábrica, ya no llega. El limitador recuerda el último turno de cada host para todo el proceso,
así que 2 pruebas del mismo archivo que usan el mismo host con ritmos distintos se estorban; cada
prueba de `test/configuracion.test.ts` usa hosts que las demás no usan. Y las pruebas que
pueden perder cupos pasan `CMF_ESPERA_CUPO_MS` corto, para dar rojo en segundos. Lo que encontró
la segunda revisión adversarial, sobre estos 3 cierres, antes de integrar. La espera de cupo era
un sondeo cada 100 ms, sin orden, y una cadena de consultas seguidas devuelve su cupo y lo
vuelve a tomar en el mismo paso, así que quien sondeaba podía no entrar nunca. Con el plazo
nuevo, esa consulta pasaba de entrar tarde a fallar. Ahora la cola va en orden de llegada (la
forma de entregar el cupo cambió después, y está en la lección 42). Regla. **agregarle un
plazo a una espera obliga a revisar si esa espera es justa**, porque el plazo convierte en error
lo que antes solo era demora. Medido con el cliente real y un reloj simulado, con los valores de
fábrica. unas 110 consultas juntas al mismo host caben en los 120 segundos si la CMF responde
en 200 ms, unas 45 si responde en 9 segundos, y 15 si está colgada. El plazo total del cuerpo
por la salida chilena salía como 403 y daba el proxy por caído; ahora el `TimeoutError` sube tal
cual. Un reintento sin cupo borraba el 500 o el bloqueo directo anterior; ahora se conservan. Y
un ritmo de 2147483647 dejaba el turno del host a 24,8 días; el ritmo y la espera del 403 tienen
un máximo de 60000. La misma revisión mostró que la prueba del plazo de cupo miraba una sola
dirección del contador, la falta que la lección 37 ya había nombrado. El máximo en vuelo se mide
en una red aparte, después del caso, porque dentro del caso ya llegó al tope.

**39. El portón de alertas medía `src/` y el código nuevo corría en `infra/` (9 de octubre de
2026).** Qué falló. CodeQL abrió una alerta crítica (`js/request-forgery`) en
`infra/salida-chilena/proxy.mjs` el mismo día que el proxy nació, y `herramientas/alertas.mjs`
la contó como «en pruebas», porque su lista de código vigilado era solo `src/`. Causa raíz. La
lista nombraba lo que SÍ se vigila, así que toda carpeta nueva nacía fuera. Cura. La lista se
dio vuelta. Todo lo que no está en `test/` cuenta como código que corre y bloquea con una
alerta alta o crítica (`herramientas/alertas-clasificar.mjs`, con `test/porton-alertas.test.ts`).
La alerta resultó un falso positivo y quedó descartada en GitHub con su razón: el destino
exige `https` y el host exacto, el `fetch` usa la URL ya analizada, y 27 direcciones tramposas
no lograron salir de `www.cmfchile.cl`. Las otras 26 alertas abiertas eran del JavaScript de la
CMF guardado en `test/fixtures`, que ahora está fuera del análisis con una prueba que exige que
ahí solo haya datos. Regla. una lista de vigilancia nombra lo que se EXCLUYE, con su razón,
nunca lo que se incluye.

**40. La ficha bancaria trimestral y el portal anual son fuentes distintas (9 de septiembre de
2026).** Qué falló. `cmf_bancos_eeff_documentos` consultaba `pestania=3` con la forma SAFEC de
emisores y devolvía cero documentos para Banco de Chile, aunque la CMF sí publicaba sus EEFF.
Causa raíz. Los bancos exponen la publicación anual en el portal
`/portal/estadisticas/626/w4-propertyvalue-43326.html`: esa página enlaza un PDF índice y el
PDF índice contiene las URL originales por código SBIF bajo `/bancos/estados_anuales/`.
Prescripción. Para EEFF anuales bancarios se llama `cmf_bancos_eeff_portal` (opcionalmente con
`anio` y `codUnicoBank`) y se entrega el enlace de `documentos_originales` a
`cmf_bancos_eeff_portal_descargar`. No se construye una URL por nombre ni se interpreta un cero
de la ficha trimestral como ausencia del documento. El fixture observado y el contrato MCP
viven en `test/fixtures/bancos-eeff-portal-observed.html` y
`test/bancos-eeff-portal.test.ts`.

**41. Un despliegue desde master sacó 3 herramientas que solo existían en producción (9 de
octubre de 2026).** Qué falló. Las 3 herramientas de la lección 40 se desplegaron el 15 de
septiembre desde el árbol principal con cambios sin commitear, y nunca llegaron al trunk. El 9
de octubre se desplegó desde master, como manda la sección «Ramas y deploy», y producción bajó
de 91 herramientas a 88. `npm run verificar-desplegado` pasó en verde, porque solo pedía «82 o
más». Nadie lo vio hasta que un cliente del MCP avisó que 3 herramientas ya no estaban. Causa
raíz. Producción y el trunk habían dejado de ser lo mismo, y ninguna comprobación comparaba uno
con el otro. Un piso no ve lo que se pierde por encima del piso, ni lo que sobra. Cura.
`test/verify-remote.ts` compara ahora los nombres que publica el servidor vivo con los del
registro del repositorio, en los 2 sentidos (`test/comparar-herramientas.ts`). Una herramienta
que falta es un despliegue incompleto, y una que sobra es un despliegue hecho desde un árbol
sucio. Las 3 herramientas volvieron al trunk con su prueba. Regla. lo desplegado se compara
con el trunk por IGUALDAD, nunca con un mínimo. Y antes de desplegar desde un árbol limpio
por primera vez en un repositorio con otros árboles de trabajo, se mira qué publica producción
que el trunk no tenga. Lo que conviene saber. La CI corre `verify-remote.ts` ANTES del
despliegue, así que ahí la diferencia solo se informa (`CMF_ANTES_DE_DESPLEGAR=1` en `ci.yml`).
Sin eso, agregar una herramienta dejaba la CI en rojo y el despliegue que la arregla exige la CI
en verde. La igualdad la exige `npm run verificar-desplegado`, después de desplegar. Y el código
que vivió fuera del trunk no había pasado por CodeQL. El día que entró, CodeQL marcó en él un
`js/double-escaping` de severidad alta, el mismo defecto que `parsers.ts` ya había curado en
agosto, en una función hermana que decodificaba entidades por su cuenta. Ahora `textoPlanoHtml`
vive en `parsers.ts` y usa `decodificarEntidades`, y `test/hallazgos-codeql.test.ts` falla si
otro archivo de `src` decodifica `&amp;` junto con otra entidad.

**42. En Workers una petición muere sin avisar, y lo que tenía tomado no vuelve (9 de octubre de
2026).** Qué falló. El limitador es un objeto de módulo, compartido por todas las peticiones de
la instancia. Cuando una petición termina, workerd abandona sus promesas y sus temporizadores
pendientes. Una consulta abandonada no llega nunca a `liberar()`. Con el contador simple de
siempre, una consulta abandonada con un cupo tomado lo perdía, y eso existía desde antes de la
lección 37. La cola en orden de la lección 38 agregó un segundo camino: `liberar()` le
entregaba el cupo al primero de la cola, y si esa consulta ya estaba muerta, el cupo quedaba en
sus manos para siempre. Con 4 cupos perdidos la instancia no podía consultar a la CMF hasta que
Cloudflare la reciclara. El disparador demostrado es una tool que responde su error mientras
otras consultas suyas siguen pendientes, que es lo que hace un `Promise.all` cuando falla una
(`companiasDeSeguros` de `src/catalogos.ts`). Lo encontró la tercera revisión adversarial, en
workerd de verdad, con el código ya desplegado. La suite no lo podía ver, porque en Node una
promesa pendiente siempre termina corriendo. Causa raíz. El código suponía que todo `esperar()`
llega a su `liberar()`, y que resolver la promesa de otro es entregarle algo. En Workers ninguna
de las 2 cosas es cierta. Prescripción. **Nadie le entrega nada a otra petición, y todo lo que
se toma lleva una señal de vida.** Cada cupo y cada puesto en la cola tienen un `visto` que
renueva su propio dueño con sus propios temporizadores (`LATIDO_MS` de 1 segundo para el cupo,
`SONDEO_COLA_MS` de 50 ms para la cola). Si el dueño muere, sus temporizadores mueren con él, la
señal envejece, y cualquier consulta que pase barre el cupo a los 45 segundos
(`GRACIA_CUPO_DE_FABRICA_MS`, que era de 5 hasta la lección 43) o el puesto a los 2
(`GRACIA_COLA_MS`). Cada consulta toma su cupo ella
misma, en su propio contexto, cuando es la primera de la cola y hay uno libre. `esperar()`
entrega el cupo y `liberar(cupo)` lo recibe, así que devolver 2 veces el mismo no hace nada. Un
cupo barrido deja una línea `cmf_cupo_recuperado` en el log. **Esa línea es la señal de una
consulta abandonada.** La produce una tool que deja consultas sin esperar, un programa de
`/codigo` que responde con llamadas pendientes, y también un cliente que corta su petición. El
costo que hay que conocer. Cada consulta abandonada de verdad deja su cupo tomado 45 segundos
para toda la instancia. Desde la lección 44 casi ninguna queda abandonada, porque sigue sola
hasta terminar. **Un hilo detenido no es una consulta muerta**, y esto lo encontró la cuarta
revisión adversarial el 10 de octubre de 2026, con el diseño ya desplegado. Mientras el hilo
está detenido nadie renueva su señal, tampoco los vivos. Una detención de 9,5 segundos daba por
muertas a las 4 consultas en vuelo y dejaba entrar a otras 4, y cada detención siguiente sumaba
4 más, sin techo (16 en vuelo tras 3 detenciones, medido). Y no hace falta un PDF enorme.
`processPdf` detuvo el hilo 8 segundos con un PDF de 200 páginas y 0,7 MB. Un programa de
`/codigo` que gasta su CPU detiene también al Worker principal en workerd local. El primer
arreglo fue un pulso: todo silencio de más de 1,5 segundos entre 2 eventos del limitador se
tomaba por una detención, y abría 2 segundos de cuarentena sin barrer. **Ese arreglo metió un
defecto peor, y lo encontró la quinta revisión con el pulso ya desplegado.** Un silencio largo
también es lo que hay cuando no quedó nadie vivo. Con 4 cupos y 200 puestos de consultas
muertas, cada consulta nueva veía el silencio, no barría, encontraba la cola llena y fallaba
al instante. Como no se quedaba a esperar, la siguiente repetía lo mismo, sin fin. Bastaban 4
programas de `/codigo` desde una IP. Y con 1 a 3 cupos muertos y tráfico espaciado, los
muertos no volvían nunca. El tercer intento dejó barrer a cualquier temporizador que corriera a
tiempo UNA vez, con el argumento de que entonces todo temporizador de un vivo que vencía antes
ya había corrido, porque los vencidos corren en el orden en que vencían. **Ese argumento es
falso en los 2 motores, y lo mostró la sexta revisión con el tercer intento ya desplegado.** En
Node los temporizadores corren por listas, una por duración, y la de 50 ms va antes que la de
1000. En workerd los atrasados se despachan de a uno por petición, unos 15 ms entre uno y otro.
En los 2 casos un temporizador recién creado corre «a tiempo» antes que las señales de vida
atrasadas de otro. Con una petición de 10 consultas, otra esperando cupo y una detención de 6
segundos, workerd dio por muertos a 4 vivos (8 en vuelo). En Node bastó una consulta que nacía
al terminar la detención (7 en vuelo). El diseño que quedó. **solo barre quien lleva una racha
corriendo a tiempo.** Para dar a alguien por muerto hay que saber que tuvo la oportunidad de
renovar su señal y no lo hizo. Esa oportunidad la prueba un temporizador periódico que corrió a
tiempo, corrida tras corrida, durante `RACHA_PARA_BARRER_MS` (2500, el latido de 1000 más 1500
para que el motor se ponga al día). La clase `Racha` lleva esa cuenta y cada corrida atrasada
(`ATRASO_MAXIMO_MS`, 1000) la corta y deja una línea `cmf_hilo_detenido`. Barren el latido de
un cupo, el sondeo de quien hace cola, y un vigía (`vigilar`) que deja quien entra directo
cuando ve cupos con la señal vieja. El costo. Una consulta que encuentra los 4 cupos muertos
espera 2 segundos y medio, no 50 ms. Y en Workers el vigía muere con su petición, así que con
1 a 3 cupos muertos y consultas cortas que llegan de a una, los muertos no vuelven hasta que
alguna consulta espera cupo 2 segundos y medio, o dura 3. Mientras tanto la instancia trabaja
con menos cupos. Se cura sola cuando sube la carga. La cola tiene
un tope de 1000 (`MAX_COLA`). Cada puesto sondea cada 50 ms, y con 10000 en cola el hilo
quedaba ocupado más de 5 segundos seguidos y nadie entraba. El primer tope fue 200 y rompía un
uso legítimo, 240 consultas juntas repartidas en 12 hosts, que antes pasaban todas. La que no
cabe no falla al instante: espera afuera hasta que su propia racha le deja barrer, porque la
cola puede estar llena de muertos. Reglas. **una señal de
vida mide 2 cosas a la vez, si el dueño vive y si el reloj corrió**, y hay que separar la
segunda antes de creerle a la primera. **Una ausencia se prueba con quien tenía que estar,
no con el silencio**: el silencio no distingue «todos callaron» de «no queda nadie». Y la que
costó 4 intentos. **una sola observación no prueba una ausencia; la prueba una ventana
entera**, y la ventana tiene que ser más larga que lo que el observado tarda en dar señal. Las
3 primeras formas fallaron en lo mismo, creerle a un instante. La regla de proceso. cuando un
arreglo se apoya en una frase sobre el motor («los temporizadores corren en orden»), esa frase
se mide en los 2 motores ANTES de construir encima, con una sonda de 20 líneas. Yo la escribí
como comentario y la di por cierta. La misma
quinta revisión encontró 3 defectos antiguos del desafío anti-bot, que quedaron cerrados. Si
la consulta repetida volvía a ser el desafío, la tool recibía esa página como dato; ahora es
un error que lo dice. Las cookies del jar REEMPLAZABAN a las de quien llama, así que el envío
del código del captcha perdía su cookie de sesión si le tocaba un desafío; ahora se suman
(`conCookiesDelJar`, también en `fetchCmf`). Y cada respuesta se convertía entera a texto solo
para mirar si era un desafío, que mide menos de 4000 caracteres; ahora se lee como bytes y se
convierte solo si es chica. Un documento de 40 MB ocupaba 124 MB y ahora ocupa 84, medido en
Node. El Worker tiene 128. Medido después en workerd, la memoria del proceso subía 56 MB con
un documento de 10 MB y 175 con uno de 40, más de 4 veces su tamaño. Eso quedó cerrado en la
lección 45, que además muestra que el `clone()` no era el costo mayor. La sexta
revisión cerró además 3 detalles de estos arreglos. El desafío repetido por la salida chilena
contaba como proxy caído y mandaba consultas a la CMF directa; ahora es su propio error
(`DesafioRepetido`) y sube tal cual. Una página chica y legítima con un script empaquetado, si
llegaba tras un desafío, se tomaba por otro desafío; ahora se exige también el dato `fwb_dat`,
igual que en la primera respuesta. Y `conCookiesDelJar` rearmaba la cabecera de quien llama
par por par y la cambiaba; ahora sus cookies viajan tal como venían y las del jar van al
final. La revisión anterior había encontrado otro defecto anterior a todo
esto, que se cerró ese día. Cuando la CMF respondía el desafío anti-bot, `resolverChallenge`
entregaba la respuesta de la consulta repetida sin leer. `fetchCmf` devolvía el cupo ahí y el
cuerpo se bajaba después, fuera del tope (12 cuerpos a la vez con tope de 4, medido). Y las
cookies de esa respuesta no quedaban en el jar, así que el flujo del captcha perdía su cookie
de sesión cuando la imagen llegaba tras un desafío. Ahora la respuesta repetida se trata igual
que una primera respuesta. su cuerpo se lee entero dentro de `resolverChallenge` y sus cookies
quedan en el jar. Regla. **el cupo cubre la respuesta entera, y `fetchCmf` nunca entrega un
cuerpo sin leer.** Lo que eso cambia para quien llama. un cuerpo que se cuelga tras el desafío
ya no le revienta en la mano al leerlo; vence dentro de la consulta, con sus 3 intentos, y por
la salida chilena cuenta como proxy caído. **Los 3 intentos de un cuerpo colgado son una
decisión, no un descuido.** Un cuerpo que deja de llegar suele ser un corte pasajero, y el
segundo intento casi siempre lo salva. El costo es que la consulta se envía 3 veces, también si
es un POST, y que el error tarda 3 plazos: 38 segundos con el plazo de fábrica, medidos, y unos
4 minutos y medio con el de 90 segundos de las tools lentas, calculados. Se acepta porque todo
POST a la CMF es una búsqueda, y repetirla no cambia nada allá. Si algún día una tool envía
algo que no se puede repetir, esa tool no puede pasar por este reintento. Lo vigila
`test/cuerpo-sin-fin.test.ts`. Verificado
en workerd, con miniflare y la salida del Worker atendida por una función local. Hoy ese arnés
vive en el repositorio y corre con `npm run workerd`. Los 3 escenarios, cupo tomado, puesto en
cola y `Promise.all`, dejaban la instancia sin cupos, y ahora los recupera. En la suite, «morir» se
simula creando los temporizadores de la consulta con el reloj de `node:test` y descartándolos
(`lanzarMuertas` de `test/tope-en-vuelo.test.ts`). Regla. **lo que corre en Workers se prueba
también contra la muerte de la petición**, y eso solo se ve en workerd. Y la regla de proceso
que deja esta lección. La segunda revisión leyó la cola nueva en Node y la dio por buena en ese
punto. Un cambio en una pieza compartida entre peticiones lleva en su encargo de revisión el
escenario «la petición termina a medio camino», con el motor real. Lo que la misma revisión
encontró además. La comprobación de clase del guardia de red buscaba el texto
`globalThis.fetch` y se burlaba de 5 formas; ahora mira lo que la prueba importa, y toda prueba
que carga algo de `../src/` lleva el guardia. El `TimeoutError` del plazo total se reconocía por
nombre y uno ajeno que viniera del proxy se saltaba el manejo de proxy caído; ahora se reconoce
por una marca propia. Y 6 mutantes pasaban en verde, entre ellos el del plazo total que no
devolvía su cupo.

**43. En Cloudflare el reloj esconde la CPU, y el limitador no puede ver una detención (10 de
octubre de 2026).** Qué falló. El cuarto diseño del limitador (lección 42) se apoyaba en que
un temporizador que corre atrasado lo nota, corta su racha y no barre. Eso es cierto en Node y
en workerd local. En Cloudflare no. Lo midió un Worker de sonda desplegado aparte
(`npm run sonda`), y todo lo que sigue es medición, con cuántas corridas.

- `Date.now()` y `performance.now()` no avanzan mientras el Worker gasta CPU. 0 ms dentro de un
  bucle de 6 segundos.
- Un temporizador atrasado ve la hora para la que estaba programado. Tras 6 segundos de CPU en
  otra petición del mismo aislado, una cadena de temporizadores de 50 ms vio huecos de 50, y un
  intervalo de 1000 vio huecos de 1000 (3 de 3). O sea, **`cmf_hilo_detenido` no puede salir en
  producción por CPU. Que haya 0 en Workers Logs no dice que no hubo detenciones.**
- La detención es real. Una petición que lee el reloj con una entrada real (una lectura del
  caché) vio huecos de 7,3 y 7,7 segundos con 5 de CPU en otra petición.
- Un programa de `/codigo` que gasta CPU detiene al Worker principal. 4,9 y 4,2 segundos de
  hueco con 5 de CPU en la caja aislada.
- Los temporizadores atrasados corren apenas el hilo queda libre y se ponen al día en
  milisegundos. Una cadena que pedía 9000 ms terminó a los 9000 de reloj real con 5 segundos
  de CPU en medio (3 de 3).
- Cloudflare reparte las peticiones entre varios aislados. 9 juntas cayeron en 3. **El
  limitador es uno por aislado, así que el tope de 4 en vuelo es por aislado, no del servidor.**
- Una sola petición recibe 20000 temporizadores por segundo sin atraso (1000 cadenas, 80000
  corridas en 4014 ms). El tope de unos 70 por segundo de workerd local es de Windows.

La falla, 3 corridas de 3. Una petición con 10 consultas (4 con cupo y 6 en la cola), otras 2
haciendo cola, y 6 segundos de CPU en otra petición. 4 o 5 cupos vivos dados por muertos, con
`sin_senal_ms` de 5050, y 8 en vuelo con tope de 4. Con 4 peticiones de 1 consulta, nada (5 de
5). Causa raíz. Tras la detención cada petición se pone al día con su propio reloj, un
temporizador por turno. Una petición con un solo sondeo de 50 ms avanza 50 ms por turno, y la
de 10 consultas necesita 124 turnos por cada segundo. A los 101 turnos el sondeo va 5050 ms
adelante de un latido que todavía no corre. Como ningún temporizador se ve atrasado, la racha
no corta nada. La séptima revisión adversarial llegó a lo mismo en workerd local por otro
camino, una detención de 6 segundos y 4 ráfagas de CPU de 900 ms, 17 rotas de 17. Prescripción.
**La gracia de un cupo tiene que ser más larga que la detención más larga que el reloj
esconde.** El tope de CPU de una petición es de 30 segundos, y `GRACIA_CUPO_DE_FABRICA_MS`
quedó en 45000. Se cambia con `CMF_GRACIA_CUPO_MS`, con un mínimo de 5000, y cada cupo lleva
la gracia de quien lo tomó. La racha sigue protegiendo donde el reloj sí avanza. Lo vigila
`test/reloj-de-cloudflare.test.ts`, con el modelo de `test/reloj-de-cloudflare.ts`, que con el
código anterior da lo mismo que producción cifra por cifra (4 recuperados con 5050, y 0 con
peticiones sueltas). En workerd lo vigilan los escenarios `rafagas-de-cpu` y su control, que
con la gracia de 5 segundos tiene que romperse. **Verificado en Cloudflare con la sonda y el
cliente nuevo.** el mismo experimento que fallaba 3 de 3 dio 0 vivos dados por muertos y
máximo 4 en vuelo, en 3 corridas válidas de 3. Los límites que quedan, aceptados. Una
detención escondida de más de 44 segundos todavía puede dar por muerto a un vivo. Y la gracia
larga tiene su costo. el cupo de una consulta muerta de verdad tarda 45 segundos en volver.
Las reglas. **Una frase sobre el motor se mide en el motor de producción, no solo en el local.**
Los 4 diseños anteriores se midieron en Node y en workerd, y los 2 tienen un reloj que
producción no tiene. **Y lo que solo pasa en producción se lleva a la suite con un modelo, y
el modelo se valida contra la medición antes de creerle.** Para leer Workers Logs. el filtro
`$metadata.message` con `includes` no encuentra los mensajes que son JSON, y da 0 con líneas
que sí existen. Se filtra por `$metadata.level` igual a `warn` y se clasifica en local por el
campo `source`. Una ventana de 1 día viene completa y una de 7 viene muestreada.

**44. Lo que una petición deja pendiente al responder se abandona, salvo que esté en su
waitUntil (10 de octubre de 2026).** Qué falló, medido con la sonda. Un cliente que corta la
conexión mata la petición. La consulta que esperaba a la red no había terminado 26 segundos
después (2 de 2), y su cupo siguió tomado hasta que otra petición lo barrió. Y el vigía de la
lección 42 moría con su petición. con 3 cupos muertos y 8 consultas cortas de a una, en
workerd volvían 0 cupos. Prescripción. `src/client/peticion.ts` guarda el `ctx.waitUntil` de la
petición en curso en un `AsyncLocalStorage`. `src/worker.ts` lo deja en sus 2 entradas, la
petición HTTP y cada llamada del puente de `/codigo`. `fetchCmf` mantiene viva a su petición
hasta que la consulta termina, y el vigía hasta que barre o vence, a lo más 5 segundos.
Workers da hasta 30 segundos después de la respuesta. Fuera de un Worker no hay petición en
curso y nada cambia. Lo vigila `test/peticion-del-worker.test.ts`, que además falla si alguna
de las 2 entradas del Worker deja de pasar por `peticionEnCurso.run`. En workerd, los
escenarios `cupos-muertos-con-poco-trafico` y `peticion-cortada-termina-sola`. **Verificado en
Cloudflare con la sonda.** una consulta de 20 segundos cuya petición se cortó a los 1500 ms
terminó sola y devolvió su cupo, sin ninguna línea `cmf_cupo_recuperado` (3 de 3, 2 de ellas
con el cliente de afuera cerrando la conexión). El costo que hay que conocer. Una consulta
cuyo cliente ya se fue sigue consultando a la CMF hasta terminar, a lo más 30 segundos. Y una
que estaba en la cola cuando su cliente se fue ya no muere ahí. toma su cupo y sale a la red. Regla. **en Workers, todo trabajo que tiene que terminar aunque la
petición responda se registra en waitUntil en el momento en que nace.**

**45. La memoria se mide antes de arreglarla, porque la causa que uno trae escrita puede no
ser la mayor (10 de octubre de 2026).** Qué pasó. La lección 42 dejó escrito que un documento
ocupaba más de 4 veces su tamaño porque `resolverChallenge` lo leía sobre un `clone()`. El
primer arreglo hizo exactamente eso, leerlo una vez con `arrayBuffer()` y rearmar la
respuesta, y la medición salió PEOR. 256 MB sobre la base para un documento de 40, contra 174.
El costo no era el `clone()`. eran las copias. Y al medir el camino completo de la tool
apareció algo que nadie había mirado. `tramoBase64` pasaba el archivo ENTERO a base64 en cada
llamada para entregar un tramo de 200.000 caracteres, y un documento de 10 MB por
`cmf_documento_descargar` subía la memoria en 105 MB, con 128 en total para el Worker.
Prescripción, las 3 partes. `leerCuerpoUnaVez` de `src/client/anti-bot.ts` copia los tramos a
un solo bloque del largo declarado a medida que llegan, y entrega una respuesta cuyo cuerpo es
ese mismo bloque. `bytesDe(res)` lo devuelve sin otra copia, y lo usan los ayudantes del
cliente y `cmf_documento_descargar`. `tramoBase64` codifica solo los bytes del tramo. Y hay un
tope, `MAX_BYTES_DE_UNA_RESPUESTA`, de 20 MB. sobre eso el cliente lanza
`RespuestaDemasiadoGrande`, que dice el peso y el tope, antes de bajar un byte si el largo
venía declarado. No se reintenta y no cuenta como proxy caído. Los números, en MB que sube la
memoria del proceso workerd sobre su base de unos 57, medidos con `npm run workerd:memoria`.

| camino | 10 MB | 20 MB |
|---|---|---|
| antes, cualquier camino del cliente | 56 | 112 |
| antes, `cmf_documento_descargar` con su base64 | 105 | 206 |
| ahora, tools que bajan documentos, con largo declarado | 25 | 49 |
| ahora, lo mismo sin largo declarado | 34 | 65 |
| ahora, `fetchCmf` directo con `arrayBuffer()` | 52 | 102 |

**El tamaño seguro medido es 20 MB**, por los caminos de las tools. 110 MB de proceso con el
largo declarado y 125 sin él. Por `fetchCmf` directo con `arrayBuffer()` el seguro es 10 MB, y
por eso quien baja algo grande usa `bytesDe`. La medida es la memoria del proceso entero, que
es más que la del aislado, así que el margen real es mayor que el que muestra la tabla. Con la
sonda original de `C:\dev\cmf-mcp-memoria`, que lee con `arrayBuffer()`, 10 MB pasaron de 56
a 52, 20 MB de 112 a 102, y los 40 MB, que ocupaban 174, ahora se rechazan. Lo vigilan
`test/memoria-del-documento.test.ts` y `test/descargas.test.ts`. Lo que queda abierto.
`cacheBinario` guarda hasta 100 documentos por 15 minutos sin tope de bytes, así que varios
documentos grandes seguidos por `cmf_empresa_paquete_documentos` pueden llenar la memoria
aunque cada uno quepa. Regla. **un arreglo de memoria se mide con la misma sonda antes y
después, por cada camino que usa el dato, y el camino completo de la tool cuenta más que el
del cliente.**

**46. Lo que dejó la séptima revisión adversarial, y lo que se acepta sin arreglar (10 de
octubre de 2026).** Arreglado, cada cosa con su prueba. Quien esperaba fuera de la cola llena
perdía su lugar frente a quien llegaba después, y ahora las de afuera tienen su fila en orden
de llegada (`afuera` en el limitador). Cada rechazo por cola llena dejaba su línea, y ahora
sale una por ráfaga con la cuenta en `rechazadas`. La línea sale 1 segundo después del primer
rechazo y cuenta la cola de ESE momento. la primera versión la leía al salir, y con la máquina
cargada decía «en_cola 0» para una cola que estuvo llena (1 corrida roja de 3 con la CPU
ocupada). Una comilla sin cerrar en la cabecera
Cookie de quien llama dejaba la cookie vieja y repetía la del jar en cada pasada. Y las
pruebas de `test/cuerpo-sin-fin.test.ts` pasan un plazo de cupo de 5 segundos. con un cupo
perdido, el archivo tardaba más de media hora en dar rojo y ahora tarda 82 segundos.

Lo que se acepta, con el número que lo midió.

- **En workerd local sobre Windows una petición recibe unos 70 temporizadores por segundo.**
  Una petición con 400 consultas atrasa sus propios latidos a uno cada 6,9 segundos, y con la
  gracia de 5 segundos otra petición le barría cupos vivos (4 de 4). En Cloudflare no pasa. una
  petición recibió 20000 por segundo. Un escenario de workerd con cientos de consultas en una
  sola petición mide el reloj de Windows, no el limitador.
- **Con el hilo detenido 1,1 segundos cada 2,4 a 3,5, nadie junta la racha de 2,5 segundos**, y
  los cupos muertos no vuelven mientras dure ese ritmo (4 de 4, en Node). Se cura sola cuando
  el ritmo termina.
- **Un latido que corre con casi 1 segundo de atraso todavía cuenta como a tiempo y barre.** Si
  la detención cae en una fase de decenas de milisegundos, saca de la cola a puestos vivos, que
  vuelven al final (5 de 5 con la fase armada). Pierden su lugar. No se pierde ningún cupo.

Los mutantes que quedan vivos, con su razón. El atraso tolerado en 2500 o en 4000 ms no cambia
nada para los cupos, porque una detención más corta que eso, más 1 segundo de latido, no llega
a la gracia mínima de 5. Rechazar por cola llena aunque haya lugar necesita una ventana de 50
ms entre 2 sondeos. Dejar a una consulta rechazada o rendida en la fila de afuera se cura a
los 2 segundos con el barrido de esa fila. El vigía que no vence por tiempo y el que no libera
su turno al terminar solo cuestan tiempo. Las reglas de prueba que dejó el día. **Una prueba
que con el mutante puesto se cuelga no es una prueba.** Los cuerpos de una prueba son
finitos, para que si nadie los corta la prueba dé rojo. Y 2 bloques grandes no se comparan
con `deepEqual`, que con 300.000 bytes distintos tarda minutos en armar el mensaje. **Y el
mutante se corre contra la prueba recién escrita antes de darla por buena.** La prueba de la
detención de 4,9 segundos partía 1100 ms después de una señal de vida, la señal quedaba en 5,0
segundos justos, y el mutante sobrevivía. Con 1900 ms queda en 5,8.

## Gotchas

- **Un reemplazo de texto por script va con calce exacto y sin barras invertidas.** El hook de
  los heredoc no cubre `node -e`. El 10 de octubre de 2026 pasaron 2 textos con `\n` por
  `node -e`, y no hubo daño solo porque el reemplazo exigía que el texto buscado apareciera
  exactamente 1 vez. Si el texto lleva una barra, va con Edit.
- **La sonda recién desplegada responde «error code: 1042» unos segundos.** Es la dirección
  workers.dev que todavía no se propaga. Se espera a que `/id` responda 200.
- **En un bucle que gasta CPU, un contador sobre mil millones cuesta 3 veces más por vuelta.**
  Deja de ser un entero chico para el motor. 6 segundos pedidos fueron 18. La sonda quema CPU
  en 2 bucles anidados por eso.

- **La fuente se cae, y eso no es un defecto tuyo.** El servlet BaseDato devuelve a veces el
  desafío anti-bot en vez de la tabla. Un plazo agotado es evidencia sobre la CMF, no sobre el
  código. Reintenta antes de declarar un hallazgo.
- **Una prueba de tiempos se mide desde el lanzamiento.** `test/rate-limit.test.ts` medía desde
  la primera llamada que veía salir, y con la máquina cargada esa primera sale hasta 26 ms tarde
  con el limitador sano (2 rojos en 48 corridas, 9 de octubre de 2026). La carga solo puede
  ATRASAR una llamada, así que la vara es un instante anterior a todo, nunca un evento medido.
  `test/salida-proxy.test.ts` tenía la misma vara y botó un pre-commit ese mismo día, porque
  arreglé la primera sin buscar a su hermana. Al corregir una prueba de tiempos, busca las demás
  con `grep -rn "Date.now()" test/*.test.ts`.
- **Toda prueba que carga código de `../src/` importa primero `./sin-red-real.js`.** Al terminar, una prueba que simula la red
  devuelve `globalThis.fetch` a su valor original, y una consulta que siga viva sale con ese
  original. Sin el guardia es la red real. El 9 de octubre de 2026 una prueba falló antes de
  esperar a sus consultas en cola y hasta 4 GET salieron a `tasas.cmfchile.cl`. Lo vigila
  `test/sin-red-real.test.ts`. Y una prueba con consultas de fondo las espera aunque falle,
  con `yEsperar` de `test/tope-en-vuelo.test.ts`, o la prueba siguiente parte sin cupo.
- **Con la máquina cargada, `npx` tarda minutos y parece colgado.** El mismo comando con
  `node node_modules/tsx/dist/cli.mjs --test test/<archivo>.test.ts` responde en segundos. Antes
  de declarar colgada una prueba, mira la CPU por proceso.
- **Un proceso colgado se detiene por la RUTA de tu árbol de trabajo, no por el nombre de la
  prueba.** Los árboles hermanos corren pruebas con el mismo nombre. El 9 de octubre de 2026 un
  filtro por `tope-en-vuelo` detuvo también 4 procesos de `C:\dev\cmf-mcp-liberar`.
- **Las tools de `www.cmfchile.cl` dependen de Floki.** Si todas responden 403 a la vez, mira
  primero si la salida chilena está viva, con los comandos de `infra/salida-chilena/README.md`,
  y busca `cmf_salida` con `proxy_fallo` en Workers Logs. Ver la lección 36.
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
