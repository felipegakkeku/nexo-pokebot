// Auto-Prey (Caçada Diária): abre o bolso Prey, gira a roleta grátis do dia e escolhe o Pokémon mais adequado.
import { normalizeText, parseNumber } from './pure.js';
import { openBackpackPocket } from './depot.js';

const SEL_LOCAL = {
    preyRoot: '#pry',
    cards: '.pry-cartela:not(.bloqueada)',
    spinBtn: 'button.pry-girar',
    chooseBox: '.pry-quad-pokemon.escolhivel',
    pokeCells: '.pry-c-pk[data-pk]:not(.vazio)',
};

export const pickBestPreyCell = (cells, { targetName = null, queueNames = [], activeLevel = null } = {}) => {
    if (!Array.isArray(cells) || cells.length === 0) return null;

    const getCellText = (cell) =>
        normalizeText(`${cell.getAttribute?.('title') ?? cell.title ?? ''} ${cell.textContent ?? ''}`);

    const needle = normalizeText(targetName);
    if (needle) {
        const directMatch = cells.find((c) => getCellText(c).includes(needle));
        if (directMatch) return directMatch;
    }

    if (Array.isArray(queueNames) && queueNames.length > 0) {
        for (const qName of queueNames) {
            const qNeedle = normalizeText(qName);
            if (!qNeedle) continue;
            const queueMatch = cells.find((c) => getCellText(c).includes(qNeedle));
            if (queueMatch) return queueMatch;
        }
    }

    const withLevels = cells.map((cell) => ({
        cell,
        level: parseNumber(cell.textContent ?? cell.getAttribute?.('title') ?? cell.title ?? ''),
    }));

    if (activeLevel !== null && activeLevel !== undefined) {
        const safe = withLevels
            .filter((x) => x.level !== null && x.level <= activeLevel)
            .sort((a, b) => b.level - a.level);
        if (safe.length > 0) return safe[0].cell;
    }

    const validLevels = withLevels.filter((x) => x.level !== null).sort((a, b) => a.level - b.level);
    return validLevels[0]?.cell || cells[0];
};

export const checkPrey = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, dom, storage, keys, sleep, randomDelay, withModalLock } = ctx;
    if (!CONFIG.prey?.enabled && !force) return;

    const savedDay = storage?.get && keys?.preyDay ? storage.get(keys.preyDay) : '';
    if (!force && state.preyDoneDay && savedDay && state.preyDoneDay === savedDay && Date.now() - (state.lastPreyCheckAt || 0) < 300000) {
        return;
    }

    await withModalLock(
        'Prey',
        async () => {
            try {
                const corpo = await openBackpackPocket(ctx, 'prey');
                if (!corpo) return;

                const root = await dom.waitFor(() => dom.$(SEL_LOCAL.preyRoot), 2500);
                if (!root) return;

                const dia = root.getAttribute?.('data-dia') || '';
                if (!force && dia && savedDay === dia) {
                    state.preyDoneDay = dia;
                    return;
                }

                const cards = Array.from(root.querySelectorAll(SEL_LOCAL.cards));
                for (const card of cards) {
                    if (!state.running) break;

                    const spinBtn = card.querySelector(SEL_LOCAL.spinBtn);
                    if (spinBtn && !spinBtn.hidden && !spinBtn.disabled && dom.isInteractable(spinBtn)) {
                        spinBtn.click();
                        state.stats.preyRolls = (state.stats.preyRolls || 0) + 1;
                        state.lastActionNote = 'Prey: roletada grátis!';
                        await dom.waitFor(() => card.querySelector(SEL_LOCAL.chooseBox), 2500);
                        await sleep(randomDelay(200, 340));
                    }

                    const chooseBox = card.querySelector(SEL_LOCAL.chooseBox);
                    if (chooseBox) {
                        const cells = Array.from(card.querySelectorAll(SEL_LOCAL.pokeCells)).filter(dom.isInteractable);
                        const chosen = pickBestPreyCell(cells, {
                            targetName: dom.getCurrentHunt()?.targetName,
                            queueNames: (state.huntQueue || []).map((q) => q.name),
                            activeLevel: dom.getActivePokemon()?.level,
                        });
                        if (chosen) {
                            chosen.click();
                            await sleep(randomDelay(220, 360));
                            await dom.confirmModalDialog(['escolher', 'confirmar', 'sim']);
                            state.lastActionNote = 'Prey: Pokémon escolhido!';
                            await sleep(randomDelay(260, 420));
                        }
                    }
                }

                const allComplete = cards.length > 0 && cards.every((c) => c.classList?.contains?.('completa'));
                if (allComplete && dia && keys?.preyDay) {
                    storage?.set?.(keys.preyDay, dia);
                    state.preyDoneDay = dia;
                }
            } finally {
                state.lastPreyCheckAt = Date.now();
                await dom.closeActiveModal();
            }
        },
        { force }
    );
};

export const prey = {
    id: 'prey',
    everyMs: (ctx) => ctx.CONFIG.prey?.checkIntervalMs ?? 60000,
    tick: (ctx) => checkPrey(ctx, { force: false }),
    check: checkPrey,
};
