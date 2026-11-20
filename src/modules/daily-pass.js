// Auto-Passe Diário: abre o Passe, resgata se estiver liberado e guarda quando tentar de novo.
// Comportamento idêntico ao da v6.5 (mesma chave de storage, mesmos tempos); só mudou de lugar.
import { SEL } from './selectors.js';

const claim = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, dom, storage, keys, sleep, randomDelay, withModalLock } = ctx;
    if (!CONFIG.dailyPass.enabled && !force) return;

    const { level } = dom.getTrainerHeaderInfo();
    if (!force && level !== null && level < 10) return;

    const nextAllowedMs = parseInt(storage.get(keys.passNext) || '0', 10);
    if (!force && nextAllowedMs > Date.now()) return;

    await withModalLock(
        'Passe',
        async () => {
            if (dom.getVisibleModal()) await dom.closeActiveModal();
            const passBtn = dom.findMenuButtonByImg('passe-') || dom.findClickableByText('Passe');
            if (!passBtn) return;

            passBtn.click();
            const resgatarBtn = await dom.waitFor(() => dom.$(SEL.passResgatar), 3500);
            if (!resgatarBtn) {
                await dom.closeActiveModal();
                return;
            }
            await sleep(randomDelay(220, 360));

            if (!resgatarBtn.disabled && dom.isInteractable(resgatarBtn)) {
                resgatarBtn.click();
                state.stats.passClaims++;
                state.lastActionNote = 'Passe Diário resgatado!';
                await sleep(randomDelay(450, 700));
            }

            const updatedBtn = dom.$(SEL.passResgatar);
            const nextTs = parseInt(updatedBtn?.querySelector(SEL.passRelogio)?.getAttribute('data-ps-relogio') || '0', 10);
            if (nextTs > Date.now()) {
                storage.set(keys.passNext, String(nextTs + 5000));
                if (resgatarBtn.disabled) {
                    state.lastActionNote = `Passe já resgatado (${updatedBtn.textContent.trim()})`;
                }
            } else {
                storage.set(keys.passNext, String(Date.now() + 3600000));
            }

            await dom.closeActiveModal();
        },
        { force }
    );
};

export const dailyPass = {
    id: 'dailyPass',
    everyMs: (ctx) => ctx.CONFIG.dailyPass.checkIntervalMs,
    tick: (ctx) => claim(ctx, { force: false }),
    claim,
};
