/**
 * Salida chilena del MCP de la CMF.
 *
 * www.cmfchile.cl rechaza las IP de salida de Cloudflare (403 y 520, medido
 * el 9 de octubre de 2026). Este proxy corre en una máquina con IP chilena,
 * recibe del Worker el destino en la cabecera X-Cmf-Destino y hace la
 * consulta desde acá. Sin dependencias: Node 20 o más.
 *
 * Lo que NO es. No es un proxy abierto. Solo consulta a www.cmfchile.cl por
 * https, solo con el secreto compartido, y con un ritmo máximo propio, porque
 * la IP que se expone es la de una casa.
 *
 * Toda respuesta reenviada lleva x-cmf-salida: 1. El Worker usa esa marca
 * para separar «la CMF respondió esto» de «el túnel o el proxy fallaron».
 */
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HOST_PERMITIDO = "www.cmfchile.cl";
const CABECERAS_DE_IDA = ["user-agent", "accept", "accept-language", "cookie", "content-type"];
const CABECERAS_DE_VUELTA = ["content-type", "content-disposition", "location"];
const CUERPO_MAXIMO = 1024 * 1024;

function tokenValido(recibido, esperado) {
  const a = Buffer.from(String(recibido ?? ""));
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** El destino pedido, o null si no es una URL https de la CMF. */
export function destinoPermitido(valor) {
  let u;
  try {
    u = new URL(String(valor ?? ""));
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== HOST_PERMITIDO || u.port !== "" || u.username !== "" || u.password !== "") return null;
  return u;
}

async function leerCuerpo(req) {
  const partes = [];
  let total = 0;
  for await (const parte of req) {
    total += parte.length;
    if (total > CUERPO_MAXIMO) return null;
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

/**
 * Arma el servidor. `fetchFn` y `minMs` se inyectan para poder probarlo sin
 * red. `minMs` es la separación mínima entre 2 consultas a la CMF, y
 * `colaMaxima` cuántas pueden estar en curso, esperando turno o bajando su
 * cuerpo, antes de responder 429. `timeoutMs` es el plazo hasta las cabeceras
 * de la CMF, y va por debajo de los 12 s del Worker para que el proxy
 * conteste su 502 antes de que el Worker lo dé por colgado.
 */
export function crearServidor({ token, fetchFn = fetch, minMs = 600, colaMaxima = 12, timeoutMs = 10000 }) {
  if (!token || token.length < 32) throw new Error("El token de la salida chilena falta o tiene menos de 32 caracteres");
  let proximoTurno = 0;
  let enCola = 0;

  const responder = (res, status, texto) => {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    res.end(texto);
  };

  return createServer(async (req, res) => {
    try {
      if (!tokenValido(req.headers["x-cmf-token"], token)) return responder(res, 401, "no autorizado");
      const destino = destinoPermitido(req.headers["x-cmf-destino"]);
      if (!destino) return responder(res, 400, "destino no permitido");
      if (req.method !== "GET" && req.method !== "POST") return responder(res, 405, "metodo no permitido");
      const cuerpo = req.method === "POST" ? await leerCuerpo(req) : undefined;
      if (cuerpo === null) return responder(res, 413, "cuerpo demasiado grande");
      if (enCola >= colaMaxima) {
        // Marca propia: el Worker espera y reintenta por acá, no por el directo.
        res.writeHead(429, { "content-type": "text/plain; charset=utf-8", "x-cmf-salida-cola": "1" });
        return res.end("cola llena");
      }

      // El cupo se ocupa hasta que sale el último byte, no hasta las
      // cabeceras, o varios documentos grandes se juntan en memoria.
      enCola++;
      let liberado = false;
      const liberar = () => {
        if (!liberado) {
          liberado = true;
          enCola--;
        }
      };
      // Si el Worker corta, la consulta a la CMF se corta con él.
      const control = new AbortController();
      res.on("close", () => {
        control.abort();
        liberar();
      });
      try {
        // El turno se reserva antes de esperar, igual que en el Worker.
        const turno = Math.max(Date.now(), proximoTurno);
        proximoTurno = turno + minMs;
        const falta = turno - Date.now();
        if (falta > 0) await new Promise((r) => setTimeout(r, falta));
        if (control.signal.aborted) return;

        const headers = {};
        for (const nombre of CABECERAS_DE_IDA) {
          if (req.headers[nombre]) headers[nombre] = req.headers[nombre];
        }
        // El plazo cubre solo hasta las cabeceras, como en el camino directo.
        const plazo = setTimeout(() => control.abort(), timeoutMs);
        let respuesta;
        try {
          respuesta = await fetchFn(destino.toString(), {
            method: req.method,
            headers,
            body: cuerpo && cuerpo.length > 0 ? cuerpo : undefined,
            redirect: "manual",
            signal: control.signal,
          });
        } finally {
          clearTimeout(plazo);
        }
        // no-transform: Cloudflare no debe reescribir el HTML de la CMF en el
        // camino (ofuscación de correos, por ejemplo). no-store: todas las
        // consultas comparten esta URL, así que jamás se cachea.
        const salida = { "x-cmf-salida": "1", "cache-control": "no-store, no-transform" };
        for (const nombre of CABECERAS_DE_VUELTA) {
          const valor = respuesta.headers.get(nombre);
          if (valor !== null) salida[nombre] = valor;
        }
        const cookies = respuesta.headers.getSetCookie?.() ?? [];
        if (cookies.length > 0) salida["set-cookie"] = cookies;
        res.writeHead(respuesta.status, salida);
        // El cuerpo pasa en tramos, sin juntarse en memoria.
        if (respuesta.body) await pipeline(Readable.fromWeb(respuesta.body), res);
        else res.end();
        // Solo estado y ruta. La query lleva tokens de la CMF y no se registra.
        console.log(`${new Date().toISOString()} ${req.method} ${destino.pathname} ${respuesta.status}`);
      } finally {
        liberar();
      }
    } catch (e) {
      if (res.destroyed) return;
      // Sin la marca x-cmf-salida: el Worker lo lee como falla del proxy.
      console.error(`${new Date().toISOString()} error ${e?.name ?? "Error"}: ${e?.message ?? e}`);
      if (!res.headersSent) responder(res, 502, "la salida chilena no pudo consultar a la CMF");
      else res.end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const archivoToken = process.env.CMF_SALIDA_TOKEN_FILE;
  if (!archivoToken) throw new Error("Falta CMF_SALIDA_TOKEN_FILE, la ruta del archivo con el secreto");
  const token = readFileSync(archivoToken, "utf8").trim();
  const puerto = Number(process.env.CMF_SALIDA_PUERTO ?? 8791);
  crearServidor({ token }).listen(puerto, "127.0.0.1", () => {
    console.log(`salida chilena escuchando en 127.0.0.1:${puerto}`);
  });
}
