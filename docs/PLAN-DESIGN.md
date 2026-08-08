# Plan: Aplicación de Design Principles y SEP Guidelines de MCP a mcp-cmf-chile

Objetivo: alinear el servidor `mcp-cmf-chile` (84 tools, hosteado en cmf-mcp.kumocloud.cl/mcp) con los 8 Design Principles de MCP y las SEP Guidelines de la comunidad. Fuentes: modelcontextprotocol.io/community/design-principles y /sep-guidelines.

## A. Convergence over choice — una sola forma por problema

1. **Auditoría de duplicación**: revisar las 84 tools y detectar pares con la misma capacidad (candidatos: `cmf_buscar_entidad` vs `cmf_empresa_por_ticker`; `cmf_empresa_paquete` vs tools individuales). Para cada par: decidir la tool canónica y documentar la división de responsabilidad (ticker→RUT del repo vs búsqueda CMF por nombre; paquete = orquestación, no duplicación). Resultado en docs/DECISIONES.md.
2. **Helpers únicos**: confirmar que paginación (util/paginate), errores (util/errors) y fecha (schemas) tienen una sola implementación; eliminar cualquier duplicado.

## B. Composability over specificity — primitivas, no features ad-hoc

3. Auditoría: toda capacidad nueva debe expresarse como tools + resources + prompts (no primitivas inventadas). Ya usamos resources para captcha y skill (`cmf://skill/uso`, alineado al SEP-2640 Skills Extension) y prompts para flujos. Documentar en DECISIONES.md qué se compone de qué (ej: paquetes = tools existentes orquestadas).
4. No agregar primitivas: si una necesidad aparece, primero intentar con tools/prompts/resources existentes.

## C. Interoperability over optimization — degradación elegante

5. **Texto autosuficiente**: auditar que el `content[0].text` de CADA tool sea comprensible sin `structuredContent` (clientes simples, modelos débiles). Corregir resúmenes que dependan solo de sc.
6. Verificar doble era (2025 legacy + 2026-07-28) documentada como capacidad (ya operativa; dejar constancia).
7. `instructions` de discover presentes (ya) y enriquecidas si la auditoría revela huecos.

## D. Stability over velocity — contratos estables

8. **Congelar catálogo v1**: server version 0.1.0; regla en CONTRIBUTING: no renombrar/eliminar tools sin deprecación (mín. 12 meses, siguiendo el feature lifecycle de MCP). Deprecación = nueva tool con prefijo y nota en instructions.
9. **Semver**: documentar política de versionado (breaking → 1.0; aditivo → 0.x) en README y CONTRIBUTING.

## E. Capability over compensation — sin parches permanentes por modelos limitados

10. Revisar si algún parámetro/estructura existe solo "para que el modelo no se equivoque" (ej: `max_chars`, `cuentas`, `incluir_tablas` son límites de contexto reales — se mantienen; `advertencia` de CPU es informativa — se mantiene). Documentar el criterio de revisión en CONTRIBUTING.

## F. Demonstration over deliberation — evidencia real

11. **CI**: agregar GitHub Actions que corra `npm run build`, `npm test` y `npm run verify` (suite de 96+ endpoints contra la CMF real) en cada push/PR.
12. Publicar `docs/VERIFICACION.md`: resultados reproducibles de la suite (fecha, total, pass/fail, endpoints probados).

## G. Pragmatism over purity — tradeoffs documentados

13. **docs/DECISIONES.md** (formato estilo SEP: Motivation / Specification / Rationale / Backward Compatibility / Security) con las decisiones clave del proyecto:
    - Captchas por MRTR sin OCR (y limitación de la lane legacy remota)
    - Límites de ventanas en paquetes (30s del worker)
    - ZIP store sin jszip (PDF ya comprimidos)
    - Tickers/RUTs desde el repo empresas-cmf-chile (KV 24h)
    - PDF→Markdown con wasm de pdf-inspector en el worker (bundle 2.4MB gzip)
    - Anti-bot F5 resuelto por HTTP (sin ejecutar JS)
    - Público sin auth (datos públicos read-only) + CMF_HTTP_TOKEN opcional
    - Exclusiones: BEST, portales con datos personales (conocetudeuda/conocetuseguro), supervisa, SIAC4, clave única
    - Encoding/mojibake de los sistemas legacy

## H. Standardization over innovation — estándares, no inventos

14. **Auditoría de estándares** (verificar y corregir si falta):
    - Nombres de tools: snake_case, 1-64 chars, sin `/` (SEP-986) — verificar las 84
    - `outputSchema`: JSON Schema 2020-12 con `additionalProperties: false` en TODAS las tools que declaran outputSchema (SEP-2106) — el SDK ya lo genera; verificar
    - `annotations: { readOnlyHint: true, destructiveHint: false }` visibles en tools/list (Tool Annotations)
    - `resultType: "complete"` en respuestas (spec 2026-07-28) — el SDK lo añade; verificar
    - Errores de validación como tool execution errors `isError: true` (SEP-1303) — ya implementado; verificar cobertura
    - `cacheHint`/`ttlMs` donde aplique (resources/read de documentos)
    - Recursos con mimeType correcto y templates listables (ya)
15. **skills**: la skill `cmf://skill/uso` sigue el formato Agent Skills y el rumbo del WG Skills Over MCP (SEP-2640); documentarlo.

## I. SEP Guidelines — participación comunitaria

16. **CONTRIBUTING.md**: nueva sección "Propuestas al protocolo MCP": qué cambios locales van por PR normal (bugs, docs, features del server) vs qué iría por SEP (cambios al protocolo/extensión) — con el flujo resumido (Draft → sponsor → in-review → accepted → final, prototype obligatorio, conformance para standards track).
17. (Opcional, no bloqueante) Si queremos proponer a la comunidad la estandarización de "PDF→Markdown como pattern" o la skill-resource, preparar borrador SEP siguiendo el template; NO enviar sin discusión en Discord/Working Group (guideline explícita).

## Criterios de aceptación (para el agente adversarial)

- Cada principio mapeado a una acción verificable (no solo declarativa)
- Auditoría H con evidencia: correr tools/list y verificar annotations, outputSchema, resultType, nombres
- docs/DECISIONES.md y docs/VERIFICACION.md creados
- CI funcionando (GitHub Actions verde)
- Cero cambios breaking en el contrato actual (84 tools intactas)
