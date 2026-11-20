    // --- 8. Auto-Evoluir ---
    // O botão #btn-evoluir fica sempre clicável, então não diz se dá para evoluir. Quem diz é a confirmação do jogo,
    // que lista os requisitos em linhas ".dlg-req" (classe "falta" quando não atendido: nível mínimo, pedra na mochila).
    // Fluxo: abre a confirmação, lê os requisitos, confirma só se todos estiverem ok; senão cancela e espera
    // CONFIG.evolve.recheckMs antes de olhar de novo.
    const readEvolveRequirements = () => {
        const confirmBtn = document.getElementById('confirmar-sim');
        const dialog = confirmBtn?.closest('.modal-caixa') || getVisibleModal();
        if (!dialog) return [];
        return Array.from(dialog.querySelectorAll('.dlg-req')).map((row) => ({
            ok: !row.classList.contains('falta'),
            text: (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim(),
        }));
    };

    const dismissEvolveDialog = async () => {
        const cancel = document.getElementById('confirmar-nao');
        if (cancel && isInteractable(cancel)) {
            cancel.click();
            await waitFor(() => !document.getElementById('confirmar-sim') || !isInteractable(document.getElementById('confirmar-sim')), 1500);
        }
        if (getVisibleModal()) await closeActiveModal();
    };

    const autoEvolveCheck = async () => {
        if (!state.running || state.paused || !CONFIG.evolve.enabled) return;
        if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return;
        if (state.modalLockOwner || getVisibleModal() || isInSpecialArena()) return;
        if (Date.now() < state.evolveNextAt) return;

        const evolveBtn = document.getElementById('btn-evoluir');
        if (!evolveBtn || !isInteractable(evolveBtn)) return;

        // Eevee tem vários destinos: a escolha é do jogador
        if (normalizeText(getActivePokemon()?.name) === 'eevee') {
            state.evolveNextAt = Date.now() + CONFIG.evolve.recheckMs;
            return;
        }

        await withModalLock('Evoluindo', async () => {
            state.evolveNextAt = Date.now() + CONFIG.evolve.recheckMs;
            evolveBtn.click();

            const confirmBtn = await waitFor(() => {
                const btn = document.getElementById('confirmar-sim');
                return btn && isInteractable(btn) ? btn : null;
            }, 2500);
            if (!confirmBtn) {
                state.lastActionNote = 'Evolução: confirmação não abriu';
                if (getVisibleModal()) await closeActiveModal();
                updateHud();
                return;
            }

            const verdict = evaluateEvolveRequirements(readEvolveRequirements());
            if (!verdict.ok) {
                await dismissEvolveDialog();
                state.lastActionNote = `Evolução adiada: ${verdict.reason}`;
                updateHud();
                return;
            }

            confirmBtn.click();
            await sleep(randomDelay(260, 420));
            state.evolveNextAt = Date.now() + CONFIG.evolve.cooldownMs;
            state.lastActionNote = 'Pokémon evoluído!';
            updateHud();
        });
    };
