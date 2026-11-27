import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MS_ONDA,
    MAX_MOBS,
    CD_GOLPE_MS,
    MS_DESLOC_MS,
    CD_MOVIMENTO_MEDIO_MS,
    VIP_MULT_XP,
    NIVEL_ANCORA,
    OURO_ANCORA,
    NIVEL_TETO_OURO,
    EXPOENTE_RENDA,
    FRACAO_BONUS_LOOT,
    OURO_KILL_NIVEL_1,
    OURO_KILL_ANCORA_NIVEL,
    OURO_KILL_ANCORA,
    FATOR_CAPTURA_DO_DEGRAU,
    CHANCE_PEDRA_POR_ESTAGIO,
    DEGRAUS_FRAGMENTO_OVO_SHINY,
    OUTLAND_TIERS,
    AJUSTE_HUNT_LEVEL,
    AJUSTE_TIPOS,
    xpDoNivel,
    ouroDoNivel,
    ouroPorKillDoNivel,
    alvoRendaPorKill,
    ouroDoLootPorKill,
    ouroDoAbate,
    multDanoSazonal,
    getSeasonalTypeWindow,
    degrauFragmentoOvoShiny,
    chanceFragmentoOvoShiny,
    proximoDegrauOvoShiny,
    outlandTier,
    tierOutlandValido,
    potencialDoSpeed,
    descontoDoSpeedPct,
    cooldownGolpeComSpeed,
    killsPorHora,
    analyzeNativeHunts,
} from '../src/headless/native-hunt-analyser.mjs';

test('constantes oficiais de hunt e recompensas conferem com pokeidle.io v1.492.0', () => {
    assert.equal(MS_ONDA, 2600);
    assert.equal(MAX_MOBS, 16);
    assert.equal(CD_GOLPE_MS, 900);
    assert.equal(MS_DESLOC_MS, 600);
    assert.equal(CD_MOVIMENTO_MEDIO_MS, 2000);
    assert.equal(VIP_MULT_XP, 1.5);
    assert.equal(NIVEL_ANCORA, 150);
    assert.equal(OURO_ANCORA, 12000);
    assert.equal(NIVEL_TETO_OURO, 25000);
    assert.equal(EXPOENTE_RENDA, 0.3);
    assert.equal(FRACAO_BONUS_LOOT, 0.15);
    assert.equal(OURO_KILL_NIVEL_1, 36);
    assert.equal(OURO_KILL_ANCORA_NIVEL, 5000);
    assert.equal(OURO_KILL_ANCORA, 6000);
    assert.deepEqual(FATOR_CAPTURA_DO_DEGRAU, { 20: 2.8669, 40: 3.5745, 100: 4.4681 });
    assert.deepEqual(CHANCE_PEDRA_POR_ESTAGIO, [0.2, 0.35, 0.5]);
    assert.equal(DEGRAUS_FRAGMENTO_OVO_SHINY.length, 32);
    assert.equal(DEGRAUS_FRAGMENTO_OVO_SHINY[0], 5000);
    assert.equal(DEGRAUS_FRAGMENTO_OVO_SHINY[31], 160300);
    assert.equal(OUTLAND_TIERS.length, 40);
    assert.deepEqual(OUTLAND_TIERS[0], { tier: 101, numero: 1, rotulo: 'Outland 1', nivel: 150, mult: 1 });
    assert.deepEqual(OUTLAND_TIERS[39], { tier: 140, numero: 40, rotulo: 'Outland 40', nivel: 65000, mult: 20 });
    assert.equal(AJUSTE_HUNT_LEVEL[112], 100);
    assert.equal(AJUSTE_HUNT_LEVEL[468], 1500);
    assert.deepEqual(AJUSTE_TIPOS[448], ['FIGHTING', 'STEEL']);
    assert.deepEqual(AJUSTE_TIPOS[13448], ['FIGHTING', 'STEEL']);
});

test('curvas de XP e ouro por nivel respeitam ancoras e teto', () => {
    assert.equal(xpDoNivel(1), 8);
    assert.equal(xpDoNivel(10), 68);
    assert.equal(xpDoNivel(150), 13508);
    assert.ok(xpDoNivel(300) > xpDoNivel(150));

    assert.equal(ouroDoNivel(150), 12000);
    assert.equal(ouroPorKillDoNivel(1), 36);
    assert.equal(ouroPorKillDoNivel(5000), 6000);
    assert.equal(ouroPorKillDoNivel(25000), ouroPorKillDoNivel(50000));

    const alvo25k = alvoRendaPorKill(25000);
    const alvo50k = alvoRendaPorKill(50000);
    assert.ok(alvo50k > alvo25k);

    const abate0 = ouroDoAbate(5000, 0);
    const abate100 = ouroDoAbate(5000, 100);
    assert.equal(abate0.base, 6000);
    assert.equal(abate0.loot, 900);
    assert.equal(abate0.total, 6900);
    assert.equal(abate100.loot, 1800);
    assert.equal(abate100.total, 7800);
    assert.equal(ouroDoLootPorKill(5000, 50), 1350);
});

test('dia sazonal: multiplicador de dano e janela de 18h BRT (21:00 UTC)', () => {
    assert.equal(multDanoSazonal('FIRE', ['FIRE'], ['GRASS']), 2);
    assert.equal(multDanoSazonal('FIRE', ['WATER'], ['FIRE']), 0.25);
    assert.equal(multDanoSazonal('FIRE', ['FIRE'], ['FIRE']), 0.5);
    assert.equal(multDanoSazonal('FIRE', ['WATER'], ['GRASS']), 1);
    assert.equal(multDanoSazonal(null, ['FIRE'], ['FIRE']), 1);

    const antes = Date.UTC(2026, 10, 27, 20, 59, 59);
    const depois = Date.UTC(2026, 10, 27, 21, 0, 0);
    const wAntes = getSeasonalTypeWindow(antes);
    const wDepois = getSeasonalTypeWindow(depois);
    assert.equal(wAntes.key, '2026-11-27');
    assert.equal(wAntes.endsAt, depois);
    assert.equal(wDepois.key, '2026-11-28');
    assert.equal(wDepois.startsAt, depois);
    assert.equal(wDepois.endsAt - wDepois.startsAt, 86_400_000);
});

test('fragmento de Ovo Shiny: degraus, chance por hunt e proximo degrau', () => {
    assert.equal(degrauFragmentoOvoShiny(4999), 0);
    assert.equal(degrauFragmentoOvoShiny(5000), 1);
    assert.equal(degrauFragmentoOvoShiny(5399), 1);
    assert.equal(degrauFragmentoOvoShiny(5400), 2);
    assert.equal(degrauFragmentoOvoShiny(160300), 32);

    assert.equal(chanceFragmentoOvoShiny({ area: 'outland', nivel: 65000 }), 0);
    assert.equal(chanceFragmentoOvoShiny({ area: 'orre', nivel: 4999 }), 0);
    assert.ok(Math.abs(chanceFragmentoOvoShiny({ area: 'orre', nivel: 5000 }) - 1 / 150000) < 1e-12);
    assert.ok(Math.abs(chanceFragmentoOvoShiny({ area: 'orre', nivel: 5400 }) - 1.04 / 150000) < 1e-12);

    assert.deepEqual(proximoDegrauOvoShiny(4500), {
        nextLevel: 5000,
        nextStep: 1,
        nextChance: 1 / 150000,
        deltaLevel: 500,
    });
    assert.equal(proximoDegrauOvoShiny(160300), null);
});

test('Outland tiers e validacao de nivel', () => {
    assert.deepEqual(outlandTier(101), { tier: 101, numero: 1, rotulo: 'Outland 1', nivel: 150, mult: 1 });
    assert.deepEqual(outlandTier(140), { tier: 140, numero: 40, rotulo: 'Outland 40', nivel: 65000, mult: 20 });
    assert.equal(outlandTier(100), null);
    assert.equal(tierOutlandValido(101, 149), false);
    assert.equal(tierOutlandValido(101, 150), true);
    assert.equal(tierOutlandValido(140, 65000), true);
    assert.equal(tierOutlandValido(999, 99999), false);
});

test('speed do Pokemon e killsPorHora com bicicleta e Prey Spawn', () => {
    assert.equal(potencialDoSpeed(0), 0);
    assert.equal(potencialDoSpeed(120), 6);
    assert.equal(potencialDoSpeed(160), 7);
    assert.equal(potencialDoSpeed(220), 7);
    assert.equal(descontoDoSpeedPct(120, 32), 6);
    assert.equal(descontoDoSpeedPct(120, 16), 3);
    assert.equal(cooldownGolpeComSpeed(10000, 120, 32), 9400);

    const hunt = { slug: 'viridian', especies: [{ pokeId: 10, pontos: 10 }] };
    const kphBase = killsPorHora(hunt);
    // 10 mobs * 3500ms + 2600ms = 37.6s -> 10 / 37.6 * 3600
    assert.ok(Math.abs(kphBase - (10 / 37.6) * 3600) < 1e-6);

    const kphBike = killsPorHora(hunt, { bikeSpeed: 1.0 });
    const kphPrey = killsPorHora(hunt, { preySpawnExtra: 5 });
    assert.ok(kphBike > kphBase);
    assert.ok(kphPrey > kphBase);
});

test('analyzeNativeHunts ordena por XP, ouro e shiny com ajustes, sazonal, eggStep e pedras', () => {
    const speciesById = new Map([
        [1, { pokeId: 1, name: 'Bulbasaur', type1: 'GRASS', type2: 'POISON', evolvesToId: 2, baseHp: 45, baseAtk: 49, baseDef: 49, baseSpAtk: 65, baseSpDef: 65, baseSpeed: 45, catchRate: 45 }],
        [2, { pokeId: 2, name: 'Ivysaur', type1: 'GRASS', type2: 'POISON', evolvesToId: 3, baseHp: 60, baseAtk: 62, baseDef: 63, baseSpAtk: 80, baseSpDef: 80, baseSpeed: 60, catchRate: 45 }],
        [143, { pokeId: 143, name: 'Snorlax', type1: 'NORMAL', evolvesToId: null, baseHp: 160, baseAtk: 110, baseDef: 65, baseSpAtk: 65, baseSpDef: 110, baseSpeed: 30, catchRate: 25 }],
        [448, { pokeId: 448, name: 'Lucario', type1: 'STEEL', type2: 'FIGHTING', evolvesToId: null, baseHp: 70, baseAtk: 110, baseDef: 70, baseSpAtk: 115, baseSpDef: 70, baseSpeed: 90, catchRate: 45 }],
        [2001, { pokeId: 2001, name: 'Brave Blastoise', type1: 'WATER', evolvesToId: null, baseHp: 79, baseAtk: 83, baseDef: 100, baseSpAtk: 85, baseSpDef: 105, baseSpeed: 78, catchRate: 45 }],
    ]);
    const typeChart = {
        FIRE: { GRASS: 2, ICE: 2, BUG: 2, STEEL: 2, WATER: 0.5 },
        GRASS: { WATER: 2, FIRE: 0.5 },
        WATER: { FIRE: 2, GRASS: 0.5 },
        FIGHTING: { NORMAL: 2, STEEL: 2 },
    };
    const nowMs = Date.UTC(2026, 10, 27, 15, 0, 0);
    const activePokemon = {
        id: 99,
        speciesId: 448,
        level: 200,
        stats: { hp: 300, atk: 400, def: 200, spAtk: 400, spDef: 200, speed: 250 },
    };
    const trainer = {
        level: 10000,
        loja: { vipAte: nowMs + 60_000, boosts: {} },
        guildBonusPct: 10,
    };
    const hunts = [
        { slug: 'bulba', nome: 'Bulbasaur Hunt', nivel: 10, area: 'kanto', especies: [{ pokeId: 1, pontos: 10 }] },
        { slug: 'snorlax', nome: 'Snorlax Hunt', nivel: 5000, area: 'unova', especies: [{ pokeId: 143, pontos: 12 }] },
        { slug: 'outland', nome: 'Brave Blastoise', nivel: 60000, area: 'outland', especies: [{ pokeId: 2001, pontos: 16 }] },
    ];

    const res = analyzeNativeHunts({
        hunts,
        activePokemon,
        trainer,
        speciesById,
        typeChart,
        diaSazonal: { tipo: 'FIGHTING' },
        bikeRarity: 'epica',
        preySpawnExtra: 2,
        nowMs,
    });

    assert.equal(res.ranked.length, 3);
    assert.equal(res.byMetric.xp[0].slug, 'outland');
    assert.equal(res.byMetric.ouro[0].slug, 'outland');

    const bulba = res.ranked.find((x) => x.slug === 'bulba');
    const snorlax = res.ranked.find((x) => x.slug === 'snorlax');
    const outland = res.ranked.find((x) => x.slug === 'outland');

    assert.equal(bulba.stoneChance, 0.2);
    assert.equal(bulba.eggStep, 0);
    assert.equal(bulba.nextEggStep.nextLevel, 5000);
    // Lucario recebe AJUSTE_TIPOS ['FIGHTING', 'STEEL'], entao no dia FIGHTING bate x2 em Bulbasaur
    assert.equal(bulba.seasonalMult, 2);
    assert.ok(bulba.weakTypes.some((w) => w.tipo === 'FIRE'));

    assert.equal(snorlax.stoneChance, 0.5);
    assert.equal(snorlax.eggStep, 1);
    assert.ok(snorlax.eggChance > 0);
    assert.equal(snorlax.nextEggStep.nextLevel, 5400);

    assert.equal(outland.stoneChance, 0.5);
    assert.equal(outland.eggStep, 0);
    assert.equal(outland.eggChance, 0);
    assert.equal(outland.nextEggStep, null);
    assert.equal(outland.unsafe, true);
    assert.ok(outland.xpPokemonH > snorlax.xpPokemonH);
    assert.ok(snorlax.shinyH > 0);
});
