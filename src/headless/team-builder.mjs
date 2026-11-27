// Construtor puro de time PvP recomendado para pokeidle.io v1.492.0.
// Seleciona ate 5 slots balanceando tipos, passivas (BST <= 500), stats base e exemplares da conta.

import { notaOf, buildSpeciesIndex } from './economy-advisor.mjs';
import { EVOLUCOES_RAMIFICADAS } from './evolution-plan.mjs';
import {
    BST_MAX_PASSIVA,
    PASSIVAS_DESDE_MS,
    effectiveArenaLevel,
    passivaParaEspecie,
} from './pvp-meta.mjs';

export const PVP_TEAM_SIZE = 5;
export const PVP_CUTOFF = Object.freeze({
    quality: 1.3,
    potencia: 4,
    nota: 4.0,
});

// Casas validas do tabuleiro de PvP (shared/pvp-tabuleiro.mjs: 0..29).
// Fileira 0 (frente): casas 0..5, priorizando o miolo.
// Fileira 2/3 (fundo): casas 14..25, priorizando miolo 14..18.
const FRONTLINE_TILES = Object.freeze([2, 3, 1, 4, 0, 5]);
const BACKLINE_TILES = Object.freeze([17, 18, 16, 15, 14, 19, 20, 21, 23, 24, 22, 25]);

const DEFENSIVE_PASSIVE_IDS = new Set([
    'iron_defense',
    'rocky_helmet',
    'recover',
    'blindagem',
    'rocha_solida',
    'casco_telurico',
    'mare_constante',
    'adaptavel',
]);

function normalizeSpeciesMap(speciesById) {
    const list = [];
    if (speciesById instanceof Map) {
        for (const [k, v] of speciesById.entries()) {
            if (v) list.push({ ...v, pokeId: Number(v.pokeId ?? k) });
        }
    } else if (speciesById && typeof speciesById === 'object') {
        for (const [k, v] of Object.entries(speciesById)) {
            if (v) list.push({ ...v, pokeId: Number(v.pokeId ?? k) });
        }
    }
    return buildSpeciesIndex(list);
}

function buildChainGraph(byId) {
    const neighbors = new Map();
    const link = (a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (!(na > 0) || !(nb > 0) || na === nb) return;
        if (!neighbors.has(na)) neighbors.set(na, new Set());
        if (!neighbors.has(nb)) neighbors.set(nb, new Set());
        neighbors.get(na).add(nb);
        neighbors.get(nb).add(na);
    };

    for (const esp of byId.values()) {
        if (esp.evolvesToId) link(esp.pokeId, esp.evolvesToId);
        for (const branch of EVOLUCOES_RAMIFICADAS[esp.pokeId] || []) {
            if (branch?.para) link(esp.pokeId, branch.para);
        }
    }

    const chainIdOf = new Map();
    const chainMembers = new Map();

    const resolveChain = (startId) => {
        const id = Number(startId);
        if (!(id > 0)) return 0;
        if (chainIdOf.has(id)) return chainIdOf.get(id);
        const visited = new Set([id]);
        const queue = [id];
        while (queue.length > 0) {
            const cur = queue.shift();
            for (const nxt of neighbors.get(cur) || []) {
                if (!visited.has(nxt)) {
                    visited.add(nxt);
                    queue.push(nxt);
                }
            }
        }
        const root = Math.min(...visited);
        chainMembers.set(root, visited);
        for (const memberId of visited) {
            chainIdOf.set(memberId, root);
        }
        return root;
    };

    for (const id of byId.keys()) resolveChain(id);
    return {
        chainOf: (id) => resolveChain(id),
        membersOf: (id) => chainMembers.get(resolveChain(id)) || new Set([Number(id)]),
    };
}

function speciesTypes(esp, pkFallback = null) {
    const raw = [];
    if (esp?.type1) raw.push(esp.type1);
    if (esp?.type2) raw.push(esp.type2);
    if (Array.isArray(esp?.tipos)) raw.push(...esp.tipos);
    if (Array.isArray(pkFallback?.tipos)) raw.push(...pkFallback.tipos);
    return [...new Set(raw.filter(Boolean).map((t) => String(t).toUpperCase()))];
}

function speciesBst(esp) {
    if (!esp) return 0;
    const explicit = Number(esp.bst);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    return (Number(esp.baseHp) || 0)
        + (Number(esp.baseAtk) || 0)
        + (Number(esp.baseDef) || 0)
        + (Number(esp.baseSpAtk) || 0)
        + (Number(esp.baseSpDef) || 0)
        + (Number(esp.baseSpeed) || 0);
}

function ivTotalOf(pk) {
    if (pk?.iv != null && Number.isFinite(Number(pk.iv))) return Number(pk.iv);
    if (pk?.ivTotal != null && Number.isFinite(Number(pk.ivTotal))) return Number(pk.ivTotal);
    if (pk?.ivs && typeof pk.ivs === 'object') {
        return Object.values(pk.ivs).reduce((s, v) => s + (Number(v) || 0), 0);
    }
    return null;
}

function isAboveCutoff(pk, nota) {
    if (!pk) return false;
    const q = Number(pk.quality ?? pk.qualidade) || 1;
    const pot = Number(pk.potencia) || 1;
    return Boolean(pk.shiny)
        || q >= PVP_CUTOFF.quality - 1e-9
        || pot >= PVP_CUTOFF.potencia
        || (nota != null && nota >= PVP_CUTOFF.nota - 1e-9);
}

function computeOwnedScore(pk, esp, ancestors) {
    if (!pk) return 0;
    const nota = notaOf(pk, esp, ancestors);
    const pot = Math.max(1, Math.min(5, Math.round(Number(pk.potencia) || 1)));
    const potBonus = [0, 8, 18, 35, 65][pot - 1] ?? 0;
    const q = Number(pk.quality ?? pk.qualidade) || 1;
    const qBonus = q >= PVP_CUTOFF.quality ? 25 + (q - PVP_CUTOFF.quality) * 30 : (q - 1) * 20;
    const ivTotal = ivTotalOf(pk);
    const ivBonus = ivTotal != null ? (Math.min(192, Math.max(0, ivTotal)) / 192) * 25 : 0;
    const spdIvBonus = pk.ivs?.speed != null ? (Math.min(32, Math.max(0, Number(pk.ivs.speed))) / 32) * 8 : 0;
    const shinyBonus = pk.shiny ? 30 : 0;
    const notaBonus = nota != null ? nota * 4 : 0;
    const arenaLv = effectiveArenaLevel(pk.level ?? pk.nivel, 'ginasio');
    const lvBonus = Math.min(15, (arenaLv / 150) * 10);
    return potBonus + qBonus + ivBonus + spdIvBonus + shinyBonus + notaBonus + lvBonus;
}

function speedCdrBonus(esp) {
    const spd = Math.max(0, Number(esp?.baseSpeed) || 0);
    const pct = Math.min(7, spd <= 120 ? spd / 20 : 6 + (spd - 120) / 40);
    return pct * 4;
}

function computeSpeciesScore(esp, passive, nowMs) {
    const bst = speciesBst(esp);
    const baseStatScore = bst > 0 ? bst / 6 : 50;
    const cdr = speedCdrBonus(esp);
    const passiveActive = nowMs >= PASSIVAS_DESDE_MS;
    const passiveBonus = passive ? (passiveActive ? 24 : 20) : 0;
    return baseStatScore + cdr + passiveBonus;
}

function synthesizeFallbackSpecies(speciesId, name, tipos = []) {
    return {
        pokeId: Number(speciesId),
        name: name || `#${speciesId}`,
        type1: tipos[0] || 'NORMAL',
        type2: tipos[1] || null,
        baseHp: 60,
        baseAtk: 60,
        baseDef: 60,
        baseSpAtk: 60,
        baseSpDef: 60,
        baseSpeed: 60,
    };
}

function isDefensivePassive(passive) {
    if (!passive) return false;
    const id = String(passive.id || '').toLowerCase();
    if (DEFENSIVE_PASSIVE_IDS.has(id)) return true;
    return Boolean(
        (Number(passive.reducaoDanoPct) || 0) > 0
        || (Number(passive.bonusDefPct) || 0) > 0
        || (Number(passive.regenHpPct) || 0) > 0
        || (Number(passive.reducaoSuperEfetivoPct) || 0) > 0
    );
}

function tankScoreOf(slot, byId) {
    const esp = byId.get(slot.speciesId);
    const owned = slot.ownedRaw;
    const st = owned?.stats;
    const hp = Number(st?.hp) || (Number(esp?.baseHp) || 60) * 2;
    const def = Number(st?.def) || Number(esp?.baseDef) || 60;
    const spDef = Number(st?.spDef) || Number(esp?.baseSpDef) || 60;
    const atk = Number(st?.atk) || Number(esp?.baseAtk) || 60;
    const spAtk = Number(st?.spAtk) || Number(esp?.baseSpAtk) || 60;
    const spd = Number(st?.speed) || Number(esp?.baseSpeed) || 60;

    const bulk = hp + def + spDef;
    const offense = Math.max(atk, spAtk) + spd * 0.5;
    const passivePts = isDefensivePassive(slot.passive) ? 200 : 0;
    return passivePts + (bulk - offense * 0.4);
}

function buildSuggestedFormation(selectedSlots, byId) {
    const withOwned = selectedSlots.filter((s) => s.ownedRaw?.id != null);
    if (withOwned.length === 0) {
        return { pokemonIds: [], casas: {} };
    }

    const seenIds = new Set();
    const members = [];
    for (const s of withOwned) {
        const idKey = String(s.ownedRaw.id);
        if (seenIds.has(idKey)) continue;
        seenIds.add(idKey);
        members.push({ slot: s, tankScore: tankScoreOf(s, byId) });
        if (members.length >= PVP_TEAM_SIZE) break;
    }

    members.sort((a, b) => b.tankScore - a.tankScore);
    const frontCount = members.length >= 4 ? 2 : 1;
    const frontline = members.slice(0, frontCount);
    const backline = members.slice(frontCount);

    const pokemonIds = [];
    const casas = {};
    frontline.forEach((m, idx) => {
        const pid = m.slot.ownedRaw.id;
        pokemonIds.push(pid);
        casas[String(pid)] = FRONTLINE_TILES[idx];
    });
    backline.forEach((m, idx) => {
        const pid = m.slot.ownedRaw.id;
        pokemonIds.push(pid);
        casas[String(pid)] = BACKLINE_TILES[idx];
    });

    return { pokemonIds, casas };
}

function buildSlotReason({ ready, esp, passive, bestOwned, huntInfo }) {
    const parts = [];
    const bst = speciesBst(esp);
    if (passive && bst > 0 && bst <= BST_MAX_PASSIVA) {
        parts.push(`Passiva ${passive.nome} (BST ${bst})`);
    } else if (bst > 0) {
        parts.push(`BST ${bst}`);
    }
    if (ready && bestOwned) {
        const tags = [];
        if (bestOwned.shiny) tags.push('Shiny');
        if (bestOwned.potencia >= 4) tags.push(`P${bestOwned.potencia}`);
        if (bestOwned.quality >= PVP_CUTOFF.quality) tags.push(`Q ${bestOwned.quality.toFixed(2)}`);
        if (bestOwned.nota != null) tags.push(`Nota ${bestOwned.nota.toFixed(1)}`);
        parts.push(`Pronto na conta (${tags.join(', ') || `Nv ${bestOwned.level}`})`);
    } else if (huntInfo) {
        parts.push(`Cacar em ${huntInfo.huntName} (Nv ${huntInfo.huntLevel})`);
    } else {
        parts.push('Sem exemplar forte ou hunt liberada para o alvo');
    }
    return parts.join(': ');
}

/**
 * Monta uma recomendacao de time PvP completo (ate 5 slots) usando as mecanicas
 * oficiais de pokeidle.io (passivas BST <= 500, diversidade de tipos, nivel de arena
 * e formacao tatica no tabuleiro 0..29).
 * @param {object} [params]
 * @param {Array<object>} [params.pokemons=[]] Todos os Pokemons da conta (equipe, depot, colecao).
 * @param {Array<object>|object} [params.hunts=[]] Lista ou mapa de hunts do servidor.
 * @param {Map|object|null} [params.speciesById=null] Catalogo de especies por pokeId.
 * @param {number} [params.trainerLevel=0] Nivel atual do treinador para filtrar hunts liberadas.
 * @param {number} [params.nowMs=Date.now()] Timestamp atual em ms.
 * @returns {object} Plano completo com slots, hunts pendentes, formacao e resumo pt-BR.
 */
export function buildRecommendedPvpTeam({
    pokemons = [],
    hunts = [],
    speciesById = null,
    trainerLevel = 0,
    nowMs = Date.now(),
} = {}) {
    const speciesIdx = normalizeSpeciesMap(speciesById);
    const byId = speciesIdx.byId;
    const { chainOf, membersOf } = buildChainGraph(byId);

    const huntList = Array.isArray(hunts) ? hunts : Object.values(hunts || {});
    const lvTreinador = Math.max(0, Number(trainerLevel) || 0);
    const unlockedHunts = huntList.filter((h) => {
        if (!h || !h.slug) return false;
        const lv = Math.max(1, Number(h.nivel ?? h.level) || 1);
        return lv <= lvTreinador;
    });

    // Mapa speciesId -> melhor hunt liberada (menor nivel / maior peso de spawn)
    const huntBySpecies = new Map();
    const huntSpeciesNames = new Map();
    for (const h of unlockedHunts) {
        const huntLevel = Math.max(1, Number(h.nivel ?? h.level) || 1);
        const huntName = String(h.nome ?? h.name ?? h.slug);
        for (const e of h.especies || []) {
            const pid = Number(e?.pokeId);
            if (!(pid > 0)) continue;
            if (e.nome || e.name) huntSpeciesNames.set(pid, String(e.nome ?? e.name));
            const prev = huntBySpecies.get(pid);
            const pontos = Number(e.pontos) || 1;
            if (!prev || huntLevel < prev.huntLevel || (huntLevel === prev.huntLevel && pontos > prev.pontos)) {
                huntBySpecies.set(pid, {
                    huntSlug: String(h.slug),
                    huntName,
                    huntLevel,
                    targetSpeciesId: pid,
                    targetSpeciesName: String(e.nome ?? e.name ?? byId.get(pid)?.name ?? `#${pid}`),
                    pontos,
                });
            }
        }
    }

    // Agrupa os Pokemons da conta por cadeia evolutiva e registra o melhor exemplar de cada cadeia.
    const bestOwnedByChain = new Map();
    const ownedSpeciesIds = new Set();
    for (const pk of pokemons || []) {
        if (!pk || pk.id == null) continue;
        const spId = Number(pk.speciesId);
        if (!(spId > 0)) continue;
        ownedSpeciesIds.add(spId);
        const esp = byId.get(spId) || synthesizeFallbackSpecies(spId, pk.nome || pk.name, pk.tipos);
        if (!byId.has(spId)) byId.set(spId, esp);
        const ancestors = speciesIdx.ancestorsOf(spId);
        const nota = notaOf(pk, esp, ancestors);
        const ready = isAboveCutoff(pk, nota);
        const score = computeOwnedScore(pk, esp, ancestors) + (ready ? 40 : 0);
        const chainId = chainOf(spId);
        const prev = bestOwnedByChain.get(chainId);
        if (!prev || score > prev.score) {
            bestOwnedByChain.set(chainId, {
                pk,
                esp,
                nota,
                ready,
                score,
                summary: {
                    id: pk.id,
                    speciesId: spId,
                    name: String(pk.apelido || pk.nome || pk.name || esp.name || `#${pk.id}`),
                    level: Math.max(1, Number(pk.level ?? pk.nivel) || 1),
                    arenaLevel: effectiveArenaLevel(pk.level ?? pk.nivel, 'ginasio'),
                    quality: Number(pk.quality ?? pk.qualidade) || 1,
                    potencia: Number(pk.potencia) || 1,
                    shiny: Boolean(pk.shiny),
                    nota,
                },
            });
        }
    }

    const findBestHuntForChain = (speciesId) => {
        const members = membersOf(speciesId);
        let best = null;
        for (const mid of members) {
            const h = huntBySpecies.get(mid);
            if (h && (!best || h.huntLevel < best.huntLevel)) {
                best = h;
            }
        }
        return best;
    };

    // Monta candidatos por cadeia evolutiva (hunts liberadas + especies ja existentes na conta).
    const candidatesByChain = new Map();
    const considerSpecies = (spId) => {
        if (!(spId > 0)) return;
        const chainId = chainOf(spId);
        const esp = byId.get(spId) || synthesizeFallbackSpecies(spId, huntSpeciesNames.get(spId));
        const ownedEntry = bestOwnedByChain.get(chainId) || null;
        const huntInfo = findBestHuntForChain(spId);
        if (!ownedEntry && !huntInfo) return;

        // Se a cadeia ja tem um exemplar pronto, usa a especie do exemplar; senao, a especie avaliada.
        const repEsp = ownedEntry?.ready ? ownedEntry.esp : esp;
        const types = speciesTypes(repEsp, ownedEntry?.pk);
        const passive = passivaParaEspecie(repEsp);
        const speciesScore = computeSpeciesScore(repEsp, passive, nowMs);
        const ownedScore = ownedEntry ? ownedEntry.score : 0;
        const totalScore = speciesScore + ownedScore;

        const prev = candidatesByChain.get(chainId);
        if (!prev || totalScore > prev.totalScore) {
            candidatesByChain.set(chainId, {
                chainId,
                speciesId: repEsp.pokeId,
                name: String(repEsp.name ?? repEsp.nome ?? huntSpeciesNames.get(repEsp.pokeId) ?? `#${repEsp.pokeId}`),
                types,
                passive,
                bestOwned: ownedEntry?.summary ?? null,
                ownedRaw: ownedEntry?.pk ?? null,
                ready: Boolean(ownedEntry?.ready),
                huntInfo: ownedEntry?.ready ? null : huntInfo,
                totalScore,
                esp: repEsp,
            });
        }
    };

    for (const spId of huntBySpecies.keys()) considerSpecies(spId);
    for (const spId of ownedSpeciesIds) considerSpecies(spId);

    const pool = [...candidatesByChain.values()];
    const selected = [];
    const usedChains = new Set();
    const usedPrimaryTypes = new Set();
    const usedTypeCounts = new Map();

    while (selected.length < PVP_TEAM_SIZE && pool.length > 0) {
        let bestIdx = -1;
        let bestAdjusted = -Infinity;

        for (let i = 0; i < pool.length; i++) {
            const c = pool[i];
            if (usedChains.has(c.chainId)) continue;
            const primary = c.types[0] || 'NORMAL';
            let penalty = 0;
            if (usedPrimaryTypes.has(primary)) penalty += 70;
            for (const t of c.types) {
                penalty += (usedTypeCounts.get(t) || 0) * 12;
            }
            const adj = c.totalScore - penalty;
            if (adj > bestAdjusted) {
                bestAdjusted = adj;
                bestIdx = i;
            }
        }

        if (bestIdx < 0) break;
        const chosen = pool[bestIdx];
        usedChains.add(chosen.chainId);
        if (chosen.types[0]) usedPrimaryTypes.add(chosen.types[0]);
        for (const t of chosen.types) {
            usedTypeCounts.set(t, (usedTypeCounts.get(t) || 0) + 1);
        }
        selected.push(chosen);
    }

    const slots = selected.map((c, idx) => ({
        slot: idx + 1,
        speciesId: c.speciesId,
        name: c.name,
        types: c.types,
        passive: c.passive,
        bestOwned: c.bestOwned,
        ready: c.ready,
        huntSlug: c.ready ? null : (c.huntInfo?.huntSlug ?? null),
        huntName: c.ready ? null : (c.huntInfo?.huntName ?? null),
        huntLevel: c.ready ? null : (c.huntInfo?.huntLevel ?? null),
        targetSpeciesId: c.ready ? null : (c.huntInfo?.targetSpeciesId ?? null),
        targetSpeciesName: c.ready ? null : (c.huntInfo?.targetSpeciesName ?? null),
        reason: buildSlotReason({
            ready: c.ready,
            esp: c.esp,
            passive: c.passive,
            bestOwned: c.bestOwned,
            huntInfo: c.huntInfo,
        }),
        ownedRaw: c.ownedRaw,
    }));

    const readyCount = slots.filter((s) => s.ready).length;
    const pendingCount = PVP_TEAM_SIZE - readyCount;
    const firstPendingHunt = slots.find((s) => !s.ready && s.huntSlug);
    const nextTargetHuntSlug = firstPendingHunt?.huntSlug ?? null;
    const nextTargetHuntName = firstPendingHunt?.huntName ?? null;
    const targetSpeciesIds = [...new Set(
        slots.filter((s) => !s.ready && s.targetSpeciesId != null).map((s) => s.targetSpeciesId)
    )];

    const suggestedFormation = buildSuggestedFormation(slots, byId);

    const publicSlots = slots.map(({ ownedRaw: _ownedRaw, ...rest }) => rest);
    const summaryText = slots.length === 0
        ? 'Nenhum candidato disponivel para montar time PvP neste nivel.'
        : (pendingCount === 0
            ? `Time PvP completo (${readyCount}/${PVP_TEAM_SIZE} prontos): ${publicSlots.map((s) => s.name).join(', ')}.`
            : `Time PvP ${readyCount}/${PVP_TEAM_SIZE} pronto (${pendingCount} pendente${pendingCount > 1 ? 's' : ''})${nextTargetHuntName ? `. Proxima caca: ${nextTargetHuntName} (Nv ${firstPendingHunt.huntLevel}).` : '.'}`);

    return {
        slots: publicSlots,
        readyCount,
        pendingCount,
        nextTargetHuntSlug,
        nextTargetHuntName,
        targetSpeciesIds,
        suggestedFormation,
        summaryText,
    };
}
