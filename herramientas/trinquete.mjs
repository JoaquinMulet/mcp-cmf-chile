/**
 * TRINQUETE. Un número de calidad no puede empeorar.
 *
 * Por qué existe, y por qué NO es un archivo con un número adentro.
 *
 * La forma habitual de un trinquete es guardar el umbral en un archivo
 * versionado. Eso no sirve cuando el mantenedor es un agente de IA,
 * porque al ver rojo puede subir el número en el MISMO commit que lo
 * rompe, y nadie se entera. Un número que el mantenedor puede editar no
 * es un trinquete, es un comentario.
 *
 * Acá la línea base se COMPUTA. Se mide la métrica sobre el árbol de
 * trabajo y sobre el último estado empujado (`git merge-base` contra el
 * remoto), y se compara. Para aflojar el trinquete habría que reescribir
 * la historia del remoto.
 *
 * Y la propiedad que lo cierra. como el portón corre ANTES de empujar,
 * un número peor nunca llega al remoto, así que la línea base solo puede
 * quedarse igual o mejorar. El trinquete se sostiene solo.
 *
 * Uso.
 *   node herramientas/trinquete.mjs            corre todas las métricas
 *   node herramientas/trinquete.mjs --listar   solo mide, no falla
 */
import { execFileSync, execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RAIZ = process.cwd()
const SOLO_LISTAR = process.argv.includes('--listar')

/** Configuracion de las herramientas. Siempre la del arbol de trabajo. */
const CONFIGS = ['biome.json', 'tsconfig.json', 'package.json', '.jscpd.json', 'knip.json']

/** Corre un comando y devuelve su salida, sin reventar por código de salida. */
function correr(comando, cwd = RAIZ) {
  try {
    return execSync(comando, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

/**
 * Las métricas. Cada una recibe la carpeta a medir y devuelve un número.
 * Menos es mejor en todas, sin excepción, para que la comparación sea
 * una sola y no haya que recordar el sentido de cada una.
 */
const METRICAS = [
  {
    nombre: 'funciones demasiado complejas',
    detalle: 'complejidad cognitiva sobre 15, medida por Biome',
    medir(dir) {
      // Por el informe JSON en un ARCHIVO. Leer la salida de texto con
      // una expresion regular fallo de 3 formas distintas el mismo dia,
      // y las 3 SUBESTIMABAN. Un trinquete que mide de menos deja pasar
      // exactamente lo que existe para frenar, asi que aca un fallo de
      // lectura mata el porton en vez de devolver un numero inventado.
      const informe = join(mkdtempSync(join(tmpdir(), 'biome-')), 'lint.json')
      correr(
        `"${join(RAIZ, 'node_modules', '.bin', 'biome')}" lint src test `
        + `--max-diagnostics=1000 --reporter=json --reporter-file="${informe}"`, dir)
      let datos
      try {
        datos = JSON.parse(readFileSync(informe, 'utf8'))
      } catch {
        process.stdout.write(
          'TRINQUETE ROTO. Biome no produjo un informe legible en el arbol medido.\n'
          + 'Sin medicion no hay comparacion, asi que esto falla en vez de dejar pasar.\n')
        process.exit(2)
      }
      return (datos.diagnostics ?? [])
        .filter((d) => String(d.category ?? '').endsWith('noExcessiveCognitiveComplexity'))
        .length
    },
  },
  {
    nombre: 'código duplicado',
    detalle: 'porcentaje de líneas clonadas, medido por jscpd (x100 para comparar enteros)',
    medir(dir) {
      const salida = correr(
        `npx --yes jscpd src --silent --reporters console --min-tokens 50`, dir)
      const m = /\(([\d.]+)%\)/.exec(salida)
      return m === null ? 0 : Math.round(Number(m[1]) * 100)
    },
  },
  {
    nombre: 'exportaciones y archivos sin usar',
    detalle: 'lo que nadie importa, medido por knip',
    medir(dir) {
      const salida = correr('npx --yes knip --no-progress --reporter compact', dir)
      const m = /(\d+)\s+issues?/i.exec(salida)
      if (m !== null) return Number(m[1])
      return (salida.match(/^\s*\S+\.ts/gm) ?? []).length
    },
  },
]

/** Crea un árbol de trabajo temporal en el commit base y devuelve su ruta. */
function arbolBase() {
  let base
  try {
    base = correr('git merge-base origin/master HEAD').trim()
  } catch { base = '' }
  if (!/^[0-9a-f]{7,40}$/.test(base)) {
    process.stdout.write(
      'TRINQUETE ROTO. no pude calcular la linea base con git merge-base origin/master HEAD.\n'
      + 'Sin linea base no hay comparacion posible, asi que esto falla en vez de dejar pasar.\n')
    process.exit(2)
  }
  const dir = mkdtempSync(join(tmpdir(), 'trinquete-'))
  execFileSync('git', ['worktree', 'add', '--detach', dir, base], { cwd: RAIZ, stdio: 'ignore' })
  // La CONFIGURACION sale del arbol de trabajo, el CODIGO sale de la
  // linea base. Si el arbol viejo usara su propia configuracion se
  // estarian comparando 2 varas distintas, y entonces agregar una regla
  // parece un empeoramiento y quitarla parece una mejora. Las 2 lecturas
  // son falsas. Detectado midiendo. sin esto, estrenar biome.json daba
  // "de 0 a 40" porque el arbol viejo medía con otra regla.
  for (const config of CONFIGS) {
    const origen = join(RAIZ, config)
    if (existsSync(origen)) copyFileSync(origen, join(dir, config))
  }
  return { dir, base }
}

const { dir, base } = arbolBase()
process.stdout.write(`Linea base computada desde ${base.slice(0, 8)} (ultimo estado empujado)\n\n`)

const empeoraron = []
try {
  for (const metrica of METRICAS) {
    const ahora = metrica.medir(RAIZ)
    const antes = metrica.medir(dir)
    const señal = ahora > antes ? 'PEOR' : ahora < antes ? 'MEJOR' : 'igual'
    process.stdout.write(
      `  ${señal.padEnd(5)}  ${String(antes).padStart(5)} -> ${String(ahora).padStart(5)}  ${metrica.nombre}\n`
      + `                                  ${metrica.detalle}\n`)
    if (ahora > antes) empeoraron.push({ ...metrica, antes, ahora })
  }
} finally {
  execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: RAIZ, stdio: 'ignore' })
  rmSync(dir, { recursive: true, force: true })
}

process.stdout.write('\n')
if (SOLO_LISTAR) {
  process.stdout.write('Modo listar. no se falla por nada.\n')
  process.exit(0)
}
if (empeoraron.length === 0) {
  process.stdout.write('VERDE. Ninguna metrica empeoro.\n')
  process.exit(0)
}
for (const m of empeoraron) {
  process.stdout.write(`ROJO. ${m.nombre} paso de ${m.antes} a ${m.ahora}.\n`)
}
process.stdout.write(
  '\nEsto NO te pide mejorar el numero historico, solo no empeorarlo.\n'
  + 'Y no lo arregles subiendo un umbral. la linea base se computa desde el remoto,\n'
  + 'asi que no hay ningun numero que puedas editar aca.\n')
process.exit(1)
