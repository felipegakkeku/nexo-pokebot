import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PASSIVAS_DESDE_MS,
    BST_MAX_PASSIVA,
    PVP_PASSIVAS,
    passivaParaEspecie,
    ARENA_NIVEL_CHEIO,
    ARENA_EXPO_GINASIO,
    ARENA_EXPO_GUERRA,
    effectiveArenaLevel,
    guildWarScore,
    REFINO_CUSTO_BASE,
    REFINO_TETO_TECNICO,
    STATS_REFINAVEIS,
    custoDoRefino,
    custoTotalDoRefino,
    sugerirProximoRefino,
    motivosEspecial,
    isProtectedSpecial,
    taxaOrbDaVenda,
    liquidoVenda,
    PITY_SHINY_BOLAS,
    PITY_SHINY_HORA_MS,
    resumoPityShiny,
    BESTIARIO_DEGRAUS,
    bestiaryProgress,
    REGIOES_BOSS,
    PREMIOS_DA_TRINCA,
    ROTACAO_BOSS_DIA_ZERO,
    premioDoBossNoInstante,
    chancesBossPorPar,
    SAFARI_BONUS_A_CADA,
    SAFARI_BONUS_MS,
    MULT_SHINY_TUDO_NO_SAFARI,
    duracaoDoSafariMs,
    optimalSafariTickets,
    RAID_SCHEDULE,
    SHOWDOWN_SCHEDULE,
    getUpcomingEvents,
    BICICLETA_VELOCIDADE,
    CASA_XP_SHARE,
    MAX_CASAS_EM_USO,
    findBestBikeUpgrade,
    findCraftableSets,
    TETO_DEPOT,
    TETO_COLECAO,
    computeCapStatus,
    selectOferendaBatches,
    BLACK_FRIDAY,
    isBlackFridayActive,
} from '../src/headless/pvp-meta.mjs';

test('passivas PvP: 18 tipos reais v1.492.0 e filtro por BST <= 500', () => {
    assert.equal(PASSIVAS_DESDE_MS, Date.UTC(2026, 10, 29, 3, 0, 0));
    assert.equal(BST_MAX_PASSIVA, 500);
    assert.equal(PVP_PASSIVAS.length, 18);
    const tipos = new Set(PVP_PASSIVAS.map((p) => p.tipo));
    assert.equal(tipos.size, 18);
    for (const p of PVP_PASSIVAS) {
        assert.ok(p.id && p.nome && p.tipo && p.gatilho && p.resumo && p.icone);
    }

    const expectedByType = {
        NORMAL: { nome: 'Recover', gatilho: 'cura' },
        FIRE: { nome: 'Burn', gatilho: 'ciclo' },
        WATER: { nome: 'Rain Dance', gatilho: 'inicio' },
        GRASS: { nome: 'Leech Seed', gatilho: 'ciclo' },
        ELECTRIC: { nome: 'Paralyze', gatilho: 'ciclo' },
        ICE: { nome: 'Freeze', gatilho: 'ciclo' },
        FIGHTING: { nome: 'Rock Smash', gatilho: 'ciclo' },
        POISON: { nome: 'Poison', gatilho: 'ciclo' },
        GROUND: { nome: 'Dig', gatilho: 'ciclo' },
        FLYING: { nome: 'Whirlwind', gatilho: 'ciclo' },
        PSYCHIC: { nome: 'Confusion', gatilho: 'ciclo' },
        BUG: { nome: 'Swarm', gatilho: 'inicio' },
        ROCK: { nome: 'Rocky Helmet', gatilho: 'inicio' },
        GHOST: { nome: 'Fear', gatilho: 'ciclo' },
        DRAGON: { nome: 'Intimidate', gatilho: 'inicio' },
        DARK: { nome: 'Assurance', gatilho: 'ciclo' },
        STEEL: { nome: 'Iron Defense', gatilho: 'inicio' },
        FAIRY: { nome: 'Charm', gatilho: 'ciclo' },
    };
    for (const [tipo, exp] of Object.entries(expectedByType)) {
        const found = PVP_PASSIVAS.find((p) => p.tipo === tipo);
        assert.equal(found?.nome, exp.nome);
        assert.equal(found?.gatilho, exp.gatilho);
    }

    const raticate = { pokeId: 20, type1: 'NORMAL', baseHp: 55, baseAtk: 81, baseDef: 60, baseSpAtk: 50, baseSpDef: 70, baseSpeed: 97 };
    const charizard = { pokeId: 6, type1: 'FIRE', type2: 'FLYING', baseHp: 78, baseAtk: 84, baseDef: 78, baseSpAtk: 109, baseSpDef: 85, baseSpeed: 100 };
    assert.equal(passivaParaEspecie(raticate)?.nome, 'Recover');
    assert.equal(passivaParaEspecie(charizard), null);
    assert.equal(passivaParaEspecie({ type1: 'DRAGON', bst: 500 })?.nome, 'Intimidate');
    assert.equal(passivaParaEspecie({ type1: 'DRAGON', bst: 501 }), null);
});

test('arena e guerra de guilda: escalonamento de nivel e pontuacao', () => {
    assert.equal(ARENA_NIVEL_CHEIO, 150);
    assert.equal(ARENA_EXPO_GINASIO, 0.45);
    assert.equal(ARENA_EXPO_GUERRA, 0.20);
    assert.equal(effectiveArenaLevel(100, 'ginasio'), 100);
    assert.equal(effectiveArenaLevel(150, 'guerra'), 150);
    assert.equal(effectiveArenaLevel(600, 'ginasio'), Math.round(150 * 4 ** 0.45));
    assert.equal(effectiveArenaLevel(600, 'guerra'), Math.round(150 * 4 ** 0.20));

    assert.equal(guildWarScore(1, 1, 3), 100);
    assert.equal(guildWarScore(4, 1, 0), 30);
    assert.equal(guildWarScore(4, 4, 2), 50);
});

test('refino de stats: formulas cubicas e sugestao do stat mais barato', () => {
    assert.equal(REFINO_CUSTO_BASE, 500);
    assert.equal(REFINO_TETO_TECNICO, 9999);
    assert.deepEqual(STATS_REFINAVEIS, ['hp', 'atk', 'def', 'spAtk', 'spDef']);

    assert.equal(custoDoRefino(0), 500);
    assert.equal(custoDoRefino(1), 3500);
    assert.equal(custoDoRefino(2), 9500);
    assert.equal(custoTotalDoRefino(0), 0);
    assert.equal(custoTotalDoRefino(1), 500);
    assert.equal(custoTotalDoRefino(2), 4000);
    assert.equal(custoTotalDoRefino(3), 13500);

    const sug = sugerirProximoRefino({ hp: 2, atk: 1, def: 1, spAtk: 0, spDef: 3 });
    assert.deepEqual(sug, { stat: 'spAtk', currentLevel: 0, nextLevel: 1, cost: 500 });

    const maxAll = Object.fromEntries(STATS_REFINAVEIS.map((k) => [k, REFINO_TETO_TECNICO]));
    assert.equal(sugerirProximoRefino(maxAll), null);
});

test('protecao de especiais identifica todos os 8 motivos', () => {
    assert.equal(isProtectedSpecial({ id: 1, speciesId: 10, level: 50, potencia: 3 }), false);
    assert.deepEqual(motivosEspecial({ id: 2, speciesId: 150, level: 50 }), ['lendario']);
    assert.deepEqual(motivosEspecial({ id: 3, speciesId: 3006, level: 50 }), ['mega']);
    assert.deepEqual(motivosEspecial({ id: 4, speciesId: 10, level: 101 }), ['nivel > 100']);
    assert.deepEqual(motivosEspecial({ id: 5, speciesId: 10, level: 20, potencia: 5 }), ['p5']);
    assert.deepEqual(motivosEspecial({ id: 6, speciesId: 10, level: 20, tmElemental: 'FIRE' }), ['zmove']);
    assert.deepEqual(motivosEspecial({ id: 7, speciesId: 10, level: 20, tmAoe: true }), ['aoe']);
    assert.deepEqual(motivosEspecial({ id: 8, speciesId: 10, level: 20, refino: { atk: 1 } }), ['refino']);
    assert.deepEqual(
        motivosEspecial({ id: 9, speciesId: 25, shiny: true, level: 120, potencia: 5 }),
        ['shiny', 'nivel > 100', 'p5']
    );
    assert.equal(isProtectedSpecial({ shiny: true }), true);
});

test('taxas de mercado em orbs e gold', () => {
    assert.equal(taxaOrbDaVenda(100, 'item'), 15);
    assert.equal(taxaOrbDaVenda(500, 'pokemon'), 65);
    assert.equal(taxaOrbDaVenda(1000, 'pokemon'), 100);
    assert.equal(taxaOrbDaVenda(10000, 'pokemon'), 750);

    assert.equal(liquidoVenda(1000, 'orb', 'pokemon'), 900);
    assert.equal(liquidoVenda(100, 'orb', 'item'), 85);
    assert.equal(liquidoVenda(1000, 'gold', 'pokemon'), 850);
});

test('pity shiny acompanha contagem de bolas e janela de 1 hora', () => {
    assert.equal(PITY_SHINY_BOLAS, 50);
    assert.equal(PITY_SHINY_HORA_MS, 3_600_000);

    const t0 = 1_000_000;
    const ativo = resumoPityShiny({ bolas: 25, inicio: t0 }, t0 + 600_000);
    assert.equal(ativo.ativo, true);
    assert.equal(ativo.restamBolas, 25);
    assert.equal(ativo.pct, 50);
    assert.equal(ativo.garantido, false);
    assert.equal(ativo.restanteMs, 3_000_000);

    const cheio = resumoPityShiny({ bolas: 50, expiraEm: t0 + 1000 }, t0);
    assert.equal(cheio.garantido, true);
    assert.equal(cheio.pct, 100);

    const expirado = resumoPityShiny({ bolas: 40, inicio: t0 }, t0 + PITY_SHINY_HORA_MS);
    assert.equal(expirado.ativo, false);
    assert.equal(expirado.bolas, 0);
});

test('bestiario calcula degraus oficiais v1.492.0 e ETA', () => {
    assert.deepEqual(BESTIARIO_DEGRAUS, [
        { abates: 25000, bp: 5 },
        { abates: 50000, bp: 15 },
        { abates: 100000, bp: 50 },
    ]);

    const p0 = bestiaryProgress(10000, 100);
    assert.equal(p0.tier, 0);
    assert.equal(p0.bp, 0);
    assert.equal(p0.killsRemaining, 15000);
    assert.equal(p0.etaMin, 150);

    const p1 = bestiaryProgress(25000, 50);
    assert.equal(p1.tier, 1);
    assert.equal(p1.bp, 5);
    assert.equal(p1.next.abates, 50000);

    const p3 = bestiaryProgress(120000, 50);
    assert.equal(p3.tier, 3);
    assert.equal(p3.bp, 50);
    assert.equal(p3.next, null);
    assert.equal(p3.pct, 100);
});

test('rotacao de bosses vira as 18h BRT e chances por par escalam', () => {
    assert.equal(REGIOES_BOSS.length, 9);
    assert.deepEqual(PREMIOS_DA_TRINCA, ['tm', 'mega', 'tickets']);
    assert.equal(ROTACAO_BOSS_DIA_ZERO, '2026-11-17');

    const dia0 = Date.UTC(2026, 10, 17, 12, 0, 0);
    const viradaDia1 = Date.UTC(2026, 10, 17, 21, 0, 0);
    assert.equal(premioDoBossNoInstante(0, dia0), 'tm');
    assert.equal(premioDoBossNoInstante('johto', dia0), 'mega');
    assert.equal(premioDoBossNoInstante(2, dia0), 'tickets');
    assert.equal(premioDoBossNoInstante(0, viradaDia1), 'mega');

    const c1 = chancesBossPorPar(1);
    const c4 = chancesBossPorPar(4);
    assert.ok(c4.tm > c1.tm && c4.mega > c1.mega && c4.tickets > c1.tickets);
});

test('safari e agenda de Raid e Showdown', () => {
    assert.equal(SAFARI_BONUS_A_CADA, 6);
    assert.equal(SAFARI_BONUS_MS, 1_800_000);
    assert.ok(Math.abs(MULT_SHINY_TUDO_NO_SAFARI - 2 * 1.15 ** 3) < 1e-12);

    assert.equal(duracaoDoSafariMs(5), 5 * 1_800_000);
    assert.equal(duracaoDoSafariMs(6), 7 * 1_800_000);
    assert.equal(duracaoDoSafariMs(12), 14 * 1_800_000);

    const opt = optimalSafariTickets(14);
    assert.equal(opt.ticketsToUse, 12);
    assert.equal(opt.bonusTickets, 2);
    assert.equal(opt.remainder, 2);

    assert.ok(RAID_SCHEDULE.hoursBrt.length > 0);
    assert.ok(SHOWDOWN_SCHEDULE.hoursBrt.length > 0);
    const evs = getUpcomingEvents(Date.UTC(2026, 10, 27, 12, 0, 0));
    assert.ok(evs.length >= 2);
    for (let i = 1; i < evs.length; i++) {
        assert.ok(evs[i].startsAt >= evs[i - 1].startsAt);
    }
});

test('bicicletas, casas, craft, teto de depot/colecao, oferenda e Black Friday', () => {
    assert.equal(MAX_CASAS_EM_USO, 5);
    assert.ok(BICICLETA_VELOCIDADE.mitica > BICICLETA_VELOCIDADE.comum);
    assert.ok(CASA_XP_SHARE.mitica.slots > CASA_XP_SHARE.comum.slots);

    const bikes = [
        { id: 1, raridade: 'comum' },
        { id: 2, raridade: 'lendaria' },
        { id: 3, raridade: 'mitica', anunciada: true },
    ];
    const up = findBestBikeUpgrade(bikes, 1);
    assert.equal(up?.upgrade.id, 2);
    assert.equal(findBestBikeUpgrade(bikes, 2), null);

    const craft = findCraftableSets({ 70011: 12, 70012: 4, 70013: 5, 70017: 25 }, 5);
    assert.equal(craft.find((c) => c.id === 70011)?.sets, 2);
    assert.equal(craft.find((c) => c.id === 70012), undefined);
    assert.equal(craft.find((c) => c.id === 70013)?.sets, 1);
    assert.equal(craft.find((c) => c.id === 70017)?.sets, 2);

    assert.equal(TETO_DEPOT, 3000);
    assert.equal(TETO_COLECAO, 3000);
    const pokes = [
        ...Array.from({ length: 2700 }, (_, i) => ({ id: i + 1 })),
        ...Array.from({ length: 2850 }, (_, i) => ({ id: 10000 + i })),
    ];
    const colSet = new Set(Array.from({ length: 2850 }, (_, i) => 10000 + i));
    const cap = computeCapStatus(pokes, colSet);
    assert.equal(cap.depot.warn, true);
    assert.equal(cap.depot.danger, false);
    assert.equal(cap.colecao.danger, true);
    assert.equal(cap.anyDanger, true);

    const ofrPool = [
        ...Array.from({ length: 6 }, (_, i) => ({ id: i + 1, tipos: ['FIRE'] })),
        ...Array.from({ length: 5 }, (_, i) => ({ id: 100 + i, tipos: ['WATER', 'GROUND'] })),
        ...Array.from({ length: 5 }, (_, i) => ({ id: 200 + i, tipos: ['GRASS'], shiny: true })),
        { id: 300, tipos: ['FIRE'], level: 120 },
        { id: 301, tipos: ['FIRE'], potencia: 5 },
    ];
    const batchesMono = selectOferendaBatches(ofrPool, new Set([6]), { monoTypeOnly: true });
    assert.equal(batchesMono.length, 1);
    assert.deepEqual(batchesMono[0].pokemonIds, [1, 2, 3, 4, 5]);

    const batchesAny = selectOferendaBatches(ofrPool, null, { monoTypeOnly: false, allowShiny: true });
    assert.equal(batchesAny.filter((b) => b.shiny).length, 1);
    assert.equal(batchesAny.filter((b) => !b.shiny).length, 2);

    assert.equal(BLACK_FRIDAY.pct, 50);
    assert.equal(isBlackFridayActive(BLACK_FRIDAY.vitrineDesde), false);
    assert.equal(isBlackFridayActive(BLACK_FRIDAY.inicio), true);
    assert.equal(isBlackFridayActive(BLACK_FRIDAY.fim - 1), true);
    assert.equal(isBlackFridayActive(BLACK_FRIDAY.fim), false);
});
