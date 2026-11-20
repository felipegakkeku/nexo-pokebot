    // --- 5. Auto-Chocadeira ---
    const EGG_PRIORITY_KEYWORDS = ['ovo shiny', 'shiny', 'p4', 'p3', 'p2', 'mystery egg'];

    const checkIncubator = async (force = false) => {
        if (!CONFIG.incubator.enabled && !force) return;
        if (!force && Date.now() < state.nextIncubatorCheckAt) return;

        await withModalLock(
            'Chocadeira',
            async () => {
                let hasActiveOrEgg = false;
                try {
                    const corpo = await openBackpackPocket('chocadeira');
                    if (!corpo) return;

                    const readyBtns = Array.from(corpo.querySelectorAll('.chc-slot button')).filter((b) => {
                        if (!isInteractable(b) || b.classList.contains('chc-liberar')) return false;
                        const t = normalizeText(b.textContent);
                        return t.includes('chocar') || t.includes('recolher') || t.includes('abrir') || t.includes('nascer');
                    });

                    for (const btn of readyBtns) {
                        btn.click();
                        state.stats.eggsHandled++;
                        state.lastActionNote = 'Ovo chocado!';
                        hasActiveOrEgg = true;
                        await sleep(randomDelay(400, 650));
                    }

                    const freeSlot = corpo.querySelector('.chc-slot.livre');
                    if (freeSlot) {
                        const slotBtns = Array.from(freeSlot.querySelectorAll('button')).filter(
                            (b) => isInteractable(b) && !b.classList.contains('chc-liberar')
                        );
                        if (slotBtns.length > 0) {
                            let chosenBtn = null;
                            for (const kw of EGG_PRIORITY_KEYWORDS) {
                                chosenBtn = slotBtns.find((b) => normalizeText(b.textContent).includes(kw));
                                if (chosenBtn) break;
                            }
                            chosenBtn = chosenBtn || slotBtns[0];
                            chosenBtn.click();
                            await confirmModalDialog(['confirmar', 'colocar', 'incubar', 'sim']);
                            state.stats.eggsHandled++;
                            state.lastActionNote = `Ovo incubado: ${chosenBtn.textContent.trim().slice(0, 24)}`;
                            hasActiveOrEgg = true;
                        }
                    }

                    const occupied = Array.from(corpo.querySelectorAll('.chc-slot')).some(
                        (s) => !s.classList.contains('livre') && !s.classList.contains('trancado')
                    );
                    if (occupied) hasActiveOrEgg = true;
                } finally {
                    state.nextIncubatorCheckAt =
                        Date.now() + (hasActiveOrEgg ? CONFIG.incubator.activeIntervalMs : CONFIG.incubator.emptyBackoffMs);
                    await closeActiveModal();
                }
            },
            { force }
        );
    };
