/**
 * Cuánto pesa cada tool en el prompt del modelo.
 *
 * El costo invisible de un servidor MCP es su `tools/list`: cada esquema
 * viaja en TODAS las peticiones del modelo, se use o no. Este script lo
 * mide tool por tool para poder atacar a las peores primero.
 *
 * No es una prueba, es una herramienta de medición. Se corre a mano con
 *   npx tsx test/peso-de-tools.ts
 */
import { createServer } from "../src/server.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

/**
 * Aproxima tokens desde caracteres. Un tokenizador real es por modelo, y
 * para priorizar basta el orden de magnitud. La regla de dedo de ~4
 * caracteres por token se queda corta en JSON con mucha puntuación, así
 * que se usa 3,5 y se declara que es una aproximación.
 */
function tokensAprox(texto: string): number {
  return Math.round(texto.length / 3.5);
}

const server = createServer({ CMF_RATE_LIMIT_MS: "0" });
const [aCliente, aServidor] = InMemoryTransport.createLinkedPair();
const cliente = new Client({ name: "medidor", version: "1" });
await Promise.all([server.connect(aServidor), cliente.connect(aCliente)]);

const { tools } = await cliente.listTools();

type Fila = { nombre: string; desc: number; esquema: number; total: number };
const filas: Fila[] = tools.map((t: any) => {
  const desc = String(t.description ?? "");
  const esquema = JSON.stringify(t.inputSchema ?? {});
  const salida = JSON.stringify(t.outputSchema ?? {});
  return {
    nombre: t.name,
    desc: tokensAprox(desc),
    esquema: tokensAprox(esquema + salida),
    total: tokensAprox(JSON.stringify(t)),
  };
});

filas.sort((a, b) => b.total - a.total);
const total = filas.reduce((s, f) => s + f.total, 0);

process.stdout.write(`\nTOOLS: ${filas.length}\n`);
process.stdout.write(`COSTO TOTAL APROXIMADO: ${total.toLocaleString("es-CL")} tokens por petición\n`);
process.stdout.write(`PROMEDIO POR TOOL: ${Math.round(total / filas.length)} tokens\n\n`);
process.stdout.write("Las 15 más caras:\n");
process.stdout.write("  tokens  descripción  esquema  nombre\n");
for (const f of filas.slice(0, 15)) {
  process.stdout.write(
    `  ${String(f.total).padStart(6)}  ${String(f.desc).padStart(11)}  ${String(f.esquema).padStart(7)}  ${f.nombre}\n`,
  );
}

// Cuánto pesan los esquemas compartidos que se repiten en muchas tools.
const conAnyOf = tools.filter((t: any) => JSON.stringify(t.inputSchema ?? {}).includes('"anyOf"'));
process.stdout.write(`\nTools cuyo esquema usa anyOf: ${conAnyOf.length} de ${tools.length}\n`);

await cliente.close()
await server.close()
