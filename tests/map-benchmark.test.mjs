import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeMaxAreaLevel,
    sortCandidates,
    isTravelConfirmText,
    getMarkerSignature,
    isMapModalOpen,
    openMapModal,
    collectCandidatesFromOpenMap,
    travelToMarkerMeta,
    saveHuntQueueState,
    waitForAreaSwitchCooldown,
} from '../src/modules/map-benchmark.js';
import { makeCtx, makeMapGame } from './fake-ctx.mjs';

const REGIONS = {
    Kanto: [{ level: 5, title: 'Rota 1' }, { level: 10, title: 'Floresta de Viridian' }, { level: 40, title: 'Caverna' }],
    Johto: [{ level: 12, title: 'Rota 29' }],
};

const setup = (opts = {}, ctxOpts = {}) => {
    const { game, dom } = makeMapGame(REGIONS, opts);
    const made = makeCtx({ dom, ...ctxOpts });
    return { game, ...made };
};

test('nível máximo da área: limitado pelo treinador e pelo Pokémon ativo + margem', () => {
    assert.equal(computeMaxAreaLevel(16, 16, 5), 16);
    assert.equal(computeMaxAreaLevel(50, 16, 5), 21);
    assert.equal(computeMaxAreaLevel(null, 10, 5), 10);
});

test('ordena candidatas por nível (decrescente; crescente no Top Catch)', () => {
    const list = () => [{ areaLevel: 5 }, { areaLevel: 20 }, { areaLevel: 10 }];
    assert.deepEqual(sortCandidates(list()).map((c) => c.areaLevel), [20, 10, 5]);
    assert.deepEqual(sortCandidates(list(), true).map((c) => c.areaLevel), [5, 10, 20]);
});

test('botão de confirmação de viagem: reconhece ir/viajar/caçar/entrar', () => {
    for (const t of ['Ir', ' viajar ', 'Caçar aqui', 'Entrar']) assert.equal(isTravelConfirmText(t), true, t);
    for (const t of ['Cancelar', 'Filtros', 'Irlanda']) assert.equal(isTravelConfirmText(t), false, t);
});

test('assinatura do marcador: região, nível, posição e título', () => {
    const btn = { textContent: ' 10 ', style: { left: '12%', top: '30%' }, getAttribute: (a) => (a === 'title' ? 'Floresta' : null) };
    assert.equal(getMarkerSignature(btn, 'Kanto'), 'Kanto::10::12%,30%::Floresta');
    const bare = { textContent: '', style: {}, getAttribute: () => null };
    assert.equal(getMarkerSignature(bare, 'Kanto'), 'Kanto::0::,::');
});

test('abrir o mapa: clica no botão do menu e devolve o modal; sem botão devolve null', async () => {
    const a = setup();
    assert.equal(isMapModalOpen(a.ctx), false);
    const modal = await openMapModal(a.ctx);
    assert.ok(modal);
    assert.equal(isMapModalOpen(a.ctx), true);
    assert.equal(await openMapModal(a.ctx), modal, 'já aberto: reaproveita');

    const b = makeCtx({});
    assert.equal(await openMapModal(b.ctx), null);
});

test('candidatas: só áreas liberadas até o nível máximo, ordenadas e com marca da área atual', async () => {
    const { ctx, game } = setup({ current: { region: 'Kanto', idx: 1 } });
    const modal = await openMapModal(ctx);
    const poke = ctx.dom.getActivePokemon();
    const list = await collectCandidatesFromOpenMap(ctx, modal, poke, false, null);
    // nível máximo = min(treinador 16, 16 + 5) = 16: a Caverna (40) fica de fora
    assert.deepEqual(list.map((c) => `${c.regionName}:${c.areaLevel}`), ['Johto:12', 'Kanto:10', 'Kanto:5']);
    assert.deepEqual(list.map((c) => c.isCurrent), [false, true, false]);
    assert.equal(list[1].title, 'Floresta de Viridian');
    assert.equal(list[1].indexInRegion, 1);
    assert.match(list[1].signature, /^Kanto::10::/);
    assert.equal(game.tab, 'Johto', 'percorreu as regiões (a última fica selecionada)');

    const asc = await collectCandidatesFromOpenMap(ctx, modal, poke, false, 'Top Catch', true);
    assert.deepEqual(asc.map((c) => c.areaLevel), [5, 10, 12]);
});

test('viajar: acha o marcador pela assinatura, clica e atualiza estado e contador', async () => {
    const { ctx, game } = setup();
    const modal = await openMapModal(ctx);
    const [meta] = (await collectCandidatesFromOpenMap(ctx, modal, ctx.dom.getActivePokemon(), false, null)).filter((c) => c.areaLevel === 10);
    await ctx.dom.closeActiveModal();

    const ok = await travelToMarkerMeta(ctx, meta);
    assert.equal(ok, true);
    assert.deepEqual(game.clicks, ['Kanto#1']);
    assert.equal(ctx.state.stats.regionSwitches, 1);
    assert.equal(ctx.state.lastMarkerMeta, meta);
    assert.ok(ctx.state.lastAreaSwitchAt > 0);
    assert.equal(game.modalOpen, false, 'modal fechado no fim');
});

test('viajar: sem assinatura igual usa o índice da região; sem marcador devolve false', async () => {
    const a = setup();
    const ok = await travelToMarkerMeta(a.ctx, { regionName: 'Kanto', signature: 'x', indexInRegion: 0 });
    assert.equal(ok, true);
    assert.deepEqual(a.game.clicks, ['Kanto#0']);

    const b = setup();
    assert.equal(await travelToMarkerMeta(b.ctx, { regionName: 'Kanto', signature: 'x', indexInRegion: 9 }), false);
    assert.equal(b.game.modalOpen, false);
    assert.equal(await travelToMarkerMeta(b.ctx, { regionName: 'Sinnoh', signature: 'x', indexInRegion: 0 }), false);
    assert.equal(b.game.modalOpen, false);
});

test('viajar: já estando na área só fecha o modal e guarda a meta', async () => {
    const { ctx, game } = setup({ current: { region: 'Kanto', idx: 0 } });
    const meta = { regionName: 'Kanto', signature: 'x', indexInRegion: 0 };
    assert.equal(await travelToMarkerMeta(ctx, meta), true);
    assert.deepEqual(game.clicks, []);
    assert.equal(ctx.state.lastMarkerMeta, meta);
    assert.equal(ctx.state.stats.regionSwitches, 0);
});

test('viajar: com Shiny em campo não sai da área', async () => {
    const { ctx, game } = setup();
    ctx.CONFIG.shinyGuard.enabled = true;
    ctx.state.shinyAlertActive = true;
    assert.equal(await travelToMarkerMeta(ctx, { regionName: 'Kanto', signature: 'x', indexInRegion: 0 }), false);
    assert.equal(game.modalOpen, false);
    assert.deepEqual(game.clicks, []);
});

test('trava de troca de área: espera o que falta e avisa no HUD', async () => {
    const slept = [];
    const { ctx } = makeCtx({ sleep: async (ms) => { slept.push(ms); } });
    ctx.state.lastAreaSwitchAt = Date.now() - 500;
    await waitForAreaSwitchCooldown(ctx);
    assert.equal(slept.length, 1);
    assert.ok(slept[0] > 2000 && slept[0] <= 2500);
    assert.match(ctx.state.lastActionNote, /^Trava de área \(\d\.\ds\)$/);

    slept.length = 0;
    ctx.state.lastAreaSwitchAt = 0;
    await waitForAreaSwitchCooldown(ctx);
    assert.deepEqual(slept, []);
});

test('fila no storage: grava modo, índice, itens e hora na chave da fila', () => {
    const { ctx, log } = makeCtx({});
    ctx.state.huntQueue = [{ name: 'Kakuna' }];
    ctx.state.huntQueueIndex = 1;
    saveHuntQueueState(ctx);
    assert.equal(log.saved[0].key, 'queue');
    assert.deepEqual(
        { mode: log.saved[0].value.mode, index: log.saved[0].value.index, items: log.saved[0].value.items },
        { mode: 'xp', index: 1, items: [{ name: 'Kakuna' }] }
    );
    assert.equal(typeof log.saved[0].value.updatedAt, 'number');
});
