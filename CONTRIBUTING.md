# Contribuir a mcp-cmf-chile

¡Gracias por aportar! Este proyecto busca poner los datos públicos de la CMF de Chile al alcance de todos los agentes de IA.

## Cómo contribuir

1. **Issues**: reporta bugs, endpoints de la CMF que fallen o datos incorrectos.
2. **Tools nuevas**: si la CMF publica un sistema no cubierto, abre un issue primero (revisa `docs/SISTEMAS.md` — quizás ya está excluido con motivo).
3. **PRs**: clona, crea rama, cambia, `npm run build` + `npm test`, y abre el PR.

## Reglas

- **No rompas el contrato**: toda tool devuelve `structuredContent` JSON + texto resumen; los datos de la CMF se tratan como no confiables.
- **Nada de tokens al modelo**: las URLs firmadas (s567, auth/send) se consumen en el servidor.
- **Respeto a la CMF**: rate limit 1 req/s por host; cachea lo que puedas; los captchas nunca se resuelven por OCR.
- **Cobertura**: una tool nueva debe documentarse en `docs/SISTEMAS.md`.
- **Estilo**: TypeScript estricto, zod/v4 para schemas, `cmf_` prefijo snake_case.
- **Tests**: los smoke tests (`npm test`) deben pasar; agrega tests para tools sin red.

## Estructura

- `src/tools/*.ts`: registradores de tools (patrón `registrarToolsX(server, env)`).
- `src/client/`: cliente HTTP central, anti-bot, parsers, cache — **todo tráfico a la CMF pasa por aquí**.
- `src/server.ts`: factory que arma el McpServer.
