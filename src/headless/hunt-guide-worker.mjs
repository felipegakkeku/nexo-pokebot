// Worker thread dedicado para executar o motor /hunt sem travar a thread principal do Electron/Node.
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const HUNT_REQUIRED_FILES = [
    'src/boot.js',
    'src/jogo-bundle.js',
    'src/game.js',
    'src/ritmo.js',
    'src/engine.js',
];

const SEASONAL_TYPES = new Set([
    'NORMAL', 'FIRE', 'WATER', 'ELECTRIC', 'GRASS', 'ICE', 'FIGHTING', 'POISON',
    'GROUND', 'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY',
]);

let runtimePromise = null;
const welcomeCache = new Map();

async function ensureRuntime(extDir) {
    if (!runtimePromise) {
        runtimePromise = (async () => {
            const sandbox = {
                console,
                fetch: globalThis.fetch,
                URL,
                URLSearchParams,
                performance: globalThis.performance || { now: () => Date.now() },
                setTimeout,
                clearTimeout,
                Intl,
                location: { origin: 'https://pokeidle.io', href: 'https://pokeidle.io/app' },
                document: { querySelector: () => null },
            };
            sandbox.globalThis = sandbox;
            sandbox.self = sandbox;
            sandbox.window = sandbox;
            const ctx = vm.createContext(sandbox);
            for (const rel of HUNT_REQUIRED_FILES) {
                const filePath = join(extDir, rel);
                const code = readFileSync(filePath, 'utf8');
                vm.runInContext(code, ctx, { filename: filePath });
            }
            const PIH = sandbox.__pokeidleHunt;
            if (!PIH?.carregarJogo || !PIH?.engine?.analisar) {
                throw new Error('Motor /hunt invalido na extensao local.');
            }
            const game = await PIH.carregarJogo();
            return { PIH, game };
        })().catch((err) => {
            runtimePromise = null;
            throw err;
        });
    }
    return runtimePromise;
}

parentPort?.on('message', async (msg) => {
    const { id, extDir, welcomeKey, welcome, state, metric = 'xp', region = '' } = msg || {};
    try {
        const targetExtDir = extDir || workerData?.extDir;
        if (welcomeKey && welcome) {
            welcomeCache.set(welcomeKey, welcome);
            if (welcomeCache.size > 6) {
                const oldest = welcomeCache.keys().next().value;
                welcomeCache.delete(oldest);
            }
        }
        const effectiveWelcome = welcome || (welcomeKey ? welcomeCache.get(welcomeKey) : null);
        if (!targetExtDir || !effectiveWelcome || !state) {
            parentPort.postMessage({ id, result: null });
            return;
        }
        const activePk = (state.pokemons || []).find((pk) => pk && String(pk.id) === String(state.activeId));
        if (!activePk?.id || !activePk.stats) {
            parentPort.postMessage({ id, result: null });
            return;
        }

        const { PIH, game } = await ensureRuntime(targetExtDir);
        const tipoRaw = state?.diaSazonal?.tipo;
        const tipoDoDia = SEASONAL_TYPES.has(tipoRaw) ? tipoRaw : null;

        const ctx = {
            mod: game.mod,
            especies: game.especies,
            hunts: effectiveWelcome.hunts ?? [],
            consts: {
                tabelaTipos: effectiveWelcome.tabelaTipos,
                ampliacaoHunt: effectiveWelcome.ampliacaoHunt,
                multHpSelvagem: effectiveWelcome.multHpSelvagem,
                multDanoSelvagem: effectiveWelcome.multDanoSelvagem,
                tiposBoost: effectiveWelcome.tiposBoost,
                catalogoBolas: effectiveWelcome.catalogoBolas,
                captura: effectiveWelcome.captura,
                chanceShiny: effectiveWelcome.chanceShiny,
                shinyLooks: effectiveWelcome.shinyLooks,
            },
            eu: state,
            ritmo: PIH.ritmo ?? null,
            mapaVisto: () => null,
            ritmoMedido: () => null,
        };

        const result = PIH.engine.analisar(activePk, ctx, {
            ordem: metric,
            soLiberadas: true,
            regiao: region || '',
            tipoDoDia,
        });
        const eligible = (result?.linhas || []).filter((row) => row.liberada && !row.inviavel);
        const regional = region ? eligible.filter((row) => row.regiao === region) : null;
        const pool = regional?.length ? regional : eligible;
        const isSafe = (row) => !row.umHit && !(Number(row.mortesH || 0) >= 0.5);
        const best = pool.find(isSafe) || pool[0];
        if (!best?.slug) {
            parentPort.postMessage({ id, result: null });
            return;
        }

        const value = { xp: best.xpPokemonH, ouro: best.ouroH, shiny: best.shinyH }[metric];
        if (!Number.isFinite(value) || value <= 0) {
            parentPort.postMessage({ id, result: null });
            return;
        }
        parentPort.postMessage({
            id,
            result: {
                slug: best.slug,
                name: best.nome,
                pokemonId: activePk.id,
                pokemonLevel: activePk.level,
                level: best.nivel,
                region: best.regiao,
                value,
                unsafe: Boolean(best.umHit || Number(best.mortesH || 0) >= 0.5),
                source: 'headless',
            },
        });
    } catch (err) {
        parentPort.postMessage({ id, error: err?.message || String(err) });
    }
});
