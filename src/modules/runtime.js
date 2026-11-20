// Runtime dos módulos. Contrato de um módulo:
//   { id, everyMs (número ou ctx => número), priority?, init?(ctx), tick?(ctx), dispose?(ctx), ...métodos extras }
// O módulo só enxerga o que vem em `ctx` (config, estado, leitores do DOM, log, storage): nada de variável global do bot.
// Uma instância de runtime por conta/janela.
import { createScheduler } from './scheduler.js';

export const createRuntime = (ctx, { scheduler = createScheduler() } = {}) => {
    const mods = new Map();

    const register = (mod) => {
        if (mods.has(mod.id)) throw new Error(`módulo duplicado: ${mod.id}`);
        mods.set(mod.id, mod);
        mod.init?.(ctx);
        if (typeof mod.tick === 'function') {
            const everyMs = typeof mod.everyMs === 'function' ? mod.everyMs(ctx) : mod.everyMs;
            scheduler.add({ id: mod.id, everyMs, priority: mod.priority ?? 0, run: () => mod.tick(ctx) });
        }
        return mod;
    };

    // Chama um método extra de um módulo (ex.: forçar o resgate do passe pelo botão do HUD)
    const call = (id, method, ...args) => {
        const mod = mods.get(id);
        if (!mod || typeof mod[method] !== 'function') return undefined;
        return mod[method](ctx, ...args);
    };

    const dispose = () => {
        scheduler.dispose();
        for (const mod of mods.values()) {
            try {
                mod.dispose?.(ctx);
            } catch (err) {
                console.error(`[PokeBot] dispose de "${mod.id}" falhou:`, err);
            }
        }
        mods.clear();
    };

    return { register, call, start: () => scheduler.start(), dispose, scheduler, has: (id) => mods.has(id) };
};
