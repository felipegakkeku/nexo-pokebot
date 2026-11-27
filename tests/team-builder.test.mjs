import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendedPvpTeam, PVP_TEAM_SIZE } from '../src/headless/team-builder.mjs';
import { PASSIVAS_DESDE_MS } from '../src/headless/pvp-meta.mjs';

function makeSpeciesCatalog() {
    return new Map([
        [6, { pokeId: 6, name: 'Charizard', type1: 'FIRE', type2: 'FLYING', baseHp: 78, baseAtk: 84, baseDef: 78, baseSpAtk: 109, baseSpDef: 85, baseSpeed: 100 }],
        [4, { pokeId: 4, name: 'Charmander', type1: 'FIRE', evolvesToId: 5, evolveLevel: 16, baseHp: 39, baseAtk: 52, baseDef: 43, baseSpAtk: 60, baseSpDef: 50, baseSpeed: 65 }],
        [5, { pokeId: 5, name: 'Charmeleon', type1: 'FIRE', evolvesToId: 6, evolveLevel: 36, baseHp: 58, baseAtk: 64, baseDef: 58, baseSpAtk: 80, baseSpDef: 65, baseSpeed: 80 }],
        [9, { pokeId: 9, name: 'Blastoise', type1: 'WATER', baseHp: 79, baseAtk: 83, baseDef: 100, baseSpAtk: 85, baseSpDef: 105, baseSpeed: 78 }],
        [208, { pokeId: 208, name: 'Steelix', type1: 'STEEL', type2: 'GROUND', baseHp: 75, baseAtk: 85, baseDef: 200, baseSpAtk: 55, baseSpDef: 65, baseSpeed: 30 }],
        [143, { pokeId: 143, name: 'Snorlax', type1: 'NORMAL', baseHp: 160, baseAtk: 110, baseDef: 65, baseSpAtk: 65, baseSpDef: 110, baseSpeed: 30 }],
        [25, { pokeId: 25, name: 'Pikachu', type1: 'ELECTRIC', evolvesToId: 26, evolveLevel: 30, baseHp: 35, baseAtk: 55, baseDef: 40, baseSpAtk: 50, baseSpDef: 50, baseSpeed: 90 }],
        [26, { pokeId: 26, name: 'Raichu', type1: 'ELECTRIC', baseHp: 60, baseAtk: 90, baseDef: 55, baseSpAtk: 90, baseSpDef: 80, baseSpeed: 110 }],
        [94, { pokeId: 94, name: 'Gengar', type1: 'GHOST', type2: 'POISON', baseHp: 60, baseAtk: 65, baseDef: 60, baseSpAtk: 130, baseSpDef: 75, baseSpeed: 110 }],
        [149, { pokeId: 149, name: 'Dragonite', type1: 'DRAGON', type2: 'FLYING', baseHp: 91, baseAtk: 134, baseDef: 95, baseSpAtk: 100, baseSpDef: 100, baseSpeed: 80 }],
        [130, { pokeId: 130, name: 'Gyarados', type1: 'WATER', type2: 'FLYING', baseHp: 95, baseAtk: 125, baseDef: 79, baseSpAtk: 60, baseSpDef: 100, baseSpeed: 81 }],
        [65, { pokeId: 65, name: 'Alakazam', type1: 'PSYCHIC', baseHp: 55, baseAtk: 50, baseDef: 45, baseSpAtk: 135, baseSpDef: 95, baseSpeed: 120 }],
    ]);
}

test('monta time completo de 5 slots com exemplares fortes e formacao tanque na linha de frente', () => {
    const speciesById = makeSpeciesCatalog();
    const pokemons = [
        { id: 101, speciesId: 208, level: 200, quality: 1.45, potencia: 4, iv: 150, stats: { hp: 400, def: 600, spDef: 260, atk: 220, spAtk: 150, speed: 90 } },
        { id: 102, speciesId: 94, level: 180, quality: 1.35, potencia: 5, iv: 160, stats: { hp: 220, def: 140, spDef: 160, atk: 150, spAtk: 420, speed: 350 } },
        { id: 103, speciesId: 6, level: 160, shiny: true, quality: 1.2, potencia: 3, iv: 140, stats: { hp: 260, def: 180, spDef: 190, atk: 220, spAtk: 340, speed: 310 } },
        { id: 104, speciesId: 26, level: 150, quality: 1.4, potencia: 4, iv: 155, stats: { hp: 210, def: 150, spDef: 190, atk: 240, spAtk: 250, speed: 340 } },
        { id: 105, speciesId: 65, level: 170, quality: 1.5, potencia: 4, iv: 170, stats: { hp: 190, def: 120, spDef: 210, atk: 120, spAtk: 450, speed: 390 } },
    ];

    const res = buildRecommendedPvpTeam({
        pokemons,
        hunts: [],
        speciesById,
        trainerLevel: 200,
        nowMs: PASSIVAS_DESDE_MS,
    });

    assert.equal(res.slots.length, PVP_TEAM_SIZE);
    assert.equal(res.readyCount, 5);
    assert.equal(res.pendingCount, 0);
    assert.equal(res.nextTargetHuntSlug, null);
    assert.deepEqual(res.targetSpeciesIds, []);

    // Raichu e Alakazam possuem BST <= 500 e devem receber passiva PvP.
    const raichuSlot = res.slots.find((s) => s.speciesId === 26);
    const alakazamSlot = res.slots.find((s) => s.speciesId === 65);
    assert.equal(raichuSlot?.passive?.tipo, 'ELECTRIC');
    assert.equal(alakazamSlot?.passive?.tipo, 'PSYCHIC');

    // Todos os 5 slots tem tipos primarios distintos.
    const primaryTypes = new Set(res.slots.map((s) => s.types[0]));
    assert.equal(primaryTypes.size, 5);

    // Formacao valida para pvp.time.salvar com Steelix (tanque) na linha de frente (0..5)
    // e atacantes no fundo (14..25).
    const { pokemonIds, casas } = res.suggestedFormation;
    assert.equal(pokemonIds.length, 5);
    assert.ok(casas['101'] >= 0 && casas['101'] <= 5);
    assert.ok(casas['105'] >= 14 && casas['105'] <= 25);
    assert.ok(casas['102'] >= 14 && casas['102'] <= 25);
    assert.equal(new Set(Object.values(casas)).size, 5);
});

test('aponta hunts liberadas quando faltam exemplares fortes e ignora hunts travadas', () => {
    const speciesById = makeSpeciesCatalog();
    // Conta tem apenas 1 Charmander forte (evolve chain do Charizard) e 1 Pikachu fraco (abaixo do corte).
    const pokemons = [
        { id: 1, speciesId: 4, level: 40, quality: 1.4, potencia: 3, iv: 120 },
        { id: 2, speciesId: 25, level: 20, quality: 0.9, potencia: 1, iv: 30 },
    ];
    const hunts = [
        { slug: 'viridian-pika', nome: 'Pikachu Camp', nivel: 12, especies: [{ pokeId: 25, nome: 'Pikachu', pontos: 10 }] },
        { slug: 'lavender-gengar', nome: 'Lavender Tower', nivel: 45, especies: [{ pokeId: 94, nome: 'Gengar', pontos: 10 }] },
        { slug: 'mt-steelix', nome: 'Iron Cave', nivel: 60, especies: [{ pokeId: 208, nome: 'Steelix', pontos: 10 }] },
        { slug: 'cerulean-alakazam', nome: 'Psychic Hall', nivel: 55, especies: [{ pokeId: 65, nome: 'Alakazam', pontos: 10 }] },
        { slug: 'dragon-den', nome: 'Dragon Den', nivel: 500, especies: [{ pokeId: 149, nome: 'Dragonite', pontos: 10 }] },
    ];

    const res = buildRecommendedPvpTeam({
        pokemons,
        hunts,
        speciesById,
        trainerLevel: 100,
    });

    assert.equal(res.slots.length, 5);
    assert.equal(res.readyCount, 1);
    assert.equal(res.pendingCount, 4);

    // Dragonite (Nv 500) nao pode entrar porque trainerLevel = 100.
    assert.equal(res.slots.some((s) => s.speciesId === 149), false);

    // Charmander esta pronto, os outros 4 apontam para hunts liberadas.
    const readySlot = res.slots.find((s) => s.ready);
    assert.equal(readySlot?.bestOwned?.id, 1);
    assert.equal(readySlot?.huntSlug, null);

    const pending = res.slots.filter((s) => !s.ready);
    assert.equal(pending.length, 4);
    for (const s of pending) {
        assert.ok(s.huntSlug && s.huntName && s.huntLevel <= 100);
        assert.ok(s.targetSpeciesId && s.targetSpeciesName);
    }
    assert.equal(res.nextTargetHuntSlug, pending[0].huntSlug);
    assert.equal(res.nextTargetHuntName, pending[0].huntName);
    assert.equal(res.targetSpeciesIds.length, 4);
    assert.ok(res.summaryText.includes('Proxima caca'));
});

test('diversidade de tipos evita empilhar dois tipos primarios iguais quando ha opcoes', () => {
    const speciesById = makeSpeciesCatalog();
    const hunts = [
        { slug: 'h-blastoise', nome: 'Blastoise Bay', nivel: 50, especies: [{ pokeId: 9, pontos: 10 }] },
        { slug: 'h-gyarados', nome: 'Gyarados Lake', nivel: 50, especies: [{ pokeId: 130, pontos: 10 }] },
        { slug: 'h-charizard', nome: 'Charizard Peak', nivel: 50, especies: [{ pokeId: 6, pontos: 10 }] },
        { slug: 'h-steelix', nome: 'Steelix Mine', nivel: 50, especies: [{ pokeId: 208, pontos: 10 }] },
        { slug: 'h-raichu', nome: 'Raichu Plant', nivel: 50, especies: [{ pokeId: 26, pontos: 10 }] },
        { slug: 'h-alakazam', nome: 'Alakazam Lab', nivel: 50, especies: [{ pokeId: 65, pontos: 10 }] },
    ];

    const res = buildRecommendedPvpTeam({
        pokemons: [],
        hunts,
        speciesById,
        trainerLevel: 100,
    });

    assert.equal(res.slots.length, 5);
    const primaryTypes = res.slots.map((s) => s.types[0]);
    assert.equal(new Set(primaryTypes).size, 5);
    // Nao deve incluir Blastoise e Gyarados (ambos WATER primario) ao mesmo tempo.
    assert.equal(primaryTypes.filter((t) => t === 'WATER').length, 1);
});

test('cadeia evolutiva reconhece evolucao ja possuida na conta e marca slot como ready', () => {
    const speciesById = makeSpeciesCatalog();
    const pokemons = [
        { id: 77, speciesId: 6, level: 120, quality: 1.35, potencia: 4, iv: 150 },
    ];
    const hunts = [
        { slug: 'charmander-valley', nome: 'Vale Charmander', nivel: 10, especies: [{ pokeId: 4, nome: 'Charmander', pontos: 10 }] },
    ];

    const res = buildRecommendedPvpTeam({
        pokemons,
        hunts,
        speciesById,
        trainerLevel: 50,
    });

    assert.equal(res.slots.length, 1);
    assert.equal(res.slots[0].speciesId, 6);
    assert.equal(res.slots[0].ready, true);
    assert.equal(res.slots[0].bestOwned.id, 77);
    assert.equal(res.readyCount, 1);
    assert.equal(res.pendingCount, 4);
});
