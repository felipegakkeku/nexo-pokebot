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

// Cura de cada poção (HP fixo), conforme /assets/items.json do jogo.
export const POTION_HEAL = Object.freeze({ 200: 60, 201: 150, 202: 400, 203: 1000, 204: 3000 });
export const POTION_NAMES = Object.freeze({ 200: 'Small Potion', 201: 'Great Potion', 202: 'Ultra Potion', 203: 'Hyper Potion', 204: 'Ultimate Potion' });

/**
 * Escolhe a poção compravel com menor gold por HP curado de verdade no Pokemon ativo.
 * O jogo so usa a poção quando a vida cai abaixo do limiar, entao faltam (100% - limiar) do HP maximo;
 * o que a poção curar alem disso se perde. Poção que cura menos de 10% do HP nao acompanha o dano
 * (o jogo passa a usar uma por segundo) e so entra se nenhuma outra servir.
 * @param {object} state Estado do jogador (pokemons, activeId, automation.hpLimiar).
 * @param {object} [catalog] Catalogo com itemPrices.
 * @returns {{id:number,name:string,useful:number,goldPerHp:number,maxHp:number,ranked:Array<object>}|null}
 */
export function pickOptimizedPotion(state, catalog = {}) {
    const active = (state?.pokemons || []).find((p) => p && p.id === state?.activeId);
    const maxHp = Number(active?.maxHp ?? active?.hpMax ?? 0);
    if (!(maxHp > 0)) return null;
    let thr = Number(state?.automation?.hpLimiar);
    if (!Number.isFinite(thr) || thr <= 0) thr = 0.3;
    if (thr > 1) thr /= 100;
    thr = Math.min(0.9, Math.max(0.1, thr));
    const room = (1 - thr) * maxHp;
    const ranked = BUYABLE_POTION_IDS.map((id) => {
        const price = Number(catalog?.itemPrices?.[id] ?? DEFAULT_ITEM_PRICES[id] ?? 0);
        const useful = Math.min(POTION_HEAL[id] || 0, room);
        return { id, name: POTION_NAMES[id], price, useful, goldPerHp: useful > 0 && price > 0 ? price / useful : Infinity, keepsUp: useful >= maxHp * 0.1 };
    }).filter((p) => Number.isFinite(p.goldPerHp));
    if (ranked.length === 0) return null;
    ranked.sort((a, b) => (Number(b.keepsUp) - Number(a.keepsUp)) || (a.goldPerHp - b.goldPerHp) || (b.useful - a.useful));
    const best = ranked[0];
    return { id: best.id, name: best.name, useful: best.useful, goldPerHp: best.goldPerHp, maxHp, ranked };
}

const PVP_RETRY_MS = 15_000;
const PVP_AFTER_MATCH_MS = 5_000;

/**
 * Aplica uma mensagem `pvp` do servidor ao estado da fila e devolve o texto para o registro (ou null).
 * @param {object} pvp Estado da fila (mutado): na, waitUntil, wins, losses.
 * @param {object} m Mensagem { t: 'pvp', fila?, filaRecusa?, partida? }.
 * @param {number} nowMs Agora.
 * @returns {string|null}
 */
export function applyPvpMessage(pvp, m, nowMs = Date.now()) {
    if (!pvp || !m) return null;
    let note = null;
    if (m.fila && typeof m.fila === 'object') {
        const was = Boolean(pvp.na);
        pvp.na = Boolean(m.fila.na);
        if (m.fila.cooldownMs !== undefined) pvp.waitUntil = nowMs + Math.max(0, Number(m.fila.cooldownMs) || 0);
        if (pvp.na && !was) note = `PvP: na fila${m.fila.tamanho ? ` (${m.fila.tamanho} na fila agora)` : ''}.`;
    }
    if (m.filaRecusa) {
        pvp.na = false;
        const rest = Number(m.filaRecusa.restaMs) || 0;
        pvp.waitUntil = Math.max(Number(pvp.waitUntil || 0), nowMs + (rest > 0 ? rest : PVP_RETRY_MS));
        note = `PvP: o jogo não deixou entrar na fila (${m.filaRecusa.msg || 'recusou'}).`;
    }
    if (m.partida && typeof m.partida === 'object') {
        const p = m.partida;
        pvp.na = false;
        if (p.venci) pvp.wins = Number(pvp.wins || 0) + 1;
        else pvp.losses = Number(pvp.losses || 0) + 1;
        pvp.waitUntil = Math.max(Number(pvp.waitUntil || 0), nowMs + PVP_AFTER_MATCH_MS);
        const rival = String((typeof p.oponente === 'object' ? p.oponente?.nick ?? p.oponente?.nome : p.oponente) ?? '?');
        const delta = Number(p.delta) || 0;
        note = `PvP: ${p.venci ? 'venceu' : 'perdeu'} contra ${rival} (${delta >= 0 ? '+' : ''}${delta}). Placar da sessão: ${pvp.wins || 0}V ${pvp.losses || 0}D.`;
    }
    return note;
}

/**
 * Mantem a conta na fila do PvP ranqueado: pergunta o estado uma vez e entra de novo depois de cada partida,
 * respeitando a espera que o jogo pede. E o mesmo pedido do botao da fila no painel de PvP do jogo.
 * @param {object} pvp Estado da fila (mutado).
 * @param {object} config Config (pvpQueue).
 * @param {number} nowMs Agora.
 * @returns {Array<object>} Acoes a enviar.
 */
export function evaluatePvpQueue(pvp, config, nowMs = Date.now()) {
    if (!pvp || !config?.pvpQueue) return [];
    if (!pvp.asked) {
        pvp.asked = true;
        pvp.lastTry = nowMs;
        return [{ t: 'pvp.info', semLadder: 1, soCaixa: 1 }];
    }
    if (pvp.na || nowMs < Number(pvp.waitUntil || 0) || nowMs - Number(pvp.lastTry || 0) < PVP_RETRY_MS) return [];
    pvp.lastTry = nowMs;
    return [{ t: 'pvp.fila.entrar' }];
}

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

export const OUTLAND_DEX_BY_POKE_ID = Object.freeze({
    2001: 9, 2002: 160, 2003: 154, 2004: 3, 2005: 214, 2006: 123, 2007: 203, 2008: 26,
    2009: 181, 2010: 125, 2011: 148, 2012: 91, 2013: 87, 2014: 124, 2015: 221, 2016: 241,
    2017: 232, 2018: 28, 2019: 76, 2020: 112, 2021: 6, 2022: 157, 2023: 34, 2024: 31,
    2025: 169, 2026: 94, 2027: 200, 2028: 107, 2029: 106, 2030: 237, 2031: 59, 2032: 126,
    2033: 247, 2034: 208, 2035: 40, 2036: 178, 2037: 65, 2038: 97, 2039: 130, 2040: 226,
    2041: 127, 2042: 36, 2043: 210, 2044: 227, 2045: 164, 2046: 18, 2047: 105, 2048: 248,
    2049: 142, 2050: 212, 2051: 149, 2052: 547, 2053: 219, 2054: 454, 2055: 103, 2056: 429,
    2057: 699, 2058: 560,
});

const OUTLAND_DEX_BY_BASE_NAME = Object.freeze({
    blastoise: 9, feraligatr: 160, meganium: 154, venusaur: 3, heracross: 214, scyther: 123,
    girafarig: 203, raichu: 26, ampharos: 181, electabuzz: 125, dragonair: 148, cloyster: 91,
    dewgong: 87, jynx: 124, piloswine: 221, miltank: 241, donphan: 232, sandslash: 28,
    golem: 76, rhydon: 112, charizard: 6, typhlosion: 157, nidoking: 34, nidoqueen: 31,
    crobat: 169, gengar: 94, misdreavus: 200, hitmonchan: 107, hitmonlee: 106, hitmontop: 237,
    arcanine: 59, magmar: 126, pupitar: 247, steelix: 208, wigglytuff: 40, xatu: 178,
    alakazam: 65, hypno: 97, gyarados: 130, mantine: 226, pinsir: 127, clefable: 36,
    granbull: 210, skarmory: 227, noctowl: 164, pidgeot: 18, marowak: 105, tyranitar: 248,
    aerodactyl: 142, scizor: 212, dragonite: 149, whimsicott: 547, magcargo: 219, toxicroak: 454,
    exeggutor: 103, mismagius: 429, aurorus: 699, scrafty: 560,
});

const SPECIAL_DEX_BY_POKE_ID = Object.freeze({
    8017: 1017,
    9017: 1017,
    12017: 1017,
    10001: 9,
});

const VARIANT_NAME_PREFIX_RE = /^(?:shiny|mega|alolan|galarian|hisuian|paldean|brave|tribal|ancient|war|furious|charged|magnetic|evil|freezing|psy|heavy|milch|roll|hard|brute|enraged|dark|trickmaster|banshee|taekwondo|enigmatic|magma|toxic)[\s-]+/i;

/**
 * Converte qualquer `speciesId` interno do PokeIdle (Gen 1-9, Hoenn 13xxx, Outland 2001..2058 / 10501..10547,
 * Megas 3xxx / 9xxx / 14xxx e Formas Regionais/Especiais 1479 / 4xxx..12xxx) para o numero da National Dex (1..1025)
 * compativel com o repositorio de sprites da PokeAPI.
 * @param {number|string|null|undefined} speciesId ID interno da especie no PokeIdle.
 * @param {string} [name=''] Nome opcional para fallback (ex.: variantes Outland ou anuncios sem speciesId).
 * @param {Record<string, number>|null} [dexByName=null] Mapa opcional nome normalizado -> National Dex.
 * @returns {number} Numero da National Dex (1..1025) ou 0 se nao resolvido.
 */
export function resolvePokemonSpriteDex(speciesId, name = '', dexByName = null) {
    let id = Number(speciesId);
    if (Number.isInteger(id) && id > 0) {
        if (id >= 10501 && id <= 10548) id -= 8500;
        if (SPECIAL_DEX_BY_POKE_ID[id]) return SPECIAL_DEX_BY_POKE_ID[id];
        if (OUTLAND_DEX_BY_POKE_ID[id]) return OUTLAND_DEX_BY_POKE_ID[id];
        if (id <= 1025) return id;
        const mod = id % 1000;
        if (mod >= 1 && mod <= 999) return mod;
    }
    const raw = String(name || '').trim();
    if (raw) {
        const lower = raw.toLowerCase();
        if (dexByName && dexByName[lower]) return dexByName[lower];
        let stripped = lower;
        for (let i = 0; i < 3; i++) {
            const next = stripped.replace(VARIANT_NAME_PREFIX_RE, '').trim();
            if (next === stripped) break;
            stripped = next;
        }
        if (dexByName && dexByName[stripped]) return dexByName[stripped];
        if (OUTLAND_DEX_BY_BASE_NAME[stripped]) return OUTLAND_DEX_BY_BASE_NAME[stripped];
    }
    return 0;
}

/**
 * Verifica se uma entidade presente em `campo` / `campo.init` representa um Pokemon selvagem de hunt.
 * Exclui treinadores (`tr`), pets de jogadores (`dn`), equipes PvP (`eq`), bonecos (`bn`),
 * pets em treino na casa (`ti`) e NPCs do Centro Medico (`cura`, `tm`, `depot`).
 * @param {object} mob Registro normalizado de mob do rastreador de campo.
 * @returns {boolean} True apenas para mobs selvagens capturaveis.
 */
export function isWildCampoMob(mob) {
    if (!mob || mob.slot == null) return false;
    if (mob.ehTreinador || mob.ehBoneco || mob.emTreino || mob.ehNpc) return false;
    if (mob.dono != null && mob.dono !== '') return false;
    if (mob.equipe != null && mob.equipe !== '') return false;
    return true;
}

/**
 * Cria um rastreador dos mobs e caidos presentes no campo atual.
 * @returns {object} Controlador com applyCampoInit, applyCampo, applyBattleEvent, getFallenCorpses, getMobs, getScene e reset.
 */
export function createFieldTracker() {
    const mobs = new Map();
    const recentBattleSlots = [];
    let serverNow = Date.now();
    let scene = { slug: null, centro: false, casa: false, pracaTag: null };

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

    const mergeCampoDelta = (m, nowMs) => {
        serverNow = Number(m?.ts || nowMs || serverNow);
        for (const b of m?.mobs ?? []) {
            if (!b || b.s == null) continue;
            const prev = mobs.get(b.s) || {};
            const isNewName = b.n !== undefined && b.n !== prev.nome;
            mobs.set(b.s, {
                ...prev,
                slot: b.s,
                speciesId: (b.p ?? b.pokeId ?? b.speciesId) !== undefined
                    ? Number(b.p ?? b.pokeId ?? b.speciesId)
                    : (isNewName ? null : (prev.speciesId ?? null)),
                nome: b.n !== undefined ? b.n : prev.nome,
                level: b.nv !== undefined ? b.nv : prev.level,
                shiny: b.sh !== undefined ? Boolean(b.sh) : (isNewName ? false : Boolean(prev.shiny)),
                morto: b.x !== undefined ? Boolean(b.x) : Boolean(prev.morto),
                ehTreinador: b.tr !== undefined ? Boolean(b.tr) : (isNewName ? false : Boolean(prev.ehTreinador)),
                dono: b.dn !== undefined ? b.dn : (isNewName ? null : (prev.dono ?? null)),
                equipe: b.eq !== undefined ? b.eq : (isNewName ? null : (prev.equipe ?? null)),
                ehBoneco: b.bn !== undefined ? Boolean(b.bn) : (isNewName ? false : Boolean(prev.ehBoneco)),
                emTreino: b.ti !== undefined ? true : (isNewName ? false : Boolean(prev.emTreino)),
                ehNpc: (b.cura || b.tm || b.depot) ? true : (isNewName ? false : Boolean(prev.ehNpc)),
                hp: b.hp !== undefined ? b.hp : prev.hp,
                maxHp: b.mhp !== undefined ? b.mhp : prev.maxHp,
                expiraEm: b.xr !== undefined ? serverNow + Number(b.xr) : (b.x === false ? undefined : prev.expiraEm),
            });
        }
        for (const slot of m?.fora ?? []) {
            mobs.delete(slot);
        }
    };

    const applyCampo = (m, nowMs) => {
        const msgPracaTag = m?.sl ?? null;
        if (scene.slug != null && msgPracaTag !== scene.pracaTag) {
            return;
        }
        if (scene.slug == null && msgPracaTag != null) {
            scene.pracaTag = msgPracaTag;
            scene.centro = true;
        }
        mergeCampoDelta(m, nowMs);
    };

    const applyCampoInit = (m, nowMs) => {
        mobs.clear();
        recentBattleSlots.length = 0;
        const pracaTag = m?.sl ?? null;
        scene = {
            slug: m?.slug ?? null,
            centro: Boolean(m?.centro || pracaTag != null),
            casa: Boolean(m?.casa),
            pracaTag,
        };
        serverNow = Number(m?.ts || nowMs || Date.now());
        if (m?.mobs || m?.fora) {
            mergeCampoDelta(m, nowMs);
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
                speciesId: (e.p ?? e.pokeId ?? e.speciesId) !== undefined
                    ? Number(e.p ?? e.pokeId ?? e.speciesId)
                    : (prev.speciesId ?? null),
                nome: e.nome ?? prev.nome ?? '',
                level: Number(e.level ?? e.nivel ?? prev.level ?? 1) || 1,
                shiny: e.shiny !== undefined ? Boolean(e.shiny) : Boolean(prev.shiny),
                morto: true,
                ehTreinador: false,
                dono: null,
                equipe: null,
                ehBoneco: false,
                emTreino: false,
                ehNpc: false,
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
        if (scene.centro || scene.casa || scene.pracaTag != null) return [];
        const list = [];
        for (const e of mobs.values()) {
            const resta = (e.expiraEm ?? 0) - nowMs;
            if (e.morto && isWildCampoMob(e) && resta > 0) {
                list.push({
                    slot: e.slot,
                    speciesId: e.speciesId ?? null,
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
    const getScene = () => ({
        ...scene,
        isWild: !scene.centro && !scene.casa && scene.pracaTag == null,
    });
    const reset = () => {
        mobs.clear();
        recentBattleSlots.length = 0;
        scene = { slug: null, centro: false, casa: false, pracaTag: null };
    };

    return { applyCampoInit, applyCampo, applyBattleEvent, getFallenCorpses, getMobs, getScene, reset };
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
            detail: 'Captura automática, Restock, Passe, Prey e /hunt estão pausados neste modo (mantém só a conexão viva e as lives).',
            fixLabel: 'Restaurar captura + Shiny',
            fixConfig: { economyPingOnly: false, economyMode: 'auto', caidosEnabled: true },
        });
        return warnings;
    }

    if (cfg.caidosEnabled === false) {
        const isCollectionMode = cfg.farmObjective === 'pokedex' || cfg.farmObjective === 'topcatch';
        warnings.push({
            code: 'caidos-disabled',
            severity: isCollectionMode ? 'danger' : 'warn',
            title: isCollectionMode
                ? `Captura automática desligada (${cfg.farmObjective === 'pokedex' ? 'Pokédex' : 'Top Catch'} travado)`
                : 'Captura automática desligada',
            detail: isCollectionMode
                ? 'O modo de coleção precisa da captura automática ligada para registrar espécies e trocar de mapa.'
                : 'O bot não vai lançar Pokébolas em Pokémon caídos nem em Shinies enquanto "Capturar Pokémon caídos" estiver desmarcado.',
            fixLabel: 'Reativar captura',
            fixConfig: { caidosEnabled: true },
        });
    }

    if (cfg.economyMode === 'on' && mode !== 'browser-bridge') {
        warnings.push({
            code: 'server-economy-no-shiny',
            severity: 'warn',
            title: 'Economia do servidor ativa: captura pelo fallback de batalha',
            detail: 'O servidor corta o feed de campo neste modo. O bot tenta capturar pelo fallback de batalha e pode perder caídos se o servidor omitir o slot; cada caído perdido é uma chance de shiny a menos. No Modo Eco padrão (desmarcado), o bot já roda com 0% GPU e mantém 100% da captura.',
            fixLabel: 'Restaurar captura completa',
            fixConfig: { economyMode: 'auto', caidosEnabled: true },
        });
    } else if (isOnline && cfg.caidosEnabled !== false && (campoFeedDegraded || (economyActive && mode !== 'browser-bridge'))) {
        warnings.push({
            code: 'campo-feed-missing',
            severity: 'warn',
            title: 'Feed de campo indisponível: captura limitada',
            detail: 'O servidor não está enviando o feed de campo nesta hunt. O bot continua tentando lançar Pokébolas pelo fallback de batalha, mas pode perder caídos.',
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
    // O PokeIdle sorteia o shiny no proprio arremesso (o brilho so aparece quando a bola sai e,
    // se ela nao fecha, o shiny vai embora com o corpo). Por isso um caido nunca chega aqui marcado
    // como shiny pelo feed de campo: a bola que pega o shiny e a bola comum, escolhida abaixo.
    // O ramo shiny fica so como defesa caso o servidor um dia passe a marcar antes.
    if (corpse?.shiny) {
        const shinyBall = config?.shinyBall || 'best';
        order = SHINY_BALL_ORDERS[shinyBall] || SHINY_BALL_ORDERS.best;
    } else if (!config?.ballEconomy && (corpse?.level || 0) >= (config?.highLevelUltraThreshold ?? 50)) {
        // Padrao: Ultra em todo caido de nivel alto, porque o shiny sai no arremesso e bola forte segura mais.
        order = NORMAL_BALL_ORDERS.ultra;
    } else {
        const pref = config?.preferredBall || 'auto';
        if (pref === 'auto' || !NORMAL_BALL_ORDERS[pref]) {
            const gold = Number(playerGold || 0);
            if (config?.ballEconomy) order = gold >= 50_000 ? [2, 1, 3, 4] : [1, 2, 3, 4];
            else if (gold >= 2_500_000) order = [4, 3, 2, 1];
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
    if (config?.ballEconomy) return gold >= 50_000 ? 2 : 1;
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
    ITEM_IDS.GOLDEN_POTION,
]);
export const POTION_IDS = BUYABLE_POTION_IDS;

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
 * @returns {number} ID da pocao compravel (200..204 ou 70070, a Golden).
 */
export function resolveRestockPotionId(state = null, config = null, catalog = null) {
    if (config?.potionOptimize) {
        const best = pickOptimizedPotion(state, catalog || {});
        if (best) return best.id;
    }
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
    desiredMissingKeys = null,
}) {
    if (!state) return [];
    tracker.slotThrownAt ??= {};

    const actions = [];
    const collectionMode = config.farmObjective === 'pokedex' || config.farmObjective === 'topcatch';

    const currentPotionIds = Array.isArray(state.automation?.potionIds)
        ? state.automation.potionIds.map((id) => Number(id))
        : [];
    let preferredPotionIds = normalizePotionIds(config.preferredPotionIds);
    tracker.potionChoice = null;
    if (config.potionOptimize) {
        const best = pickOptimizedPotion(state, catalog);
        if (best) {
            tracker.potionChoice = best;
            const base = preferredPotionIds.length > 0 ? preferredPotionIds : currentPotionIds;
            preferredPotionIds = [best.id, ...base.filter((id) => id !== best.id && POTION_IDS.includes(id))];
        }
    }
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
    const needsCollectionControl = collectionMode && config.caidosEnabled !== false &&
        Boolean(state.automation?.autoBallSemParar || state.automation?.autoBallAteCapturar);
    const needsCollectionRestore = !collectionMode && Boolean(
        tracker.savedAutoBall &&
        (tracker.savedAutoBall.autoBallAteCapturar || tracker.savedAutoBall.autoBallSemParar)
    );
    const autoSetCooldownMs = needsPotionSync || needsCollectionControl || needsCollectionRestore ? 5_000 : 30_000;

    if ((needsNativeHeal || needsPotionSync || needsCollectionControl || needsCollectionRestore) &&
        nowMs - (tracker.lastAutoSetAt || 0) >= autoSetCooldownMs) {
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
        if (needsCollectionControl) {
            tracker.savedAutoBall ??= {
                autoBallAteCapturar: Boolean(state.automation?.autoBallAteCapturar),
                autoBallSemParar: Boolean(state.automation?.autoBallSemParar),
            };
            autoPayload.autoBallAteCapturar = false;
            autoPayload.autoBallSemParar = false;
        } else if (needsCollectionRestore) {
            autoPayload.autoBallAteCapturar = tracker.savedAutoBall.autoBallAteCapturar;
            autoPayload.autoBallSemParar = tracker.savedAutoBall.autoBallSemParar;
            tracker.savedAutoBall = null;
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
        const sceneSlug = field.getScene?.()?.slug || state.huntSlug || '';
        const sceneSpecies = Array.isArray(catalog.huntsBySlug?.[sceneSlug]?.especies)
            ? catalog.huntsBySlug[sceneSlug].especies
            : [];
        const sceneIdByName = new Map();
        for (const sp of sceneSpecies) {
            const nm = String(sp?.nome || '').trim().toLowerCase();
            if (nm && sp?.pokeId != null) sceneIdByName.set(nm, Number(sp.pokeId));
        }
        const resolveCorpseSpeciesId = (c) => {
            if (c.speciesId != null) return c.speciesId;
            const nm = String(c.nome || '').trim().toLowerCase();
            if (!nm) return null;
            if (sceneIdByName.has(nm)) return sceneIdByName.get(nm);
            const catId = catalog.pokemonIdByName?.[nm];
            return catId != null ? catId : null;
        };
        const hasMissingSet = desiredMissingKeys instanceof Set && desiredMissingKeys.size > 0;
        const isDesiredMissing = (c) => {
            if (!hasMissingSet) return false;
            const k = chavePokedex(resolveCorpseSpeciesId(c));
            return k != null && desiredMissingKeys.has(String(k));
        };
        // autoBallAteCapturar do servidor nao lanca em especies ja registradas na Pokedex;
        // so delegamos quando autoBallSemParar esta ativo para nao matar rolagens de Shiny.
        const vipAutoBall = Boolean(
            state.loja?.vip && state.automation?.autoBallSemParar
        );
        if (collectionMode && desiredMissingKeys instanceof Set && config.farmObjectiveFocus !== 'shiny') {
            corpses = corpses.filter(isDesiredMissing);
        } else if (vipAutoBall) {
            corpses = corpses.filter((c) => c.shiny === true || isDesiredMissing(c));
        }
        if (hasMissingSet && corpses.length > 1) {
            corpses = [...corpses].sort((a, b) => {
                if (Boolean(a.shiny) !== Boolean(b.shiny)) return a.shiny ? -1 : 1;
                const ma = isDesiredMissing(a);
                const mb = isDesiredMissing(b);
                if (ma !== mb) return ma ? -1 : 1;
                return 0;
            });
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
            const potionId = resolveRestockPotionId(state, config, catalog);
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

        // Com pouco gold, primeiro a cura (poção), depois o revive e por ultimo a bola: sem cura o farm morre.
        const restockPriority = (item) => (item.kind === 'ball' ? 2 : item.id === ITEM_IDS.REVIVE ? 1 : 0);
        checks.sort((a, b) => restockPriority(a) - restockPriority(b));
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

    if (state.noCentro !== true) {
        tracker.centerHealSinceAt = 0;
    } else if (
        nowMs >= Number(state.centroLivreEm || 0) &&
        nowMs - (tracker.lastHealAt || 0) >= 5000
    ) {
        if (!tracker.centerHealSinceAt) tracker.centerHealSinceAt = nowMs;
        tracker.lastHealAt = nowMs;
        actions.push({ t: 'centro.curar' });
        const huntSlug = config.targetHuntSlug || tracker.lastHuntSlug;
        const stuckInCenter = nowMs - tracker.centerHealSinceAt >= 4_000;
        if (huntSlug && (!state.automation?.autoVoltarHunt || stuckInCenter)) {
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
                let pk = catalog.huntSpeciesId && c.lista.includes(catalog.huntSpeciesId)
                    ? catalog.huntSpeciesId
                    : null;
                if (pk == null && Array.isArray(catalog.huntsList)) {
                    const lvl = Number(state.level || 0);
                    const unlockedIds = new Set();
                    for (const h of catalog.huntsList) {
                        if (lvl > 0 && Number(h?.nivel || 0) > lvl) continue;
                        for (const sp of h?.especies || []) {
                            if (sp?.pokeId != null) unlockedIds.add(Number(sp.pokeId));
                        }
                    }
                    pk = c.lista.find((id) => unlockedIds.has(Number(id))) ?? null;
                }
                if (pk == null) pk = c.lista[0];
                tracker.lastPreyActionAt = nowMs;
                actions.push({ t: 'prey.escolher', cartela: i, dia, pk });
                break;
            }
        }
    }

    return actions;
}

// ===== Pokedex & Top Catch (protocolo oficial PokeIdle) =====

const FUSO_BRASILIA_MS = 3 * 60 * 60_000;
const SEMANA_MS = 7 * 24 * 60 * 60_000;

export const TOP_CATCH_MILESTONES = Object.freeze([
    Object.freeze({ marco: 10, label: '30m XP' }),
    Object.freeze({ marco: 25, label: '30m PokeXP' }),
    Object.freeze({ marco: 50, label: '1h XP + 1h PokeXP' }),
    Object.freeze({ marco: 100, label: '30m Shiny' }),
    Object.freeze({ marco: 150, label: '30m XP + PokeXP + Shiny' }),
    Object.freeze({ marco: 200, label: '1h XP + PokeXP + Shiny' }),
    Object.freeze({ marco: 300, label: '2h XP + PokeXP + Shiny' }),
    Object.freeze({ marco: 400, label: '12h Shiny' }),
    Object.freeze({ marco: 600, label: '1.000 Beast Balls + 24h Shiny' }),
]);

export const TOP_CATCH_PRIZE_TIERS = Object.freeze([
    Object.freeze({ ate: 1, diamantes: 50, selo: true }),
    Object.freeze({ ate: 10, diamantes: 20, selo: false }),
    Object.freeze({ ate: 100, diamantes: 5, selo: false }),
]);

/**
 * Resolve a chave canonica da Pokedex / Top Catch para um pokeId (identico a shared/pokedex.mjs).
 * @param {number|string|null|undefined} pokeId ID da especie no servidor.
 * @returns {number|null} Chave numerica da Pokedex ou null.
 */
export function chavePokedex(pokeId) {
    const id = Number(pokeId);
    if (!Number.isFinite(id) || id < 1) return null;
    if (id >= 10501 && id <= 10548) return id - 8500;
    if (id >= 2001 && id < 2059) return id;
    if (id >= 13000) return id % 1000;
    return id;
}

/**
 * Calcula a chave YYYY-MM-DD (domingo em Brasilia UTC-3) da semana atual do Top Catch.
 * @param {number} [nowMs=Date.now()] Timestamp do servidor em ms.
 * @returns {string} Data do domingo inicial da semana.
 */
export function getTopCatchWeekKey(nowMs = Date.now()) {
    const brasilia = new Date(Number(nowMs) - FUSO_BRASILIA_MS);
    const desdeDomingo = brasilia.getUTCDay();
    return new Date(Date.UTC(
        brasilia.getUTCFullYear(),
        brasilia.getUTCMonth(),
        brasilia.getUTCDate() - desdeDomingo,
    )).toISOString().slice(0, 10);
}

/**
 * Retorna a janela (inicio, fim, restante em ms) de uma semana do Top Catch.
 * @param {string|null} weekKey Chave YYYY-MM-DD (usa semana atual se vazia).
 * @param {number} [nowMs=Date.now()] Timestamp atual do servidor em ms.
 * @returns {{ week: string, startMs: number, endMs: number, remainingMs: number, ending: boolean }}
 */
export function getTopCatchWeekWindow(weekKey = null, nowMs = Date.now()) {
    const week = typeof weekKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(weekKey)
        ? weekKey
        : getTopCatchWeekKey(nowMs);
    const startMs = Date.parse(`${week}T00:00:00Z`) + FUSO_BRASILIA_MS;
    const endMs = startMs + SEMANA_MS;
    const remainingMs = Math.max(0, endMs - Number(nowMs));
    return { week, startMs, endMs, remainingMs, ending: remainingMs <= 0 };
}

/**
 * Calcula o progresso do jogador nos marcos de recompensa do Top Catch.
 * @param {number} count Total de especies capturadas na semana.
 * @param {number} [paidMilestone=0] Ultimo marco ja pago pelo servidor.
 * @returns {object} Progresso detalhado de marcos.
 */
export function getTopCatchMilestoneProgress(count, paidMilestone = 0) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    let previous = 0;
    let nextObj = null;
    for (const m of TOP_CATCH_MILESTONES) {
        if (n < m.marco) {
            nextObj = m;
            break;
        }
        previous = m.marco;
    }
    const span = nextObj ? Math.max(1, nextObj.marco - previous) : 1;
    const progressPct = nextObj
        ? Math.max(0, Math.min(100, Math.round(((n - previous) / span) * 100)))
        : 100;
    return {
        current: n,
        previous,
        next: nextObj ? nextObj.marco : null,
        nextRewardLabel: nextObj ? nextObj.label : 'Todos os marcos concluídos',
        remainingToNext: nextObj ? Math.max(0, nextObj.marco - n) : 0,
        progressPct,
        paidMilestone: Math.max(0, Math.floor(Number(paidMilestone) || 0)),
        completedAll: !nextObj,
    };
}

/**
 * Calcula a posicao atual do jogador no ranking semanal de Top Catch (identico a tcPosicaoCom).
 * @param {string} nick Nick do treinador.
 * @param {number} count Especies capturadas na semana.
 * @param {number} trainerLevel Nivel do treinador (desempate).
 * @param {Array<object>|null} linhas Linhas de ranking.capturas do servidor.
 * @returns {object|null} Posicao, premio e diferencas.
 */
export function computeTopCatchRankingPosition(nick, count, trainerLevel = 0, linhas = null) {
    if (!Array.isArray(linhas) || linhas.length === 0) return null;
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const lvl = Number(trainerLevel) || 0;
    const lowNick = String(nick || '').toLowerCase();
    const iEu = lowNick ? linhas.findIndex((l) => String(l?.nick || '').toLowerCase() === lowNick) : -1;
    const outros = lowNick ? linhas.filter((l) => String(l?.nick || '').toLowerCase() !== lowNick) : linhas;
    const daLista = iEu >= 0 && (Number(linhas[iEu]?.valor) || 0) === n;
    const acima = daLista
        ? linhas.slice(0, iEu)
        : outros.filter((l) => {
            const v = Number(l?.valor) || 0;
            return v > n || (v === n && (Number(l?.level) || 0) >= lvl);
        });
    const pos = n > 0 ? acima.length + 1 : null;
    const tier = pos != null ? TOP_CATCH_PRIZE_TIERS.find((f) => pos <= f.ate) ?? null : null;
    const aboveEntry = acima.length > 0 ? acima[acima.length - 1] : null;
    const top100Entry = linhas.length >= 100 ? linhas[99] : linhas[linhas.length - 1];
    const top10Entry = linhas.length >= 10 ? linhas[9] : null;
    const top1Entry = linhas[0] || null;
    return {
        pos,
        inPrizeZone: Boolean(tier),
        prize: tier ? { diamantes: tier.diamantes, selo: Boolean(tier.selo) } : null,
        above: aboveEntry ? { nick: aboveEntry.nick || '', count: Number(aboveEntry.valor || 0) } : null,
        top100Cutoff: top100Entry ? Number(top100Entry.valor || 0) : null,
        top10Cutoff: top10Entry ? Number(top10Entry.valor || 0) : null,
        top1Count: top1Entry ? Number(top1Entry.valor || 0) : null,
        totalRanked: linhas.length,
    };
}

/**
 * Extrai o conjunto de chaves de especies ja capturadas (c > 0) na Pokedex do jogador.
 * @param {Record<string, object>|null} pokedex Mapa estado.pokedex.
 * @param {Iterable<string|number>|null} [extraKeys=null] Chaves otimistas capturadas na sessao.
 * @returns {Set<string>} Conjunto de chaves canonicas (string).
 */
export function getPokedexCapturedSet(pokedex, extraKeys = null) {
    const out = new Set();
    if (pokedex && typeof pokedex === 'object') {
        for (const [rawKey, entry] of Object.entries(pokedex)) {
            if (!(Number(entry?.c || 0) > 0)) continue;
            const norm = chavePokedex(rawKey);
            if (norm != null) out.add(String(norm));
        }
    }
    if (extraKeys) {
        for (const k of extraKeys) {
            const norm = chavePokedex(k);
            if (norm != null) out.add(String(norm));
            else if (k != null && String(k)) out.add(String(k));
        }
    }
    return out;
}

/**
 * Lista as especies de uma hunt que ainda nao estao presentes em `capturedSet`.
 * @param {object|null} hunt Entrada da hunt contendo `especies` ou `speciesId`.
 * @param {Set<string>|null} capturedSet Conjunto de chaves ja capturadas.
 * @returns {Array<{ pokeId: number, key: string, name: string }>} Especies faltantes.
 */
export function getHuntMissingSpecies(hunt, capturedSet) {
    if (!hunt || typeof hunt !== 'object') return [];
    const list = Array.isArray(hunt.especies) && hunt.especies.length > 0
        ? hunt.especies
        : (hunt.speciesId != null ? [{ pokeId: hunt.speciesId, nome: hunt.nome || `#${hunt.speciesId}` }] : []);
    const seen = new Set();
    const missing = [];
    for (const sp of list) {
        const rawId = sp?.pokeId ?? sp?.speciesId ?? sp?.id;
        const keyNum = chavePokedex(rawId);
        if (keyNum == null) continue;
        const key = String(keyNum);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!capturedSet || !capturedSet.has(key)) {
            missing.push({
                pokeId: Number(rawId),
                key,
                name: String(sp?.nome || sp?.name || hunt.nome || `#${rawId}`),
            });
        }
    }
    return missing;
}

/**
 * Consolida contadores de Pokedex e Top Catch sobre todas as hunts liberadas pelo nivel do treinador.
 * @param {object} params Contexto com hunts, trainerLevel, pokedex, weeklyCaughtSet e extraPokedexKeys.
 * @returns {{ pokedex: object, topCatch: object }} Resumo de progresso.
 */
export function computeCollectionSummary({
    hunts = [],
    trainerLevel = 0,
    pokedex = null,
    weeklyCaughtSet = null,
    extraPokedexKeys = null,
} = {}) {
    const dexSet = getPokedexCapturedSet(pokedex, extraPokedexKeys);
    const weekSet = weeklyCaughtSet instanceof Set ? weeklyCaughtSet : null;
    const lvl = Number(trainerLevel) || 0;
    const unlockedSpecies = new Set();
    const unlockedDexCaught = new Set();
    const unlockedWeekCaught = new Set();
    let dexPendingHunts = 0;
    let weekPendingHunts = 0;

    for (const h of hunts || []) {
        if (!h || typeof h !== 'object') continue;
        if (lvl > 0 && Number(h.nivel || 0) > lvl) continue;
        const allSp = getHuntMissingSpecies(h, null);
        if (allSp.length === 0) continue;
        let huntMissingDex = false;
        let huntMissingWeek = false;
        for (const sp of allSp) {
            unlockedSpecies.add(sp.key);
            if (dexSet.has(sp.key)) unlockedDexCaught.add(sp.key);
            else huntMissingDex = true;
            if (weekSet) {
                if (weekSet.has(sp.key)) unlockedWeekCaught.add(sp.key);
                else huntMissingWeek = true;
            }
        }
        if (huntMissingDex) dexPendingHunts += 1;
        if (weekSet && huntMissingWeek) weekPendingHunts += 1;
    }

    const unlockedTotal = unlockedSpecies.size;
    const dexCapturedTotal = dexSet.size;
    return {
        pokedex: {
            capturedTotal: dexCapturedTotal,
            unlockedTotal,
            unlockedCaptured: unlockedDexCaught.size,
            unlockedMissing: Math.max(0, unlockedTotal - unlockedDexCaught.size),
            unlockedPendingHunts: dexPendingHunts,
            pct: unlockedTotal > 0 ? Math.round((unlockedDexCaught.size / unlockedTotal) * 100) : 0,
        },
        topCatch: {
            unlockedTotal,
            unlockedCaptured: weekSet ? unlockedWeekCaught.size : 0,
            unlockedMissing: weekSet ? Math.max(0, unlockedTotal - unlockedWeekCaught.size) : unlockedTotal,
            unlockedPendingHunts: weekSet ? weekPendingHunts : 0,
            pct: unlockedTotal > 0 && weekSet ? Math.round((unlockedWeekCaught.size / unlockedTotal) * 100) : 0,
        },
    };
}

/**
 * Seleciona a melhor hunt alvo para o modo Completar Pokedex ou Modo Top Catch,
 * combinando especies faltantes com o ranking real do /hunt (xp, ouro, shiny) ou modo rapido (fast).
 * @param {object} params Contexto de selecao.
 * @returns {object} Decisao com targetSlug, targetHunt, metricas e contagem pendente.
 */
export function selectObjectiveHunt({
    mode = 'off',
    focus = 'xp',
    currentSlug = '',
    activeTargetSlug = null,
    rotateAfterCatch = false,
    staleSlugs = null,
    hunts = [],
    trainerLevel = 0,
    activePokemonLevel = 0,
    capturedSet = null,
    huntRanking = null,
} = {}) {
    if (mode !== 'pokedex' && mode !== 'topcatch') {
        return { active: false, targetSlug: null, completed: false };
    }
    const lvl = Number(trainerLevel) || 0;
    const pkLvl = Number(activePokemonLevel) || lvl || 0;
    const rankMap = new Map();
    if (Array.isArray(huntRanking)) {
        for (const row of huntRanking) {
            if (row?.slug) rankMap.set(String(row.slug), row);
        }
    }
    const hasRank = rankMap.size > 0;
    const metricKey = focus === 'ouro' ? 'goldH' : (focus === 'shiny' ? 'shinyH' : 'xpH');

    const candidates = [];
    let currentCandidate = null;
    const missingSpeciesAll = new Set();

    for (const h of hunts || []) {
        if (!h?.slug) continue;
        if (lvl > 0 && Number(h.nivel || 0) > lvl) continue;
        const missing = getHuntMissingSpecies(h, capturedSet);
        if (missing.length === 0) continue;
        for (const sp of missing) missingSpeciesAll.add(sp.key);

        const r = rankMap.get(h.slug) || null;
        const metricValue = r ? Number(r[metricKey] ?? r.value ?? 0) : 0;
        const unsafe = r
            ? Boolean(r.unsafe)
            : (pkLvl > 0 && Number(h.nivel || 0) > Math.max(pkLvl * 1.15, pkLvl + 15));
        const item = {
            hunt: h,
            slug: h.slug,
            name: h.nome || h.slug,
            level: Number(h.nivel || 0),
            missing,
            rankRow: r,
            metricValue,
            unsafe,
        };
        candidates.push(item);
        if (h.slug === currentSlug) currentCandidate = item;
    }

    if (candidates.length === 0) {
        return {
            active: true,
            mode,
            focus,
            completed: true,
            targetSlug: null,
            targetHunt: null,
            currentHasMissing: false,
            currentMissing: [],
            pendingHuntsCount: 0,
            missingSpeciesCount: 0,
            usedHuntGuide: hasRank,
            metricValue: 0,
            unsafe: false,
        };
    }

    const safePool = candidates.filter((c) => !c.unsafe);
    const eligiblePool = safePool.length > 0 ? safePool : candidates;
    const freshPool = staleSlugs instanceof Set && staleSlugs.size > 0
        ? eligiblePool.filter((c) => !staleSlugs.has(c.slug))
        : [];
    const basePool = freshPool.length > 0 ? freshPool : eligiblePool;
    const alternatives = mode === 'topcatch' && rotateAfterCatch
        ? basePool.filter((candidate) => candidate.slug !== currentSlug)
        : [];
    const pool = alternatives.length ? alternatives : basePool;

    if (focus === 'fast') {
        pool.sort((a, b) =>
            (a.level - b.level) ||
            (b.missing.length - a.missing.length) ||
            (b.metricValue - a.metricValue) ||
            a.name.localeCompare(b.name)
        );
    } else if (hasRank) {
        pool.sort((a, b) =>
            (Number(Boolean(b.rankRow)) - Number(Boolean(a.rankRow))) ||
            (b.metricValue - a.metricValue) ||
            (b.missing.length - a.missing.length) ||
            (a.level - b.level)
        );
    } else {
        // Sem /hunt instalado: prioriza nivel mais alto seguro (melhor XP/ouro) ate o nivel do Pokemon ativo
        pool.sort((a, b) =>
            (b.level - a.level) ||
            (b.missing.length - a.missing.length) ||
            a.name.localeCompare(b.name)
        );
    }

    // Estabilidade: se ja estamos na hunt alvo ativa (e ela segue segura e com especie pendente), termina de capturar antes de trocar.
    let chosen = pool[0];
    if (
        currentCandidate && alternatives.length === 0 &&
        activeTargetSlug &&
        currentCandidate.slug === activeTargetSlug &&
        !(staleSlugs instanceof Set && staleSlugs.has(currentCandidate.slug)) &&
        (!currentCandidate.unsafe || safePool.length === 0)
    ) {
        chosen = currentCandidate;
    }

    return {
        active: true,
        mode,
        focus,
        completed: false,
        targetSlug: chosen.slug,
        targetHunt: chosen.hunt,
        targetName: chosen.name,
        targetLevel: chosen.level,
        currentHasMissing: Boolean(currentCandidate),
        currentMissing: currentCandidate ? currentCandidate.missing : [],
        targetMissing: chosen.missing,
        pendingHuntsCount: candidates.length,
        missingSpeciesCount: missingSpeciesAll.size,
        usedHuntGuide: Boolean(chosen.rankRow),
        metricValue: chosen.metricValue,
        unsafe: chosen.unsafe,
    };
}
