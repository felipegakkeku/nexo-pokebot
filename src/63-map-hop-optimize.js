    const hopNextTopCatchArea = async (force = false) => {
        return withModalLock(
            'TopCatch Hop',
            async () => {
                const poke = getActivePokemon();
                const modal = await openMapModal();
                if (!modal) return false;

                let candidates = await collectCandidatesFromOpenMap(modal, poke, false, 'Top Catch', true);
                candidates = candidates.filter((c) => !c.isCurrent);
                await closeActiveModal();

                if (candidates.length === 0) {
                    state.lastActionNote = 'Top Catch: todas as áreas liberadas capturadas!';
                    return false;
                }

                const nextArea = candidates[0];
                state.lastActionNote = `Top Catch -> ${nextArea.regionName} Nv${nextArea.areaLevel}`;
                const ok = await travelToMarkerMeta(nextArea);
                if (ok) {
                    state.session = createSession(getCurrentHunt(), getActivePokemon(), nextArea);
                }
                return ok;
            },
            { force }
        );
    };

    const otimizarRegiao = async ({
        modo = CONFIG.mode,
        tempoPorRegiaoSeg = CONFIG.map.benchmarkSecPerArea,
        maxRegioes = CONFIG.map.maxAreasToTest,
        usarVantagemTipo = CONFIG.map.preferTypeAdvantage,
        force = false,
    } = {}) => {
        return withModalLock(
            'Otimizando',
            async () => {
                state.lastOptimizeAt = Date.now();
                const poke = getActivePokemon();
                const trainerLv = getTrainerHeaderInfo().level;
                if (trainerLv !== null) state.lastOptimizedTrainerLevel = trainerLv;

                const dexFilter = modo === 'topcatch' ? 'Top Catch' : null;
                const modal = await openMapModal();
                if (!modal) return null;

                let candidates = await collectCandidatesFromOpenMap(
                    modal,
                    poke,
                    usarVantagemTipo,
                    dexFilter,
                    modo === 'topcatch'
                );
                if (candidates.length === 0 && usarVantagemTipo) {
                    candidates = await collectCandidatesFromOpenMap(modal, poke, false, dexFilter, modo === 'topcatch');
                }
                if (candidates.length === 0 && dexFilter) {
                    candidates = await collectCandidatesFromOpenMap(modal, poke, false, null, false);
                }
                await closeActiveModal();

                if (candidates.length === 0) return null;

                const toTest = candidates.slice(0, maxRegioes);
                const results = [];

                for (let i = 0; i < toTest.length; i++) {
                    if (!state.running || (state.paused && !force)) break;
                    if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) {
                        state.lastActionNote = 'Benchmark pausado: Shiny em campo!';
                        return null;
                    }

                    const cand = toTest[i];
                    state.lastActionNote = `Testando ${i + 1}/${toTest.length} (${cand.regionName} Nv${cand.areaLevel})`;
                    updateHud();

                    const ok = await travelToMarkerMeta(cand);
                    if (!ok) continue;

                    const preWarm = readNativeSessionPanel();
                    let aborted = false;
                    const warmupEnd = Date.now() + CONFIG.map.warmupMaxSec * 1000;
                    while (Date.now() < warmupEnd && state.running) {
                        await sleep(450);
                        if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return null;
                        const livePoke = getActivePokemon();
                        const nowSnap = readNativeSessionPanel();
                        if (
                            (livePoke?.hpPercent !== null && livePoke.hpPercent < CONFIG.map.abortHpThreshold) ||
                            (preWarm && nowSnap && nowSnap.revivesUsados > preWarm.revivesUsados)
                        ) {
                            aborted = true;
                            break;
                        }
                        if (preWarm && nowSnap && nowSnap.abates > preWarm.abates) break;
                    }

                    state.session = createSession(getCurrentHunt(), getActivePokemon(), cand);

                    if (!aborted && state.running) {
                        const measureEnd = Date.now() + tempoPorRegiaoSeg * 1000;
                        while (Date.now() < measureEnd && state.running) {
                            await sleep(1000);
                            if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return null;
                            updateFarmTelemetry();
                            updateHud();
                            const livePoke = getActivePokemon();
                            const m = computeSessionMetrics(state.session);
                            if (
                                (livePoke?.hpPercent !== null && livePoke.hpPercent < CONFIG.map.abortHpThreshold) ||
                                m.revivesMin > 0
                            ) {
                                aborted = true;
                                break;
                            }
                        }
                    }

                    const saved = persistCurrentSession(true);
                    const metrics = saved || computeSessionMetrics(state.session);
                    const isSafe = !aborted && metrics.segura && metrics.abates > 0;
                    results.push({
                        ...metrics,
                        segura: isSafe,
                        markerMeta: cand,
                        score: Math.round(scoreRecord({ ...metrics, segura: isSafe }, modo)),
                    });
                }

                if (results.length === 0) return null;
                results.sort((a, b) => b.score - a.score);
                console.table(
                    results.map((r) => ({
                        regiao: r.regiao,
                        abatesMin: r.abatesMin,
                        xpPokeMin: r.xpPokeMin,
                        lucroLiqMin: r.lucroLiqMin,
                        pocoesMin: r.pocoesMin,
                        segura: r.segura,
                        score: r.score,
                    }))
                );

                const winner = results[0];
                await travelToMarkerMeta(winner.markerMeta);
                state.session = createSession(getCurrentHunt(), getActivePokemon(), winner.markerMeta);
                state.lastActionNote = `Melhor (${modo}): ${winner.regiao}`;
                return winner;
            },
            { force }
        );
    };

    const checkAutoRegionProgression = async () => {
        if (!state.running || state.paused || !CONFIG.autoRegion.enabled) return;
        if (state.modalLockOwner || isInSpecialArena() || getVisibleModal() || state.shinyAlertActive) return;

        const { level: trainerLv } = getTrainerHeaderInfo();
        if (trainerLv !== null && state.lastOptimizedTrainerLevel === null) {
            state.lastOptimizedTrainerLevel = trainerLv;
        }
        if (Date.now() - state.lastOptimizeAt < CONFIG.autoRegion.minIntervalMs) return;

        if (
            trainerLv !== null &&
            state.lastOptimizedTrainerLevel !== null &&
            trainerLv >= state.lastOptimizedTrainerLevel + CONFIG.autoRegion.levelStep
        ) {
            if (state.huntQueue.length > 0) {
                await irProximaHuntGuia(false);
            } else {
                await otimizarRegiao({ modo: CONFIG.mode });
            }
            return;
        }

        if (state.session && getCurrentHunt()) {
            const m = computeSessionMetrics(state.session);
            if (m.abates >= 3 && (m.revivesMin > 0 || m.pocoesMin > CONFIG.farm.maxPotionsPerMinSafe)) {
                if (state.huntQueue.length > 0) {
                    await irProximaHuntGuia(false);
                } else {
                    await otimizarRegiao({ modo: CONFIG.mode });
                }
            }
        }
    };
