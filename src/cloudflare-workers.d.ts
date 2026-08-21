/**
 * Declaración mínima de `cloudflare:workers`.
 *
 * El módulo lo provee el runtime de Cloudflare, no npm, así que
 * TypeScript no lo encuentra solo. Acá se declara únicamente lo que
 * usamos: `WorkerEntrypoint`, la clase base cuyo stub SÍ puede viajar en
 * el `env` de un Worker cargado al vuelo. Un objeto común con métodos no
 * sobrevive ese viaje, porque el env se serializa.
 */
declare module "cloudflare:workers" {
  export class WorkerEntrypoint<Env = unknown> {
    protected readonly env: Env;
    protected readonly ctx: unknown;
    constructor(ctx: unknown, env: Env);
  }
}
