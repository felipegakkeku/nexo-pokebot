import test from 'node:test';
import assert from 'node:assert/strict';
import { prey, pickBestPreyCell, checkPrey } from '../src/modules/prey.js';
import { createRuntime } from '../src/modules/runtime.js';

const cell = (title, text) => ({
    title,
    textContent: text,
    clicks: 0,
    getAttribute: (a) => (a === 'title' ? title : null),
    click() { this.clicks++; },
});

test('prey: pickBestPreyCell prioriza hunt atual, depois fila, depois nível seguro', () => {
    const c1 = cell('Rattata — Route 1 (Nv 2)', 'Nv 2');
    const c2 = cell('Kakuna — Viridian Forest (Nv 10)', 'Nv 10');
    const c3 = cell('Onix — Rock Tunnel (Nv 25)', 'Nv 25');

    assert.equal(pickBestPreyCell([c1, c2, c3], { targetName: 'Kakuna', activeLevel: 15 }), c2);
    assert.equal(pickBestPreyCell([c1, c2, c3], { targetName: 'Pidgey', queueNames: ['Onix'], activeLevel: 15 }), c3);
    assert.equal(pickBestPreyCell([c1, c2, c3], { activeLevel: 12 }), c2);
    assert.equal(pickBestPreyCell([c3], { activeLevel: 5 }), c3);
    assert.equal(pickBestPreyCell([]), null);
});

const makePreyCtx = ({
    enabled = true,
    dia = '2026-11-21',
    savedDay = '',
    hasSpin = true,
    hasChoose = true,
    complete = false,
} = {}) => {
    const store = new Map();
    if (savedDay) store.set('prey_day', savedDay);
    const log = { locks: [], closes: 0, confirms: [] };
    let modalOpen = false;
    let chooseVisible = !hasSpin && hasChoose;
    let isComplete = complete;

    const c1 = cell('Zubat — Mt Moon (Nv 12)', 'Nv 12');
    const c2 = cell('Pikachu — Viridian Forest (Nv 10)', 'Nv 10');

    const spinBtn = {
        hidden: !hasSpin,
        disabled: false,
        clicks: 0,
        click() {
            this.clicks++;
            this.hidden = true;
            if (hasChoose) chooseVisible = true;
        },
    };
    const card = {
        classList: { contains: (c) => c === 'completa' && isComplete },
        querySelector: (sel) => {
            if (sel === 'button.pry-girar') return spinBtn;
            if (sel === '.pry-quad-pokemon.escolhivel') return chooseVisible ? {} : null;
            return null;
        },
        querySelectorAll: (sel) => (sel === '.pry-c-pk[data-pk]:not(.vazio)' ? [c1, c2] : []),
    };
    const root = {
        getAttribute: (a) => (a === 'data-dia' ? dia : null),
        querySelectorAll: (sel) => (sel === '.pry-cartela:not(.bloqueada)' ? [card] : []),
    };

    const ctx = {
        CONFIG: { prey: { enabled, checkIntervalMs: 60000 } },
        state: {
            running: true,
            lastPreyCheckAt: 0,
            preyDoneDay: savedDay,
            lastActionNote: '',
            huntQueue: [{ name: 'Pikachu' }],
            stats: { preyRolls: 0 },
        },
        keys: { preyDay: 'prey_day' },
        storage: {
            get: (k) => store.get(k) || null,
            set: (k, v) => store.set(k, v),
        },
        sleep: async () => {},
        randomDelay: () => 0,
        withModalLock: async (label, fn) => { log.locks.push(label); return fn(); },
        dom: {
            $: (sel) => {
                if (sel === '#btn-bolsa') return { click: () => { modalOpen = true; } };
                if (sel === '.mochila-bolso[data-aba="prey"]') return modalOpen ? { click: () => {} } : null;
                if (sel === '#bolsa-corpo') return modalOpen ? {} : null;
                if (sel === '#pry') return modalOpen ? root : null;
                return null;
            },
            isInteractable: () => true,
            getVisibleModal: () => null,
            closeActiveModal: async () => { log.closes++; modalOpen = false; },
            waitFor: async (fn) => fn(),
            confirmModalDialog: async (kw) => { log.confirms.push(kw); isComplete = true; return true; },
            getCurrentHunt: () => ({ targetName: 'Pidgey' }),
            getActivePokemon: () => ({ name: 'Charmander', level: 16 }),
        },
    };
    return { ctx, log, store, spinBtn, cells: [c1, c2] };
};

test('prey: gira roleta grátis, escolhe Pokémon da fila, confirma e salva dia', async () => {
    const { ctx, log, store, spinBtn, cells } = makePreyCtx();
    await checkPrey(ctx);
    assert.deepEqual(log.locks, ['Prey']);
    assert.equal(spinBtn.clicks, 1);
    assert.equal(ctx.state.stats.preyRolls, 1);
    assert.equal(cells[1].clicks, 1, 'Pikachu está na huntQueue');
    assert.equal(cells[0].clicks, 0);
    assert.deepEqual(log.confirms, [['escolher', 'confirmar', 'sim']]);
    assert.equal(store.get('prey_day'), '2026-11-21');
    assert.equal(ctx.state.preyDoneDay, '2026-11-21');
    assert.equal(log.closes, 1);
});

test('prey: pula quando desligado ou já concluído no dia (exceto force)', async () => {
    const off = makePreyCtx({ enabled: false });
    await checkPrey(off.ctx);
    assert.equal(off.log.locks.length, 0);

    const done = makePreyCtx({ savedDay: '2026-11-21' });
    done.ctx.state.lastPreyCheckAt = Date.now();
    await checkPrey(done.ctx);
    assert.equal(done.log.locks.length, 0);

    await checkPrey(done.ctx, { force: true });
    assert.deepEqual(done.log.locks, ['Prey']);
});

test('prey: runtime registra módulo e expõe check', async () => {
    const { ctx, log } = makePreyCtx({ hasSpin: false, hasChoose: false, complete: true });
    assert.equal(prey.everyMs(ctx), 60000);
    const rt = createRuntime(ctx);
    rt.register(prey);
    assert.deepEqual(rt.scheduler.list(), ['prey']);
    await rt.call('prey', 'check', { force: true });
    assert.deepEqual(log.locks, ['Prey']);
    rt.dispose();
});
