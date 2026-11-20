    // --- 10. Assistente de Mini Games ---
    const dexNumberToRegion = (num) => {
        if (!num || num <= 0) return '';
        if (num <= 151) return 'kanto';
        if (num <= 251) return 'johto';
        if (num <= 386) return 'hoenn';
        if (num <= 493) return 'sinnoh';
        if (num <= 649) return 'unova';
        if (num <= 721) return 'kalos';
        if (num <= 809) return 'alola';
        if (num <= 905) return 'galar';
        if (num <= 1025) return 'paldea';
        return '';
    };

    const parsePokedexCsv = (csvText) => {
        const lines = (csvText || '').split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) return [];

        const sep = lines[0].includes(';') ? ';' : ',';
        const headers = lines[0].split(sep).map((h) => normalizeText(h.replace(/^"|"$/g, '')));
        const col = (candidates) => headers.findIndex((h) => candidates.some((c) => h.includes(c)));

        const idIdx = col(['#', 'id', 'num', 'dex']);
        const nameIdx = col(['nome', 'name', 'especie', 'pokemon']);
        const type1Idx = col(['tipo1', 'tipo 1', 'type1', 'tipo', 'type']);
        const type2Idx = col(['tipo2', 'tipo 2', 'type2']);
        const regIdx = col(['regiao', 'region', 'geracao', 'gen']);

        if (nameIdx === -1) return [];

        const map = new Map();
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(sep).map((v) => v.replace(/^"|"$/g, '').trim());
            const name = cols[nameIdx];
            if (!name || map.has(name)) continue;

            const types = [];
            const rawTypes = `${cols[type1Idx] || ''} ${type2Idx !== -1 ? cols[type2Idx] || '' : ''}`;
            rawTypes.split(/[\s/|,]+/).forEach((rawTok) => {
                const canonical = TYPE_ALIASES[normalizeText(rawTok)];
                if (canonical && !types.includes(canonical)) types.push(canonical);
            });

            const dexId = idIdx !== -1 ? parseNumber(cols[idIdx]) : null;
            const region = regIdx !== -1 && cols[regIdx] ? normalizeText(cols[regIdx]) : dexNumberToRegion(dexId);

            map.set(name, {
                id: dexId,
                name,
                cleanName: cleanKey(name),
                types,
                region,
            });
        }

        const list = Array.from(map.values());
        state.dexCatalog = list;
        saveJson(STORAGE_DEX_KEY, list);
        state.lastActionNote = `Pokedex importada: ${list.length} espécies`;
        updateHud();
        return list;
    };

    const abrirSeletorCsvPokedex = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,.txt';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            const text = await file.text();
            parsePokedexCsv(text);
        };
        input.click();
    };

    const applyMiniGameGuess = (pokemonName, submit = false) => {
        const input = document.getElementById('mg-input');
        if (!input || !isInteractable(input)) return false;

        input.value = pokemonName;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();

        if (submit) {
            const sendBtn = document.getElementById('mg-enviar');
            if (sendBtn && isInteractable(sendBtn)) {
                sendBtn.click();
                return true;
            }
            const form = input.closest('form');
            if (form) {
                form.requestSubmit
                    ? form.requestSubmit()
                    : form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                return true;
            }
            return false;
        }
        return true;
    };

    const updateMiniGameHelper = () => {
        if (!state.running || !CONFIG.minigame.enabled || state.dexCatalog.length === 0) return;

        const tela = document.getElementById('mg-tela');
        if (!tela || !isVisible(tela) || tela.getAttribute('data-fase') !== 'palpites') {
            if (state.miniGameMatches.length > 0) {
                state.miniGameMatches = [];
                renderQuizCandidates();
            }
            return;
        }

        const barraSig = document.getElementById('mg-barra')?.getAttribute('data-sig') || '';
        const roundId = barraSig.split('|')[0] || '';
        if (roundId && roundId !== state.currentMiniGameRoundId) {
            state.currentMiniGameRoundId = roundId;
            state.roundTriedNames.clear();
            state.lastGuessedStageKey = '';
        }

        const pistasEl = tela.querySelector('.mg-pistas');
        if (!pistasEl) return;

        const clueTypes = [];
        pistasEl.querySelectorAll('.mg-tipo-sel').forEach((badge) => {
            for (const cls of badge.classList) {
                const up = cls.toUpperCase();
                if (VALID_TYPES.has(up) && !clueTypes.includes(up)) clueTypes.push(up);
            }
        });

        let clueRegion = null;
        const regions = ['kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea'];
        pistasEl.querySelectorAll('.mg-par:not(.trava)').forEach((par) => {
            const rot = normalizeText(par.querySelector('.mg-pista-rot')?.textContent);
            const val = normalizeText(par.querySelector('.mg-pista-val')?.textContent);
            if (rot.includes('regiao')) {
                const found = regions.find((r) => val.includes(r));
                if (found) clueRegion = found;
            }
        });

        let letterPattern = null;
        const letrasEl = pistasEl.querySelector('.mg-pista-letras');
        if (letrasEl) {
            const cells = Array.from(letrasEl.querySelectorAll('span, i, b')).filter((c) => {
                const t = (c.textContent || '').trim();
                return c.children.length === 0 && t.length <= 2;
            });
            if (cells.length >= 3) {
                const chars = cells.map((c) => {
                    const ch = cleanKey(c.textContent);
                    return ch.length === 1 ? ch : '.';
                });
                letterPattern = new RegExp(`^${chars.join('')}$`);
            }
        }

        if (clueTypes.length === 0 && !clueRegion && !letterPattern) {
            if (state.miniGameMatches.length > 0) {
                state.miniGameMatches = [];
                renderQuizCandidates();
            }
            return;
        }

        let matches = state.dexCatalog;
        if (clueTypes.length > 0) {
            matches = matches.filter((p) => clueTypes.every((t) => p.types.includes(t)));
            if (clueTypes.length === 1) {
                matches = [...matches].sort((a, b) => a.types.length - b.types.length);
            }
        }
        if (clueRegion) {
            matches = matches.filter((p) => !p.region || p.region.includes(clueRegion));
        }
        if (letterPattern) {
            matches = matches.filter((p) => letterPattern.test(p.cleanName));
        }

        const untried = matches.filter((p) => !state.roundTriedNames.has(p.cleanName));
        state.miniGameMatches = untried.slice(0, 8).map((p) => p.name);
        renderQuizCandidates();

        if (
            CONFIG.minigame.autoGuess &&
            untried.length >= 1 &&
            untried.length <= CONFIG.minigame.autoGuessMaxCandidates
        ) {
            const stageKey = `${roundId || 'mg'}_${tela.getAttribute('data-estagio') || '0'}`;
            if (state.lastGuessedStageKey !== stageKey) {
                const pick = untried[0];
                if (applyMiniGameGuess(pick.name, true)) {
                    state.lastGuessedStageKey = stageKey;
                    state.roundTriedNames.add(pick.cleanName);
                    state.lastActionNote = `Quiz auto (${untried.length} opç.): ${pick.name}`;
                    renderQuizCandidates();
                }
            }
        }
    };
