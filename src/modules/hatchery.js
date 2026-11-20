// Auto-Chocadeira: abre o bolso da chocadeira, recolhe ovos prontos e põe um ovo novo no slot livre.
// Comportamento idêntico ao da v6.5; só mudou de lugar.
import { normalizeText } from './pure.js';
import { openBackpackPocket } from './depot.js';

const EGG_PRIORITY_KEYWORDS = ['ovo shiny', 'shiny', 'p4', 'p3', 'p2', 'mystery egg'];

const SEL_LOCAL = {
    slotButtons: '.chc-slot button',
    release: 'chc-liberar', // classe do botão "liberar" (nunca clicar)
    freeSlot: '.chc-slot.livre',
    slots: '.chc-slot',
};

export const checkIncubator = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, dom, sleep, randomDelay, withModalLock } = ctx;
    if (!CONFIG.incubator.enabled && !force) return;
    if (!force && Date.now() < state.nextIncubatorCheckAt) return;

    await withModalLock(
        'Chocadeira',
        async () => {
            let hasActiveOrEgg = false;
            try {
                const corpo = await openBackpackPocket(ctx, 'chocadeira');
                if (!corpo) return;

                const readyBtns = Array.from(corpo.querySelectorAll(SEL_LOCAL.slotButtons)).filter((b) => {
                    if (!dom.isInteractable(b) || b.classList.contains(SEL_LOCAL.release)) return false;
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

                const freeSlot = corpo.querySelector(SEL_LOCAL.freeSlot);
                if (freeSlot) {
                    const slotBtns = Array.from(freeSlot.querySelectorAll('button')).filter(
                        (b) => dom.isInteractable(b) && !b.classList.contains(SEL_LOCAL.release)
                    );
                    if (slotBtns.length > 0) {
                        let chosenBtn = null;
                        for (const kw of EGG_PRIORITY_KEYWORDS) {
                            chosenBtn = slotBtns.find((b) => normalizeText(b.textContent).includes(kw));
                            if (chosenBtn) break;
                        }
                        chosenBtn = chosenBtn || slotBtns[0];
                        chosenBtn.click();
                        await dom.confirmModalDialog(['confirmar', 'colocar', 'incubar', 'sim']);
                        state.stats.eggsHandled++;
                        state.lastActionNote = `Ovo incubado: ${chosenBtn.textContent.trim().slice(0, 24)}`;
                        hasActiveOrEgg = true;
                    }
                }

                const occupied = Array.from(corpo.querySelectorAll(SEL_LOCAL.slots)).some(
                    (s) => !s.classList.contains('livre') && !s.classList.contains('trancado')
                );
                if (occupied) hasActiveOrEgg = true;
            } finally {
                state.nextIncubatorCheckAt =
                    Date.now() + (hasActiveOrEgg ? CONFIG.incubator.activeIntervalMs : CONFIG.incubator.emptyBackoffMs);
                await dom.closeActiveModal();
            }
        },
        { force }
    );
};

export const hatchery = {
    id: 'hatchery',
    everyMs: 15000,
    tick: (ctx) => checkIncubator(ctx, { force: false }),
    check: checkIncubator,
};
