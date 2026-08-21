/**
 * El servidor no recorta por criterio propio.
 *
 * Regla del proyecto. una herramienta jamás decide por el agente qué
 * parte del dato merece verse, y si hay que cortar, el corte SIEMPRE
 * viaja con la forma exacta de pedir el resto, con un parámetro que
 * exista de verdad.
 *
 * El 20 de agosto de 2026, 43 operaciones cortaban sus filas dentro del
 * `structuredContent` con un `.slice(0, N)` clavado, sin total y sin
 * parámetro de continuación. El modo código lee justo ese campo, así que
 * el programa recibía N filas y no tenía cómo saber que faltaban más.
 *
 * Estas comprobaciones son de CLASE. No miran una operación, miran el
 * código fuente entero, así que el defecto no puede volver por una
 * operación nueva escrita con el patrón viejo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { construirRegistro } from "../src/registro.js";
import { paginacion, toolOkPaginado, avisoDeTramo } from "../src/util/tramos.js";

const DIR = join(import.meta.dirname, "..", "src", "tools");
const ARCHIVOS = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

/** Un `campo: algo.slice(0, N)` dentro del objeto de structuredContent. */
const RECORTE = /(\w+):\s*[A-Za-z0-9_.[\]()]+\.slice\(0,\s*\d+\)/;

/** El segundo argumento de cada toolOk del archivo. */
function cuerposDeToolOk(fuente: string): Array<{ cuerpo: string; linea: number }> {
  const salida: Array<{ cuerpo: string; linea: number }> = [];
  const re = /toolOk\(\s*[^,]+,\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  for (let m = re.exec(fuente); m !== null; m = re.exec(fuente)) {
    salida.push({ cuerpo: m[1] ?? "", linea: fuente.slice(0, m.index).split("\n").length });
  }
  return salida;
}

test("ninguna tool recorta filas dentro del structuredContent", () => {
  const culpables: string[] = [];
  for (const archivo of ARCHIVOS) {
    const fuente = readFileSync(join(DIR, archivo), "utf-8");
    for (const { cuerpo, linea } of cuerposDeToolOk(fuente)) {
      const m = RECORTE.exec(cuerpo);
      if (m) culpables.push(`${archivo}:${linea} (campo "${m[1]}")`);
    }
  }
  assert.deepEqual(
    culpables,
    [],
    `estas respuestas cortan filas sin decir el total ni cómo pedir el resto:\n${culpables.join("\n")}`,
  );
});

test("la comprobación anterior SÍ puede fallar", () => {
  // Una prueba que no puede fallar da confianza falsa. Esta es la prueba
  // de la prueba, con el patrón exacto que se está prohibiendo.
  const falso = 'return toolOk(texto, { rut, directorio: filas.slice(0, 100) });';
  const encontrados = cuerposDeToolOk(falso).filter((c) => RECORTE.test(c.cuerpo));
  assert.equal(encontrados.length, 1, "el detector tiene que ver el patrón prohibido");
});

test("toda operación con limit también acepta offset, y al revés", () => {
  const rotas: string[] = [];
  for (const op of construirRegistro({ CMF_RATE_LIMIT_MS: "0" }).values()) {
    const nombres = new Set(op.params.map((p) => p.nombre));
    if (nombres.has("limit") !== nombres.has("offset")) rotas.push(op.nombre);
  }
  assert.deepEqual(rotas, [], "paginar con la mitad de los parámetros deja filas inalcanzables");
});

test("toda operación paginada explica la paginación en su descripción", () => {
  // El modelo elige la tool leyendo la descripción. Si el parámetro
  // existe y nadie lo nombra, es como si no existiera.
  const mudas: string[] = [];
  for (const op of construirRegistro({ CMF_RATE_LIMIT_MS: "0" }).values()) {
    const tienePaginacion = op.params.some((p) => p.nombre === "offset");
    if (tienePaginacion && !/next_offset|paginad/i.test(op.descripcion)) mudas.push(op.nombre);
  }
  assert.deepEqual(mudas, []);
});

test("toolOkPaginado publica total y next_offset, y lo dice en el TEXTO", () => {
  // El structuredContent no lo ve el modelo. Si el aviso no está en el
  // texto, el corte es invisible para quien tiene que reaccionar.
  const filas = Array.from({ length: 250 }, (_, i) => ({ i }));
  const r = toolOkPaginado("Resumen.", { rut: "1" }, "filas", filas, 0, 100, "cmf_prueba") as {
    content: Array<{ text?: string }>;
    structuredContent: { total: number; next_offset: number | null; filas: unknown[] };
  };
  assert.equal(r.structuredContent.total, 250);
  assert.equal(r.structuredContent.next_offset, 100);
  assert.equal(r.structuredContent.filas.length, 100);
  const texto = r.content[0]?.text ?? "";
  assert.match(texto, /100 filas de 250/);
  assert.match(texto, /offset=100/, "el corte tiene que traer el parámetro exacto para continuar");
  assert.match(texto, /cmf_prueba/, "y a quién llamar");
});

test("la última página no ofrece un offset que no existe", () => {
  const filas = Array.from({ length: 30 }, (_, i) => ({ i }));
  const r = toolOkPaginado("Resumen.", {}, "filas", filas, 0, 100, "cmf_prueba") as {
    content: Array<{ text?: string }>;
    structuredContent: { next_offset: number | null };
  };
  assert.equal(r.structuredContent.next_offset, null);
  assert.doesNotMatch(r.content[0]?.text ?? "", /offset=/);
});

test("el techo de limit deja pedir muchísimo más que el default", () => {
  const campos = paginacion(100);
  const grande = campos.limit.safeParse(5000);
  assert.equal(grande.success, true, "quien quiere todo tiene que poder pedirlo");
  assert.equal(campos.limit.safeParse(0).success, false);
  assert.equal(campos.limit.parse(undefined), 100, "el default conserva el tamaño histórico");
});

test("el aviso de la última página informa el tramo cuando venías paginando", () => {
  const aviso = avisoDeTramo(20, { offset: 100, total: 120, next_offset: null }, "cmf_prueba");
  assert.match(aviso, /101 a 120 de 120/);
  assert.equal(avisoDeTramo(20, { offset: 0, total: 20, next_offset: null }, "cmf_prueba"), "");
});

/**
 * Campos donde un `.max()` significa que el SERVIDOR decide cuánto dato
 * mereces. La regla del dueño, del 21 de agosto de 2026, es que el MCP
 * entrega toda la información disponible y el agente decide qué hacer
 * con ella.
 */
const CAMPOS_SIN_TECHO = ["limit", "max_chars", "max_entradas"];

/** Devuelve el campo con techo que hay en esta línea, si lo hay. */
function techoEnLinea(linea: string): string | undefined {
  if (!/\.max\(/.test(linea)) return undefined;
  return CAMPOS_SIN_TECHO.find((campo) => new RegExp(`\\b${campo}\\s*[:=]`).test(linea));
}

test("ningún campo de tamaño lleva un techo elegido por el servidor", () => {
  // Subí estos números 6 veces antes de entender que el arreglo no era
  // otro número. 8, 500 y 5000 filas. 2.000, 30.000, 100.000 y 2.000.000
  // caracteres. Esta comprobación existe para que no vuelva a pasar.
  const culpables: string[] = [];
  const fuentes = [
    ...ARCHIVOS.map((f) => join(DIR, f)),
    join(DIR, "..", "util", "schemas.ts"),
    join(DIR, "..", "util", "tramos.ts"),
  ];
  for (const archivo of fuentes) {
    readFileSync(archivo, "utf-8").split("\n").forEach((linea, i) => {
      const campo = techoEnLinea(linea);
      if (campo !== undefined) culpables.push(`${archivo.split(/[\\/]/).pop()}:${i + 1} (${campo})`);
    });
  }
  assert.deepEqual(culpables, [], `estos campos todavía ponen techo: ${culpables.join(" | ")}`);
});

test("y ese detector SÍ puede fallar", () => {
  // La prueba de la prueba, sobre la MISMA función que usa el control de
  // arriba. Duplicar la lógica acá habría dejado pasar un detector roto,
  // que es exactamente lo que pasó cuando un escape se perdió al editar.
  assert.equal(techoEnLinea("limit: z.number().int().min(1).max(5000).default(100),"), "limit");
  assert.equal(techoEnLinea("max_chars: z.number().max(100000).default(30000),"), "max_chars");
  assert.equal(techoEnLinea("limit: z.number().int().min(1).default(100),"), undefined);
  assert.equal(techoEnLinea("anio: z.string().max(4),"), undefined, "otros campos sí pueden acotarse");
});

test("el valor por DEFECTO se conserva, que no es lo mismo que un techo", () => {
  // Un default protege a quien no pide nada, sobre todo en modo clásico,
  // donde el texto sí entra al contexto del modelo. Un techo le prohíbe
  // pedir más a quien sí sabe lo que quiere. Solo lo segundo está mal.
  const ops = construirRegistro({ CMF_RATE_LIMIT_MS: "0" });
  const doc = ops.get("documento_markdown");
  assert.ok(doc);
  assert.equal(doc.prepararArgs({ url: "https://x" }).max_chars, 30000);
  assert.equal(doc.prepararArgs({ url: "https://x", max_chars: 9_000_000 }).max_chars, 9_000_000);
});
