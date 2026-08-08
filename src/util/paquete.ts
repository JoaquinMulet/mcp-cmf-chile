/**
 * Helpers de orquestación de paquetes: ejecución con semáforo global,
 * caché de binarios y presupuesto de requests.
 */

export interface ResultadoBarrer<T> {
  ok: T[];
  fallidos: { clave: string; motivo: string }[];
}

/**
 * Ejecuta tareas en paralelo acotado, capturando fallos individuales.
 * El semáforo global garantiza un solo job pesado a la vez por instancia
 * (fair use hacia la CMF: un cliente no satura el rate limiter del host).
 */
let jobsPesados = 0;
const MAX_JOBS_PESADOS = 1;

export async function conSemafotoGlobal<T>(fn: () => Promise<T>): Promise<T> {
  while (jobsPesados >= MAX_JOBS_PESADOS) {
    await new Promise((r) => setTimeout(r, 200));
  }
  jobsPesados++;
  try {
    return await fn();
  } finally {
    jobsPesados--;
  }
}

export async function barrerPeriodos<T>(
  specs: { clave: string; tarea: () => Promise<T> }[],
  concurrencia = 3,
): Promise<ResultadoBarrer<T>> {
  const ok: T[] = [];
  const fallidos: { clave: string; motivo: string }[] = [];
  let idx = 0;

  async function worker() {
    while (idx < specs.length) {
      const i = idx++;
      const spec = specs[i];
      try {
        ok.push(await spec.tarea());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        fallidos.push({ clave: spec.clave, motivo: msg.slice(0, 120) });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrencia, specs.length) }, () => worker()),
  );
  return { ok, fallidos };
}

/** Presupuesto de requests CMF según el plan (1 request ≈ 1.1s con el rate limiter). */
export function estimarTiempoS(requests: number): number {
  return Math.round(requests * 1.1);
}

/** Convierte bytes a MB con 1 decimal. */
export function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
