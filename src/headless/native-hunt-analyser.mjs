// Motor puro de analise de hunts com as mecanicas oficiais de pokeidle.io v1.492.0.
// Sem dependencias de DOM, rede ou estado mutavel global.

import { BICICLETA_VELOCIDADE } from './pvp-meta.mjs';

export const MS_ONDA = 2600;
export const MAX_MOBS = 16;
export const CD_GOLPE_MS = 900;
export const MS_DESLOC_MS = 600;
export const CD_MOVIMENTO_MEDIO_MS = 2000;
export const VIP_MULT_XP = 1.5;

export const NIVEL_ANCORA = 150;
export const OURO_ANCORA = 12000;
export const NIVEL_TETO_OURO = 25_000;
export const EXPOENTE_RENDA = 0.30;
export const FRACAO_BONUS_LOOT = 0.15;

export const OURO_KILL_NIVEL_1 = 36;
export const OURO_KILL_ANCORA_NIVEL = 5_000;
export const OURO_KILL_ANCORA = 6_000;

export const FATOR_CAPTURA_DO_DEGRAU = Object.freeze({ 20: 2.8669, 40: 3.5745, 100: 4.4681 });
export const CHANCE_PEDRA_POR_ESTAGIO = Object.freeze([0.2, 0.35, 0.5]);

export const DEGRAUS_FRAGMENTO_OVO_SHINY = Object.freeze([
    5000, 5400, 5900, 6400, 6950, 8000, 8600, 10000,
    11250, 12750, 14350, 16000, 20000, 21200, 25000, 26150,
    27500, 28950, 30450, 35150, 40000, 42800, 46150, 49650,
    53350, 64950, 75000, 84650, 95950, 108000, 120550, 160300,
]);

const OUTLAND_ESCADA = [
    [150, 1], [500, 1.1], [750, 1.15], [1000, 1.25], [1250, 1.3],
    [1500, 1.5], [1800, 1.65], [2000, 1.85], [2250, 2], [2500, 2.15],
    [3000, 2.3], [3250, 2.45], [3500, 2.6], [4000, 2.75], [5000, 3],
    [6000, 3.25], [7000, 3.5], [8000, 3.75], [10000, 4], [11000, 4.25],
    [12000, 4.5], [14000, 5], [15000, 5.25], [17000, 6], [19000, 6.5],
    [21000, 7], [24000, 7.5], [28000, 8], [32000, 8.5], [36000, 9],
    [38000, 9.5], [40000, 10], [41000, 10.5], [43000, 11], [45000, 12],
    [48000, 13], [52000, 14], [58000, 16], [60000, 17], [65000, 20],
];

export const OUTLAND_TIERS = Object.freeze(
    OUTLAND_ESCADA.map(([nivel, mult], idx) => Object.freeze({
        tier: 101 + idx,
        numero: idx + 1,
        rotulo: `Outland ${idx + 1}`,
        nivel,
        mult,
    }))
);

export const AJUSTE_HUNT_LEVEL = Object.freeze({
    112: 100,
    219: 100,
    13447: 1000,
    13448: 1250,
    297: 700,
    13297: 700,
    235: 30,
    132: 50,
    461: 1500,
    468: 1500,
});

export const AJUSTE_TIPOS = Object.freeze({
    448: Object.freeze(['FIGHTING', 'STEEL']),
    13448: Object.freeze(['FIGHTING', 'STEEL']),
});

const XP_ANCORA = 0.6 * NIVEL_ANCORA ** 2;
const EXPOENTE_OURO_KILL = Math.log(OURO_KILL_ANCORA / OURO_KILL_NIVEL_1) / Math.log(OURO_KILL_ANCORA_NIVEL);
const TETO_OURO_KILL = Math.round(OURO_KILL_NIVEL_1 * NIVEL_TETO_OURO ** EXPOENTE_OURO_KILL);

const FUSO_BRASILIA_MS = 3 * 3600_000;
const ANTECIPACAO_SAZONAL_MS = 6 * 3600_000;
const DESLOCAMENTO_SAZONAL_MS = FUSO_BRASILIA_MS - ANTECIPACAO_SAZONAL_MS;
const DIA_MS = 86_400_000;

const CHANCE_OVO_BASE = 1 / 150_000;
const CHANCE_OVO_PASSO = 0.04 / 150_000;
const NIVEL_MIN_OVO_SHINY = 5_000;

const SPEED_JOELHO = 120;
const SPEED_POTENCIAL_TETO_PCT = 7;

const TIPOS_ELEMENTAIS = Object.freeze([
    'NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'FIGHTING', 'POISON', 'GROUND',
    'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY',
]);

const DIAGONAL_DE_TIPOS = Object.freeze({
    FIRE: 0.5,
    WATER: 0.5,
    ELECTRIC: 0.5,
    GRASS: 0.5,
    ICE: 0.5,
    POISON: 0.5,
    PSYCHIC: 0.5,
    DARK: 0.5,
    STEEL: 0.5,
    GHOST: 2,
    DRAGON: 2,
});

const RARIDADE_ALIAS = Object.freeze({
    common: 'comum',
    uncommon: 'incomum',
    rare: 'rara',
    epic: 'epica',
    legendary: 'lendaria',
    mythic: 'mitica',
});

/**
 * XP base concedido pela derrota de um selvagem no nivel informado.
 * @param {number} n Nivel do mob.
 * @returns {number} XP base.
 */
export function xpDoNivel(n) {
    const lv = Math.max(1, Number(n) || 1);
    return lv <= NIVEL_ANCORA
        ? Math.floor((6 * lv * lv) / 10) + 8
        : Math.round(XP_ANCORA * (lv / NIVEL_ANCORA) ** 1.25);
}

/**
 * Valor base de ouro de referencia para uma especie no nivel informado.
 * @param {number} n Nivel de referencia.
 * @returns {number} Ouro de referencia.
 */
export function ouroDoNivel(n) {
    const lv = Math.max(1, Number(n) || 1);
    return Math.round(OURO_ANCORA * (lv / NIVEL_ANCORA) ** 0.6);
}

/**
 * Ouro base por abate no nivel informado, respeitando o teto em NIVEL_TETO_OURO.
 * @param {number} n Nivel do mob.
 * @returns {number} Ouro base do abate.
 */
export function ouroPorKillDoNivel(n) {
    const lv = Math.max(1, Number(n) || 1);
    return Math.min(
        TETO_OURO_KILL,
        Math.max(1, Math.round(OURO_KILL_NIVEL_1 * lv ** EXPOENTE_OURO_KILL))
    );
}

/**
 * Renda alvo total por abate (base + bonus de loot base de 15%).
 * @param {number} n Nivel do mob.
 * @returns {number} Renda alvo por kill.
 */
export function alvoRendaPorKill(n) {
    const lv = Math.max(1, Number(n) || 1);
    const base = lv <= NIVEL_TETO_OURO
        ? ouroPorKillDoNivel(lv)
        : TETO_OURO_KILL * (lv / NIVEL_TETO_OURO) ** EXPOENTE_RENDA;
    return Math.round(base * (1 + FRACAO_BONUS_LOOT));
}

/**
 * Parcela de ouro vinda do loot por abate, escalada por bonusLootPct.
 * @param {number} n Nivel do mob.
 * @param {number} [bonusLootPct=0] Bonus percentual de loot.
 * @returns {number} Ouro do loot por abate.
 */
export function ouroDoLootPorKill(n, bonusLootPct = 0) {
    const base = Math.max(0, alvoRendaPorKill(n) - ouroPorKillDoNivel(n));
    const bonus = Math.max(0, Number(bonusLootPct) || 0);
    return Math.round(base * (1 + bonus / 100));
}

/**
 * Total de ouro por abate dividido entre ouro base e loot.
 * @param {number} n Nivel do mob.
 * @param {number} [bonusLootPct=0] Bonus percentual de loot.
 * @returns {{ base: number, loot: number, total: number }} Detalhe do ouro por abate.
 */
export function ouroDoAbate(n, bonusLootPct = 0) {
    const base = ouroPorKillDoNivel(n);
    const loot = ouroDoLootPorKill(n, bonusLootPct);
    return { base, loot, total: base + loot };
}

/**
 * Multiplicador sazonal de dano (ataca=2, apanha=4, retorna ataca/apanha).
 * @param {string|null} tipoDia Tipo do dia sazonal.
 * @param {Array<string>} tiposAtacante Tipos do atacante.
 * @param {Array<string>} tiposDefensor Tipos do defensor.
 * @returns {number} Multiplicador de dano.
 */
export function multDanoSazonal(tipoDia, tiposAtacante, tiposDefensor) {
    if (!tipoDia) return 1;
    const alvo = String(tipoDia).toUpperCase();
    const temTipo = (lista) => Array.isArray(lista) && lista.some((t) => String(t || '').toUpperCase() === alvo);
    const ataca = temTipo(tiposAtacante) ? 2 : 1;
    const apanha = temTipo(tiposDefensor) ? 4 : 1;
    return ataca / apanha;
}

/**
 * Calcula a janela atual do dia sazonal (vira as 18h BRT = 21:00 UTC).
 * @param {number} [nowMs=Date.now()] Timestamp em ms.
 * @returns {{ key: string, startsAt: number, endsAt: number }} Janela sazonal.
 */
export function getSeasonalTypeWindow(nowMs = Date.now()) {
    const t = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    const key = new Date(t - DESLOCAMENTO_SAZONAL_MS).toISOString().slice(0, 10);
    const startsAt = Math.floor((t - DESLOCAMENTO_SAZONAL_MS) / DIA_MS) * DIA_MS + DESLOCAMENTO_SAZONAL_MS;
    const endsAt = startsAt + DIA_MS;
    return { key, startsAt, endsAt };
}

/**
 * Degrau (0..32) do fragmento de Ovo Shiny para o nivel da hunt.
 * @param {number} nivel Nivel da hunt.
 * @returns {number} Degrau atual.
 */
export function degrauFragmentoOvoShiny(nivel) {
    const n = Number(nivel);
    if (!Number.isFinite(n) || n < NIVEL_MIN_OVO_SHINY) return 0;
    let degrau = 0;
    for (const marco of DEGRAUS_FRAGMENTO_OVO_SHINY) {
        if (marco > n) break;
        degrau++;
    }
    return degrau;
}

/**
 * Chance de cair fragmento de Ovo Shiny por abate na hunt (0 na Outland).
 * @param {object|null} hunt Objeto da hunt.
 * @returns {number} Probabilidade por abate.
 */
export function chanceFragmentoOvoShiny(hunt) {
    if (!hunt || hunt.area === 'outland') return 0;
    const degrau = degrauFragmentoOvoShiny(hunt.nivel ?? hunt.level);
    return degrau > 0 ? CHANCE_OVO_BASE + (degrau - 1) * CHANCE_OVO_PASSO : 0;
}

/**
 * Informa o proximo degrau de fragmento de Ovo Shiny acima do nivel informado.
 * @param {number} nivel Nivel atual da hunt.
 * @returns {{ nextLevel: number, nextStep: number, nextChance: number, deltaLevel: number }|null} Proximo degrau ou null.
 */
export function proximoDegrauOvoShiny(nivel) {
    const n = Number(nivel);
    const atual = Number.isFinite(n) ? n : 0;
    const idx = DEGRAUS_FRAGMENTO_OVO_SHINY.findIndex((marco) => marco > atual);
    if (idx < 0) return null;
    const nextLevel = DEGRAUS_FRAGMENTO_OVO_SHINY[idx];
    const nextStep = idx + 1;
    const nextChance = CHANCE_OVO_BASE + (nextStep - 1) * CHANCE_OVO_PASSO;
    return {
        nextLevel,
        nextStep,
        nextChance,
        deltaLevel: Math.max(0, nextLevel - atual),
    };
}

/**
 * Busca os metadados de um tier da Outland (101..140).
 * @param {number} tier Codigo do tier.
 * @returns {{ tier: number, numero: number, rotulo: string, nivel: number, mult: number }|null} Dados do tier ou null.
 */
export function outlandTier(tier) {
    const t = Number(tier);
    return OUTLAND_TIERS.find((item) => item.tier === t) ?? null;
}

/**
 * Verifica se um treinador/pokemon atende ao nivel minimo do tier da Outland.
 * @param {number} tier Codigo do tier (101..140).
 * @param {number} level Nivel avaliado.
 * @returns {boolean} Verdadeiro se valido.
 */
export function tierOutlandValido(tier, level) {
    const info = outlandTier(tier);
    if (!info) return false;
    return (Number(level) || 0) >= info.nivel;
}

/**
 * Potencial maximo de reducao de cooldown (%) dado o baseSpeed da especie.
 * Joelho em 120 = 6%, teto em 160 = 7%.
 * @param {number} speedBase Speed base da especie.
 * @returns {number} Percentual maximo de desconto.
 */
export function potencialDoSpeed(speedBase) {
    const s = Math.max(0, Number(speedBase) || 0);
    const pct = s <= SPEED_JOELHO ? s / 20 : 6 + (s - SPEED_JOELHO) / 40;
    return Math.min(SPEED_POTENCIAL_TETO_PCT, pct);
}

/**
 * Desconto real (%) no cooldown considerando o IV de Speed (1..32).
 * @param {number} speedBase Speed base da especie.
 * @param {number} ivSpeed IV de Speed do Pokemon.
 * @returns {number} Desconto percentual aplicado.
 */
export function descontoDoSpeedPct(speedBase, ivSpeed) {
    const iv = Math.min(32, Math.max(1, Math.round(Number(ivSpeed) || 1)));
    return potencialDoSpeed(speedBase) * (iv / 32);
}

/**
 * Aplica o desconto de Speed ao cooldown base de um golpe em ms.
 * @param {number} cdMs Cooldown base em ms.
 * @param {number} speedBase Speed base da especie.
 * @param {number} ivSpeed IV de Speed do Pokemon.
 * @returns {number} Cooldown final em ms.
 */
export function cooldownGolpeComSpeed(cdMs, speedBase, ivSpeed) {
    const base = Math.max(0, Number(cdMs) || 0);
    if (base <= 0) return base;
    return Math.round(base * (1 - descontoDoSpeedPct(speedBase, ivSpeed) / 100));
}

function resolveBikeSpeed(bikeRarity) {
    if (typeof bikeRarity === 'number') return Math.max(0, bikeRarity);
    if (!bikeRarity) return 0;
    const raw = String(bikeRarity).trim().toLowerCase();
    const key = RARIDADE_ALIAS[raw] || raw;
    return Number(BICICLETA_VELOCIDADE[key]) || 0;
}

/**
 * Estima os abates por hora de uma hunt considerando bicicleta e spawns extras de Prey.
 * @param {object} hunt Dados da hunt.
 * @param {object} [opts]
 * @param {number} [opts.bikeSpeed=0] Bonus de velocidade da bicicleta (fracao ou percentual).
 * @param {number} [opts.preySpawnExtra=0] Mobs extras por onda vindos do Prey.
 * @returns {number} Kills por hora estimados.
 */
export function killsPorHora(hunt, { bikeSpeed = 0, preySpawnExtra = 0 } = {}) {
    const pontos = (hunt?.especies ?? []).reduce((s, e) => s + (Number(e?.pontos) || 0), 0) || 1;
    const extra = Math.max(0, Number(preySpawnExtra) || 0);
    const porOnda = Math.min(MAX_MOBS, pontos) + extra;
    const speedRaw = Math.max(0, Number(bikeSpeed) || 0);
    const speedFrac = speedRaw > 3 ? speedRaw / 100 : speedRaw;
    const deslocMs = MS_DESLOC_MS / (1 + speedFrac);
    const msPorKill = CD_GOLPE_MS + deslocMs + CD_MOVIMENTO_MEDIO_MS;
    const segPorOnda = (porOnda * msPorKill + MS_ONDA) / 1000;
    return (porOnda / segPorOnda) * 3600;
}

function getSpecies(speciesById, pokeId) {
    if (!speciesById || pokeId == null) return null;
    const id = Number(pokeId);
    const raw = speciesById instanceof Map ? speciesById.get(id) : (speciesById[id] ?? speciesById[String(id)]);
    if (!raw) return null;
    const tiposAdj = AJUSTE_TIPOS[id];
    const levelAdj = AJUSTE_HUNT_LEVEL[id];
    if (!tiposAdj && levelAdj == null) return raw;
    return {
        ...raw,
        ...(tiposAdj ? { type1: tiposAdj[0], type2: tiposAdj[1] ?? null } : {}),
        ...(levelAdj != null ? { huntLevel: levelAdj } : {}),
    };
}

function getSpeciesTypes(esp, pkFallback) {
    const raw = pkFallback?.tipos?.length ? pkFallback.tipos : [esp?.type1, esp?.type2];
    return [...new Set(raw.filter(Boolean).map((t) => String(t).toUpperCase()))];
}

function effectiveness(atk, def1, def2, typeChart) {
    if (!typeChart || !atk || !def1) return 1;
    const a = String(atk).toUpperCase();
    const row = typeChart[a] ?? typeChart[atk] ?? {};
    const step = (def) => {
        if (!def) return 1;
        const d = String(def).toUpperCase();
        if (d === a) return DIAGONAL_DE_TIPOS[a] ?? 1;
        return row[d] ?? row[def] ?? 1;
    };
    let mult = step(def1);
    if (def2 && String(def2).toUpperCase() !== String(def1).toUpperCase()) {
        mult *= step(def2);
    }
    return mult;
}

function amplifyHunt(v, factor = 1.5) {
    if (v === 0 || v === 1) return v;
    return v > 1 ? 1 + (v - 1) * factor : v / factor;
}

function defensiveMatchup(types, typeChart) {
    const weakTypes = [];
    const resistTypes = [];
    if (!types?.length || !typeChart) return { weakTypes, resistTypes };
    const [d1, d2] = types;
    for (const atk of TIPOS_ELEMENTAIS) {
        const mult = effectiveness(atk, d1, d2 ?? null, typeChart);
        if (mult >= 2) weakTypes.push({ tipo: atk, mult });
        else if (mult <= 0.5) resistTypes.push({ tipo: atk, mult });
    }
    return { weakTypes, resistTypes };
}

function buildPreEvolutionSet(speciesById) {
    const hasParent = new Set();
    const parentOf = new Map();
    if (!speciesById) return { hasParent, parentOf };
    const values = speciesById instanceof Map ? speciesById.values() : Object.values(speciesById);
    for (const esp of values) {
        const to = Number(esp?.evolvesToId);
        const from = Number(esp?.pokeId);
        if (to > 0 && from > 0 && to !== from) {
            hasParent.add(to);
            if (!parentOf.has(to)) parentOf.set(to, from);
        }
    }
    return { hasParent, parentOf };
}

function speciesStoneChance(esp, hunt, parentOf) {
    if (!esp) return 0.5;
    const pid = Number(esp.pokeId);
    if (hunt?.area === 'outland' || (pid >= 2001 && pid < 2059)) return 0.5;
    const hasEvo = Number(esp.evolvesToId) > 0;
    const hasPre = parentOf.has(pid);
    if (!hasEvo && !hasPre) return 0.5;
    let stage = 0;
    let cur = parentOf.get(pid);
    const seen = new Set([pid]);
    while (cur != null && !seen.has(cur) && stage < 2) {
        seen.add(cur);
        stage++;
        cur = parentOf.get(cur);
    }
    return CHANCE_PEDRA_POR_ESTAGIO[Math.min(2, stage)];
}

function computeXpAndLootMultipliers(trainer, nowMs) {
    if (!trainer) return { multPk: 1, multTr: 1, bonusLootPct: 0, multShiny: 1 };
    const b = trainer.bonusXp;
    let multPk = 1;
    let multTr = 1;

    if (b && Array.isArray(b.partes)) {
        const active = b.partes.filter((x) => !(Number(x?.ate) > 0) || Number(x.ate) > nowMs);
        const basePk = active.reduce((acc, x) => acc * (Number(x?.pk) || 1), 1);
        const baseTr = active.reduce((acc, x) => acc * (Number(x?.tr) || 1), 1);
        const allPk = b.partes.reduce((acc, x) => acc * (Number(x?.pk) || 1), 1);
        const allTr = b.partes.reduce((acc, x) => acc * (Number(x?.tr) || 1), 1);
        const extraPk = Number(b.pk) > 0 ? Number(b.pk) / allPk : 1;
        const extraTr = Number(b.tr) > 0 ? Number(b.tr) / allTr : 1;
        multPk = basePk * (Math.abs(extraPk - 1) < 1e-4 ? 1 : extraPk);
        multTr = baseTr * (Math.abs(extraTr - 1) < 1e-4 ? 1 : extraTr);
    } else if (b && (Number(b.pk) > 0 || Number(b.tr) > 0)) {
        multPk = Number(b.pk) || 1;
        multTr = Number(b.tr) || 1;
    } else {
        const loja = trainer.loja ?? {};
        const vipOn = loja.vip === true || (Number(loja.vipAte) || 0) > nowMs;
        const vipMult = vipOn ? VIP_MULT_XP : 1;
        const boostMult = (key, fallback = 2) => {
            const ate = Number(loja.boosts?.[key]) || 0;
            if (ate <= nowMs) return 1;
            const found = (trainer.tiposBoost ?? []).find((x) => x.chave === key);
            return Number(found?.mult) || fallback;
        };
        const guildRank = 1 + (Number(trainer.guildBonusPct) || 0) / 100;
        const guildBoost = (Number(trainer.guild?.boostAte) || 0) > nowMs ? 1.1 : 1;
        let liveMult = 1;
        for (const k of ['twitch', 'kick']) {
            const live = trainer[k];
            if ((Number(live?.bonus?.xp) || 0) > nowMs && Number(live?.pct) > 0) {
                liveMult *= 1 + Number(live.pct) / 100;
            }
        }
        let eventPk = 1;
        let eventTr = 1;
        const ev = trainer.evento;
        if (ev && (Number(ev.terminaEm) || 0) > nowMs) {
            if (Number(ev.xpPokemonPct) > 0) eventPk = 1 + Number(ev.xpPokemonPct) / 100;
            if (Number(ev.xpTreinadorPct) > 0) eventTr = 1 + Number(ev.xpTreinadorPct) / 100;
        }
        const atrasados = loja.atrasados && Number(loja.atrasados.mult) > 1 && (Number(trainer.level) || 0) < (Number(loja.atrasados.alvo) || 0)
            ? Number(loja.atrasados.mult)
            : 1;
        const sacMult = (Number(trainer.sacrificio?.boostAte) || 0) > nowMs ? (Number(trainer.sacrificio.mult) || 1.2) : 1;

        multTr = vipMult * boostMult('xp') * guildRank * guildBoost * liveMult * eventTr * atrasados * sacMult;
        multPk = vipMult * boostMult('pokexp') * guildRank * guildBoost * liveMult * eventPk * atrasados * sacMult;
    }

    const loja = trainer.loja ?? {};
    const lootAte = Number(loja.boosts?.loot) || 0;
    const lootBoostMult = lootAte > nowMs
        ? (Number((trainer.tiposBoost ?? []).find((x) => x.chave === 'loot')?.mult) || 2)
        : 1;
    const bonusLootPct = (lootBoostMult - 1) * 100
        + (Number(trainer.guildBonusPct) || 0)
        + ((Number(trainer.evento?.terminaEm) || 0) > nowMs ? (Number(trainer.evento?.lootPct) || 0) : 0);

    const shinyAte = Number(loja.boosts?.shiny) || 0;
    const multShiny = shinyAte > nowMs
        ? (Number((trainer.tiposBoost ?? []).find((x) => x.chave === 'shiny')?.mult) || 2)
        : 1;

    return { multPk, multTr, bonusLootPct, multShiny };
}

function estimateUnsafe(huntLevel, especiesHunt, activePokemon, typeChart, tipoDia) {
    if (!activePokemon?.stats || !especiesHunt.length) return false;
    const hpPk = Number(activePokemon.maxHp) || Math.max(24, Math.round((Number(activePokemon.stats.hp) || 0) * 12));
    if (!(hpPk > 0)) return false;

    const pkTipos = activePokemon.tipos?.length ? activePokemon.tipos : [];
    const defStat = Math.max(1, Number(activePokemon.stats.def) || 1);
    const spDefStat = Math.max(1, Number(activePokemon.stats.spDef) || 1);

    let worstHit = 0;
    for (const { esp } of especiesHunt) {
        if (!esp) continue;
        const espTipos = getSpeciesTypes(esp);
        const multSaz = multDanoSazonal(tipoDia, espTipos, pkTipos);
        const multDano = 1.8 * multSaz;
        const wildAtk = (((Number(esp.baseAtk) || 50) + 32) * huntLevel) / 100;
        const wildSpAtk = (((Number(esp.baseSpAtk) || 50) + 32) * huntLevel) / 100;
        const moves = (esp.attacks ?? []).filter((a) => (a.learnLevel ?? 1) <= huntLevel);
        for (const m of moves) {
            const special = m.category === 'SPECIAL';
            const power = Math.max(15, Number(m.power) || 15);
            const stab = espTipos.includes(String(m.type || '').toUpperCase()) ? 1.5 : 1;
            const ef = amplifyHunt(effectiveness(m.type, pkTipos[0], pkTipos[1], typeChart), 1.5);
            const raw = ((2 * huntLevel / 5 + 2) * power * (special ? wildSpAtk : wildAtk) / (special ? spDefStat : defStat)) / 50 + 2;
            const hit = raw * stab * ef * multDano;
            if (hit > worstHit) worstHit = hit;
        }
        const invEf = amplifyHunt(effectiveness(espTipos[0] || 'NORMAL', pkTipos[0], pkTipos[1], typeChart), 1.5);
        const invRaw = ((2 * huntLevel / 5 + 2) * 30 * wildAtk / defStat) / 50 + 2;
        const invHit = invRaw * 1.5 * invEf * multDano;
        if (invHit > worstHit) worstHit = invHit;
    }
    return worstHit >= hpPk;
}

function resolveCaptureChance(esp, hunt) {
    if (!esp || esp.catchRate == null) return 0.02;
    const catchRate = Number(esp.catchRate) || 0;
    if (catchRate >= 255) return 1;
    const isOutland = hunt?.area === 'outland';
    const fator = isOutland ? FATOR_CAPTURA_DO_DEGRAU[100] : FATOR_CAPTURA_DO_DEGRAU[40];
    const chance = 0.0075 * ((catchRate * 2) / fator) * 1.4;
    return Math.max(0.003, Math.min(0.1, chance));
}

/**
 * Analisa uma lista de hunts nativas e gera rankings por XP, ouro e shiny.
 * @param {object} params Parametros de analise.
 * @returns {{ ranked: Array<object>, byMetric: { xp: Array<object>, ouro: Array<object>, shiny: Array<object> } }} Resultado ordenado.
 */
export function analyzeNativeHunts({
    hunts = [],
    activePokemon = null,
    trainer = null,
    speciesById = null,
    typeChart = null,
    diaSazonal = null,
    bikeRarity = null,
    preySpawnExtra = 0,
    nowMs = Date.now(),
} = {}) {
    const huntList = Array.isArray(hunts) ? hunts : Object.values(hunts || {});
    const activeSpecies = getSpecies(speciesById, activePokemon?.speciesId);
    const pkTipos = getSpeciesTypes(activeSpecies, activePokemon);
    const tipoDia = typeof diaSazonal === 'string' ? diaSazonal : (diaSazonal?.tipo ?? null);
    const bikeSpeed = resolveBikeSpeed(bikeRarity);
    const { multPk, multTr, bonusLootPct, multShiny } = computeXpAndLootMultipliers(trainer, nowMs);
    const { weakTypes, resistTypes } = defensiveMatchup(pkTipos, typeChart);
    const { parentOf } = buildPreEvolutionSet(speciesById);

    const items = [];
    for (const h of huntList) {
        if (!h || !h.slug) continue;
        const level = Math.max(1, Number(h.nivel ?? h.level) || 1);
        const especiesHunt = (h.especies ?? []).map((e) => ({
            pokeId: Number(e.pokeId),
            pontos: Number(e.pontos) || 0,
            esp: getSpecies(speciesById, e.pokeId),
        })).filter((e) => e.pontos > 0);
        const totalPontos = especiesHunt.reduce((s, e) => s + e.pontos, 0) || 1;

        const extraForHunt = typeof preySpawnExtra === 'object' && preySpawnExtra !== null
            ? especiesHunt.reduce((acc, e) => acc + (Number(preySpawnExtra[e.pokeId]) || 0), 0)
            : (Number(preySpawnExtra) || 0);

        const killsH = killsPorHora(h, { bikeSpeed, preySpawnExtra: extraForHunt });

        let xpKill = 0;
        let ouroKill = 0;
        let seasonalMult = 0;
        let stoneChance = 0;
        let capChance = 0;

        if (especiesHunt.length > 0) {
            for (const entry of especiesHunt) {
                const w = entry.pontos / totalPontos;
                const mobLevel = entry.esp?.huntLevel ?? level;
                xpKill += w * xpDoNivel(level);
                ouroKill += w * ouroDoAbate(level, bonusLootPct).total;
                const espTipos = getSpeciesTypes(entry.esp);
                seasonalMult += w * multDanoSazonal(tipoDia, pkTipos, espTipos);
                stoneChance += w * speciesStoneChance(entry.esp ?? { pokeId: entry.pokeId }, h, parentOf);
                capChance += w * resolveCaptureChance(entry.esp, h);
                void mobLevel;
            }
        } else {
            xpKill = xpDoNivel(level);
            ouroKill = ouroDoAbate(level, bonusLootPct).total;
            seasonalMult = multDanoSazonal(tipoDia, pkTipos, []);
            stoneChance = 0.5;
            capChance = 0.02;
        }

        const xpPokemonH = killsH * xpKill * multPk;
        const xpTreinadorH = killsH * xpKill * multTr;
        const ouroH = killsH * ouroKill;
        const shinyH = killsH * capChance * (1 / 24_000) * multShiny;

        const isOutland = h.area === 'outland';
        const eggStep = isOutland ? 0 : degrauFragmentoOvoShiny(level);
        const eggChance = chanceFragmentoOvoShiny(h);
        const nextEggStep = isOutland ? null : proximoDegrauOvoShiny(level);
        const unsafe = estimateUnsafe(level, especiesHunt, activePokemon, typeChart, tipoDia);

        items.push({
            slug: String(h.slug),
            name: String(h.nome ?? h.name ?? h.slug),
            level,
            xpPokemonH,
            xpTreinadorH,
            ouroH,
            shinyH,
            killsH,
            unsafe,
            eggStep,
            eggChance,
            nextEggStep,
            seasonalMult,
            weakTypes,
            resistTypes,
            stoneChance,
        });
    }

    const sortBy = (key) => [...items].sort((a, b) => (b[key] - a[key]) || (b.xpPokemonH - a.xpPokemonH) || (a.level - b.level));
    const byXp = sortBy('xpPokemonH');
    const byOuro = sortBy('ouroH');
    const byShiny = sortBy('shinyH');

    return {
        ranked: byXp,
        byMetric: {
            xp: byXp,
            ouro: byOuro,
            shiny: byShiny,
        },
    };
}
