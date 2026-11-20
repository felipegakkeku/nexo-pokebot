import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
    mapHop,
    shouldAbortWarmup,
    warmupDone,
    shouldAbortMeasure,
    buildBenchmarkResult,
    rankResults,
    trainerLevelReached,
    sessionIsDangerous,
    hopNextTopCatchArea,
    otimizarRegiao,
    checkAutoRegionProgression,
} from '../src/modules/map-hop-optimize.js';
import { createRuntime } from '../src/modules/runtime.js';
import { makeCtx, makeMapGame, makeConfig } from './fake-ctx.mjs';

const REGIONS = {
    Kanto: [{ level: 5, title: 'Rota 1' }, { level: 10, title: 'Floresta' }],
    Johto: [{ level: 12, title: 'Rota 29' }],
};

test('abortar no aquecimento: HP baixo ou revive gasto; terminar cedo no 1º abate', () => {
    assert.equal(shouldAbortWarmup({ hpPercent: 20 }, null, null, 30), true);
    assert.equal(shouldAbortWarmup({ hpPercent: 80 }, null, null, 30), false);
    assert.equal(shouldAbortWarmup({ hpPercent: null }, { revivesUsados: 0 }, { revivesUsados: 1 }, 30), true);
    assert.equal(shouldAbortWarmup({ hpPercent: null }, { revivesUsados: 1 }, { revivesUsados: 1 }, 30), false);
    assert.equal(warmupDone({ abates: 3 }, { abates: 4 }), true);
    assert.equal(warmupDone({ abates: 3 }, { abates: 3 }), false);
    assert.equal(warmupDone(null, { abates: 3 }), false);
});

test('abortar na medição: HP baixo ou revive por minuto', () => {
    assert.equal(shouldAbortMeasure({ hpPercent: 10 }, { revivesMin: 0 }, 30), true);
    assert.equal(shouldAbortMeasure({ hpPercent: 90 }, { revivesMin: 0.5 }, 30), true);
    assert.equal(shouldAbortMeasure({ hpPercent: null }, { revivesMin: 0 }, 30), false);
});

test('resultado do benchmark: segura só se não abortou, métricas seguras e com abates; nota arredondada', () => {
    const m = { segura: true, abates: 10, xpPokeMin: 1000.4, lucroLiqMin: 0, abatesMin: 5, regiao: 'R' };
    const ok = buildBenchmarkResult(m, { aborted: false, cand: { a: 1 }, modo: 'xp' });
    assert.deepEqual([ok.segura, ok.score, ok.markerMeta], [true, 1000, { a: 1 }]);
    const aborted = buildBenchmarkResult(m, { aborted: true, cand: {}, modo: 'xp' });
    assert.deepEqual([aborted.segura, aborted.score], [false, 250]);
    assert.equal(buildBenchmarkResult({ ...m, abates: 0 }, { aborted: false, cand: {}, modo: 'xp' }).segura, false);
});

test('ranking: maior nota primeiro, sem alterar a lista original', () => {
    const list = [{ score: 1 }, { score: 9 }, { score: 5 }];
    assert.deepEqual(rankResults(list).map((r) => r.score), [9, 5, 1]);
    assert.deepEqual(list.map((r) => r.score), [1, 9, 5]);
});

test('progressão por nível e por perigo', () => {
    assert.equal(trainerLevelReached(21, 16, 5), true);
    assert.equal(trainerLevelReached(20, 16, 5), false);
    assert.equal(trainerLevelReached(null, 16, 5), false);
    assert.equal(trainerLevelReached(30, null, 5), false);
    assert.equal(sessionIsDangerous({ abates: 3, revivesMin: 1, pocoesMin: 0 }, 2), true);
    assert.equal(sessionIsDangerous({ abates: 3, revivesMin: 0, pocoesMin: 2.5 }, 2), true);
    assert.equal(sessionIsDangerous({ abates: 2, revivesMin: 1, pocoesMin: 9 }, 2), false, 'poucos abates: não decide');
    assert.equal(sessionIsDangerous({ abates: 9, revivesMin: 0, pocoesMin: 2 }, 2), false);
});

test('Top Catch Hop: vai para a menor área não atual e abre nova sessão', async () => {
    const { game, dom } = makeMapGame(REGIONS, { current: { region: 'Kanto', idx: 0 } });
    const { ctx, log } = makeCtx({ dom });
    assert.equal(await hopNextTopCatchArea(ctx, true), true);
    assert.deepEqual(log.locks, ['TopCatch Hop']);
    assert.deepEqual(game.clicks, ['Kanto#1'], 'Kanto 5 é a atual; a menor das outras é Kanto 10');
    assert.equal(ctx.state.lastActionNote, 'Top Catch -> Kanto Nv10');
    assert.equal(ctx.state.session.regionKey, 'Floresta · nível 10');
    assert.equal(ctx.state.session.markerMeta.areaLevel, 10);
});

test('Top Catch Hop: sem outra área avisa; sem mapa devolve false', async () => {
    const { game, dom } = makeMapGame({ Kanto: [{ level: 5, title: 'Rota 1' }] }, { current: { region: 'Kanto', idx: 0 } });
    const a = makeCtx({ dom });
    assert.equal(await hopNextTopCatchArea(a.ctx, true), false);
    assert.equal(a.ctx.state.lastActionNote, 'Top Catch: todas as áreas liberadas capturadas!');
    assert.deepEqual(game.clicks, []);

    const b = makeCtx({});
    assert.equal(await hopNextTopCatchArea(b.ctx, true), false);
});

// Painel falso: cada leitura soma `rate` abates/XP da área atual, então a área de maior rate rende mais
const benchmarkCtx = ({ rates }) => {
    const { game, dom } = makeMapGame(REGIONS, { pokeLevel: 16, trainerLevel: 16 });
    let n = 0;
    const config = makeConfig();
    config.map.maxAreasToTest = 3;
    config.map.benchmarkSecPerArea = 3;
    const made = makeCtx({
        config,
        sleep: async (ms) => { mock.timers.tick(ms); },
        dom: {
            ...dom,
            readNativeSessionPanel: () => {
                n++;
                const key = game.current ? `${game.current.region}#${game.current.idx}` : '-';
                const rate = rates[key] ?? 1;
                return { abates: n * rate, xpPokemon: n * rate * 100, gold: n * rate * 10, lucro: n * rate * 10, capturas: 0, shiniesVistos: 0, pocoesUsadas: 0, revivesUsados: 0 };
            },
        },
    });
    return { game, ...made };
};

test('otimizar região: testa as melhores áreas, ranqueia e termina na de maior nota', async () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_700_000_000_000 });
    const origTable = console.table;
    const tables = [];
    console.table = (rows) => tables.push(rows);
    try {
        const { ctx, game, log } = benchmarkCtx({ rates: { 'Kanto#0': 1, 'Kanto#1': 2, 'Johto#0': 8 } });
        const winner = await otimizarRegiao(ctx, { force: true });
        assert.deepEqual(log.locks, ['Otimizando']);
        // visita por nível decrescente (Johto 12, Kanto 10, Kanto 5) e volta para a vencedora
        assert.deepEqual(game.clicks, ['Johto#0', 'Kanto#1', 'Kanto#0', 'Johto#0']);
        assert.equal(winner.regiao, 'Rota 29 · nível 12');
        assert.equal(ctx.state.lastActionNote, 'Melhor (xp): Rota 29 · nível 12');
        assert.equal(ctx.state.stats.regionSwitches, 4);
        assert.equal(tables.length, 1);
        assert.equal(tables[0].length, 3);
        assert.deepEqual(tables[0].map((r) => r.regiao)[0], 'Rota 29 · nível 12', 'tabela ordenada por nota');
        assert.ok(tables[0][0].score >= tables[0][1].score && tables[0][1].score >= tables[0][2].score);
        assert.equal(ctx.state.lastOptimizedTrainerLevel, 16);
        assert.ok(ctx.state.lastOptimizeAt > 0);
        assert.equal(ctx.state.session.markerMeta.regionName, 'Johto');
        assert.ok(Object.keys(ctx.state.history).length >= 3, 'cada área testada foi gravada no histórico');
    } finally {
        console.table = origTable;
        mock.timers.reset();
    }
});

test('otimizar região: respeita maxRegioes, modo e opções passadas; sem mapa devolve null', async () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_700_000_000_000 });
    const origTable = console.table;
    console.table = () => {};
    try {
        const { ctx, game } = benchmarkCtx({ rates: { 'Kanto#1': 5 } });
        const winner = await otimizarRegiao(ctx, { modo: 'ouro', maxRegioes: 2, tempoPorRegiaoSeg: 2, force: true });
        assert.deepEqual(game.clicks.slice(0, 2), ['Johto#0', 'Kanto#1']);
        assert.equal(winner.regiao, 'Floresta · nível 10');
        assert.match(ctx.state.lastActionNote, /^Melhor \(ouro\): /);

        const none = makeCtx({});
        assert.equal(await otimizarRegiao(none.ctx, { force: true }), null);
    } finally {
        console.table = origTable;
        mock.timers.reset();
    }
});

test('otimizar região: Shiny em campo interrompe o benchmark; pausado sem force não testa nada', async () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_700_000_000_000 });
    try {
        const a = benchmarkCtx({ rates: {} });
        a.ctx.CONFIG.shinyGuard.enabled = true;
        a.ctx.state.shinyAlertActive = true;
        assert.equal(await otimizarRegiao(a.ctx, { force: true }), null);
        assert.equal(a.ctx.state.lastActionNote, 'Benchmark pausado: Shiny em campo!');
        assert.deepEqual(a.game.clicks, []);

        const b = benchmarkCtx({ rates: {} });
        b.ctx.state.paused = true;
        assert.equal(await otimizarRegiao(b.ctx, { force: false }), null);
    } finally {
        mock.timers.reset();
    }
});

// ctx onde o lock só registra o rótulo (para ver qual rotina a progressão automática escolheu)
const autoCtx = (stateOver = {}, dom = {}) => {
    const made = makeCtx({ dom: { getCurrentHunt: () => ({ key: 'K' }), ...dom } });
    made.ctx.withModalLock = async (label) => { made.log.locks.push(label); return null; };
    Object.assign(made.ctx.state, stateOver);
    return made;
};
const liveSession = (over = {}) => ({
    regionKey: 'K', pokemonName: 'C', pokemonLevel: 16, startedAt: Date.now() - 120_000,
    startSnap: { abates: 0, xpPokemon: 0, gold: 0, lucro: 0, pocoesUsadas: 0, revivesUsados: 0 },
    latestSnap: { abates: 10, xpPokemon: 0, gold: 0, lucro: 0, pocoesUsadas: 0, revivesUsados: 0 },
    minHpPercent: 100, logKills: 0, logXpPoke: 0, logGold: 0, ...over,
});

test('progressão automática: não faz nada desligada, pausada, com trava, Shiny, arena especial ou modal aberto', async () => {
    const base = { lastOptimizedTrainerLevel: 10, lastOptimizeAt: 0 };
    const dom = { getTrainerHeaderInfo: () => ({ level: 30 }) };
    const cases = [
        [{ ...base, paused: true }, dom],
        [{ ...base, modalLockOwner: 'x' }, dom],
        [{ ...base, shinyAlertActive: true }, dom],
        [{ ...base }, { ...dom, isInSpecialArena: () => true }],
        [{ ...base }, { ...dom, getVisibleModal: () => ({}) }],
    ];
    for (const [st, d] of cases) {
        const { ctx, log } = autoCtx(st, d);
        await checkAutoRegionProgression(ctx);
        assert.deepEqual(log.locks, [], JSON.stringify(st));
    }
    const off = autoCtx({ ...base }, dom);
    off.ctx.CONFIG.autoRegion.enabled = false;
    await checkAutoRegionProgression(off.ctx);
    assert.deepEqual(off.log.locks, []);
});

test('progressão automática: subiu 5 níveis -> otimiza (sem fila) ou vai para a fila (com fila)', async () => {
    const dom = { getTrainerHeaderInfo: () => ({ level: 21 }) };
    const a = autoCtx({ lastOptimizedTrainerLevel: 16, lastOptimizeAt: 0 }, dom);
    await checkAutoRegionProgression(a.ctx);
    assert.deepEqual(a.log.locks, ['Otimizando']);

    const b = autoCtx({ lastOptimizedTrainerLevel: 16, lastOptimizeAt: 0, huntQueue: [{ name: 'Kakuna' }] }, dom);
    await checkAutoRegionProgression(b.ctx);
    assert.deepEqual(b.log.locks, ['Fila /hunt']);

    const c = autoCtx({ lastOptimizedTrainerLevel: 17, lastOptimizeAt: 0 }, dom);
    await checkAutoRegionProgression(c.ctx);
    assert.deepEqual(c.log.locks, [], 'só 4 níveis: espera');
});

test('progressão automática: respeita o intervalo mínimo e guarda o nível inicial do treinador', async () => {
    const dom = { getTrainerHeaderInfo: () => ({ level: 40 }) };
    const a = autoCtx({ lastOptimizedTrainerLevel: 16, lastOptimizeAt: Date.now() }, dom);
    await checkAutoRegionProgression(a.ctx);
    assert.deepEqual(a.log.locks, []);

    const b = autoCtx({ lastOptimizedTrainerLevel: null, lastOptimizeAt: 0 }, dom);
    await checkAutoRegionProgression(b.ctx);
    assert.equal(b.ctx.state.lastOptimizedTrainerLevel, 40, 'primeira leitura vira referência');
    assert.deepEqual(b.log.locks, [], 'e não otimiza na hora');
});

test('progressão automática: farm perigoso (revive/poções) troca de área; farm seguro não', async () => {
    const dom = { getTrainerHeaderInfo: () => ({ level: 16 }) };
    const danger = liveSession({ latestSnap: { abates: 10, xpPokemon: 0, gold: 0, lucro: 0, pocoesUsadas: 0, revivesUsados: 1 } });
    const a = autoCtx({ lastOptimizedTrainerLevel: 16, session: danger }, dom);
    await checkAutoRegionProgression(a.ctx);
    assert.deepEqual(a.log.locks, ['Otimizando']);

    const b = autoCtx({ lastOptimizedTrainerLevel: 16, session: liveSession(), huntQueue: [{ name: 'x' }] }, dom);
    await checkAutoRegionProgression(b.ctx);
    assert.deepEqual(b.log.locks, []);

    const c = autoCtx({ lastOptimizedTrainerLevel: 16, session: danger, huntQueue: [{ name: 'x' }] }, { ...dom, getCurrentHunt: () => null });
    await checkAutoRegionProgression(c.ctx);
    assert.deepEqual(c.log.locks, [], 'sem caçada atual não decide');
});

test('módulo: registra com o período da config e o tick roda a progressão', async () => {
    const dom = { getTrainerHeaderInfo: () => ({ level: 30 }) };
    const { ctx, log } = autoCtx({ lastOptimizedTrainerLevel: 10, lastOptimizeAt: 0 }, dom);
    const rt = createRuntime(ctx);
    rt.register(mapHop);
    assert.deepEqual(rt.scheduler.list(), ['mapHop']);
    await mapHop.tick(ctx);
    assert.deepEqual(log.locks, ['Otimizando']);
    rt.dispose();
});
