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
const KICK_INFO_CACHE_MS = 90 * 1000;
const KICK_INFO_WS_CACHE_MS = 180 * 1000;
const KICK_REWARDS_CACHE_MS = 5 * 60 * 1000;
const TWITCH_PROBE_CACHE_MS = 90 * 1000;
const TWITCH_HLS_PLAYLIST_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_BASE_MS = 60 * 1000;
const RATE_LIMIT_MAX_MS = 10 * 60 * 1000;
const MAX_GUARD_PROBES_TWITCH = 3;
const MAX_GUARD_PROBES_KICK = 2;

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
    const short = text.match(/\b(\d+)\s*h(?:rs?|oras?)?\b/i);
    if (short) return Number(short[1]) || 1;
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

export const needsBuffRedeem = (remainingMin, liveConfig = {}) => {
    const rem = Math.max(0, Number(remainingMin) || 0);
    const targetMin = resolveEffectiveThresholdMin(liveConfig);
    const baseGuard = Math.max(0, Number(liveConfig?.guardThresholdMin ?? 30) || 0);
    if (liveConfig?.smartBalance === true && targetMin > baseGuard) {
        return rem < targetMin - 0.5;
    }
    return rem <= targetMin;
};

const resolvePlatformConfiguredKinds = (liveConfig = {}, platform = 'twitch') => {
    const pref = platform === 'twitch' ? liveConfig?.twitchRewards : liveConfig?.kickRewards;
    if (pref !== undefined && pref !== null) return parseRewardKinds(pref, []);
    return parseRewardKinds(liveConfig?.rewardType, ['xp']);
};

const buffPriorityThresholdMin = (liveConfig = {}) => {
    const targetMin = resolveEffectiveThresholdMin(liveConfig);
    const baseGuard = Math.max(0, Number(liveConfig?.guardThresholdMin ?? 30) || 0);
    if (liveConfig?.smartBalance === true && targetMin > baseGuard) {
        const hysteresis = Math.min(5, Math.max(1, Math.round(targetMin * 0.05)));
        return Math.max(baseGuard, targetMin - hysteresis);
    }
    return targetMin;
};

export const orderBuffsForRedeem = (
    kinds = [],
    bonusState = null,
    liveConfig = {},
    now = Date.now(),
    _lastRedeemByKind = null
) => {
    const list = Array.isArray(kinds) ? [...kinds] : [];
    if (list.length <= 1 || liveConfig?.smartBalance !== true) return list;
    const indexMap = new Map(list.map((k, idx) => [k, idx]));
    return list.sort((a, b) => {
        const needA = needsBuffRedeem(getBonusRemainingMin(bonusState, a, now), liveConfig) ? 0 : 1;
        const needB = needsBuffRedeem(getBonusRemainingMin(bonusState, b, now), liveConfig) ? 0 : 1;
        if (needA !== needB) return needA - needB;
        return (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0);
    });
};

/**
 * Quando syncPlatforms esta ligado explicitamente junto com smartBalance, so libera o proximo buff
 * (ex: Captura) depois que os buffs de prioridade maior (ex: XP) baterem a meta nas duas plataformas.
 * Por padrao (syncPlatforms = false), Kick e Twitch funcionam de forma independente.
 */
export const resolveCrossPlatformBlocker = ({
    platform = 'twitch',
    kind = 'xp',
    configuredKinds = null,
    liveConfig = {},
    otherBonusState = null,
    otherKinds = null,
    now = Date.now(),
} = {}) => {
    if (liveConfig?.smartBalance !== true || liveConfig?.syncPlatforms !== true || !otherBonusState) {
        return { blocked: false, waitKind: null, waitPlatform: null, reason: null };
    }
    const otherPlatform = platform === 'twitch' ? 'kick' : 'twitch';
    const otherWatch = otherPlatform === 'kick'
        ? liveConfig?.watchKick !== false
        : liveConfig?.watchTwitch !== false;
    const hasOtherToken = Boolean(
        otherPlatform === 'kick'
            ? (liveConfig?.kickToken || liveConfig?.hasKickToken)
            : (liveConfig?.twitchToken || liveConfig?.hasTwitchToken)
    );
    if (!otherWatch || !hasOtherToken) {
        return { blocked: false, waitKind: null, waitPlatform: null, reason: null };
    }

    const thisList = Array.isArray(configuredKinds) ? configuredKinds : resolvePlatformConfiguredKinds(liveConfig, platform);
    const otherList = Array.isArray(otherKinds) ? otherKinds : resolvePlatformConfiguredKinds(liveConfig, otherPlatform);
    const kindIdx = LIVE_REWARD_KINDS.indexOf(kind);
    if (kindIdx <= 0) return { blocked: false, waitKind: null, waitPlatform: null, reason: null };

    for (let i = 0; i < kindIdx; i++) {
        const hi = LIVE_REWARD_KINDS[i];
        if (!thisList.includes(hi) || !otherList.includes(hi)) continue;
        const otherRem = getBonusRemainingMin(otherBonusState, hi, now);
        if (otherRem < buffPriorityThresholdMin(liveConfig)) {
            const platLabel = otherPlatform === 'kick' ? 'Kick' : 'Twitch';
            return {
                blocked: true,
                waitKind: hi,
                waitPlatform: otherPlatform,
                reason: `aguardando ${hi.toUpperCase()} na ${platLabel}`,
            };
        }
    }
    return { blocked: false, waitKind: null, waitPlatform: null, reason: null };
};

export const computeSmartBuffStatus = (
    kinds = [],
    bonusState = null,
    liveConfig = {},
    now = Date.now(),
    lastRedeemByKind = null,
    crossCtx = null
) => {
    const list = Array.isArray(kinds) ? kinds : [];
    const targetMin = resolveEffectiveThresholdMin(liveConfig);
    if (list.length === 0) {
        return {
            enabled: Boolean(liveConfig?.smartBalance),
            targetMin,
            nextKind: null,
            nextMin: 0,
            allReached: true,
            waitingPlatform: null,
            waitingKind: null,
        };
    }
    const smartView = { ...liveConfig, smartBalance: true };
    const ordered = orderBuffsForRedeem(list, bonusState, smartView, now, lastRedeemByKind);
    const nextKind = ordered.find((k) => needsBuffRedeem(getBonusRemainingMin(bonusState, k, now), smartView)) || null;
    const nextMin = nextKind ? Math.round(getBonusRemainingMin(bonusState, nextKind, now)) : targetMin;
    const cross = nextKind && crossCtx?.platform && liveConfig?.smartBalance === true
        ? resolveCrossPlatformBlocker({
            platform: crossCtx.platform,
            kind: nextKind,
            configuredKinds: list,
            liveConfig,
            otherBonusState: crossCtx.otherBonusState || null,
            otherKinds: crossCtx.otherKinds || null,
            now,
        })
        : { blocked: false, waitKind: null, waitPlatform: null };
    return {
        enabled: Boolean(liveConfig?.smartBalance),
        targetMin,
        nextKind,
        nextMin,
        allReached: !nextKind,
        waitingPlatform: cross.blocked ? cross.waitPlatform : null,
        waitingKind: cross.blocked ? cross.waitKind : null,
    };
};

/**
 * Decide se um canal com smartBalance ligado pode gastar saldo em `kind` ou deve guardar pontos
 * para um buff mais prioritario que ainda nao atingiu a meta na plataforma.
 * @param {object} params Contexto de decisao do canal.
 * @returns {{ allow: boolean, reason: string | null }}
 */
export const shouldReservePointsForHigherPriority = ({
    kind,
    orderedKinds = [],
    candidateMeta = new Map(),
    smartBalance = false,
}) => {
    if (!smartBalance) return { allow: true, reason: null };
    const idx = orderedKinds.indexOf(kind);
    if (idx <= 0) return { allow: true, reason: null };
    const cur = candidateMeta.get(kind);
    if (!cur) return { allow: true, reason: null };

    for (let i = 0; i < idx; i++) {
        const higherKind = orderedKinds[i];
        const hi = candidateMeta.get(higherKind);
        if (!hi || !hi.available || !hi.needsRedeem) continue;
        return {
            allow: false,
            reason: hi.recentlyRedeemed
                ? `completando ${higherKind.toUpperCase()} até a meta`
                : `guardando p/ ${higherKind.toUpperCase()} (${hi.minCost} pts)`,
        };
    }
    return { allow: true, reason: null };
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

// --- Estado interno por conta (evita conflito entre as 4 contas no mesmo processo) ---

const sharedSpadeCache = new Map();
const sharedKickInfoCache = new Map(); // slug -> { at, data }
const sharedKickInfoInFlight = new Map(); // slug -> Promise
const sharedKickRewardsCache = new Map(); // slug -> { at, rewards }
const sharedKickRewardsInFlight = new Map(); // slug -> Promise
const sharedTwitchProbeCache = new Map(); // login -> { at, live }
const sharedRateLimit = {
    twitch: { blockedUntil: 0, consecutive: 0 },
    kick: { blockedUntil: 0, consecutive: 0 },
};
const platformPaceState = {
    twitch: { chain: Promise.resolve(), nextAt: 0 },
    kick: { chain: Promise.resolve(), nextAt: 0 },
};

export const parseRetryAfterMs = (headerVal, now = Date.now()) => {
    if (headerVal == null) return null;
    const raw = String(headerVal).trim();
    if (!raw) return null;
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
        const sec = Number(raw);
        const ms = Math.ceil(sec * 1000);
        return Number.isSafeInteger(ms) ? ms : null;
    }
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) return null;
    const diff = parsed - Number(now);
    return Math.max(0, diff);
};

export const getPlatformRateLimit = (platform, now = Date.now()) => {
    const bucket = sharedRateLimit[platform];
    if (!bucket) return { blocked: false, remainingMs: 0, consecutive: 0 };
    const remainingMs = Math.max(0, Number(bucket.blockedUntil || 0) - Number(now));
    return { blocked: remainingMs > 0, remainingMs, consecutive: bucket.consecutive };
};

const formatRateLimitError = (platform, remainingMs) => {
    const label = platform === 'kick' ? 'Kick' : 'Twitch';
    const sec = Math.max(1, Math.ceil(Number(remainingMs || 0) / 1000));
    const when = sec >= 90 ? `${Math.ceil(sec / 60)}m` : `${sec}s`;
    return `limite 429 da ${label} (aguardando ${when})`;
};

const notePlatformRateLimit = (platform, res = null, now = Date.now()) => {
    const bucket = sharedRateLimit[platform];
    if (!bucket) return RATE_LIMIT_BASE_MS;
    bucket.consecutive = Math.min(6, Number(bucket.consecutive || 0) + 1);
    const headerVal = typeof res?.headers?.get === 'function'
        ? res.headers.get('retry-after')
        : (res?.headers?.['retry-after'] ?? res?.headers?.['Retry-After'] ?? null);
    const parsed = parseRetryAfterMs(headerVal, now);
    const expMs = Math.min(RATE_LIMIT_MAX_MS, RATE_LIMIT_BASE_MS * (2 ** (bucket.consecutive - 1)));
    const waitMs = parsed != null ? Math.max(parsed, 10_000) : expMs;
    bucket.blockedUntil = Math.max(bucket.blockedUntil, now + waitMs);
    return Math.max(1_000, bucket.blockedUntil - now);
};

const clearPlatformRateLimit = (platform) => {
    const bucket = sharedRateLimit[platform];
    if (!bucket) return;
    bucket.consecutive = 0;
    if (bucket.blockedUntil <= Date.now()) bucket.blockedUntil = 0;
};

export const resetLiveRateLimits = () => {
    sharedRateLimit.twitch = { blockedUntil: 0, consecutive: 0 };
    sharedRateLimit.kick = { blockedUntil: 0, consecutive: 0 };
    sharedKickInfoCache.clear();
    sharedKickInfoInFlight.clear();
    sharedKickRewardsCache.clear();
    sharedKickRewardsInFlight.clear();
    sharedTwitchProbeCache.at = 0;
    sharedTwitchProbeCache.key = '';
    sharedTwitchProbeCache.map = null;
    platformPaceState.twitch = { chain: Promise.resolve(), nextAt: 0 };
    platformPaceState.kick = { chain: Promise.resolve(), nextAt: 0 };
};

const resolvePlatformPaceMs = (ctx, platform) => {
    const fromNet = ctx?.net?.paceMs;
    if (typeof fromNet === 'number' && fromNet > 0) return fromNet;
    if (fromNet && typeof fromNet === 'object' && Number(fromNet[platform]) > 0) {
        return Number(fromNet[platform]);
    }
    const fromCfg = ctx?.CONFIG?.live?.requestPaceMs;
    if (typeof fromCfg === 'number' && fromCfg > 0) return fromCfg;
    if (fromCfg && typeof fromCfg === 'object' && Number(fromCfg[platform]) > 0) {
        return Number(fromCfg[platform]);
    }
    return 0;
};

const enqueuePlatformRequest = (ctx, platform, fn, { affectRateLimit = true } = {}) => {
    const paceMs = resolvePlatformPaceMs(ctx, platform);
    const st = platformPaceState[platform];
    const blockedResponse = () => ({
        ok: false, status: 429, rateLimited: true,
        retryAfterMs: getPlatformRateLimit(platform).remainingMs,
        json: async () => null, text: async () => '',
    });
    if (affectRateLimit && getPlatformRateLimit(platform).blocked) return Promise.resolve(blockedResponse());
    const run = async () => {
        const now = Date.now();
        const waitMs = Math.max(0, st.nextAt - now);
        if (waitMs > 0) {
            await new Promise((r) => setTimeout(r, waitMs));
        }
        if (affectRateLimit && getPlatformRateLimit(platform).blocked) return blockedResponse();
        st.nextAt = Date.now() + paceMs;
        const res = await fn();
        if (affectRateLimit) {
            if (res?.status === 429) notePlatformRateLimit(platform, res);
            else if (res?.ok) clearPlatformRateLimit(platform);
        }
        return res;
    };
    const next = st.chain.then(run, run);
    st.chain = next.catch(() => {});
    return next;
};

const createRuntimeState = () => ({
    twitchLastPingAt: new Map(),
    twitchSeenSegments: new Map(),
    twitchHlsPlaylistCache: new Map(), // login -> { at, uri }
    kickSockets: new Map(),
    kickPointsCheckAt: new Map(),
    kickTimer: null,
    lastPlatformRedeemAt: {},
    optimisticBonusUntil: { twitch: {}, kick: {} },
    redeemRetryAt: { twitch: new Map(), kick: new Map() },
    claimRetryAt: new Map(),
    confirmedClaims: new Map(),
    guardReads: { twitch: new Map(), kick: new Map() },
    twitchIntegrityCache: { token: null, expiresAt: 0 },
    lastLiveProbeAt: { twitch: 0, kick: 0 },
    cycleInFlight: false,
    modalSyncDone: false,
});

const defaultRuntimeState = createRuntimeState();
const runtimeStateByObj = new WeakMap();
const activeRuntimeStates = new Set([defaultRuntimeState]);

const getRuntimeState = (ctx) => {
    const key = ctx?.state;
    if (!key || typeof key !== 'object') return defaultRuntimeState;
    let rt = runtimeStateByObj.get(key);
    if (!rt) {
        rt = createRuntimeState();
        runtimeStateByObj.set(key, rt);
        activeRuntimeStates.add(rt);
    }
    return rt;
};

const clearRuntimeState = (rt) => {
    if (!rt) return;
    if (rt.kickTimer) {
        clearInterval(rt.kickTimer);
        rt.kickTimer = null;
    }
    for (const [, conn] of rt.kickSockets) {
        try {
            conn.ws?.close?.();
        } catch {
            // já fechado
        }
    }
    rt.kickSockets.clear();
    rt.twitchLastPingAt.clear();
    rt.twitchSeenSegments.clear();
    rt.twitchHlsPlaylistCache?.clear();
    rt.kickPointsCheckAt.clear();
    rt.lastPlatformRedeemAt = {};
    rt.optimisticBonusUntil = { twitch: {}, kick: {} };
    rt.redeemRetryAt = { twitch: new Map(), kick: new Map() };
    rt.claimRetryAt.clear();
    rt.confirmedClaims.clear();
    rt.guardReads = { twitch: new Map(), kick: new Map() };
    rt.twitchIntegrityCache = { token: null, expiresAt: 0 };
    rt.lastLiveProbeAt = { twitch: 0, kick: 0 };
    rt.cycleInFlight = false;
    rt.modalSyncDone = false;
};

const getPageWindow = (ctx) => ctx.pageWin || (typeof window !== 'undefined' ? window : null);

const canRedeemPlatform = (rt, platform, kind, now, force = false) =>
    force || now - (rt.lastPlatformRedeemAt[`${platform}:${kind}`] || 0) >= CONFIRM_WITHIN_MS;

const getLastRedeemMapForPlatform = (rt, platform) => {
    const out = {};
    for (const k of LIVE_REWARD_KINDS) {
        out[k] = Number(rt.lastPlatformRedeemAt[`${platform}:${k}`] || 0);
    }
    return out;
};

const buildEffectiveBonusState = (rt, bonusState, platform) => {
    const opt = rt?.optimisticBonusUntil?.[platform];
    if (!opt) return bonusState;
    const mergedBonus = { ...(bonusState?.bonus || {}) };
    for (const k of LIVE_REWARD_KINDS) {
        const cur = Number(mergedBonus[k]) || 0;
        const est = Number(opt[k]) || 0;
        if (est > cur) mergedBonus[k] = est;
    }
    return { ...(bonusState || {}), bonus: mergedBonus };
};

const recordOptimisticRedeem = (rt, platform, kind, reward, serverNow, serverBonusState = null) => {
    const hours = Math.max(1, extractRewardHours(reward));
    const curOpt = Number(rt.optimisticBonusUntil?.[platform]?.[kind]) || 0;
    const curSrv = Number(serverBonusState?.bonus?.[kind]) || 0;
    const base = Math.max(curOpt, curSrv, serverNow);
    rt.optimisticBonusUntil[platform][kind] = base + hours * 3_600_000;
};

export const getLiveLastRedeemMap = (ctx, platform) =>
    getLastRedeemMapForPlatform(getRuntimeState(ctx), platform);

export const getEffectiveBonusStateForCtx = (ctx, platform) =>
    buildEffectiveBonusState(getRuntimeState(ctx), ctx?.state?.liveGameData?.[platform], platform);

const recordChannelBalance = (state, platform, channel, points) => {
    if (!state || typeof points !== 'number') return;
    if (!state.liveChannelBalances) state.liveChannelBalances = { twitch: {}, kick: {} };
    state.liveChannelBalances[platform][String(channel || '').toLowerCase()] = points;
};

const guardKey = (channel, kind) => `${String(channel || '').toLowerCase()}::${kind}`;

const pushLiveStepEvent = (state, text) => {
    if (Array.isArray(state?.stepEvents) && text) {
        state.stepEvents.push(String(text));
    }
};

export const mergeGameWsMessage = (state, msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t !== 'welcome' && msg.t !== 'estado') return;
    const st = msg.estado;
    if (!st || typeof st !== 'object') return;
    if (!state.liveGameData) state.liveGameData = { twitch: null, kick: null, skew: 0 };
    state.liveGameData.updatedAt = Date.now();
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
            getRuntimeState(ctx).modalSyncDone = true;
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

const twitchFetch = (ctx, url, opts) =>
    enqueuePlatformRequest(ctx, 'twitch', () => netFetch(ctx, url, opts));

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
    const rt = getRuntimeState(ctx);
    const rl = getPlatformRateLimit('twitch');
    if (rl.blocked) {
        return { failed: formatRateLimitError('twitch', rl.remainingMs), rateLimited: true, retryAfterMs: rl.remainingMs };
    }
    const headers = {
        'Client-Id': TWITCH_CLIENT_ID,
        'Content-Type': 'text/plain;charset=UTF-8',
    };
    if (token) headers.Authorization = `OAuth ${token}`;
    if (deviceId) headers['X-Device-Id'] = deviceId;

    let integrity = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        const reqHeaders = integrity ? { ...headers, 'Client-Integrity': integrity } : headers;
        const res = await twitchFetch(ctx, TWITCH_GQL_URL, {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify(payload),
        });
        if (res.status === 429) {
            const waitMs = getPlatformRateLimit('twitch').remainingMs;
            return { failed: formatRateLimitError('twitch', waitMs), rateLimited: true, retryAfterMs: waitMs };
        }
        if (!res.ok) return { failed: `erro ${res.status}` };
        const json = await res.json();
        const challenged =
            Boolean(json?.extensions?.challenge) ||
            (json?.errors || []).some((e) => e?.extensions?.code === 'IntegrityCheckFailed');
        if (!challenged) return json;

        if (integrity) {
            rt.twitchIntegrityCache = { token: null, expiresAt: 0 };
            return { failed: 'checagem anti-robô da Twitch (IntegrityCheckFailed)' };
        }
        if (!token) return { failed: 'checagem anti-robô da Twitch' };

        const now = Date.now();
        if (rt.twitchIntegrityCache.token && rt.twitchIntegrityCache.expiresAt > now + 60_000) {
            integrity = rt.twitchIntegrityCache.token;
            continue;
        }

        if (typeof ctx.getTwitchIntegrityToken === 'function') {
            try {
                const browserInt = await ctx.getTwitchIntegrityToken({ token, deviceId });
                if (browserInt?.token) {
                    integrity = browserInt.token;
                    rt.twitchIntegrityCache = {
                        token: browserInt.token,
                        expiresAt: Number(browserInt.expiration) || now + 3_600_000,
                    };
                    continue;
                }
            } catch {
                // fallback para /integrity direto
            }
        }

        const intRes = await twitchFetch(ctx, TWITCH_INTEGRITY_URL, { method: 'POST', headers });
        if (intRes.status === 429) {
            const waitMs = getPlatformRateLimit('twitch').remainingMs;
            return { failed: formatRateLimitError('twitch', waitMs), rateLimited: true, retryAfterMs: waitMs };
        }
        const intJson = intRes.ok ? await intRes.json().catch(() => null) : null;
        if (!intJson?.token) return { failed: `checagem anti-robô (${intRes.status})` };
        integrity = intJson.token;
        rt.twitchIntegrityCache = {
            token: intJson.token,
            expiresAt: Number(intJson.expiration) || now + 3_600_000,
        };
    }
    return { failed: 'sem resposta' };
};

export const checkTwitchLiveBatch = async (ctx, channels = []) => {
    const list = Array.from(new Set(channels.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean)));
    if (list.length === 0) return {};
    const now = Date.now();
    const out = {};
    const missing = [];
    for (const ch of list) {
        const cached = sharedTwitchProbeCache.get(ch);
        if (cached && now - cached.at < TWITCH_PROBE_CACHE_MS) {
            out[ch] = cached.live;
        } else {
            missing.push(ch);
        }
    }
    if (missing.length === 0) return out;

    const res = await twitchGqlCall(ctx, { token: '', deviceId: '' }, {
        query: 'query($l:[String!]){users(logins:$l){login id stream{id}}}',
        variables: { l: missing },
    });
    const users = res?.data?.users;
    if (!Array.isArray(users)) return out;
    for (const ch of missing) {
        out[ch] = false;
        sharedTwitchProbeCache.set(ch, { at: now, live: false });
    }
    for (const u of users) {
        if (u?.login) {
            const low = String(u.login).toLowerCase();
            const isLive = Boolean(u.stream?.id);
            out[low] = isLive;
            sharedTwitchProbeCache.set(low, { at: now, live: isLive });
        }
    }
    return out;
};

/**
 * Leitura leve dos pontos de canal: uma unica consulta GQL para varios canais,
 * sem pings, baus ou resgates. Usada para manter o painel de lives atualizado
 * mesmo com o bot pausado.
 * @param {object} ctx Contexto do modulo (CONFIG.live com token e estado).
 * @param {string[]} logins Canais da Twitch.
 * @returns {Promise<{ok: boolean, updated: number, error?: string|null}>}
 */
export const refreshTwitchBalances = async (ctx, logins = []) => {
    const { CONFIG, state } = ctx;
    const token = String(CONFIG.live?.twitchToken || '').trim();
    const list = [...new Set((Array.isArray(logins) ? logins : [])
        .map((l) => String(l || '').trim().toLowerCase())
        .filter((l) => /^[a-z0-9_]{1,40}$/.test(l)))].slice(0, 30);
    if (!token || list.length === 0) return { ok: false, updated: 0, error: token ? null : 'sem token' };
    const res = await twitchGqlCall(ctx, { token, deviceId: String(CONFIG.live?.twitchDeviceId || '') }, {
        query: 'query($l:[String!]){users(logins:$l){login stream{id} channel{self{communityPoints{balance}}}}}',
        variables: { l: list },
    });
    const users = res?.data?.users;
    if (!Array.isArray(users)) {
        return { ok: false, updated: 0, error: res?.failed || res?.errors?.[0]?.message || null };
    }
    if (!state.liveStatus) state.liveStatus = { twitch: {}, kick: {} };
    const keyByLow = new Map(Object.keys(state.liveStatus.twitch || {}).map((k) => [k.toLowerCase(), k]));
    const now = Date.now();
    let updated = 0;
    for (const u of users) {
        const login = String(u?.login || '').toLowerCase();
        if (!login) continue;
        const st = state.liveStatus.twitch[keyByLow.get(login) ?? login];
        if (st) {
            st.live = Boolean(u.stream?.id);
            st.broadcastId = u.stream?.id || null;
        }
        const bal = u?.channel?.self?.communityPoints?.balance;
        if (typeof bal === 'number') {
            recordChannelBalance(state, 'twitch', login, bal);
            if (st) {
                st.balance = bal;
                st.balanceAt = now;
            }
            updated += 1;
        }
    }
    state.liveBalancesAt = now;
    return { ok: true, updated };
};

const discoverSpadeUrl = async (ctx, login) => {
    const cached = sharedSpadeCache.get('twitch');
    if (cached && Date.now() - cached.at < (cached.ttlMs || SPADE_CACHE_MS)) return cached.url;

    try {
        const pageRes = await netFetch(ctx, `https://www.twitch.tv/${encodeURIComponent(login)}`, { method: 'GET' });
        if (pageRes.ok) {
            const html = await pageRes.text();
            const directMatch = html.match(/"spade_url"\s*:\s*"(.*?)"/);
            if (directMatch) {
                const raw = directMatch[1].replace(/\\\//g, '/');
                sharedSpadeCache.set('twitch', { url: raw, at: Date.now(), ttlMs: SPADE_CACHE_MS });
                return raw;
            }
            const settingsMatch = html.match(/(https?:\/\/[^"'\s]+\/config\/settings[^"'\s]*?\.js)/);
            if (settingsMatch) {
                const cfgRes = await netFetch(ctx, settingsMatch[1], { method: 'GET' });
                if (cfgRes.ok) {
                    const js = await cfgRes.text();
                    const spadeMatch = js.match(/"spade_url"\s*:\s*"(.*?)"/);
                    if (spadeMatch) {
                        const raw = spadeMatch[1].replace(/\\\//g, '/');
                        sharedSpadeCache.set('twitch', { url: raw, at: Date.now(), ttlMs: SPADE_CACHE_MS });
                        return raw;
                    }
                }
            }
        }
    } catch {
        // fallback abaixo
    }
    sharedSpadeCache.set('twitch', { url: TWITCH_FALLBACK_SPADE, at: Date.now(), ttlMs: 15 * 60_000 });
    return TWITCH_FALLBACK_SPADE;
};

const touchTwitchHlsSegment = async (ctx, { token, deviceId }, login) => {
    try {
        if (getPlatformRateLimit('twitch').blocked) return false;
        const rt = getRuntimeState(ctx);
        const now = Date.now();
        const cached = rt.twitchHlsPlaylistCache.get(login);
        let chosenUri = cached && now - cached.at < TWITCH_HLS_PLAYLIST_TTL_MS ? cached.uri : null;

        if (!chosenUri) {
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

            const masterRes = await twitchFetch(ctx, masterUrl, { method: 'GET' });
            if (!masterRes.ok) return false;
            const lines = (await masterRes.text()).replace(/\r\n/g, '\n').split('\n');
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
            rt.twitchHlsPlaylistCache.set(login, { at: now, uri: chosenUri });
        }

        const mediaRes = await netFetch(ctx, chosenUri, { method: 'GET' });
        if (!mediaRes.ok) {
            rt.twitchHlsPlaylistCache.delete(login);
            return false;
        }
        const segs = (await mediaRes.text())
            .replace(/\r\n/g, '\n')
            .split('\n')
            .filter((l) => l && !l.startsWith('#'));
        const lastSeg = segs[segs.length - 1];
        if (!lastSeg) return false;
        const segUrl = new URL(lastSeg, chosenUri).toString();
        let seen = rt.twitchSeenSegments.get(login);
        if (!seen) {
            seen = new Set();
            rt.twitchSeenSegments.set(login, seen);
        }
        if (seen.has(segUrl)) return true;
        const segment = await netFetch(ctx, segUrl, { method: 'HEAD' });
        if (segment.ok) {
            if (seen.size >= 100) seen.clear();
            seen.add(segUrl);
        }
        return segment.ok;
    } catch {
        return false;
    }
};

export const stepTwitchChannel = async (ctx, login, { token = '', deviceId = '', force = false, guardOnly = false, onlyKind = null, probeOnly = false } = {}) => {
    const { CONFIG, state } = ctx;
    const rt = getRuntimeState(ctx);
    if (!state.liveStatus) state.liveStatus = { twitch: {}, kick: {} };
    const status = guardOnly
        ? { balance: null, live: false, lastPingAt: 0, lastRedeemAt: 0, redeemedThisStep: false, smartNote: '', error: null }
        : (state.liveStatus.twitch[login] ||= { balance: null, live: false, lastPingAt: 0, lastRedeemAt: 0, redeemedThisStep: false, smartNote: '', error: null });
    status.redeemedThisStep = false;
    status.smartNote = '';

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
    status.broadcastId = broadcastId;
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
        status.balanceAt = now;
        for (const k of LIVE_REWARD_KINDS) {
            if (!configuredKinds.includes(k)) {
                rt.guardReads.twitch.delete(guardKey(channelKey, k));
                continue;
            }
            const cheapestRew = pickRewardForChannel(rewards, k, 'twitch', { tier: 'cheapest', balance });
            const rew = pickRewardForChannel(rewards, k, 'twitch', { tier, balance });
            if (rew) {
                const unavail = Boolean(rew.isPaused || rew.isInStock === false || rew.cooldownExpiresAt);
                const minUnavail = cheapestRew ? Boolean(cheapestRew.isPaused || cheapestRew.isInStock === false || cheapestRew.cooldownExpiresAt) : unavail;
                rt.guardReads.twitch.set(guardKey(channelKey, k), {
                    at: now,
                    points: balance,
                    cost: rew.cost,
                    minCost: cheapestRew ? cheapestRew.cost : rew.cost,
                    paused: unavail && minUnavail,
                });
            } else {
                // Cache negativo: evita reconsultar canais sem recompensa PokeIdle a cada ciclo
                rt.guardReads.twitch.set(guardKey(channelKey, k), {
                    at: now,
                    points: balance,
                    cost: null,
                    minCost: Infinity,
                    paused: true,
                });
            }
        }
    }

    const claimId = cp?.availableClaim?.id;
    if (cp && !claimId) status.manualChest = false;
    const canClaim = now >= (rt.claimRetryAt.get(channelKey) || 0);
    if (!guardOnly && CONFIG.live?.autoClaimChest && token && claimId &&
        rt.confirmedClaims.get(channelKey) !== claimId && canClaim) {
        const claimRes = await twitchGqlCall(ctx, { token, deviceId }, {
            query: 'mutation($i:ClaimCommunityPointsInput!){claimCommunityPoints(input:$i){claim{id}}}',
            variables: { i: { channelID: channelId, claimID: claimId } },
        });
        const claimData = claimRes?.data?.claimCommunityPoints;
        if (claimData?.claim?.id && !claimData.error && !claimRes?.errors?.length && !claimRes?.failed) {
            status.manualChest = false;
            rt.confirmedClaims.set(channelKey, claimId);
            state.stats.liveChestsClaimed = (state.stats.liveChestsClaimed || 0) + 1;
            balance = typeof claimData.currentPoints === 'number' ? claimData.currentPoints : (balance ?? 0) + 50;
            recordChannelBalance(state, 'twitch', login, balance);
            state.lastActionNote = `Twitch baú +50 (${login})`;
            pushLiveStepEvent(state, `Lives: caixinha +50 resgatada em ${login}.`);
        } else {
            const errCode = claimData?.error?.code || claimRes?.errors?.[0]?.message || claimRes?.failed || 'erro desconhecido';
            const isIntegrity = /integrity|anti-rob/i.test(String(errCode));
            if (isIntegrity) {
                status.manualChest = true;
                status.error = null;
            } else {
                status.error = `baú +50: ${errCode}`;
                state.lastActionNote = `Twitch baú +50 (${login}): ${errCode}`;
            }
            if (errCode && errCode !== 'NOT_FOUND') {
                rt.claimRetryAt.set(channelKey, now + (isIntegrity ? RETRY_WAIT_MS : 60_000));
            }
        }
    }

    const lastPing = rt.twitchLastPingAt.get(login) || 0;
    if (!guardOnly && CONFIG.live?.watchTwitch && broadcastId && userId && (force || now - lastPing >= 48_000)) {
        const spadeUrl = await discoverSpadeUrl(ctx, login);
        const encoded = encodeSpadePayload({ channelId, broadcastId, userId, login, game, gameId });
        const pingRes = await netFetch(ctx, spadeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(encoded)}`,
        });
        if (pingRes.ok) {
            rt.twitchLastPingAt.set(login, now);
            status.lastPingAt = now;
            state.stats.liveMinutesWatched = (state.stats.liveMinutesWatched || 0) + 1;
        }
        await touchTwitchHlsSegment(ctx, { token, deviceId }, login);
    }

    const canRetryRedeem = force || now >= (rt.redeemRetryAt.twitch.get(channelKey) || 0);
    const hasTwitchGameData = state.liveGameData?.twitch != null || Object.keys(rt.optimisticBonusUntil?.twitch || {}).length > 0;
    if (!probeOnly && CONFIG.live?.autoRedeem && token && balance !== null && canRetryRedeem && activeKinds.length > 0 && hasTwitchGameData) {
        const serverNow = Date.now() - (state.liveGameData?.skew || 0);
        const bonusState = buildEffectiveBonusState(rt, state.liveGameData?.twitch, 'twitch');
        const otherBonusState = buildEffectiveBonusState(rt, state.liveGameData?.kick, 'kick');
        const thresholdMin = resolveEffectiveThresholdMin(CONFIG.live);
        const criticalMin = Math.max(15, Number(CONFIG.live?.guardThresholdMin ?? 30) || 30);
        const smartOn = CONFIG.live?.smartBalance === true;
        const lastRedeemMap = getLastRedeemMapForPlatform(rt, 'twitch');
        const orderedKinds = orderBuffsForRedeem(activeKinds, bonusState, CONFIG.live, serverNow, lastRedeemMap);
        const criticalPending = new Set(
            orderedKinds.filter((k) => getBonusRemainingMin(bonusState, k, serverNow) <= criticalMin)
        );
        const candidateMeta = new Map();
        const priorityFloor = buffPriorityThresholdMin(CONFIG.live);
        for (const k of orderedKinds) {
            const rem = getBonusRemainingMin(bonusState, k, serverNow);
            const minRew = pickRewardForChannel(rewards, k, 'twitch', { tier: 'cheapest', balance });
            const unavail = minRew ? Boolean(minRew.isPaused || minRew.isInStock === false || minRew.cooldownExpiresAt) : true;
            candidateMeta.set(k, {
                remainingMin: rem,
                needsRedeem: rem < priorityFloor || (thresholdMin <= criticalMin && needsBuffRedeem(rem, CONFIG.live)),
                available: Boolean(minRew && !unavail),
                minCost: minRew ? minRew.cost : Infinity,
                minHours: minRew ? extractRewardHours(minRew) : 1,
                lastRedeemAt: lastRedeemMap[k] || 0,
                recentlyRedeemed: !canRedeemPlatform(rt, 'twitch', k, now, false),
            });
        }
        for (const kind of orderedKinds) {
            if (!canRedeemPlatform(rt, 'twitch', kind, now, false)) continue;
            const meta = candidateMeta.get(kind);
            const remainingMin = meta?.remainingMin ?? getBonusRemainingMin(bonusState, kind, serverNow);
            const needsRedeem = meta ? meta.needsRedeem : needsBuffRedeem(remainingMin, CONFIG.live);
            if (!needsRedeem) continue;
            const reserveCheck = shouldReservePointsForHigherPriority({
                kind,
                orderedKinds,
                candidateMeta,
                smartBalance: smartOn,
            });
            if (!reserveCheck.allow) {
                if (!status.smartNote && reserveCheck.reason) status.smartNote = reserveCheck.reason;
                continue;
            }
            const crossCheck = resolveCrossPlatformBlocker({
                platform: 'twitch',
                kind,
                configuredKinds: activeKinds,
                liveConfig: CONFIG.live,
                otherBonusState,
                now: serverNow,
            });
            if (crossCheck.blocked) {
                if (!status.smartNote && crossCheck.reason) status.smartNote = crossCheck.reason;
                continue;
            }
            const deficitMin = Math.max(0, thresholdMin - remainingMin);
            const preferQuickTurnOn = smartOn && thresholdMin <= 60 && criticalPending.has(kind) && criticalPending.size > 1;
            const reward = pickRewardForChannel(rewards, kind, 'twitch', {
                tier,
                balance,
                deficitMin,
                preferQuickTurnOn,
            });
            const unavailable = reward ? Boolean(reward.isPaused || reward.isInStock === false || reward.cooldownExpiresAt) : true;
            if (!reward || unavailable) continue;
            if (balance < reward.cost) {
                if (!status.smartNote) {
                    const hrs = extractRewardHours(reward);
                    status.smartNote = `próx. ${kind.toUpperCase()} (${reward.cost} pts · ${hrs}h)`;
                }
                continue;
            }

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
                recordOptimisticRedeem(rt, 'twitch', kind, reward, serverNow, state.liveGameData?.twitch);
                if (meta) {
                    const updatedBonus = buildEffectiveBonusState(rt, state.liveGameData?.twitch, 'twitch');
                    const nextRem = getBonusRemainingMin(updatedBonus, kind, serverNow);
                    meta.remainingMin = nextRem;
                    meta.needsRedeem = needsBuffRedeem(nextRem, CONFIG.live);
                    meta.recentlyRedeemed = true;
                }
                status.lastRedeemAt = now;
                status.redeemedThisStep = true;
                status.smartNote = '';
                rt.lastPlatformRedeemAt[`twitch:${kind}`] = now;
                state.stats.liveRewardsRedeemed = (state.stats.liveRewardsRedeemed || 0) + 1;
                state.lastActionNote = `Twitch resgatou ${reward.title} (${login})`;
                pushLiveStepEvent(state, `Twitch resgatou ${reward.title} (${login}).`);
            } else {
                rt.redeemRetryAt.twitch.set(login, now + RETRY_WAIT_MS);
                status.error = p?.error?.code || redRes?.errors?.[0]?.message || redRes?.failed || 'resgate recusado';
                break;
            }
        }
    }

    status.balance = balance;
    if (!guardOnly && !status.live) {
        delete state.liveStatus.twitch[login];
        rt.lastLiveProbeAt.twitch = 0;
    }
    return status;
};

// --- Kick Leve ---

const kickHeaders = (token) => ({
    Accept: 'application/json',
    Origin: 'https://kick.com',
    Referer: 'https://kick.com/',
    'x-app-platform': 'web',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const kickFetch = (ctx, url, opts = {}) =>
    enqueuePlatformRequest(ctx, 'kick', () => netFetch(ctx, url, opts));

const fetchKickChannelInfo = async (ctx, slug, headers, { force = false, cacheTtlMs = KICK_INFO_CACHE_MS } = {}) => {
    const key = String(slug || '').trim().toLowerCase();
    const now = Date.now();
    const cached = sharedKickInfoCache.get(key);
    if (!force && cached && now - cached.at < cacheTtlMs) {
        return { ok: true, status: 200, info: cached.data, cached: true };
    }
    if (!force && sharedKickInfoInFlight.has(key)) {
        return sharedKickInfoInFlight.get(key);
    }
    const run = (async () => {
        let infoRes = await kickFetch(ctx, `${KICK_API_URL}/api/v2/channels/${encodeURIComponent(slug)}/info`, { method: 'GET', headers });
        if (!infoRes.ok && infoRes.status !== 429 && infoRes.status !== 401 && infoRes.status !== 403) {
            infoRes = await kickFetch(ctx, `${KICK_API_URL}/api/v2/channels/${encodeURIComponent(slug)}`, { method: 'GET', headers });
        }
        if (!infoRes.ok) {
            const rl = getPlatformRateLimit('kick');
            return {
                ok: false,
                status: infoRes.status,
                rateLimited: infoRes.status === 429,
                retryAfterMs: infoRes.status === 429 ? rl.remainingMs : 0,
                info: null,
            };
        }
        const rawInfo = await infoRes.json();
        const info = rawInfo?.data && rawInfo?.id == null ? rawInfo.data : rawInfo;
        sharedKickInfoCache.set(key, { at: Date.now(), data: info });
        return { ok: true, status: 200, info, cached: false };
    })();
    if (!force) sharedKickInfoInFlight.set(key, run);
    try {
        return await run;
    } finally {
        if (sharedKickInfoInFlight.get(key) === run) sharedKickInfoInFlight.delete(key);
    }
};

const fetchKickChannelRewards = async (ctx, slug, headers, { force = false } = {}) => {
    const key = String(slug || '').trim().toLowerCase();
    const now = Date.now();
    const cached = sharedKickRewardsCache.get(key);
    if (!force && cached && now - cached.at < KICK_REWARDS_CACHE_MS) {
        return { ok: true, status: 200, rewards: cached.rewards, rateLimited: false };
    }
    if (!force && sharedKickRewardsInFlight.has(key)) {
        return sharedKickRewardsInFlight.get(key);
    }
    const run = (async () => {
        const rewRes = await kickFetch(ctx, `${KICK_API_URL}/api/v2/channels/${encodeURIComponent(slug)}/rewards`, { method: 'GET', headers });
        if (rewRes.status === 429) {
            return { ok: false, status: 429, rewards: cached?.rewards || [], rateLimited: true };
        }
        const rewards = rewRes.ok ? (await rewRes.json())?.data || [] : [];
        if (rewRes.ok) {
            sharedKickRewardsCache.set(key, { at: Date.now(), rewards });
        }
        return { ok: Boolean(rewRes.ok), status: rewRes.status, rewards, rateLimited: false };
    })();
    if (!force) sharedKickRewardsInFlight.set(key, run);
    try {
        return await run;
    } finally {
        if (sharedKickRewardsInFlight.get(key) === run) sharedKickRewardsInFlight.delete(key);
    }
};

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
    const rt = getRuntimeState(ctx);
    if (rt.kickTimer) return;
    rt.kickTimer = setInterval(() => {
        if (!ctx.state?.running || ctx.state?.paused || !ctx.CONFIG?.live?.enabled || !ctx.CONFIG?.live?.watchKick) return;
        for (const [, conn] of rt.kickSockets) {
            flushKickSocketEvents(ctx, conn, false);
        }
    }, 15000);
};

const ensureKickViewerSocket = async (ctx, slug, { token, channelId, livestreamId, vodId, force = false }) => {
    const { net } = ctx;
    const rt = getRuntimeState(ctx);
    const createWs = net?.createWebSocket || (typeof WebSocket === 'function' ? (url) => new WebSocket(url) : null);
    if (!createWs) return false;

    let conn = rt.kickSockets.get(slug);
    const nowMs = Date.now();
    const staleSocket = conn && (
        !conn.ws ||
        conn.ws.readyState > 1 ||
        conn.token !== token ||
        (conn.ws.readyState === 0 && nowMs - (conn.createdAt || 0) > 15_000) ||
        nowMs - (conn.createdAt || 0) > 2 * 3600_000
    );
    if (staleSocket) {
        try { conn.ws?.close?.(); } catch { /* ignore */ }
        rt.kickSockets.delete(slug);
        conn = null;
    }
    if (!conn) {
        const tokRes = await kickFetch(ctx, `${KICK_WS_API_URL}/viewer/v1/token`, {
            method: 'GET',
            headers: { ...kickHeaders(token), 'X-CLIENT-TOKEN': KICK_CLIENT_TOKEN },
        });
        if (!tokRes.ok) return false;
        const tokJson = await tokRes.json();
        const viewerToken = tokJson?.data?.token;
        if (!viewerToken) return false;

        const ws = createWs(`${KICK_WS_URL}?token=${encodeURIComponent(viewerToken)}`);
        conn = { ws, token, createdAt: nowMs, channelId, livestreamId, vodId, lastHandshakeAt: 0, lastPingAt: 0, lastWatchAt: 0 };
        rt.kickSockets.set(slug, conn);

        const onOpen = () => flushKickSocketEvents(ctx, conn, true);
        const onClose = () => {
            if (rt.kickSockets.get(slug) === conn) rt.kickSockets.delete(slug);
        };
        if (typeof ws.addEventListener === 'function') {
            ws.addEventListener('open', onOpen);
            ws.addEventListener('close', onClose);
            ws.addEventListener('error', onClose);
        } else if ('onopen' in ws || typeof ws === 'object') {
            ws.onopen = onOpen;
            ws.onclose = onClose;
            ws.onerror = onClose;
        }
    } else {
        conn.channelId = channelId;
        conn.livestreamId = livestreamId;
        conn.vodId = vodId;
    }

    ensureKickHeartbeatTimer(ctx);
    return flushKickSocketEvents(ctx, conn, force);
};

const readKickPointsAndRewards = async (ctx, slug, headers, { force = false } = {}) => {
    const ptsRes = await kickFetch(ctx, `${KICK_API_URL}/api/v2/channels/${encodeURIComponent(slug)}/points`, { method: 'GET', headers });
    if (ptsRes.status === 429) return { rateLimited: true, points: null, rewards: [] };
    if (!ptsRes.ok) return null;
    const ptsJson = await ptsRes.json();
    const points = ptsJson?.data?.points;
    if (typeof points !== 'number') return null;

    const rewRes = await fetchKickChannelRewards(ctx, slug, headers, { force });
    return { points, rewards: rewRes.rewards || [], rateLimited: Boolean(rewRes.rateLimited) };
};

export const stepKickChannel = async (ctx, slug, { token = '', force = false, guardOnly = false, onlyKind = null, probeOnly = false } = {}) => {
    const { CONFIG, state } = ctx;
    const rt = getRuntimeState(ctx);
    if (!state.liveStatus) state.liveStatus = { twitch: {}, kick: {} };
    const status = guardOnly
        ? { balance: null, live: false, wsOpen: false, lastPingAt: 0, lastRedeemAt: 0, redeemedThisStep: false, smartNote: '', error: null }
        : (state.liveStatus.kick[slug] ||= { balance: null, live: false, wsOpen: false, lastPingAt: 0, lastRedeemAt: 0, redeemedThisStep: false, smartNote: '', error: null });
    status.redeemedThisStep = false;
    status.smartNote = '';

    const rlBefore = getPlatformRateLimit('kick');
    if (rlBefore.blocked) {
        status.error = formatRateLimitError('kick', rlBefore.remainingMs);
        return status;
    }

    const headers = kickHeaders(token);
    let live = status.live;
    if (!guardOnly) {
        const wsAlreadyOpen = rt.kickSockets.get(slug)?.ws?.readyState === 1;
        const infoResult = await fetchKickChannelInfo(ctx, slug, headers, {
            force,
            cacheTtlMs: wsAlreadyOpen ? KICK_INFO_WS_CACHE_MS : KICK_INFO_CACHE_MS,
        });
        if (!infoResult.ok) {
            status.error = infoResult.rateLimited
                ? formatRateLimitError('kick', infoResult.retryAfterMs || getPlatformRateLimit('kick').remainingMs)
                : `erro ${infoResult.status}`;
            return status;
        }

        const info = infoResult.info;
        const channelId = info?.id;
        const stream = info?.livestream;
        live = Boolean(stream && stream.is_live !== false);
        const livestreamId = stream?.id || null;
        const vodId = stream?.vod_id ?? stream?.vod?.id ?? null;

        status.live = live;
        status.error = null;

        if (!live) {
            const oldConn = rt.kickSockets.get(slug);
            if (oldConn) {
                try { oldConn.ws?.close?.(); } catch { /* ja fechado */ }
                rt.kickSockets.delete(slug);
            }
            status.wsOpen = false;
            delete state.liveStatus.kick[slug];
            rt.lastLiveProbeAt.kick = 0;
        } else if (CONFIG.live?.watchKick && token && channelId && livestreamId) {
            const ok = await ensureKickViewerSocket(ctx, slug, { token, channelId, livestreamId, vodId, force });
            status.wsOpen = ok;
            if (ok) status.lastPingAt = Date.now();
            else if (getPlatformRateLimit('kick').blocked) {
                status.error = formatRateLimitError('kick', getPlatformRateLimit('kick').remainingMs);
                return status;
            }
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

    const lastCheck = rt.kickPointsCheckAt.get(slug) || 0;
    const hasKickGameData = state.liveGameData?.kick != null || Object.keys(rt.optimisticBonusUntil?.kick || {}).length > 0;
    const bonusKickNow = hasKickGameData ? buildEffectiveBonusState(rt, state.liveGameData?.kick, 'kick') : null;
    const kickNeedEarly = Boolean(
        !guardOnly &&
        !probeOnly &&
        hasKickGameData &&
        CONFIG.live?.autoRedeem &&
        typeof status.balance === 'number' &&
        activeKinds.some((k) => needsBuffRedeem(getBonusRemainingMin(bonusKickNow, k, Date.now() - (state.liveGameData?.skew || 0)), CONFIG.live)) &&
        now - lastCheck >= 60_000
    );
    if (token && (force || guardOnly || kickNeedEarly || now - lastCheck >= 290000)) {
        const data = await readKickPointsAndRewards(ctx, slug, headers, { force });
        if (data?.rateLimited && data.points == null) {
            status.error = formatRateLimitError('kick', getPlatformRateLimit('kick').remainingMs);
            return status;
        }
        if (data && typeof data.points === 'number') {
            rt.kickPointsCheckAt.set(slug, now);
            let { points, rewards } = data;
            status.balance = points;
            recordChannelBalance(state, 'kick', slug, points);
            for (const k of LIVE_REWARD_KINDS) {
                if (!configuredKinds.includes(k)) {
                    rt.guardReads.kick.delete(guardKey(channelKey, k));
                    continue;
                }
                const cheapestRew = pickRewardForChannel(rewards, k, 'kick', { tier: 'cheapest', balance: points });
                const rew = pickRewardForChannel(rewards, k, 'kick', { tier, balance: points });
                if (rew) {
                    rt.guardReads.kick.set(guardKey(channelKey, k), {
                        at: now,
                        points,
                        cost: rew.cost,
                        minCost: cheapestRew ? cheapestRew.cost : rew.cost,
                        paused: Boolean(rew.is_paused && (!cheapestRew || cheapestRew.is_paused)),
                    });
                } else {
                    rt.guardReads.kick.set(guardKey(channelKey, k), {
                        at: now,
                        points,
                        cost: null,
                        minCost: Infinity,
                        paused: true,
                    });
                }
            }

            const canRetryRedeem = force || now >= (rt.redeemRetryAt.kick.get(channelKey) || 0);
            if (!probeOnly && CONFIG.live?.autoRedeem && canRetryRedeem && activeKinds.length > 0 && hasKickGameData) {
                const serverNow = Date.now() - (state.liveGameData?.skew || 0);
                const bonusState = buildEffectiveBonusState(rt, state.liveGameData?.kick, 'kick');
                const otherBonusState = buildEffectiveBonusState(rt, state.liveGameData?.twitch, 'twitch');
                const thresholdMin = resolveEffectiveThresholdMin(CONFIG.live);
                const criticalMin = Math.max(15, Number(CONFIG.live?.guardThresholdMin ?? 30) || 30);
                const smartOn = CONFIG.live?.smartBalance === true;
                const lastRedeemMap = getLastRedeemMapForPlatform(rt, 'kick');
                const orderedKinds = orderBuffsForRedeem(activeKinds, bonusState, CONFIG.live, serverNow, lastRedeemMap);
                const criticalPending = new Set(
                    orderedKinds.filter((k) => getBonusRemainingMin(bonusState, k, serverNow) <= criticalMin)
                );
                const candidateMeta = new Map();
                const kickPriorityFloor = buffPriorityThresholdMin(CONFIG.live);
                for (const k of orderedKinds) {
                    const rem = getBonusRemainingMin(bonusState, k, serverNow);
                    const minRew = pickRewardForChannel(rewards, k, 'kick', { tier: 'cheapest', balance: points });
                    candidateMeta.set(k, {
                        remainingMin: rem,
                        needsRedeem: rem < kickPriorityFloor || (thresholdMin <= criticalMin && needsBuffRedeem(rem, CONFIG.live)),
                        available: Boolean(minRew && !minRew.is_paused),
                        minCost: minRew ? minRew.cost : Infinity,
                        minHours: minRew ? extractRewardHours(minRew) : 1,
                        lastRedeemAt: lastRedeemMap[k] || 0,
                        recentlyRedeemed: !canRedeemPlatform(rt, 'kick', k, now, false),
                    });
                }
                for (const kind of orderedKinds) {
                    if (!canRedeemPlatform(rt, 'kick', kind, now, false)) continue;
                    const meta = candidateMeta.get(kind);
                    const remainingMin = meta?.remainingMin ?? getBonusRemainingMin(bonusState, kind, serverNow);
                    const needsRedeem = meta ? meta.needsRedeem : needsBuffRedeem(remainingMin, CONFIG.live);
                    if (!needsRedeem) continue;
                    const reserveCheck = shouldReservePointsForHigherPriority({
                        kind,
                        orderedKinds,
                        candidateMeta,
                        smartBalance: smartOn,
                    });
                    if (!reserveCheck.allow) {
                        if (!status.smartNote && reserveCheck.reason) status.smartNote = reserveCheck.reason;
                        continue;
                    }
                    const crossCheck = resolveCrossPlatformBlocker({
                        platform: 'kick',
                        kind,
                        configuredKinds: activeKinds,
                        liveConfig: CONFIG.live,
                        otherBonusState,
                        now: serverNow,
                    });
                    if (crossCheck.blocked) {
                        if (!status.smartNote && crossCheck.reason) status.smartNote = crossCheck.reason;
                        continue;
                    }
                    const deficitMin = Math.max(0, thresholdMin - remainingMin);
                    const preferQuickTurnOn = smartOn && thresholdMin <= 60 && criticalPending.has(kind) && criticalPending.size > 1;
                    const reward = pickRewardForChannel(rewards, kind, 'kick', {
                        tier,
                        balance: points,
                        deficitMin,
                        preferQuickTurnOn,
                    });
                    if (!reward || reward.is_paused) continue;
                    if (points < reward.cost) {
                        if (!status.smartNote) {
                            const hrs = extractRewardHours(reward);
                            status.smartNote = `próx. ${kind.toUpperCase()} (${reward.cost} pts · ${hrs}h)`;
                        }
                        continue;
                    }
                    const redRes = await kickFetch(ctx, `${KICK_API_URL}/api/v2/channels/${encodeURIComponent(slug)}/rewards/${reward.id}/redeem`, {
                        method: 'POST',
                        headers: { ...headers, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ transaction_id: generateUlid(now), message: '' }),
                    });
                    if (redRes.ok) {
                        points -= reward.cost;
                        criticalPending.delete(kind);
                        status.balance = points;
                        recordChannelBalance(state, 'kick', slug, points);
                        recordOptimisticRedeem(rt, 'kick', kind, reward, serverNow, state.liveGameData?.kick);
                        if (meta) {
                            const updatedBonus = buildEffectiveBonusState(rt, state.liveGameData?.kick, 'kick');
                            const nextRem = getBonusRemainingMin(updatedBonus, kind, serverNow);
                            meta.remainingMin = nextRem;
                            meta.needsRedeem = needsBuffRedeem(nextRem, CONFIG.live);
                            meta.recentlyRedeemed = true;
                        }
                        status.lastRedeemAt = now;
                        status.redeemedThisStep = true;
                        status.smartNote = '';
                        rt.lastPlatformRedeemAt[`kick:${kind}`] = now;
                        state.stats.liveRewardsRedeemed = (state.stats.liveRewardsRedeemed || 0) + 1;
                        state.lastActionNote = `Kick resgatou ${reward.title} (${slug})`;
                        pushLiveStepEvent(state, `Kick resgatou ${reward.title} (${slug}).`);
                    } else if (redRes.status === 429) {
                        status.error = formatRateLimitError('kick', getPlatformRateLimit('kick').remainingMs);
                        break;
                    } else {
                        rt.redeemRetryAt.kick.set(slug, now + RETRY_WAIT_MS);
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
    const rt = getRuntimeState(ctx);
    const now = Date.now();
    if (!CONFIG.live?.autoRedeem || !token) return false;
    if (state.liveGameData?.[platform] == null && Object.keys(rt.optimisticBonusUntil?.[platform] || {}).length === 0) {
        return false;
    }

    const serverNow = now - (state.liveGameData?.skew || 0);
    const bonusState = buildEffectiveBonusState(rt, state.liveGameData?.[platform], platform);
    const smartOn = CONFIG.live?.smartBalance === true;
    const lastRedeemMap = getLastRedeemMapForPlatform(rt, platform);

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

    const otherPlatform = platform === 'twitch' ? 'kick' : 'twitch';
    const eligibleKinds = LIVE_REWARD_KINDS.filter((kind) =>
        canRedeemPlatform(rt, platform, kind, now, false) &&
        needsBuffRedeem(getBonusRemainingMin(bonusState, kind, serverNow), CONFIG.live) &&
        candidates.some((ch) => resolveChannelRewardKinds(CONFIG.live, platform, ch).includes(kind))
    );
    const kindsToCheck = orderBuffsForRedeem(eligibleKinds, bonusState, CONFIG.live, serverNow, lastRedeemMap);
    if (kindsToCheck.length === 0) return false;

    const readsMap = rt.guardReads[platform];
    const tier = CONFIG.live?.rewardTier || 'cheapest';
    if (getPlatformRateLimit(platform).blocked) return false;
    const maxProbes = platform === 'kick' ? MAX_GUARD_PROBES_KICK : MAX_GUARD_PROBES_TWITCH;
    let probedCount = 0;
    for (const ch of candidates) {
        if (!state.running) return false;
        if (getPlatformRateLimit(platform).blocked) break;
        const chKinds = resolveChannelRewardKinds(CONFIG.live, platform, ch)
            .filter((k) => kindsToCheck.includes(k));
        if (chKinds.length === 0) continue;
        const allFresh = chKinds.every((k) => {
            const cached = readsMap.get(guardKey(ch, k));
            return cached && now - cached.at <= GUARD_READ_TTL_MS;
        });
        if (allFresh) continue;
        if (probedCount >= maxProbes) break;
        probedCount += 1;
        if (platform === 'twitch') {
            await stepTwitchChannel(ctx, ch, { token, deviceId, force: false, guardOnly: true, probeOnly: true });
        } else {
            const data = await readKickPointsAndRewards(ctx, ch, kickHeaders(token), { force: false });
            if (data?.rateLimited && data.points == null) break;
            if (data && typeof data.points === 'number') {
                recordChannelBalance(state, 'kick', ch, data.points);
                for (const k of chKinds) {
                    const cheapestRew = pickRewardForChannel(data.rewards, k, 'kick', { tier: 'cheapest', balance: data.points });
                    const rew = pickRewardForChannel(data.rewards, k, 'kick', { tier, balance: data.points });
                    if (rew) {
                        readsMap.set(guardKey(ch, k), {
                            at: Date.now(),
                            points: data.points,
                            cost: rew.cost,
                            minCost: cheapestRew ? cheapestRew.cost : rew.cost,
                            paused: Boolean(rew.is_paused && (!cheapestRew || cheapestRew.is_paused)),
                        });
                    } else {
                        readsMap.set(guardKey(ch, k), {
                            at: Date.now(),
                            points: data.points,
                            cost: null,
                            minCost: Infinity,
                            paused: true,
                        });
                    }
                }
            } else {
                for (const k of chKinds) {
                    readsMap.set(guardKey(ch, k), { at: Date.now(), points: 0, cost: null, minCost: Infinity, paused: true });
                }
            }
        }
    }

    if (getPlatformRateLimit(platform).blocked) return false;
    let redeemedAny = false;
    for (const kind of kindsToCheck) {
        if (!state.running || !canRedeemPlatform(rt, platform, kind, Date.now(), false)) continue;
        const curBonusState = buildEffectiveBonusState(rt, state.liveGameData?.[platform], platform);
        const curOtherBonus = buildEffectiveBonusState(rt, state.liveGameData?.[otherPlatform], otherPlatform);
        const kindCandidates = candidates.filter((ch) => {
            const chLow = ch.toLowerCase();
            if (Date.now() < (rt.redeemRetryAt[platform].get(chLow) || rt.redeemRetryAt[platform].get(ch) || 0)) return false;
            const chKinds = resolveChannelRewardKinds(CONFIG.live, platform, ch);
            if (!chKinds.includes(kind)) return false;
            if (!smartOn) return true;
            const entry = readsMap.get(guardKey(ch, kind));
            if (!entry) return false;
            const chOrdered = orderBuffsForRedeem(chKinds, curBonusState, CONFIG.live, serverNow, getLastRedeemMapForPlatform(rt, platform));
            const chMeta = new Map();
            const chPriorityFloor = buffPriorityThresholdMin(CONFIG.live);
            for (const k of chOrdered) {
                const r = readsMap.get(guardKey(ch, k));
                const rem = getBonusRemainingMin(curBonusState, k, serverNow);
                chMeta.set(k, {
                    remainingMin: rem,
                    needsRedeem: rem < chPriorityFloor,
                    available: Boolean(r && !r.paused),
                    minCost: r ? (r.minCost ?? r.cost) : Infinity,
                    lastRedeemAt: Number(rt.lastPlatformRedeemAt[`${platform}:${k}`] || 0),
                    recentlyRedeemed: !canRedeemPlatform(rt, platform, k, Date.now(), false),
                });
            }
            if (!shouldReservePointsForHigherPriority({
                kind,
                orderedKinds: chOrdered,
                candidateMeta: chMeta,
                smartBalance: true,
            }).allow) {
                return false;
            }
            return !resolveCrossPlatformBlocker({
                platform,
                kind,
                configuredKinds: chKinds,
                liveConfig: CONFIG.live,
                otherBonusState: curOtherBonus,
                now: serverNow,
            }).blocked;
        });
        const kindReads = new Map();
        for (const ch of kindCandidates) {
            const entry = readsMap.get(guardKey(ch, kind));
            if (entry) kindReads.set(ch.toLowerCase(), entry);
        }
        const remainingCands = [...kindCandidates];
        for (let attempt = 0; attempt < 2 && remainingCands.length > 0; attempt++) {
            const best = pickBonusGuardCandidate(remainingCands, kindReads, liveSet);
            if (!best) break;
            const st = platform === 'twitch'
                ? await stepTwitchChannel(ctx, best.channel, { token, deviceId, force: false, guardOnly: true, onlyKind: kind })
                : await stepKickChannel(ctx, best.channel, { token, force: false, guardOnly: true, onlyKind: kind });
            if (st?.redeemedThisStep) {
                redeemedAny = true;
                break;
            }
            const rmIdx = remainingCands.findIndex((c) => c.toLowerCase() === best.channel.toLowerCase());
            if (rmIdx !== -1) remainingCands.splice(rmIdx, 1);
            kindReads.delete(best.channel.toLowerCase());
        }
    }
    return redeemedAny;
};

// --- Ciclo principal ---

export const runLiveCycle = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, updateHud } = ctx;
    const rt = getRuntimeState(ctx);
    if (!state.running || (!CONFIG.live?.enabled && !force)) return;
    if (rt.cycleInFlight) return;
    rt.cycleInFlight = true;

    try {
        installGameWsTap(ctx);
        readDomBonusFallback(ctx);

        const { twitchToken, twitchDeviceId, kickToken } = await syncCookiesToConfig(ctx);

        const probeNow = Date.now();
        const gameDataStale = !state.liveGameData?.updatedAt || (probeNow - state.liveGameData.updatedAt >= 180_000);
        const shouldProbeTw = (!Array.isArray(state.liveGameData?.twitch?.oficiais) || gameDataStale) &&
            !getPlatformRateLimit('twitch').blocked &&
            probeNow - rt.lastLiveProbeAt.twitch >= 120_000;
        if (shouldProbeTw) {
            rt.lastLiveProbeAt.twitch = probeNow;
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
                if (Array.isArray(state.liveGameData.twitch.oficiais)) {
                    state.liveGameData.twitch.oficiais = state.liveGameData.twitch.oficiais.map((o) => {
                        const low = String(o?.login || '').toLowerCase();
                        return low in liveMap ? { ...o, aoVivo: Boolean(liveMap[low]) } : o;
                    });
                }
            }
        }

        const shouldProbeKk = (!Array.isArray(state.liveGameData?.kick?.oficiais) || gameDataStale) &&
            !getPlatformRateLimit('kick').blocked &&
            probeNow - rt.lastLiveProbeAt.kick >= 120_000;
        if (shouldProbeKk) {
            const customKk = String(CONFIG.live?.customKickChannels || '').split(/[\s,;]+/).filter(Boolean);
            const knownKk = (state.liveGameData?.kick?.oficiais || []).map((o) => o?.slug).filter(Boolean);
            const poolKk = [...new Set([...customKk, ...knownKk, ...DEFAULT_KICK_OFFICIALS])];
            const probed = [];
            for (const slug of poolKk) {
                if (!state.running || getPlatformRateLimit('kick').blocked) break;
                try {
                    const resInfo = await fetchKickChannelInfo(ctx, slug, kickHeaders(kickToken), { force: false });
                    if (resInfo.rateLimited) break;
                    const j = resInfo.info;
                    probed.push({ slug, aoVivo: Boolean(j?.livestream && j.livestream.is_live !== false), ativo: true });
                } catch {
                    probed.push({ slug, aoVivo: false, ativo: true });
                }
            }
            if (probed.length > 0) {
                if (!state.liveGameData) state.liveGameData = { twitch: null, kick: null, skew: 0 };
                state.liveGameData.kick = { ...(state.liveGameData.kick || {}), canaisConsultados: probed };
                if (Array.isArray(state.liveGameData.kick.oficiais)) {
                    const kkMap = new Map(probed.map((p) => [p.slug.toLowerCase(), p.aoVivo]));
                    state.liveGameData.kick.oficiais = state.liveGameData.kick.oficiais.map((o) => {
                        const low = String(o?.slug || '').toLowerCase();
                        return kkMap.has(low) ? { ...o, aoVivo: kkMap.get(low) } : o;
                    });
                }
            }
            rt.lastLiveProbeAt.kick = probeNow;
        }

        const twMaxSlots = Math.max(1, Number(CONFIG.live?.maxTwitchSlots ?? CONFIG.live?.maxSlots) || 4);
        const kkMaxSlots = Math.max(1, Number(CONFIG.live?.maxKickSlots ?? CONFIG.live?.maxSlots) || 2);

        const filterOnlyLiveCustom = (csv, list) => {
            if (!csv) return '';
            if (!Array.isArray(list) || list.length === 0) return csv;
            const liveMap = new Map(list.map((o) => [String(o?.login || o?.slug || '').toLowerCase(), Boolean(o?.aoVivo)]));
            return String(csv)
                .split(/[\s,;]+/)
                .filter((ch) => {
                    const low = ch.trim().toLowerCase();
                    if (!low) return false;
                    return liveMap.has(low) ? liveMap.get(low) : true;
                })
                .join(',');
        };

        const channelsFor = (platform) => {
            const data = state.liveGameData?.[platform];
            return data?.oficiais ?? data?.canaisConsultados;
        };
        const liveCustomTw = filterOnlyLiveCustom(CONFIG.live?.customTwitchChannels, channelsFor('twitch'));
        const liveCustomKk = filterOnlyLiveCustom(CONFIG.live?.customKickChannels, channelsFor('kick'));
        const twChannels = selectChannelsToWatch(channelsFor('twitch'), liveCustomTw, twMaxSlots);
        const kkChannels = selectChannelsToWatch(channelsFor('kick'), liveCustomKk, kkMaxSlots);

        if (twChannels.length === 0 && kkChannels.length === 0 && force && !rt.modalSyncDone) {
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

        if (CONFIG.live?.watchKick || CONFIG.live?.autoRedeem) {
            const activeKk = new Set(finalKk.map((s) => s.toLowerCase()));
            for (const [slug, conn] of rt.kickSockets.entries()) {
                if (!activeKk.has(String(slug).toLowerCase())) {
                    try {
                        conn.ws?.close?.();
                    } catch {
                        // já fechado
                    }
                    rt.kickSockets.delete(slug);
                }
            }
            for (const slug of finalKk) {
                if (!state.running || getPlatformRateLimit('kick').blocked) break;
                await stepKickChannel(ctx, slug, { token: kickToken, force })
                    .catch(() => {
                        const status = state.liveStatus?.kick?.[slug];
                        if (status) status.error ||= 'falha de comunicação com o Kick';
                    });
            }
            if (!getPlatformRateLimit('kick').blocked) {
                await runBonusGuard(ctx, 'kick', {
                    token: kickToken,
                    watched: finalKk,
                    officials: state.liveGameData?.kick?.oficiais,
                    customCsv: CONFIG.live?.customKickChannels,
                }).catch(() => {
                    state.lastActionNote = 'Kick: falha ao verificar bônus';
                });
            }
        }

        if (CONFIG.live?.watchTwitch || CONFIG.live?.autoClaimChest || CONFIG.live?.autoRedeem) {
            for (const login of finalTw) {
                if (!state.running || getPlatformRateLimit('twitch').blocked) break;
                await stepTwitchChannel(ctx, login, { token: twitchToken, deviceId: twitchDeviceId, force })
                    .catch(() => {
                        const status = state.liveStatus?.twitch?.[login];
                        if (status) status.error ||= 'falha de comunicação com a Twitch';
                    });
            }
            if (!getPlatformRateLimit('twitch').blocked) {
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
        }

        if (!twitchToken && !kickToken && (finalTw.length > 0 || finalKk.length > 0)) {
            state.lastActionNote = 'Lives: informe token ou permita GM_cookie';
        }
        updateHud?.();
    } finally {
        rt.cycleInFlight = false;
    }
};

const dispose = (ctx = null) => {
    if (ctx && ctx.state && typeof ctx.state === 'object') {
        const rt = runtimeStateByObj.get(ctx.state);
        if (rt) {
            clearRuntimeState(rt);
            runtimeStateByObj.delete(ctx.state);
            activeRuntimeStates.delete(rt);
        }
        return;
    }
    sharedSpadeCache.clear();
    resetLiveRateLimits();
    for (const rt of activeRuntimeStates) {
        clearRuntimeState(rt);
    }
    activeRuntimeStates.clear();
    activeRuntimeStates.add(defaultRuntimeState);
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
