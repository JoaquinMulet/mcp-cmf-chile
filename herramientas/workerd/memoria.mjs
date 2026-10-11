// Mide cuánta memoria gasta el proceso workerd al bajar un documento con el
// cliente del servidor. Toda la salida del Worker la atiende una función
// local. Nada sale a internet.
//
// Uso. node herramientas/workerd/memoria.mjs [directo|desafio] [MB ...] [--por=fetch|binario|descargar] [--sin-largo]
// Sin argumentos mide 10, 20 y 40 MB, con y sin el desafío anti-bot.
//
// Cada medición levanta un workerd nuevo, porque el máximo de memoria de un
// proceso no baja. El número que importa es `sobre_la_base_mb`. cuánto subió
// la memoria del proceso sobre la que tenía antes de bajar el documento. En
// producción un Worker tiene 128 MB en total.
import { execFileSync } from "node:child_process";
import { levantar } from "./arnes.mjs";

const DESAFIO = '<script>var fwb_dat="QUJD";location="?cookiesession8341=0123456789abcdef0123456789abcdef"</script>';
const args = process.argv.slice(2);
const por = args.find((a) => a.startsWith("--por="))?.slice(6) ?? "fetch";
const sinLargo = args.includes("--sin-largo");
const modos = args.filter((a) => a === "directo" || a === "desafio");
const tamanos = args.filter((a) => /^[0-9]+$/.test(a)).map(Number);

/** Memoria actual y máxima de los procesos workerd que levantó este script, en MB. */
function memoria() {
  const salida = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='workerd.exe'" | ForEach-Object { $p = $_; $padre = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)").ParentProcessId; if ($p.ParentProcessId -eq ${process.pid} -or $padre -eq ${process.pid}) { "$($p.WorkingSetSize) $($p.PeakWorkingSetSize)" } }`,
    ],
    { encoding: "utf8" },
  ).trim();
  const [actual, pico] = salida.split(/\s+/).map(Number);
  // PeakWorkingSetSize viene en kilobytes y WorkingSetSize en bytes.
  return { actual: Math.round(actual / 1048576), pico: Math.round(pico / 1024) };
}

async function medir(modo, mb) {
  const w = await levantar({
    entrada: "./entrada-memoria.ts",
    atender: (request, Response) => {
      const u = new URL(request.url);
      if (request.method === "POST") return new Response("ok", { headers: { "set-cookie": "cookiesession1=AAAA; Path=/" } });
      const conCookie = (request.headers.get("cookie") ?? "").includes("cookiesession1");
      if (u.searchParams.get("desafio") === "1" && !conCookie) return new Response(DESAFIO);
      const cuerpo = new Uint8Array(Number(u.searchParams.get("mb") ?? "1") * 1024 * 1024).fill(37);
      // Con su largo declarado, como los documentos de la CMF. Con --sin-largo
      // va sin él, como una respuesta por tramos, que es el caso más caro.
      const cabeceras = { "content-type": "application/pdf", ...(sinLargo ? {} : { "content-length": String(cuerpo.byteLength) }) };
      return new Response(cuerpo, { headers: cabeceras });
    },
  });
  const extra = `${modo === "desafio" ? "&desafio=1" : ""}&por=${por}`;
  // Calentamiento con 1 MB, para no contarle al documento la carga del Worker.
  await w.pedirYa(`/?mb=1${extra}`);
  const antes = memoria();
  const fin = await w.pedirYa(`/?mb=${mb}${extra}`);
  const despues = memoria();
  await w.mf.dispose();
  return { modo, por, largo_declarado: !sinLargo, MB: mb, respuesta: (fin.texto ?? fin.cortada ?? "").slice(0, 90), base_mb: antes.actual, pico_mb: despues.pico, sobre_la_base_mb: despues.pico - antes.actual };
}

console.error("[memoria] cada medición levanta un workerd y tarda entre 5 y 15 segundos.");
for (const modo of modos.length ? modos : ["directo", "desafio"]) {
  for (const mb of tamanos.length ? tamanos : [10, 20, 40]) console.log(JSON.stringify(await medir(modo, mb)));
}
process.exit(0);
