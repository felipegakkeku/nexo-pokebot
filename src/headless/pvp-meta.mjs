// Mecanicas de meta PvP, economia avancada, eventos, bestiario, safari e gestao de conta
// alinhadas a pokeidle.io v1.492.0.

export const PASSIVAS_DESDE_MS = Date.UTC(2026, 10, 29, 3, 0, 0);
export const BST_MAX_PASSIVA = 500;

export const PVP_PASSIVAS = Object.freeze([
    Object.freeze({
        id: 'adaptavel',
        nome: 'Adaptável',
        tipo: 'NORMAL',
        gatilho: 'sempre',
        icone: '/img/tipos/normal.svg',
        reducaoDanoPct: 12,
        bonusStabPct: 15,
    }),
    Object.freeze({
        id: 'brasa_viva',
        nome: 'Brasa Viva',
        tipo: 'FIRE',
        gatilho: 'ao_atacar',
        icone: '/img/tipos/fire.svg',
        queimaduraPct: 8,
        duracaoMs: 3000,
        bonusDanoPct: 10,
    }),
    Object.freeze({
        id: 'mare_constante',
        nome: 'Maré Constante',
        tipo: 'WATER',
        gatilho: 'por_segundo',
        icone: '/img/tipos/water.svg',
        regenHpPct: 2.5,
        reducaoFogoPct: 15,
    }),
    Object.freeze({
        id: 'raizes_vitais',
        nome: 'Raízes Vitais',
        tipo: 'GRASS',
        gatilho: 'ao_atacar',
        icone: '/img/tipos/grass.svg',
        rouboVidaPct: 15,
    }),
    Object.freeze({
        id: 'sobrecarga',
        nome: 'Sobrecarga',
        tipo: 'ELECTRIC',
        gatilho: 'sempre',
        icone: '/img/tipos/electric.svg',
        reducaoCdPct: 12,
        bonusSpeedPct: 10,
    }),
    Object.freeze({
        id: 'geada_cortante',
        nome: 'Geada Cortante',
        tipo: 'ICE',
        gatilho: 'ao_atacar',
        icone: '/img/tipos/ice.svg',
        lentidaoPct: 15,
        duracaoMs: 2500,
    }),
    Object.freeze({
        id: 'espirito_luta',
        nome: 'Espírito de Luta',
        tipo: 'FIGHTING',
        gatilho: 'abaixo_hp',
        icone: '/img/tipos/fighting.svg',
        limiarHpPct: 50,
        bonusDanoPct: 25,
    }),
    Object.freeze({
        id: 'toxina_persistente',
        nome: 'Toxina Persistente',
        tipo: 'POISON',
        gatilho: 'ao_atacar',
        icone: '/img/tipos/poison.svg',
        venenoPct: 6,
        maxStacks: 3,
    }),
    Object.freeze({
        id: 'casco_telurico',
        nome: 'Casco Telúrico',
        tipo: 'GROUND',
        gatilho: 'ao_receber_dano',
        icone: '/img/tipos/ground.svg',
        reducaoDanoPct: 15,
        imunidadeEletrico: true,
    }),
    Object.freeze({
        id: 'ventania',
        nome: 'Ventania',
        tipo: 'FLYING',
        gatilho: 'sempre',
        icone: '/img/tipos/flying.svg',
        esquivaPct: 12,
        reducaoCdPct: 8,
    }),
    Object.freeze({
        id: 'barreira_mental',
        nome: 'Barreira Mental',
        tipo: 'PSYCHIC',
        gatilho: 'ao_entrar',
        icone: '/img/tipos/psychic.svg',
        escudoHpPct: 15,
        bonusSpAtkPct: 10,
    }),
    Object.freeze({
        id: 'enxame_veloz',
        nome: 'Enxame Veloz',
        tipo: 'BUG',
        gatilho: 'primeiro_golpe',
        icone: '/img/tipos/bug.svg',
        bonusPrimeiroGolpePct: 30,
        reducaoCdPct: 10,
    }),
    Object.freeze({
        id: 'rocha_solida',
        nome: 'Rocha Sólida',
        tipo: 'ROCK',
        gatilho: 'ao_receber_dano',
        icone: '/img/tipos/rock.svg',
        reducaoSuperEfetivoPct: 25,
        bonusDefPct: 12,
    }),
    Object.freeze({
        id: 'intangivel',
        nome: 'Intangível',
        tipo: 'GHOST',
        gatilho: 'ao_receber_dano',
        icone: '/img/tipos/ghost.svg',
        esquivaPct: 15,
        reflexoPct: 10,
    }),
    Object.freeze({
        id: 'furia_ancestral',
        nome: 'Fúria Ancestral',
        tipo: 'DRAGON',
        gatilho: 'ao_abater',
        icone: '/img/tipos/dragon.svg',
        bonusDanoPorAbatePct: 12,
        maxStacks: 3,
    }),
    Object.freeze({
        id: 'golpe_baixo',
        nome: 'Golpe Baixo',
        tipo: 'DARK',
        gatilho: 'ao_atacar',
        icone: '/img/tipos/dark.svg',
        chanceCritPct: 20,
        multCrit: 1.5,
    }),
    Object.freeze({
        id: 'blindagem',
        nome: 'Blindagem',
        tipo: 'STEEL',
        gatilho: 'sempre',
        icone: '/img/tipos/steel.svg',
        reducaoDanoPct: 18,
    }),
    Object.freeze({
        id: 'aura_feerica',
        nome: 'Aura Feérica',
        tipo: 'FAIRY',
        gatilho: 'ao_entrar',
        icone: '/img/tipos/fairy.svg',
        reducaoDanoDragaoPct: 30,
        curaAliadoPct: 10,
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
