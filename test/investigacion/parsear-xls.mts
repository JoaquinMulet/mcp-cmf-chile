// Parseo del XLSX de cumplimiento con xlsAJson (parsers.ts del proyecto, vía tsx).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { xlsAJson } from "../../src/client/parsers.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");
const bytes = readFileSync(join(DIR, "cumplimiento_202503.xls"));
const filas = xlsAJson(new Uint8Array(bytes));
console.log("filas:", filas.length);
console.log("fila 0:", JSON.stringify(filas[0], null, 1).slice(0, 800));
console.log("fila 1:", JSON.stringify(filas[1], null, 1).slice(0, 800));
