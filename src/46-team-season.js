    // --- 7. Equipe + Dia Sazonal ---
    const getTeamCards = () => {
        const list = document.getElementById('time');
        if (!list) return [];

        return Array.from(list.querySelectorAll('.poke-linha')).map((el) => {
            const id = el.getAttribute('data-id') || '';
            const isActive = el.classList.contains('ativo');
            const nomeEl = el.querySelector('.pl-nome');
            const lvEl = el.querySelector('.pl-lv');
            const level = parseNumber(lvEl?.textContent) ?? 1;
            const name = getDirectText(nomeEl);

            const titleAttr = el.getAttribute('title') || '';
            const powerMatch = titleAttr.match(/poder\s+([\d.]+)/i);
            const power = powerMatch ? parseNumber(powerMatch[1]) : null;

            const types = [];
            titleAttr
                .toUpperCase()
                .split(/[\s/·,]+/)
                .forEach((tok) => {
                    if (VALID_TYPES.has(tok) && !types.includes(tok)) types.push(tok);
                });

            const hpStyle = el.querySelector('.mini-hp i')?.style?.width || '';
            const hpPercent = hpStyle.endsWith('%') ? Math.round(parseFloat(hpStyle)) : 100;

            return { el, id, key: id || `${name}_${level}`, name, level, power, types, hpPercent, isActive };
        });
    };

    const triggerTeamSwap = (chosen, noteLabel) => {
        const clickTarget = chosen.el.querySelector('.pl-info') || chosen.el;
        if (!isVisible(clickTarget)) return;

        const snap = readNativeSessionPanel();
        state.teamSwapPotionSnap = snap
            ? { pocoes: snap.pocoesUsadas, revives: snap.revivesUsados }
            : null;

        clickTarget.click();
        state.lastTeamSwapAt = Date.now();

        setTimeout(() => {
            if (!state.running) return;
            const currentActiveRow = document.querySelector('#time .poke-linha.ativo');
            const swapped =
                (chosen.id && currentActiveRow?.getAttribute('data-id') === chosen.id) ||
                getActivePokemon()?.name.toLowerCase() === chosen.name.toLowerCase();

            if (swapped) {
                state.stats.teamSwaps++;
                state.lastActionNote = noteLabel || `Equipe: ${chosen.name} Nv${chosen.level}`;
            } else {
                state.failedSwapUntil[chosen.key] = Date.now() + CONFIG.team.failedSwapBackoffMs;
            }
        }, 1600);
    };

    const checkTeamRotation = () => {
        if (!state.running || state.paused || CONFIG.team.mode === 'off') return;
        if (state.modalLockOwner || isInSpecialArena()) return;

        const now = Date.now();
        const active = getActivePokemon();
        const hunt = getCurrentHunt();
        const { level: trainerLv } = getTrainerHeaderInfo();
        const team = getTeamCards();
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
            const snap = readNativeSessionPanel();
            const spentSupply = Boolean(
                snap &&
                    state.teamSwapPotionSnap &&
                    (snap.pocoesUsadas > state.teamSwapPotionSnap.pocoes ||
                        snap.revivesUsados > state.teamSwapPotionSnap.revives)
            );
            const lowHp = active.hpPercent !== null && active.hpPercent < CONFIG.team.rescueHpPercent;
            const tooWeak = active.power !== null && active.power < CONFIG.team.minTrainPower;

            if (spentSupply || lowHp || tooWeak) {
                if (now - state.lastTeamSwapAt >= ESPERA_TROCA_ATIVO_MS) {
                    state.unsafeTrainUntil[activeRow.key] = now + CONFIG.team.unsafeBackoffMs;
                    triggerTeamSwap(strongest, `Resgate: ${strongest.name} (${activeRow.name} frágil)`);
                }
                return;
            }
        }

        const cooldown = Math.max(CONFIG.team.swapCooldownMs, ESPERA_TROCA_ATIVO_MS);
        if (now - state.lastTeamSwapAt < cooldown) return;

        let chosen = null;
        if (CONFIG.team.mode === 'sazonal') {
            const dayType = getSeasonalDayType();
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
            triggerTeamSwap(chosen, `Equipe: ${chosen.name} Nv${chosen.level}`);
        }
    };
