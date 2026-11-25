import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    XP_SHARE_HELD_ID,
    evaluateTrainerPlan,
    evaluateSniperSummary,
    evaluateSniperItemListings,
    buildSniperPokemonQueries,
    evaluateSniperPokemonListings,
} from '../src/headless/trainer-sniper.mjs';
import { createHeadlessController } from '../src/headless/gui-server.mjs';

test('trainer: escadinha (50 em 50) rotaciona Exp. Share respeitando cooldown de 60s', () => {
    const tracker = {};
    const state = {
        activeId: 10,
        items: { [XP_SHARE_HELD_ID]: 1 },
        automation: { pokemonTravado: [20, 30] },
        pokemons: [
            { id: 10, nome: 'Charizard', level: 500, slot: 0 },
            { id: 20, nome: 'Garchomp', level: 48, heldItemId: null },
            { id: 30, nome: 'Tyranitar', level: 25, heldItemId: null },
        ],
    };
    const config = {
        trainerEnabled: true,
        trainerUseExpShare: true,
        trainerUseHouses: true,
        trainerMode: 'step',
        trainerStepLevels: 50,
        trainerQueue: [
            { pokemonId: 20, targetLevel: 200 },
            { pokemonId: 30, targetLevel: 200 },
        ],
    };

    // Degrau 50: minLvl = 25 -> ceiling = 50. Ambos abaixo de 50; primeiro da fila (20) pega Exp. Share
    const r1 = evaluateTrainerPlan({ state, config, tracker, nowMs: 100_000 });
    assert.deepEqual(r1.actions, [{ t: 'xpshareheld.equipar', pokemonId: 20 }]);

    // Cooldown < 60s: nenhuma acao
    state.items[XP_SHARE_HELD_ID] = 0;
    state.pokemons[1].heldItemId = XP_SHARE_HELD_ID;
    state.pokemons[1].level = 50; // bateu o degrau 50 enquanto 30 ainda esta no 25!
    const tooSoon = evaluateTrainerPlan({ state, config, tracker, nowMs: 130_000 });
    assert.equal(tooSoon.actions.length, 0);

    // Passados 60s: remove Exp. Share de 20 para passar ao 30
    const r2 = evaluateTrainerPlan({ state, config, tracker, nowMs: 165_000 });
    assert.deepEqual(r2.actions, [{ t: 'xpshareheld.remover', pokemonId: 20 }]);

    // Mais 60s: com item na bolsa, equipa no 30
    state.items[XP_SHARE_HELD_ID] = 1;
    state.pokemons[1].heldItemId = null;
    const r3 = evaluateTrainerPlan({ state, config, tracker, nowMs: 226_000 });
    assert.deepEqual(r3.actions, [{ t: 'xpshareheld.equipar', pokemonId: 30 }]);
});

test('trainer: Casa prioriza Equipe/Colecao, rejeita Depot e preserva Pokemon fora da fila', () => {
    const tracker = {};
    const state = {
        activeId: 1,
        items: {},
        automation: { pokemonTravado: [20] },
        casa: {
            lista: [
                { id: 9, rar: 'lendaria', emUso: true, postos: [999, null] }, // 999 esta fora da fila
            ],
        },
        pokemons: [
            { id: 1, nome: 'Charizard', level: 500, slot: 0 },
            { id: 999, nome: 'Mewtwo', level: 100 }, // fora da fila
            { id: 20, nome: 'Garchomp', level: 80 }, // na colecao (travado)
            { id: 30, nome: 'Magikarp', level: 10 }, // no depot (nao entra na casa)
        ],
    };
    const config = {
        trainerEnabled: true,
        trainerUseExpShare: false,
        trainerUseHouses: true,
        trainerMode: 'sequential',
        trainerQueue: [
            { pokemonId: 30, targetLevel: 100 },
            { pokemonId: 20, targetLevel: 200 },
        ],
    };

    const res = evaluateTrainerPlan({ state, config, tracker, nowMs: 50_000 });
    assert.deepEqual(res.actions, [
        { t: 'xpshare.escolher', casaId: 9, slot: 1, pokemonId: 20 },
    ]);
});

test('sniper: consulta somente itens abaixo do teto, respeita reservas, retencao e vendedor proprio', () => {
    const tracker = {};
    const rules = [
        { id: 'r1', itemId: 70011, itemName: 'Frag. Chave', currency: 'gold', maxPrice: 50_000, maxQty: 5, boughtQty: 2, autoBuy: true, enabled: true },
        { id: 'r2', itemId: 100, itemName: 'Fire Stone', currency: 'orb', maxPrice: 10, maxQty: 0, boughtQty: 0, autoBuy: false, enabled: true },
    ];
    const resumo = {
        70011: { anuncios: 3, minGold: 45_000 },
        100: { anuncios: 1, minOrb: 25 }, // acima do teto
    };
    const sumCmds = evaluateSniperSummary({ resumo, rules, nowMs: 10_000, tracker });
    assert.deepEqual(sumCmds, [{ t: 'market.item', itemId: 70011, moeda: 'gold' }]);

    const state = { id: 42, gold: 130_000, orbs: 100 };
    const cfg = { sniperMinGoldReserve: 50_000, sniperMinOrbsReserve: 0 }; // disponivel gold = 80k
    const syncedNowMs = 1_700_000_000_000;
    const linhas = [
        { id: 'a_meu', vendedorId: 42, vendedor: 'Eu', preco: 10_000, qtd: 5 },
        { id: 'a_retido', vendedorId: 88, vendedor: 'Fulano', preco: 20_000, qtd: 2, compravelEm: syncedNowMs + 5_000 },
        { id: 'a_ok', vendedorId: 99, vendedor: 'Beltrano', preco: 35_000, qtd: 10 },
    ];

    const res = evaluateSniperItemListings({
        itemId: 70011,
        moeda: 'gold',
        linhas,
        rules,
        state,
        config: cfg,
        tracker,
        syncedNowMs,
    });
    // Disponivel = 80k -> 80k / 35k = max 2 unidades (mesmo faltando 3 na regra e tendo 10 no anuncio)
    assert.deepEqual(res.actions, [{ t: 'market.comprar', id: 'a_ok', qtd: 2, preco: 35_000, moeda: 'gold' }]);
    assert.equal(res.purchases[0].qty, 2);
    assert.equal(res.recheckAtMs, syncedNowMs + 5_150);
});

test('gui: bridge WS integra Treinador Exp. Share e Sniper de Itens ponta a ponta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokebot-tr-sn-'));
    try {
        const sentFrames = [];
        let fakeWs = null;
        const controller = createHeadlessController({
            cwd: dir,
            autoLoginOnMissingSession: false,
            disableBrowserProfileSync: true,
            liveRunner: async () => {},
            liveDisposer: () => {},
            resolveSession: () => ({
                nick: 'Gake',
                token: 'tok',
                provedor: 'google',
                dispositivo: 'uuid-test-1',
                payload: { nick: 'Gake', contaId: 1, provedor: 'google', exp: Date.now() + 3_600_000 },
                source: 'cache',
                cachePath: join(dir, 'sess.json'),
            }),
            wsFactory: () => {
                fakeWs = {
                    readyState: 1,
                    send(raw) { sentFrames.push(JSON.parse(raw)); },
                    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); },
                };
                queueMicrotask(() => {
                    fakeWs.onopen?.();
                    fakeWs.onmessage?.({
                        data: JSON.stringify({
                            t: 'welcome',
                            mercado: { catalogo: [{ id: 70011, nome: 'Frag. Chave', categoria: 'outland' }] },
                            estado: {
                                cheio: true,
                                id: 1,
                                nick: 'Gake',
                                level: 50,
                                gold: 200_000,
                                orbs: 50,
                                activeId: 10,
                                items: { 70050: 1 },
                                pokemons: [
                                    { id: 10, nome: 'Charizard', level: 200, slot: 0 },
                                    { id: 20, nome: 'Larvitar', level: 15, heldItemId: null },
                                ],
                                automation: { pokemonTravado: [20] },
                            },
                        }),
                    });
                });
                return fakeWs;
            },
        });
        try {
            await controller.start();
            await new Promise((r) => setTimeout(r, 30));
            controller.updateConfig({
                trainerEnabled: true,
                trainerQueue: [{ pokemonId: 20, targetLevel: 100 }],
                sniperEnabled: true,
                sniperRules: [{
                    id: 'r1',
                    itemId: 70011,
                    itemName: 'Frag. Chave',
                    currency: 'orb',
                    maxPrice: 10,
                    maxQty: 2,
                    autoBuy: true,
                    enabled: true,
                }],
            });
            await new Promise((r) => setTimeout(r, 20));
            assert.ok(sentFrames.some((f) => f.t === 'xpshareheld.equipar' && f.pokemonId === 20));
            assert.ok(sentFrames.some((f) => f.t === 'market.itens'));

            fakeWs.onmessage?.({
                data: JSON.stringify({ t: 'market', aba: 'itens', resumo: { 70011: { anuncios: 1, minOrb: 8 } } }),
            });
            assert.ok(sentFrames.some((f) => f.t === 'market.item' && f.itemId === 70011 && f.moeda === 'orb'));

            fakeWs.onmessage?.({
                data: JSON.stringify({
                    t: 'market',
                    aba: 'item',
                    itemId: 70011,
                    moeda: 'orb',
                    linhas: [{ id: 'lot1', vendedorId: 99, vendedor: 'Seller', preco: 8, qtd: 3 }],
                }),
            });
            assert.ok(sentFrames.some((f) => f.t === 'market.comprar' && f.id === 'lot1' && f.qtd === 2 && f.moeda === 'orb' && f.sorteioUi === 1));
            // Entrar no sorteio ainda não é compra: só conta quando o resultado chega.
            let snap = controller.getSnapshot({ includeHunts: false });
            assert.equal(snap.sniper.rules[0].boughtQty, 0);
            assert.equal(snap.sniper.rules[0].pendingQty, 2);
            assert.equal(snap.sniper.recentHits.length, 1);
            assert.equal(snap.sniper.recentHits[0].status, 'pendente');

            fakeWs.onmessage?.({ data: JSON.stringify({ t: 'batalha', ev: [{ k: 'mktSorteio', fase: 'entrou', id: 'lot1' }] }) });
            snap = controller.getSnapshot({ includeHunts: false });
            assert.equal(snap.sniper.rules[0].boughtQty, 0);
            assert.equal(snap.sniper.recentHits[0].status, 'sorteio');

            fakeWs.onmessage?.({ data: JSON.stringify({ t: 'batalha', ev: [{ k: 'mktSorteio', fase: 'fim', id: 'lot1', ok: true, qtd: 2 }] }) });
            snap = controller.getSnapshot({ includeHunts: false });
            assert.equal(snap.sniper.rules[0].boughtQty, 2);
            assert.equal(snap.sniper.rules[0].pendingQty, 0);
            assert.equal(snap.sniper.recentHits[0].status, 'comprado');
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('sniper pokemon: filtra por nivel, especie, shiny, retencao, reserva e anuncio proprio', () => {
    const tracker = {};
    const rules = [
        {
            id: 'pk1',
            kind: 'pokemon',
            speciesId: 0,
            speciesName: '',
            minLevel: 200,
            maxLevel: 500,
            onlyShiny: false,
            currency: 'gold',
            maxPrice: 300_000,
            maxQty: 1,
            boughtQty: 0,
            autoBuy: true,
            enabled: true,
        },
        {
            id: 'pk2',
            kind: 'pokemon',
            speciesId: 150,
            speciesName: 'Mewtwo',
            minLevel: 100,
            maxLevel: 0,
            onlyShiny: true,
            currency: 'orb',
            maxPrice: 50,
            maxQty: 1,
            boughtQty: 0,
            autoBuy: false,
            enabled: true,
        },
    ];

    const queries = buildSniperPokemonQueries({ rules, nowMs: 10_000, tracker, intervalMs: 30_000, force: true });
    assert.equal(queries.length, 2);
    assert.equal(queries[0].t, 'market.listar');
    assert.equal(queries[0].tipo, 'pokemon');
    assert.equal(queries[0].nivelMin, '200');
    assert.equal(queries[0].nivelMax, '500');
    assert.equal(queries[0].precoMax, '300000');
    assert.equal(queries[0].especieId, 0);
    assert.equal(queries[1].soShiny, true);
    assert.equal(queries[1].especieId, 150);

    const queriesCooldown = buildSniperPokemonQueries({ rules, nowMs: 15_000, tracker, intervalMs: 30_000, force: false });
    assert.equal(queriesCooldown.length, 0);

    const state = { id: 7, gold: 400_000, orbs: 100 };
    const cfg = { sniperMinGoldReserve: 150_000, sniperMinOrbsReserve: 0 }; // gold disp = 250k
    const syncedNowMs = 1_700_000_000_000;
    const linhas = [
        { tipo: 'pokemon', id: 'p_meu', vendedorId: 7, vendedor: 'Eu', preco: 100_000, moeda: 'gold', ficha: { speciesId: 6, nome: 'Charizard', level: 300 } },
        { tipo: 'pokemon', id: 'p_lvl_baixo', vendedorId: 11, vendedor: 'Joao', preco: 50_000, moeda: 'gold', ficha: { speciesId: 6, nome: 'Charizard', level: 199 } },
        { tipo: 'pokemon', id: 'p_retido', vendedorId: 12, vendedor: 'Maria', preco: 180_000, moeda: 'gold', compravelEm: syncedNowMs + 6_000, ficha: { speciesId: 149, nome: 'Dragonite', level: 250 } },
        { tipo: 'pokemon', id: 'p_ok', vendedorId: 13, vendedor: 'Lucas', preco: 220_000, moeda: 'gold', ficha: { speciesId: 248, nome: 'Tyranitar', level: 320 } },
        { tipo: 'pokemon', id: 'p_mew_nao_shiny', vendedorId: 14, vendedor: 'Ana', preco: 20, moeda: 'orb', ficha: { speciesId: 150, nome: 'Mewtwo', level: 150, shiny: false } },
        { tipo: 'pokemon', id: 'p_mew_shiny', vendedorId: 15, vendedor: 'Bia', preco: 45, moeda: 'orb', ficha: { speciesId: 150, nome: 'Mewtwo', level: 180, shiny: true } },
    ];

    const res = evaluateSniperPokemonListings({ linhas, rules, state, config: cfg, tracker, syncedNowMs });
    assert.deepEqual(res.actions, [{ t: 'market.comprar', id: 'p_ok', qtd: 1, preco: 220_000, moeda: 'gold' }]);
    assert.equal(res.purchases.length, 1);
    assert.equal(res.purchases[0].itemName, 'Tyranitar');
    assert.equal(res.purchases[0].level, 320);
    assert.equal(res.recheckAtMs, syncedNowMs + 6_150);
    assert.equal(res.recheckRule?.id, 'pk1');
    // p_mew_shiny disparou alerta (autoBuy: false)
    assert.ok(res.hits.some((h) => h.listingId === 'p_mew_shiny' && h.bought === false && h.shiny === true));
});

test('gui: bridge WS integra Sniper de Pokemon por nivel ponta a ponta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokebot-pk-sn-'));
    try {
        const sentFrames = [];
        let fakeWs = null;
        const controller = createHeadlessController({
            cwd: dir,
            autoLoginOnMissingSession: false,
            disableBrowserProfileSync: true,
            liveRunner: async () => {},
            liveDisposer: () => {},
            resolveSession: () => ({
                nick: 'Gake',
                token: 'tok',
                provedor: 'google',
                dispositivo: 'uuid-test-2',
                payload: { nick: 'Gake', contaId: 1, provedor: 'google', exp: Date.now() + 3_600_000 },
                source: 'cache',
                cachePath: join(dir, 'sess.json'),
            }),
            wsFactory: () => {
                fakeWs = {
                    readyState: 1,
                    send(raw) { sentFrames.push(JSON.parse(raw)); },
                    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); },
                };
                queueMicrotask(() => {
                    fakeWs.onopen?.();
                    fakeWs.onmessage?.({
                        data: JSON.stringify({
                            t: 'welcome',
                            especies: [{ id: 248, nome: 'Tyranitar' }],
                            estado: {
                                cheio: true,
                                id: 1,
                                nick: 'Gake',
                                level: 50,
                                gold: 800_000,
                                orbs: 10,
                                activeId: 10,
                                pokemons: [{ id: 10, speciesId: 6, nome: 'Charizard', level: 200, slot: 0 }],
                            },
                        }),
                    });
                });
                return fakeWs;
            },
        });
        try {
            await controller.start();
            await new Promise((r) => setTimeout(r, 30));
            controller.updateConfig({
                sniperEnabled: true,
                sniperRules: [{
                    id: 'pk_lvl300',
                    kind: 'pokemon',
                    speciesId: 0,
                    speciesName: '',
                    minLevel: 300,
                    maxLevel: 0,
                    onlyShiny: false,
                    currency: 'gold',
                    maxPrice: 500_000,
                    maxQty: 1,
                    autoBuy: true,
                    enabled: true,
                }],
            });
            await new Promise((r) => setTimeout(r, 20));
            assert.ok(sentFrames.some((f) => f.t === 'market.listar' && f.tipo === 'pokemon' && f.nivelMin === '300' && f.precoMax === '500000'));

            fakeWs.onmessage?.({
                data: JSON.stringify({
                    t: 'market',
                    aba: 'vitrine',
                    linhas: [
                        { tipo: 'pokemon', id: 'pk_low', vendedorId: 88, vendedor: 'Seller1', preco: 200_000, moeda: 'gold', ficha: { speciesId: 248, nome: 'Tyranitar', level: 250 } },
                        { tipo: 'pokemon', id: 'pk_hit', vendedorId: 89, vendedor: 'Seller2', preco: 420_000, moeda: 'gold', ficha: { speciesId: 248, nome: 'Tyranitar', level: 350 } },
                    ],
                }),
            });
            assert.ok(sentFrames.some((f) => f.t === 'market.comprar' && f.id === 'pk_hit' && f.qtd === 1 && f.preco === 420_000 && f.moeda === 'gold'));
            assert.equal(controller.getSnapshot({ includeHunts: false }).sniper.rules[0].boughtQty, 0);
            fakeWs.onmessage?.({ data: JSON.stringify({ t: 'batalha', ev: [{ k: 'marketComprado', id: 'pk_hit', descricao: 'Tyranitar' }] }) });
            const snap = controller.getSnapshot({ includeHunts: false });
            assert.equal(snap.sniper.rules[0].boughtQty, 1);
            assert.equal(snap.sniper.recentHits.length, 1);
            assert.equal(snap.sniper.recentHits[0].kind, 'pokemon');
            assert.equal(snap.sniper.recentHits[0].level, 350);
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
