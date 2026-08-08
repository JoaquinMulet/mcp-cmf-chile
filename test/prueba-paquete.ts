import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

/** Prueba real de la tool A contra la CMF (COPEC 2025-2026, solo eeff + memoria). */
async function main() {
  const srv = createServer({});
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await srv.connect(st);
  const client = new Client({ name: "verify", version: "1" }, {});
  await client.connect(ct);

  const t0 = Date.now();
  const res = await client.callTool({
    name: "cmf_empresa_paquete",
    arguments: {
      rut: "90690000",
      anio_inicio: "2025",
      anio_fin: "2026",
      secciones: ["eeff", "memoria"],
      incluir_tablas: true,
    },
  });
  console.log("duracion_ms:", Date.now() - t0);
  console.log("isError:", res.isError);
  console.log("texto:", (res.content?.[0]?.text ?? "").slice(0, 900));
  const sc = (res as { structuredContent?: unknown }).structuredContent as {
    manifest?: { ruta: string; tipo: string }[];
    resumen?: Record<string, unknown>;
  } | undefined;
  console.log("manifest tipos:", [...new Set((sc?.manifest ?? []).map((m) => m.tipo))].join(", "));
  const conAnalisis = (sc?.manifest ?? []).filter((m) => m.tipo.includes("analisis"));
  console.log("analisis en manifest:", conAnalisis.length, JSON.stringify(conAnalisis.slice(0, 2)));
  console.log("resumen:", JSON.stringify(sc?.resumen));
  await client.close();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
