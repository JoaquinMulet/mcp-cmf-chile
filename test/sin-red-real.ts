/**
 * Guardia. Una prueba que simula la red nunca sale a la red de verdad.
 *
 * Toda prueba que reemplaza `globalThis.fetch` lo devuelve a su valor
 * original al terminar. Si a esa altura queda una consulta viva (en la cola
 * del limitador, en un reintento, esperando un turno), esa consulta sale con
 * el fetch original. Sin este guardia, el original es la red real.
 *
 * Pasó el 9 de octubre de 2026. Una prueba de test/tope-en-vuelo.test.ts
 * falló antes de esperar a sus consultas en cola, y hasta 4 GET salieron a
 * tasas.cmfchile.cl. Se supo solo porque la CMF respondió una redirección a
 * un host fuera de la lista.
 *
 * Importar este archivo deja como «original» un fetch que lanza. Va primero,
 * antes de importar el cliente.
 */
globalThis.fetch = (async (url: string | URL | Request) => {
  const destino = String(url instanceof Request ? url.url : url).split("?")[0];
  throw new Error(`Una prueba dejó una consulta viva fuera de su red simulada, hacia ${destino}`);
}) as typeof fetch;
