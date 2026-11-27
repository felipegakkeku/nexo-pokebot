// Destino dos drops: para cada Pokémon novo que cai no depot, decide entre guardar na coleção,
// anunciar no mercado pela média ou seguir o resto (deixar, vender no depot, sacrificar ou oferenda), conforme a config.
// Taxas e diária do anúncio seguem o jogo (shared/taxa-mercado.mjs e o diálogo de dias do mercado).
import { isProtectedSpecial, motivosEspecial, taxaOrbDaVenda, liquidoVenda } from './pvp-meta.mjs';

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

function resolveOrbFeeRate(price, tipo = 'pokemon') {
    const p = Number(price) || 0;
    if (p <= 0) return 0.15;
    if (typeof taxaOrbDaVenda === 'function') {
        const feeOrbs = Number(taxaOrbDaVenda(p, tipo));
        if (Number.isFinite(feeOrbs) && feeOrbs >= 0) return feeOrbs / p;
    }
    if (tipo === 'pokemon') {
        if (p <= 500) return 0.13;
        if (p <= 5000) return 0.10;
        return 0.075;
    }
    return 0.15;
}

/** Regras do mercado vindas do welcome do jogo, com os padrões do cliente quando faltam. */
export function marketRulesOf(welcome) {
    const reg = welcome?.mercado || {};
    const pct = welcome?.economia?.taxaMercadoGoldPct ?? reg.taxaGoldPct;
    return {
        taxaGold: Number.isFinite(pct) ? pct / 100 : TAXA_GOLD_PADRAO,
        taxaOrb: resolveOrbFeeRate,
        diaria: Number.isFinite(reg.taxaDiaria) ? reg.taxaDiaria : DIARIA_PADRAO,
        diasMin: Number.isFinite(reg.diasMin) ? reg.diasMin : 1,
        diasMax: Number.isFinite(reg.diasMax) ? reg.diasMax : 30,
        precoMinGold: Number.isFinite(reg.precoMinGold) ? reg.precoMinGold : PRECO_MIN_GOLD,
    };
}

/** Quanto sobra de um anúncio (gold ou orb): preço menos a taxa de venda e a diária (gold). */
export function netOfListing(price, dias, rules, moeda = 'gold', tipo = 'pokemon') {
    if (moeda === 'orb') {
        if (typeof liquidoVenda === 'function') {
            const net = Number(liquidoVenda(price, 'orb', tipo));
            if (Number.isFinite(net) && net >= 0) return net;
        }
        return Math.floor(price * (1 - resolveOrbFeeRate(price, tipo)));
    }
    return Math.floor(price * (1 - rules.taxaGold)) - rules.diaria * dias;
}

function getSpecialBlockReasons(row) {
    if (!row || typeof row !== 'object') return [];
    const out = new Set();
    if (Array.isArray(row.motivosEspecial)) {
        for (const m of row.motivosEspecial) if (m) out.add(String(m));
    }
    if (typeof motivosEspecial === 'function') {
        const list = motivosEspecial(row);
        if (Array.isArray(list)) {
            for (const m of list) if (m) out.add(String(m));
        }
    }
    if (row.protectedSpecial || (typeof isProtectedSpecial === 'function' && isProtectedSpecial(row))) {
        if (out.size === 0) out.add('especial');
    }
    if (row.shiny) out.add('shiny');
    if (row.legend || row.lendario) out.add('lendario');
    if (Number(row.potencia) >= 5 || row.p5) out.add('p5');
    if (row.mega) out.add('mega');
    if (Number(row.level ?? row.nivel ?? 0) > 100) out.add('nivel > 100');
    if (row.zmove || row.zMove) out.add('zmove');
    if (row.aoe || row.tmAoe) out.add('aoe');
    if (row.refino && typeof row.refino === 'object' && Object.values(row.refino).some((v) => Number(v) > 0)) {
        out.add('refino');
    }
    return [...out];
}

/**
 * Decide o destino de um Pokémon já avaliado pelo consultor (uma linha de advisePokemons).
 * @returns {{action:'guardar'|'anunciar'|'vender'|'sacrifice'|'oferenda'|'deixar', reason:string, price?:number, dias?:number, net?:number, protectedSpecial?:boolean, motivosEspecial?:string[]}}
 */
export function decideDrop(row, cfg = {}, rules = marketRulesOf(null)) {
    const c = { ...DROP_DEFAULTS, ...cfg };
    if (!row) return { action: 'deixar', reason: 'Sem dados.' };
    const specialReasons = getSpecialBlockReasons(row);
    if (specialReasons.length > 0) {
        return {
            action: 'guardar',
            protectedSpecial: true,
            motivosEspecial: specialReasons,
            reason: `Especial protegido (${specialReasons.join(', ')}): vai para a coleção.`,
        };
    }
    const best = row.potential;
    // Regra 1 (sozinha basta): nota máxima. Vale a da forma final ou a de agora, quando ele já é a forma final.
    const maxNota = Math.max(row.maxNota ?? -1, best?.nota ?? -1, row.nota ?? -1);
    if (maxNota >= 0 && maxNota >= Number(c.dropKeepNota) - 1e-9) {
        const viaFinal = best?.nota != null && best.nota >= maxNota - 1e-9;
        return {
            action: 'guardar',
            reason: viaFinal
                ? `Na forma final (${best.name}${best.level ? `, Nv ${fmt(best.level)}` : ''}) chega a nota ${maxNota.toFixed(1)}.`
                : `Nota ${maxNota.toFixed(1)} já na forma final.`,
        };
    }
    // Regra 2 (independente da nota): valor da forma final.
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
        const net = netOfListing(price, dias, rules, 'gold');
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
    if (c.dropRest === 'sacrifice' || c.dropRest === 'sacrificar') {
        return { action: 'sacrifice', reason: `Segue para sacrifício (depot pagaria ${fmt(row.depot)} gold).` };
    }
    if (c.dropRest === 'oferenda') {
        return { action: 'oferenda', reason: `Aguarda lote 5/5 para oferenda (depot pagaria ${fmt(row.depot)} gold).` };
    }
    return { action: 'deixar', reason: `Fica no depot (paga ${fmt(row.depot)} gold).` };
}

/** Frame do jogo para executar a decisão (sempre bloqueando ações destrutivas em especiais). */
export function frameForDecision(id, d, extra = {}) {
    if (!d) return null;
    const isDestructive = d.action === 'vender' || d.action === 'sacrifice' || d.action === 'sacrificar' || d.action === 'oferenda';
    if (isDestructive) {
        if (d.protectedSpecial) return null;
        if (extra?.pokemon && getSpecialBlockReasons(extra.pokemon).length > 0) return null;
        if (Array.isArray(extra?.pokemons) && extra.pokemons.some((p) => getSpecialBlockReasons(p).length > 0)) return null;
        if (d.pokemon && getSpecialBlockReasons(d.pokemon).length > 0) return null;
    }
    const pokemonId = Array.isArray(id) ? Number(id[0]) : Number(id);
    if (d.action === 'guardar') return { t: 'colecao.mover', pokemonId, para: 'colecao' };
    if (d.action === 'vender') return { t: 'shop.sellPokemon', pokemonId };
    if (d.action === 'sacrifice' || d.action === 'sacrificar') {
        const ids = Array.isArray(d.pokemonIds)
            ? d.pokemonIds.map(Number).filter(Number.isFinite)
            : (Array.isArray(id) ? id.map(Number).filter(Number.isFinite) : [pokemonId]);
        if (ids.length === 0) return null;
        return { t: 'sacrificio.sacrificar', pokemonIds: ids };
    }
    if (d.action === 'oferenda') {
        const ids = Array.isArray(d.pokemonIds)
            ? d.pokemonIds.map(Number).filter(Number.isFinite)
            : (Array.isArray(id)
                ? id.map(Number).filter(Number.isFinite)
                : (Array.isArray(extra?.oferendaBatch) ? extra.oferendaBatch.map(Number).filter(Number.isFinite) : []));
        if (ids.length < 5) return null;
        return { t: 'oferenda.girar', pokemonIds: ids.slice(0, 5) };
    }
    if (d.action === 'anunciar') {
        return {
            t: 'market.criar',
            tipo: 'pokemon',
            pokemonId,
            casaId: null,
            bicicletaId: null,
            qtd: 1,
            preco: d.price,
            moeda: d.moeda === 'orb' ? 'orb' : 'gold',
            dias: d.dias,
        };
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
    if (patch.dropRest !== undefined) {
        const allowed = ['deixar', 'vender', 'sacrifice', 'sacrificar', 'oferenda'];
        next.dropRest = allowed.includes(patch.dropRest) ? patch.dropRest : 'deixar';
    }
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
