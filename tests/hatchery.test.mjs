import test from 'node:test';
import assert from 'node:assert/strict';
import { hatchery, checkIncubator } from '../src/modules/hatchery.js';
import { createRuntime } from '../src/modules/runtime.js';

const button = (log, text, classes = []) => ({
    textContent: text,
    classList: { contains: (c) => classes.includes(c) },
    click: () => log.clicks.push(text),
});
const slot = (classes, buttons = []) => ({
    classList: { contains: (c) => classes.includes(c) },
    querySelectorAll: () => buttons,
});

// `slots`: [{ classes, buttons }]; o corpo da chocadeira devolve os botões de todos os slots em '.chc-slot button'
const makeCtx = ({ enabled = true, slots = [], hasPocket = true, next = 0 } = {}) => {
    const log = { clicks: [], locks: [], closes: 0, confirms: [] };
    const slotEls = slots.map((s) => slot(s.classes, s.buttons.map((b) => button(log, b.text, b.classes))));
    const corpo = {
        querySelectorAll: (sel) => (sel === '.chc-slot button' ? slotEls.flatMap((s) => s.querySelectorAll()) : sel === '.chc-slot' ? slotEls : []),
        querySelector: (sel) => (sel === '.chc-slot.livre' ? slotEls.find((s) => s.classList.contains('livre')) ?? null : null),
    };
    const pocketBtn = { click: () => log.clicks.push('bolso') };
    const ctx = {
        CONFIG: { incubator: { enabled, activeIntervalMs: 30000, emptyBackoffMs: 180000 } },
        state: { running: true, nextIncubatorCheckAt: next, lastActionNote: '', stats: { eggsHandled: 0 } },
        sleep: async () => {},
        randomDelay: () => 0,
        withModalLock: async (label, fn) => { log.locks.push(label); return fn(); },
        dom: {
            $: (sel) => (sel === '#btn-bolsa' ? { click: () => log.clicks.push('bolsa') } : sel === '.mochila-bolso[data-aba="chocadeira"]' ? (hasPocket ? pocketBtn : null) : sel === '#bolsa-corpo' ? corpo : null),
            isVisible: () => true,
            isInteractable: () => true,
            getVisibleModal: () => null,
            closeActiveModal: async () => { log.closes++; },
            waitFor: async (fn) => fn(),
            confirmModalDialog: async (kw) => { log.confirms.push(kw); return true; },
        },
    };
    return { ctx, log };
};

test('chocadeira: desligada ou em espera não abre nada; force ignora os dois', async () => {
    const off = makeCtx({ enabled: false });
    await checkIncubator(off.ctx);
    assert.equal(off.log.locks.length, 0);

    const waiting = makeCtx({ next: Date.now() + 60000 });
    await checkIncubator(waiting.ctx);
    assert.equal(waiting.log.locks.length, 0);

    const forced = makeCtx({ enabled: false, next: Date.now() + 60000 });
    await checkIncubator(forced.ctx, { force: true });
    assert.deepEqual(forced.log.locks, ['Chocadeira']);
});

test('chocadeira: recolhe ovo pronto (ignora "liberar") e usa o intervalo ativo', async () => {
    const { ctx, log } = makeCtx({
        slots: [{ classes: [], buttons: [{ text: 'Recolher' }, { text: 'Liberar recolher', classes: ['chc-liberar'] }, { text: 'Info' }] }],
    });
    await checkIncubator(ctx);
    assert.deepEqual(log.clicks, ['bolsa', 'bolso', 'Recolher']);
    assert.equal(ctx.state.stats.eggsHandled, 1);
    assert.equal(ctx.state.lastActionNote, 'Ovo chocado!');
    const wait = ctx.state.nextIncubatorCheckAt - Date.now();
    assert.ok(wait > 29000 && wait <= 30000, `ativo: ${wait}`);
    assert.equal(log.closes, 1);
});

test('chocadeira: slot livre recebe o ovo de maior prioridade e confirma', async () => {
    const { ctx, log } = makeCtx({
        slots: [{ classes: ['livre'], buttons: [{ text: 'Ovo P2 comum' }, { text: 'Ovo Shiny' }, { text: 'Descartar', classes: ['chc-liberar'] }] }],
    });
    await checkIncubator(ctx);
    assert.deepEqual(log.clicks, ['bolsa', 'bolso', 'Ovo Shiny']);
    assert.deepEqual(log.confirms, [['confirmar', 'colocar', 'incubar', 'sim']]);
    assert.equal(ctx.state.stats.eggsHandled, 1);
    assert.equal(ctx.state.lastActionNote, 'Ovo incubado: Ovo Shiny');
});

test('chocadeira: sem palavra de prioridade pega o primeiro e corta o nome em 24 caracteres', async () => {
    const { ctx, log } = makeCtx({
        slots: [{ classes: ['livre'], buttons: [{ text: '  Ovo muito comprido de teste aqui  ' }, { text: 'Outro' }] }],
    });
    await checkIncubator(ctx);
    assert.equal(log.clicks[2].trim(), 'Ovo muito comprido de teste aqui');
    assert.equal(ctx.state.lastActionNote, 'Ovo incubado: Ovo muito comprido de te');
});

test('chocadeira: prioridade segue a ordem da lista (P3 antes de P2)', async () => {
    const { log, ctx } = makeCtx({ slots: [{ classes: ['livre'], buttons: [{ text: 'Ovo P2' }, { text: 'Ovo P3' }] }] });
    await checkIncubator(ctx);
    assert.equal(log.clicks[2], 'Ovo P3');
});

test('chocadeira: slot ocupado conta como ativo; vazia/trancada usa o backoff longo', async () => {
    const busy = makeCtx({ slots: [{ classes: [], buttons: [{ text: 'Info' }] }] });
    await checkIncubator(busy.ctx);
    assert.equal(busy.ctx.state.stats.eggsHandled, 0);
    assert.ok(busy.ctx.state.nextIncubatorCheckAt - Date.now() <= 30000);

    const empty = makeCtx({ slots: [{ classes: ['trancado'], buttons: [] }, { classes: ['livre'], buttons: [] }] });
    await checkIncubator(empty.ctx);
    const wait = empty.ctx.state.nextIncubatorCheckAt - Date.now();
    assert.ok(wait > 179000 && wait <= 180000, `vazio: ${wait}`);
});

test('chocadeira: bolso que não abre agenda o backoff longo e fecha o modal', async () => {
    const { ctx, log } = makeCtx({ hasPocket: false });
    await checkIncubator(ctx);
    assert.equal(ctx.state.stats.eggsHandled, 0);
    assert.ok(ctx.state.nextIncubatorCheckAt - Date.now() > 179000);
    assert.ok(log.closes >= 1);
});

test('chocadeira: runtime registra a cada 15 s e expõe check', async () => {
    const { ctx, log } = makeCtx({ enabled: false });
    assert.equal(hatchery.everyMs, 15000);
    const rt = createRuntime(ctx);
    rt.register(hatchery);
    assert.deepEqual(rt.scheduler.list(), ['hatchery']);
    await rt.call('hatchery', 'check', { force: true });
    assert.deepEqual(log.locks, ['Chocadeira']);
    rt.dispose();
});
