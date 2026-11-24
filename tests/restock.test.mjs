import test from 'node:test';
import assert from 'node:assert/strict';
import { restock, smartRestock, isMarketOpen, ensureMarketTab, ensureNativeAutomations } from '../src/modules/restock.js';
import { createRuntime } from '../src/modules/runtime.js';

// Market falso: cards com contador, botão "Comprar" que soma +10, atalho ×10, categorias e abas
const makeCtx = ({
    enabled = true, balls = [5, 0, 0, 0], smallPotions = null, totalRevives = null, tierChip = 0,
    marketOpen = false, hasMarketBtn = true, buyWorks = true, cardsOnCategory = null,
    owned = { 'Poke Ball': 5, 'Small Potion': 30, Revive: 2 }, restockSmallPotion = false, restockRevive = false, maxPurchases = 6,
} = {}) => {
    const log = { locks: [], menuClicks: 0, buys: 0, shortcuts: 0, closes: 0, tabClicks: 0, categoryClicks: [] };
    const market = { open: marketOpen, activeCategory: null };
    const cards = Object.entries(owned).map(([name, count]) => {
        const card = {
            name, count, category: name === 'Poke Ball' ? 'Pokebolas' : name === 'Small Potion' ? 'Poções' : 'Revives',
            querySelector: (sel) => (sel === '.mk-nome' ? { textContent: name } : sel === '.mk-tem' ? { textContent: String(card.count) } : null),
            querySelectorAll: (sel) => (sel === 'button' ? [buyBtn(card)] : sel === '.mk-atalhos button' ? [shortcutBtn] : []),
        };
        return card;
    });
    const buyBtn = (card) => ({ textContent: ' Comprar ', click: () => { log.buys++; if (buyWorks) card.count += 10; } });
    const shortcutBtn = { textContent: '×10', click: () => { log.shortcuts++; } };
    const tab = { classList: { contains: () => false }, click: () => { log.tabClicks++; } };
    const catBtns = ['Pokebolas', 'Poções', 'Revives'].map((cat) => ({
        classList: { contains: () => market.activeCategory === cat },
        querySelector: () => ({ textContent: cat }),
        textContent: cat,
        click: () => { market.activeCategory = cat; log.categoryClicks.push(cat); },
    }));
    const visibleCards = () => cards.filter((c) => (cardsOnCategory ? market.activeCategory === c.category : true));
    const ctx = {
        CONFIG: {
            restock: {
                enabled, minBalls: 10, targetBalls: 50, restockSmallPotion, minPotions: 10, targetPotions: 40,
                restockRevive, minRevives: 5, targetRevives: 20, batchButton: '×10', maxPurchases,
                buyConfirmTimeoutMs: 2600, closeMarketAfter: true,
            },
            delays: { uiMinMs: 0, uiMaxMs: 0 },
        },
        state: { running: true, lastActionNote: '', stats: { purchases: 0 } },
        sleep: async () => {},
        randomDelay: () => 0,
        withModalLock: async (label, fn) => { log.locks.push(label); return fn(); },
        dom: {
            $: (sel) => (sel === '#mk-modos' ? (market.open ? {} : null) : sel === '#mk-modos .cmp-op[data-aba="compra"]' ? tab : null),
            $$: (sel) => (sel === '#mk-corpo .mk-card' ? visibleCards() : sel === '#mk-corpo .mk-lado button.mk-cat' ? catBtns : []),
            isVisible: () => true,
            isInteractable: () => true,
            getVisibleModal: () => null,
            closeActiveModal: async () => { log.closes++; market.open = false; },
            findMenuButtonByImg: () => (hasMarketBtn ? { click: () => { log.menuClicks++; market.open = true; } } : null),
            findClickableByText: () => null,
            waitFor: async (fn) => fn(),
            getTargetBallTier: () => ({ itemName: 'Poke Ball', chipIndex: tierChip }),
            getInventorySnapshot: () => ({ balls, smallPotions, totalRevives }),
        },
    };
    return { ctx, log, cards, market };
};

test('restock: bolas abaixo do mínimo abre o Market, compra até a meta e fecha', async () => {
    const { ctx, log, cards } = makeCtx();
    await smartRestock(ctx);
    assert.deepEqual(log.locks, ['Restock']);
    assert.equal(log.menuClicks, 1);
    assert.equal(cards[0].count, 55, '5 +10 por compra até >= 50');
    assert.equal(ctx.state.stats.purchases, 5);
    assert.equal(ctx.state.lastActionNote, 'Poke Ball: 55');
    assert.equal(log.shortcuts, 5, 'seleciona o lote ×10 antes de cada compra');
    assert.equal(log.closes, 1, 'fechou porque o bot que abriu');
});

test('restock: estoque suficiente, desligado ou sem leitura do inventário não faz nada', async () => {
    for (const opts of [{ balls: [30, 0, 0, 0] }, { enabled: false }, { balls: null }]) {
        const { ctx, log } = makeCtx(opts);
        await smartRestock(ctx);
        assert.equal(log.locks.length, 0, JSON.stringify(opts));
    }
});

test('restock: olha o estoque da bola alvo (chipIndex), não de qualquer bola', async () => {
    const { ctx, log } = makeCtx({ balls: [100, 3, 0, 0], tierChip: 1 });
    await smartRestock(ctx);
    assert.deepEqual(log.locks, ['Restock']);
    const ok = makeCtx({ balls: [3, 100, 0, 0], tierChip: 1 });
    await smartRestock(ok.ctx);
    assert.equal(ok.log.locks.length, 0);
});

test('restock: force compra mesmo desligado e mesmo com estoque', async () => {
    const { ctx, log, cards } = makeCtx({ enabled: false, balls: [30, 0, 0, 0], owned: { 'Poke Ball': 30 } });
    await smartRestock(ctx, { force: true });
    assert.deepEqual(log.locks, ['Restock']);
    assert.equal(cards[0].count, 50);
});

test('restock: poção e revive só entram se ligados e abaixo do mínimo', async () => {
    const off = makeCtx({ balls: [30, 0, 0, 0], smallPotions: 2, totalRevives: 1 });
    await smartRestock(off.ctx);
    assert.equal(off.log.locks.length, 0, 'ligados=false');

    const on = makeCtx({
        balls: [30, 0, 0, 0], smallPotions: 2, totalRevives: 1, restockSmallPotion: true, restockRevive: true,
        cardsOnCategory: true,
    });
    await smartRestock(on.ctx);
    assert.deepEqual(on.log.locks, ['Restock']);
    assert.deepEqual(on.log.categoryClicks, ['Poções', 'Revives'], 'troca de categoria para achar o card');
    assert.equal(on.cards[1].count, 40);
    assert.equal(on.cards[2].count, 22);
});

test('restock: Market já aberto não é reaberto nem fechado depois', async () => {
    const { ctx, log } = makeCtx({ marketOpen: true });
    await smartRestock(ctx);
    assert.equal(log.menuClicks, 0);
    assert.equal(log.closes, 0);
    assert.equal(log.buys, 5);
});

test('restock: sem botão do Market ou Market que não abre, não compra nada', async () => {
    const a = makeCtx({ hasMarketBtn: false });
    await smartRestock(a.ctx);
    assert.equal(a.log.buys, 0);

    const b = makeCtx();
    b.ctx.dom.findMenuButtonByImg = () => ({ click: () => { b.log.menuClicks++; } }); // clica mas não abre
    await smartRestock(b.ctx);
    assert.equal(b.log.buys, 0);
    assert.equal(b.log.closes, 1, 'bot abriu (tentou): fecha no finally');
});

test('restock: compra que não aumenta o contador para na hora; maxPurchases limita', async () => {
    const stuck = makeCtx({ buyWorks: false });
    await smartRestock(stuck.ctx);
    assert.equal(stuck.log.buys, 1);
    assert.equal(stuck.ctx.state.stats.purchases, 1);

    const capped = makeCtx({ maxPurchases: 2, owned: { 'Poke Ball': 0 }, balls: [0, 0, 0, 0] });
    await smartRestock(capped.ctx);
    assert.equal(capped.log.buys, 2);
    assert.equal(capped.cards[0].count, 20);
});

test('restock: card que não existe em nenhuma categoria é ignorado sem travar', async () => {
    const { ctx, log } = makeCtx({ owned: {} });
    await smartRestock(ctx);
    assert.equal(log.buys, 0);
    assert.equal(log.closes, 1);
});

test('restock: state.running=false no meio interrompe as compras', async () => {
    const { ctx, log } = makeCtx();
    const orig = ctx.dom.findMenuButtonByImg;
    ctx.dom.findMenuButtonByImg = (s) => { const b = orig(s); return b && { click: () => { b.click(); ctx.state.running = false; } }; };
    await smartRestock(ctx);
    assert.equal(log.buys, 0);
    assert.equal(log.closes, 0, 'parado: não fecha o modal por conta própria');
});

test('market: isMarketOpen e ensureMarketTab', async () => {
    const { ctx, log, market } = makeCtx();
    assert.equal(isMarketOpen(ctx), false);
    market.open = true;
    assert.equal(isMarketOpen(ctx), true);
    await ensureMarketTab(ctx, 'compra');
    assert.equal(log.tabClicks, 1);
    ctx.dom.$ = () => null;
    await ensureMarketTab(ctx, 'compra');
    assert.equal(log.tabClicks, 1, 'sem aba: nada');
});

test('restock: runtime registra com o período da config e expõe run', async () => {
    const { ctx, log } = makeCtx({ balls: [30, 0, 0, 0] });
    ctx.CONFIG.restock.checkIntervalMs = 15000;
    assert.equal(restock.everyMs(ctx), 15000);
    const rt = createRuntime(ctx);
    rt.register(restock);
    assert.deepEqual(rt.scheduler.list(), ['restock']);
    await rt.call('restock', 'run', { force: true });
    assert.deepEqual(log.locks, ['Restock']);
    rt.dispose();
});

test('restock: ensureNativeAutomations religa checkboxes desmarcados do jogo', () => {
    const checkboxes = {
        '#auto-revive': { checked: false, click() { this.checked = true; } },
        '#auto-potion': { checked: true, click() { throw new Error('não deveria clicar'); } },
        '#auto-voltar-hunt': { checked: false, click() { this.checked = true; } },
    };
    const ctx = {
        CONFIG: { restock: { ensureNativeAutoHeal: true } },
        dom: {
            $: (sel) => checkboxes[sel] || null,
            isInteractable: () => true,
        },
    };
    const count = ensureNativeAutomations(ctx);
    assert.equal(count, 2);
    assert.equal(checkboxes['#auto-revive'].checked, true);
    assert.equal(checkboxes['#auto-voltar-hunt'].checked, true);

    checkboxes['#auto-revive'].checked = false;
    ctx.CONFIG.restock.ensureNativeAutoHeal = false;
    assert.equal(ensureNativeAutomations(ctx), 0);
    assert.equal(checkboxes['#auto-revive'].checked, false);
});
