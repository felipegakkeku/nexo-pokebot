    // --- 2. Restock ---
    const getVisibleMarketCards = () =>
        Array.from(document.querySelectorAll('#mk-corpo .mk-card')).filter(isInteractable);

    const isMarketOpen = () => Boolean(document.getElementById('mk-modos') && isVisible(document.getElementById('mk-modos')));

    const findMarketCard = (itemName) => {
        const target = normalizeText(itemName);
        return (
            getVisibleMarketCards().find((card) => {
                const nameEl = card.querySelector('.mk-nome');
                return nameEl && normalizeText(nameEl.textContent) === target;
            }) ||
            getVisibleMarketCards().find((card) => {
                const nameEl = card.querySelector('.mk-nome');
                return nameEl && normalizeText(nameEl.textContent).includes(target);
            }) ||
            null
        );
    };

    const findCardBuyButton = (card) => {
        if (!card) return null;
        return (
            Array.from(card.querySelectorAll('button')).find(
                (btn) => normalizeText(btn.textContent).includes('comprar') && isInteractable(btn)
            ) || null
        );
    };

    const selectBatchShortcut = async (card, batchLabel) => {
        if (!card || !batchLabel) return;
        const target = normalizeText(batchLabel).replace('×', 'x');
        const shortcutBtn = Array.from(card.querySelectorAll('.mk-atalhos button')).find((btn) => {
            const txt = normalizeText(btn.textContent).replace('×', 'x');
            return txt === target && isInteractable(btn);
        });
        if (shortcutBtn) {
            shortcutBtn.click();
            await sleep(randomDelay(120, 220));
        }
    };

    const ensureMarketTab = async (abaKey) => {
        const tab = document.querySelector(`#mk-modos .cmp-op[data-aba="${abaKey}"]`);
        if (tab && !tab.classList.contains('on') && isInteractable(tab)) {
            tab.click();
            await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
        }
    };

    const switchMarketCategory = async (categoryName) => {
        const target = normalizeText(categoryName);
        const catBtn = Array.from(document.querySelectorAll('#mk-corpo .mk-lado button.mk-cat')).find((btn) => {
            if (!isInteractable(btn)) return false;
            const txt = normalizeText(btn.querySelector('.mk-cat-txt')?.textContent || btn.textContent);
            return txt.startsWith(target) || txt === target;
        });
        if (catBtn && !catBtn.classList.contains('on')) {
            catBtn.click();
            await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
        }
    };

    const smartRestock = async (force = false) => {
        if (!CONFIG.restock.enabled && !force) return;

        const ballTier = getTargetBallTier();
        const inv = getInventorySnapshot();
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
                    if (!isMarketOpen()) {
                        if (getVisibleModal()) await closeActiveModal();
                        const marketBtn = findMenuButtonByImg('menu-market') || findClickableByText('Market');
                        if (!marketBtn) return;
                        marketBtn.click();
                        openedByBot = true;
                        const loaded = await waitFor(isMarketOpen, 3500);
                        if (!loaded) return;
                        await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
                    }

                    await ensureMarketTab('compra');

                    for (const item of toBuy) {
                        if (!state.running) break;

                        let card = findMarketCard(item.itemName);
                        if (!card) {
                            await switchMarketCategory(item.categoryName);
                            card = await waitFor(() => findMarketCard(item.itemName), 2800);
                        }
                        if (!card) continue;

                        for (let i = 0; i < CONFIG.restock.maxPurchases; i++) {
                            if (!state.running) break;
                            const currCard = findMarketCard(item.itemName);
                            if (!currCard) break;

                            const countBefore = parseNumber(currCard.querySelector('.mk-tem')?.textContent);
                            if (countBefore !== null && countBefore >= item.targetAmount) break;

                            await selectBatchShortcut(currCard, CONFIG.restock.batchButton);
                            const buyBtn = findCardBuyButton(currCard);
                            if (!buyBtn) break;

                            buyBtn.click();
                            state.stats.purchases++;

                            const countAfter = await waitFor(() => {
                                const upd = findMarketCard(item.itemName);
                                const val = parseNumber(upd?.querySelector('.mk-tem')?.textContent);
                                return val !== null && countBefore !== null && val > countBefore ? val : null;
                            }, CONFIG.restock.buyConfirmTimeoutMs, 100);

                            if (countAfter === null) break;
                            state.lastActionNote = `${item.itemName}: ${countAfter}`;
                            await sleep(randomDelay(160, 280));
                        }
                    }
                } finally {
                    if (openedByBot && CONFIG.restock.closeMarketAfter && state.running) {
                        await closeActiveModal();
                    }
                }
            },
            { force }
        );
    };
