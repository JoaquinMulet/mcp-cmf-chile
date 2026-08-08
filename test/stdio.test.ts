import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

/** Prueba del proceso STDIO real: arranca dist/index.js y lista tools por el pipe. */
test("STDIO real: el proceso compilado responde server/discover", { timeout: 30000 }, async () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const proc = spawn(process.execPath, [path.join(dir, "..", "dist", "index.js")], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };

  const respuesta = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("timeout esperando respuesta JSON-RPC del proceso STDIO"));
    }, 15000);
    let buffer = "";
    proc.stdout.on("data", (d) => {
      buffer += d.toString();
      if (buffer.includes('"result"')) {
        clearTimeout(timer);
        resolve(buffer);
      }
    });
    proc.stderr.on("data", () => {
      /* logs a stderr son normales */
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.stdin.write(JSON.stringify(request) + "\n");
  });

  const line = respuesta.split("\n").find((l) => l.includes('"result"'));
  assert.ok(line, `sin respuesta JSON-RPC: ${respuesta.slice(0, 300)}`);
  const parsed = JSON.parse(line!);
  assert.ok(Array.isArray(parsed.result?.supportedVersions), "discover debe devolver supportedVersions");

  // Cerrar stdin: serveStdio termina el proceso al cerrarse el canal
  proc.stdin.end();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill();
      resolve();
    }, 5000);
    proc.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
});
