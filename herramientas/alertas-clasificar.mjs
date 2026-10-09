/**
 * Reparte las alertas de seguridad entre las que bloquean, las que se listan
 * y las de pruebas. Vive aparte de alertas.mjs para poder probarse sin
 * consultar a GitHub (test/porton-alertas.test.ts).
 *
 * Todo lo que no es prueba cuenta como codigo que corre. El Worker vive en
 * src/, el proxy de la salida chilena en infra/ y corre en una maquina del
 * dueno, y las herramientas corren en la CI con credenciales. Una carpeta
 * nueva queda vigilada sin que nadie la anote. Antes la lista era al reves,
 * solo src/, y una alerta critica en infra/ paso como informativa (9 de
 * octubre de 2026).
 */

/** Lo unico que no corre en ninguna maquina de produccion ni en la CI con permisos. */
const SOLO_PRUEBAS = ['test/']
/** Severidades que bloquean. */
const BLOQUEAN = new Set(['critical', 'high'])

const esPrueba = (f) => SOLO_PRUEBAS.some((d) => f.ruta.startsWith(d))

export function clasificar(filas) {
  const enProduccion = filas.filter((f) => !esPrueba(f))
  return {
    enProduccion,
    bloqueantes: enProduccion.filter((f) => BLOQUEAN.has(f.severidad)),
    otrasProduccion: enProduccion.filter((f) => !BLOQUEAN.has(f.severidad)),
    enPruebas: filas.filter(esPrueba),
  }
}
