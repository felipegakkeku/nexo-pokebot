// Troca automática de área: Top Catch Hop (próxima área com Pokémon não capturados), otimização de região
// (benchmark: visita as melhores áreas, mede e fica com a de maior nota) e progressão automática por nível/perigo.
// Comportamento idêntico ao da v6.5.
import { openMapModal, collectCandidatesFromOpenMap, travelToMarkerMeta } from './map-benchmark.js';
import { irProximaHuntGuia } from './hunt-queue.js';
import {
    createSession,
    computeSessionMetrics,
    persistCurrentSession,
    scoreRecord,
    updateFarmTelemetry,
} from './telemetry.js';

// --- Funções puras ---

// Durante o aquecimento: aborta se o HP caiu abaixo do limite ou se gastou revive desde antes do aquecimento
export const shouldAbortWarmup = (livePoke, preWarm, nowSnap, hpThreshold) =>
    (livePoke?.hpPercent !== null && livePoke.hpPercent < hpThreshold) ||
    Boolean(preWarm && nowSnap && nowSnap.revivesUsados > preWarm.revivesUsados);

// Aquecimento termina cedo quando o primeiro abate aparece
export const warmupDone = (preWarm, nowSnap) => Boolean(preWarm && nowSnap && nowSnap.abates > preWarm.abates);

// Durante a medição: aborta por HP baixo ou por revive/min > 0
export const shouldAbortMeasure = (livePoke, metrics, hpThreshold) =>
    (livePoke?.hpPercent !== null && livePoke.hpPercent < hpThreshold) || metrics.revivesMin > 0;

// Registro de uma área testada: segura só se não abortou, as métricas dizem seguro e houve abate
export const buildBenchmarkResult = (metrics, { aborted, cand, modo }) => {
    const isSafe = !aborted && metrics.segura && metrics.abates > 0;
    return {
        ...metrics,
        segura: isSafe,
        markerMeta: cand,
        score: Math.round(scoreRecord({ ...metrics, segura: isSafe }, modo)),
    };
};

// Maior nota primeiro
export const rankResults = (results) => [...results].sort((a, b) => b.score - a.score);

// Subiu `levelStep` níveis desde a última otimização?
export const trainerLevelReached = (trainerLv, lastOptimizedLv, levelStep) =>
    trainerLv !== null && lastOptimizedLv !== null && trainerLv >= lastOptimizedLv + levelStep;

// Farm ruim (revive ou poção demais depois de 3+ abates): hora de trocar de área
export const sessionIsDangerous = (metrics, maxPotionsPerMinSafe) =>
    metrics.abates >= 3 && (metrics.revivesMin > 0 || metrics.pocoesMin > maxPotionsPerMinSafe);

// --- Funções com ctx ---

export const hopNextTopCatchArea = async (ctx, force = false) => {
    const { state, dom, withModalLock } = ctx;
    return withModalLock(
        'TopCatch Hop',
        async () => {
            const poke = dom.getActivePokemon();
            const modal = await openMapModal(ctx);
            if (!modal) return false;

            let candidates = await collectCandidatesFromOpenMap(ctx, modal, poke, false, 'Top Catch', true);
            candidates = candidates.filter((c) => !c.isCurrent);
            await dom.closeActiveModal();

            if (candidates.length === 0) {
                state.lastActionNote = 'Top Catch: todas as áreas liberadas capturadas!';
                return false;
            }

            const visited = Array.isArray(state.topCatchVisitedSignatures) ? state.topCatchVisitedSignatures : [];
            const unseen = candidates.filter((c) => !visited.includes(c.signature));
            const nextArea = unseen.length > 0 ? unseen[0] : candidates[0];
            state.topCatchVisitedSignatures = unseen.length > 0
                ? [...visited.slice(-19), nextArea.signature]
                : [nextArea.signature];
            state.lastActionNote = `Top Catch -> ${nextArea.regionName} Nv${nextArea.areaLevel}`;
            const ok = await travelToMarkerMeta(ctx, nextArea);
            if (ok) {
                state.session = createSession(ctx, dom.getCurrentHunt(), dom.getActivePokemon(), nextArea);
            }
            return ok;
        },
        { force }
    );
};

export const otimizarRegiao = async (ctx, options = {}) => {
    const { CONFIG, state, dom, sleep, updateHud, withModalLock } = ctx;
    const {
        modo = CONFIG.mode,
        tempoPorRegiaoSeg = CONFIG.map.benchmarkSecPerArea,
        maxRegioes = CONFIG.map.maxAreasToTest,
        usarVantagemTipo = CONFIG.map.preferTypeAdvantage,
        force = false,
    } = options;
    return withModalLock(
        'Otimizando',
        async () => {
            state.lastOptimizeAt = Date.now();
            const poke = dom.getActivePokemon();
            const trainerLv = dom.getTrainerHeaderInfo().level;
            if (trainerLv !== null) state.lastOptimizedTrainerLevel = trainerLv;

            const dexFilter = modo === 'topcatch' ? 'Top Catch' : null;
            const modal = await openMapModal(ctx);
            if (!modal) return null;

            let candidates = await collectCandidatesFromOpenMap(
                ctx,
                modal,
                poke,
                usarVantagemTipo,
                dexFilter,
                modo === 'topcatch'
            );
            if (candidates.length === 0 && usarVantagemTipo) {
                candidates = await collectCandidatesFromOpenMap(ctx, modal, poke, false, dexFilter, modo === 'topcatch');
            }
            if (candidates.length === 0 && dexFilter) {
                candidates = await collectCandidatesFromOpenMap(ctx, modal, poke, false, null, false);
            }
            await dom.closeActiveModal();

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

                const ok = await travelToMarkerMeta(ctx, cand);
                if (!ok) continue;

                const preWarm = dom.readNativeSessionPanel();
                let aborted = false;
                const warmupEnd = Date.now() + CONFIG.map.warmupMaxSec * 1000;
                while (Date.now() < warmupEnd && state.running) {
                    await sleep(450);
                    if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return null;
                    const livePoke = dom.getActivePokemon();
                    const nowSnap = dom.readNativeSessionPanel();
                    if (shouldAbortWarmup(livePoke, preWarm, nowSnap, CONFIG.map.abortHpThreshold)) {
                        aborted = true;
                        break;
                    }
                    if (warmupDone(preWarm, nowSnap)) break;
                }

                state.session = createSession(ctx, dom.getCurrentHunt(), dom.getActivePokemon(), cand);

                if (!aborted && state.running) {
                    const measureEnd = Date.now() + tempoPorRegiaoSeg * 1000;
                    while (Date.now() < measureEnd && state.running) {
                        await sleep(1000);
                        if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return null;
                        updateFarmTelemetry(ctx);
                        updateHud();
                        const livePoke = dom.getActivePokemon();
                        const m = computeSessionMetrics(ctx, state.session);
                        if (shouldAbortMeasure(livePoke, m, CONFIG.map.abortHpThreshold)) {
                            aborted = true;
                            break;
                        }
                    }
                }

                const saved = persistCurrentSession(ctx, true);
                const metrics = saved || computeSessionMetrics(ctx, state.session);
                results.push(buildBenchmarkResult(metrics, { aborted, cand, modo }));
            }

            if (results.length === 0) return null;
            const ranked = rankResults(results);
            console.table(
                ranked.map((r) => ({
                    regiao: r.regiao,
                    abatesMin: r.abatesMin,
                    xpPokeMin: r.xpPokeMin,
                    lucroLiqMin: r.lucroLiqMin,
                    pocoesMin: r.pocoesMin,
                    segura: r.segura,
                    score: r.score,
                }))
            );

            const winner = ranked[0];
            await travelToMarkerMeta(ctx, winner.markerMeta);
            state.session = createSession(ctx, dom.getCurrentHunt(), dom.getActivePokemon(), winner.markerMeta);
            state.lastActionNote = `Melhor (${modo}): ${winner.regiao}`;
            return winner;
        },
        { force }
    );
};

// Troca de área pela fila /hunt (se houver) ou pelo benchmark
const changeArea = async (ctx) => {
    if (ctx.state.huntQueue.length > 0) {
        await irProximaHuntGuia(ctx, false);
    } else {
        await otimizarRegiao(ctx, { modo: ctx.CONFIG.mode });
    }
};

export const checkAutoRegionProgression = async (ctx) => {
    const { CONFIG, state, dom } = ctx;
    if (!state.running || state.paused || !CONFIG.autoRegion.enabled) return;
    if (state.modalLockOwner || dom.isInSpecialArena() || dom.getVisibleModal() || state.shinyAlertActive) return;

    const { level: trainerLv } = dom.getTrainerHeaderInfo();
    if (trainerLv !== null && state.lastOptimizedTrainerLevel === null) {
        state.lastOptimizedTrainerLevel = trainerLv;
    }
    if (Date.now() - state.lastOptimizeAt < CONFIG.autoRegion.minIntervalMs) return;

    if (trainerLevelReached(trainerLv, state.lastOptimizedTrainerLevel, CONFIG.autoRegion.levelStep)) {
        await changeArea(ctx);
        return;
    }

    if (state.session && dom.getCurrentHunt()) {
        const m = computeSessionMetrics(ctx, state.session);
        if (sessionIsDangerous(m, CONFIG.farm.maxPotionsPerMinSafe)) {
            await changeArea(ctx);
        }
    }
};

export const mapHop = {
    id: 'mapHop',
    everyMs: (ctx) => ctx.CONFIG.autoRegion.checkIntervalMs,
    tick: (ctx) => checkAutoRegionProgression(ctx),
    hopNextTopCatchArea,
    otimizarRegiao,
    checkAutoRegionProgression,
};
