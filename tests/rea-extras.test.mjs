import test from 'node:test';
import assert from 'node:assert/strict';
import {
    NIVEL_TETO_OURO,
    REGIOES_BOSS,
    premioDoBossNoInstante,
    evaluateLureFractionRisk,
    selectBestAutoBoss,
    recommendBestGymForTeam,
    computePvpRankIntel,
    computeLootLeverageInfo,
    computeGuildRaidIntel,
    computeAccountProbGuide,
    summarizeSessionRolls,
    selectBestRaidTeam,
    buildPvpFormationForMode,
    analyzeOwnListingsUndercut,
} from '../src/headless/pvp-meta.mjs';
import {
    ITEM_IDS,
    computeIncubatorStatus,
    evaluateSeasonalTeamSwap,
    evaluateTeamAutoManage,
    evaluatePostReviveHeal,
    evaluateAutoPokedexEvolve,
    evaluateAutoBossRotation,
    evaluateAutoSafariSmart,
    selectObjectiveHunt,
} from '../src/headless/protocol-engine.mjs';

test('evaluateLureFractionRisk: identifica fracao < 60m e hora fechada sem risco', () => {
    const now = 10_000_000;
    const risk = evaluateLureFractionRisk({ bolas: 20, expiraEm: now + 25 * 60_000 }, now);
    assert.equal(risk.atRisk, true);
    assert.equal(risk.minutesLost, 25);
    assert.equal(risk.nextHourShortByMin, 35);
    assert.equal(risk.bolasAtRisk, 50);
    assert.match(risk.message, /cortarGarantiaNoFim/);
    assert.match(risk.message, /\+50 Beast Balls/);

    const safeExact = evaluateLureFractionRisk({ remainingMs: 2 * 3_600_000, bolas: 10 }, now);
    assert.equal(safeExact.atRisk, false);
    assert.equal(safeExact.wholeHours, 2);

    const fracHours = evaluateLureFractionRisk({ horas: 1.5, bolas: 5 }, now);
    assert.equal(fracHours.atRisk, true);
    assert.equal(fracHours.minutesLost, 30);

    const empty = evaluateLureFractionRisk(null, now);
    assert.equal(empty.atRisk, false);
});

test('selectBestAutoBoss: escolhe regiao mais alta desbloqueada para o premio desejado', () => {
    const t = Date.UTC(2026, 10, 17, 12, 0, 0);
    const regions = REGIOES_BOSS.map((region, index) => ({
        region,
        index,
        prize: premioDoBossNoInstante(region, t),
    }));
    const bossRotation = { regions };

    // Johto (par0=1, nivelMin=650) tem 'mega' no dia 0; Alola (6) -> 75900; Unova (4) -> 22700 ('mega')
    const lv1000 = selectBestAutoBoss(bossRotation, 1000, 'mega');
    assert.equal(lv1000?.region, 'johto');
    assert.equal(lv1000?.nivelMin, 650);
    assert.equal(lv1000?.prize, 'mega');

    const lv30000 = selectBestAutoBoss(bossRotation, 30000, 'mega');
    assert.equal(lv30000?.region, 'unova');
    assert.equal(lv30000?.nivelMin, 22700);

    assert.equal(selectBestAutoBoss(bossRotation, 100, 'mega'), null);
    assert.equal(selectBestAutoBoss(null, 50000, 'tm'), null);
});

test('recommendBestGymForTeam: verifica cooldown 24h e pontua 18 tipos incluindo dual-type', () => {
    const now = 5_000_000;
    const species = new Map([
        [6, { pokeId: 6, type1: 'FIRE', type2: 'FLYING' }],
        [9, { pokeId: 9, type1: 'WATER' }],
        [130, { pokeId: 130, type1: 'WATER', type2: 'FLYING' }],
    ]);
    const team = [
        { id: 1, speciesId: 6 },
        { id: 2, speciesId: 9 },
        { id: 3, speciesId: 130 },
    ];
    const gymsReady = {
        nextCooldownAt: now - 1000,
        podiums: [{ tipo: 'FLYING', pos: 1 }, { tipo: 'WATER', pos: 3 }],
    };
    const rec = recommendBestGymForTeam(team, gymsReady, species, now);
    assert.equal(rec.cooldownReady, true);
    assert.equal(rec.cooldownRemainingMs, 0);
    assert.equal(rec.recommendedType, 'WATER');
    assert.equal(rec.recommendedCount, 2);
    assert.equal(rec.topOptions.length, 5);
    assert.match(rec.recommendedSummary, /WATER/);

    // Dual-type herda melhor podio (Gyarados herda 25% de FLYING mesmo WATER sendo pos 3 = 5%)
    const waterOpt = rec.topOptions.find((o) => o.tipo === 'WATER');
    assert.equal(waterOpt?.bestPodiumPct, 25);
    assert.equal(waterOpt?.currentPodiumPct, 5);
    assert.equal(waterOpt?.potentialGain, 20); // apenas Blastoise (mono WATER, 5% -> 25%) precisa de WATER

    // Quando team tem 2 FLYING ja cobertos por podio 1 (25%), nenhum ganho adicional em FLYING
    const teamTie = [
        { id: 1, speciesId: 6 }, // FIRE / FLYING (herda 25% de FLYING)
        { id: 3, speciesId: 130 }, // WATER / FLYING (herda 25% de FLYING)
    ];
    const recTie = recommendBestGymForTeam(teamTie, gymsReady, species, now);
    assert.equal(recTie.recommendedCount, 2);
    assert.equal(recTie.recommendedType, 'FLYING');

    const gymsCd = { nextCooldownAt: now + 600_000 };
    const recCd = recommendBestGymForTeam(team, gymsCd, species, now);
    assert.equal(recCd.cooldownReady, false);
    assert.equal(recCd.cooldownRemainingMs, 600_000);
});

test('computePvpRankIntel: calcula decaimento 24h, escudo e janelas progressivas de PR', () => {
    const t0 = 100_000_000;
    const intel0 = computePvpRankIntel({ pr: 1500, escudo: 1, lastMatchAt: t0 - 21 * 3_600_000, queueSince: t0 }, t0);
    assert.equal(intel0.tierShieldActive, true);
    assert.equal(intel0.escudo, 1);
    assert.equal(intel0.decayWarning, true);
    assert.equal(intel0.decayActive, false);
    assert.equal(intel0.prWindow, 25);

    const cases = [
        [2 * 60_000, 50],
        [5 * 60_000, 100],
        [15 * 60_000, 150],
        [30 * 60_000, 250],
        [60 * 60_000, 400],
        [120 * 60_000, 600],
        [240 * 60_000, 1000],
        [360 * 60_000, Infinity],
    ];
    for (const [elapsed, expectedWindow] of cases) {
        const res = computePvpRankIntel({ queueElapsedMs: elapsed }, t0);
        assert.equal(res.prWindow, expectedWindow);
    }

    const decayed = computePvpRankIntel({ lastMatchAt: t0 - 25 * 3_600_000 }, t0);
    assert.equal(decayed.decayActive, true);
    assert.equal(decayed.decayRemainingMs, 0);
});

test('computeLootLeverageInfo e computeGuildRaidIntel: formulas oficiais', () => {
    assert.equal(NIVEL_TETO_OURO, 25000);
    const low = computeLootLeverageInfo(10000, 50);
    assert.equal(low.active, false);
    assert.equal(low.multiplier, 1.5);

    const high = computeLootLeverageInfo(25000, 100);
    assert.equal(high.active, true);
    assert.equal(high.multiplier, 2);

    const now = 1_000_000;
    const guild = computeGuildRaidIntel({
        id: 7,
        fighters: 10,
        teamDamage: 125_000,
        boostAte: now + 3 * 86_400_000,
        diamantes: 350,
    }, now);
    assert.equal(guild.reserveMaxHp, 250_000);
    assert.equal(guild.bonusPct, 2.5);
    assert.equal(guild.boostActive, true);
    assert.equal(guild.boostPct, 10);
    assert.equal(guild.diamondsGoal, 500);
    assert.equal(guild.diamondsRemaining, 150);

    const noGuild = computeGuildRaidIntel(undefined, now);
    assert.equal(noGuild.hasGuild, false);
    assert.equal(noGuild.reserveMaxHp, 0);
    assert.equal(noGuild.bonusPct, 0);
});

test('computeAccountProbGuide e summarizeSessionRolls: EV de Ovo Shiny e estatisticas de captura', () => {
    const guide = computeAccountProbGuide({
        killsPerHour: 1500,
        huntLevel: 5000,
        isOutland: false,
        captureBoost: true,
        lureActive: true,
        twitchShiny: true,
        kickShiny: true,
    });
    assert.equal(guide.step, 1);
    assert.equal(guide.avgKillsPerFrag, 150_000);
    assert.equal(guide.avgKillsPerEgg, 1_500_000);
    assert.equal(guide.hoursPerEgg, 1000);
    assert.equal(guide.nextStep, 2);
    assert.equal(guide.nextLevel, 5400);
    assert.ok(guide.hoursPerEggNextStep < guide.hoursPerEgg);
    assert.equal(guide.mysticBeastPct, 1.0);
    assert.equal(guide.tables.quality.q180.oneIn, 347);
    assert.equal(guide.tables.prey.oneIn, 200);
    assert.equal(guide.tables.craft.legendaryOneIn, 20000);
    assert.equal(guide.tables.boss[8].region, 'paldea');
    assert.equal(guide.tables.boss[8].mult, 9);
    assert.deepEqual(guide.tables.stoneDrops, { stage0Pct: 20, stage1Pct: 35, finalOrOutlandPct: 50 });

    const outGuide = computeAccountProbGuide({ killsPerHour: 2000, huntLevel: 50000, isOutland: true });
    assert.equal(outGuide.step, 0);
    assert.equal(outGuide.baseChance, 0);
    assert.equal(outGuide.hoursPerEgg, null);

    const rolls = summarizeSessionRolls([
        { potencia: 4, quality: 1.55 },
        { potencia: 5, quality: 1.80 },
        { potencia: 4, quality: 1.72 },
        { potencia: 1, quality: 1.05 },
    ]);
    assert.equal(rolls.total, 4);
    assert.equal(rolls.p4, 2);
    assert.equal(rolls.p5, 1);
    assert.equal(rolls.q150, 3);
    assert.equal(rolls.q170, 2);
    assert.equal(rolls.q180, 1);
    assert.equal(rolls.expected.q150, Number((4 * 0.05962).toFixed(2)));
    assert.equal(rolls.expected.q170, Number((4 * 0.00962).toFixed(2)));
    assert.equal(rolls.expected.q180, Number((4 * 0.00288).toFixed(2)));
});

test('selectBestRaidTeam e buildPvpFormationForMode: seleciona PvE e modos ginasio/guerra', () => {
    const catalog = new Map([
        [20, { pokeId: 20, type1: 'NORMAL', baseHp: 55, baseAtk: 81, baseDef: 60, baseSpAtk: 50, baseSpDef: 70, baseSpeed: 97 }],
        [149, { pokeId: 149, type1: 'DRAGON', baseHp: 91, baseAtk: 134, baseDef: 95, baseSpAtk: 100, baseSpDef: 100, baseSpeed: 80 }],
        [208, { pokeId: 208, type1: 'STEEL', type2: 'GROUND', baseHp: 75, baseAtk: 85, baseDef: 200, baseSpAtk: 55, baseSpDef: 65, baseSpeed: 30 }],
    ]);
    const pokemons = [
        { id: 1, speciesId: 149, level: 5000, potencia: 5, quality: 1.6, iv: 180, mega: true, tmElemental: 'DRAGON' },
        { id: 2, speciesId: 20, level: 150, potencia: 5, quality: 1.75, iv: 185, tmElemental: 'NORMAL', stats: { hp: 380, def: 260, spDef: 250, atk: 180, spAtk: 90, speed: 150 } },
        { id: 3, speciesId: 208, level: 200, potencia: 4, quality: 1.4, iv: 160, stats: { hp: 420, def: 520, spDef: 220, atk: 180, spAtk: 90, speed: 60 } },
        { id: 4, speciesId: 20, level: 100, potencia: 1, quality: 1.0, iv: 60 },
        { id: 5, speciesId: 149, level: 300, potencia: 3, quality: 1.2, iv: 120 },
        { id: 6, speciesId: 208, level: 150, potencia: 2, quality: 1.1, iv: 100 },
    ];

    const raid = selectBestRaidTeam(pokemons, catalog, 5);
    assert.equal(raid.pokemonIds.length, 5);
    assert.equal(raid.pokemonIds[0], 1);

    const war = buildPvpFormationForMode({ pokemons }, 'guerra', catalog);
    assert.equal(war.mode, 'guerra');
    assert.equal(war.pokemonIds.length, 5);
    assert.equal(new Set(Object.values(war.casas)).size, 5);
    // Tanques ficam na linha de frente (0..5)
    assert.ok(war.casas['3'] >= 0 && war.casas['3'] <= 5);

    const gym = buildPvpFormationForMode({ pokemons }, 'ginasio', catalog);
    assert.equal(gym.mode, 'ginasio');
    assert.equal(gym.pokemonIds.length, 5);
});

test('analyzeOwnListingsUndercut: detecta undercut e calcula liquido com taxas de Orb e Gold', () => {
    const listings = [
        { id: 'a1', preco: 450, moeda: 'orb', tipo: 'pokemon' },
        { id: 'a2', preco: 1200, moeda: 'orb', tipo: 'pokemon' },
        { id: 'a3', preco: 100, moeda: 'gold', tipo: 'item' },
    ];
    const floors = { a1: 400, a2: 1500, a3: 50 };
    const analysis = analyzeOwnListingsUndercut(listings, (l) => floors[l.id]);
    assert.equal(analysis.total, 3);
    assert.equal(analysis.undercutCount, 2);

    const a1 = analysis.listings.find((x) => x.id === 'a1');
    assert.equal(a1.undercut, true);
    assert.equal(a1.suggestedPrice, 396); // 400 * 0.99
    assert.equal(a1.currentNet, 450 - Math.round(450 * 0.13));

    const a2 = analysis.listings.find((x) => x.id === 'a2');
    assert.equal(a2.undercut, false);
    assert.equal(a2.suggestedPrice, 1200);
    assert.equal(a2.currentNet, 1200 - Math.round(1200 * 0.10));

    const a3 = analysis.listings.find((x) => x.id === 'a3');
    assert.equal(a3.undercut, true);
    assert.equal(a3.suggestedPrice, 49);
    assert.equal(a3.currentNet, 85);
});

test('computeIncubatorStatus: conta slots ocupados, livres, prontos e ovos na mochila', () => {
    const now = 5_000_000;
    const status = computeIncubatorStatus({
        chocadeira: {
            total: 3,
            ovos: [
                { slot: 0, ovo: 'shiny', terminaEm: now - 1000 },
                { slot: 2, ovo: 'p4', terminaEm: now + 60_000 },
            ],
        },
        items: { 70094: 1, 70093: 2, 70092: 3, 70091: 4 },
    }, now);

    assert.equal(status.totalSlots, 3);
    assert.equal(status.usedSlots, 2);
    assert.equal(status.freeSlots, 1);
    assert.equal(status.readyCount, 1);
    assert.deepEqual(status.eggsInBag, { shiny: 1, p4: 2, p3: 3, p2: 4, total: 10 });
});

test('evaluateSeasonalTeamSwap: troca no Mapa nao Outland e respeita teto trainerLevel+5 e cooldown', () => {
    const now = 100_000;
    const state = {
        level: 50,
        huntSlug: 'cerulean-water',
        activeId: 1,
        diaSazonal: { tipo: 'GRASS' },
        pokemons: [
            { id: 1, slot: 0, speciesId: 4, level: 40, tipos: ['FIRE'], hp: 100, maxHp: 100 },
            { id: 2, slot: 1, speciesId: 1, level: 80, tipos: ['GRASS'], hp: 100, maxHp: 100 }, // acima de 55
            { id: 3, slot: 2, speciesId: 2, level: 52, tipos: ['GRASS'], hp: 100, maxHp: 100 },
        ],
    };
    const tracker = {};
    const actions = evaluateSeasonalTeamSwap(state, { huntsBySlug: { 'cerulean-water': { area: 'mapa' } } }, { autoSeasonalSwap: true }, tracker, now);
    assert.deepEqual(actions, [{ t: 'team.active', pokemonId: 3 }]);

    // Cooldown de 3s bloqueia troca imediata
    assert.deepEqual(evaluateSeasonalTeamSwap(state, {}, { autoSeasonalSwap: true }, tracker, now + 1000), []);
    // Outland bloqueia
    assert.deepEqual(evaluateSeasonalTeamSwap({ ...state, huntSlug: 'outland-1' }, {}, { autoSeasonalSwap: true }, {}, now + 5000), []);
});

test('evaluateTeamAutoManage: troca ao bater trainerLevel+5, mas NUNCA troca starter por teto de nivel', () => {
    const now = 200_000;
    const starterState = {
        level: 50,
        activeId: 1,
        pokemons: [
            { id: 1, slot: 0, starter: true, level: 60, hp: 100, maxHp: 100, tipos: ['FIRE'] },
            { id: 2, slot: 1, starter: false, level: 40, hp: 100, maxHp: 100, tipos: ['WATER'] },
        ],
    };
    assert.deepEqual(evaluateTeamAutoManage(starterState, {}, { autoTeamManage: true }, {}, now), []);

    const nonStarterState = {
        level: 50,
        activeId: 1,
        pokemons: [
            { id: 1, slot: 0, starter: false, level: 55, hp: 100, maxHp: 100, tipos: ['FIRE'] },
            { id: 2, slot: 1, starter: false, level: 40, hp: 100, maxHp: 100, tipos: ['WATER'] },
        ],
    };
    const tracker = {};
    assert.deepEqual(
        evaluateTeamAutoManage(nonStarterState, {}, { autoTeamManage: true }, tracker, now),
        [{ t: 'team.active', pokemonId: 2 }]
    );

    // HP <= 25% sem pocao dispara troca
    const lowHpState = {
        level: 50,
        activeId: 1,
        items: {},
        automation: { autoPotion: false },
        pokemons: [
            { id: 1, slot: 0, starter: true, level: 45, hp: 20, maxHp: 100, tipos: ['FIRE'] },
            { id: 2, slot: 1, starter: false, level: 40, hp: 100, maxHp: 100, tipos: ['WATER'] },
        ],
    };
    assert.deepEqual(
        evaluateTeamAutoManage(lowHpState, {}, { autoTeamManage: true }, {}, now + 5000),
        [{ t: 'team.active', pokemonId: 2 }]
    );
});

test('evaluatePostReviveHeal: usa melhor pocao apos revive normal (10% HP) uma vez por revive', () => {
    const now = 300_000;
    const state = {
        activeId: 1,
        pokemons: [{ id: 1, hp: 10, maxHp: 100 }],
        items: { [ITEM_IDS.SMALL_POTION]: 5, [ITEM_IDS.HYPER_POTION]: 2 },
    };
    const tracker = { lastNormalReviveAt: now - 2000 };
    const first = evaluatePostReviveHeal(state, {}, tracker, now);
    assert.deepEqual(first, [{ t: 'item.use', itemId: ITEM_IDS.HYPER_POTION }]);
    // Nao repete para o mesmo revive
    assert.deepEqual(evaluatePostReviveHeal(state, {}, tracker, now + 5000), []);
});

test('evaluateAutoPokedexEvolve, evaluateAutoBossRotation e evaluateAutoSafariSmart', () => {
    const now = 500_000;
    const evolveTracker = {};
    const evoList = [{ pokemonId: 10, alvoId: 11, ready: true }, { pokemonId: 12, alvoId: 13, ready: false }];
    assert.deepEqual(
        evaluateAutoPokedexEvolve({ nick: 'A' }, evoList, { autoPokedexEvolve: true }, evolveTracker, now),
        [{ t: 'pokemon.evoluir', pokemonId: 10, alvoId: 11 }]
    );
    assert.deepEqual(
        evaluateAutoPokedexEvolve({ nick: 'A' }, evoList, { autoPokedexEvolve: true }, evolveTracker, now + 3000),
        []
    );

    const tBoss = Date.UTC(2026, 10, 17, 12, 0, 0);
    const bossRotation = {
        regions: REGIOES_BOSS.map((region, index) => ({ region, index, prize: premioDoBossNoInstante(region, tBoss) })),
    };
    const bossTracker = {};
    const bossActions = evaluateAutoBossRotation({ level: 1000 }, bossRotation, { autoBossEnabled: true, autoBossPrize: 'mega' }, bossTracker, now);
    assert.deepEqual(bossActions, [{ t: 'boss.auto', ativo: true, key: 'johto' }]);
    assert.deepEqual(evaluateAutoBossRotation({ level: 1000 }, bossRotation, { autoBossEnabled: true, autoBossPrize: 'mega' }, bossTracker, now + 10_000), []);

    const safariTracker = {};
    const safariState = {
        items: { 70095: 14 },
        loja: { lure: true },
    };
    const liveBuffs = { twitchShiny: true, kickShiny: true };
    assert.deepEqual(
        evaluateAutoSafariSmart(safariState, liveBuffs, { autoSafariSmart: true }, safariTracker, now),
        [{ t: 'safari.entrar', tickets: 12 }]
    );
    assert.deepEqual(
        evaluateAutoSafariSmart(safariState, liveBuffs, { autoSafariSmart: true }, safariTracker, now + 60_000),
        []
    );
});

test('selectObjectiveHunt: Top Catch com preferEasyStage prioriza estagio inicial (teto 20 = 2.87)', () => {
    const speciesCatalog = new Map([
        [4, { pokeId: 4, name: 'Charmander', evolvesToId: 5 }],
        [5, { pokeId: 5, name: 'Charmeleon', evolvesToId: 6 }],
        [6, { pokeId: 6, name: 'Charizard' }],
    ]);
    const hunts = [
        { slug: 'charizard-peak', nome: 'Charizard Peak', nivel: 30, especies: [{ pokeId: 6 }] },
        { slug: 'charmander-camp', nome: 'Charmander Camp', nivel: 10, especies: [{ pokeId: 4 }] },
    ];
    const easy = selectObjectiveHunt({
        mode: 'topcatch',
        focus: 'xp',
        hunts,
        trainerLevel: 50,
        activePokemonLevel: 50,
        capturedSet: new Set(),
        speciesCatalog,
        preferEasyStage: true,
    });
    assert.equal(easy.targetSlug, 'charmander-camp');
    assert.equal(easy.easyStageCeiling, 2.87);

    const noEasy = selectObjectiveHunt({
        mode: 'topcatch',
        focus: 'xp',
        hunts,
        trainerLevel: 50,
        activePokemonLevel: 50,
        capturedSet: new Set(),
        speciesCatalog,
        preferEasyStage: false,
    });
    assert.equal(noEasy.targetSlug, 'charizard-peak');
});
