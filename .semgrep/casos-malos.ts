// CASOS MALOS a proposito. Cada uno reintroduce un defecto que ya nos
// costo caro, para probar que su regla de Semgrep sepa dispararse.
//
// Este archivo NO se compila ni se despliega. Vive fuera de src/ y de
// test/, y solo lo lee el escaner. Una regla que nunca puede encontrar
// nada da confianza falsa, asi que cada una tiene su caso aqui.
//
// Si agregas una regla, agrega su caso malo en la misma tanda. Y si
// quitas una, quita el caso.

declare function resumirTabla(filas: unknown[], cols: string[]): string;
declare function paginar(filas: unknown[], offset: number, limit: number): unknown;
declare const filas: Record<string, unknown>[];
declare const z: { number(): { max(n: number): unknown } };

// texto-recortado-antes-de-paginar
export const malo1 = resumirTabla(filas.slice(0, 10), ["a", "b"]);

// paginar-con-offset-clavado
export const malo2 = paginar(filas, 0, 50);

// replace-de-texto-donde-hay-varias-apariciones
export const malo3 = "../../doc/x.pdf".replace("../", "/institucional/");

// techo-elegido-por-el-servidor
export const malo4 = { limit: z.number().max(500) };
