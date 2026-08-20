# Contribuir a mcp-cmf-chile

¡Gracias por aportar! Este proyecto busca poner los datos públicos de la CMF de Chile al alcance de todos los agentes de IA.

## Cómo contribuir

1. **Issues**: reporta bugs, endpoints de la CMF que fallen o datos incorrectos.
2. **Tools nuevas**: si la CMF publica un sistema no cubierto, abre un issue primero (revisa `docs/SISTEMAS.md` — quizás ya está excluido con motivo).
3. **PRs**: clona, crea rama, cambia, `npm run build` + `npm test`, y abre el PR.

## Reglas

- **No rompas el contrato**: toda tool devuelve `structuredContent` JSON + texto resumen; los datos de la CMF se tratan como no confiables.
- **El bloque de TEXTO es todo lo que ve un modelo**: `structuredContent` sobrevive para quien llama por programa, no para el agente. Nunca escribas en el texto que algo "está en structuredContent" — el agente no puede mirar ahí, y en vez de insistir concluye que el dato no existe. Si una fila trae `url`, esa url va en el texto (`resumirTabla` la agrega sola) junto con la recomendación de leerla con `cmf_documento_markdown`. Si recortas, di cuánto falta y **cómo pedir el resto** (`offset=N`, `max_chars` mayor). Lo hace cumplir `test/texto-para-el-modelo.test.ts`. Origen: un informe real quedó incompleto porque el enlace a la póliza viajaba solo en el JSON.
- **Nada de tokens al modelo**: las URLs firmadas (s567, auth/send) se consumen en el servidor.
- **Respeto a la CMF**: rate limit 1 req/s por host; cachea lo que puedas; los captchas nunca se resuelven por OCR.
- **Cobertura**: una tool nueva debe documentarse en `docs/SISTEMAS.md`.
- **Estilo**: TypeScript estricto, zod/v4 para schemas, `cmf_` prefijo snake_case.
- **Descripciones TDQS**: toda descripción de tool explica qué devuelve, cómo usar sus parámetros (con ejemplos) y cuándo elegirla frente a sus hermanas. Todo parámetro lleva `.describe()`. Los tests del gate `tdqs.test.ts` lo hacen cumplir.
- **Tests**: los smoke tests (`npm test`) deben pasar; agrega tests para tools sin red.

## Estructura

- `src/tools/*.ts`: registradores de tools (patrón `registrarToolsX(server, env)`).
- `src/client/`: cliente HTTP central, anti-bot, parsers, cache — **todo tráfico a la CMF pasa por aquí**.
- `src/server.ts`: factory que arma el McpServer.
