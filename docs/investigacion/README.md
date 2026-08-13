# Investigación de sistemas legacy de la CMF (fuente de verdad: el sitio real)

Metodología adaptada de `js-reverse` (reverse-skill): **Observe → Capture → Evidencia**, pasiva,
solo páginas públicas de www.cmfchile.cl y sus endpoints documentados en su propio JS.
Sin herramientas intrusivas, sin auth, rate limit 1 req/s, todo hallazgo con evidencia reproducible.

Cada escuadrón investiga un lote y escribe su veredicto en `docs/investigacion/<lote>.md`:
por sistema: **SOLUCION** (endpoint real + params + formato + ejemplo de output) o **MUERTO**
(sin ruta pública de datos, con la evidencia de por qué).
