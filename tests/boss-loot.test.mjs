import test from 'node:test';
import assert from 'node:assert/strict';
import { bosses, bossLoot, bossMatchesPriority, checkBosses, dismissBossLoot } from '../src/modules/boss-loot.js';
import { createRuntime } from '../src/modules/runtime.js';

const detail = (html, text = html) => ({ innerHTML: html, textContent: text });

test('prioridade de boss: qualquer sempre serve; mega/tm/tickets olham o conteúdo do modal', () => {
    assert.equal(bossMatchesPriority(detail('nada'), 'qualquer'), true);
    assert.equal(bossMatchesPriority(detail('<img src="fragmento-mega.png">', ''), 'mega'), true);
    assert.equal(bossMatchesPriority(detail('x', 'Recompensa: Mega Stone'), 'mega'), true);
    assert.equal(bossMatchesPriority(detail('x', 'Recompensa: ouro'), 'mega'), false);
    assert.equal(bossMatchesPriority(detail('<img src="tm_disk.png">', ''), 'tm'), true);
    assert.equal(bossMatchesPriority(detail('<i class="zmove">', ''), 'tm'), true);
    assert.equal(bossMatchesPriority(detail('x', 'TM 24'), 'tm'), true);
    assert.equal(bossMatchesPriority(detail('x', 'Potion'), 'tm'), false);
    assert.equal(bossMatchesPriority(detail('<img src="mystic-ticket.png">', ''), 'tickets'), true);
    assert.equal(bossMatchesPriority(detail('x', 'Safari Ticket'), 'tickets'), true);
    assert.equal(bossMatchesPriority(detail('x', 'ouro'), 'tickets'), false);
    assert.equal(bossMatchesPriority(null, 'mega'), false);
    assert.equal(bossMatchesPriority(detail('x'), 'prioridade-desconhecida'), true);
});

// Lista de bosses falsa: cada item, ao ser clicado, troca o conteúdo do modal (#modal-corpo)
const makeCtx = ({ priority = 'mega', bosses: bossDefs = [], hasBossBtn = true, hasList = true, lastCheck = 0, lootBtn = true, autoDismiss = true } = {}) => {
    const log = { clicks: [], locks: [], closes: 0, confirms: [] };
    let modalBody = null;
    const items = bossDefs.map((b) => ({
        click: () => {
            log.clicks.push(`item:${b.name}`);
            modalBody = {
                innerHTML: b.html ?? '',
                textContent: b.text ?? '',
                querySelector: (sel) => (sel === 'button.boss-desafiar' ? (b.noChallenge ? null : { disabled: Boolean(b.disabled), click: () => log.clicks.push(`desafiar:${b.name}`) }) : sel === '.boss-nome' ? (b.name ? { textContent: ` ${b.name} ` } : null) : null),
            };
        },
    }));
    const list = { querySelectorAll: () => items };
    const ctx = {
        CONFIG: { boss: { priority, checkIntervalMs: 300000, autoDismissLoot: autoDismiss } },
        state: { running: true, lastBossCheckAt: lastCheck, lastActionNote: '', stats: { bossEntries: 0 } },
        sleep: async () => {},
        randomDelay: () => 0,
        withModalLock: async (label, fn) => { log.locks.push(label); return fn(); },
        dom: {
            $: (sel) => (sel === '#boss-lista' ? (hasList ? list : null) : sel === '#modal-corpo' ? modalBody : sel === '#boss-loot-ok' ? (lootBtn ? { click: () => log.clicks.push('loot-ok') } : null) : null),
            isInteractable: () => true,
            getVisibleModal: () => null,
            closeActiveModal: async () => { log.closes++; },
            findMenuButtonByImg: (img) => (hasBossBtn && img === 'boss-cabeca' ? { click: () => log.clicks.push('menu-boss') } : null),
            waitFor: async (fn) => fn(),
            confirmModalDialog: async (kw) => { log.confirms.push(kw); return true; },
        },
    };
    return { ctx, log };
};

test('boss: prioridade off não roda sozinho; dentro do intervalo não roda; force ignora', async () => {
    const off = makeCtx({ priority: 'off' });
    await checkBosses(off.ctx);
    assert.equal(off.log.locks.length, 0);

    const recent = makeCtx({ lastCheck: Date.now() - 1000 });
    await checkBosses(recent.ctx);
    assert.equal(recent.log.locks.length, 0);

    await checkBosses(off.ctx, { force: true });
    assert.deepEqual(off.log.locks, ['Bosses']);
});

test('boss: entra no primeiro que bate com a prioridade, confirma, conta e NÃO fecha o modal', async () => {
    const { ctx, log } = makeCtx({
        bosses: [{ name: 'Brock', text: 'ouro' }, { name: 'Misty', text: 'Mega Stone' }, { name: 'Surge', text: 'Mega Stone' }],
    });
    await checkBosses(ctx);
    assert.deepEqual(log.clicks, ['menu-boss', 'item:Brock', 'item:Misty', 'desafiar:Misty']);
    assert.deepEqual(log.confirms, [['desafiar', 'entrar', 'confirmar', 'sim']]);
    assert.equal(ctx.state.stats.bossEntries, 1);
    assert.equal(ctx.state.lastActionNote, 'Entrou no Boss: Misty');
    assert.equal(log.closes, 0);
    assert.ok(Date.now() - ctx.state.lastBossCheckAt < 1000);
});

test('boss: pula desafio desabilitado ou ausente; se nenhum serve, avisa e fecha', async () => {
    const { ctx, log } = makeCtx({
        priority: 'qualquer',
        bosses: [{ name: 'A', disabled: true }, { name: 'B', noChallenge: true }],
    });
    await checkBosses(ctx);
    assert.ok(!log.clicks.some((c) => c.startsWith('desafiar')));
    assert.equal(ctx.state.stats.bossEntries, 0);
    assert.equal(ctx.state.lastActionNote, 'Bosses (qualquer): nenhum disponível agora');
    assert.equal(log.closes, 1);
});

test('boss: force com prioridade off aceita qualquer boss', async () => {
    const { ctx, log } = makeCtx({ priority: 'off', bosses: [{ name: 'Lance', text: 'ouro' }] });
    await checkBosses(ctx, { force: true });
    assert.ok(log.clicks.includes('desafiar:Lance'));
});

test('boss: nome ausente vira "Boss"', async () => {
    const { ctx } = makeCtx({ priority: 'qualquer', bosses: [{ name: '' }] });
    await checkBosses(ctx);
    assert.equal(ctx.state.lastActionNote, 'Entrou no Boss: Boss');
});

test('boss: sem botão do menu ou sem lista, só fecha o modal', async () => {
    const a = makeCtx({ hasBossBtn: false });
    await checkBosses(a.ctx);
    assert.equal(a.log.closes, 1);
    assert.deepEqual(a.log.clicks, []);

    const b = makeCtx({ hasList: false, bosses: [{ name: 'X' }] });
    await checkBosses(b.ctx);
    assert.equal(b.log.closes, 1);
    assert.deepEqual(b.log.clicks, ['menu-boss']);
});

test('boss: parar o bot no meio interrompe a varredura', async () => {
    const { ctx, log } = makeCtx({ priority: 'qualquer', bosses: [{ name: 'A' }, { name: 'B' }] });
    ctx.state.running = false;
    await checkBosses(ctx, { force: true });
    assert.ok(!log.clicks.some((c) => c.startsWith('item:')));
});

test('loot: clica em OK quando aparece; desligado, parado ou sem botão não clica', () => {
    const on = makeCtx();
    dismissBossLoot(on.ctx);
    assert.deepEqual(on.log.clicks, ['loot-ok']);
    assert.equal(on.ctx.state.lastActionNote, 'Loot de Boss coletado!');

    for (const opts of [{ autoDismiss: false }, { lootBtn: false }]) {
        const c = makeCtx(opts);
        dismissBossLoot(c.ctx);
        assert.deepEqual(c.log.clicks, [], JSON.stringify(opts));
    }
    const stopped = makeCtx();
    stopped.ctx.state.running = false;
    dismissBossLoot(stopped.ctx);
    assert.deepEqual(stopped.log.clicks, []);
});

test('boss: runtime registra os dois módulos (60 s e 3 s) e chama os métodos extras', async () => {
    assert.equal(bosses.everyMs, 60000);
    assert.equal(bossLoot.everyMs, 3000);
    const { ctx, log } = makeCtx();
    const rt = createRuntime(ctx);
    rt.register(bosses);
    rt.register(bossLoot);
    assert.deepEqual(rt.scheduler.list(), ['bosses', 'bossLoot']);
    rt.call('bossLoot', 'dismiss');
    assert.deepEqual(log.clicks, ['loot-ok']);
    await rt.call('bosses', 'check', { force: true });
    assert.deepEqual(log.locks, ['Bosses']);
    rt.dispose();
});

test('loot: Arena Mística (#recompensa.rc-mistico) escolhe melhor bola disponível', () => {
    const clicks = [];
    const elements = {
        '#recompensa.rc-mistico:not(.hidden)': { visible: true },
        '.mst-bolas button.mst-bola.melhor:not([disabled])': { click: () => clicks.push('mst-melhor') },
    };
    const ctx = {
        CONFIG: { boss: { autoDismissLoot: true } },
        state: { running: true, lastActionNote: '', stats: { mysticBallsThrown: 0 } },
        dom: {
            $: (sel) => elements[sel] || null,
            isInteractable: () => true,
            isVisible: () => true,
        },
    };
    dismissBossLoot(ctx);
    assert.deepEqual(clicks, ['mst-melhor']);
    assert.equal(ctx.state.stats.mysticBallsThrown, 1);
    assert.equal(ctx.state.lastActionNote, 'Bola lançada no Mítico!');
});

test('loot: modal #recompensa comum usa #rc-todos primeiro e fallback #rc-ok', () => {
    const clicks = [];
    const elements = {
        '#recompensa:not(.hidden)': { visible: true },
        '#rc-todos:not([hidden])': { click: () => clicks.push('rc-todos') },
        '#rc-ok': { click: () => clicks.push('rc-ok') },
    };
    const ctx = {
        CONFIG: { boss: { autoDismissLoot: true } },
        state: { running: true, lastActionNote: '', stats: {} },
        dom: {
            $: (sel) => elements[sel] || null,
            isInteractable: () => true,
            isVisible: () => true,
        },
    };
    dismissBossLoot(ctx);
    assert.deepEqual(clicks, ['rc-todos']);
    assert.equal(ctx.state.lastActionNote, 'Loot de Boss coletado!');

    delete elements['#rc-todos:not([hidden])'];
    dismissBossLoot(ctx);
    assert.deepEqual(clicks, ['rc-todos', 'rc-ok']);
});
