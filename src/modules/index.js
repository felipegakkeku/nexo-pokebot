// Ponto de entrada dos módulos: o build.mjs empacota isto (esbuild) e embute no userscript como `PokeBotModules`.
export { createScheduler } from './scheduler.js';
export { createRuntime } from './runtime.js';
export { dailyPass } from './daily-pass.js';
export { SEL, SEL_ALWAYS_PRESENT } from './selectors.js';
export { autoEvolve, evaluateEvolveRequirements } from './auto-evolve.js';
export { normalizeText } from './text.js';
