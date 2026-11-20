// Equipe + Dia Sazonal: modo "equilibrar" (treina os mais fracos, resgata quando o ativo está frágil) e
// modo "sazonal" (troca para quem tem o tipo do dia). Comportamento idêntico ao da v6.5; só mudou de lugar.
import { parseNumber } from './pure.js';

const SEL_LOCAL = {
    timeList: '#time',
    teamRow: '.poke-linha',
    activeRow: '#time .poke-linha.ativo',
    rowName: '.pl-nome',
    rowLevel: '.pl-lv',
    rowHp: '.mini-hp i',
    rowInfo: '.pl-info',
};

export const getTeamCards = ({ dom, consts }) => {
    const list = dom.$(SEL_LOCAL.timeList);
    if (!list) return [];

    return Array.from(list.querySelectorAll(SEL_LOCAL.teamRow)).map((el) => {
        const id = el.getAttribute('data-id') || '';
        const isActive = el.classList.contains('ativo');
        const nomeEl = el.querySelector(SEL_LOCAL.rowName);
        const lvEl = el.querySelector(SEL_LOCAL.rowLevel);
        const level = parseNumber(lvEl?.textContent) ?? 1;
        const name = dom.getDirectText(nomeEl);

        const titleAttr = el.getAttribute('title') || '';
        const powerMatch = titleAttr.match(/poder\s+([\d.]+)/i);
        const power = powerMatch ? parseNumber(powerMatch[1]) : null;

        const types = [];
        titleAttr
            .toUpperCase()
            .split(/[\s/·,]+/)
            .forEach((tok) => {
                if (consts.VALID_TYPES.has(tok) && !types.includes(tok)) types.push(tok);
            });

        const hpStyle = el.querySelector(SEL_LOCAL.rowHp)?.style?.width || '';
        const hpPercent = hpStyle.endsWith('%') ? Math.round(parseFloat(hpStyle)) : 100;

        return { el, id, key: id || `${name}_${level}`, name, level, power, types, hpPercent, isActive };
    });
};

export const triggerTeamSwap = (ctx, chosen, noteLabel) => {
    const { CONFIG, state, dom } = ctx;
    const clickTarget = chosen.el.querySelector(SEL_LOCAL.rowInfo) || chosen.el;
    if (!dom.isVisible(clickTarget)) return;

    const snap = dom.readNativeSessionPanel();
    state.teamSwapPotionSnap = snap
        ? { pocoes: snap.pocoesUsadas, revives: snap.revivesUsados }
        : null;

    clickTarget.click();
    state.lastTeamSwapAt = Date.now();

    setTimeout(() => {
        if (!state.running) return;
        const currentActiveRow = dom.$(SEL_LOCAL.activeRow);
        const swapped =
            (chosen.id && currentActiveRow?.getAttribute('data-id') === chosen.id) ||
            dom.getActivePokemon()?.name.toLowerCase() === chosen.name.toLowerCase();

        if (swapped) {
            state.stats.teamSwaps++;
            state.lastActionNote = noteLabel || `Equipe: ${chosen.name} Nv${chosen.level}`;
        } else {
            state.failedSwapUntil[chosen.key] = Date.now() + CONFIG.team.failedSwapBackoffMs;
        }
    }, 1600);
};

const tick = (ctx) => {
    const { CONFIG, state, dom, consts } = ctx;
    if (!state.running || state.paused || CONFIG.team.mode === 'off') return;
    if (state.modalLockOwner || dom.isInSpecialArena()) return;

    const now = Date.now();
    const active = dom.getActivePokemon();
    const hunt = dom.getCurrentHunt();
    const { level: trainerLv } = dom.getTrainerHeaderInfo();
    const team = getTeamCards(ctx);
    if (!active || team.length < 2) return;

    const eligible = team.filter((p) => {
        if (trainerLv !== null && p.level > trainerLv + 5) return false;
        if (p.hpPercent <= 0) return false;
        if ((state.failedSwapUntil[p.key] || 0) > now) return false;
        return true;
    });
    if (eligible.length < 2) return;

    const activeRow = team.find((p) => p.isActive) || null;
    const strongest = [...eligible].sort(
        (a, b) => b.level - a.level || (b.power ?? 0) - (a.power ?? 0)
    )[0];

    if (CONFIG.team.mode === 'equilibrar' && activeRow && strongest && activeRow.key !== strongest.key) {
        const snap = dom.readNativeSessionPanel();
        const spentSupply = Boolean(
            snap &&
                state.teamSwapPotionSnap &&
                (snap.pocoesUsadas > state.teamSwapPotionSnap.pocoes ||
                    snap.revivesUsados > state.teamSwapPotionSnap.revives)
        );
        const lowHp = active.hpPercent !== null && active.hpPercent < CONFIG.team.rescueHpPercent;
        const tooWeak = active.power !== null && active.power < CONFIG.team.minTrainPower;

        if (spentSupply || lowHp || tooWeak) {
            if (now - state.lastTeamSwapAt >= consts.ESPERA_TROCA_ATIVO_MS) {
                state.unsafeTrainUntil[activeRow.key] = now + CONFIG.team.unsafeBackoffMs;
                triggerTeamSwap(ctx, strongest, `Resgate: ${strongest.name} (${activeRow.name} frágil)`);
            }
            return;
        }
    }

    const cooldown = Math.max(CONFIG.team.swapCooldownMs, consts.ESPERA_TROCA_ATIVO_MS);
    if (now - state.lastTeamSwapAt < cooldown) return;

    let chosen = null;
    if (CONFIG.team.mode === 'sazonal') {
        const dayType = dom.getSeasonalDayType();
        if (dayType && !active.types.includes(dayType)) {
            const matching = eligible
                .filter((p) => p.types.includes(dayType) && !p.isActive)
                .sort((a, b) => b.level - a.level || (b.power ?? 0) - (a.power ?? 0));
            if (matching.length > 0) chosen = matching[0];
        }
    } else if (CONFIG.team.mode === 'equilibrar') {
        const minSafeLevel = hunt ? Math.max(1, hunt.targetLevel - CONFIG.team.maxGapBelowHunt) : 1;
        const safeToTrain = eligible
            .filter((p) => {
                if (p.level < minSafeLevel) return false;
                if (p.hpPercent < CONFIG.team.minTrainHpPercent) return false;
                if (p.power !== null && p.power < CONFIG.team.minTrainPower) return false;
                if ((state.unsafeTrainUntil[p.key] || 0) > now) return false;
                return true;
            })
            .sort((a, b) => a.level - b.level || (b.power ?? 0) - (a.power ?? 0));

        if (safeToTrain.length > 0 && !safeToTrain[0].isActive && safeToTrain[0].level + 1 < (active.level ?? 1)) {
            chosen = safeToTrain[0];
        }
    }

    if (chosen && !chosen.isActive) {
        triggerTeamSwap(ctx, chosen, `Equipe: ${chosen.name} Nv${chosen.level}`);
    }
};

export const teamSeason = {
    id: 'teamSeason',
    everyMs: (ctx) => ctx.CONFIG.team.checkIntervalMs,
    tick,
};
