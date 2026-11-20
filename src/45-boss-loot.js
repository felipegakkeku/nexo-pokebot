    // --- 6. Bosses + Auto-Loot ---
    const dismissBossLoot = () => {
        if (!state.running || !CONFIG.boss.autoDismissLoot) return;
        const okBtn = document.getElementById('boss-loot-ok');
        if (okBtn && isInteractable(okBtn)) {
            okBtn.click();
            state.lastActionNote = 'Loot de Boss coletado!';
        }
    };

    const bossMatchesPriority = (detailEl, priority) => {
        if (priority === 'qualquer') return true;
        const html = (detailEl?.innerHTML || '').toLowerCase();
        const txt = normalizeText(detailEl?.textContent || '');
        if (priority === 'mega') return html.includes('fragmento-mega') || txt.includes('mega');
        if (priority === 'tm') return html.includes('tm_disk') || html.includes('zmove') || txt.includes('tm ');
        if (priority === 'tickets') return html.includes('mystic-ticket') || html.includes('safari-ticket') || txt.includes('ticket');
        return true;
    };

    const checkBosses = async (force = false) => {
        const prio = CONFIG.boss.priority;
        if (prio === 'off' && !force) return;
        if (!force && Date.now() - state.lastBossCheckAt < CONFIG.boss.checkIntervalMs) return;

        await withModalLock(
            'Bosses',
            async () => {
                state.lastBossCheckAt = Date.now();
                let entered = false;
                try {
                    if (getVisibleModal()) await closeActiveModal();
                    const bossBtn = findMenuButtonByImg('boss-cabeca') || findMenuButtonByImg('menu-bosses');
                    if (!bossBtn) return;
                    bossBtn.click();

                    const listEl = await waitFor(() => document.getElementById('boss-lista'), 3500);
                    if (!listEl) return;
                    await sleep(randomDelay(240, 380));

                    const items = Array.from(listEl.querySelectorAll('button.boss-item:not([data-key="@raid"])')).filter(isInteractable);
                    for (const item of items) {
                        if (!state.running) break;
                        item.click();
                        await sleep(randomDelay(220, 340));

                        const modalBody = document.getElementById('modal-corpo');
                        const challengeBtn = modalBody?.querySelector('button.boss-desafiar');
                        if (!challengeBtn || challengeBtn.disabled || !isInteractable(challengeBtn)) continue;

                        if (!bossMatchesPriority(modalBody, prio === 'off' ? 'qualquer' : prio)) continue;

                        const bossName = modalBody.querySelector('.boss-nome')?.textContent?.trim() || 'Boss';
                        challengeBtn.click();
                        await confirmModalDialog(['desafiar', 'entrar', 'confirmar', 'sim']);
                        state.stats.bossEntries++;
                        state.lastActionNote = `Entrou no Boss: ${bossName}`;
                        entered = true;
                        break;
                    }

                    if (!entered) {
                        state.lastActionNote = `Bosses (${prio}): nenhum disponível agora`;
                    }
                } finally {
                    if (!entered) await closeActiveModal();
                }
            },
            { force }
        );
    };
