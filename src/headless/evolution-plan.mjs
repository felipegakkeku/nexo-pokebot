// Projeção da evolução final (sem mega): para onde o Pokémon pode evoluir, a nota que ele teria lá,
// o nível pedido e as pedras gastas no caminho. Tabela de ramificações e pedra por tipo seguem o jogo
// (shared/evolucoes-ramificadas.mjs do pokeidle.io).
import { notaOf } from './economy-advisor.mjs';

/** Evoluções com mais de um destino (Eevee, Tyrogue...) e formas especiais. */
export const EVOLUCOES_RAMIFICADAS = {
    44: [{ para: 45, nivel: 70 }, { para: 182, nivel: 50 }],
    61: [{ para: 62, nivel: 80 }, { para: 186, nivel: 70 }],
    79: [{ para: 80, nivel: 60 }, { para: 199, nivel: 1_000 }],
    133: [
        { para: 134, nivel: 80, fixo: true },
        { para: 135, nivel: 80, fixo: true },
        { para: 136, nivel: 80, fixo: true },
        { para: 196, nivel: 80, fixo: true },
        { para: 197, nivel: 80, fixo: true },
        { para: 470, nivel: 80, fixo: true },
        { para: 471, nivel: 80, fixo: true },
        { para: 700, nivel: 80, fixo: true },
    ],
    236: [{ para: 237, nivel: 60 }, { para: 106, nivel: 60 }, { para: 107, nivel: 60 }],
    265: [{ para: 266, nivel: 650 }, { para: 268, nivel: 500 }],
    13265: [{ para: 266, nivel: 650 }, { para: 268, nivel: 500 }],
    281: [{ para: 282, nivel: 100 }, { para: 475, nivel: 1_500 }],
    13281: [{ para: 282, nivel: 100 }, { para: 475, nivel: 1_500 }],
    290: [{ para: 291, nivel: 700 }, { para: 292, nivel: 500 }],
    13290: [{ para: 291, nivel: 700 }, { para: 292, nivel: 500 }],
    361: [{ para: 362, nivel: 80 }, { para: 478, nivel: 1_250 }],
    13361: [{ para: 362, nivel: 80 }, { para: 478, nivel: 1_250 }],
    366: [{ para: 367, nivel: 700 }, { para: 368, nivel: 550 }],
    13366: [{ para: 367, nivel: 700 }, { para: 368, nivel: 550 }],
    412: [
        { para: 413, nivel: 2_000 },
        { para: 414, nivel: 1_250 },
        { para: 8413, nivel: 2_000 },
        { para: 9413, nivel: 2_000 },
    ],
    25: [{ para: 26, nivel: 80 }, { para: 4026, nivel: 43_100 }],
    102: [{ para: 103, nivel: 100 }, { para: 4103, nivel: 34_650 }],
    104: [{ para: 105, nivel: 50 }, { para: 4105, nivel: 34_650 }],
    109: [{ para: 110, nivel: 60 }, { para: 5110, nivel: 69_300 }],
    439: [{ para: 122, nivel: 80 }, { para: 5122, nivel: 64_000 }],
    156: [{ para: 157, nivel: 80 }, { para: 6157, nivel: 86_150 }],
    502: [{ para: 503, nivel: 100 }, { para: 6503, nivel: 86_150 }],
    548: [{ para: 549, nivel: 100 }, { para: 6549, nivel: 69_300 }],
    627: [{ para: 628, nivel: 100 }, { para: 6628, nivel: 69_300 }],
    704: [{ para: 705, nivel: 40 }, { para: 6705, nivel: 64_000 }],
    712: [{ para: 713, nivel: 100 }, { para: 6713, nivel: 69_300 }],
    723: [{ para: 724, nivel: 100 }, { para: 6724, nivel: 86_150 }],
    744: [{ para: 745, nivel: 34_650 }, { para: 8745, nivel: 34_650 }, { para: 9745, nivel: 34_650 }],
    550: [{ para: 902, nivel: 69_300 }, { para: 8902, nivel: 69_300 }],
    5079: [{ para: 5080, nivel: 69_300 }, { para: 5199, nivel: 69_300 }],
    123: [{ para: 212, nivel: 80 }, { para: 900, nivel: 27_500 }],
    790: [{ para: 791, nivel: 7_500 }, { para: 792, nivel: 7_500 }],
    840: [{ para: 841, nivel: 30_450 }, { para: 842, nivel: 26_150 }, { para: 1011, nivel: 40_000 }],
    646: [{ para: 8646, nivel: 8_600 }, { para: 9646, nivel: 8_600 }],
    935: [{ para: 936, nivel: 120_550 }, { para: 937, nivel: 120_550 }],
    898: [{ para: 8898, nivel: 64_950 }, { para: 9898, nivel: 64_950 }],
    1017: [{ para: 9017, nivel: 160_300 }, { para: 8017, nivel: 160_300 }, { para: 12017, nivel: 160_300 }],
    217: [{ para: 901, nivel: 46_150 }, { para: 8901, nivel: 160_300 }],
    680: [{ para: 681, nivel: 16_000 }, { para: 8681, nivel: 21_200 }],
    800: [{ para: 8800, nivel: 35_150 }, { para: 9800, nivel: 35_150 }],
};

/** Espécies cuja pedra não segue o tipo principal. */
export const TIPO_DA_PEDRA_POR_ESPECIE = {
    16: 'FLYING',
    17: 'FLYING',
    21: 'FLYING',
    163: 'FLYING',
    276: 'FLYING',
    13276: 'FLYING',
    333: 'FLYING',
    13333: 'FLYING',
    396: 'FLYING',
    397: 'FLYING',
    627: 'FLYING',
    661: 'FLYING',
    731: 'FLYING',
    732: 'FLYING',
};

/** Outland não evolui no jogo. */
export const OUTLAND_POKE_MIN = 2001;
export const OUTLAND_POKE_MAX = 2059;
/** Formas acima deste nível ficam fora da conta: treinar até lá não é plano realista para um drop. */
export const NIVEL_FINAL_MAX = 2_500;
const MAX_FORMAS = 64;

/** Destinos diretos de uma espécie, como o jogo lista no botão Evoluir. */
export function evolutionTargets(esp, byId) {
    if (!esp) return [];
    const out = [];
    const add = (id, nivel) => {
        const pid = Number(id) || 0;
        if (!pid || out.some((d) => d.pokeId === pid)) return;
        const alvo = byId.get(pid);
        if (!alvo) return;
        out.push({ pokeId: pid, nivel: Number(nivel) || 0, esp: alvo });
    };
    for (const r of EVOLUCOES_RAMIFICADAS[esp.pokeId] || []) add(r.para, r.nivel);
    add(esp.evolvesToId, esp.evolveLevel);
    return out;
}

export function stoneTypeFor(base, destino = null) {
    if (!base) return null;
    const forcado = TIPO_DA_PEDRA_POR_ESPECIE[base.pokeId];
    if (forcado) return forcado;
    if (destino?.type1 && EVOLUCOES_RAMIFICADAS[base.pokeId]) return destino.type1;
    return base.type1 ?? null;
}

/**
 * Formas finais alcançáveis (sem mega), cada uma com o caminho: nível pedido (o maior do caminho)
 * e o tipo da pedra de cada passo.
 */
export function finalFormsOf(esp, byId, { maxLevel = NIVEL_FINAL_MAX } = {}) {
    if (!esp?.pokeId) return [];
    if (esp.pokeId >= OUTLAND_POKE_MIN && esp.pokeId <= OUTLAND_POKE_MAX) return [];
    const finals = [];
    const fila = [{ esp, nivel: 0, pedras: [], caminho: [] }];
    const vistos = new Set([esp.pokeId]);
    while (fila.length && vistos.size <= MAX_FORMAS) {
        const atual = fila.shift();
        const prox = evolutionTargets(atual.esp, byId).filter((d) => !vistos.has(d.pokeId) && d.nivel <= maxLevel);
        if (!prox.length) {
            if (atual.esp.pokeId !== esp.pokeId) finals.push(atual);
            continue;
        }
        for (const d of prox) {
            vistos.add(d.pokeId);
            fila.push({
                esp: d.esp,
                nivel: Math.max(atual.nivel, d.nivel),
                pedras: [...atual.pedras, stoneTypeFor(atual.esp, d.esp)],
                caminho: [...atual.caminho, d.esp.name],
            });
        }
    }
    return finals;
}

/**
 * Plano da forma final para um Pokémon.
 * @param {object} pk Pokémon (speciesId, ivs/iv, quality, potencia, shiny, refino, level)
 * @param {{byId:Map, ancestorsOf:Function}} species índice de espécies
 * @param {object} [opts]
 * @param {Record<string,{itemId:number,nome:string}>} [opts.pedras] pedra por tipo (welcome.pedrasEvolucao)
 * @param {(itemId:number)=>number|null} [opts.stonePrice] preço médio em gold de uma pedra
 * @returns {null|{nota:number|null, best:object|null, finals:Array<object>}}
 */
export function planFinalEvolution(pk, species, { pedras = {}, stonePrice = () => null, maxLevel = NIVEL_FINAL_MAX } = {}) {
    if (!pk || !species?.byId) return null;
    const spId = Number(pk.speciesId) || 0;
    const esp = species.byId.get(spId);
    if (!esp) return null;
    const base = { ...pk };
    delete base.nota;
    const notaAgora = notaOf(pk, esp, species.ancestorsOf(spId));
    const finals = finalFormsOf(esp, species.byId, { maxLevel }).map((f) => {
        const nota = notaOf({ ...base, speciesId: f.esp.pokeId }, f.esp, species.ancestorsOf(f.esp.pokeId));
        const stones = f.pedras.map((tipo) => {
            const p = pedras?.[tipo] ?? pedras?.NORMAL ?? null;
            return { tipo, itemId: p?.itemId ?? null, nome: p?.nome ?? tipo ?? 'Pedra' };
        });
        let stoneCost = 0;
        let stoneCostKnown = true;
        for (const s of stones) {
            const v = s.itemId != null ? stonePrice(s.itemId) : null;
            if (v == null) stoneCostKnown = false;
            else stoneCost += v;
        }
        return {
            speciesId: f.esp.pokeId,
            name: f.esp.name,
            path: f.caminho,
            level: f.nivel,
            levelsLeft: Math.max(0, f.nivel - (Number(pk.level) || 1)),
            nota,
            stones,
            stoneCost: Math.round(stoneCost),
            stoneCostKnown,
        };
    });
    let best = null;
    for (const f of finals) if (f.nota != null && (best == null || f.nota > best.nota)) best = f;
    return { nota: notaAgora, best: best || finals[0] || null, finals };
}

function dexKeyOf(pokeId) {
    const id = Number(pokeId);
    if (!Number.isFinite(id) || id < 1) return null;
    if (id >= 10501 && id <= 10548) return id - 8500;
    if (id >= 2001 && id < 2059) return id;
    if (id >= 13000) return id % 1000;
    return id;
}

function normalizePokedexSet(pokedexSet) {
    const out = new Set();
    if (!pokedexSet) return out;
    if (pokedexSet instanceof Set) {
        for (const k of pokedexSet) {
            if (k != null && String(k)) out.add(String(k));
        }
        return out;
    }
    if (Array.isArray(pokedexSet)) {
        for (const k of pokedexSet) {
            if (k != null && String(k)) out.add(String(k));
        }
        return out;
    }
    if (typeof pokedexSet === 'object') {
        for (const [k, v] of Object.entries(pokedexSet)) {
            if (v === true || (typeof v === 'number' && v > 0) || Number(v?.c || 0) > 0) {
                const canon = dexKeyOf(k);
                out.add(String(canon ?? k));
            }
        }
    }
    return out;
}

/**
 * Lista Pokémons (na equipe ou fora dela) cuja evolução direta registra uma espécie
 * ainda ausente em `pokedexSet`.
 * @param {Array<object>} [pokemons=[]] Lista de Pokémons da conta.
 * @param {Set<string|number>|Record<string, object>|Array<string|number>} [pokedexSet=new Set()] Chaves já capturadas.
 * @param {{ byId?: Map<number, object>, pedras?: Record<string, object> }|Map<number, object>|null} [speciesIndex=null] Índice de espécies.
 * @param {Record<string, number>} [items={}] Inventário do jogador (`state.items`).
 * @param {{ pedras?: Record<string, { itemId?: number, nome?: string }> }} [opts={}] Mapa opcional de pedras (`welcome.pedrasEvolucao`).
 * @returns {Array<{ pokemonId: number|string, alvoId: number, fromName: string, toName: string, currentLevel: number, requiredLevel: number, ready: boolean, stoneNeeded: string|null }>}
 */
export function findPokedexEvolutions(
    pokemons = [],
    pokedexSet = new Set(),
    speciesIndex = null,
    items = {},
    { pedras = null } = {},
) {
    const byId = speciesIndex instanceof Map ? speciesIndex : speciesIndex?.byId;
    if (!Array.isArray(pokemons) || !(byId instanceof Map)) return [];

    const dexSet = normalizePokedexSet(pokedexSet);
    const pedrasMap = pedras || speciesIndex?.pedras || null;
    const bag = items && typeof items === 'object' ? items : null;
    const bagEmpty = bag ? Object.keys(bag).length === 0 : false;
    const out = [];

    const hasInDex = (id) => {
        const raw = Number(id);
        if (!Number.isFinite(raw) || raw < 1) return true;
        if (dexSet.has(String(raw))) return true;
        const canon = dexKeyOf(raw);
        return canon != null && dexSet.has(String(canon));
    };

    for (const pk of pokemons) {
        if (!pk || pk.id == null) continue;
        const spId = Number(pk.speciesId) || 0;
        if (spId >= OUTLAND_POKE_MIN && spId <= OUTLAND_POKE_MAX) continue;
        const esp = byId.get(spId);
        if (!esp) continue;

        const currentLevel = Math.max(1, Number(pk.level ?? pk.nivel ?? 1) || 1);
        const fromName = String(pk.apelido || pk.nome || pk.name || esp.name || `#${spId}`);
        const targets = evolutionTargets(esp, byId);

        for (const target of targets) {
            const alvoId = Number(target.pokeId);
            if (!alvoId || hasInDex(alvoId)) continue;

            const requiredLevel = Math.max(0, Number(target.nivel) || 0);
            const stoneType = stoneTypeFor(esp, target.esp);
            const pedraInfo = stoneType && pedrasMap ? (pedrasMap[stoneType] ?? pedrasMap.NORMAL ?? null) : null;
            const stoneItemId = pedraInfo?.itemId ?? target.esp?.stoneItemId ?? esp.stoneItemId ?? null;
            const stoneNeeded = pedraInfo?.nome || stoneType || null;

            let hasStone = true;
            if (stoneType) {
                if (bag == null) {
                    hasStone = true;
                } else if (stoneItemId != null) {
                    hasStone = Number(bag[stoneItemId] ?? bag[String(stoneItemId)] ?? 0) >= 1;
                } else if (bag[stoneType] !== undefined) {
                    hasStone = Number(bag[stoneType] || 0) >= 1;
                } else if (bagEmpty) {
                    hasStone = false;
                }
            }

            const ready = currentLevel >= requiredLevel && hasStone;
            out.push({
                pokemonId: pk.id,
                alvoId,
                fromName,
                toName: String(target.esp?.name || `#${alvoId}`),
                currentLevel,
                requiredLevel,
                ready,
                stoneNeeded,
            });
        }
    }

    out.sort((a, b) => (Number(b.ready) - Number(a.ready)) || (a.requiredLevel - b.requiredLevel) || a.toName.localeCompare(b.toName));
    return out;
}
