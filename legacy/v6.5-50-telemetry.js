    // --- 11. Telemetria Híbrida (#sessao-painel + Fallback #hud-log) ---
    const createSession = (hunt, pokemon, markerMeta = null) => ({
        regionKey: hunt ? hunt.key : 'Centro / Fora',
        targetName: hunt ? hunt.targetName : 'Nenhum',
        targetLevel: hunt ? hunt.targetLevel : null,
        markerMeta,
        pokemonName: pokemon ? pokemon.name : 'Desconhecido',
        pokemonLevel: pokemon ? pokemon.level : null,
        pokemonTypes: pokemon ? pokemon.types : [],
        startedAt: Date.now(),
        startSnap: readNativeSessionPanel(),
        latestSnap: readNativeSessionPanel(),
        logKills: 0,
        logXpPoke: 0,
        logGold: 0,
        minHpPercent: pokemon?.hpPercent ?? 100,
    });

    const handleCombatLogNode = (node) => {
        if (!state.running || !state.session || node.nodeType !== Node.ELEMENT_NODE) return;
        const txt = node.textContent || '';
        if (txt.includes('derrotado!')) {
            state.session.logKills++;
            const xpMatch = txt.match(/\+([\d.]+)\s*xp\s*pok[eé]mon/i);
            const goldMatch = txt.match(/\+([\d.]+)\s*ouro/i);
            if (xpMatch) state.session.logXpPoke += parseNumber(xpMatch[1]) ?? 0;
            if (goldMatch) state.session.logGold += parseNumber(goldMatch[1]) ?? 0;
        } else if (normalizeText(txt).includes('capturado')) {
            state.stats.captures++;
        }
    };

    const ensureCombatLogObserver = () => {
        const logNode = document.getElementById('hud-log');
        if (logNode === state.observedLogNode) return;

        if (state.logObserver) {
            state.logObserver.disconnect();
            state.logObserver = null;
            state.observedLogNode = null;
        }
        if (logNode) {
            state.observedLogNode = logNode;
            state.logObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    for (const added of m.addedNodes) {
                        handleCombatLogNode(added);
                    }
                }
            });
            state.logObserver.observe(logNode, { childList: true });
        }
    };

    const computeSessionMetrics = (s, now = Date.now()) => {
        const elapsedSec = Math.max(1, Math.floor((now - s.startedAt) / 1000));
        const minutes = elapsedSec / 60;

        const a = s.startSnap;
        const b = s.latestSnap || a;
        const useNative = Boolean(a && b);

        const dKills = useNative ? Math.max(0, b.abates - a.abates) : s.logKills;
        const dXpPoke = useNative ? Math.max(0, b.xpPokemon - a.xpPokemon) : s.logXpPoke;
        const dGold = useNative ? Math.max(0, b.gold - a.gold) : s.logGold;
        const dLucro = useNative ? b.lucro - a.lucro : s.logGold;
        const dPotions = useNative ? Math.max(0, b.pocoesUsadas - a.pocoesUsadas) : 0;
        const dRevives = useNative ? Math.max(0, b.revivesUsados - a.revivesUsados) : 0;

        const killsPerMin = +(dKills / minutes).toFixed(2);
        const xpPokePerMin = Math.round(dXpPoke / minutes);
        const goldGrossPerMin = Math.round(dGold / minutes);
        const lucroPerMin = Math.round(dLucro / minutes);
        const potionsPerMin = +(dPotions / minutes).toFixed(2);
        const revivesPerMin = +(dRevives / minutes).toFixed(2);

        const safe =
            revivesPerMin === 0 &&
            potionsPerMin <= CONFIG.farm.maxPotionsPerMinSafe &&
            s.minHpPercent >= CONFIG.farm.minHpPercentSafe;

        return {
            regiao: s.regionKey,
            pokemon: `${s.pokemonName} Nv${s.pokemonLevel ?? '?'}`,
            tempoSeg: elapsedSec,
            abates: dKills,
            abatesMin: killsPerMin,
            xpPokeMin: xpPokePerMin,
            ouroBrutoMin: goldGrossPerMin,
            lucroLiqMin: lucroPerMin,
            pocoesMin: potionsPerMin,
            revivesMin: revivesPerMin,
            minHpPct: s.minHpPercent,
            segura: safe,
        };
    };

    const scoreRecord = (r, modo = CONFIG.mode) => {
        const safetyWeight = r.segura ? 1 : 0.25;
        if (modo === 'xp') return r.xpPokeMin * safetyWeight;
        if (modo === 'ouro') return Math.max(0, r.lucroLiqMin) * safetyWeight;
        if (modo === 'topcatch') return (r.abatesMin * 100 + r.xpPokeMin * 0.2) * safetyWeight;
        return (r.xpPokeMin * 0.65 + Math.max(0, r.lucroLiqMin) * 0.35) * safetyWeight;
    };

    const persistCurrentSession = (forceSave = false) => {
        const s = state.session;
        if (!s || !s.regionKey || s.regionKey === 'Centro / Fora') return null;

        const metrics = computeSessionMetrics(s);
        if (!forceSave && (metrics.tempoSeg < CONFIG.farm.minSampleSec || metrics.abates < CONFIG.farm.minKillsToSave)) {
            return null;
        }

        const recordKey = `${s.pokemonName}__${s.regionKey}`;
        const prev = state.history[recordKey];
        const record = {
            ...metrics,
            pokemonName: s.pokemonName,
            pokemonLevel: s.pokemonLevel,
            targetLevel: s.targetLevel,
            markerMeta: s.markerMeta || prev?.markerMeta || null,
            updatedAt: new Date().toISOString(),
        };

        state.history[recordKey] = record;
        saveJson(STORAGE_HISTORY_KEY, state.history);
        return record;
    };

    const checkVersionAlert = () => {
        const aviso = document.getElementById('aviso-versao');
        if (aviso && isVisible(aviso) && !state.paused) {
            state.paused = true;
            setStatus('Atualização!', 'Nova versão detectada — recarregue o jogo');
            playBeep(520, 0.25);
        }
    };

    const updateFarmTelemetry = () => {
        if (!state.running || !CONFIG.farm.enabled) return;

        ensureCombatLogObserver();
        checkVersionAlert();

        const hunt = getCurrentHunt();
        const poke = getActivePokemon();
        const snap = readNativeSessionPanel();

        if (snap) {
            if (state.lastShiniesVistos === null) {
                state.lastShiniesVistos = snap.shiniesVistos;
            } else if (snap.shiniesVistos > state.lastShiniesVistos) {
                state.lastShiniesVistos = snap.shiniesVistos;
                state.stats.shiniesSpotted++;
                if (CONFIG.shinyGuard.soundAlert) playBeep(1180, 0.25);
                state.lastActionNote = '✨ Shiny apareceu na sessão!';
            } else if (snap.shiniesVistos < state.lastShiniesVistos) {
                state.lastShiniesVistos = snap.shiniesVistos;
            }

            if (state.lastSessionCaptures === null) {
                state.lastSessionCaptures = snap.capturas;
            } else if (snap.capturas > state.lastSessionCaptures) {
                state.stats.captures += snap.capturas - state.lastSessionCaptures;
                state.lastSessionCaptures = snap.capturas;
                if (
                    CONFIG.topCatchHop.enabled &&
                    !state.modalLockOwner &&
                    !state.shinyAlertActive &&
                    Date.now() - state.lastHopAt >= CONFIG.topCatchHop.hopCooldownMs
                ) {
                    state.lastHopAt = Date.now();
                    setTimeout(() => {
                        if (state.running && !state.shinyAlertActive) hopNextTopCatchArea(false);
                    }, 1000);
                }
            } else if (snap.capturas < state.lastSessionCaptures) {
                state.lastSessionCaptures = snap.capturas;
            }
        }

        if (!state.session) {
            state.session = createSession(hunt, poke, state.lastMarkerMeta);
        } else if (hunt && hunt.key !== state.session.regionKey) {
            persistCurrentSession(false);
            state.session = createSession(hunt, poke, state.lastMarkerMeta);
        } else if (poke && poke.name !== state.session.pokemonName) {
            persistCurrentSession(false);
            state.session = createSession(hunt, poke, state.lastMarkerMeta);
        } else {
            if (poke) {
                state.session.pokemonLevel = poke.level;
                if (poke.hpPercent !== null && poke.hpPercent < state.session.minHpPercent) {
                    state.session.minHpPercent = poke.hpPercent;
                }
            }
            if (snap) {
                if (state.session.startSnap && snap.abates < state.session.startSnap.abates) {
                    state.session.startSnap = snap;
                    state.session.startedAt = Date.now();
                }
                if (!state.session.startSnap) state.session.startSnap = snap;
                state.session.latestSnap = snap;
            }
        }

        persistCurrentSession(false);
    };
