import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPvpMatch, computePvpMonitor, evaluatePvpMonitor, normalizePvpMonitorLevel } from '../src/headless/pvp-monitor.mjs';
import { applyPvpMessage, checkPvpMonitor, evaluatePvpQueue } from '../src/headless/protocol-engine.mjs';

/** 'W' vence (+13), 'L' perde (-9), como o jogo manda hoje. */
function play(seq, { win = 13, loss = -9 } = {}) {
    const pvp = {};
    let t = 0;
    for (const c of seq.replace(/\s/g, '')) recordPvpMatch(pvp, { venci: c === 'W', delta: c === 'W' ? win : loss }, (t += 1000));
    return pvp;
}

test('monitor de PvP: saldo, pico e sequência de derrotas saem do histórico', () => {
    const pvp = play('WWLL');
    assert.equal(pvp.netPr, 8);
    assert.equal(pvp.peakPr, 26);
    const m = computePvpMonitor(pvp);
    assert.equal(m.games, 4);
    assert.equal(m.lossStreak, 2);
    assert.equal(m.drawdown, 18);
});

test('monitor de PvP: o sinal do delta é corrigido e sem delta vale +13 / -9', () => {
    const pvp = {};
    recordPvpMatch(pvp, { venci: false, delta: 9 }, 1);
    recordPvpMatch(pvp, { venci: true }, 2);
    recordPvpMatch(pvp, { venci: false }, 3);
    assert.deepEqual(pvp.history.map((h) => h.delta), [-9, 13, -9]);
    assert.equal(pvp.netPr, -5);
});

test('monitor de PvP: o ponto de equilíbrio acompanha o PR que o jogo realmente dá', () => {
    const padrao = computePvpMonitor(play('WL'));
    assert.ok(Math.abs(padrao.breakEvenWinRate - 9 / 22) < 0.02);
    // derrotas que tiram muito mais PR do que a vitória dá: equilíbrio sobe bem acima de 50%
    const caro = computePvpMonitor(play('WLWLWLWLWLWL', { win: 10, loss: -20 }));
    assert.ok(caro.breakEvenWinRate > 0.55);
});

test('monitor de PvP: o limite de derrotas seguidas encolhe quanto mais a conta vence', () => {
    const neutro = computePvpMonitor({});
    const vencendo = computePvpMonitor(play('WWWWWWWWWW'));
    const perdendo = computePvpMonitor(play('LLWLLWLLWL'));
    assert.equal(neutro.streakLimit, 5);
    assert.equal(vencendo.streakLimit, 4);
    assert.ok(perdendo.streakLimit > neutro.streakLimit);
    assert.ok(perdendo.streakLimit <= 7);
});

test('monitor de PvP: derrotas seguidas dentro do limite não param a fila', () => {
    assert.equal(evaluatePvpMonitor(play('LLLL')).stop, false);
    assert.equal(evaluatePvpMonitor(play('WLLWLLWLL')).stop, false);
});

test('monitor de PvP: derrotas seguidas acima do limite param a fila', () => {
    const r = evaluatePvpMonitor(play('LLLLL'));
    assert.equal(r.stop, true);
    assert.equal(r.rule, 'sequencia');
    assert.match(r.reason, /5 derrotas seguidas/);
});

test('monitor de PvP: quem vinha ganhando para mais cedo numa sequência ruim', () => {
    const r = evaluatePvpMonitor(play('WWWWWWWWWWLLLL'));
    assert.equal(r.stop, true);
    assert.equal(r.rule, 'sequencia');
    assert.equal(r.metrics.lossStreak, 4);
});

test('monitor de PvP: janela ruim sem sequência longa também para (taxa abaixo do equilíbrio e saldo negativo)', () => {
    const r = evaluatePvpMonitor(play('LLLWLLLWLL'));
    assert.equal(r.stop, true);
    assert.equal(r.rule, 'janela');
});

test('monitor de PvP: janela só vale depois de 6 partidas', () => {
    assert.equal(evaluatePvpMonitor(play('LLWLL')).stop, false);
});

test('monitor de PvP: perda lenta espalhada em muitas partidas para pela queda do pico', () => {
    const r = evaluatePvpMonitor(play('WWLLL'.repeat(9), { win: 10, loss: -9 }));
    assert.equal(r.stop, true);
    assert.equal(r.rule, 'queda');
});

test('monitor de PvP: uma sessão boa com derrotas espalhadas não para', () => {
    assert.equal(evaluatePvpMonitor(play('WWLWWLWLWWLWWLL')).stop, false);
});

test('monitor de PvP: o nível muda a tolerância', () => {
    const quatro = play('LLLL');
    assert.equal(evaluatePvpMonitor(quatro, 'cauteloso').stop, true);
    assert.equal(evaluatePvpMonitor(quatro, 'equilibrado').stop, false);
    assert.equal(evaluatePvpMonitor(play('LLLLL'), 'tolerante').stop, false);
    assert.equal(normalizePvpMonitorLevel('qualquer coisa'), 'equilibrado');
});

test('fila de PvP com monitor: para depois da derrota que passa do limite e não volta sozinha', () => {
    const pvp = {};
    const cfg = { pvpQueue: true, pvpMonitor: true, pvpMonitorLevel: 'equilibrado' };
    let now = 0;
    const lose = () => applyPvpMessage(pvp, { t: 'pvp', partida: { venci: false, oponente: { nick: 'R' }, delta: -9 } }, (now += 60_000));
    for (let i = 0; i < 4; i++) { lose(); assert.equal(checkPvpMonitor(pvp, cfg, now), null); }
    pvp.na = true;
    lose();
    pvp.na = true; // o servidor ainda diz que está na fila
    const stop = checkPvpMonitor(pvp, cfg, now);
    assert.ok(stop);
    assert.match(stop.note, /monitor parou a fila.*5 derrotas seguidas/);
    assert.deepEqual(stop.actions, [{ t: 'pvp.fila.sair' }]);
    assert.equal(pvp.halted.rule, 'sequencia');
    assert.equal(pvp.na, false);
    assert.deepEqual(evaluatePvpQueue(pvp, cfg, now + 600_000), []);
    assert.equal(checkPvpMonitor(pvp, cfg, now + 1), null, 'não dispara duas vezes');
});

test('fila de PvP com monitor desligado ou fila desligada: não interfere', () => {
    const pvp = play('LLLLLLLL');
    assert.equal(checkPvpMonitor(pvp, { pvpQueue: true, pvpMonitor: false }, 1), null);
    assert.equal(checkPvpMonitor(pvp, { pvpQueue: false, pvpMonitor: true }, 1), null);
    assert.equal(pvp.halted, undefined);
    assert.equal(evaluatePvpQueue(pvp, { pvpQueue: true, pvpMonitor: false }, 0)[0].t, 'pvp.info');
});
