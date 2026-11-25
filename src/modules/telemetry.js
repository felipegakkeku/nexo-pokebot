// Telemetria híbrida: lê o painel nativo #sessao-painel e, se ele não existir, cai para o log de combate (#hud-log).
// Mantém a sessão da área/Pokémon atual, calcula métricas por minuto, pontua e grava o histórico de benchmarks.
// Comportamento idêntico ao da v6.5 (mesmas chaves, mesmos limites); só mudou de lugar.
import { normalizeText, parseNumber } from './pure.js';
import { hopNextTopCatchArea } from './map-hop-optimize.js';

const SEL_LOCAL = {
    hudLog: '#hud-log',
    avisoVersao: '#aviso-versao',
};
const ELEMENT_NODE = 1; // Node.ELEMENT_NODE

// --- Funções puras (sem DOM nem estado global) ---

// Métricas por minuto de uma sessão. `farm` = CONFIG.farm (limites de segurança).
export const computeMetrics = (s, farm, now = Date.now()) => {
    const elapsedSec = Math.max(1, Math.floor((now - s.startedAt) / 1000));
    const minutes = elapsedSec / 60;

    const a = s.startSnap;
    const b = s.latestSnap || a;
    const useNative = Boolean(a && b);

    const dKills = useNative ? Math.max(0, b.abates - a.abates) : s.logKills;
    const dXpPoke = useNative ? Math.max(0, b.xpPokemon - a.xpPokemon) : s.logXpPoke;
    const dGold = useNative ? Math.max(0, b.gold - a.gold) : s.logGold;
    const dLucro = useNative ? b.lucro - a.lucro : s.logGold;
    const dPotions = useNative ? Math.max(0, b.pocoesUsadas - a.pocoesUsadas) : 0;
    const dRevives = useNative ? Math.max(0, b.revivesUsados - a.revivesUsados) : 0;

    const killsPerMin = +(dKills / minutes).toFixed(2);
    const xpPokePerMin = Math.round(dXpPoke / minutes);
    const goldGrossPerMin = Math.round(dGold / minutes);
    const lucroPerMin = Math.round(dLucro / minutes);
    const potionsPerMin = +(dPotions / minutes).toFixed(2);
    const revivesPerMin = +(dRevives / minutes).toFixed(2);

    const safe =
        revivesPerMin === 0 &&
        potionsPerMin <= farm.maxPotionsPerMinSafe &&
        s.minHpPercent >= farm.minHpPercentSafe;

    return {
        regiao: s.regionKey,
        pokemon: `${s.pokemonName} Nv${s.pokemonLevel ?? '?'}`,
        tempoSeg: elapsedSec,
        abates: dKills,
        abatesMin: killsPerMin,
        xpPokeMin: xpPokePerMin,
        ouroBrutoMin: goldGrossPerMin,
        lucroLiqMin: lucroPerMin,
        pocoesMin: potionsPerMin,
        revivesMin: revivesPerMin,
        minHpPct: s.minHpPercent,
        segura: safe,
    };
};

// Nota de uma área para o modo (xp / ouro / topcatch / equilibrado). Área insegura vale 1/4.
export const scoreRecord = (r, modo) => {
    const safetyWeight = r.segura ? 1 : 0.25;
    if (modo === 'xp') return r.xpPokeMin * safetyWeight;
    if (modo === 'ouro') return Math.max(0, r.lucroLiqMin) * safetyWeight;
    if (modo === 'topcatch') return (r.abatesMin * 100 + r.xpPokeMin * 0.2) * safetyWeight;
    return (r.xpPokeMin * 0.65 + Math.max(0, r.lucroLiqMin) * 0.35) * safetyWeight;
};

// Vale gravar no histórico? (amostra mínima de tempo e de abates, a não ser que force)
export const shouldSaveMetrics = (metrics, farm, forceSave = false) =>
    forceSave || !(metrics.tempoSeg < farm.minSampleSec || metrics.abates < farm.minKillsToSave);

// Compara um contador do painel (capturas, shinies vistos) com o último valor visto.
// delta > 0 só quando subiu; primeira leitura (last === null) e quedas apenas atualizam `next`.
export const trackCounter = (last, current) => ({
    next: current,
    delta: last === null ? 0 : Math.max(0, current - last),
});

// O que fazer com a sessão a cada leitura: criar (não há), trocar (mudou área/Pokémon) ou só atualizar
export const planSessionStep = (session, hunt, poke) => {
    if (!session) return 'create';
    if (hunt && hunt.key !== session.regionKey) return 'rotate';
    if (poke && poke.name !== session.pokemonName) return 'rotate';
    return 'update';
};

// Atualiza a sessão em andamento com o Pokémon e o painel lidos agora
export const updateSessionReadings = (session, poke, snap, now = Date.now()) => {
    if (poke) {
        session.pokemonLevel = poke.level;
        if (poke.hpPercent !== null && poke.hpPercent < session.minHpPercent) {
            session.minHpPercent = poke.hpPercent;
        }
    }
    if (snap) {
        if (session.startSnap && snap.abates < session.startSnap.abates) {
            session.startSnap = snap;
            session.startedAt = now;
        }
        if (!session.startSnap) session.startSnap = snap;
        session.latestSnap = snap;
    }
};

// Capturou algo na sessão: já pode pular para a próxima área do Top Catch?
export const shouldTopCatchHop = (topCatchHop, state, now = Date.now()) =>
    Boolean(
        topCatchHop.enabled &&
            !state.paused &&
            !state.modalLockOwner &&
            !state.shinyAlertActive &&
            now - state.lastHopAt >= topCatchHop.hopCooldownMs
    );

// Linha do log de combate -> ganhos da sessão (usado quando não há painel nativo)
export const parseCombatLogText = (txt) => {
    if (txt.includes('derrotado!')) {
        const xpMatch = txt.match(/\+([\d.]+)\s*xp\s*pok[eé]mon/i);
        const goldMatch = txt.match(/\+([\d.]+)\s*ouro/i);
        return {
            kind: 'kill',
            xp: xpMatch ? parseNumber(xpMatch[1]) ?? 0 : 0,
            gold: goldMatch ? parseNumber(goldMatch[1]) ?? 0 : 0,
        };
    }
    if (normalizeText(txt).includes('capturado')) return { kind: 'capture' };
    return null;
};

// --- Funções com ctx ---

export const createSession = (ctx, hunt, pokemon, markerMeta = null) => ({
    regionKey: hunt ? hunt.key : 'Centro / Fora',
    targetName: hunt ? hunt.targetName : 'Nenhum',
    targetLevel: hunt ? hunt.targetLevel : null,
    markerMeta,
    pokemonName: pokemon ? pokemon.name : 'Desconhecido',
    pokemonLevel: pokemon ? pokemon.level : null,
    pokemonTypes: pokemon ? pokemon.types : [],
    startedAt: Date.now(),
    startSnap: ctx.dom.readNativeSessionPanel(),
    latestSnap: ctx.dom.readNativeSessionPanel(),
    logKills: 0,
    logXpPoke: 0,
    logGold: 0,
    minHpPercent: pokemon?.hpPercent ?? 100,
});

export const handleCombatLogNode = ({ state }, node) => {
    if (!state.running || !state.session || node.nodeType !== ELEMENT_NODE) return;
    const parsed = parseCombatLogText(node.textContent || '');
    if (!parsed) return;
    if (parsed.kind === 'kill') {
        state.session.logKills++;
        state.session.logXpPoke += parsed.xp;
        state.session.logGold += parsed.gold;
    } else {
        state.stats.captures++;
    }
};

export const ensureCombatLogObserver = (ctx) => {
    const { state, dom } = ctx;
    const logNode = dom.$(SEL_LOCAL.hudLog);
    if (logNode === state.observedLogNode) return;

    if (state.logObserver) {
        state.logObserver.disconnect();
        state.logObserver = null;
        state.observedLogNode = null;
    }
    if (logNode) {
        state.observedLogNode = logNode;
        state.logObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const added of m.addedNodes) {
                    handleCombatLogNode(ctx, added);
                }
            }
        });
        state.logObserver.observe(logNode, { childList: true });
    }
};

export const computeSessionMetrics = ({ CONFIG }, s, now = Date.now()) => computeMetrics(s, CONFIG.farm, now);

export const persistCurrentSession = (ctx, forceSave = false) => {
    const { CONFIG, state, storage, keys } = ctx;
    const s = state.session;
    if (!s || !s.regionKey || s.regionKey === 'Centro / Fora') return null;

    const metrics = computeSessionMetrics(ctx, s);
    if (!shouldSaveMetrics(metrics, CONFIG.farm, forceSave)) return null;

    const recordKey = `${s.pokemonName}__${s.regionKey}`;
    const prev = state.history[recordKey];
    const record = {
        ...metrics,
        pokemonName: s.pokemonName,
        pokemonLevel: s.pokemonLevel,
        targetLevel: s.targetLevel,
        markerMeta: s.markerMeta || prev?.markerMeta || null,
        updatedAt: new Date().toISOString(),
    };

    state.history[recordKey] = record;
    storage.saveJson(keys.history, state.history);
    return record;
};

export const checkVersionAlert = ({ state, dom, setStatus, playBeep }) => {
    const aviso = dom.$(SEL_LOCAL.avisoVersao);
    if (aviso && dom.isVisible(aviso) && !state.paused) {
        state.paused = true;
        setStatus('Atualização!', 'Nova versão detectada — recarregue o jogo');
        playBeep(520, 0.25);
    }
};

export const updateFarmTelemetry = (ctx) => {
    const { CONFIG, state, dom, playBeep } = ctx;
    if (!state.running || !CONFIG.farm.enabled) return;

    ensureCombatLogObserver(ctx);
    checkVersionAlert(ctx);

    const hunt = dom.getCurrentHunt();
    const poke = dom.getActivePokemon();
    const snap = dom.readNativeSessionPanel();

    if (snap) {
        const shiny = trackCounter(state.lastShiniesVistos, snap.shiniesVistos);
        if (shiny.delta > 0) {
            state.stats.shiniesSpotted++;
            if (CONFIG.shinyGuard.soundAlert) playBeep(1180, 0.25);
            state.lastActionNote = '✨ Shiny apareceu na sessão!';
        }
        state.lastShiniesVistos = shiny.next;

        const caps = trackCounter(state.lastSessionCaptures, snap.capturas);
        state.lastSessionCaptures = caps.next;
        if (caps.delta > 0) {
            state.stats.captures += caps.delta;
            if (shouldTopCatchHop(CONFIG.topCatchHop, state)) {
                state.lastHopAt = Date.now();
                setTimeout(() => {
                    if (state.running && !state.paused && !state.shinyAlertActive) hopNextTopCatchArea(ctx, false);
                }, 1000);
            }
        }
    }

    const step = planSessionStep(state.session, hunt, poke);
    if (step === 'create') {
        state.session = createSession(ctx, hunt, poke, state.lastMarkerMeta);
    } else if (step === 'rotate') {
        persistCurrentSession(ctx, false);
        state.session = createSession(ctx, hunt, poke, state.lastMarkerMeta);
    } else {
        updateSessionReadings(state.session, poke, snap);
    }

    persistCurrentSession(ctx, false);
};

const dispose = ({ state }) => {
    if (state.logObserver) {
        state.logObserver.disconnect();
        state.logObserver = null;
        state.observedLogNode = null;
    }
};

export const telemetry = {
    id: 'telemetry',
    everyMs: (ctx) => ctx.CONFIG.farm.tickIntervalMs,
    init: (ctx) => ensureCombatLogObserver(ctx),
    tick: (ctx) => updateFarmTelemetry(ctx),
    dispose,
    createSession,
    ensureCombatLogObserver,
    computeSessionMetrics,
    persistCurrentSession,
    updateFarmTelemetry,
};
