// Live Watcher & Auto-Redeem (Twitch e Kick): assiste sem aba de vídeo via ping/WebSocket leve,
// coleta o baú +50 na Twitch, mantém guarda de bônus (inclusive canais offline) e resgata quando vence.
import { normalizeText } from './pure.js';

export const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
export const TWITCH_GQL_URL = 'https://gql.twitch.tv/gql';
export const TWITCH_INTEGRITY_URL = 'https://gql.twitch.tv/integrity';
export const TWITCH_USHER_URL = 'https://usher.ttvnw.net';
export const TWITCH_FALLBACK_SPADE = 'https://video-edge-c2a8bc.pdx01.abs.hls.ttvnw.net/v1/segment';
const PLAYBACK_PERSISTED_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';

export const KICK_API_URL = 'https://kick.com';
export const KICK_WS_API_URL = 'https://websockets.kick.com';
export const KICK_WS_URL = 'wss://websockets.kick.com/viewer/v1/connect';
export const KICK_CLIENT_TOKEN = 'e1393935a959b4020a4491574f6490129f678acdaa92760471263db43487f823';

export const DEFAULT_TWITCH_OFFICIALS = Object.freeze([
    'tftoddy', 'clovaobengala', 'axtlol', 'patopapao', 'matta', 'guaxilol1', 'rodil',
    'cogu', 'luccatv', 'faasii', 'biscoitao', 'techzz', 'dersin2k', 'denissnidertv',
]);
export const DEFAULT_KICK_OFFICIALS = Object.freeze(['biscoitao', 'yetz', 'surskity']);

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SPADE_CACHE_MS = 6 * 3600 * 1000;
const CONFIRM_WITHIN_MS = 5 * 60 * 1000;
const RETRY_WAIT_MS = 30 * 60 * 1000;
const GUARD_READ_TTL_MS = 30 * 60 * 1000;

export const LIVE_REWARD_KINDS = Object.freeze(['xp', 'captura', 'shiny']);
export const LIVE_REWARD_TIERS = Object.freeze(['smart', 'cheapest', 'largest', '1h', '3h', '5h', '10h']);

// --- Funções puras ---

export const parseRewardKinds = (value, fallback = ['xp']) => {
    if (value == null) return [...fallback];
    if (Array.isArray(value)) {
        const seen = new Set();
        const out = [];
        for (const item of value) {
            const clean = String(item || '').trim().toLowerCase();
            if (LIVE_REWARD_KINDS.includes(clean) && !seen.has(clean)) {
                seen.add(clean);
                out.push(clean);
            }
        }
        return out;
    }
    const raw = String(value).trim().toLowerCase();
    if (!raw) return [...fallback];
    if (raw === 'off' || raw === 'none' || raw === 'nenhum') return [];
    if (raw === 'all' || raw === 'todos') return [...LIVE_REWARD_KINDS];
    const parts = raw.split(/[\s,;|+]+/).filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const part of parts) {
        if (LIVE_REWARD_KINDS.includes(part) && !seen.has(part)) {
            seen.add(part);
            out.push(part);
        }
    }
    return out.length > 0 ? out : [...fallback];
};

export const resolveChannelRewardKinds = (liveConfig = {}, platform = 'twitch', channel = '') => {
    const cfg = liveConfig && typeof liveConfig === 'object' ? liveConfig : {};
    const low = String(channel || '').trim().toLowerCase();
    const overrides = cfg.channelRewards && typeof cfg.channelRewards === 'object' ? cfg.channelRewards : null;
    if (overrides && low) {
        const specific = overrides[`${platform}:${low}`] ?? overrides[low];
        if (specific !== undefined && specific !== null && String(specific).trim() !== '') {
            return parseRewardKinds(specific, []);
        }
    }
    const platformPref = platform === 'twitch' ? cfg.twitchRewards : cfg.kickRewards;
    if (platformPref !== undefined && platformPref !== null) {
        return parseRewardKinds(platformPref, []);
    }
    return parseRewardKinds(cfg.rewardType, ['xp']);
};

export const extractRewardHours = (reward) => {
    const text = `${reward?.title || ''} ${reward?.prompt || reward?.description || ''}`;
    const paren = text.match(/\((\d+)\s*h\)/i);
    if (paren) return Number(paren[1]) || 1;
    const words = text.match(/\b(\d+)\s*horas?\b/i);
    if (words) return Number(words[1]) || 1;
    return 1;
};

export const rewardRegexForKind = (kind) => {
    if (kind === 'captura') return /\bcaptur/i;
    if (kind === 'shiny') return /\b(lure|shiny)\b/i;
    return /\bxp\b/i;
};

export const pickRewardForChannel = (
    rewards,
    kind = 'xp',
    platform = 'twitch',
    { tier = 'cheapest', balance = null, deficitMin = null, preferQuickTurnOn = false } = {}
) => {
    if (!Array.isArray(rewards) || rewards.length === 0) return null;
    const word = rewardRegexForKind(kind);

    const isTwitch = platform === 'twitch';
    const matching = rewards
        .filter((r) => {
            if (!r || typeof r !== 'object') return false;
            const enabled = isTwitch ? r.isEnabled !== false : r.is_enabled !== false;
            if (!enabled) return false;
            const title = String(r.title || '');
            const extra = String(isTwitch ? r.prompt || '' : r.description || '');
            if (!word.test(title)) return false;
            if (!/pokeidle/i.test(`${title} ${extra}`)) return false;
            return typeof r.cost === 'number' && r.cost > 0;
        })
        .sort((a, b) => a.cost - b.cost);

    if (matching.length === 0) return null;

    const isUnavailable = (r) =>
        isTwitch
            ? Boolean(r.isPaused || r.isInStock === false || r.cooldownExpiresAt)
            : Boolean(r.is_paused);

    const available = matching.filter((r) => !isUnavailable(r));
    const pool = available.length > 0 ? available : matching;
    const cleanTier = String(tier || 'cheapest').toLowerCase();

    if (cleanTier === 'smart') {
        if (preferQuickTurnOn) return pool[0];
        if (typeof balance === 'number') {
            const affordable = pool.filter((r) => r.cost <= balance);
            if (affordable.length === 0) return pool[0];
            if (typeof deficitMin === 'number' && deficitMin > 0) {
                const deficitHours = Math.max(1, Math.ceil(deficitMin / 60));
                const withinDeficit = affordable.filter((r) => extractRewardHours(r) <= deficitHours);
                if (withinDeficit.length > 0) return withinDeficit[withinDeficit.length - 1];
                return affordable[0];
            }
            return affordable[affordable.length - 1];
        }
        return pool[0];
    }

    if (cleanTier === 'largest') {
        if (typeof balance === 'number') {
            const affordable = pool.filter((r) => r.cost <= balance);
            if (affordable.length > 0) return affordable[affordable.length - 1];
        }
        return pool[0];
    }

    const hourMatch = cleanTier.match(/^(1|3|5|10)h$/);
    if (hourMatch) {
        const targetHours = Number(hourMatch[1]);
        const exact = pool.find((r) => extractRewardHours(r) === targetHours);
        if (exact) return exact;
    }

    return pool[0];
};

export const pickCheapestReward = (rewards, kind = 'xp', platform = 'twitch') =>
    pickRewardForChannel(rewards, kind, platform, { tier: 'cheapest' });

const toBase64Utf8 = (str) => {
    if (typeof TextEncoder !== 'undefined' && typeof btoa === 'function') {
        const bytes = new TextEncoder().encode(str);
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        return btoa(bin);
    }
    return btoa(str);
};

export const encodeSpadePayload = ({ channelId, broadcastId, userId, login, game, gameId }) => {
    const properties = {
        channel_id: channelId,
        broadcast_id: broadcastId,
        player: 'site',
        user_id: userId,
        live: true,
        channel: login,
        hidden: false,
        muted: false,
        volume: 0.5,
    };
    if (game && gameId) {
        properties.game = game;
        properties.game_id = gameId;
    }
    return toBase64Utf8(JSON.stringify([{ event: 'minute-watched', properties }]));
};

export const generateUlid = (now = Date.now(), rand = Math.random) => {
    let t = Math.max(0, Math.floor(now));
    let timePart = '';
    for (let i = 0; i < 10; i++) {
        timePart = ULID_ALPHABET[t % 32] + timePart;
        t = Math.floor(t / 32);
    }
    let randPart = '';
    for (let i = 0; i < 16; i++) {
        randPart += ULID_ALPHABET[Math.floor(rand() * 32) % 32];
    }
    return timePart + randPart;
};

export const getBonusRemainingMin = (bonusState, kind = 'xp', now = Date.now()) => {
    const until = Number(bonusState?.bonus?.[kind]) || 0;
    return Math.max(0, (until - now) / 60000);
};

export const shouldRedeemBonus = (bonusState, kind = 'xp', guardThresholdMin = 30, now = Date.now()) => {
    const minsLeft = getBonusRemainingMin(bonusState, kind, now);
    return minsLeft <= Math.max(0, Number(guardThresholdMin) || 0);
};

export const resolveEffectiveThresholdMin = (liveConfig = {}) => {
    const baseGuard = Math.max(0, Number(liveConfig?.guardThresholdMin ?? 30) || 0);
    if (liveConfig?.smartBalance === true) {
        const targetHours = Number(liveConfig?.targetHours ?? 24);
        if (Number.isFinite(targetHours) && targetHours > 0) {
            return Math.max(baseGuard, Math.round(targetHours * 60));
        }
    }
    return baseGuard;
};

export const orderBuffsForRedeem = (kinds = [], bonusState = null, liveConfig = {}, now = Date.now()) => {
    const list = Array.isArray(kinds) ? [...kinds] : [];
    if (list.length <= 1 || liveConfig?.smartBalance !== true) return list;
    const criticalMin = Math.max(15, Number(liveConfig?.guardThresholdMin ?? 30) || 30);
    const indexMap = new Map(list.map((k, idx) => [k, idx]));
    return list.sort((a, b) => {
        const minA = getBonusRemainingMin(bonusState, a, now);
        const minB = getBonusRemainingMin(bonusState, b, now);
        const critA = minA <= criticalMin ? 0 : 1;
        const critB = minB <= criticalMin ? 0 : 1;
        if (critA !== critB) return critA - critB;
        if (Math.abs(minA - minB) > 0.5) return minA - minB;
        return (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0);
    });
};

export const computeSmartBuffStatus = (kinds = [], bonusState = null, liveConfig = {}, now = Date.now()) => {
    const list = Array.isArray(kinds) ? kinds : [];
    const targetMin = resolveEffectiveThresholdMin(liveConfig);
    if (list.length === 0) {
        return { enabled: Boolean(liveConfig?.smartBalance), targetMin, nextKind: null, nextMin: 0, allReached: true };
    }
    const ordered = orderBuffsForRedeem(list, bonusState, { ...liveConfig, smartBalance: true }, now);
    const nextKind = ordered.find((k) => getBonusRemainingMin(bonusState, k, now) <= targetMin) || null;
    const nextMin = nextKind ? Math.round(getBonusRemainingMin(bonusState, nextKind, now)) : targetMin;
    return {
        enabled: Boolean(liveConfig?.smartBalance),
        targetMin,
        nextKind,
        nextMin,
        allReached: !nextKind,
    };
};

export const selectChannelsToWatch = (officials = [], customCsv = '', maxSlots = 2) => {
    const seen = new Set();
    const out = [];
    const add = (raw) => {
        const clean = String(raw || '').trim();
        if (!clean) return;
        const key = clean.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(clean);
    };

    String(customCsv || '')
        .split(/[\s,;]+/)
        .forEach(add);

    if (Array.isArray(officials)) {
        officials
            .filter((o) => o && o.aoVivo && o.ativo !== false)
            .forEach((o) => add(o.login || o.slug));
    }

    const cap = Math.max(1, Number(maxSlots) || 2);
    return out.slice(0, cap);
};

export const pickBonusGuardCandidate = (candidates = [], reads = new Map(), liveSet = new Set()) => {
    const getRead = (ch) => (reads instanceof Map ? reads.get(ch.toLowerCase()) || reads.get(ch) : reads?.[ch.toLowerCase()] || reads?.[ch]);
    const isLive = (ch) => (liveSet instanceof Set ? liveSet.has(ch.toLowerCase()) || liveSet.has(ch) : Boolean(liveSet?.[ch]));

    const eligible = [];
    for (const channel of candidates) {
        const r = getRead(channel);
        if (!r || r.paused) continue;
        if (typeof r.points !== 'number' || typeof r.cost !== 'number') continue;
        if (r.points < r.cost) continue;
        eligible.push({
            channel,
            points: r.points,
            cost: r.cost,
            live: isLive(channel),
        });
    }

    if (eligible.length === 0) return null;
    eligible.sort((a, b) => Number(a.live) - Number(b.live) || b.points - a.points);
    return eligible[0];
};

// --- Estado interno do módulo ---

const runtimeState = {
    spadeCache: new Map(),
    twitchLastPingAt: new Map(),
    twitchSeenSegments: new Map(),
    kickSockets: new Map(),
    kickPointsCheckAt: new Map(),
    kickTimer: null,
    lastPlatformRedeemAt: {},
    redeemRetryAt: { twitch: new Map(), kick: new Map() },
    claimRetryAt: new Map(),
    confirmedClaims: new Map(),
    guardReads: { twitch: new Map(), kick: new Map() },
    twitchIntegrityCache: { token: null, expiresAt: 0 },
    lastLiveProbeAt: { twitch: 0, kick: 0 },
    cycleInFlight: false,
    modalSyncDone: false,
};

const getPageWindow = (ctx) => ctx.pageWin || (typeof window !== 'undefined' ? window : null);

const canRedeemPlatform = (platform, kind, now, force = false) =>
    force || now - (runtimeState.lastPlatformRedeemAt[`${platform}:${kind}`] || 0) >= CONFIRM_WITHIN_MS;

const recordChannelBalance = (state, platform, channel, points) => {
    if (!state || typeof points !== 'number') return;
    if (!state.liveChannelBalances) state.liveChannelBalances = { twitch: {}, kick: {} };
    state.liveChannelBalances[platform][String(channel || '').toLowerCase()] = points;
};

const guardKey = (channel, kind) => `${String(channel || '').toLowerCase()}::${kind}`;

export const mergeGameWsMessage = (state, msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t !== 'welcome' && msg.t !== 'estado') return;
    const st = msg.estado;
    if (!st || typeof st !== 'object') return;
    if (!state.liveGameData) state.liveGameData = { twitch: null, kick: null, skew: 0 };
    if (msg.t === 'welcome' || st.cheio) {
        state.liveGameData.twitch = null;
        state.liveGameData.kick = null;
    }
    for (const platform of ['twitch', 'kick']) {
        if (!(platform in st)) continue;
        const next = st[platform];
        state.liveGameData[platform] = next ? { ...state.liveGameData[platform], ...next } : next;
    }
    if (Number(st.servidorAgora) > 0) {
        state.liveGameData.skew = Date.now() - Number(st.servidorAgora);
    }
};

export const installGameWsTap = (ctx) => {
    const win = getPageWindow(ctx);
    if (!win) return;

    const attachSocket = (ws) => {
        if (!ws || ws.__pbLiveAttached) return;
        ws.__pbLiveAttached = true;
        if (typeof ws.addEventListener === 'function') {
            ws.addEventListener('message', (ev) => {
                if (typeof ev?.data !== 'string' || !ev.data.includes('"estado"')) return;
                try {
                    mergeGameWsMessage(ctx.state, JSON.parse(ev.data));
                } catch {
                    // frame não JSON ou parcial
                }
            });
        }
    };

    if (win.__activeGameWs) attachSocket(win.__activeGameWs);
    if (win.__pkSocket) attachSocket(win.__pkSocket);

    if (!win.__pbLiveWsWrapped && typeof win.WebSocket === 'function') {
        const NativeWs = win.WebSocket;
        win.__pbLiveWsWrapped = true;
        try {
            win.WebSocket = new Proxy(NativeWs, {
                construct(target, args, newTarget) {
                    const ws = Reflect.construct(target, args, newTarget);
                    try {
                        const targetHost = win.location?.host;
                        const wsHost = new URL(String(args[0]), win.location?.href || 'https://pokeidle.io').host;
                        if (!targetHost || wsHost === targetHost) attachSocket(ws);
                    } catch {
                        // ignora URLs inválidas
                    }
                    return ws;
                },
            });
        } catch {
            // fallback sem Proxy se ambiente congelar window.WebSocket
        }
    }
};

const readDomBonusFallback = (ctx) => {
    const { dom, state } = ctx;
    if (!state.liveGameData) state.liveGameData = { twitch: null, kick: null, skew: 0 };
    const rewardType = ctx.CONFIG?.live?.rewardType || 'xp';

    const readBtn = (sel, attr, existing) => {
        const btn = dom.$(sel);
        if (!btn) return existing;
        const until = Number(btn.getAttribute?.(attr) || btn.dataset?.[attr === 'data-tw-fim' ? 'twFim' : 'kkFim'] || 0);
        if (until > 0) {
            return {
                ...(existing || {}),
                bonus: { ...(existing?.bonus || {}), [rewardType]: until },
            };
        }
        return existing;
    };

    state.liveGameData.twitch = readBtn('button.tr-ativo.twitch', 'data-tw-fim', state.liveGameData.twitch);
    state.liveGameData.kick = readBtn('button.tr-ativo.kick', 'data-kk-fim', state.liveGameData.kick);
};

export const syncChannelsFromModal = async (ctx, { force = false } = {}) => {
    const { dom, state, sleep, withModalLock } = ctx;
    if (!withModalLock) return { twitch: [], kick: [] };

    const result = { twitch: [], kick: [] };
    await withModalLock(
        'LivesSync',
        async () => {
            const sites = [
                { key: 'twitch', btnSel: 'button.tr-ativo.twitch', linkSel: 'a.tw-canal.ao-vivo', hostRe: /twitch\.tv\/([^/?#]+)/i },
                { key: 'kick', btnSel: 'button.tr-ativo.kick', linkSel: 'a.kk-canal.ao-vivo', hostRe: /kick\.com\/([^/?#]+)/i },
            ];
            for (const s of sites) {
                const btn = dom.$(s.btnSel);
                if (!btn || !dom.isInteractable(btn)) continue;
                try {
                    if (dom.getVisibleModal()) await dom.closeActiveModal();
                    btn.click();
                    const modal = await dom.waitFor(() => dom.getVisibleModal(), 2500);
                    if (modal) {
                        await sleep(220);
                        const links = Array.from(modal.querySelectorAll(s.linkSel));
                        const found = links
                            .map((a) => {
                                const href = a.getAttribute?.('href') || '';
                                const m = href.match(s.hostRe);
                                return m ? decodeURIComponent(m[1]) : null;
                            })
                            .filter(Boolean);
                        result[s.key] = found;
                        if (found.length > 0) {
                            if (!state.liveGameData) state.liveGameData = { twitch: null, kick: null, skew: 0 };
                            state.liveGameData[s.key] = {
                                ...(state.liveGameData[s.key] || {}),
                                oficiais: found.map((id) =>
                                    s.key === 'twitch' ? { login: id, aoVivo: true, ativo: true } : { slug: id, aoVivo: true, ativo: true }
                                ),
                            };
                        }
                    }
                } finally {
                    if (dom.getVisibleModal()) await dom.closeActiveModal();
                }
            }
            runtimeState.modalSyncDone = true;
            state.lastActionNote = `Lives lidas: TW=${result.twitch.length} KK=${result.kick.length}`;
        },
        { force }
    );
    return result;
};

// --- Helpers de rede ---

const netFetch = (ctx, url, opts) => {
    if (ctx.net?.fetch) return ctx.net.fetch(url, opts);
    return fetch(url, opts);
};

const normalizeKickToken = (raw) => {
    const clean = String(raw || '').trim();
    if (!clean) return '';
    if (!clean.includes('%')) return clean;
    try {
        return decodeURIComponent(clean);
    } catch {
        return clean;
    }
};

const resolveCredentials = async (ctx) => {
    const { CONFIG, net } = ctx;
    let twitchToken = (CONFIG.live?.twitchToken || '').trim();
    let twitchDeviceId = (CONFIG.live?.twitchDeviceId || '').trim();
    let kickToken = normalizeKickToken(CONFIG.live?.kickToken || '');

    if (net?.readCookie) {
        if (!twitchToken) twitchToken = (await net.readCookie('.twitch.tv', 'auth-token')) || '';
        if (!twitchDeviceId) twitchDeviceId = (await net.readCookie('.twitch.tv', 'unique_id')) || '';
        if (!kickToken) kickToken = normalizeKickToken((await net.readCookie('.kick.com', 'session_token')) || '');
    }

    return { twitchToken, twitchDeviceId, kickToken };
};

export const syncCookiesToConfig = async (ctx) => {
    const { CONFIG } = ctx;
    const creds = await resolveCredentials(ctx);
    if (!CONFIG?.live) return creds;

    let changed = false;
    if (creds.twitchToken && !CONFIG.live.twitchToken) {
        CONFIG.live.twitchToken = creds.twitchToken;
        changed = true;
    }
    if (creds.twitchDeviceId && !CONFIG.live.twitchDeviceId) {
        CONFIG.live.twitchDeviceId = creds.twitchDeviceId;
        changed = true;
    }
    if (creds.kickToken && !CONFIG.live.kickToken) {
        CONFIG.live.kickToken = creds.kickToken;
        changed = true;
    }

    if (changed) {
        (ctx.persistPrefs || ctx.storage?.persistPrefs)?.();
    }
    return creds;
};

// --- Twitch Leve ---

const twitchGqlCall = async (ctx, { token, deviceId }, payload) => {
    const headers = {
        'Client-Id': TWITCH_CLIENT_ID,
        'Content-Type': 'text/plain;charset=UTF-8',
    };
    if (token) headers.Authorization = `OAuth ${token}`;
    if (deviceId) headers['X-Device-Id'] = deviceId;

    let integrity = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        const reqHeaders = integrity ? { ...headers, 'Client-Integrity': integrity } : headers;
        const res = await netFetch(ctx, TWITCH_GQL_URL, {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify(payload),
        });
        if (!res.ok) return { failed: `erro ${res.status}` };
        const json = await res.json();
        const challenged =
            Boolean(json?.extensions?.challenge) ||
            (json?.errors || []).some((e) => e?.extensions?.code === 'IntegrityCheckFailed');
        if (!challenged) return json;

        if (integrity) {
            runtimeState.twitchIntegrityCache = { token: null, expiresAt: 0 };
            return { failed: 'checagem anti-robô da Twitch (IntegrityCheckFailed)' };
        }
        if (!token) return { failed: 'checagem anti-robô da Twitch' };

        const now = Date.now();
        if (runtimeState.twitchIntegrityCache.token && runtimeState.twitchIntegrityCache.expiresAt > now + 60_000) {
            integrity = runtimeState.twitchIntegrityCache.token;
            continue;
        }

        if (typeof ctx.getTwitchIntegrityToken === 'function') {
            try {
                const browserInt = await ctx.getTwitchIntegrityToken({ token, deviceId });
                if (browserInt?.token) {
                    integrity = browserInt.token;
                    runtimeState.twitchIntegrityCache = {
                        token: browserInt.token,
                        expiresAt: Number(browserInt.expiration) || now + 3_600_000,
                    };
                    continue;
                }
            } catch {
                // fallback para /integrity direto
            }
        }

        const intRes = await netFetch(ctx, TWITCH_INTEGRITY_URL, { method: 'POST', headers });
        const intJson = intRes.ok ? await intRes.json().catch(() => null) : null;
        if (!intJson?.token) return { failed: `checagem anti-robô (${intRes.status})` };
        integrity = intJson.token;
        runtimeState.twitchIntegrityCache = {
            token: intJson.token,
            expiresAt: Number(intJson.expiration) || now + 3_600_000,
        };
    }
    return { failed: 'sem resposta' };
};

export const checkTwitchLiveBatch = async (ctx, channels = []) => {
    const list = Array.from(new Set(channels.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean)));
    if (list.length === 0) return {};
    const res = await twitchGqlCall(ctx, { token: '', deviceId: '' }, {
        query: 'query($l:[String!]){users(logins:$l){login id stream{id}}}',
        variables: { l: list },
    });
    const users = res?.data?.users;
    if (!Array.isArray(users)) return {};
    const out = Object.fromEntries(list.map((ch) => [ch, false]));
    for (const u of users) {
        if (u?.login) out[String(u.login).toLowerCase()] = Boolean(u.stream?.id);
    }
    return out;
};

const discoverSpadeUrl = async (ctx, login) => {
    const cached = runtimeState.spadeCache.get('twitch');
    if (cached && Date.now() - cached.at < SPADE_CACHE_MS) return cached.url;

    try {
        const pageRes = await netFetch(ctx, `https://www.twitch.tv/${encodeURIComponent(login)}`, { method: 'GET' });
        if (pageRes.ok) {
            const html = await pageRes.text();
            const settingsMatch = html.match(/(https?:\/\/[^"'\s]+\/config\/settings[^"'\s]*?\.js)/);
            if (settingsMatch) {
                const cfgRes = await netFetch(ctx, settingsMatch[1], { method: 'GET' });
                if (cfgRes.ok) {
                    const js = await cfgRes.text();
                    const spadeMatch = js.match(/"spade_url"\s*:\s*"(.*?)"/);
                    if (spadeMatch) {
                        const raw = spadeMatch[1].replace(/\\\//g, '/');
                        runtimeState.spadeCache.set('twitch', { url: raw, at: Date.now() });
                        return raw;
                    }
                }
            }
        }
    } catch {
        // fallback abaixo
    }
    return TWITCH_FALLBACK_SPADE;
};

const touchTwitchHlsSegment = async (ctx, { token, deviceId }, login) => {
    try {
        const tokRes = await twitchGqlCall(
            ctx,
            { token, deviceId },
            {
                operationName: 'PlaybackAccessToken',
                variables: { login, isLive: true, isVod: false, vodID: '', playerType: 'site', platform: 'web' },
                extensions: { persistedQuery: { version: 1, sha256Hash: PLAYBACK_PERSISTED_HASH } },
            }
        );
        const access = tokRes?.data?.streamPlaybackAccessToken;
        if (!access?.value || !access?.signature) return false;

        const masterUrl =
            `${TWITCH_USHER_URL}/api/channel/hls/${encodeURIComponent(login)}.m3u8` +
            `?sig=${encodeURIComponent(access.signature)}&token=${encodeURIComponent(access.value)}` +
            `&allow_source=true&allow_audio_only=true&player=twitchweb&type=any&p=${Math.floor(Math.random() * 9000000) + 1000000}`;

        const masterRes = await netFetch(ctx, masterUrl, { method: 'GET' });
        if (!masterRes.ok) return false;
        const lines = (await masterRes.text()).replace(/\r\n/g, '\n').split('\n');
        let chosenUri = null;
        let bestBw = Infinity;
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
            const uri = lines[i + 1]?.trim();
            if (!uri || uri.startsWith('#')) continue;
            const bwMatch = lines[i].match(/(?<![-A-Z])BANDWIDTH=(\d+)/);
            const bw = bwMatch ? parseInt(bwMatch[1], 10) : Infinity;
            if (lines[i].includes('RESOLUTION=') && bw < bestBw) {
                bestBw = bw;
                chosenUri = new URL(uri, masterUrl).toString();
            } else if (!chosenUri) {
                chosenUri = new URL(uri, masterUrl).toString();
            }
        }
        if (!chosenUri) return false;

        const mediaRes = await netFetch(ctx, chosenUri, { method: 'GET' });
        if (!mediaRes.ok) return false;
        const segs = (await mediaRes.text())
            .replace(/\r\n/g, '\n')
            .split('\n')
            .filter((l) => l && !l.startsWith('#'));
        const lastSeg = segs[segs.length - 1];
        if (!lastSeg) return false;
        const segUrl = new URL(lastSeg, chosenUri).toString();
        let seen = runtimeState.twitchSeenSegments.get(login);
        if (!seen) {
            seen = new Set();
            runtimeState.twitchSeenSegments.set(login, seen);
        }
        if (seen.has(segUrl)) return true;
        seen.add(segUrl);
        if (seen.size > 100) seen.clear();
        await netFetch(ctx, segUrl, { method: 'HEAD' });
        return true;
    } catch {
        return false;
    }
};

export const stepTwitchChannel = async (ctx, login, { token = '', deviceId = '', force = false, guardOnly = false, onlyKind = null, probeOnly = false } = {}) => {
    const { CONFIG, state } = ctx;
    if (!state.liveStatus) state.liveStatus = { twitch: {}, kick: {} };
    const status = guardOnly
        ? { balance: null, live: false, lastPingAt: 0, lastRedeemAt: 0, redeemedThisStep: false, error: null }
        : (state.liveStatus.twitch[login] ||= { balance: null, live: false, lastPingAt: 0, lastRedeemAt: 0, redeemedThisStep: false, error: null });
    status.redeemedThisStep = false;

    const query =
        'query($login:String!){currentUser{id} user(login:$login){id stream{id game{id name}} ' +
        'channel{self{communityPoints{balance availableClaim{id}}} ' +
        'communityPointsSettings{customRewards{id title prompt cost isEnabled isPaused isInStock cooldownExpiresAt}}}}}';

    const credentials = { token, deviceId };
    let res = await twitchGqlCall(ctx, credentials, { query, variables: { login } });
    if (!res?.data?.user && res?.errors?.length && !guardOnly && CONFIG.live?.autoClaimChest) {
        // A consulta de recompensas personalizadas pode falhar sem invalidar o baú.
        res = await twitchGqlCall(ctx, credentials, {
            query: 'query($login:String!){currentUser{id} user(login:$login){id stream{id game{id name}} channel{self{communityPoints{balance availableClaim{id}}}}}}',
            variables: { login },
        });
    }
    if (res?.failed) {
        status.error = res.failed;
        return status;
    }

    const user = res?.data?.user;
    if (!user?.id) {
        status.error = res?.errors?.[0]?.message || 'canal não encontrado';
        return status;
    }

    const userId = res?.data?.currentUser?.id || null;
    const channelId = user.id;
    const broadcastId = user.stream?.id || null;
    const game = user.stream?.game?.name || null;
    const gameId = user.stream?.game?.id || null;
    const cp = user.channel?.self?.communityPoints;
    const rewards = user.channel?.communityPointsSettings?.customRewards || [];

    status.live = Boolean(broadcastId);
    status.error = token && !userId ? 'sessão Twitch não reconhecida' : null;
    let balance = typeof cp?.balance === 'number' ? cp.balance : null;
    const now = Date.now();
    const channelKey = login.toLowerCase();
    const tier = CONFIG.live?.rewardTier || 'cheapest';
    const configuredKinds = resolveChannelRewardKinds(CONFIG.live, 'twitch', login);
    const activeKinds = onlyKind
        ? (configuredKinds.includes(onlyKind) ? [onlyKind] : [])
        : configuredKinds;
    status.rewardKinds = configuredKinds;

    if (balance !== null) {
        recordChannelBalance(state, 'twitch', login, balance);
        for (const k of LIVE_REWARD_KINDS) {
            if (!configuredKinds.includes(k)) {
                runtimeState.guardReads.twitch.delete(guardKey(channelKey, k));
                continue;
            }
            const rew = pickRewardForChannel(rewards, k, 'twitch', { tier, balance });
            if (rew) {
                const unavail = Boolean(rew.isPaused || rew.isInStock === false || rew.cooldownExpiresAt);
                runtimeState.guardReads.twitch.set(guardKey(channelKey, k), {
                    at: now,
                    points: balance,
                    cost: rew.cost,
                    paused: unavail,
                });
            }
        }
    }

    const claimId = cp?.availableClaim?.id;
    if (cp && !claimId) status.manualChest = false;
    const canClaim = now >= (runtimeState.claimRetryAt.get(channelKey) || 0);
    if (!guardOnly && CONFIG.live?.autoClaimChest && token && claimId &&
        runtimeState.confirmedClaims.get(channelKey) !== claimId && canClaim) {
        const claimRes = await twitchGqlCall(ctx, { token, deviceId }, {
            query: 'mutation($i:ClaimCommunityPointsInput!){claimCommunityPoints(input:$i){claim{id}}}',
            variables: { i: { channelID: channelId, claimID: claimId } },
        });
        const claimData = claimRes?.data?.claimCommunityPoints;
        if (claimData?.claim?.id && !claimData.error && !claimRes?.errors?.length && !claimRes?.failed) {
            status.manualChest = false;
            runtimeState.confirmedClaims.set(channelKey, claimId);
            state.stats.liveChestsClaimed = (state.stats.liveChestsClaimed || 0) + 1;
            balance = typeof claimData.currentPoints === 'number' ? claimData.currentPoints : (balance ?? 0) + 50;
            recordChannelBalance(state, 'twitch', login, balance);
            state.lastActionNote = `Twitch baú +50 (${login})`;
        } else {
            const errCode = claimData?.error?.code || claimRes?.errors?.[0]?.message || claimRes?.failed || 'erro desconhecido';
            const isIntegrity = /integrity|anti-rob/i.test(String(errCode));
            if (isIntegrity) status.manualChest = true;
            status.error = isIntegrity
                ? 'Twitch exige o resgate do baú +50 no navegador'
                : `baú +50: ${errCode}`;
            state.lastActionNote = isIntegrity
                ? `Twitch (${login}): baú +50 exige clique no navegador`
                : `Twitch baú +50 (${login}): ${errCode}`;
            if (errCode && errCode !== 'NOT_FOUND') {
                runtimeState.claimRetryAt.set(channelKey, now + (isIntegrity ? RETRY_WAIT_MS : 60_000));
            }
        }
    }

    const lastPing = runtimeState.twitchLastPingAt.get(login) || 0;
    if (!guardOnly && CONFIG.live?.watchTwitch && broadcastId && userId && (force || now - lastPing >= 55000)) {
        const spadeUrl = await discoverSpadeUrl(ctx, login);
        const encoded = encodeSpadePayload({ channelId, broadcastId, userId, login, game, gameId });
        const pingRes = await netFetch(ctx, spadeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(encoded)}`,
        });
        if (pingRes.ok) {
            runtimeState.twitchLastPingAt.set(login, now);
            status.lastPingAt = now;
            state.stats.liveMinutesWatched = (state.stats.liveMinutesWatched || 0) + 1;
        }
        await touchTwitchHlsSegment(ctx, { token, deviceId }, login);
    }

    const canRetryRedeem = force || now >= (runtimeState.redeemRetryAt.twitch.get(login) || 0);
    if (!probeOnly && CONFIG.live?.autoRedeem && token && balance !== null && canRetryRedeem && activeKinds.length > 0) {
        const serverNow = Date.now() - (state.liveGameData?.skew || 0);
        const bonusState = state.liveGameData?.twitch;
        const thresholdMin = resolveEffectiveThresholdMin(CONFIG.live);
        const criticalMin = Math.max(15, Number(CONFIG.live?.guardThresholdMin ?? 30) || 30);
        const orderedKinds = orderBuffsForRedeem(activeKinds, bonusState, CONFIG.live, serverNow);
        const criticalPending = new Set(
            orderedKinds.filter((k) => getBonusRemainingMin(bonusState, k, serverNow) <= criticalMin)
        );
        for (const kind of orderedKinds) {
            if (!canRedeemPlatform('twitch', kind, now, force)) continue;
            const remainingMin = getBonusRemainingMin(bonusState, kind, serverNow);
            const needsRedeem = force || remainingMin <= thresholdMin;
            if (!needsRedeem) continue;
            const deficitMin = Math.max(0, thresholdMin - remainingMin);
            const preferQuickTurnOn = CONFIG.live?.smartBalance === true &&
                criticalPending.has(kind) && criticalPending.size > 1;
            const reward = pickRewardForChannel(rewards, kind, 'twitch', {
                tier,
                balance,
                deficitMin,
                preferQuickTurnOn,
            });
            const unavailable = reward ? Boolean(reward.isPaused || reward.isInStock === false || reward.cooldownExpiresAt) : true;
            if (!reward || unavailable || balance < reward.cost) continue;

            const txId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
            const redRes = await twitchGqlCall(ctx, { token, deviceId }, {
                query: 'mutation($i:RedeemCommunityPointsCustomRewardInput!){redeemCommunityPointsCustomReward(input:$i){redemption{id} error{code}}}',
                variables: {
                    i: {
                        channelID: channelId,
                        cost: reward.cost,
                        prompt: reward.prompt ?? null,
                        rewardID: reward.id,
                        title: reward.title,
                        transactionID: txId,
                    },
                },
            });
            const p = redRes?.data?.redeemCommunityPointsCustomReward;
            if (p?.redemption?.id && !p.error && !redRes?.errors?.length) {
                balance -= reward.cost;
                criticalPending.delete(kind);
                recordChannelBalance(state, 'twitch', login, balance);
                status.lastRedeemAt = now;
                status.redeemedThisStep = true;
                runtimeState.lastPlatformRedeemAt[`twitch:${kind}`] = now;
                state.stats.liveRewardsRedeemed = (state.stats.liveRewardsRedeemed || 0) + 1;
                state.lastActionNote = `Twitch resgatou ${reward.title} (${login})`;
            } else {
                runtimeState.redeemRetryAt.twitch.set(login, now + RETRY_WAIT_MS);
                status.error = p?.error?.code || redRes?.errors?.[0]?.message || redRes?.failed || 'resgate recusado';
                break;
            }
        }
    }

    status.balance = balance;
    if (!guardOnly && !status.live) {
        delete state.liveStatus.twitch[login];
        runtimeState.lastLiveProbeAt.twitch = 0;
    }
    return status;
};

// --- Kick Leve ---

const kickHeaders = (token) => ({
    Accept: 'application/json',
    'x-app-platform': 'web',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const sendWsJson = (ws, obj) => {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(obj));
        return true;
    }
    return false;
};

const flushKickSocketEvents = (ctx, conn, force = false) => {
    if (!conn?.ws || conn.ws.readyState !== 1) return false;
    const { state } = ctx;
    const now = Date.now();
    if (force || now - conn.lastHandshakeAt >= 15000) {
        sendWsJson(conn.ws, { type: 'channel_handshake', data: { message: { channelId: String(conn.channelId) } } });
        conn.lastHandshakeAt = now;
    }
    if (force || now - conn.lastPingAt >= 30000) {
        sendWsJson(conn.ws, { type: 'ping' });
        conn.lastPingAt = now;
    }
    if (force || now - conn.lastWatchAt >= 115000) {
        const sent = sendWsJson(conn.ws, {
            type: 'user_event',
            data: {
                message: {
                    name: 'tracking.user.watch.livestream',
                    channel_id: conn.channelId,
                    livestream_id: conn.livestreamId,
                    vod_id: conn.vodId,
                },
            },
        });
        if (sent) {
            conn.lastWatchAt = now;
            state.stats.liveMinutesWatched = (state.stats.liveMinutesWatched || 0) + 2;
        }
    }
    return true;
};

const ensureKickHeartbeatTimer = (ctx) => {
    if (runtimeState.kickTimer) return;
    runtimeState.kickTimer = setInterval(() => {
        if (!ctx.state?.running || ctx.state?.paused || !ctx.CONFIG?.live?.enabled || !ctx.CONFIG?.live?.watchKick) return;
        for (const [, conn] of runtimeState.kickSockets) {
            flushKickSocketEvents(ctx, conn, false);
        }
    }, 15000);
};

const ensureKickViewerSocket = async (ctx, slug, { token, channelId, livestreamId, vodId, force = false }) => {
    const { net } = ctx;
    const createWs = net?.createWebSocket || (typeof WebSocket === 'function' ? (url) => new WebSocket(url) : null);
    if (!createWs) return false;

    let conn = runtimeState.kickSockets.get(slug);
    if (!conn || !conn.ws || conn.ws.readyState > 1) {
        const tokRes = await netFetch(ctx, `${KICK_WS_API_URL}/viewer/v1/token`, {
            method: 'GET',
            headers: { ...kickHeaders(token), 'X-CLIENT-TOKEN': KICK_CLIENT_TOKEN },
        });
        if (!tokRes.ok) return false;
        const tokJson = await tokRes.json();
        const viewerToken = tokJson?.data?.token;
        if (!viewerToken) return false;

        const ws = createWs(`${KICK_WS_URL}?token=${encodeURIComponent(viewerToken)}`);
        conn = { ws, channelId, livestreamId, vodId, lastHandshakeAt: 0, lastPingAt: 0, lastWatchAt: 0 };
        runtimeState.kickSockets.set(slug, conn);

        const onOpen = () => flushKickSocketEvents(ctx, conn, true);
        if (typeof ws.addEventListener === 'function') {
            ws.addEventListener('open', onOpen);
        } else if ('onopen' in ws || typeof ws === 'object') {
            ws.onopen = onOpen;
        }
    } else {
        conn.channelId = channelId;
        conn.livestreamId = livestreamId;
        conn.vodId = vodId;
    }

    ensureKickHeartbeatTimer(ctx);
    return flushKickSocketEvents(ctx, conn, force);
};

const readKickPointsAndRewards = async (ctx, slug, headers) => {
    const ptsRes = await netFetch(ctx, `${KICK_API_URL}/api/v2/channels/${encodeURIComponent(slug)}/points`, { method: 'GET', headers });
    if (!ptsRes.ok) return null;
    const ptsJson = await ptsRes.json();
    const points = ptsJson?.data?.points;
    if (typeof points !== 'number') return null;

    const rewRes = await netFetch(ctx, `${KICK_API_URL}/api/v2/channels/${encodeURIComponent(slug)}/rewards`, { method: 'GET', headers });
    const rewards = rewRes.ok ? (await rewRes.json())?.data || [] : [];
    return { points, rewards };
};

export const stepKickChannel = async (ctx, slug, { token = '', force = false, guardOnly = false, onlyKind = null, probeOnly = false } = {}) => {
    const { CONFIG, state } = ctx;
    if (!state.liveStatus) state.liveStatus = { twitch: {}, kick: {} };
    const status = guardOnly
        ? { balance: null, live: false, wsOpen: false, lastPingAt: 0, lastRedeemAt: 0, redeemedThisStep: false, error: null }
        : (state.liveStatus.kick[slug] ||= { balance: null, live: false, wsOpen: false, lastPingAt: 0, lastRedeemAt: 0, redeemedThisStep: false, error: null });
    status.redeemedThisStep = false;

    const headers = kickHeaders(token);
    let live = status.live;
    if (!guardOnly) {
        let infoRes = await netFetch(ctx, `${KICK_API_URL}/api/v2/channels/${encodeURIComponent(slug)}/info`, { method: 'GET', headers });
        if (!infoRes.ok) {
            infoRes = await netFetch(ctx, `${KICK_API_URL}/api/v2/channels/${encodeURIComponent(slug)}`, { method: 'GET', headers });
        }
        if (!infoRes.ok) {
            status.error = `erro ${infoRes.status}`;
            return status;
        }

        const rawInfo = await infoRes.json();
        const info = rawInfo?.data && rawInfo?.id == null ? rawInfo.data : rawInfo;
        const channelId = info?.id;
        const stream = info?.livestream;
        live = Boolean(stream && stream.is_live !== false);
        const livestreamId = stream?.id || null;
        const vodId = stream?.vod_id ?? null;

        status.live = live;
        status.error = null;

        if (!live) {
            const oldConn = runtimeState.kickSockets.get(slug);
            if (oldConn) {
                try { oldConn.ws?.close?.(); } catch { /* ja fechado */ }
                runtimeState.kickSockets.delete(slug);
            }
            status.wsOpen = false;
            delete state.liveStatus.kick[slug];
            runtimeState.lastLiveProbeAt.kick = 0;
        } else if (CONFIG.live?.watchKick && token && channelId && livestreamId && vodId) {
            const ok = await ensureKickViewerSocket(ctx, slug, { token, channelId, livestreamId, vodId, force });
            status.wsOpen = ok;
            if (ok) status.lastPingAt = Date.now();
        }
    }

    const now = Date.now();
    const channelKey = slug.toLowerCase();
    const tier = CONFIG.live?.rewardTier || 'cheapest';
    const configuredKinds = resolveChannelRewardKinds(CONFIG.live, 'kick', slug);
    const activeKinds = onlyKind
        ? (configuredKinds.includes(onlyKind) ? [onlyKind] : [])
        : configuredKinds;
    status.rewardKinds = configuredKinds;

    const lastCheck = runtimeState.kickPointsCheckAt.get(slug) || 0;
    if (token && (force || guardOnly || now - lastCheck >= 290000)) {
        runtimeState.kickPointsCheckAt.set(slug, now);
        const data = await readKickPointsAndRewards(ctx, slug, headers);
        if (data) {
            let { points, rewards } = data;
            status.balance = points;
            recordChannelBalance(state, 'kick', slug, points);
            for (const k of LIVE_REWARD_KINDS) {
                if (!configuredKinds.includes(k)) {
                    runtimeState.guardReads.kick.delete(guardKey(channelKey, k));
                    continue;
                }
                const rew = pickRewardForChannel(rewards, k, 'kick', { tier, balance: points });
                if (rew) {
                    runtimeState.guardReads.kick.set(guardKey(channelKey, k), {
                        at: now,
                        points,
                        cost: rew.cost,
                        paused: Boolean(rew.is_paused),
                    });
                }
            }

            const canRetryRedeem = force || now >= (runtimeState.redeemRetryAt.kick.get(slug) || 0);
            if (!probeOnly && CONFIG.live?.autoRedeem && canRetryRedeem && activeKinds.length > 0) {
                const serverNow = Date.now() - (state.liveGameData?.skew || 0);
                const bonusState = state.liveGameData?.kick;
                const thresholdMin = resolveEffectiveThresholdMin(CONFIG.live);
                const criticalMin = Math.max(15, Number(CONFIG.live?.guardThresholdMin ?? 30) || 30);
                const orderedKinds = orderBuffsForRedeem(activeKinds, bonusState, CONFIG.live, serverNow);
                const criticalPending = new Set(
                    orderedKinds.filter((k) => getBonusRemainingMin(bonusState, k, serverNow) <= criticalMin)
                );
                for (const kind of orderedKinds) {
                    if (!canRedeemPlatform('kick', kind, now, force)) continue;
                    const remainingMin = getBonusRemainingMin(bonusState, kind, serverNow);
                    const needsRedeem = force || remainingMin <= thresholdMin;
                    if (!needsRedeem) continue;
                    const deficitMin = Math.max(0, thresholdMin - remainingMin);
                    const preferQuickTurnOn = CONFIG.live?.smartBalance === true &&
                        criticalPending.has(kind) && criticalPending.size > 1;
                    const reward = pickRewardForChannel(rewards, kind, 'kick', {
                        tier,
                        balance: points,
                        deficitMin,
                        preferQuickTurnOn,
                    });
                    if (!reward || reward.is_paused || points < reward.cost) continue;
                    const redRes = await netFetch(ctx, `${KICK_API_URL}/api/v2/channels/${encodeURIComponent(slug)}/rewards/${reward.id}/redeem`, {
                        method: 'POST',
                        headers: { ...headers, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ transaction_id: generateUlid(now), message: '' }),
                    });
                    if (redRes.ok) {
                        points -= reward.cost;
                        criticalPending.delete(kind);
                        status.balance = points;
                        recordChannelBalance(state, 'kick', slug, points);
                        status.lastRedeemAt = now;
                        status.redeemedThisStep = true;
                        runtimeState.lastPlatformRedeemAt[`kick:${kind}`] = now;
                        state.stats.liveRewardsRedeemed = (state.stats.liveRewardsRedeemed || 0) + 1;
                        state.lastActionNote = `Kick resgatou ${reward.title} (${slug})`;
                    } else {
                        runtimeState.redeemRetryAt.kick.set(slug, now + RETRY_WAIT_MS);
                        status.error = `resgate erro ${redRes.status}`;
                        break;
                    }
                }
            }
        }
    }

    return status;
};

// --- Guarda de Bônus (canais não assistidos / offline) ---

const runBonusGuard = async (ctx, platform, { token, deviceId = '', watched = [], officials = [], customCsv = '' }) => {
    const { CONFIG, state } = ctx;
    const now = Date.now();
    if (!CONFIG.live?.autoRedeem || !token) return false;

    const serverNow = now - (state.liveGameData?.skew || 0);
    const bonusState = state.liveGameData?.[platform];

    const watchedSet = new Set(watched.map((w) => w.toLowerCase()));
    const defaults = platform === 'twitch' ? DEFAULT_TWITCH_OFFICIALS : DEFAULT_KICK_OFFICIALS;
    const liveSet = new Set();
    const candidates = [];
    const seen = new Set();
    const addCandidate = (raw, isLive = false) => {
        const clean = String(raw || '').trim();
        if (!clean) return;
        const low = clean.toLowerCase();
        if (isLive) liveSet.add(low);
        if (watchedSet.has(low) || seen.has(low)) return;
        seen.add(low);
        candidates.push(clean);
    };

    String(customCsv || '')
        .split(/[\s,;]+/)
        .forEach((c) => addCandidate(c, false));
    if (Array.isArray(officials)) {
        officials.forEach((o) => {
            if (o && o.ativo !== false) addCandidate(o.login || o.slug, Boolean(o.aoVivo));
        });
    }
    defaults.forEach((c) => addCandidate(c, false));

    const thresholdMin = resolveEffectiveThresholdMin(CONFIG.live);
    const eligibleKinds = LIVE_REWARD_KINDS.filter((kind) =>
        canRedeemPlatform(platform, kind, now, false) &&
        shouldRedeemBonus(bonusState, kind, thresholdMin, serverNow) &&
        candidates.some((ch) => resolveChannelRewardKinds(CONFIG.live, platform, ch).includes(kind))
    );
    const kindsToCheck = orderBuffsForRedeem(eligibleKinds, bonusState, CONFIG.live, serverNow);
    if (kindsToCheck.length === 0) return false;

    const readsMap = runtimeState.guardReads[platform];
    const tier = CONFIG.live?.rewardTier || 'cheapest';
    for (const ch of candidates) {
        if (!state.running) return false;
        const chKinds = resolveChannelRewardKinds(CONFIG.live, platform, ch)
            .filter((k) => kindsToCheck.includes(k));
        if (chKinds.length === 0) continue;
        const allFresh = chKinds.every((k) => {
            const cached = readsMap.get(guardKey(ch, k));
            return cached && now - cached.at <= GUARD_READ_TTL_MS;
        });
        if (allFresh) continue;
        if (platform === 'twitch') {
            await stepTwitchChannel(ctx, ch, { token, deviceId, force: false, guardOnly: true, probeOnly: true });
        } else {
            const data = await readKickPointsAndRewards(ctx, ch, kickHeaders(token));
            if (data) {
                recordChannelBalance(state, 'kick', ch, data.points);
                for (const k of chKinds) {
                    const rew = pickRewardForChannel(data.rewards, k, 'kick', { tier, balance: data.points });
                    if (rew) {
                        readsMap.set(guardKey(ch, k), {
                            at: Date.now(),
                            points: data.points,
                            cost: rew.cost,
                            paused: Boolean(rew.is_paused),
                        });
                    }
                }
            }
        }
    }

    let redeemedAny = false;
    for (const kind of kindsToCheck) {
        if (!state.running || !canRedeemPlatform(platform, kind, Date.now(), false)) continue;
        const kindCandidates = candidates.filter((ch) =>
            resolveChannelRewardKinds(CONFIG.live, platform, ch).includes(kind)
        );
        const kindReads = new Map();
        for (const ch of kindCandidates) {
            const entry = readsMap.get(guardKey(ch, kind));
            if (entry) kindReads.set(ch.toLowerCase(), entry);
        }
        const best = pickBonusGuardCandidate(kindCandidates, kindReads, liveSet);
        if (!best) continue;

        if (platform === 'twitch') {
            const st = await stepTwitchChannel(ctx, best.channel, { token, deviceId, force: false, guardOnly: true, onlyKind: kind });
            if (st?.redeemedThisStep) redeemedAny = true;
        } else {
            const st = await stepKickChannel(ctx, best.channel, { token, force: false, guardOnly: true, onlyKind: kind });
            if (st?.redeemedThisStep) redeemedAny = true;
        }
    }
    return redeemedAny;
};

// --- Ciclo principal ---

export const runLiveCycle = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, updateHud } = ctx;
    if (!state.running || (!CONFIG.live?.enabled && !force)) return;
    if (runtimeState.cycleInFlight) return;
    runtimeState.cycleInFlight = true;

    try {
        installGameWsTap(ctx);
        readDomBonusFallback(ctx);

        const { twitchToken, twitchDeviceId, kickToken } = await syncCookiesToConfig(ctx);

        const probeNow = Date.now();
        const shouldProbeTw = !Array.isArray(state.liveGameData?.twitch?.oficiais) &&
            probeNow - runtimeState.lastLiveProbeAt.twitch >= 120_000;
        if (shouldProbeTw) {
            runtimeState.lastLiveProbeAt.twitch = probeNow;
            const customTw = String(CONFIG.live?.customTwitchChannels || '').split(/[\s,;]+/).filter(Boolean);
            const knownTw = (state.liveGameData?.twitch?.oficiais || []).map((o) => o?.login).filter(Boolean);
            const poolTw = [...new Set([...customTw, ...knownTw, ...DEFAULT_TWITCH_OFFICIALS])];
            const liveMap = await checkTwitchLiveBatch(ctx, poolTw).catch(() => ({}));
            if (Object.keys(liveMap).length > 0) {
                if (!state.liveGameData) state.liveGameData = { twitch: null, kick: null, skew: 0 };
                state.liveGameData.twitch = {
                    ...(state.liveGameData.twitch || {}),
                    canaisConsultados: poolTw.map((login) => ({ login, aoVivo: Boolean(liveMap[login.toLowerCase()]), ativo: true })),
                };
            }
        }

        const shouldProbeKk = !Array.isArray(state.liveGameData?.kick?.oficiais) &&
            probeNow - runtimeState.lastLiveProbeAt.kick >= 120_000;
        if (shouldProbeKk) {
            const customKk = String(CONFIG.live?.customKickChannels || '').split(/[\s,;]+/).filter(Boolean);
            const knownKk = (state.liveGameData?.kick?.oficiais || []).map((o) => o?.slug).filter(Boolean);
            const poolKk = [...new Set([...customKk, ...knownKk, ...DEFAULT_KICK_OFFICIALS])];
            const probed = [];
            for (const slug of poolKk) {
                if (!state.running) break;
                try {
                    const r = await netFetch(ctx, `${KICK_API_URL}/api/v2/channels/${encodeURIComponent(slug)}`, { method: 'GET', headers: kickHeaders(kickToken) });
                    const j = r.ok ? await r.json().catch(() => null) : null;
                    probed.push({ slug, aoVivo: Boolean(j?.livestream && j.livestream.is_live !== false), ativo: true });
                } catch {
                    probed.push({ slug, aoVivo: false, ativo: true });
                }
            }
            if (!state.liveGameData) state.liveGameData = { twitch: null, kick: null, skew: 0 };
            state.liveGameData.kick = { ...(state.liveGameData.kick || {}), canaisConsultados: probed };
            runtimeState.lastLiveProbeAt.kick = probeNow;
        }

        const twMaxSlots = Math.max(1, Number(CONFIG.live?.maxTwitchSlots ?? CONFIG.live?.maxSlots) || 4);
        const kkMaxSlots = Math.max(1, Number(CONFIG.live?.maxKickSlots ?? CONFIG.live?.maxSlots) || 2);

        const filterOnlyLiveCustom = (csv, oficiais) => {
            if (!csv) return '';
            if (!Array.isArray(oficiais) || oficiais.length === 0) return csv;
            const liveMap = new Map(oficiais.map((o) => [String(o?.login || o?.slug || '').toLowerCase(), Boolean(o?.aoVivo)]));
            return String(csv)
                .split(/[\s,;]+/)
                .filter((ch) => {
                    const low = ch.trim().toLowerCase();
                    if (!low) return false;
                    return liveMap.has(low) ? liveMap.get(low) : true;
                })
                .join(',');
        };

        const liveCustomTw = filterOnlyLiveCustom(CONFIG.live?.customTwitchChannels, state.liveGameData?.twitch?.oficiais);
        const liveCustomKk = filterOnlyLiveCustom(CONFIG.live?.customKickChannels, state.liveGameData?.kick?.oficiais);

        const channelsFor = (platform) => {
            const data = state.liveGameData?.[platform];
            return data?.oficiais ?? data?.canaisConsultados;
        };
        const twChannels = selectChannelsToWatch(channelsFor('twitch'), liveCustomTw, twMaxSlots);
        const kkChannels = selectChannelsToWatch(channelsFor('kick'), liveCustomKk, kkMaxSlots);

        if (twChannels.length === 0 && kkChannels.length === 0 && force && !runtimeState.modalSyncDone) {
            await syncChannelsFromModal(ctx, { force: true });
        }

        const finalTw = selectChannelsToWatch(channelsFor('twitch'), liveCustomTw, twMaxSlots);
        const finalKk = selectChannelsToWatch(channelsFor('kick'), liveCustomKk, kkMaxSlots);

        if (state.liveStatus?.twitch) {
            const activeTwSet = new Set(finalTw.map((s) => s.toLowerCase()));
            for (const key of Object.keys(state.liveStatus.twitch)) {
                if (!activeTwSet.has(key.toLowerCase())) {
                    delete state.liveStatus.twitch[key];
                }
            }
        }
        if (state.liveStatus?.kick) {
            const activeKkSet = new Set(finalKk.map((s) => s.toLowerCase()));
            for (const key of Object.keys(state.liveStatus.kick)) {
                if (!activeKkSet.has(key.toLowerCase()) || !state.liveStatus.kick[key]?.live) {
                    delete state.liveStatus.kick[key];
                }
            }
        }

        if (CONFIG.live?.watchTwitch || CONFIG.live?.autoClaimChest || CONFIG.live?.autoRedeem) {
            for (const login of finalTw) {
                if (!state.running) break;
                await stepTwitchChannel(ctx, login, { token: twitchToken, deviceId: twitchDeviceId, force })
                    .catch(() => {
                        const status = state.liveStatus?.twitch?.[login];
                        if (status) status.error ||= 'falha de comunicação com a Twitch';
                    });
            }
            await runBonusGuard(ctx, 'twitch', {
                token: twitchToken,
                deviceId: twitchDeviceId,
                watched: finalTw,
                officials: state.liveGameData?.twitch?.oficiais,
                customCsv: CONFIG.live?.customTwitchChannels,
            }).catch(() => {
                state.lastActionNote = 'Twitch: falha ao verificar bônus';
            });
        }

        if (CONFIG.live?.watchKick || CONFIG.live?.autoRedeem) {
            const activeKk = new Set(finalKk.map((s) => s.toLowerCase()));
            for (const [slug, conn] of runtimeState.kickSockets.entries()) {
                if (!activeKk.has(String(slug).toLowerCase())) {
                    try {
                        conn.ws?.close?.();
                    } catch {
                        // já fechado
                    }
                    runtimeState.kickSockets.delete(slug);
                }
            }
            for (const slug of finalKk) {
                if (!state.running) break;
                await stepKickChannel(ctx, slug, { token: kickToken, force })
                    .catch(() => {
                        const status = state.liveStatus?.kick?.[slug];
                        if (status) status.error ||= 'falha de comunicação com o Kick';
                    });
            }
            await runBonusGuard(ctx, 'kick', {
                token: kickToken,
                watched: finalKk,
                officials: state.liveGameData?.kick?.oficiais,
                customCsv: CONFIG.live?.customKickChannels,
            });
        }

        if (!twitchToken && !kickToken && (finalTw.length > 0 || finalKk.length > 0)) {
            state.lastActionNote = 'Lives: informe token ou permita GM_cookie';
        }
        updateHud?.();
    } finally {
        runtimeState.cycleInFlight = false;
    }
};

const dispose = () => {
    if (runtimeState.kickTimer) {
        clearInterval(runtimeState.kickTimer);
        runtimeState.kickTimer = null;
    }
    for (const [, conn] of runtimeState.kickSockets) {
        try {
            conn.ws?.close?.();
        } catch {
            // já fechado
        }
    }
    runtimeState.kickSockets.clear();
    runtimeState.spadeCache.clear();
    runtimeState.twitchLastPingAt.clear();
    runtimeState.twitchSeenSegments.clear();
    runtimeState.kickPointsCheckAt.clear();
    runtimeState.lastPlatformRedeemAt = {};
    runtimeState.redeemRetryAt = { twitch: new Map(), kick: new Map() };
    runtimeState.claimRetryAt.clear();
    runtimeState.confirmedClaims.clear();
    runtimeState.guardReads = { twitch: new Map(), kick: new Map() };
    runtimeState.twitchIntegrityCache = { token: null, expiresAt: 0 };
    runtimeState.lastLiveProbeAt = { twitch: 0, kick: 0 };
    runtimeState.cycleInFlight = false;
    runtimeState.modalSyncDone = false;
};

export const liveRewards = {
    id: 'liveRewards',
    everyMs: (ctx) => ctx.CONFIG.live?.checkIntervalMs ?? 30000,
    init: (ctx) => {
        installGameWsTap(ctx);
        syncCookiesToConfig(ctx).catch(() => {});
    },
    tick: (ctx) => runLiveCycle(ctx, { force: false }),
    dispose,
    run: runLiveCycle,
    sync: syncChannelsFromModal,
};

export { normalizeText };
