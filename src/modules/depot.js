// Gestor de Depot: a cada 10 min (CONFIG.depot.intervalMs) vende / oferenda / sacrifica os Pokémon do depósito.
// Comportamento idêntico ao da v6.5; só mudou de lugar. openBackpackPocket é exportado: a Chocadeira também usa.
import { parseNumber } from './pure.js';
import { isMarketOpen, ensureMarketTab } from './restock.js';

const SEL_LOCAL = {
    bagBtn: '#btn-bolsa',
    pocket: (abaKey) => `.mochila-bolso[data-aba="${abaKey}"]`,
    bagBody: '#bolsa-corpo',
    sellInfo: '.mk-vt-info',
    sellAllBtn: '.mk-vender-tudo button.mk-acao',
    offerAll: '#ofr-tudo',
    offerAuto: '#ofr-auto',
    offerFast: '#ofr-rapida',
    offerSpin: '#ofr-girar',
    sacSelectAll: '#sac-todos',
    sacDo: '#sac-sacrificar',
    sacClaim: '#sac-resgatar',
};

export const openBackpackPocket = async ({ dom, sleep, randomDelay }, abaKey) => {
    if (dom.getVisibleModal()) await dom.closeActiveModal();
    const bagBtn = dom.$(SEL_LOCAL.bagBtn);
    if (!bagBtn || !dom.isInteractable(bagBtn)) return null;

    bagBtn.click();
    const bolsoBtn = await dom.waitFor(() => dom.$(SEL_LOCAL.pocket(abaKey)), 3500);
    if (!bolsoBtn || !dom.isInteractable(bolsoBtn)) {
        await dom.closeActiveModal();
        return null;
    }
    bolsoBtn.click();
    await sleep(randomDelay(320, 480));
    return dom.$(SEL_LOCAL.bagBody);
};

export const runDepotManager = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, dom, sleep, randomDelay, withModalLock } = ctx;
    const mode = CONFIG.depot.mode;
    if (mode === 'off') return;
    if (!force && Date.now() - state.lastDepotRunAt < CONFIG.depot.intervalMs) return;

    await withModalLock(
        `Depot:${mode}`,
        async () => {
            state.lastDepotRunAt = Date.now();
            try {
                if (mode === 'venda') {
                    if (dom.getVisibleModal()) await dom.closeActiveModal();
                    const marketBtn = dom.findMenuButtonByImg('menu-market') || dom.findClickableByText('Market');
                    if (!marketBtn) return;
                    marketBtn.click();
                    if (!(await dom.waitFor(() => isMarketOpen(ctx), 3500))) return;

                    await ensureMarketTab(ctx, 'pokemons');
                    await sleep(randomDelay(250, 400));

                    const infoTxt = dom.$(SEL_LOCAL.sellInfo)?.textContent || '';
                    const countToSell = parseNumber(infoTxt.split('para vender')[0]);
                    const sellAllBtn = dom.$(SEL_LOCAL.sellAllBtn);

                    if (sellAllBtn && dom.isInteractable(sellAllBtn) && (countToSell === null || countToSell > 0)) {
                        sellAllBtn.click();
                        await dom.confirmModalDialog(['confirmar', 'vender', 'sim']);
                        state.stats.depotRuns++;
                        state.lastActionNote = `Depot vendido (${countToSell ?? '?'} pkm)`;
                    } else {
                        state.lastActionNote = 'Depot sem Pokémon para vender';
                    }
                } else if (mode === 'oferenda') {
                    const corpo = await openBackpackPocket(ctx, 'oferenda');
                    if (!corpo) return;

                    const allBtn = dom.$(SEL_LOCAL.offerAll);
                    if (allBtn && dom.isInteractable(allBtn)) {
                        allBtn.click();
                        await dom.confirmModalDialog(['confirmar', 'oferendar', 'sim']);
                        state.stats.depotRuns++;
                        state.lastActionNote = 'Oferenda em lote executada';
                    } else {
                        const autoBtn = dom.$(SEL_LOCAL.offerAuto);
                        if (autoBtn && dom.isInteractable(autoBtn)) {
                            autoBtn.click();
                            await sleep(randomDelay(260, 400));
                        }
                        const fastBtn = dom.$(SEL_LOCAL.offerFast) || dom.$(SEL_LOCAL.offerSpin);
                        if (fastBtn && dom.isInteractable(fastBtn)) {
                            fastBtn.click();
                            await dom.confirmModalDialog(['confirmar', 'oferendar', 'sim']);
                            state.stats.depotRuns++;
                            state.lastActionNote = 'Oferenda rápida executada';
                        } else {
                            state.lastActionNote = 'Oferenda: sem Pokémon elegíveis';
                        }
                    }
                } else if (mode === 'sacrificio') {
                    const corpo = await openBackpackPocket(ctx, 'sacrificio');
                    if (!corpo) return;

                    const selBtn = dom.$(SEL_LOCAL.sacSelectAll);
                    if (selBtn && dom.isInteractable(selBtn)) {
                        selBtn.click();
                        await sleep(randomDelay(260, 400));
                    }

                    const sacBtn = dom.$(SEL_LOCAL.sacDo);
                    if (sacBtn && dom.isInteractable(sacBtn)) {
                        sacBtn.click();
                        await dom.confirmModalDialog(['confirmar', 'sacrificar', 'sim']);
                        state.stats.depotRuns++;
                        state.lastActionNote = 'Sacrifício concluído';
                        await sleep(randomDelay(300, 450));
                    }

                    const native = dom.readNativeSessionPanel();
                    const boostOn = Boolean(native?.boosts?.sacrificio);
                    const claimBtn = dom.$(SEL_LOCAL.sacClaim);
                    if (claimBtn && dom.isInteractable(claimBtn) && (!boostOn || force)) {
                        claimBtn.click();
                        await dom.confirmModalDialog(['confirmar', 'resgatar', 'sim']);
                        state.lastActionNote = 'Boost +20% XP resgatado!';
                    }
                }
            } finally {
                await dom.closeActiveModal();
            }
        },
        { force }
    );
};

export const depot = {
    id: 'depot',
    everyMs: 60000,
    tick: (ctx) => runDepotManager(ctx, { force: false }),
    run: runDepotManager,
};
