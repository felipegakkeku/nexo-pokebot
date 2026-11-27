import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';

const WORKER_URL = new URL('./hunt-guide-worker.mjs', import.meta.url);
const NATIVE_ANALYSER_URL = new URL('./native-hunt-analyser.mjs', import.meta.url);
const EVAL_CACHE_TTL_MS = 5 * 60_000;
const MAX_EVAL_CACHE = 64;

let cachedNativeAnalyser = null;
async function getNativeHuntAnalyser() {
    if (cachedNativeAnalyser) return cachedNativeAnalyser;
    try {
        const mod = await import('./native-hunt-analyser.mjs');
        if (typeof mod?.analyzeNativeHunts === 'function') {
            cachedNativeAnalyser = mod.analyzeNativeHunts;
            return cachedNativeAnalyser;
        }
    } catch {
        // Modulo nativo indisponivel neste ambiente.
    }
    return null;
}

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

export function isValidHuntExtensionVersionDir(dir) {
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
            // cópia que o próprio Hub baixa da Chrome Web Store (hunt-ext-install.mjs)
            join(baseCwd, '.pokebot-hunt-ext'),
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
        state?.automation?.prey?.cartelas || null,
        state?.ginasiosPodio ?? state?.podio ?? null,
        state?.bonusXp ?? null,
        state?.evento ?? null,
        activePk.id,
        activePk.speciesId,
        activePk.level,
        activePk.stats,
        activePk.ivs || null,
        activePk.tmAoe || null,
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
        ginasiosPodio: state.ginasiosPodio,
        ginasios: state.ginasios,
        bonusXp: state.bonusXp,
        evento: state.evento,
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
        const ranked = pool
            .filter((row) => row?.slug)
            .map((row) => ({
                slug: String(row.slug),
                name: String(row.nome || row.slug),
                level: Number(row.nivel || 0),
                region: String(row.regiao || ''),
                value: Number({ xp: row.xpPokemonH, ouro: row.ouroH, shiny: row.shinyH }[metric] || 0),
                xpH: Number(row.xpPokemonH || 0),
                goldH: Number(row.ouroH || 0),
                shinyH: Number(row.shinyH || 0),
                unsafe: Boolean(row.umHit || Number(row.mortesH || 0) >= 0.5),
            }));
        return {
            slug: best.slug,
            name: best.nome,
            pokemonId: activePk.id,
            pokemonLevel: activePk.level,
            level: best.nivel,
            region: best.regiao,
            value,
            unsafe: Boolean(best.umHit || Number(best.mortesH || 0) >= 0.5),
            ranked,
            source: 'headless',
        };
    };

    const normalizeNativeResult = (raw, { activePk, metric, region, huntsBySlug }) => {
        if (!raw || typeof raw !== 'object') return null;
        const rawList = Array.isArray(raw)
            ? raw
            : (Array.isArray(raw.byMetric?.[metric])
                ? raw.byMetric[metric]
                : (Array.isArray(raw.ranked) ? raw.ranked : (Array.isArray(raw.linhas) ? raw.linhas : [])));
        const metricKey = metric === 'ouro' ? 'goldH' : (metric === 'shiny' ? 'shinyH' : 'xpH');
        const allMapped = rawList
            .filter((row) => row && row.slug)
            .map((row) => {
                const huntMeta = huntsBySlug?.get(String(row.slug)) || null;
                const xpH = Number(row.xpH ?? row.xpPokemonH ?? 0);
                const goldH = Number(row.goldH ?? row.ouroH ?? 0);
                const shinyH = Number(row.shinyH ?? 0);
                const val = Number(row.value ?? ({ xp: xpH, ouro: goldH, shiny: shinyH }[metric]) ?? 0);
                return {
                    slug: String(row.slug),
                    name: String(row.name || row.nome || huntMeta?.nome || row.slug),
                    level: Number(row.level ?? row.nivel ?? huntMeta?.nivel ?? 0),
                    region: String(row.region ?? row.regiao ?? huntMeta?.regiao ?? ''),
                    value: val,
                    xpH,
                    goldH,
                    shinyH,
                    unsafe: Boolean(row.unsafe || row.umHit || Number(row.mortesH || 0) >= 0.5),
                };
            });
        const regional = region ? allMapped.filter((r) => r.region === region) : null;
        const ranked = regional?.length ? regional : allMapped;
        const bestRaw = (!Array.isArray(raw) && !region && raw.best)
            ? raw.best
            : (ranked.find((r) => !r.unsafe) || ranked[0] || null);
        if (!bestRaw?.slug) return null;
        const bestXpH = Number(bestRaw.xpH ?? bestRaw.xpPokemonH ?? 0);
        const bestGoldH = Number(bestRaw.goldH ?? bestRaw.ouroH ?? 0);
        const bestShinyH = Number(bestRaw.shinyH ?? 0);
        const bestValue = Number(bestRaw.value ?? bestRaw[metricKey] ?? ({ xp: bestXpH, ouro: bestGoldH, shiny: bestShinyH }[metric]) ?? 0);
        if (!Number.isFinite(bestValue) || bestValue <= 0) return null;
        const best = {
            slug: String(bestRaw.slug),
            name: String(bestRaw.name || bestRaw.nome || bestRaw.slug),
            level: Number(bestRaw.level ?? bestRaw.nivel ?? 0),
            region: String(bestRaw.region ?? bestRaw.regiao ?? ''),
            value: bestValue,
            xpH: bestXpH,
            goldH: bestGoldH,
            shinyH: bestShinyH,
            unsafe: Boolean(bestRaw.unsafe || bestRaw.umHit || Number(bestRaw.mortesH || 0) >= 0.5),
        };
        return {
            slug: best.slug,
            name: best.name,
            pokemonId: raw.pokemonId ?? activePk.id,
            pokemonLevel: raw.pokemonLevel ?? activePk.level,
            level: best.level,
            region: best.region,
            value: best.value,
            unsafe: best.unsafe,
            metric,
            best,
            ranked,
            source: 'native',
        };
    };

    const evaluateNative = async ({ welcome, state, activePk, metric, region }) => {
        const analyser = typeof options.analyzeNativeHunts === 'function'
            ? options.analyzeNativeHunts
            : await getNativeHuntAnalyser();
        if (!analyser) return null;

        const allHunts = Array.isArray(welcome.hunts) ? welcome.hunts : [];
        const huntsBySlug = new Map(allHunts.filter((h) => h?.slug).map((h) => [String(h.slug), h]));
        const trainerLvl = Number(state.level || 0);
        const unlockedSet = Array.isArray(state.huntsLiberadas) ? new Set(state.huntsLiberadas.map(String)) : null;
        const eligibleHunts = allHunts.filter((h) => {
            if (!h?.slug) return false;
            if (trainerLvl > 0 && Number(h.nivel || 0) > trainerLvl) return false;
            if (h.requer && unlockedSet && !unlockedSet.has(String(h.slug))) return false;
            return true;
        });

        const bikeList = Array.isArray(state.bicicletas?.lista)
            ? state.bicicletas.lista
            : (Array.isArray(state.bicicletas) ? state.bicicletas : []);
        const equippedBikeId = state.bicicletas?.equipadaId ?? state.bicicleta?.id ?? state.bicicletaId ?? null;
        const equippedBike = state.bicicleta
            || (equippedBikeId != null ? bikeList.find((b) => b && String(b.id) === String(equippedBikeId)) : null)
            || bikeList.find((b) => b?.equipada)
            || null;
        const bikeRarity = equippedBike?.rar ?? equippedBike?.raridade ?? equippedBike?.rarity ?? null;

        const raw = analyser({
            hunts: eligibleHunts,
            activePokemon: activePk,
            trainer: state,
            speciesById: options.speciesById ?? welcome.especies ?? welcome.speciesById ?? null,
            typeChart: welcome.tabelaTipos ?? null,
            diaSazonal: state.diaSazonal ?? null,
            bikeRarity,
        });
        return normalizeNativeResult(raw, { activePk, metric, region, huntsBySlug });
    };

    const evaluate = async ({ welcome, state, metric = 'xp', region = '' } = {}) => {
        if (!welcome || !state) return null;
        const activePk = (state.pokemons || []).find((pk) => pk && String(pk.id) === String(state.activeId));
        if (!activePk?.id) return null;
        const extDir = getExtensionDir();
        const canRunExtension = Boolean(extDir && activePk.stats);

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
            let res = null;
            if (canRunExtension) {
                if (useWorker) {
                    try {
                        res = await evaluateInWorker(extDir, { welcome, state, activePk, metric, region });
                    } catch {
                        res = await evaluateInline({ welcome, state, activePk, metric, region });
                    }
                } else {
                    res = await evaluateInline({ welcome, state, activePk, metric, region });
                }
            }
            if (!res) {
                res = await evaluateNative({ welcome, state, activePk, metric, region });
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
        isAvailable: () => Boolean(getExtensionDir() || cachedNativeAnalyser || typeof options.analyzeNativeHunts === 'function' || existsSync(NATIVE_ANALYSER_URL)),
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
    const ranked = pool
        .filter((row) => row?.slug)
        .map((row) => ({
            slug: String(row.slug),
            name: String(row.nome || row.slug),
            level: Number(row.nivel || 0),
            region: String(row.regiao || ''),
            value: Number({ xp: row.xpPokemonH, ouro: row.ouroH, shiny: row.shinyH }[metric] || 0),
            xpH: Number(row.xpPokemonH || 0),
            goldH: Number(row.ouroH || 0),
            shinyH: Number(row.shinyH || 0),
            unsafe: Boolean(row.umHit || Number(row.mortesH || 0) >= 0.5),
        }));
    return {
        slug: best.slug,
        name: best.nome,
        pokemonId: pokemon.id,
        pokemonLevel: pokemon.level,
        level: best.nivel,
        region: best.regiao,
        value,
        unsafe: Boolean(best.umHit || best.mortesH >= 0.5),
        ranked,
    };
}

export function describeHuntGuide(result, metric) {
    const number = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 2 });
    const rate = metric === 'shiny'
        ? `1 shiny a cada ${number.format(1 / result.value)} h (estimativa)`
        : `${number.format(result.value)} ${metric === 'xp' ? 'XP/h' : 'ouro/h'}`;
    return `${result.name} · Nv ${result.level} · ${rate}`;
}
