// Fila /hunt: lista de áreas (espécie/alvo do Hub ou região) que o bot percorre em ordem, casando cada entrada
// com um marcador liberado do mapa. Sem match, cai para uma área segura (opcional). Comportamento idêntico ao da v6.5.
import { normalizeText, parseQueueEntry, parseQueueText } from './pure.js';
import {
    openMapModal,
    collectCandidatesFromOpenMap,
    travelToMarkerMeta,
    saveHuntQueueState,
} from './map-benchmark.js';
import { createSession } from './telemetry.js';

const SEL_LOCAL = {
    manualQueueBox: '#pb-manual-queue',
};

// --- Funções puras ---

// Lista crua (strings do Hub ou objetos) -> entradas da fila, sem nomes vazios
export const normalizeQueueList = (list, mode) =>
    list
        .map((entry) =>
            typeof entry === 'string'
                ? parseQueueEntry(entry, mode)
                : { ...entry, name: String(entry?.name || '').trim() }
        )
        .filter((x) => x.name.length > 0);

// Casa uma entrada da fila (espécie/alvo do Hub ou nome de região) com um marcador liberado do mapa
export const findQueueMatch = (entry, candidates) => {
    if (entry.markerMeta) return entry.markerMeta;
    const needle = normalizeText(entry.regionName || entry.name);
    if (!needle) return null;
    const byName = candidates.filter((c) => {
        const region = normalizeText(c.regionName);
        const title = normalizeText(c.title);
        return (
            (region && (region.includes(needle) || needle.includes(region))) ||
            (title && title.includes(needle))
        );
    });
    // Se a entrada trouxe nível (ex.: "Kakuna Nv 10"), prefere a área com esse nível
    return (entry.level && byName.find((c) => c.areaLevel === entry.level)) || byName[0] || null;
};

// Fallback seguro: área liberada, diferente da atual e com nível não acima do Pokémon ativo
export const pickSafeFallback = (entry, candidates, poke) => {
    const pokeLevel = poke?.level ?? null;
    const pool = candidates.filter((c) => !c.isCurrent && (pokeLevel === null || c.areaLevel <= pokeLevel));
    if (pool.length === 0) return null;
    return (entry?.level && pool.find((c) => c.areaLevel === entry.level)) || pool[0];
};

// --- Funções com ctx ---

export const definirFilaHunt = (ctx, list) => {
    const { CONFIG, state, updateHud } = ctx;
    if (!Array.isArray(list)) return [];
    state.huntQueue = normalizeQueueList(list, CONFIG.mode);
    state.huntQueueIndex = 0;
    saveHuntQueueState(ctx);
    state.lastActionNote = `Fila /hunt: ${state.huntQueue.length} áreas`;
    updateHud();
    return state.huntQueue;
};

// Fila manual: lê a caixa de texto do HUD, atualiza state/storage/HUD na hora (sem reload, sem derrubar timers)
export const loadManualQueue = async (ctx, irAgora = false) => {
    const { CONFIG, state, updateHud } = ctx;
    const raw = state.hudEl?.querySelector(SEL_LOCAL.manualQueueBox)?.value || '';
    const entries = parseQueueText(raw, CONFIG.mode);

    if (entries.length === 0) {
        if (irAgora && state.huntQueue.length > 0) {
            return irProximaHuntGuia(ctx, true);
        }
        state.lastActionNote = 'Cole ao menos 1 área válida';
        updateHud();
        return false;
    }

    definirFilaHunt(ctx, entries);
    state.lastActionNote = `Fila /hunt: ${state.huntQueue.length} itens (próx: ${state.huntQueue[0].name})`;
    updateHud();

    if (irAgora) {
        return irProximaHuntGuia(ctx, true);
    }
    return true;
};

export const limparFilaHunt = (ctx) => {
    const { state, updateHud } = ctx;
    state.huntQueue = [];
    state.huntQueueIndex = 0;
    saveHuntQueueState(ctx);
    state.lastActionNote = 'Fila /hunt limpa';
    updateHud();
};

// Monta a fila sem tomar o lock (pode ser chamada de dentro de outra rotina com lock)
export const buildHuntQueueItems = async (ctx) => {
    const { CONFIG, dom } = ctx;
    let items = [];

    // Monta a fila a partir das áreas seguras/liberadas do mapa (a lista do Hub entra pela caixa "Fila Manual")
    if (items.length === 0) {
        const poke = dom.getActivePokemon();
        const modal = await openMapModal(ctx);
        if (modal) {
            const candidates = await collectCandidatesFromOpenMap(
                ctx,
                modal,
                poke,
                CONFIG.map.preferTypeAdvantage,
                CONFIG.mode === 'topcatch' ? 'Top Catch' : null,
                CONFIG.mode === 'topcatch'
            );
            await dom.closeActiveModal();
            items = candidates.slice(0, 8).map((c) => ({
                name: c.regionName,
                regionName: c.regionName,
                areaLevel: c.areaLevel,
                markerMeta: c,
                mode: CONFIG.mode,
            }));
        }
    }
    return items;
};

export const adoptHuntQueue = (ctx, items) => {
    const { state } = ctx;
    state.huntQueue = items;
    state.huntQueueIndex = 0;
    saveHuntQueueState(ctx);
    state.lastActionNote = `Fila /hunt pronta (${items.length} áreas)`;
};

export const syncHuntGuideQueue = async (ctx, force = false) => {
    const { state, withModalLock } = ctx;
    return withModalLock(
        'Montando fila',
        async () => {
            const items = await buildHuntQueueItems(ctx);
            if (items.length > 0) {
                adoptHuntQueue(ctx, items);
            } else if (!state.lastActionNote.startsWith('Guia /hunt:')) {
                state.lastActionNote = 'Nenhuma área encontrada para a fila';
            }
            return state.huntQueue;
        },
        { force }
    );
};

export const irProximaHuntGuia = async (ctx, force = false) => {
    const { CONFIG, state, dom, withModalLock } = ctx;
    return withModalLock(
        'Fila /hunt',
        async () => {
            if (state.huntQueue.length === 0) {
                const built = await buildHuntQueueItems(ctx);
                if (built.length > 0) adoptHuntQueue(ctx, built);
            }
            if (state.huntQueue.length === 0) {
                state.lastActionNote = 'Fila /hunt vazia';
                return false;
            }

            const poke = dom.getActivePokemon();
            const modal = await openMapModal(ctx);
            if (!modal) return false;
            const liveCandidates = await collectCandidatesFromOpenMap(
                ctx,
                modal,
                poke,
                false,
                null,
                CONFIG.mode === 'topcatch'
            );
            await dom.closeActiveModal();

            for (let attempt = 0; attempt < state.huntQueue.length; attempt++) {
                const idx = (state.huntQueueIndex + attempt) % state.huntQueue.length;
                const entry = state.huntQueue[idx];
                const matchedMeta = findQueueMatch(entry, liveCandidates);
                if (!matchedMeta) continue;

                state.huntQueueIndex = (idx + 1) % state.huntQueue.length;
                saveHuntQueueState(ctx);
                state.lastActionNote = `Fila -> ${matchedMeta.regionName} Nv${matchedMeta.areaLevel}`;
                const ok = await travelToMarkerMeta(ctx, matchedMeta);
                if (ok) {
                    state.session = createSession(ctx, dom.getCurrentHunt(), dom.getActivePokemon(), matchedMeta);
                    return true;
                }
            }

            // Nenhuma entrada casou com marcador do mapa: usa área segura/liberada como fallback
            if (CONFIG.huntQueue.fallbackToSafeArea) {
                const entry = state.huntQueue[state.huntQueueIndex % state.huntQueue.length];
                const fallback = pickSafeFallback(entry, liveCandidates, poke);
                if (fallback) {
                    state.huntQueueIndex = (state.huntQueueIndex + 1) % state.huntQueue.length;
                    saveHuntQueueState(ctx);
                    state.lastActionNote = `Fila sem match (${entry.name}) -> fallback ${fallback.regionName} Nv${fallback.areaLevel}`;
                    const ok = await travelToMarkerMeta(ctx, fallback);
                    if (ok) {
                        state.session = createSession(ctx, dom.getCurrentHunt(), dom.getActivePokemon(), fallback);
                        return true;
                    }
                }
            }

            state.lastActionNote = 'Fila /hunt: sem área elegível agora';
            return false;
        },
        { force }
    );
};

export const huntQueue = {
    id: 'huntQueue',
    definirFilaHunt,
    loadManualQueue,
    limparFilaHunt,
    syncHuntGuideQueue,
    irProximaHuntGuia,
};
