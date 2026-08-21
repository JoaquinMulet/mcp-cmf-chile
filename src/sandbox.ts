/**
 * La caja donde corre el código que escribe el modelo.
 *
 * Regla de seguridad que gobierna este archivo. **el código del modelo no
 * tiene salida a internet.** Lo único que puede tocar son las funciones
 * que le entregamos, y todas pasan por `src/client/`, con su límite de
 * velocidad, su caché y su anti-bot. Si un dato de la CMF trajera una
 * instrucción escondida, el código no tiene a dónde mandar nada.
 *
 * En producción la caja es un Worker cargado al vuelo con el binding
 * `worker_loaders`, con `globalOutbound: null`, sin sistema de archivos y
 * sin variables de entorno. Es un proceso aparte del nuestro.
 *
 * En las pruebas la caja es local, porque el cargador de Workers no
 * existe fuera del runtime de Cloudflare. Esa versión NO es segura y se
 * niega a correr si no se le pide explícitamente.
 */

/** Lo que la caja le presta al código del modelo. */
export interface Prestamos {
  /** El catálogo de operaciones, para que el modelo lo filtre. */
  catalogo: unknown;
  /** Una función async por operación de la CMF. */
  cmf: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
}

/** Lo que la caja devuelve. */
export interface Resultado {
  /** Lo que el código retornó, ya en JSON. */
  valor: unknown;
  /** Lo que el código imprimió con console.log, en orden. */
  registros: string[];
  /**
   * Lo que el programa empujó a `parcial`. Sobrevive al error.
   *
   * Existe porque una sola llamada que falla a mitad de camino tiraba
   * todo el trabajo anterior. El 21 de agosto de 2026 un agente bajó las
   * 5.956 filas del registro, empezó a leer 6 pólizas, pidió un tramo
   * más grande que el tope, y perdió los 40 segundos completos.
   */
  parcial?: unknown[];
  /** Mensaje de error legible por el modelo, si el código falló. */
  error?: string;
}

/** Quien sabe correr el código. Se inyecta para poder probar sin Cloudflare. */
export interface Ejecutor {
  correr(codigo: string, prestamos: Prestamos): Promise<Resultado>;
}

/** Presupuesto de la caja. Un programa del modelo no puede colgar el Worker. */
const LIMITES = { cpuMs: 10_000, subRequests: 60 };

/** Tope del valor devuelto, en caracteres. Ver `recortarValor`. */
const TOPE_VALOR = 40_000;

/**
 * Lo que se le dice al modelo cuando su código no retornó nada.
 *
 * Antes esto devolvía el texto "null" para las 3 causas y también para
 * una búsqueda vacía legítima, así que olvidar el `return` se leía como
 * "la CMF no tiene ese dato". En una corredora eso es un daño.
 *
 * Desde acá las 3 causas no se distinguen, porque en JavaScript caerse
 * del final de una función y devolver `undefined` a propósito son lo
 * mismo. Por eso el mensaje las nombra las 3 en vez de adivinar una.
 */
const SIN_RETURN = [
  "Tu código no devolvió ningún valor.",
  "Hay 3 causas y desde acá no se distinguen, así que revisa las 3.",
  "1. Olvidaste el return.",
  "2. Escribiste una función completa en vez del CUERPO. Así sí, return catalogo.length. Así no, async function main() { ... }.",
  "3. Tu búsqueda no encontró nada y devolviste undefined, por ejemplo con find. En ese caso devuelve un arreglo vacío o un objeto que lo diga, para que se note la diferencia entre no hay dato y el código falló.",
].join(" ");

/**
 * Quita el cerco de markdown que los modelos ponen por costumbre.
 *
 * Sin esto, los acentos graves se leen como plantilla etiquetada y el
 * error es `"" is not a function`, que no le dice nada a nadie. Es un
 * problema del formato de entrada, no del programa, así que se corrige
 * antes de ejecutar en vez de fallar.
 */
function limpiarCodigo(codigo: string): string {
  const t = codigo.trim();
  const CERCO = "```";
  if (!t.startsWith(CERCO) || !t.endsWith(CERCO) || t.length < CERCO.length * 2) return codigo;
  const SALTO = String.fromCharCode(10);
  const primerSalto = t.indexOf(SALTO);
  if (primerSalto === -1) return codigo;
  // La primera línea es el cerco con su etiqueta de lenguaje, si la trae.
  const cuerpo = t.slice(primerSalto + 1, t.length - CERCO.length);
  return cuerpo.endsWith(SALTO) ? cuerpo.slice(0, -1) : cuerpo;
}

/**
 * Acota el valor devuelto y dice cómo pedir el resto.
 *
 * La regla del proyecto prohíbe que el servidor decida qué parte del
 * dato merece verse. Esto no decide nada. el programa puede devolver
 * cualquier parte que quiera, y acá solo se evita que un `return r`
 * accidental gaste 60 mil tokens de una vez. El corte viaja con su
 * forma exacta de continuar, que en modo código es el propio código.
 */
export function recortarValor(texto: string): string {
  if (texto.length <= TOPE_VALOR) return texto;
  return [
    texto.slice(0, TOPE_VALOR),
    "",
    `[CORTE. tu código devolvió ${texto.length} caracteres y el tope de una respuesta es ${TOPE_VALOR}.`,
    "No se perdió nada en el servidor, solo en esta respuesta. Vuelve a llamar filtrando en el código,",
    "o devuelve por partes, por ejemplo return todo.slice(200, 400).]",
  ].join(String.fromCharCode(10));
}

/**
 * Traduce los errores de infraestructura del runtime.
 *
 * Los originales están en inglés, son jerga de Cloudflare, y el de
 * subpeticiones le manda al MODELO un enlace para configurar wrangler,
 * que es una instrucción dirigida a otro actor.
 */
export function traducirErrorDeCaja(bruto: string): string {
  if (/Too many subrequests/i.test(bruto)) {
    return `Tu programa hizo más de ${LIMITES.subRequests} llamadas a la CMF, que es el techo de un solo programa. Parte el trabajo en varias llamadas a cmf_ejecutar y devuelve el offset al que llegaste para continuar en la siguiente.`;
  }
  if (/exceeded CPU time/i.test(bruto)) {
    return `Tu programa pasó los ${LIMITES.cpuMs / 1000} segundos de CPU. Revisa si hay un bucle sin salida, y si el trabajo es legítimo, pártelo en varias llamadas a cmf_ejecutar.`;
  }
  if (/exceeded memory/i.test(bruto)) {
    return "Tu programa se quedó sin memoria. No acumules todos los resultados; filtra dentro del bucle y guarda solo lo que vas a devolver.";
  }
  return bruto;
}

/**
 * Expone las operaciones al programa sin mentir sobre lo que existe.
 *
 * Un proxy que devuelve función para CUALQUIER nombre le miente al
 * programa. `typeof cmf.loQueSea` diría "function" aunque no exista, y en
 * `cmf_buscar`, donde no hay ninguna operación disponible, parecería que
 * sí las hay. Por eso el nombre desconocido devuelve `undefined`, y para
 * los que existen se entrega la función de verdad.
 */
function construirProxyCmf(
  operaciones: Record<string, (args: Record<string, unknown>) => Promise<unknown>>,
): Record<string, unknown> {
  const hayAlguna = Object.keys(operaciones).length > 0;
  return new Proxy({} as Record<string, unknown>, {
    has: (_t, nombre) => String(nombre) in operaciones,
    ownKeys: () => Object.keys(operaciones),
    getOwnPropertyDescriptor: (_t, nombre) =>
      String(nombre) in operaciones
        ? { configurable: true, enumerable: true, value: operaciones[String(nombre)] }
        : undefined,
    get: (_t, nombre) => {
      const clave = String(nombre);
      const fn = operaciones[clave];
      if (fn) {
        // Mismo viaje por JSON que en producción, para que las pruebas
        // midan la semántica real del borde y no una más permisiva.
        return async (args: Record<string, unknown>) =>
          JSON.parse(JSON.stringify(await fn(args ?? {})) ?? "null");
      }
      if (!hayAlguna) {
        // Caso de cmf_buscar. no hay red acá, y hay que decir por qué.
        return () => {
          throw new Error(
            "cmf_buscar no puede llamar operaciones, solo filtrar el catálogo. Usa cmf_ejecutar para llamarlas.",
          );
        };
      }
      return undefined;
    },
  });
}

/**
 * Traduce el error crudo de JavaScript a algo que el modelo pueda usar
 * para corregirse. `cmf.loQueSea is not a function` no le dice nada.
 */
function mejorarError(e: unknown): string {
  const bruto = e instanceof Error ? e.message : String(e);
  const nombreMalo = /cmf\.([A-Za-z0-9_]+) is not a function/.exec(bruto);
  if (nombreMalo) {
    return `La operación "${nombreMalo[1]}" no existe en el catálogo. Búscala primero con cmf_buscar para saber su nombre exacto.`;
  }
  return bruto;
}

/**
 * Envuelve el código del modelo en un módulo de Worker.
 *
 * El código va TAL CUAL adentro de una función async. No se sanitiza,
 * porque el aislamiento no lo da el texto, lo da el borde del Worker.
 */
function moduloDelPrograma(codigoCrudo: string): string {
  const codigo = limpiarCodigo(codigoCrudo);
  return `
const registros = [];
const parcial = [];
const console = { log: (...a) => registros.push(a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ")) };
export default {
  async fetch(peticion, env) {
    const catalogo = env.CATALOGO;
    const nombres = new Set(env.NOMBRES);
    // Mismo criterio que en el ejecutor local: el proxy no miente sobre
    // qué operaciones existen.
    if (!env.PUENTE) {
      // Esta rama es cmf_buscar. No hay puente que llamar.
      const sinRed = () => { throw new Error("Esta herramienta solo filtra el catálogo, no llama operaciones. Usa cmf_ejecutar para llamarlas."); };
      const cmf = new Proxy({}, { get: () => sinRed, has: () => false, ownKeys: () => [] });
      try {
        const valor = await (async () => { ${codigo} })();
        if (valor === undefined) return Response.json({ valor: null, registros, parcial, error: ${JSON.stringify(SIN_RETURN)} });
        return Response.json({ valor, registros, parcial });
      } catch (e) {
        return Response.json({ valor: null, registros, parcial, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const cmf = new Proxy({}, {
      has: (_, n) => nombres.has(String(n)),
      ownKeys: () => [...nombres],
      getOwnPropertyDescriptor: (_, n) =>
        nombres.has(String(n)) ? { configurable: true, enumerable: true, value: 1 } : undefined,
      get: (_, n) => (nombres.has(String(n))
        ? async (args) => JSON.parse(await env.PUENTE.llamar(String(n), args ?? {}))
        : undefined),
    });
    try {
      const valor = await (async () => { ${codigo} })();
      if (valor === undefined) return Response.json({ valor: null, registros, parcial, error: ${JSON.stringify(SIN_RETURN)} });
      return Response.json({ valor, registros, parcial });
    } catch (e) {
      const bruto = e instanceof Error ? e.message : String(e);
      const malo = /cmf\\.([A-Za-z0-9_]+) is not a function/.exec(bruto);
      const error = malo
        ? 'La operación "' + malo[1] + '" no existe en el catálogo. Búscala primero con cmf_buscar para saber su nombre exacto.'
        : bruto;
      return Response.json({ valor: null, registros, parcial, error });
    }
  },
};`;
}

/**
 * Ejecutor de producción. Carga un Worker nuevo por cada programa.
 * @param cargador Binding `worker_loaders` del entorno.
 * @param fechaCompatibilidad La misma del wrangler, para que el runtime calce.
 */
export function ejecutorDeWorker(
  cargador: WorkerLoaderLike,
  fechaCompatibilidad: string,
  crearPuente: (permitidas: string[]) => unknown,
): Ejecutor {
  return {
    async correr(codigo, prestamos) {
      const permitidas = Object.keys(prestamos.cmf);
      // El puente es la ÚNICA puerta del programa hacia el mundo, y tiene
      // que ser un stub de WorkerEntrypoint. Los valores de `env` viajan
      // serializados al aislado; un objeto con métodos no sobrevive ese
      // viaje, y un stub sí, porque va por referencia. Lo crea quien tiene
      // el `ctx` de la petición, así que llega inyectado.
      const stub = cargador.get(null, () => ({
        compatibilityDate: fechaCompatibilidad,
        mainModule: "programa.js",
        modules: { "programa.js": moduloDelPrograma(codigo) },
        // El puente NO se inyecta si no hay operaciones permitidas, y
        // cuando se inyecta lleva su lista adentro.
        //
        // Esto no es redundancia. El código del modelo se inserta dentro
        // de la función `fetch(peticion, env)` del módulo, así que `env`
        // queda en su alcance léxico y el proxy `cmf` es una comodidad,
        // nunca una valla. Verificado contra el despliegue el 20 de
        // agosto de 2026. `cmf_buscar`, que se documenta sin red,
        // alcanzaba las 86 operaciones con `env.PUENTE.llamar(...)`.
        // La única frontera real es la que vive del lado del servidor.
        env: {
          CATALOGO: prestamos.catalogo,
          NOMBRES: permitidas,
          ...(permitidas.length > 0 ? { PUENTE: crearPuente(permitidas) } : {}),
        },
        // Sin salida a internet. Esta línea es la garantía de seguridad.
        globalOutbound: null,
        limits: LIMITES,
      }));
      // El stub no se llama directo: expone el Worker por su entrypoint.
      //
      // El try envuelve la INVOCACIÓN, no solo el programa. Un error de
      // sintaxis impide compilar el módulo, y los topes del runtime lo
      // matan desde afuera, así que los 2 revientan antes de que corra
      // el try de adentro y llegaban crudos, en inglés y sin contexto.
      try {
        const entrada = stub.getEntrypoint(undefined, { limits: LIMITES });
        const respuesta = await entrada.fetch("https://caja.invalid/");
        return (await respuesta.json()) as Resultado;
      } catch (e) {
        const bruto = e instanceof Error ? e.message : String(e);
        return { valor: null, registros: [], error: traducirErrorDeCaja(bruto) };
      }
    },
  };
}

/**
 * Forma mínima del binding, para no depender de los tipos experimentales.
 * El stub NO se llama directo. hay que pedirle su entrypoint primero.
 */
export interface WorkerLoaderLike {
  get(
    nombre: string | null,
    getCode: () => unknown,
  ): {
    getEntrypoint(
      nombre?: string,
      opciones?: { limits?: { cpuMs?: number; subRequests?: number } },
    ): { fetch(url: string): Promise<Response> };
  };
}

/**
 * Ejecutor LOCAL, solo para pruebas. **No aísla nada.**
 *
 * Corre el código en este mismo proceso, así que un programa hostil
 * tendría todo. Existe porque el cargador de Workers no está fuera del
 * runtime de Cloudflare y sin esto no se podría probar la lógica.
 * @param permitirInseguro Hay que pasar `true` a propósito.
 */
export function ejecutorLocalDePrueba(permitirInseguro: boolean): Ejecutor {
  if (!permitirInseguro) {
    throw new Error("ejecutorLocalDePrueba: no aísla nada; pásale true solo desde una prueba");
  }
  return {
    async correr(codigo, prestamos) {
      const registros: string[] = [];
      const consola = {
        log: (...a: unknown[]) =>
          registros.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")),
      };
      const parcial: unknown[] = [];
      const cmf = construirProxyCmf(prestamos.cmf);
      try {
        const fn = new Function(
          "catalogo",
          "cmf",
          "console",
          "parcial",
          `return (async () => { ${limpiarCodigo(codigo)} })()`,
        ) as (c: unknown, m: unknown, k: unknown, p: unknown[]) => Promise<unknown>;
        const valor = await fn(prestamos.catalogo, cmf, consola, parcial);
        if (valor === undefined) return { valor: null, registros, parcial, error: SIN_RETURN };
        return { valor, registros, parcial };
      } catch (e) {
        return { valor: null, registros, parcial, error: mejorarError(e) };
      }
    },
  };
}
