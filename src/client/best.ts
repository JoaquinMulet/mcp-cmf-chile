import { fetchCmf, type CmfEnv } from "./cmf-client.js";

/**
 * El servicio que alimenta best.cmfchile.cl, el sitio estadístico de la CMF.
 *
 * La aplicación Angular del sitio lo declara en su código público
 * (`API_URL_BASE` en el chunk principal) y manda en cada llamada a `/public`
 * la cabecera `x-apikey` con esta clave, que por lo tanto es pública. La
 * CMF ofrece además una API oficial con claves personales
 * (`apibest.cmfchile.cl/api/v1`, se piden en best.cmfchile.cl/api), pero su
 * cuota es de 100 llamadas al día y 10 por minuto, que no alcanza para un
 * servidor compartido. Si el dueño consigue una clave para este servicio,
 * va en `CMF_BEST_KEY` y reemplaza a la del sitio.
 *
 * Todo lo que habla con BEST pasa por acá, para que el error y la clave
 * vivan en un solo lugar.
 */
const BEST_API = "https://best-sbif-api.azurewebsites.net";
const BEST_CLAVE_WEB = "web-zUsFq7CKNYBm1boKYLtF7KyEDoXFwtKl";
export const BEST_SITIO = "https://best.cmfchile.cl";

/** Lo que BEST respondió, y si vino de la caché, cuándo se guardó. */
export interface RespuestaBest<T> {
  datos: T;
  /** Nulo cuando la respuesta se pidió a BEST en esta misma llamada. */
  cache: { guardado: string; horas: number } | null;
}

/**
 * Cuánto dura una respuesta de BEST en la caché, en horas.
 *
 * BEST recomienda en su documentación 6 horas para datos diarios y 24 para
 * mensuales. Casi todos los cuadros son mensuales y se actualizan a fin de
 * mes; los 23 diarios llevan DAYL en el tag, y las tasas TMC se publican
 * por día. Medido el 3 de septiembre de 2026 sobre el catálogo completo.
 */
export function horasDeCache(ruta: string): number {
  return /DAYL|\/tmc\//i.test(ruta) ? 6 : 24;
}

function claveDeCache(ruta: string, cuerpo: unknown): string {
  // La versión va en la clave. Si cambia la FORMA de lo guardado, se sube.
  return cuerpo === undefined ? `best:v1:${ruta}` : `best:v1:POST:${ruta}:${JSON.stringify(cuerpo)}`;
}

/**
 * GET o POST a BEST, con la respuesta ya como JSON y guardada en la caché
 * KV del Worker por 6 o 24 horas. La segunda consulta del mismo cuadro no
 * toca BEST, que es lo que sus términos de uso piden (nada de extracción
 * masiva) y lo que hace rápido al servidor. Sin KV (en local) no hay caché.
 *
 * Distingue 3 fallos que antes se veían iguales. un HTTP distinto de 200
 * (401 cuando la clave cambió), un 200 sin JSON (página de mantención), y
 * la red. Los 3 nombran la página oficial para que el agente pueda ir a
 * mirar. Un error nunca se guarda.
 */
export async function bestJson<T>(
  ruta: string,
  env: CmfEnv,
  opciones: { que: string; paginaOficial: string; cuerpo?: unknown },
): Promise<RespuestaBest<T>> {
  const { que, paginaOficial, cuerpo } = opciones;
  const clave = claveDeCache(ruta, cuerpo);
  const horas = horasDeCache(ruta);
  if (env.CMF_KV) {
    const guardado = await env.CMF_KV.get(clave);
    if (guardado) {
      const { fecha, datos } = JSON.parse(guardado) as { fecha: string; datos: T };
      return { datos, cache: { guardado: fecha, horas } };
    }
  }
  const res = await fetchCmf(
    `${BEST_API}${ruta}`,
    {
      method: cuerpo === undefined ? "GET" : "POST",
      headers: {
        "x-apikey": env.CMF_BEST_KEY ?? BEST_CLAVE_WEB,
        Accept: "application/json",
        ...(cuerpo === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    },
    env,
  );
  const oficial = `La fuente oficial es ${paginaOficial}`;
  if (!res.ok) {
    throw new Error(
      `${que}: BEST respondió HTTP ${res.status} en ${BEST_API}${ruta}. ${oficial}; ` +
        "si el error es 401 la clave web del sitio cambió y hay que leerla de nuevo de su código, o poner una clave propia en CMF_BEST_KEY.",
    );
  }
  const texto = await res.text();
  let datos: T;
  try {
    datos = JSON.parse(texto) as T;
  } catch {
    throw new Error(
      `${que}: BEST respondió 200 pero sin JSON en ${BEST_API}${ruta} (empieza con «${texto.slice(0, 60).replace(/\s+/g, " ")}»). ${oficial}; el servicio puede estar en mantención, reintente más tarde.`,
    );
  }
  if (env.CMF_KV) {
    // Guardar es lo de menos. si KV no acepta la escritura (cuota del plan
    // gratis, valor de más de 25 MB), la respuesta igual se entrega.
    try {
      await env.CMF_KV.put(clave, JSON.stringify({ fecha: new Date().toISOString(), datos }), { expirationTtl: horas * 3600 });
    } catch (e) {
      console.warn(`BEST: no pude guardar ${clave} en KV. ${(e as Error).message}`);
    }
  }
  return { datos, cache: null };
}

/** La nota que va con toda respuesta servida desde la caché, para que el modelo sepa de cuándo es el dato. */
export function notaDeCache(cache: RespuestaBest<unknown>["cache"]): string[] {
  if (!cache) return [];
  const cuando = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" }).format(new Date(cache.guardado));
  return [`Respuesta guardada en la caché del servidor el ${cuando} (hora de Chile). BEST se vuelve a consultar ${cache.horas} horas después de esa hora.`];
}

/** Hoy en Chile, como AAAA-MM-DD. «Hoy» en UTC ya es mañana a las 22:30 de Chile. */
export function hoyEnChile(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
}
