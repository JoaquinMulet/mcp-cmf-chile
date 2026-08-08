# MCP para la CMF de Chile 🇨🇱

Servidor **Model Context Protocol** (spec 2026-07-28) con **todos los datos públicos de la Comisión para el Mercado Financiero de Chile (CMF)**: empresas en bolsa, estados financieros (EEFF), hechos esenciales, fondos mutuos, fondos de inversión, normativa, seguros, indicadores económicos y bancos.

**Libre, gratuito y open-source (MIT)** — un aporte a la sociedad chilena: conecta tus agentes de IA a la información oficial del regulador financiero sin costos ni claves.

---

## 🚀 Instalación rápida (versión hosteada por nosotros)

**No necesitas instalar ni hostear nada.** El servidor ya está en línea y puedes conectarte directamente:

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

### Probar sin instalar nada

- **MCP Inspector**: `npx @modelcontextprotocol/inspector@latest` → URL → Connect → List Tools.

> Más ejemplos en [`docs/CONEXION.md`](docs/CONEXION.md).

---

## Qué es

Un puente entre los agentes de IA y la información pública del regulador financiero chileno. Con 82 herramientas, el servidor expone:

- **Empresas en bolsa**: búsqueda por nombre/RUT/ticker, estados financieros (EEFF IFRS/NCH con tablas estructuradas), hechos esenciales, accionistas, directorio, sanciones, resoluciones, juntas, memoria anual, indicadores ASG, dividendos, APV, tomas de control e intermediarios.
- **Fondos mutuos**: catálogo completo (3.400+ fondos), cartera, comisiones, inversiones, patrimonio, rentabilidad, partícipes, costos TAC, cartola diaria y comisiones máximas.
- **Fondos de inversión**: catálogo, estados financieros IFRS y comisiones máximas.
- **Indicadores económicos (API oficial v3)**: UF, dólar, euro, TAB, UTM, IPC, TIP, TMC, balances y resultados de bancos.
- **Normativa, seguros (incl. registro de depósito de pólizas), XBRL, documentos firmados y sistemas bancarios**.
- **Paquetes de alto nivel**: descarga completa de una empresa en 2 llamadas (árbol de directorio + ZIP ordenado con manifiesto), boletines mensuales de fondos mutuos y catálogo completo de entidades. Ver [`docs/PAQUETES.md`](docs/PAQUETES.md).

## Paquetes de alto nivel

**Descarga todo lo de una empresa en 2 llamadas**:

1. `cmf_empresa_paquete` (rut) → plan de descarga: árbol de directorio lógico + manifest de documentos con nombres normalizados.
2. `cmf_empresa_paquete_documentos` (rut, anio_inicio, anio_fin) → ZIP ordenado en base64 con los documentos.

```text
copec_90690000/
├── eeff/202512/eeff_xbrl_202512.zip, eeff_202512.pdf, analisis_razonado_202512.pdf…
├── hechos/2026/hechos_relevantes_20260315_12345.pdf
├── sanciones/2026/sancion_20260701_007.pdf
├── resoluciones/2026/resolucion_20260402_112.pdf
├── memorias/memoria_anual_2025.pdf
└── manifiesto.json
```

Otras: `cmf_fondos_paquete_mensual` (boletines FM de un mes) y `cmf_catalogo_entidades` (catálogo completo filtrable).

## Instalación local (STDIO)

```bash
git clone https://github.com/JoaquinMulet/mcp-cmf-chile.git
cd mcp-cmf-chile
npm install
npm run build
npm test          # smoke tests (sin red)
npm run dev       # STDIO: node dist/index.js
```

Configura tu agente para lanzarlo como proceso:

```json
{
  "mcpServers": {
    "cmf-chile": {
      "command": "node",
      "args": ["/ruta/a/mcp-cmf-chile/dist/index.js"]
    }
  }
}
```

> Opcional: `CMF_API_KEY` habilita las tools de la API oficial v3 (indicadores, balances). Se obtiene gratis en la CMF.

## Arquitectura

```
src/
├── worker.ts            # Entrypoint HTTP remoto: createMcpHandler (agents) + auth opcional
├── index.ts             # Entrypoint STDIO local
├── server.ts            # Factory per-request: registra 86 tools + 7 resources + 3 prompts
├── client/
│   ├── cmf-client.ts    # Cliente HTTP central: allowlist, UA, cookies, rate limit, retry
│   ├── anti-bot.ts      # Resolución del challenge anti-bot F5 (por HTTP, sin ejecutar JS)
│   ├── cache.ts         # LRU + TTL
│   └── parsers.ts       # HTML→JSON, TXT CSV→JSON, XLS/BIFF→JSON, grids GoogleVis, mojibake
├── tools/               # api-oficial, empresas, fondos-mutuos, fondos-inversion, otros, paquete
├── resources.ts         # cmf://entidades/{rut}, cmf://indicadores/…, cmf://captcha/{id}, …
├── prompts.ts           # cmf_analizar_empresa, cmf_comparar_fondos, cmf_indicadores_economicos
└── captcha.ts           # Store de captchas (KV, TTL 10 min, single-use) para MRTR
```

## Seguridad y buenas prácticas

- La API key de la CMF vive **solo en el servidor**; nunca se expone al modelo.
- Los datos de la CMF se tratan como **no confiables**: siempre `structuredContent` JSON, nunca HTML crudo.
- **Captchas** (hechos globales, cartola diaria): se solicitan vía MRTR (`input_required`) con la imagen como resource `cmf://captcha/{id}`; nunca OCR automático.
- **Rate limiting** hacia la CMF (1 req/s por host) y respeto a la cuota de la API oficial.
- Tokens firmados efímeros (ver_sgd) nunca llegan al modelo.
- Incluye `CMF_HTTP_TOKEN` (bearer) opcional para quienes desplieguen su instancia privada.

## Contribuir

Lee [`CONTRIBUTING.md`](CONTRIBUTING.md). Ideas bienvenidas: nuevas tools, parsers, tests de integración, traducciones.

## Aviso legal

Los datos servidos son **públicos y de acceso abierto** de la Comisión para el Mercado Financiero de Chile (CMF). Este proyecto **no está afiliado ni respaldado por la CMF**. Los datos se entregan "tal cual"; verifique la fuente oficial para decisiones financieras.
