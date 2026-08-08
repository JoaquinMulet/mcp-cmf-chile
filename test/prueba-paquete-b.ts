import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

/** Prueba real de la tool B: descarga 1 período EEFF y construye el ZIP. */
async function main() {
  const srv = createServer({});
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await srv.connect(st);
  const client = new Client({ name: "verify", version: "1" }, {});
  await client.connect(ct);

  const t0 = Date.now();
  const res = await client.callTool({
    name: "cmf_empresa_paquete_documentos",
    arguments: {
      rut: "90690000",
      anio_inicio: "2026",
      anio_fin: "2026",
      secciones: ["eeff"],
      max_documentos: 6,
      max_mb: 10,
      incluir_zip: true,
    },
  });
  console.log("duracion_ms:", Date.now() - t0);
  console.log("isError:", res.isError);
  console.log("texto:", (res.content?.[0]?.text ?? "").slice(0, 600));
  const sc = (res as { structuredContent?: unknown }).structuredContent as {
    descargados?: { ruta: string; tamano_kb: number }[];
    resumen?: Record<string, unknown>;
    zip?: { nombre: string; tamano_mb: number; archivos: number; base64: string; faltantes: number };
  } | undefined;
  console.log("descargados:", sc?.descargados?.length, JSON.stringify(sc?.descargados?.map((d) => d.ruta)));
  console.log("resumen:", JSON.stringify(sc?.resumen));
  const zip = sc?.zip;
  if (zip) {
    console.log("zip:", zip.nombre, zip.tamano_mb + "MB", zip.archivos + " archivos", "faltantes:", zip.faltantes);
    // Verificar magic del zip en base64
    const bin = atob(zip.base64);
    console.log("zip magic:", bin.charCodeAt(0).toString(16), bin.charCodeAt(1).toString(16), bin.charCodeAt(2).toString(16), bin.charCodeAt(3).toString(16));
  }
  await client.close();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
