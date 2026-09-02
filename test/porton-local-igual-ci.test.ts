/**
 * El portón local corre TODO lo que corre la CI. Si corre menos, el verde
 * local es de otro color.
 *
 * Origen (2 de septiembre de 2026). El flujo de Seguridad corría
 * `npm audit --omit=dev --audit-level=high` y el pre-push no. Una
 * vulnerabilidad publicada en fast-uri dejó 3 commits seguidos en rojo en
 * GitHub, con el pre-push verde en los 3 y el deploy hecho. Lo vio el
 * dueño en su correo. La lección 10 del CLAUDE.md ya decía que el portón
 * local corría menos que la CI, y se arregló ese caso. Esto arregla la
 * clase: cualquier comando que la CI agregue y el hook no, se pone rojo
 * acá, en la suite, antes del commit.
 *
 * Y el deploy no puede correr con la CI remota en rojo. El push que
 * termina en 0 solo dice que el commit llegó al remoto. El veredicto vive
 * en GitHub, y `predeploy` va a leerlo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const RAIZ = join(import.meta.dirname, "..");

/**
 * Comandos de la CI que NO tienen que estar en un hook, con su razón.
 * La lista es corta a propósito y cada entrada dice por qué. Una
 * exclusión sin razón es un agujero que nadie va a revisar.
 */
const EXCLUIDOS: Record<string, string> = {
  "npm ci": "instala dependencias, no comprueba nada",
};

interface Paso {
  run?: string;
}
interface Flujo {
  jobs?: Record<string, { steps?: Paso[] }>;
}

/** Todos los `run:` de todos los jobs de todos los flujos, con el parser YAML real. */
export function comandosDeLaCi(dirFlujos: string): string[] {
  const comandos: string[] = [];
  for (const archivo of readdirSync(dirFlujos).filter((f) => /\.ya?ml$/.test(f))) {
    const flujo = parse(readFileSync(join(dirFlujos, archivo), "utf8")) as Flujo;
    for (const job of Object.values(flujo.jobs ?? {})) {
      for (const paso of job.steps ?? []) {
        if (typeof paso.run === "string") comandos.push(paso.run.trim());
      }
    }
  }
  return comandos;
}

/**
 * Los comandos de la CI que ningún texto local contiene. El texto local
 * es la suma de los hooks y de los scripts de package.json, porque un
 * comando puede vivir en cualquiera de los 2 y seguir corriendo antes de
 * empujar o justo después de desplegar.
 */
export function comandosSinCubrir(comandosCi: string[], textosLocales: string[]): string[] {
  const local = textosLocales.join("\n");
  return comandosCi.filter((c) => !(c in EXCLUIDOS) && !local.includes(c));
}

function textosLocalesReales(): string[] {
  const hooks = readdirSync(join(RAIZ, ".githooks")).map((h) => readFileSync(join(RAIZ, ".githooks", h), "utf8"));
  const scripts = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).scripts as Record<string, string>;
  return [...hooks, ...Object.values(scripts)];
}

test("la CI se lee de verdad: encuentra los comandos que sabemos que corre", () => {
  // Prueba de trabajo. Un lector que devuelve una lista vacía aprobaría
  // cualquier hook, así que primero se comprueba que leyó algo conocido.
  const comandos = comandosDeLaCi(join(RAIZ, ".github", "workflows"));
  assert.ok(comandos.includes("npm test"), `la CI corre npm test y el lector no lo vio: ${comandos.join(" | ")}`);
  assert.ok(comandos.length >= 5, "la CI tiene al menos 5 comandos");
});

test("todo comando de la CI corre también en un hook o en un script local", () => {
  const faltan = comandosSinCubrir(comandosDeLaCi(join(RAIZ, ".github", "workflows")), textosLocalesReales());
  assert.deepEqual(faltan, [], `la CI corre esto y el portón local no: ${faltan.join(" | ")}`);
});

test("la comprobación anterior SÍ puede fallar", () => {
  // El defecto exacto del 2 de septiembre de 2026: la CI audita y el
  // hook no.
  const faltan = comandosSinCubrir(
    ["npm test", "npm audit --omit=dev --audit-level=high"],
    ["npm run build\nnpm test"],
  );
  assert.deepEqual(faltan, ["npm audit --omit=dev --audit-level=high"]);
});

test("cada exclusión tiene su razón escrita", () => {
  for (const [comando, razon] of Object.entries(EXCLUIDOS)) {
    assert.ok(razon.length > 10, `la exclusión de '${comando}' no dice por qué`);
  }
});

test("el deploy no puede correr sin leer la CI remota", () => {
  // npm corre `predeploy` solo antes de `deploy`. Sin esa línea, wrangler
  // sube lo que hay en el disco con la CI de GitHub en rojo, y ya pasó.
  const scripts = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).scripts as Record<string, string>;
  assert.match(scripts.deploy, /wrangler deploy/);
  assert.match(scripts.predeploy ?? "", /ci-remoto\.mjs/, "predeploy tiene que correr herramientas/ci-remoto.mjs");
});
