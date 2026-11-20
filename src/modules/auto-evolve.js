// Auto-Evoluir. O botão #btn-evoluir fica sempre clicável, então não diz se dá para evoluir; quem diz é a
// confirmação do jogo, que lista os requisitos em linhas ".dlg-req" (classe "falta" quando não atendido:
// nível mínimo, pedra na mochila). Fluxo: abre a confirmação, lê os requisitos, confirma só se todos estiverem
// ok; senão cancela e espera CONFIG.evolve.recheckMs antes de olhar de novo.
import { SEL } from './selectors.js';
import { normalizeText } from './text.js';

// Decide se vale confirmar a partir das linhas de requisito: [{ ok: boolean, text: string }].
// Sem requisito legível, sem confirmar (melhor não evoluir do que gastar pedra sem querer).
export const evaluateEvolveRequirements = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) return { ok: false, reason: 'requisitos não encontrados' };
    if (list.some((r) => /shiny/.test(normalizeText(r.text)))) {
        return { ok: false, reason: 'exige Shiny Stone (ignorado)' };
    }
    const missing = list.filter((r) => !r.ok);
    if (missing.length > 0) {
        return { ok: false, reason: `falta ${missing.map((r) => r.text).join(' + ')}` };
    }
    return { ok: true, reason: '' };
};

const readRequirements = ({ dom }) => {
    const dialog = dom.$(SEL.confirmarSim)?.closest('.modal-caixa') || dom.getVisibleModal();
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll(SEL.dlgReq)).map((row) => ({
        ok: !row.classList.contains('falta'),
        text: (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
};

const dismissDialog = async ({ dom }) => {
    const cancel = dom.$(SEL.confirmarNao);
    if (cancel && dom.isInteractable(cancel)) {
        cancel.click();
        await dom.waitFor(() => {
            const sim = dom.$(SEL.confirmarSim);
            return !sim || !dom.isInteractable(sim);
        }, 1500);
    }
    if (dom.getVisibleModal()) await dom.closeActiveModal();
};

const tick = async (ctx) => {
    const { CONFIG, state, dom, sleep, randomDelay, withModalLock, updateHud } = ctx;
    if (!state.running || state.paused || !CONFIG.evolve.enabled) return;
    if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return;
    if (state.modalLockOwner || dom.getVisibleModal() || dom.isInSpecialArena()) return;
    if (Date.now() < state.evolveNextAt) return;

    const evolveBtn = dom.$(SEL.btnEvoluir);
    if (!evolveBtn || !dom.isInteractable(evolveBtn)) return;

    // Eevee tem vários destinos: a escolha é do jogador
    if (normalizeText(dom.getActivePokemon()?.name) === 'eevee') {
        state.evolveNextAt = Date.now() + CONFIG.evolve.recheckMs;
        return;
    }

    await withModalLock('Evoluindo', async () => {
        state.evolveNextAt = Date.now() + CONFIG.evolve.recheckMs;
        evolveBtn.click();

        const confirmBtn = await dom.waitFor(() => {
            const btn = dom.$(SEL.confirmarSim);
            return btn && dom.isInteractable(btn) ? btn : null;
        }, 2500);
        if (!confirmBtn) {
            state.lastActionNote = 'Evolução: confirmação não abriu';
            if (dom.getVisibleModal()) await dom.closeActiveModal();
            updateHud();
            return;
        }

        const verdict = evaluateEvolveRequirements(readRequirements(ctx));
        if (!verdict.ok) {
            await dismissDialog(ctx);
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

export const autoEvolve = {
    id: 'autoEvolve',
    everyMs: (ctx) => ctx.CONFIG.evolve.checkIntervalMs,
    tick,
};
