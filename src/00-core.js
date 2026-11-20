(() => {
    // Se o gerenciador de userscripts isolar o script (@grant), unsafeWindow é a janela real da página
    const pageWin = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
    [window, pageWin].forEach((w) => {
        try {
            if (w.PokeBot && typeof w.PokeBot.stop === 'function') w.PokeBot.stop();
        } catch {
            // instância antiga já encerrada
        }
    });
    if (window.FarmAnalyzer && typeof window.FarmAnalyzer.stop === 'function') {
        window.FarmAnalyzer.stop();
    }

    const VERSION = '__VERSION__'; // preenchido no build a partir do package.json
    const HUD_ID = 'pokebot-hud';
    const STYLE_ID = 'pokebot-hud-style';
    // Mantém chaves v60 para preservar Pokédex importada, alertas e preferências
    const STORAGE_HISTORY_KEY = 'pokeidle_farm_benchmarks_v60';
    const STORAGE_PREFS_KEY = 'pokeidle_hud_prefs_v60';
    const STORAGE_DEX_KEY = 'pokeidle_minigame_dex_v60';
    const STORAGE_PASS_NEXT_KEY = 'pokeidle_pass_next_ms_v60';
    const STORAGE_HUNT_QUEUE_KEY = 'pokeidle_hunt_queue_v63';

    const HUNT_GUIDE_URL = 'https://pokeidleguide.io/#hunt';
    const TETO_DEPOT = 3000;
    const ESPERA_TROCA_ATIVO_MS = 3250;

    const BALL_TIERS = [
        { minGold: 0,       itemName: 'Poke Ball',  chipIndex: 0, unitCost: 5   },
        { minGold: 50000,   itemName: 'Great Ball', chipIndex: 1, unitCost: 20  },
        { minGold: 300000,  itemName: 'Super Ball', chipIndex: 2, unitCost: 50  },
        { minGold: 2500000, itemName: 'Ultra Ball', chipIndex: 3, unitCost: 130 },
    ];

    const SEASONAL_DAYS = {
        'dia de ceu limpo': 'NORMAL',
        'dia escaldante': 'FIRE',
        'dia chuvoso': 'WATER',
        'dia florido': 'GRASS',
        'dia de tempestade': 'ELECTRIC',
        'dia de nevasca': 'ICE',
        'dia de treino': 'FIGHTING',
        'dia toxico': 'POISON',
        'dia de terremoto': 'GROUND',
        'dia de ventania': 'FLYING',
        'dia telepatico': 'PSYCHIC',
        'dia do enxame': 'BUG',
        'dia de avalanche': 'ROCK',
        'dia assombrado': 'GHOST',
        'dia do dragao': 'DRAGON',
        'noite eterna': 'DARK',
        'dia da forja': 'STEEL',
        'dia encantado': 'FAIRY',
    };

    const TYPE_ALIASES = {
        normal: 'NORMAL',
        fire: 'FIRE', fogo: 'FIRE',
        water: 'WATER', agua: 'WATER',
        electric: 'ELECTRIC', eletrico: 'ELECTRIC',
        grass: 'GRASS', planta: 'GRASS', grama: 'GRASS',
        ice: 'ICE', gelo: 'ICE',
        fighting: 'FIGHTING', lutador: 'FIGHTING', luta: 'FIGHTING',
        poison: 'POISON', venenoso: 'POISON', veneno: 'POISON',
        ground: 'GROUND', terra: 'GROUND', terrestre: 'GROUND',
        flying: 'FLYING', voador: 'FLYING', voo: 'FLYING',
        psychic: 'PSYCHIC', psiquico: 'PSYCHIC',
        bug: 'BUG', inseto: 'BUG',
        rock: 'ROCK', pedra: 'ROCK', rocha: 'ROCK',
        ghost: 'GHOST', fantasma: 'GHOST',
        dragon: 'DRAGON', dragao: 'DRAGON',
        dark: 'DARK', sombrio: 'DARK', noturno: 'DARK',
        steel: 'STEEL', aco: 'STEEL', metal: 'STEEL',
        fairy: 'FAIRY', fada: 'FAIRY',
    };

    const TYPE_CHART = {
        NORMAL:   { ROCK: 0.5, GHOST: 0, STEEL: 0.5 },
        FIRE:     { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 2, BUG: 2, ROCK: 0.5, DRAGON: 0.5, STEEL: 2 },
        WATER:    { FIRE: 2, WATER: 0.5, GRASS: 0.5, GROUND: 2, ROCK: 2, DRAGON: 0.5 },
        ELECTRIC: { WATER: 2, ELECTRIC: 0.5, GRASS: 0.5, GROUND: 0, FLYING: 2, DRAGON: 0.5 },
        GRASS:    { FIRE: 0.5, WATER: 2, GRASS: 0.5, POISON: 0.5, GROUND: 2, FLYING: 0.5, BUG: 0.5, ROCK: 2, DRAGON: 0.5, STEEL: 0.5 },
        ICE:      { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 0.5, GROUND: 2, FLYING: 2, DRAGON: 2, STEEL: 0.5 },
        FIGHTING: { NORMAL: 2, ICE: 2, POISON: 0.5, FLYING: 0.5, PSYCHIC: 0.5, BUG: 0.5, ROCK: 2, GHOST: 0, DARK: 2, STEEL: 2, FAIRY: 0.5 },
        POISON:   { GRASS: 2, POISON: 0.5, GROUND: 0.5, ROCK: 0.5, GHOST: 0.5, STEEL: 0, FAIRY: 2 },
        GROUND:   { FIRE: 2, ELECTRIC: 2, GRASS: 0.5, POISON: 2, FLYING: 0, BUG: 0.5, ROCK: 2, STEEL: 2 },
        FLYING:   { ELECTRIC: 0.5, GRASS: 2, FIGHTING: 2, BUG: 2, ROCK: 0.5, STEEL: 0.5 },
        PSYCHIC:  { FIGHTING: 2, POISON: 2, PSYCHIC: 0.5, DARK: 0, STEEL: 0.5 },
        BUG:      { FIRE: 0.5, GRASS: 2, FIGHTING: 0.5, POISON: 0.5, FLYING: 0.5, PSYCHIC: 2, GHOST: 0.5, DARK: 2, STEEL: 0.5, FAIRY: 0.5 },
        ROCK:     { FIRE: 2, ICE: 2, FIGHTING: 0.5, GROUND: 0.5, FLYING: 2, BUG: 2, STEEL: 0.5 },
        GHOST:    { NORMAL: 0, PSYCHIC: 2, GHOST: 2, DARK: 0.5 },
        DRAGON:   { DRAGON: 2, STEEL: 0.5, FAIRY: 0 },
        DARK:     { FIGHTING: 0.5, PSYCHIC: 2, GHOST: 2, DARK: 0.5, FAIRY: 0.5 },
        STEEL:    { FIRE: 0.5, WATER: 0.5, ELECTRIC: 0.5, ICE: 2, ROCK: 2, STEEL: 0.5, FAIRY: 2 },
        FAIRY:    { FIRE: 0.5, FIGHTING: 2, POISON: 0.5, DRAGON: 2, DARK: 2, STEEL: 0.5 },
    };

    const HUNT_AMP = { 0: 0, 0.25: 0.167, 0.5: 0.333, 1: 1, 2: 2.5, 4: 5.5 };
    const VALID_TYPES = new Set(Object.keys(TYPE_CHART));
    const VALID_MODES = ['xp', 'ouro', 'equilibrado', 'topcatch'];
    const DEPOT_MODES = ['off', 'venda', 'oferenda', 'sacrificio'];
    const TEAM_MODES = ['off', 'equilibrar', 'sazonal'];
    const BOSS_PRIORITIES = ['off', 'qualquer', 'mega', 'tm', 'tickets'];

    const loadJson = (key, fallback) => {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    };

    const saveJson = (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.warn('[PokeBot] Erro ao salvar localStorage:', err);
        }
    };

    const savedPrefs = loadJson(STORAGE_PREFS_KEY, {});
    const savedQueueStore = loadJson(STORAGE_HUNT_QUEUE_KEY, { items: [], index: 0 });

    const CONFIG = {
        mode: VALID_MODES.includes(savedPrefs.mode) ? savedPrefs.mode : 'equilibrado',
        caidos: {
            enabled: savedPrefs.caidosEnabled ?? true,
            smartBallSelect: savedPrefs.smartBallSelect ?? true,
            highLevelUltraThreshold: 20,
            containerSelector: '#caidos-lista',
            buttonSelector: 'button.caido',
            minThrowIntervalMs: 1200,
            retryAfterMs: 4500,
            reattachIntervalMs: 3000,
        },
        shinyGuard: {
            enabled: savedPrefs.shinyGuardEnabled ?? true,
            soundAlert: true,
        },
        restock: {
            enabled: savedPrefs.restockEnabled ?? true,
            autoUpgradeBalls: savedPrefs.autoUpgradeBalls ?? true,
            minGoldReserve: savedPrefs.minGoldReserve ?? 50000,
            minBalls: 10,
            targetBalls: 50,
            restockSmallPotion: true,
            minPotions: 10,
            targetPotions: 40,
            restockRevive: savedPrefs.restockRevive ?? false,
            minRevives: 5,
            targetRevives: 20,
            batchButton: '×10',
            maxPurchases: 6,
            buyConfirmTimeoutMs: 2600,
            checkIntervalMs: 15000,
            closeMarketAfter: true,
        },
        topCatchHop: {
            enabled: savedPrefs.topCatchHopEnabled ?? false,
            hopCooldownMs: 15000,
        },
        depot: {
            mode: DEPOT_MODES.includes(savedPrefs.depotMode) ? savedPrefs.depotMode : 'off',
            intervalMs: 600000,
            tetoMax: TETO_DEPOT,
        },
        dailyPass: {
            enabled: savedPrefs.dailyPassEnabled ?? true,
            checkIntervalMs: 60000,
        },
        team: {
            mode: TEAM_MODES.includes(savedPrefs.teamMode) ? savedPrefs.teamMode : 'off',
            checkIntervalMs: 4000,
            swapCooldownMs: 12000,
            failedSwapBackoffMs: 60000,
            unsafeBackoffMs: 180000,
            maxGapBelowHunt: 0,
            minTrainPower: 2,
            minTrainHpPercent: 75,
            rescueHpPercent: 55,
        },
        incubator: {
            enabled: savedPrefs.incubatorEnabled ?? false,
            activeIntervalMs: 30000,
            emptyBackoffMs: 180000,
        },
        boss: {
            priority: BOSS_PRIORITIES.includes(savedPrefs.bossPriority) ? savedPrefs.bossPriority : 'off',
            checkIntervalMs: 300000,
            autoDismissLoot: true,
        },
        radar: {
            enabled: savedPrefs.radarEnabled ?? true,
            checkIntervalMs: 1800,
            soundAlert: true,
            alerts: Array.isArray(savedPrefs.radarAlerts) ? savedPrefs.radarAlerts : [],
        },
        minigame: {
            enabled: savedPrefs.minigameEnabled ?? true,
            autoGuess: savedPrefs.minigameAutoGuess ?? false,
            autoGuessMaxCandidates: 3,
            checkIntervalMs: 1200,
        },
        autoRegion: {
            enabled: savedPrefs.autoRegionEnabled ?? true,
            checkIntervalMs: 12000,
            levelStep: 5,
            minIntervalMs: 180000,
        },
        evolve: {
            enabled: savedPrefs.evolveEnabled ?? false,
            checkIntervalMs: 8000,
            cooldownMs: 15000, // depois de evoluir de verdade
            recheckMs: 600000, // depois de abrir a confirmação e ver que falta requisito
        },
        huntQueue: {
            fallbackToSafeArea: savedPrefs.queueFallback ?? true,
        },
        farm: {
            enabled: true,
            tickIntervalMs: 3000,
            minSampleSec: 15,
            minKillsToSave: 2,
            maxPotionsPerMinSafe: 2,
            minHpPercentSafe: 25,
        },
        map: {
            preferTypeAdvantage: true,
            onlyUnlocked: true,
            switchCooldownMs: 10500,
            warmupMaxSec: 11,
            benchmarkSecPerArea: 30,
            maxAreasToTest: 4,
            maxLevelAbovePokemon: 5,
            abortHpThreshold: 25,
        },
        hud: {
            tab: savedPrefs.hudTab || 'geral',
            minimized: savedPrefs.hudMinimized ?? false,
            left: typeof savedPrefs.hudLeft === 'number' ? savedPrefs.hudLeft : 14,
            top: typeof savedPrefs.hudTop === 'number' ? savedPrefs.hudTop : 14,
            refreshMs: 2500,
        },
        delays: {
            clickMinMs: 70,
            clickMaxMs: 170,
            uiMinMs: 220,
            uiMaxMs: 380,
        },
    };

    const persistPrefs = () => {
        saveJson(STORAGE_PREFS_KEY, {
            mode: CONFIG.mode,
            caidosEnabled: CONFIG.caidos.enabled,
            smartBallSelect: CONFIG.caidos.smartBallSelect,
            shinyGuardEnabled: CONFIG.shinyGuard.enabled,
            restockEnabled: CONFIG.restock.enabled,
            autoUpgradeBalls: CONFIG.restock.autoUpgradeBalls,
            minGoldReserve: CONFIG.restock.minGoldReserve,
            restockRevive: CONFIG.restock.restockRevive,
            topCatchHopEnabled: CONFIG.topCatchHop.enabled,
            depotMode: CONFIG.depot.mode,
            dailyPassEnabled: CONFIG.dailyPass.enabled,
            teamMode: CONFIG.team.mode,
            incubatorEnabled: CONFIG.incubator.enabled,
            bossPriority: CONFIG.boss.priority,
            radarEnabled: CONFIG.radar.enabled,
            radarAlerts: CONFIG.radar.alerts,
            minigameEnabled: CONFIG.minigame.enabled,
            minigameAutoGuess: CONFIG.minigame.autoGuess,
            autoRegionEnabled: CONFIG.autoRegion.enabled,
            evolveEnabled: CONFIG.evolve.enabled,
            queueFallback: CONFIG.huntQueue.fallbackToSafeArea,
            hudTab: CONFIG.hud.tab,
            hudMinimized: CONFIG.hud.minimized,
            hudLeft: CONFIG.hud.left,
            hudTop: CONFIG.hud.top,
        });
    };

    const state = {
        running: true,
        paused: false,
        modalLockOwner: null,
        statusText: 'Ativo',
        lastActionNote: `Conectado (PokeBot v${VERSION})`,
        throwPending: false,
        lastThrowAt: 0,
        evolveNextAt: 0,
        lastAreaSwitchAt: 0,
        lastOptimizeAt: 0,
        lastHopAt: 0,
        lastDepotRunAt: 0,
        lastTeamSwapAt: 0,
        teamSwapPotionSnap: null,
        failedSwapUntil: {},
        unsafeTrainUntil: {},
        nextIncubatorCheckAt: 0,
        lastBossCheckAt: 0,
        lastOptimizedTrainerLevel: null,
        lastMarkerMeta: null,
        huntQueue: Array.isArray(savedQueueStore?.items) ? savedQueueStore.items : [],
        huntQueueIndex: typeof savedQueueStore?.index === 'number' ? savedQueueStore.index : 0,
        lastSessionCaptures: null,
        lastShiniesVistos: null,
        shinyAlertActive: false,
        shinyNotifiedSlots: new Set(),
        seasonalDayType: null,
        radarHits: [],
        radarNotifiedKeys: new Set(),
        miniGameMatches: [],
        currentMiniGameRoundId: '',
        roundTriedNames: new Set(),
        lastQuizSigRendered: '',
        lastGuessedStageKey: '',
        dexCatalog: loadJson(STORAGE_DEX_KEY, []),
        startedAt: Date.now(),
        timers: [],
        cleanupListeners: [],
        caidosObserver: null,
        observedCaidosNode: null,
        logObserver: null,
        observedLogNode: null,
        history: loadJson(STORAGE_HISTORY_KEY, {}),
        session: null,
        hudEl: null,
        hudCache: {},
        stats: {
            caidosClicked: 0,
            captures: 0,
            purchases: 0,
            regionSwitches: 0,
            depotRuns: 0,
            passClaims: 0,
            teamSwaps: 0,
            eggsHandled: 0,
            bossEntries: 0,
            shiniesSpotted: 0,
        },
    };
