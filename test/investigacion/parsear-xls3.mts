import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { xlsAJson } from "../../src/client/parsers.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "evidencia");
const bytes = readFileSync(join(DIR, "cumplimiento_202503_novsn.xls"));
const filas = xlsAJson(new Uint8Array(bytes));
console.log("filas:", filas.length);
for (const f of filas.slice(0, 3)) console.log(JSON.stringify(f).slice(0, 400));
