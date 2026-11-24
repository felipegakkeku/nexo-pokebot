import test from 'node:test';
import assert from 'node:assert/strict';
import { capture, isShinyCaidoButton, ensureBestBallSelected, processCaidos, ensureCaidosObserver, resolveDesiredBallOrder } from '../src/modules/capture.js';
import { createRuntime } from '../src/modules/runtime.js';

// O módulo usa só globais de navegador (window, setTimeout, MutationObserver): fakes mínimos
globalThis.window = { requestAnimationFrame: (fn) => fn() };
const observers = [];
globalThis.MutationObserver = class {
    constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); }
    observe(node, opts) { this.node = node; this.opts = opts; }
    disconnect() { this.disconnected = true; }
};

const wait = (ms = 15) => new Promise((r) => setTimeout(r, ms));

const caidoBtn = (props = {}) => ({
    className: 'caido',
    dataset: {},
    textContent: 'Rattata Nv 5',
    clicks: 0,
    click() { this.clicks++; },
    querySelector: () => null,
    ...props,
});
const shinyBtn = (props = {}) => caidoBtn({ className: 'caido shiny', textContent: '✨ Pikachu Nv 9', ...props });
const container = (buttons) => ({ querySelectorAll: () => buttons });

const chip = (qty, on = false) => ({
    textContent: String(qty),
    classList: { contains: (c) => c === 'on' && on },
    querySelector: () => ({ textContent: String(qty) }),
    clicks: 0,
    click() { this.clicks++; },
});

const makeCtx = ({ caidosEnabled = true, balls = [20, 5, 0, 0], totalBalls, smart = true, huntLevel = 5, chips = null } = {}) => {
    const log = { beeps: [], locks: [], huds: 0 };
    const chipEls = chips ?? [chip(20, true), chip(5), chip(0), chip(0), chip(0)];
    const ballOpts = { querySelectorAll: () => chipEls };
    const total = totalBalls ?? balls.reduce((a, b) => a + b, 0);
    let node = null;
    const ctx = {
        CONFIG: {
            caidos: {
                enabled: caidosEnabled, smartBallSelect: smart, highLevelUltraThreshold: 20, containerSelector: '#caidos-lista',
                buttonSelector: 'button.caido', minThrowIntervalMs: 0, retryAfterMs: 4500, reattachIntervalMs: 3000,
            },
            shinyGuard: { enabled: true, soundAlert: true },
            restock: { enabled: true, minBalls: 10, targetBalls: 50, restockSmallPotion: false, restockRevive: false, maxPurchases: 6 },
            delays: { clickMinMs: 0, clickMaxMs: 0, uiMinMs: 0, uiMaxMs: 0 },
        },
        state: {
            running: true, paused: false, modalLockOwner: null, throwPending: false, lastThrowAt: 0, shinyAlertActive: false,
            shinyNotifiedSlots: new Set(), observedCaidosNode: null, caidosObserver: null, lastActionNote: '',
            stats: { shiniesSpotted: 0, caidosClicked: 0, purchases: 0 },
        },
        sleep: async () => {},
        randomDelay: () => 0,
        playBeep: (f, d) => log.beeps.push([f, d]),
        updateHud: () => { log.huds++; },
        withModalLock: async (label) => { log.locks.push(label); return null; }, // não executa o corpo: só queremos saber se o restock foi pedido
        dom: {
            $: (sel) => (sel === '#auto-ball-opts' ? ballOpts : sel === '#caidos-lista' ? node : null),
            $$: () => [],
            isInteractable: () => true,
            isVisible: () => true,
            getInventorySnapshot: () => ({ balls, totalBalls: total, smallPotions: null, totalRevives: null }),
            getTargetBallTier: () => ({ itemName: 'Poke Ball', chipIndex: 0 }),
            getCurrentHunt: () => ({ targetLevel: huntLevel }),
        },
    };
    return { ctx, log, chipEls, setNode: (n) => { node = n; } };
};

test('shiny: reconhece pela classe, data-shiny, emoji ou texto', () => {
    assert.equal(isShinyCaidoButton(null), false);
    assert.equal(isShinyCaidoButton(caidoBtn()), false);
    assert.equal(isShinyCaidoButton(caidoBtn({ className: 'caido SHINY' })), true);
    assert.equal(isShinyCaidoButton(caidoBtn({ dataset: { shiny: '1' } })), true);
    assert.equal(isShinyCaidoButton(caidoBtn({ dataset: { shiny: 'true' } })), true);
    assert.equal(isShinyCaidoButton(caidoBtn({ textContent: 'Abra ✨' })), true);
    assert.equal(isShinyCaidoButton(caidoBtn({ textContent: 'Shiny Abra' })), true);
});

test('captura: lança a bola no botão, conta o clique e libera a trava', async () => {
    const { ctx } = makeCtx();
    const btn = caidoBtn();
    processCaidos(ctx, container([btn]));
    assert.equal(ctx.state.throwPending, true, 'trava enquanto espera o lançamento');
    await wait();
    assert.equal(btn.clicks, 1);
    assert.equal(ctx.state.stats.caidosClicked, 1);
    assert.equal(ctx.state.throwPending, false);
    assert.ok(btn.dataset.pbTriedAt);
    assert.ok(ctx.state.lastThrowAt > 0);
});

test('captura: dentro da janela de retry não tenta de novo; passada a janela, tenta', async () => {
    const { ctx } = makeCtx();
    const recent = caidoBtn({ dataset: { pbTriedAt: String(Date.now() - 1000) } });
    processCaidos(ctx, container([recent]));
    await wait();
    assert.equal(recent.clicks, 0);
    assert.equal(ctx.state.throwPending, false);

    const old = caidoBtn({ dataset: { pbTriedAt: String(Date.now() - 5000) } });
    processCaidos(ctx, container([old]));
    await wait();
    assert.equal(old.clicks, 1);
});

test('captura: desligada, pausada, sem container ou com lançamento pendente não lança', async () => {
    for (const mutate of [
        (c) => { c.CONFIG.caidos.enabled = false; },
        (c) => { c.state.paused = true; },
        (c) => { c.state.running = false; },
        (c) => { c.state.throwPending = true; },
        (c) => { c.state.modalLockOwner = 'Restock'; },
    ]) {
        const { ctx } = makeCtx();
        mutate(ctx);
        const btn = caidoBtn();
        processCaidos(ctx, container([btn]));
        await wait();
        assert.equal(btn.clicks, 0, mutate.toString());
    }
    const { ctx } = makeCtx();
    processCaidos(ctx, null);
    assert.equal(ctx.state.throwPending, false);
});

test('shiny: avisa uma vez por slot (bipe, contador, nota) e vai na frente dos normais', async () => {
    const { ctx, log } = makeCtx();
    const shiny = shinyBtn({ dataset: { slot: 's1' }, querySelector: () => ({ textContent: ' Pikachu ' }) });
    const normal = caidoBtn();
    processCaidos(ctx, container([normal, shiny]));
    assert.equal(ctx.state.shinyAlertActive, true);
    assert.equal(ctx.state.stats.shiniesSpotted, 1);
    assert.deepEqual(log.beeps, [[1180, 0.25]]);
    assert.equal(ctx.state.lastActionNote, '✨ SHINY DETECTADO: Pikachu');
    await wait();
    assert.equal(shiny.clicks, 1, 'shiny primeiro');
    assert.equal(normal.clicks, 0);

    processCaidos(ctx, container([shiny]));
    assert.equal(ctx.state.stats.shiniesSpotted, 1, 'mesmo slot não conta duas vezes');
    assert.equal(log.beeps.length, 1);
    await wait();
});

test('shiny: some da tela -> alerta desliga; com modal aberto o shiny ainda passa na frente', async () => {
    const { ctx } = makeCtx();
    ctx.state.shinyAlertActive = true;
    processCaidos(ctx, container([]));
    assert.equal(ctx.state.shinyAlertActive, false);

    ctx.state.modalLockOwner = 'Depot:venda';
    const shiny = shinyBtn({ dataset: { slot: 's2' } });
    processCaidos(ctx, container([shiny]));
    await wait();
    assert.equal(shiny.clicks, 1);
});

test('shiny: captura desligada ainda detecta e avisa, mas não lança', async () => {
    const { ctx } = makeCtx({ caidosEnabled: false });
    const shiny = shinyBtn({ dataset: { slot: 's3' } });
    processCaidos(ctx, container([shiny]));
    await wait();
    assert.equal(ctx.state.stats.shiniesSpotted, 1);
    assert.equal(shiny.clicks, 0);
});

test('captura: sem nenhuma bola pede restock em vez de lançar', async () => {
    const { ctx, log } = makeCtx({ balls: [0, 0, 0, 0], totalBalls: 0 });
    const btn = caidoBtn();
    processCaidos(ctx, container([btn]));
    await wait();
    assert.deepEqual(log.locks, ['Restock']);
    assert.equal(btn.clicks, 0);
    assert.equal(ctx.state.throwPending, false);
});

test('captura: bolas acabam durante a espera -> pede restock e não clica', async () => {
    const { ctx, log } = makeCtx();
    let calls = 0;
    ctx.dom.getInventorySnapshot = () => ({ balls: [0, 0, 0, 0], totalBalls: ++calls === 1 ? 5 : 0, smallPotions: null, totalRevives: null });
    const btn = caidoBtn();
    processCaidos(ctx, container([btn]));
    await wait();
    assert.deepEqual(log.locks, ['Restock']);
    assert.equal(btn.clicks, 0);
});

test('bola: shiny usa a melhor bola com estoque (índice mais alto primeiro)', () => {
    const { ctx, chipEls } = makeCtx({ chips: [chip(20, true), chip(5), chip(3), chip(0), chip(0)] });
    ensureBestBallSelected(ctx, shinyBtn());
    assert.deepEqual(chipEls.map((c) => c.clicks), [0, 0, 1, 0, 0]);
});

test('bola: alvo comum começa pela mais barata; nível >= 20 começa pela Ultra', () => {
    const low = makeCtx({ chips: [chip(0, true), chip(5), chip(3), chip(2), chip(0)] });
    ensureBestBallSelected(low.ctx, caidoBtn({ textContent: 'Rattata Nv 5' }));
    assert.deepEqual(low.chipEls.map((c) => c.clicks), [0, 1, 0, 0, 0], 'Poke zerada -> Great');

    const high = makeCtx({ chips: [chip(20, true), chip(5), chip(3), chip(2), chip(0)] });
    ensureBestBallSelected(high.ctx, caidoBtn({ textContent: 'Onix Nv 25' }));
    assert.deepEqual(high.chipEls.map((c) => c.clicks), [0, 0, 0, 1, 0], 'nível 25 -> Ultra');
});

test('bola: sem nível no botão usa o nível da hunt atual', () => {
    const { ctx, chipEls } = makeCtx({ huntLevel: 30, chips: [chip(20, true), chip(5), chip(3), chip(2), chip(0)] });
    ensureBestBallSelected(ctx, caidoBtn({ textContent: 'Alvo' }));
    assert.deepEqual(chipEls.map((c) => c.clicks), [0, 0, 0, 1, 0]);
});

test('bola: já na bola certa não clica; seleção inteligente desligada só troca se a atual zerou', () => {
    const same = makeCtx({ chips: [chip(20, true), chip(5), chip(3), chip(2), chip(0)] });
    ensureBestBallSelected(same.ctx, caidoBtn());
    assert.equal(same.chipEls.reduce((n, c) => n + c.clicks, 0), 0);

    const keep = makeCtx({ smart: false, chips: [chip(0), chip(5, true), chip(3), chip(2), chip(0)] });
    ensureBestBallSelected(keep.ctx, caidoBtn());
    assert.equal(keep.chipEls.reduce((n, c) => n + c.clicks, 0), 0, 'atual tem estoque: mantém');

    const swap = makeCtx({ smart: false, chips: [chip(0), chip(0, true), chip(3), chip(2), chip(0)] });
    ensureBestBallSelected(swap.ctx, caidoBtn());
    assert.deepEqual(swap.chipEls.map((c) => c.clicks), [0, 0, 1, 0, 0], 'atual zerada: primeira com estoque');
});

test('bola: sem painel de bolas ou sem chips não faz nada', () => {
    const { ctx } = makeCtx({ chips: [] });
    assert.doesNotThrow(() => ensureBestBallSelected(ctx, caidoBtn()));
    ctx.dom.$ = () => null;
    assert.doesNotThrow(() => ensureBestBallSelected(ctx, caidoBtn()));
});

test('observer: liga em #caidos-lista, religa quando o nó muda e não faz nada pausado', () => {
    observers.length = 0;
    const { ctx, setNode } = makeCtx();
    ensureCaidosObserver(ctx);
    assert.equal(observers.length, 0, 'sem nó no jogo ainda');

    const nodeA = container([]);
    setNode(nodeA);
    ensureCaidosObserver(ctx);
    assert.equal(observers.length, 1);
    assert.equal(ctx.state.observedCaidosNode, nodeA);
    assert.deepEqual(observers[0].opts, { childList: true });

    ensureCaidosObserver(ctx);
    assert.equal(observers.length, 1, 'mesmo nó: não recria');

    const nodeB = container([]);
    setNode(nodeB);
    ensureCaidosObserver(ctx);
    assert.equal(observers.length, 2);
    assert.equal(observers[0].disconnected, true);
    assert.equal(ctx.state.observedCaidosNode, nodeB);

    ctx.state.paused = true;
    setNode(container([]));
    ensureCaidosObserver(ctx);
    assert.equal(observers.length, 2, 'pausado: ignora');
});

test('observer: mutação dispara processCaidos no nó observado', async () => {
    observers.length = 0;
    const { ctx, setNode } = makeCtx();
    const btn = caidoBtn();
    const node = container([]);
    setNode(node);
    ensureCaidosObserver(ctx);
    node.querySelectorAll = () => [btn];
    observers[0].cb();
    await wait();
    assert.equal(btn.clicks, 1);
});

test('capture: runtime registra com o período da config e dispose solta o observer', () => {
    observers.length = 0;
    const { ctx, setNode } = makeCtx();
    assert.equal(capture.everyMs(ctx), 3000);
    const rt = createRuntime(ctx);
    rt.register(capture);
    assert.deepEqual(rt.scheduler.list(), ['capture']);

    setNode(container([]));
    rt.call('capture', 'ensureObserver');
    assert.equal(observers.length, 1);
    rt.dispose();
    assert.equal(observers[0].disconnected, true);
    assert.equal(ctx.state.caidosObserver, null);
    assert.equal(ctx.state.observedCaidosNode, null);
});

test('bola: resolveDesiredBallOrder respeita preferredBall, shinyBall e threshold', () => {
    const cfg = {
        caidos: { preferredBall: 'great', shinyBall: 'ultra', smartBallSelect: true, highLevelUltraThreshold: 20 },
    };
    assert.deepEqual(resolveDesiredBallOrder(cfg, { isShiny: false, targetLv: 5 }), [1, 0, 2, 3, 4]);
    assert.deepEqual(resolveDesiredBallOrder(cfg, { isShiny: true, targetLv: 5 }), [3, 4, 2, 1, 0]);
    cfg.caidos.preferredBall = 'auto';
    cfg.caidos.shinyBall = 'best';
    assert.deepEqual(resolveDesiredBallOrder(cfg, { isShiny: false, targetLv: 19 }), [0, 1, 2, 3]);
    assert.deepEqual(resolveDesiredBallOrder(cfg, { isShiny: false, targetLv: 20 }), [3, 2, 1, 0]);
    assert.deepEqual(resolveDesiredBallOrder(cfg, { isShiny: true, targetLv: 1 }), [4, 3, 2, 1, 0]);
});

test('bola: sincroniza a bola selecionada em #caidos-bolas mesmo sem #auto-ball-opts', () => {
    const { ctx } = makeCtx();
    ctx.CONFIG.caidos.preferredBall = 'super';
    const caidosBallBtns = [
        { title: 'Poke Ball — você tem 20', classList: { contains: (c) => c === 'on' }, clicks: 0, click() { this.clicks++; } },
        { title: 'Great Ball — você tem 10', classList: { contains: () => false }, clicks: 0, click() { this.clicks++; } },
        { title: 'Super Ball — você tem 5', classList: { contains: () => false }, clicks: 0, click() { this.clicks++; } },
    ];
    const caidosBolasHost = { querySelectorAll: () => caidosBallBtns };
    const origDollar = ctx.dom.$;
    ctx.dom.$ = (sel) => (sel === '#caidos-bolas' ? caidosBolasHost : sel === '#auto-ball-opts' ? null : origDollar(sel));

    ensureBestBallSelected(ctx, caidoBtn());
    assert.deepEqual(caidosBallBtns.map((b) => b.clicks), [0, 0, 1]);
});

test('captura: prioriza corpos com classe acabando na frente dos normais', async () => {
    const { ctx } = makeCtx();
    const normal = caidoBtn({ textContent: 'Pidgey Nv 4', classList: { contains: () => false } });
    const expiring = caidoBtn({ textContent: 'Caterpie Nv 3', classList: { contains: (c) => c === 'acabando' } });
    processCaidos(ctx, container([normal, expiring]));
    await wait();
    assert.equal(expiring.clicks, 1);
    assert.equal(normal.clicks, 0);
});
