    // --- Ficha para o Hub ---
    // A ficha que o Hub lê é a MESMA que o jogo gera no botão "Copiar p/ ChatGPT" (#fi-gpt, dentro do modal #ficha-corpo).
    // O bot abre a ficha do Pokémon ativo, aciona esse botão, confere o texto copiado e fecha o modal.
    const SHEET_BTN_ID = 'fi-gpt';
    const SHEET_CLOSE_ID = 'ficha-fechar';

    const closeSheetModal = async () => {
        const closeBtn = document.getElementById(SHEET_CLOSE_ID);
        if (closeBtn && isInteractable(closeBtn)) {
            closeBtn.click();
            await waitFor(() => !document.getElementById(SHEET_BTN_ID) || !isInteractable(document.getElementById(SHEET_BTN_ID)), 1400);
            await sleep(randomDelay(120, 200));
        } else {
            await closeActiveModal();
        }
    };

    // Retorna { ok, text, reason }. Não depende de clipboard.readText (exige permissão): intercepta o writeText do próprio jogo.
    const copyNativeSheet = async () => {
        const card = document.getElementById('ativo-card');
        if (!card) return { ok: false, reason: 'Pokémon ativo não encontrado' };

        const clip = navigator.clipboard;
        const originalWrite = clip && typeof clip.writeText === 'function' ? clip.writeText.bind(clip) : null;
        const hadOwnWrite = Boolean(clip) && Object.prototype.hasOwnProperty.call(clip, 'writeText');
        let captured = null;
        let hooked = false;
        if (originalWrite) {
            try {
                clip.writeText = (t) => {
                    captured = String(t ?? '');
                    return originalWrite(t);
                };
                hooked = true;
            } catch {
                // clipboard não permite sobrescrever: segue sem conferir o texto
            }
        }

        try {
            let btn = document.getElementById(SHEET_BTN_ID);
            if (!btn || !isInteractable(btn)) {
                card.click();
                btn = await waitFor(() => {
                    const el = document.getElementById(SHEET_BTN_ID);
                    return el && isInteractable(el) ? el : null;
                }, 2500);
            }
            if (!btn) return { ok: false, reason: 'Botão "Copiar p/ ChatGPT" não apareceu' };

            btn.click();
            if (hooked) await waitFor(() => captured, 1500);
            else await sleep(300);

            const valid = hooked ? looksLikeSheet(captured) : true;
            return valid
                ? { ok: true, text: captured, reason: '' }
                : { ok: false, text: captured, reason: 'O jogo não copiou a ficha (clipboard bloqueado?)' };
        } finally {
            if (hooked) {
                try {
                    // No navegador writeText vem do protótipo: apagar a cópia própria restaura o original
                    if (hadOwnWrite) clip.writeText = originalWrite;
                    else delete clip.writeText;
                } catch {
                    // restaurado no próximo reload
                }
            }
            await closeSheetModal();
        }
    };

    const copyActiveSheet = async ({ openSite = false } = {}) => {
        const res = await withModalLock('Copiando ficha', copyNativeSheet, { force: true });
        if (!res) {
            state.lastActionNote = 'Ficha: bot ocupado, tente de novo';
        } else if (res.ok) {
            const size = res.text ? ` (${res.text.length} car.)` : '';
            state.lastActionNote = openSite ? `Ficha copiada${size} — cole no Hub` : `Ficha copiada${size}!`;
            if (openSite) window.open(HUNT_GUIDE_URL, '_blank', 'noopener,noreferrer');
        } else {
            state.lastActionNote = `Ficha: ${res.reason}`;
        }
        updateHud();
        return res?.text ?? null;
    };

    // Nome antigo da API (v6.2/v6.3)
    const copiarFichaHunt = (abrirSite = false) => copyActiveSheet({ openSite: abrirSite });
