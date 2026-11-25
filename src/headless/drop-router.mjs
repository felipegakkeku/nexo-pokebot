// Destino dos drops: para cada Pokémon novo que cai no depot, decide entre guardar na coleção,
// anunciar no mercado pela média ou seguir o resto (deixar ou vender no depot), conforme a config.
// Taxas e diária do anúncio seguem o jogo (shared/taxa-mercado.mjs e o diálogo de dias do mercado).

export const TAXA_GOLD_PADRAO = 0.15;
export const DIARIA_PADRAO = 100_000;
export const PRECO_MIN_GOLD = Math.ceil(1 / (1 - TAXA_GOLD_PADRAO));
const CONFIANCA = { baixa: 0, media: 1, alta: 2 };
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

export const DROP_DEFAULTS = Object.freeze({
    dropRouteEnabled: false,
    dropRouteMode: 'sugerir',
    dropKeepNota: 7,
    dropKeepFinalMult: 3,
    dropSellMarket: true,
    dropPricePct: 100,
    dropListDays: 1,
    dropMinProfitPct: 50,
    dropMinConfidence: 'media',
    dropRest: 'deixar',
    dropMaxListingsHour: 6,
});

/** Regras do mercado vindas do welcome do jogo, com os padrões do cliente quando faltam. */
export function marketRulesOf(welcome) {
    const reg = welcome?.mercado || {};
    const pct = welcome?.economia?.taxaMercadoGoldPct ?? reg.taxaGoldPct;
    return {
        taxaGold: Number.isFinite(pct) ? pct / 100 : TAXA_GOLD_PADRAO,
        diaria: Number.isFinite(reg.taxaDiaria) ? reg.taxaDiaria : DIARIA_PADRAO,
        diasMin: Number.isFinite(reg.diasMin) ? reg.diasMin : 1,
        diasMax: Number.isFinite(reg.diasMax) ? reg.diasMax : 30,
        precoMinGold: Number.isFinite(reg.precoMinGold) ? reg.precoMinGold : PRECO_MIN_GOLD,
    };
}

/** Quanto sobra de um anúncio em gold: preço menos a taxa de venda e a diária. */
export function netOfListing(price, dias, rules) {
    return Math.floor(price * (1 - rules.taxaGold)) - rules.diaria * dias;
}

/**
 * Decide o destino de um Pokémon já avaliado pelo consultor (uma linha de advisePokemons).
 * @returns {{action:'guardar'|'anunciar'|'vender'|'deixar', reason:string, price?:number, dias?:number, net?:number}}
 */
export function decideDrop(row, cfg = {}, rules = marketRulesOf(null)) {
    const c = { ...DROP_DEFAULTS, ...cfg };
    if (!row) return { action: 'deixar', reason: 'Sem dados.' };
    if (row.shiny || row.legend || row.potencia >= 5) {
        const why = row.shiny ? 'Shiny' : (row.legend ? 'Lendário ou mítico' : 'Potência máxima');
        return { action: 'guardar', reason: `${why}: vai para a coleção.` };
    }
    const best = row.potential;
    if (best?.nota != null && best.nota >= Number(c.dropKeepNota) - 1e-9) {
        return {
            action: 'guardar',
            reason: `Na forma final (${best.name}${best.level ? `, Nv ${fmt(best.level)}` : ''}) chega a nota ${best.nota.toFixed(1)}.`,
        };
    }
    // A forma final vende muito mais do que ele vale hoje, mesmo pagando as pedras: guarda para treinar.
    const fm = best?.market;
    const mult = Number(c.dropKeepFinalMult) || 0;
    if (mult > 0 && fm?.currency === 'gold' && (CONFIANCA[fm.confidence] ?? 0) >= (CONFIANCA[c.dropMinConfidence] ?? 1)) {
        const hoje = Math.max(1, Number(row.nowValue) || row.depot || 1);
        const ganho = fm.price - (best.stoneCost || 0);
        if (ganho >= hoje * mult) {
            const pedraTxt = best.stoneCost ? ` (já tirando ~${fmt(best.stoneCost)} de pedras)` : '';
            return {
                action: 'guardar',
                reason: `Evoluído até ${best.name} (Nv ${fmt(best.level)}) vende ~${fmt(fm.price)} gold${pedraTxt}; hoje vale ~${fmt(hoje)}.`,
            };
        }
    }
    const est = row.market;
    if (c.dropSellMarket && row.eligible && est?.currency === 'gold'
        && (CONFIANCA[est.confidence] ?? 0) >= (CONFIANCA[c.dropMinConfidence] ?? 1)) {
        const dias = Math.max(rules.diasMin, Math.min(rules.diasMax, Math.round(Number(c.dropListDays) || 1)));
        const price = Math.max(rules.precoMinGold, Math.round(est.price * (Number(c.dropPricePct) || 100) / 100));
        const net = netOfListing(price, dias, rules);
        const alvo = Math.round(row.depot * (1 + (Number(c.dropMinProfitPct) || 0) / 100));
        if (net >= alvo) {
            return {
                action: 'anunciar', price, dias, net,
                reason: `Vendas parecidas saem por ~${fmt(est.price)} gold. Anúncio a ${fmt(price)} por ${dias} dia(s) deixa ~${fmt(net)} limpo; depot paga ${fmt(row.depot)}.`,
            };
        }
    }
    if (c.dropRest === 'vender') {
        return { action: 'vender', reason: `Nada melhor que o depot: vende por ${fmt(row.depot)} gold.` };
    }
    return { action: 'deixar', reason: `Fica no depot (paga ${fmt(row.depot)} gold).` };
}

/** Frame do jogo para executar a decisão. */
export function frameForDecision(id, d) {
    const pokemonId = Number(id);
    if (d.action === 'guardar') return { t: 'colecao.mover', pokemonId, para: 'colecao' };
    if (d.action === 'vender') return { t: 'shop.sellPokemon', pokemonId };
    if (d.action === 'anunciar') {
        return { t: 'market.criar', tipo: 'pokemon', pokemonId, casaId: null, bicicletaId: null, qtd: 1, preco: d.price, moeda: 'gold', dias: d.dias };
    }
    return null;
}

/** Normaliza o patch de config do destino dos drops (só as chaves presentes). */
export function normalizeDropPatch(patch, next) {
    const num = (k, min, max, step = 1) => {
        if (patch[k] === undefined) return;
        const n = Number(patch[k]);
        if (Number.isFinite(n)) next[k] = Math.max(min, Math.min(max, Math.round(n / step) * step));
    };
    if (patch.dropRouteEnabled !== undefined) next.dropRouteEnabled = Boolean(patch.dropRouteEnabled);
    if (patch.dropSellMarket !== undefined) next.dropSellMarket = Boolean(patch.dropSellMarket);
    if (patch.dropRouteMode !== undefined) next.dropRouteMode = patch.dropRouteMode === 'auto' ? 'auto' : 'sugerir';
    if (patch.dropRest !== undefined) next.dropRest = patch.dropRest === 'vender' ? 'vender' : 'deixar';
    if (patch.dropMinConfidence !== undefined) {
        next.dropMinConfidence = ['baixa', 'media', 'alta'].includes(patch.dropMinConfidence) ? patch.dropMinConfidence : 'media';
    }
    num('dropKeepNota', 0, 10, 0.1);
    if (next.dropKeepNota !== undefined) next.dropKeepNota = Math.round(next.dropKeepNota * 10) / 10;
    num('dropPricePct', 50, 200);
    num('dropKeepFinalMult', 0, 50, 0.5);
    num('dropListDays', 1, 30);
    num('dropMinProfitPct', 0, 1000);
    num('dropMaxListingsHour', 0, 60);
    return next;
}
