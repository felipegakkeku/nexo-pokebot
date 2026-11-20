    // --- 3. Auto-Passe Diário ---
    const checkDailyPass = async (force = false) => {
        if (!CONFIG.dailyPass.enabled && !force) return;
        const { level } = getTrainerHeaderInfo();
        if (!force && level !== null && level < 10) return;

        const nextAllowedMs = parseInt(localStorage.getItem(STORAGE_PASS_NEXT_KEY) || '0', 10);
        if (!force && nextAllowedMs > Date.now()) return;

        await withModalLock(
            'Passe',
            async () => {
                if (getVisibleModal()) await closeActiveModal();
                const passBtn = findMenuButtonByImg('passe-') || findClickableByText('Passe');
                if (!passBtn) return;

                passBtn.click();
                const resgatarBtn = await waitFor(() => document.querySelector('button.ps-resgatar'), 3500);
                if (!resgatarBtn) {
                    await closeActiveModal();
                    return;
                }
                await sleep(randomDelay(220, 360));

                if (!resgatarBtn.disabled && isInteractable(resgatarBtn)) {
                    resgatarBtn.click();
                    state.stats.passClaims++;
                    state.lastActionNote = 'Passe Diário resgatado!';
                    await sleep(randomDelay(450, 700));
                }

                const updatedBtn = document.querySelector('button.ps-resgatar');
                const nextTs = parseInt(updatedBtn?.querySelector('b[data-ps-relogio]')?.getAttribute('data-ps-relogio') || '0', 10);
                if (nextTs > Date.now()) {
                    localStorage.setItem(STORAGE_PASS_NEXT_KEY, String(nextTs + 5000));
                    if (resgatarBtn.disabled) {
                        state.lastActionNote = `Passe já resgatado (${updatedBtn.textContent.trim()})`;
                    }
                } else {
                    localStorage.setItem(STORAGE_PASS_NEXT_KEY, String(Date.now() + 3600000));
                }

                await closeActiveModal();
            },
            { force }
        );
    };
