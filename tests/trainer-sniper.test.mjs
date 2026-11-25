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
            assert.ok(sentFrames.some((f) => f.t === 'market.comprar' && f.id === 'lot1' && f.qtd === 2 && f.moeda === 'orb'));
            const snap = controller.getSnapshot({ includeHunts: false });
            assert.equal(snap.sniper.rules[0].boughtQty, 2);
            assert.equal(snap.sniper.recentHits.length, 1);
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
