/**
 * Resolución del challenge anti-bot F5 ASM ("cookiesession") de los sistemas legacy de la CMF.
 *
 * Flujo del challenge F5 (cookiesession1):
 * 1. GET sin cookie → 200 con JS ofuscado (packer) que embebe `fwb_dat` (la petición original
 *    en base64) y una URL con `cookiesession8341=<md5>`.
 * 2. POST a esa URL con `Content-Type: text/html` y body `fwb_dat=<base64>`.
 * 3. Respuesta con `Set-Cookie: cookiesession1=<32hex>` → el tráfico posterior pasa.
 *
 * Se resuelve por HTTP puro (sin ejecutar JS), válido en Workers y Node.
 */

export interface CookieJar {
  cookies: Map<string, string>;
  setFromHeaders(headers: Headers): void;
  header(url: URL): string;
  cabeceraCompleta(): string;
}

export function crearCookieJar(): CookieJar {
  const cookies = new Map<string, string>();
  return {
    cookies,
    setFromHeaders(headers: Headers) {
      const sc = headers.getSetCookie ? headers.getSetCookie() : [];
      const unico = sc.length ? sc : [headers.get("set-cookie") ?? ""].filter(Boolean);
      for (const linea of unico) {
        const [par] = linea.split(";");
        const eq = par.indexOf("=");
        if (eq > 0) cookies.set(par.slice(0, eq).trim(), par.slice(eq + 1).trim());
      }
    },
    header(_url: URL) {
      const partes: string[] = [];
      for (const [k, v] of cookies) {
        if (k.toLowerCase().startsWith("cookiesession") || k.startsWith("csb")) partes.push(`${k}=${v}`);
      }
      return partes.length ? partes.join("; ") : "";
    },
    /** Todas las cookies (incluye sesiones PHP como SVS_HE, necesarias para reintentar captchas). */
    cabeceraCompleta() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
  };
}

function esChallenge(body: string): boolean {
  return (
    body.length < 4000 &&
    (body.includes("cookiesession8341") || body.includes("fwb_dat") || body.includes("eval(function"))
  );
}

function extraerChallenge(body: string): { fwbDat: string; md5: string } | null {
  const fwb = body.match(/fwb_dat["']?\s*[:=]\s*["']([A-Za-z0-9+/=]+)["']/);
  const md5 = body.match(/cookiesession8341\s*=\s*([a-f0-9]{32})/) || body.match(/cookiesession8341=([a-f0-9]{32})/);
  if (!fwb) return null;
  return { fwbDat: fwb[1], md5: md5 ? md5[1] : "00000000000000000000000000000000" };
}

/** Intenta resolver el challenge: devuelve la Response del request original ya autenticado, o la original si no era challenge. */
export async function resolverChallenge(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  jar: CookieJar,
): Promise<Response> {
  const urlObj = new URL(url);
  const headers = new Headers(init.headers ?? {});
  conCookiesDelJar(headers, jar, urlObj);

  const primera = await fetchFn(url, { ...init, headers });
  const cuerpo = textoSiEsChico(await primera.clone().arrayBuffer());

  if (!esChallenge(cuerpo)) {
    jar.setFromHeaders(primera.headers);
    return primera;
  }

  const ch = extraerChallenge(cuerpo);
  if (!ch) return primera; // challenge no reconocido: devolver tal cual

  const challengeUrl = new URL(urlObj);
  challengeUrl.searchParams.set("cookiesession8341", ch.md5);

  const cookie = headers.get("Cookie");
  const postHeaders = new Headers({
    "Content-Type": "text/html",
    "User-Agent": headers.get("User-Agent") ?? UA_DEFAULT,
    ...(cookie ? { Cookie: cookie } : {}),
  });

  const res = await fetchFn(challengeUrl.toString(), {
    method: "POST",
    headers: postHeaders,
    body: `fwb_dat=${ch.fwbDat}`,
  });

  jar.setFromHeaders(res.headers);
  // De esta respuesta solo sirven las cookies. Su cuerpo se suelta, porque
  // una respuesta sin leer deja su conexión abierta.
  void res.body?.cancel().catch(() => {});

  // Reintento del request original con la cookie resuelta
  const retryHeaders = new Headers(headers);
  conCookiesDelJar(retryHeaders, jar, urlObj);
  const final = await fetchFn(url, { ...init, headers: retryHeaders });
  // La respuesta repetida se trata igual que una primera respuesta que no fue
  // desafío. Su cuerpo se lee entero acá, y sus cookies quedan en el jar.
  // Quien llama tiene tomado un cupo del limitador hasta que esta función
  // termina. Entregar la respuesta sin leer dejaba que el cuerpo se bajara con
  // el cupo ya devuelto (12 cuerpos a la vez con tope de 4, medido el 10 de
  // octubre de 2026), y perdía la cookie de sesión que el flujo del captcha
  // necesita.
  const cuerpoFinal = textoSiEsChico(await final.clone().arrayBuffer());
  if (esChallenge(cuerpoFinal)) {
    // La CMF no aceptó la cookie del desafío. Entregar esta página como si
    // fuera la respuesta dejaba al parser leyendo un desafío como una página
    // sin datos. La URL va sin su query, que puede llevar una clave.
    throw new Error(
      `La CMF respondió con su desafío anti-bot 2 veces seguidas y no entregó la página (${urlObj.origin}${urlObj.pathname}). Es un bloqueo, no ausencia de datos.`,
    );
  }
  jar.setFromHeaders(final.headers);
  return final;
}

/** Sobre este tamaño una respuesta no es el desafío, que mide menos de 4000 caracteres. */
const MAX_BYTES_DE_UN_DESAFIO = 16000;

/**
 * El texto de un cuerpo, solo si es lo bastante chico para ser el desafío.
 * Convertir a texto cada respuesta, también un PDF de 40 MB, dejaba en memoria
 * una copia más del documento solo para mirar si era un desafío.
 */
function textoSiEsChico(bytes: ArrayBuffer): string {
  return bytes.byteLength < MAX_BYTES_DE_UN_DESAFIO ? new TextDecoder().decode(bytes) : "";
}

/**
 * Suma las cookies del jar a las que ya trae la consulta. Las del jar mandan
 * si se repite el nombre. Antes las del jar REEMPLAZABAN la cabecera entera,
 * y una consulta que traía su cookie de sesión la perdía apenas el jar tenía
 * la del desafío. Así fallaba el envío del código del captcha.
 */
export function conCookiesDelJar(headers: Headers, jar: CookieJar, url: URL): void {
  const delJar = jar.header(url);
  if (!delJar) return;
  const pares = new Map<string, string>();
  for (const trozo of `${headers.get("Cookie") ?? ""}; ${delJar}`.split(";")) {
    const igual = trozo.indexOf("=");
    if (igual > 0) pares.set(trozo.slice(0, igual).trim(), trozo.slice(igual + 1).trim());
  }
  headers.set("Cookie", [...pares].map(([nombre, valor]) => `${nombre}=${valor}`).join("; "));
}

export const UA_DEFAULT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
