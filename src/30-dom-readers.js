    // --- Leitores de Estado Travados no DOM Real (O(1)) ---
    const getTrainerHeaderInfo = () => ({
        level: parseNumber(document.getElementById('tr-level')?.textContent),
        gold: parseNumber(document.getElementById('tr-gold')?.textContent),
        diamonds: parseNumber(document.getElementById('tr-diamantes')?.textContent),
        gems: parseNumber(document.getElementById('tr-gemas')?.textContent),
    });

    const getActivePokemon = () => {
        const card = document.getElementById('ativo-card');
        if (!card || !isVisible(card)) return null;

        const nameEl = card.querySelector('.ativo-nome');
        const lvEl = card.querySelector('.pl-lv');
        const level = parseNumber(lvEl?.textContent);
        const name = getDirectText(nameEl);

        const types = [];
        card.querySelectorAll('.ativo-sub .tipo').forEach((el) => {
            const t = normalizeText(el.textContent).toUpperCase();
            if (VALID_TYPES.has(t) && !types.includes(t)) types.push(t);
        });

        const subTxt = card.querySelector('.ativo-sub')?.textContent || '';
        const powerMatch = subTxt.match(/poder\s+([\d.]+)/i);
        const power = powerMatch ? parseNumber(powerMatch[1]) : null;

        const hpTxt = card.querySelector('.barra.hp span')?.textContent || '';
        const hpMatch = hpTxt.match(/([\d.]+)\s*\/\s*([\d.]+)/);
        const hpCurrent = hpMatch ? parseNumber(hpMatch[1]) : null;
        const hpMax = hpMatch ? parseNumber(hpMatch[2]) : null;

        let hpPercent = null;
        if (hpCurrent !== null && hpMax) {
            hpPercent = Math.round((hpCurrent / hpMax) * 100);
        } else {
            const fillW = card.querySelector('.barra.hp .fill')?.style?.width;
            if (fillW && fillW.endsWith('%')) hpPercent = Math.round(parseFloat(fillW));
        }

        return { name, level, types, power, hpCurrent, hpMax, hpPercent };
    };

    const getCurrentHunt = () => {
        const el = document.getElementById('hud-hunt');
        if (!el || !isVisible(el)) return null;

        const text = (el.textContent || '').trim();
        const match = text.match(/^(.+?)\s*·\s*n[ií]vel\s*([\d.]+)$/i);
        if (!match) return null;

        return {
            key: text,
            pokeId: el.getAttribute('data-poke-id') || null,
            targetName: match[1].trim(),
            targetLevel: parseNumber(match[2]),
        };
    };

    const getSeasonalDayType = () => {
        const btn = document.getElementById('cena-dia-tipo');
        if (btn) {
            const dataTipo = (btn.getAttribute('data-tipo') || '').toUpperCase();
            if (VALID_TYPES.has(dataTipo)) {
                state.seasonalDayType = dataTipo;
                return dataTipo;
            }
            const imgSrc = btn.querySelector('img')?.getAttribute('src') || '';
            const typeMatch = imgSrc.match(/\/tipos\/([a-z]+)\./i);
            if (typeMatch) {
                const candidate = typeMatch[1].toUpperCase();
                if (VALID_TYPES.has(candidate)) {
                    state.seasonalDayType = candidate;
                    return candidate;
                }
            }
            const probe = normalizeText(btn.getAttribute('title') || btn.textContent || '');
            for (const [dayName, type] of Object.entries(SEASONAL_DAYS)) {
                if (probe.includes(dayName)) {
                    state.seasonalDayType = type;
                    return type;
                }
            }
        }
        return state.seasonalDayType;
    };

    const readChipsByContainer = (id) => {
        const container = document.getElementById(id);
        if (!container) return null;
        return Array.from(container.querySelectorAll('.auto-chip')).map((chip) =>
            parseNumber(chip.querySelector('.q')?.textContent ?? chip.textContent)
        );
    };

    const getInventorySnapshot = () => {
        const balls = readChipsByContainer('auto-ball-opts');
        const revives = readChipsByContainer('auto-revive-opts');
        const potions = readChipsByContainer('auto-potion-opts');
        const sumValid = (arr) => {
            if (!arr) return null;
            const valid = arr.filter((n) => n !== null);
            return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
        };
        return {
            panelOpen: Boolean(balls),
            balls,
            revives,
            potions,
            pokeBalls: balls ? balls[0] : null,
            totalBalls: sumValid(balls),
            maxRevives: revives ? revives[0] : null,
            reviveNormal: revives && revives.length > 1 ? revives[1] : revives ? revives[0] : null,
            totalRevives: sumValid(revives),
            smallPotions: potions && potions.length ? potions[potions.length - 1] : null,
        };
    };

    const getTargetBallTier = () => {
        if (!CONFIG.restock.autoUpgradeBalls) return BALL_TIERS[0];
        const { gold } = getTrainerHeaderInfo();
        const available = Math.max(0, (gold ?? 0) - CONFIG.restock.minGoldReserve);
        let chosen = BALL_TIERS[0];
        for (const tier of BALL_TIERS) {
            if (available >= tier.minGold) chosen = tier;
        }
        return chosen;
    };
