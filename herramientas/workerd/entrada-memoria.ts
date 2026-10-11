// Worker mínimo para medir memoria. Baja un documento con el cliente del
// servidor, igual que las tools que descargan, y devuelve cuántos bytes recibió.
//
// `por` elige el camino. «fetch» lee el cuerpo como cualquier código que llama
// a fetchCmf. «binario» es el de las tools que bajan planillas y documentos.
// «descargar» es el de cmf_documento_descargar, que además arma un tramo de
// base64.
import { fetchCmf, fetchCmfBinario, fetchCmfBinarioCached } from "../../src/client/cmf-client.ts";
import { tramoBase64 } from "../../src/util/binario.ts";

export default {
  async fetch(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const env = { CMF_RATE_LIMIT_MS: "0", CMF_UPSTREAM_TIMEOUT_MS: "60000" };
    const destino = `https://api.sbif.cl/doc${u.search}`;
    const por = u.searchParams.get("por") ?? "fetch";
    // Le pide al motor que recoja la memoria que ya nadie usa. Existe solo si
    // workerd partió con --expose-gc, que es como lo levanta memoria.mjs.
    if (u.searchParams.get("recoger") === "1") {
      const recoger = (globalThis as { gc?: () => void }).gc;
      for (let i = 0; recoger && i < 4; i++) {
        recoger();
        await new Promise((r) => setTimeout(r, 50));
      }
      return new Response(recoger ? "recogida" : "sin gc");
    }
    try {
      if (por === "fetch") {
        const res = await fetchCmf(destino, {}, env);
        return new Response(`ok ${(await res.arrayBuffer()).byteLength}`);
      }
      // Antes del documento que se mide, `previos` documentos de `mb_previos`
      // megabytes pasan por la caché de binarios, como los de un paquete.
      const previos = Number(u.searchParams.get("previos") ?? "0");
      for (let i = 0; i < previos; i++) {
        const previo = `https://api.sbif.cl/previo${i}?mb=${u.searchParams.get("mb_previos") ?? "3"}`;
        await fetchCmfBinarioCached(previo, `memoria:${previo}`, env);
      }
      const { bytes } = await fetchCmfBinario(destino, env);
      if (por === "descargar") {
        const tramo = tramoBase64(bytes, 0, 200000);
        return new Response(`ok ${bytes.byteLength}, tramo de ${tramo.base64.length} de ${tramo.total_chars}`);
      }
      return new Response(`ok ${bytes.byteLength}`);
    } catch (e) {
      return new Response(`error ${(e as Error).name}. ${(e as Error).message}`, { status: 500 });
    }
  },
};
