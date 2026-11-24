import test from 'node:test';
import assert from 'node:assert/strict';
import {
    liveRewards,
    DEFAULT_TWITCH_OFFICIALS,
    DEFAULT_KICK_OFFICIALS,
    rewardRegexForKind,
    pickCheapestReward,
    pickRewardForChannel,
    parseRewardKinds,
    resolveChannelRewardKinds,
    extractRewardHours,
    needsBuffRedeem,
    orderBuffsForRedeem,
    resolveEffectiveThresholdMin,
    resolveCrossPlatformBlocker,
    computeSmartBuffStatus,
    pickBonusGuardCandidate,
    encodeSpadePayload,
    generateUlid,
    shouldRedeemBonus,
    selectChannelsToWatch,
    checkTwitchLiveBatch,
    stepTwitchChannel,
    stepKickChannel,
    runLiveCycle,
    mergeGameWsMessage,
    parseRetryAfterMs,
    getPlatformRateLimit,
    resetLiveRateLimits,
} from '../src/modules/live-rewards.js';
import { createRuntime } from '../src/modules/runtime.js';

test('live: Retry-After aceita segundos e data sem encurtar a espera do servidor', () => {
    const now = Date.UTC(2026, 10, 24, 12);
    assert.equal(parseRetryAfterMs('900', now), 900_000);
    assert.equal(parseRetryAfterMs(new Date(now + 1_800_000).toUTCString(), now), 1_800_000);
    assert.equal(parseRetryAfterMs('inválido', now), null);
});

test('live: uma resposta 429 bloqueia requisições já enfileiradas de outras contas', async () => {
    resetLiveRateLimits();
    let calls = 0;
    const ctx = () => ({
        CONFIG: { live: {} },
        state: { stats: {} },
        net: {
            paceMs: 5,
            async fetch() {
                calls += 1;
                return { status: 429, ok: false, headers: { 'Retry-After': '900' } };
            },
        },
    });
    try {
        for (const platform of ['twitch', 'kick']) {
            const step = platform === 'twitch' ? stepTwitchChannel : stepKickChannel;
            const before = calls;
            const other = platform === 'twitch' ? 'kick' : 'twitch';
            const otherBefore = getPlatformRateLimit(other).consecutive;
            const result = await Promise.all([step(ctx(), 'a'), step(ctx(), 'b'), step(ctx(), 'c', { force: true })]);
            assert.equal(calls, before + 1, platform);
            assert.ok(result.every((item) => item.error?.includes('429')));
            assert.equal(getPlatformRateLimit(platform).consecutive, 1);
            assert.ok(getPlatformRateLimit(platform).remainingMs > 890_000);
            assert.equal(getPlatformRateLimit(other).consecutive, otherBefore);
        }
    } finally {
        resetLiveRateLimits();
    }
});

test('live: atualização só de bônus preserva a lista oficial e lista vazia substitui a anterior', () => {
    const state = {};
    const oficiais = [{ login: 'oficial', aoVivo: true }];
    mergeGameWsMessage(state, { t: 'welcome', estado: { twitch: { oficiais } } });
    mergeGameWsMessage(state, { t: 'estado', estado: { twitch: { bonus: { xp: 1 } } } });
    assert.deepEqual(state.liveGameData.twitch.oficiais, oficiais);
    mergeGameWsMessage(state, { t: 'estado', estado: { twitch: { oficiais: [] } } });
    assert.deepEqual(state.liveGameData.twitch.oficiais, []);
});

test('live: rewardRegexForKind e pickCheapestReward (Twitch e Kick)', () => {
    assert.ok(rewardRegexForKind('xp').test('Bônus +15% XP PokeIdle'));
    assert.ok(rewardRegexForKind('captura').test('Bônus de +15% Capture Boost PokeIdle'));
    assert.ok(rewardRegexForKind('shiny').test('Shiny Secret Lure PokeIdle'));

    const twRewards = [
        { id: 'r3', title: 'XP +15% 3h', prompt: 'PokeIdle', cost: 900, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'r1', title: 'XP +15% 1h', prompt: 'PokeIdle', cost: 300, isEnabled: true, isPaused: true, isInStock: true },
        { id: 'r0', title: 'XP +15% 1h', prompt: 'Outro jogo', cost: 100, isEnabled: true, isPaused: false, isInStock: true },
    ];
    assert.equal(pickCheapestReward(twRewards, 'xp', 'twitch')?.id, 'r3', 'pula pausada e outro jogo');

    const kkRewards = [
        { id: 'k1', title: 'Bônus +15% XP', description: 'PokeIdle', cost: 300, is_enabled: true, is_paused: false },
        { id: 'k2', title: 'Bônus +15% XP 3h', description: 'PokeIdle', cost: 900, is_enabled: true, is_paused: false },
    ];
    assert.equal(pickCheapestReward(kkRewards, 'xp', 'kick')?.id, 'k1');
    assert.equal(pickCheapestReward(kkRewards, 'shiny', 'kick'), null);
});

test('live: encodeSpadePayload, generateUlid, shouldRedeemBonus e selectChannelsToWatch', () => {
    const b64 = encodeSpadePayload({
        channelId: '111',
        broadcastId: '222',
        userId: '333',
        login: 'streamerA',
        game: 'Pokemon',
        gameId: '999',
    });
    const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    assert.equal(decoded[0].event, 'minute-watched');
    assert.equal(decoded[0].properties.channel_id, '111');
    assert.equal(decoded[0].properties.broadcast_id, '222');
    assert.equal(decoded[0].properties.user_id, '333');
    assert.equal(decoded[0].properties.muted, false);
    assert.equal(decoded[0].properties.hidden, false);
    assert.equal(decoded[0].properties.volume, 0.5);

    const ulid = generateUlid(1700000000000, () => 0.5);
    assert.equal(ulid.length, 26);
    assert.match(ulid, /^[0-9A-HJKMNP-TV-Z]{26}$/);

    const now = 1000000;
    assert.equal(shouldRedeemBonus({ bonus: { xp: now + 20 * 60000 } }, 'xp', 30, now), true);
    assert.equal(shouldRedeemBonus({ bonus: { xp: now + 45 * 60000 } }, 'xp', 30, now), false);

    assert.deepEqual(
        selectChannelsToWatch(
            [
                { login: 'off1', aoVivo: false, ativo: true },
                { login: 'on1', aoVivo: true, ativo: true },
                { login: 'on2', aoVivo: true, ativo: true },
                { login: 'on3', aoVivo: true, ativo: true },
            ],
            'custom1, on1',
            2
        ),
        ['custom1', 'on1']
    );
});

test('live: o baú independe da consulta de recompensas e só conta uma confirmação', async () => {
    let attempts = 0;
    const ctx = {
        CONFIG: { live: { autoClaimChest: true } },
        state: { stats: {} },
        net: {
            fetch: async (_url, opts) => {
                const { query } = JSON.parse(opts.body);
                let result;
                if (query.includes('customRewards')) {
                    result = { errors: [{ message: 'campo inválido' }] };
                } else if (query.includes('claimCommunityPoints')) {
                    attempts += 1;
                    result = { data: { claimCommunityPoints: { claim: { id: 'bonus' } } } };
                } else {
                    result = { data: { currentUser: { id: 'viewer' }, user: {
                        id: 'channel', stream: { id: 'live' },
                        channel: { self: { communityPoints: { balance: 100, availableClaim: { id: 'bonus' } } } },
                    } } };
                }
                return { ok: true, json: async () => result };
            },
        },
    };
    try {
        const status = await stepTwitchChannel(ctx, 'canal', { token: 'mock' });
        assert.equal(status.balance, 150);
        await stepTwitchChannel(ctx, 'CANAL', { token: 'mock', force: true });
        assert.equal(attempts, 1);
        assert.equal(ctx.state.stats.liveChestsClaimed, 1);
    } finally {
        liveRewards.dispose();
    }
});

test('live: stepTwitchChannel envia minute-watched, coleta baú +50 e resgata bônus', async () => {
    const requests = [];
    const mockFetch = async (url, opts = {}) => {
        requests.push({ url, method: opts.method || 'GET', body: opts.body });
        if (url === 'https://gql.twitch.tv/gql') {
            const payload = JSON.parse(opts.body);
            if (payload.operationName === 'PlaybackAccessToken') {
                return { ok: true, status: 200, json: async () => ({ data: { streamPlaybackAccessToken: null } }) };
            }
            if (payload.query.includes('claimCommunityPoints')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ data: { claimCommunityPoints: { claim: { id: 'c1' }, currentPoints: 350 } } }),
                };
            }
            if (payload.query.includes('redeemCommunityPointsCustomReward')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ data: { redeemCommunityPointsCustomReward: { redemption: { id: 'red1' } } } }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: {
                        currentUser: { id: 'u99' },
                        user: {
                            id: 'ch1',
                            stream: { id: 'br1', game: { id: 'g1', name: 'PokeIdle' } },
                            channel: {
                                self: { communityPoints: { balance: 300, availableClaim: { id: 'c1' } } },
                                communityPointsSettings: {
                                    customRewards: [
                                        { id: 'rew1', title: 'XP +15% PokeIdle', prompt: '', cost: 300, isEnabled: true, isPaused: false, isInStock: true },
                                    ],
                                },
                            },
                        },
                    },
                }),
            };
        }
        if (url.startsWith('https://www.twitch.tv/')) {
            return { ok: true, status: 200, text: async () => '<script src="https://static.twitchcdn.net/config/settings.abc.js"></script>' };
        }
        if (url.includes('/config/settings')) {
            return { ok: true, status: 200, text: async () => '{"spade_url":"https://spade.twitch.test/track"}' };
        }
        if (url === 'https://spade.twitch.test/track') {
            return { ok: true, status: 204, text: async () => '' };
        }
        return { ok: false, status: 404, text: async () => '' };
    };

    const ctx = {
        CONFIG: {
            live: {
                enabled: true,
                watchTwitch: true,
                autoClaimChest: true,
                autoRedeem: true,
                rewardType: 'xp',
                guardThresholdMin: 30,
            },
        },
        state: {
            running: true,
            lastActionNote: '',
            liveGameData: { twitch: { bonus: { xp: Date.now() + 10 * 60000 } }, kick: null, skew: 0 },
            liveStatus: { twitch: {}, kick: {} },
            stats: { liveMinutesWatched: 0, liveChestsClaimed: 0, liveRewardsRedeemed: 0 },
        },
        net: { fetch: mockFetch },
    };

    const st = await stepTwitchChannel(ctx, 'streamerX', { token: 'tok123', force: true });
    assert.equal(st.live, true);
    assert.equal(st.balance, 50, '300 + 50 (baú) - 300 (resgate)');
    assert.equal(ctx.state.stats.liveChestsClaimed, 1);
    assert.equal(ctx.state.stats.liveMinutesWatched, 1);
    assert.equal(ctx.state.stats.liveRewardsRedeemed, 1);
    assert.ok(requests.some((r) => r.url === 'https://spade.twitch.test/track' && String(r.body).startsWith('data=')));
});

test('live: stepKickChannel abre WebSocket de espectador, manda watch event e resgata bônus', async () => {
    const sentWs = [];
    const redeemed = [];
    const fakeWs = {
        readyState: 1,
        send: (msg) => sentWs.push(JSON.parse(msg)),
        close: () => { fakeWs.readyState = 3; },
    };

    const mockFetch = async (url, opts = {}) => {
        if (url.endsWith('/info')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 77, livestream: { id: 888, is_live: true, vod_id: 999 } }),
            };
        }
        if (url.includes('/viewer/v1/token')) {
            return { ok: true, status: 200, json: async () => ({ data: { token: 'vtok' } }) };
        }
        if (url.endsWith('/points')) {
            return { ok: true, status: 200, json: async () => ({ data: { points: 500 } }) };
        }
        if (url.endsWith('/rewards')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: [{ id: 'kk1', title: 'Bônus +15% XP', description: 'PokeIdle', cost: 300, is_enabled: true, is_paused: false }],
                }),
            };
        }
        if (url.endsWith('/redeem')) {
            redeemed.push(JSON.parse(opts.body));
            return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };

    const ctx = {
        CONFIG: {
            live: {
                enabled: true,
                watchKick: true,
                autoRedeem: true,
                rewardType: 'xp',
                guardThresholdMin: 30,
            },
        },
        state: {
            running: true,
            lastActionNote: '',
            liveGameData: { twitch: null, kick: { bonus: { xp: 0 } }, skew: 0 },
            liveStatus: { twitch: {}, kick: {} },
            stats: { liveMinutesWatched: 0, liveChestsClaimed: 0, liveRewardsRedeemed: 0 },
        },
        net: {
            fetch: mockFetch,
            createWebSocket: () => fakeWs,
        },
    };

    const st = await stepKickChannel(ctx, 'kicker', { token: 'ktok', force: true });
    assert.equal(st.live, true);
    assert.equal(st.wsOpen, true);
    assert.equal(st.balance, 200);
    assert.equal(ctx.state.stats.liveRewardsRedeemed, 1);
    assert.equal(ctx.state.stats.liveMinutesWatched, 2);
    assert.equal(sentWs.length, 3, 'handshake + ping + tracking.user.watch.livestream');
    assert.equal(sentWs[0].type, 'channel_handshake');
    assert.equal(sentWs[1].type, 'ping');
    assert.equal(sentWs[2].data.message.name, 'tracking.user.watch.livestream');
    assert.equal(redeemed.length, 1);
    assert.equal(redeemed[0].transaction_id.length, 26);

    liveRewards.dispose();
});

test('live: runtime registra liveRewards e runLiveCycle respeita flag enabled', async () => {
    const ctx = {
        CONFIG: { live: { enabled: false, checkIntervalMs: 30000 } },
        state: { running: true, paused: false, stats: {} },
        dom: { $: () => null },
    };
    const rt = createRuntime(ctx);
    rt.register(liveRewards);
    assert.deepEqual(rt.scheduler.list(), ['liveRewards']);
    await runLiveCycle(ctx, { force: false });
    rt.dispose();
});

test('live: DEFAULT_TWITCH_OFFICIALS, DEFAULT_KICK_OFFICIALS e checkTwitchLiveBatch', async () => {
    assert.ok(DEFAULT_TWITCH_OFFICIALS.includes('tftoddy'));
    assert.ok(DEFAULT_KICK_OFFICIALS.includes('biscoitao'));

    const ctx = {
        net: {
            fetch: async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    data: {
                        users: [
                            { login: 'tftoddy', id: '1', stream: null },
                            { login: 'cogu', id: '2', stream: { id: 's2' } },
                        ],
                    },
                }),
            }),
        },
    };
    const res = await checkTwitchLiveBatch(ctx, ['tftoddy', 'cogu']);
    assert.deepEqual(res, { tftoddy: false, cogu: true });
});

test('live: pickBonusGuardCandidate prioriza offline com saldo e depois maior saldo', () => {
    const reads = new Map([
        ['on1', { points: 800, cost: 300, paused: false }],
        ['off1', { points: 450, cost: 300, paused: false }],
        ['off2', { points: 700, cost: 300, paused: false }],
        ['off_paused', { points: 9999, cost: 300, paused: true }],
    ]);
    const liveSet = new Set(['on1']);
    const best = pickBonusGuardCandidate(['on1', 'off1', 'off2', 'off_paused'], reads, liveSet);
    assert.deepEqual(best, { channel: 'off2', points: 700, cost: 300, live: false });
});

test('live: ConfirmWithin (5 min) bloqueia duplo resgate na mesma plataforma', async () => {
    liveRewards.dispose();
    let redeemCalls = 0;
    const mockFetch = async (url, opts = {}) => {
        if (url === 'https://gql.twitch.tv/gql') {
            const payload = JSON.parse(opts.body);
            if (payload.query.includes('redeemCommunityPointsCustomReward')) {
                redeemCalls++;
                return { ok: true, status: 200, json: async () => ({ data: { redeemCommunityPointsCustomReward: { redemption: { id: 'r' } } } }) };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: {
                        currentUser: { id: 'u1' },
                        user: {
                            id: 'ch',
                            stream: null,
                            channel: {
                                self: { communityPoints: { balance: 600, availableClaim: null } },
                                communityPointsSettings: {
                                    customRewards: [{ id: 'w1', title: 'XP +15% PokeIdle', cost: 300, isEnabled: true, isPaused: false, isInStock: true }],
                                },
                            },
                        },
                    },
                }),
            };
        }
        return { ok: false, status: 404 };
    };

    const ctx = {
        CONFIG: { live: { enabled: true, autoRedeem: true, rewardType: 'xp', guardThresholdMin: 30 } },
        state: {
            running: true,
            lastActionNote: '',
            liveGameData: { twitch: { bonus: { xp: Date.now() + 5 * 60000 } }, kick: null, skew: 0 },
            liveStatus: { twitch: {}, kick: {} },
            stats: { liveRewardsRedeemed: 0 },
        },
        net: { fetch: mockFetch },
    };

    await stepTwitchChannel(ctx, 'canal1', { token: 'tok', force: false });
    await stepTwitchChannel(ctx, 'canal2', { token: 'tok', force: false });
    assert.equal(redeemCalls, 1, 'segundo canal bloqueado pela janela de confirmação de 5 min');
    assert.equal(ctx.state.stats.liveRewardsRedeemed, 1);
    liveRewards.dispose();
});

test('live: WebSocket da Kick em CONNECTING (0) envia handshake/ping/watch no evento open', async () => {
    liveRewards.dispose();
    const sent = [];
    const listeners = {};
    const ws = {
        readyState: 0,
        addEventListener: (evt, fn) => { listeners[evt] = fn; },
        send: (msg) => sent.push(JSON.parse(msg)),
        close: () => { ws.readyState = 3; },
    };

    const ctx = {
        CONFIG: { live: { enabled: true, watchKick: true, autoRedeem: false } },
        state: { running: true, paused: false, liveStatus: { twitch: {}, kick: {} }, stats: { liveMinutesWatched: 0 } },
        net: {
            fetch: async (url) => {
                if (url.endsWith('/info')) return { ok: true, status: 200, json: async () => ({ id: 55, livestream: { id: 66, is_live: true, vod_id: 77 } }) };
                if (url.includes('/viewer/v1/token')) return { ok: true, status: 200, json: async () => ({ data: { token: 't' } }) };
                return { ok: false, status: 404 };
            },
            createWebSocket: () => ws,
        },
    };

    await stepKickChannel(ctx, 'biscoitao', { token: 'ktok', force: false });
    assert.equal(sent.length, 0, 'ainda CONNECTING');

    ws.readyState = 1;
    listeners.open();
    assert.equal(sent.length, 3, 'envia handshake + ping + watch assim que abre');
    assert.equal(sent[0].type, 'channel_handshake');
    assert.equal(sent[1].type, 'ping');
    assert.equal(sent[2].data.message.name, 'tracking.user.watch.livestream');
    liveRewards.dispose();
});

test('live: runLiveCycle assiste ate 4 Twitch e 2 Kick por padrao e fecha WebSocket Kick ao reduzir maxKickSlots', async () => {
    liveRewards.dispose();
    const twPings = [];
    const closedSockets = [];
    const createdSockets = [];

    const mockFetch = async (url, opts = {}) => {
        if (url === 'https://gql.twitch.tv/gql') {
            const payload = JSON.parse(opts.body);
            if (payload.operationName === 'PlaybackAccessToken') {
                return { ok: true, status: 200, json: async () => ({ data: { streamPlaybackAccessToken: null } }) };
            }
            const login = payload.variables?.login;
            if (login) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: {
                            currentUser: { id: 'u1' },
                            user: {
                                id: `ch-${login}`,
                                stream: { id: `br-${login}`, game: { id: 'g1', name: 'PokeIdle' } },
                                channel: {
                                    self: { communityPoints: { balance: 100, availableClaim: null } },
                                    communityPointsSettings: { customRewards: [] },
                                },
                            },
                        },
                    }),
                };
            }
        }
        if (url.startsWith('https://www.twitch.tv/')) {
            return { ok: true, status: 200, text: async () => '<script src="https://static.twitchcdn.net/config/settings.abc.js"></script>' };
        }
        if (url.includes('/config/settings')) {
            return { ok: true, status: 200, text: async () => '{"spade_url":"https://spade.twitch.test/slots"}' };
        }
        if (url === 'https://spade.twitch.test/slots') {
            const b64 = decodeURIComponent(String(opts.body || '').replace(/^data=/, ''));
            const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
            twPings.push(parsed[0].properties.channel);
            return { ok: true, status: 204, text: async () => '' };
        }
        const kkMatch = url.match(/\/channels\/([^/]+)\/info$/);
        if (kkMatch) {
            const slug = decodeURIComponent(kkMatch[1]);
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: slug, livestream: { id: `ls-${slug}`, is_live: true, vod_id: `vod-${slug}` } }),
            };
        }
        if (url.includes('/viewer/v1/token')) {
            return { ok: true, status: 200, json: async () => ({ data: { token: 'vtok' } }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };

    const liveConfig = {
        enabled: true,
        watchTwitch: true,
        watchKick: true,
        autoClaimChest: false,
        autoRedeem: false,
        rewardType: 'xp',
        guardThresholdMin: 30,
        twitchToken: 'tw_tok',
        kickToken: 'kk_tok',
    };

    const ctx = {
        CONFIG: { live: liveConfig },
        dom: { $: () => null },
        state: {
            running: true,
            paused: false,
            lastActionNote: '',
            liveGameData: {
                twitch: {
                    oficiais: ['t1', 't2', 't3', 't4', 't5'].map((login) => ({ login, aoVivo: true, ativo: true })),
                },
                kick: {
                    oficiais: ['k1', 'k2', 'k3'].map((slug) => ({ slug, aoVivo: true, ativo: true })),
                },
                skew: 0,
            },
            liveStatus: { twitch: {}, kick: {} },
            stats: { liveMinutesWatched: 0, liveChestsClaimed: 0, liveRewardsRedeemed: 0 },
        },
        net: {
            fetch: mockFetch,
            createWebSocket: () => {
                const ws = {
                    readyState: 1,
                    sent: [],
                    send(msg) { this.sent.push(JSON.parse(msg)); },
                    close() { this.readyState = 3; closedSockets.push(ws); },
                };
                createdSockets.push(ws);
                return ws;
            },
        },
    };

    await runLiveCycle(ctx, { force: true });
    assert.deepEqual(twPings, ['t1', 't2', 't3', 't4'], 'Twitch padrao deve farmar ate 4 lives');
    assert.equal(createdSockets.length, 2, 'Kick padrao deve abrir 2 websockets');

    twPings.length = 0;
    liveConfig.maxTwitchSlots = 5;
    liveConfig.maxKickSlots = 1;
    await runLiveCycle(ctx, { force: true });
    assert.deepEqual(twPings, ['t1', 't2', 't3', 't4', 't5'], 'maxTwitchSlots=5 deve farmar 5 lives');
    assert.equal(closedSockets.length, 1, 'ao reduzir maxKickSlots para 1, websocket excedente (k2) deve fechar');
    liveRewards.dispose();
});

test('live: stepTwitchChannel usa getTwitchIntegrityToken ao receber IntegrityCheckFailed e coleta bau +50', async () => {
    liveRewards.dispose();
    let integrityCalls = 0;
    const claimHeaders = [];

    const mockFetch = async (url, opts = {}) => {
        if (url === 'https://gql.twitch.tv/gql') {
            const payload = JSON.parse(opts.body);
            if (payload.query.includes('claimCommunityPoints')) {
                claimHeaders.push(opts.headers?.['Client-Integrity'] || null);
                if (!opts.headers?.['Client-Integrity']) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            errors: [{ message: 'failed integrity check', extensions: { code: 'IntegrityCheckFailed' } }],
                            data: { claimCommunityPoints: null },
                            extensions: { challenge: { type: 'integrity' } },
                        }),
                    };
                }
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: { claimCommunityPoints: { claim: { id: 'chest1' }, currentPoints: 320, error: null } },
                    }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: {
                        currentUser: { id: 'u1' },
                        user: {
                            id: 'ch99',
                            stream: null,
                            channel: {
                                self: { communityPoints: { balance: 270, availableClaim: { id: 'chest1' } } },
                                communityPointsSettings: { customRewards: [] },
                            },
                        },
                    },
                }),
            };
        }
        return { ok: false, status: 404 };
    };

    const ctx = {
        CONFIG: { live: { enabled: true, autoClaimChest: true, autoRedeem: false, watchTwitch: false } },
        state: {
            running: true,
            lastActionNote: '',
            liveGameData: { twitch: null, kick: null, skew: 0 },
            liveStatus: { twitch: {}, kick: {} },
            stats: { liveChestsClaimed: 0, liveMinutesWatched: 0, liveRewardsRedeemed: 0 },
        },
        net: { fetch: mockFetch },
        getTwitchIntegrityToken: async () => {
            integrityCalls += 1;
            return { token: 'browser_int_tok_1', expiration: Date.now() + 3_600_000 };
        },
    };

    const st = await stepTwitchChannel(ctx, 'luccatv', { token: 'tw_tok', force: true });
    assert.equal(integrityCalls, 1);
    assert.deepEqual(claimHeaders, [null, 'browser_int_tok_1']);
    assert.equal(st.balance, 320);
    assert.equal(ctx.state.stats.liveChestsClaimed, 1);
    liveRewards.dispose();
});

test('live: so entra e exibe lives online (guardOnly e canais offline nao entram em liveStatus)', async () => {
    liveRewards.dispose();
    const ctx = {
        CONFIG: { live: { enabled: true, watchTwitch: true, watchKick: true, autoClaimChest: false, autoRedeem: false } },
        dom: { $: () => null },
        state: {
            running: true,
            paused: false,
            lastActionNote: '',
            liveGameData: {
                twitch: {
                    oficiais: [
                        { login: 'on_ch', aoVivo: true, ativo: true },
                        { login: 'off_ch', aoVivo: false, ativo: true },
                    ],
                },
                kick: {
                    oficiais: [{ slug: 'kk_off', aoVivo: false, ativo: true }],
                },
                skew: 0,
            },
            liveStatus: {
                twitch: { stale_off: { live: false, balance: 0 } },
                kick: { kk_stale: { live: false, balance: 0 } },
            },
            stats: { liveMinutesWatched: 0, liveChestsClaimed: 0, liveRewardsRedeemed: 0 },
        },
        net: {
            fetch: async (url, opts = {}) => {
                if (url === 'https://gql.twitch.tv/gql') {
                    const p = JSON.parse(opts.body);
                    if (p.operationName === 'PlaybackAccessToken') {
                        return { ok: true, status: 200, json: async () => ({ data: { streamPlaybackAccessToken: null } }) };
                    }
                    const login = p.variables?.login;
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: {
                                currentUser: { id: 'u1' },
                                user: {
                                    id: `id-${login}`,
                                    stream: login === 'on_ch' ? { id: 'br1', game: { id: 'g1', name: 'PokeIdle' } } : null,
                                    channel: {
                                        self: { communityPoints: { balance: 150, availableClaim: null } },
                                        communityPointsSettings: { customRewards: [] },
                                    },
                                },
                            },
                        }),
                    };
                }
                if (url.startsWith('https://www.twitch.tv/')) {
                    return { ok: true, status: 200, text: async () => '<script src="https://static.twitchcdn.net/config/settings.x.js"></script>' };
                }
                if (url.includes('/config/settings')) {
                    return { ok: true, status: 200, text: async () => '{"spade_url":"https://spade.twitch.test/on"}' };
                }
                if (url === 'https://spade.twitch.test/on') {
                    return { ok: true, status: 204, text: async () => '' };
                }
                return { ok: false, status: 404, json: async () => ({}) };
            },
        },
    };

    await stepTwitchChannel(ctx, 'off_ch', { token: 't', force: false, guardOnly: true });
    assert.equal(ctx.state.liveStatus.twitch.off_ch, undefined, 'guardOnly nao polui liveStatus');

    await runLiveCycle(ctx, { force: true });
    assert.deepEqual(Object.keys(ctx.state.liveStatus.twitch), ['on_ch'], 'apenas canal online fica em liveStatus.twitch');
    assert.deepEqual(Object.keys(ctx.state.liveStatus.kick), [], 'nenhum canal offline fica em liveStatus.kick');
    liveRewards.dispose();
});

test('live: buff por canal, multiplos buffs simultaneos e escolha de pacote (tier)', async () => {
    assert.deepEqual(parseRewardKinds('all'), ['xp', 'captura', 'shiny']);
    assert.deepEqual(parseRewardKinds('off'), []);
    assert.deepEqual(parseRewardKinds('xp,shiny'), ['xp', 'shiny']);

    const liveCfg = {
        rewardType: 'xp',
        twitchRewards: ['xp', 'shiny'],
        kickRewards: ['captura'],
        channelRewards: {
            'twitch:biscoitao': 'shiny',
            'twitch:tftoddy': 'off',
            'kick:yetz': 'all',
        },
    };
    assert.deepEqual(resolveChannelRewardKinds(liveCfg, 'twitch', 'clovaobengala'), ['xp', 'shiny']);
    assert.deepEqual(resolveChannelRewardKinds(liveCfg, 'twitch', 'biscoitao'), ['shiny']);
    assert.deepEqual(resolveChannelRewardKinds(liveCfg, 'twitch', 'tftoddy'), []);
    assert.deepEqual(resolveChannelRewardKinds(liveCfg, 'kick', 'surskity'), ['captura']);
    assert.deepEqual(resolveChannelRewardKinds(liveCfg, 'kick', 'yetz'), ['xp', 'captura', 'shiny']);

    const rewards = [
        { id: 'xp1', title: 'Bônus +15% XP PokeIdle', prompt: '1 hora', cost: 300, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'xp3', title: 'Bônus +15% XP PokeIdle (3h)', prompt: '3 horas', cost: 900, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'xp10', title: 'Bônus +15% XP PokeIdle (10h)', prompt: '10 horas', cost: 3000, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'sh1', title: 'Bônus de +15% Secret Lure', prompt: 'PokeIdle', cost: 1000, isEnabled: true, isPaused: false, isInStock: true },
    ];
    assert.equal(extractRewardHours(rewards[0]), 1);
    assert.equal(extractRewardHours(rewards[1]), 3);
    assert.equal(extractRewardHours(rewards[2]), 10);
    assert.equal(pickRewardForChannel(rewards, 'xp', 'twitch', { tier: 'cheapest', balance: 5000 })?.id, 'xp1');
    assert.equal(pickRewardForChannel(rewards, 'xp', 'twitch', { tier: 'largest', balance: 1200 })?.id, 'xp3');
    assert.equal(pickRewardForChannel(rewards, 'xp', 'twitch', { tier: 'largest', balance: 5000 })?.id, 'xp10');
    assert.equal(pickRewardForChannel(rewards, 'xp', 'twitch', { tier: '3h', balance: 5000 })?.id, 'xp3');

    // Canal com XP+Shiny resgata os 2 no mesmo passo; canal com 'off' nao resgata nada
    const redeemedIds = [];
    const mockFetch = async (url, opts = {}) => {
        if (url === 'https://gql.twitch.tv/gql') {
            const p = JSON.parse(opts.body);
            if (p.query?.includes('redeemCommunityPointsCustomReward')) {
                redeemedIds.push(p.variables?.i?.rewardID);
                return { ok: true, status: 200, json: async () => ({ data: { redeemCommunityPointsCustomReward: { redemption: { id: 'ok' } } } }) };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: {
                        currentUser: { id: 'u1' },
                        user: {
                            id: 'ch1',
                            stream: { id: 'br1', game: { id: 'g1', name: 'PokeIdle' } },
                            channel: {
                                self: { communityPoints: { balance: 2000, availableClaim: null } },
                                communityPointsSettings: { customRewards: rewards },
                            },
                        },
                    },
                }),
            };
        }
        return { ok: false, status: 404, text: async () => '' };
    };

    const ctx = {
        CONFIG: {
            live: {
                enabled: true,
                watchTwitch: false,
                autoClaimChest: false,
                autoRedeem: true,
                rewardTier: 'cheapest',
                twitchRewards: ['xp', 'shiny'],
                channelRewards: { 'twitch:bloqueado': 'off' },
                guardThresholdMin: 30,
            },
        },
        state: {
            running: true,
            lastActionNote: '',
            liveGameData: { twitch: { bonus: { xp: 0, shiny: 0 } }, kick: null, skew: 0 },
            liveStatus: { twitch: {}, kick: {} },
            stats: { liveMinutesWatched: 0, liveChestsClaimed: 0, liveRewardsRedeemed: 0 },
        },
        net: { fetch: mockFetch },
    };

    try {
        await stepTwitchChannel(ctx, 'bloqueado', { token: 'tok', force: false });
        assert.deepEqual(redeemedIds, [], 'canal em off nao resgata nada');

        await stepTwitchChannel(ctx, 'liberado', { token: 'tok', force: false });
        assert.deepEqual(redeemedIds, ['xp1', 'sh1'], 'resgata XP e Shiny no mesmo canal quando ambos vencidos');
        assert.equal(ctx.state.liveChannelBalances.twitch.liberado, 700, '2000 - 300 - 1000 = 700');
    } finally {
        liveRewards.dispose();
    }
});

test('live: gestor inteligente completa cada buff ate a meta na ordem de prioridade (XP -> Captura -> Shiny)', async () => {
    const now = 1_700_000_000_000;
    const h = (hrs) => now + hrs * 3_600_000;
    const smartCfg = { smartBalance: true, targetHours: 24, guardThresholdMin: 30 };
    assert.equal(resolveEffectiveThresholdMin(smartCfg), 1440);
    assert.equal(needsBuffRedeem(1440, smartCfg), false, '24h exatas ja atingem a meta de 24h');
    assert.equal(needsBuffRedeem(1430, smartCfg), true, '23h50m ainda falta para 24h');
    assert.equal(needsBuffRedeem(30, { smartBalance: true, targetHours: 0.5, guardThresholdMin: 30 }), true, '30m em modo manter ligado renova antes de expirar');
    assert.equal(needsBuffRedeem(34, { smartBalance: true, targetHours: 0.5, guardThresholdMin: 30 }), false, '34m ja cumpre meta de 30m');

    // XP ja tem 26h (>= 1d), Captura tem 8h, Shiny tem 2h -> completa Captura ate 24h antes de ir para Shiny
    const bonusState = { bonus: { xp: h(26), captura: h(8), shiny: h(2) } };
    assert.deepEqual(
        orderBuffsForRedeem(['xp', 'captura', 'shiny'], bonusState, smartCfg, now),
        ['captura', 'shiny', 'xp']
    );
    const st1 = computeSmartBuffStatus(['xp', 'captura', 'shiny'], bonusState, smartCfg, now);
    assert.equal(st1.nextKind, 'captura');
    assert.equal(st1.allReached, false);

    // Mesmo com Shiny zerado, XP em 4m (< 30m) tem prioridade maxima sobre Shiny
    const keepOnCfg = { smartBalance: true, targetHours: 0.5, guardThresholdMin: 30 };
    const lowXpState = { bonus: { xp: now + 4 * 60_000, captura: now + 32 * 60_000, shiny: 0 } };
    assert.deepEqual(
        orderBuffsForRedeem(['xp', 'captura', 'shiny'], lowXpState, keepOnCfg, now),
        ['xp', 'shiny', 'captura']
    );
    assert.equal(computeSmartBuffStatus(['xp', 'captura', 'shiny'], lowXpState, keepOnCfg, now).nextKind, 'xp');

    // Quando todos atingem >= 24h, allReached = true e nenhum resgate e necessario
    const fullState = { bonus: { xp: h(24), captura: h(24.5), shiny: h(30) } };
    const stFull = computeSmartBuffStatus(['xp', 'captura', 'shiny'], fullState, smartCfg, now);
    assert.equal(stFull.allReached, true);
    assert.equal(stFull.nextKind, null);

    // Pacote 'smart' respeita o deficit restante (faltam 4h -> escolhe 3h, nao 10h)
    const rewards = [
        { id: 'xp1', title: 'Bônus +15% XP PokeIdle', prompt: '1 hora', cost: 300, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'xp3', title: 'Bônus +15% XP PokeIdle (3h)', prompt: '3 horas', cost: 900, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'xp10', title: 'Bônus +15% XP PokeIdle (10h)', prompt: '10 horas', cost: 3000, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'cap1', title: 'Bônus de +15% Capture Boost', prompt: '1 hora PokeIdle', cost: 500, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'sh1', title: 'Bônus de +15% Secret Lure', prompt: '1 hora PokeIdle', cost: 1000, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'sh5', title: 'Bônus de +15% Secret Lure (5h)', prompt: '5 horas PokeIdle', cost: 5000, isEnabled: true, isPaused: false, isInStock: true },
    ];
    assert.equal(pickRewardForChannel(rewards, 'xp', 'twitch', { tier: 'smart', balance: 5000, deficitMin: 240 })?.id, 'xp3');
    assert.equal(pickRewardForChannel(rewards, 'xp', 'twitch', { tier: 'smart', balance: 5000, deficitMin: 1200 })?.id, 'xp10');
    assert.equal(pickRewardForChannel(rewards, 'xp', 'twitch', { tier: 'smart', balance: 5000, deficitMin: 1200, preferQuickTurnOn: true })?.id, 'xp1');

    // Execucao real (meta 24h): XP ja tem 26h (>= 24h), Captura tem 23h30m (falta 30m -> 1h completa 24h!), Shiny tem 2h
    // Com 1800 pts: completa Captura (+1h -> 24h30m, meta batida!) e imediatamente avanca para Shiny (+1h), pulando XP!
    const redeemed = [];
    const ctx = {
        CONFIG: {
            live: {
                enabled: true,
                watchTwitch: false,
                autoClaimChest: false,
                autoRedeem: true,
                smartBalance: true,
                targetHours: 24,
                rewardTier: 'smart',
                twitchRewards: ['xp', 'captura', 'shiny'],
                guardThresholdMin: 30,
            },
        },
        state: {
            running: true,
            lastActionNote: '',
            liveGameData: {
                twitch: { bonus: { xp: Date.now() + 26 * 3_600_000, captura: Date.now() + 23.5 * 3_600_000, shiny: Date.now() + 2 * 3_600_000 } },
                kick: null,
                skew: 0,
            },
            liveStatus: { twitch: {}, kick: {} },
            stats: { liveMinutesWatched: 0, liveChestsClaimed: 0, liveRewardsRedeemed: 0 },
        },
        net: {
            fetch: async (url, opts = {}) => {
                if (url === 'https://gql.twitch.tv/gql') {
                    const p = JSON.parse(opts.body);
                    if (p.query?.includes('redeemCommunityPointsCustomReward')) {
                        redeemed.push(p.variables?.i?.rewardID);
                        return { ok: true, status: 200, json: async () => ({ data: { redeemCommunityPointsCustomReward: { redemption: { id: 'r-ok' } } } }) };
                    }
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: {
                                currentUser: { id: 'u1' },
                                user: {
                                    id: 'ch1',
                                    stream: { id: 'br1', game: { id: 'g1', name: 'PokeIdle' } },
                                    channel: {
                                        self: { communityPoints: { balance: 1800, availableClaim: null } },
                                        communityPointsSettings: { customRewards: rewards },
                                    },
                                },
                            },
                        }),
                    };
                }
                return { ok: false, status: 404, text: async () => '' };
            },
        },
    };
    try {
        await stepTwitchChannel(ctx, 'smartch', { token: 'tok', force: false });
        assert.deepEqual(redeemed, ['cap1', 'sh1'], 'completa Captura ate 24h e so entao avanca para Shiny, pulando XP que ja tem 26h');
    } finally {
        liveRewards.dispose(ctx);
    }
});

test('live: gestor inteligente nao vaza pontos para o proximo buff antes de bater 24h na Kick e +24h na Twitch', async () => {
    liveRewards.dispose();
    const now = Date.now();
    const h = (hrs) => now + hrs * 3_600_000;
    const rewards = [
        { id: 'xp1', title: 'Bônus +15% XP PokeIdle', prompt: '1 hora', cost: 300, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'xp3', title: 'Bônus +15% XP PokeIdle (3h)', prompt: '3 horas', cost: 900, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'cap1', title: 'Bônus de +15% Capture Boost', prompt: '1 hora PokeIdle', cost: 500, isEnabled: true, isPaused: false, isInStock: true },
        { id: 'sh1', title: 'Bônus de +15% Secret Lure', prompt: '1 hora PokeIdle', cost: 1000, isEnabled: true, isPaused: false, isInStock: true },
    ];
    let balance = 1600;
    const redeemed = [];
    const mockFetch = async (url, opts = {}) => {
        if (url === 'https://gql.twitch.tv/gql') {
            const p = JSON.parse(opts.body);
            if (p.query?.includes('redeemCommunityPointsCustomReward')) {
                redeemed.push(p.variables?.i?.rewardID);
                return { ok: true, status: 200, json: async () => ({ data: { redeemCommunityPointsCustomReward: { redemption: { id: 'ok' } } } }) };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: {
                        currentUser: { id: 'u1' },
                        user: {
                            id: 'ch1',
                            stream: { id: 'br1', game: { id: 'g1', name: 'PokeIdle' } },
                            channel: {
                                self: { communityPoints: { balance, availableClaim: null } },
                                communityPointsSettings: { customRewards: rewards },
                            },
                        },
                    },
                }),
            };
        }
        return { ok: false, status: 404 };
    };

    // 1) Mesma plataforma: XP tem 45m (falta 23h15m para 24h), Captura 0m, saldo 1600 pts -> compra xp3 (900) e SEGURA os 700 restantes para XP (nao compra cap1!)
    const ctx = {
        CONFIG: {
            live: {
                enabled: true,
                watchTwitch: true,
                watchKick: true,
                twitchToken: 'tw-tok',
                kickToken: 'kk-tok',
                autoClaimChest: false,
                autoRedeem: true,
                smartBalance: true,
                targetHours: 24,
                rewardTier: 'smart',
                twitchRewards: ['xp', 'captura', 'shiny'],
                kickRewards: ['xp', 'captura', 'shiny'],
                guardThresholdMin: 30,
            },
        },
        state: {
            running: true,
            lastActionNote: '',
            liveGameData: {
                twitch: { bonus: { xp: now + 45 * 60_000, captura: 0, shiny: 0 } },
                kick: { bonus: { xp: h(12), captura: 0, shiny: 0 } },
                skew: 0,
            },
            liveStatus: { twitch: {}, kick: {} },
            stats: { liveMinutesWatched: 0, liveChestsClaimed: 0, liveRewardsRedeemed: 0 },
        },
        net: { fetch: mockFetch },
    };

    try {
        const st1 = await stepTwitchChannel(ctx, 'guaxilol1', { token: 'tw-tok', force: true });
        assert.deepEqual(redeemed, ['xp3'], 'compra maior pacote de XP (3h) e NAO vaza os 700 pts restantes em Captura');
        assert.equal(st1.balance, 700);
        assert.match(st1.smartNote, /XP/i);

        // 2) Por padrao (syncPlatforms = false): cada plataforma e independente!
        // Mesmo com Kick em 12h (< 24h) de XP, a Twitch que ja bateu 24h de XP avanca livremente para Captura!
        ctx.state.liveGameData.twitch.bonus.xp = h(24.5);
        balance = 1000;
        const stIndep = await stepTwitchChannel(ctx, 'guaxilol1', { token: 'tw-tok', force: false });
        assert.deepEqual(redeemed, ['xp3', 'cap1'], 'sem syncPlatforms, Twitch nao fica travada pela Kick e resgata Captura');
        assert.equal(stIndep.balance, 500);

        const indepStatus = computeSmartBuffStatus(
            ['xp', 'captura', 'shiny'],
            ctx.state.liveGameData.twitch,
            ctx.CONFIG.live,
            now,
            null,
            { platform: 'twitch', otherKinds: ['xp', 'captura', 'shiny'], otherBonusState: ctx.state.liveGameData.kick }
        );
        assert.equal(indepStatus.waitingPlatform, null);
        assert.equal(indepStatus.waitingKind, null);

        // 3) Com syncPlatforms = true (opcional): aguarda a outra plataforma bater a meta do buff anterior antes de avancar
        ctx.CONFIG.live.syncPlatforms = true;
        ctx.state.liveGameData.twitch.bonus.captura = h(24.5);
        balance = 1200;
        const stSynced = await stepTwitchChannel(ctx, 'guaxilol1', { token: 'tw-tok', force: false });
        assert.deepEqual(redeemed, ['xp3', 'cap1'], 'com syncPlatforms ativo, aguarda Kick bater 24h de XP antes de pegar Shiny');
        assert.match(stSynced.smartNote, /aguardando XP na Kick/i);

        const crossStatus = computeSmartBuffStatus(
            ['xp', 'captura', 'shiny'],
            ctx.state.liveGameData.twitch,
            ctx.CONFIG.live,
            now,
            null,
            { platform: 'twitch', otherKinds: ['xp', 'captura', 'shiny'], otherBonusState: ctx.state.liveGameData.kick }
        );
        assert.equal(crossStatus.nextKind, 'shiny');
        assert.equal(crossStatus.waitingPlatform, 'kick');
        assert.equal(crossStatus.waitingKind, 'xp');

        // 4) Assim que a Kick completa 24h de XP e Captura, a Twitch libera Shiny mesmo com syncPlatforms = true
        ctx.state.liveGameData.kick.bonus.xp = h(24);
        ctx.state.liveGameData.kick.bonus.captura = h(24);
        const blockerCleared = resolveCrossPlatformBlocker({
            platform: 'twitch',
            kind: 'shiny',
            configuredKinds: ['xp', 'captura', 'shiny'],
            liveConfig: ctx.CONFIG.live,
            otherBonusState: ctx.state.liveGameData.kick,
            now,
        });
        assert.equal(blockerCleared.blocked, false);
        const st3 = await stepTwitchChannel(ctx, 'guaxilol1', { token: 'tw-tok', force: false });
        assert.deepEqual(redeemed, ['xp3', 'cap1', 'sh1'], 'com 24h de XP e Captura na Kick e Twitch, libera Shiny');
        assert.equal(st3.balance, 200);
    } finally {
        liveRewards.dispose(ctx);
    }
});

test('live: isolamento multi-conta (runtimeState independente para Twitch, Kick e dispose)', async () => {
    liveRewards.dispose();
    const twPingsByToken = { tok1: [], tok2: [] };
    const kickSocketsByAccount = { acc1: [], acc2: [] };

    const makeCtx = (accKey, twTok, kkTok) => ({
        CONFIG: {
            live: {
                enabled: true,
                watchTwitch: true,
                watchKick: true,
                autoClaimChest: false,
                autoRedeem: false,
                twitchToken: twTok,
                kickToken: kkTok,
                maxTwitchSlots: 2,
                maxKickSlots: 1,
            },
        },
        dom: { $: () => null },
        state: {
            running: true,
            paused: false,
            lastActionNote: '',
            liveGameData: {
                twitch: { oficiais: [{ login: 'sharedch', aoVivo: true, ativo: true }] },
                kick: { oficiais: [{ slug: 'sharedkk', aoVivo: true, ativo: true }] },
                skew: 0,
            },
            liveStatus: { twitch: {}, kick: {} },
            stats: { liveMinutesWatched: 0, liveChestsClaimed: 0, liveRewardsRedeemed: 0 },
        },
        net: {
            fetch: async (url, opts = {}) => {
                if (url === 'https://gql.twitch.tv/gql') {
                    const p = JSON.parse(opts.body);
                    if (p.operationName === 'PlaybackAccessToken') {
                        return { ok: true, status: 200, json: async () => ({ data: { streamPlaybackAccessToken: null } }) };
                    }
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: {
                                currentUser: { id: `u-${twTok}` },
                                user: {
                                    id: 'ch-shared',
                                    stream: { id: 'br-1', game: { id: 'g1', name: 'PokeIdle' } },
                                    channel: { self: { communityPoints: { balance: 100 } }, communityPointsSettings: { customRewards: [] } },
                                },
                            },
                        }),
                    };
                }
                if (url.startsWith('https://www.twitch.tv/')) return { ok: true, status: 200, text: async () => '<script src="https://static.twitchcdn.net/config/settings.x.js"></script>' };
                if (url.includes('/config/settings')) return { ok: true, status: 200, text: async () => '{"spade_url":"https://spade.twitch.test/multi"}' };
                if (url === 'https://spade.twitch.test/multi') {
                    twPingsByToken[twTok].push('sharedch');
                    return { ok: true, status: 204, text: async () => '' };
                }
                if (url.endsWith('/info')) return { ok: true, status: 200, json: async () => ({ id: 42, livestream: { id: 99, is_live: true, vod_id: 7 } }) };
                if (url.includes('/viewer/v1/token')) return { ok: true, status: 200, json: async () => ({ data: { token: `vtok-${kkTok}` } }) };
                if (url.endsWith('/points')) return { ok: true, status: 200, json: async () => ({ data: { points: 100 } }) };
                if (url.endsWith('/rewards')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
                return { ok: false, status: 404, json: async () => ({}) };
            },
            createWebSocket: (wsUrl) => {
                const ws = {
                    url: wsUrl,
                    readyState: 1,
                    closed: false,
                    send() {},
                    close() { this.closed = true; this.readyState = 3; },
                };
                kickSocketsByAccount[accKey].push(ws);
                return ws;
            },
        },
    });

    const ctx1 = makeCtx('acc1', 'tok1', 'kk1');
    const ctx2 = makeCtx('acc2', 'tok2', 'kk2');
    try {
        await Promise.all([runLiveCycle(ctx1, { force: false }), runLiveCycle(ctx2, { force: false })]);
        assert.deepEqual(twPingsByToken.tok1, ['sharedch'], 'Conta 1 envia minute-watched independente');
        assert.deepEqual(twPingsByToken.tok2, ['sharedch'], 'Conta 2 tambem envia minute-watched sem ser bloqueada pela Conta 1');
        assert.equal(kickSocketsByAccount.acc1.length, 1);
        assert.equal(kickSocketsByAccount.acc2.length, 1);
        assert.notEqual(kickSocketsByAccount.acc1[0].url, kickSocketsByAccount.acc2[0].url);

        // dispose(ctx1) fecha apenas o socket da Conta 1 e mantem a Conta 2 viva
        liveRewards.dispose(ctx1);
        assert.equal(kickSocketsByAccount.acc1[0].closed, true);
        assert.equal(kickSocketsByAccount.acc2[0].closed, false);
    } finally {
        liveRewards.dispose(ctx1);
        liveRewards.dispose(ctx2);
    }
});
