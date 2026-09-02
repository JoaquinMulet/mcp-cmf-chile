/**
 * PORTON DE CI REMOTA. Nada se despliega con la CI del remoto en rojo.
 *
 * Por que existe, medido el 2 de septiembre de 2026. Acepte 2 PR, empuje
 * 2 commits y desplegue, y declare todo terminado. Los 3 flujos de
 * Seguridad de esos commits estaban en rojo en GitHub. El pre-push no lo
 * podia ver, porque la alerta nacio despues del ultimo commit y solo la
 * ve `npm audit` corriendo en la nube. Yo tampoco lo mire, porque un
 * push que termina en 0 se siente como un verde.
 *
 * La regla que queda. **el push que termina bien dice que el commit
 * llego al remoto, no que el remoto lo aprobo.** Ese veredicto vive en
 * los flujos de GitHub y hay que ir a leerlo. Este porton lo lee y
 * bloquea el deploy si algo esta rojo.
 *
 * Que hace.
 *   - Toma el commit actual (o el de --sha) y comprueba que este en el
 *     remoto. Un commit que no se empujo no tiene CI que consultar.
 *   - Espera a que TODOS los flujos de ese commit terminen, avisando el
 *     progreso por stderr para que la espera no parezca un cuelgue.
 *   - Falla si alguno termino distinto de success. Falla tambien si no
 *     puede consultar, en vez de dejar pasar en silencio.
 *
 * Uso.
 *   node herramientas/ci-remoto.mjs              el commit actual
 *   node herramientas/ci-remoto.mjs --sha abc123 otro commit
 *
 * Corre solo como `predeploy`, asi que `npm run deploy` se niega con la
 * CI en rojo o sin empujar.
 */
import { execFileSync } from 'node:child_process'

const ESPERA_MAXIMA_MS = 20 * 60 * 1000
const INTERVALO_MS = 20 * 1000
const ANCHO = 68

function corta(texto) {
  return texto.length <= ANCHO ? texto : `${texto.slice(0, ANCHO - 1)}…`
}

function aviso(texto) {
  process.stderr.write(`${corta(texto)}\n`)
}

function ejecutar(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function shaObjetivo() {
  const i = process.argv.indexOf('--sha')
  const pedido = i >= 0 ? process.argv[i + 1] : 'HEAD'
  return ejecutar('git', ['rev-parse', pedido])
}

function estaEnElRemoto(sha) {
  const ramas = ejecutar('git', ['branch', '-r', '--contains', sha])
  return ramas.split('\n').some((r) => r.trim().length > 0)
}

function flujosDe(sha) {
  const crudo = ejecutar('gh', [
    'run', 'list', '--commit', sha, '--limit', '30',
    '--json', 'workflowName,status,conclusion,databaseId,event',
  ])
  return JSON.parse(crudo || '[]').filter((f) => f.event !== 'pull_request')
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

const sha = shaObjetivo()
const corto = sha.slice(0, 7)

try {
  ejecutar('git', ['fetch', '--quiet', 'origin'])
} catch (e) {
  aviso(`No pude consultar el remoto: ${e.message}`)
  process.exit(1)
}

if (!estaEnElRemoto(sha)) {
  aviso(`El commit ${corto} NO esta en el remoto. Empuja antes.`)
  process.exit(1)
}

aviso(`Leyendo la CI de GitHub para ${corto}. Puede tardar hasta`)
aviso(`${ESPERA_MAXIMA_MS / 60000} minutos si los flujos siguen corriendo.`)

const inicio = Date.now()
let flujos = []
for (;;) {
  try {
    flujos = flujosDe(sha)
  } catch (e) {
    aviso(`No pude leer los flujos con gh: ${e.message}`)
    process.exit(1)
  }
  const pendientes = flujos.filter((f) => f.status !== 'completed')
  const transcurrido = Math.round((Date.now() - inicio) / 1000)
  if (flujos.length > 0 && pendientes.length === 0) break
  if (Date.now() - inicio > ESPERA_MAXIMA_MS) {
    aviso(`Se agoto el plazo con ${pendientes.length} flujos sin terminar.`)
    aviso('Eso es evidencia sobre GitHub, no sobre el codigo. Vuelve a correr.')
    process.exit(1)
  }
  const que = flujos.length === 0 ? 'todavia no aparece ningun flujo' : `${pendientes.length} de ${flujos.length} flujos en curso`
  aviso(`[${transcurrido}s] ${que}, sigo esperando...`)
  await dormir(INTERVALO_MS)
}

const rojos = flujos.filter((f) => f.conclusion !== 'success')
for (const f of flujos) {
  const marca = f.conclusion === 'success' ? 'OK  ' : 'ROJO'
  console.log(corta(`${marca} ${f.workflowName} (${f.conclusion}) run ${f.databaseId}`))
}
if (rojos.length > 0) {
  console.log(corta(`${rojos.length} flujo(s) en rojo para ${corto}. No se despliega.`))
  console.log(corta(`Para ver el detalle: gh run view ${rojos[0].databaseId} --log-failed`))
  process.exit(1)
}
console.log(corta(`CI remota verde para ${corto}: ${flujos.length} flujos.`))
