> **Los scripts y la evidencia binaria ya no estan en el repositorio.**
> `test/investigacion/` se borro el 29 de agosto de 2026. Eran 48 archivos, entre scripts
> de exploracion de un rato y HTML, XLS y DOC capturados del sitio de la CMF. Nada de eso
> se desplegaba y nada se iba a arreglar, pero generaba 65 de las 74 alertas del analisis
> de seguridad, y para poder leer la lista habia una exclusion que dejaba esa carpeta sin
> revisar. Excluir es esconder. Borrar es no tener que esconder, y de paso el analisis
> volvio a cubrir todo el repositorio.
>
> Lo que estos documentos CUENTAN sigue siendo cierto y por eso se conservan. Los caminos
> que nombran son de www.cmfchile.cl, no del repositorio, y se pueden volver a recorrer.
> Lo que ya no se puede es abrir el archivo capturado ese dia.

# Investigación de sistemas legacy de la CMF (fuente de verdad: el sitio real)

Metodología adaptada de `js-reverse` (reverse-skill): **Observe → Capture → Evidencia**, pasiva,
solo páginas públicas de www.cmfchile.cl y sus endpoints documentados en su propio JS.
Sin herramientas intrusivas, sin auth, rate limit 1 req/s, todo hallazgo con evidencia reproducible.

Cada escuadrón investiga un lote y escribe su veredicto en `docs/investigacion/<lote>.md`:
por sistema: **SOLUCION** (endpoint real + params + formato + ejemplo de output) o **MUERTO**
(sin ruta pública de datos, con la evidencia de por qué).
