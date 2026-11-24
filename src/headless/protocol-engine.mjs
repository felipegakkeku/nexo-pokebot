export const DEFAULT_WS_URL = 'wss://pokeidle.io';
export const DEFAULT_ORIGIN = 'https://pokeidle.io';

export const BALL_IDS = Object.freeze({ POKE: 1, GREAT: 2, SUPER: 3, ULTRA: 4, BEAST: 5 });
export const DEFAULT_BALL_PRICES = Object.freeze({ 1: 5, 2: 20, 3: 50, 4: 130 });

export const ITEM_IDS = Object.freeze({
    SMALL_POTION: 200,
    GREAT_POTION: 201,
    ULTRA_POTION: 202,
    HYPER_POTION: 203,
    ULTIMATE_POTION: 204,
    REVIVE: 205,
    MAX_REVIVE: 206,
    GOLDEN_POTION: 70070,
});
export const DEFAULT_ITEM_PRICES = Object.freeze({
    200: 50,
    201: 150,
    202: 400,
    203: 800,
    204: 1500,
    205: 600,
    206: 5000,
    70070: 2500,
});

export const MYSTIC_BALL_PRIORITY = Object.freeze([5, 4, 3, 2, 1]);
export const CAMPOS_AUTO_SET = Object.freeze([
    'autoBallAteCapturar',
    'autoBallSemParar',
    'autoBall',
    'ballIds',
    'autoRevive',
    'reviveIds',
    'autoPotion',
    'potionIds',
    'hpLimiar',
    'autoVoltarHunt',
    'pvpAutoFila',
]);

const DESLOCAMENTO_SAZONAL_MS = -3 * 3600_000;
const PASSE_NIVEL_MIN = 10;
const PASSE_FUSO_MS = 3 * 3600_000;
const DIA_MS = 86_400_000;

/**
 * Calcula a chave YYYY-MM-DD do dia sazonal do servidor (Brasilia -3h com antecipacao de +6h).
 * @param {number} [nowMs] Timestamp em milissegundos.
 * @returns {string} Data no formato YYYY-MM-DD.
 */
export function getSeasonalDayKey(nowMs = Date.now()) {
    return new Date(Number(nowMs) - DESLOCAMENTO_SAZONAL_MS).toISOString().slice(0, 10);
}

/**
 * Calcula o status atual do Passe Diario de acordo com a regra de shared/passe-batalha.mjs.
 * @param {object} passeRaw Objeto passe do estado do jogador.
 * @param {number} [trainerLevel=1] Nivel do treinador.
 * @param {number} [nowMs] Timestamp atual em milissegundos.
 * @returns {object} Status calculado contendo hoje, degrau, flags VIP e canClaim.
 */
export function computePassStatus(passeRaw, trainerLevel = 1, nowMs = Date.now()) {
    const hoje = Math.floor((Number(nowMs) - PASSE_FUSO_MS) / DIA_MS);
    const ultimoVal = passeRaw?.ultimo;
    const ultimo = ultimoVal != null && typeof ultimoVal !== 'boolean' && ultimoVal !== '' && Number.isSafeInteger(Number(ultimoVal))
        ? Number(ultimoVal)
        : null;
    const degrau = Number(passeRaw?.degrau) || 0;
    const jaPegouHoje = ultimo != null && degrau >= 1 && ultimo === hoje;
    const vipAtivo = (Number(passeRaw?.vipAte) || 0) > Number(nowMs);
    const vipPegouHoje = passeRaw?.ultimoVip != null && Number(passeRaw.ultimoVip) === hoje;
    const vipPendenteHoje = vipAtivo && jaPegouHoje && !vipPegouHoje;
    const canClaim = Number(trainerLevel || 0) >= PASSE_NIVEL_MIN && Boolean(passeRaw) && (!jaPegouHoje || vipPendenteHoje);

    return { hoje, degrau, jaPegouHoje, vipAtivo, vipPendenteHoje, canClaim };
}

/**
 * Cria um mesclador de estado incremental compativel com shared/estado-delta.mjs.
 * @returns {{ merge: (parcial: object) => object|null, getState: () => object|null }} Interface do mesclador.
 */
export function createStateMerger() {
    let campos = null;
    let pokemons = new Map();

    const getState = () => {
        if (!campos) return null;
        return { ...campos, pokemons: [...pokemons.values()] };
    };

    const merge = (parcial) => {
        if (!parcial || typeof parcial !== 'object') return getState();
        const { cheio, pokemons: lista, pkMud, pkFora, dexMud, dexFora, ...resto } = parcial;

        if (cheio || !campos) {
            campos = { ...resto };
            pokemons = new Map((lista ?? []).map((k) => [k.id, k]));
            return getState();
        }

        Object.assign(campos, resto);

        if (Array.isArray(lista)) {
            pokemons = new Map(lista.map((k) => [k.id, k]));
        }
        for (const k of pkMud ?? []) {
            if (k && k.id != null) pokemons.set(k.id, k);
        }
        for (const id of pkFora ?? []) {
            pokemons.delete(id);
        }

        if (dexMud || dexFora) {
            campos.pokedex = { ...(campos.pokedex ?? {}), ...(dexMud ?? {}) };
            for (const chave of dexFora ?? []) {
                delete campos.pokedex[chave];
            }
        }

        return getState();
    };

    return { merge, getState };
}

/**
 * Cria um rastreador dos mobs e caidos presentes no campo atual.
 * @returns {object} Controlador com applyCampoInit, applyCampo, getFallenCorpses, getMobs e reset.
 */
export function createFieldTracker() {
    const mobs = new Map();
    const recentBattleSlots = [];
    let serverNow = Date.now();

    const pruneRecentSlots = (ts) => {
        for (let i = recentBattleSlots.length - 1; i >= 0; i--) {
            if (ts - recentBattleSlots[i].ts > 15_000) {
                recentBattleSlots.splice(i, 1);
            }
        }
    };

    const recordAttackedSlot = (slot, ts) => {
        pruneRecentSlots(ts);
        const existingIdx = recentBattleSlots.findIndex((item) => item.slot === slot);
        if (existingIdx !== -1) recentBattleSlots.splice(existingIdx, 1);
        recentBattleSlots.push({ slot, ts });
        if (recentBattleSlots.length > 8) recentBattleSlots.shift();
    };

    const consumeFallbackSlot = (ts) => {
        pruneRecentSlots(ts);
        while (recentBattleSlots.length > 0) {
            const candidate = recentBattleSlots.shift();
            if (!candidate) continue;
            const cur = mobs.get(candidate.slot);
            if (cur && cur.morto && Number(cur.expiraEm || 0) > ts) continue;
            return candidate.slot;
        }
        return null;
    };

    const applyCampo = (m, nowMs) => {
        serverNow = Number(m?.ts || nowMs || serverNow);
        for (const b of m?.mobs ?? []) {
            if (!b || b.s == null) continue;
            const prev = mobs.get(b.s) || {};
            const isNewName = b.n !== undefined && b.n !== prev.nome;
            mobs.set(b.s, {
                ...prev,
                slot: b.s,
                nome: b.n !== undefined ? b.n : prev.nome,
                level: b.nv !== undefined ? b.nv : prev.level,
                shiny: b.sh !== undefined ? Boolean(b.sh) : (isNewName ? false : Boolean(prev.shiny)),
                morto: b.x !== undefined ? Boolean(b.x) : Boolean(prev.morto),
                ehTreinador: b.tr !== undefined ? Boolean(b.tr) : (isNewName ? false : Boolean(prev.ehTreinador)),
                hp: b.hp !== undefined ? b.hp : prev.hp,
                maxHp: b.mhp !== undefined ? b.mhp : prev.maxHp,
                expiraEm: b.xr !== undefined ? serverNow + Number(b.xr) : (b.x === false ? undefined : prev.expiraEm),
            });
        }
        for (const slot of m?.fora ?? []) {
            mobs.delete(slot);
        }
    };

    const applyCampoInit = (m, nowMs) => {
        mobs.clear();
        recentBattleSlots.length = 0;
        serverNow = Number(m?.ts || nowMs || Date.now());
        if (m?.mobs || m?.fora) {
            applyCampo(m, nowMs);
        }
    };

    const applyBattleEvent = (e, nowMs = Date.now()) => {
        if (!e || typeof e !== 'object') return false;
        const ts = Number(nowMs || Date.now());
        const kind = e.k || e.t || e.tipo || e.acao;
        if (kind === 'ataque' && e.slot != null) {
            recordAttackedSlot(e.slot, ts);
            return false;
        }
        if (kind === 'morte' && e.quem === 'selvagem' && !e.safari) {
            const slot = e.slot != null ? e.slot : consumeFallbackSlot(ts);
            if (slot == null) return false;
            if (e.slot != null) {
                const idx = recentBattleSlots.findIndex((item) => item.slot === e.slot);
                if (idx !== -1) recentBattleSlots.splice(idx, 1);
            }
            const prev = mobs.get(slot) || {};
            if (prev.morto && Number(prev.expiraEm || 0) > ts) return false;
            mobs.set(slot, {
                ...prev,
                slot,
                nome: e.nome ?? prev.nome ?? '',
                level: Number(e.level ?? e.nivel ?? prev.level ?? 1) || 1,
                shiny: e.shiny !== undefined ? Boolean(e.shiny) : Boolean(prev.shiny),
                morto: true,
                ehTreinador: false,
                expiraEm: ts + Number(e.xr || 25_000),
            });
            return true;
        }
        if (kind === 'bola' || kind === 'capturado' || kind === 'fugiu') {
            if (e.slot != null) {
                mobs.delete(e.slot);
                const idx = recentBattleSlots.findIndex((item) => item.slot === e.slot);
                if (idx !== -1) recentBattleSlots.splice(idx, 1);
            }
        }
        return false;
    };

    const getFallenCorpses = (nowMs = serverNow, prioritizeExpiring = true) => {
        const list = [];
        for (const e of mobs.values()) {
            const resta = (e.expiraEm ?? 0) - nowMs;
            if (e.morto && !e.ehTreinador && resta > 0) {
                list.push({
                    slot: e.slot,
                    nome: e.nome || '',
                    level: Number(e.level) || 1,
                    shiny: Boolean(e.shiny),
                    resta,
                });
            }
        }
        list.sort((a, b) => {
            if (a.shiny !== b.shiny) return a.shiny ? -1 : 1;
            if (prioritizeExpiring) {
                const aExp = a.resta < 6000;
                const bExp = b.resta < 6000;
                if (aExp !== bExp) return aExp ? -1 : 1;
            }
            if (a.level !== b.level) return b.level - a.level;
            return a.resta - b.resta;
        });
        return list;
    };

    const getMobs = () => [...mobs.values()];
    const reset = () => {
        mobs.clear();
        recentBattleSlots.length = 0;
    };

    return { applyCampoInit, applyCampo, applyBattleEvent, getFallenCorpses, getMobs, reset };
}

/**
 * Calcula os avisos ativos quando alguma configuracao ou estado de economia limita funcoes do bot.
 * @param {object} [params] Estado atual: config, status, mode, economyActive e campoFeedDegraded.
 * @returns {Array<{ code: string, severity: 'danger'|'warn', title: string, detail: string, fixLabel?: string, fixConfig?: object }>}
 */
export function computeModeWarnings({
    config = {},
    status = 'disconnected',
    mode = 'headless',
    economyActive = false,
    campoFeedDegraded = false,
} = {}) {
    const warnings = [];
    const cfg = config || {};
    const isOnline = status === 'connected' || status === 'bridge';

    if (cfg.economyPingOnly) {
        warnings.push({
            code: 'economy-ping-only',
            severity: 'danger',
            title: 'Modo Somente Ping ativo: automações pausadas',
            detail: 'Captura automática, detecção de Shiny, Restock, Passe, Prey e /hunt estão pausados neste modo (mantém apenas keepalive e lives).',
            fixLabel: 'Restaurar captura + Shiny',
            fixConfig: { economyPingOnly: false, economyMode: 'auto', caidosEnabled: true },
        });
        return warnings;
    }

    if (cfg.caidosEnabled === false) {
        warnings.push({
            code: 'caidos-disabled',
            severity: 'warn',
            title: 'Captura automática desligada',
            detail: 'O bot não vai lançar Pokébolas em Pokémon caídos nem em Shinies enquanto "Capturar Pokémon caídos" estiver desmarcado.',
            fixLabel: 'Reativar captura',
            fixConfig: { caidosEnabled: true },
        });
    }

    if (cfg.economyMode === 'on' && mode !== 'browser-bridge') {
        warnings.push({
            code: 'server-economy-no-shiny',
            severity: 'warn',
            title: 'Economia do servidor ativa: sem detecção de Shiny',
            detail: 'O servidor corta o feed de campo neste modo. O bot tenta capturar pelo fallback de batalha, mas não detecta Shiny antes de jogar a Pokébola (nem escolhe a Bola Shiny) e pode perder caídos se o servidor omitir o slot. No Modo Eco padrão (desmarcado), o bot já roda com 0% GPU e mantém 100% da captura + Shiny.',
            fixLabel: 'Ativar captura + Shiny',
            fixConfig: { economyMode: 'auto', caidosEnabled: true },
        });
    } else if (isOnline && cfg.caidosEnabled !== false && (campoFeedDegraded || (economyActive && mode !== 'browser-bridge'))) {
        warnings.push({
            code: 'campo-feed-missing',
            severity: 'warn',
            title: 'Feed de campo indisponível: detecção de Shiny limitada',
            detail: 'O servidor não está enviando o feed de campo nesta hunt. O bot continua tentando lançar Pokébolas pelo fallback de batalha, mas não consegue identificar Shiny antes do arremesso.',
            fixLabel: 'Restaurar feed de campo',
            fixConfig: { economyMode: 'auto', economyPingOnly: false, caidosEnabled: true },
        });
    }

    return warnings;
}

const SHINY_BALL_ORDERS = {
    best: [5, 4, 3, 2, 1],
    beast: [5, 4, 3, 2, 1],
    ultra: [4, 3, 2, 1, 5],
    super: [3, 4, 2, 1, 5],
    great: [2, 3, 4, 1, 5],
    poke: [1, 2, 3, 4, 5],
};

const NORMAL_BALL_ORDERS = {
    ultra: [4, 3, 2, 1],
    super: [3, 2, 1, 4],
    great: [2, 1, 3, 4],
    poke: [1, 2, 3, 4],
    beast: [5, 4, 3, 2, 1],
};

/**
 * Escolhe o ID da melhor Pokebola disponivel no inventario para capturar um caido.
 * @param {object} corpse Alvo caido contendo shiny e level.
 * @param {object} [balls] Mapa de quantidades por ballId.
 * @param {object} [config] Preferencias de captura (shinyBall, preferredBall, highLevelUltraThreshold).
 * @param {number} [playerGold=0] Gold atual do jogador para modo auto.
 * @returns {number|null} ID da bola selecionada ou null se sem estoque.
 */
export function pickHeadlessBallForCorpse(corpse, balls = {}, config = {}, playerGold = 0) {
    let order;
    if (corpse?.shiny) {
        const shinyBall = config?.shinyBall || 'best';
        order = SHINY_BALL_ORDERS[shinyBall] || SHINY_BALL_ORDERS.best;
    } else if ((corpse?.level || 0) >= (config?.highLevelUltraThreshold ?? 50)) {
        order = NORMAL_BALL_ORDERS.ultra;
    } else {
        const pref = config?.preferredBall || 'auto';
        if (pref === 'auto' || !NORMAL_BALL_ORDERS[pref]) {
            const gold = Number(playerGold || 0);
            if (gold >= 2_500_000) order = [4, 3, 2, 1];
            else if (gold >= 300_000) order = [3, 2, 1, 4];
            else if (gold >= 50_000) order = [2, 1, 3, 4];
            else order = [1, 2, 3, 4];
        } else {
            order = NORMAL_BALL_ORDERS[pref];
        }
    }

    for (const id of order) {
        if (Number(balls?.[id] ?? balls?.[String(id)] ?? 0) > 0) {
            return id;
        }
    }
    return null;
}

/**
 * Resolve o ID compravel de Pokebola (1 a 4) para restock conforme configuracao e gold.
 * @param {object} [config] Configuracao de preferencia de bola.
 * @param {number} [playerGold=0] Gold atual do jogador.
 * @returns {number} ID da bola alvo (1..4).
 */
export function resolveRestockBallId(config = {}, playerGold = 0) {
    const pref = config?.preferredBall || 'auto';
    if (pref === 'poke') return 1;
    if (pref === 'great') return 2;
    if (pref === 'super') return 3;
    if (pref === 'ultra' || pref === 'beast') return 4;

    const gold = Number(playerGold || 0);
    if (gold >= 2_500_000) return 4;
    if (gold >= 300_000) return 3;
    if (gold >= 50_000) return 2;
    return 1;
}

const MAX_SHOP_BUY_QTY = 9999;
export const BUYABLE_POTION_IDS = Object.freeze([
    ITEM_IDS.SMALL_POTION,
    ITEM_IDS.GREAT_POTION,
    ITEM_IDS.ULTRA_POTION,
    ITEM_IDS.HYPER_POTION,
    ITEM_IDS.ULTIMATE_POTION,
]);
export const POTION_IDS = Object.freeze([
    ...BUYABLE_POTION_IDS,
    ITEM_IDS.GOLDEN_POTION,
]);

/**
 * Normaliza uma lista de IDs de pocoes validas para auto.set (potionIds).
 * @param {unknown} raw Lista ou valor bruto configurado pelo usuario.
 * @returns {number[]} IDs unicos validos de pocoes.
 */
export function normalizePotionIds(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const id = Number(item);
        if (POTION_IDS.includes(id) && !seen.has(id)) {
            seen.add(id);
            out.push(id);
        }
    }
    return out;
}

/**
 * Resolve o ID compravel de pocao com base na config explicita ou preferencias nativas (potionIds).
 * @param {object} [state] Estado atual do jogador.
 * @param {object} [config] Configuracao headless (restockPotionId e preferredPotionIds).
 * @returns {number} ID da pocao compravel (200..204).
 */
export function resolveRestockPotionId(state = null, config = null) {
    const explicit = Number(config?.restockPotionId || 0);
    if (BUYABLE_POTION_IDS.includes(explicit)) {
        return explicit;
    }
    const configured = normalizePotionIds(config?.preferredPotionIds)
        .filter((id) => BUYABLE_POTION_IDS.includes(id));
    if (configured.length > 0) {
        return configured[0];
    }
    const enabled = Array.isArray(state?.automation?.potionIds)
        ? state.automation.potionIds.map((id) => Number(id)).filter((id) => BUYABLE_POTION_IDS.includes(id))
        : [];
    if (enabled.length === 0 || enabled.includes(ITEM_IDS.SMALL_POTION)) {
        return ITEM_IDS.SMALL_POTION;
    }
    return Math.min(...enabled);
}

/**
 * Calcula o limiar minimo automatico proporcional ao estoque alvo quando o usuario configura um alvo alto.
 * @param {number} target Estoque alvo configurado.
 * @param {number} explicitMin Minimo base configurado.
 * @returns {number} Limiar efetivo (entre explicitMin e target).
 */
export function computeEffectiveRestockMin(target, explicitMin) {
    const cleanTarget = Math.max(0, Math.floor(Number(target || 0)));
    if (cleanTarget <= 0) return 0;
    const cleanMin = Math.max(1, Math.floor(Number(explicitMin || 1)));
    return Math.min(cleanTarget, cleanMin);
}

/**
 * Avalia um tick headless e retorna as acoes WebSocket a enviar sem mutar o state.
 * @param {object} params Contexto contendo state, field, catalog, config, tracker, nowMs e forceRestock.
 * @returns {Array<object>} Lista ordenada de payloads WS a enviar.
 */
export function evaluateHeadlessTick({
    state,
    field,
    catalog = {},
    config = {},
    tracker = {},
    nowMs = Date.now(),
    forceRestock = false,
}) {
    if (!state) return [];
    tracker.slotThrownAt ??= {};

    const actions = [];

    const preferredPotionIds = normalizePotionIds(config.preferredPotionIds);
    const currentPotionIds = Array.isArray(state.automation?.potionIds)
        ? state.automation.potionIds.map((id) => Number(id))
        : [];
    const needsNativeHeal = Boolean(
        config.ensureNativeAutoHeal !== false &&
        state.automation &&
        (!state.automation.autoRevive || !state.automation.autoPotion || !state.automation.autoVoltarHunt)
    );
    const needsPotionSync = Boolean(
        state.automation &&
        preferredPotionIds.length > 0 &&
        (
            preferredPotionIds.length !== currentPotionIds.length ||
            preferredPotionIds.some((id, idx) => currentPotionIds[idx] !== id)
        )
    );
    const autoSetCooldownMs = needsPotionSync ? 5_000 : 30_000;

    if ((needsNativeHeal || needsPotionSync) && nowMs - (tracker.lastAutoSetAt || 0) >= autoSetCooldownMs) {
        const autoPayload = { t: 'auto.set' };
        for (const campo of CAMPOS_AUTO_SET) {
            if (state.automation[campo] !== undefined) {
                autoPayload[campo] = state.automation[campo];
            }
        }
        if (config.ensureNativeAutoHeal !== false) {
            autoPayload.autoRevive = true;
            autoPayload.autoPotion = true;
            autoPayload.autoVoltarHunt = true;
        }
        if (preferredPotionIds.length > 0) {
            autoPayload.potionIds = [...preferredPotionIds];
        }
        tracker.lastAutoSetAt = nowMs;
        actions.push(autoPayload);
    }

    if (Number(state.mistico?.prazo || 0) > nowMs && tracker.lastMysticPrazo !== state.mistico.prazo) {
        const mysticBallId = MYSTIC_BALL_PRIORITY.find(
            (id) => Number(state.balls?.[id] ?? state.balls?.[String(id)] ?? 0) > 0
        );
        if (mysticBallId != null) {
            tracker.lastMysticPrazo = state.mistico.prazo;
            actions.push({ t: 'mistico.bola', ballId: mysticBallId });
        }
    }

    if (config.caidosEnabled !== false && field) {
        let corpses = field.getFallenCorpses(nowMs, config.prioritizeExpiring !== false);
        const vipAutoBall = Boolean(
            state.loja?.vip && (state.automation?.autoBallSemParar || state.automation?.autoBallAteCapturar)
        );
        if (vipAutoBall) {
            corpses = corpses.filter((c) => c.shiny === true);
        }
        const target = corpses.find((c) => nowMs - (tracker.slotThrownAt[c.slot] || 0) >= 1200);
        if (target) {
            const ballId = pickHeadlessBallForCorpse(target, state.balls, config, state.gold);
            if (ballId != null) {
                tracker.slotThrownAt[target.slot] = nowMs;
                actions.push({ t: 'ball.throw', ballId, slot: target.slot });
            }
        }
    }

    if ((forceRestock || config.restockEnabled !== false) && (forceRestock || nowMs - (tracker.lastRestockAt || 0) >= 10_000)) {
        const reserveGold = Math.max(0, Number(config.minGoldReserve ?? 50_000));
        const currentGold = Number(state.gold || 0);
        let availableGold = Math.max(0, currentGold - reserveGold);
        const checks = [];

        const ballId = resolveRestockBallId(config, currentGold);
        const ballTarget = Math.max(0, Math.floor(Number(config.targetBalls ?? 100)));
        if (ballTarget > 0) {
            checks.push({
                kind: 'ball',
                id: ballId,
                current: Number(state.balls?.[ballId] ?? state.balls?.[String(ballId)] ?? 0),
                min: computeEffectiveRestockMin(ballTarget, config.minBalls ?? 25),
                target: ballTarget,
                price: Number(catalog.ballPrices?.[ballId] ?? DEFAULT_BALL_PRICES[ballId] ?? 50),
            });
        }

        const potionTarget = Math.max(0, Math.floor(Number(config.targetPotions ?? 100)));
        if (config.restockSmallPotion !== false && potionTarget > 0) {
            const potionId = resolveRestockPotionId(state, config);
            checks.push({
                kind: 'item',
                id: potionId,
                current: Number(state.items?.[potionId] ?? state.items?.[String(potionId)] ?? 0),
                min: computeEffectiveRestockMin(potionTarget, config.minPotions ?? 20),
                target: potionTarget,
                price: Number(catalog.itemPrices?.[potionId] ?? DEFAULT_ITEM_PRICES[potionId] ?? DEFAULT_ITEM_PRICES[ITEM_IDS.SMALL_POTION]),
            });
        }

        const reviveTarget = Math.max(0, Math.floor(Number(config.targetRevives ?? 50)));
        if (config.restockRevive !== false && reviveTarget > 0) {
            checks.push({
                kind: 'item',
                id: ITEM_IDS.REVIVE,
                current: Number(state.items?.[ITEM_IDS.REVIVE] ?? state.items?.[String(ITEM_IDS.REVIVE)] ?? 0),
                min: computeEffectiveRestockMin(reviveTarget, config.minRevives ?? 10),
                target: reviveTarget,
                price: Number(catalog.itemPrices?.[ITEM_IDS.REVIVE] ?? DEFAULT_ITEM_PRICES[ITEM_IDS.REVIVE]),
            });
        }

        let boughtAny = false;
        let neededAny = false;
        let blockedByGold = false;
        for (const item of checks) {
            const needsBuy = forceRestock ? item.current < item.target : item.current < item.min;
            if (!needsBuy || item.price <= 0) continue;
            const deficit = Math.max(0, item.target - item.current);
            if (deficit <= 0) continue;
            neededAny = true;
            const qty = Math.min(MAX_SHOP_BUY_QTY, deficit, Math.floor(availableGold / item.price));
            if (qty >= 1) {
                availableGold -= qty * item.price;
                boughtAny = true;
                actions.push({ t: 'shop.buy', kind: item.kind, id: item.id, qty });
            } else {
                blockedByGold = true;
            }
        }
        tracker.lastRestockReport = {
            at: nowMs,
            boughtAny,
            neededAny,
            blockedByGold,
            currentGold,
            reserveGold,
        };
        if (boughtAny || forceRestock) {
            tracker.lastRestockAt = nowMs;
        }
    }

    if (
        state.noCentro === true &&
        nowMs >= Number(state.centroLivreEm || 0) &&
        nowMs - (tracker.lastHealAt || 0) >= 5000
    ) {
        tracker.lastHealAt = nowMs;
        actions.push({ t: 'centro.curar' });
        const huntSlug = config.targetHuntSlug || tracker.lastHuntSlug;
        if (huntSlug && !state.automation?.autoVoltarHunt) {
            actions.push({ t: 'hunt.select', slug: huntSlug });
        }
    }

    if (config.dailyPassEnabled !== false && state.passe) {
        const passSt = computePassStatus(state.passe, state.level, nowMs);
        const claimKey = `${passSt.hoje}:${passSt.jaPegouHoje}`;
        if (
            passSt.canClaim &&
            tracker.lastPassClaimKey !== claimKey &&
            nowMs - (tracker.lastPassAttemptAt || 0) >= 30_000
        ) {
            tracker.lastPassClaimKey = claimKey;
            tracker.lastPassAttemptAt = nowMs;
            actions.push({ t: 'passe.resgatar' });
        }
    }

    if (config.preyEnabled !== false && state.automation && nowMs - (tracker.lastPreyActionAt || 0) >= 15_000) {
        const dia = getSeasonalDayKey(nowMs);
        const liberadas = Number(state.automation.preyCartela2) > 0 ? 2 : 1;
        const prey = state.automation.prey?.dia === dia ? state.automation.prey : { dia, cartelas: [null, null] };

        for (let i = 0; i < liberadas; i++) {
            const c = prey.cartelas?.[i] || null;
            if (!c || (!c.bonus && !Array.isArray(c.lista))) {
                tracker.lastPreyActionAt = nowMs;
                actions.push({ t: 'prey.roletar', cartela: i, categoria: 'tudo', dia });
                break;
            }
            if (Array.isArray(c.lista) && c.lista.length > 0 && c.pk == null) {
                const pk = catalog.huntSpeciesId && c.lista.includes(catalog.huntSpeciesId)
                    ? catalog.huntSpeciesId
                    : c.lista[0];
                tracker.lastPreyActionAt = nowMs;
                actions.push({ t: 'prey.escolher', cartela: i, dia, pk });
                break;
            }
        }
    }

    return actions;
}
