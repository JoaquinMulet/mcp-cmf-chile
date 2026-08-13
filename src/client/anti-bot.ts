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
    header(url: URL) {
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

export function esChallenge(body: string): boolean {
  return (
    body.length < 4000 &&
    (body.includes("cookiesession8341") || body.includes("fwb_dat") || body.includes("eval(function"))
  );
}

export function extraerChallenge(body: string): { fwbDat: string; md5: string } | null {
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
  const cookie = jar.header(urlObj);
  if (cookie) headers.set("Cookie", cookie);

  const primera = await fetchFn(url, { ...init, headers });
  const cuerpo = await primera.clone().text();

  if (!esChallenge(cuerpo)) {
    jar.setFromHeaders(primera.headers);
    return primera;
  }

  const ch = extraerChallenge(cuerpo);
  if (!ch) return primera; // challenge no reconocido: devolver tal cual

  const challengeUrl = new URL(urlObj);
  challengeUrl.searchParams.set("cookiesession8341", ch.md5);

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

  // Reintento del request original con la cookie resuelta
  const retryHeaders = new Headers(headers);
  const nuevaCookie = jar.header(urlObj);
  if (nuevaCookie) retryHeaders.set("Cookie", nuevaCookie);
  return fetchFn(url, { ...init, headers: retryHeaders });
}

export const UA_DEFAULT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
