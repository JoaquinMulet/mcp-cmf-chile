/**
 * PORTON DE ALERTAS. Baja los hallazgos de seguridad de la nube al flujo
 * de trabajo local.
 *
 * Por que existe, dicho por el dueno el 21 de agosto de 2026.
 * «si no estan en el flujo de cada commit son invisibles e inservibles».
 *
 * Tenia razon y el caso fue este. encendi el analisis de seguridad en la
 * nube, lei que el trabajo habia terminado en verde, y no mire ni una
 * alerta. Habia 3 de severidad alta en codigo que se despliega, y 6
 * declaraciones sin usar que ni el linter local ni el detector de codigo
 * muerto veian. Todo eso vivio en una pagina web que nadie abrio.
 *
 * La regla general que queda. **una capa cuyo veredicto no llega al lugar
 * donde se trabaja no es una capa.** El estado de un trabajo dice si la
 * herramienta CORRIO; el conteo de hallazgos dice si encontro algo, y es
 * lo unico que vale como veredicto.
 *
 * Que hace este porton.
 *   - Falla si hay alertas de severidad alta o critica en src/, que es
 *     el codigo que se despliega.
 *   - Informa, sin fallar, las de las carpetas de prueba.
 *   - Falla si NO PUEDE consultar, en vez de dejar pasar en silencio.
 *
 * Uso.
 *   node herramientas/alertas.mjs            porton, falla con las altas
 *   node herramientas/alertas.mjs --listar   solo informa, nunca falla
 */
import { execFileSync } from 'node:child_process'

const REPO = 'JoaquinMulet/mcp-cmf-chile'
const SOLO_LISTAR = process.argv.includes('--listar')

/** Carpetas cuyo codigo llega al Worker desplegado. */
const DESPLEGADO = ['src/']
/** Severidades que bloquean. */
const BLOQUEAN = new Set(['critical', 'high'])

let crudo
try {
  crudo = execFileSync(
    process.platform === 'win32' ? 'gh.exe' : 'gh',
    ['api', `repos/${REPO}/code-scanning/alerts?state=open&per_page=100`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
} catch (e) {
  const texto = `${e.stdout ?? ''}${e.stderr ?? ''}`
  // Fallo cerrado, pero con una excepcion honesta. si el analisis nunca
  // corrio no hay nada que consultar todavia, y eso no es un fallo.
  if (/no analysis found|not enabled|404/i.test(texto)) {
    process.stdout.write('ALERTAS. el analisis de seguridad todavia no ha producido resultados.\n')
    process.exit(0)
  }
  process.stdout.write(
    'PORTON DE ALERTAS ROTO. no pude consultar los hallazgos de seguridad.\n'
    + 'Sin consulta no hay veredicto, asi que esto falla en vez de dejar pasar.\n'
    + `Detalle: ${texto.trim().slice(0, 300)}\n`
    + 'Si es un problema de credenciales, corre: gh auth status\n')
  process.exit(2)
}

let alertas
try {
  alertas = JSON.parse(crudo)
} catch {
  process.stdout.write('PORTON DE ALERTAS ROTO. la respuesta no era JSON.\n')
  process.exit(2)
}

const filas = alertas.map((a) => ({
  severidad: a.rule?.security_severity_level ?? null,
  regla: a.rule?.id ?? '?',
  ruta: a.most_recent_instance?.location?.path ?? '?',
  linea: a.most_recent_instance?.location?.start_line ?? 0,
  url: a.html_url ?? '',
}))

const enProduccion = filas.filter((f) => DESPLEGADO.some((d) => f.ruta.startsWith(d)))
const bloqueantes = enProduccion.filter((f) => BLOQUEAN.has(f.severidad))
const otrasProduccion = enProduccion.filter((f) => !BLOQUEAN.has(f.severidad))
const enPruebas = filas.filter((f) => !DESPLEGADO.some((d) => f.ruta.startsWith(d)))

process.stdout.write(
  `ALERTAS abiertas. ${filas.length} en total, ${enProduccion.length} en codigo desplegado`
  + ` (${bloqueantes.length} de severidad alta o critica), ${enPruebas.length} en pruebas.\n`)

for (const f of bloqueantes) {
  process.stdout.write(`  ALTA   ${f.regla}  ${f.ruta}:${f.linea}\n`)
}
for (const f of otrasProduccion.slice(0, 10)) {
  process.stdout.write(`  aviso  ${f.regla}  ${f.ruta}:${f.linea}\n`)
}
if (otrasProduccion.length > 10) {
  process.stdout.write(`  ... y ${otrasProduccion.length - 10} avisos mas en codigo desplegado\n`)
}

if (SOLO_LISTAR) {
  process.stdout.write('\nModo listar. no se falla por nada.\n')
  process.exit(0)
}

if (bloqueantes.length > 0) {
  process.stdout.write(
    `\nROJO. ${bloqueantes.length} alertas de severidad alta o critica en codigo que se despliega.\n`
    + 'Arreglalas, o si son falsos positivos, descartalas UNA POR UNA con su razon escrita:\n'
    + `  gh api -X PATCH repos/${REPO}/code-scanning/alerts/<numero> \\\n`
    + '    -f state=dismissed -f dismissed_reason="false positive" -f dismissed_comment="por que"\n'
    + 'Descartarlas sin razon escrita es exactamente como se pierde una alerta de verdad.\n')
  process.exit(1)
}

process.stdout.write('\nVERDE. Ninguna alerta de severidad alta o critica en codigo desplegado.\n')
process.exit(0)
