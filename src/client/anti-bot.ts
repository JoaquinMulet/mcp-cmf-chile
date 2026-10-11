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
  /** Lo más que puede pesar el cuerpo de la respuesta. Sobre eso se corta con RespuestaDemasiadoGrande. */
  topeBytes = Number.POSITIVE_INFINITY,
): Promise<Response> {
  const urlObj = new URL(url);
  const headers = new Headers(init.headers ?? {});
  conCookiesDelJar(headers, jar, urlObj);
  const leerUnaVez = (res: Response) => leerCuerpoUnaVez(res, topeBytes, `${urlObj.origin}${urlObj.pathname}`);

  const { respuesta: primera, bytes } = await leerUnaVez(await fetchFn(url, { ...init, headers }));
  const cuerpo = textoSiEsChico(bytes);

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
  // La respuesta repetida se trata igual que una primera respuesta que no fue
  // desafío. Su cuerpo se lee entero acá, y sus cookies quedan en el jar.
  // Quien llama tiene tomado un cupo del limitador hasta que esta función
  // termina. Entregar la respuesta sin leer dejaba que el cuerpo se bajara con
  // el cupo ya devuelto (12 cuerpos a la vez con tope de 4, medido el 10 de
  // octubre de 2026), y perdía la cookie de sesión que el flujo del captcha
  // necesita.
  const { respuesta: final, bytes: bytesFinal } = await leerUnaVez(await fetchFn(url, { ...init, headers: retryHeaders }));
  const cuerpoFinal = textoSiEsChico(bytesFinal);
  // Con la misma exigencia que la primera respuesta. es el desafío solo si
  // además trae su dato. Una página chica y legítima con un script empaquetado
  // no lo es.
  if (esChallenge(cuerpoFinal) && extraerChallenge(cuerpoFinal)) {
    // La CMF no aceptó la cookie del desafío. Entregar esta página como si
    // fuera la respuesta dejaba al parser leyendo un desafío como una página
    // sin datos. La URL va sin su query, que puede llevar una clave.
    throw new DesafioRepetido(
      `La CMF respondió con su desafío anti-bot 2 veces seguidas y no entregó la página (${urlObj.origin}${urlObj.pathname}). Es un bloqueo, no ausencia de datos.`,
    );
  }
  jar.setFromHeaders(final.headers);
  return final;
}

/**
 * La CMF respondió el desafío otra vez, con la cookie ya puesta. Tiene clase
 * propia para que quien llama lo distinga de una falla de la red. cuando la
 * consulta va por la salida chilena, esto no es un proxy caído.
 */
export class DesafioRepetido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "DesafioRepetido";
  }
}

/** Sobre este tamaño una respuesta no es el desafío, que mide menos de 4000 caracteres. */
const MAX_BYTES_DE_UN_DESAFIO = 16000;

/**
 * El texto de un cuerpo, solo si es lo bastante chico para ser el desafío.
 * Convertir a texto cada respuesta, también un PDF de 40 MB, dejaba en memoria
 * una copia más del documento solo para mirar si era un desafío.
 */
function textoSiEsChico(bytes: Uint8Array): string {
  return bytes.byteLength < MAX_BYTES_DE_UN_DESAFIO ? new TextDecoder().decode(bytes) : "";
}

/**
 * Una respuesta pesa más de lo que el servidor puede tener en memoria. Tiene
 * clase propia para que quien llama no la reintente ni la tome por una falla
 * de la red. repetir la consulta trae el mismo documento.
 */
export class RespuestaDemasiadoGrande extends Error {
  constructor(bytes: number, topeBytes: number, pagina: string, pesoExacto: boolean) {
    const enMb = (n: number) => (n / 1048576).toFixed(1).replace(".", ",");
    super(
      `El documento de la CMF pesa ${pesoExacto ? "" : "más de "}${enMb(bytes)} MB, y este servidor no baja documentos de más de ${enMb(topeBytes)} MB porque no caben en su memoria (${pagina}). Ábralo directo desde la CMF con su enlace.`,
    );
    this.name = "RespuestaDemasiadoGrande";
  }
}

/**
 * Lee el cuerpo de una respuesta UNA sola vez, y entrega los bytes junto con
 * una respuesta igual, armada con esos mismos bytes.
 *
 * Antes el cuerpo se leía sobre un clone(), para mirar si era el desafío, y
 * quien llamaba lo leía otra vez. En workerd un documento ocupaba así más de
 * 4 veces su tamaño (174 MB para uno de 40, medido el 10 de octubre de 2026).
 */
async function leerCuerpoUnaVez(res: Response, topeBytes: number, pagina: string): Promise<{ respuesta: Response; bytes: Uint8Array }> {
  // Sin cuerpo no hay nada que copiar. Y una respuesta con un estado que
  // `new Response` rechaza no se puede rearmar, así que conserva su copia.
  if (!res.body || res.status < 200 || res.status > 599) {
    return { respuesta: res, bytes: new Uint8Array(await res.clone().arrayBuffer()) };
  }
  const declarado = Number(res.headers.get("content-length") ?? "");
  if (declarado > topeBytes) {
    // Se sabe antes de bajar un solo byte.
    void res.body.cancel().catch(() => {});
    throw new RespuestaDemasiadoGrande(declarado, topeBytes, pagina, true);
  }
  const bytes = await juntarTramos(res.body.getReader(), declarado, topeBytes, pagina);
  // El cuerpo de la respuesta nueva entrega ese mismo bloque, sin copiarlo,
  // recién cuando alguien lo lee.
  const cuerpo = new ReadableStream<Uint8Array>({
    pull(salida) {
      salida.enqueue(bytes);
      salida.close();
    },
  });
  const respuesta = new Response(cuerpo, { status: res.status, statusText: res.statusText, headers: res.headers });
  cuerposLeidos.set(respuesta, bytes);
  return { respuesta, bytes };
}

/**
 * Lee un cuerpo hasta el final y lo entrega en un solo bloque del largo justo.
 *
 * Con el largo declarado, los tramos se copian a ese bloque a medida que
 * llegan, y el documento está en memoria una sola vez. Con arrayBuffer() el
 * motor junta primero todos los tramos y después los copia a un bloque nuevo.
 * Lo que no cabe en el bloque se guarda aparte. pasa cuando no hay largo
 * declarado, o cuando el declarado es el del cuerpo comprimido.
 */
async function juntarTramos(lector: ReadableStreamDefaultReader<Uint8Array>, declarado: number, topeBytes: number, pagina: string): Promise<Uint8Array> {
  const bloque = new Uint8Array(declarado > 0 ? declarado : 0);
  const sobrantes: Uint8Array[] = [];
  let enBloque = 0;
  let largo = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    largo += value.byteLength;
    if (largo > topeBytes) {
      // Sin largo declarado, o con uno que mentía, se sabe recién acá.
      void lector.cancel().catch(() => {});
      throw new RespuestaDemasiadoGrande(largo, topeBytes, pagina, false);
    }
    if (sobrantes.length === 0 && enBloque + value.byteLength <= bloque.byteLength) {
      bloque.set(value, enBloque);
      enBloque += value.byteLength;
    } else {
      sobrantes.push(value);
    }
  }
  // Un bloque del largo justo, para que `bytes.buffer` sea el cuerpo y nada
  // más. Si el largo declarado era el real, es el mismo bloque, sin copia.
  if (largo === bloque.byteLength) return bloque;
  const bytes = new Uint8Array(largo);
  bytes.set(bloque.subarray(0, enBloque));
  let desde = enBloque;
  for (const tramo of sobrantes) {
    bytes.set(tramo, desde);
    desde += tramo.byteLength;
  }
  return bytes;
}

/** Los cuerpos que este cliente ya leyó enteros, por respuesta. */
const cuerposLeidos = new WeakMap<Response, Uint8Array>();

/**
 * Los bytes del cuerpo de una respuesta. Si la respuesta salió de este
 * cliente, son los que ya se leyeron, sin otra copia.
 */
export async function bytesDe(res: Response): Promise<Uint8Array> {
  return cuerposLeidos.get(res) ?? new Uint8Array(await res.arrayBuffer());
}

/**
 * Suma las cookies del jar a las que ya trae la consulta. Antes las del jar
 * REEMPLAZABAN la cabecera entera, y una consulta que traía su cookie de
 * sesión la perdía apenas el jar tenía la del desafío. Así fallaba el envío
 * del código del captcha.
 *
 * Las cookies de quien llama viajan tal como venían, en su orden. Solo se
 * quita la que tiene el mismo nombre que una del jar, y las del jar van al
 * final. Rearmar la cabecera par por par la cambiaba. un nombre repetido
 * perdía su primer valor, una cookie sin valor desaparecía, y un valor entre
 * comillas con un punto y coma salía cortado.
 */
export function conCookiesDelJar(headers: Headers, jar: CookieJar, url: URL): void {
  const delJar = jar.header(url);
  if (!delJar) return;
  const nombresDelJar = new Set(delJar.split("; ").map((par) => par.slice(0, par.indexOf("="))));
  const deQuienLlama = trozosDeCookie(headers.get("Cookie") ?? "").filter((trozo) => {
    const igual = trozo.indexOf("=");
    return !nombresDelJar.has(igual > 0 ? trozo.slice(0, igual).trim() : trozo);
  });
  headers.set("Cookie", [...deQuienLlama, delJar].join("; "));
}

/** Parte una cabecera Cookie por sus punto y coma, sin cortar los que van entre comillas. */
function trozosDeCookie(cabecera: string): string[] {
  const trozos: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (const letra of cabecera) {
    if (letra === '"') entreComillas = !entreComillas;
    if (letra === ";" && !entreComillas) {
      trozos.push(actual.trim());
      actual = "";
    } else {
      actual += letra;
    }
  }
  trozos.push(actual.trim());
  // Una comilla que no se cierra no encierra nada. Sin esto, todo lo que venía
  // después de ella quedaba como un solo valor. la cookie del mismo nombre que
  // la del jar no se quitaba, y la del jar se agregaba otra vez en cada pasada.
  const partes = entreComillas ? cabecera.split(";").map((trozo) => trozo.trim()) : trozos;
  return partes.filter((trozo) => trozo !== "");
}

export const UA_DEFAULT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
