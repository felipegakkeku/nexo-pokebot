// Restock otimizado de poções e modo de economia de Pokébolas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickOptimizedPotion, resolveRestockPotionId, pickHeadlessBallForCorpse, resolveRestockBallId, evaluateHeadlessTick, applyPvpMessage, evaluatePvpQueue } from '../src/headless/protocol-engine.mjs';

const stateWith = (maxHp, hpLimiar = 0.5) => ({
    activeId: 7,
    pokemons: [{ id: 7, maxHp }],
    automation: { hpLimiar, autoPotion: true, autoRevive: true, autoVoltarHunt: true, potionIds: [200] },
    items: { 200: 5 },
    balls: { 1: 50, 2: 50, 3: 50, 4: 50 },
    gold: 5_000_000,
});

test('poção otimizada: Pokémon de muito HP usa Ultimate, de pouco HP usa Small', () => {
    assert.equal(pickOptimizedPotion(stateWith(8000)).id, 204);
    assert.equal(pickOptimizedPotion(stateWith(300)).id, 200);
});

test('poção otimizada: limiar em porcentagem (50) vale como 0,5 e sem Pokémon ativo não escolhe', () => {
    assert.equal(pickOptimizedPotion(stateWith(8000, 50)).id, 204);
    assert.equal(pickOptimizedPotion({ pokemons: [], automation: {} }), null);
});

test('poção otimizada: poção que cura menos de 10% do HP fica para o fim', () => {
    const best = pickOptimizedPotion(stateWith(2000));
    assert.notEqual(best.id, 200);
    assert.equal(best.ranked.at(-1).keepsUp, false);
});

test('restock otimizado compra a poção escolhida e põe ela em 1º na fila do jogo', () => {
    const st = stateWith(8000);
    assert.equal(resolveRestockPotionId(st, { potionOptimize: true }), 204);
    assert.equal(resolveRestockPotionId(st, { potionOptimize: false }), 200);
    const tracker = {};
    const actions = evaluateHeadlessTick({ state: st, field: null, config: { potionOptimize: true, caidosEnabled: false, minGoldReserve: 0, targetPotions: 10, minPotions: 10, targetBalls: 0, targetRevives: 0 }, tracker, nowMs: 100_000 });
    const auto = actions.find((a) => a.t === 'auto.set');
    assert.deepEqual(auto.potionIds, [204, 200]);
    assert.ok(actions.some((a) => a.t === 'shop.buy' && a.id === 204));
    assert.equal(tracker.potionChoice.id, 204);
});

test('Pokébolas: padrão segura shiny com Ultra no nível alto; economia respeita a bola e evita Ultra', () => {
    const balls = { 1: 9, 2: 9, 3: 9, 4: 9 };
    const corpse = { level: 120 };
    assert.equal(pickHeadlessBallForCorpse(corpse, balls, { preferredBall: 'great', highLevelUltraThreshold: 20 }, 5_000_000), 4);
    assert.equal(pickHeadlessBallForCorpse(corpse, balls, { preferredBall: 'great', highLevelUltraThreshold: 20, ballEconomy: true }, 5_000_000), 2);
    assert.equal(pickHeadlessBallForCorpse(corpse, balls, { preferredBall: 'auto', highLevelUltraThreshold: 20, ballEconomy: true }, 5_000_000), 2);
    assert.equal(resolveRestockBallId({ preferredBall: 'auto', ballEconomy: true }, 5_000_000), 2);
    assert.equal(resolveRestockBallId({ preferredBall: 'auto' }, 5_000_000), 4);
});

test('restock com pouco gold: compra poção e revive antes da bola', () => {
    const st = { ...stateWith(300), gold: 1_700, items: {}, balls: {} };
    const actions = evaluateHeadlessTick({ state: st, field: null, config: { caidosEnabled: false, ensureNativeAutoHeal: false, minGoldReserve: 0, preferredBall: 'poke', targetBalls: 100, minBalls: 50, targetPotions: 10, minPotions: 5, targetRevives: 1, minRevives: 1 }, tracker: {}, nowMs: 100_000 });
    const buys = actions.filter((a) => a.t === 'shop.buy');
    assert.deepEqual(buys.map((b) => b.id), [200, 205, 1]);
    assert.equal(buys[0].qty, 10);
});

test('fila de PvP: pergunta o estado, entra, espera a partida e o tempo do jogo', () => {
    const pvp = {};
    assert.deepEqual(evaluatePvpQueue(pvp, { pvpQueue: false }, 0), []);
    assert.equal(evaluatePvpQueue(pvp, { pvpQueue: true }, 0)[0].t, 'pvp.info');
    assert.deepEqual(evaluatePvpQueue(pvp, { pvpQueue: true }, 5_000), []);
    assert.equal(evaluatePvpQueue(pvp, { pvpQueue: true }, 16_000)[0].t, 'pvp.fila.entrar');
    applyPvpMessage(pvp, { t: 'pvp', fila: { na: true, tamanho: 3 } }, 17_000);
    assert.deepEqual(evaluatePvpQueue(pvp, { pvpQueue: true }, 40_000), []);
    const note = applyPvpMessage(pvp, { t: 'pvp', partida: { venci: true, oponente: { nick: 'Rival' }, delta: 12 } }, 50_000);
    assert.match(note, /venceu contra Rival \(\+12\)/);
    assert.deepEqual(evaluatePvpQueue(pvp, { pvpQueue: true }, 52_000), []);
    assert.equal(evaluatePvpQueue(pvp, { pvpQueue: true }, 56_000)[0].t, 'pvp.fila.entrar');
    applyPvpMessage(pvp, { t: 'pvp', filaRecusa: { restaMs: 60_000, msg: 'espere' } }, 57_000);
    assert.deepEqual(evaluatePvpQueue(pvp, { pvpQueue: true }, 100_000), []);
    assert.equal(evaluatePvpQueue(pvp, { pvpQueue: true }, 118_000)[0].t, 'pvp.fila.entrar');
});
