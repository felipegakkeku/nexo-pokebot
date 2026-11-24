import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';

const WORKER_URL = new URL('./hunt-guide-worker.mjs', import.meta.url);
const EVAL_CACHE_TTL_MS = 5 * 60_000;
const MAX_EVAL_CACHE = 64;

export const HUNT_EXTENSION_ID = 'mhnplloljgchpfpcpbhmcokmnefodjnh';

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

function compareVersionNames(a, b) {
    const pa = String(a || '').split(/[._-]/).map((n) => Number.parseInt(n, 10) || 0);
    const pb = String(b || '').split(/[._-]/).map((n) => Number.parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const diff = (pb[i] || 0) - (pa[i] || 0);
        if (diff !== 0) return diff;
    }
    return String(b || '').localeCompare(String(a || ''));
}

function isValidHuntExtensionVersionDir(dir) {
    return Boolean(dir) &&
        existsSync(join(dir, 'manifest.json')) &&
        HUNT_REQUIRED_FILES.every((rel) => existsSync(join(dir, rel)));
}

function findLatestVersionUnderExtIdDir(extIdDir) {
    if (!extIdDir || !existsSync(extIdDir)) return null;
    if (isValidHuntExtensionVersionDir(extIdDir)) return resolve(extIdDir);
    let entries;
    try {
        entries = readdirSync(extIdDir, { withFileTypes: true });
    } catch {
        return null;
    }
    const versions = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort(compareVersionNames);
    for (const ver of versions) {
        const candidate = join(extIdDir, ver);
        if (isValidHuntExtensionVersionDir(candidate)) return resolve(candidate);
    }
    return null;
}

/**
 * Localiza a pasta da extensao "/hunt for PokeIdle" instalada no Chrome/Edge ou nos perfis do bot.
 * @param {object} [options] Caminhos extras e cwd para busca ou teste.
 * @returns {string|null} Caminho absoluto da versao mais recente encontrada ou null.
 */
export function findHuntExtensionDir(options = {}) {
    const envDir = options.extensionDir ?? process.env.POKEBOT_HUNT_EXT_DIR;
    if (envDir) {
        const direct = findLatestVersionUnderExtIdDir(envDir);
        if (direct) return direct;
    }

    const roots = [];
    if (Array.isArray(options.extraRoots)) {
        roots.push(...options.extraRoots);
    }
    if (!options.onlyExtraRoots) {
        const baseCwd = options.cwd || process.cwd();
        const localAppData = options.localAppData || process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
        roots.push(
            join(localAppData, 'Google', 'Chrome', 'User Data'),
            join(localAppData, 'Microsoft', 'Edge', 'User Data'),
            join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
            join(baseCwd, '.pokebot-browser-profile'),
            join(baseCwd, '.pokebot-accounts', '2', '.pokebot-browser-profile'),
            join(baseCwd, '.pokebot-accounts', '3', '.pokebot-browser-profile'),
            join(baseCwd, '.pokebot-accounts', '4', '.pokebot-browser-profile'),
        );
    }

    const candidates = [];
    for (const root of roots) {
        if (!root || !existsSync(root)) continue;
        const direct = findLatestVersionUnderExtIdDir(root);
        if (direct) {
            candidates.push({ dir: direct, version: direct.split(/[\\/]/).pop() });
            continue;
        }
        let profiles;
        try {
            profiles = readdirSync(root, { withFileTypes: true })
                .filter((e) => e.isDirectory() && (e.name === 'Default' || e.name.startsWith('Profile ')))
                .map((e) => e.name);
        } catch {
            continue;
        }
        for (const prof of profiles) {
            const found = findLatestVersionUnderExtIdDir(join(root, prof, 'Extensions', HUNT_EXTENSION_ID));
            if (found) {
                candidates.push({ dir: found, version: found.split(/[\\/]/).pop() });
            }
        }
    }

    candidates.sort((a, b) => compareVersionNames(a.version, b.version));
    return candidates[0]?.dir || null;
}

function buildEvalCacheKey(welcome, state, activePk, metric, region) {
    const now = Date.now();
    const twBonus = state?.twitch?.bonus || {};
    const kkBonus = state?.kick?.bonus || {};
    const activeFlags = [
        Number(twBonus.xp) > now ? 1 : 0,
        Number(twBonus.captura) > now ? 1 : 0,
        Number(twBonus.shiny) > now ? 1 : 0,
        Number(kkBonus.xp) > now ? 1 : 0,
        Number(kkBonus.captura) > now ? 1 : 0,
        Number(kkBonus.shiny) > now ? 1 : 0,
        state?.loja?.vip ? 1 : 0,
        state?.sacrificio?.boostAte > now ? 1 : 0,
    ].join('');
    return JSON.stringify([
        metric,
        region || '',
        state?.nick || '',
        state?.level || 0,
        state?.diaSazonal?.tipo || '',
        activeFlags,
        welcome?.hunts?.length || 0,
        Array.isArray(state?.huntsLiberadas) ? state.huntsLiberadas.length : 0,
        state?.automation?.prey?.dia || '',
        activePk.id,
        activePk.speciesId,
        activePk.level,
        activePk.stats,
        activePk.tipos || null,
        activePk.golpes || activePk.moves || null,
    ]);
}

function compactStateForWorker(state, activePk) {
    return {
        nick: state.nick,
        level: state.level,
        activeId: state.activeId,
        huntSlug: state.huntSlug,
        diaSazonal: state.diaSazonal,
        huntsLiberadas: state.huntsLiberadas,
        pokedex: state.pokedex,
        podio: state.podio,
        bestiario: state.bestiario,
        loja: state.loja,
        twitch: state.twitch,
        kick: state.kick,
        sacrificio: state.sacrificio,
        guild: state.guild,
        buffs: state.buffs,
        automation: state.automation,
        pokemons: [activePk],
    };
}

/**
 * Cria um avaliador /hunt 100% headless usando Worker thread (zero travamento na UI) + cache por assinatura.
 * Faz fallback automatico para vm inline apenas quando options.fetch customizado e fornecido (testes).
 * @param {object} [options] Opcoes de diretorio da extensao, useWorker e fetch customizado para testes.
 * @returns {{ isAvailable: () => boolean, getExtensionDir: () => string|null, evaluate: (params: object) => Promise<object|null>, dispose: () => void }}
 */
export function createHeadlessHuntGuideEvaluator(options = {}) {
    let resolvedExtDir = null;
    let runtimePromise = null;
    let worker = null;
    let nextReqId = 1;
    let nextWelcomeId = 1;
    const pending = new Map();
    const sentWelcomes = new WeakMap();
    const evalCache = new Map();
    const inFlight = new Map();
    const fetchFn = options.fetch || globalThis.fetch;
    const useWorker = options.useWorker !== false && !options.fetch;

    const getExtensionDir = () => {
        if (resolvedExtDir && isValidHuntExtensionVersionDir(resolvedExtDir)) return resolvedExtDir;
        resolvedExtDir = findHuntExtensionDir(options);
        return resolvedExtDir;
    };

    const failPendingWorker = (err) => {
        for (const [, p] of pending) {
            p.reject(err);
        }
        pending.clear();
        worker = null;
    };

    const ensureWorker = (extDir) => {
        if (worker) return worker;
        const w = new Worker(WORKER_URL, { workerData: { extDir } });
        w.unref();
        w.on('message', (msg) => {
            const p = pending.get(msg?.id);
            if (!p) return;
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve(msg.result ?? null);
        });
        w.on('error', (err) => failPendingWorker(err));
        w.on('exit', (code) => {
            if (pending.size > 0) {
                failPendingWorker(new Error(`Worker /hunt encerrado (${code})`));
            }
            if (worker === w) worker = null;
        });
        worker = w;
        return worker;
    };

    const evaluateInWorker = (extDir, { welcome, state, activePk, metric, region }) => new Promise((resolvePromise, rejectPromise) => {
        const w = ensureWorker(extDir);
        const id = nextReqId++;
        pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
        let welcomeKey = sentWelcomes.get(welcome);
        let welcomePayload = null;
        if (!welcomeKey) {
            welcomeKey = `w-${nextWelcomeId++}`;
            sentWelcomes.set(welcome, welcomeKey);
            welcomePayload = {
                hunts: welcome.hunts ?? [],
                tabelaTipos: welcome.tabelaTipos,
                ampliacaoHunt: welcome.ampliacaoHunt,
                multHpSelvagem: welcome.multHpSelvagem,
                multDanoSelvagem: welcome.multDanoSelvagem,
                tiposBoost: welcome.tiposBoost,
                catalogoBolas: welcome.catalogoBolas,
                captura: welcome.captura,
                chanceShiny: welcome.chanceShiny,
                shinyLooks: welcome.shinyLooks,
            };
        }
        w.postMessage({
            id,
            extDir,
            welcomeKey,
            welcome: welcomePayload,
            state: compactStateForWorker(state, activePk),
            metric,
            region,
        });
    });

    const ensureRuntime = async () => {
        const extDir = getExtensionDir();
        if (!extDir) return null;
        if (!runtimePromise) {
            runtimePromise = (async () => {
                const sandbox = {
                    console,
                    fetch: fetchFn,
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
    };

    const evaluateInline = async ({ welcome, state, activePk, metric, region }) => {
        const loaded = await ensureRuntime();
        if (!loaded) return null;
        const { PIH, game } = loaded;
        const tipoRaw = state?.diaSazonal?.tipo;
        const tipoDoDia = SEASONAL_TYPES.has(tipoRaw) ? tipoRaw : null;

        const ctx = {
            mod: game.mod,
            especies: game.especies,
            hunts: welcome.hunts ?? [],
            consts: {
                tabelaTipos: welcome.tabelaTipos,
                ampliacaoHunt: welcome.ampliacaoHunt,
                multHpSelvagem: welcome.multHpSelvagem,
                multDanoSelvagem: welcome.multDanoSelvagem,
                tiposBoost: welcome.tiposBoost,
                catalogoBolas: welcome.catalogoBolas,
                captura: welcome.captura,
                chanceShiny: welcome.chanceShiny,
                shinyLooks: welcome.shinyLooks,
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
        if (!best?.slug) return null;

        const value = { xp: best.xpPokemonH, ouro: best.ouroH, shiny: best.shinyH }[metric];
        if (!Number.isFinite(value) || value <= 0) return null;
        return {
            slug: best.slug,
            name: best.nome,
            pokemonId: activePk.id,
            pokemonLevel: activePk.level,
            level: best.nivel,
            region: best.regiao,
            value,
            unsafe: Boolean(best.umHit || Number(best.mortesH || 0) >= 0.5),
            source: 'headless',
        };
    };

    const evaluate = async ({ welcome, state, metric = 'xp', region = '' } = {}) => {
        if (!welcome || !state) return null;
        const activePk = (state.pokemons || []).find((pk) => pk && String(pk.id) === String(state.activeId));
        if (!activePk?.id || !activePk.stats) return null;
        const extDir = getExtensionDir();
        if (!extDir) return null;

        const cacheKey = buildEvalCacheKey(welcome, state, activePk, metric, region);
        const now = Date.now();
        const cached = evalCache.get(cacheKey);
        if (cached && now - cached.at < EVAL_CACHE_TTL_MS) {
            return cached.result;
        }
        if (inFlight.has(cacheKey)) {
            return inFlight.get(cacheKey);
        }

        const run = (async () => {
            let res;
            if (useWorker) {
                try {
                    res = await evaluateInWorker(extDir, { welcome, state, activePk, metric, region });
                } catch {
                    res = await evaluateInline({ welcome, state, activePk, metric, region });
                }
            } else {
                res = await evaluateInline({ welcome, state, activePk, metric, region });
            }
            if (evalCache.size >= MAX_EVAL_CACHE) {
                const oldest = evalCache.keys().next().value;
                evalCache.delete(oldest);
            }
            evalCache.set(cacheKey, { at: Date.now(), result: res });
            return res;
        })().finally(() => {
            inFlight.delete(cacheKey);
        });

        inFlight.set(cacheKey, run);
        return run;
    };

    const dispose = () => {
        if (worker) {
            const w = worker;
            worker = null;
            w.terminate().catch(() => {});
        }
        pending.clear();
        inFlight.clear();
        evalCache.clear();
    };

    return {
        isAvailable: () => Boolean(getExtensionDir()),
        getExtensionDir,
        evaluate,
        dispose,
    };
}

export async function readHuntGuideInPage(metric) {
    const guide = globalThis.__pokeidleHunt;
    const calc = guide?.calculo;
    if (!guide?.engine?.analisar || !guide.carregarJogo || !calc?.pronto?.()) return null;

    const pokemon = calc.pkAtivo();
    const game = await guide.carregarJogo();
    if (!pokemon?.id || calc.pkAtivo()?.id !== pokemon.id) return null;
    const opts = calc.opcoes();
    const result = guide.engine.analisar(pokemon, calc.contexto(game, pokemon), {
        ...opts, ordem: metric, soLiberadas: true,
    });
    const eligible = result.linhas.filter((row) => row.liberada && !row.inviavel);
    const regional = opts.regiao && eligible.filter((row) => row.regiao === opts.regiao);
    const pool = regional?.length ? regional : eligible;
    const isSafe = (row) => !row.umHit && !(Number(row.mortesH || 0) >= 0.5);
    const best = pool.find(isSafe) || pool[0];
    if (!best?.slug) return null;
    const value = { xp: best.xpPokemonH, ouro: best.ouroH, shiny: best.shinyH }[metric];
    if (!Number.isFinite(value) || value <= 0) return null;
    return {
        slug: best.slug,
        name: best.nome,
        pokemonId: pokemon.id,
        pokemonLevel: pokemon.level,
        level: best.nivel,
        region: best.regiao,
        value,
        unsafe: Boolean(best.umHit || best.mortesH >= 0.5),
    };
}

export function describeHuntGuide(result, metric) {
    const number = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 2 });
    const rate = metric === 'shiny'
        ? `1 shiny a cada ${number.format(1 / result.value)} h (estimativa)`
        : `${number.format(result.value)} ${metric === 'xp' ? 'XP/h' : 'ouro/h'}`;
    return `${result.name} · Nv ${result.level} · ${rate}`;
}
