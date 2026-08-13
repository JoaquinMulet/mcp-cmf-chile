import { fetchCmf, type CmfEnv } from "./client/cmf-client.js";
import { crearCookieJar } from "./client/anti-bot.js";

/**
 * Store de captchas para el flujo de 2 pasadas:
 * 1. La tool (sin código captcha) descarga la imagen real de la CMF, la guarda
 *    con un id opaco y las cookies de sesión necesarias para reintentar.
 * 2. El agente pide el código al usuario (los hosts MCP pueden mostrar la imagen
 *    del resource cmf://captcha/{id}) y reintenta con el código: el servidor
 *    reutiliza las cookies del captcha y lo marca como usado (single-use).
 *
 * Se guarda en memoria (STDIO) y en KV con TTL 10 min (Worker).
 */

export interface CaptchaRegistro {
  id: string;
  imagenBase64: string;
  contentType: string;
  cookies: string;
  tipo: "hechos" | "cartola";
  expiraEn: number;
  usado: boolean;
}

const TTL_MS = 10 * 60 * 1000;

let memoria = new Map<string, CaptchaRegistro>();

function ahora(): number {
  return Date.now();
}

const IMG_POR_TIPO: Record<"hechos" | "cartola", string> = {
  hechos: "/biblioteca/captcha2/captcha_hechos.php",
  cartola: "/sitio/biblioteca/captcha2/captcha.php",
};

function aBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function esPng(bytes: Uint8Array): boolean {
  return bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

/** Descarga una imagen captcha REAL de la CMF y la registra (single-use, TTL 10 min). */
export async function pedirCaptchaCMF(env: CmfEnv, tipo: "hechos" | "cartola"): Promise<string> {
  const jar = crearCookieJar();
  const rand = Math.floor(Math.random() * 1_000_000);
  const url = `https://www.cmfchile.cl${IMG_POR_TIPO[tipo]}?rand=${rand}`;
  const res = await fetchCmf(url, {}, env, jar);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!esPng(bytes)) {
    throw new Error(
      `La CMF no devolvió una imagen captcha válida (${bytes.length} bytes, HTTP ${res.status}). ` +
        "Suele ser un bloqueo temporal del sitio de la CMF: reintente la consulta en unos minutos.",
    );
  }
  const reg: CaptchaRegistro = {
    id: crypto.randomUUID(),
    imagenBase64: aBase64(bytes),
    contentType: "image/png",
    cookies: jar.cabeceraCompleta(),
    tipo,
    expiraEn: ahora() + TTL_MS,
    usado: false,
  };
  memoria.set(reg.id, reg);
  if (env.CMF_KV) {
    await env.CMF_KV.put(`captcha:${reg.id}`, JSON.stringify(reg), { expirationTtl: 600 });
  }
  return reg.id;
}

/** El captcha activo más reciente de un tipo (fallback si el agente no devolvió el id). */
export function ultimoCaptcha(env: CmfEnv, tipo: "hechos" | "cartola"): CaptchaRegistro | null {
  let mejor: CaptchaRegistro | null = null;
  for (const reg of memoria.values()) {
    if (reg.tipo !== tipo || reg.usado || reg.expiraEn < ahora()) continue;
    if (!mejor || reg.expiraEn > mejor.expiraEn) mejor = reg;
  }
  void env;
  return mejor;
}

export async function obtenerCaptcha(env: CmfEnv, id: string): Promise<CaptchaRegistro | null> {
  let reg = memoria.get(id);
  if (!reg && env.CMF_KV) {
    const raw = await env.CMF_KV.get(`captcha:${id}`);
    if (raw) {
      try {
        reg = JSON.parse(raw) as CaptchaRegistro;
        memoria.set(id, reg);
      } catch {
        /* ignorar */
      }
    }
  }
  if (!reg) return null;
  if (reg.usado || reg.expiraEn < ahora()) {
    memoria.delete(id);
    return null;
  }
  return reg;
}

/** Marca un captcha como usado (single-use). */
export async function consumirCaptcha(env: CmfEnv, id: string): Promise<void> {
  const reg = memoria.get(id);
  if (reg) {
    reg.usado = true;
    memoria.set(id, reg);
  }
  if (env.CMF_KV) {
    const raw = await env.CMF_KV.get(`captcha:${id}`);
    if (raw) {
      try {
        const r = JSON.parse(raw) as CaptchaRegistro;
        r.usado = true;
        await env.CMF_KV.put(`captcha:${id}`, JSON.stringify(r), { expirationTtl: 600 });
      } catch {
        /* ignorar */
      }
    }
  }
}
