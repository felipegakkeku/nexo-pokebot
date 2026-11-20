import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
    telemetry,
    computeMetrics,
    scoreRecord,
    shouldSaveMetrics,
    trackCounter,
    planSessionStep,
    updateSessionReadings,
    shouldTopCatchHop,
    parseCombatLogText,
    createSession,
    persistCurrentSession,
    updateFarmTelemetry,
    checkVersionAlert,
    ensureCombatLogObserver,
} from '../src/modules/telemetry.js';
import { createRuntime } from '../src/modules/runtime.js';
import { makeCtx, makeConfig, makeState } from './fake-ctx.mjs';

const FARM = makeConfig().farm;
const snap = (over = {}) => ({
    abates: 0, xpPokemon: 0, gold: 0, lucro: 0, capturas: 0, shiniesVistos: 0, pocoesUsadas: 0, revivesUsados: 0, ...over,
});
const session = (over = {}) => ({
    regionKey: 'Floresta · nível 5', targetName: 'Caterpie', targetLevel: 5, markerMeta: null,
    pokemonName: 'Charmander', pokemonLevel: 16, pokemonTypes: ['FIRE'],
    startedAt: 1_000_000, startSnap: null, latestSnap: null, logKills: 0, logXpPoke: 0, logGold: 0, minHpPercent: 100, ...over,
});

test('métricas: usa o painel nativo (deltas por minuto) e marca a área como segura', () => {
    const s = session({ startSnap: snap(), latestSnap: snap({ abates: 30, xpPokemon: 6000, gold: 3000, lucro: 2400, pocoesUsadas: 2 }) });
    const m = computeMetrics(s, FARM, 1_000_000 + 120_000); // 2 min
    assert.equal(m.tempoSeg, 120);
    assert.equal(m.abates, 30);
    assert.equal(m.abatesMin, 15);
    assert.equal(m.xpPokeMin, 3000);
    assert.equal(m.ouroBrutoMin, 1500);
    assert.equal(m.lucroLiqMin, 1200);
    assert.equal(m.pocoesMin, 1);
    assert.equal(m.pokemon, 'Charmander Nv16');
    assert.equal(m.segura, true);
});

test('métricas: sem painel cai para o log de combate; revive, poções demais ou HP baixo tornam insegura', () => {
    const s = session({ logKills: 6, logXpPoke: 600, logGold: 300 });
    const m = computeMetrics(s, FARM, 1_000_000 + 60_000);
    assert.deepEqual({ k: m.abates, xp: m.xpPokeMin, lucro: m.lucroLiqMin, pocoes: m.pocoesMin }, { k: 6, xp: 600, lucro: 300, pocoes: 0 });

    const base = { startSnap: snap(), latestSnap: snap({ abates: 5 }) };
    const at = (over, snapOver = {}) =>
        computeMetrics(session({ ...base, ...over, latestSnap: snap({ abates: 5, ...snapOver }) }), FARM, 1_000_000 + 60_000).segura;
    assert.equal(at({}), true);
    assert.equal(at({}, { revivesUsados: 1 }), false);
    assert.equal(at({}, { pocoesUsadas: 3 }), false);
    assert.equal(at({ minHpPercent: 10 }), false);
});

test('métricas: tempo mínimo de 1s (sem dividir por zero) e quedas no painel não geram valores negativos', () => {
    const s = session({ startSnap: snap({ abates: 50 }), latestSnap: snap({ abates: 10 }) });
    const m = computeMetrics(s, FARM, s.startedAt);
    assert.equal(m.tempoSeg, 1);
    assert.equal(m.abates, 0);
});

test('nota da área por modo; área insegura vale 1/4', () => {
    const r = { xpPokeMin: 1000, lucroLiqMin: 400, abatesMin: 10, segura: true };
    assert.equal(scoreRecord(r, 'xp'), 1000);
    assert.equal(scoreRecord(r, 'ouro'), 400);
    assert.equal(scoreRecord(r, 'topcatch'), 10 * 100 + 1000 * 0.2);
    assert.equal(scoreRecord(r, 'equilibrado'), 1000 * 0.65 + 400 * 0.35);
    assert.equal(scoreRecord({ ...r, segura: false }, 'xp'), 250);
    assert.equal(scoreRecord({ ...r, lucroLiqMin: -50 }, 'ouro'), 0, 'lucro negativo não pontua');
});

test('amostra mínima para gravar no histórico (a não ser que force)', () => {
    assert.equal(shouldSaveMetrics({ tempoSeg: 10, abates: 9 }, FARM), false);
    assert.equal(shouldSaveMetrics({ tempoSeg: 30, abates: 2 }, FARM), false);
    assert.equal(shouldSaveMetrics({ tempoSeg: 30, abates: 3 }, FARM), true);
    assert.equal(shouldSaveMetrics({ tempoSeg: 1, abates: 0 }, FARM, true), true);
});

test('contador do painel: primeira leitura só registra; subida gera delta; queda só atualiza', () => {
    assert.deepEqual(trackCounter(null, 4), { next: 4, delta: 0 });
    assert.deepEqual(trackCounter(4, 7), { next: 7, delta: 3 });
    assert.deepEqual(trackCounter(7, 7), { next: 7, delta: 0 });
    assert.deepEqual(trackCounter(7, 2), { next: 2, delta: 0 });
});

test('passo da sessão: cria, troca ao mudar de área ou de Pokémon, ou só atualiza', () => {
    const s = session();
    assert.equal(planSessionStep(null, null, null), 'create');
    assert.equal(planSessionStep(s, { key: 'Outra · nível 9' }, { name: 'Charmander' }), 'rotate');
    assert.equal(planSessionStep(s, { key: s.regionKey }, { name: 'Charmeleon' }), 'rotate');
    assert.equal(planSessionStep(s, { key: s.regionKey }, { name: 'Charmander' }), 'update');
    assert.equal(planSessionStep(s, null, null), 'update', 'sem leitura não troca');
});

test('atualiza a sessão: nível, HP mínimo, e reinicia a base se o painel zerou', () => {
    const s = session({ startSnap: snap({ abates: 40 }), latestSnap: snap({ abates: 45 }), minHpPercent: 80 });
    updateSessionReadings(s, { level: 17, hpPercent: 55 }, snap({ abates: 2 }), 5_000_000);
    assert.equal(s.pokemonLevel, 17);
    assert.equal(s.minHpPercent, 55);
    assert.equal(s.startedAt, 5_000_000);
    assert.equal(s.startSnap.abates, 2);
    assert.equal(s.latestSnap.abates, 2);

    const t = session({ minHpPercent: 80 });
    updateSessionReadings(t, { level: 16, hpPercent: null }, snap({ abates: 1 }));
    assert.equal(t.minHpPercent, 80, 'HP desconhecido não altera');
    assert.equal(t.startSnap.abates, 1, 'sem base, adota a leitura como base');
});

test('hop depois de captura: só com Top Catch ligado, sem trava, sem shiny e fora da espera', () => {
    const cfg = { enabled: true, hopCooldownMs: 30000 };
    const st = { modalLockOwner: null, shinyAlertActive: false, lastHopAt: 0 };
    assert.equal(shouldTopCatchHop(cfg, st, 100_000), true);
    assert.equal(shouldTopCatchHop({ ...cfg, enabled: false }, st, 100_000), false);
    assert.equal(shouldTopCatchHop(cfg, { ...st, modalLockOwner: 'x' }, 100_000), false);
    assert.equal(shouldTopCatchHop(cfg, { ...st, shinyAlertActive: true }, 100_000), false);
    assert.equal(shouldTopCatchHop(cfg, { ...st, lastHopAt: 80_000 }, 100_000), false);
});

test('log de combate: abate com XP/ouro, captura e ruído', () => {
    assert.deepEqual(parseCombatLogText('Rattata derrotado! +1.250 xp pokémon +300 ouro'), { kind: 'kill', xp: 1250, gold: 300 });
    assert.deepEqual(parseCombatLogText('Rattata derrotado!'), { kind: 'kill', xp: 0, gold: 0 });
    assert.deepEqual(parseCombatLogText('Pidgey foi Capturado'), { kind: 'capture' });
    assert.equal(parseCombatLogText('Você andou'), null);
});

test('createSession: usa caçada e Pokémon, ou "Centro / Fora" sem caçada', () => {
    const { ctx } = makeCtx({ dom: { readNativeSessionPanel: () => snap({ abates: 3 }) } });
    const s = createSession(ctx, { key: 'Rota · nível 4', targetName: 'Rattata', targetLevel: 4 }, { name: 'Charmander', level: 16, types: ['FIRE'], hpPercent: 70 }, { a: 1 });
    assert.deepEqual(
        { r: s.regionKey, t: s.targetName, p: s.pokemonName, hp: s.minHpPercent, snap: s.startSnap.abates, meta: s.markerMeta },
        { r: 'Rota · nível 4', t: 'Rattata', p: 'Charmander', hp: 70, snap: 3, meta: { a: 1 } }
    );
    const none = createSession(ctx, null, null);
    assert.deepEqual({ r: none.regionKey, t: none.targetName, p: none.pokemonName, hp: none.minHpPercent }, { r: 'Centro / Fora', t: 'Nenhum', p: 'Desconhecido', hp: 100 });
});

test('persistir sessão: grava com a chave Pokémon__região; não grava em "Centro / Fora" nem sem amostra', () => {
    const { ctx, log } = makeCtx({ dom: { readNativeSessionPanel: () => null } });
    ctx.state.session = session({ startedAt: Date.now() - 120_000, logKills: 10, logXpPoke: 2000, logGold: 1000 });
    const rec = persistCurrentSession(ctx, false);
    assert.equal(rec.abates, 10);
    assert.equal(log.saved.length, 1);
    assert.equal(log.saved[0].key, 'hist');
    assert.ok(ctx.state.history['Charmander__Floresta · nível 5']);

    // mantém markerMeta anterior quando a sessão atual não tem
    ctx.state.history['Charmander__Floresta · nível 5'].markerMeta = { regionName: 'Kanto' };
    assert.deepEqual(persistCurrentSession(ctx, false).markerMeta, { regionName: 'Kanto' });

    ctx.state.session = session({ regionKey: 'Centro / Fora', logKills: 10 });
    assert.equal(persistCurrentSession(ctx, true), null);

    ctx.state.session = session({ startedAt: Date.now() - 1000, logKills: 1 });
    assert.equal(persistCurrentSession(ctx, false), null, 'amostra pequena não grava');
    assert.ok(persistCurrentSession(ctx, true), 'force grava mesmo assim');
});

test('aviso de nova versão pausa o bot e apita uma vez', () => {
    const { ctx, log } = makeCtx({ dom: { $: (sel) => (sel === '#aviso-versao' ? {} : null) } });
    checkVersionAlert(ctx);
    assert.equal(ctx.state.paused, true);
    assert.deepEqual(log.status, [['Atualização!', 'Nova versão detectada — recarregue o jogo']]);
    assert.deepEqual(log.beeps, [[520, 0.25]]);
    checkVersionAlert(ctx);
    assert.equal(log.beeps.length, 1);
});

const tickCtx = (panel, extra = {}) => {
    const hunt = { key: 'Rota · nível 4', targetName: 'Rattata', targetLevel: 4 };
    const poke = { name: 'Charmander', level: 16, types: ['FIRE'], hpPercent: 90 };
    return makeCtx({
        dom: { getCurrentHunt: () => hunt, getActivePokemon: () => poke, readNativeSessionPanel: () => panel.current, ...extra },
    });
};

test('tick: cria a sessão, conta shiny visto (com aviso sonoro) e capturas', () => {
    const panel = { current: snap({ capturas: 5, shiniesVistos: 1 }) };
    const { ctx, log } = tickCtx(panel);
    ctx.CONFIG.topCatchHop.enabled = false;
    updateFarmTelemetry(ctx); // primeira leitura: só registra
    assert.equal(ctx.state.session.regionKey, 'Rota · nível 4');
    assert.equal(ctx.state.stats.captures, 0);
    assert.equal(ctx.state.stats.shiniesSpotted, 0);

    panel.current = snap({ capturas: 7, shiniesVistos: 2 });
    updateFarmTelemetry(ctx);
    assert.equal(ctx.state.stats.captures, 2);
    assert.equal(ctx.state.stats.shiniesSpotted, 1);
    assert.deepEqual(log.beeps, [[1180, 0.25]]);
    assert.equal(ctx.state.lastActionNote, '✨ Shiny apareceu na sessão!');

    panel.current = snap({ capturas: 1, shiniesVistos: 0 }); // painel reiniciado: só atualiza a referência
    updateFarmTelemetry(ctx);
    assert.equal(ctx.state.stats.captures, 2);
    assert.equal(ctx.state.lastSessionCaptures, 1);
});

test('tick: trocou de área, grava a sessão antiga e abre uma nova', () => {
    const panel = { current: snap({ abates: 0 }) };
    let hunt = { key: 'A · nível 4', targetName: 'A', targetLevel: 4 };
    const { ctx, log } = makeCtx({
        dom: { getCurrentHunt: () => hunt, getActivePokemon: () => ({ name: 'Charmander', level: 16, types: [], hpPercent: 100 }), readNativeSessionPanel: () => panel.current },
    });
    updateFarmTelemetry(ctx);
    ctx.state.session.startedAt = Date.now() - 120_000;
    panel.current = snap({ abates: 20, xpPokemon: 2000 });
    updateFarmTelemetry(ctx); // atualiza e já grava (amostra suficiente)
    assert.equal(log.saved.length, 1);
    hunt = { key: 'B · nível 9', targetName: 'B', targetLevel: 9 };
    updateFarmTelemetry(ctx);
    assert.equal(ctx.state.session.regionKey, 'B · nível 9');
    assert.ok(ctx.state.history['Charmander__A · nível 4']);
    assert.equal(log.saved.length, 2, 'gravou a sessão antiga ao trocar');
});

test('tick: com a farm desligada ou o bot parado não faz nada', () => {
    const { ctx } = tickCtx({ current: snap() });
    ctx.CONFIG.farm.enabled = false;
    updateFarmTelemetry(ctx);
    assert.equal(ctx.state.session, null);
    ctx.CONFIG.farm.enabled = true;
    ctx.state.running = false;
    updateFarmTelemetry(ctx);
    assert.equal(ctx.state.session, null);
});

test('tick: captura nova dispara o hop do Top Catch depois de 1s, uma vez por cooldown', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 });
    try {
        const panel = { current: snap({ capturas: 1 }) };
        const { ctx, log } = tickCtx(panel);
        updateFarmTelemetry(ctx);
        panel.current = snap({ capturas: 2 });
        updateFarmTelemetry(ctx);
        assert.equal(ctx.state.lastHopAt, 1_700_000_000_000);
        assert.deepEqual(log.locks, [], 'ainda não rodou: espera 1s');
        mock.timers.tick(1000);
        assert.deepEqual(log.locks, ['TopCatch Hop']);

        panel.current = snap({ capturas: 3 });
        updateFarmTelemetry(ctx); // dentro do cooldown de 30s
        mock.timers.tick(1000);
        assert.deepEqual(log.locks, ['TopCatch Hop']);
        assert.equal(ctx.state.stats.captures, 2);
    } finally {
        mock.timers.reset();
    }
});

test('observador do log de combate: conta abates/ouro/XP e capturas; dispose desconecta', () => {
    const observers = [];
    globalThis.MutationObserver = class {
        constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); }
        observe(node, opts) { this.node = node; this.opts = opts; }
        disconnect() { this.disconnected = true; }
    };
    try {
        const logNode = { id: 'hud-log' };
        const { ctx } = makeCtx({ dom: { $: (sel) => (sel === '#hud-log' ? logNode : null) } });
        ctx.state.session = session();
        ensureCombatLogObserver(ctx);
        ensureCombatLogObserver(ctx); // mesmo nó: não recria
        assert.equal(observers.length, 1);
        assert.deepEqual(observers[0].opts, { childList: true });

        const el = (textContent, nodeType = 1) => ({ nodeType, textContent });
        observers[0].cb([{ addedNodes: [el('Rattata derrotado! +100 xp pokémon +30 ouro'), el('Pidgey capturado!'), el('texto', 3)] }]);
        assert.deepEqual({ k: ctx.state.session.logKills, xp: ctx.state.session.logXpPoke, g: ctx.state.session.logGold, c: ctx.state.stats.captures }, { k: 1, xp: 100, g: 30, c: 1 });

        telemetry.dispose(ctx);
        assert.equal(observers[0].disconnected, true);
        assert.equal(ctx.state.logObserver, null);
    } finally {
        delete globalThis.MutationObserver;
    }
});

test('telemetria: registra no runtime com o período da config e liga o observador no init', () => {
    let attached = 0;
    globalThis.MutationObserver = class { observe() { attached++; } disconnect() {} };
    try {
        const { ctx } = makeCtx({ dom: { $: (sel) => (sel === '#hud-log' ? {} : null) } });
        const rt = createRuntime(ctx);
        rt.register(telemetry);
        assert.deepEqual(rt.scheduler.list(), ['telemetry']);
        assert.equal(attached, 1);
        rt.dispose();
    } finally {
        delete globalThis.MutationObserver;
    }
});
