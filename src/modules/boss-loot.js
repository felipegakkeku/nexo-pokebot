// Bosses + Auto-Loot. Dois módulos no mesmo arquivo porque têm períodos diferentes:
//   bosses   (60 s)  -> abre a lista de bosses e entra no primeiro que bate com CONFIG.boss.priority
//   bossLoot (3 s)   -> clica em "OK" na tela de loot do boss
// Comportamento idêntico ao da v6.5; só mudou de lugar.
import { normalizeText } from './pure.js';

const SEL_LOCAL = {
    lootOk: '#boss-loot-ok',
    bossList: '#boss-lista',
    bossItems: 'button.boss-item:not([data-key="@raid"])',
    modalBody: '#modal-corpo',
    challengeBtn: 'button.boss-desafiar',
    bossName: '.boss-nome',
};

export const dismissBossLoot = ({ CONFIG, state, dom }) => {
    if (!state.running || !CONFIG.boss.autoDismissLoot) return;
    const okBtn = dom.$(SEL_LOCAL.lootOk);
    if (okBtn && dom.isInteractable(okBtn)) {
        okBtn.click();
        state.lastActionNote = 'Loot de Boss coletado!';
    }
};

export const bossMatchesPriority = (detailEl, priority) => {
    if (priority === 'qualquer') return true;
    const html = (detailEl?.innerHTML || '').toLowerCase();
    const txt = normalizeText(detailEl?.textContent || '');
    if (priority === 'mega') return html.includes('fragmento-mega') || txt.includes('mega');
    if (priority === 'tm') return html.includes('tm_disk') || html.includes('zmove') || txt.includes('tm ');
    if (priority === 'tickets') return html.includes('mystic-ticket') || html.includes('safari-ticket') || txt.includes('ticket');
    return true;
};

export const checkBosses = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, dom, sleep, randomDelay, withModalLock } = ctx;
    const prio = CONFIG.boss.priority;
    if (prio === 'off' && !force) return;
    if (!force && Date.now() - state.lastBossCheckAt < CONFIG.boss.checkIntervalMs) return;

    await withModalLock(
        'Bosses',
        async () => {
            state.lastBossCheckAt = Date.now();
            let entered = false;
            try {
                if (dom.getVisibleModal()) await dom.closeActiveModal();
                const bossBtn = dom.findMenuButtonByImg('boss-cabeca') || dom.findMenuButtonByImg('menu-bosses');
                if (!bossBtn) return;
                bossBtn.click();

                const listEl = await dom.waitFor(() => dom.$(SEL_LOCAL.bossList), 3500);
                if (!listEl) return;
                await sleep(randomDelay(240, 380));

                const items = Array.from(listEl.querySelectorAll(SEL_LOCAL.bossItems)).filter(dom.isInteractable);
                for (const item of items) {
                    if (!state.running) break;
                    item.click();
                    await sleep(randomDelay(220, 340));

                    const modalBody = dom.$(SEL_LOCAL.modalBody);
                    const challengeBtn = modalBody?.querySelector(SEL_LOCAL.challengeBtn);
                    if (!challengeBtn || challengeBtn.disabled || !dom.isInteractable(challengeBtn)) continue;

                    if (!bossMatchesPriority(modalBody, prio === 'off' ? 'qualquer' : prio)) continue;

                    const bossName = modalBody.querySelector(SEL_LOCAL.bossName)?.textContent?.trim() || 'Boss';
                    challengeBtn.click();
                    await dom.confirmModalDialog(['desafiar', 'entrar', 'confirmar', 'sim']);
                    state.stats.bossEntries++;
                    state.lastActionNote = `Entrou no Boss: ${bossName}`;
                    entered = true;
                    break;
                }

                if (!entered) {
                    state.lastActionNote = `Bosses (${prio}): nenhum disponível agora`;
                }
            } finally {
                if (!entered) await dom.closeActiveModal();
            }
        },
        { force }
    );
};

export const bosses = {
    id: 'bosses',
    everyMs: 60000,
    tick: (ctx) => checkBosses(ctx, { force: false }),
    check: checkBosses,
};

export const bossLoot = {
    id: 'bossLoot',
    everyMs: 3000,
    tick: (ctx) => dismissBossLoot(ctx),
    dismiss: dismissBossLoot,
};
