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

/**
 * GET o POST a BEST, con la respuesta ya como JSON.
 *
 * Distingue 3 fallos que antes se veían iguales. un HTTP distinto de 200
 * (401 cuando la clave cambió), un 200 sin JSON (página de mantención), y
 * la red. Los 3 nombran la página oficial para que el agente pueda ir a
 * mirar.
 */
export async function bestJson<T>(
  ruta: string,
  env: CmfEnv,
  opciones: { que: string; paginaOficial: string; cuerpo?: unknown },
): Promise<T> {
  const { que, paginaOficial, cuerpo } = opciones;
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
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new Error(
      `${que}: BEST respondió 200 pero sin JSON en ${BEST_API}${ruta} (empieza con «${texto.slice(0, 60).replace(/\s+/g, " ")}»). ${oficial}; el servicio puede estar en mantención, reintente más tarde.`,
    );
  }
}

/** Hoy en Chile, como AAAA-MM-DD. «Hoy» en UTC ya es mañana a las 22:30 de Chile. */
export function hoyEnChile(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
}
