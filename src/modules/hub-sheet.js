// Ficha para o Hub: a ficha que o Hub lê é a MESMA que o jogo gera no botão "Copiar p/ ChatGPT" (#fi-gpt, dentro
// do modal da ficha). O bot abre a ficha do Pokémon ativo, aciona esse botão, confere o texto copiado e fecha o modal.
// Não depende de clipboard.readText (exige permissão): intercepta o writeText do próprio jogo.
// Comportamento idêntico ao da v6.5.
import { looksLikeSheet } from './pure.js';
import { SEL } from './selectors.js';

// --- Funções puras ---

// Resultado da tentativa de copiar: sem gancho no clipboard não dá para conferir o texto (aceita); com gancho, precisa parecer ficha
export const evaluateSheetCopy = ({ hooked, captured }) => {
    const valid = hooked ? looksLikeSheet(captured) : true;
    return valid
        ? { ok: true, text: captured, reason: '' }
        : { ok: false, text: captured, reason: 'O jogo não copiou a ficha (clipboard bloqueado?)' };
};

// Texto que o HUD mostra depois da tentativa
export const describeSheetResult = (res, openSite = false) => {
    if (!res) return 'Ficha: bot ocupado, tente de novo';
    if (res.ok) {
        const size = res.text ? ` (${res.text.length} car.)` : '';
        return openSite ? `Ficha copiada${size} — cole no Hub` : `Ficha copiada${size}!`;
    }
    return `Ficha: ${res.reason}`;
};

// --- Funções com ctx ---

export const closeSheetModal = async ({ dom, sleep, randomDelay }) => {
    const closeBtn = dom.$(SEL.fichaFechar);
    if (closeBtn && dom.isInteractable(closeBtn)) {
        closeBtn.click();
        await dom.waitFor(() => !dom.$(SEL.fichaGpt) || !dom.isInteractable(dom.$(SEL.fichaGpt)), 1400);
        await sleep(randomDelay(120, 200));
    } else {
        await dom.closeActiveModal();
    }
};

// Retorna { ok, text, reason }
export const copyNativeSheet = async (ctx) => {
    const { dom, sleep } = ctx;
    const card = dom.$(SEL.ativoCard);
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
        let btn = dom.$(SEL.fichaGpt);
        if (!btn || !dom.isInteractable(btn)) {
            card.click();
            btn = await dom.waitFor(() => {
                const el = dom.$(SEL.fichaGpt);
                return el && dom.isInteractable(el) ? el : null;
            }, 2500);
        }
        if (!btn) return { ok: false, reason: 'Botão "Copiar p/ ChatGPT" não apareceu' };

        btn.click();
        if (hooked) await dom.waitFor(() => captured, 1500);
        else await sleep(300);

        return evaluateSheetCopy({ hooked, captured });
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
        await closeSheetModal(ctx);
    }
};

export const copyActiveSheet = async (ctx, { openSite = false } = {}) => {
    const { state, updateHud, withModalLock, consts } = ctx;
    const res = await withModalLock('Copiando ficha', () => copyNativeSheet(ctx), { force: true });
    state.lastActionNote = describeSheetResult(res, openSite);
    if (res?.ok && openSite) window.open(consts.HUNT_GUIDE_URL, '_blank', 'noopener,noreferrer');
    updateHud();
    return res?.text ?? null;
};

// Nome antigo da API (v6.2/v6.3)
export const copiarFichaHunt = (ctx, abrirSite = false) => copyActiveSheet(ctx, { openSite: abrirSite });

export const hubSheet = {
    id: 'hubSheet',
    copyActiveSheet,
    copiarFichaHunt,
};
