import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../src/modules/scheduler.js';

// Relógio e timer falsos: o teste controla o tempo, sem esperar
const makeClock = () => {
    let t = 1000;
    let cb = null;
    return {
        now: () => t,
        advance: (ms) => { t += ms; },
        deps: { now: () => t, setIntervalFn: (fn) => { cb = fn; return 1; }, clearIntervalFn: () => { cb = null; }, onError: () => {} },
        hasTimer: () => cb !== null,
    };
};

test('roda a tarefa só quando o período vence', async () => {
    const clock = makeClock();
    const s = createScheduler(clock.deps);
    let runs = 0;
    s.add({ id: 'a', everyMs: 1000, run: () => { runs++; } });
    await s.tick();
    assert.equal(runs, 0);
    clock.advance(1000);
    await s.tick();
    assert.equal(runs, 1);
    await s.tick(); // mesma hora: não repete
    assert.equal(runs, 1);
    clock.advance(1000);
    await s.tick();
    assert.equal(runs, 2);
});

test('não sobrepõe: se a rodada anterior ainda roda, pula', async () => {
    const clock = makeClock();
    const s = createScheduler(clock.deps);
    let runs = 0;
    let release;
    s.add({ id: 'lenta', everyMs: 100, run: () => { runs++; return new Promise((r) => { release = r; }); } });
    clock.advance(100);
    const first = s.tick();
    clock.advance(100);
    await s.tick(); // a primeira ainda não terminou
    assert.equal(runs, 1);
    release();
    await first;
    clock.advance(100);
    const next = s.tick();
    assert.equal(runs, 2);
    release();
    await next;
});

test('uma tarefa que falha não derruba as outras nem a si mesma', async () => {
    const clock = makeClock();
    const errors = [];
    const s = createScheduler({ ...clock.deps, onError: (id) => errors.push(id) });
    let ok = 0;
    s.add({ id: 'ruim', everyMs: 100, run: () => { throw new Error('x'); } });
    s.add({ id: 'boa', everyMs: 100, run: () => { ok++; } });
    clock.advance(100);
    await s.tick();
    clock.advance(100);
    await s.tick();
    assert.deepEqual(errors, ['ruim', 'ruim']);
    assert.equal(ok, 2);
});

test('prioridade maior começa primeiro quando vencem juntas', async () => {
    const clock = makeClock();
    const s = createScheduler(clock.deps);
    const order = [];
    s.add({ id: 'baixa', everyMs: 100, priority: 0, run: () => { order.push('baixa'); } });
    s.add({ id: 'alta', everyMs: 100, priority: 5, run: () => { order.push('alta'); } });
    clock.advance(100);
    await s.tick();
    assert.deepEqual(order, ['alta', 'baixa']);
});

test('pausa global e enabled() seguram a tarefa sem perder o ritmo', async () => {
    const clock = makeClock();
    const s = createScheduler(clock.deps);
    let on = false;
    let runs = 0;
    s.add({ id: 'a', everyMs: 100, enabled: () => on, run: () => { runs++; } });
    clock.advance(100);
    await s.tick();
    assert.equal(runs, 0, 'desabilitada');
    on = true;
    s.pause();
    clock.advance(100);
    await s.tick();
    assert.equal(runs, 0, 'pausada');
    s.resume();
    await s.tick();
    assert.equal(runs, 1);
});

test('dispose para o timer e descarta as tarefas', async () => {
    const clock = makeClock();
    const s = createScheduler(clock.deps);
    let runs = 0;
    s.add({ id: 'a', everyMs: 100, run: () => { runs++; } });
    s.start();
    assert.equal(clock.hasTimer(), true);
    s.dispose();
    assert.equal(clock.hasTimer(), false);
    clock.advance(500);
    await s.tick();
    assert.equal(runs, 0);
    assert.deepEqual(s.list(), []);
});
