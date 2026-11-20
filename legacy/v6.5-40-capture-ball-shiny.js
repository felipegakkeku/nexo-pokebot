    // --- 1. Captura Automática em Fila (#caidos-lista) + Seleção Inteligente de Bola + Guardião de Shiny ---
    const isShinyCaidoButton = (btn) => {
        if (!btn) return false;
        const cls = (btn.className || '').toLowerCase();
        const txt = btn.textContent || '';
        return (
            cls.includes('shiny') ||
            btn.dataset.shiny === '1' ||
            btn.dataset.shiny === 'true' ||
            txt.includes('✨') ||
            normalizeText(txt).includes('shiny')
        );
    };

    const ensureBestBallSelected = (targetBtn) => {
        const container = document.getElementById('auto-ball-opts');
        if (!container) return;

        const chips = Array.from(container.querySelectorAll('.auto-chip'));
        if (chips.length === 0) return;

        const counts = chips.map((c) => parseNumber(c.querySelector('.q')?.textContent ?? c.textContent) ?? 0);
        const currentIdx = chips.findIndex((c) => c.classList.contains('on'));
        const isShiny = isShinyCaidoButton(targetBtn);

        let desiredIdx = currentIdx;

        if (isShiny) {
            for (const idx of [4, 3, 2, 1, 0]) {
                if (chips[idx] && counts[idx] > 0) {
                    desiredIdx = idx;
                    break;
                }
            }
        } else if (CONFIG.caidos.smartBallSelect) {
            const targetLv = parseNumber(targetBtn?.textContent) ?? getCurrentHunt()?.targetLevel ?? 1;
            const order =
                targetLv >= CONFIG.caidos.highLevelUltraThreshold
                    ? [3, 2, 1, 0]
                    : [0, 1, 2, 3];
            for (const idx of order) {
                if (chips[idx] && counts[idx] > 0) {
                    desiredIdx = idx;
                    break;
                }
            }
        } else if (currentIdx === -1 || counts[currentIdx] <= 0) {
            const firstAvailable = counts.findIndex((n) => n > 0);
            if (firstAvailable !== -1) desiredIdx = firstAvailable;
        }

        if (desiredIdx !== -1 && desiredIdx !== currentIdx && chips[desiredIdx] && isInteractable(chips[desiredIdx])) {
            chips[desiredIdx].click();
        }
    };

    const processCaidos = (container) => {
        if (!state.running || state.paused || !container) return;

        const allButtons = Array.from(container.querySelectorAll(CONFIG.caidos.buttonSelector)).filter(isInteractable);
        const shinyButtons = allButtons.filter(isShinyCaidoButton);

        if (shinyButtons.length > 0) {
            state.shinyAlertActive = true;
            shinyButtons.forEach((b) => {
                const slot = b.dataset.slot || b.textContent;
                if (!state.shinyNotifiedSlots.has(slot)) {
                    state.shinyNotifiedSlots.add(slot);
                    state.stats.shiniesSpotted++;
                    if (CONFIG.shinyGuard.soundAlert) playBeep(1180, 0.25);
                    state.lastActionNote = `✨ SHINY DETECTADO: ${(b.querySelector('.caido-quem')?.textContent || 'Alvo').trim()}`;
                    updateHud();
                }
            });
        } else {
            state.shinyAlertActive = false;
        }

        if (!CONFIG.caidos.enabled) return;
        if (state.modalLockOwner && !(CONFIG.shinyGuard.enabled && shinyButtons.length > 0)) return;
        if (state.throwPending) return;

        const inv = getInventorySnapshot();
        if (inv.totalBalls === 0) {
            smartRestock(false);
            return;
        }

        const now = Date.now();
        const ordered = shinyButtons.length > 0 ? [...shinyButtons, ...allButtons] : allButtons;
        const nextBtn = ordered.find((btn) => {
            const lastTry = parseInt(btn.dataset.pbTriedAt || '0', 10);
            const retryMs = isShinyCaidoButton(btn) ? 1400 : CONFIG.caidos.retryAfterMs;
            return now - lastTry >= retryMs;
        });

        if (!nextBtn) return;

        const elapsed = now - state.lastThrowAt;
        const baseWait = Math.max(0, CONFIG.caidos.minThrowIntervalMs - elapsed);
        const jitter = randomDelay(CONFIG.delays.clickMinMs, CONFIG.delays.clickMaxMs);

        state.throwPending = true;
        setTimeout(() => {
            window.requestAnimationFrame(() => {
                state.throwPending = false;
                if (!state.running || state.paused) return;
                if (state.modalLockOwner && !isShinyCaidoButton(nextBtn)) return;

                if (getInventorySnapshot().totalBalls === 0) {
                    smartRestock(false);
                    return;
                }

                if (isInteractable(nextBtn)) {
                    ensureBestBallSelected(nextBtn);
                    nextBtn.dataset.pbTriedAt = String(Date.now());
                    state.lastThrowAt = Date.now();
                    nextBtn.click();
                    state.stats.caidosClicked++;
                }

                if (state.observedCaidosNode) {
                    processCaidos(state.observedCaidosNode);
                }
            });
        }, baseWait + jitter);
    };

    const ensureCaidosObserver = () => {
        if (!state.running || state.paused) return;

        const targetNode = document.querySelector(CONFIG.caidos.containerSelector);
        if (targetNode !== state.observedCaidosNode) {
            if (state.caidosObserver) {
                state.caidosObserver.disconnect();
                state.caidosObserver = null;
                state.observedCaidosNode = null;
            }
            if (targetNode) {
                state.observedCaidosNode = targetNode;
                state.caidosObserver = new MutationObserver(() => processCaidos(targetNode));
                state.caidosObserver.observe(targetNode, { childList: true });
            }
        }

        if (state.observedCaidosNode) {
            processCaidos(state.observedCaidosNode);
        }
    };
