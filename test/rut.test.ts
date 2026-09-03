/**
 * Un solo formato de RUT en todo lo que sale de un catálogo.
 *
 * El 2 de septiembre de 2026 el informe de pruebas del MCP midió que el
 * RUT viajaba en 3 formatos según la tool que lo entregara. `cmf_listar_entidades`
 * decía «76598625-7», `cmf_catalogo_entidades` decía «99155000»,
 * `cmf_empresa_por_ticker` decía «90690000-9» y los grids de la CMF traen
 * «76.212.519-6». Cada tool de consulta quiere el RUT sin dígito verificador,
 * y el castigo por pegar el formato equivocado es una respuesta vacía.
 *
 * La regla que esta prueba hace cumplir. el campo `rut` de TODA fila que
 * sale de un catálogo viene sin puntos y sin dígito verificador, que es lo
 * que toda tool acepta. Si la fuente traía el dígito verificador, viaja en
 * `rut_dv`, para que no se pierda.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { conRutCanonico, dvDeRut, rutCanonico } from "../src/util/rut.js";
import { rutSchema, sociedadesSchema, rutOTodosSchema } from "../src/util/schemas.js";

test("rutCanonico deja el RUT sin puntos ni dígito verificador, venga como venga", () => {
  // Las 4 formas reales, medidas el 2 de septiembre de 2026.
  assert.equal(rutCanonico("76598625-7"), "76598625"); // cmf_listar_entidades
  assert.equal(rutCanonico("99155000"), "99155000"); // cmf_catalogo_entidades
  assert.equal(rutCanonico("90690000-9"), "90690000"); // cmf_empresa_por_ticker
  assert.equal(rutCanonico("76.212.519-6"), "76212519"); // grid de seguros
  assert.equal(rutCanonico("99.147.000-K"), "99147000"); // DV con letra
  assert.equal(rutCanonico(" 90.690.000 - 9 "), "90690000");
  // Un número de registro de 4 dígitos no es un RUT, pero pasa intacto.
  assert.equal(rutCanonico("7081"), "7081");
  assert.equal(rutCanonico(90690000), "90690000");
});

test("dvDeRut conserva el dígito verificador solo cuando la fuente lo traía", () => {
  assert.equal(dvDeRut("76598625-7"), "7");
  assert.equal(dvDeRut("99.147.000-K"), "K");
  assert.equal(dvDeRut("99.147.000-k"), "K");
  assert.equal(dvDeRut("99155000"), undefined);
  assert.equal(dvDeRut("7081"), undefined);
});

test("conRutCanonico normaliza la fila y guarda el DV aparte, sin inventarlo", () => {
  assert.deepEqual(conRutCanonico({ rut: "76598625-7", nombre: "PORVENIR" }), {
    rut: "76598625",
    rut_dv: "7",
    nombre: "PORVENIR",
  });
  assert.deepEqual(conRutCanonico({ rut: "99155000", nombre: "ABN" }), { rut: "99155000", nombre: "ABN" });
  // Una fila sin rut se devuelve tal cual.
  assert.deepEqual(conRutCanonico({ nombre: "X" }), { nombre: "X" });
});

test("rutSchema y rutCanonico son la MISMA regla, no 2 copias", () => {
  for (const forma of ["90.690.000-9", "90690000-9", "90690000", "90.690.000"]) {
    assert.equal(rutSchema.parse(forma), rutCanonico(forma));
  }
});

test("las listas de sociedades aceptan el RUT en cualquier formato y '0' como todas", () => {
  assert.deepEqual(sociedadesSchema.parse(["76.212.519-6", "99147000-K", "96837640"]), ["76212519", "99147000", "96837640"]);
  assert.deepEqual(sociedadesSchema.parse(["0"]), ["0"]);
  assert.deepEqual(sociedadesSchema.parse(undefined), ["0"]);
  assert.equal(rutOTodosSchema.parse(0), "0");
  assert.throws(() => rutOTodosSchema.parse("COPEC"));
});

/**
 * Comprobación de CLASE. ninguna tool declara una lista de RUT como
 * `z.array(z.string())`, porque esa forma acepta el formato con puntos y
 * lo manda a la CMF tal cual, que responde vacío. Toda lista de RUT pasa
 * por `sociedadesSchema`, y todo RUT suelto que admite «todas» por
 * `rutOTodosSchema`.
 */
const TOOLS = join(import.meta.dirname, "..", "src", "tools");
// Prohibido también `z.array(rutSchema)`, porque rutSchema exige 6 a 9
// dígitos y rechazaría el "0" que en la CMF significa todas.
const LISTA_CRUDA = /\b(sociedades|admins)\s*:\s*z\.(array\((z\.string\(\)|rutSchema)\)|string\(\))/;

function fuentesDeTools(): Map<string, string> {
  const salida = new Map<string, string>();
  for (const nombre of readdirSync(TOOLS)) {
    if (nombre.endsWith(".ts")) salida.set(nombre, readFileSync(join(TOOLS, nombre), "utf-8"));
  }
  return salida;
}

export function listasDeRutCrudas(archivos: Map<string, string>): string[] {
  const culpables: string[] = [];
  for (const [archivo, fuente] of archivos) {
    fuente.split(/\r?\n/).forEach((linea, i) => {
      if (LISTA_CRUDA.test(linea)) culpables.push(`${archivo}:${i + 1}`);
    });
  }
  return culpables;
}

test("ninguna tool recibe una lista de RUT sin normalizar", () => {
  assert.deepEqual(
    listasDeRutCrudas(fuentesDeTools()),
    [],
    "estas tools declaran sociedades o admins como texto crudo; usa sociedadesSchema o rutOTodosSchema",
  );
});

test("y esa comprobación SÍ puede fallar", () => {
  const falso = new Map([
    ["x.ts", 'inputSchema: z.object({\n  sociedades: z.array(z.string()).default(["0"]),\n})'],
    ["y.ts", '  admins: z.string().default("0"),'],
    ["z.ts", '  sociedades: z.array(rutSchema).default(["0"]),\n  sociedades: sociedadesSchema,'],
  ]);
  assert.deepEqual(listasDeRutCrudas(falso), ["x.ts:2", "y.ts:1", "z.ts:1"]);
});

/**
 * Y la otra mitad de la clase. los catálogos que entregan un `rut` lo pasan
 * por `conRutCanonico`. Se comprueba sobre el texto porque el defecto vive
 * en la ausencia de una llamada, y eso no lo ve ningún tipo.
 */
const CATALOGOS_CON_RUT = [
  ["empresas.ts", "cmf_empresa_por_ticker"],
  ["empresas.ts", "cmf_buscar_entidad"],
  ["empresas.ts", "cmf_listar_entidades"],
  ["empresas.ts", "cmf_catalogo_entidades"],
  ["fondos-inversion.ts", "cmf_fondos_inversion_catalogo"],
  ["catalogos.ts", "cmf_codigos"],
] as const;

test("todo catálogo que entrega un rut lo entrega canónico", () => {
  const archivos = fuentesDeTools();
  const sinNormalizar: string[] = [];
  for (const [archivo, tool] of CATALOGOS_CON_RUT) {
    const fuente = archivos.get(archivo) ?? "";
    const ini = fuente.indexOf(`"${tool}"`);
    assert.notEqual(ini, -1, `${tool} no está en ${archivo}`);
    // El cuerpo de la tool llega hasta el registerTool siguiente o el fin.
    const fin = fuente.indexOf("server.registerTool(", ini + 1);
    const cuerpo = fuente.slice(ini, fin === -1 ? undefined : fin);
    if (!/conRutCanonico/.test(cuerpo)) sinNormalizar.push(tool);
  }
  assert.deepEqual(sinNormalizar, [], "estos catálogos entregan el rut como venga de la fuente");
});
