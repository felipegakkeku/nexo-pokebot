import test from 'node:test';
import assert from 'node:assert/strict';
import { depot, runDepotManager, openBackpackPocket } from '../src/modules/depot.js';
import { createRuntime } from '../src/modules/runtime.js';

const btn = (log, name, extra = {}) => ({ click: () => log.clicks.push(name), ...extra });

// DOM falso: `els` mapeia seletor -> elemento; o Market e o bolso abrem quando o botão do menu/bolsa é clicado
const makeCtx = ({ mode = 'venda', els = {}, sellInfo = '12 Pokémon para vender', boost = false, lastRun = 0, hasBag = true, hasPocket = true, hasMarketBtn = true } = {}) => {
    const log = { clicks: [], locks: [], closes: 0, confirms: [], tabClicks: 0 };
    const open = { market: false };
    const elements = {
        '#mk-modos .cmp-op[data-aba="pokemons"]': { classList: { contains: () => false }, click: () => { log.tabClicks++; } },
        '.mk-vt-info': sellInfo === null ? null : { textContent: sellInfo },
        '.mk-vender-tudo button.mk-acao': btn(log, 'venderTudo'),
        ...(hasBag ? { '#btn-bolsa': btn(log, 'bolsa') } : {}),
        ...(hasPocket ? { '.mochila-bolso[data-aba="oferenda"]': btn(log, 'bolso-oferenda'), '.mochila-bolso[data-aba="sacrificio"]': btn(log, 'bolso-sacrificio') } : {}),
        '#bolsa-corpo': { id: 'corpo' },
        ...els,
    };
    const ctx = {
        CONFIG: { depot: { mode, intervalMs: 600000 }, delays: { uiMinMs: 0, uiMaxMs: 0 } },
        state: { running: true, lastDepotRunAt: lastRun, lastActionNote: '', stats: { depotRuns: 0 } },
        sleep: async () => {},
        randomDelay: () => 0,
        withModalLock: async (label, fn) => { log.locks.push(label); return fn(); },
        dom: {
            $: (sel) => (sel === '#mk-modos' ? (open.market ? {} : null) : elements[sel] ?? null),
            isVisible: () => true,
            isInteractable: () => true,
            getVisibleModal: () => null,
            closeActiveModal: async () => { log.closes++; },
            findMenuButtonByImg: () => (hasMarketBtn ? { click: () => { open.market = true; log.clicks.push('menu-market'); } } : null),
            findClickableByText: () => null,
            waitFor: async (fn) => fn(),
            confirmModalDialog: async (kw) => { log.confirms.push(kw); return true; },
            readNativeSessionPanel: () => ({ boosts: { sacrificio: boost } }),
        },
    };
    return { ctx, log, elements };
};

test('depot: modo off, ou dentro do intervalo, não faz nada; force ignora o intervalo', async () => {
    const off = makeCtx({ mode: 'off' });
    await runDepotManager(off.ctx, { force: true });
    assert.equal(off.log.locks.length, 0);

    const recent = makeCtx({ lastRun: Date.now() - 1000 });
    await runDepotManager(recent.ctx);
    assert.equal(recent.log.locks.length, 0);

    await runDepotManager(recent.ctx, { force: true });
    assert.deepEqual(recent.log.locks, ['Depot:venda']);
});

test('depot venda: abre o Market, vende tudo, confirma, conta e fecha', async () => {
    const { ctx, log } = makeCtx();
    await runDepotManager(ctx);
    assert.deepEqual(log.locks, ['Depot:venda']);
    assert.deepEqual(log.clicks, ['menu-market', 'venderTudo']);
    assert.deepEqual(log.confirms, [['confirmar', 'vender', 'sim']]);
    assert.equal(log.tabClicks, 1);
    assert.equal(ctx.state.stats.depotRuns, 1);
    assert.equal(ctx.state.lastActionNote, 'Depot vendido (12 pkm)');
    assert.ok(Date.now() - ctx.state.lastDepotRunAt < 1000);
    assert.equal(log.closes, 1);
});

test('depot venda: 0 para vender não vende; sem texto de contagem vende e mostra "?"', async () => {
    const zero = makeCtx({ sellInfo: '0 Pokémon para vender' });
    await runDepotManager(zero.ctx);
    assert.equal(zero.log.confirms.length, 0);
    assert.equal(zero.ctx.state.stats.depotRuns, 0);
    assert.equal(zero.ctx.state.lastActionNote, 'Depot sem Pokémon para vender');

    const unknown = makeCtx({ sellInfo: null });
    await runDepotManager(unknown.ctx);
    assert.equal(unknown.ctx.state.lastActionNote, 'Depot vendido (? pkm)');
});

test('depot venda: sem botão do Market, ou Market não abre, só fecha o modal', async () => {
    const a = makeCtx({ hasMarketBtn: false });
    await runDepotManager(a.ctx);
    assert.deepEqual(a.log.clicks, []);
    assert.equal(a.log.closes, 1);
    assert.ok(a.ctx.state.lastDepotRunAt > 0, 'marca a tentativa mesmo assim');

    const b = makeCtx();
    b.ctx.dom.findMenuButtonByImg = () => ({ click: () => b.log.clicks.push('menu-market') });
    await runDepotManager(b.ctx);
    assert.deepEqual(b.log.clicks, ['menu-market']);
    assert.equal(b.ctx.state.stats.depotRuns, 0);
});

test('depot oferenda: botão "tudo" faz oferenda em lote', async () => {
    const { ctx, log } = makeCtx({ mode: 'oferenda', els: {} });
    ctx.dom.$ = ((orig) => (sel) => (sel === '#ofr-tudo' ? btn(log, 'ofr-tudo') : orig(sel)))(ctx.dom.$);
    await runDepotManager(ctx);
    assert.deepEqual(log.clicks, ['bolsa', 'bolso-oferenda', 'ofr-tudo']);
    assert.deepEqual(log.confirms, [['confirmar', 'oferendar', 'sim']]);
    assert.equal(ctx.state.lastActionNote, 'Oferenda em lote executada');
    assert.equal(ctx.state.stats.depotRuns, 1);
    assert.equal(log.closes, 1);
});

test('depot oferenda: sem "tudo", usa auto + rápida; cai para girar; sem nada avisa', async () => {
    const rapid = makeCtx({ mode: 'oferenda' });
    rapid.elements['#ofr-auto'] = btn(rapid.log, 'ofr-auto');
    rapid.elements['#ofr-rapida'] = btn(rapid.log, 'ofr-rapida');
    await runDepotManager(rapid.ctx);
    assert.deepEqual(rapid.log.clicks, ['bolsa', 'bolso-oferenda', 'ofr-auto', 'ofr-rapida']);
    assert.equal(rapid.ctx.state.lastActionNote, 'Oferenda rápida executada');

    const spin = makeCtx({ mode: 'oferenda' });
    spin.elements['#ofr-girar'] = btn(spin.log, 'ofr-girar');
    await runDepotManager(spin.ctx);
    assert.deepEqual(spin.log.clicks, ['bolsa', 'bolso-oferenda', 'ofr-girar']);

    const none = makeCtx({ mode: 'oferenda' });
    await runDepotManager(none.ctx);
    assert.equal(none.ctx.state.lastActionNote, 'Oferenda: sem Pokémon elegíveis');
    assert.equal(none.ctx.state.stats.depotRuns, 0);
});

test('depot sacrifício: seleciona tudo, sacrifica e resgata o boost se estiver desligado', async () => {
    const { ctx, log, elements } = makeCtx({ mode: 'sacrificio' });
    elements['#sac-todos'] = btn(log, 'sac-todos');
    elements['#sac-sacrificar'] = btn(log, 'sac-sacrificar');
    elements['#sac-resgatar'] = btn(log, 'sac-resgatar');
    await runDepotManager(ctx);
    assert.deepEqual(log.clicks, ['bolsa', 'bolso-sacrificio', 'sac-todos', 'sac-sacrificar', 'sac-resgatar']);
    assert.deepEqual(log.confirms, [['confirmar', 'sacrificar', 'sim'], ['confirmar', 'resgatar', 'sim']]);
    assert.equal(ctx.state.stats.depotRuns, 1);
    assert.equal(ctx.state.lastActionNote, 'Boost +20% XP resgatado!');
});

test('depot sacrifício: boost já ativo não resgata, a não ser com force', async () => {
    const mk = () => {
        const c = makeCtx({ mode: 'sacrificio', boost: true });
        c.elements['#sac-sacrificar'] = btn(c.log, 'sac-sacrificar');
        c.elements['#sac-resgatar'] = btn(c.log, 'sac-resgatar');
        return c;
    };
    const normal = mk();
    await runDepotManager(normal.ctx);
    assert.ok(!normal.log.clicks.includes('sac-resgatar'));
    assert.equal(normal.ctx.state.lastActionNote, 'Sacrifício concluído');

    const forced = mk();
    await runDepotManager(forced.ctx, { force: true });
    assert.ok(forced.log.clicks.includes('sac-resgatar'));
});

test('depot: bolsa ou bolso que não abre devolve null, fecha o modal e não conta execução', async () => {
    const noBag = makeCtx({ mode: 'oferenda', hasBag: false });
    assert.equal(await openBackpackPocket(noBag.ctx, 'oferenda'), null);
    await runDepotManager(noBag.ctx);
    assert.equal(noBag.ctx.state.stats.depotRuns, 0);
    assert.equal(noBag.log.closes, 1, 'só o finally do depot');

    const noPocket = makeCtx({ mode: 'sacrificio', hasPocket: false });
    assert.equal(await openBackpackPocket(noPocket.ctx, 'sacrificio'), null);
    assert.equal(noPocket.log.closes, 1, 'fecha a bolsa que abriu');
    await runDepotManager(noPocket.ctx);
    assert.equal(noPocket.ctx.state.stats.depotRuns, 0);
});

test('depot: runtime registra a cada 60 s e expõe run', async () => {
    const { ctx, log } = makeCtx({ mode: 'off' });
    assert.equal(depot.everyMs, 60000);
    const rt = createRuntime(ctx);
    rt.register(depot);
    assert.deepEqual(rt.scheduler.list(), ['depot']);
    ctx.CONFIG.depot.mode = 'venda';
    await rt.call('depot', 'run', { force: true });
    assert.deepEqual(log.locks, ['Depot:venda']);
    rt.dispose();
});
