// Mecanicas de meta PvP, economia avancada, eventos, bestiario, safari e gestao de conta
// alinhadas a pokeidle.io v1.492.0.

export const PASSIVAS_DESDE_MS = Date.UTC(2026, 10, 29, 3, 0, 0);
export const BST_MAX_PASSIVA = 500;

export const PVP_PASSIVAS = Object.freeze([
    Object.freeze({
        id: 'recover',
        nome: 'Recover',
        tipo: 'NORMAL',
        gatilho: 'cura',
        icone: '/img/tipos/normal.svg',
        resumo: 'Cura 20% HP ao atingir 50% HP',
        curaHpPct: 20,
        limiarHpPct: 50,
    }),
    Object.freeze({
        id: 'burn',
        nome: 'Burn',
        tipo: 'FIRE',
        gatilho: 'ciclo',
        icone: '/img/tipos/fire.svg',
        resumo: '4%/s por 5s = 20% de dano',
        queimaduraPctPorSeg: 4,
        duracaoSeg: 5,
        danoTotalPct: 20,
    }),
    Object.freeze({
        id: 'rain_dance',
        nome: 'Rain Dance',
        tipo: 'WATER',
        gatilho: 'inicio',
        icone: '/img/tipos/water.svg',
        resumo: '+20% dano e -10% recarga',
        bonusDanoPct: 20,
        reducaoCdPct: 10,
    }),
    Object.freeze({
        id: 'leech_seed',
        nome: 'Leech Seed',
        tipo: 'GRASS',
        gatilho: 'ciclo',
        icone: '/img/tipos/grass.svg',
        resumo: '1.5%/s por 10s + ate 15% cura',
        drenoPctPorSeg: 1.5,
        duracaoSeg: 10,
        rouboVidaPct: 15,
    }),
    Object.freeze({
        id: 'paralyze',
        nome: 'Paralyze',
        tipo: 'ELECTRIC',
        gatilho: 'ciclo',
        icone: '/img/tipos/electric.svg',
        resumo: '12s, +30% recarga + 25% falha',
        duracaoSeg: 12,
        penalidadeCdPct: 30,
        chanceFalhaPct: 25,
    }),
    Object.freeze({
        id: 'freeze',
        nome: 'Freeze',
        tipo: 'ICE',
        gatilho: 'ciclo',
        icone: '/img/tipos/ice.svg',
        resumo: '2.5s + +20% dano recebido',
        duracaoSeg: 2.5,
        aumentoDanoRecebidoPct: 20,
    }),
    Object.freeze({
        id: 'rock_smash',
        nome: 'Rock Smash',
        tipo: 'FIGHTING',
        gatilho: 'ciclo',
        icone: '/img/tipos/fighting.svg',
        resumo: '-20% defesa por 15s',
        reducaoDefInimigaPct: 20,
        duracaoSeg: 15,
    }),
    Object.freeze({
        id: 'poison',
        nome: 'Poison',
        tipo: 'POISON',
        gatilho: 'ciclo',
        icone: '/img/tipos/poison.svg',
        resumo: '1.5%/s por 12s = 18%',
        venenoPctPorSeg: 1.5,
        duracaoSeg: 12,
        danoTotalPct: 18,
    }),
    Object.freeze({
        id: 'dig',
        nome: 'Dig',
        tipo: 'GROUND',
        gatilho: 'ciclo',
        icone: '/img/tipos/ground.svg',
        resumo: 'Escava no ciclo para evitar dano',
    }),
    Object.freeze({
        id: 'whirlwind',
        nome: 'Whirlwind',
        tipo: 'FLYING',
        gatilho: 'ciclo',
        icone: '/img/tipos/flying.svg',
        resumo: '+15% dano',
        bonusDanoPct: 15,
    }),
    Object.freeze({
        id: 'confusion',
        nome: 'Confusion',
        tipo: 'PSYCHIC',
        gatilho: 'ciclo',
        icone: '/img/tipos/psychic.svg',
        resumo: 'Aplica confusao no ciclo',
    }),
    Object.freeze({
        id: 'swarm',
        nome: 'Swarm',
        tipo: 'BUG',
        gatilho: 'inicio',
        icone: '/img/tipos/bug.svg',
        resumo: '+35% dano, +5% por inseto ate +50%',
        bonusDanoPct: 35,
        bonusPorInsetoPct: 5,
        maxBonusDanoPct: 50,
    }),
    Object.freeze({
        id: 'rocky_helmet',
        nome: 'Rocky Helmet',
        tipo: 'ROCK',
        gatilho: 'inicio',
        icone: '/img/tipos/rock.svg',
        resumo: 'Devolve 20% dano',
        reflexoPct: 20,
    }),
    Object.freeze({
        id: 'fear',
        nome: 'Fear',
        tipo: 'GHOST',
        gatilho: 'ciclo',
        icone: '/img/tipos/ghost.svg',
        resumo: 'Medo por 4s',
        duracaoSeg: 4,
    }),
    Object.freeze({
        id: 'intimidate',
        nome: 'Intimidate',
        tipo: 'DRAGON',
        gatilho: 'inicio',
        icone: '/img/tipos/dragon.svg',
        resumo: '-20% dano inimigo',
        reducaoDanoInimigoPct: 20,
        reducaoDanoPct: 20,
    }),
    Object.freeze({
        id: 'assurance',
        nome: 'Assurance',
        tipo: 'DARK',
        gatilho: 'ciclo',
        icone: '/img/tipos/dark.svg',
        resumo: '+25% dano escalando com HP faltando',
        bonusDanoPct: 25,
    }),
    Object.freeze({
        id: 'iron_defense',
        nome: 'Iron Defense',
        tipo: 'STEEL',
        gatilho: 'inicio',
        icone: '/img/tipos/steel.svg',
        resumo: '+35% defesa',
        bonusDefPct: 35,
    }),
    Object.freeze({
        id: 'charm',
        nome: 'Charm',
        tipo: 'FAIRY',
        gatilho: 'ciclo',
        icone: '/img/tipos/fairy.svg',
        resumo: '+10% dano',
        bonusDanoPct: 10,
    }),
]);

const PASSIVA_POR_TIPO = new Map(PVP_PASSIVAS.map((p) => [p.tipo, p]));

/**
 * Retorna a passiva PvP do tipo primario da especie quando seu BST <= 500.
 * @param {object|null} esp Especie do catalogo.
 * @returns {object|null} Passiva ou null se BST > 500 ou invalido.
 */
export function passivaParaEspecie(esp) {
    if (!esp || typeof esp !== 'object') return null;
    const bstRaw = Number(esp.bst);
    const bst = Number.isFinite(bstRaw)
        ? bstRaw
        : (Number(esp.baseHp) || 0)
            + (Number(esp.baseAtk) || 0)
            + (Number(esp.baseDef) || 0)
            + (Number(esp.baseSpAtk) || 0)
            + (Number(esp.baseSpDef) || 0)
            + (Number(esp.baseSpeed) || 0);
    if (!(bst > 0) || bst > BST_MAX_PASSIVA) return null;
    const tipo = String(esp.type1 ?? esp.tipo1 ?? esp.tipos?.[0] ?? '').toUpperCase();
    return PASSIVA_POR_TIPO.get(tipo) ?? null;
}

// ---------- Arena e Guerra de Guilda ----------
export const ARENA_NIVEL_CHEIO = 150;
export const ARENA_EXPO_GINASIO = 0.45;
export const ARENA_EXPO_GUERRA = 0.20;

/**
 * Nivel efetivo escalonado na Arena de Ginasio ou Guerra de Guilda.
 * @param {number} level Nivel real do Pokemon.
 * @param {'ginasio'|'guerra'|'war'} [mode='ginasio'] Modo da arena.
 * @returns {number} Nivel efetivo na arena.
 */
export function effectiveArenaLevel(level, mode = 'ginasio') {
    const n = Math.max(1, Math.floor(Number(level) || 1));
    if (n <= ARENA_NIVEL_CHEIO) return n;
    const expo = mode === 'guerra' || mode === 'war' ? ARENA_EXPO_GUERRA : ARENA_EXPO_GINASIO;
    return Math.max(
        ARENA_NIVEL_CHEIO,
        Math.round(ARENA_NIVEL_CHEIO * (n / ARENA_NIVEL_CHEIO) ** expo)
    );
}

/**
 * Pontuacao na Guerra de Guilda: 60 / sqrt(queda) + 40 / sqrt(pos) se kills > 0.
 * @param {number} dropOrder Ordem de queda (1..N).
 * @param {number} killRank Posicao no ranking de abates (1..N).
 * @param {number} kills Total de abates do jogador.
 * @returns {number} Pontuacao calculada.
 */
export function guildWarScore(dropOrder, killRank, kills) {
    const q = Number(dropOrder);
    const pos = Number(killRank);
    const k = Number(kills) || 0;
    const dropPts = Number.isFinite(q) && q > 0 ? 60 / Math.sqrt(q) : 0;
    const killPts = k > 0 && Number.isFinite(pos) && pos > 0 ? 40 / Math.sqrt(pos) : 0;
    return dropPts + killPts;
}

// ---------- Refino ----------
export const REFINO_CUSTO_BASE = 500;
export const REFINO_TETO_TECNICO = 9999;
export const STATS_REFINAVEIS = Object.freeze(['hp', 'atk', 'def', 'spAtk', 'spDef']);

/**
 * Custo do proximo nivel de refino a partir do nivel atual n: 500 * (3n^2 + 3n + 1).
 * @param {number} n Nivel atual de refino do stat.
 * @returns {number} Custo em gold.
 */
export function custoDoRefino(n) {
    const k = Math.max(0, Math.floor(Number(n) || 0));
    return REFINO_CUSTO_BASE * (3 * k * k + 3 * k + 1);
}

/**
 * Custo acumulado total para atingir o nivel n de refino: 500 * n^3.
 * @param {number} n Nivel alvo de refino.
 * @returns {number} Custo acumulado em gold.
 */
export function custoTotalDoRefino(n) {
    const k = Math.max(0, Math.min(REFINO_TETO_TECNICO, Math.floor(Number(n) || 0)));
    return REFINO_CUSTO_BASE * k ** 3;
}

function parseRefinoObj(raw) {
    let obj = raw;
    if (typeof obj === 'string') {
        try {
            obj = JSON.parse(obj);
        } catch {
            obj = null;
        }
    }
    const out = {};
    for (const k of STATS_REFINAVEIS) {
        const val = Math.floor(Number(obj?.[k]) || 0);
        out[k] = val > 0 ? Math.min(REFINO_TETO_TECNICO, val) : 0;
    }
    return out;
}

/**
 * Sugere o stat mais barato para o proximo refino (menor nivel atual abaixo do teto).
 * @param {object|string|null} refinoObj Mapa de refinos atuais.
 * @returns {{ stat: string, currentLevel: number, nextLevel: number, cost: number }|null} Sugestao ou null se no teto.
 */
export function sugerirProximoRefino(refinoObj) {
    const norm = parseRefinoObj(refinoObj);
    let bestStat = null;
    let bestLevel = Infinity;
    for (const stat of STATS_REFINAVEIS) {
        const lv = norm[stat];
        if (lv < REFINO_TETO_TECNICO && lv < bestLevel) {
            bestLevel = lv;
            bestStat = stat;
        }
    }
    if (!bestStat) return null;
    return {
        stat: bestStat,
        currentLevel: bestLevel,
        nextLevel: bestLevel + 1,
        cost: custoDoRefino(bestLevel),
    };
}

// ---------- Protecao de especiais ----------
const LENDARIO_OU_MITICO_DEX = new Set([
    144, 145, 146, 150, 151,
    243, 244, 245, 249, 250, 251,
    377, 378, 379, 380, 381, 382, 383, 384, 385, 386,
    480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, 494,
    638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649,
    716, 717, 718, 719, 720, 721,
    772, 773, 785, 786, 787, 788, 789, 790, 791, 792, 793, 794, 795, 796, 797, 798, 799, 800, 801, 802, 803, 804, 805, 806, 807, 808, 809,
    888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 905,
    1001, 1002, 1003, 1004, 1007, 1008, 1009, 1010, 1014, 1015, 1016, 1017, 1020, 1021, 1022, 1023, 1024, 1025,
]);

function baseDexFromSpeciesId(speciesId) {
    const id = Number(speciesId);
    if (!Number.isFinite(id) || id <= 0) return null;
    if (id >= 13000) return id % 1000;
    if (id >= 3000 && id < 4000) return id - 3000;
    if (id >= 4000 && id < 13000) return id % 1000;
    return id;
}

/**
 * Lista os motivos pelos quais um Pokemon e considerado especial/protegido.
 * @param {object|null} pk Objeto do Pokemon.
 * @returns {Array<string>} Motivos encontrados.
 */
export function motivosEspecial(pk) {
    if (!pk || typeof pk !== 'object') return [];
    const motivos = [];
    if (pk.shiny) motivos.push('shiny');
    const spId = Number(pk.speciesId);
    const dex = baseDexFromSpeciesId(spId);
    const isLend = Boolean(
        pk.lendario
        || pk.mitico
        || pk.legendary
        || pk.mythic
        || pk.rarity === 'LEGENDARY'
        || pk.rarity === 'MYTHIC'
        || (dex != null && LENDARIO_OU_MITICO_DEX.has(dex))
    );
    if (isLend) motivos.push('lendario');
    const isMega = Boolean(pk.mega || pk.isMega || pk.megaDeDex != null || (spId >= 3000 && spId < 4000));
    if (isMega) motivos.push('mega');
    const level = Number(pk.level ?? pk.nivel) || 1;
    if (level > 100) motivos.push('nivel > 100');
    if (Number(pk.potencia) >= 5) motivos.push('p5');
    if (pk.tmElemental || pk.zmove || pk.zMove) motivos.push('zmove');
    if (pk.tmAoe || pk.aoe) motivos.push('aoe');
    const ref = parseRefinoObj(pk.refino);
    if (STATS_REFINAVEIS.some((k) => ref[k] > 0)) motivos.push('refino');
    return motivos;
}

/**
 * Indica se um Pokemon deve ser protegido de vendas/oferendas/sacrificios automaticos.
 * @param {object|null} pk Objeto do Pokemon.
 * @returns {boolean} Verdadeiro se possui algum motivo especial.
 */
export function isProtectedSpecial(pk) {
    return motivosEspecial(pk).length > 0;
}

// ---------- Mercado (taxa e liquido) ----------
/**
 * Calcula a taxa em orbs cobrada na venda no mercado.
 * Itens: 15%. Pokemon: progressiva por faixa (13% ate 500, 10% ate 5000, 7.5% acima).
 * @param {number} total Preco bruto em orbs.
 * @param {'item'|'pokemon'|string} [tipo='item'] Tipo do anuncio.
 * @returns {number} Taxa cobrada em orbs.
 */
export function taxaOrbDaVenda(total, tipo = 'item') {
    const valor = Math.max(0, Number(total) || 0);
    if (valor <= 0) return 0;
    const pct = tipo === 'pokemon'
        ? (valor <= 500 ? 0.13 : (valor <= 5000 ? 0.10 : 0.075))
        : 0.15;
    return Math.round(valor * pct);
}

/**
 * Valor liquido recebido pelo vendedor apos descontar a taxa de venda.
 * @param {number} total Preco bruto.
 * @param {'gold'|'orb'} [moeda='gold'] Moeda do anuncio.
 * @param {'item'|'pokemon'|string} [tipo='item'] Tipo do anuncio.
 * @returns {number} Valor liquido estimado.
 */
export function liquidoVenda(total, moeda = 'gold', tipo = 'item') {
    const valor = Math.max(0, Number(total) || 0);
    if (valor <= 0) return 0;
    if (moeda === 'orb') {
        return Math.max(0, valor - taxaOrbDaVenda(valor, tipo));
    }
    return Math.floor(valor * 0.85);
}

// ---------- Pity Shiny ----------
export const PITY_SHINY_BOLAS = 50;
export const PITY_SHINY_HORA_MS = 3_600_000;

/**
 * Resume o estado atual do Pity Shiny na janela de 1 hora e 50 bolas.
 * @param {object|null} st Estado do pity ({ bolas, expiraEm, inicio, atualizouEm }).
 * @param {number} [nowMs=Date.now()] Timestamp atual em ms.
 * @returns {{ bolas: number, maxBolas: number, restamBolas: number, pct: number, garantido: boolean, expiraEm: number|null, restanteMs: number, ativo: boolean }} Resumo do pity.
 */
export function resumoPityShiny(st, nowMs = Date.now()) {
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    if (!st || typeof st !== 'object') {
        return {
            bolas: 0,
            maxBolas: PITY_SHINY_BOLAS,
            restamBolas: PITY_SHINY_BOLAS,
            pct: 0,
            garantido: false,
            expiraEm: null,
            restanteMs: 0,
            ativo: false,
        };
    }
    const rawBolas = Math.max(0, Math.floor(Number(st.bolas ?? st.count ?? st.tentativas) || 0));
    const startTs = Number(st.inicio ?? st.atualizouEm ?? st.ultimoEm);
    const explicitExp = Number(st.expiraEm ?? st.ate);
    const expiraEm = Number.isFinite(explicitExp) && explicitExp > 0
        ? explicitExp
        : (Number.isFinite(startTs) && startTs > 0 ? startTs + PITY_SHINY_HORA_MS : null);

    const expired = expiraEm != null && now >= expiraEm;
    const bolas = expired ? 0 : rawBolas;
    const restanteMs = expiraEm != null ? Math.max(0, expiraEm - now) : (bolas > 0 ? PITY_SHINY_HORA_MS : 0);
    const pct = Math.min(100, Math.round((bolas / PITY_SHINY_BOLAS) * 1000) / 10);

    return {
        bolas,
        maxBolas: PITY_SHINY_BOLAS,
        restamBolas: Math.max(0, PITY_SHINY_BOLAS - bolas),
        pct,
        garantido: bolas >= PITY_SHINY_BOLAS,
        expiraEm: expired ? null : expiraEm,
        restanteMs,
        ativo: bolas > 0 && !expired,
    };
}

// ---------- Bestiario ----------
export const BESTIARIO_DEGRAUS = Object.freeze([
    Object.freeze({ abates: 25000, bp: 5 }),
    Object.freeze({ abates: 50000, bp: 15 }),
    Object.freeze({ abates: 100000, bp: 50 }),
]);

/**
 * Calcula o progresso do Bestiario e o tempo estimado para o proximo degrau.
 * @param {number} kills Total de abates da especie.
 * @param {number} [killsPerMin=0] Ritmo de abates por minuto.
 * @returns {{ kills: number, tier: number, bp: number, bonusPct: number, next: object|null, killsRemaining: number, pct: number, etaMin: number|null, etaMs: number|null }} Progresso no bestiario.
 */
export function bestiaryProgress(kills, killsPerMin = 0) {
    const k = Math.max(0, Number(kills) || 0);
    let tier = 0;
    for (const d of BESTIARIO_DEGRAUS) {
        if (k >= d.abates) tier++;
    }
    const bp = tier > 0 ? BESTIARIO_DEGRAUS[tier - 1].bp : 0;
    const next = BESTIARIO_DEGRAUS[tier] ?? null;
    const killsRemaining = next ? Math.max(0, next.abates - k) : 0;
    const prevThreshold = tier > 0 ? BESTIARIO_DEGRAUS[tier - 1].abates : 0;
    const pct = next
        ? Math.min(100, Math.max(0, ((k - prevThreshold) / (next.abates - prevThreshold)) * 100))
        : 100;
    const rate = Number(killsPerMin) || 0;
    const etaMin = next ? (rate > 0 ? killsRemaining / rate : null) : 0;
    const etaMs = etaMin != null ? Math.round(etaMin * 60_000) : null;

    return {
        kills: k,
        tier,
        bp,
        bonusPct: bp / 100,
        next,
        killsRemaining,
        pct,
        etaMin,
        etaMs,
    };
}

// ---------- Bosses ----------
export const REGIOES_BOSS = Object.freeze([
    'kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea',
]);
export const PREMIOS_DA_TRINCA = Object.freeze(['tm', 'mega', 'tickets']);
export const ROTACAO_BOSS_DIA_ZERO = '2026-11-17';

const FUSO_BRASILIA_MS = 3 * 3600_000;
const ANTECIPACAO_SAZONAL_MS = 6 * 3600_000;
const DESLOCAMENTO_SAZONAL_MS = FUSO_BRASILIA_MS - ANTECIPACAO_SAZONAL_MS;
const DIA_MS = 86_400_000;
const DIA_ZERO_UTC_MS = Date.parse(`${ROTACAO_BOSS_DIA_ZERO}T00:00:00Z`);

/**
 * Retorna o premio da trinca ('tm', 'mega' ou 'tickets') para a posicao/regiao no instante dado.
 * A rotacao vira diariamente as 18h BRT (21:00 UTC).
 * @param {number|string} posicao Indice (0..8) ou nome da regiao.
 * @param {number} [nowMs=Date.now()] Timestamp em ms.
 * @returns {'tm'|'mega'|'tickets'} Premio ativo na posicao.
 */
export function premioDoBossNoInstante(posicao, nowMs = Date.now()) {
    const pos = typeof posicao === 'string'
        ? Math.max(0, REGIOES_BOSS.indexOf(posicao.toLowerCase()))
        : Math.max(0, Math.floor(Number(posicao) || 0));
    const t = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    const dayKey = new Date(t - DESLOCAMENTO_SAZONAL_MS).toISOString().slice(0, 10);
    const dayUtcMs = Date.parse(`${dayKey}T00:00:00Z`);
    const dayOffset = Math.round((dayUtcMs - DIA_ZERO_UTC_MS) / DIA_MS);
    const idx = ((pos + dayOffset) % PREMIOS_DA_TRINCA.length + PREMIOS_DA_TRINCA.length) % PREMIOS_DA_TRINCA.length;
    return PREMIOS_DA_TRINCA[idx];
}

/**
 * Estima as chances de drops raros do boss de acordo com o par (1..N).
 * @param {number} par Indice do par de boss (1-based).
 * @returns {{ par: number, tm: number, mega: number, tickets: number }} Probabilidades por categoria.
 */
export function chancesBossPorPar(par) {
    const p = Math.max(1, Math.floor(Number(par) || 1));
    const step = p - 1;
    return {
        par: p,
        tm: Math.min(1, 0.05 + step * 0.025),
        mega: Math.min(1, 0.08 + step * 0.03),
        tickets: Math.min(1, 0.15 + step * 0.04),
    };
}

// ---------- Safari ----------
export const SAFARI_BONUS_A_CADA = 6;
export const SAFARI_BONUS_MS = 1_800_000;
export const MULT_SHINY_TUDO_NO_SAFARI = 2 * 1.15 * 1.15 * 1.15;

/**
 * Calcula a duracao total no Safari em ms para a quantidade de tickets informada,
 * incluindo o ticket bonus a cada 6 gastos juntos.
 * @param {number} tickets Quantidade de Safari Tickets.
 * @returns {number} Duracao total em ms.
 */
export function duracaoDoSafariMs(tickets) {
    const n = Math.max(0, Math.floor(Number(tickets) || 0));
    const bonus = Math.floor(n / SAFARI_BONUS_A_CADA);
    return (n + bonus) * SAFARI_BONUS_MS;
}

/**
 * Calcula a quantidade otima de Safari Tickets para maximizar lotes completos de 6.
 * @param {number} available Quantidade disponivel na mochila.
 * @returns {{ available: number, ticketsToUse: number, bonusTickets: number, totalSlots: number, durationMs: number, remainder: number, waitForBonus: number }} Plano otimo.
 */
export function optimalSafariTickets(available) {
    const avail = Math.max(0, Math.floor(Number(available) || 0));
    const fullBatches = Math.floor(avail / SAFARI_BONUS_A_CADA);
    const ticketsToUse = fullBatches > 0 ? fullBatches * SAFARI_BONUS_A_CADA : avail;
    const bonusTickets = Math.floor(ticketsToUse / SAFARI_BONUS_A_CADA);
    const remainder = avail - ticketsToUse;
    return {
        available: avail,
        ticketsToUse,
        bonusTickets,
        totalSlots: ticketsToUse + bonusTickets,
        durationMs: duracaoDoSafariMs(ticketsToUse),
        remainder,
        waitForBonus: fullBatches === 0 && avail > 0 ? SAFARI_BONUS_A_CADA - avail : 0,
    };
}

// ---------- Eventos: Raid e Showdown ----------
export const RAID_SCHEDULE = Object.freeze({
    name: 'Raid Gigantamax',
    hoursBrt: Object.freeze([10, 14, 18, 22]),
    durationMs: 30 * 60_000,
});

export const SHOWDOWN_SCHEDULE = Object.freeze({
    name: 'Showdown',
    hoursBrt: Object.freeze([15, 21]),
    durationMs: 30 * 60_000,
});

function nextOccurrenceForHourBrt(hourBrt, durationMs, nowMs) {
    const nowBrtMs = nowMs - FUSO_BRASILIA_MS;
    const dayStartBrtMs = Math.floor(nowBrtMs / DIA_MS) * DIA_MS;
    for (let d = 0; d <= 1; d++) {
        const startsAt = dayStartBrtMs + d * DIA_MS + hourBrt * 3600_000 + FUSO_BRASILIA_MS;
        const endsAt = startsAt + durationMs;
        if (endsAt > nowMs) {
            return {
                startsAt,
                endsAt,
                active: nowMs >= startsAt && nowMs < endsAt,
                inMs: Math.max(0, startsAt - nowMs),
            };
        }
    }
    return null;
}

/**
 * Lista os proximos eventos de Raid e Showdown em ordem cronologica a partir de nowMs.
 * @param {number} [nowMs=Date.now()] Timestamp em ms.
 * @returns {Array<{ type: 'raid'|'showdown', name: string, hourBrt: number, startsAt: number, endsAt: number, active: boolean, inMs: number }>} Eventos ordenados.
 */
export function getUpcomingEvents(nowMs = Date.now()) {
    const t = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    const events = [];
    for (const [type, sched] of [['raid', RAID_SCHEDULE], ['showdown', SHOWDOWN_SCHEDULE]]) {
        for (const hourBrt of sched.hoursBrt) {
            const occ = nextOccurrenceForHourBrt(hourBrt, sched.durationMs, t);
            if (occ) {
                events.push({
                    type,
                    name: sched.name,
                    hourBrt,
                    ...occ,
                });
            }
        }
    }
    events.sort((a, b) => a.startsAt - b.startsAt || a.type.localeCompare(b.type));
    return events;
}

// ---------- Bicicletas, Casas e Craft ----------
export const BICICLETA_VELOCIDADE = Object.freeze({
    comum: 0.10,
    incomum: 0.20,
    rara: 0.35,
    epica: 0.50,
    lendaria: 0.75,
    mitica: 1.00,
});

export const CASA_XP_SHARE = Object.freeze({
    comum: Object.freeze({ slots: 1, xpPct: 10 }),
    incomum: Object.freeze({ slots: 2, xpPct: 15 }),
    rara: Object.freeze({ slots: 3, xpPct: 22 }),
    epica: Object.freeze({ slots: 4, xpPct: 30 }),
    lendaria: Object.freeze({ slots: 5, xpPct: 40 }),
    mitica: Object.freeze({ slots: 6, xpPct: 55 }),
});

export const MAX_CASAS_EM_USO = 5;

const RARIDADE_MAP = Object.freeze({
    common: 'comum',
    uncommon: 'incomum',
    rare: 'rara',
    epic: 'epica',
    legendary: 'lendaria',
    mythic: 'mitica',
});

function bikeSpeedOf(bike) {
    if (!bike) return 0;
    if (typeof bike.velocidade === 'number' && Number.isFinite(bike.velocidade)) return bike.velocidade;
    const raw = String(bike.raridade ?? bike.rar ?? bike.rarity ?? '').trim().toLowerCase();
    const key = RARIDADE_MAP[raw] || raw;
    return Number(BICICLETA_VELOCIDADE[key]) || 0;
}

/**
 * Encontra a melhor bicicleta disponivel para substituir a equipada atualmente.
 * @param {Array<object>} bikes Lista de bicicletas da conta.
 * @param {number|string|null} [equippedId] ID da bicicleta equipada.
 * @returns {{ upgrade: object, current: object|null, currentSpeed: number, nextSpeed: number, gain: number }|null} Melhor upgrade ou null.
 */
export function findBestBikeUpgrade(bikes = [], equippedId = null) {
    if (!Array.isArray(bikes) || bikes.length === 0) return null;
    const eqStr = equippedId != null ? String(equippedId) : null;
    const current = eqStr ? (bikes.find((b) => b && String(b.id) === eqStr) ?? null) : null;
    const currentSpeed = bikeSpeedOf(current);

    let best = null;
    let bestSpeed = currentSpeed;
    for (const bike of bikes) {
        if (!bike || bike.anunciada) continue;
        if (eqStr && String(bike.id) === eqStr) continue;
        const sp = bikeSpeedOf(bike);
        if (sp > bestSpeed) {
            bestSpeed = sp;
            best = bike;
        }
    }
    if (!best) return null;
    return {
        upgrade: best,
        current,
        currentSpeed,
        nextSpeed: bestSpeed,
        gain: bestSpeed - currentSpeed,
    };
}

const CRAFT_FRAGMENT_CATALOG = Object.freeze([
    { id: 70011, name: 'Chave (Fragmentos)', defaultReq: 5 },
    { id: 70012, name: 'Pedra Shiny (Fragmentos)', defaultReq: 5 },
    { id: 70013, name: 'Bicicleta (Fragmentos)', defaultReq: 5 },
    { id: 70017, name: 'Ovo Shiny (Fragmentos)', defaultReq: 10 },
]);

/**
 * Identifica conjuntos craftaveis na mochila dado um minimo de fragmentos por lote.
 * @param {Record<string, number>|Array<object>} items Mapa de itens ou lista com { id, name, qty, required }.
 * @param {number} [minQty=5] Quantidade minima padrao por craft.
 * @returns {Array<{ id: number, name: string, qty: number, required: number, sets: number, remainder: number }>} Conjuntos prontos.
 */
export function findCraftableSets(items = {}, minQty = 5) {
    const reqBase = Math.max(1, Math.floor(Number(minQty) || 5));
    const out = [];

    if (Array.isArray(items)) {
        for (const it of items) {
            if (!it) continue;
            const qty = Math.max(0, Math.floor(Number(it.qty ?? it.qtd ?? 0) || 0));
            const req = Math.max(1, Math.floor(Number(it.required ?? reqBase) || reqBase));
            if (qty < req) continue;
            const sets = Math.floor(qty / req);
            out.push({
                id: Number(it.id) || 0,
                name: String(it.name ?? it.nome ?? `Item #${it.id ?? '?'}`),
                qty,
                required: req,
                sets,
                remainder: qty - sets * req,
            });
        }
    } else if (items && typeof items === 'object') {
        for (const entry of CRAFT_FRAGMENT_CATALOG) {
            const qty = Math.max(0, Math.floor(Number(items[entry.id] ?? items[String(entry.id)] ?? 0) || 0));
            const req = Math.max(reqBase, entry.defaultReq);
            if (qty < req) continue;
            const sets = Math.floor(qty / req);
            out.push({
                id: entry.id,
                name: entry.name,
                qty,
                required: req,
                sets,
                remainder: qty - sets * req,
            });
        }
    }

    out.sort((a, b) => (b.sets - a.sets) || (b.qty - a.qty));
    return out;
}

// ---------- Teto de Depot e Colecao ----------
export const TETO_DEPOT = 3000;
export const TETO_COLECAO = 3000;

function formatCapBucket(count, cap) {
    const ratio = count / cap;
    const warn = ratio >= 0.90;
    const danger = ratio >= 0.95;
    return {
        count,
        cap,
        pct: Math.round(ratio * 1000) / 10,
        level: danger ? 'danger' : (warn ? 'warn' : 'ok'),
        warn,
        danger,
        full: count >= cap,
    };
}

/**
 * Calcula lotacao de Depot e Colecao contra o teto de 3000 cada (alerta >= 90%, perigo >= 95%).
 * @param {Array<object>} pokemons Lista de Pokemon da conta.
 * @param {Set<number|string>|Array<number|string>|null} [colecaoSet] IDs na colecao.
 * @returns {{ depot: object, colecao: object, anyWarn: boolean, anyDanger: boolean }} Status de capacidade.
 */
export function computeCapStatus(pokemons = [], colecaoSet = null) {
    const colIds = colecaoSet instanceof Set
        ? new Set([...colecaoSet].map(String))
        : (Array.isArray(colecaoSet) ? new Set(colecaoSet.map(String)) : null);

    let depotCount = 0;
    let colecaoCount = 0;
    for (const pk of pokemons || []) {
        if (!pk || pk.id == null) continue;
        const idStr = String(pk.id);
        const inColecao = colIds ? colIds.has(idStr) : Boolean(pk.colecao || pk.travado || pk.location === 'colecao');
        if (inColecao) {
            colecaoCount++;
        } else if (pk.slot == null) {
            depotCount++;
        }
    }

    const depot = formatCapBucket(depotCount, TETO_DEPOT);
    const colecao = formatCapBucket(colecaoCount, TETO_COLECAO);
    return {
        depot,
        colecao,
        anyWarn: depot.warn || colecao.warn,
        anyDanger: depot.danger || colecao.danger,
    };
}

// ---------- Oferenda ----------
/**
 * Seleciona lotes exatos de 5 Pokemon elegiveis para Oferenda, bloqueando especiais
 * e mantendo shinies separados de nao-shinies. Nunca retorna lote parcial (< 5).
 * @param {Array<object>} pokemons Lista de Pokemon disponiveis.
 * @param {Set<number|string>|Array<number|string>|null} [protectedIds] IDs bloqueados manualmente.
 * @param {object} [opts]
 * @param {boolean} [opts.monoTypeOnly=true] Exige Pokemon mono-tipo e agrupa por tipo.
 * @param {boolean} [opts.allowShiny=false] Permite incluir shinies (em lotes separados).
 * @returns {Array<{ shiny: boolean, type: string, pokemonIds: Array<number|string>, pokemons: Array<object> }>} Lotes de 5.
 */
export function selectOferendaBatches(
    pokemons = [],
    protectedIds = null,
    { monoTypeOnly = true, allowShiny = false } = {}
) {
    const blocked = protectedIds instanceof Set
        ? new Set([...protectedIds].map(String))
        : (Array.isArray(protectedIds) ? new Set(protectedIds.map(String)) : new Set());

    const groups = new Map();
    for (const pk of pokemons || []) {
        if (!pk || pk.id == null) continue;
        if (pk.slot != null) continue;
        if (blocked.has(String(pk.id))) continue;

        const motivos = motivosEspecial(pk);
        if (allowShiny) {
            if (motivos.some((m) => m !== 'shiny')) continue;
        } else if (motivos.length > 0) {
            continue;
        }

        const rawTypes = Array.isArray(pk.tipos) && pk.tipos.length
            ? pk.tipos
            : [pk.type1, pk.type2];
        const tipos = [...new Set(rawTypes.filter(Boolean).map((t) => String(t).toUpperCase()))];
        if (monoTypeOnly && tipos.length > 1) continue;

        const isShiny = Boolean(pk.shiny);
        const typeKey = monoTypeOnly ? (tipos[0] || 'ANY') : 'ANY';
        const groupKey = `${isShiny ? 'shiny' : 'normal'}:${typeKey}`;
        let bucket = groups.get(groupKey);
        if (!bucket) {
            bucket = { shiny: isShiny, type: typeKey, items: [] };
            groups.set(groupKey, bucket);
        }
        bucket.items.push(pk);
    }

    const batches = [];
    for (const bucket of groups.values()) {
        const fullCount = Math.floor(bucket.items.length / 5);
        for (let i = 0; i < fullCount; i++) {
            const slice = bucket.items.slice(i * 5, (i + 1) * 5);
            batches.push({
                shiny: bucket.shiny,
                type: bucket.type,
                pokemonIds: slice.map((p) => p.id),
                pokemons: slice,
            });
        }
    }
    return batches;
}

// ---------- Black Friday ----------
export const BLACK_FRIDAY = Object.freeze({
    vitrineDesde: Date.parse('2026-11-25T00:00:00-03:00'),
    inicio: Date.parse('2026-11-27T00:00:00-03:00'),
    fim: Date.parse('2026-11-28T00:00:00-03:00'),
    pct: 50,
});

/**
 * Verifica se a promocao de Black Friday (50% de desconto) esta ativa no instante informado.
 * @param {number} [nowMs=Date.now()] Timestamp em ms.
 * @returns {boolean} Verdadeiro se ativa.
 */
export function isBlackFridayActive(nowMs = Date.now()) {
    const t = Number(nowMs);
    return Number.isFinite(t) && t >= BLACK_FRIDAY.inicio && t < BLACK_FRIDAY.fim;
}

// ---------- Helpers internos de catalogo ----------
function lookupSpecies(speciesCatalog, speciesId) {
    if (!speciesCatalog || speciesId == null) return null;
    const id = Number(speciesId);
    if (!Number.isFinite(id) || id <= 0) return null;
    if (speciesCatalog instanceof Map) return speciesCatalog.get(id) ?? null;
    if (speciesCatalog.byId instanceof Map) return speciesCatalog.byId.get(id) ?? null;
    if (typeof speciesCatalog === 'object') return speciesCatalog[id] ?? speciesCatalog[String(id)] ?? null;
    return null;
}

function extractPokemonTypes(pk, speciesCatalog = null) {
    const esp = lookupSpecies(speciesCatalog, pk?.speciesId ?? pk?.pokeId);
    const raw = [];
    if (Array.isArray(pk?.tipos) && pk.tipos.length > 0) raw.push(...pk.tipos);
    if (pk?.type1) raw.push(pk.type1);
    if (pk?.type2) raw.push(pk.type2);
    if (esp?.type1) raw.push(esp.type1);
    if (esp?.type2) raw.push(esp.type2);
    if (Array.isArray(esp?.tipos)) raw.push(...esp.tipos);
    return [...new Set(raw.filter(Boolean).map((t) => String(t).toUpperCase()))];
}

function ivTotalOf(pk) {
    if (pk?.iv != null && Number.isFinite(Number(pk.iv))) return Number(pk.iv);
    if (pk?.ivTotal != null && Number.isFinite(Number(pk.ivTotal))) return Number(pk.ivTotal);
    if (pk?.ivs && typeof pk.ivs === 'object') {
        return Object.values(pk.ivs).reduce((s, v) => s + (Number(v) || 0), 0);
    }
    return null;
}

// ---------- Risco de fracao do Pity Shiny no Lure ----------
/**
 * Avalia se o Shiny Lure comprado possui fracao restante menor que 60 minutos
 * que sera descartada ao fim do boost (cortarGarantiaNoFim), colocando +50 Beast Balls em risco.
 * @param {object|null} pityShiny Estado do pityShiny (remainingMs, restanteMs, expiraEm, horas, bolas, seg).
 * @param {number} [nowMs=Date.now()] Timestamp atual em ms.
 * @returns {{ atRisk: boolean, minutesLost: number, nextHourShortByMin: number, remainingMs: number, wholeHours: number, bolasAtRisk: number, message: string }}
 */
export function evaluateLureFractionRisk(pityShiny, nowMs = Date.now()) {
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    if (!pityShiny || typeof pityShiny !== 'object') {
        return {
            atRisk: false,
            minutesLost: 0,
            nextHourShortByMin: 0,
            remainingMs: 0,
            wholeHours: 0,
            bolasAtRisk: 0,
            message: '',
        };
    }

    const explicitRem = pityShiny.remainingMs ?? pityShiny.restanteMs;
    const explicitExp = Number(pityShiny.expiraEm ?? pityShiny.ate ?? pityShiny.fim);
    const lureExp = Number(pityShiny.lureExpiraEm ?? pityShiny.lureAte ?? NaN);
    const horasRaw = Number(pityShiny.horas);
    const segRaw = Number(pityShiny.seg);
    const bolas = Math.max(0, Math.floor(Number(pityShiny.bolas ?? pityShiny.count ?? 0) || 0));

    let remainingMs = 0;
    if (explicitRem != null && Number.isFinite(Number(explicitRem))) {
        remainingMs = Math.max(0, Number(explicitRem));
    } else if (Number.isFinite(lureExp) && lureExp > 0) {
        remainingMs = Math.max(0, lureExp - now);
    } else if (Number.isFinite(explicitExp) && explicitExp > 0) {
        remainingMs = Math.max(0, explicitExp - now);
    } else if (Number.isFinite(segRaw) && segRaw > 0) {
        remainingMs = segRaw * 1000;
    } else if (Number.isFinite(horasRaw) && horasRaw > 0) {
        remainingMs = horasRaw * PITY_SHINY_HORA_MS;
    }

    // Se lureExpiraEm termina antes do fim da hora do pity, usa a fracao real disponivel do lure.
    if (Number.isFinite(lureExp) && lureExp > now && Number.isFinite(explicitExp) && explicitExp > lureExp) {
        remainingMs = Math.max(0, lureExp - now);
    }

    const wholeHours = Math.floor(remainingMs / PITY_SHINY_HORA_MS);
    let trailingMs = remainingMs % PITY_SHINY_HORA_MS;

    // Caso horas seja fracionario e remainingMs nao tenha refletido a fracao
    if (trailingMs === 0 && Number.isFinite(horasRaw) && horasRaw > 0) {
        const fracHoras = horasRaw - Math.floor(horasRaw);
        if (fracHoras > 1e-6 && fracHoras < 1 - 1e-6) {
            trailingMs = Math.round(fracHoras * PITY_SHINY_HORA_MS);
        }
    }

    const shinyCaughtThisHour = Boolean(pityShiny.shiny);
    const hasTrailingFraction = trailingMs > 0 && trailingMs < PITY_SHINY_HORA_MS;
    const activeWindow = remainingMs > 0 || bolas > 0 || (Number.isFinite(horasRaw) && horasRaw > 0);
    const atRisk = Boolean(activeWindow && hasTrailingFraction && !(shinyCaughtThisHour && wholeHours === 0));

    if (!atRisk) {
        return {
            atRisk: false,
            minutesLost: 0,
            nextHourShortByMin: 0,
            remainingMs,
            wholeHours,
            bolasAtRisk: 0,
            message: '',
        };
    }

    const minutesLost = Math.max(1, Math.round(trailingMs / 60_000));
    const nextHourShortByMin = Math.max(1, Math.round((PITY_SHINY_HORA_MS - trailingMs) / 60_000));
    const message = `Fracao de Lure de ${minutesLost} min sera descartada por cortarGarantiaNoFim (faltam ${nextHourShortByMin} min para fechar 1h; +50 Beast Balls em risco).`;

    return {
        atRisk: true,
        minutesLost,
        nextHourShortByMin,
        remainingMs,
        wholeHours,
        bolasAtRisk: PITY_SHINY_BOLAS,
        message,
    };
}

// ---------- Selecao de Auto-Boss ----------
/**
 * Seleciona o boss da regiao mais alta desbloqueada pelo treinador que oferece o premio desejado.
 * @param {object|Array<object>|null} bossRotation Rotacao de bosses ({ regions } ou lista de regioes).
 * @param {number} [trainerLevel=0] Nivel atual do treinador.
 * @param {'mega'|'tm'|'tickets'|string} [desiredPrize='mega'] Premio desejado.
 * @returns {{ key: string, region: string, par: number, chances: object, prize: string, nivelMin: number }|null}
 */
export function selectBestAutoBoss(bossRotation, trainerLevel = 0, desiredPrize = 'mega') {
    const regions = Array.isArray(bossRotation)
        ? bossRotation
        : (Array.isArray(bossRotation?.regions) ? bossRotation.regions : []);
    if (regions.length === 0) return null;

    const lv = Math.max(0, Number(trainerLevel) || 0);
    const targetPrize = String(desiredPrize || 'mega').trim().toLowerCase();

    let best = null;
    for (let i = 0; i < regions.length; i++) {
        const entry = regions[i];
        if (!entry || typeof entry !== 'object') continue;
        const region = String(entry.region ?? entry.regiao ?? '').trim().toLowerCase();
        const regIdx = region ? REGIOES_BOSS.indexOf(region) : -1;
        const par0 = Number.isFinite(Number(entry.index))
            ? Math.max(0, Math.floor(Number(entry.index)))
            : (regIdx >= 0 ? regIdx : (Number.isFinite(Number(entry.par)) ? Math.max(0, Math.floor(Number(entry.par)) - 1) : i));
        const nivelMin = Number.isFinite(Number(entry.nivelMin))
            ? Number(entry.nivelMin)
            : 300 + 350 * (par0 ** 3);
        if (lv < nivelMin) continue;

        const prize = String(entry.prize ?? entry.premio ?? '').trim().toLowerCase();
        if (targetPrize !== 'any' && targetPrize !== 'qualquer' && prize !== targetPrize) continue;

        const par1 = par0 + 1;
        const chances = entry.chances || chancesBossPorPar(par1);
        const key = String(entry.key ?? (region || `boss_${par0}`));
        if (!best || par0 > best._par0) {
            best = {
                key,
                region: region || REGIOES_BOSS[par0] || key,
                par: Number(entry.par ?? par1),
                chances,
                prize,
                nivelMin,
                _par0: par0,
            };
        }
    }

    if (!best) return null;
    const result = { ...best };
    delete result._par0;
    return result;
}

// ---------- Recomendacao de Ginasio ----------
const PODIO_BONUS_POR_POS = Object.freeze({ 1: 25, 2: 10, 3: 5 });
const GYM_COOLDOWN_MS = 24 * 3_600_000;

function parseGymPodiumsMap(gyms) {
    const map = new Map();
    const raw = gyms?.podiums ?? gyms?.podios ?? gyms?.podiumsByType ?? gyms;
    if (Array.isArray(raw)) {
        for (const p of raw) {
            if (!p || typeof p !== 'object') continue;
            const tipo = String(p.tipo ?? p.type ?? '').trim().toUpperCase();
            if (!tipo) continue;
            const pos = Number(p.pos ?? p.posicao ?? p.rank ?? 0) || null;
            const bonusPct = Number(p.bonusPct ?? p.buffPct ?? (pos ? PODIO_BONUS_POR_POS[pos] : 0)) || 0;
            map.set(tipo, { pos, bonusPct });
        }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw)) {
            const tipo = String(k || '').trim().toUpperCase();
            if (!PASSIVA_POR_TIPO.has(tipo)) continue;
            if (typeof v === 'number') {
                const pos = v > 0 ? v : null;
                map.set(tipo, { pos, bonusPct: pos ? (PODIO_BONUS_POR_POS[pos] || 0) : 0 });
            } else if (v && typeof v === 'object') {
                const pos = Number(v.pos ?? v.posicao ?? v.rank ?? 0) || null;
                const bonusPct = Number(v.bonusPct ?? v.buffPct ?? (pos ? PODIO_BONUS_POR_POS[pos] : 0)) || 0;
                map.set(tipo, { pos, bonusPct });
            }
        }
    }
    return map;
}

/**
 * Avalia o cooldown de 24h dos ginasios e pontua os 18 tipos conforme a composicao da equipe
 * (respeitando que Pokemon dual-type herda o melhor podio entre seus 2 tipos).
 * @param {Array<object>} [team=[]] Pokemons da equipe.
 * @param {object} [gyms={}] Estado dos ginasios (nextCooldownAt, lastChallengeAt, podiums).
 * @param {Map|object|null} [speciesCatalog=null] Catalogo de especies opcional.
 * @param {number} [nowMs=Date.now()] Timestamp atual em ms.
 * @returns {{ cooldownReady: boolean, cooldownRemainingMs: number, recommendedType: string|null, recommendedCount: number, topOptions: Array<object>, recommendedSummary: string }}
 */
export function recommendBestGymForTeam(team = [], gyms = {}, speciesCatalog = null, nowMs = Date.now()) {
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    const nextCd = Number(gyms?.nextCooldownAt ?? gyms?.cooldownAte ?? gyms?.cooldownAt ?? 0) || 0;
    const lastChallenge = Number(gyms?.lastChallengeAt ?? gyms?.ultimoDesafioEm ?? 0) || 0;
    const cdTarget = nextCd > 0 ? nextCd : (lastChallenge > 0 ? lastChallenge + GYM_COOLDOWN_MS : 0);
    const cooldownRemainingMs = cdTarget > now ? cdTarget - now : 0;
    const cooldownReady = cooldownRemainingMs === 0;

    const podiumMap = parseGymPodiumsMap(gyms);
    const teamList = Array.isArray(team) ? team.filter(Boolean) : [];
    const teamTypesList = teamList.map((pk) => {
        const tipos = extractPokemonTypes(pk, speciesCatalog);
        const bestInheritedPodiumPct = tipos.reduce((mx, t) => {
            const pct = podiumMap.get(t)?.bonusPct || 0;
            return Math.max(mx, pct);
        }, 0);
        return { pk, tipos, bestInheritedPodiumPct };
    });

    const options = [];
    for (const p of PVP_PASSIVAS) {
        const tipo = p.tipo;
        let count = 0;
        let inheritedMaxPct = 0;
        let potentialGain = 0;
        for (const member of teamTypesList) {
            if (member.tipos.includes(tipo)) {
                count++;
                if (member.bestInheritedPodiumPct > inheritedMaxPct) {
                    inheritedMaxPct = member.bestInheritedPodiumPct;
                }
                potentialGain += Math.max(0, 25 - member.bestInheritedPodiumPct);
            }
        }
        const currentPodium = podiumMap.get(tipo) || { pos: null, bonusPct: 0 };
        const score = count * 100 + potentialGain;
        options.push({
            tipo,
            count,
            score,
            potentialGain,
            bestPodiumPct: inheritedMaxPct,
            currentPodiumPos: currentPodium.pos,
            currentPodiumPct: currentPodium.bonusPct,
        });
    }

    options.sort((a, b) =>
        (b.count - a.count)
        || (b.potentialGain - a.potentialGain)
        || (a.currentPodiumPct - b.currentPodiumPct)
        || a.tipo.localeCompare(b.tipo)
    );
    const topOptions = options.slice(0, 5);
    const best = options[0] && options[0].count > 0 ? options[0] : null;
    const recommendedType = best ? best.tipo : null;
    const recommendedCount = best ? best.count : 0;

    let recommendedSummary;
    if (!recommendedType) {
        recommendedSummary = cooldownReady
            ? 'Sem tipos identificados no time para recomendar ginasio.'
            : 'Sem tipos identificados no time; ginasio em cooldown.';
    } else if (cooldownReady) {
        recommendedSummary = `Ginasio ${recommendedType} recomendado (${recommendedCount}/${teamList.length} do time) com cooldown liberado.`;
    } else {
        const minsLeft = Math.ceil(cooldownRemainingMs / 60_000);
        recommendedSummary = `Ginasio ${recommendedType} recomendado (${recommendedCount}/${teamList.length} do time), cooldown em ${minsLeft} min.`;
    }

    return {
        cooldownReady,
        cooldownRemainingMs,
        recommendedType,
        recommendedCount,
        topOptions,
        recommendedSummary,
    };
}

// ---------- Intel de Rank PvP ----------
const PVP_PR_WINDOWS = Object.freeze([
    Object.freeze({ minElapsedMs: 6 * 3_600_000, window: Infinity }),
    Object.freeze({ minElapsedMs: 4 * 3_600_000, window: 1000 }),
    Object.freeze({ minElapsedMs: 2 * 3_600_000, window: 600 }),
    Object.freeze({ minElapsedMs: 1 * 3_600_000, window: 400 }),
    Object.freeze({ minElapsedMs: 30 * 60_000, window: 250 }),
    Object.freeze({ minElapsedMs: 15 * 60_000, window: 150 }),
    Object.freeze({ minElapsedMs: 5 * 60_000, window: 100 }),
    Object.freeze({ minElapsedMs: 2 * 60_000, window: 50 }),
    Object.freeze({ minElapsedMs: 0, window: 25 }),
]);
const PVP_DECAY_MS = 24 * 3_600_000;
const PVP_DECAY_WARN_MS = 4 * 3_600_000;

/**
 * Calcula countdown de decaimento 24h, status do Escudo de Tier e janela atual de PR no matchmaking.
 * @param {object} [pvpState={}] Estado do PvP (decayAt, lastMatchAt, escudo, queueSince, queueElapsedMs).
 * @param {number} [nowMs=Date.now()] Timestamp atual em ms.
 * @returns {object} Intel de rank PvP.
 */
export function computePvpRankIntel(pvpState = {}, nowMs = Date.now()) {
    const st = pvpState && typeof pvpState === 'object' ? pvpState : {};
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();

    const lastMatchAtRaw = Number(st.lastMatchAt ?? st.ultimaPartidaEm ?? st.ultimoJogoEm ?? 0);
    const lastMatchAt = Number.isFinite(lastMatchAtRaw) && lastMatchAtRaw > 0 ? lastMatchAtRaw : null;

    const explicitDecayRaw = Number(st.decayAt ?? st.decaimentoEm ?? 0);
    const decayAt = Number.isFinite(explicitDecayRaw) && explicitDecayRaw > 0
        ? explicitDecayRaw
        : (lastMatchAt != null ? lastMatchAt + PVP_DECAY_MS : null);

    const decayRemainingMs = decayAt != null ? Math.max(0, decayAt - now) : null;
    const decayActive = decayAt != null && now >= decayAt;
    const decayWarning = decayAt != null && (decayActive || decayRemainingMs <= PVP_DECAY_WARN_MS);

    const escudo = Math.max(0, Math.floor(Number(st.escudo ?? st.tierShield ?? 0) || 0));
    const tierShieldActive = escudo > 0;

    const queueSinceRaw = Number(st.queueSince ?? st.filaDesde ?? st.entrouFilaEm ?? 0);
    const explicitElapsed = Number(st.queueElapsedMs ?? st.tempoFilaMs);
    const queueElapsedMs = Number.isFinite(explicitElapsed) && explicitElapsed >= 0
        ? explicitElapsed
        : (Number.isFinite(queueSinceRaw) && queueSinceRaw > 0 ? Math.max(0, now - queueSinceRaw) : 0);
    const inQueue = Boolean(st.inQueue ?? st.naFila ?? st.na ?? queueSinceRaw > 0);

    const step = PVP_PR_WINDOWS.find((w) => queueElapsedMs >= w.minElapsedMs) || PVP_PR_WINDOWS[PVP_PR_WINDOWS.length - 1];
    const prWindow = step.window;
    const prWindowLabel = prWindow === Infinity ? 'infinito' : `+-${prWindow}`;

    return {
        pr: Number(st.pr ?? st.pontos ?? 0) || 0,
        escudo,
        tierShieldActive,
        lastMatchAt,
        decayAt,
        decayRemainingMs,
        decayActive,
        decayWarning,
        inQueue,
        queueElapsedMs,
        prWindow,
        prWindowLabel,
    };
}

// ---------- Alavancagem de Loot acima do Nv 25.000 ----------
export const NIVEL_TETO_OURO = 25_000;

/**
 * Informa a alavancagem de bonus de Loot em hunts a partir do Nv 25.000 (teto do ouro direto).
 * @param {number} [huntLevel=0] Nivel da hunt.
 * @param {number} [bonusLootPct=0] Bonus percentual total de loot.
 * @returns {{ active: boolean, huntLevel: number, tetoOuro: number, bonusLootPct: number, multiplier: number, summary: string }}
 */
export function computeLootLeverageInfo(huntLevel = 0, bonusLootPct = 0) {
    const level = Math.max(0, Math.floor(Number(huntLevel) || 0));
    const bonus = Math.max(0, Number(bonusLootPct) || 0);
    const multiplier = Number((1 + bonus / 100).toFixed(4));
    const active = level >= NIVEL_TETO_OURO;
    const summary = active
        ? `Alavancagem de Loot ativa (Nv ${level} >= ${NIVEL_TETO_OURO}): 100% do ganho extra vem do loot x${multiplier.toFixed(2)}.`
        : `Hunt Nv ${level} abaixo do teto de ouro (${NIVEL_TETO_OURO}); alavancagem total de loot ativa a partir do Nv ${NIVEL_TETO_OURO}.`;

    return {
        active,
        huntLevel: level,
        tetoOuro: NIVEL_TETO_OURO,
        bonusLootPct: bonus,
        multiplier,
        summary,
    };
}

// ---------- Raid da Reserva e Boost da Guilda ----------
const GUILD_RAID_HP_POR_LUTADOR = 25_000;
const GUILD_RAID_MAX_BONUS_PCT = 5;
const GUILD_BOOST_DIAMONDS_GOAL = 500;
const GUILD_BOOST_PCT = 10;
const GUILD_BOOST_DAYS = 7;

/**
 * Consolida a inteligencia da Raid da Reserva da Guilda e do Boost de +10% (7d / 500 diamantes).
 * @param {object} [guildState={}] Estado da guilda.
 * @param {number} [nowMs=Date.now()] Timestamp atual em ms.
 * @returns {object} Metricas da Raid da Reserva e Boost da Guilda.
 */
export function computeGuildRaidIntel(guildState = {}, nowMs = Date.now()) {
    const g = guildState && typeof guildState === 'object' ? guildState : {};
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();

    const fighters = Math.max(0, Math.floor(Number(g.fighters ?? g.lutadores ?? g.membros ?? 0) || 0));
    const reserveMaxHp = GUILD_RAID_HP_POR_LUTADOR * fighters;
    const teamDamage = Math.max(0, Number(g.teamDamage ?? g.dano ?? g.danoEquipe ?? 0) || 0);
    const damageRatio = reserveMaxHp > 0 ? Math.min(1, teamDamage / reserveMaxHp) : 0;

    const computedBonus = reserveMaxHp > 0
        ? Math.min(GUILD_RAID_MAX_BONUS_PCT, Math.round(damageRatio * GUILD_RAID_MAX_BONUS_PCT * 100) / 100)
        : 0;
    const explicitBonus = Number(g.bonusPct);
    const bonusPct = Number.isFinite(explicitBonus) && explicitBonus >= 0 && reserveMaxHp === 0
        ? Math.min(GUILD_RAID_MAX_BONUS_PCT, explicitBonus)
        : computedBonus;

    const boostAteRaw = Number(g.boostAte ?? g.boostUntil ?? 0);
    const boostAte = Number.isFinite(boostAteRaw) && boostAteRaw > 0 ? boostAteRaw : null;
    const boostActive = boostAte != null && boostAte > now;
    const boostRemainingMs = boostActive ? boostAte - now : 0;

    const diamondsCurrent = Math.max(0, Number(g.diamantes ?? g.diamonds ?? g.boostDiamantes ?? 0) || 0);
    const diamondsGoal = GUILD_BOOST_DIAMONDS_GOAL;
    const diamondsRemaining = Math.max(0, diamondsGoal - diamondsCurrent);
    const diamondsPct = Math.min(100, Math.round((diamondsCurrent / diamondsGoal) * 1000) / 10);

    return {
        hasGuild: Boolean(g.id || g.nome || g.name || fighters > 0 || boostAte || diamondsCurrent > 0),
        fighters,
        reserveMaxHp,
        teamDamage,
        damageRatio,
        bonusPct,
        maxBonusPct: GUILD_RAID_MAX_BONUS_PCT,
        boostActive,
        boostPct: boostActive ? GUILD_BOOST_PCT : 0,
        boostAte,
        boostRemainingMs,
        boostDurationDays: GUILD_BOOST_DAYS,
        diamondsGoal,
        diamondsCurrent,
        diamondsRemaining,
        diamondsPct,
    };
}

// ---------- Guia Probabilistico da Conta ----------
const DEGRAUS_OVO_SHINY = Object.freeze([
    5000, 5400, 5900, 6400, 6950, 8000, 8600, 10000,
    11250, 12750, 14350, 16000, 20000, 21200, 25000, 26150,
    27500, 28950, 30450, 35150, 40000, 42800, 46150, 49650,
    53350, 64950, 75000, 84650, 95950, 108000, 120550, 160300,
]);
const OVO_SHINY_BASE_CHANCE = 1 / 150_000;
const OVO_SHINY_PASSO_CHANCE = 0.04 / 150_000;

/**
 * Gera guia probabilistico personalizado da conta (EV de Ovo Shiny por hora real + tabelas oficiais).
 * @param {object} [params] Parametros da conta e hunt atual.
 * @returns {object} Estatisticas de EV e tabelas oficiais de referencia.
 */
export function computeAccountProbGuide({
    killsPerHour = 0,
    huntLevel = 0,
    isOutland = false,
    captureBoost = false,
    lureActive = false,
    twitchShiny = false,
    kickShiny = false,
} = {}) {
    const kph = Math.max(0, Number(killsPerHour) || 0);
    const lv = Math.max(0, Number(huntLevel) || 0);
    const outland = Boolean(isOutland);

    let step = 0;
    if (!outland && lv >= DEGRAUS_OVO_SHINY[0]) {
        for (const marco of DEGRAUS_OVO_SHINY) {
            if (marco > lv) break;
            step++;
        }
    }

    const baseChance = step > 0 ? OVO_SHINY_BASE_CHANCE + (step - 1) * OVO_SHINY_PASSO_CHANCE : 0;
    const shinyMult = Number(((lureActive ? 2 : 1) * (twitchShiny ? 1.15 : 1) * (kickShiny ? 1.15 : 1)).toFixed(4));
    const boostedChance = baseChance;
    const avgKillsPerFrag = baseChance > 0 ? Math.round(1 / baseChance) : null;
    const avgKillsPerEgg = baseChance > 0 ? Math.round(10 / baseChance) : null;
    const hoursPerEgg = kph > 0 && avgKillsPerEgg != null ? Number((avgKillsPerEgg / kph).toFixed(2)) : null;

    const nextStep = !outland && step < DEGRAUS_OVO_SHINY.length ? step + 1 : null;
    const nextLevel = nextStep != null ? DEGRAUS_OVO_SHINY[nextStep - 1] : null;
    const nextChance = nextStep != null ? OVO_SHINY_BASE_CHANCE + (nextStep - 1) * OVO_SHINY_PASSO_CHANCE : null;
    const nextAvgKillsPerEgg = nextChance != null ? Math.round(10 / nextChance) : null;
    const hoursPerEggNextStep = kph > 0 && nextAvgKillsPerEgg != null ? Number((nextAvgKillsPerEgg / kph).toFixed(2)) : null;

    const mysticBeastPct = captureBoost ? 1.0 : 0.5;

    const tables = {
        quality: {
            q180: { pct: 0.288, oneIn: 347 },
            q170Plus: { pct: 0.962, oneIn: 104 },
            q150Plus: { pct: 5.962, oneIn: 17 },
        },
        prey: {
            star5Pct: 0.5,
            oneIn: 200,
            categoryPct: 25,
        },
        craft: {
            legendaryPct: 0.005,
            legendaryOneIn: 20_000,
            mythicPct: 0.5,
        },
        mysticArena: {
            baseBeastPct: 0.5,
            boostedBeastPct: 1.0,
            activeBeastPct: mysticBeastPct,
        },
        safari: {
            maxMult: Number(MULT_SHINY_TUDO_NO_SAFARI.toFixed(2)),
            exactMaxMult: MULT_SHINY_TUDO_NO_SAFARI,
        },
        boss: REGIOES_BOSS.map((region, idx) => ({
            region,
            par: idx + 1,
            mult: idx + 1,
            ...chancesBossPorPar(idx + 1),
        })),
        stoneDrops: {
            stage0Pct: 20,
            stage1Pct: 35,
            finalOrOutlandPct: 50,
        },
    };

    return {
        killsPerHour: kph,
        huntLevel: lv,
        isOutland: outland,
        step,
        maxSteps: DEGRAUS_OVO_SHINY.length,
        baseChance,
        boostedChance,
        shinyMult,
        mysticBeastPct,
        avgKillsPerFrag,
        avgKillsPerEgg,
        hoursPerEgg,
        nextStep,
        nextLevel,
        nextChance,
        hoursPerEggNextStep,
        tables,
    };
}

// ---------- Resumo Estatistico de Rolagens da Sessao ----------
/**
 * Compara rolagens reais de captura (P4, P5, Q>=1.50, Q>=1.70, Q>=1.80) com a taxa oficial esperada.
 * @param {Array<object>} [capturedRecords=[]] Registros de capturas da sessao.
 * @returns {object} Contagens reais vs esperadas.
 */
export function summarizeSessionRolls(capturedRecords = []) {
    const records = Array.isArray(capturedRecords) ? capturedRecords.filter((r) => r && typeof r === 'object') : [];
    const total = records.length;
    let p4 = 0;
    let p5 = 0;
    let q150 = 0;
    let q170 = 0;
    let q180 = 0;

    for (const r of records) {
        const pot = Number(r.potencia ?? r.pot ?? 1) || 1;
        if (pot === 4) p4++;
        else if (pot >= 5) p5++;

        const q = Number(r.quality ?? r.qualidade ?? 1) || 1;
        if (q >= 1.50 - 1e-9) q150++;
        if (q >= 1.70 - 1e-9) q170++;
        if (q >= 1.80 - 1e-9) q180++;
    }

    const expectedQ150 = Number((total * 0.05962).toFixed(2));
    const expectedQ170 = Number((total * 0.00962).toFixed(2));
    const expectedQ180 = Number((total * 0.00288).toFixed(2));

    return {
        total,
        p4,
        p5,
        q150,
        q170,
        q180,
        expected: {
            q150: expectedQ150,
            q170: expectedQ170,
            q180: expectedQ180,
        },
        ratesPct: {
            q150: { real: total > 0 ? Number(((q150 / total) * 100).toFixed(3)) : 0, expected: 5.962, diff: Number((q150 - expectedQ150).toFixed(2)) },
            q170: { real: total > 0 ? Number(((q170 / total) * 100).toFixed(3)) : 0, expected: 0.962, diff: Number((q170 - expectedQ170).toFixed(2)) },
            q180: { real: total > 0 ? Number(((q180 / total) * 100).toFixed(3)) : 0, expected: 0.288, diff: Number((q180 - expectedQ180).toFixed(2)) },
        },
    };
}

// ---------- Selecao de Time de Raid (PvE) ----------
const POTENCIA_MULTS = Object.freeze([1.0, 1.05, 1.10, 1.25, 2.0]);

/**
 * Pontua e seleciona os melhores Pokemons da conta para Raid PvE (nivel real, potencia, qualidade, IVs, Mega/Z-Move).
 * @param {Array<object>} [pokemons=[]] Lista de Pokemons da conta.
 * @param {Map|object|null} [speciesCatalog=null] Catalogo de especies opcional.
 * @param {number} [maxSlots=5] Maximo de slots na Raid.
 * @returns {{ pokemonIds: Array<number|string>, members: Array<object> }}
 */
export function selectBestRaidTeam(pokemons = [], speciesCatalog = null, maxSlots = 5) {
    const limit = Math.max(1, Math.floor(Number(maxSlots) || 5));
    const list = Array.isArray(pokemons) ? pokemons : [];
    const seen = new Set();
    const scored = [];

    for (const pk of list) {
        if (!pk || pk.id == null) continue;
        const idKey = String(pk.id);
        if (seen.has(idKey)) continue;
        seen.add(idKey);

        const spId = Number(pk.speciesId) || 0;
        const esp = lookupSpecies(speciesCatalog, spId);
        const level = Math.max(1, Number(pk.level ?? pk.nivel) || 1);
        const pot = Math.max(1, Math.min(5, Math.round(Number(pk.potencia) || 1)));
        const potMult = POTENCIA_MULTS[pot - 1] ?? 1;
        const q = Math.max(0.8, Number(pk.quality ?? pk.qualidade) || 1);
        const ivSum = ivTotalOf(pk) ?? 96;
        const isMega = Boolean(pk.mega || pk.isMega || pk.megaDeDex != null || (spId >= 3000 && spId < 4000));
        const hasZMove = Boolean(pk.tmElemental || pk.zmove || pk.zMove);
        const bstRaw = Number(esp?.bst);
        const bst = Number.isFinite(bstRaw) && bstRaw > 0
            ? bstRaw
            : ((Number(esp?.baseHp) || 0) + (Number(esp?.baseAtk) || 0) + (Number(esp?.baseDef) || 0)
                + (Number(esp?.baseSpAtk) || 0) + (Number(esp?.baseSpDef) || 0) + (Number(esp?.baseSpeed) || 0)) || 450;

        const score = level
            * potMult
            * q
            * (pk.shiny ? 1.5 : 1)
            * (1 + Math.min(192, Math.max(0, ivSum)) / 384)
            * (1 + bst / 2000)
            * (isMega ? 1.25 : 1)
            * (hasZMove ? 1.15 : 1);

        scored.push({
            id: pk.id,
            speciesId: spId,
            name: String(pk.apelido || pk.nome || pk.name || esp?.name || `#${pk.id}`),
            level,
            potencia: pot,
            potMult,
            quality: q,
            ivTotal: ivSum,
            isMega,
            hasZMove,
            shiny: Boolean(pk.shiny),
            score: Number(score.toFixed(2)),
        });
    }

    scored.sort((a, b) => (b.score - a.score) || (b.level - a.level));
    const members = scored.slice(0, limit);
    return {
        pokemonIds: members.map((m) => m.id),
        members,
    };
}

// ---------- Formacao PvP por Modo (Padrao, Ginasio ^0.45, Guerra ^0.20) ----------
const PVP_FRONTLINE_TILES = Object.freeze([2, 3, 1, 4, 0, 5]);
const PVP_BACKLINE_TILES = Object.freeze([17, 18, 16, 15, 14, 19, 20, 21, 23, 24, 22, 25]);
const PVP_DEFENSIVE_PASSIVE_SET = new Set(['iron_defense', 'rocky_helmet', 'recover', 'intimidate']);

/**
 * Monta formacao PvP de ate 5 slots adaptada ao modo ('padrao', 'ginasio' ^0.45, 'guerra' ^0.20).
 * @param {object|Array<object>} [state={}] Estado da conta ou lista de Pokemons.
 * @param {'padrao'|'ginasio'|'guerra'} [mode='padrao'] Modo da arena.
 * @param {Map|object|null} [speciesCatalog=null] Catalogo de especies opcional.
 * @returns {{ mode: string, pokemonIds: Array<number|string>, casas: Record<string, number>, members: Array<object> }}
 */
export function buildPvpFormationForMode(state = {}, mode = 'padrao', speciesCatalog = null) {
    const rawMode = String(mode || 'padrao').trim().toLowerCase();
    const normMode = rawMode === 'war' ? 'guerra' : (rawMode === 'ginasio' || rawMode === 'guerra' ? rawMode : 'padrao');
    const pool = Array.isArray(state)
        ? state
        : (Array.isArray(state?.pokemons) ? state.pokemons : []);

    const seen = new Set();
    const candidates = [];

    for (const pk of pool) {
        if (!pk || pk.id == null) continue;
        const idKey = String(pk.id);
        if (seen.has(idKey)) continue;
        seen.add(idKey);

        const spId = Number(pk.speciesId) || 0;
        const esp = lookupSpecies(speciesCatalog, spId);
        const level = Math.max(1, Number(pk.level ?? pk.nivel) || 1);
        const arenaLevel = effectiveArenaLevel(level, normMode === 'guerra' ? 'guerra' : 'ginasio');
        const pot = Math.max(1, Math.min(5, Math.round(Number(pk.potencia) || 1)));
        const potMult = POTENCIA_MULTS[pot - 1] ?? 1;
        const q = Math.max(0.8, Number(pk.quality ?? pk.qualidade) || 1);
        const ivSum = ivTotalOf(pk) ?? 96;
        const ref = parseRefinoObj(pk.refino);
        const refSum = STATS_REFINAVEIS.reduce((s, k) => s + ref[k], 0);
        const isMega = Boolean(pk.mega || pk.isMega || pk.megaDeDex != null || (spId >= 3000 && spId < 4000));
        const hasZMove = Boolean(pk.tmElemental || pk.zmove || pk.zMove);
        const passive = passivaParaEspecie(esp || pk);
        const defensivePassive = Boolean(
            passive && (
                PVP_DEFENSIVE_PASSIVE_SET.has(passive.id)
                || (Number(passive.bonusDefPct) || 0) > 0
                || (Number(passive.curaHpPct) || 0) > 0
                || (Number(passive.reducaoDanoInimigoPct) || 0) > 0
                || (Number(passive.reflexoPct) || 0) > 0
            )
        );

        const st = pk.stats || {};
        const hp = Number(st.hp) || (Number(esp?.baseHp) || 60) * 2;
        const def = Number(st.def) || Number(esp?.baseDef) || 60;
        const spDef = Number(st.spDef) || Number(esp?.baseSpDef) || 60;
        const atk = Number(st.atk) || Number(esp?.baseAtk) || 60;
        const spAtk = Number(st.spAtk) || Number(esp?.baseSpAtk) || 60;
        const spd = Number(st.speed) || Number(esp?.baseSpeed) || 60;
        const bulk = hp + def + spDef;
        const offense = Math.max(atk, spAtk) + spd * 0.5;
        const tankScore = (defensivePassive ? 250 : 0) + (bulk - offense * 0.35);

        let score;
        if (normMode === 'guerra') {
            // Na Guerra (^0.20), sobrevivencia pesa 60% vs 40% abates; P5/Q/IV/Refino/Z-Move/Passiva dominam.
            const statCore = bulk * 0.6 + offense * 0.4;
            score = (arenaLevel * 0.4)
                + (potMult * 110)
                + (q * 60)
                + (ivSum * 0.35)
                + (refSum * 4)
                + (pk.shiny ? 35 : 0)
                + (isMega ? 45 : 0)
                + (hasZMove ? 45 : 0)
                + (passive ? (defensivePassive ? 65 : 40) : 0)
                + (statCore * 0.15);
        } else if (normMode === 'ginasio') {
            score = (arenaLevel * 1.1)
                + (potMult * 85)
                + (q * 45)
                + (ivSum * 0.25)
                + (refSum * 2.5)
                + (pk.shiny ? 25 : 0)
                + (isMega ? 30 : 0)
                + (hasZMove ? 25 : 0)
                + (passive ? 30 : 0);
        } else {
            score = (arenaLevel * 0.85)
                + (potMult * 90)
                + (q * 50)
                + (ivSum * 0.25)
                + (refSum * 3)
                + (pk.shiny ? 25 : 0)
                + (isMega ? 30 : 0)
                + (hasZMove ? 30 : 0)
                + (passive ? 35 : 0);
        }

        candidates.push({
            id: pk.id,
            speciesId: spId,
            name: String(pk.apelido || pk.nome || pk.name || esp?.name || `#${pk.id}`),
            level,
            arenaLevel,
            potencia: pot,
            quality: q,
            hasZMove,
            isMega,
            passive,
            tankScore: Number(tankScore.toFixed(2)),
            score: Number(score.toFixed(2)),
        });
    }

    candidates.sort((a, b) => (b.score - a.score) || (b.arenaLevel - a.arenaLevel));
    const chosen = candidates.slice(0, 5);
    if (chosen.length === 0) {
        return { mode: normMode, pokemonIds: [], casas: {}, members: [] };
    }

    const byTank = [...chosen].sort((a, b) => (b.tankScore - a.tankScore) || (b.score - a.score));
    const frontCount = byTank.length >= 4 ? 2 : 1;
    const frontline = byTank.slice(0, frontCount);
    const backline = byTank.slice(frontCount);

    const pokemonIds = [];
    const casas = {};
    const members = [];

    frontline.forEach((m, idx) => {
        const tile = PVP_FRONTLINE_TILES[idx];
        pokemonIds.push(m.id);
        casas[String(m.id)] = tile;
        members.push({ ...m, role: 'front', tile });
    });
    backline.forEach((m, idx) => {
        const tile = PVP_BACKLINE_TILES[idx];
        pokemonIds.push(m.id);
        casas[String(m.id)] = tile;
        members.push({ ...m, role: 'back', tile });
    });

    return { mode: normMode, pokemonIds, casas, members };
}

// ---------- Analise de Undercut em Anuncios Proprios ----------
/**
 * Analisa anuncios proprios no mercado contra o piso retornado por marketFloorFn,
 * calculando preco sugerido (piso - 1 ou -1%, >= 1) e liquido apos taxa oficial.
 * @param {Array<object>} [ownListings=[]] Anuncios proprios no mercado.
 * @param {Function|null} [marketFloorFn=null] Funcao (listing) => number | { price, preco, floor }.
 * @returns {{ total: number, undercutCount: number, listings: Array<object>, undercutListings: Array<object> }}
 */
export function analyzeOwnListingsUndercut(ownListings = [], marketFloorFn = null) {
    const rawList = Array.isArray(ownListings) ? ownListings.filter(Boolean) : [];
    const listings = [];
    const undercutListings = [];

    for (const item of rawList) {
        const price = Math.max(0, Number(item.preco ?? item.price ?? 0) || 0);
        const currency = String(item.moeda ?? item.currency ?? 'gold').toLowerCase() === 'orb' ? 'orb' : 'gold';
        const kind = (item.tipo === 'pokemon' || item.speciesId != null || item.pokeId != null || item.pokemon != null)
            ? 'pokemon'
            : 'item';

        const floorRaw = typeof marketFloorFn === 'function' ? marketFloorFn(item) : null;
        const floorPriceRaw = typeof floorRaw === 'number'
            ? floorRaw
            : Number(floorRaw?.price ?? floorRaw?.preco ?? floorRaw?.floor ?? NaN);
        const floorPrice = Number.isFinite(floorPriceRaw) && floorPriceRaw > 0 ? floorPriceRaw : null;

        const undercut = floorPrice != null && price > floorPrice;
        let suggestedPrice = price;
        if (undercut) {
            const pctStep = Math.floor(floorPrice * 0.99);
            suggestedPrice = Math.max(1, floorPrice >= 100 ? Math.min(floorPrice - 1, pctStep) : floorPrice - 1);
        }

        const currentNet = liquidoVenda(price, currency, kind);
        const suggestedNet = liquidoVenda(suggestedPrice, currency, kind);
        const entry = {
            id: item.id ?? null,
            price,
            currency,
            kind,
            floorPrice,
            undercut,
            diff: floorPrice != null ? price - floorPrice : 0,
            suggestedPrice,
            currentNet,
            suggestedNet,
            currentFee: Math.max(0, price - currentNet),
            suggestedFee: Math.max(0, suggestedPrice - suggestedNet),
        };
        listings.push(entry);
        if (undercut) undercutListings.push(entry);
    }

    return {
        total: listings.length,
        undercutCount: undercutListings.length,
        listings,
        undercutListings,
    };
}
