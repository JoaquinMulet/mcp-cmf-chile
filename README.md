# MCP para la CMF de Chile 🇨🇱

Servidor **Model Context Protocol** (spec 2026-07-28, dual-era: también responde el handshake `initialize` legacy 2025-11-25) con **todos los datos públicos de la Comisión para el Mercado Financiero de Chile (CMF)**: empresas en bolsa, estados financieros (EEFF), hechos esenciales, fondos mutuos, fondos de inversión, normativa, seguros, indicadores económicos y bancos.

**Libre, gratuito y open-source (MIT)** — un aporte a la sociedad chilena: conecta tus agentes de IA a la información oficial del regulador financiero sin costos ni claves.

---

## 🚀 Instalación rápida (versión hosteada por nosotros)

**No necesitas instalar ni hostear nada.** El servidor ya está en línea y hay 2 rutas para conectarse.

**Modo código, recomendado.** 2 herramientas.

```
https://cmf-mcp.kumocloud.cl/mcp/codigo
```

**Modo clásico.** 86 herramientas, una por operación.

```
https://cmf-mcp.kumocloud.cl/mcp
```

Las 2 rutas sirven exactamente las mismas 86 operaciones, sobre el mismo
registro. Cambia cómo se exponen. En modo clásico cada operación es una
herramienta MCP, y las 86 definiciones viajan en cada petición del
modelo, unos 37 mil tokens medidos. En modo código hay 2 herramientas y
el modelo escribe JavaScript, con un costo fijo de unos 736 tokens. Es
un 98 por ciento menos, y no crece si mañana hay 200 operaciones.

Elige el modo al conectarte. Son 2 servidores MCP distintos, cada uno
en su propio endpoint y con su propio `serverInfo`, no un servidor que
cambia de forma. La norma dice que el conjunto de herramientas "MUST NOT
vary per-connection or as a side effect of other requests on the
connection", así que un servidor cuyo conjunto dependiera de por dónde
entró el cliente no cumpliría. El conjunto de cada endpoint es fijo.

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

---

## Modo código (2 herramientas en vez de 86)

En la ruta `/mcp/codigo` el servidor expone solo `cmf_buscar` y
`cmf_ejecutar`. Las 2 reciben JavaScript y devuelven lo que ese código
retorne.

1. **`cmf_buscar`** te da la variable `catalogo`, un arreglo con las 86
   operaciones y sus parámetros. Escribes código que lo filtra. El
   catálogo nunca entra a tu contexto, solo entra lo que devuelvas.
2. **`cmf_ejecutar`** te da además `cmf`, con una función async por
   operación. Llamas las que necesites, filtras el resultado y devuelves
   solo lo útil.

En los 2 casos escribes el CUERPO de una función async y usas `return`.
Lo que imprimas con `console.log` también te llega.

```js
// cmf_buscar. qué operaciones hay sobre pólizas
return catalogo
  .filter(o => /poliza|seguros/i.test(o.nombre + o.resumen))
  .map(o => ({ nombre: o.nombre, params: o.params }))
```

```js
// cmf_ejecutar. buscar la póliza, bajar su documento y recorrerlo
const r = await cmf.seguros_deposito_polizas({ poliza: "POL120260128" })
const p = r.polizas[0]
const d = await cmf.documento_markdown({ url: p.url })
const lineas = d.markdown.split("
").filter(l => /deducible/i.test(l))
return { entidad: p.entidad, largo: d.markdown.length, lineas: lineas.slice(0, 3) }
```

Ese segundo ejemplo recorre un documento de 30 mil caracteres adentro
del servidor y devuelve 3 líneas. Antes había que traer el documento
entero al contexto del modelo, o conformarse con lo que el servidor
quisiera mostrar.

### El servidor no recorta

Regla dura del proyecto. **una herramienta jamás decide por el agente
qué parte del dato merece verse.** Dentro del código, cada operación
devuelve su JSON completo, con todas las filas que pediste y todos sus
campos, incluida la url del documento. Quien filtra eres tú, en tu
código, sabiendo para qué lo necesitas.

Esto arregla un defecto real. El bloque de texto es lo único que un
modelo ve de una respuesta MCP; el `structuredContent` sobrevive solo
para quien llama por programa. El resumen en texto del modo clásico no
traía la columna `url`, así que un agente podía encontrar una póliza y
no tener nunca cómo leerla.

### La caja aislada

El código corre en un Worker cargado al vuelo, aparte del proceso del
servidor.

- **Sin salida a internet.** `globalOutbound: null`. Verificado
  intentando un `fetch` desde adentro y recibiendo el bloqueo del
  runtime.
- **Sin sistema de archivos y sin variables de entorno.**
- **Una sola puerta.** Un puente RPC con las operaciones de la CMF, que
  salen todas por el cliente HTTP del servidor, con su límite de
  velocidad, su caché y su anti-bot.
- **Presupuesto acotado.** 10 segundos de CPU y 60 subpeticiones por
  programa.

El agente que te habla nunca ejecuta código en su propia máquina. Manda
un texto y recibe un resultado.

### Cuándo usar el modo clásico

- Si tu cliente ya integró las 86 herramientas y no quieres tocarlo.
- Si tu modelo escribe JavaScript poco fiable. En modo código, un
  programa mal escrito cuesta un reintento.
- Si necesitas las herramientas con captcha. Su imagen viaja como
  recurso MCP y ese camino solo existe en modo clásico.

---

## Qué es

Un puente entre los agentes de IA y la información pública del regulador financiero chileno. Con 86 herramientas, el servidor expone:

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
├── server.ts            # Factory per-request. registra las tools segun el modo, + resources + prompts
├── registro.ts          # Captura las 86 operaciones de src/tools/ y deriva el catalogo
├── sandbox.ts           # La caja aislada. Worker cargado al vuelo, sin internet
├── client/
│   ├── cmf-client.ts    # Cliente HTTP central: allowlist, UA, cookies, rate limit, retry
│   ├── anti-bot.ts      # Resolución del challenge anti-bot F5 (por HTTP, sin ejecutar JS)
│   ├── cache.ts         # LRU + TTL
│   └── parsers.ts       # HTML→JSON, TXT CSV→JSON, XLS/BIFF→JSON, grids GoogleVis, mojibake
├── tools/               # api-oficial, empresas, fondos-mutuos, fondos-inversion, otros, paquete
│   └── code-mode.ts     # Las 2 tools del modo codigo (cmf_buscar, cmf_ejecutar)
├── resources.ts         # cmf://entidades/{rut}, cmf://indicadores/…, cmf://captcha/{id}, …
├── prompts.ts           # cmf_analizar_empresa, cmf_comparar_fondos, cmf_indicadores_economicos
└── captcha.ts           # Store de captchas (KV, TTL 10 min, single-use) para MRTR
```

## Seguridad y buenas prácticas

- La API key de la CMF vive **solo en el servidor**; nunca se expone al modelo.
- Los datos de la CMF se tratan como **no confiables**: siempre `structuredContent` JSON, nunca HTML crudo.
- **Captchas** (hechos globales, cartola diaria): al llamar la tool sin código, el servidor descarga la imagen real de la CMF y la sirve como resource `cmf://captcha/{id}`; el agente pide el código al usuario y reintenta con `captcha=<código>` (single-use, TTL 10 min); nunca OCR automático.
- **Rate limiting** hacia la CMF (1 req/s por host) y respeto a la cuota de la API oficial.
- Los enlaces firmados de la CMF (`ver_sgd`/`auth`/`send`) son **efímeros**: las tools los consumen y no requieren que el modelo maneje credenciales; no los comparta ni los trate como URLs permanentes.
- **Modo código.** El JavaScript del modelo corre en un Worker cargado al vuelo con `globalOutbound: null`, sin sistema de archivos y sin variables de entorno, con 10 segundos de CPU y 60 subpeticiones de tope. Su única puerta es un puente RPC hacia las operaciones de la CMF, así que toda petición real sale por el cliente HTTP del servidor. El bloqueo de internet está verificado contra el despliegue, no supuesto.
- Incluye `CMF_HTTP_TOKEN` (bearer) opcional para quienes desplieguen su instancia privada. Cubre las 2 rutas.
- El transport Streamable HTTP valida `Origin` (403 si está presente e inválido), exige `MCP-Protocol-Version`, `Mcp-Method`/`Mcp-Name` y `_meta` en cada request, y responde 202 a las notificaciones (lo implementa el SDK de Cloudflare, verificado en CI por `test/verify-proto.ts`).

## Solución de problemas

- **"CMF_API_KEY no configurada"**: las tools `cmf_api_*` (UF, dólar, balances bancarios) usan la API oficial v3, que requiere la key gratuita de la CMF configurada en el servidor. La instancia pública la tiene configurada; si despliegas la tuya, obtén la key en api.cmfchile.cl y defínela como secret `CMF_API_KEY` (en STDIO, variable de entorno).
- **Captcha**: la imagen vive ligada a la sesión del servidor, así que debe leerse desde el resource `cmf://captcha/{id}` que la propia tool entrega (los hosts que renderizan resources la muestran automáticamente). Si tu cliente no puede mostrar la imagen, no hay forma alternativa de completar la consulta protegida.
- **"La fuente de la CMF no devolvió datos"**: varios sistemas legacy de la CMF (normativa, dividendos, APV, clasificaciones, SCOMP…) están caídos o migrados en el propio sitio de la CMF. La tool lo dice explícitamente y da la página oficial para verificar; no significa que no existan datos.

## Versionado

Versión actual: `0.1.0` (semver). Cambios *breaking* (renombrar/eliminar tools o parámetros) requieren subir la versión minor/major y se documentan en el changelog del release. Este repositorio acaba de nacer: mientras esté en `0.x`, el contrato puede ajustarse entre releases menores si un parámetro resultó muerto o engañoso (se registra en el release).

## Contribuir

Lee [`CONTRIBUTING.md`](CONTRIBUTING.md). Ideas bienvenidas: nuevas tools, parsers, tests de integración, traducciones.

## Aviso legal

Los datos servidos son **públicos y de acceso abierto** de la Comisión para el Mercado Financiero de Chile (CMF). Este proyecto **no está afiliado ni respaldado por la CMF**. Los datos se entregan "tal cual"; verifique la fuente oficial para decisiones financieras.
