// Consultor de economia: compara depot, sacrifício e mercado para cada Pokémon fora da equipe
// e avalia a mochila pela média de vendas. As fórmulas seguem as do jogo (sell-value, nota-pokemon
// e sacrificio do pokeidle.io); os preços de mercado vêm da base local de vendas (market-base.mjs).

// ---------- valor no depot (NPC) ----------
const NIVEL_ANCORA = 150;
const OURO_ANCORA = 12_000;
const TETO_PRICE_NPC_VENDA = 500_000;
const NIVEL_TETO_VENDA_POKEMON = 100;
const ouroDoNivel = (n) => Math.round(OURO_ANCORA * (n / NIVEL_ANCORA) ** 0.6);
const TETO_SELL_POKEMON = ouroDoNivel(2_500);
const PRECO_NPC_FIXO = new Map([[2027, 60_000], [2050, 60_000], [2006, 32_000], [212, 88_000], [3212, 88_000]]);

function valorEconomicoDe(esp) {
    if (!esp) return OURO_ANCORA;
    const hl = Math.max(1, esp.huntLevel ?? 1);
    let sell = esp.sellValue ?? 0;
    let npc = esp.priceNpc ?? 0;
    if ((esp.huntLevel ?? 0) > NIVEL_ANCORA) {
        sell = ouroDoNivel(esp.huntLevel);
        npc = sell;
    }
    if (sell > 0 && sell <= TETO_PRICE_NPC_VENDA) return sell;
    if (sell > TETO_PRICE_NPC_VENDA) return ouroDoNivel(hl);
    if (npc > 0 && npc <= TETO_PRICE_NPC_VENDA) return npc;
    return ouroDoNivel(hl);
}

export function sellValueBaseDe(esp) {
    if (!esp) return Math.min(OURO_ANCORA, TETO_SELL_POKEMON);
    const fixo = PRECO_NPC_FIXO.get(esp.pokeId);
    if (fixo != null) return Math.min(fixo, TETO_SELL_POKEMON);
    const valor = valorEconomicoDe(esp);
    const base = (esp.huntLevel ?? 0) > NIVEL_ANCORA ? Math.min(ouroDoNivel(esp.huntLevel), valor) : valor;
    return Math.min(base, TETO_SELL_POKEMON);
}

export function depotValueOf(pk, esp) {
    const base = sellValueBaseDe(esp);
    const nivel = Math.min(Number(pk?.level) || 1, NIVEL_TETO_VENDA_POKEMON);
    const q = Number(pk?.quality ?? pk?.qualidade) || 1;
    return Math.max(1, Math.floor(base * (1 + nivel / 50) * q * (pk?.shiny ? 10 : 1)));
}

// ---------- nota (0 a 10) ----------
const STAT_KEYS = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
const IV_MIN = 6;
const IV_MAX = 192;
const QUALIDADE_MIN = 0.8;
const QUALIDADE_MAX = 1.8;
const EXPO_QUALIDADE = { hp: 0.95, atk: 0.8, def: 0.8, spAtk: 0.8, spDef: 0.8, speed: 0.95 };
const BONUS_POTENCIA = [0, 0.05, 0.1, 0.25, 1];
const REF_BASE = { hp: 80, atk: 80, def: 80, spAtk: 80, spDef: 80, speed: 80 };
const GANHO_MIN_EVOLUCAO = 0.1;
export const MERCADO_POKEMON_MIN = { level: 50, nota: 3.5 };
const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

function ivsDeSoma(soma) {
    const s = limitar(Math.round(Number(soma) || IV_MIN), IV_MIN, IV_MAX);
    const med = Math.floor(s / 6);
    const ivs = Object.fromEntries(STAT_KEYS.map((k) => [k, med]));
    for (let i = 0; i < s - med * 6; i++) ivs[STAT_KEYS[i % 6]]++;
    return ivs;
}

function somaStats({ iv, ivs: ivsRaw, qualidade, potencia, shiny = false, bases }) {
    const b = { ...REF_BASE, ...(bases || {}) };
    const ivs = ivsRaw ?? ivsDeSoma(iv);
    const q = limitar(Number(qualidade) || 1, QUALIDADE_MIN, QUALIDADE_MAX);
    const p = limitar(Math.round(Number(potencia) || 1), 1, 5);
    const mult = (1 + (BONUS_POTENCIA[p - 1] ?? 0)) * (shiny ? 3 : 1);
    let soma = 0;
    for (const k of STAT_KEYS) {
        soma += Math.round((b[k] + 2 * (Number(ivs[k]) || 1)) * (q ** EXPO_QUALIDADE[k]) * mult);
    }
    return soma;
}

const LIMITES_REF = (() => {
    const min = somaStats({ iv: IV_MIN, qualidade: QUALIDADE_MIN, potencia: 1, bases: REF_BASE });
    const max = somaStats({ iv: IV_MAX, qualidade: QUALIDADE_MAX, potencia: 5, shiny: true, bases: REF_BASE });
    return { min: Math.max(1, min), max: Math.max(min + 1, max) };
})();

function scoreRef(args) {
    const { min, max } = LIMITES_REF;
    const s = limitar(somaStats(args) || min, min, max);
    const nota = Math.round(limitar(10 * (Math.log(Math.max(1, s)) - Math.log(min)) / (Math.log(max) - Math.log(min)), 0, 10) * 1000) / 1000;
    return limitar(nota / 10, 0, 1);
}

function notaComBases(args, bases) {
    const min = scoreRef({ iv: IV_MIN, qualidade: QUALIDADE_MIN, potencia: 1, bases });
    const max = Math.max(min, scoreRef({ iv: IV_MAX, qualidade: QUALIDADE_MAX, potencia: 5, shiny: true, bases }));
    const s = limitar(scoreRef({ ...args, bases }) || min, min, max);
    if (max <= min) return 0;
    return Math.round(10 * (s - min) / (max - min) * 1000) / 1000;
}

export const basesDaEspecie = (esp) => (esp ? {
    hp: esp.baseHp, atk: esp.baseAtk, def: esp.baseDef, spAtk: esp.baseSpAtk, spDef: esp.baseSpDef, speed: esp.baseSpeed,
} : null);

function basesComRefino(esp, refino) {
    const r = refino && typeof refino === 'object' ? refino : {};
    const b = basesDaEspecie(esp);
    for (const k of ['hp', 'atk', 'def', 'spAtk', 'spDef']) b[k] = (b[k] ?? 0) + Math.max(0, Math.floor(Number(r[k]) || 0));
    return b;
}

/** Nota do Pokémon como o jogo calcula. Sem IV conhecido devolve null. */
export function notaOf(pk, esp, ancestors = []) {
    if (typeof pk?.nota === 'number' && Number.isFinite(pk.nota)) return pk.nota;
    const iv = pk?.iv ?? pk?.ivTotal ?? (pk?.ivs ? Object.values(pk.ivs).reduce((s, v) => s + (Number(v) || 0), 0) : null);
    if (iv == null || !Number.isFinite(Number(iv)) || !esp) return null;
    const args = {
        iv: Math.round(Number(iv)),
        ivs: pk?.ivs,
        qualidade: Number(pk?.quality ?? pk?.qualidade) || 1,
        potencia: limitar(Number(pk?.potencia) || 1, 1, 5),
        shiny: Boolean(pk?.shiny),
    };
    let nota = notaComBases(args, basesComRefino(esp, pk?.refino));
    for (const { esp: anc, passos } of ancestors) {
        const piso = Math.min(10, notaComBases(args, basesDaEspecie(anc)) + (passos || 1) * GANHO_MIN_EVOLUCAO);
        if (piso > nota) nota = piso;
    }
    return Math.round(nota * 1000) / 1000;
}

// ---------- sacrifício ----------
const PONTOS_POR_NOTA = [10, 12, 14, 17, 20, 25, 30, 35, 42, 50, 60, 70, 80, 90, 100, 110, 125, 140, 155, 170,
    190, 210, 235, 260, 290, 320, 360, 400, 450, 500, 560, 620, 700, 780, 870, 1000];
export const SACRIFICIO_TETO_PONTOS = 1000;

export function sacrificePointsOf(nota) {
    if (typeof nota !== 'number' || !Number.isFinite(nota)) return 0;
    const d = Math.floor(Math.round(nota * 1000) / 100);
    if (d < 35) return 0;
    return PONTOS_POR_NOTA[Math.min(d - 35, PONTOS_POR_NOTA.length - 1)];
}

const LENDARIOS_FIXOS = new Set([144, 145, 146, 150, 243, 244, 245, 249, 250, 151, 251, 494]);
export const isLegendary = (esp, speciesId) => LENDARIOS_FIXOS.has(Number(speciesId))
    || esp?.rarity === 'LEGENDARY' || esp?.rarity === 'MYTHIC';

// ---------- catálogo de espécies ----------
/** Monta o mapa de espécies e a linhagem (para o piso de nota de quem evoluiu). */
export function buildSpeciesIndex(list) {
    const byId = new Map();
    for (const c of list || []) if (c && Number.isInteger(c.pokeId)) byId.set(c.pokeId, c);
    const parentOf = new Map();
    for (const c of byId.values()) {
        const to = Number(c.evolvesToId) || 0;
        if (to > 0 && to !== c.pokeId && !parentOf.has(to)) parentOf.set(to, c.pokeId);
    }
    const ancestorsCache = new Map();
    const ancestorsOf = (id) => {
        if (ancestorsCache.has(id)) return ancestorsCache.get(id);
        const out = [];
        let cur = parentOf.get(id);
        let passos = 1;
        const seen = new Set([id]);
        while (cur != null && !seen.has(cur) && passos <= 4) {
            seen.add(cur);
            const esp = byId.get(cur);
            if (esp) out.push({ esp, passos });
            cur = parentOf.get(cur);
            passos++;
        }
        ancestorsCache.set(id, out);
        return out;
    };
    return { byId, ancestorsOf, size: byId.size };
}

// ---------- preço de mercado pela base local ----------
const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Estima o preço de um Pokémon pelas vendas parecidas (mesma espécie, shiny igual, nota e nível próximos).
 * @returns {{price:number, currency:'gold'|'orb', n:number, confidence:'alta'|'media'|'baixa'}|null}
 */
export function estimatePokemonPrice(pk, nota, salesBySpecies, { nowMs = Date.now(), windowDays = 30 } = {}) {
    const sales = salesBySpecies?.get(Number(pk?.speciesId)) || [];
    if (!sales.length) return null;
    const cut = nowMs - windowDays * 86_400_000;
    const shiny = Boolean(pk?.shiny);
    const lv = Math.max(1, Number(pk?.level) || 1);
    const pool = sales.filter((s) => s.em >= cut && Boolean(s.sh) === shiny);
    const pick = (rows) => {
        const byCur = { gold: [], orb: [] };
        for (const r of rows) (byCur[r.m === 'orb' ? 'orb' : 'gold']).push(r.pr);
        const cur = shiny || byCur.orb.length > byCur.gold.length ? 'orb' : 'gold';
        return { cur, prices: byCur[cur] };
    };
    const close = pool.filter((s) => {
        const okLv = s.lv >= lv * 0.6 && s.lv <= lv * 1.6;
        const okNota = nota == null || s.nota == null || Math.abs(s.nota - nota) <= 0.5;
        return okLv && okNota;
    });
    if (close.length >= 3) {
        const { cur, prices } = pick(close);
        if (prices.length >= 2) return { price: median(prices), currency: cur, n: prices.length, confidence: prices.length >= 6 ? 'alta' : 'media' };
    }
    if (pool.length >= 3) {
        const { cur, prices } = pick(pool);
        if (prices.length >= 3) return { price: median(prices), currency: cur, n: prices.length, confidence: 'baixa' };
    }
    return null;
}

// ---------- recomendações ----------
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

/**
 * @param {object} p
 * @param {Array<object>} p.pokemons Pokémon da conta (estado do jogo)
 * @param {(pk:object)=>string} p.locationOf 'equipe' | 'colecao' | 'depot'
 * @param {{byId:Map, ancestorsOf:Function}|null} p.species índice de espécies
 * @param {Map<number, Array>} p.salesBySpecies vendas da base local por espécie
 * @param {{pts:number}} p.sacrifice estado da barra de sacrifício
 * @param {Set<string>} p.busyIds Pokémon presos (ativo, casa, Exp. Share, fila do treinador)
 * @param {(pk:object)=>object|null} [p.planOf] plano da forma final (evolution-plan.mjs)
 * @param {(itemId:number)=>number|null} [p.stonePriceOf] preço médio em gold de uma pedra
 * @param {number} [p.keepNota] nota na forma final que já vale guardar na coleção
 * @param {number} [p.keepFinalMult] guardar quando a forma final vende N vezes o que ele vale hoje (0 = desliga)
 * @param {(price:number)=>number} [p.netOf] quanto sobra de um anúncio em gold (taxa e diária)
 */
export function advisePokemons({
    pokemons = [], locationOf, species, salesBySpecies, sacrifice = {}, busyIds = new Set(), nowMs = Date.now(),
    planOf = null, stonePriceOf = () => null, keepNota = 7, keepFinalMult = 3, netOf = (price) => price,
}) {
    const out = [];
    let sacLeft = Math.max(0, SACRIFICIO_TETO_PONTOS - (Number(sacrifice.pts) || 0));
    const rows = [];
    for (const pk of pokemons) {
        if (!pk || pk.id == null) continue;
        const loc = locationOf ? locationOf(pk) : (pk.slot != null ? 'equipe' : 'depot');
        if (loc === 'equipe') continue;
        const spId = Number(pk.speciesId) || 0;
        const esp = species?.byId?.get(spId) || null;
        const nota = notaOf(pk, esp, species?.ancestorsOf?.(spId) || []);
        const level = Number(pk.level ?? pk.nivel) || 1;
        // O depot paga pela espécie em que foi capturado: evoluir não muda esse valor.
        const origem = (pk.especieOrigem != null && species?.byId?.get(Number(pk.especieOrigem))) || esp;
        const depot = depotValueOf(pk, origem);
        const pts = sacrificePointsOf(nota);
        const legend = isLegendary(esp, spId);
        const eligible = Boolean(pk.shiny) || Number(pk.potencia) === 5 || legend
            || (level >= MERCADO_POKEMON_MIN.level && nota != null && nota >= MERCADO_POKEMON_MIN.nota - 1e-9);
        const market = eligible ? estimatePokemonPrice({ ...pk, level }, nota, salesBySpecies, { nowMs }) : null;
        const evolveTo = esp && Number(esp.evolvesToId) > 0 && Number(esp.evolveLevel) > 0 && level >= Number(esp.evolveLevel)
            ? species.byId.get(Number(esp.evolvesToId)) || null : null;
        // Evoluir só compensa se o evoluído vende mais no mercado, já tirando o preço da pedra.
        let evolveGain = null;
        if (evolveTo && eligible && !pk.shiny) {
            const nextPk = { ...pk, level, speciesId: evolveTo.pokeId };
            delete nextPk.nota;
            const nextNota = notaOf(nextPk, evolveTo, species.ancestorsOf(evolveTo.pokeId));
            const nextMarket = estimatePokemonPrice(nextPk, nextNota, salesBySpecies, { nowMs });
            const pedra = planOf?.(pk)?.finals?.find((f) => f.path?.[0] === evolveTo.name)?.stones?.[0];
            const stone = pedra?.itemId != null ? stonePriceOf(pedra.itemId) : null;
            if (nextMarket?.currency === 'gold') {
                evolveGain = { name: evolveTo.name, price: nextMarket.price, n: nextMarket.n, stone, stoneName: pedra?.nome || null };
            }
        }
        const plan = planOf ? planOf(pk) : null;
        // Quanto a forma final vale no mercado (mesma nota projetada, no nível em que ela aparece).
        let finalMarket = null;
        const bestPlan = plan?.best;
        if (bestPlan && !pk.shiny) {
            const finalPk = { ...pk, speciesId: bestPlan.speciesId, level: Math.max(level, bestPlan.level || 0) };
            delete finalPk.nota;
            finalMarket = estimatePokemonPrice(finalPk, bestPlan.nota, salesBySpecies, { nowMs });
        }
        rows.push({ pk, loc, esp, nota, level, depot, pts, legend, eligible, market, evolveTo, evolveGain, plan, finalMarket });
    }
    // Sacrifício enche uma barra só: os de maior nota usam os pontos primeiro.
    rows.sort((a, b) => (b.pts - a.pts) || (b.depot - a.depot));
    for (const r of rows) {
        const { pk, nota, depot, pts, legend, eligible, market, evolveGain, plan, finalMarket } = r;
        const busy = busyIds.has(String(pk.id));
        const best = plan?.best || null;
        const marketNet = market?.currency === 'gold' ? netOf(market.price) : null;
        const nowValue = Math.max(depot, marketNet || 0);
        const finalGain = finalMarket?.currency === 'gold' && finalMarket.confidence !== 'baixa'
            ? finalMarket.price - (best?.stoneCostKnown ? best.stoneCost : 0) : null;
        // Nota máxima: a da melhor forma final, ou a de agora quando ele já é a forma final (ou não evolui).
        const maxNota = Math.max(best?.nota ?? -1, nota ?? -1);
        const maxNotaRef = best?.nota != null && best.nota >= (nota ?? -1) ? best : null;
        // As duas regras de guardar são independentes: basta uma.
        const keepByNota = maxNota >= 0 && maxNota >= keepNota - 1e-9;
        const keepByValue = keepFinalMult > 0 && finalGain != null && finalGain >= nowValue * keepFinalMult;
        let action = 'depot';
        let reason = `Depot paga ${fmt(depot)} gold.`;
        if (pk.shiny || legend || Number(pk.potencia) === 5) {
            action = 'manter';
            reason = pk.shiny ? 'Shiny: só sai por gemas, decida com calma.' : (legend ? 'Lendário ou mítico: não vai para depot nem sacrifício.' : 'Potência máxima: vale olhar o mercado com calma.');
            if (market) reason += ` Vendas parecidas: ~${fmt(market.price)} ${market.currency === 'orb' ? 'gemas' : 'gold'}.`;
        } else if (busy) {
            action = 'manter';
            reason = 'Em uso (ativo, casa, Exp. Share ou fila do Treinador).';
        } else if (r.loc === 'depot' && keepByNota) {
            action = 'guardar';
            reason = maxNotaRef
                ? `Na forma final (${maxNotaRef.name}${maxNotaRef.level ? `, Nv ${fmt(maxNotaRef.level)}` : ''}) chega a nota ${maxNota.toFixed(1)}. Vale guardar na coleção para treinar.`
                : `Nota ${maxNota.toFixed(1)} já na forma final. Vale guardar na coleção.`;
            if (finalMarket?.currency === 'gold') reason += ` Lá vende ~${fmt(finalMarket.price)} gold.`;
        } else if (r.loc === 'depot' && keepByValue) {
            action = 'guardar';
            const pedraTxt = best.stoneCostKnown && best.stoneCost ? ` (já tirando ~${fmt(best.stoneCost)} de pedras)` : '';
            reason = `Evoluído até ${best.name} (Nv ${fmt(best.level)}) vende ~${fmt(finalMarket.price)} gold${pedraTxt}; hoje vale ~${fmt(nowValue)}.`;
        } else if (evolveGain && evolveGain.price - (evolveGain.stone || 0) > nowValue * 1.2) {
            action = 'evoluir';
            const pedraTxt = evolveGain.stone ? ` menos ~${fmt(evolveGain.stone)} da ${evolveGain.stoneName || 'pedra'}` : '';
            reason = `Evoluído para ${evolveGain.name} sai por ~${fmt(evolveGain.price)} gold (${evolveGain.n} vendas)${pedraTxt}. Do jeito que está vale ~${fmt(nowValue)}.`;
        } else if (eligible && marketNet != null && marketNet >= depot * 1.5) {
            action = 'mercado';
            reason = `Vendas parecidas saem por ~${fmt(market.price)} gold (${market.n} vendas, confiança ${market.confidence}); tirando taxa e diária sobra ~${fmt(marketNet)}. Depot paga ${fmt(depot)}.`;
        } else if (eligible && market && market.currency === 'orb') {
            action = 'mercado';
            reason = `Vende em gemas: ~${fmt(market.price)} (${market.n} vendas, confiança ${market.confidence}).`;
        } else if (pts > 0 && sacLeft > 0) {
            action = 'sacrificar';
            reason = `+${fmt(pts)} pontos de sacrifício (nota ${nota.toFixed(1)}). Depot pagaria ${fmt(depot)} gold.`;
            sacLeft -= pts;
        } else if (pts > 0) {
            reason = `Barra de sacrifício cheia. Depot paga ${fmt(depot)} gold.`;
        }
        out.push({
            id: pk.id,
            speciesId: Number(pk.speciesId) || null,
            name: pk.apelido || pk.nome || pk.name || r.esp?.name || `#${pk.id}`,
            level: r.level,
            shiny: Boolean(pk.shiny),
            location: r.loc,
            nota,
            depot,
            sacPoints: pts,
            market,
            eligible,
            legend,
            potencia: Number(pk.potencia) || 1,
            starter: Boolean(pk.starter),
            busy,
            potential: best ? {
                name: best.name, speciesId: best.speciesId, level: best.level, nota: best.nota,
                stones: (best.stones || []).map((x) => x.nome), stoneCost: best.stoneCostKnown ? best.stoneCost : null,
                market: finalMarket,
            } : null,
            maxNota: maxNota >= 0 ? maxNota : null,
            nowValue,
            action,
            reason,
        });
    }
    const order = { mercado: 0, evoluir: 1, guardar: 2, sacrificar: 3, depot: 4, manter: 5 };
    out.sort((a, b) => (order[a.action] - order[b.action]) || ((b.market?.price || b.depot) - (a.market?.price || a.depot)));
    return out;
}

/**
 * Avalia a mochila pela média de 7 dias do mercado.
 * @param {Record<string, number>} items itemId -> quantidade
 * @param {Record<string, {gold?:{media:number,unidades:number}, orb?:{media:number,unidades:number}}>} medias
 * @param {Set<number>} keepIds itens que o bot consome (bolas, poções, revives)
 */
export function adviseItems({ items = {}, medias = {}, names = {}, keepIds = new Set() }) {
    const out = [];
    for (const [idStr, qtyRaw] of Object.entries(items || {})) {
        const id = Number(idStr);
        const qty = Math.max(0, Math.floor(Number(qtyRaw) || 0));
        if (!id || !qty) continue;
        const m = medias?.[id] || medias?.[idStr];
        const gold = m?.gold?.media ? { avg: Number(m.gold.media), sold: Number(m.gold.unidades || 0) } : null;
        const orb = m?.orb?.media ? { avg: Number(m.orb.media), sold: Number(m.orb.unidades || 0) } : null;
        if (!gold && !orb) continue;
        const keep = keepIds.has(id);
        const sold = (gold?.sold || 0) + (orb?.sold || 0);
        const liquidity = sold >= qty ? 'alta' : (sold >= Math.ceil(qty / 4) ? 'media' : 'baixa');
        let action = 'vender';
        let reason = `Saíram ${fmt(sold)} unidades em 7 dias.`;
        if (keep) { action = 'manter'; reason = 'O bot usa este item no farm.'; }
        else if (liquidity === 'baixa') { action = 'aos-poucos'; reason = `Pouca saída (${fmt(sold)} em 7 dias): venda aos poucos para não derrubar o preço.`; }
        out.push({
            id,
            name: names?.[id] || `Item #${id}`,
            qty,
            gold,
            orb,
            valueGold: gold ? Math.round(gold.avg * qty) : 0,
            valueOrb: orb ? Math.round(orb.avg * qty) : 0,
            liquidity,
            action,
            reason,
        });
    }
    out.sort((a, b) => (b.valueGold - a.valueGold) || (b.valueOrb - a.valueOrb));
    return out;
}
