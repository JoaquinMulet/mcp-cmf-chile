/**
 * Un bloqueo de la CMF no es «sin datos».
 *
 * Medido el 14 de septiembre de 2026. Desde las 16:00 la CMF devolvió para
 * cada paquete una página que no era datos, y como el cliente no miraba el
 * estado HTTP, cmf_empresa_paquete_documentos respondía «0 descargados, 0
 * fallidos, Sin ZIP» con el período en periodos_eeff_sin_datos. El sistema
 * que consume el MCP tomó 206 documentos por rotos y siguió pegándole a la
 * CMF a 2 consultas por segundo. Ahora la respuesta que no es datos sube
 * como CmfUpstreamError, con el estado HTTP, y nunca se cachea.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CmfUpstreamError,
  fetchCmfBinarioCached,
  getLegacy,
  postLegacy,
} from "../src/client/cmf-client.js";

const env = { CMF_RATE_LIMIT_MS: "1" };

function conFetch(respuesta: () => Response, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => respuesta()) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("un 403 del legacy sube como CmfUpstreamError con su estado", () =>
  conFetch(
    () => new Response("<html>Forbidden</html>", { status: 403 }),
    async () => {
      await assert.rejects(
        getLegacy("/institucional/mercados/entidad.php", { rut: "92580000", pestania: 3 }, env, "clave-403"),
        (e: unknown) => e instanceof CmfUpstreamError && e.status === 403 && e.motivo === "http",
      );
      // Nada quedó cacheado: la siguiente llamada vuelve a preguntar.
      let llamadas = 0;
      globalThis.fetch = (async () => {
        llamadas++;
        return new Response("<html><table><option value=2025>2025</option></table></html>", { status: 200 });
      }) as typeof fetch;
      await getLegacy("/institucional/mercados/entidad.php", { rut: "92580000", pestania: 3 }, env, "clave-403");
      assert.equal(llamadas, 1);
    },
  ));

test("la página «Attack ID» del cortafuegos con HTTP 200 también es bloqueo", () =>
  conFetch(
    () => new Response("<html><body>The requested URL was rejected. Your support ID is: Attack ID 123</body></html>", { status: 200 }),
    async () => {
      await assert.rejects(
        postLegacy("/institucional/mercados/entidad.php", { forma: "F", mm: "03", aa: "2026" }, env),
        (e: unknown) => e instanceof CmfUpstreamError && e.motivo === "cortafuegos",
      );
    },
  ));

test("un documento que llega como HTML no se guarda ni se entrega como documento", () =>
  conFetch(
    () => new Response("<!DOCTYPE html><html>error</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    async () => {
      await assert.rejects(
        fetchCmfBinarioCached("https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=x", "doc-html", env),
        (e: unknown) => e instanceof CmfUpstreamError && e.motivo === "no_binario",
      );
      globalThis.fetch = (async () => new Response("%PDF-1.4 fixture", { status: 200, headers: { "Content-Type": "application/pdf" } })) as typeof fetch;
      const { bytes } = await fetchCmfBinarioCached("https://www.cmfchile.cl/sitio/aplic/serdoc/ver_sgd.php?s567=x", "doc-html", env);
      assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
    },
  ));
