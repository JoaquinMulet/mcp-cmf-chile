# Conexión del MCP de la CMF

## Hosteado por nosotros (recomendado)

Conecta tu agente directamente a la URL pública — sin instalar nada:

```
https://cmf-mcp.kumocloud.cl/mcp
```

### opencode (`opencode.json`)

```json
{
  "mcp": {
    "cmf-chile": {
      "type": "remote",
      "url": "https://cmf-mcp.kumocloud.cl/mcp"
    }
  }
}
```

### Claude Desktop / Cursor / Windsurf (clientes locales)

Usa el adaptador `mcp-remote`:

```json
{
  "mcpServers": {
    "cmf-chile": {
      "command": "npx",
      "args": ["mcp-remote", "https://cmf-mcp.kumocloud.cl/mcp"]
    }
  }
}
```

### Probarlo sin instalar nada

- **MCP Inspector**: `npx @modelcontextprotocol/inspector@latest` → URL del server → Connect → List Tools.

## Instancia local (STDIO)

```bash
git clone https://github.com/JoaquinMulet/mcp-cmf-chile.git
cd mcp-cmf-chile
npm install
npm run build
```

```json
{
  "mcpServers": {
    "cmf-chile": {
      "command": "node",
      "args": ["/ruta/absoluta/mcp-cmf-chile/dist/index.js"]
    }
  }
}
```

(opcional: exporta `CMF_API_KEY` para las tools de indicadores/bancos de la API oficial)

## Notas

- **Compatibilidad**: el endpoint sirve clientes MCP 2026-07-28 (stateless) y clientes legacy 2025 (initialize) en el mismo `/mcp`.
- **Captchas**: las tools `cmf_hechos_globales` y `cmf_fondos_mutuos_cartola` requieren el código captcha de la CMF. En clientes modernos se solicita automáticamente (MRTR); en clientes legacy remotos devuelven un error claro.
- **Límites**: respeta ~1 req/s hacia la CMF; la API oficial tiene cuota de 10.000 req/mes por key.
