// Controlador stateful de farm headless e servidor HTTP/API para Dashboard Web e App Desktop.
import { createServer } from 'node:http';
import { fetchSpeciesCatalog, getSharedMarketBase, SPECIES_CACHE_VERSION } from './market-base.mjs';
import { adviseItems, advisePokemons, buildSpeciesIndex, estimatePokemonPrice, isLegendary, notaOf } from './economy-advisor.mjs';
import { planFinalEvolution } from './evolution-plan.mjs';
import { DROP_DEFAULTS, decideDrop, frameForDecision, marketRulesOf, netOfListing, normalizeDropPatch } from './drop-router.mjs';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
    resolveHeadlessSession,
    discoverBrowserUserDataDirs,
    extractSessionFromLevelDbDir,
    saveSessionCache,
    decodeJwtPayload,
} from './session-extractor.mjs';
import {
    DEFAULT_WS_URL,
    DEFAULT_ORIGIN,
    DEFAULT_BALL_PRICES,
    DEFAULT_ITEM_PRICES,
    ITEM_IDS,
    BUYABLE_POTION_IDS,
    normalizePotionIds,
    createStateMerger,
    createFieldTracker,
    isWildCampoMob,
    resolvePokemonSpriteDex,
    evaluateHeadlessTick,
    evaluatePvpQueue,
    applyPvpMessage,
    computeModeWarnings,
    chavePokedex,
    getTopCatchWeekKey,
    getTopCatchWeekWindow,
    getTopCatchMilestoneProgress,
    computeTopCatchRankingPosition,
    getPokedexCapturedSet,
    getHuntMissingSpecies,
    computeCollectionSummary,
    selectObjectiveHunt,
} from './protocol-engine.mjs';
import {
    XP_SHARE_HELD_ID,
    getPokemonLocation,
    evaluateTrainerPlan,
    evaluateSniperSummary,
    evaluateSniperItemListings,
    buildPokemonListingFrame,
    buildSniperPokemonQueries,
    evaluateSniperPokemonListings,
} from './trainer-sniper.mjs';
import {
    liveRewards,
    DEFAULT_TWITCH_OFFICIALS,
    DEFAULT_KICK_OFFICIALS,
    LIVE_REWARD_KINDS,
    LIVE_REWARD_TIERS,
    parseRewardKinds,
    resolveChannelRewardKinds,
    computeSmartBuffStatus,
    getLiveLastRedeemMap,
    getEffectiveBonusStateForCtx,
    mergeGameWsMessage,
    runLiveCycle,
    refreshTwitchBalances,
    selectChannelsToWatch,
    getPlatformRateLimit,
} from '../modules/live-rewards.js';
import { createHeadlessHuntGuideEvaluator, describeHuntGuide, readHuntGuideInPage } from './hunt-guide.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const APP_VERSION = (() => {
    try {
        return String(JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')).version || '1.0.8');
    } catch {
        return '1.0.8';
    }
})();
const DEFAULT_DASHBOARD_PATH = resolve(HERE, 'gui-dashboard.html');
const DEFAULT_ICON_PNG_PATH = resolve(REPO_ROOT, 'assets', 'nexo-pokebot-icon.png');

// Campos do Pokemon que viram a "ficha" do shiny na HUD. O protocolo do jogo nao
// e documentado, entao guarda os valores simples que vierem (e objetos rasos de
// numeros, como IVs/stats) e ignora o que ja aparece no cabecalho do cartao.
const POKEMON_DETAIL_SKIP = new Set(['nome', 'name', 'speciesId', 'level', 'nivel', 'shiny', 'id', 'uid', '_id', 'looktype', 'lookType', 'outfit']);
export function extractPokemonDetails(pokemon) {
    const out = [];
    if (!pokemon || typeof pokemon !== 'object') return out;
    for (const [key, val] of Object.entries(pokemon)) {
        if (out.length >= 12) break;
        if (POKEMON_DETAIL_SKIP.has(key) || val === null || val === undefined || val === '') continue;
        if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
            out.push([key, typeof val === 'boolean' ? (val ? 'sim' : 'não') : String(val).slice(0, 40)]);
        } else if (Array.isArray(val)) {
            const flat = val.filter((v) => typeof v === 'number' || typeof v === 'string').slice(0, 6);
            if (flat.length) out.push([key, flat.join(' / ')]);
        } else if (typeof val === 'object') {
            const nums = Object.entries(val).filter(([, v]) => typeof v === 'number' || typeof v === 'string').slice(0, 6);
            if (nums.length) out.push([key, nums.map(([k, v]) => `${k} ${v}`).join(' · ')]);
        }
    }
    return out;
}
const DEFAULT_ICON_ICO_PATH = resolve(REPO_ROOT, 'assets', 'nexo-pokebot.ico');
const DEFAULT_CONFIG_FILE = '.pokebot-headless-config.json';
const DEFAULT_BROWSER_PROFILE_DIR = '.pokebot-browser-profile';
const DEFAULT_LIVE_PROFILE_DIR = '.pokebot-live-profile';
const USER_AGENT = 'Nexo-PokeBot/1.0';

const LOGIN_URLS = Object.freeze({
    twitch: 'https://www.twitch.tv/login',
    kick: 'https://kick.com',
    pokeidle: 'https://pokeidle.io/app',
});

const PING_INTERVAL_MS = 25_000;
const WATCHDOG_INTERVAL_MS = 10_000;
const WATCHDOG_TIMEOUT_MS = 35_000;
const LIVE_CYCLE_INTERVAL_MS = 55_000;
const MIN_RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 30_000;
const MAX_LOGS = 120;
const BALL_LABELS = Object.freeze({ 1: 'Poke Ball', 2: 'Great Ball', 3: 'Super Ball', 4: 'Ultra Ball', 5: 'Beast Ball' });

const EDITABLE_CONFIG_KEYS = new Set([
    'caidosEnabled',
    'preferredBall',
    'shinyBall',
    'highLevelUltraThreshold',
    'prioritizeExpiring',
    'economyMode',
    'economyPingOnly',
    'standbyOn4001',
    'standbySec',
    'restockEnabled',
    'minGoldReserve',
    'minBalls',
    'targetBalls',
    'minPotions',
    'targetPotions',
    'preferredPotionIds',
    'restockPotionId',
    'potionOptimize',
    'ballEconomy',
    'pvpQueue',
    'minRevives',
    'targetRevives',
    'restockRevive',
    'dailyPassEnabled',
    'preyEnabled',
    'ensureNativeAutoHeal',
    'targetHuntSlug',
    'huntGuideMode',
    'huntGuideMetric',
    'farmObjective',
    'farmObjectiveFocus',
    'liveEnabled',
    'liveWatchTwitch',
    'liveWatchKick',
    'liveAutoClaimChest',
    'liveAutoFollow',
    'liveStreakWatch',
    'liveAutoRedeem',
    'liveRewardType',
    'liveTwitchRewards',
    'liveKickRewards',
    'liveRewardTier',
    'liveSmartBalance',
    'liveSyncPlatforms',
    'liveTargetHours',
    'liveChannelRewards',
    'liveGuardThresholdMin',
    'liveMaxSlots',
    'liveMaxTwitchSlots',
    'liveMaxKickSlots',
    'liveTwitchToken',
    'liveTwitchDeviceId',
    'liveKickToken',
    'liveCustomTwitch',
    'liveCustomKick',
    'dropHideCategories',
    'dropHideItems',
    'dropNotifyCategories',
    'dropNotifyAllowItems',
    'dropNotifyCommon',
    'notifyCatchNewSpecies',
    'trainerEnabled',
    'trainerUseExpShare',
    'trainerUseHouses',
    'trainerMode',
    'trainerStepLevels',
    'trainerQueue',
    'sniperEnabled',
    'sniperIntervalSec',
    'sniperMinGoldReserve',
    'sniperMinOrbsReserve',
    'sniperRules',
    'advisorEnabled',
    ...Object.keys(DROP_DEFAULTS),
    'browserProfile',
]);

const recentShinyHistoryMap = new Map(); // key -> { ts, own }
function resolveSharedShinyHistoryPath(cwd) {
    const abs = resolve(cwd || process.cwd());
    const parent = dirname(abs);
    const rootDir = basename(parent) === '.pokebot-accounts' ? dirname(parent) : abs;
    return join(rootDir, '.pokebot-shiny-history.jsonl');
}

function appendShinyHistoryRecord(cwd, record) {
    if (!record || !record.name) return false;
    const ts = Number(record.ts || Date.now());
    const trainerKey = String(record.trainer || '').trim().toLowerCase();
    const nameKey = String(record.name || '').trim().toLowerCase();
    const dedupeKey = `${trainerKey}|${nameKey}|${record.egg ? 1 : 0}`;
    const prev = recentShinyHistoryMap.get(dedupeKey);
    if (prev && Math.abs(ts - prev.ts) < 12_000 && (prev.own || !record.own)) {
        return false;
    }
    recentShinyHistoryMap.set(dedupeKey, { ts, own: Boolean(record.own) });
    if (recentShinyHistoryMap.size > 120) {
        for (const [k, v] of recentShinyHistoryMap) {
            if (ts - v.ts > 60_000) recentShinyHistoryMap.delete(k);
        }
    }
    const brt = new Date(ts - 3 * 3600_000);
    const pad2 = (n) => String(n).padStart(2, '0');
    const row = {
        ts,
        iso: new Date(ts).toISOString(),
        brtDate: `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}`,
        brtTime: `${pad2(brt.getUTCHours())}:${pad2(brt.getUTCMinutes())}:${pad2(brt.getUTCSeconds())}`,
        hourBrt: brt.getUTCHours(),
        minuteBrt: brt.getUTCMinutes(),
        weekdayBrt: brt.getUTCDay(),
        trainer: record.trainer || 'Desconhecido',
        own: Boolean(record.own),
        account: record.account ?? null,
        egg: Boolean(record.egg),
        name: record.name,
        speciesId: record.speciesId ?? null,
        spriteDex: record.spriteDex ?? null,
        level: record.level ?? '?',
        hunt: record.hunt || '',
        ballId: record.ballId ?? null,
        details: Array.isArray(record.details) ? record.details : [],
    };
    try {
        const filePath = resolveSharedShinyHistoryPath(cwd);
        mkdirSync(dirname(filePath), { recursive: true });
        appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
        return true;
    } catch {
        return false;
    }
}

export const SESSION_DROP_CATALOG = Object.freeze([
    { key: 'bossTokens', id: 70000, name: 'Bronze Boss Token', area: 'outland', rare: true },
    { key: 'fragChave', id: 70011, name: 'Key Fragment', area: 'outland', rare: true },
    { key: 'fragShiny', id: 70012, name: 'Shiny Stone Fragment', area: 'outland', rare: true },
    { key: 'fragBicicleta', id: 70013, name: 'Bicycle Fragment', area: 'outland', rare: true },
    { key: 'ossoSacrificio', id: 70018, name: 'Sacrifice Bone', area: 'outland', rare: true },
    { key: 'fragOvoShiny', id: 70017, name: 'Shiny Egg Fragment', area: 'unova', rare: true },
    { key: 'fragMega', id: 70014, name: 'Mega Stone Fragment', area: 'boss', rare: true },
    { key: 'fragMegaShiny', id: 70015, name: 'Mega Shiny Stone Fragment', area: 'boss', rare: true },
    { key: 'tmPeca', id: 59194, name: 'TM Disk Piece', area: 'boss', rare: true },
    { key: 'tmPecaAoe', id: 40530, name: 'AoE TM Disk Piece', area: 'boss', rare: true },
    { key: 'ticketMistico', id: 70090, name: 'Mystic Ticket', area: 'boss', rare: true },
    { key: 'ticketSafari', id: 70095, name: 'Safari Ticket', area: 'boss', rare: true },
]);

export const DROP_CATEGORIES = Object.freeze(['outland', 'unova', 'boss', 'stone', 'other']);

const COMMON_STONE_RE = /\b(?:stone|pedra)\b/i;
const SPECIAL_STONE_RE = /\b(?:fragment|mega|shiny\s+stone\s+frag|shiny\s+egg)\b/i;

/**
 * Classifica um drop em categoria para filtro de exibicao no painel Eco/Hub.
 * Pedras de evolucao comuns viram 'stone' (separado de fragmentos raros de Outland/Boss).
 * @param {object|null} meta Entrada de SESSION_DROP_CATALOG quando conhecida.
 * @param {string} name Nome do item dropado.
 * @returns {'outland'|'unova'|'boss'|'stone'|'other'} Categoria do drop.
 */
export function classifyDropCategory(meta, name = '') {
    if (meta?.area && ['outland', 'unova', 'boss'].includes(meta.area)) {
        return meta.area;
    }
    const clean = String(name || '');
    if (COMMON_STONE_RE.test(clean) && !SPECIAL_STONE_RE.test(clean)) {
        return 'stone';
    }
    return 'other';
}

const SESSION_DROP_BY_ID = new Map(SESSION_DROP_CATALOG.map((d) => [d.id, d]));
const SESSION_DROP_BY_NAME = new Map(SESSION_DROP_CATALOG.map((d) => [d.name.toLowerCase(), d]));
const MAX_RECENT_DROPS = 20;

/**
 * Classifica o foco de farm da hunt/cena atual de acordo com as areas oficiais do PokeIdle.
 * @param {object|null} hunt Entrada de hunt do catalogo (area, nivel).
 * @param {object|null} state Estado atual do jogador.
 * @returns {{ focus: 'outland'|'unova'|'boss'|'hunt', label: string }} Foco e rotulo legivel.
 */
export function resolveHuntFocus(hunt = null, state = null) {
    if (state?.boss?.arena) {
        return { focus: 'boss', label: 'Drops de Boss' };
    }
    const area = String(hunt?.area || '').toLowerCase();
    if (area === 'outland') {
        return { focus: 'outland', label: 'Itens (Outland)' };
    }
    if (Number(hunt?.nivel || 0) >= 5000 || area === 'unova') {
        return { focus: 'unova', label: 'Shiny + Ovo Shiny (Unova)' };
    }
    return { focus: 'hunt', label: 'XP / Gold / Shiny' };
}

function createEmptyCatalog() {
    return {
        ballPrices: {},
        itemPrices: {},
        prices: {},
        itemNames: {},
        marketItems: [],
        huntSpeciesBySlug: {},
        huntSpeciesId: null,
        huntNames: {},
        huntsBySlug: {},
        pokemonNames: {},
        huntsList: [],
    };
}

function buildConfig(prefs = {}, saved = {}, overrides = {}, isolatedAccount = false) {
    const p = prefs && typeof prefs === 'object' ? prefs : {};
    const s = saved && typeof saved === 'object' ? saved : {};
    const o = overrides && typeof overrides === 'object' ? overrides : {};

    const base = {
        caidosEnabled: p.caidosEnabled ?? true,
        preferredBall: p.preferredBall || 'auto',
        shinyBall: p.shinyBall || 'best',
        highLevelUltraThreshold: typeof p.highLevelUltraThreshold === 'number' ? p.highLevelUltraThreshold : 20,
        prioritizeExpiring: p.prioritizeExpiring ?? true,
        economyMode: 'auto',
        economyPingOnly: Boolean(p.economyPingOnly ?? false),
        standbyOn4001: true,
        standbySec: 180,
        restockEnabled: p.restockEnabled ?? true,
        minGoldReserve: typeof p.minGoldReserve === 'number' ? p.minGoldReserve : (isolatedAccount ? 0 : 50000),
        minBalls: undefined,
        targetBalls: typeof p.targetBalls === 'number' ? p.targetBalls : 50,
        restockSmallPotion: p.restockSmallPotion ?? true,
        minPotions: undefined,
        targetPotions: typeof p.targetPotions === 'number' ? p.targetPotions : 40,
        preferredPotionIds: Array.isArray(p.preferredPotionIds) ? normalizePotionIds(p.preferredPotionIds) : [],
        restockPotionId: Number(p.restockPotionId || 0),
        potionOptimize: p.potionOptimize === true,
        ballEconomy: p.ballEconomy === true,
        pvpQueue: p.pvpQueue === true,
        minRevives: undefined,
        targetRevives: typeof p.targetRevives === 'number' ? p.targetRevives : 20,
        restockRevive: p.restockRevive ?? true,
        ensureNativeAutoHeal: p.ensureNativeAutoHeal ?? true,
        dailyPassEnabled: p.dailyPassEnabled ?? true,
        preyEnabled: p.preyEnabled ?? true,
        targetHuntSlug: null,
        huntGuideMode: 'off',
        huntGuideMetric: 'xp',
        farmObjective: 'off',
        farmObjectiveFocus: 'xp',
        liveEnabled: p.liveEnabled ?? true,
        liveWatchTwitch: p.liveWatchTwitch ?? true,
        liveWatchKick: p.liveWatchKick ?? true,
        liveAutoClaimChest: p.liveAutoClaimChest ?? true,
        liveAutoFollow: p.liveAutoFollow ?? true,
        liveStreakWatch: p.liveStreakWatch ?? true,
        liveAutoRedeem: p.liveAutoRedeem ?? true,
        liveRewardType: ['xp', 'captura', 'shiny'].includes(p.liveRewardType) ? p.liveRewardType : 'xp',
        liveTwitchRewards: Array.isArray(p.liveTwitchRewards) ? parseRewardKinds(p.liveTwitchRewards, []) : null,
        liveKickRewards: Array.isArray(p.liveKickRewards) ? parseRewardKinds(p.liveKickRewards, []) : null,
        liveRewardTier: LIVE_REWARD_TIERS.includes(p.liveRewardTier) ? p.liveRewardTier : 'smart',
        liveSmartBalance: p.liveSmartBalance ?? true,
        liveSyncPlatforms: Boolean(p.liveSyncPlatforms ?? false),
        liveTargetHours: typeof p.liveTargetHours === 'number' ? p.liveTargetHours : 24,
        liveChannelRewards: p.liveChannelRewards && typeof p.liveChannelRewards === 'object' ? { ...p.liveChannelRewards } : {},
        liveGuardThresholdMin: typeof p.liveGuardThresholdMin === 'number' ? p.liveGuardThresholdMin : 30,
        liveMaxSlots: typeof p.liveMaxSlots === 'number' ? p.liveMaxSlots : 4,
        liveMaxTwitchSlots: typeof p.liveMaxTwitchSlots === 'number'
            ? p.liveMaxTwitchSlots
            : (typeof p.liveMaxSlots === 'number' ? p.liveMaxSlots : 4),
        liveMaxKickSlots: typeof p.liveMaxKickSlots === 'number' ? p.liveMaxKickSlots : 2,
        liveTwitchToken: typeof p.liveTwitchToken === 'string' && p.liveTwitchToken ? p.liveTwitchToken : (isolatedAccount ? '' : process.env.TWITCH_AUTH_TOKEN || ''),
        liveTwitchDeviceId: typeof p.liveTwitchDeviceId === 'string' ? p.liveTwitchDeviceId : '',
        liveKickToken: typeof p.liveKickToken === 'string' && p.liveKickToken ? p.liveKickToken : (isolatedAccount ? '' : process.env.KICK_SESSION_TOKEN || ''),
        liveCustomTwitch: typeof p.liveCustomTwitch === 'string' ? p.liveCustomTwitch : '',
        liveCustomKick: typeof p.liveCustomKick === 'string' ? p.liveCustomKick : '',
        dropHideCategories: Array.isArray(p.dropHideCategories) ? p.dropHideCategories : ['stone'],
        dropHideItems: Array.isArray(p.dropHideItems) ? p.dropHideItems : [],
        dropNotifyCategories: Array.isArray(p.dropNotifyCategories)
            ? p.dropNotifyCategories
            : ['outland', 'unova', 'boss', 'other'],
        dropNotifyAllowItems: Array.isArray(p.dropNotifyAllowItems) ? p.dropNotifyAllowItems : [],
        dropNotifyCommon: Boolean(p.dropNotifyCommon ?? false),
        notifyCatchNewSpecies: p.notifyCatchNewSpecies ?? true,
        trainerEnabled: Boolean(p.trainerEnabled ?? false),
        trainerUseExpShare: p.trainerUseExpShare ?? true,
        trainerUseHouses: p.trainerUseHouses ?? true,
        trainerMode: p.trainerMode === 'sequential' ? 'sequential' : 'step',
        trainerStepLevels: Math.max(5, Math.min(1000, Math.floor(Number(p.trainerStepLevels || 50) || 50))),
        trainerQueue: Array.isArray(p.trainerQueue) ? p.trainerQueue : [],
        sniperEnabled: Boolean(p.sniperEnabled ?? false),
        sniperIntervalSec: Math.max(10, Math.min(300, Math.floor(Number(p.sniperIntervalSec || 30) || 30))),
        sniperMinGoldReserve: Math.max(0, Math.floor(Number(p.sniperMinGoldReserve ?? 0) || 0)),
        sniperMinOrbsReserve: Math.max(0, Math.floor(Number(p.sniperMinOrbsReserve ?? 0) || 0)),
        sniperRules: Array.isArray(p.sniperRules) ? p.sniperRules : [],
        advisorEnabled: p.advisorEnabled ?? true,
        ...normalizeDropPatch(p, { ...DROP_DEFAULTS }),
        browserProfile: '',
    };

    const merged = { ...base };
    for (const key of EDITABLE_CONFIG_KEYS) {
        if (s[key] !== undefined) merged[key] = s[key];
    }
    for (const key of EDITABLE_CONFIG_KEYS) {
        if (o[key] !== undefined) merged[key] = o[key];
    }
    return normalizeConfigPatch(merged, merged);
}

function normalizeConfigPatch(current, patch = {}) {
    const next = { ...current };
    if (['off', 'notify', 'auto'].includes(patch.huntGuideMode)) next.huntGuideMode = patch.huntGuideMode;
    if (['xp', 'ouro', 'shiny'].includes(patch.huntGuideMetric)) next.huntGuideMetric = patch.huntGuideMetric;
    if (['off', 'pokedex', 'topcatch'].includes(patch.farmObjective)) next.farmObjective = patch.farmObjective;
    if (['xp', 'ouro', 'shiny', 'fast'].includes(patch.farmObjectiveFocus)) next.farmObjectiveFocus = patch.farmObjectiveFocus;
    if (patch.caidosEnabled !== undefined) next.caidosEnabled = Boolean(patch.caidosEnabled);
    if (typeof patch.preferredBall === 'string' && ['auto', 'poke', 'great', 'super', 'ultra', 'beast'].includes(patch.preferredBall)) {
        next.preferredBall = patch.preferredBall;
    }
    if (typeof patch.shinyBall === 'string' && ['best', 'beast', 'ultra', 'super', 'great', 'poke'].includes(patch.shinyBall)) {
        next.shinyBall = patch.shinyBall;
    }
    if (patch.highLevelUltraThreshold !== undefined) {
        const n = Number(patch.highLevelUltraThreshold);
        if (Number.isFinite(n)) next.highLevelUltraThreshold = Math.max(1, Math.min(200, Math.round(n)));
    }
    if (patch.prioritizeExpiring !== undefined) next.prioritizeExpiring = Boolean(patch.prioritizeExpiring);
    if (typeof patch.economyMode === 'string' && ['auto', 'on', 'off'].includes(patch.economyMode)) {
        next.economyMode = patch.economyMode;
    }
    if (patch.economyPingOnly !== undefined) next.economyPingOnly = Boolean(patch.economyPingOnly);
    if (patch.standbyOn4001 !== undefined) next.standbyOn4001 = Boolean(patch.standbyOn4001);
    if (patch.standbySec !== undefined) {
        const n = Number(patch.standbySec);
        if (Number.isFinite(n)) next.standbySec = Math.max(5, Math.min(3600, Math.round(n)));
    }
    if (patch.restockEnabled !== undefined) next.restockEnabled = Boolean(patch.restockEnabled);
    if (patch.minGoldReserve !== undefined) {
        const n = Number(patch.minGoldReserve);
        if (Number.isFinite(n)) next.minGoldReserve = Math.max(0, Math.round(n));
    }
    if (patch.targetBalls !== undefined) {
        const n = Number(patch.targetBalls);
        if (Number.isFinite(n)) next.targetBalls = Math.max(10, Math.min(5000, Math.round(n)));
    }
    if (patch.minBalls !== undefined) {
        const n = Number(patch.minBalls);
        if (Number.isFinite(n)) next.minBalls = Math.max(1, Math.min(next.targetBalls, Math.round(n)));
    } else {
        next.minBalls = Math.min(next.targetBalls, Math.max(15, Math.round(next.targetBalls * 0.35)));
    }
    if (patch.targetPotions !== undefined) {
        const n = Number(patch.targetPotions);
        if (Number.isFinite(n)) next.targetPotions = Math.max(0, Math.min(5000, Math.round(n)));
    }
    if (patch.preferredPotionIds !== undefined) {
        next.preferredPotionIds = normalizePotionIds(patch.preferredPotionIds);
    }
    if (patch.restockPotionId !== undefined) {
        const pid = Number(patch.restockPotionId || 0);
        next.restockPotionId = BUYABLE_POTION_IDS.includes(pid) ? pid : 0;
    }
    if (patch.potionOptimize !== undefined) next.potionOptimize = Boolean(patch.potionOptimize);
    if (patch.ballEconomy !== undefined) next.ballEconomy = Boolean(patch.ballEconomy);
    if (patch.pvpQueue !== undefined) next.pvpQueue = Boolean(patch.pvpQueue);
    if (patch.minPotions !== undefined) {
        const n = Number(patch.minPotions);
        if (Number.isFinite(n)) next.minPotions = next.targetPotions > 0 ? Math.max(1, Math.min(next.targetPotions, Math.round(n))) : 0;
    } else {
        next.minPotions = next.targetPotions > 0 ? Math.min(next.targetPotions, Math.max(15, Math.round(next.targetPotions * 0.35))) : 0;
    }
    if (patch.targetRevives !== undefined) {
        const n = Number(patch.targetRevives);
        if (Number.isFinite(n)) next.targetRevives = Math.max(0, Math.min(5000, Math.round(n)));
    }
    if (patch.restockRevive !== undefined) {
        next.restockRevive = Boolean(patch.restockRevive);
    } else if (patch.targetRevives !== undefined) {
        next.restockRevive = next.targetRevives > 0;
    }
    if (patch.minRevives !== undefined) {
        const n = Number(patch.minRevives);
        if (Number.isFinite(n)) next.minRevives = next.targetRevives > 0 ? Math.max(1, Math.min(next.targetRevives, Math.round(n))) : 0;
    } else {
        next.minRevives = next.targetRevives > 0 ? Math.min(next.targetRevives, Math.max(5, Math.round(next.targetRevives * 0.35))) : 0;
    }
    if (patch.dailyPassEnabled !== undefined) next.dailyPassEnabled = Boolean(patch.dailyPassEnabled);
    if (patch.preyEnabled !== undefined) next.preyEnabled = Boolean(patch.preyEnabled);
    if (patch.ensureNativeAutoHeal !== undefined) next.ensureNativeAutoHeal = Boolean(patch.ensureNativeAutoHeal);
    if (patch.targetHuntSlug !== undefined) {
        next.targetHuntSlug = typeof patch.targetHuntSlug === 'string' && patch.targetHuntSlug.trim()
            ? patch.targetHuntSlug.trim()
            : null;
    }
    if (patch.liveEnabled !== undefined) next.liveEnabled = Boolean(patch.liveEnabled);
    if (patch.liveWatchTwitch !== undefined) next.liveWatchTwitch = Boolean(patch.liveWatchTwitch);
    if (patch.liveWatchKick !== undefined) next.liveWatchKick = Boolean(patch.liveWatchKick);
    if (patch.liveAutoClaimChest !== undefined) next.liveAutoClaimChest = Boolean(patch.liveAutoClaimChest);
    if (patch.liveAutoFollow !== undefined) next.liveAutoFollow = Boolean(patch.liveAutoFollow);
    if (patch.liveStreakWatch !== undefined) next.liveStreakWatch = Boolean(patch.liveStreakWatch);
    if (patch.liveAutoRedeem !== undefined) next.liveAutoRedeem = Boolean(patch.liveAutoRedeem);
    if (typeof patch.liveRewardType === 'string' && ['xp', 'captura', 'shiny'].includes(patch.liveRewardType)) {
        next.liveRewardType = patch.liveRewardType;
    }
    if (patch.liveTwitchRewards !== undefined) {
        next.liveTwitchRewards = patch.liveTwitchRewards === null
            ? null
            : parseRewardKinds(patch.liveTwitchRewards, []);
    }
    if (patch.liveKickRewards !== undefined) {
        next.liveKickRewards = patch.liveKickRewards === null
            ? null
            : parseRewardKinds(patch.liveKickRewards, []);
    }
    if (typeof patch.liveRewardTier === 'string' && LIVE_REWARD_TIERS.includes(patch.liveRewardTier)) {
        next.liveRewardTier = patch.liveRewardTier;
    }
    if (patch.liveSmartBalance !== undefined) {
        next.liveSmartBalance = Boolean(patch.liveSmartBalance);
    }
    if (patch.liveSyncPlatforms !== undefined) {
        next.liveSyncPlatforms = Boolean(patch.liveSyncPlatforms);
    }
    if (patch.liveTargetHours !== undefined) {
        const h = Number(patch.liveTargetHours);
        if (Number.isFinite(h)) {
            next.liveTargetHours = Math.max(0.5, Math.min(168, Math.round(h * 2) / 2));
        }
    }
    if (patch.liveChannelRewards !== undefined && patch.liveChannelRewards && typeof patch.liveChannelRewards === 'object' && !Array.isArray(patch.liveChannelRewards)) {
        const cleanMap = {};
        for (const [rawKey, rawVal] of Object.entries(patch.liveChannelRewards)) {
            const key = String(rawKey || '').trim().toLowerCase();
            if (!/^(?:twitch|kick):[a-z0-9_-]{1,64}$/.test(key)) continue;
            const val = String(rawVal || '').trim().toLowerCase();
            if (!val || val === 'default') continue;
            if (val === 'off' || val === 'none') {
                cleanMap[key] = 'off';
                continue;
            }
            const parsed = parseRewardKinds(val, []);
            if (parsed.length === LIVE_REWARD_KINDS.length) {
                cleanMap[key] = 'all';
            } else if (parsed.length > 0) {
                cleanMap[key] = parsed.join(',');
            }
        }
        next.liveChannelRewards = cleanMap;
    }
    const firstActiveReward = (Array.isArray(next.liveTwitchRewards) && next.liveTwitchRewards[0]) ||
        (Array.isArray(next.liveKickRewards) && next.liveKickRewards[0]);
    if (firstActiveReward && patch.liveRewardType === undefined) {
        next.liveRewardType = firstActiveReward;
    }
    if (patch.liveGuardThresholdMin !== undefined) {
        const n = Number(patch.liveGuardThresholdMin);
        if (Number.isFinite(n)) next.liveGuardThresholdMin = Math.max(0, Math.min(600, Math.round(n)));
    }
    if (patch.liveMaxSlots !== undefined) {
        const n = Number(patch.liveMaxSlots);
        if (Number.isFinite(n)) next.liveMaxSlots = Math.max(1, Math.min(12, Math.round(n)));
    }
    if (patch.liveMaxTwitchSlots !== undefined) {
        const n = Number(patch.liveMaxTwitchSlots);
        if (Number.isFinite(n)) next.liveMaxTwitchSlots = Math.max(1, Math.min(12, Math.round(n)));
    }
    if (patch.liveMaxKickSlots !== undefined) {
        const n = Number(patch.liveMaxKickSlots);
        if (Number.isFinite(n)) next.liveMaxKickSlots = Math.max(1, Math.min(12, Math.round(n)));
    }
    if (typeof patch.liveTwitchToken === 'string') {
        const clean = patch.liveTwitchToken.trim();
        if (clean) next.liveTwitchToken = clean;
    }
    if (typeof patch.liveTwitchDeviceId === 'string') next.liveTwitchDeviceId = patch.liveTwitchDeviceId.trim();
    if (typeof patch.liveKickToken === 'string') {
        const clean = patch.liveKickToken.trim();
        if (clean) next.liveKickToken = clean;
    }
    if (typeof patch.liveCustomTwitch === 'string') next.liveCustomTwitch = patch.liveCustomTwitch.trim();
    if (typeof patch.liveCustomKick === 'string') next.liveCustomKick = patch.liveCustomKick.trim();
    if (Array.isArray(patch.dropHideCategories)) {
        next.dropHideCategories = [...new Set(
            patch.dropHideCategories
                .map((c) => String(c || '').trim().toLowerCase())
                .filter((c) => DROP_CATEGORIES.includes(c))
        )];
    }
    if (Array.isArray(patch.dropHideItems)) {
        next.dropHideItems = [...new Set(
            patch.dropHideItems
                .map((k) => String(k || '').trim())
                .filter((k) => k.length > 0 && k.length <= 80)
        )].slice(0, 64);
    }
    if (Array.isArray(patch.dropNotifyCategories)) {
        next.dropNotifyCategories = [...new Set(
            patch.dropNotifyCategories
                .map((c) => String(c || '').trim().toLowerCase())
                .filter((c) => DROP_CATEGORIES.includes(c))
        )];
    }
    if (Array.isArray(patch.dropNotifyAllowItems)) {
        next.dropNotifyAllowItems = [...new Set(
            patch.dropNotifyAllowItems
                .map((k) => String(k || '').trim())
                .filter((k) => k.length > 0 && k.length <= 80)
        )].slice(0, 64);
    }
    if (patch.dropNotifyCommon !== undefined) {
        next.dropNotifyCommon = Boolean(patch.dropNotifyCommon);
    }
    if (patch.notifyCatchNewSpecies !== undefined) {
        next.notifyCatchNewSpecies = Boolean(patch.notifyCatchNewSpecies);
    }
    if (patch.trainerEnabled !== undefined) next.trainerEnabled = Boolean(patch.trainerEnabled);
    if (patch.trainerUseExpShare !== undefined) next.trainerUseExpShare = Boolean(patch.trainerUseExpShare);
    if (patch.trainerUseHouses !== undefined) next.trainerUseHouses = Boolean(patch.trainerUseHouses);
    if (patch.trainerMode !== undefined) {
        next.trainerMode = patch.trainerMode === 'sequential' ? 'sequential' : 'step';
    }
    if (patch.trainerStepLevels !== undefined) {
        const n = Number(patch.trainerStepLevels);
        if (Number.isFinite(n)) next.trainerStepLevels = Math.max(5, Math.min(1000, Math.round(n)));
    }
    if (Array.isArray(patch.trainerQueue)) {
        const seenIds = new Set();
        const cleaned = [];
        for (const q of patch.trainerQueue) {
            if (!q || q.pokemonId == null) continue;
            const idStr = String(q.pokemonId);
            if (seenIds.has(idStr)) continue;
            seenIds.add(idStr);
            cleaned.push({
                pokemonId: q.pokemonId,
                name: typeof q.name === 'string' ? q.name.slice(0, 60) : '',
                speciesId: q.speciesId != null ? Number(q.speciesId) || null : null,
                targetLevel: Math.max(2, Math.min(10000, Math.round(Number(q.targetLevel || 200) || 200))),
            });
            if (cleaned.length >= 40) break;
        }
        next.trainerQueue = cleaned;
    }
    if (patch.sniperEnabled !== undefined) next.sniperEnabled = Boolean(patch.sniperEnabled);
    if (patch.advisorEnabled !== undefined) next.advisorEnabled = Boolean(patch.advisorEnabled);
    normalizeDropPatch(patch, next);
    if (patch.sniperIntervalSec !== undefined) {
        const n = Number(patch.sniperIntervalSec);
        if (Number.isFinite(n)) next.sniperIntervalSec = Math.max(10, Math.min(300, Math.round(n)));
    }
    if (patch.sniperMinGoldReserve !== undefined) {
        const n = Number(patch.sniperMinGoldReserve);
        if (Number.isFinite(n)) next.sniperMinGoldReserve = Math.max(0, Math.round(n));
    }
    if (patch.sniperMinOrbsReserve !== undefined) {
        const n = Number(patch.sniperMinOrbsReserve);
        if (Number.isFinite(n)) next.sniperMinOrbsReserve = Math.max(0, Math.round(n));
    }
    if (Array.isArray(patch.sniperRules)) {
        const cleanedRules = [];
        for (let idx = 0; idx < patch.sniperRules.length && cleanedRules.length < 40; idx++) {
            const r = patch.sniperRules[idx];
            if (!r || typeof r !== 'object') continue;
            const maxPrice = Number(r.maxPrice);
            if (!Number.isFinite(maxPrice) || maxPrice <= 0) continue;
            const currency = r.currency === 'orb' ? 'orb' : 'gold';
            const maxQty = Math.max(0, Math.floor(Number(r.maxQty || 0) || 0));
            const boughtQty = Math.max(0, Math.floor(Number(r.boughtQty || 0) || 0));
            const autoBuy = Boolean(r.autoBuy);
            const enabled = r.enabled !== false;

            if (r.kind === 'pokemon') {
                const speciesId = Math.max(0, Math.floor(Number(r.speciesId || 0) || 0));
                const speciesName = typeof r.speciesName === 'string' ? r.speciesName.trim().slice(0, 64) : '';
                const minLevel = Math.max(1, Math.min(10000, Math.round(Number(r.minLevel || 1) || 1)));
                let maxLevel = Math.max(0, Math.min(10000, Math.round(Number(r.maxLevel || 0) || 0)));
                if (maxLevel > 0 && maxLevel < minLevel) maxLevel = minLevel;
                cleanedRules.push({
                    id: typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 40) : `sr_pk_${speciesId || 'any'}_${idx}_${Date.now()}`,
                    kind: 'pokemon',
                    speciesId,
                    speciesName,
                    minLevel,
                    maxLevel,
                    onlyShiny: Boolean(r.onlyShiny),
                    currency,
                    maxPrice: Math.max(1, Math.round(maxPrice)),
                    maxQty,
                    boughtQty,
                    autoBuy,
                    enabled,
                });
                continue;
            }

            const itemId = Number(r.itemId);
            if (!Number.isInteger(itemId) || itemId <= 0) continue;
            cleanedRules.push({
                id: typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 40) : `sr_${itemId}_${idx}_${Date.now()}`,
                kind: 'item',
                itemId,
                itemName: typeof r.itemName === 'string' ? r.itemName.trim().slice(0, 64) : '',
                currency,
                maxPrice: Math.max(1, Math.round(maxPrice)),
                maxQty,
                boughtQty,
                autoBuy,
                enabled,
            });
        }
        next.sniperRules = cleanedRules;
    }
    if (typeof patch.browserProfile === 'string') {
        const cleanProfile = patch.browserProfile.trim();
        if (
            cleanProfile === '' ||
            cleanProfile === 'isolated' ||
            /^(?:(?:chrome|edge|brave):)?(?:Default|Profile \d+)$/.test(cleanProfile)
        ) {
            next.browserProfile = cleanProfile;
        }
    }
    return next;
}

function loadSavedConfig(configPath) {
    if (!configPath || !existsSync(configPath)) return {};
    try {
        const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function persistConfig(configPath, config) {
    if (!configPath) return;
    const out = {};
    for (const key of EDITABLE_CONFIG_KEYS) {
        out[key] = config[key];
    }
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

function formatLogTime(tsMs) {
    const d = new Date(tsMs);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ingestPriceEntries(source, targetPrices, combinedPrices, targetNames) {
    if (!source) return;
    const entries = Array.isArray(source)
        ? source.map((item) => [item?.id ?? item?.chave ?? item?.slug ?? item?.key, item])
        : Object.entries(source);

    for (const [rawId, item] of entries) {
        if (item == null) continue;
        const id = typeof item === 'object' ? (item.id ?? item.chave ?? rawId) : rawId;
        if (id === undefined || id === null || id === '') continue;

        const price = typeof item === 'number'
            ? item
            : Number(item.priceGold ?? item.precoGold ?? item.preco ?? item.price ?? item.gold ?? NaN);
        if (Number.isFinite(price) && price >= 0) {
            targetPrices[id] = price;
            combinedPrices[id] = price;
        }
        if (typeof item === 'object') {
            const name = item.nome ?? item.name ?? item.label ?? item.titulo;
            if (name) targetNames[id] = String(name);
        }
    }
}

function ingestWelcomeCatalog(welcomeMsg, catalog) {
    ingestPriceEntries(welcomeMsg?.catalogoBolas, catalog.ballPrices, catalog.prices, catalog.itemNames);
    ingestPriceEntries(welcomeMsg?.itensNossos, catalog.itemPrices, catalog.prices, catalog.itemNames);
    ingestPriceEntries(welcomeMsg?.itensCompraveis, catalog.itemPrices, catalog.prices, catalog.itemNames);

    const rawMarketCatalog = welcomeMsg?.mercado?.catalogo;
    if (Array.isArray(rawMarketCatalog) && rawMarketCatalog.length > 0) {
        const itemsList = [];
        for (const it of rawMarketCatalog) {
            if (!it || it.id == null) continue;
            const id = Number(it.id);
            if (!Number.isInteger(id) || id <= 0) continue;
            const name = String(it.nome ?? it.name ?? catalog.itemNames[id] ?? `Item #${id}`).trim();
            if (!catalog.itemNames[id] && name) catalog.itemNames[id] = name;
            itemsList.push({
                id,
                name,
                category: String(it.categoria || ''),
                type: String(it.tipo || ''),
            });
        }
        itemsList.sort((a, b) => a.name.localeCompare(b.name));
        catalog.marketItems = itemsList;
    }

    const hunts = welcomeMsg?.hunts;
    if (!hunts) return;
    const entries = Array.isArray(hunts)
        ? hunts.map((h) => [h?.slug, h])
        : Object.entries(hunts);

    const huntsList = [];
    for (const [rawSlug, hunt] of entries) {
        if (!hunt || typeof hunt !== 'object') continue;
        const slug = hunt.slug ?? rawSlug;
        if (!slug) continue;

        const especies = Array.isArray(hunt.especies) ? hunt.especies : [];
        let primarySpecies = null;
        let primaryWeight = -1;
        const normalizedSpecies = [];
        for (const sp of especies) {
            if (!sp || sp.pokeId == null) continue;
            const pid = Number(sp.pokeId);
            const spName = sp.nome ? String(sp.nome) : (catalog.pokemonNames[pid] || `#${pid}`);
            if (sp.nome) {
                catalog.pokemonNames[pid] = spName;
                catalog.pokemonIdByName ??= {};
                catalog.pokemonIdByName[spName.trim().toLowerCase()] = pid;
                const dex = resolvePokemonSpriteDex(pid, spName);
                if (dex > 0) {
                    catalog.pokemonDexByName ??= {};
                    catalog.pokemonDexByName[spName.trim().toLowerCase()] = dex;
                }
            }
            const weight = Number(sp.pontos || 0);
            const keyNum = chavePokedex(pid);
            normalizedSpecies.push({
                pokeId: pid,
                key: keyNum != null ? String(keyNum) : String(pid),
                nome: spName,
                pontos: weight,
            });
            if (primarySpecies == null || weight > primaryWeight) {
                primarySpecies = pid;
                primaryWeight = weight;
            }
        }

        const speciesId = primarySpecies ?? hunt.speciesId ?? hunt.especieId ?? hunt.pokemonId ?? null;
        if (speciesId != null) {
            catalog.huntSpeciesBySlug[slug] = speciesId;
        }
        const huntName = String(hunt.nome ?? hunt.name ?? hunt.titulo ?? slug);
        catalog.huntNames[slug] = huntName;
        const huntInfo = {
            slug: String(slug),
            nome: huntName,
            area: String(hunt.area ?? hunt.regiao ?? ''),
            nivel: Number(hunt.nivel ?? hunt.level ?? 0),
            speciesId,
            especies: normalizedSpecies,
        };
        catalog.huntsBySlug[slug] = huntInfo;
        huntsList.push(huntInfo);
    }

    huntsList.sort((a, b) => (a.nivel - b.nivel) || a.nome.localeCompare(b.nome));
    catalog.huntsList = huntsList;
}

function attachWsListeners(ws, { onOpen, onMessage, onClose, onError }) {
    if (typeof ws.addEventListener === 'function') {
        ws.addEventListener('open', onOpen);
        ws.addEventListener('message', onMessage);
        ws.addEventListener('close', onClose);
        ws.addEventListener('error', onError);
    } else {
        ws.onopen = onOpen;
        ws.onmessage = onMessage;
        ws.onclose = onClose;
        ws.onerror = onError;
    }
}

function getBrowserKeyFromExe(exe) {
    if (/msedge\.exe$/i.test(exe || '')) return 'edge';
    if (/brave\.exe$/i.test(exe || '')) return 'brave';
    if (/chrome(?:\.exe)?$|chromium$/i.test(exe || '')) return 'chrome';
    return '';
}

function listInstalledChromiumExecutables() {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:/Program Files';
    const programFiles86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
    const groups = [
        {
            key: 'chrome',
            label: 'Chrome',
            paths: [
                join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                join(programFiles86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/usr/bin/google-chrome',
                '/usr/bin/chromium',
            ],
        },
        {
            key: 'brave',
            label: 'Brave',
            paths: [
                join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
                join(programFiles86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
                join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
            ],
        },
        {
            key: 'edge',
            label: 'Edge',
            paths: [
                join(programFiles86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
                join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
                join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            ],
        },
    ];
    const found = [];
    if (process.env.POKEBOT_BROWSER_EXE && existsSync(process.env.POKEBOT_BROWSER_EXE)) {
        const key = getBrowserKeyFromExe(process.env.POKEBOT_BROWSER_EXE) || 'chrome';
        const label = { chrome: 'Chrome', brave: 'Brave', edge: 'Edge' }[key] || 'Navegador';
        found.push({ key, label, exe: process.env.POKEBOT_BROWSER_EXE });
    }
    for (const grp of groups) {
        if (found.some((item) => item.key === grp.key)) continue;
        const hit = grp.paths.find((p) => existsSync(p));
        if (hit) found.push({ key: grp.key, label: grp.label, exe: hit });
    }
    return found;
}

function findChromiumExecutable(preferredKey = '') {
    if (process.env.POKEBOT_BROWSER_EXE && !preferredKey) return process.env.POKEBOT_BROWSER_EXE;
    const installed = listInstalledChromiumExecutables();
    if (preferredKey) {
        const exact = installed.find((b) => b.key === preferredKey);
        if (exact) return exact.exe;
    }
    return installed[0]?.exe || null;
}

/**
 * Identifica qual motor Chromium (chrome, edge ou brave) criou um diretorio de perfil isolado
 * para garantir descriptografia dos cookies na reabertura de lives.
 * @param {string} profileDir Caminho do diretorio de perfil isolado.
 * @returns {'chrome'|'edge'|'brave'|''} Chave do navegador detectado ou string vazia.
 */
export function detectProfileBrowserKind(profileDir) {
    if (!profileDir || !existsSync(profileDir)) return '';
    try {
        const localStatePath = join(profileDir, 'Local State');
        const prefPath = join(profileDir, 'Default', 'Preferences');
        const state = existsSync(localStatePath) ? JSON.parse(readFileSync(localStatePath, 'utf8')) : null;
        const pref = existsSync(prefPath) ? JSON.parse(readFileSync(prefPath, 'utf8')) : null;
        if (state && typeof state === 'object') {
            const keys = Object.keys(state);
            if (keys.some((k) => /edge|msedge/i.test(k)) || Boolean(pref?.edge)) return 'edge';
            if (keys.some((k) => /brave/i.test(k)) || Boolean(pref?.brave)) return 'brave';
            return 'chrome';
        }
        if (pref && typeof pref === 'object') {
            if (pref.edge) return 'edge';
            if (pref.brave) return 'brave';
            return 'chrome';
        }
    } catch {
        // perfil novo ou ilegivel
    }
    return '';
}

async function launchBrowserWindow(exe, profileDir, urls, existingProfile, { enableRemoteDebugging = true, waitForExit = false, signal = null } = {}) {
    if (!existingProfile) mkdirSync(profileDir, { recursive: true });
    const profileArgs = existingProfile
        ? [
            ...(existingProfile.root ? [`--user-data-dir=${existingProfile.root}`] : []),
            `--profile-directory=${existingProfile.name}`,
        ]
        : [
            `--user-data-dir=${profileDir}`,
            ...(enableRemoteDebugging ? ['--remote-debugging-port=0'] : []),
        ];
    const child = spawn(exe, [
        ...profileArgs,
        '--no-first-run', '--no-default-browser-check',
        ...(existingProfile ? [] : ['--new-window']), ...urls,
    ], { detached: !waitForExit, stdio: 'ignore' });
    await new Promise((resolveLaunch, rejectLaunch) => {
        child.once('spawn', resolveLaunch);
        child.once('error', rejectLaunch);
    });
    if (!waitForExit) {
        child.unref();
        return { exitedQuickly: false };
    }
    const startedAt = Date.now();
    return new Promise((resolveExit, rejectExit) => {
        let settled = false;
        const finish = (fn, val) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            fn(val);
        };
        const onAbort = () => {
            try { child.kill(); } catch { /* ja encerrado */ }
            finish(rejectExit, new Error('Login cancelado.'));
        };
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        child.once('error', (err) => finish(rejectExit, err));
        child.once('exit', () => finish(resolveExit, { exitedQuickly: Date.now() - startedAt < 1500 }));
    });
}

export function listExistingBrowserProfiles(exe, roots) {
    const browser = /msedge\.exe$/i.test(exe || '') ? 'Microsoft' :
        /chrome\.exe$/i.test(exe || '') ? 'Google' : /brave\.exe$/i.test(exe || '') ? 'BraveSoftware' : null;
    if (!browser) return [];
    const browserLabel = { Microsoft: 'Edge', Google: 'Chrome', BraveSoftware: 'Brave' }[browser];
    for (const root of roots) {
        const parts = root.split(/[\\/]/);
        if (!parts.includes(browser)) continue;
        try {
            const state = JSON.parse(readFileSync(join(root, 'Local State'), 'utf8'));
            const lastUsed = state?.profile?.last_used || 'Default';
            const infoCache = state?.profile?.info_cache && typeof state.profile.info_cache === 'object'
                ? state.profile.info_cache
                : {};
            const names = new Set();
            for (const key of Object.keys(infoCache)) {
                if (/^(?:Default|Profile \d+)$/.test(key) && existsSync(join(root, key))) {
                    names.add(key);
                }
            }
            if (/^(?:Default|Profile \d+)$/.test(lastUsed) && existsSync(join(root, lastUsed))) {
                names.add(lastUsed);
            }
            if (names.size === 0 && existsSync(join(root, 'Default'))) {
                names.add('Default');
            }
            const sorted = [...names].sort((a, b) => {
                if (a === 'Default') return -1;
                if (b === 'Default') return 1;
                const na = Number(a.replace(/^Profile /, '')) || 0;
                const nb = Number(b.replace(/^Profile /, '')) || 0;
                return na - nb || a.localeCompare(b);
            });
            if (sorted.length > 0) {
                return sorted.map((name) => {
                    const meta = infoCache[name] || {};
                    const displayName = String(meta.name || meta.shortcut_name || '').trim();
                    const label = displayName && displayName.toLowerCase() !== name.toLowerCase()
                        ? `${browserLabel} · ${displayName} (${name})`
                        : `${browserLabel} · ${name}`;
                    return {
                        root,
                        name,
                        label,
                        levelDb: join(root, name, 'Local Storage', 'leveldb'),
                        isLastUsed: name === lastUsed,
                    };
                });
            }
        } catch {
            // tenta o próximo diretório do mesmo navegador
        }
    }
    return [];
}

export function findExistingBrowserProfile(exe, roots, preferredName = '') {
    const profiles = listExistingBrowserProfiles(exe, roots);
    if (profiles.length === 0) return null;
    const wanted = String(preferredName || '').trim();
    const matched = wanted
        ? profiles.find((p) => p.name === wanted)
        : (profiles.find((p) => p.isLastUsed) || profiles[0]);
    if (!matched) return null;
    return { root: matched.root, name: matched.name, levelDb: matched.levelDb };
}

export function parseImportedSessionInput(input) {
    let obj = null;
    let rawText = '';
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        if (typeof input.raw === 'string' && input.raw.trim()) {
            rawText = input.raw.trim();
        } else if (typeof input.session === 'string' && input.session.trim()) {
            rawText = input.session.trim();
        } else if (input.session && typeof input.session === 'object') {
            obj = input.session;
        } else if (input.token) {
            obj = input;
        }
    } else if (typeof input === 'string') {
        rawText = input.trim();
    }

    if (!obj && rawText) {
        let candidate = rawText;
        if ((candidate.startsWith("'") && candidate.endsWith("'")) ||
            (candidate.startsWith('`') && candidate.endsWith('`'))) {
            candidate = candidate.slice(1, -1).trim();
        }
        try {
            let parsed = JSON.parse(candidate);
            if (typeof parsed === 'string') {
                parsed = JSON.parse(parsed);
            }
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                obj = parsed;
            }
        } catch {
            const payloadOnly = decodeJwtPayload(candidate);
            if (payloadOnly) {
                obj = { token: candidate, nick: payloadOnly.nick || '' };
            }
        }
    }

    if (!obj || typeof obj.token !== 'string' || !obj.token.trim()) {
        throw new Error('Cole o JSON da sessão (botão "Copiar Sessão Headless" ou localStorage.sessao) contendo nick e token.');
    }

    const token = obj.token.trim();
    const payload = decodeJwtPayload(token);
    if (!payload) {
        throw new Error('Token de sessão inválido.');
    }
    if (payload.exp && Number(payload.exp) <= Date.now() + 60_000) {
        throw new Error('Esta sessão já expirou. Faça login novamente no PokeIdle e copie uma sessão nova.');
    }
    const nick = String(obj.nick || payload.nick || '').trim();
    if (!nick) {
        throw new Error('A sessão importada não contém o nick do treinador.');
    }
    return {
        provider: 'pokeidle',
        nick,
        token,
        provedor: obj.provedor || payload.provedor || null,
        dispositivo: typeof obj.dispositivo === 'string' && obj.dispositivo.trim() ? obj.dispositivo.trim() : null,
    };
}

function normalizeUrlCookie(raw) {
    const clean = String(raw || '').trim();
    if (!clean) return '';
    if (!clean.includes('%')) return clean;
    try {
        return decodeURIComponent(clean);
    } catch {
        return clean;
    }
}

async function connectCdpClient(wsUrl, timeoutMs = 12_000) {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const eventListeners = new Set();

    await new Promise((res, rej) => {
        let settled = false;
        const finishErr = (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                ws.close();
            } catch {
                // ignora falha ao fechar handshake
            }
            rej(err);
        };
        const timer = setTimeout(() => finishErr(new Error('Timeout na conexao CDP')), timeoutMs);
        ws.addEventListener('open', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            res();
        });
        ws.addEventListener('error', (err) => {
            finishErr(new Error(err?.message || 'Erro WebSocket CDP'));
        });
        ws.addEventListener('close', () => {
            finishErr(new Error('Conexao WebSocket CDP encerrada'));
        });
    });

    ws.addEventListener('message', (ev) => {
        let msg;
        try {
            msg = JSON.parse(String(ev.data));
        } catch {
            return;
        }
        if (msg?.id && pending.has(msg.id)) {
            const { resolveCmd, rejectCmd } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) {
                rejectCmd(new Error(msg.error.message || 'Erro CDP'));
            } else {
                resolveCmd(msg.result || {});
            }
        } else if (msg?.method) {
            for (const fn of eventListeners) {
                try {
                    fn(msg);
                } catch {
                    // ignora erro em listener de evento CDP
                }
            }
        }
    });

    const rejectAllPending = (reason) => {
        for (const [, p] of pending) {
            p.rejectCmd(new Error(reason));
        }
        pending.clear();
    };

    ws.addEventListener('close', () => {
        rejectAllPending('CDP encerrado');
    });

    const send = (method, params = {}, sessionId = undefined) => new Promise((resolveCmd, rejectCmd) => {
        if (ws.readyState !== 1) {
            rejectCmd(new Error('CDP fechado'));
            return;
        }
        const id = nextId++;
        const cmdTimer = setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                rejectCmd(new Error(`Timeout no comando CDP: ${method}`));
            }
        }, 8_000);
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        pending.set(id, {
            resolveCmd: (val) => {
                clearTimeout(cmdTimer);
                resolveCmd(val);
            },
            rejectCmd: (err) => {
                clearTimeout(cmdTimer);
                rejectCmd(err);
            },
        });
        ws.send(JSON.stringify(payload));
    });

    const onEvent = (fn) => {
        eventListeners.add(fn);
        return () => eventListeners.delete(fn);
    };

    const close = () => {
        eventListeners.clear();
        rejectAllPending('CDP encerrado');
        try {
            ws.close();
        } catch {
            // ja fechado
        }
    };

    return { ws, send, onEvent, close };
}

async function connectActiveBrowserCdp(options = {}) {
    let candidateRoots;
    if (options.profileDir) {
        candidateRoots = [resolve(options.profileDir)];
    } else if (options.executablePath && !options.extraUserDataDirs && !options.onlyExtraUserDataDirs) {
        return null;
    } else {
        candidateRoots = discoverBrowserUserDataDirs(options);
    }

    const candidates = [];
    for (const userDataDir of candidateRoots) {
        const portFile = join(userDataDir, 'DevToolsActivePort');
        if (!existsSync(portFile)) continue;
        try {
            const st = statSync(portFile);
            const lines = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
            const port = Number(lines[0]);
            const wsPath = String(lines[1] || '').trim();
            if (port > 0 && wsPath.startsWith('/devtools/')) {
                candidates.push({
                    userDataDir,
                    port,
                    wsPath,
                    mtimeMs: Number(st.mtimeMs || 0),
                });
            }
        } catch {
            // ignora DevToolsActivePort ilegivel
        }
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const connectTimeoutMs = options.connectTimeoutMs ?? 12_000;
    for (const item of candidates) {
        try {
            const cdp = await connectCdpClient(`ws://127.0.0.1:${item.port}${item.wsPath}`, connectTimeoutMs);
            return {
                cdp,
                userDataDir: item.userDataDir,
                port: item.port,
                wsPath: item.wsPath,
                isSharedBrowser: true,
            };
        } catch {
            // porta obsoleta ou instancia encerrada; tenta proximo perfil
        }
    }
    return null;
}

function isGameTab(target) {
    return target?.type === 'page' && /^https:\/\/pokeidle\.io\/app(?:[/?#]|$)/i.test(target.url || '');
}

async function extractCredentialsViaCdp(cdp, provider, { collectAllCookies = false, userDataDir = null } = {}) {
    if (provider === 'twitch' || provider === 'kick' || collectAllCookies) {
        const cookieRes = await cdp.send('Storage.getCookies').catch(() => null);
        const cookies = Array.isArray(cookieRes?.cookies) ? cookieRes.cookies : [];

        if (collectAllCookies) {
            const twAuth = cookies.find((c) => c.domain?.includes('twitch.tv') && c.name === 'auth-token' && c.value)?.value || '';
            const twUnique = cookies.find((c) => c.domain?.includes('twitch.tv') && c.name === 'unique_id' && c.value)?.value || '';
            const kkTok = normalizeUrlCookie(cookies.find((c) => c.domain?.includes('kick.com') && c.name === 'session_token' && c.value)?.value || '');
            return {
                provider: 'all',
                twitchToken: String(twAuth).trim(),
                twitchDeviceId: String(twUnique).trim(),
                kickToken: kkTok,
            };
        }

        if (provider === 'twitch') {
            const auth = cookies.find((c) => c.domain?.includes('twitch.tv') && c.name === 'auth-token' && c.value);
            if (auth?.value) {
                const unique = cookies.find((c) => c.domain?.includes('twitch.tv') && c.name === 'unique_id' && c.value);
                return {
                    provider: 'twitch',
                    twitchToken: String(auth.value).trim(),
                    twitchDeviceId: unique?.value ? String(unique.value).trim() : '',
                };
            }
            return null;
        }

        if (provider === 'kick') {
            const sess = cookies.find((c) => c.domain?.includes('kick.com') && c.name === 'session_token' && c.value);
            if (sess?.value) {
                return {
                    provider: 'kick',
                    kickToken: normalizeUrlCookie(sess.value),
                };
            }
            return null;
        }
    }

    if (provider === 'pokeidle') {
        const targetsRes = await cdp.send('Target.getTargets').catch(() => null);
        const pokeTargets = (targetsRes?.targetInfos || []).filter(isGameTab);

        for (const pageTarget of pokeTargets) {
            if (!pageTarget?.targetId) continue;
            const attached = await cdp.send('Target.attachToTarget', {
                targetId: pageTarget.targetId,
                flatten: true,
            }).catch(() => null);
            if (!attached?.sessionId) continue;

            try {
                const evalRes = await cdp.send('Runtime.evaluate', {
                    expression: "JSON.stringify({ sessao: localStorage.getItem('sessao'), dispositivo: localStorage.getItem('id-dispositivo') })",
                    returnByValue: true,
                }, attached.sessionId).catch(() => null);
                const rawVal = evalRes?.result?.value;
                if (typeof rawVal === 'string') {
                    const box = JSON.parse(rawVal);
                    const sessao = box?.sessao ? JSON.parse(box.sessao) : null;
                    const payload = sessao?.token ? decodeJwtPayload(sessao.token) : null;
                    const tokenValid = payload && (!payload.exp || Number(payload.exp) > Date.now() + 60_000);
                    if (sessao?.nick && sessao?.token && tokenValid) {
                        return {
                            provider: 'pokeidle',
                            nick: sessao.nick,
                            token: sessao.token,
                            provedor: sessao.provedor || payload.provedor || null,
                            dispositivo: box.dispositivo || null,
                        };
                    }
                }
            } catch {
                // login ainda em andamento
            } finally {
                await cdp.send('Target.detachFromTarget', { sessionId: attached.sessionId }).catch(() => {});
            }
        }

        if (userDataDir) {
            const extracted = extractSessionFromLevelDbDir(join(userDataDir, 'Default', 'Local Storage', 'leveldb'));
            const tokenValid = extracted?.payload && (!extracted.payload.exp || Number(extracted.payload.exp) > Date.now() + 60_000);
            if (extracted?.token && extracted?.nick && tokenValid) {
                return {
                    provider: 'pokeidle',
                    nick: extracted.nick,
                    token: extracted.token,
                    provedor: extracted.provedor || null,
                    dispositivo: extracted.dispositivo || null,
                };
            }
        }
    }

    return null;
}

/**
 * Conecta no navegador ativo (Chrome/Edge/Brave via DevToolsActivePort) ou abre perfil isolado fallback
 * para capturar cookies/localStorage de Twitch, Kick ou PokeIdle.
 * @param {'twitch'|'kick'|'pokeidle'} provider Servico alvo de autenticacao.
 * @param {object} [options] Opcoes de perfil, headless, signal, timeoutMs e descoberta CDP.
 * @returns {Promise<object|null>} Credenciais capturadas do provedor.
 */
export async function openInteractiveLogin(provider, options = {}) {
    const targetUrl = LOGIN_URLS[provider];
    if (!targetUrl) throw new Error(`Provedor de login desconhecido: ${provider}`);

    const headless = Boolean(options.headless);
    const accepts = (result) => result && (!options.previousNick ||
        result.nick?.toLowerCase() !== options.previousNick.toLowerCase()) &&
        (!options.previousToken || (result.twitchToken || result.kickToken) !== options.previousToken);
    const pollIntervalMs = Math.max(50, Number(options.pollIntervalMs ?? 900));
    const active = options.forceIsolatedProfile ? null : await connectActiveBrowserCdp(options);

    if (active) {
        let createdTargetId = null;
        let cdpDisconnected = false;
        let captured = false;

        active.cdp.ws.addEventListener?.('close', () => {
            cdpDisconnected = true;
        });

        const cleanupActiveTab = async () => {
            if (createdTargetId && !cdpDisconnected) {
                const tid = createdTargetId;
                createdTargetId = null;
                await active.cdp.send('Target.closeTarget', { targetId: tid }).catch(() => {});
            }
            active.cdp.close();
        };

        const onAbortActive = () => {
            cleanupActiveTab().catch(() => {});
        };
        options.signal?.addEventListener('abort', onAbortActive, { once: true });

        try {
            const immediate = await extractCredentialsViaCdp(active.cdp, provider, {
                collectAllCookies: options.collectAllCookies,
                userDataDir: active.userDataDir,
            });

            if (immediate && !options.interactive) {
                if (options.collectAllCookies && !immediate.twitchToken && !immediate.kickToken && headless) {
                    return immediate;
                }
                if (!options.collectAllCookies || immediate.twitchToken || immediate.kickToken) {
                    return { ...immediate, fromActiveBrowser: true };
                }
            }

            if (headless) {
                return options.collectAllCookies
                    ? { provider: 'all', twitchToken: '', twitchDeviceId: '', kickToken: '' }
                    : null;
            }

            const created = await active.cdp.send('Target.createTarget', {
                url: targetUrl,
                ...(options.interactive ? { newWindow: true } : {}),
            });
            createdTargetId = created?.targetId || null;

            const timeoutMs = options.timeoutMs ?? 300_000;
            const deadline = Date.now() + timeoutMs;

            while (Date.now() < deadline && !cdpDisconnected && !options.signal?.aborted) {
                await new Promise((r) => setTimeout(r, pollIntervalMs));
                if (cdpDisconnected || options.signal?.aborted) break;

                const polled = await extractCredentialsViaCdp(active.cdp, provider, {
                    collectAllCookies: options.collectAllCookies,
                    userDataDir: options.interactive ? null : active.userDataDir,
                });
                if (accepts(polled) && (!options.collectAllCookies || polled.twitchToken || polled.kickToken)) {
                    captured = true;
                    return { ...polled, fromActiveBrowser: true };
                }

                if (createdTargetId) {
                    const targetsRes = await active.cdp.send('Target.getTargets').catch(() => null);
                    if (
                        Array.isArray(targetsRes?.targetInfos) &&
                        !targetsRes.targetInfos.some((t) => t.targetId === createdTargetId)
                    ) {
                        createdTargetId = null;
                        throw new Error(`Aba de login (${provider}) foi fechada antes de concluir.`);
                    }
                }
            }

            if (options.signal?.aborted) {
                throw new Error('Login cancelado.');
            }
            if (cdpDisconnected) {
                throw new Error(`Navegador ativo foi fechado durante o login (${provider}).`);
            }
            throw new Error(`Tempo limite esgotado aguardando login (${provider}).`);
        } finally {
            options.signal?.removeEventListener('abort', onAbortActive);
            if (!captured && !options.signal?.aborted) {
                createdTargetId = null;
            }
            await cleanupActiveTab();
        }
    }

    const exe = options.executablePath || findChromiumExecutable();
    if (!exe || !existsSync(exe)) {
        throw new Error('Chrome/Edge nao encontrado para abrir a janela de login.');
    }

    const cwd = options.cwd || process.cwd();
    const profileDir = options.profileDir || resolve(cwd, DEFAULT_BROWSER_PROFILE_DIR);
    mkdirSync(profileDir, { recursive: true });

    const portFile = join(profileDir, 'DevToolsActivePort');
    try {
        rmSync(portFile, { force: true });
    } catch {
        // sem arquivo antigo
    }

    const timeoutMs = options.timeoutMs ?? (headless ? 10_000 : 300_000);
    const args = [
        `--user-data-dir=${profileDir}`,
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        ...(headless ? ['--headless=new', 'about:blank'] : ['--new-window', targetUrl]),
    ];

    const child = spawn(exe, args, { stdio: 'ignore' });
    let exited = false;
    let launchError = null;
    child.once('exit', () => { exited = true; });
    child.once('error', (err) => { launchError = err; exited = true; });

    let cdp = null;
    const closeAll = async () => {
        if (cdp) {
            try {
                await Promise.race([
                    cdp.send('Browser.close'),
                    new Promise((r) => setTimeout(r, 400)),
                ]);
            } catch {
                // ignora se janela ja fechou
            }
            cdp.close();
            cdp = null;
        }
        if (!exited) {
            try {
                child.kill();
            } catch {
                // ja finalizado
            }
        }
    };

    const onAbort = () => { closeAll(); };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
        let port = null;
        let wsPath = null;
        const waitPortDeadline = Date.now() + 12_000;
        while (Date.now() < waitPortDeadline && !exited && !options.signal?.aborted) {
            if (existsSync(portFile)) {
                const lines = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
                const parsedPort = Number(lines[0]);
                const parsedPath = String(lines[1] || '').trim();
                if (parsedPort > 0 && parsedPath.startsWith('/devtools/')) {
                    port = parsedPort;
                    wsPath = parsedPath;
                    break;
                }
            }
            await new Promise((r) => setTimeout(r, 150));
        }

        if (!port || !wsPath) {
            if (launchError) throw new Error(`Falha ao abrir o navegador: ${launchError.message}`);
            throw new Error('Janela de login fechada ou perfil ocupado. Feche as janelas abertas deste perfil e tente novamente.');
        }

        cdp = await connectCdpClient(`ws://127.0.0.1:${port}${wsPath}`, options.connectTimeoutMs ?? 12_000);
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline && !exited && !options.signal?.aborted) {
            const extracted = await extractCredentialsViaCdp(cdp, provider, {
                collectAllCookies: options.collectAllCookies,
                userDataDir: options.interactive ? null : profileDir,
            });
            if (accepts(extracted)) {
                return extracted;
            }
            await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        if (options.signal?.aborted) {
            throw new Error('Login cancelado.');
        }
        if (exited) {
            throw new Error(`Janela de login (${provider}) foi fechada antes de concluir.`);
        }
        throw new Error(`Tempo limite esgotado aguardando login (${provider}).`);
    } finally {
        options.signal?.removeEventListener('abort', onAbort);
        await closeAll();
    }
}

/**
 * Le cookies Twitch/Kick do navegador ativo (CDP) ou do perfil embutido fallback sem abrir janela.
 * @param {object} [options] Diretorio de perfil, cwd e opcoes de descoberta.
 * @returns {Promise<{ twitchToken: string, twitchDeviceId: string, kickToken: string, fromActiveBrowser?: boolean }|null>} Tokens encontrados ou null.
 */
export async function trySilentProfileCookieSync(options = {}) {
    const active = options.forceIsolatedProfile ? null : await connectActiveBrowserCdp(options);
    if (active) {
        try {
            const res = await extractCredentialsViaCdp(active.cdp, 'twitch', {
                collectAllCookies: true,
                userDataDir: active.userDataDir,
            });
            if (res && (res.twitchToken || res.kickToken)) {
                return { ...res, fromActiveBrowser: true };
            }
        } catch {
            // falha silenciosa no navegador ativo tenta fallback isolado
        } finally {
            active.cdp.close();
        }
        return null;
    }

    const cwd = options.cwd || process.cwd();
    const profileDir = options.profileDir || resolve(cwd, DEFAULT_BROWSER_PROFILE_DIR);
    if (!existsSync(profileDir)) return null;
    try {
        const res = await openInteractiveLogin('twitch', {
            ...options,
            profileDir,
            forceIsolatedProfile: true,
            headless: true,
            collectAllCookies: true,
            timeoutMs: 8_000,
        });
        if (res && (res.twitchToken || res.kickToken)) {
            return res;
        }
        return null;
    } catch {
        return null;
    }
}

const BROWSER_BRIDGE_HOOK_SCRIPT = `(() => {
    if (!window.__pbBridgeTap) {
        window.__pbBridgeTap = true;
        window.__pbNeedCampoFeed = true;
        const origSend = WebSocket.prototype.send;
        const capture = (sock) => {
            try {
                if (sock && /pokeidle\\.io/i.test(String(sock.url || ''))) {
                    window.__pbGameWs = sock;
                }
            } catch {}
        };
        WebSocket.prototype.send = function(data) {
            capture(this);
            try {
                if (
                    window.__pbNeedCampoFeed !== false &&
                    /pokeidle\\.io/i.test(String(this?.url || '')) &&
                    typeof data === 'string' &&
                    data.includes('"cliente.economia"') &&
                    data.includes('true')
                ) {
                    const parsed = JSON.parse(data);
                    if (parsed && parsed.t === 'cliente.economia' && parsed.ativo === true) {
                        return origSend.call(this, JSON.stringify({ t: 'cliente.economia', ativo: false }));
                    }
                }
            } catch {}
            return origSend.apply(this, arguments);
        };
        const NativeWS = window.WebSocket;
        if (typeof NativeWS === 'function') {
            try {
                window.WebSocket = new Proxy(NativeWS, {
                    construct(target, args, newTarget) {
                        const ws = Reflect.construct(target, args, newTarget);
                        capture(ws);
                        return ws;
                    }
                });
            } catch {}
        }
    }
    return {
        hooked: true,
        hasWs: Boolean(window.__pbGameWs && window.__pbGameWs.readyState === 1),
    };
})()`;

function buildSessionSeedScript(seedSession) {
    if (!seedSession?.token || !seedSession?.nick) return null;
    const sessaoJson = JSON.stringify({
        nick: seedSession.nick,
        token: seedSession.token,
        provedor: seedSession.provedor || 'google',
    });
    const dispositivo = seedSession.dispositivo || '';
    return `(() => {
        try {
            if (!/pokeidle\\.io/i.test(location.hostname || '')) return { seeded: false };
            const cur = localStorage.getItem('sessao');
            let curTok = '';
            try { curTok = cur ? JSON.parse(cur).token || '' : ''; } catch {}
            const dev = ${JSON.stringify(dispositivo)};
            if (dev && !localStorage.getItem('id-dispositivo')) {
                localStorage.setItem('id-dispositivo', dev);
            }
            if (curTok !== ${JSON.stringify(seedSession.token)}) {
                localStorage.setItem('sessao', ${JSON.stringify(sessaoJson)});
                return { seeded: true };
            }
            return { seeded: false };
        } catch {
            return { seeded: false };
        }
    })()`;
}

/**
 * Conecta via CDP a aba ativa do PokeIdle no navegador (incluindo tela vinculada do app)
 * para receber frames WebSocket em tempo real e enviar acoes do bot pela mesma sessao sem 4001.
 * @param {object} [options] Opcoes CDP, profileDir, seedSession, callbacks onFrame/onDetach e timeouts.
 * @returns {Promise<{ send: (frame: object) => boolean, isReady: () => boolean, close: () => void, targetId: string }>} Ponte ativa.
 */
export async function createCdpBrowserBridge(options = {}) {
    const waitMs = Math.max(500, Number(options.waitForTargetMs ?? 12_000));
    const connectDeadline = Date.now() + waitMs;
    let active = null;
    while (Date.now() < connectDeadline && !options.signal?.aborted) {
        active = await connectActiveBrowserCdp({
            ...options,
            connectTimeoutMs: Math.min(4000, Number(options.connectTimeoutMs ?? 4000)),
        });
        if (active || !options.profileDir) break;
        await new Promise((r) => setTimeout(r, 250));
    }
    if (!active) {
        throw new Error('Navegador da tela vinculada com DevToolsActivePort nao encontrado.');
    }

    const { cdp } = active;
    const preferNewTarget = Boolean(options.preferNewTarget);
    const autoReloadIfMissedWs = options.autoReloadIfMissedWs !== false;
    const seedScript = buildSessionSeedScript(options.seedSession);
    const onFrame = typeof options.onFrame === 'function' ? options.onFrame : () => {};
    const onDetach = typeof options.onDetach === 'function' ? options.onDetach : () => {};

    let closed = false;
    let sessionId = null;
    let targetId = null;
    let unsubEvent = null;
    const pokeidleRequestIds = new Set();

    const cleanup = (notifyDetach = false) => {
        if (closed) return;
        closed = true;
        if (unsubEvent) {
            try { unsubEvent(); } catch { /* ignore */ }
            unsubEvent = null;
        }
        if (sessionId) {
            const sid = sessionId;
            sessionId = null;
            cdp.send('Target.detachFromTarget', { sessionId: sid }).catch(() => {});
        }
        cdp.close();
        if (notifyDetach) onDetach();
    };

    const onAbort = () => cleanup(false);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
        if (options.openWindow) {
            const created = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
            targetId = created?.targetId;
            if (!targetId) throw new Error('O navegador não abriu a janela do jogo.');
        }
        const initialTargetsRes = await cdp.send('Target.getTargets').catch(() => null);
        const initialIds = new Set(
            (initialTargetsRes?.targetInfos || [])
                .filter(isGameTab)
                .map((t) => t.targetId)
        );

        const deadline = Date.now() + waitMs;
        let chosen = null;
        const preferNewDeadline = Date.now() + Math.min(waitMs, 4500);

        while (!targetId && Date.now() < deadline && !closed && !options.signal?.aborted) {
            const res = await cdp.send('Target.getTargets').catch(() => null);
            const matches = (res?.targetInfos || []).filter(
                (t) => isGameTab(t) && (!options.targetId || t.targetId === options.targetId)
            );
            const fresh = matches.find((t) => !initialIds.has(t.targetId));
            if (fresh) {
                chosen = fresh;
                break;
            }
            if (matches.length > 0 && (!preferNewTarget || Date.now() >= preferNewDeadline)) {
                chosen = matches[matches.length - 1];
                break;
            }
            await new Promise((r) => setTimeout(r, 200));
        }

        targetId ||= chosen?.targetId;
        if (!targetId) {
            throw new Error('Aba do PokeIdle nao encontrada na tela vinculada.');
        }

        await cdp.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
        const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        sessionId = attached?.sessionId || null;
        if (!sessionId) {
            throw new Error('Falha ao acoplar CDP na aba do PokeIdle.');
        }

        unsubEvent = cdp.onEvent((msg) => {
            if (closed) return;
            if (msg.method === 'Target.targetDestroyed' && msg.params?.targetId === targetId) {
                cleanup(true);
                return;
            }
            if (msg.method === 'Inspector.detached' && msg.sessionId === sessionId) {
                cleanup(true);
                return;
            }
            if (msg.sessionId !== sessionId) return;

            if (msg.method === 'Network.webSocketCreated') {
                if (/pokeidle\.io/i.test(String(msg.params?.url || ''))) {
                    pokeidleRequestIds.add(msg.params.requestId);
                }
                return;
            }
            if (msg.method === 'Network.webSocketFrameReceived') {
                const payload = msg.params?.response?.payloadData;
                if (typeof payload !== 'string' || !payload.startsWith('{')) return;
                const reqId = msg.params?.requestId;
                if (pokeidleRequestIds.size === 0 || pokeidleRequestIds.has(reqId)) {
                    if (payload.includes('"t":')) {
                        onFrame(payload);
                    }
                }
            }
        });

        cdp.ws.addEventListener?.('close', () => cleanup(true));

        await cdp.send('Network.enable', {}, sessionId);
        await cdp.send('Page.enable', {}, sessionId).catch(() => {});
        await cdp.send('Runtime.enable', {}, sessionId).catch(() => {});
        if (seedScript) {
            await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript }, sessionId).catch(() => {});
        }
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: BROWSER_BRIDGE_HOOK_SCRIPT }, sessionId).catch(() => {});

        let seededNow = false;
        if (seedScript) {
            const seedRes = await cdp.send('Runtime.evaluate', {
                expression: seedScript,
                returnByValue: true,
            }, sessionId).catch(() => null);
            seededNow = Boolean(seedRes?.result?.value?.seeded);
        }

        const evalInit = await cdp.send('Runtime.evaluate', {
            expression: BROWSER_BRIDGE_HOOK_SCRIPT,
            returnByValue: true,
        }, sessionId).catch(() => null);

        let hasWs = Boolean(evalInit?.result?.value?.hasWs);
        if (options.openWindow) {
            const navigation = await cdp.send('Page.navigate', { url: LOGIN_URLS.pokeidle }, sessionId);
            if (navigation?.errorText) throw new Error(navigation.errorText);
        } else if (seededNow && !closed && !options.signal?.aborted) {
            await cdp.send('Page.reload', {}, sessionId).catch(() => {});
        } else if (!hasWs && autoReloadIfMissedWs) {
            for (let i = 0; i < 6 && !hasWs && !closed && !options.signal?.aborted; i++) {
                await new Promise((r) => setTimeout(r, 250));
                const check = await cdp.send('Runtime.evaluate', {
                    expression: 'Boolean(window.__pbGameWs && window.__pbGameWs.readyState === 1)',
                    returnByValue: true,
                }, sessionId).catch(() => null);
                hasWs = Boolean(check?.result?.value);
            }
            if (!hasWs && !closed && !options.signal?.aborted) {
                await cdp.send('Page.reload', {}, sessionId).catch(() => {});
            }
        }

        const sendGameFrame = (frame) => {
            if (closed || !sessionId || !frame) return false;
            const rawJson = JSON.stringify(frame);
            const expr = `(() => { const ws = window.__pbGameWs; if (!ws || ws.readyState !== 1) return false; ws.send(${JSON.stringify(rawJson)}); return true; })()`;
            cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId).catch(() => {});
            return true;
        };

        return {
            targetId,
            isReady: () => !closed && Boolean(sessionId),
            send: sendGameFrame,
            async readHuntGuide(metric) {
                if (closed || !sessionId) return null;
                const result = await cdp.send('Runtime.evaluate', {
                    expression: `(${readHuntGuideInPage.toString()})(${JSON.stringify(metric)})`,
                    awaitPromise: true,
                    returnByValue: true,
                }, sessionId);
                return result?.result?.value ?? null;
            },
            close: () => {
                options.signal?.removeEventListener('abort', onAbort);
                cleanup(false);
            },
        };
    } catch (err) {
        options.signal?.removeEventListener('abort', onAbort);
        cleanup(false);
        throw err;
    }
}

/**
 * Cria ponte compartilhada entre o loop WebSocket headless e o modulo liveRewards (Twitch & Kick).
 * @param {object} params Getters de configuracao, logger e runners injetaveis.
 * @returns {object} Ponte com ingestWsMessage, runOnce, startTimer, stopTimer, setPaused, getLivesSnapshot e dispose.
 */
export function createLiveRewardsBridge({
    getConfig,
    onLog,
    liveRunner = runLiveCycle,
    liveDisposer = liveRewards.dispose,
    intervalMs = LIVE_CYCLE_INTERVAL_MS,
} = {}) {
    let liveTimer = null;
    let liveStartDelayTimer = null;
    let warnedNoToken = false;

    const liveState = {
        running: true,
        paused: false,
        liveGameData: { twitch: null, kick: null, skew: 0 },
        liveStatus: { twitch: {}, kick: {} },
        stats: {
            liveMinutesWatched: 0,
            liveChestsClaimed: 0,
            liveRewardsRedeemed: 0,
        },
        stepEvents: [],
        lastActionNote: '',
    };

    const liveCtx = {
        CONFIG: {
            get live() {
                const c = getConfig?.() || {};
                return {
                    enabled: c.liveEnabled ?? true,
                    watchTwitch: c.liveWatchTwitch ?? true,
                    watchKick: c.liveWatchKick ?? true,
                    autoClaimChest: c.liveAutoClaimChest ?? true,
                    autoRedeem: c.liveAutoRedeem ?? true,
                    rewardType: c.liveRewardType || 'xp',
                    twitchRewards: Array.isArray(c.liveTwitchRewards) ? c.liveTwitchRewards : null,
                    kickRewards: Array.isArray(c.liveKickRewards) ? c.liveKickRewards : null,
                    rewardTier: c.liveRewardTier || 'smart',
                    smartBalance: c.liveSmartBalance ?? true,
                    syncPlatforms: Boolean(c.liveSyncPlatforms ?? false),
                    targetHours: Number(c.liveTargetHours ?? 24),
                    channelRewards: c.liveChannelRewards && typeof c.liveChannelRewards === 'object' ? c.liveChannelRewards : {},
                    guardThresholdMin: c.liveGuardThresholdMin ?? 30,
                    maxSlots: c.liveMaxSlots ?? 4,
                    maxTwitchSlots: c.liveMaxTwitchSlots ?? c.liveMaxSlots ?? 4,
                    maxKickSlots: c.liveMaxKickSlots ?? 2,
                    twitchToken: c.liveTwitchToken || '',
                    twitchDeviceId: c.liveTwitchDeviceId || '',
                    kickToken: c.liveKickToken || '',
                    customTwitchChannels: c.liveCustomTwitch || '',
                    customKickChannels: c.liveCustomKick || '',
                    checkIntervalMs: intervalMs,
                };
            },
        },
        state: liveState,
        dom: {
            $: () => null,
            $$: () => [],
            getVisibleModal: () => null,
            closeActiveModal: async () => false,
            isInteractable: () => false,
            waitFor: async () => null,
        },
        net: {
            fetch: (url, opts) => fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(12_000) }),
            createWebSocket: (url) => new WebSocket(url),
            paceMs: { twitch: 450, kick: 1500 },
        },
        updateHud: () => {},
    };

    const ingestWsMessage = (msg) => mergeGameWsMessage(liveState, msg);

    const officialLiveUrls = () => {
        const cfg = getConfig?.() || {};
        const platforms = [
            ['twitch', 'https://www.twitch.tv/', cfg.liveWatchTwitch],
            ['kick', 'https://kick.com/', cfg.liveWatchKick],
        ];
        return platforms.flatMap(([platform, base, enabled]) => enabled === false ? [] :
            selectChannelsToWatch(liveState.liveGameData[platform]?.oficiais, '', 12)
                .filter((channel) => /^[a-z0-9_-]+$/i.test(channel))
                .map((channel) => base + channel.toLowerCase()));
    };

    const runOnce = async ({ force = false } = {}) => {
        const cfg = getConfig?.() || {};
        if (!liveState.running || (liveState.paused && !force)) return false;
        if (!cfg.liveEnabled && !force) return false;

        const prevChests = liveState.stats.liveChestsClaimed;
        const prevRedeems = liveState.stats.liveRewardsRedeemed;
        const prevNote = liveState.lastActionNote;
        liveState.stepEvents.length = 0;

        try {
            await liveRunner(liveCtx, { force });
        } catch (err) {
            onLog?.('warn', `Lives: ${err?.message || err}`);
            return false;
        }

        const stepEvents = liveState.stepEvents.splice(0, liveState.stepEvents.length);
        if (stepEvents.length > 0) {
            for (const msg of stepEvents) {
                onLog?.('live', msg);
            }
        } else if (liveState.stats.liveChestsClaimed > prevChests || liveState.stats.liveRewardsRedeemed > prevRedeems) {
            const note = String(liveState.lastActionNote || '');
            onLog?.('live', note && !/exige clique/i.test(note) ? note : 'Lives: recompensa processada.');
        } else if (
            liveState.lastActionNote &&
            liveState.lastActionNote !== prevNote &&
            liveState.lastActionNote.includes('token') &&
            (!warnedNoToken || force)
        ) {
            warnedNoToken = true;
            onLog?.('warn', liveState.lastActionNote);
        }
        return true;
    };

    const startTimer = () => {
        if (liveTimer || liveStartDelayTimer) return;
        const jitterMs = intervalMs >= 10_000
            ? Math.floor(Math.random() * Math.min(12_000, Math.floor(intervalMs / 2)))
            : 0;
        if (jitterMs > 0) {
            liveStartDelayTimer = setTimeout(() => {
                liveStartDelayTimer = null;
                if (!liveState.running || liveTimer) return;
                liveTimer = setInterval(() => {
                    runOnce({ force: false });
                }, intervalMs);
                runOnce({ force: false });
            }, jitterMs);
        } else {
            liveTimer = setInterval(() => {
                runOnce({ force: false });
            }, intervalMs);
        }
    };

    const stopTimer = () => {
        if (liveStartDelayTimer) {
            clearTimeout(liveStartDelayTimer);
            liveStartDelayTimer = null;
        }
        if (liveTimer) {
            clearInterval(liveTimer);
            liveTimer = null;
        }
    };

    const setPaused = (paused) => {
        liveState.paused = Boolean(paused);
    };

    const dispose = () => {
        liveState.running = false;
        stopTimer();
        try {
            liveDisposer?.(liveCtx);
        } catch {
            // ignorar cleanup duplicado
        }
    };

    const getLivesSnapshot = () => {
        const cfg = getConfig?.() || {};
        const fallbackKind = cfg.liveRewardType || 'xp';
        const twitchRewards = Array.isArray(cfg.liveTwitchRewards) ? [...cfg.liveTwitchRewards] : [fallbackKind];
        const kickRewards = Array.isArray(cfg.liveKickRewards) ? [...cfg.liveKickRewards] : [fallbackKind];
        const channelRewards = cfg.liveChannelRewards && typeof cfg.liveChannelRewards === 'object'
            ? { ...cfg.liveChannelRewards }
            : {};
        const liveCfgView = {
            rewardType: fallbackKind,
            twitchRewards: Array.isArray(cfg.liveTwitchRewards) ? cfg.liveTwitchRewards : null,
            kickRewards: Array.isArray(cfg.liveKickRewards) ? cfg.liveKickRewards : null,
            channelRewards,
        };
        const serverNow = Date.now() - (liveState.liveGameData?.skew || 0);
        const effTwBonus = getEffectiveBonusStateForCtx(liveCtx, 'twitch');
        const effKkBonus = getEffectiveBonusStateForCtx(liveCtx, 'kick');
        const calcBonusMins = (platform) => {
            const eff = platform === 'twitch' ? effTwBonus : effKkBonus;
            const b = eff?.bonus || {};
            const out = {};
            for (const kind of LIVE_REWARD_KINDS) {
                const until = Number(b[kind]) || 0;
                out[kind] = until > serverNow ? Math.ceil((until - serverNow) / 60_000) : 0;
            }
            return out;
        };

        const buildPlatformChannels = (platform) => {
            const seen = new Map();
            const addCh = (rawName, liveFlag = false) => {
                const name = String(rawName || '').trim();
                if (!name) return;
                const low = name.toLowerCase();
                const prev = seen.get(low);
                if (prev) {
                    if (liveFlag) prev.live = true;
                    return;
                }
                const stObj = liveState.liveStatus?.[platform]?.[name] || liveState.liveStatus?.[platform]?.[low];
                const savedBal = liveState.liveChannelBalances?.[platform]?.[low];
                const bal = typeof stObj?.balance === 'number'
                    ? stObj.balance
                    : (typeof savedBal === 'number' ? savedBal : null);
                const key = `${platform}:${low}`;
                seen.set(low, {
                    key,
                    platform,
                    channel: low,
                    live: Boolean(liveFlag || stObj?.live),
                    balance: bal,
                    smartNote: stObj?.smartNote || '',
                    override: channelRewards[key] || '',
                    effectiveKinds: resolveChannelRewardKinds(liveCfgView, platform, low),
                    balanceAt: Number(stObj?.balanceAt || 0),
                    watch: platform === 'twitch' ? (liveState.liveWatch?.[low] || null) : null,
                });
            };
            const gameList = liveState.liveGameData?.[platform]?.oficiais ?? liveState.liveGameData?.[platform]?.canaisConsultados ?? [];
            for (const o of gameList) {
                if (o && o.ativo !== false) addCh(o.login || o.slug, Boolean(o.aoVivo));
            }
            const customCsv = platform === 'twitch' ? cfg.liveCustomTwitch : cfg.liveCustomKick;
            String(customCsv || '').split(/[\s,;]+/).forEach((c) => addCh(c, false));
            for (const [k, st] of Object.entries(liveState.liveStatus?.[platform] || {})) {
                addCh(k, Boolean(st?.live));
            }
            const defaults = platform === 'twitch' ? DEFAULT_TWITCH_OFFICIALS : DEFAULT_KICK_OFFICIALS;
            defaults.forEach((c) => addCh(c, false));
            for (const key of Object.keys(channelRewards)) {
                if (key.startsWith(`${platform}:`)) {
                    addCh(key.slice(platform.length + 1), false);
                }
            }
            return [...seen.values()];
        };

        const channels = [
            ...buildPlatformChannels('twitch'),
            ...buildPlatformChannels('kick'),
        ].sort((a, b) =>
            Number(b.live) - Number(a.live) ||
            Number(b.override !== '') - Number(a.override !== '') ||
            (b.balance ?? -1) - (a.balance ?? -1) ||
            a.platform.localeCompare(b.platform) ||
            a.channel.localeCompare(b.channel)
        );

        const smartCfgView = {
            smartBalance: cfg.liveSmartBalance ?? true,
            syncPlatforms: Boolean(cfg.liveSyncPlatforms ?? false),
            targetHours: Number(cfg.liveTargetHours ?? 24),
            guardThresholdMin: Number(cfg.liveGuardThresholdMin ?? 30),
            watchTwitch: cfg.liveWatchTwitch ?? true,
            watchKick: cfg.liveWatchKick ?? true,
            hasTwitchToken: Boolean(cfg.liveTwitchToken),
            hasKickToken: Boolean(cfg.liveKickToken),
            twitchRewards,
            kickRewards,
        };
        return {
            enabled: Boolean(cfg.liveEnabled ?? true),
            autoClaimChest: Boolean(cfg.liveAutoClaimChest ?? true),
            rewardType: fallbackKind,
            twitchRewards,
            kickRewards,
            rewardTier: cfg.liveRewardTier || 'smart',
            smartBalance: Boolean(cfg.liveSmartBalance ?? true),
            syncPlatforms: Boolean(cfg.liveSyncPlatforms ?? false),
            targetHours: Number(cfg.liveTargetHours ?? 24),
            smartStatus: {
                twitch: computeSmartBuffStatus(twitchRewards, effTwBonus, smartCfgView, serverNow, getLiveLastRedeemMap(liveCtx, 'twitch'), {
                    platform: 'twitch',
                    otherKinds: kickRewards,
                    otherBonusState: effKkBonus,
                }),
                kick: computeSmartBuffStatus(kickRewards, effKkBonus, smartCfgView, serverNow, getLiveLastRedeemMap(liveCtx, 'kick'), {
                    platform: 'kick',
                    otherKinds: twitchRewards,
                    otherBonusState: effTwBonus,
                }),
            },
            channelRewards,
            activeBonuses: {
                twitch: calcBonusMins('twitch'),
                kick: calcBonusMins('kick'),
            },
            channels,
            maxTwitchSlots: Number(cfg.liveMaxTwitchSlots ?? 4),
            maxKickSlots: Number(cfg.liveMaxKickSlots ?? 2),
            hasTwitchToken: Boolean(cfg.liveTwitchToken),
            hasKickToken: Boolean(cfg.liveKickToken),
            minutesWatched: Number(liveState.stats.liveMinutesWatched || 0),
            balancesAt: Number(liveState.liveBalancesAt || 0),
            guardThresholdMin: Number(cfg.liveGuardThresholdMin ?? 30),
            chestsClaimed: Number(liveState.stats.liveChestsClaimed || 0),
            rewardsRedeemed: Number(liveState.stats.liveRewardsRedeemed || 0),
            officialUrls: officialLiveUrls(),
            twitch: liveState.liveStatus?.twitch || {},
            kick: liveState.liveStatus?.kick || {},
        };
    };

    // Caixinha +50 resgatada fora do GQL (clique no chat oculto do Hub Electron)
    const noteChestClaimed = (channel, source = 'hud') => {
        const low = String(channel || '').trim().toLowerCase();
        liveState.stats.liveChestsClaimed = (liveState.stats.liveChestsClaimed || 0) + 1;
        const twMap = liveState.liveStatus?.twitch || {};
        for (const [k, st] of Object.entries(twMap)) {
            if (k.toLowerCase() === low && st) {
                st.manualChest = false;
                st.error = null;
            }
        }
        onLog?.('live', `Lives: caixinha +50 resgatada em ${low}${source === 'auto' ? ' (automático)' : ''}.`);
    };

    // Sessao no player real da Twitch (janela oculta do Hub): sequencia e seguir
    const noteWatchSession = (channel, info = {}) => {
        const low = String(channel || '').trim().toLowerCase();
        if (!low) return;
        if (!liveState.liveWatch) liveState.liveWatch = {};
        const prev = liveState.liveWatch[low] || {};
        const next = { ...prev, ...info, at: Date.now() };
        if (info.following) next.following = true;
        liveState.liveWatch[low] = next;
        if (info.watching) return;
        if (info.kind === 'watch' && info.ok) {
            onLog?.('live', `Lives: ${low} assistida por ${info.minutes} min no player da Twitch (conta para a sequência).`);
        } else if (info.kind === 'watch' && info.reasonText) {
            onLog?.('warn', `Lives: não consegui assistir ${low} no player da Twitch (${info.reasonText}).`);
        }
        if (info.followedNow) onLog?.('live', `Lives: agora seguindo ${low} na Twitch.`);
    };

    // Pontos dos canais sem esperar o ciclo completo (funciona com o bot pausado)
    let lastBalanceRefreshAt = 0;
    let balanceRefreshInFlight = null;
    const refreshBalances = () => {
        const cfg = getConfig?.() || {};
        if (cfg.liveEnabled === false || !cfg.liveTwitchToken) return Promise.resolve(false);
        if (getPlatformRateLimit('twitch').blocked) return Promise.resolve(false);
        if (balanceRefreshInFlight) return balanceRefreshInFlight;
        if (Date.now() - lastBalanceRefreshAt < 30_000) return Promise.resolve(false);
        lastBalanceRefreshAt = Date.now();
        const logins = getLivesSnapshot().channels.filter((c) => c.platform === 'twitch').map((c) => c.channel);
        balanceRefreshInFlight = refreshTwitchBalances(liveCtx, logins)
            .catch(() => null)
            .finally(() => { balanceRefreshInFlight = null; });
        return balanceRefreshInFlight;
    };

    return {
        ingestWsMessage,
        runOnce,
        noteChestClaimed,
        noteWatchSession,
        refreshBalances,
        startTimer,
        stopTimer,
        setPaused,
        dispose,
        getLivesSnapshot,
        officialLiveUrls,
    };
}

/**
 * Cria o controlador stateful do bot headless com suporte a telemetria e comandos em tempo real.
 * @param {object} [options] Opcoes de sessao, configuracao, factories e callbacks.
 * @returns {object} Controlador com start, pause, reconnect, setHunt, updateConfig, triggerAction, getSnapshot e stop.
 */
export function createHeadlessController(options = {}) {
    const cwd = options.cwd || process.cwd();
    const configPath = options.configPath !== undefined
        ? options.configPath
        : resolve(cwd, DEFAULT_CONFIG_FILE);
    const sessionResolver = options.resolveSession || resolveHeadlessSession;
    const wsFactory = options.wsFactory || ((url, opts) => new WebSocket(url, opts));
    const hasCustomLoginLauncher = typeof options.loginLauncher === 'function';
    const loginLauncher = options.loginLauncher || ((provider, opts) => openInteractiveLogin(provider, opts));
    const browserLauncher = options.browserLauncher || launchBrowserWindow;
    const silentCookieSync = options.silentCookieSync || ((opts) => trySilentProfileCookieSync(opts));
    const browserBridgeFactory = options.browserBridgeFactory || ((opts) => createCdpBrowserBridge(opts));
    const headlessHuntGuide = options.headlessHuntGuide !== undefined
        ? options.headlessHuntGuide
        : (options.disableHeadlessHuntGuide ? null : createHeadlessHuntGuideEvaluator({ cwd }));
    const autoLoginOnMissingSession = Boolean(options.autoLoginOnMissingSession);
    const nowFn = options.nowFn || (() => Date.now());
    const pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
    const watchdogIntervalMs = options.watchdogIntervalMs ?? WATCHDOG_INTERVAL_MS;
    const watchdogTimeoutMs = options.watchdogTimeoutMs ?? WATCHDOG_TIMEOUT_MS;

    const browserOptions = options.isolatedAccount || options.useEmbeddedBrowser
        ? { cwd, profileDir: resolve(cwd, DEFAULT_BROWSER_PROFILE_DIR), forceIsolatedProfile: Boolean(options.useEmbeddedBrowser) }
        : { cwd };
    const allowBrowserProfiles = Boolean(options.useExistingBrowser || options.enableBrowserProfilePicker);
    const installedBrowsers = allowBrowserProfiles
        ? (options.browserExecutablePath
            ? [{
                key: getBrowserKeyFromExe(options.browserExecutablePath) || 'chrome',
                label: { chrome: 'Chrome', brave: 'Brave', edge: 'Edge' }[getBrowserKeyFromExe(options.browserExecutablePath)] || 'Navegador',
                exe: options.browserExecutablePath,
            }]
            : listInstalledChromiumExecutables())
        : [];
    const desktopBrowser = installedBrowsers[0]?.exe || null;
    const usePrefixedProfileIds = !options.browserExecutablePath && installedBrowsers.length > 1;
    const getBrowserUserDataRoots = () => (Array.isArray(options.browserUserDataRoots)
        ? options.browserUserDataRoots
        : [
            ...new Set([
                ...discoverBrowserUserDataDirs({ cwd }),
                ...discoverBrowserUserDataDirs({ cwd, homeDir: homedir() }),
            ]),
        ]);
    const getAvailableBrowserProfiles = () => {
        if (!allowBrowserProfiles || installedBrowsers.length === 0) return [];
        const roots = getBrowserUserDataRoots();
        const out = [];
        for (const br of installedBrowsers) {
            const profs = listExistingBrowserProfiles(br.exe, roots);
            for (const p of profs) {
                out.push({
                    ...p,
                    browser: br.key,
                    browserLabel: br.label,
                    exe: br.exe,
                    id: usePrefixedProfileIds ? `${br.key}:${p.name}` : p.name,
                });
            }
        }
        return out;
    };
    const savedConfig = loadSavedConfig(configPath);
    let config = buildConfig({}, savedConfig, options.initialConfig, options.isolatedAccount);
    const getExistingProfile = () => {
        if (installedBrowsers.length === 0) return null;
        const selected = String(config.browserProfile || '').trim();
        if (selected === 'isolated') return null;
        const profiles = getAvailableBrowserProfiles();
        if (profiles.length === 0) return null;
        if (selected) {
            const colonIdx = selected.indexOf(':');
            if (colonIdx > 0) {
                const wantBrowser = selected.slice(0, colonIdx);
                const wantName = selected.slice(colonIdx + 1);
                const exact = profiles.find((p) => p.browser === wantBrowser && p.name === wantName);
                if (exact) {
                    return { root: exact.root, name: exact.name, levelDb: exact.levelDb, exe: exact.exe, browser: exact.browser, label: exact.label, id: exact.id };
                }
                return null;
            }
            const byName = profiles.find((p) => p.name === selected);
            if (byName) {
                return { root: byName.root, name: byName.name, levelDb: byName.levelDb, exe: byName.exe, browser: byName.browser, label: byName.label, id: byName.id };
            }
            return null;
        }
        if (!options.useExistingBrowser) return null;
        const auto = profiles.find((p) => p.isLastUsed) || profiles[0];
        return auto
            ? { root: auto.root, name: auto.name, levelDb: auto.levelDb, exe: auto.exe, browser: auto.browser, label: auto.label, id: auto.id }
            : null;
    };
    const buildBrowserProfileOptions = () => {
        if (!allowBrowserProfiles) return [];
        const profiles = getAvailableBrowserProfiles();
        const items = [];
        if (options.useExistingBrowser) {
            const autoTarget = profiles.find((p) => p.isLastUsed) || profiles[0];
            items.push({
                id: '',
                label: autoTarget
                    ? `Automático (${autoTarget.label})`
                    : 'Automático (último do navegador)',
            });
            items.push({
                id: 'isolated',
                label: 'Perfil isolado do bot',
            });
        } else {
            items.push({
                id: '',
                label: 'Perfil isolado desta conta',
            });
        }
        for (const p of profiles) {
            items.push({
                id: p.id,
                label: p.label,
            });
        }
        return items;
    };
    let session = null;
    let status = 'disconnected';
    let connectionMode = 'headless';
    let lastError = null;
    let economyActive = false;
    let loginInProgress = null;
    let loginAbortCtrl = null;
    let activeBridge = null;
    let huntGuideTimer = null;
    let huntGuideRequest = null;
    let huntGuideStatus = null;
    let huntGuideSwapAt = null;
    let huntGuideTarget = null;
    let huntGuideRanking = null; // { metric, ranked, fetchedAt, pokemonId }
    let objectiveTargetSlug = null;
    let objectiveRotateFromSlug = null;
    let objectiveLastDecision = null;
    let objectiveLastLogKey = '';
    let objectiveStaySlug = null;
    let objectiveStaySinceAt = 0;
    const objectiveStaleUntilBySlug = new Map();
    const optimisticPokedexKeys = new Set();
    const createTopCatchState = () => ({
        week: null,
        ini: false,
        count: 0,
        lastMinute: 0,
        paidMilestone: 0,
        keys: new Set(),
        loaded: false,
        lastRequestedAt: 0,
        previousWeek: null,
        rankingRows: null,
        rankingFetchedAt: 0,
        rankingRequestedAt: 0,
    });
    let topCatchState = createTopCatchState();
    let lastWelcome = null;
    let bridgeAbortCtrl = null;
    let silentSyncAttempted = false;
    let autoLoginTriggered = false;
    let disposed = false;

    let serverClockOffsetMs = 0;
    let centroLivreEm = 0;
    let trocaHuntLivreEm = 0;
    let ondaSeq = 0;
    let combateOndaSeq = 0;
    let fieldInitialized = false;
    let lastCampoAt = 0;
    let lastCampoHealAt = 0;
    let battleKillsWithoutCampo = 0;
    let campoFeedDegraded = false;
    let pendingHuntSlug = null;
    let huntFlushTimer = null;
    let campoDrainTimer = null;

    const voteFetch = typeof options.voteFetch === 'function'
        ? options.voteFetch
        : (!options.disableVotePolling && !options.wsFactory ? fetch : null);
    let voteState = {
        checkedAt: 0,
        ativo: false,
        esperaMs: 0,
        availableAt: 0,
        votos: 0,
        noPar: 0,
        votosPorDiamante: 2,
        porPar: 1,
        diamantes: 0,
        url: '',
        identificador: '',
        error: null,
        notifiedAvailableKey: '',
    };
    let voteTimer = null;
    let voteRecheckTimer = null;
    let voteAbortCtrl = null;
    let voteInFlightPromise = null;

    let merger = createStateMerger();
    const field = createFieldTracker();
    const catalog = createEmptyCatalog();
    let tracker = { lastHuntSlug: config.targetHuntSlug || null };
    const trainerTracker = {};
    const sniperTracker = {};
    let marketSummary = {};
    let marketMedias = null;
    const sniperPokemonStats = {};
    const sniperRecentHits = [];
    let sniperTimer = null;
    const sniperRetentionTimers = new Map();
    // Compra no Mercado da Comunidade entra num sorteio: só conta como comprada quando o resultado chega.
    const sniperPending = new Map();
    sniperTracker.pendingListings = new Set();
    let sniperPendingTimer = null;
    const SNIPER_PENDING_MS = 90_000;
    const sniperHitLabel = (p) => (p.kind === 'pokemon'
        ? `${p.shiny ? '★ ' : ''}${p.itemName || 'Pokémon'} Nv ${p.level || 1}`
        : `${p.itemName || `Item #${p.itemId}`} x${p.qty}`);
    const sniperPriceLabel = (p) => `${Number(p.price || 0).toLocaleString('pt-BR')} ${p.currency === 'orb' ? 'gemas' : 'gold'}`;
    const sniperPendingQtyByRule = () => {
        const out = new Map();
        for (const { purchase } of sniperPending.values()) {
            out.set(purchase.ruleId, (out.get(purchase.ruleId) || 0) + Number(purchase.qty || 0));
        }
        return out;
    };
    const sniperRulesWithPending = () => {
        const pend = sniperPendingQtyByRule();
        return (config.sniperRules || []).map((r) => {
            const q = pend.get(r.id) || 0;
            return q > 0 ? { ...r, boughtQty: Number(r.boughtQty || 0) + q } : r;
        });
    };
    const settleSniperPending = (key, outcome, ev = {}) => {
        const entry = sniperPending.get(key);
        if (!entry) return false;
        sniperPending.delete(key);
        sniperTracker.pendingListings.delete(key);
        const p = entry.purchase;
        p.pending = false;
        const label = sniperHitLabel(p);
        if (outcome === 'won') {
            const wonQty = Math.max(1, Math.floor(Number(ev.qtd) || 0) || Number(p.qty || 1));
            p.qty = wonQty;
            p.bought = true;
            p.status = 'comprado';
            const updatedRules = (config.sniperRules || []).map((r) => (
                r.id === p.ruleId ? { ...r, boughtQty: Number(r.boughtQty || 0) + wonQty } : r
            ));
            config = normalizeConfigPatch(config, { sniperRules: updatedRules });
            persistConfig(configPath, config);
            pushLog('reward', `Sniper comprou: ${sniperHitLabel(p)} por ${sniperPriceLabel(p)} (${p.seller}).`);
        } else if (outcome === 'lost') {
            p.status = 'perdeu';
            pushLog('warn', `Sniper perdeu o sorteio de ${label} (${sniperPriceLabel(p)}). Nada foi cobrado.`);
        } else if (outcome === 'failed') {
            p.status = 'falhou';
            const motivo = ev.msg || ev.chave || '';
            pushLog('warn', `Sniper não conseguiu comprar ${label}${motivo ? `: ${motivo}` : ''}.`);
        } else {
            p.status = 'sem-resposta';
            pushLog('info', `Sniper ficou sem o resultado da compra de ${label}. Não contei como comprado.`);
        }
        return true;
    };
    const sweepSniperPending = () => {
        const now = getSyncedNowMs();
        for (const [key, entry] of [...sniperPending]) {
            if (now >= entry.expireAt) settleSniperPending(key, 'timeout');
        }
        if (!sniperPending.size && sniperPendingTimer) {
            clearInterval(sniperPendingTimer);
            sniperPendingTimer = null;
        }
    };
    const registerSniperPending = (purchases) => {
        const now = getSyncedNowMs();
        for (const purchase of purchases) {
            const key = String(purchase.listingId);
            sniperPending.set(key, { purchase, expireAt: now + SNIPER_PENDING_MS, announced: false });
            sniperTracker.pendingListings.add(key);
        }
        if (sniperPending.size && !sniperPendingTimer) {
            sniperPendingTimer = setInterval(sweepSniperPending, 5_000);
            sniperPendingTimer.unref?.();
        }
    };
    const marketMoney = (valor, moeda) => `${Number(valor || 0).toLocaleString('pt-BR')} ${moeda === 'orb' ? 'gemas' : 'gold'}`;
    const handleSniperMarketEvent = (kind, e) => {
        if (kind === 'marketVendido') {
            pushLog('reward', `Mercado: vendeu ${e.descricao || 'um anúncio'} por ${marketMoney(e.valor, e.moeda)}.`);
            return;
        }
        const key = e?.id != null ? String(e.id) : '';
        if (!key || !sniperPending.has(key)) {
            if (kind === 'marketComprado' && e?.descricao) pushLog('reward', `Mercado: comprou ${e.descricao}.`);
            return;
        }
        if (kind === 'marketComprado') {
            settleSniperPending(key, 'won', e);
            return;
        }
        if (e.fase === 'entrou') {
            const entry = sniperPending.get(key);
            entry.purchase.status = 'sorteio';
            const ate = Number(e.sorteioAte || e.fechaEm || 0);
            if (ate > 0) entry.expireAt = Math.max(entry.expireAt, ate + 30_000);
            if (!entry.announced) {
                entry.announced = true;
                pushLog('info', `Sniper entrou no sorteio de ${sniperHitLabel(entry.purchase)}. Aguardando o resultado.`);
            }
            return;
        }
        if (e.fase === 'fim') settleSniperPending(key, e.ok ? 'won' : (e.perdeu ? 'lost' : 'failed'), e);
    };
    const sendSniperActions = (actions) => sendActions(actions.map((a) => (
        a.t === 'market.comprar' ? { ...a, sorteioUi: 1 } : a
    )));

    // ===== Consultor de economia: base local de vendas + catálogo do jogo =====
    const ADVISOR_SYNC_MS = 20 * 60_000;
    const ADVISOR_MAX_PAGES = 12;
    const ADVISOR_SPECIES_TTL_MS = 24 * 3_600_000;
    const marketBase = options.marketBase || getSharedMarketBase({ cwd, nowFn });
    let marketBaseLoaded = false;
    let advisorSpecies = null;
    let advisorItemNames = {};
    let advisorSpeciesLoading = false;
    let advisorTimer = null;
    let advisorSync = null; // { queue: [{tipo}], tipo, pagina, seq, waitTimer }
    let advisorSeq = 0;
    let advisorCache = { at: 0, key: '', value: null };
    const advisorOn = () => config.advisorEnabled !== false && !config.economyPingOnly;
    const ensureMarketBase = () => {
        if (marketBaseLoaded) return;
        marketBaseLoaded = true;
        try { marketBase.load(); } catch { /* base corrompida: começa vazia */ }
    };
    const annotateSaleNotas = () => {
        if (!advisorSpecies) return;
        marketBase.annotateNotas((sale) => {
            const esp = advisorSpecies.byId.get(sale.sp);
            if (!esp || sale.iv == null) return null;
            return notaOf({ iv: sale.iv, quality: sale.q, potencia: sale.pot, shiny: Boolean(sale.sh), refino: sale.rf }, esp, advisorSpecies.ancestorsOf(sale.sp));
        });
    };
    const applySpeciesCatalog = (cat) => {
        if (!cat?.creatures?.length) return false;
        advisorSpecies = buildSpeciesIndex(cat.creatures);
        advisorItemNames = cat.itemNames || {};
        annotateSaleNotas();
        return true;
    };
    const ensureSpeciesCatalog = async () => {
        if (advisorSpeciesLoading) return;
        const cached = marketBase.readSpeciesCache();
        if (!advisorSpecies && cached) applySpeciesCatalog(cached);
        if (cached && cached.v === SPECIES_CACHE_VERSION && nowFn() - (Number(cached.em) || 0) < ADVISOR_SPECIES_TTL_MS) return;
        const fetchImpl = options.fetch || globalThis.fetch;
        if (typeof fetchImpl !== 'function') return;
        advisorSpeciesLoading = true;
        try {
            const cat = await fetchSpeciesCatalog((url) => fetchImpl(url, { signal: AbortSignal.timeout(20_000) }));
            if (cat.creatures.length > 100) {
                marketBase.writeSpeciesCache(cat);
                applySpeciesCatalog(cat);
            }
        } catch {
            // tenta de novo no próximo ciclo
        } finally {
            advisorSpeciesLoading = false;
        }
    };
    const finishAdvisorSync = () => {
        if (advisorSync?.waitTimer) clearTimeout(advisorSync.waitTimer);
        advisorSync = null;
        marketBase.markSynced(cwd);
        marketBase.save();
    };
    const requestAdvisorPage = () => {
        if (!advisorSync || disposed) return;
        const online = status === 'connected' || status === 'bridge';
        if (!online) { finishAdvisorSync(); return; }
        if (advisorSync.waitTimer) clearTimeout(advisorSync.waitTimer);
        advisorSync.seq = ++advisorSeq;
        sendFrame({ t: 'market.historicoGlobal', pagina: advisorSync.pagina, seq: advisorSync.seq, tipo: advisorSync.tipo });
        // Sem resposta em 15s: passa para o próximo tipo.
        advisorSync.waitTimer = setTimeout(() => advanceAdvisorSync(false), 15_000);
        advisorSync.waitTimer.unref?.();
    };
    const advanceAdvisorSync = (nextPage) => {
        if (!advisorSync) return;
        if (nextPage && advisorSync.pagina + 1 < ADVISOR_MAX_PAGES) {
            advisorSync.pagina += 1;
        } else {
            const next = advisorSync.queue.shift();
            if (!next) { finishAdvisorSync(); return; }
            advisorSync.tipo = next;
            advisorSync.pagina = 0;
        }
        const t = setTimeout(requestAdvisorPage, 1_500);
        t.unref?.();
        advisorSync.waitTimer = t;
    };
    const startAdvisorSync = ({ force = false } = {}) => {
        if (disposed || advisorSync || !advisorOn()) return false;
        if (!(status === 'connected' || status === 'bridge')) return false;
        ensureMarketBase();
        if (!force && marketBase.syncedRecently(ADVISOR_SYNC_MS)) return false;
        marketBase.markSynced(cwd);
        marketBase.save();
        sendFrame({ t: 'market.medias' });
        advisorSync = { queue: ['item'], tipo: 'pokemon', pagina: 0, seq: 0, waitTimer: null };
        requestAdvisorPage();
        return true;
    };
    const handleAdvisorMarket = (m) => {
        if (m.aba === 'medias') {
            ensureMarketBase();
            marketBase.setMedias(m.medias || {}, m.dias);
            marketBase.save();
            return true;
        }
        if (m.aba !== 'historicoGlobal') return false;
        ensureMarketBase();
        // Também guarda o que a pessoa abre no jogo embutido: venda vista é dado a mais na base.
        const added = marketBase.ingestHistory(m.linhas || []);
        if (added) annotateSaleNotas();
        if (!advisorSync || (m.seq != null && Number(m.seq) !== advisorSync.seq)) {
            if (added) marketBase.save();
            return true;
        }
        // Página só com vendas já guardadas: o resto também já está na base.
        advanceAdvisorSync(Boolean(m.temMais) && added > 0);
        return true;
    };
    const scheduleAdvisor = () => {
        if (advisorTimer || options.disableAdvisor) return;
        const tick = () => {
            advisorTimer = setTimeout(tick, 60_000);
            advisorTimer.unref?.();
            if (disposed || !advisorOn()) return;
            ensureMarketBase();
            void ensureSpeciesCatalog();
            startAdvisorSync();
        };
        advisorTimer = setTimeout(tick, 20_000);
        advisorTimer.unref?.();
        if (!dropTimer) {
            dropTimer = setInterval(() => { try { runDropRouting(); } catch (e) { pushLog('error', `Destino dos drops: ${e?.message || e}`); } }, DROP_TICK_MS);
            dropTimer.unref?.();
        }
    };
    const clearAdvisorTimers = () => {
        if (advisorTimer) { clearTimeout(advisorTimer); advisorTimer = null; }
        if (dropTimer) { clearInterval(dropTimer); dropTimer = null; }
        if (dropPumpTimer) { clearTimeout(dropPumpTimer); dropPumpTimer = null; }
        dropQueue = [];
        if (advisorSync?.waitTimer) clearTimeout(advisorSync.waitTimer);
        advisorSync = null;
    };
    const stonePriceOf = (itemId) => {
        const v = Number(marketBase.getMedias()?.itens?.[itemId]?.gold?.media);
        return Number.isFinite(v) && v > 0 ? v : null;
    };
    const planCache = new Map();
    const planOf = (pk) => {
        if (!advisorSpecies || !pk) return null;
        const k = `${pk.id}|${pk.speciesId}|${pk.level}|${pk.quality}|${pk.potencia}|${advisorSpecies.size}|${marketBase.version}`;
        if (planCache.has(k)) return planCache.get(k);
        if (planCache.size > 4000) planCache.clear();
        const plan = planFinalEvolution(pk, advisorSpecies, { pedras: lastWelcome?.pedrasEvolucao || {}, stonePrice: stonePriceOf });
        planCache.set(k, plan);
        return plan;
    };
    const advisorNetOf = () => {
        const rules = marketRulesOf(lastWelcome);
        const dias = Math.max(rules.diasMin, Math.min(rules.diasMax, Number(config.dropListDays) || 1));
        return (price) => netOfListing(price, dias, rules);
    };
    const advisorBusyIds = (state) => {
        const busyIds = new Set();
        if (state?.activeId != null) busyIds.add(String(state.activeId));
        for (const pk of state?.pokemons || []) if (Number(pk?.heldItemId) === XP_SHARE_HELD_ID) busyIds.add(String(pk.id));
        for (const q of config.trainerQueue || []) if (q?.pokemonId != null) busyIds.add(String(q.pokemonId));
        for (const casa of state?.casa?.lista || []) for (const id of casa?.postos || []) if (id != null) busyIds.add(String(id));
        return busyIds;
    };

    // ===== Destino dos drops: decide o que fazer com cada Pokémon novo que cai no depot =====
    const DROP_TICK_MS = 15_000;
    const DROP_STEP_MS = 2_500;
    let dropTimer = null;
    let dropPumpTimer = null;
    let dropBaseline = null; // maior id já visto quando o destino começou a olhar
    const dropDecisions = new Map();
    let dropRecent = [];
    let dropQueue = [];
    let dropListTimes = [];
    const dropOn = () => advisorOn() && config.dropRouteEnabled === true;
    const DROP_VERB = { guardar: 'guardou na coleção', anunciar: 'anunciou no mercado', vender: 'vendeu no depot' };
    const pumpDropQueue = () => {
        if (dropPumpTimer || !dropQueue.length || disposed) return;
        const { entry, d } = dropQueue.shift();
        const st = merger.getState();
        const still = (st?.pokemons || []).find((pk) => String(pk?.id) === entry.id);
        const canRun = still && getPokemonLocation(still, st) === 'depot' && dropOn() && config.dropRouteMode === 'auto';
        const frame = canRun ? frameForDecision(entry.id, d) : null;
        if (frame && sendFrame(frame)) {
            entry.done = true;
            if (d.action === 'anunciar') dropListTimes.push(nowFn());
            pushLog('info', `Destino dos drops: ${DROP_VERB[d.action]} ${entry.name} Nv ${entry.level}. ${d.reason}`);
        } else {
            entry.skipped = true;
        }
        dropPumpTimer = setTimeout(() => { dropPumpTimer = null; pumpDropQueue(); }, DROP_STEP_MS);
        dropPumpTimer.unref?.();
    };
    const runDropRouting = () => {
        if (!dropOn()) { dropBaseline = null; return; }
        if (!(status === 'connected' || status === 'bridge') || !advisorSpecies) return;
        const state = merger.getState();
        const pokes = Array.isArray(state?.pokemons) ? state.pokemons : [];
        if (!pokes.length) return;
        const maxId = pokes.reduce((m, pk) => Math.max(m, Number(pk?.id) || 0), 0);
        // Só o que dropar depois de ligar: nada do que já estava na conta é mexido.
        if (dropBaseline == null) { dropBaseline = maxId; return; }
        const busy = advisorBusyIds(state);
        const fresh = pokes.filter((pk) => Number(pk?.id) > dropBaseline && !dropDecisions.has(String(pk.id))
            && !pk.starter && !busy.has(String(pk.id)) && getPokemonLocation(pk, state) === 'depot');
        if (!fresh.length) return;
        ensureMarketBase();
        const rows = advisePokemons({
            pokemons: fresh,
            locationOf: (pk) => getPokemonLocation(pk, state),
            species: advisorSpecies,
            salesBySpecies: marketBase.salesBySpecies(),
            sacrifice: { pts: 1000 },
            nowMs: getSyncedNowMs(),
            planOf,
            stonePriceOf,
            keepNota: config.dropKeepNota,
            keepFinalMult: config.dropKeepFinalMult,
            netOf: advisorNetOf(),
        });
        const rules = marketRulesOf(lastWelcome);
        const auto = config.dropRouteMode === 'auto';
        const now = nowFn();
        dropListTimes = dropListTimes.filter((t) => now - t < 3_600_000);
        let gold = Number(state?.gold || 0);
        for (const row of rows) {
            let d = decideDrop(row, config, rules);
            if (auto && d.action === 'anunciar') {
                const semVaga = dropListTimes.length + dropQueue.filter((q) => q.d.action === 'anunciar').length >= config.dropMaxListingsHour;
                const semGold = gold - rules.diaria * d.dias < (Number(config.sniperMinGoldReserve) || 0);
                if (semVaga || semGold) {
                    const resto = decideDrop(row, { ...config, dropSellMarket: false }, rules);
                    d = { ...resto, reason: `${semVaga ? 'Limite de anúncios por hora' : 'Sem gold para a diária do anúncio'}. ${resto.reason}` };
                } else {
                    gold -= rules.diaria * d.dias;
                }
            }
            const entry = {
                id: String(row.id), name: row.name, level: row.level, shiny: row.shiny, action: d.action, reason: d.reason,
                price: d.price ?? null, dias: d.dias ?? null, potential: row.potential, ts: now, auto, done: false,
            };
            dropDecisions.set(entry.id, entry);
            dropRecent.unshift(entry);
            if (auto && d.action !== 'deixar') dropQueue.push({ entry, d });
        }
        dropRecent = dropRecent.slice(0, 30);
        if (dropDecisions.size > 5000) for (const k of [...dropDecisions.keys()].slice(0, 2500)) dropDecisions.delete(k);
        pumpDropQueue();
    };
    const dropSnapshot = (state) => {
        const rules = marketRulesOf(lastWelcome);
        return {
            enabled: dropOn(),
            mode: config.dropRouteMode,
            watching: dropBaseline != null,
            gameAutoSell: state?.automation?.autoVendaDepot === true,
            diaria: rules.diaria,
            taxaPct: Math.round(rules.taxaGold * 100),
            queued: dropQueue.length,
            recent: dropRecent.slice(0, 15),
        };
    };

    // ===== Ficha do shiny: o anúncio do servidor traz só espécie e nível; o resto sai do catálogo,
    // da base de mercado e, quando o shiny é desta conta, do Pokémon de verdade.
    const RARIDADE_PT = { COMMON: 'Comum', UNCOMMON: 'Incomum', RARE: 'Raro', EPIC: 'Épico', LEGENDARY: 'Lendário', MYTHIC: 'Mítico' };
    const fmtBR = (n) => Number(n || 0).toLocaleString('pt-BR');
    const inspectShiny = (entry = {}) => {
        if (!advisorSpecies) {
            try {
                const cached = marketBase.readSpeciesCache();
                if (cached) applySpeciesCatalog(cached);
            } catch { /* sem catálogo, segue com o que tiver */ }
        }
        try { ensureMarketBase(); } catch { /* base vazia */ }
        const spId = Number(entry.speciesId) || 0;
        const state = merger.getState();
        const nick = String(state?.nick || session?.nick || '').toLowerCase();
        const mine = Boolean(nick && String(entry.trainer || '').toLowerCase() === nick);
        let pk = null;
        if (mine) {
            const cands = (state?.pokemons || []).filter((p) => p?.shiny && Number(p.speciesId) === spId);
            const evolved = cands.length ? cands : (state?.pokemons || []).filter((p) => p?.shiny
                && Number(p.especieOrigem) === spId);
            pk = evolved.sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
        }
        const esp = advisorSpecies?.byId?.get(Number(pk?.speciesId) || spId) || null;
        const level = Number(pk?.level ?? pk?.nivel ?? entry.level) || 1;
        const rows = [];
        let nota = null;
        if (pk) {
            nota = notaOf(pk, esp, advisorSpecies?.ancestorsOf?.(Number(pk.speciesId)) || []);
            if (nota != null) rows.push(['Nota', `${nota.toFixed(1)} / 10`]);
            const ivs = pk.ivs && typeof pk.ivs === 'object' ? Object.values(pk.ivs).map(Number).filter(Number.isFinite) : [];
            const ivTotal = pk.iv ?? pk.ivTotal ?? (ivs.length ? ivs.reduce((s, v) => s + v, 0) : null);
            if (ivTotal != null) rows.push(['IV', ivs.length ? `${fmtBR(ivTotal)} (${ivs.join(' / ')})` : fmtBR(ivTotal)]);
            const q = pk.quality ?? pk.qualidade;
            if (q != null) rows.push(['Qualidade', String(q)]);
            if (pk.potencia != null) rows.push(['Potência', `${pk.potencia} / 5`]);
            const nat = pk.natureza ?? pk.nature;
            if (nat) rows.push(['Natureza', String(nat)]);
            if (Number(pk.speciesId) !== spId && esp?.name) rows.push(['Hoje', `${esp.name} Nv ${fmtBR(level)}`]);
            try {
                const loc = getPokemonLocation(pk, state);
                rows.push(['Onde está', loc === 'equipe' ? 'Equipe' : (loc === 'colecao' ? 'Coleção' : 'Depot')]);
            } catch { /* sem local */ }
        }
        if (esp) {
            const rar = isLegendary(esp, esp.pokeId) && !['LEGENDARY', 'MYTHIC'].includes(esp.rarity) ? 'Lendário' : (RARIDADE_PT[esp.rarity] || esp.rarity);
            if (rar) rows.push(['Raridade', rar]);
            const tipos = [esp.type1, esp.type2].filter(Boolean).join(' / ');
            if (tipos) rows.push(['Tipo', tipos]);
            const bst = ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed'].reduce((s, k) => s + (Number(esp[k]) || 0), 0);
            if (bst) rows.push(['Status base', fmtBR(bst)]);
        }
        const base = pk || { speciesId: spId, level, shiny: true };
        const plan = esp ? planOf({ ...base, id: base.id ?? `s${spId}`, speciesId: esp.pokeId, level, shiny: true }) : null;
        const best = plan?.best;
        if (best && best.speciesId !== esp?.pokeId) {
            rows.push(['Forma final', `${best.name} Nv ${fmtBR(best.level)}${best.nota != null ? ` · nota ${best.nota.toFixed(1)}` : ''}`]);
        }
        const market = estimatePokemonPrice({ speciesId: esp?.pokeId || spId, level, shiny: true }, nota, marketBase.salesBySpecies(), { nowMs: getSyncedNowMs() });
        if (market) {
            rows.push(['Mercado', `~${fmtBR(market.price)} ${market.currency === 'orb' ? 'gemas' : 'gold'} (${market.n} venda${market.n > 1 ? 's' : ''}, confiança ${market.confidence})`]);
        } else {
            rows.push(['Mercado', 'Sem vendas de shiny desta espécie nos últimos 30 dias']);
        }
        const hint = pk ? '' : (mine
            ? 'Não achei este shiny entre os Pokémon da conta (pode ter sido vendido ou ainda não sincronizou).'
            : 'IV e nota só aparecem nos shinies das suas contas: o servidor anuncia só a espécie e o nível.');
        return { mine, found: Boolean(pk), rows, hint };
    };

    /** Resumo leve do consultor para o snapshot de 1,25 s; as listas saem só por getAdvisor(). */
    const buildAdvisorLite = (state) => {
        if (!advisorOn()) return { enabled: false, drops: dropSnapshot(state) };
        ensureMarketBase();
        return {
            enabled: true,
            lite: true,
            base: marketBase.stats(),
            speciesReady: Boolean(advisorSpecies),
            syncing: Boolean(advisorSync),
            sacrificePts: Number(state?.automation?.sacrificio?.pts || 0),
            drops: dropSnapshot(state),
        };
    };
    const buildAdvisorSnapshot = (state) => {
        if (!advisorOn()) return { enabled: false };
        ensureMarketBase();
        const pokes = state?.pokemons || [];
        const key = `${marketBase.version}|${advisorSpecies?.size || 0}|${pokes.length}|${pokes.map((p) => `${p.id}:${p.level}:${p.slot ?? ''}`).join(',')}|${JSON.stringify(state?.items || {})}|${state?.automation?.sacrificio?.pts || 0}|${config.dropKeepNota}|${config.dropKeepFinalMult}|${config.dropListDays}`;
        const now = nowFn();
        if (advisorCache.value && advisorCache.key === key && now - advisorCache.at < 60_000) return { ...advisorCache.value, drops: dropSnapshot(state) };
        const busyIds = advisorBusyIds(state);
        const medias = marketBase.getMedias();
        const names = { ...advisorItemNames, ...(catalog.itemNames || {}) };
        for (const it of catalog.marketItems || []) if (it?.id && it.name) names[it.id] = it.name;
        const keepIds = new Set(Object.values(ITEM_IDS).map(Number));
        const value = {
            enabled: true,
            base: marketBase.stats(),
            speciesReady: Boolean(advisorSpecies),
            syncing: Boolean(advisorSync),
            sacrificePts: Number(state?.automation?.sacrificio?.pts || 0),
            items: adviseItems({ items: state?.items || {}, medias: medias?.itens || {}, names, keepIds }).slice(0, 40),
            pokemons: advisePokemons({
                pokemons: pokes,
                locationOf: (pk) => getPokemonLocation(pk, state),
                species: advisorSpecies,
                salesBySpecies: marketBase.salesBySpecies(),
                sacrifice: state?.automation?.sacrificio || {},
                busyIds,
                nowMs: getSyncedNowMs(),
                planOf,
                stonePriceOf,
                keepNota: config.dropKeepNota,
                keepFinalMult: config.dropKeepFinalMult,
                netOf: advisorNetOf(),
            }).slice(0, 120),
        };
        advisorCache = { at: now, key, value };
        return { ...value, drops: dropSnapshot(state) };
    };

    const clearSniperTimers = () => {
        if (sniperTimer) {
            clearInterval(sniperTimer);
            sniperTimer = null;
        }
        for (const t of sniperRetentionTimers.values()) clearTimeout(t);
        sniperRetentionTimers.clear();
        if (sniperPendingTimer) {
            clearInterval(sniperPendingTimer);
            sniperPendingTimer = null;
        }
    };
    const requestSniperSummary = ({ force = false } = {}) => {
        const isOnline = status === 'connected' || status === 'bridge';
        if (!isOnline || config.economyPingOnly) return false;
        const activeRules = (config.sniperRules || []).filter(
            (r) => r && r.enabled !== false && (Number(r.maxQty || 0) === 0 || Number(r.boughtQty || 0) < Number(r.maxQty))
        );
        const hasItemRule = activeRules.some((r) => r.kind !== 'pokemon');
        const hasPokemonRule = activeRules.some((r) => r.kind === 'pokemon');
        if (!force && (!config.sniperEnabled || (!hasItemRule && !hasPokemonRule))) return false;
        const now = nowFn();
        const intervalMs = Math.max(8_000, Number(config.sniperIntervalSec || 30) * 1000);
        let sentAny = false;
        if (hasItemRule || (force && !hasPokemonRule)) {
            if (force || now - (sniperTracker.lastSummaryReqAt || 0) >= intervalMs) {
                sniperTracker.lastSummaryReqAt = now;
                if (sendFrame({ t: 'market.itens', elementos: [], categoria: '' })) sentAny = true;
            }
        }
        if (hasPokemonRule) {
            const pokeQueries = buildSniperPokemonQueries({
                rules: config.sniperRules || [],
                nowMs: now,
                tracker: sniperTracker,
                intervalMs,
                force,
            });
            if (pokeQueries.length && sendActions(pokeQueries) > 0) sentAny = true;
        }
        return sentAny;
    };
    const scheduleSniperTimer = () => {
        clearSniperTimers();
        if (disposed) return;
        const stepMs = Math.max(10_000, Math.min(300_000, Number(config.sniperIntervalSec || 30) * 1000));
        sniperTimer = setInterval(() => {
            if (!disposed) requestSniperSummary({ force: false });
        }, stepMs);
        sniperTimer.unref?.();
        requestSniperSummary({ force: true });
    };

    const getSyncedNowMs = () => nowFn() + serverClockOffsetMs;
    const syncServerClock = (serverTs) => {
        const ts = Number(serverTs);
        if (Number.isFinite(ts) && ts > 1_000_000_000_000) {
            serverClockOffsetMs = ts - nowFn();
        }
    };
    const clearHuntFlushTimer = () => {
        if (huntFlushTimer) {
            clearTimeout(huntFlushTimer);
            huntFlushTimer = null;
        }
    };
    const clearCampoDrainTimer = () => {
        if (campoDrainTimer) {
            clearTimeout(campoDrainTimer);
            campoDrainTimer = null;
        }
    };
    const hasAnyBallStock = (state = merger.getState()) => {
        const b = state?.balls;
        if (!b) return false;
        return [1, 2, 3, 4, 5].some((id) => Number(b[id] ?? b[String(id)] ?? 0) > 0);
    };
    const hasFieldCatchPriority = (state = merger.getState()) => {
        if (pendingShinies.size > 0) return true;
        if (field.getMobs().some((m) => isWildCampoMob(m) && m.shiny)) return true;
        if (config.caidosEnabled !== false && hasAnyBallStock(state)) {
            return field.getFallenCorpses(getSyncedNowMs(), config.prioritizeExpiring !== false).length > 0;
        }
        return false;
    };
    const hasLiveMobInField = () => field.getMobs().some((mob) => !mob.morto && Number(mob.hp ?? 0) > 0);
    const getCombatLockMs = (state = merger.getState()) => {
        if (!state || state.noCentro || (!state.huntSlug && !state.safari?.dentro) || state.casa?.dentro || state.boss?.arena) {
            return 0;
        }
        if (!economyActive && fieldInitialized && (!hasLiveMobInField() || combateOndaSeq < ondaSeq)) {
            return 0;
        }
        return Math.max(0, Math.round(centroLivreEm - getSyncedNowMs()));
    };
    const getHuntSwapLockMs = () => Math.max(0, Math.round(trocaHuntLivreEm - getSyncedNowMs()));
    const rearmCombatLock = () => {
        const st = merger.getState();
        if (!st?.huntSlug || st.noCentro) return;
        combateOndaSeq = ondaSeq;
        centroLivreEm = Math.max(centroLivreEm, getSyncedNowMs() + 3000);
    };
    const syncCombatTimersFromState = (rawEstado, mergedState) => {
        if (rawEstado?.servidorAgora != null) {
            syncServerClock(rawEstado.servidorAgora);
        }
        if (rawEstado?.trocaHuntLivreEm != null) {
            trocaHuntLivreEm = Number(rawEstado.trocaHuntLivreEm) || 0;
        }
        const inHunt = Boolean(
            (mergedState?.huntSlug || mergedState?.safari?.dentro) &&
            !mergedState?.noCentro &&
            !mergedState?.casa?.dentro &&
            !mergedState?.boss?.arena
        );
        if (inHunt) {
            if (rawEstado?.ondaSeq != null) ondaSeq = Number(rawEstado.ondaSeq) || 0;
            if (rawEstado?.combateOndaSeq != null) combateOndaSeq = Number(rawEstado.combateOndaSeq) || 0;
            if (rawEstado?.centroLivreEm != null) {
                const carimbo = Number(rawEstado.centroLivreEm) || 0;
                const refNow = Number(rawEstado?.servidorAgora) || getSyncedNowMs();
                const livreAgora = economyActive && carimbo > 0 && carimbo <= refNow;
                centroLivreEm = livreAgora ? carimbo : Math.max(centroLivreEm, carimbo);
            }
        } else {
            centroLivreEm = 0;
            ondaSeq = 0;
            combateOndaSeq = 0;
        }
    };

    const createFreshStats = (startTs = null) => ({
        startedAt: startTs,
        attacks: 0,
        heals: 0,
        revivesUsed: 0,
        playerDeaths: 0,
        kills: 0,
        xpGained: 0,
        xpTrainerGained: 0,
        goldGained: 0,
        spentGold: 0,
        ballsThrown: 0,
        captures: 0,
        shiniesSeen: 0,
        shiniesCaptured: 0,
        shiniesMissed: 0,
        dropsTotal: 0,
        rareDropsCount: 0,
        killDeltaSumMs: 0,
        killDeltaCount: 0,
        lastKillAt: 0,
        pongs: 0,
    });
    let stats = createFreshStats(null);
    const dropCounts = new Map();
    const recentDrops = [];
    const recentRareDrops = [];
    let nextDropId = 1;
    const seenShinySlots = new Set();
    // Shiny visto e nao capturado: cada shiny vivo no campo fica pendente por slot.
    // Quando some do campo (fugiu, corpo expirou, bola falhou, troca de hunt) e nenhuma
    // captura shiny correspondente chega dentro da carencia, vira um evento de "shiny perdido".
    const SHINY_MISS_GRACE_MS = 12_000;
    const pendingShinies = new Map();
    const missedShinies = [];
    let nextMissedShinyId = 1;

    const recordSessionDrop = (rawDrop, { forceRare = false } = {}) => {
        if (!rawDrop || typeof rawDrop !== 'object') return;
        const rawId = rawDrop.itemId ?? rawDrop.id ?? null;
        const itemId = rawId != null && Number.isFinite(Number(rawId)) ? Number(rawId) : null;
        const rawName = String(rawDrop.nome ?? rawDrop.name ?? (itemId != null ? catalog.itemNames?.[itemId] : '') ?? '').trim();
        const meta = (itemId != null ? SESSION_DROP_BY_ID.get(itemId) : null) ||
            (rawName ? SESSION_DROP_BY_NAME.get(rawName.toLowerCase()) : null) ||
            null;
        const name = meta?.name || rawName || (itemId != null ? `Item #${itemId}` : '');
        if (!name) return;
        const qty = Math.max(1, Math.floor(Number(rawDrop.qtd ?? rawDrop.qty ?? 1) || 1));
        const key = meta?.key || (itemId != null ? `id:${itemId}` : `name:${name.toLowerCase()}`);
        const category = classifyDropCategory(meta, name);
        const isRare = Boolean(
            forceRare ||
            meta?.rare ||
            (category !== 'stone' && /\b(fragment|token|ticket|tm\b|bone|osso|shiny|mega|golden|ovo|egg|bike|bicicleta)\b/i.test(name))
        );
        const ts = nowFn();
        const prev = dropCounts.get(key);
        if (prev) {
            prev.qty += qty;
            prev.lastAt = ts;
        } else {
            dropCounts.set(key, {
                key,
                itemId: meta?.id ?? itemId,
                name,
                qty,
                area: meta?.area || category,
                category,
                rare: isRare,
                lastAt: ts,
            });
        }
        stats.dropsTotal += qty;
        if (isRare) stats.rareDropsCount += qty;
        const curSlug = merger.getState()?.huntSlug || tracker.lastHuntSlug || '';
        const huntLabel = curSlug ? (catalog.huntNames?.[curSlug] || curSlug) : '';
        const dropEntry = {
            id: nextDropId++,
            ts,
            time: formatLogTime(ts),
            key,
            itemId: meta?.id ?? itemId,
            name,
            qty,
            category,
            hunt: huntLabel,
            rare: isRare,
        };
        recentDrops.unshift(dropEntry);
        if (recentDrops.length > MAX_RECENT_DROPS) recentDrops.length = MAX_RECENT_DROPS;
        if (isRare) {
            recentRareDrops.unshift(dropEntry);
            if (recentRareDrops.length > MAX_RECENT_DROPS) recentRareDrops.length = MAX_RECENT_DROPS;
        }
        const hiddenCats = Array.isArray(config.dropHideCategories) ? config.dropHideCategories : [];
        const hiddenItems = Array.isArray(config.dropHideItems) ? config.dropHideItems : [];
        if (isRare && !hiddenCats.includes(category) && !hiddenItems.includes(key)) {
            pushLog('reward', `Drop: ${name} x${qty}${huntLabel ? ` (${huntLabel})` : ''}`);
        }
    };

    const logs = [];
    let nextLogId = 1;
    let ws = null;
    let pingTimer = null;
    let watchdogTimer = null;
    let reconnectTimer = null;
    let lastMsgAt = 0;
    let backoffMs = MIN_RECONNECT_MS;

    const recentShinies = [];
    const ownShinies = []; // ficha dos shinies capturados por esta conta (para o cartao na HUD)
    let lastBallThrown = null;

    const recordMissedShiny = (pending, ts) => {
        const curSlug = merger.getState()?.huntSlug || '';
        const name = pending.name || 'Shiny';
        stats.shiniesMissed = Number(stats.shiniesMissed || 0) + 1;
        missedShinies.unshift({
            id: nextMissedShinyId++,
            ts,
            seenAt: pending.seenAt,
            name,
            level: pending.level ?? null,
            hunt: curSlug ? (catalog.huntNames?.[curSlug] || curSlug) : '',
            ballId: pending.ballId ?? null,
        });
        if (missedShinies.length > 10) missedShinies.pop();
        const ballTxt = pending.ballId ? `, escapou da ${BALL_LABELS[pending.ballId] || `bola #${pending.ballId}`}` : '';
        pushLog('shiny-miss', `Shiny visto e não capturado: ${name}${pending.level ? ` (Nv ${pending.level})` : ''}${ballTxt}`);
    };

    const isNonWildScene = (state, msg = null) => {
        const sc = field.getScene?.();
        return Boolean(
            msg?.centro ||
            msg?.casa ||
            msg?.sl != null ||
            sc?.centro ||
            sc?.casa ||
            sc?.pracaTag != null ||
            state?.noCentro === true ||
            state?.casa?.dentro === true ||
            state?.boss?.arena
        );
    };

    const resolveShinyCapture = (name, slot = null) => {
        if (slot != null && pendingShinies.has(slot)) {
            pendingShinies.delete(slot);
            return;
        }
        let best = null;
        for (const [s, p] of pendingShinies) {
            const sameName = name && p.name && p.name === name;
            const score = (sameName ? 2 : 0) + (p.goneAt ? 1 : 0);
            if (!best || score > best.score || (score === best.score && p.seenAt < best.p.seenAt)) {
                best = { slot: s, p, score };
            }
        }
        if (best) pendingShinies.delete(best.slot);
    };

    const scanShinyField = (ts) => {
        const st = merger.getState();
        const nonWild = isNonWildScene(st);
        const mysticSlot = st?.mistico?.slot ?? null;
        const bossSlot = st?.boss?.arena?.slot ?? null;
        const live = new Map();
        if (!nonWild) {
            for (const mob of field.getMobs?.() ?? []) {
                if (!isWildCampoMob(mob) || !mob.shiny) continue;
                if (mysticSlot != null && mob.slot === mysticSlot) continue;
                if (bossSlot != null && mob.slot === bossSlot) continue;
                if (mob.morto && !(Number(mob.expiraEm || 0) > ts)) continue;
                live.set(mob.slot, mob);
            }
        }
        const activeSlotKeys = new Set();
        for (const [slot, mob] of live) {
            const slotKey = `slot:${slot}`;
            activeSlotKeys.add(slotKey);
            const p = pendingShinies.get(slot);
            if (!p || (p.name && mob.nome && p.name !== mob.nome)) {
                if (p) recordMissedShiny(p, ts);
                pendingShinies.set(slot, { seenAt: ts, name: mob.nome || '', level: mob.level ?? null, goneAt: 0 });
                seenShinySlots.add(slotKey);
                stats.shiniesSeen += 1;
            } else {
                p.goneAt = 0;
                if (!p.name && mob.nome) p.name = mob.nome;
                if (p.level == null && mob.level != null) p.level = mob.level;
                if (!seenShinySlots.has(slotKey)) {
                    seenShinySlots.add(slotKey);
                    stats.shiniesSeen += 1;
                }
            }
        }
        for (const oldKey of [...seenShinySlots]) {
            if (!activeSlotKeys.has(oldKey)) seenShinySlots.delete(oldKey);
        }
        for (const [slot, p] of [...pendingShinies]) {
            if (live.has(slot)) continue;
            if (!p.goneAt) p.goneAt = ts;
            // bola jogada no shiny reinicia a carencia: a proxima tentativa ainda pode capturar
            if (ts - Math.max(p.goneAt, p.touchAt || 0) >= SHINY_MISS_GRACE_MS) {
                pendingShinies.delete(slot);
                recordMissedShiny(p, ts);
            }
        }
    };
    const pushLog = (kind, text) => {
        const ts = nowFn();
        logs.push({
            id: nextLogId++,
            ts,
            time: formatLogTime(ts),
            kind: String(kind || 'info'),
            text: String(text || ''),
        });
        if (logs.length > MAX_LOGS) {
            logs.splice(0, logs.length - MAX_LOGS);
        }
    };

    const liveBridge = createLiveRewardsBridge({
        getConfig: () => config,
        onLog: pushLog,
        liveRunner: options.liveRunner,
        liveDisposer: options.liveDisposer,
        intervalMs: options.liveIntervalMs ?? LIVE_CYCLE_INTERVAL_MS,
    });

    const clearSocketTimers = () => {
        if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
        }
        if (watchdogTimer) {
            clearInterval(watchdogTimer);
            watchdogTimer = null;
        }
    };

    const clearReconnectTimer = () => {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    };

    const clearHuntGuideTimer = () => {
        if (huntGuideTimer) {
            clearInterval(huntGuideTimer);
            huntGuideTimer = null;
        }
    };

    const ensureHuntGuideTimer = () => {
        if (huntGuideTimer) return;
        huntGuideTimer = setInterval(() => void checkHuntGuide(), options.huntGuideIntervalMs ?? 30_000);
    };

    const closeSocketQuietly = (code = 1000, reason = 'client stop') => {
        const current = ws;
        ws = null;
        clearSocketTimers();
        if (connectionMode !== 'browser-bridge') {
            clearHuntGuideTimer();
        }
        if (current && (current.readyState === 0 || current.readyState === 1)) {
            try {
                current.close(code, reason);
            } catch {
                // socket ja encerrando
            }
        }
    };

    const closeBridgeQuietly = () => {
        clearHuntGuideTimer();
        huntGuideStatus = null;
        huntGuideSwapAt = null;
        huntGuideTarget = null;
        huntGuideRequest = null;
        if (bridgeAbortCtrl) {
            try { bridgeAbortCtrl.abort(); } catch { /* ignore */ }
            bridgeAbortCtrl = null;
        }
        const currentBridge = activeBridge;
        activeBridge = null;
        if (currentBridge) {
            try { currentBridge.close(); } catch { /* ignore */ }
        }
    };

    const sendFrame = (frame) => {
        if (!frame) return false;
        if (connectionMode === 'browser-bridge' && activeBridge && activeBridge.isReady()) {
            return activeBridge.send(frame);
        }
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify(frame));
            return true;
        }
        return false;
    };

    const ensureCurrentTopCatchWeek = () => {
        const syncedNow = getSyncedNowMs();
        const currentWeek = getTopCatchWeekKey(syncedNow);
        if (topCatchState.week && (topCatchState.week < currentWeek || getTopCatchWeekWindow(topCatchState.week, syncedNow).ending)) {
            topCatchState.keys.clear();
            topCatchState.loaded = false;
            topCatchState.ini = false;
            topCatchState.count = 0;
            topCatchState.lastMinute = 0;
            topCatchState.paidMilestone = 0;
            topCatchState.lastRequestedAt = 0;
            topCatchState.rankingRequestedAt = 0;
            topCatchState.rankingRows = null;
            topCatchState.rankingFetchedAt = 0;
            topCatchState.week = currentWeek;
            objectiveRotateFromSlug = null;
            return true;
        }
        return false;
    };

    const syncTopCatchFromState = (state) => {
        const snap = state?.topCatch;
        if (!snap || typeof snap !== 'object') return;
        ensureCurrentTopCatchWeek();
        const currentWeek = getTopCatchWeekKey(getSyncedNowMs());
        const week = typeof snap.s === 'string' && snap.s ? snap.s : null;
        if (week && (week < currentWeek || (topCatchState.week && week < topCatchState.week))) return;
        if (week && topCatchState.week && week > topCatchState.week) {
            topCatchState.keys.clear();
            topCatchState.loaded = false;
            topCatchState.count = 0;
            topCatchState.lastMinute = 0;
            topCatchState.paidMilestone = 0;
            topCatchState.lastRequestedAt = 0;
            topCatchState.rankingRequestedAt = 0;
            topCatchState.rankingRows = null;
            topCatchState.rankingFetchedAt = 0;
            objectiveRotateFromSlug = null;
        }
        if (week) topCatchState.week = week;
        topCatchState.ini = Boolean(snap.ini);
        if (Number.isFinite(Number(snap.n))) topCatchState.count = Math.max(0, Number(snap.n));
        if (Number.isFinite(Number(snap.m))) topCatchState.lastMinute = Math.max(0, Number(snap.m));
        if (Number.isFinite(Number(snap.r))) topCatchState.paidMilestone = Math.max(0, Number(snap.r));
        if (topCatchState.ini && topCatchState.count === 0) {
            topCatchState.loaded = true;
        }
    };

    const requestTopCatchSync = ({ force = false, includeRanking = true } = {}) => {
        const isOnline = status === 'connected' || status === 'bridge';
        if (!isOnline || config.economyPingOnly) return false;
        ensureCurrentTopCatchWeek();
        const state = merger.getState();
        if (!force && !state?.topCatch && config.farmObjective !== 'topcatch') return false;
        const now = nowFn();
        let sent = false;
        const tcMinGap = force ? 2_000 : (topCatchState.loaded ? 120_000 : 8_000);
        if (now - topCatchState.lastRequestedAt >= tcMinGap) {
            if (sendFrame({ t: 'topcatch.pedir' })) {
                topCatchState.lastRequestedAt = now;
                sent = true;
            }
        }
        if (includeRanking) {
            const rkMinGap = force ? 5_000 : 90_000;
            if (now - topCatchState.rankingRequestedAt >= rkMinGap) {
                if (sendFrame({ t: 'ranking.pedir', aba: 'capturas' })) {
                    topCatchState.rankingRequestedAt = now;
                    sent = true;
                }
            }
        }
        return sent;
    };

    const getEffectiveWeeklyCaughtSet = () => {
        ensureCurrentTopCatchWeek();
        if (!topCatchState.loaded ||
            (topCatchState.week && getTopCatchWeekWindow(topCatchState.week, getSyncedNowMs()).ending)) return null;
        return new Set(topCatchState.keys);
    };

    const resetCollectionState = () => {
        optimisticPokedexKeys.clear();
        topCatchState = createTopCatchState();
        objectiveTargetSlug = null;
        objectiveRotateFromSlug = null;
        objectiveLastDecision = null;
        objectiveLastLogKey = '';
        objectiveStaySlug = null;
        objectiveStaySinceAt = 0;
        objectiveStaleUntilBySlug.clear();
        huntGuideRanking = null;
    };

    const getDesiredMissingKeysForTick = (state) => {
        const mode = config.farmObjective;
        if (mode !== 'pokedex' && mode !== 'topcatch') return null;
        if (mode === 'pokedex' && !state?.pokedex) return null;
        const currentHunt = state?.huntSlug ? catalog.huntsBySlug?.[state.huntSlug] : null;
        if (!currentHunt) return null;
        const capturedSet = mode === 'pokedex'
            ? getPokedexCapturedSet(state?.pokedex, optimisticPokedexKeys)
            : getEffectiveWeeklyCaughtSet();
        if (!capturedSet) return null;
        const missing = getHuntMissingSpecies(currentHunt, capturedSet);
        return new Set(missing.map((m) => m.key));
    };

    const formatObjectiveRate = (value, focus) => {
        if (!Number.isFinite(value) || value <= 0) return '';
        const fmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 2 });
        if (focus === 'shiny') return `1 shiny / ${fmt.format(1 / value)} h`;
        return `${fmt.format(value)} ${focus === 'ouro' ? 'ouro/h' : 'XP/h'}`;
    };

    const queueObjectiveHuntSwap = (slug, reasonLabel) => {
        const isOnline = status === 'connected' || status === 'bridge';
        if (!isOnline || !slug) return false;
        const state = merger.getState();
        if (state?.huntSlug === slug) return false;
        if (pendingHuntSlug === slug) return false;
        const waitMs = Math.max(getCombatLockMs(state), getHuntSwapLockMs());
        const huntLabel = catalog.huntNames?.[slug] || slug;
        if (waitMs > 0 || hasFieldCatchPriority(state)) {
            pendingHuntSlug = slug;
            schedulePendingHuntFlush();
            if (waitMs > 0) {
                pushLog('info', `${reasonLabel}: troca para ${huntLabel} agendada (${(waitMs / 1000).toFixed(1)}s fora de combate).`);
            }
            return true;
        }
        if (sendFrame({ t: 'hunt.select', slug })) {
            tracker.lastHuntSlug = slug;
            pushLog('ok', `${reasonLabel}: trocando para ${huntLabel}.`);
            return true;
        }
        return false;
    };

    const evaluateFarmObjective = ({ triggerSwap = true } = {}) => {
        const mode = config.farmObjective;
        const focus = config.farmObjectiveFocus || 'xp';
        if (mode !== 'pokedex' && mode !== 'topcatch') {
            objectiveTargetSlug = null;
            objectiveLastDecision = null;
            return null;
        }
        const state = merger.getState();
        const isOnline = status === 'connected' || status === 'bridge';
        if (!state || catalog.huntsList.length === 0) {
            objectiveLastDecision = {
                active: true,
                mode,
                focus,
                loading: true,
                statusText: 'Aguardando catálogo de hunts do servidor...',
            };
            return objectiveLastDecision;
        }
        const capturedSet = mode === 'pokedex'
            ? getPokedexCapturedSet(state.pokedex, optimisticPokedexKeys)
            : getEffectiveWeeklyCaughtSet();
        if (mode === 'topcatch' && !capturedSet) {
            if (isOnline) requestTopCatchSync({ force: false, includeRanking: true });
            objectiveLastDecision = {
                active: true,
                mode,
                focus,
                loading: true,
                statusText: 'Sincronizando espécies da semana do Top Catch...',
            };
            return objectiveLastDecision;
        }
        if (mode === 'pokedex' && !state.pokedex) {
            objectiveLastDecision = { active: true, mode, focus, loading: true, statusText: 'Aguardando o registro da Pokédex do servidor...' };
            return objectiveLastDecision;
        }
        const activePk = (state.pokemons || []).find((pk) => pk && String(pk.id) === String(state.activeId)) || null;
        const matchingRanking = focus !== 'fast' && huntGuideRanking?.metric === focus &&
            String(huntGuideRanking.pokemonId) === String(activePk?.id)
            ? huntGuideRanking.ranked
            : null;
        const now = nowFn();
        for (const [s, until] of objectiveStaleUntilBySlug) {
            if (until <= now) objectiveStaleUntilBySlug.delete(s);
        }
        if (state.huntSlug && state.huntSlug === objectiveTargetSlug && isOnline && config.caidosEnabled !== false) {
            if (objectiveStaySlug !== state.huntSlug) {
                objectiveStaySlug = state.huntSlug;
                objectiveStaySinceAt = now;
            } else if (now - objectiveStaySinceAt >= 12 * 60_000) {
                objectiveStaleUntilBySlug.set(state.huntSlug, now + 20 * 60_000);
                objectiveStaySinceAt = now;
            }
        } else if (state.huntSlug !== objectiveStaySlug) {
            objectiveStaySlug = state.huntSlug || null;
            objectiveStaySinceAt = now;
        }
        const activeStaleSet = new Set(objectiveStaleUntilBySlug.keys());
        const decision = selectObjectiveHunt({
            mode,
            focus,
            currentSlug: state.huntSlug || '',
            activeTargetSlug: objectiveTargetSlug,
            rotateAfterCatch: mode === 'topcatch' && Boolean(state.huntSlug && state.huntSlug === objectiveRotateFromSlug),
            staleSlugs: activeStaleSet,
            hunts: catalog.huntsList,
            trainerLevel: Number(state.level || 0),
            activePokemonLevel: Number(activePk?.level || 0),
            capturedSet,
            huntRanking: matchingRanking,
        });
        const modeLabel = mode === 'pokedex' ? 'Pokédex' : 'Top Catch';
        const focusLabel = { xp: 'XP/h', ouro: 'Ouro/h', shiny: 'Shiny/h', fast: 'Mais rápido' }[focus] || 'XP/h';

        if (decision.completed) {
            objectiveTargetSlug = null;
            const statusText = mode === 'pokedex'
                ? 'Pokédex concluída em todas as hunts liberadas!'
                : 'Top Catch concluído em todas as hunts liberadas desta semana!';
            decision.statusText = statusText;
            objectiveLastDecision = decision;
            const logKey = `done:${mode}:${topCatchState.week || ''}`;
            if (objectiveLastLogKey !== logKey) {
                objectiveLastLogKey = logKey;
                pushLog('ok', statusText);
            }
            return decision;
        }

        objectiveTargetSlug = decision.targetSlug;
        if (objectiveRotateFromSlug && (state.huntSlug !== objectiveRotateFromSlug ||
            decision.targetSlug === objectiveRotateFromSlug)) objectiveRotateFromSlug = null;
        const rateTxt = decision.usedHuntGuide ? formatObjectiveRate(decision.metricValue, focus) : '';
        decision.targetMetricLabel = rateTxt;
        if (decision.targetSlug === state.huntSlug) {
            const missNames = (decision.currentMissing || []).slice(0, 3).map((m) => m.name).join(', ');
            decision.statusText = `${modeLabel} (${focusLabel}): buscando ${missNames || decision.targetName}${rateTxt ? ` · ${rateTxt}` : ''} · faltam ${decision.pendingHuntsCount} hunts`;
        } else {
            decision.statusText = `${modeLabel} (${focusLabel}) -> ${decision.targetName} (Nv ${decision.targetLevel})${rateTxt ? ` · ${rateTxt}` : ''} · faltam ${decision.pendingHuntsCount} hunts`;
        }
        objectiveLastDecision = decision;

        if (
            triggerSwap &&
            isOnline &&
            config.caidosEnabled !== false &&
            !config.economyPingOnly &&
            decision.targetSlug &&
            decision.targetSlug !== state.huntSlug &&
            state.noCentro !== true &&
            !(Number(state.mistico?.prazo || 0) > nowFn())
        ) {
            queueObjectiveHuntSwap(decision.targetSlug, `${modeLabel} (${focusLabel})`);
        }
        return decision;
    };

    const checkHuntGuide = async () => {
        const bridge = activeBridge;
        const mode = config.huntGuideMode;
        const objMode = config.farmObjective;
        const objFocus = config.farmObjectiveFocus || 'xp';
        const objNeedsGuide = (objMode === 'pokedex' || objMode === 'topcatch') &&
            !objectiveLastDecision?.completed && objFocus !== 'fast';
        const metric = objNeedsGuide ? objFocus : config.huntGuideMetric;
        const activeStatus = status;
        const isOnline = activeStatus === 'bridge' || activeStatus === 'connected';
        if (isOnline && (objMode === 'topcatch' || merger.getState()?.topCatch)) {
            requestTopCatchSync({ force: false, includeRanking: true });
        }
        if ((mode === 'off' && !objNeedsGuide) || huntGuideRequest || !isOnline || config.economyPingOnly) {
            if (objMode === 'pokedex' || objMode === 'topcatch') {
                evaluateFarmObjective({ triggerSwap: true });
            }
            return;
        }

        const canUseBridge = activeStatus === 'bridge' && typeof bridge?.readHuntGuide === 'function';
        const canUseHeadless = Boolean(headlessHuntGuide?.evaluate && lastWelcome && merger.getState());
        if (!canUseBridge && !canUseHeadless) {
            if (activeStatus === 'connected' && headlessHuntGuide && !headlessHuntGuide.isAvailable?.()) {
                huntGuideStatus = { note: 'Instale a extensão /hunt for PokeIdle no Chrome para ranking automático.' };
            }
            if (objMode === 'pokedex' || objMode === 'topcatch') {
                evaluateFarmObjective({ triggerSwap: true });
            }
            return;
        }

        const runEval = async () => {
            if (canUseBridge) {
                const fromPage = await bridge.readHuntGuide(metric).catch(() => null);
                if (fromPage) return fromPage;
            }
            if (canUseHeadless) {
                return headlessHuntGuide.evaluate({ welcome: lastWelcome, state: merger.getState(), metric });
            }
            return null;
        };

        const request = runEval();
        huntGuideRequest = request;
        try {
            const best = await request;
            if ((activeStatus === 'bridge' && activeBridge !== bridge) || status !== activeStatus ||
                config.huntGuideMode !== mode || config.farmObjective !== objMode) return;
            if (!best) {
                if (mode !== 'off') {
                    huntGuideStatus = {
                        note: activeStatus === 'connected'
                            ? (headlessHuntGuide?.isAvailable?.()
                                ? 'Aguardando dados do Pokémon ativo para calcular /hunt.'
                                : 'Instale a extensão /hunt for PokeIdle no Chrome para /hunt automático.')
                            : 'Aguardando o ranking da extensão /hunt no jogo.',
                    };
                }
                if (objMode === 'pokedex' || objMode === 'topcatch') {
                    evaluateFarmObjective({ triggerSwap: true });
                }
                return;
            }
            const state = merger.getState();
            const pokemon = state?.pokemons?.find((pk) => String(pk.id) === String(best.pokemonId));
            if (!pokemon || String(state.activeId) !== String(best.pokemonId) ||
                Number(pokemon.level) < Number(best.pokemonLevel)) return;

            if (Array.isArray(best.ranked) && best.ranked.length > 0) {
                huntGuideRanking = {
                    metric,
                    ranked: best.ranked,
                    fetchedAt: nowFn(),
                    pokemonId: best.pokemonId,
                };
            }

            const sameHunt = best.slug === state.huntSlug;
            const note = describeHuntGuide(best, metric) + (best.unsafe ? ' · risco de morte' : '');
            const previous = huntGuideStatus;
            huntGuideStatus = { slug: best.slug, metric, note, sameHunt, unsafe: best.unsafe };

            if (objMode === 'pokedex' || objMode === 'topcatch') {
                const decision = evaluateFarmObjective({ triggerSwap: true });
                // Enquanto o modo Pokedex / Top Catch tiver hunts pendentes, ele controla a troca de mapa.
                if (decision && !decision.completed) return;
            }

            if (mode === 'off') return;
            if (!sameHunt && (previous?.slug !== best.slug || previous?.metric !== metric || previous?.sameHunt)) {
                pushLog('info', `/hunt recomenda ${note}`);
            }
            const confirmed = previous?.slug === best.slug && previous.metric === metric && !previous.unsafe;
            if (mode === 'auto' && sameHunt) huntGuideTarget = best.slug;
            const huntKnown = catalog.huntsList.length === 0 || catalog.huntsList.some((hunt) => hunt.slug === best.slug);
            if (mode !== 'auto' || sameHunt || best.unsafe || !confirmed || !state.huntSlug ||
                state.noCentro === true || Number(state.mistico?.prazo || 0) > nowFn() ||
                getCombatLockMs(state) > 0 || getHuntSwapLockMs() > 0 || hasFieldCatchPriority(state) ||
                !huntKnown ||
                (huntGuideSwapAt !== null && nowFn() - huntGuideSwapAt < 30_000)) return;
            if (sendFrame({ t: 'hunt.select', slug: best.slug })) {
                huntGuideSwapAt = nowFn();
                huntGuideTarget = best.slug;
                tracker.lastHuntSlug = best.slug;
                if (config.targetHuntSlug && config.targetHuntSlug !== best.slug) {
                    config = normalizeConfigPatch(config, { targetHuntSlug: best.slug });
                    persistConfig(configPath, config);
                }
                pushLog('info', `/hunt pediu a troca para ${best.name}.`);
            }
        } catch {
            if (status === activeStatus && config.huntGuideMode === mode) {
                if (mode !== 'off') huntGuideStatus = { note: 'Ranking /hunt indisponível no momento.' };
                if (objMode === 'pokedex' || objMode === 'topcatch') {
                    evaluateFarmObjective({ triggerSwap: true });
                }
            }
        } finally {
            if (huntGuideRequest === request) huntGuideRequest = null;
        }
    };

    const describeShopBuy = (action) => {
        if (action.kind === 'ball') {
            return catalog.itemNames?.[action.id] || BALL_LABELS[action.id] || `ball #${action.id}`;
        }
        const itemNames = {
            [ITEM_IDS.SMALL_POTION]: 'Small Potion',
            [ITEM_IDS.GREAT_POTION]: 'Great Potion',
            [ITEM_IDS.ULTRA_POTION]: 'Ultra Potion',
            [ITEM_IDS.HYPER_POTION]: 'Hyper Potion',
            [ITEM_IDS.ULTIMATE_POTION]: 'Ultimate Potion',
            [ITEM_IDS.REVIVE]: 'Revive',
            [ITEM_IDS.MAX_REVIVE]: 'Max Revive',
        };
        return catalog.itemNames?.[action.id] || itemNames[action.id] || `item #${action.id}`;
    };

    const sendActions = (actions) => {
        if (!Array.isArray(actions)) return 0;
        let sentCount = 0;
        for (const a of actions) {
            if (!sendFrame(a)) continue;
            sentCount += 1;
            if (a?.t === 'shop.buy') {
                pushLog('shop', `Restock enviado: ${describeShopBuy(a)} x${a.qty}`);
            } else if (a?.t === 'passe.resgatar') {
                pushLog('reward', 'Resgate automatico do Passe Diario enviado.');
            } else if (a?.t === 'mistico.bola') {
                pushLog('catch', `Arena Mistica: lancando bola #${a.ballId}`);
            } else if (a?.t === 'prey.escolher') {
                pushLog('prey', `Auto-Prey escolhido: especie #${a.pk}`);
            }
        }
        return sentCount;
    };

    const resolveEconomyFlag = (state) => {
        if (config.economyPingOnly || config.economyMode === 'on') return true;
        if (config.economyMode === 'off') return false;
        // Em modo auto, so ativa cliente.economia no servidor se a captura de caidos estiver desligada;
        // mesmo em contas VIP, o feed de campo e o que mostra os caidos para o bot jogar a bola.
        if (config.caidosEnabled !== false) return false;
        return Boolean(state?.loja?.vip && (state?.automation?.autoBallSemParar || state?.automation?.autoBallAteCapturar));
    };

    const runTickForState = (state, { ignorePingOnly = false, forceRestock = false } = {}) => {
        if (config.economyPingOnly && !ignorePingOnly) return [];
        if (connectionMode === 'browser-bridge' && !activeBridge?.isReady()) return [];
        const evalCatalog = {
            ...catalog,
            huntSpeciesId: catalog.huntSpeciesBySlug?.[state?.huntSlug] ?? null,
        };
        const effectiveTargetSlug = (config.farmObjective === 'pokedex' || config.farmObjective === 'topcatch') && objectiveTargetSlug
            ? objectiveTargetSlug
            : (config.huntGuideMode === 'auto' && huntGuideTarget ? huntGuideTarget : config.targetHuntSlug);
        const syncedNow = getSyncedNowMs();
        const actions = evaluateHeadlessTick({
            state,
            field,
            catalog: evalCatalog,
            config: effectiveTargetSlug
                ? { ...config, targetHuntSlug: effectiveTargetSlug }
                : config,
            tracker,
            nowMs: syncedNow,
            forceRestock,
            desiredMissingKeys: getDesiredMissingKeysForTick(state),
        });
        sendActions(actions);
        if (actions.some((a) => a.t === 'ball.throw') &&
            field.getFallenCorpses(syncedNow, config.prioritizeExpiring !== false).length > 1) {
            clearCampoDrainTimer();
            campoDrainTimer = setTimeout(() => {
                campoDrainTimer = null;
                if (!disposed) runTickForState(merger.getState());
            }, 1250);
            campoDrainTimer.unref?.();
        }
        tracker.pvp ??= {};
        const pvpActions = evaluatePvpQueue(tracker.pvp, config, nowFn());
        if (pvpActions.length) sendActions(pvpActions);
        if (!config.economyPingOnly && config.trainerEnabled) {
            const trRes = evaluateTrainerPlan({
                state,
                config,
                tracker: trainerTracker,
                nowMs: syncedNow,
                catalog,
            });
            if (trRes.actions.length) sendActions(trRes.actions);
            for (const lg of trRes.logs) pushLog(lg.kind || 'ok', lg.text);
        }
        const choice = tracker.potionChoice;
        if (config.potionOptimize && choice && choice.id !== tracker.lastPotionChoiceId) {
            tracker.lastPotionChoiceId = choice.id;
            const fmtRate = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
            const worst = choice.ranked[choice.ranked.length - 1];
            pushLog('info', `Poção mais econômica: ${choice.name} (${fmtRate(choice.goldPerHp)} gold por HP no Pokémon de ${Number(choice.maxHp).toLocaleString('pt-BR')} HP${worst && worst.id !== choice.id ? `; ${worst.name} sairia ${fmtRate(worst.goldPerHp)}` : ''}).`);
        }
        const report = tracker.lastRestockReport;
        if (!forceRestock && report?.blockedByGold && nowFn() - (tracker.lastGoldReserveWarnAt || 0) >= 300_000) {
            tracker.lastGoldReserveWarnAt = nowFn();
            const goldFmt = Number(report.currentGold || 0).toLocaleString('pt-BR');
            const reserveFmt = Number(report.reserveGold || 0).toLocaleString('pt-BR');
            pushLog(
                'warn',
                report.currentGold <= report.reserveGold
                    ? `Restock bloqueado pela reserva de gold (${goldFmt} / reserva ${reserveFmt}). Ajuste "Reserva mínima gold" em Automação.`
                    : `Restock sem gold disponível após a reserva (${goldFmt} / reserva ${reserveFmt}).`
            );
        }
        return actions;
    };

    const loadSession = (forceRefresh = false) => {
        if (session && !forceRefresh) return session;
        const activeExistingProfile = getExistingProfile();
        const resolved = sessionResolver({
            nick: options.nick,
            token: options.token,
            dispositivo: options.dispositivo,
            sessionFile: options.sessionFile,
            cwd,
            ...(browserOptions.profileDir || activeExistingProfile ? {
                env: {},
                ...(activeExistingProfile
                    ? { extraDirs: [activeExistingProfile.levelDb], onlyExtraDirs: true }
                    : { onlyEmbeddedProfile: true, preferSessionCache: true }),
            } : {}),
        });
        session = resolved;
        config = buildConfig(resolved.prefs, loadSavedConfig(configPath), options.initialConfig, options.isolatedAccount);
        lastError = null;
        return session;
    };

    const handleBattleEvents = (msg) => {
        const eventos = Array.isArray(msg.ev)
            ? msg.ev
            : (Array.isArray(msg.eventos) ? msg.eventos : [msg]);
        const ts = nowFn();
        const syncedTs = getSyncedNowMs();
        let addedCorpse = false;
        for (const e of eventos) {
            if (!e || typeof e !== 'object') continue;
            if (field.applyBattleEvent?.(e, syncedTs)) {
                addedCorpse = true;
            }
            const kind = e.k || e.t || e.tipo || e.acao;
            if (kind === 'mktSorteio' || kind === 'marketComprado' || kind === 'marketVendido') {
                handleSniperMarketEvent(kind, e);
                continue;
            }
            if (kind === 'ataque') {
                stats.attacks += 1;
                rearmCombatLock();
            } else if (kind === 'cura') {
                stats.heals += 1;
                const potId = Number(e.itemId || ITEM_IDS.SMALL_POTION);
                stats.spentGold += Number(catalog.itemPrices?.[potId] ?? DEFAULT_ITEM_PRICES[potId] ?? DEFAULT_ITEM_PRICES[ITEM_IDS.SMALL_POTION] ?? 0);
            } else if (kind === 'revive') {
                stats.revivesUsed += 1;
                const revId = Number(e.itemId || ITEM_IDS.REVIVE);
                stats.spentGold += Number(catalog.itemPrices?.[revId] ?? DEFAULT_ITEM_PRICES[revId] ?? DEFAULT_ITEM_PRICES[ITEM_IDS.REVIVE] ?? 0);
            } else if (kind === 'morte' && e.quem === 'jogador') {
                stats.playerDeaths += 1;
            } else if (kind === 'morte' && e.quem !== 'jogador') {
                stats.kills += 1;
                if (stats.lastKillAt > 0) {
                    const deltaMs = ts - stats.lastKillAt;
                    if (deltaMs > 0 && deltaMs <= 60_000) {
                        stats.killDeltaSumMs += deltaMs;
                        stats.killDeltaCount += 1;
                    }
                }
                stats.lastKillAt = ts;
                stats.xpGained += Number(e.xpPokemon ?? e.xp ?? 0);
                stats.xpTrainerGained += Number(e.xpTreinador ?? e.xp ?? 0);
                stats.goldGained += Number(e.ouro || 0);
                if (Array.isArray(e.drops)) {
                    for (const d of e.drops) recordSessionDrop(d);
                }
            } else if (kind === 'bossMorto') {
                stats.xpGained += Number(e.xpPokemon ?? e.xp ?? 0);
                stats.xpTrainerGained += Number(e.xpTreinador ?? e.xp ?? 0);
                stats.goldGained += Number(e.valor || e.ouro || 0);
                if (Array.isArray(e.drops)) {
                    for (const d of e.drops) recordSessionDrop(d, { forceRare: true });
                }
            } else if (kind === 'bola') {
                stats.ballsThrown += 1;
                const bId = Number(e.ballId || 1);
                lastBallThrown = bId;
                stats.spentGold += Number(catalog.ballPrices?.[bId] ?? DEFAULT_BALL_PRICES[bId] ?? 0);
                if (e.shiny && !isNonWildScene(merger.getState())) {
                    if (e.slot != null) {
                        const p = pendingShinies.get(e.slot)
                            || { seenAt: ts, name: e.nome || '', level: e.level ?? e.nivel ?? null, goneAt: 0 };
                        p.touchAt = ts;
                        p.ballId = bId;
                        pendingShinies.set(e.slot, p);
                    }
                    const slotKey = e.slot != null ? `slot:${e.slot}` : null;
                    if (!slotKey || !seenShinySlots.has(slotKey)) {
                        if (slotKey) seenShinySlots.add(slotKey);
                        stats.shiniesSeen += 1;
                    }
                }
            } else if (kind === 'capturado') {
                stats.captures += 1;
                const isShiny = Boolean(e.pokemon?.shiny);
                if (isShiny) {
                    resolveShinyCapture(e.pokemon?.nome || e.pokemon?.name || '', e.slot ?? null);
                    stats.shiniesCaptured += 1;
                    if (stats.shiniesSeen < stats.shiniesCaptured) {
                        stats.shiniesSeen = stats.shiniesCaptured;
                    }
                }
                const name = e.pokemon?.nome || e.pokemon?.name || catalog.pokemonNames?.[e.pokemon?.speciesId] || `#${e.pokemon?.speciesId ?? '?'}`;
                const level = e.pokemon?.level ?? e.pokemon?.nivel ?? '?';
                pushLog(isShiny ? 'shiny' : 'catch', `Capturado${isShiny ? ' SHINY' : ''}: ${name} (Nv ${level})`);
                const caughtKey = chavePokedex(e.pokemon?.speciesId);
                if (caughtKey != null) {
                    const keyStr = String(caughtKey);
                    const weeklyBefore = getEffectiveWeeklyCaughtSet();
                    optimisticPokedexKeys.add(keyStr);
                    if (weeklyBefore && !weeklyBefore.has(keyStr)) {
                        topCatchState.keys.add(keyStr);
                        topCatchState.count = Math.max(topCatchState.count + 1, topCatchState.keys.size);
                        if (config.farmObjective === 'topcatch') {
                            objectiveRotateFromSlug = merger.getState()?.huntSlug || null;
                        }
                    }
                    if (config.farmObjective === 'pokedex' || config.farmObjective === 'topcatch') {
                        evaluateFarmObjective({ triggerSwap: true });
                    }
                }
                if (isShiny) {
                    const curSlug = merger.getState()?.huntSlug || '';
                    const spId = Number(e.pokemon?.speciesId) || null;
                    const spriteDex = resolvePokemonSpriteDex(spId, name, catalog.pokemonDexByName) || null;
                    const details = extractPokemonDetails(e.pokemon);
                    const huntLabel = curSlug ? (catalog.huntNames?.[curSlug] || curSlug) : '';
                    ownShinies.unshift({
                        ts,
                        speciesId: spId,
                        spriteDex,
                        name,
                        level,
                        hunt: huntLabel,
                        ballId: lastBallThrown,
                        details,
                    });
                    if (ownShinies.length > 10) ownShinies.pop();
                    appendShinyHistoryRecord(cwd, {
                        ts,
                        trainer: merger.getState()?.nick || session?.nick || 'Você',
                        own: true,
                        egg: false,
                        name,
                        speciesId: spId,
                        spriteDex,
                        level,
                        hunt: huntLabel,
                        ballId: lastBallThrown,
                        details,
                    });
                }
            } else if (kind === 'topCatchNova') {
                const week = String(e.s || topCatchState.week || '');
                if (week && topCatchState.week && week < topCatchState.week) continue;
                const key = chavePokedex(e.chave);
                const chave = key == null ? '' : String(key);
                if (week && topCatchState.week && week > topCatchState.week) {
                    topCatchState.week = week;
                    topCatchState.keys.clear();
                    topCatchState.ini = false;
                    topCatchState.count = 0;
                    topCatchState.lastMinute = 0;
                    topCatchState.paidMilestone = 0;
                    topCatchState.loaded = false;
                    topCatchState.rankingRows = null;
                    topCatchState.lastRequestedAt = 0;
                    topCatchState.rankingRequestedAt = 0;
                    objectiveRotateFromSlug = null;
                } else if (week && !topCatchState.week) {
                    topCatchState.week = week;
                }
                if (chave) {
                    const isNew = !topCatchState.keys.has(chave);
                    topCatchState.keys.add(chave);
                    if (Number.isFinite(Number(e.n))) topCatchState.count = Math.max(Number(e.n), topCatchState.keys.size);
                    else if (isNew) topCatchState.count = Math.max(topCatchState.count + 1, topCatchState.keys.size);
                    if (Number.isFinite(Number(e.m))) topCatchState.lastMinute = Number(e.m);
                    if (isNew) {
                        if (config.farmObjective === 'topcatch') {
                            objectiveRotateFromSlug = merger.getState()?.huntSlug || null;
                        }
                        pushLog('reward', `Top Catch: nova espécie na semana (${topCatchState.count} no total)!`);
                    }
                    if (config.farmObjective === 'topcatch') {
                        evaluateFarmObjective({ triggerSwap: true });
                    }
                }
            } else if (kind === 'topCatchMarco') {
                const marco = Number(e.marco) || 0;
                if (marco > topCatchState.paidMilestone) {
                    topCatchState.paidMilestone = marco;
                }
                if (marco > 0) {
                    pushLog('reward', `Top Catch: marco de ${marco} espécies atingido!`);
                }
            } else if (kind === 'votoCreditado') {
                const qtd = Number(e.qtd || 1);
                pushLog('reward', `+${qtd} diamante${qtd === 1 ? '' : 's'} creditado${qtd === 1 ? '' : 's'} pelo voto no IdleHub.io!`);
                void refreshVoteStatus({ force: true });
            }
        }
        scanShinyField(ts);
        if (addedCorpse && config.caidosEnabled !== false) {
            runTickForState(merger.getState());
        }
        const stNow = merger.getState();
        const inActiveHunt = Boolean(
            stNow?.huntSlug &&
            !stNow.noCentro &&
            !stNow.casa?.dentro &&
            !stNow.boss?.arena
        );
        const hadWildKill = eventos.some((ev) => {
            if (!ev || typeof ev !== 'object') return false;
            const k = ev.k || ev.t || ev.tipo || ev.acao;
            return k === 'morte' && ev.quem === 'selvagem' && !ev.safari;
        });
        if (hadWildKill && inActiveHunt && config.caidosEnabled !== false && !config.economyPingOnly) {
            const campoStale = lastCampoAt === 0 || ts - lastCampoAt >= 8_000;
            if (campoStale) {
                battleKillsWithoutCampo += 1;
                const shouldKeepCampo = connectionMode === 'browser-bridge' || config.economyMode !== 'on';
                if (shouldKeepCampo && battleKillsWithoutCampo >= 2 && ts - lastCampoHealAt >= 15_000) {
                    lastCampoHealAt = ts;
                    if (sendFrame({ t: 'cliente.economia', ativo: false })) {
                        economyActive = false;
                        pushLog('warn', 'Feed de campo ausente em combate: reativando o feed leve para não perder caídos.');
                    }
                }
                if (battleKillsWithoutCampo >= 3) {
                    campoFeedDegraded = true;
                }
            }
        }
    };

    const handleMessage = (rawData) => {
        let m;
        try {
            m = JSON.parse(String(rawData));
        } catch {
            return;
        }
        if (!m || typeof m !== 'object') return;
        lastMsgAt = nowFn();

        if (m.t === 'pong') {
            stats.pongs += 1;
            return;
        }

        if (m.t === 'shiny.captura' && typeof m.pokemon?.nome === 'string') {
            const spId = Number(m.pokemon.speciesId ?? m.pokemon.pokeId) || null;
            const spriteDex = resolvePokemonSpriteDex(spId, m.pokemon.nome, catalog.pokemonDexByName) || null;
            const trainerNick = m.nick || 'Desconhecido';
            const level = m.pokemon.level ?? m.pokemon.nivel ?? '?';
            const details = extractPokemonDetails(m.pokemon);
            const ownNick = String(merger.getState()?.nick || session?.nick || '').toLowerCase();
            const isOwn = Boolean(ownNick && String(m.nick || '').toLowerCase() === ownNick);
            const curSlug = merger.getState()?.huntSlug || '';
            const huntLabel = m.ovo ? 'Ovo Shiny' : (isOwn && curSlug ? (catalog.huntNames?.[curSlug] || curSlug) : '');
            recentShinies.unshift({
                ts: lastMsgAt,
                name: m.pokemon.nome,
                speciesId: spId,
                spriteDex,
                level,
                trainer: trainerNick,
                egg: Boolean(m.ovo),
                own: isOwn,
                hunt: huntLabel,
                details,
            });
            if (recentShinies.length > 50) recentShinies.pop();
            appendShinyHistoryRecord(cwd, {
                ts: lastMsgAt,
                trainer: trainerNick,
                own: isOwn,
                egg: Boolean(m.ovo),
                name: m.pokemon.nome,
                speciesId: spId,
                spriteDex,
                level,
                hunt: huntLabel,
                ballId: isOwn && !m.ovo ? lastBallThrown : null,
                details,
            });
            if (isOwn) {
                const lastOwn = ownShinies[0];
                const sameAsRecent = lastOwn && (lastMsgAt - Number(lastOwn.ts || 0) < 8_000) && (
                    (spId != null && lastOwn.speciesId === spId) ||
                    String(lastOwn.name || '').toLowerCase() === m.pokemon.nome.toLowerCase()
                );
                if (!sameAsRecent) {
                    resolveShinyCapture(m.pokemon.nome, null);
                    stats.shiniesCaptured += 1;
                    if (stats.shiniesSeen < stats.shiniesCaptured) stats.shiniesSeen = stats.shiniesCaptured;
                    pushLog('shiny', `${m.ovo ? 'Chocado SHINY' : 'Capturado SHINY'}: ${m.pokemon.nome} (Nv ${level})`);
                    ownShinies.unshift({
                        ts: lastMsgAt,
                        speciesId: spId,
                        spriteDex,
                        name: m.pokemon.nome,
                        level,
                        hunt: huntLabel,
                        ballId: m.ovo ? null : lastBallThrown,
                        details,
                    });
                    if (ownShinies.length > 10) ownShinies.pop();
                }
            }
            return;
        }

        if (m.t === 'drop.raro') {
            const ownNick = String(merger.getState()?.nick || session?.nick || '').toLowerCase();
            const dropOwner = String(m.nick ?? m.jogador ?? '').toLowerCase();
            if (ownNick && dropOwner === ownNick) {
                let name = String(m.item ?? m.nome ?? m.itemNome ?? '').trim();
                if (!name && (m.tipo === 'casa' || m.tipo === 'bicicleta')) {
                    const kindLabel = m.tipo === 'casa' ? 'Casa' : 'Bicicleta';
                    const rarLabel = m.raridade === 'mitica' ? 'Mítica' : (m.raridade === 'lendaria' ? 'Lendária' : String(m.raridade || 'Rara'));
                    name = `${kindLabel} ${rarLabel}`.trim();
                }
                const itemId = m.itemId ?? null;
                if (name || itemId != null) {
                    const last = recentDrops[0];
                    const alreadyLogged = last && (nowFn() - last.ts < 3000) &&
                        ((itemId != null && last.itemId === Number(itemId)) || (name && last.name.toLowerCase() === name.toLowerCase()));
                    if (!alreadyLogged) {
                        recordSessionDrop({ itemId, nome: name, qtd: m.qtd ?? 1 }, { forceRare: true });
                    }
                }
            }
            return;
        }

        if (m.t === 'topCatch') {
            const week = typeof m.s === 'string' && m.s ? m.s : topCatchState.week;
            if (week && topCatchState.week && week < topCatchState.week) return;
            if (week && topCatchState.week && week > topCatchState.week) {
                topCatchState.keys.clear();
                topCatchState.rankingRows = null;
                topCatchState.count = 0;
                topCatchState.lastMinute = 0;
                topCatchState.paidMilestone = 0;
                objectiveRotateFromSlug = null;
            }
            if (week) topCatchState.week = week;
            topCatchState.ini = Boolean(m.ini);
            if (Array.isArray(m.e)) {
                for (const pair of m.e) {
                    const k = chavePokedex(Array.isArray(pair) ? pair[0] : pair);
                    if (k != null) topCatchState.keys.add(String(k));
                }
            }
            if (Number.isFinite(Number(m.n))) {
                topCatchState.count = Math.max(topCatchState.keys.size, Number(m.n));
            } else {
                topCatchState.count = topCatchState.keys.size;
            }
            if (Number.isFinite(Number(m.m))) topCatchState.lastMinute = Math.max(0, Number(m.m));
            if (Number.isFinite(Number(m.r))) topCatchState.paidMilestone = Math.max(topCatchState.paidMilestone, Number(m.r));
            if (m.ant && typeof m.ant === 'object') {
                topCatchState.previousWeek = { s: String(m.ant.s || ''), n: Number(m.ant.n || 0) };
            }
            topCatchState.loaded = topCatchState.count === 0 || topCatchState.keys.size >= topCatchState.count;
            if (config.farmObjective === 'topcatch') {
                evaluateFarmObjective({ triggerSwap: true });
            }
            return;
        }

        if (m.t === 'ranking' && m.aba === 'capturas' && Array.isArray(m.linhas)) {
            topCatchState.rankingRows = m.linhas;
            topCatchState.rankingFetchedAt = nowFn();
            return;
        }

        if (m.t === 'votoCreditado') {
            const qtd = Number(m.qtd || 1);
            pushLog('reward', `+${qtd} diamante${qtd === 1 ? '' : 's'} creditado${qtd === 1 ? '' : 's'} pelo voto no IdleHub.io!`);
            void refreshVoteStatus({ force: true });
            return;
        }

        if (m.t === 'sessao.renovada') {
            if (m.token && session) {
                session.token = m.token;
                session.payload = decodeJwtPayload(m.token) || session.payload;
                try {
                    saveSessionCache(session.cachePath, {
                        nick: session.nick,
                        token: session.token,
                        provedor: session.provedor,
                        dispositivo: session.dispositivo,
                    });
                    pushLog('info', 'Token de sessao renovado e salvo no cache.');
                } catch (err) {
                    pushLog('warn', `Aviso ao salvar cache de sessao: ${err?.message || err}`);
                }
            }
            return;
        }

        if (m.t === 'welcome') {
            const isBridge = connectionMode === 'browser-bridge';
            status = isBridge ? 'bridge' : 'connected';
            lastError = null;
            lastWelcome = m;
            field.reset();
            seenShinySlots.clear();
            const previousNick = merger.getState()?.nick;
            if (previousNick && m.estado?.nick && previousNick.toLowerCase() !== m.estado.nick.toLowerCase()) {
                resetCollectionState();
            }
            liveBridge.ingestWsMessage(m);
            ingestWelcomeCatalog(m, catalog);
            if (m.estado) merger.merge(m.estado);
            const state = merger.getState();
            syncCombatTimersFromState(m.estado, state);
            syncTopCatchFromState(state);
            tracker.lastHuntSlug = state?.huntSlug || tracker.lastHuntSlug;
            pushLog(
                'ok',
                isBridge
                    ? `Bot acoplado ao jogo como ${state?.nick || session?.nick || '-'} (Hunt: ${state?.huntSlug || '-'}).`
                    : `Conectado em wss://pokeidle.io como ${state?.nick || session?.nick} (Hunt: ${state?.huntSlug || '-'}).`
            );

            if (!isBridge && config.farmObjective === 'off' && config.targetHuntSlug && state?.huntSlug !== config.targetHuntSlug) {
                pushLog('info', `Selecionando hunt configurada: ${config.targetHuntSlug}`);
                sendFrame({ t: 'hunt.select', slug: config.targetHuntSlug });
            }
            scheduleSniperTimer();
            scheduleAdvisor();

            const needGuideNow = config.huntGuideMode !== 'off' || config.farmObjective !== 'off';
            if (isBridge) {
                economyActive = false;
                lastCampoAt = 0;
                battleKillsWithoutCampo = 0;
                campoFeedDegraded = false;
                ensureHuntGuideTimer();
                void checkHuntGuide();
            } else {
                economyActive = resolveEconomyFlag(state);
                lastCampoAt = 0;
                battleKillsWithoutCampo = 0;
                campoFeedDegraded = false;
                sendFrame({ t: 'cliente.economia', ativo: economyActive });
                if (needGuideNow) {
                    ensureHuntGuideTimer();
                    void checkHuntGuide();
                }
            }
            if (state?.topCatch || config.farmObjective === 'topcatch') {
                requestTopCatchSync({ force: false, includeRanking: true });
            }
            const waitingInitialRank = Boolean(
                huntGuideRequest &&
                config.farmObjectiveFocus !== 'fast' &&
                huntGuideRanking?.metric !== config.farmObjectiveFocus
            );
            if (config.farmObjective === 'pokedex' || config.farmObjective === 'topcatch') {
                evaluateFarmObjective({ triggerSwap: !waitingInitialRank });
            }
            if (pendingHuntSlug) schedulePendingHuntFlush();
            runTickForState(state);
            liveBridge.setPaused(false);
            liveBridge.startTimer();
            liveBridge.runOnce({ force: false });
            ensureVoteTimer();
            void refreshVoteStatus({ force: false });
            return;
        }

        if (m.t === 'estado') {
            liveBridge.ingestWsMessage(m);
            if (m.estado) merger.merge(m.estado);
            const state = merger.getState();
            syncCombatTimersFromState(m.estado, state);
            syncTopCatchFromState(state);
            if (pendingHuntSlug && state?.huntSlug === pendingHuntSlug) {
                pendingHuntSlug = null;
                clearHuntFlushTimer();
            } else if (pendingHuntSlug) {
                schedulePendingHuntFlush();
            }
            if (connectionMode === 'browser-bridge' && status === 'connecting' && state?.nick) {
                status = 'bridge';
                lastError = null;
                void checkHuntGuide();
            }
            if (config.farmObjective === 'pokedex' || config.farmObjective === 'topcatch') {
                const waitingInitialRank = Boolean(
                    huntGuideRequest &&
                    config.farmObjectiveFocus !== 'fast' &&
                    huntGuideRanking?.metric !== config.farmObjectiveFocus
                );
                evaluateFarmObjective({ triggerSwap: !waitingInitialRank });
            }
            tracker.lastHuntSlug = state?.huntSlug || tracker.lastHuntSlug;
            runTickForState(state);
            return;
        }

        if (m.t === 'campo.init') {
            if (m.ts != null) syncServerClock(m.ts);
            fieldInitialized = true;
            lastCampoAt = nowFn();
            battleKillsWithoutCampo = 0;
            campoFeedDegraded = false;
            field.applyCampoInit(m, getSyncedNowMs());
            scanShinyField(nowFn());
            if (pendingHuntSlug) schedulePendingHuntFlush();
            return;
        }

        if (m.t === 'campo') {
            if (m.ts != null) syncServerClock(m.ts);
            fieldInitialized = true;
            lastCampoAt = nowFn();
            battleKillsWithoutCampo = 0;
            campoFeedDegraded = false;
            field.applyCampo(m, getSyncedNowMs());
            scanShinyField(nowFn());
            if (pendingHuntSlug) schedulePendingHuntFlush();
            runTickForState(merger.getState());
            return;
        }

        if (m.t === 'batalha') {
            handleBattleEvents(m);
            return;
        }

        if (m.t === 'pvp') {
            tracker.pvp ??= {};
            const note = applyPvpMessage(tracker.pvp, m, nowFn());
            if (note && config.pvpQueue) pushLog(m.partida ? (m.partida.venci ? 'ok' : 'info') : (m.filaRecusa ? 'warn' : 'info'), note);
            return;
        }

        if (m.t === 'market') {
            if (handleAdvisorMarket(m)) return;
            if (m.aba === 'itens') {
                marketSummary = m.resumo || {};
                marketMedias = m.medias || null;
                if (config.sniperEnabled && !config.economyPingOnly) {
                    const cmds = evaluateSniperSummary({
                        resumo: marketSummary,
                        rules: config.sniperRules || [],
                        nowMs: nowFn(),
                        tracker: sniperTracker,
                    });
                    if (cmds.length) sendActions(cmds);
                }
            } else if (m.aba === 'item' && m.itemId != null) {
                const stateNow = merger.getState();
                if (config.sniperEnabled && !config.economyPingOnly) {
                    const evalRes = evaluateSniperItemListings({
                        itemId: m.itemId,
                        moeda: m.moeda === 'orb' ? 'orb' : 'gold',
                        linhas: m.linhas || [],
                        rules: sniperRulesWithPending(),
                        state: stateNow,
                        config,
                        tracker: sniperTracker,
                        syncedNowMs: getSyncedNowMs(),
                    });
                    if (evalRes.actions.length) sendSniperActions(evalRes.actions);
                    for (const lg of evalRes.logs) pushLog(lg.kind || 'reward', lg.text);
                    for (const hit of evalRes.hits) {
                        sniperRecentHits.unshift(hit);
                        if (sniperRecentHits.length > 25) sniperRecentHits.pop();
                    }
                    if (evalRes.purchases.length > 0) registerSniperPending(evalRes.purchases);
                    if (evalRes.recheckAtMs != null) {
                        const pairKey = `${m.itemId}:${m.moeda === 'orb' ? 'orb' : 'gold'}`;
                        const oldTimer = sniperRetentionTimers.get(pairKey);
                        if (oldTimer) clearTimeout(oldTimer);
                        const delayMs = Math.max(250, Math.min(60_000, evalRes.recheckAtMs - getSyncedNowMs()));
                        const rtTimer = setTimeout(() => {
                            sniperRetentionTimers.delete(pairKey);
                            if (!disposed && (status === 'connected' || status === 'bridge')) {
                                sendFrame({ t: 'market.item', itemId: Number(m.itemId), moeda: m.moeda === 'orb' ? 'orb' : 'gold' });
                            }
                        }, delayMs);
                        rtTimer.unref?.();
                        sniperRetentionTimers.set(pairKey, rtTimer);
                    }
                }
            } else if (m.aba === 'vitrine' && Array.isArray(m.linhas)) {
                const stateNow = merger.getState();
                if (config.sniperEnabled && !config.economyPingOnly) {
                    const evalRes = evaluateSniperPokemonListings({
                        linhas: m.linhas,
                        rules: sniperRulesWithPending(),
                        state: stateNow,
                        config,
                        tracker: sniperTracker,
                        syncedNowMs: getSyncedNowMs(),
                    });
                    for (const [rId, st] of Object.entries(evalRes.matchedRuleStats || {})) {
                        sniperPokemonStats[rId] = st;
                    }
                    if (evalRes.actions.length) sendSniperActions(evalRes.actions);
                    for (const lg of evalRes.logs) pushLog(lg.kind || 'reward', lg.text);
                    for (const hit of evalRes.hits) {
                        sniperRecentHits.unshift(hit);
                        if (sniperRecentHits.length > 25) sniperRecentHits.pop();
                    }
                    if (evalRes.purchases.length > 0) registerSniperPending(evalRes.purchases);
                    if (evalRes.recheckAtMs != null && evalRes.recheckRule) {
                        const pkKey = `pk:${evalRes.recheckRule.id}`;
                        const oldTimer = sniperRetentionTimers.get(pkKey);
                        if (oldTimer) clearTimeout(oldTimer);
                        const delayMs = Math.max(250, Math.min(60_000, evalRes.recheckAtMs - getSyncedNowMs()));
                        const recheckRuleSnapshot = evalRes.recheckRule;
                        const rtTimer = setTimeout(() => {
                            sniperRetentionTimers.delete(pkKey);
                            if (!disposed && (status === 'connected' || status === 'bridge')) {
                                sendFrame(buildPokemonListingFrame(recheckRuleSnapshot));
                            }
                        }, delayMs);
                        rtTimer.unref?.();
                        sniperRetentionTimers.set(pkKey, rtTimer);
                    }
                }
            }
            return;
        }

        if (m.t === 'erro') {
            const errTxt = m.chave || m.msg || 'erro desconhecido';
            lastError = errTxt;
            pushLog('error', `Servidor: ${errTxt}`);
            if (errTxt === 'auth.sessaoInvalida' && connectionMode === 'headless') {
                clearReconnectTimer();
                closeSocketQuietly();
                session = null;
                status = 'error';
                pushLog('warn', getExistingProfile()
                    ? 'Sessão rejeitada. Recarregue o jogo no Chrome, confirme que está logado e clique em Iniciar.'
                    : 'Sessão rejeitada. Entre novamente no Pokeidle pelo painel de conexões.');
            }
        }
    };

    const scheduleReconnect = (delayMs) => {
        if (disposed || status === 'paused') return;
        clearReconnectTimer();
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (disposed || status === 'paused') return;
            try {
                loadSession(true);
            } catch {
                // mantem sessao em memoria se o cache nao mudou
            }
            openConnection();
        }, delayMs);
    };

    const runSilentCookieRecoveryIfNeeded = () => {
        if (getExistingProfile() || silentSyncAttempted || loginInProgress || disposed || options.disableBrowserProfileSync) return;
        if (config.liveTwitchToken && config.liveKickToken) return;
        silentSyncAttempted = true;
        const liveProfileDir = getLiveProfileDir();
        const trySync = async () => {
            if (existsSync(liveProfileDir)) {
                const fromLive = await readCookiesFromLocalProfile(liveProfileDir).catch(() => null);
                if (fromLive && (fromLive.twitchToken || fromLive.kickToken)) return fromLive;
            }
            return silentCookieSync(browserOptions);
        };
        Promise.resolve(trySync()).then((res) => {
            if (!res || disposed) return;
            const patch = {};
            if (res.twitchToken && !config.liveTwitchToken) patch.liveTwitchToken = res.twitchToken;
            if (res.twitchDeviceId && !config.liveTwitchDeviceId) patch.liveTwitchDeviceId = res.twitchDeviceId;
            if (res.kickToken && !config.liveKickToken) patch.liveKickToken = res.kickToken;
            if (Object.keys(patch).length > 0) {
                updateConfig({ ...patch, liveEnabled: true });
                pushLog('live', 'Lives: cookies Twitch/Kick sincronizados do navegador.');
                liveBridge.runOnce({ force: false });
            }
        }).catch(() => {});
    };

    const getIsolatedProfileDir = () => browserOptions.profileDir || resolve(cwd, DEFAULT_BROWSER_PROFILE_DIR);
    const getLiveProfileDir = () => resolve(cwd, DEFAULT_LIVE_PROFILE_DIR);

    const resolveIsolatedExeForDir = (dir) => {
        if (options.browserExecutablePath) return options.browserExecutablePath;
        const detected = detectProfileBrowserKind(dir);
        return (detected && findChromiumExecutable(detected)) || findChromiumExecutable();
    };

    const readCookiesFromLocalProfile = options.cookieReader || ((profileDir, signal, explicitExe = null) => openInteractiveLogin('twitch', {
        cwd,
        executablePath: explicitExe || resolveIsolatedExeForDir(profileDir),
        profileDir,
        forceIsolatedProfile: true,
        headless: true,
        collectAllCookies: true,
        timeoutMs: 8_000,
        signal,
    }));

    const loginLiveViaCleanBrowser = async (provider, { previousToken, interactive, signal }) => {
        const liveProfileDir = getLiveProfileDir();
        const exe = resolveIsolatedExeForDir(liveProfileDir);
        if (!exe || (!options.browserLauncher && !existsSync(exe))) {
            throw new Error('Chrome/Edge nao encontrado para abrir a janela de login.');
        }
        if (!interactive && existsSync(liveProfileDir)) {
            const existing = await readCookiesFromLocalProfile(liveProfileDir, signal, exe).catch(() => null);
            const existingTok = provider === 'twitch' ? existing?.twitchToken : existing?.kickToken;
            if (existingTok && existingTok !== previousToken) return existing;
        }
        pushLog('info', `Abrindo ${provider} no navegador limpo (sem depuração). Faça login e feche a janela ao concluir.`);
        const launchRes = await browserLauncher(exe, liveProfileDir, [LOGIN_URLS[provider]], null, {
            enableRemoteDebugging: false,
            waitForExit: true,
            signal,
        });
        if (signal.aborted) throw new Error('Login cancelado.');
        if (launchRes?.exitedQuickly) {
            throw new Error(`Feche as janelas abertas de Twitch/Kick desta conta e clique em Conectar ${provider} novamente (ou use "Colar token").`);
        }
        await new Promise((r) => setTimeout(r, 450));
        if (signal.aborted) throw new Error('Login cancelado.');
        const extracted = await readCookiesFromLocalProfile(liveProfileDir, signal, exe).catch(() => null);
        const capturedTok = provider === 'twitch' ? extracted?.twitchToken : extracted?.kickToken;
        if (!capturedTok) {
            throw new Error(`Nenhum login de ${provider} encontrado ao fechar o navegador. Confirme que concluiu o login antes de fechar (ou use "Colar token").`);
        }
        return extracted;
    };

    const readValidSessionFromLevelDb = (levelDbDir) => {
        const found = levelDbDir && extractSessionFromLevelDbDir(levelDbDir);
        return found?.nick && found?.token && found.payload &&
            (!found.payload.exp || Number(found.payload.exp) > nowFn() + 60_000) ? found : null;
    };

    const readCurrentProfileGameSession = () => {
        const activeExistingProfile = getExistingProfile();
        const levelDbDir = activeExistingProfile
            ? activeExistingProfile.levelDb
            : join(getIsolatedProfileDir(), 'Default', 'Local Storage', 'leveldb');
        return readValidSessionFromLevelDb(levelDbDir);
    };

    const adoptGameSession = (result) => {
        if (session?.nick?.toLowerCase() !== result.nick.toLowerCase()) {
            resetCollectionState();
            merger = createStateMerger();
            tracker = { lastHuntSlug: config.targetHuntSlug || null };
            for (const key of Object.keys(stats)) stats[key] = key === 'startedAt' ? null : 0;
        }
        const cacheTarget = options.sessionFile ? resolve(options.sessionFile) : resolve(cwd, '.pokebot-session.json');
        saveSessionCache(cacheTarget, result);
        session = null;
        loadSession(true);
    };

    const loginViaBrowserProfile = async (provider, {
        existingProfile: targetExistingProfile,
        previousNick,
        previousGameToken,
        interactive,
        signal,
    }) => {
        const profileDir = targetExistingProfile ? null : getIsolatedProfileDir();
        const exe = targetExistingProfile
            ? (targetExistingProfile.exe || desktopBrowser || findChromiumExecutable())
            : resolveIsolatedExeForDir(profileDir);
        if (!exe || (!options.browserLauncher && !existsSync(exe))) {
            throw new Error('Chrome/Edge nao encontrado para abrir a janela de login.');
        }
        const levelDbDir = targetExistingProfile
            ? targetExistingProfile.levelDb
            : join(profileDir, 'Default', 'Local Storage', 'leveldb');
        const initial = provider === 'pokeidle' ? readValidSessionFromLevelDb(levelDbDir) : null;
        const hadActiveSession = Boolean(previousNick || previousGameToken);
        if (provider === 'pokeidle' && initial && (!interactive || !hadActiveSession)) {
            return { ...initial, keepBrowserOpen: true };
        }
        await browserLauncher(exe, profileDir, [LOGIN_URLS[provider]], targetExistingProfile, {
            enableRemoteDebugging: false,
        });
        if (provider !== 'pokeidle') {
            pushLog('info', `Entre em ${provider} no navegador para usar o chat desse perfil.`);
            return null;
        }
        const ignoreTokens = new Set([initial?.token, previousGameToken].filter(Boolean));
        const deadline = Date.now() + (options.loginTimeoutMs ?? 300_000);
        const pollMs = Math.max(50, Number(options.loginPollIntervalMs ?? 1500));
        while (!signal.aborted && Date.now() < deadline) {
            const found = readValidSessionFromLevelDb(levelDbDir);
            if (found && !ignoreTokens.has(found.token)) {
                return { ...found, keepBrowserOpen: true };
            }
            await new Promise((wait) => setTimeout(wait, pollMs));
        }
        throw new Error(signal.aborted ? 'Login cancelado.' : 'O navegador não gravou uma nova sessão do Pokeidle a tempo.');
    };

    const startLogin = (provider, { interactive = false } = {}) => {
        const clean = String(provider || '').toLowerCase();
        if (!LOGIN_URLS[clean]) return false;
        if (loginInProgress) {
            pushLog('warn', `Login em andamento (${loginInProgress}). Conclua ou feche a aba/janela aberta.`);
            return false;
        }

        const activeExistingProfile = getExistingProfile();
        const previousNick = clean === 'pokeidle' && interactive ? merger.getState()?.nick || session?.nick : null;
        const previousGameToken = clean === 'pokeidle' && interactive ? session?.token || null : null;
        const previousToken = interactive
            ? (clean === 'twitch' ? config.liveTwitchToken : clean === 'kick' ? config.liveKickToken : null)
            : null;
        if (clean === 'pokeidle' && interactive) pause();
        loginInProgress = clean;
        loginAbortCtrl = new AbortController();
        pushLog('info', previousNick
            ? `No navegador, saia de ${previousNick} e entre na conta desejada.`
            : previousToken ? `No navegador, saia de ${clean} e entre na conta desejada.`
                : `Abrindo ou sincronizando o login de ${clean}...`);

        const useDirectLevelDbLogin = Boolean(activeExistingProfile) ||
            (clean === 'pokeidle' && !hasCustomLoginLauncher);
        const useCleanLiveLogin = !activeExistingProfile && !hasCustomLoginLauncher &&
            (clean === 'twitch' || clean === 'kick');

        if (interactive && activeExistingProfile && !config.browserProfile) {
            config = normalizeConfigPatch(config, { browserProfile: activeExistingProfile.id || activeExistingProfile.name });
            persistConfig(configPath, config);
        }

        Promise.resolve().then(() => {
            const loginOptions = {
                ...browserOptions,
                interactive,
                previousNick,
                previousGameToken,
                previousToken,
                existingProfile: activeExistingProfile,
                signal: loginAbortCtrl.signal,
            };
            if (useDirectLevelDbLogin) return loginViaBrowserProfile(clean, loginOptions);
            if (useCleanLiveLogin) return loginLiveViaCleanBrowser(clean, loginOptions);
            return loginLauncher(clean, loginOptions);
        })
            .then((result) => {
                if (disposed) return;
                if ((clean === 'twitch' || clean === 'kick') && (result?.twitchToken || result?.kickToken)) {
                    const patch = { liveEnabled: true };
                    if (result.twitchToken) {
                        patch.liveTwitchToken = result.twitchToken;
                        if (result.twitchDeviceId) patch.liveTwitchDeviceId = result.twitchDeviceId;
                    }
                    if (result.kickToken) {
                        patch.liveKickToken = result.kickToken;
                    }
                    updateConfig(patch);
                    const connected = [
                        result.twitchToken ? 'Twitch' : '',
                        result.kickToken ? 'Kick' : '',
                    ].filter(Boolean).join(' e ');
                    pushLog('ok', `${connected} conectada automaticamente!`);
                    liveBridge.runOnce({ force: false });
                } else if (clean === 'pokeidle' && result?.token && result?.nick) {
                    adoptGameSession(result);
                    if (result.keepBrowserOpen || activeExistingProfile) {
                        status = 'paused';
                        pushLog('ok', `Sessão de ${result.nick} salva. Feche a aba do jogo e clique em Iniciar para farmar.`);
                    } else {
                        pushLog('ok', `PokeIdle conectado como ${result.nick}! Iniciando farm...`);
                        openConnection();
                    }
                } else if (!activeExistingProfile) {
                    pushLog('warn', `Login (${clean}) finalizado sem capturar credenciais.`);
                }
            })
            .catch((err) => {
                if (!disposed) {
                    lastError = err?.message || `Login (${clean}) cancelado.`;
                    pushLog('warn', err?.message || `Login (${clean}) cancelado.`);
                }
            })
            .finally(() => {
                loginInProgress = null;
                loginAbortCtrl = null;
            });
        return true;
    };

    const importSession = (rawInput) => {
        try {
            const parsed = parseImportedSessionInput(rawInput);
            if (loginAbortCtrl) {
                try { loginAbortCtrl.abort(); } catch { /* ignore */ }
            }
            pause();
            adoptGameSession(parsed);
            lastError = null;
            pushLog('ok', `Sessão de ${parsed.nick} importada. Feche a aba do jogo se estiver aberta e clique em Iniciar.`);
            return { ok: true, nick: parsed.nick };
        } catch (err) {
            const message = err?.message || 'Erro ao importar sessão.';
            lastError = message;
            pushLog('error', message);
            return { ok: false, error: message };
        }
    };

    const importLiveTokens = (input = {}) => {
        const rawTw = String(input.twitchToken || '').trim().replace(/^["']|["']$/g, '');
        const rawTwDev = String(input.twitchDeviceId || '').trim().replace(/^["']|["']$/g, '');
        const rawKk = normalizeUrlCookie(String(input.kickToken || '').trim().replace(/^["']|["']$/g, ''));
        if (!rawTw && !rawKk) {
            const message = 'Informe o cookie auth-token da Twitch e/ou session_token da Kick.';
            pushLog('warn', message);
            return { ok: false, error: message };
        }
        const patch = { liveEnabled: true };
        if (rawTw) patch.liveTwitchToken = rawTw;
        if (rawTwDev) patch.liveTwitchDeviceId = rawTwDev;
        if (rawKk) patch.liveKickToken = rawKk;
        updateConfig(patch);
        const labels = [rawTw ? 'Twitch' : '', rawKk ? 'Kick' : ''].filter(Boolean).join(' e ');
        pushLog('ok', `Token de ${labels} salvo! Sincronizando lives...`);
        liveBridge.runOnce({ force: true });
        return { ok: true };
    };

    const openConnection = () => {
        if (disposed) return;
        clearReconnectTimer();
        closeBridgeQuietly();
        closeSocketQuietly();
        connectionMode = 'headless';
        field.reset();

        const activeExistingProfile = getExistingProfile();
        try {
            loadSession(Boolean(activeExistingProfile));
        } catch (err) {
            status = 'error';
            lastError = err?.message || 'Sessao nao encontrada';
            pushLog('error', lastError);
            if (autoLoginOnMissingSession && !autoLoginTriggered && !loginInProgress) {
                autoLoginTriggered = true;
                startLogin('pokeidle');
            }
            return false;
        }

        runSilentCookieRecoveryIfNeeded();

        status = 'connecting';
        lastError = null;
        if (!stats.startedAt) stats.startedAt = nowFn();
        lastMsgAt = nowFn();
        pushLog('info', `Conectando em ${DEFAULT_WS_URL} como ${session.nick}...`);

        const socket = wsFactory(DEFAULT_WS_URL, {
            headers: {
                Origin: DEFAULT_ORIGIN,
                'User-Agent': USER_AGENT,
            },
        });
        ws = socket;

        attachWsListeners(socket, {
            onOpen: () => {
                if (ws !== socket || disposed) return;
                backoffMs = MIN_RECONNECT_MS;
                lastMsgAt = nowFn();
                sendFrame({
                    t: 'hello',
                    nick: session.nick,
                    token: session.token,
                    delta: 1,
                    dispositivo: session.dispositivo,
                });
                pingTimer = setInterval(() => {
                    sendFrame({ t: 'ping' });
                }, pingIntervalMs);
                watchdogTimer = setInterval(() => {
                    if (nowFn() - lastMsgAt > watchdogTimeoutMs) {
                        pushLog('warn', 'Watchdog sem resposta (>35s). Reiniciando socket...');
                        try {
                            socket.close(4000, 'watchdog timeout');
                        } catch {
                            // ja fechado
                        }
                    }
                }, watchdogIntervalMs);
            },
            onMessage: (event) => {
                if (ws !== socket || disposed) return;
                handleMessage(event?.data ?? event);
            },
            onError: (err) => {
                if (ws !== socket || disposed) return;
                const msg = err?.message || err?.error?.message || 'falha no WebSocket';
                lastError = msg;
                pushLog('error', `WebSocket: ${msg}`);
            },
            onClose: (event) => {
                if (ws !== socket) return;
                ws = null;
                clearSocketTimers();
                if (disposed || status === 'paused') return;

                const code = Number(event?.code ?? 0);
                if (code === 4001) {
                    if (config.standbyOn4001) {
                        status = 'standby';
                        pushLog('warn', `Sessao assumida no navegador (4001). Standby de ${config.standbySec}s...`);
                        scheduleReconnect(config.standbySec * 1000);
                    } else {
                        status = 'paused';
                        pushLog('warn', 'Sessao assumida no navegador (4001). Farm pausado.');
                    }
                    return;
                }

                status = 'error';
                const waitMs = backoffMs;
                backoffMs = Math.min(MAX_RECONNECT_MS, backoffMs * 2);
                pushLog('warn', `Conexao fechada (code=${code}). Reconectando em ${Math.round(waitMs / 1000)}s...`);
                scheduleReconnect(waitMs);
            },
        });
        return true;
    };

    const start = () => openConnection();

    const reconnect = () => {
        if (disposed) return false;
        return openConnection();
    };

    const pause = () => {
        clearReconnectTimer();
        clearSniperTimers();
        closeBridgeQuietly();
        closeSocketQuietly(1000, 'paused by user');
        connectionMode = 'headless';
        status = 'paused';
        pushLog('info', 'Farm pausado pelo usuario (conta livre no navegador; Auto-Lives segue ativo).');
    };

    const attachBrowser = (opts = {}) => {
        if (disposed) return false;
        clearReconnectTimer();
        closeBridgeQuietly();
        closeSocketQuietly(1000, 'switching to browser bridge');
        connectionMode = 'browser-bridge';
        economyActive = false;
        field.reset();
        status = 'connecting';
        lastError = null;
        if (!stats.startedAt) stats.startedAt = nowFn();
        runSilentCookieRecoveryIfNeeded();
        pushLog('info', 'Acoplando bot a tela vinculada do PokeIdle (Auto-Catch, Restock, Passe e Prey ativos)...');

        const ctrl = new AbortController();
        bridgeAbortCtrl = ctrl;
        if (!session) {
            try { loadSession(false); } catch { /* segue sem seed se nao houver sessao */ }
        }
        const seedSession = opts.seedSession !== false && session && session.token && session.nick
            ? {
                nick: session.nick,
                token: session.token,
                provedor: session.provedor || null,
                dispositivo: session.dispositivo || null,
            }
            : null;

        Promise.resolve(browserBridgeFactory({
            cwd,
            profileDir: opts.openWindow ? opts.profileDir : browserOptions.profileDir || opts.profileDir || undefined,
            targetId: opts.targetId,
            openWindow: opts.openWindow === true,
            seedSession,
            preferNewTarget: opts.preferNewTarget !== false,
            waitForTargetMs: opts.waitForTargetMs ?? 12_000,
            autoReloadIfMissedWs: opts.autoReloadIfMissedWs !== false,
            signal: ctrl.signal,
            onFrame: (raw) => {
                if (disposed || connectionMode !== 'browser-bridge') return;
                handleMessage(raw);
            },
            onDetach: () => {
                if (disposed || connectionMode !== 'browser-bridge') return;
                closeBridgeQuietly();
                if (status === 'bridge' || status === 'connecting') {
                    status = 'paused';
                    pushLog('info', 'Janela do jogo fechada. Clique em Iniciar para retomar o farm em segundo plano.');
                }
            },
        }))
            .then((bridge) => {
                if (disposed || ctrl.signal.aborted || connectionMode !== 'browser-bridge') {
                    bridge?.close?.();
                    return;
                }
                activeBridge = bridge;
                if (!opts.waitForWelcome) status = 'bridge';
                ensureHuntGuideTimer();
                void checkHuntGuide();
                lastError = null;
                if (status === 'bridge') runTickForState(merger.getState());
                liveBridge.setPaused(false);
                if (config.liveEnabled) {
                    liveBridge.startTimer();
                    liveBridge.runOnce({ force: false });
                }
                pushLog('info', opts.waitForWelcome && status !== 'bridge'
                    ? 'Janela do jogo vinculada. Entre no PokeIdle para iniciar as automações.'
                    : 'Bot vinculado à janela do jogo.');
            })
            .catch((err) => {
                if (disposed || ctrl.signal.aborted || connectionMode !== 'browser-bridge') return;
                status = 'paused';
                lastError = err?.message || 'Falha ao acoplar no navegador';
                pushLog('warn', `Nao foi possivel acoplar via CDP (${lastError}); farm headless pausado.`);
            });

        return true;
    };

    const openGame = async ({ linked = false } = {}) => {
        if (disposed || loginInProgress) return false;
        const exe = options.browserExecutablePath || findChromiumExecutable();
        if (!exe || (!options.browserLauncher && !existsSync(exe))) {
            pushLog('error', 'Chrome ou Edge não encontrado para abrir o jogo.');
            return false;
        }
        const profileDir = getIsolatedProfileDir();
        const activeExistingProfile = getExistingProfile();
        try {
            pause();
            if (activeExistingProfile && !linked) {
                await browserLauncher(activeExistingProfile.exe || desktopBrowser || exe, null, [LOGIN_URLS.pokeidle], activeExistingProfile, {
                    enableRemoteDebugging: false,
                });
                pushLog('info', 'Jogo aberto no seu perfil. Feche a aba e clique em Iniciar para voltar ao farm em segundo plano.');
                return true;
            }
            if (linked) {
                const normalBrowser = activeExistingProfile && await connectActiveBrowserCdp({ profileDir: activeExistingProfile.root });
                if (normalBrowser) {
                    normalBrowser.cdp.close();
                    return attachBrowser({ profileDir: activeExistingProfile.root, openWindow: true, seedSession: false, waitForWelcome: true });
                }
                const isolatedBrowser = await connectActiveBrowserCdp({ profileDir });
                if (isolatedBrowser) isolatedBrowser.cdp.close();
                else await browserLauncher(exe, profileDir, ['about:blank']);
                pushLog('info', 'O navegador habitual não está disponível para vínculo. Abrindo o perfil separado do bot.');
                return attachBrowser({ profileDir, openWindow: true, seedSession: Boolean(session), waitForWelcome: true });
            }
            const active = await connectActiveBrowserCdp({ profileDir });
            let targetId;
            if (active) {
                try {
                    const target = await active.cdp.send('Target.createTarget', { url: LOGIN_URLS.pokeidle, newWindow: true });
                    targetId = target?.targetId;
                    if (!targetId) throw new Error('O navegador não abriu a janela do jogo.');
                } finally {
                    active.cdp.close();
                }
            } else {
                await browserLauncher(exe, profileDir, [LOGIN_URLS.pokeidle]);
            }
            return attachBrowser({
                profileDir, targetId, preferNewTarget: false, seedSession: Boolean(session),
                waitForWelcome: true, autoReloadIfMissedWs: false,
            });
        } catch (err) {
            lastError = err?.message || 'Falha ao abrir o jogo';
            pushLog('error', lastError);
            return false;
        }
    };

    const resolveBrowserLaunchTarget = ({ forLives = false } = {}) => {
        const activeExistingProfile = getExistingProfile();
        if (activeExistingProfile) {
            const exe = activeExistingProfile.exe || desktopBrowser || options.browserExecutablePath || findChromiumExecutable();
            return { exe, profileDir: null, existingProfile: activeExistingProfile };
        }
        const liveDir = getLiveProfileDir();
        const isoDir = getIsolatedProfileDir();
        const profileDir = forLives
            ? (existsSync(liveDir) ? liveDir : (existsSync(isoDir) ? isoDir : liveDir))
            : isoDir;
        const exe = resolveIsolatedExeForDir(profileDir);
        return { exe, profileDir, existingProfile: null };
    };

    const getVoteRemainingMs = (now = nowFn()) => {
        if (!voteState.ativo) return 0;
        if (voteState.availableAt > 0) return Math.max(0, voteState.availableAt - now);
        return Math.max(0, Number(voteState.esperaMs || 0));
    };

    const clearVoteTimers = () => {
        if (voteTimer) {
            clearInterval(voteTimer);
            voteTimer = null;
        }
        if (voteRecheckTimer) {
            clearTimeout(voteRecheckTimer);
            voteRecheckTimer = null;
        }
        if (voteAbortCtrl) {
            try { voteAbortCtrl.abort(); } catch { /* ignore */ }
            voteAbortCtrl = null;
        }
    };

    const refreshVoteStatus = async ({ force = false } = {}) => {
        if (disposed) return voteState;
        if (voteInFlightPromise) return voteInFlightPromise;
        const fetcher = voteFetch || (force ? fetch : null);
        if (!fetcher) return voteState;
        const tok = session?.token || getRawSession()?.token || options.token || '';
        if (!tok) return voteState;
        const now = nowFn();
        if (!force && voteState.checkedAt > 0 && (now - voteState.checkedAt) < 5 * 60_000) {
            return voteState;
        }
        const ac = new AbortController();
        voteAbortCtrl = ac;
        const timeout = setTimeout(() => ac.abort(), 10_000);
        const run = (async () => {
            try {
                const resp = await fetcher('https://pokeidle.io/idlehub/me', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ token: tok }),
                    signal: ac.signal,
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || !data || typeof data !== 'object') {
                    voteState.error = data?.erro || `HTTP ${resp.status}`;
                    voteState.checkedAt = nowFn();
                    return voteState;
                }
                const tNow = nowFn();
                const esperaMs = Math.max(0, Number(data.esperaMs || 0));
                const ativo = Boolean(data.ativo);
                const url = typeof data.url === 'string' && /^https?:\/\//i.test(data.url) ? data.url : '';
                const available = ativo && esperaMs <= 0 && Boolean(url);
                const availKey = available ? `${data.votos ?? 0}:${data.noPar ?? 0}:${data.identificador || session?.nick || ''}` : '';
                const shouldNotify = available && availKey && availKey !== voteState.notifiedAvailableKey;
                voteState = {
                    checkedAt: tNow,
                    ativo,
                    esperaMs,
                    availableAt: esperaMs > 0 ? tNow + esperaMs : 0,
                    votos: Number(data.votos || 0),
                    noPar: Number(data.noPar || 0),
                    votosPorDiamante: Math.max(1, Number(data.votosPorDiamante || 2)),
                    porPar: Math.max(1, Number(data.porPar || 1)),
                    diamantes: Number(data.diamantes || 0),
                    url,
                    identificador: String(data.identificador || session?.nick || ''),
                    error: null,
                    notifiedAvailableKey: available ? availKey : '',
                };
                if (shouldNotify) {
                    pushLog('reward', 'Voto diario disponivel no IdleHub.io! Clique em Votar para ganhar diamantes.');
                }
                return voteState;
            } catch (err) {
                if (!disposed) {
                    voteState.error = err?.message || 'Erro ao consultar voto';
                }
                return voteState;
            } finally {
                clearTimeout(timeout);
                if (voteAbortCtrl === ac) voteAbortCtrl = null;
                if (voteInFlightPromise === run) voteInFlightPromise = null;
            }
        })();
        voteInFlightPromise = run;
        return run;
    };

    const ensureVoteTimer = () => {
        if (disposed || voteTimer || !voteFetch) return;
        voteTimer = setInterval(() => {
            if (disposed || !session?.token) return;
            const rem = getVoteRemainingMs();
            const stale = !voteState.checkedAt || (nowFn() - voteState.checkedAt) >= 15 * 60_000;
            if (stale || (voteState.availableAt > 0 && rem === 0)) {
                void refreshVoteStatus({ force: true });
            }
        }, 60_000);
        voteTimer.unref?.();
    };

    const openVote = async () => {
        if (disposed) return false;
        if (!voteState.url || !voteState.checkedAt) {
            await refreshVoteStatus({ force: true });
        }
        const targetUrl = voteState.url;
        if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
            pushLog('warn', voteState.ativo === false && voteState.checkedAt
                ? 'Vote & Ganhe ainda nao esta ativo no servidor.'
                : 'Link de voto do IdleHub.io ainda nao disponivel. Conecte a conta primeiro.');
            return false;
        }
        const opened = await openExternalUrl(targetUrl, { forLives: false });
        if (opened) {
            pushLog('info', `Pagina de voto (IdleHub.io) aberta no perfil configurado (${voteState.identificador || session?.nick || 'conta'}).`);
            if (voteRecheckTimer) clearTimeout(voteRecheckTimer);
            voteRecheckTimer = setTimeout(() => {
                voteRecheckTimer = null;
                if (!disposed) void refreshVoteStatus({ force: true });
            }, 60_000);
            voteRecheckTimer.unref?.();
        }
        return opened;
    };

    const openExternalUrl = async (url, { forLives = false } = {}) => {
        if (disposed || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
        const { exe, profileDir, existingProfile } = resolveBrowserLaunchTarget({ forLives });
        if (!exe || (!options.browserLauncher && !existsSync(exe))) return false;
        try {
            await browserLauncher(exe, profileDir, [url], existingProfile, {
                enableRemoteDebugging: false,
            });
            return true;
        } catch (err) {
            pushLog('error', `Falha ao abrir link no navegador da conta: ${err.message}`);
            return false;
        }
    };

    const openLives = async (selectedUrl, { chatOnly = false } = {}) => {
        if (disposed) return false;
        const onlineUrls = liveBridge.officialLiveUrls();
        const urls = selectedUrl === undefined ? onlineUrls : onlineUrls.filter((url) => url === selectedUrl);
        if (!urls.length) {
            pushLog('info', selectedUrl === undefined
                ? 'Nenhuma live oficial online recebida. Conecte ao Pokeidle e tente quando houver lives.'
                : 'O canal selecionado não consta mais na lista de lives oficiais online.');
            return false;
        }
        const { exe, profileDir, existingProfile } = resolveBrowserLaunchTarget({ forLives: true });
        if (!exe || (!options.browserLauncher && !existsSync(exe))) {
            pushLog('error', 'Chrome ou Edge não encontrado para abrir as lives.');
            return false;
        }
        try {
            const destinations = chatOnly ? urls.map((url) => {
                const channel = new URL(url);
                const name = channel.pathname.slice(1);
                return channel.hostname === 'kick.com'
                    ? `https://kick.com/popout/${name}/chat`
                    : `https://www.twitch.tv/popout/${name}/chat`;
            }) : urls;
            await browserLauncher(exe, profileDir, destinations, existingProfile, {
                enableRemoteDebugging: false,
            });
            const browserName = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave' }[getBrowserKeyFromExe(exe)] || 'navegador';
            const targetDesc = existingProfile
                ? `em ${existingProfile.label || existingProfile.name}`
                : `no ${browserName} (perfil isolado desta conta)`;
            pushLog('info', chatOnly ? `Chat oficial aberto ${targetDesc}.`
                : `Abertura de ${urls.length} lives oficiais solicitada ${targetDesc}.`);
            return true;
        } catch (err) {
            pushLog('error', `Falha ao abrir lives: ${err.message}`);
            return false;
        }
    };

    const openPanel = async (port, { extensions = false } = {}) => {
        const { exe, profileDir, existingProfile } = resolveBrowserLaunchTarget({ forLives: false });
        if (disposed || !exe || (!options.browserLauncher && !existsSync(exe))) return false;
        try {
            const url = extensions ? (/msedge\.exe$/i.test(exe) ? 'edge://extensions/' : 'chrome://extensions/') : `http://localhost:${port}/`;
            await browserLauncher(exe, profileDir, [url], existingProfile, {
                enableRemoteDebugging: false,
            });
            return true;
        } catch (err) {
            pushLog('error', `Falha ao abrir o painel no navegador da conta: ${err.message}`);
            return false;
        }
    };

    const flushPendingHunt = () => {
        clearHuntFlushTimer();
        if (disposed || !pendingHuntSlug) return false;
        const isOnline = status === 'connected' || status === 'bridge';
        if (!isOnline) return false;
        const state = merger.getState();
        if (state?.huntSlug === pendingHuntSlug) {
            pendingHuntSlug = null;
            return true;
        }
        const waitMs = Math.max(getCombatLockMs(state), getHuntSwapLockMs());
        if (waitMs > 0 || hasFieldCatchPriority(state)) {
            schedulePendingHuntFlush();
            return false;
        }
        const slug = pendingHuntSlug;
        pendingHuntSlug = null;
        const huntLabel = catalog.huntNames?.[slug] || slug;
        if (sendFrame({ t: 'hunt.select', slug })) {
            tracker.lastHuntSlug = slug;
            pushLog('ok', `Troca de hunt executada: ${huntLabel}`);
            return true;
        }
        pendingHuntSlug = slug;
        return false;
    };

    const schedulePendingHuntFlush = () => {
        clearHuntFlushTimer();
        if (disposed || !pendingHuntSlug) return;
        const stNow = merger.getState();
        const waitMs = Math.max(getCombatLockMs(stNow), getHuntSwapLockMs());
        const fieldBusy = hasFieldCatchPriority(stNow);
        if (waitMs <= 0 && !fieldBusy) {
            flushPendingHunt();
            return;
        }
        const delayMs = waitMs > 0 ? Math.min(waitMs + 80, 15_000) : 1300;
        huntFlushTimer = setTimeout(() => {
            huntFlushTimer = null;
            flushPendingHunt();
        }, delayMs);
        huntFlushTimer.unref?.();
    };

    const cancelPendingHunt = () => {
        const had = Boolean(pendingHuntSlug);
        pendingHuntSlug = null;
        clearHuntFlushTimer();
        if (had) pushLog('info', 'Troca de hunt agendada cancelada.');
        return had;
    };

    const goCenter = () => {
        const isOnline = status === 'connected' || status === 'bridge';
        if (!isOnline) {
            pushLog('warn', 'Centro Médico requer a conta conectada.');
            return false;
        }
        const state = merger.getState();
        if (state?.noCentro) {
            if (sendFrame({ t: 'centro.curar' })) {
                pushLog('ok', 'Equipe curada no Centro Médico.');
                return true;
            }
            return false;
        }
        const combatMs = getCombatLockMs(state);
        if (combatMs > 0) {
            pushLog('warn', `Em combate: aguarde ${(combatMs / 1000).toFixed(1)}s para ir ao Centro Médico.`);
            return false;
        }
        if (hasFieldCatchPriority(state)) {
            pushLog('warn', 'Aguardando captura de caído/Shiny antes de ir ao Centro Médico.');
            return false;
        }
        if (sendFrame({ t: 'centro.ir' })) {
            pushLog('ok', 'Indo para o Centro Médico.');
            return true;
        }
        return false;
    };

    const setHunt = (slug) => {
        const cleanSlug = typeof slug === 'string' && slug.trim() ? slug.trim() : null;
        if (!cleanSlug) return false;
        config = normalizeConfigPatch(config, { targetHuntSlug: cleanSlug });
        persistConfig(configPath, config);
        const huntLabel = catalog.huntNames?.[cleanSlug] || cleanSlug;
        const isOnline = status === 'connected' || status === 'bridge';
        if (isOnline) {
            const state = merger.getState();
            const waitMs = Math.max(getCombatLockMs(state), getHuntSwapLockMs());
            if (waitMs > 0) {
                pendingHuntSlug = cleanSlug;
                schedulePendingHuntFlush();
                pushLog('info', `Troca para ${huntLabel} agendada (aguardando ${(waitMs / 1000).toFixed(1)}s fora de combate).`);
                return true;
            }
            pendingHuntSlug = null;
            clearHuntFlushTimer();
            if (sendFrame({ t: 'hunt.select', slug: cleanSlug })) {
                tracker.lastHuntSlug = cleanSlug;
                pushLog('ok', `Troca de hunt enviada: ${huntLabel}`);
                return true;
            }
        }
        pushLog('info', `Hunt padrao atualizada para: ${huntLabel}`);
        return true;
    };

    const updateConfig = (patch = {}) => {
        const prevGuideMode = config.huntGuideMode;
        const prevGuideMetric = config.huntGuideMetric;
        const prevFarmObjective = config.farmObjective;
        const prevFarmObjectiveFocus = config.farmObjectiveFocus;
        const prevEcoMode = config.economyMode;
        const prevPingOnly = config.economyPingOnly;
        const prevCaidosEnabled = config.caidosEnabled;
        const prevLiveEnabled = config.liveEnabled;
        const prevBrowserProfile = config.browserProfile;
        const prevPotionsKey = JSON.stringify(config.preferredPotionIds || []);
        const prevPvpQueue = Boolean(config.pvpQueue);
        const prevSniperEnabled = Boolean(config.sniperEnabled);
        const prevSniperInterval = Number(config.sniperIntervalSec || 30);
        const prevTrainerEnabled = Boolean(config.trainerEnabled);
        config = normalizeConfigPatch(config, patch);
        if (prevSniperEnabled !== Boolean(config.sniperEnabled) || prevSniperInterval !== Number(config.sniperIntervalSec || 30) || patch.sniperRules !== undefined) {
            if (config.sniperEnabled && (status === 'connected' || status === 'bridge')) {
                scheduleSniperTimer();
            } else if (!config.sniperEnabled) {
                clearSniperTimers();
            }
        }
        if (config.trainerEnabled && (status === 'connected' || status === 'bridge') &&
            (!prevTrainerEnabled || patch.trainerQueue !== undefined || patch.trainerMode !== undefined || patch.trainerStepLevels !== undefined)) {
            const stNow = merger.getState();
            if (stNow) runTickForState(stNow);
        }
        if (prevPvpQueue !== Boolean(config.pvpQueue)) {
            const wasInQueue = Boolean(tracker.pvp?.na);
            tracker.pvp = {};
            if (config.pvpQueue) pushLog('info', 'Fila de PvP ligada: a conta entra na fila e volta depois de cada partida.');
            else {
                if (wasInQueue) sendActions([{ t: 'pvp.fila.sair' }]);
                pushLog('info', 'Fila de PvP desligada.');
            }
        }
        if (JSON.stringify(config.preferredPotionIds || []) !== prevPotionsKey) {
            tracker.lastAutoSetAt = 0;
        }
        const guideChanged = prevGuideMode !== config.huntGuideMode || prevGuideMetric !== config.huntGuideMetric;
        const objectiveChanged = prevFarmObjective !== config.farmObjective || prevFarmObjectiveFocus !== config.farmObjectiveFocus;
        if (guideChanged || objectiveChanged) {
            if (guideChanged) {
                huntGuideStatus = null;
                huntGuideTarget = null;
                huntGuideSwapAt = null;
            }
            if (objectiveChanged) {
                objectiveTargetSlug = null;
                objectiveRotateFromSlug = null;
                objectiveLastDecision = null;
                objectiveLastLogKey = '';
                if (prevFarmObjectiveFocus !== config.farmObjectiveFocus) {
                    huntGuideRanking = null;
                }
            }
            const isOnlineNow = status === 'bridge' || status === 'connected';
            const needGuideNow = config.huntGuideMode !== 'off' || config.farmObjective !== 'off';
            if (needGuideNow && isOnlineNow) {
                ensureHuntGuideTimer();
                if (config.farmObjective === 'topcatch') {
                    requestTopCatchSync({ force: true, includeRanking: true });
                }
                void checkHuntGuide();
                if (config.farmObjective === 'pokedex' || config.farmObjective === 'topcatch') {
                    const waitingInitialRank = Boolean(
                        huntGuideRequest &&
                        config.farmObjectiveFocus !== 'fast' &&
                        huntGuideRanking?.metric !== config.farmObjectiveFocus
                    );
                    evaluateFarmObjective({ triggerSwap: !waitingInitialRank });
                }
            } else if (!needGuideNow) {
                clearHuntGuideTimer();
            }
        }
        persistConfig(configPath, config);

        if (config.browserProfile !== prevBrowserProfile) {
            if (loginAbortCtrl) {
                try { loginAbortCtrl.abort(); } catch { /* ignore */ }
            }
            session = null;
            lastError = null;
            const activeExistingProfile = getExistingProfile();
            pushLog(
                'info',
                activeExistingProfile
                    ? `Perfil do navegador definido para ${activeExistingProfile.name}. Clique em "Usar sessão do Chrome" ou "Logar PokeIdle".`
                    : 'Perfil do navegador definido para o perfil isolado desta conta.'
            );
        }

        const state = merger.getState();
        const isLiveOnline = Boolean(
            (ws && ws.readyState === 1) ||
            (connectionMode === 'browser-bridge' && activeBridge && activeBridge.isReady())
        );
        const ecoChanged = config.economyMode !== prevEcoMode ||
            config.economyPingOnly !== prevPingOnly ||
            config.caidosEnabled !== prevCaidosEnabled;
        if (connectionMode !== 'browser-bridge' && ws && ws.readyState === 1 && ecoChanged) {
            const nextEco = resolveEconomyFlag(state);
            if (nextEco !== economyActive || config.economyMode !== prevEcoMode || config.economyPingOnly !== prevPingOnly) {
                economyActive = nextEco;
                if (!economyActive) {
                    campoFeedDegraded = false;
                    battleKillsWithoutCampo = 0;
                }
                sendFrame({ t: 'cliente.economia', ativo: economyActive });
                pushLog(
                    'info',
                    config.economyPingOnly
                        ? 'Modo Economia (So Ping): ON (apenas keepalive).'
                        : `Modo economia atualizado no servidor: ${economyActive ? 'ON' : 'OFF'}`
                );
            }
        }
        if (config.economyPingOnly && !prevPingOnly) {
            pushLog('warn', 'Aviso de limitação: Modo Somente Ping pausa captura, Shiny, restock, passe, prey e /hunt.');
        } else if (config.economyMode === 'on' && prevEcoMode !== 'on' && !config.economyPingOnly) {
            pushLog('warn', 'Aviso de limitação: Economia do servidor corta o feed de campo e o bot passa a achar os caídos pelos eventos de batalha.');
        }
        if (config.caidosEnabled === false && prevCaidosEnabled !== false) {
            pushLog('warn', 'Aviso de limitação: Captura automática desligada (o bot não vai jogar Pokébolas em caídos nem em Shinies).');
        }
        if (config.liveEnabled !== prevLiveEnabled) {
            if (config.liveEnabled) {
                liveBridge.setPaused(false);
                liveBridge.startTimer();
                liveBridge.runOnce({ force: false });
            } else {
                liveBridge.stopTimer();
            }
        }
        if (state && isLiveOnline) {
            runTickForState(state);
        }
        pushLog('info', 'Configuracoes salvas.');
        return { ...config };
    };

    const triggerAction = (name) => {
        const state = merger.getState();
        const isOnline = Boolean(
            (ws && ws.readyState === 1) ||
            (connectionMode === 'browser-bridge' && activeBridge && activeBridge.isReady())
        );
        if (name === 'restock') {
            if (!state || !isOnline) {
                pushLog('warn', 'Restock manual requer o farm conectado ou acoplado.');
                return false;
            }
            tracker.lastRestockAt = 0;
            const actions = runTickForState(state, { ignorePingOnly: true, forceRestock: true });
            const bought = actions.filter((a) => a?.t === 'shop.buy');
            if (bought.length === 0) {
                const report = tracker.lastRestockReport;
                if (report?.blockedByGold) {
                    const goldFmt = Number(report.currentGold || 0).toLocaleString('pt-BR');
                    const reserveFmt = Number(report.reserveGold || 0).toLocaleString('pt-BR');
                    pushLog(
                        'warn',
                        `Restock manual sem gold disponível (${goldFmt} / reserva ${reserveFmt}). Reduza "Reserva mínima gold" em Automação.`
                    );
                } else {
                    pushLog('info', 'Restock manual: estoque ja atingiu o alvo configurado.');
                }
            }
            return true;
        }
        if (name === 'pass') {
            if (sendFrame({ t: 'passe.resgatar' })) {
                pushLog('reward', 'Resgate manual do Passe Diario enviado.');
                return true;
            }
            pushLog('warn', 'Resgate do Passe requer o farm headless conectado.');
            return false;
        }
        if (name === 'prey') {
            if (!state || !isOnline) {
                pushLog('warn', 'Prey manual requer o farm headless conectado.');
                return false;
            }
            tracker.lastPreyActionAt = 0;
            runTickForState(state, { ignorePingOnly: true });
            return true;
        }
        if (name === 'heal') {
            if (sendFrame({ t: 'centro.curar' })) {
                pushLog('info', 'Comando de cura no Centro enviado.');
                return true;
            }
            pushLog('warn', 'Cura no Centro requer o farm headless conectado.');
            return false;
        }
        if (name === 'go-center') {
            return goCenter();
        }
        if (name === 'cancel-pending-hunt') {
            return cancelPendingHunt();
        }
        if (name === 'reload-session') {
            try {
                const activeExistingProfile = getExistingProfile();
                if (loginInProgress) {
                    loginAbortCtrl?.abort();
                }
                const current = readCurrentProfileGameSession();
                if (current) {
                    pause();
                    adoptGameSession(current);
                    pushLog(
                        'ok',
                        activeExistingProfile
                            ? `Sessão de ${current.nick} importada do perfil ${activeExistingProfile.name}. Feche a aba do jogo e clique em Iniciar.`
                            : `Sessão de ${current.nick} importada do perfil desta conta. Feche a aba do jogo e clique em Iniciar.`
                    );
                    return true;
                }
                if (activeExistingProfile) {
                    throw new Error(`Nenhuma sessão válida no perfil ${activeExistingProfile.name}. Entre no Pokeidle nesse perfil e tente novamente.`);
                }
                loadSession(true);
                pushLog('ok', `Sessao recarregada: ${session.nick} (${session.source}).`);
                return true;
            } catch (err) {
                lastError = err?.message || 'Erro ao recarregar sessao';
                pushLog('error', lastError);
                return false;
            }
        }
        if (name === 'cancel-login') {
            if (!loginInProgress || !loginAbortCtrl) return false;
            try { loginAbortCtrl.abort(); } catch { /* ignore */ }
            pushLog('info', `Login (${loginInProgress}) cancelado.`);
            return true;
        }
        if (name === 'run-lives') {
            liveBridge.runOnce({ force: true });
            return true;
        }
        if (name === 'refresh-lives') {
            void liveBridge.refreshBalances();
            return true;
        }
        if (name === 'reset-stats') {
            const isOnlineNow = status === 'connected' || status === 'bridge';
            stats = createFreshStats(isOnlineNow ? nowFn() : null);
            dropCounts.clear();
            recentDrops.length = 0;
            recentRareDrops.length = 0;
            seenShinySlots.clear();
            pendingShinies.clear();
            pushLog('info', 'Estatísticas e drops da sessão zerados.');
            return true;
        }
        if (name === 'refresh-vote') {
            void refreshVoteStatus({ force: true });
            return true;
        }
        if (name === 'refresh-topcatch') {
            const sent = requestTopCatchSync({ force: true, includeRanking: true });
            if (config.farmObjective !== 'off') void checkHuntGuide();
            return sent;
        }
        if (name === 'sniper-scan-now') {
            return requestSniperSummary({ force: true });
        }
        if (name === 'trainer-step-now') {
            const st = merger.getState();
            if (!st) return false;
            runTickForState(st);
            return true;
        }
        return false;
    };

    const getSnapshot = ({ includeHunts = true, advisorLists = true } = {}) => {
        const now = nowFn();
        const state = merger.getState();
        const currentSlug = state?.huntSlug || tracker.lastHuntSlug || null;
        const active = (state?.pokemons || []).find((p) => p && p.id === state?.activeId) || null;
        const uptimeMs = stats.startedAt ? Math.max(0, now - stats.startedAt) : 0;
        const uptimeSec = Math.floor(uptimeMs / 1000);
        const hours = uptimeMs > 1000 ? uptimeMs / 3_600_000 : 0;
        const mins = uptimeMs > 1000 ? uptimeMs / 60_000 : 0;

        const payload = session?.payload || (session?.token ? decodeJwtPayload(session.token) : null);
        const safeConfig = { ...config };
        delete safeConfig.liveTwitchToken;
        delete safeConfig.liveKickToken;

        const activeExistingProfile = getExistingProfile();

        const avgKillSec = stats.killDeltaCount > 0
            ? Number((stats.killDeltaSumMs / stats.killDeltaCount / 1000).toFixed(2))
            : (stats.kills > 0 && uptimeSec > 0 ? Number((uptimeSec / stats.kills).toFixed(2)) : 0);
        const capturePerKillPct = stats.kills > 0
            ? Number(((stats.captures / stats.kills) * 100).toFixed(1))
            : 0;
        const killsPerCapture = stats.captures > 0
            ? Number((stats.kills / stats.captures).toFixed(2))
            : 0;
        const ballsPerCapture = stats.captures > 0
            ? Number((stats.ballsThrown / stats.captures).toFixed(2))
            : 0;
        const catchPerBallPct = stats.ballsThrown > 0
            ? Number(((stats.captures / stats.ballsThrown) * 100).toFixed(1))
            : 0;
        const netGold = stats.goldGained - stats.spentGold;
        const currentHuntInfo = currentSlug ? (catalog.huntsBySlug?.[currentSlug] || null) : null;
        const huntFocusInfo = resolveHuntFocus(currentHuntInfo, state);

        const hiddenCats = new Set(Array.isArray(config.dropHideCategories) ? config.dropHideCategories : []);
        const hiddenItems = new Set(Array.isArray(config.dropHideItems) ? config.dropHideItems : []);
        const isDropVisible = (entry) => !hiddenCats.has(entry.category) && !hiddenItems.has(entry.key);

        const featuredDrops = [];
        const featuredKeys = new Set();
        for (const item of SESSION_DROP_CATALOG) {
            const rec = dropCounts.get(item.key);
            const qty = rec?.qty || 0;
            if (item.area === huntFocusInfo.focus || qty > 0) {
                featuredKeys.add(item.key);
                const entry = {
                    key: item.key,
                    itemId: item.id,
                    name: item.name,
                    area: item.area,
                    category: item.area,
                    rare: true,
                    qty,
                    perHour: hours > 0 ? Number((qty / hours).toFixed(2)) : 0,
                    bagQty: Number(state?.items?.[item.id] || 0),
                    lastTime: rec?.lastAt ? formatLogTime(rec.lastAt) : null,
                };
                if (isDropVisible(entry)) featuredDrops.push(entry);
            }
        }
        for (const [key, rec] of dropCounts.entries()) {
            if (featuredKeys.has(key) || rec.qty <= 0) continue;
            const entry = {
                key,
                itemId: rec.itemId,
                name: rec.name,
                area: rec.area,
                category: rec.category || classifyDropCategory(null, rec.name),
                rare: rec.rare,
                qty: rec.qty,
                perHour: hours > 0 ? Number((rec.qty / hours).toFixed(2)) : 0,
                bagQty: rec.itemId != null ? Number(state?.items?.[rec.itemId] || 0) : null,
                lastTime: rec.lastAt ? formatLogTime(rec.lastAt) : null,
            };
            if (isDropVisible(entry)) featuredDrops.push(entry);
        }
        featuredDrops.sort((a, b) => (b.qty - a.qty) || Number(b.rare) - Number(a.rare) || a.name.localeCompare(b.name));
        const visibleRecent = recentDrops.filter((r) => isDropVisible(r)).slice(0, 15);
        const visibleTotal = featuredDrops.reduce((sum, d) => sum + d.qty, 0);

        const isOnlineSnap = status === 'connected' || status === 'bridge';
        const combatLockMs = isOnlineSnap ? getCombatLockMs(state) : 0;
        const huntSwapLockMs = isOnlineSnap ? getHuntSwapLockMs() : 0;
        const normalizedProfileSetting = (!options.useExistingBrowser && config.browserProfile === 'isolated')
            ? ''
            : (config.browserProfile && activeExistingProfile?.id ? activeExistingProfile.id : (config.browserProfile || ''));

        const modeWarnings = computeModeWarnings({
            config,
            status,
            mode: connectionMode,
            economyActive,
            campoFeedDegraded,
        });

        const serverNowSnap = now + serverClockOffsetMs;
        const weeklySetSnap = getEffectiveWeeklyCaughtSet();
        const colSummary = computeCollectionSummary({
            hunts: catalog.huntsList,
            trainerLevel: Number(state?.level || 0),
            pokedex: state?.pokedex || null,
            weeklyCaughtSet: weeklySetSnap,
            extraPokedexKeys: optimisticPokedexKeys,
        });
        const tcWindow = getTopCatchWeekWindow(topCatchState.week || state?.topCatch?.s || null, serverNowSnap);
        const tcCount = Math.max(topCatchState.count, topCatchState.keys.size);
        const tcMilestone = getTopCatchMilestoneProgress(tcCount, topCatchState.paidMilestone);
        const tcRanking = computeTopCatchRankingPosition(
            state?.nick || session?.nick || '',
            tcCount,
            Number(state?.level || 0),
            topCatchState.rankingRows
        );
        const objDec = (config.farmObjective === 'pokedex' || config.farmObjective === 'topcatch')
            ? (objectiveLastDecision || evaluateFarmObjective({ triggerSwap: false }))
            : null;
        const collectionSnap = {
            mode: config.farmObjective || 'off',
            focus: config.farmObjectiveFocus || 'xp',
            statusText: objDec?.statusText || '',
            loading: Boolean(objDec?.loading),
            completed: Boolean(objDec?.completed),
            usedHuntGuide: Boolean(objDec?.usedHuntGuide),
            targetSlug: objDec?.targetSlug || null,
            targetName: objDec?.targetName || null,
            targetLevel: Number(objDec?.targetLevel || 0),
            targetMetricLabel: objDec?.targetMetricLabel || '',
            currentMissing: Array.isArray(objDec?.currentMissing) ? objDec.currentMissing : [],
            pokedex: colSummary.pokedex,
            topCatch: {
                week: tcWindow.week,
                startMs: tcWindow.startMs,
                endMs: tcWindow.endMs,
                remainingMs: tcWindow.remainingMs,
                ending: tcWindow.ending,
                loaded: topCatchState.loaded,
                ini: topCatchState.ini,
                count: tcCount,
                unlockedTotal: colSummary.topCatch.unlockedTotal,
                unlockedCaptured: colSummary.topCatch.unlockedCaptured,
                unlockedMissing: colSummary.topCatch.unlockedMissing,
                unlockedPendingHunts: colSummary.topCatch.unlockedPendingHunts,
                pct: colSummary.topCatch.pct,
                milestone: tcMilestone,
                ranking: tcRanking,
                previousWeek: topCatchState.previousWeek,
            },
        };

        const xpTrainerPlan = evaluateTrainerPlan({
            state,
            config: { ...config, trainerEnabled: false },
            tracker: trainerTracker,
            nowMs: now + serverClockOffsetMs,
            catalog,
        });
        const locRank = { equipe: 0, colecao: 1, depot: 2 };
        const availablePokemons = (state?.pokemons || [])
            .filter((p) => p && p.id != null)
            .map((p) => {
                const spId = Number(p.speciesId || 0) || null;
                const nm = p.apelido || p.nome || p.name || (spId != null ? catalog.pokemonNames?.[spId] : '') || `#${p.id}`;
                const loc = getPokemonLocation(p, state);
                return {
                    id: p.id,
                    speciesId: spId,
                    spriteDex: resolvePokemonSpriteDex(spId, nm, catalog.pokemonDexByName) || null,
                    name: nm,
                    level: Number(p.level ?? p.nivel ?? 1) || 1,
                    shiny: Boolean(p.shiny),
                    location: loc,
                    hasExpShare: Number(p.heldItemId) === XP_SHARE_HELD_ID,
                    inHouse: xpTrainerPlan.summary.queue.some((q) => String(q.pokemonId) === String(p.id) && q.inHouse),
                    isActive: state?.activeId != null && String(state.activeId) === String(p.id),
                };
            })
            .sort((a, b) => (locRank[a.location] - locRank[b.location]) || (b.level - a.level) || a.name.localeCompare(b.name))
            .slice(0, 150);

        const pendingByRule = sniperPendingQtyByRule();
        const enrichedSniperRules = (config.sniperRules || []).map((r) => {
            if (r.kind === 'pokemon') {
                const st = sniperPokemonStats[r.id] || null;
                return { ...r, currentMinPrice: st ? st.minPrice : null, avgPrice: null, pendingQty: pendingByRule.get(r.id) || 0 };
            }
            const sum = marketSummary?.[r.itemId] || marketSummary?.[String(r.itemId)] || null;
            const currentMinPrice = sum ? (r.currency === 'orb' ? (sum.minOrb ?? null) : (sum.minGold ?? null)) : null;
            const avgRaw = marketMedias?.[r.itemId] || marketMedias?.[String(r.itemId)] || null;
            const avgPrice = avgRaw ? (r.currency === 'orb' ? (avgRaw.orb ?? null) : (avgRaw.gold ?? null)) : null;
            return { ...r, currentMinPrice, avgPrice, pendingQty: pendingByRule.get(r.id) || 0 };
        });

        const speciesById = new Map();
        for (const [idStr, nm] of Object.entries(catalog.pokemonNames || {})) {
            const idNum = Number(idStr);
            if (Number.isInteger(idNum) && idNum > 0 && nm) speciesById.set(idNum, String(nm));
        }
        for (const p of state?.pokemons || []) {
            const spId = Number(p?.speciesId ?? p?.pokeId ?? 0);
            const nm = p?.nome || p?.name;
            if (Number.isInteger(spId) && spId > 0 && nm && !speciesById.has(spId)) {
                speciesById.set(spId, String(nm));
            }
        }
        const marketSpecies = [...speciesById.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return {
            version: APP_VERSION,
            status,
            mode: connectionMode,
            lastError,
            modeWarnings,
            campoFeedDegraded,
            loginInProgress,
            browserProfile: activeExistingProfile?.name || null,
            browserProfileSetting: normalizedProfileSetting,
            browserProfiles: buildBrowserProfileOptions(),
            huntGuide: huntGuideStatus,
            collection: collectionSnap,
            xpTrainer: {
                ...xpTrainerPlan.summary,
                availablePokemons,
            },
            sniper: {
                enabled: Boolean(config.sniperEnabled),
                intervalSec: Number(config.sniperIntervalSec || 30),
                minGoldReserve: Number(config.sniperMinGoldReserve || 0),
                minOrbsReserve: Number(config.sniperMinOrbsReserve || 0),
                gold: Number(state?.gold || 0),
                orbs: Number(state?.orbs || 0),
                rules: enrichedSniperRules,
                recentHits: sniperRecentHits,
                marketItems: catalog.marketItems || [],
                marketSpecies,
            },
            advisor: advisorLists ? buildAdvisorSnapshot(state) : buildAdvisorLite(state),
            session: session ? {
                nick: session.nick,
                contaId: payload?.contaId ?? null,
                provedor: session.provedor ?? payload?.provedor ?? null,
                dispositivo: session.dispositivo ?? null,
                source: session.source ?? null,
                exp: payload?.exp ?? null,
            } : null,
            trainer: {
                nick: state?.nick || session?.nick || '-',
                level: Number(state?.level || 0),
                gold: Number(state?.gold || 0),
                diamonds: Number(state?.diamonds || 0),
                huntSlug: currentSlug,
                huntName: currentSlug ? (catalog.huntNames?.[currentSlug] || currentSlug) : '-',
                huntArea: currentHuntInfo?.area || '',
                huntFocus: huntFocusInfo.focus,
                huntFocusLabel: huntFocusInfo.label,
                noCentro: Boolean(state?.noCentro),
                combatLockMs,
                huntSwapLockMs,
                centroLivreAt: combatLockMs > 0 ? now + combatLockMs : 0,
                trocaHuntLivreAt: huntSwapLockMs > 0 ? now + huntSwapLockMs : 0,
                canGoCenter: isOnlineSnap && (Boolean(state?.noCentro) || (Boolean(currentSlug) && combatLockMs === 0)),
                canSwapHunt: isOnlineSnap && combatLockMs === 0 && huntSwapLockMs === 0,
                pendingHuntSlug,
                pendingHuntName: pendingHuntSlug ? (catalog.huntNames?.[pendingHuntSlug] || pendingHuntSlug) : null,
                vip: Boolean(state?.loja?.vip),
                economyActive,
            },
            activePokemon: active ? {
                id: active.id,
                speciesId: Number(active.speciesId || 0),
                spriteDex: resolvePokemonSpriteDex(active.speciesId, active.nome || active.name || catalog.pokemonNames?.[active.speciesId] || '', catalog.pokemonDexByName) || null,
                name: active.nome || active.name || catalog.pokemonNames?.[active.speciesId] || `#${active.speciesId ?? '?'}`,
                level: Number(active.level || 0),
                hp: Number(active.hp || 0),
                maxHp: Math.max(1, Number(active.maxHp || 1)),
                hpPercent: Math.max(0, Math.min(100, Math.round((Number(active.hp || 0) / Math.max(1, Number(active.maxHp || 1))) * 100))),
                shiny: Boolean(active.shiny),
            } : null,
            inventory: {
                balls: {
                    1: Number(state?.balls?.[1] || 0),
                    2: Number(state?.balls?.[2] || 0),
                    3: Number(state?.balls?.[3] || 0),
                    4: Number(state?.balls?.[4] || 0),
                    5: Number(state?.balls?.[5] || 0),
                },
                items: {
                    [ITEM_IDS.SMALL_POTION]: Number(state?.items?.[ITEM_IDS.SMALL_POTION] || 0),
                    [ITEM_IDS.GREAT_POTION]: Number(state?.items?.[ITEM_IDS.GREAT_POTION] || 0),
                    [ITEM_IDS.ULTRA_POTION]: Number(state?.items?.[ITEM_IDS.ULTRA_POTION] || 0),
                    [ITEM_IDS.HYPER_POTION]: Number(state?.items?.[ITEM_IDS.HYPER_POTION] || 0),
                    [ITEM_IDS.ULTIMATE_POTION]: Number(state?.items?.[ITEM_IDS.ULTIMATE_POTION] || 0),
                    [ITEM_IDS.REVIVE]: Number(state?.items?.[ITEM_IDS.REVIVE] || 0),
                    [ITEM_IDS.MAX_REVIVE]: Number(state?.items?.[ITEM_IDS.MAX_REVIVE] || 0),
                    [ITEM_IDS.GOLDEN_POTION]: Number(state?.items?.[ITEM_IDS.GOLDEN_POTION] || 0),
                },
            },
            stats: {
                ...stats,
                uptimeSec,
                xpPerHour: hours > 0 ? Math.round(stats.xpGained / hours) : 0,
                xpTrainerPerHour: hours > 0 ? Math.round(stats.xpTrainerGained / hours) : 0,
                goldPerHour: hours > 0 ? Math.round(stats.goldGained / hours) : 0,
                netGold,
                netGoldPerHour: hours > 0 ? Math.round(netGold / hours) : 0,
                killsPerMin: mins > 0 ? Number((stats.kills / mins).toFixed(2)) : 0,
                avgKillSec,
                capturePerKillPct,
                killsPerCapture,
                ballsPerCapture,
                catchPerBallPct,
                potionsPerHour: hours > 0 ? Number((stats.heals / hours).toFixed(1)) : 0,
                revivesPerHour: hours > 0 ? Number((stats.revivesUsed / hours).toFixed(1)) : 0,
            },
            drops: {
                focus: huntFocusInfo.focus,
                focusLabel: huntFocusInfo.label,
                total: visibleTotal,
                allTotal: stats.dropsTotal,
                rareCount: stats.rareDropsCount,
                hiddenCategories: [...hiddenCats],
                hiddenItems: [...hiddenItems],
                featured: featuredDrops,
                recent: visibleRecent,
                recentRare: recentRareDrops.slice(0, 15),
            },
            config: safeConfig,
            automation: {
                autoPotion: Boolean(state?.automation?.autoPotion),
                autoRevive: Boolean(state?.automation?.autoRevive),
                autoVoltarHunt: Boolean(state?.automation?.autoVoltarHunt),
                potionIds: Array.isArray(state?.automation?.potionIds) ? state.automation.potionIds.map(Number) : [],
                hpLimiar: Number(state?.automation?.hpLimiar || 0),
            },
            lives: liveBridge.getLivesSnapshot(),
            vote: (() => {
                const remMs = getVoteRemainingMs(now);
                return {
                    checkedAt: voteState.checkedAt,
                    ativo: voteState.ativo,
                    available: Boolean(voteState.ativo && remMs === 0 && voteState.url),
                    remainingMs: remMs,
                    availableAt: remMs > 0 ? now + remMs : 0,
                    votos: voteState.votos,
                    noPar: voteState.noPar,
                    votosPorDiamante: voteState.votosPorDiamante,
                    porPar: voteState.porPar,
                    diamantes: voteState.diamantes,
                    url: voteState.url,
                    identificador: voteState.identificador,
                    error: voteState.error,
                };
            })(),
            hunts: includeHunts ? catalog.huntsList : undefined,
            huntsCount: catalog.huntsList.length,
            logs: [...logs],
            recentShinies: [...recentShinies],
            ownShinies: [...ownShinies],
            missedShinies: [...missedShinies],
        };
    };

    const attachExternalBridge = (bridge, { waitForWelcome = true } = {}) => {
        if (disposed || !bridge) return null;
        clearReconnectTimer();
        closeBridgeQuietly();
        closeSocketQuietly(1000, 'switching to embedded webview');
        connectionMode = 'browser-bridge';
        economyActive = false;
        field.reset();
        status = waitForWelcome ? 'connecting' : 'bridge';
        lastError = null;
        if (!stats.startedAt) stats.startedAt = nowFn();
        activeBridge = bridge;
        ensureHuntGuideTimer();
        liveBridge.setPaused(false);
        if (config.liveEnabled) {
            liveBridge.startTimer();
            liveBridge.runOnce({ force: false });
        }
        pushLog('info', 'Navegador embutido conectado. Aguardando jogo carregar...');
        return {
            onFrame: (raw) => {
                if (disposed || connectionMode !== 'browser-bridge' || activeBridge !== bridge) return;
                handleMessage(raw);
            },
            onDetach: () => {
                if (disposed || activeBridge !== bridge) return;
                closeBridgeQuietly();
                connectionMode = 'headless';
                if (status === 'bridge' || status === 'connecting') {
                    status = 'paused';
                    pushLog('info', 'Navegador embutido desconectado.');
                }
            },
        };
    };

    const getRawSession = () => {
        if (!session) {
            try { loadSession(false); } catch { return null; }
        }
        return session?.token && session?.nick
            ? {
                nick: session.nick,
                token: session.token,
                provedor: session.provedor || null,
                dispositivo: session.dispositivo || null,
            }
            : null;
    };

    const getLiveCredentials = () => ({
        twitchToken: config.liveTwitchToken || '',
        twitchDeviceId: config.liveTwitchDeviceId || '',
        kickToken: config.liveKickToken || '',
    });

    const syncWebviewSession = (rawObj) => {
        try {
            const parsed = parseImportedSessionInput(rawObj);
            if (session?.token === parsed.token && session?.nick === parsed.nick) return false;
            const cacheTarget = options.sessionFile ? resolve(options.sessionFile) : resolve(cwd, '.pokebot-session.json');
            saveSessionCache(cacheTarget, parsed);
            session = {
                ...parsed,
                payload: decodeJwtPayload(parsed.token),
                source: 'webview',
                cachePath: cacheTarget,
            };
            pushLog('ok', `Sessão de ${parsed.nick} sincronizada do navegador embutido.`);
            return true;
        } catch {
            return false;
        }
    };

    const stop = () => {
        disposed = true;
        if (loginAbortCtrl) {
            try {
                loginAbortCtrl.abort();
            } catch {
                // ignora erro ao abortar login
            }
            loginAbortCtrl = null;
        }
        liveBridge.dispose();
        clearVoteTimers();
        if (options.headlessHuntGuide === undefined) {
            try { headlessHuntGuide?.dispose?.(); } catch { /* ignore */ }
        }
        clearHuntFlushTimer();
        clearCampoDrainTimer();
        clearSniperTimers();
        clearAdvisorTimers();
        try { marketBase.save(); } catch { /* ignore */ }
        pendingHuntSlug = null;
        clearReconnectTimer();
        closeBridgeQuietly();
        closeSocketQuietly(1000, 'shutdown');
        status = 'disconnected';
    };

    return {
        start,
        reconnect,
        pause,
        attachBrowser,
        attachExternalBridge,
        getRawSession,
        getLiveCredentials,
        noteLiveChestClaimed: (channel, source) => liveBridge.noteChestClaimed(channel, source),
        noteLiveWatchSession: (channel, info) => liveBridge.noteWatchSession(channel, info),
        getMissedShinies: () => [...missedShinies],
        syncWebviewSession,
        openGame,
        openLives,
        openPanel,
        openExternalUrl,
        openVote,
        refreshVoteStatus,
        goCenter,
        cancelPendingHunt,
        setHunt,
        updateConfig,
        triggerAction,
        startLogin,
        importSession,
        importLiveTokens,
        getHunts: () => catalog.huntsList,
        getSnapshot,
        getAdvisor: () => buildAdvisorSnapshot(merger.getState()),
        inspectShiny,
        stop,
    };
}

function readJsonBody(req) {
    return new Promise((resolveBody, rejectBody) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 262_144) {
                rejectBody(new Error('Body muito grande'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            if (!raw) {
                resolveBody({});
                return;
            }
            try {
                resolveBody(JSON.parse(raw));
            } catch {
                rejectBody(new Error('JSON invalido'));
            }
        });
        req.on('error', rejectBody);
    });
}

function sendJson(res, statusCode, data) {
    const payload = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    res.end(payload);
}

/**
 * Sobe o servidor HTTP local do Dashboard Web + API de controle do motor headless.
 * @param {object} [options] Configuracoes de porta, host, autoStart e controlador customizado.
 * @returns {Promise<{ server: object, controller: object, port: number, host: string, url: string, close: () => Promise<void> }>} Instancia pronta.
 */
export async function startGuiServer(options = {}) {
    const port = options.port ?? 17890;
    const host = options.host || '127.0.0.1';
    const autoStart = options.autoStart !== false;
    const dashboardPath = options.dashboardPath || DEFAULT_DASHBOARD_PATH;

    const controller = options.controller || createHeadlessController(options);
    const cachedHtml = existsSync(dashboardPath)
        ? readFileSync(dashboardPath, 'utf8')
        : '<!doctype html><html><body><h1>PokeBot GUI</h1></body></html>';

    let closing = false;
    let server;

    const close = async () => {
        if (closing) return;
        closing = true;
        controller.stop();
        await new Promise((res) => {
            if (!server) {
                res();
                return;
            }
            const timer = setTimeout(res, 300);
            server.close(() => {
                clearTimeout(timer);
                res();
            });
            server.closeAllConnections?.();
        });
    };

    server = createServer(async (req, res) => {
        const urlPath = (req.url || '/').split('?')[0];
        const boundPort = server.address()?.port;
        const allowedHosts = [`${host}:${boundPort}`];
        if (host === '127.0.0.1') allowedHosts.push(`localhost:${boundPort}`);
        if (!allowedHosts.includes(req.headers.host) ||
            (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
            sendJson(res, 403, { ok: false, error: 'O painel aceita apenas requisições locais da própria página.' });
            return;
        }

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method === 'GET' && urlPath === '/') {
            const html = existsSync(dashboardPath) ? readFileSync(dashboardPath, 'utf8') : cachedHtml;
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            res.end(html);
            return;
        }

        if (req.method === 'GET' && urlPath === '/assets/nexo-pokebot-icon.png' && existsSync(DEFAULT_ICON_PNG_PATH)) {
            res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
            res.end(readFileSync(DEFAULT_ICON_PNG_PATH));
            return;
        }

        if (req.method === 'GET' && urlPath === '/favicon.ico' && existsSync(DEFAULT_ICON_ICO_PATH)) {
            res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'public, max-age=3600' });
            res.end(readFileSync(DEFAULT_ICON_ICO_PATH));
            return;
        }

        if (req.method === 'GET' && urlPath === '/api/status') {
            sendJson(res, 200, controller.getSnapshot());
            return;
        }

        if (req.method === 'POST' && urlPath === '/api/action') {
            let body;
            try {
                body = await readJsonBody(req);
            } catch (err) {
                sendJson(res, 400, { ok: false, error: err?.message || 'Requisicao invalida' });
                return;
            }

            const action = String(body?.action || '');
            let ok = true;
            if (action === 'start' || action === 'reconnect') {
                ok = Boolean(controller.reconnect());
            } else if (action === 'pause') {
                controller.pause();
            } else if (action === 'attach-browser') {
                ok = controller.attachBrowser(body || {});
            } else if (action === 'open-game') {
                ok = await controller.openGame();
            } else if (action === 'play-with-bot') {
                ok = await controller.openGame({ linked: true });
            } else if (action === 'open-lives') {
                ok = await controller.openLives(body.url);
            } else if (action === 'open-vote') {
                ok = await controller.openVote();
            } else if (action === 'refresh-vote') {
                await controller.refreshVoteStatus({ force: true });
                ok = true;
            } else if (action === 'open-live-chat') {
                ok = typeof body.url === 'string' && await controller.openLives(body.url, { chatOnly: true });
            } else if (action === 'open-panel') {
                ok = await controller.openPanel(boundPort);
            } else if (action === 'set-hunt') {
                ok = controller.setHunt(body.slug);
            } else if (action === 'go-center') {
                ok = controller.triggerAction('go-center');
            } else if (action === 'cancel-pending-hunt') {
                ok = controller.triggerAction('cancel-pending-hunt');
            } else if (action === 'set-config') {
                controller.updateConfig(body.config || body);
            } else if (action === 'restock-now') {
                ok = controller.triggerAction('restock');
            } else if (action === 'claim-pass') {
                ok = controller.triggerAction('pass');
            } else if (action === 'roll-prey') {
                ok = controller.triggerAction('prey');
            } else if (action === 'heal-now') {
                ok = controller.triggerAction('heal');
            } else if (action === 'reload-session') {
                ok = controller.triggerAction('reload-session');
            } else if (action === 'import-session') {
                const imported = controller.importSession(body || {});
                if (!imported?.ok) {
                    sendJson(res, 400, { ok: false, error: imported?.error || 'Sessão inválida', snapshot: controller.getSnapshot() });
                    return;
                }
                ok = true;
            } else if (action === 'import-live-tokens') {
                const imported = controller.importLiveTokens(body || {});
                if (!imported?.ok) {
                    sendJson(res, 400, { ok: false, error: imported?.error || 'Tokens inválidos', snapshot: controller.getSnapshot() });
                    return;
                }
                ok = true;
            } else if (action === 'cancel-login') {
                ok = controller.triggerAction('cancel-login');
            } else if (action === 'run-lives') {
                ok = controller.triggerAction('run-lives');
            } else if (action === 'refresh-lives') {
                ok = controller.triggerAction('refresh-lives');
            } else if (action === 'reset-stats') {
                ok = controller.triggerAction('reset-stats');
            } else if (action === 'refresh-topcatch') {
                ok = controller.triggerAction('refresh-topcatch');
            } else if (action === 'login-twitch') {
                ok = controller.startLogin('twitch', { interactive: body.interactive === true });
            } else if (action === 'login-kick') {
                ok = controller.startLogin('kick', { interactive: body.interactive === true });
            } else if (action === 'login-pokeidle') {
                ok = controller.startLogin('pokeidle', { interactive: body.interactive === true });
            } else if (action === 'oauth-login') {
                ok = controller.startLogin(body.provider);
            } else if (action === 'shutdown') {
                sendJson(res, 200, { ok: true, shuttingDown: true });
                setTimeout(() => {
                    close().then(() => {
                        if (typeof options.onShutdown === 'function') options.onShutdown();
                    });
                }, 50);
                return;
            } else {
                sendJson(res, 400, { ok: false, error: `Acao desconhecida: ${action}` });
                return;
            }

            sendJson(res, 200, { ok, snapshot: controller.getSnapshot() });
            return;
        }

        sendJson(res, 404, { ok: false, error: 'Rota nao encontrada' });
    });

    await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(port, host, () => {
            server.removeListener('error', rejectListen);
            resolveListen();
        });
    });

    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const url = `http://${host}:${actualPort}`;

    if (autoStart) {
        controller.start();
    }

    return { server, controller, port: actualPort, host, url, close };
}

function openBrowserAppWindow(url, controller = null) {
    const exe = findChromiumExecutable();
    if (exe && existsSync(exe)) {
        const snap = controller?.getSnapshot?.({ includeHunts: false });
        const profileName = snap?.browserProfile || '';
        const args = [];
        if (profileName) args.push(`--profile-directory=${profileName}`);
        args.push(`--app=${url}`);
        const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
        child.unref();
        return true;
    }
    return false;
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
    if (typeof WebSocket !== 'function') {
        throw new Error('Este Nexo PokeBot requer Node.js 22 ou superior.');
    }
    const argv = process.argv.slice(2);
    const accountIndex = argv.indexOf('--account');
    const account = accountIndex === -1 ? 1 : Number(argv[accountIndex + 1]);
    if (!Number.isInteger(account) || account < 1 || account > 4) {
        throw new Error('Use --account com um número de 1 a 4.');
    }
    let port = 17890;
    port += account - 1;
    const portIdx = argv.indexOf('--port');
    if (portIdx !== -1 && argv[portIdx + 1]) {
        const parsed = Number(argv[portIdx + 1]);
        if (Number.isFinite(parsed) && parsed > 0) port = parsed;
    }
    const autoStart = !argv.includes('--no-autostart');
    const openApp = argv.includes('--open-app');
    let parentPid = 0;
    const parentIdx = argv.indexOf('--parent-pid');
    if (parentIdx !== -1 && argv[parentIdx + 1]) {
        const parsedPid = Number(argv[parentIdx + 1]);
        if (Number.isFinite(parsedPid) && parsedPid > 0) parentPid = parsedPid;
    }

    let parentWatchTimer = null;
    const stopAllAndExit = () => {
        if (parentWatchTimer) {
            clearInterval(parentWatchTimer);
            parentWatchTimer = null;
        }
        instance.close().then(() => process.exit(0));
    };

    const instance = await startGuiServer({
        port,
        useExistingBrowser: accountIndex !== -1 && account === 1,
        enableBrowserProfilePicker: accountIndex !== -1,
        useEmbeddedBrowser: accountIndex !== -1,
        ...(account > 1 ? {
            cwd: resolve(process.cwd(), '.pokebot-accounts', String(account)),
            isolatedAccount: true,
        } : {}),
        autoStart,
        autoLoginOnMissingSession: true,
        onShutdown: () => {
            if (parentWatchTimer) {
                clearInterval(parentWatchTimer);
                parentWatchTimer = null;
            }
            process.exit(0);
        },
    });

    if (parentPid > 0) {
        parentWatchTimer = setInterval(() => {
            try {
                process.kill(parentPid, 0);
            } catch {
                stopAllAndExit();
            }
        }, 5000);
        parentWatchTimer.unref?.();
    }

    console.log(`[Nexo PokeBot] Painel ativo em ${instance.url}`);
    if (openApp) {
        openBrowserAppWindow(instance.url, instance.controller);
    }

    process.on('SIGINT', stopAllAndExit);
    process.on('SIGTERM', stopAllAndExit);
}
