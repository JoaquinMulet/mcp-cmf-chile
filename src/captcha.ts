import type { CmfEnv } from "./client/cmf-client.js";

/**
 * Store de captchas para MRTR: cada captcha tiene un id opaco, la URL del asset
 * (imagen) y la sesión del host necesaria para reintentar. Se guarda en KV con TTL
 * corto (10 min) y es single-use.
 */

export interface CaptchaRegistro {
  id: string;
  assetUrl: string;
  hostSession: string;
  expiraEn: number;
  usado: boolean;
}

const TTL_MS = 10 * 60 * 1000;

let memoria = new Map<string, CaptchaRegistro>();

function ahora(): number {
  return Date.now();
}

export async function crearCaptcha(
  env: CmfEnv,
  assetUrl: string,
  hostSession: string,
): Promise<CaptchaRegistro> {
  const id = crypto.randomUUID();
  const reg: CaptchaRegistro = {
    id,
    assetUrl,
    hostSession,
    expiraEn: ahora() + TTL_MS,
    usado: false,
  };
  memoria.set(id, reg);
  if (env.CMF_KV) {
    await env.CMF_KV.put(`captcha:${id}`, JSON.stringify(reg), { expirationTtl: 600 });
  }
  return reg;
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
