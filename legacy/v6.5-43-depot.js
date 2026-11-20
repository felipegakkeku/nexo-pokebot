    // --- 4. Gestor de Depot ---
    const openBackpackPocket = async (abaKey) => {
        if (getVisibleModal()) await closeActiveModal();
        const bagBtn = document.getElementById('btn-bolsa');
        if (!bagBtn || !isInteractable(bagBtn)) return null;

        bagBtn.click();
        const bolsoBtn = await waitFor(
            () => document.querySelector(`.mochila-bolso[data-aba="${abaKey}"]`),
            3500
        );
        if (!bolsoBtn || !isInteractable(bolsoBtn)) {
            await closeActiveModal();
            return null;
        }
        bolsoBtn.click();
        await sleep(randomDelay(320, 480));
        return document.getElementById('bolsa-corpo');
    };

    const runDepotManager = async (force = false) => {
        const mode = CONFIG.depot.mode;
        if (mode === 'off') return;
        if (!force && Date.now() - state.lastDepotRunAt < CONFIG.depot.intervalMs) return;

        await withModalLock(
            `Depot:${mode}`,
            async () => {
                state.lastDepotRunAt = Date.now();
                try {
                    if (mode === 'venda') {
                        if (getVisibleModal()) await closeActiveModal();
                        const marketBtn = findMenuButtonByImg('menu-market') || findClickableByText('Market');
                        if (!marketBtn) return;
                        marketBtn.click();
                        if (!(await waitFor(isMarketOpen, 3500))) return;

                        await ensureMarketTab('pokemons');
                        await sleep(randomDelay(250, 400));

                        const infoTxt = document.querySelector('.mk-vt-info')?.textContent || '';
                        const countToSell = parseNumber(infoTxt.split('para vender')[0]);
                        const sellAllBtn = document.querySelector('.mk-vender-tudo button.mk-acao');

                        if (sellAllBtn && isInteractable(sellAllBtn) && (countToSell === null || countToSell > 0)) {
                            sellAllBtn.click();
                            await confirmModalDialog(['confirmar', 'vender', 'sim']);
                            state.stats.depotRuns++;
                            state.lastActionNote = `Depot vendido (${countToSell ?? '?'} pkm)`;
                        } else {
                            state.lastActionNote = 'Depot sem Pokémon para vender';
                        }
                    } else if (mode === 'oferenda') {
                        const corpo = await openBackpackPocket('oferenda');
                        if (!corpo) return;

                        const allBtn = document.getElementById('ofr-tudo');
                        if (allBtn && isInteractable(allBtn)) {
                            allBtn.click();
                            await confirmModalDialog(['confirmar', 'oferendar', 'sim']);
                            state.stats.depotRuns++;
                            state.lastActionNote = 'Oferenda em lote executada';
                        } else {
                            const autoBtn = document.getElementById('ofr-auto');
                            if (autoBtn && isInteractable(autoBtn)) {
                                autoBtn.click();
                                await sleep(randomDelay(260, 400));
                            }
                            const fastBtn = document.getElementById('ofr-rapida') || document.getElementById('ofr-girar');
                            if (fastBtn && isInteractable(fastBtn)) {
                                fastBtn.click();
                                await confirmModalDialog(['confirmar', 'oferendar', 'sim']);
                                state.stats.depotRuns++;
                                state.lastActionNote = 'Oferenda rápida executada';
                            } else {
                                state.lastActionNote = 'Oferenda: sem Pokémon elegíveis';
                            }
                        }
                    } else if (mode === 'sacrificio') {
                        const corpo = await openBackpackPocket('sacrificio');
                        if (!corpo) return;

                        const selBtn = document.getElementById('sac-todos');
                        if (selBtn && isInteractable(selBtn)) {
                            selBtn.click();
                            await sleep(randomDelay(260, 400));
                        }

                        const sacBtn = document.getElementById('sac-sacrificar');
                        if (sacBtn && isInteractable(sacBtn)) {
                            sacBtn.click();
                            await confirmModalDialog(['confirmar', 'sacrificar', 'sim']);
                            state.stats.depotRuns++;
                            state.lastActionNote = 'Sacrifício concluído';
                            await sleep(randomDelay(300, 450));
                        }

                        const native = readNativeSessionPanel();
                        const boostOn = Boolean(native?.boosts?.sacrificio);
                        const claimBtn = document.getElementById('sac-resgatar');
                        if (claimBtn && isInteractable(claimBtn) && (!boostOn || force)) {
                            claimBtn.click();
                            await confirmModalDialog(['confirmar', 'resgatar', 'sim']);
                            state.lastActionNote = 'Boost +20% XP resgatado!';
                        }
                    }
                } finally {
                    await closeActiveModal();
                }
            },
            { force }
        );
    };
