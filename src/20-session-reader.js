    // --- Leitor Nativo do #sessao-painel ---
    const readNativeSessionPanel = () => {
        const panel = document.getElementById('sessao-painel');
        if (!panel) return null;

        const hasData = panel.querySelector('b[data-k]');
        if (!hasData) return null;

        const getDataK = (k, signed = false) => {
            const el = panel.querySelector(`b[data-k="${k}"]`);
            if (!el) return 0;
            const fn = signed ? parseSignedNumber : parseNumber;
            return fn(el.textContent) ?? 0;
        };

        const sumPrefix = (prefix) => {
            let total = 0;
            panel.querySelectorAll(`b[data-k^="${prefix}"]`).forEach((el) => {
                total += parseNumber(el.textContent) ?? 0;
            });
            return total;
        };

        const getById = (id, signed = false) => {
            const el = panel.querySelector(`#${id}`);
            if (!el) return 0;
            const fn = signed ? parseSignedNumber : parseNumber;
            return fn(el.textContent) ?? 0;
        };

        const boosts = {};
        panel.querySelectorAll('.bxp-f[data-f]').forEach((icon) => {
            boosts[icon.getAttribute('data-f')] = icon.classList.contains('on');
        });

        const lugar = (panel.querySelector('.ss-lugar')?.textContent || '').replace('·', '').trim();

        return {
            xpBonusText: panel.querySelector('.bxp-total b')?.textContent?.trim() || '+0%',
            boosts,
            lugar,
            xpTreinador: getDataK('xpTreinador'),
            xpPokemon: getDataK('xpPokemon'),
            gold: getDataK('gold'),
            abates: getDataK('abates'),
            capturas: getDataK('capturas'),
            gasto: getDataK('gasto'),
            lucro: getDataK('lucro', true),
            shiniesVistos: getDataK('shiniesVistos'),
            shinies: getDataK('shinies'),
            pocoesUsadas: sumPrefix('pocao:'),
            revivesUsados: sumPrefix('revive:'),
            bolasUsadas: sumPrefix('bola:'),
            xpPokemonH: getById('sessao-xp-pokemon-h'),
            goldH: getById('sessao-gold-h'),
            lucroH: getById('sessao-lucro-h', true),
            abatesH: getById('sessao-abates-h'),
            tempo: panel.querySelector('#sessao-tempo')?.textContent?.trim() || '0:00:00',
        };
    };

    const isInSpecialArena = () => {
        const native = readNativeSessionPanel();
        if (native?.lugar) {
            const loc = normalizeText(native.lugar);
            if (loc.includes('boss') || loc.includes('mistica') || loc.includes('safari') || loc.includes('raid')) {
                return true;
            }
        }
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            if (isInsideHud(btn)) continue;
            const txt = normalizeText(btn.textContent);
            if ((txt.includes('abandonar arena') || txt.includes('sair de casa')) && isInteractable(btn)) {
                return true;
            }
        }
        return false;
    };

    const withModalLock = async (ownerLabel, fn, { force = false } = {}) => {
        if (!state.running || (state.paused && !force)) return null;
        if (!force && isInSpecialArena()) return null;
        if (!force && CONFIG.shinyGuard.enabled && state.shinyAlertActive) return null;
        if (state.modalLockOwner) return null;

        state.modalLockOwner = ownerLabel;
        setStatus(ownerLabel);
        try {
            return await fn();
        } finally {
            state.modalLockOwner = null;
            setStatus(state.paused ? 'Pausado' : 'Ativo');
            if (state.observedCaidosNode) {
                processCaidos(state.observedCaidosNode);
            }
        }
    };

    const getHuntTypeMultiplier = (attackerTypes, defenderTypes) => {
        if (!attackerTypes?.length || !defenderTypes?.length) return 1;
        let best = 0;
        for (const atk of attackerTypes) {
            const chart = TYPE_CHART[atk.toUpperCase()] || {};
            let raw = 1;
            for (const def of defenderTypes) {
                const factor = chart[def.toUpperCase()];
                raw *= factor !== undefined ? factor : 1;
            }
            const amp = HUNT_AMP[raw] !== undefined ? HUNT_AMP[raw] : raw;
            if (amp > best) best = amp;
        }
        return best;
    };
