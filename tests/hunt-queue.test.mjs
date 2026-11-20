import test from 'node:test';
import assert from 'node:assert/strict';
import {
    huntQueue,
    normalizeQueueList,
    findQueueMatch,
    pickSafeFallback,
    definirFilaHunt,
    loadManualQueue,
    limparFilaHunt,
    buildHuntQueueItems,
    syncHuntGuideQueue,
    irProximaHuntGuia,
} from '../src/modules/hunt-queue.js';
import { makeCtx, makeMapGame } from './fake-ctx.mjs';

const REGIONS = {
    Kanto: [{ level: 5, title: 'Rota 1' }, { level: 10, title: 'Floresta de Viridian' }, { level: 10, title: 'Monte Lua' }],
    Johto: [{ level: 12, title: 'Rota 29' }],
};

const setup = (opts = {}) => {
    const { game, dom } = makeMapGame(REGIONS, opts);
    const made = makeCtx({ dom });
    return { game, ...made };
};

const cand = (regionName, areaLevel, over = {}) => ({ regionName, areaLevel, title: '', isCurrent: false, ...over });

test('normaliza a lista: texto vira entrada com nível e modo; objetos mantêm campos; nomes vazios saem', () => {
    const out = normalizeQueueList(['Kakuna Nv 10', { name: '  Viridian ', areaLevel: 3 }, '', { name: '' }, null], 'ouro');
    assert.deepEqual(out, [
        { name: 'Kakuna', level: 10, raw: 'Kakuna Nv 10', mode: 'ouro' },
        { name: 'Viridian', areaLevel: 3 },
    ]);
});

test('casar entrada da fila: markerMeta direto, região, título e preferência pelo nível', () => {
    const meta = { regionName: 'X' };
    assert.equal(findQueueMatch({ name: 'qualquer', markerMeta: meta }, []), meta);

    const list = [cand('Kanto', 5, { title: 'Rota 1' }), cand('Kanto', 10, { title: 'Floresta de Viridian' }), cand('Johto', 12, { title: 'Rota 29' })];
    assert.equal(findQueueMatch({ name: 'johto' }, list), list[2], 'por nome da região');
    assert.equal(findQueueMatch({ name: 'Floresta' }, list), list[1], 'por título (sem acento/caixa)');
    assert.equal(findQueueMatch({ name: 'Kanto', level: 10 }, list), list[1], 'região com vários níveis: prefere o pedido');
    assert.equal(findQueueMatch({ name: 'Kanto', level: 99 }, list), list[0], 'nível inexistente: primeira da região');
    assert.equal(findQueueMatch({ name: 'Sinnoh' }, list), null);
    assert.equal(findQueueMatch({ name: '   ' }, list), null);
    assert.equal(findQueueMatch({ name: 'x', regionName: 'johto' }, list), list[2], 'regionName tem prioridade sobre name');
    assert.equal(findQueueMatch({ name: 'Kanto Central' }, list), list[0], 'nome da região contido no que veio do Hub');
});

test('fallback seguro: não é a área atual, nível até o do Pokémon, prefere o nível pedido', () => {
    const list = [cand('A', 30), cand('B', 8, { isCurrent: true }), cand('C', 6), cand('D', 12)];
    assert.equal(pickSafeFallback({ level: 12 }, list, { level: 16 }), list[3]);
    assert.equal(pickSafeFallback({ level: 99 }, list, { level: 16 }), list[2], 'sem o nível pedido: primeira elegível');
    assert.equal(pickSafeFallback(null, list, { level: 7 }), list[2]);
    assert.equal(pickSafeFallback({}, list, { level: 2 }), null, 'nenhuma abaixo do nível');
    assert.equal(pickSafeFallback({}, [cand('A', 99)], null).areaLevel, 99);
});

test('definirFilaHunt: aceita strings/objetos, zera o índice, grava e atualiza o HUD', () => {
    const { ctx, log } = makeCtx({});
    ctx.state.huntQueueIndex = 3;
    const out = definirFilaHunt(ctx, ['Kakuna Nv 10', 'Magnemite']);
    assert.equal(out.length, 2);
    assert.equal(ctx.state.huntQueueIndex, 0);
    assert.equal(ctx.state.lastActionNote, 'Fila /hunt: 2 áreas');
    assert.equal(log.saved.at(-1).key, 'queue');
    assert.equal(log.saved.at(-1).value.items.length, 2);
    assert.equal(log.huds, 1);
    assert.deepEqual(definirFilaHunt(ctx, 'não é lista'), []);
    assert.equal(ctx.state.huntQueue.length, 2, 'entrada inválida não mexe na fila');
});

const withBox = (ctx, value) => {
    ctx.state.hudEl = { querySelector: (sel) => (sel === '#pb-manual-queue' ? { value } : null) };
};

test('fila manual: lê a caixa do HUD, monta a fila e avisa o próximo', async () => {
    const { ctx } = makeCtx({});
    withBox(ctx, '1. Kakuna Nv 10 38,1 mil XP/h ✓ 6%\n2. Magnemite Nv 10 ⚠ 9%');
    assert.equal(await loadManualQueue(ctx, false), true);
    assert.deepEqual(ctx.state.huntQueue.map((e) => e.name), ['Kakuna', 'Magnemite']);
    assert.equal(ctx.state.lastActionNote, 'Fila /hunt: 2 itens (próx: Kakuna)');
});

test('fila manual: caixa vazia avisa; com "ir agora" e fila existente vai para a próxima área', async () => {
    const a = makeCtx({});
    withBox(a.ctx, '  ');
    assert.equal(await loadManualQueue(a.ctx, false), false);
    assert.equal(a.ctx.state.lastActionNote, 'Cole ao menos 1 área válida');

    const b = makeCtx({});
    b.ctx.state.huntQueue = [{ name: 'Kakuna' }];
    withBox(b.ctx, '');
    await loadManualQueue(b.ctx, true);
    assert.deepEqual(b.log.locks, ['Fila /hunt']);

    const c = makeCtx({});
    withBox(c.ctx, 'Kakuna Nv 10');
    await loadManualQueue(c.ctx, true);
    assert.deepEqual(c.log.locks, ['Fila /hunt'], 'monta e vai');
    assert.equal(c.ctx.state.huntQueue.length, 1);

    const d = makeCtx({});
    d.ctx.state.hudEl = null;
    assert.equal(await loadManualQueue(d.ctx), false, 'sem HUD montado');
});

test('limpar fila: zera lista e índice e grava', () => {
    const { ctx, log } = makeCtx({});
    ctx.state.huntQueue = [{ name: 'a' }];
    ctx.state.huntQueueIndex = 1;
    limparFilaHunt(ctx);
    assert.deepEqual([ctx.state.huntQueue, ctx.state.huntQueueIndex, ctx.state.lastActionNote], [[], 0, 'Fila /hunt limpa']);
    assert.deepEqual(log.saved.at(-1).value.items, []);
});

test('montar fila pelo mapa: até 8 áreas, com meta do marcador e modo atual', async () => {
    const { ctx, game } = setup();
    const items = await buildHuntQueueItems(ctx);
    assert.deepEqual(items.map((i) => `${i.name}:${i.areaLevel}`), ['Johto:12', 'Kanto:10', 'Kanto:10', 'Kanto:5']);
    assert.equal(items[0].markerMeta.regionName, 'Johto');
    assert.equal(items[0].mode, 'xp');
    assert.equal(game.modalOpen, false);

    const none = makeCtx({});
    assert.deepEqual(await buildHuntQueueItems(none.ctx), [], 'sem botão de mapa');
});

test('sync da fila: usa o lock "Montando fila", adota o resultado e avisa quando não acha nada', async () => {
    const a = setup();
    const out = await syncHuntGuideQueue(a.ctx, true);
    assert.equal(a.log.locks[0], 'Montando fila');
    assert.equal(out.length, 4);
    assert.equal(a.ctx.state.lastActionNote, 'Fila /hunt pronta (4 áreas)');
    assert.equal(a.ctx.state.huntQueueIndex, 0);

    const b = makeCtx({});
    b.ctx.state.lastActionNote = 'x';
    await syncHuntGuideQueue(b.ctx);
    assert.equal(b.ctx.state.lastActionNote, 'Nenhuma área encontrada para a fila');

    const c = makeCtx({});
    c.ctx.state.lastActionNote = 'Guia /hunt: algo';
    await syncHuntGuideQueue(c.ctx);
    assert.equal(c.ctx.state.lastActionNote, 'Guia /hunt: algo', 'mantém o aviso do guia');
});

test('próxima da fila: viaja para o 1º marcador que casa, avança o índice e abre nova sessão', async () => {
    const { ctx, game, log } = setup();
    ctx.state.huntQueue = [{ name: 'Sinnoh' }, { name: 'Floresta' }, { name: 'Rota 29' }];
    ctx.state.huntQueueIndex = 0;
    assert.equal(await irProximaHuntGuia(ctx, true), true);
    assert.deepEqual(game.clicks, ['Kanto#1']);
    assert.equal(ctx.state.huntQueueIndex, 2, 'índice depois da entrada usada');
    assert.equal(ctx.state.lastActionNote, 'Fila -> Kanto Nv10');
    assert.equal(ctx.state.session.markerMeta.regionName, 'Kanto');
    assert.equal(log.saved.at(-1).value.index, 2);
    assert.deepEqual(log.locks, ['Fila /hunt']);

    // dá a volta na fila
    ctx.state.huntQueueIndex = 2;
    game.current = null;
    await irProximaHuntGuia(ctx, false);
    assert.equal(game.clicks.at(-1), 'Johto#0');
    assert.equal(ctx.state.huntQueueIndex, 0);
});

test('próxima da fila: sem match usa a área segura (não atual, nível <= Pokémon) e avança 1', async () => {
    const { ctx, game } = setup({ current: { region: 'Kanto', idx: 0 } });
    ctx.state.huntQueue = [{ name: 'Pidgey Nv 12', level: 12 }, { name: 'Outro' }];
    assert.equal(await irProximaHuntGuia(ctx, true), true);
    assert.deepEqual(game.clicks, ['Johto#0'], 'pediu nível 12: área segura de nível 12');
    assert.equal(ctx.state.huntQueueIndex, 1);
    assert.match(ctx.state.lastActionNote, /^Fila sem match \(Pidgey Nv 12\) -> fallback Johto Nv12$/);
});

test('próxima da fila: fallback desligado ou fila vazia sem mapa não viaja', async () => {
    const a = setup();
    a.ctx.CONFIG.huntQueue.fallbackToSafeArea = false;
    a.ctx.state.huntQueue = [{ name: 'Sinnoh' }];
    assert.equal(await irProximaHuntGuia(a.ctx, true), false);
    assert.equal(a.ctx.state.lastActionNote, 'Fila /hunt: sem área elegível agora');
    assert.deepEqual(a.game.clicks, []);

    const b = makeCtx({});
    assert.equal(await irProximaHuntGuia(b.ctx, true), false);
    assert.equal(b.ctx.state.lastActionNote, 'Fila /hunt vazia');
});

test('próxima da fila: fila vazia monta pelo mapa antes de viajar', async () => {
    const { ctx, game } = setup();
    assert.equal(await irProximaHuntGuia(ctx, true), true);
    assert.equal(ctx.state.huntQueue.length, 4);
    assert.equal(game.clicks.length, 1);
    assert.equal(game.clicks[0], 'Johto#0', 'a primeira da fila montada é a de maior nível');
});

test('lock: sem force e com o bot pausado/ocupado, nada acontece', async () => {
    const { ctx } = setup();
    ctx.state.huntQueue = [{ name: 'Floresta' }];
    ctx.state.modalLockOwner = 'outro';
    assert.equal(await irProximaHuntGuia(ctx, false), null);
});

test('módulo expõe os métodos usados pelos aliases e não tem tick próprio', () => {
    assert.equal(huntQueue.id, 'huntQueue');
    for (const m of ['definirFilaHunt', 'loadManualQueue', 'limparFilaHunt', 'syncHuntGuideQueue', 'irProximaHuntGuia']) {
        assert.equal(typeof huntQueue[m], 'function', m);
    }
    assert.equal(huntQueue.tick, undefined);
});
