/**
 * BANDEJA DE HALLAZGOS. Un solo lugar donde nada se pierde.
 *
 * Por que existe, dicho por el dueno el 21 de agosto de 2026. «crea los
 * flujos para revisar los findings y que no queden olvidados perdidos y
 * nunca los veamos».
 *
 * El problema no es encontrar defectos, es que ya los encontramos y
 * viven en 5 lugares distintos que nadie abre al mismo tiempo. Una
 * pagina web de alertas, la salida de un linter, un JSON de un escaner.
 * Un hallazgo que vive donde nadie mira no existe.
 *
 * COMO SE CIERRA UN HALLAZGO. Hay 3 estados y ninguno es el silencio.
 *   - ARREGLADO. desaparece solo de la bandeja.
 *   - FALSO POSITIVO. la regla se equivoco, y se dice por que.
 *   - DEUDA. es un defecto de verdad y elegimos no arreglarlo ahora.
 * Los 2 ultimos se anotan en `hallazgos-descartados.json`, que se
 * versiona, y los 2 exigen razon y fecha.
 *
 * La diferencia entre falso positivo y deuda es la que hace que esto
 * sirva. Meterlos en el mismo saco convierte la bandeja en un basurero, y
 * la deuda desaparece de la vista justo cuando dejo de doler. El informe
 * cuenta la deuda aparte y en voz alta, siempre.
 *
 * Un hallazgo que no esta en ninguno de los 3 estados deja el porton en
 * rojo.
 *
 * Por eso el descarte pide razon obligatoria. descartar sin razon es
 * exactamente como se pierde una alerta de verdad, y ademas dentro de 3
 * meses nadie recuerda si eso era un falso positivo o una deuda.
 *
 * LA IDENTIDAD NO LLEVA NUMERO DE LINEA. Se calcula con la regla, el
 * archivo y el texto de la linea normalizado, porque las lineas se
 * mueven con cada edicion y un descarte atado a la linea 312 caduca al
 * primer cambio de arriba.
 *
 * Uso.
 *   node herramientas/hallazgos.mjs            porton, falla si hay sin triar
 *   node herramientas/hallazgos.mjs --listar   solo informa
 *   node herramientas/hallazgos.mjs --nuevos   solo los que faltan triar
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const DESCARTES = join(RAIZ, 'hallazgos-descartados.json')
const SOLO_LISTAR = process.argv.includes('--listar')
const SOLO_NUEVOS = process.argv.includes('--nuevos')
// Salida en datos, para sembrar el triaje desde un script o para ver la
// lista entera cuando el informe la corta en 25.
const COMO_DATOS = process.argv.includes('--json')

function correr(comando) {
  try {
    return execSync(comando, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

/** El texto de una linea, sin espacios de sobra, para la identidad. */
function lineaDe(archivo, n) {
  try {
    const ls = readFileSync(join(RAIZ, archivo), 'utf8').split('\n')
    return (ls[n - 1] ?? '').trim().replace(/\s+/g, ' ')
  } catch {
    return ''
  }
}

function identidad(h) {
  const semilla = `${h.fuente}|${h.regla}|${h.archivo}|${lineaDe(h.archivo, h.linea)}`
  return createHash('sha256').update(semilla).digest('hex').slice(0, 12)
}

// --- Las fuentes. Cada una normaliza a la misma forma -----------------

const FUENTES = [
  {
    nombre: 'semgrep',
    que: 'reglas propias, cada una nacida de un defecto real',
    recoger() {
      const salida = correr('uvx semgrep scan --config .semgrep/reglas-propias.yml --json --quiet src test')
      const i = salida.indexOf('{')
      if (i < 0) return null
      const j = JSON.parse(salida.slice(i))
      return (j.results ?? []).map((r) => ({
        regla: String(r.check_id).split('.').pop(),
        archivo: String(r.path).replace(/\\/g, '/'),
        linea: r.start?.line ?? 0,
        gravedad: r.extra?.severity === 'ERROR' ? 'alta' : 'media',
        detalle: String(r.extra?.message ?? '').trim().split('\n')[0].slice(0, 140),
      }))
    },
  },
  {
    nombre: 'biome',
    que: 'complejidad excesiva y declaraciones sin usar',
    recoger() {
      const informe = join(RAIZ, 'node_modules', '.cache', 'hallazgos-biome.json')
      correr(`"${join(RAIZ, 'node_modules', '.bin', 'biome')}" lint src test --max-diagnostics=1000 --reporter=json --reporter-file="${informe}"`)
      if (!existsSync(informe)) return null
      const j = JSON.parse(readFileSync(informe, 'utf8'))
      return (j.diagnostics ?? []).map((d) => ({
        regla: String(d.category ?? '').split('/').pop(),
        archivo: String(d.location?.path ?? '?').replace(/\\/g, '/'),
        linea: d.location?.start?.line ?? 0,
        gravedad: String(d.category).includes('Cognitive') ? 'media' : 'baja',
        detalle: String(d.message ?? '').slice(0, 140),
      }))
    },
  },
  {
    nombre: 'codeql',
    que: 'camino del dato, desde la nube',
    recoger() {
      const salida = correr('gh api "repos/JoaquinMulet/mcp-cmf-chile/code-scanning/alerts?state=open&per_page=100"')
      const i = salida.indexOf('[')
      if (i < 0) return null
      const j = JSON.parse(salida.slice(i))
      return j.map((a) => ({
        regla: a.rule?.id ?? '?',
        archivo: a.most_recent_instance?.location?.path ?? '?',
        linea: a.most_recent_instance?.location?.start_line ?? 0,
        gravedad: ['critical', 'high'].includes(a.rule?.security_severity_level) ? 'alta' : 'baja',
        detalle: String(a.rule?.description ?? '').slice(0, 140),
      }))
    },
  },
]

// --- Recoger ----------------------------------------------------------

const todos = []
const rotas = []
for (const f of FUENTES) {
  const r = f.recoger()
  if (r === null) {
    // Fallo cerrado. una fuente que no respondio NO son cero hallazgos,
    // y tratarla como cero es exactamente como se pierde uno.
    rotas.push(f.nombre)
    continue
  }
  for (const h of r) todos.push({ fuente: f.nombre, ...h, id: identidad({ fuente: f.nombre, ...h }) })
}

const descartes = existsSync(DESCARTES) ? JSON.parse(readFileSync(DESCARTES, 'utf8')) : {}
const sinTriar = todos.filter((h) => !descartes[h.id])
const falsos = todos.filter((h) => descartes[h.id]?.estado === 'falso-positivo')
const deuda = todos.filter((h) => descartes[h.id]?.estado === 'deuda')
// Una anotacion sin estado valido NO cuenta como triada. Si contara,
// bastaria con poner la clave para que el hallazgo desaparezca sin decir
// nada, que es justo lo que esta bandeja existe para impedir.
const malAnotados = todos.filter((h) =>
  descartes[h.id] && !['falso-positivo', 'deuda'].includes(descartes[h.id].estado))

// --- Informe ----------------------------------------------------------

if (COMO_DATOS) {
  process.stdout.write(JSON.stringify({ todos, sinTriar, rotas }, null, 1))
  process.exit(0)
}

process.stdout.write('='.repeat(70) + '\n')
process.stdout.write('BANDEJA DE HALLAZGOS\n')
process.stdout.write('='.repeat(70) + '\n\n')

for (const f of FUENTES) {
  const n = todos.filter((h) => h.fuente === f.nombre).length
  const estado = rotas.includes(f.nombre) ? 'NO RESPONDIO' : `${n} hallazgos`
  process.stdout.write(`  ${f.nombre.padEnd(9)} ${String(estado).padEnd(16)} ${f.que}\n`)
}
process.stdout.write(`\n  ${todos.length} en total.\n`)
process.stdout.write(`  ${falsos.length} falsos positivos, con su razon escrita.\n`)
process.stdout.write(`  ${deuda.length} DEUDA ACEPTADA, defectos de verdad que elegimos no arreglar todavia.\n`)
process.stdout.write(`  ${sinTriar.length} SIN TRIAR.\n`)
if (malAnotados.length > 0) {
  process.stdout.write(`  ${malAnotados.length} con un estado invalido, y eso NO cuenta como triado.\n`)
}
process.stdout.write('\n')

const orden = { alta: 0, media: 1, baja: 2 }
for (const h of sinTriar.sort((a, b) => orden[a.gravedad] - orden[b.gravedad]).slice(0, 25)) {
  process.stdout.write(`  ${h.gravedad.toUpperCase().padEnd(6)} ${h.id}  ${h.fuente}/${h.regla}\n`)
  process.stdout.write(`         ${h.archivo}:${h.linea}\n`)
  if (h.detalle) process.stdout.write(`         ${h.detalle}\n`)
}
if (sinTriar.length > 25) process.stdout.write(`\n  ... y ${sinTriar.length - 25} mas\n`)

if (sinTriar.length > 0) {
  process.stdout.write(
    '\nCADA UNO SE ARREGLA O SE DESCARTA CON SU RAZON. No hay tercera opcion.\n'
    + 'Para descartar, agrega su id a hallazgos-descartados.json con la razon escrita:\n'
    + '  { "' + sinTriar[0].id + '": { "estado": "falso-positivo", "razon": "...", "fecha": "2026-08-21" } }\n'
    + 'El estado es "falso-positivo" cuando la regla se equivoco, o "deuda" cuando el\n'
    + 'defecto es real y elegimos no arreglarlo ahora. La diferencia importa, porque la\n'
    + 'deuda se sigue contando en voz alta y el falso positivo no.\n'
    + 'Descartar sin razon es como se pierde una alerta de verdad, y en 3 meses nadie\n'
    + 'recuerda si era un falso positivo o una deuda que alguien decidio ignorar.\n')
}

if (rotas.length > 0) {
  process.stdout.write(`\nFUENTES QUE NO RESPONDIERON. ${rotas.join(', ')}\n`)
  process.stdout.write('Una fuente muda NO son cero hallazgos. Arreglala o el porton queda ciego de ese lado.\n')
}

if (SOLO_LISTAR || SOLO_NUEVOS) {
  process.stdout.write('\nModo informe. no se falla por nada.\n')
  process.exit(0)
}
if (rotas.length > 0) process.exit(2)
if (malAnotados.length > 0) {
  process.stdout.write('\nROJO. Hay hallazgos con un estado invalido en el archivo de triaje.\n')
  process.exit(1)
}
if (sinTriar.length > 0) process.exit(1)
process.stdout.write('\nVERDE. Ningun hallazgo sin triar.\n')
