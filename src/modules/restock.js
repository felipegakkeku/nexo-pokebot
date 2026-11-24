// Restock: compra bolas/poções/revives no Market quando o estoque cai abaixo do mínimo.
// Comportamento idêntico ao da v6.5; só mudou de lugar. Helpers do Market (isMarketOpen, ensureMarketTab)
// são exportados porque o Depot (modo "venda") também usa.
import { normalizeText, parseNumber } from './pure.js';

const SEL_LOCAL = {
    marketCards: '#mk-corpo .mk-card',
    marketModes: '#mk-modos',
    cardName: '.mk-nome',
    cardOwned: '.mk-tem',
    cardShortcuts: '.mk-atalhos button',
    categoryBtns: '#mk-corpo .mk-lado button.mk-cat',
    categoryText: '.mk-cat-txt',
    marketTab: (abaKey) => `#mk-modos .cmp-op[data-aba="${abaKey}"]`,
    nativeAutoChecks: ['#auto-revive', '#auto-potion', '#auto-voltar-hunt'],
};

export const ensureNativeAutomations = ({ CONFIG, dom }) => {
    if (CONFIG.restock?.ensureNativeAutoHeal === false) return 0;
    let reenabled = 0;
    for (const sel of SEL_LOCAL.nativeAutoChecks) {
        const el = dom.$(sel);
        if (el && el.checked === false && dom.isInteractable(el)) {
            el.click();
            reenabled++;
        }
    }
    return reenabled;
};

const getVisibleMarketCards = ({ dom }) => dom.$$(SEL_LOCAL.marketCards).filter(dom.isInteractable);

export const isMarketOpen = ({ dom }) => Boolean(dom.$(SEL_LOCAL.marketModes) && dom.isVisible(dom.$(SEL_LOCAL.marketModes)));

const findMarketCard = (ctx, itemName) => {
    const target = normalizeText(itemName);
    return (
        getVisibleMarketCards(ctx).find((card) => {
            const nameEl = card.querySelector(SEL_LOCAL.cardName);
            return nameEl && normalizeText(nameEl.textContent) === target;
        }) ||
        getVisibleMarketCards(ctx).find((card) => {
            const nameEl = card.querySelector(SEL_LOCAL.cardName);
            return nameEl && normalizeText(nameEl.textContent).includes(target);
        }) ||
        null
    );
};

const findCardBuyButton = ({ dom }, card) => {
    if (!card) return null;
    return (
        Array.from(card.querySelectorAll('button')).find(
            (btn) => normalizeText(btn.textContent).includes('comprar') && dom.isInteractable(btn)
        ) || null
    );
};

const selectBatchShortcut = async ({ dom, sleep, randomDelay }, card, batchLabel) => {
    if (!card || !batchLabel) return;
    const target = normalizeText(batchLabel).replace('×', 'x');
    const shortcutBtn = Array.from(card.querySelectorAll(SEL_LOCAL.cardShortcuts)).find((btn) => {
        const txt = normalizeText(btn.textContent).replace('×', 'x');
        return txt === target && dom.isInteractable(btn);
    });
    if (shortcutBtn) {
        shortcutBtn.click();
        await sleep(randomDelay(120, 220));
    }
};

export const ensureMarketTab = async ({ CONFIG, dom, sleep, randomDelay }, abaKey) => {
    const tab = dom.$(SEL_LOCAL.marketTab(abaKey));
    if (tab && !tab.classList.contains('on') && dom.isInteractable(tab)) {
        tab.click();
        await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
    }
};

const switchMarketCategory = async ({ CONFIG, dom, sleep, randomDelay }, categoryName) => {
    const target = normalizeText(categoryName);
    const catBtn = dom.$$(SEL_LOCAL.categoryBtns).find((btn) => {
        if (!dom.isInteractable(btn)) return false;
        const txt = normalizeText(btn.querySelector(SEL_LOCAL.categoryText)?.textContent || btn.textContent);
        return txt.startsWith(target) || txt === target;
    });
    if (catBtn && !catBtn.classList.contains('on')) {
        catBtn.click();
        await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
    }
};

export const smartRestock = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, dom, sleep, randomDelay, withModalLock } = ctx;
    ensureNativeAutomations(ctx);
    if (!CONFIG.restock.enabled && !force) return;

    const ballTier = dom.getTargetBallTier();
    const inv = dom.getInventorySnapshot();
    const toBuy = [];

    const currentTierBalls = inv.balls ? inv.balls[ballTier.chipIndex] : null;
    if (force || (currentTierBalls !== null && currentTierBalls < CONFIG.restock.minBalls)) {
        toBuy.push({
            itemName: ballTier.itemName,
            categoryName: 'Pokebolas',
            targetAmount: CONFIG.restock.targetBalls,
        });
    }

    if (
        CONFIG.restock.restockSmallPotion &&
        (force || (inv.smallPotions !== null && inv.smallPotions < CONFIG.restock.minPotions))
    ) {
        toBuy.push({
            itemName: 'Small Potion',
            categoryName: 'Poções',
            targetAmount: CONFIG.restock.targetPotions,
        });
    }

    if (
        CONFIG.restock.restockRevive &&
        (force || (inv.totalRevives !== null && inv.totalRevives < CONFIG.restock.minRevives))
    ) {
        toBuy.push({
            itemName: 'Revive',
            categoryName: 'Revives',
            targetAmount: CONFIG.restock.targetRevives,
        });
    }

    if (toBuy.length === 0) return;

    await withModalLock(
        'Restock',
        async () => {
            let openedByBot = false;
            try {
                if (!isMarketOpen(ctx)) {
                    if (dom.getVisibleModal()) await dom.closeActiveModal();
                    const marketBtn = dom.findMenuButtonByImg('menu-market') || dom.findClickableByText('Market');
                    if (!marketBtn) return;
                    marketBtn.click();
                    openedByBot = true;
                    const loaded = await dom.waitFor(() => isMarketOpen(ctx), 3500);
                    if (!loaded) return;
                    await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
                }

                await ensureMarketTab(ctx, 'compra');

                for (const item of toBuy) {
                    if (!state.running) break;

                    let card = findMarketCard(ctx, item.itemName);
                    if (!card) {
                        await switchMarketCategory(ctx, item.categoryName);
                        card = await dom.waitFor(() => findMarketCard(ctx, item.itemName), 2800);
                    }
                    if (!card) continue;

                    for (let i = 0; i < CONFIG.restock.maxPurchases; i++) {
                        if (!state.running) break;
                        const currCard = findMarketCard(ctx, item.itemName);
                        if (!currCard) break;

                        const countBefore = parseNumber(currCard.querySelector(SEL_LOCAL.cardOwned)?.textContent);
                        if (countBefore !== null && countBefore >= item.targetAmount) break;

                        await selectBatchShortcut(ctx, currCard, CONFIG.restock.batchButton);
                        const buyBtn = findCardBuyButton(ctx, currCard);
                        if (!buyBtn) break;

                        buyBtn.click();
                        state.stats.purchases++;

                        const countAfter = await dom.waitFor(() => {
                            const upd = findMarketCard(ctx, item.itemName);
                            const val = parseNumber(upd?.querySelector(SEL_LOCAL.cardOwned)?.textContent);
                            return val !== null && countBefore !== null && val > countBefore ? val : null;
                        }, CONFIG.restock.buyConfirmTimeoutMs, 100);

                        if (countAfter === null) break;
                        state.lastActionNote = `${item.itemName}: ${countAfter}`;
                        await sleep(randomDelay(160, 280));
                    }
                }
            } finally {
                if (openedByBot && CONFIG.restock.closeMarketAfter && state.running) {
                    await dom.closeActiveModal();
                }
            }
        },
        { force }
    );
};

export const restock = {
    id: 'restock',
    everyMs: (ctx) => ctx.CONFIG.restock.checkIntervalMs,
    tick: (ctx) => smartRestock(ctx, { force: false }),
    run: smartRestock,
};
