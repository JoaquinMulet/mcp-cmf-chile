/**
 * OPORTUNIDADES. El informe que lee el que va a refactorizar.
 *
 * Esto NO es un portón. El portón es `trinquete.mjs` y solo dice rojo o
 * verde, que sirve para impedir que el código empeore y no sirve para
 * arreglar nada. Este archivo es lo otro. la lista de dónde conviene
 * meter mano, ordenada por cuánto se gana.
 *
 * Qué hace que sea útil y no otro volcado de métricas.
 *
 * 1. jscpd informa PARES de clones. Si una forma aparece 6 veces, eso
 *    son 15 pares y el informe crudo se vuelve ilegible. Acá los pares
 *    se agrupan en FAMILIAS, que es la unidad accionable de verdad.
 *    extraes 1 ayudante y arreglas 6 sitios de una.
 * 2. Cada familia viene ordenada por lo que se AHORRA, que son las
 *    líneas que desaparecen al extraer el ayudante, no por su
 *    porcentaje. Un 0,3 por ciento repetido 6 veces vale más que un
 *    2 por ciento repetido una.
 * 3. Trae el fragmento compartido, para poder ver de una qué forma
 *    tendría ese ayudante sin ir a abrir 6 archivos.
 *
 * Uso.
 *   node herramientas/oportunidades.mjs
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const RAIZ = process.cwd()

/** Corre un comando sin reventar por su código de salida. */
function correr(comando) {
  try {
    return execSync(comando, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

const corto = (ruta) => relative(RAIZ, ruta).replace(/\\/g, '/')

// --- Familias de código duplicado --------------------------------------

/**
 * Agrupa los pares de clones en familias con conjuntos disjuntos.
 * @returns {Array<{sitios: string[], lineas: number, ahorro: number, fragmento: string}>}
 */
function familiasDeClones(dirSalida) {
  const informe = join(dirSalida, 'jscpd-report.json')
  if (!existsSync(informe)) return []
  const datos = JSON.parse(readFileSync(informe, 'utf8'))
  const pares = datos.duplicates ?? []

  const padre = new Map()
  const raiz = (x) => {
    while (padre.get(x) !== x) {
      padre.set(x, padre.get(padre.get(x)))
      x = padre.get(x)
    }
    return x
  }
  const unir = (a, b) => {
    for (const x of [a, b]) if (!padre.has(x)) padre.set(x, x)
    padre.set(raiz(a), raiz(b))
  }
  const clave = (f) => `${corto(f.name)}:${f.start}`

  const meta = new Map()
  for (const par of pares) {
    const a = clave(par.firstFile)
    const b = clave(par.secondFile)
    unir(a, b)
    for (const k of [a, b]) {
      const previo = meta.get(k)
      if (previo === undefined || par.lines > previo.lineas) {
        meta.set(k, { lineas: par.lines, fragmento: par.fragment ?? '' })
      }
    }
  }

  const grupos = new Map()
  for (const k of padre.keys()) {
    const r = raiz(k)
    if (!grupos.has(r)) grupos.set(r, [])
    grupos.get(r).push(k)
  }

  return [...grupos.values()]
    .map((sitios) => {
      const info = sitios.map((s) => meta.get(s)).filter(Boolean)
      const lineas = Math.max(...info.map((i) => i.lineas), 0)
      const fragmento = (info.find((i) => i.lineas === lineas) ?? { fragmento: '' }).fragmento
      return { sitios: sitios.sort(), lineas, ahorro: (sitios.length - 1) * lineas, fragmento }
    })
    .sort((a, b) => b.ahorro - a.ahorro)
}

// --- Funciones más complejas -------------------------------------------

function funcionesComplejas() {
  // Por el informe JSON en un ARCHIVO, no por la salida bonita ni por
  // stdout. Tres lecturas equivocadas seguidas antes de llegar aca.
  //   1. Con expresion regular sobre el texto de colores daba 1 de 40.
  //   2. Leyendo stdout, el texto de stderr venia pegado al final del
  //      JSON y reventaba JSON.parse, asi que daba 0 de 40.
  //   3. El puntaje no se llama "complexity score from", se llama
  //      "Excessive complexity of N detected".
  // Una lectura que SUBESTIMA es la peor de todas, porque deja creer
  // que el codigo esta limpio. Por eso ahora, si no puede leer el
  // informe, lo DICE en vez de devolver una lista vacia en silencio.
  const informe = join(mkdtempSync(join(tmpdir(), 'biome-')), 'lint.json')
  correr(
    `"${join(RAIZ, 'node_modules', '.bin', 'biome')}" lint src test `
    + `--max-diagnostics=1000 --reporter=json --reporter-file="${informe}"`)
  let datos
  try {
    datos = JSON.parse(readFileSync(informe, 'utf8'))
  } catch {
    process.stdout.write(
      '  AVISO. no pude leer el informe de Biome, asi que esta seccion NO es vacia,\n'
      + '  es desconocida. Corre a mano: npx biome lint src test\n')
    return null
  }
  return (datos.diagnostics ?? [])
    .filter((d) => String(d.category ?? '').endsWith('noExcessiveCognitiveComplexity'))
    .map((d) => {
      const m = /complexity of (\d+)/.exec(String(d.message ?? ''))
      return {
        archivo: String(d.location?.path ?? '?').replace(/\\/g, '/'),
        linea: d.location?.start?.line ?? 0,
        puntaje: m === null ? 0 : Number(m[1]),
      }
    })
    .sort((a, b) => b.puntaje - a.puntaje)
}

// --- Informe ------------------------------------------------------------

const dirSalida = mkdtempSync(join(tmpdir(), 'oportunidades-'))
try {
  correr(`npx --yes jscpd src test --reporters json --output "${dirSalida}" --min-tokens 50`)
  const familias = familiasDeClones(dirSalida)

  process.stdout.write('='.repeat(70) + '\nOPORTUNIDADES DE LIMPIEZA\n' + '='.repeat(70) + '\n')

  const ahorroTotal = familias.reduce((s, f) => s + f.ahorro, 0)
  process.stdout.write(
    `\n--- DUPLICACION. ${familias.length} familias, `
    + `${ahorroTotal} lineas se irian al extraer sus ayudantes\n`)
  process.stdout.write('    (una familia son N copias de la MISMA forma. 1 ayudante arregla las N)\n\n')

  for (const f of familias.slice(0, 8)) {
    process.stdout.write(
      `  ahorro ${String(f.ahorro).padStart(3)} lineas  |  ${f.sitios.length} copias de ${f.lineas} lineas\n`)
    for (const s of f.sitios.slice(0, 6)) process.stdout.write(`      ${s}\n`)
    if (f.sitios.length > 6) process.stdout.write(`      y ${f.sitios.length - 6} mas\n`)
    const muestra = f.fragmento.split('\n').filter((l) => l.trim() !== '').slice(0, 3)
    for (const l of muestra) process.stdout.write(`      | ${l.trim().slice(0, 88)}\n`)
    process.stdout.write('\n')
  }

  // null NO es lo mismo que una lista vacia. null significa "no pude
  // medir", y decirlo es obligatorio. Un cero silencioso se lee como
  // "esta limpio", que es justo la conclusion contraria.
  const complejas = funcionesComplejas()
  if (complejas === null) {
    process.stdout.write('--- COMPLEJIDAD. DESCONOCIDA, la medicion fallo (ver el aviso de arriba)\n')
  } else {
    process.stdout.write(`--- COMPLEJIDAD. ${complejas.length} funciones sobre el umbral\n`)
    process.stdout.write('    (el puntaje sube con cada rama y con cada nivel de anidamiento)\n\n')
    for (const c of complejas.slice(0, 10)) {
      process.stdout.write(`  puntaje ${String(c.puntaje).padStart(3)}  ${c.archivo}:${c.linea}\n`)
    }
    if (complejas.length > 10) {
      process.stdout.write(`  ... y ${complejas.length - 10} mas, todas en el informe de Biome\n`)
    }
  }

  const muerto = correr('npx --yes knip --no-progress')
  const lineasMuerto = muerto.split('\n').filter((l) => /\.ts/.test(l) && !/^\s*$/.test(l))
  process.stdout.write(`\n--- SIN USAR. ${lineasMuerto.length} hallazgos de knip\n\n`)
  for (const l of lineasMuerto.slice(0, 10)) process.stdout.write(`  ${l.trim().slice(0, 96)}\n`)

  process.stdout.write(
    '\n' + '='.repeat(70)
    + '\nEsto es una LISTA, no una orden. Cada arreglo va en su propio commit,\n'
    + 'y el trinquete ya impide que estos numeros empeoren mientras tanto.\n')
} finally {
  rmSync(dirSalida, { recursive: true, force: true })
}
