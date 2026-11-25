// Captura automática em fila (#caidos-lista) + seleção inteligente de bola + Guardião de Shiny.
// Comportamento idêntico ao da v6.5; só mudou de lugar. Não é periódico por natureza: um MutationObserver
// em #caidos-lista dispara processCaidos; o tick só religa o observer se o nó do jogo foi trocado.
import { normalizeText, parseNumber } from './pure.js';
import { smartRestock } from './restock.js';

const SEL_LOCAL = {
    ballOpts: '#auto-ball-opts',
    ballChip: '.auto-chip',
    chipQty: '.q',
    caidosBallsHost: '#caidos-bolas',
    caidosBallBtn: 'button.caidos-bola',
    caidoWho: '.caido-quem',
};

const BALL_INDEX_BY_KEY = { poke: 0, great: 1, super: 2, ultra: 3, beast: 4 };
const BALL_MATCHERS = [
    { idx: 0, key: 'poke', token: 'poke ball', img: 'ball-poke' },
    { idx: 1, key: 'great', token: 'great ball', img: 'ball-great' },
    { idx: 2, key: 'super', token: 'super ball', img: 'ball-super' },
    { idx: 3, key: 'ultra', token: 'ultra ball', img: 'ball-ultra' },
    { idx: 4, key: 'beast', token: 'beast ball', img: 'ball-beast' },
];

export const resolveDesiredBallOrder = (CONFIG, { isShiny = false, targetLv = 1 } = {}) => {
    const caidosCfg = CONFIG?.caidos || {};
    if (isShiny) {
        const base = [4, 3, 2, 1, 0];
        const pref = BALL_INDEX_BY_KEY[caidosCfg.shinyBall];
        return pref !== undefined ? [pref, ...base.filter((i) => i !== pref)] : base;
    }

    const pref = BALL_INDEX_BY_KEY[caidosCfg.preferredBall];
    if (pref !== undefined) {
        const fallback = [0, 1, 2, 3, 4];
        return [pref, ...fallback.filter((i) => i !== pref)];
    }

    if (caidosCfg.smartBallSelect) {
        return targetLv >= (caidosCfg.highLevelUltraThreshold ?? 20)
            ? [3, 2, 1, 0]
            : [0, 1, 2, 3];
    }

    return null;
};

const detectBallIndexFromBtn = (btn) => {
    if (!btn) return null;
    const title = normalizeText(btn.getAttribute?.('title') ?? btn.title ?? '');
    const imgSrc = normalizeText(btn.querySelector?.('img')?.getAttribute?.('src') ?? '');
    const matched = BALL_MATCHERS.find((m) => title.includes(m.token) || imgSrc.includes(m.img));
    return matched ? matched.idx : null;
};

const syncCaidosBallHost = (ctx, order, preferredIdx) => {
    const { dom } = ctx;
    const host = dom.$(SEL_LOCAL.caidosBallsHost);
    if (!host) return;
    const btns = Array.from(host.querySelectorAll(SEL_LOCAL.caidosBallBtn));
    if (btns.length === 0) return;

    const byIdx = new Map();
    btns.forEach((btn, pos) => {
        const idx = detectBallIndexFromBtn(btn) ?? pos;
        byIdx.set(idx, btn);
    });

    let targetBtn = preferredIdx !== -1 && preferredIdx !== null ? byIdx.get(preferredIdx) : null;
    if (!targetBtn && Array.isArray(order)) {
        for (const idx of order) {
            if (byIdx.has(idx)) {
                targetBtn = byIdx.get(idx);
                break;
            }
        }
    }
    if (!targetBtn && !btns.some((b) => b.classList?.contains?.('on'))) {
        targetBtn = btns[0];
    }

    if (targetBtn && !targetBtn.classList?.contains?.('on') && dom.isInteractable(targetBtn)) {
        targetBtn.click();
    }
};

export const isShinyCaidoButton = (btn) => {
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

export const ensureBestBallSelected = (ctx, targetBtn) => {
    const { CONFIG, dom } = ctx;
    const isShiny = isShinyCaidoButton(targetBtn);
    const targetLv = parseNumber(targetBtn?.textContent) ?? dom.getCurrentHunt()?.targetLevel ?? 1;
    const order = resolveDesiredBallOrder(CONFIG, { isShiny, targetLv });

    const container = dom.$(SEL_LOCAL.ballOpts);
    const chips = container ? Array.from(container.querySelectorAll(SEL_LOCAL.ballChip)) : [];
    let desiredIdx = -1;

    if (chips.length > 0) {
        const counts = chips.map((c) => parseNumber(c.querySelector(SEL_LOCAL.chipQty)?.textContent ?? c.textContent) ?? 0);
        const currentIdx = chips.findIndex((c) => c.classList.contains('on'));
        desiredIdx = currentIdx;

        if (order) {
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

        if (desiredIdx !== -1 && desiredIdx !== currentIdx && chips[desiredIdx] && dom.isInteractable(chips[desiredIdx])) {
            chips[desiredIdx].click();
        }
    }

    syncCaidosBallHost(ctx, order, desiredIdx);
};

export const processCaidos = (ctx, container) => {
    const { CONFIG, state, dom, randomDelay, playBeep, updateHud } = ctx;
    if (!state.running || state.paused || !container) return;

    const allButtons = Array.from(container.querySelectorAll(CONFIG.caidos.buttonSelector)).filter(dom.isInteractable);
    const shinyButtons = allButtons.filter(isShinyCaidoButton);

    if (shinyButtons.length > 0) {
        state.shinyAlertActive = true;
        shinyButtons.forEach((b) => {
            const slot = b.dataset.slot || b.textContent;
            if (!state.shinyNotifiedSlots.has(slot)) {
                state.shinyNotifiedSlots.add(slot);
                state.stats.shiniesSpotted++;
                if (CONFIG.shinyGuard.soundAlert) playBeep(1180, 0.25);
                state.lastActionNote = `✨ SHINY DETECTADO: ${(b.querySelector(SEL_LOCAL.caidoWho)?.textContent || 'Alvo').trim()}`;
                updateHud();
            }
        });
    } else {
        state.shinyAlertActive = false;
    }

    if (!CONFIG.caidos.enabled) return;
    const modalBlocking = typeof dom.getVisibleModal === 'function'
        ? Boolean(dom.getVisibleModal())
        : Boolean(state.modalLockOwner);
    if (modalBlocking && !(CONFIG.shinyGuard.enabled && shinyButtons.length > 0)) return;
    if (state.throwPending) return;

    const inv = dom.getInventorySnapshot();
    if (inv.totalBalls === 0) {
        smartRestock(ctx, { force: false });
        return;
    }

    const now = Date.now();
    const normalButtons = allButtons.filter((b) => !isShinyCaidoButton(b));
    const orderedNormals =
        CONFIG.caidos.prioritizeExpiring !== false
            ? [
                  ...normalButtons.filter((b) => b.classList?.contains?.('acabando')),
                  ...normalButtons.filter((b) => !b.classList?.contains?.('acabando')),
              ]
            : normalButtons;
    const ordered = shinyButtons.length > 0 ? [...shinyButtons, ...orderedNormals] : orderedNormals;
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

            if (dom.getInventorySnapshot().totalBalls === 0) {
                smartRestock(ctx, { force: false });
                return;
            }

            if (dom.isInteractable(nextBtn)) {
                ensureBestBallSelected(ctx, nextBtn);
                nextBtn.dataset.pbTriedAt = String(Date.now());
                state.lastThrowAt = Date.now();
                nextBtn.click();
                state.stats.caidosClicked++;
            }

            if (state.observedCaidosNode) {
                processCaidos(ctx, state.observedCaidosNode);
            }
        });
    }, baseWait + jitter);
};

export const ensureCaidosObserver = (ctx) => {
    const { CONFIG, state, dom } = ctx;
    if (!state.running || state.paused) return;

    const targetNode = dom.$(CONFIG.caidos.containerSelector);
    if (targetNode !== state.observedCaidosNode) {
        if (state.caidosObserver) {
            state.caidosObserver.disconnect();
            state.caidosObserver = null;
            state.observedCaidosNode = null;
        }
        if (targetNode) {
            state.observedCaidosNode = targetNode;
            state.caidosObserver = new MutationObserver(() => processCaidos(ctx, targetNode));
            state.caidosObserver.observe(targetNode, { childList: true });
        }
    }

    if (state.observedCaidosNode) {
        processCaidos(ctx, state.observedCaidosNode);
    }
};

export const capture = {
    id: 'capture',
    everyMs: (ctx) => ctx.CONFIG.caidos.reattachIntervalMs,
    tick: (ctx) => ensureCaidosObserver(ctx),
    process: processCaidos,
    ensureObserver: ensureCaidosObserver,
    dispose: ({ state }) => {
        if (state.caidosObserver) {
            state.caidosObserver.disconnect();
            state.caidosObserver = null;
            state.observedCaidosNode = null;
        }
    },
};
