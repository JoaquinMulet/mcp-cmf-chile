/** Declaración de tipos para imports de módulos wasm (wrangler los convierte a WebAssembly.Module). */
declare module "*.wasm" {
  const m: WebAssembly.Module;
  export default m;
}
