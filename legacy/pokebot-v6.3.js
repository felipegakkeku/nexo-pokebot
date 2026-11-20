(() => {
    if (window.PokeBot && typeof window.PokeBot.stop === 'function') {
        window.PokeBot.stop();
    }
    if (window.FarmAnalyzer && typeof window.FarmAnalyzer.stop === 'function') {
        window.FarmAnalyzer.stop();
    }

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
            cooldownMs: 15000,
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
        lastActionNote: 'Conectado (PokeBot v6.3)',
        throwPending: false,
        lastThrowAt: 0,
        lastEvolveAt: 0,
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

    // --- Utilitários ---
    const isInsideHud = (el) => Boolean(el && el.closest && el.closest(`#${HUD_ID}`));
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    const scheduleIdle = (fn) => {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => fn(), { timeout: 1000 });
        } else {
            setTimeout(fn, 0);
        }
    };

    const normalizeText = (str) =>
        (str || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();

    const cleanKey = (str) => normalizeText(str).replace(/[^a-z0-9]/g, '');

    const escapeHtml = (str) =>
        String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

    const getDirectText = (el) => {
        if (!el) return 'Desconhecido';
        let text = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
        }
        return text.trim() || 'Desconhecido';
    };

    const parseNumber = (text) => {
        const digits = (text || '').replace(/\D/g, '');
        if (!digits) return null;
        const n = parseInt(digits, 10);
        return Number.isNaN(n) ? null : n;
    };

    const parseSignedNumber = (text) => {
        const raw = (text || '').trim();
        const negative = raw.startsWith('-') || raw.startsWith('−');
        const n = parseNumber(raw);
        if (n === null) return null;
        return negative ? -n : n;
    };

    const playBeep = (freq = 880, dur = 0.14) => {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.value = 0.08;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + dur);
        } catch {
            // Ignora bloqueio de áudio
        }
    };

    const isVisible = (el) => {
        if (!el || !el.isConnected || isInsideHud(el)) return false;
        if (el.offsetParent === null) {
            const style = window.getComputedStyle(el);
            if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }
        }
        return true;
    };

    const isInteractable = (el) => {
        if (!isVisible(el)) return false;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const style = window.getComputedStyle(el);
        return style.pointerEvents !== 'none' && parseFloat(style.opacity) >= 0.45;
    };

    const findClickableByText = (text, root = document, exact = false) => {
        const target = normalizeText(text);
        const matchFn = (el) => {
            const txt = normalizeText(el.textContent);
            return exact ? txt === target : txt.includes(target);
        };

        const primary = Array.from(root.querySelectorAll('button, a, [role="button"]')).filter(
            (el) => matchFn(el) && isInteractable(el)
        );
        if (primary.length > 0) {
            primary.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
            return primary[0];
        }

        const fallback = Array.from(root.querySelectorAll('div, li, label')).filter((el) => {
            if (!isInteractable(el) || el.children.length > 4) return false;
            const style = window.getComputedStyle(el);
            return style.cursor === 'pointer' && matchFn(el);
        });
        fallback.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
        return fallback[0] || null;
    };

    const findMenuButtonByImg = (srcPart) =>
        Array.from(document.querySelectorAll('button')).find(
            (btn) => isInteractable(btn) && Boolean(btn.querySelector(`img[src*="${srcPart}"]`))
        ) || null;

    const waitFor = async (conditionFn, timeoutMs = 4000, pollMs = 90) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (!state.running) return null;
            const res = conditionFn();
            if (res) return res;
            await sleep(pollMs);
        }
        return null;
    };

    const setStatus = (label, note = null) => {
        state.statusText = label;
        if (note) state.lastActionNote = note;
        updateHud();
    };

    const getVisibleModal = () => {
        const modals = Array.from(document.querySelectorAll('.modal-caixa, .modal')).filter(isVisible);
        return modals[modals.length - 1] || null;
    };

    const closeActiveModal = async () => {
        const closeById = document.getElementById('modal-fechar');
        if (closeById && isInteractable(closeById)) {
            closeById.click();
            await waitFor(() => !getVisibleModal(), 1400);
            await sleep(randomDelay(160, 240));
            return;
        }

        const modal = getVisibleModal();
        if (!modal) return;

        const closeBtn =
            modal.querySelector('.modal-acoes button') ||
            Array.from(modal.querySelectorAll('button, a')).find((btn) => {
                if (!isInteractable(btn)) return false;
                const txt = normalizeText(btn.textContent);
                const aria = normalizeText(btn.getAttribute('aria-label'));
                return (
                    txt === 'x' ||
                    txt === '×' ||
                    txt === '✕' ||
                    txt === 'fechar' ||
                    aria.includes('fechar') ||
                    aria.includes('close')
                );
            });

        if (closeBtn && isInteractable(closeBtn)) {
            closeBtn.click();
        } else {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
            );
        }

        await waitFor(() => !getVisibleModal(), 1400);
        await sleep(randomDelay(160, 240));
    };

    const confirmModalDialog = async (keywords = ['confirmar', 'vender', 'oferendar', 'sacrificar', 'evoluir', 'sim']) => {
        await sleep(randomDelay(220, 360));
        const directConfirm = document.getElementById('confirmar-sim');
        if (directConfirm && isInteractable(directConfirm)) {
            directConfirm.click();
            await sleep(randomDelay(260, 420));
            return true;
        }

        const topModal = getVisibleModal();
        if (!topModal) return false;

        const btn = Array.from(topModal.querySelectorAll('button')).find((b) => {
            if (!isInteractable(b)) return false;
            const txt = normalizeText(b.textContent);
            return keywords.some((kw) => txt === kw || txt.includes(kw));
        });
        if (btn) {
            btn.click();
            await sleep(randomDelay(260, 420));
            return true;
        }
        return false;
    };

    // --- Leitor Nativo do #sessao-painel ---
    const readNativeSessionPanel = () => {
        const panel = document.getElementById('sessao-painel');
        if (!panel) return null;

        const hasData = panel.querySelector('b[data-k]');
        if (!hasData) return null;

        const getDataK = (k, signed = false) => {
            const el = panel.querySelector(`b[data-k="${k}"]`);
            if (!el) return 0;
            const fn = signed ? parseSignedNumber : parseNumber;
            return fn(el.textContent) ?? 0;
        };

        const sumPrefix = (prefix) => {
            let total = 0;
            panel.querySelectorAll(`b[data-k^="${prefix}"]`).forEach((el) => {
                total += parseNumber(el.textContent) ?? 0;
            });
            return total;
        };

        const getById = (id, signed = false) => {
            const el = panel.querySelector(`#${id}`);
            if (!el) return 0;
            const fn = signed ? parseSignedNumber : parseNumber;
            return fn(el.textContent) ?? 0;
        };

        const boosts = {};
        panel.querySelectorAll('.bxp-f[data-f]').forEach((icon) => {
            boosts[icon.getAttribute('data-f')] = icon.classList.contains('on');
        });

        const lugar = (panel.querySelector('.ss-lugar')?.textContent || '').replace('·', '').trim();

        return {
            xpBonusText: panel.querySelector('.bxp-total b')?.textContent?.trim() || '+0%',
            boosts,
            lugar,
            xpTreinador: getDataK('xpTreinador'),
            xpPokemon: getDataK('xpPokemon'),
            gold: getDataK('gold'),
            abates: getDataK('abates'),
            capturas: getDataK('capturas'),
            gasto: getDataK('gasto'),
            lucro: getDataK('lucro', true),
            shiniesVistos: getDataK('shiniesVistos'),
            shinies: getDataK('shinies'),
            pocoesUsadas: sumPrefix('pocao:'),
            revivesUsados: sumPrefix('revive:'),
            bolasUsadas: sumPrefix('bola:'),
            xpPokemonH: getById('sessao-xp-pokemon-h'),
            goldH: getById('sessao-gold-h'),
            lucroH: getById('sessao-lucro-h', true),
            abatesH: getById('sessao-abates-h'),
            tempo: panel.querySelector('#sessao-tempo')?.textContent?.trim() || '0:00:00',
        };
    };

    const isInSpecialArena = () => {
        const native = readNativeSessionPanel();
        if (native?.lugar) {
            const loc = normalizeText(native.lugar);
            if (loc.includes('boss') || loc.includes('mistica') || loc.includes('safari') || loc.includes('raid')) {
                return true;
            }
        }
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            if (isInsideHud(btn)) continue;
            const txt = normalizeText(btn.textContent);
            if ((txt.includes('abandonar arena') || txt.includes('sair de casa')) && isInteractable(btn)) {
                return true;
            }
        }
        return false;
    };

    const withModalLock = async (ownerLabel, fn, { force = false } = {}) => {
        if (!state.running || (state.paused && !force)) return null;
        if (!force && isInSpecialArena()) return null;
        if (!force && CONFIG.shinyGuard.enabled && state.shinyAlertActive) return null;
        if (state.modalLockOwner) return null;

        state.modalLockOwner = ownerLabel;
        setStatus(ownerLabel);
        try {
            return await fn();
        } finally {
            state.modalLockOwner = null;
            setStatus(state.paused ? 'Pausado' : 'Ativo');
            if (state.observedCaidosNode) {
                processCaidos(state.observedCaidosNode);
            }
        }
    };

    const getHuntTypeMultiplier = (attackerTypes, defenderTypes) => {
        if (!attackerTypes?.length || !defenderTypes?.length) return 1;
        let best = 0;
        for (const atk of attackerTypes) {
            const chart = TYPE_CHART[atk.toUpperCase()] || {};
            let raw = 1;
            for (const def of defenderTypes) {
                const factor = chart[def.toUpperCase()];
                raw *= factor !== undefined ? factor : 1;
            }
            const amp = HUNT_AMP[raw] !== undefined ? HUNT_AMP[raw] : raw;
            if (amp > best) best = amp;
        }
        return best;
    };

    // --- Leitores de Estado Travados no DOM Real (O(1)) ---
    const getTrainerHeaderInfo = () => ({
        level: parseNumber(document.getElementById('tr-level')?.textContent),
        gold: parseNumber(document.getElementById('tr-gold')?.textContent),
        diamonds: parseNumber(document.getElementById('tr-diamantes')?.textContent),
        gems: parseNumber(document.getElementById('tr-gemas')?.textContent),
    });

    const getActivePokemon = () => {
        const card = document.getElementById('ativo-card');
        if (!card || !isVisible(card)) return null;

        const nameEl = card.querySelector('.ativo-nome');
        const lvEl = card.querySelector('.pl-lv');
        const level = parseNumber(lvEl?.textContent);
        const name = getDirectText(nameEl);

        const types = [];
        card.querySelectorAll('.ativo-sub .tipo').forEach((el) => {
            const t = normalizeText(el.textContent).toUpperCase();
            if (VALID_TYPES.has(t) && !types.includes(t)) types.push(t);
        });

        const subTxt = card.querySelector('.ativo-sub')?.textContent || '';
        const powerMatch = subTxt.match(/poder\s+([\d.]+)/i);
        const power = powerMatch ? parseNumber(powerMatch[1]) : null;

        const hpTxt = card.querySelector('.barra.hp span')?.textContent || '';
        const hpMatch = hpTxt.match(/([\d.]+)\s*\/\s*([\d.]+)/);
        const hpCurrent = hpMatch ? parseNumber(hpMatch[1]) : null;
        const hpMax = hpMatch ? parseNumber(hpMatch[2]) : null;

        let hpPercent = null;
        if (hpCurrent !== null && hpMax) {
            hpPercent = Math.round((hpCurrent / hpMax) * 100);
        } else {
            const fillW = card.querySelector('.barra.hp .fill')?.style?.width;
            if (fillW && fillW.endsWith('%')) hpPercent = Math.round(parseFloat(fillW));
        }

        return { name, level, types, power, hpCurrent, hpMax, hpPercent };
    };

    const getCurrentHunt = () => {
        const el = document.getElementById('hud-hunt');
        if (!el || !isVisible(el)) return null;

        const text = (el.textContent || '').trim();
        const match = text.match(/^(.+?)\s*·\s*n[ií]vel\s*([\d.]+)$/i);
        if (!match) return null;

        return {
            key: text,
            pokeId: el.getAttribute('data-poke-id') || null,
            targetName: match[1].trim(),
            targetLevel: parseNumber(match[2]),
        };
    };

    const getSeasonalDayType = () => {
        const btn = document.getElementById('cena-dia-tipo');
        if (btn) {
            const dataTipo = (btn.getAttribute('data-tipo') || '').toUpperCase();
            if (VALID_TYPES.has(dataTipo)) {
                state.seasonalDayType = dataTipo;
                return dataTipo;
            }
            const imgSrc = btn.querySelector('img')?.getAttribute('src') || '';
            const typeMatch = imgSrc.match(/\/tipos\/([a-z]+)\./i);
            if (typeMatch) {
                const candidate = typeMatch[1].toUpperCase();
                if (VALID_TYPES.has(candidate)) {
                    state.seasonalDayType = candidate;
                    return candidate;
                }
            }
            const probe = normalizeText(btn.getAttribute('title') || btn.textContent || '');
            for (const [dayName, type] of Object.entries(SEASONAL_DAYS)) {
                if (probe.includes(dayName)) {
                    state.seasonalDayType = type;
                    return type;
                }
            }
        }
        return state.seasonalDayType;
    };

    const readChipsByContainer = (id) => {
        const container = document.getElementById(id);
        if (!container) return null;
        return Array.from(container.querySelectorAll('.auto-chip')).map((chip) =>
            parseNumber(chip.querySelector('.q')?.textContent ?? chip.textContent)
        );
    };

    const getInventorySnapshot = () => {
        const balls = readChipsByContainer('auto-ball-opts');
        const revives = readChipsByContainer('auto-revive-opts');
        const potions = readChipsByContainer('auto-potion-opts');
        const sumValid = (arr) => {
            if (!arr) return null;
            const valid = arr.filter((n) => n !== null);
            return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
        };
        return {
            panelOpen: Boolean(balls),
            balls,
            revives,
            potions,
            pokeBalls: balls ? balls[0] : null,
            totalBalls: sumValid(balls),
            maxRevives: revives ? revives[0] : null,
            reviveNormal: revives && revives.length > 1 ? revives[1] : revives ? revives[0] : null,
            totalRevives: sumValid(revives),
            smallPotions: potions && potions.length ? potions[potions.length - 1] : null,
        };
    };

    const getTargetBallTier = () => {
        if (!CONFIG.restock.autoUpgradeBalls) return BALL_TIERS[0];
        const { gold } = getTrainerHeaderInfo();
        const available = Math.max(0, (gold ?? 0) - CONFIG.restock.minGoldReserve);
        let chosen = BALL_TIERS[0];
        for (const tier of BALL_TIERS) {
            if (available >= tier.minGold) chosen = tier;
        }
        return chosen;
    };

    // --- 1. Captura Automática em Fila (#caidos-lista) + Seleção Inteligente de Bola + Guardião de Shiny ---
    const isShinyCaidoButton = (btn) => {
        if (!btn) return false;
        const cls = (btn.className || '').toLowerCase();
        const txt = btn.textContent || '';
        return (
            cls.includes('shiny') ||
            btn.dataset.shiny === '1' ||
            btn.dataset.shiny === 'true' ||
            txt.includes('✨') ||
            normalizeText(txt).includes('shiny')
        );
    };

    const ensureBestBallSelected = (targetBtn) => {
        const container = document.getElementById('auto-ball-opts');
        if (!container) return;

        const chips = Array.from(container.querySelectorAll('.auto-chip'));
        if (chips.length === 0) return;

        const counts = chips.map((c) => parseNumber(c.querySelector('.q')?.textContent ?? c.textContent) ?? 0);
        const currentIdx = chips.findIndex((c) => c.classList.contains('on'));
        const isShiny = isShinyCaidoButton(targetBtn);

        let desiredIdx = currentIdx;

        if (isShiny) {
            for (const idx of [4, 3, 2, 1, 0]) {
                if (chips[idx] && counts[idx] > 0) {
                    desiredIdx = idx;
                    break;
                }
            }
        } else if (CONFIG.caidos.smartBallSelect) {
            const targetLv = parseNumber(targetBtn?.textContent) ?? getCurrentHunt()?.targetLevel ?? 1;
            const order =
                targetLv >= CONFIG.caidos.highLevelUltraThreshold
                    ? [3, 2, 1, 0]
                    : [0, 1, 2, 3];
            for (const idx of order) {
                if (chips[idx] && counts[idx] > 0) {
                    desiredIdx = idx;
                    break;
                }
            }
        } else if (currentIdx === -1 || counts[currentIdx] <= 0) {
            const firstAvailable = counts.findIndex((n) => n > 0);
            if (firstAvailable !== -1) desiredIdx = firstAvailable;
        }

        if (desiredIdx !== -1 && desiredIdx !== currentIdx && chips[desiredIdx] && isInteractable(chips[desiredIdx])) {
            chips[desiredIdx].click();
        }
    };

    const processCaidos = (container) => {
        if (!state.running || state.paused || !container) return;

        const allButtons = Array.from(container.querySelectorAll(CONFIG.caidos.buttonSelector)).filter(isInteractable);
        const shinyButtons = allButtons.filter(isShinyCaidoButton);

        if (shinyButtons.length > 0) {
            state.shinyAlertActive = true;
            shinyButtons.forEach((b) => {
                const slot = b.dataset.slot || b.textContent;
                if (!state.shinyNotifiedSlots.has(slot)) {
                    state.shinyNotifiedSlots.add(slot);
                    state.stats.shiniesSpotted++;
                    if (CONFIG.shinyGuard.soundAlert) playBeep(1180, 0.25);
                    state.lastActionNote = `✨ SHINY DETECTADO: ${(b.querySelector('.caido-quem')?.textContent || 'Alvo').trim()}`;
                    updateHud();
                }
            });
        } else {
            state.shinyAlertActive = false;
        }

        if (!CONFIG.caidos.enabled) return;
        if (state.modalLockOwner && !(CONFIG.shinyGuard.enabled && shinyButtons.length > 0)) return;
        if (state.throwPending) return;

        const inv = getInventorySnapshot();
        if (inv.totalBalls === 0) {
            smartRestock(false);
            return;
        }

        const now = Date.now();
        const ordered = shinyButtons.length > 0 ? [...shinyButtons, ...allButtons] : allButtons;
        const nextBtn = ordered.find((btn) => {
            const lastTry = parseInt(btn.dataset.pbTriedAt || '0', 10);
            const retryMs = isShinyCaidoButton(btn) ? 1400 : CONFIG.caidos.retryAfterMs;
            return now - lastTry >= retryMs;
        });

        if (!nextBtn) return;

        const elapsed = now - state.lastThrowAt;
        const baseWait = Math.max(0, CONFIG.caidos.minThrowIntervalMs - elapsed);
        const jitter = randomDelay(CONFIG.delays.clickMinMs, CONFIG.delays.clickMaxMs);

        state.throwPending = true;
        setTimeout(() => {
            window.requestAnimationFrame(() => {
                state.throwPending = false;
                if (!state.running || state.paused) return;
                if (state.modalLockOwner && !isShinyCaidoButton(nextBtn)) return;

                if (getInventorySnapshot().totalBalls === 0) {
                    smartRestock(false);
                    return;
                }

                if (isInteractable(nextBtn)) {
                    ensureBestBallSelected(nextBtn);
                    nextBtn.dataset.pbTriedAt = String(Date.now());
                    state.lastThrowAt = Date.now();
                    nextBtn.click();
                    state.stats.caidosClicked++;
                }

                if (state.observedCaidosNode) {
                    processCaidos(state.observedCaidosNode);
                }
            });
        }, baseWait + jitter);
    };

    const ensureCaidosObserver = () => {
        if (!state.running || state.paused) return;

        const targetNode = document.querySelector(CONFIG.caidos.containerSelector);
        if (targetNode !== state.observedCaidosNode) {
            if (state.caidosObserver) {
                state.caidosObserver.disconnect();
                state.caidosObserver = null;
                state.observedCaidosNode = null;
            }
            if (targetNode) {
                state.observedCaidosNode = targetNode;
                state.caidosObserver = new MutationObserver(() => processCaidos(targetNode));
                state.caidosObserver.observe(targetNode, { childList: true });
            }
        }

        if (state.observedCaidosNode) {
            processCaidos(state.observedCaidosNode);
        }
    };

    // --- 2. Restock ---
    const getVisibleMarketCards = () =>
        Array.from(document.querySelectorAll('#mk-corpo .mk-card')).filter(isInteractable);

    const isMarketOpen = () => Boolean(document.getElementById('mk-modos') && isVisible(document.getElementById('mk-modos')));

    const findMarketCard = (itemName) => {
        const target = normalizeText(itemName);
        return (
            getVisibleMarketCards().find((card) => {
                const nameEl = card.querySelector('.mk-nome');
                return nameEl && normalizeText(nameEl.textContent) === target;
            }) ||
            getVisibleMarketCards().find((card) => {
                const nameEl = card.querySelector('.mk-nome');
                return nameEl && normalizeText(nameEl.textContent).includes(target);
            }) ||
            null
        );
    };

    const findCardBuyButton = (card) => {
        if (!card) return null;
        return (
            Array.from(card.querySelectorAll('button')).find(
                (btn) => normalizeText(btn.textContent).includes('comprar') && isInteractable(btn)
            ) || null
        );
    };

    const selectBatchShortcut = async (card, batchLabel) => {
        if (!card || !batchLabel) return;
        const target = normalizeText(batchLabel).replace('×', 'x');
        const shortcutBtn = Array.from(card.querySelectorAll('.mk-atalhos button')).find((btn) => {
            const txt = normalizeText(btn.textContent).replace('×', 'x');
            return txt === target && isInteractable(btn);
        });
        if (shortcutBtn) {
            shortcutBtn.click();
            await sleep(randomDelay(120, 220));
        }
    };

    const ensureMarketTab = async (abaKey) => {
        const tab = document.querySelector(`#mk-modos .cmp-op[data-aba="${abaKey}"]`);
        if (tab && !tab.classList.contains('on') && isInteractable(tab)) {
            tab.click();
            await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
        }
    };

    const switchMarketCategory = async (categoryName) => {
        const target = normalizeText(categoryName);
        const catBtn = Array.from(document.querySelectorAll('#mk-corpo .mk-lado button.mk-cat')).find((btn) => {
            if (!isInteractable(btn)) return false;
            const txt = normalizeText(btn.querySelector('.mk-cat-txt')?.textContent || btn.textContent);
            return txt.startsWith(target) || txt === target;
        });
        if (catBtn && !catBtn.classList.contains('on')) {
            catBtn.click();
            await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
        }
    };

    const smartRestock = async (force = false) => {
        if (!CONFIG.restock.enabled && !force) return;

        const ballTier = getTargetBallTier();
        const inv = getInventorySnapshot();
        const toBuy = [];

        const currentTierBalls = inv.balls ? inv.balls[ballTier.chipIndex] : null;
        if (force || (currentTierBalls !== null && currentTierBalls < CONFIG.restock.minBalls)) {
            toBuy.push({
                itemName: ballTier.itemName,
                categoryName: 'Pokebolas',
                targetAmount: CONFIG.restock.targetBalls,
            });
        }

        if (
            CONFIG.restock.restockSmallPotion &&
            (force || (inv.smallPotions !== null && inv.smallPotions < CONFIG.restock.minPotions))
        ) {
            toBuy.push({
                itemName: 'Small Potion',
                categoryName: 'Poções',
                targetAmount: CONFIG.restock.targetPotions,
            });
        }

        if (
            CONFIG.restock.restockRevive &&
            (force || (inv.totalRevives !== null && inv.totalRevives < CONFIG.restock.minRevives))
        ) {
            toBuy.push({
                itemName: 'Revive',
                categoryName: 'Revives',
                targetAmount: CONFIG.restock.targetRevives,
            });
        }

        if (toBuy.length === 0) return;

        await withModalLock(
            'Restock',
            async () => {
                let openedByBot = false;
                try {
                    if (!isMarketOpen()) {
                        if (getVisibleModal()) await closeActiveModal();
                        const marketBtn = findMenuButtonByImg('menu-market') || findClickableByText('Market');
                        if (!marketBtn) return;
                        marketBtn.click();
                        openedByBot = true;
                        const loaded = await waitFor(isMarketOpen, 3500);
                        if (!loaded) return;
                        await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
                    }

                    await ensureMarketTab('compra');

                    for (const item of toBuy) {
                        if (!state.running) break;

                        let card = findMarketCard(item.itemName);
                        if (!card) {
                            await switchMarketCategory(item.categoryName);
                            card = await waitFor(() => findMarketCard(item.itemName), 2800);
                        }
                        if (!card) continue;

                        for (let i = 0; i < CONFIG.restock.maxPurchases; i++) {
                            if (!state.running) break;
                            const currCard = findMarketCard(item.itemName);
                            if (!currCard) break;

                            const countBefore = parseNumber(currCard.querySelector('.mk-tem')?.textContent);
                            if (countBefore !== null && countBefore >= item.targetAmount) break;

                            await selectBatchShortcut(currCard, CONFIG.restock.batchButton);
                            const buyBtn = findCardBuyButton(currCard);
                            if (!buyBtn) break;

                            buyBtn.click();
                            state.stats.purchases++;

                            const countAfter = await waitFor(() => {
                                const upd = findMarketCard(item.itemName);
                                const val = parseNumber(upd?.querySelector('.mk-tem')?.textContent);
                                return val !== null && countBefore !== null && val > countBefore ? val : null;
                            }, CONFIG.restock.buyConfirmTimeoutMs, 100);

                            if (countAfter === null) break;
                            state.lastActionNote = `${item.itemName}: ${countAfter}`;
                            await sleep(randomDelay(160, 280));
                        }
                    }
                } finally {
                    if (openedByBot && CONFIG.restock.closeMarketAfter && state.running) {
                        await closeActiveModal();
                    }
                }
            },
            { force }
        );
    };

    // --- 3. Auto-Passe Diário ---
    const checkDailyPass = async (force = false) => {
        if (!CONFIG.dailyPass.enabled && !force) return;
        const { level } = getTrainerHeaderInfo();
        if (!force && level !== null && level < 10) return;

        const nextAllowedMs = parseInt(localStorage.getItem(STORAGE_PASS_NEXT_KEY) || '0', 10);
        if (!force && nextAllowedMs > Date.now()) return;

        await withModalLock(
            'Passe',
            async () => {
                if (getVisibleModal()) await closeActiveModal();
                const passBtn = findMenuButtonByImg('passe-') || findClickableByText('Passe');
                if (!passBtn) return;

                passBtn.click();
                const resgatarBtn = await waitFor(() => document.querySelector('button.ps-resgatar'), 3500);
                if (!resgatarBtn) {
                    await closeActiveModal();
                    return;
                }
                await sleep(randomDelay(220, 360));

                if (!resgatarBtn.disabled && isInteractable(resgatarBtn)) {
                    resgatarBtn.click();
                    state.stats.passClaims++;
                    state.lastActionNote = 'Passe Diário resgatado!';
                    await sleep(randomDelay(450, 700));
                }

                const updatedBtn = document.querySelector('button.ps-resgatar');
                const nextTs = parseInt(updatedBtn?.querySelector('b[data-ps-relogio]')?.getAttribute('data-ps-relogio') || '0', 10);
                if (nextTs > Date.now()) {
                    localStorage.setItem(STORAGE_PASS_NEXT_KEY, String(nextTs + 5000));
                    if (resgatarBtn.disabled) {
                        state.lastActionNote = `Passe já resgatado (${updatedBtn.textContent.trim()})`;
                    }
                } else {
                    localStorage.setItem(STORAGE_PASS_NEXT_KEY, String(Date.now() + 3600000));
                }

                await closeActiveModal();
            },
            { force }
        );
    };

    // --- 4. Gestor de Depot ---
    const openBackpackPocket = async (abaKey) => {
        if (getVisibleModal()) await closeActiveModal();
        const bagBtn = document.getElementById('btn-bolsa');
        if (!bagBtn || !isInteractable(bagBtn)) return null;

        bagBtn.click();
        const bolsoBtn = await waitFor(
            () => document.querySelector(`.mochila-bolso[data-aba="${abaKey}"]`),
            3500
        );
        if (!bolsoBtn || !isInteractable(bolsoBtn)) {
            await closeActiveModal();
            return null;
        }
        bolsoBtn.click();
        await sleep(randomDelay(320, 480));
        return document.getElementById('bolsa-corpo');
    };

    const runDepotManager = async (force = false) => {
        const mode = CONFIG.depot.mode;
        if (mode === 'off') return;
        if (!force && Date.now() - state.lastDepotRunAt < CONFIG.depot.intervalMs) return;

        await withModalLock(
            `Depot:${mode}`,
            async () => {
                state.lastDepotRunAt = Date.now();
                try {
                    if (mode === 'venda') {
                        if (getVisibleModal()) await closeActiveModal();
                        const marketBtn = findMenuButtonByImg('menu-market') || findClickableByText('Market');
                        if (!marketBtn) return;
                        marketBtn.click();
                        if (!(await waitFor(isMarketOpen, 3500))) return;

                        await ensureMarketTab('pokemons');
                        await sleep(randomDelay(250, 400));

                        const infoTxt = document.querySelector('.mk-vt-info')?.textContent || '';
                        const countToSell = parseNumber(infoTxt.split('para vender')[0]);
                        const sellAllBtn = document.querySelector('.mk-vender-tudo button.mk-acao');

                        if (sellAllBtn && isInteractable(sellAllBtn) && (countToSell === null || countToSell > 0)) {
                            sellAllBtn.click();
                            await confirmModalDialog(['confirmar', 'vender', 'sim']);
                            state.stats.depotRuns++;
                            state.lastActionNote = `Depot vendido (${countToSell ?? '?'} pkm)`;
                        } else {
                            state.lastActionNote = 'Depot sem Pokémon para vender';
                        }
                    } else if (mode === 'oferenda') {
                        const corpo = await openBackpackPocket('oferenda');
                        if (!corpo) return;

                        const allBtn = document.getElementById('ofr-tudo');
                        if (allBtn && isInteractable(allBtn)) {
                            allBtn.click();
                            await confirmModalDialog(['confirmar', 'oferendar', 'sim']);
                            state.stats.depotRuns++;
                            state.lastActionNote = 'Oferenda em lote executada';
                        } else {
                            const autoBtn = document.getElementById('ofr-auto');
                            if (autoBtn && isInteractable(autoBtn)) {
                                autoBtn.click();
                                await sleep(randomDelay(260, 400));
                            }
                            const fastBtn = document.getElementById('ofr-rapida') || document.getElementById('ofr-girar');
                            if (fastBtn && isInteractable(fastBtn)) {
                                fastBtn.click();
                                await confirmModalDialog(['confirmar', 'oferendar', 'sim']);
                                state.stats.depotRuns++;
                                state.lastActionNote = 'Oferenda rápida executada';
                            } else {
                                state.lastActionNote = 'Oferenda: sem Pokémon elegíveis';
                            }
                        }
                    } else if (mode === 'sacrificio') {
                        const corpo = await openBackpackPocket('sacrificio');
                        if (!corpo) return;

                        const selBtn = document.getElementById('sac-todos');
                        if (selBtn && isInteractable(selBtn)) {
                            selBtn.click();
                            await sleep(randomDelay(260, 400));
                        }

                        const sacBtn = document.getElementById('sac-sacrificar');
                        if (sacBtn && isInteractable(sacBtn)) {
                            sacBtn.click();
                            await confirmModalDialog(['confirmar', 'sacrificar', 'sim']);
                            state.stats.depotRuns++;
                            state.lastActionNote = 'Sacrifício concluído';
                            await sleep(randomDelay(300, 450));
                        }

                        const native = readNativeSessionPanel();
                        const boostOn = Boolean(native?.boosts?.sacrificio);
                        const claimBtn = document.getElementById('sac-resgatar');
                        if (claimBtn && isInteractable(claimBtn) && (!boostOn || force)) {
                            claimBtn.click();
                            await confirmModalDialog(['confirmar', 'resgatar', 'sim']);
                            state.lastActionNote = 'Boost +20% XP resgatado!';
                        }
                    }
                } finally {
                    await closeActiveModal();
                }
            },
            { force }
        );
    };

    // --- 5. Auto-Chocadeira ---
    const EGG_PRIORITY_KEYWORDS = ['ovo shiny', 'shiny', 'p4', 'p3', 'p2', 'mystery egg'];

    const checkIncubator = async (force = false) => {
        if (!CONFIG.incubator.enabled && !force) return;
        if (!force && Date.now() < state.nextIncubatorCheckAt) return;

        await withModalLock(
            'Chocadeira',
            async () => {
                let hasActiveOrEgg = false;
                try {
                    const corpo = await openBackpackPocket('chocadeira');
                    if (!corpo) return;

                    const readyBtns = Array.from(corpo.querySelectorAll('.chc-slot button')).filter((b) => {
                        if (!isInteractable(b) || b.classList.contains('chc-liberar')) return false;
                        const t = normalizeText(b.textContent);
                        return t.includes('chocar') || t.includes('recolher') || t.includes('abrir') || t.includes('nascer');
                    });

                    for (const btn of readyBtns) {
                        btn.click();
                        state.stats.eggsHandled++;
                        state.lastActionNote = 'Ovo chocado!';
                        hasActiveOrEgg = true;
                        await sleep(randomDelay(400, 650));
                    }

                    const freeSlot = corpo.querySelector('.chc-slot.livre');
                    if (freeSlot) {
                        const slotBtns = Array.from(freeSlot.querySelectorAll('button')).filter(
                            (b) => isInteractable(b) && !b.classList.contains('chc-liberar')
                        );
                        if (slotBtns.length > 0) {
                            let chosenBtn = null;
                            for (const kw of EGG_PRIORITY_KEYWORDS) {
                                chosenBtn = slotBtns.find((b) => normalizeText(b.textContent).includes(kw));
                                if (chosenBtn) break;
                            }
                            chosenBtn = chosenBtn || slotBtns[0];
                            chosenBtn.click();
                            await confirmModalDialog(['confirmar', 'colocar', 'incubar', 'sim']);
                            state.stats.eggsHandled++;
                            state.lastActionNote = `Ovo incubado: ${chosenBtn.textContent.trim().slice(0, 24)}`;
                            hasActiveOrEgg = true;
                        }
                    }

                    const occupied = Array.from(corpo.querySelectorAll('.chc-slot')).some(
                        (s) => !s.classList.contains('livre') && !s.classList.contains('trancado')
                    );
                    if (occupied) hasActiveOrEgg = true;
                } finally {
                    state.nextIncubatorCheckAt =
                        Date.now() + (hasActiveOrEgg ? CONFIG.incubator.activeIntervalMs : CONFIG.incubator.emptyBackoffMs);
                    await closeActiveModal();
                }
            },
            { force }
        );
    };

    // --- 6. Bosses + Auto-Loot ---
    const dismissBossLoot = () => {
        if (!state.running || !CONFIG.boss.autoDismissLoot) return;
        const okBtn = document.getElementById('boss-loot-ok');
        if (okBtn && isInteractable(okBtn)) {
            okBtn.click();
            state.lastActionNote = 'Loot de Boss coletado!';
        }
    };

    const bossMatchesPriority = (detailEl, priority) => {
        if (priority === 'qualquer') return true;
        const html = (detailEl?.innerHTML || '').toLowerCase();
        const txt = normalizeText(detailEl?.textContent || '');
        if (priority === 'mega') return html.includes('fragmento-mega') || txt.includes('mega');
        if (priority === 'tm') return html.includes('tm_disk') || html.includes('zmove') || txt.includes('tm ');
        if (priority === 'tickets') return html.includes('mystic-ticket') || html.includes('safari-ticket') || txt.includes('ticket');
        return true;
    };

    const checkBosses = async (force = false) => {
        const prio = CONFIG.boss.priority;
        if (prio === 'off' && !force) return;
        if (!force && Date.now() - state.lastBossCheckAt < CONFIG.boss.checkIntervalMs) return;

        await withModalLock(
            'Bosses',
            async () => {
                state.lastBossCheckAt = Date.now();
                let entered = false;
                try {
                    if (getVisibleModal()) await closeActiveModal();
                    const bossBtn = findMenuButtonByImg('boss-cabeca') || findMenuButtonByImg('menu-bosses');
                    if (!bossBtn) return;
                    bossBtn.click();

                    const listEl = await waitFor(() => document.getElementById('boss-lista'), 3500);
                    if (!listEl) return;
                    await sleep(randomDelay(240, 380));

                    const items = Array.from(listEl.querySelectorAll('button.boss-item:not([data-key="@raid"])')).filter(isInteractable);
                    for (const item of items) {
                        if (!state.running) break;
                        item.click();
                        await sleep(randomDelay(220, 340));

                        const modalBody = document.getElementById('modal-corpo');
                        const challengeBtn = modalBody?.querySelector('button.boss-desafiar');
                        if (!challengeBtn || challengeBtn.disabled || !isInteractable(challengeBtn)) continue;

                        if (!bossMatchesPriority(modalBody, prio === 'off' ? 'qualquer' : prio)) continue;

                        const bossName = modalBody.querySelector('.boss-nome')?.textContent?.trim() || 'Boss';
                        challengeBtn.click();
                        await confirmModalDialog(['desafiar', 'entrar', 'confirmar', 'sim']);
                        state.stats.bossEntries++;
                        state.lastActionNote = `Entrou no Boss: ${bossName}`;
                        entered = true;
                        break;
                    }

                    if (!entered) {
                        state.lastActionNote = `Bosses (${prio}): nenhum disponível agora`;
                    }
                } finally {
                    if (!entered) await closeActiveModal();
                }
            },
            { force }
        );
    };

    // --- 7. Equipe + Dia Sazonal ---
    const getTeamCards = () => {
        const list = document.getElementById('time');
        if (!list) return [];

        return Array.from(list.querySelectorAll('.poke-linha')).map((el) => {
            const id = el.getAttribute('data-id') || '';
            const isActive = el.classList.contains('ativo');
            const nomeEl = el.querySelector('.pl-nome');
            const lvEl = el.querySelector('.pl-lv');
            const level = parseNumber(lvEl?.textContent) ?? 1;
            const name = getDirectText(nomeEl);

            const titleAttr = el.getAttribute('title') || '';
            const powerMatch = titleAttr.match(/poder\s+([\d.]+)/i);
            const power = powerMatch ? parseNumber(powerMatch[1]) : null;

            const types = [];
            titleAttr
                .toUpperCase()
                .split(/[\s/·,]+/)
                .forEach((tok) => {
                    if (VALID_TYPES.has(tok) && !types.includes(tok)) types.push(tok);
                });

            const hpStyle = el.querySelector('.mini-hp i')?.style?.width || '';
            const hpPercent = hpStyle.endsWith('%') ? Math.round(parseFloat(hpStyle)) : 100;

            return { el, id, key: id || `${name}_${level}`, name, level, power, types, hpPercent, isActive };
        });
    };

    const triggerTeamSwap = (chosen, noteLabel) => {
        const clickTarget = chosen.el.querySelector('.pl-info') || chosen.el;
        if (!isVisible(clickTarget)) return;

        const snap = readNativeSessionPanel();
        state.teamSwapPotionSnap = snap
            ? { pocoes: snap.pocoesUsadas, revives: snap.revivesUsados }
            : null;

        clickTarget.click();
        state.lastTeamSwapAt = Date.now();

        setTimeout(() => {
            if (!state.running) return;
            const currentActiveRow = document.querySelector('#time .poke-linha.ativo');
            const swapped =
                (chosen.id && currentActiveRow?.getAttribute('data-id') === chosen.id) ||
                getActivePokemon()?.name.toLowerCase() === chosen.name.toLowerCase();

            if (swapped) {
                state.stats.teamSwaps++;
                state.lastActionNote = noteLabel || `Equipe: ${chosen.name} Nv${chosen.level}`;
            } else {
                state.failedSwapUntil[chosen.key] = Date.now() + CONFIG.team.failedSwapBackoffMs;
            }
        }, 1600);
    };

    const checkTeamRotation = () => {
        if (!state.running || state.paused || CONFIG.team.mode === 'off') return;
        if (state.modalLockOwner || isInSpecialArena()) return;

        const now = Date.now();
        const active = getActivePokemon();
        const hunt = getCurrentHunt();
        const { level: trainerLv } = getTrainerHeaderInfo();
        const team = getTeamCards();
        if (!active || team.length < 2) return;

        const eligible = team.filter((p) => {
            if (trainerLv !== null && p.level > trainerLv + 5) return false;
            if (p.hpPercent <= 0) return false;
            if ((state.failedSwapUntil[p.key] || 0) > now) return false;
            return true;
        });
        if (eligible.length < 2) return;

        const activeRow = team.find((p) => p.isActive) || null;
        const strongest = [...eligible].sort(
            (a, b) => b.level - a.level || (b.power ?? 0) - (a.power ?? 0)
        )[0];

        if (CONFIG.team.mode === 'equilibrar' && activeRow && strongest && activeRow.key !== strongest.key) {
            const snap = readNativeSessionPanel();
            const spentSupply = Boolean(
                snap &&
                    state.teamSwapPotionSnap &&
                    (snap.pocoesUsadas > state.teamSwapPotionSnap.pocoes ||
                        snap.revivesUsados > state.teamSwapPotionSnap.revives)
            );
            const lowHp = active.hpPercent !== null && active.hpPercent < CONFIG.team.rescueHpPercent;
            const tooWeak = active.power !== null && active.power < CONFIG.team.minTrainPower;

            if (spentSupply || lowHp || tooWeak) {
                if (now - state.lastTeamSwapAt >= ESPERA_TROCA_ATIVO_MS) {
                    state.unsafeTrainUntil[activeRow.key] = now + CONFIG.team.unsafeBackoffMs;
                    triggerTeamSwap(strongest, `Resgate: ${strongest.name} (${activeRow.name} frágil)`);
                }
                return;
            }
        }

        const cooldown = Math.max(CONFIG.team.swapCooldownMs, ESPERA_TROCA_ATIVO_MS);
        if (now - state.lastTeamSwapAt < cooldown) return;

        let chosen = null;
        if (CONFIG.team.mode === 'sazonal') {
            const dayType = getSeasonalDayType();
            if (dayType && !active.types.includes(dayType)) {
                const matching = eligible
                    .filter((p) => p.types.includes(dayType) && !p.isActive)
                    .sort((a, b) => b.level - a.level || (b.power ?? 0) - (a.power ?? 0));
                if (matching.length > 0) chosen = matching[0];
            }
        } else if (CONFIG.team.mode === 'equilibrar') {
            const minSafeLevel = hunt ? Math.max(1, hunt.targetLevel - CONFIG.team.maxGapBelowHunt) : 1;
            const safeToTrain = eligible
                .filter((p) => {
                    if (p.level < minSafeLevel) return false;
                    if (p.hpPercent < CONFIG.team.minTrainHpPercent) return false;
                    if (p.power !== null && p.power < CONFIG.team.minTrainPower) return false;
                    if ((state.unsafeTrainUntil[p.key] || 0) > now) return false;
                    return true;
                })
                .sort((a, b) => a.level - b.level || (b.power ?? 0) - (a.power ?? 0));

            if (safeToTrain.length > 0 && !safeToTrain[0].isActive && safeToTrain[0].level + 1 < (active.level ?? 1)) {
                chosen = safeToTrain[0];
            }
        }

        if (chosen && !chosen.isActive) {
            triggerTeamSwap(chosen, `Equipe: ${chosen.name} Nv${chosen.level}`);
        }
    };

    // --- 8. Auto-Evoluir ---
    const autoEvolveCheck = async () => {
        if (!state.running || state.paused || !CONFIG.evolve.enabled) return;
        if (state.modalLockOwner || getVisibleModal()) return;
        if (Date.now() - state.lastEvolveAt < CONFIG.evolve.cooldownMs) return;

        const evolveBtn = document.getElementById('btn-evoluir');
        if (!evolveBtn || !isInteractable(evolveBtn)) return;

        await withModalLock('Evoluindo', async () => {
            state.lastEvolveAt = Date.now();
            evolveBtn.click();
            await confirmModalDialog(['evoluir', 'confirmar', 'sim']);
            state.lastActionNote = 'Pokémon evoluído!';
        });
    };

    // --- 9. Radar RMT ---
    const parseRmtPriceEl = (priceEl) => {
        if (!priceEl) return null;
        const isGems =
            priceEl.classList.contains('orb') ||
            Boolean(priceEl.querySelector('img[src*="moeda-gema"]'));
        const value = parseNumber(priceEl.textContent);
        if (!value || value <= 0) return null;
        return { value, currency: isGems ? 'gemas' : 'coins' };
    };

    const scanMarketRadar = () => {
        if (!state.running || !CONFIG.radar.enabled || CONFIG.radar.alerts.length === 0) return;

        const title = normalizeText(document.getElementById('modal-titulo')?.textContent);
        if (!title.includes('mercado da comunidade')) return;

        const corpo = document.getElementById('modal-corpo');
        if (!corpo || !isVisible(corpo)) return;

        const hits = [];

        corpo.querySelectorAll('.cm-card').forEach((card) => {
            if (!isVisible(card)) return;
            const nameText = card.querySelector('.cm-nome-txt')?.textContent?.trim() || '';
            const priceInfo = parseRmtPriceEl(card.querySelector('.cm-rodape .cm-preco'));
            if (!nameText || !priceInfo) return;

            const normName = normalizeText(nameText);
            for (const rule of CONFIG.radar.alerts) {
                if (!normName.includes(normalizeText(rule.nome))) continue;
                if (rule.moeda !== 'todas' && rule.moeda !== priceInfo.currency) continue;
                if (priceInfo.value > rule.maxPreco) continue;

                card.style.outline = '2px solid #22c55e';
                card.style.boxShadow = '0 0 12px rgba(34,197,94,0.55)';

                const hitKey = `pk_${normName}_${priceInfo.value}_${priceInfo.currency}`;
                hits.push({ nome: nameText, preco: priceInfo.value, moeda: priceInfo.currency });

                if (!state.radarNotifiedKeys.has(hitKey)) {
                    state.radarNotifiedKeys.add(hitKey);
                    if (CONFIG.radar.soundAlert) playBeep(960, 0.18);
                    state.lastActionNote = `RMT! ${nameText} por ${priceInfo.value.toLocaleString('pt-BR')} ${priceInfo.currency}`;
                }

                if (rule.autoComprar) {
                    const buyBtn = card.querySelector('button.cm-btn.comprar');
                    if (buyBtn && isInteractable(buyBtn) && !buyBtn.classList.contains('cm-retido')) {
                        buyBtn.click();
                        state.lastActionNote = `Compra RMT: ${nameText}`;
                    }
                }
            }
        });

        corpo.querySelectorAll('button.cmi-linha').forEach((row) => {
            if (!isVisible(row)) return;
            const itemName = row.querySelector('.cmi-nome b')?.textContent?.trim() || '';
            if (!itemName) return;

            const normName = normalizeText(itemName);
            const priceNodes = Array.from(row.querySelectorAll('.cmi-precos .cmi-de:not(.nada) .cm-preco'));

            for (const pNode of priceNodes) {
                const priceInfo = parseRmtPriceEl(pNode);
                if (!priceInfo) continue;

                for (const rule of CONFIG.radar.alerts) {
                    if (!normName.includes(normalizeText(rule.nome))) continue;
                    if (rule.moeda !== 'todas' && rule.moeda !== priceInfo.currency) continue;
                    if (priceInfo.value > rule.maxPreco) continue;

                    row.style.outline = '2px solid #22c55e';
                    row.style.boxShadow = '0 0 12px rgba(34,197,94,0.55)';

                    const hitKey = `it_${normName}_${priceInfo.value}_${priceInfo.currency}`;
                    hits.push({ nome: itemName, preco: priceInfo.value, moeda: priceInfo.currency });

                    if (!state.radarNotifiedKeys.has(hitKey)) {
                        state.radarNotifiedKeys.add(hitKey);
                        if (CONFIG.radar.soundAlert) playBeep(960, 0.18);
                        state.lastActionNote = `RMT Item! ${itemName} por ${priceInfo.value.toLocaleString('pt-BR')} ${priceInfo.currency}`;
                    }
                }
            }
        });

        state.radarHits = hits;
    };

    const adicionarAlertaRadar = ({ nome, maxPreco, moeda = 'coins', autoComprar = false }) => {
        if (!nome || !maxPreco) return false;
        CONFIG.radar.alerts.push({
            nome: String(nome).trim(),
            maxPreco: Number(maxPreco),
            moeda: normalizeText(moeda),
            autoComprar: Boolean(autoComprar),
        });
        persistPrefs();
        renderAlertList();
        return true;
    };

    const removerAlertaRadar = (index) => {
        if (index < 0 || index >= CONFIG.radar.alerts.length) return;
        CONFIG.radar.alerts.splice(index, 1);
        persistPrefs();
        renderAlertList();
    };

    // --- 10. Assistente de Mini Games ---
    const dexNumberToRegion = (num) => {
        if (!num || num <= 0) return '';
        if (num <= 151) return 'kanto';
        if (num <= 251) return 'johto';
        if (num <= 386) return 'hoenn';
        if (num <= 493) return 'sinnoh';
        if (num <= 649) return 'unova';
        if (num <= 721) return 'kalos';
        if (num <= 809) return 'alola';
        if (num <= 905) return 'galar';
        if (num <= 1025) return 'paldea';
        return '';
    };

    const parsePokedexCsv = (csvText) => {
        const lines = (csvText || '').split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) return [];

        const sep = lines[0].includes(';') ? ';' : ',';
        const headers = lines[0].split(sep).map((h) => normalizeText(h.replace(/^"|"$/g, '')));
        const col = (candidates) => headers.findIndex((h) => candidates.some((c) => h.includes(c)));

        const idIdx = col(['#', 'id', 'num', 'dex']);
        const nameIdx = col(['nome', 'name', 'especie', 'pokemon']);
        const type1Idx = col(['tipo1', 'tipo 1', 'type1', 'tipo', 'type']);
        const type2Idx = col(['tipo2', 'tipo 2', 'type2']);
        const regIdx = col(['regiao', 'region', 'geracao', 'gen']);

        if (nameIdx === -1) return [];

        const map = new Map();
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(sep).map((v) => v.replace(/^"|"$/g, '').trim());
            const name = cols[nameIdx];
            if (!name || map.has(name)) continue;

            const types = [];
            const rawTypes = `${cols[type1Idx] || ''} ${type2Idx !== -1 ? cols[type2Idx] || '' : ''}`;
            rawTypes.split(/[\s/|,]+/).forEach((rawTok) => {
                const canonical = TYPE_ALIASES[normalizeText(rawTok)];
                if (canonical && !types.includes(canonical)) types.push(canonical);
            });

            const dexId = idIdx !== -1 ? parseNumber(cols[idIdx]) : null;
            const region = regIdx !== -1 && cols[regIdx] ? normalizeText(cols[regIdx]) : dexNumberToRegion(dexId);

            map.set(name, {
                id: dexId,
                name,
                cleanName: cleanKey(name),
                types,
                region,
            });
        }

        const list = Array.from(map.values());
        state.dexCatalog = list;
        saveJson(STORAGE_DEX_KEY, list);
        state.lastActionNote = `Pokedex importada: ${list.length} espécies`;
        updateHud();
        return list;
    };

    const abrirSeletorCsvPokedex = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,.txt';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            const text = await file.text();
            parsePokedexCsv(text);
        };
        input.click();
    };

    const applyMiniGameGuess = (pokemonName, submit = false) => {
        const input = document.getElementById('mg-input');
        if (!input || !isInteractable(input)) return false;

        input.value = pokemonName;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();

        if (submit) {
            const sendBtn = document.getElementById('mg-enviar');
            if (sendBtn && isInteractable(sendBtn)) {
                sendBtn.click();
                return true;
            }
            const form = input.closest('form');
            if (form) {
                form.requestSubmit
                    ? form.requestSubmit()
                    : form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                return true;
            }
            return false;
        }
        return true;
    };

    const updateMiniGameHelper = () => {
        if (!state.running || !CONFIG.minigame.enabled || state.dexCatalog.length === 0) return;

        const tela = document.getElementById('mg-tela');
        if (!tela || !isVisible(tela) || tela.getAttribute('data-fase') !== 'palpites') {
            if (state.miniGameMatches.length > 0) {
                state.miniGameMatches = [];
                renderQuizCandidates();
            }
            return;
        }

        const barraSig = document.getElementById('mg-barra')?.getAttribute('data-sig') || '';
        const roundId = barraSig.split('|')[0] || '';
        if (roundId && roundId !== state.currentMiniGameRoundId) {
            state.currentMiniGameRoundId = roundId;
            state.roundTriedNames.clear();
            state.lastGuessedStageKey = '';
        }

        const pistasEl = tela.querySelector('.mg-pistas');
        if (!pistasEl) return;

        const clueTypes = [];
        pistasEl.querySelectorAll('.mg-tipo-sel').forEach((badge) => {
            for (const cls of badge.classList) {
                const up = cls.toUpperCase();
                if (VALID_TYPES.has(up) && !clueTypes.includes(up)) clueTypes.push(up);
            }
        });

        let clueRegion = null;
        const regions = ['kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea'];
        pistasEl.querySelectorAll('.mg-par:not(.trava)').forEach((par) => {
            const rot = normalizeText(par.querySelector('.mg-pista-rot')?.textContent);
            const val = normalizeText(par.querySelector('.mg-pista-val')?.textContent);
            if (rot.includes('regiao')) {
                const found = regions.find((r) => val.includes(r));
                if (found) clueRegion = found;
            }
        });

        let letterPattern = null;
        const letrasEl = pistasEl.querySelector('.mg-pista-letras');
        if (letrasEl) {
            const cells = Array.from(letrasEl.querySelectorAll('span, i, b')).filter((c) => {
                const t = (c.textContent || '').trim();
                return c.children.length === 0 && t.length <= 2;
            });
            if (cells.length >= 3) {
                const chars = cells.map((c) => {
                    const ch = cleanKey(c.textContent);
                    return ch.length === 1 ? ch : '.';
                });
                letterPattern = new RegExp(`^${chars.join('')}$`);
            }
        }

        if (clueTypes.length === 0 && !clueRegion && !letterPattern) {
            if (state.miniGameMatches.length > 0) {
                state.miniGameMatches = [];
                renderQuizCandidates();
            }
            return;
        }

        let matches = state.dexCatalog;
        if (clueTypes.length > 0) {
            matches = matches.filter((p) => clueTypes.every((t) => p.types.includes(t)));
            if (clueTypes.length === 1) {
                matches = [...matches].sort((a, b) => a.types.length - b.types.length);
            }
        }
        if (clueRegion) {
            matches = matches.filter((p) => !p.region || p.region.includes(clueRegion));
        }
        if (letterPattern) {
            matches = matches.filter((p) => letterPattern.test(p.cleanName));
        }

        const untried = matches.filter((p) => !state.roundTriedNames.has(p.cleanName));
        state.miniGameMatches = untried.slice(0, 8).map((p) => p.name);
        renderQuizCandidates();

        if (
            CONFIG.minigame.autoGuess &&
            untried.length >= 1 &&
            untried.length <= CONFIG.minigame.autoGuessMaxCandidates
        ) {
            const stageKey = `${roundId || 'mg'}_${tela.getAttribute('data-estagio') || '0'}`;
            if (state.lastGuessedStageKey !== stageKey) {
                const pick = untried[0];
                if (applyMiniGameGuess(pick.name, true)) {
                    state.lastGuessedStageKey = stageKey;
                    state.roundTriedNames.add(pick.cleanName);
                    state.lastActionNote = `Quiz auto (${untried.length} opç.): ${pick.name}`;
                    renderQuizCandidates();
                }
            }
        }
    };

    // --- 11. Telemetria Híbrida (#sessao-painel + Fallback #hud-log) ---
    const createSession = (hunt, pokemon, markerMeta = null) => ({
        regionKey: hunt ? hunt.key : 'Centro / Fora',
        targetName: hunt ? hunt.targetName : 'Nenhum',
        targetLevel: hunt ? hunt.targetLevel : null,
        markerMeta,
        pokemonName: pokemon ? pokemon.name : 'Desconhecido',
        pokemonLevel: pokemon ? pokemon.level : null,
        pokemonTypes: pokemon ? pokemon.types : [],
        startedAt: Date.now(),
        startSnap: readNativeSessionPanel(),
        latestSnap: readNativeSessionPanel(),
        logKills: 0,
        logXpPoke: 0,
        logGold: 0,
        minHpPercent: pokemon?.hpPercent ?? 100,
    });

    const handleCombatLogNode = (node) => {
        if (!state.running || !state.session || node.nodeType !== Node.ELEMENT_NODE) return;
        const txt = node.textContent || '';
        if (txt.includes('derrotado!')) {
            state.session.logKills++;
            const xpMatch = txt.match(/\+([\d.]+)\s*xp\s*pok[eé]mon/i);
            const goldMatch = txt.match(/\+([\d.]+)\s*ouro/i);
            if (xpMatch) state.session.logXpPoke += parseNumber(xpMatch[1]) ?? 0;
            if (goldMatch) state.session.logGold += parseNumber(goldMatch[1]) ?? 0;
        } else if (normalizeText(txt).includes('capturado')) {
            state.stats.captures++;
        }
    };

    const ensureCombatLogObserver = () => {
        const logNode = document.getElementById('hud-log');
        if (logNode === state.observedLogNode) return;

        if (state.logObserver) {
            state.logObserver.disconnect();
            state.logObserver = null;
            state.observedLogNode = null;
        }
        if (logNode) {
            state.observedLogNode = logNode;
            state.logObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    for (const added of m.addedNodes) {
                        handleCombatLogNode(added);
                    }
                }
            });
            state.logObserver.observe(logNode, { childList: true });
        }
    };

    const computeSessionMetrics = (s, now = Date.now()) => {
        const elapsedSec = Math.max(1, Math.floor((now - s.startedAt) / 1000));
        const minutes = elapsedSec / 60;

        const a = s.startSnap;
        const b = s.latestSnap || a;
        const useNative = Boolean(a && b);

        const dKills = useNative ? Math.max(0, b.abates - a.abates) : s.logKills;
        const dXpPoke = useNative ? Math.max(0, b.xpPokemon - a.xpPokemon) : s.logXpPoke;
        const dGold = useNative ? Math.max(0, b.gold - a.gold) : s.logGold;
        const dLucro = useNative ? b.lucro - a.lucro : s.logGold;
        const dPotions = useNative ? Math.max(0, b.pocoesUsadas - a.pocoesUsadas) : 0;
        const dRevives = useNative ? Math.max(0, b.revivesUsados - a.revivesUsados) : 0;

        const killsPerMin = +(dKills / minutes).toFixed(2);
        const xpPokePerMin = Math.round(dXpPoke / minutes);
        const goldGrossPerMin = Math.round(dGold / minutes);
        const lucroPerMin = Math.round(dLucro / minutes);
        const potionsPerMin = +(dPotions / minutes).toFixed(2);
        const revivesPerMin = +(dRevives / minutes).toFixed(2);

        const safe =
            revivesPerMin === 0 &&
            potionsPerMin <= CONFIG.farm.maxPotionsPerMinSafe &&
            s.minHpPercent >= CONFIG.farm.minHpPercentSafe;

        return {
            regiao: s.regionKey,
            pokemon: `${s.pokemonName} Nv${s.pokemonLevel ?? '?'}`,
            tempoSeg: elapsedSec,
            abates: dKills,
            abatesMin: killsPerMin,
            xpPokeMin: xpPokePerMin,
            ouroBrutoMin: goldGrossPerMin,
            lucroLiqMin: lucroPerMin,
            pocoesMin: potionsPerMin,
            revivesMin: revivesPerMin,
            minHpPct: s.minHpPercent,
            segura: safe,
        };
    };

    const scoreRecord = (r, modo = CONFIG.mode) => {
        const safetyWeight = r.segura ? 1 : 0.25;
        if (modo === 'xp') return r.xpPokeMin * safetyWeight;
        if (modo === 'ouro') return Math.max(0, r.lucroLiqMin) * safetyWeight;
        if (modo === 'topcatch') return (r.abatesMin * 100 + r.xpPokeMin * 0.2) * safetyWeight;
        return (r.xpPokeMin * 0.65 + Math.max(0, r.lucroLiqMin) * 0.35) * safetyWeight;
    };

    const persistCurrentSession = (forceSave = false) => {
        const s = state.session;
        if (!s || !s.regionKey || s.regionKey === 'Centro / Fora') return null;

        const metrics = computeSessionMetrics(s);
        if (!forceSave && (metrics.tempoSeg < CONFIG.farm.minSampleSec || metrics.abates < CONFIG.farm.minKillsToSave)) {
            return null;
        }

        const recordKey = `${s.pokemonName}__${s.regionKey}`;
        const prev = state.history[recordKey];
        const record = {
            ...metrics,
            pokemonName: s.pokemonName,
            pokemonLevel: s.pokemonLevel,
            targetLevel: s.targetLevel,
            markerMeta: s.markerMeta || prev?.markerMeta || null,
            updatedAt: new Date().toISOString(),
        };

        state.history[recordKey] = record;
        saveJson(STORAGE_HISTORY_KEY, state.history);
        return record;
    };

    const checkVersionAlert = () => {
        const aviso = document.getElementById('aviso-versao');
        if (aviso && isVisible(aviso) && !state.paused) {
            state.paused = true;
            setStatus('Atualização!', 'Nova versão detectada — recarregue o jogo');
            playBeep(520, 0.25);
        }
    };

    const updateFarmTelemetry = () => {
        if (!state.running || !CONFIG.farm.enabled) return;

        ensureCombatLogObserver();
        checkVersionAlert();

        const hunt = getCurrentHunt();
        const poke = getActivePokemon();
        const snap = readNativeSessionPanel();

        if (snap) {
            if (state.lastShiniesVistos === null) {
                state.lastShiniesVistos = snap.shiniesVistos;
            } else if (snap.shiniesVistos > state.lastShiniesVistos) {
                state.lastShiniesVistos = snap.shiniesVistos;
                state.stats.shiniesSpotted++;
                if (CONFIG.shinyGuard.soundAlert) playBeep(1180, 0.25);
                state.lastActionNote = '✨ Shiny apareceu na sessão!';
            } else if (snap.shiniesVistos < state.lastShiniesVistos) {
                state.lastShiniesVistos = snap.shiniesVistos;
            }

            if (state.lastSessionCaptures === null) {
                state.lastSessionCaptures = snap.capturas;
            } else if (snap.capturas > state.lastSessionCaptures) {
                state.stats.captures += snap.capturas - state.lastSessionCaptures;
                state.lastSessionCaptures = snap.capturas;
                if (
                    CONFIG.topCatchHop.enabled &&
                    !state.modalLockOwner &&
                    !state.shinyAlertActive &&
                    Date.now() - state.lastHopAt >= CONFIG.topCatchHop.hopCooldownMs
                ) {
                    state.lastHopAt = Date.now();
                    setTimeout(() => {
                        if (state.running && !state.shinyAlertActive) hopNextTopCatchArea(false);
                    }, 1000);
                }
            } else if (snap.capturas < state.lastSessionCaptures) {
                state.lastSessionCaptures = snap.capturas;
            }
        }

        if (!state.session) {
            state.session = createSession(hunt, poke, state.lastMarkerMeta);
        } else if (hunt && hunt.key !== state.session.regionKey) {
            persistCurrentSession(false);
            state.session = createSession(hunt, poke, state.lastMarkerMeta);
        } else if (poke && poke.name !== state.session.pokemonName) {
            persistCurrentSession(false);
            state.session = createSession(hunt, poke, state.lastMarkerMeta);
        } else {
            if (poke) {
                state.session.pokemonLevel = poke.level;
                if (poke.hpPercent !== null && poke.hpPercent < state.session.minHpPercent) {
                    state.session.minHpPercent = poke.hpPercent;
                }
            }
            if (snap) {
                if (state.session.startSnap && snap.abates < state.session.startSnap.abates) {
                    state.session.startSnap = snap;
                    state.session.startedAt = Date.now();
                }
                if (!state.session.startSnap) state.session.startSnap = snap;
                state.session.latestSnap = snap;
            }
        }

        persistCurrentSession(false);
    };

    // --- 12. Mapa, Benchmark, Auto-Hop e Fila /hunt ---
    const isMapModalOpen = () => {
        const modal = getVisibleModal();
        return Boolean(modal && modal.querySelector('.mapa-barra'));
    };

    const openMapModal = async () => {
        if (isMapModalOpen()) return getVisibleModal();
        if (getVisibleModal()) await closeActiveModal();
        const mapBtn = findMenuButtonByImg('menu-mapa') || findClickableByText('Mapa');
        if (!mapBtn) return null;
        mapBtn.click();
        const modal = await waitFor(() => (isMapModalOpen() ? getVisibleModal() : null), 3800);
        if (modal) await sleep(randomDelay(240, 380));
        return modal;
    };

    const ensureMapViewMode = async (modal, modeLabel = 'MAPA') => {
        const btns = Array.from(modal.querySelectorAll('.mapa-modo button.mapa-modo-bt'));
        const target = btns.find((b) => normalizeText(b.textContent) === normalizeText(modeLabel));
        if (target && !target.classList.contains('on') && isInteractable(target)) {
            target.click();
            await sleep(randomDelay(200, 340));
        }
    };

    const applyMapFilters = async (
        modal,
        { pokemonTypes = [], useTypeAdvantage = true, onlyUnlocked = true, pokedexFilter = null } = {}
    ) => {
        const bar = modal.querySelector('.mapa-barra');
        if (!bar) return;

        const tipoTrigger = Array.from(bar.querySelectorAll('button')).find((b) =>
            normalizeText(b.textContent).startsWith('tipo')
        );
        if (tipoTrigger && isInteractable(tipoTrigger)) {
            const ensureTipoOpen = async () => {
                if (!findClickableByText('todos os tipos', modal, true)) {
                    tipoTrigger.click();
                    await waitFor(() => findClickableByText('todos os tipos', modal, true), 1400);
                    await sleep(120);
                }
            };
            await ensureTipoOpen();
            const resetBtn = findClickableByText('todos os tipos', modal, true);
            if (resetBtn) {
                resetBtn.click();
                await sleep(150);
            }
            if (useTypeAdvantage && pokemonTypes.length > 0) {
                await ensureTipoOpen();
                for (const type of pokemonTypes) {
                    const typeBtn = findClickableByText(type, modal, true);
                    if (typeBtn) {
                        typeBtn.click();
                        await sleep(120);
                    }
                }
                const weakBtn = findClickableByText('Fraco contra', modal, true);
                if (weakBtn) {
                    weakBtn.click();
                    await sleep(150);
                }
            }
            if (findClickableByText('todos os tipos', modal, true)) {
                tipoTrigger.click();
                await sleep(120);
            }
        }

        const dexTrigger = Array.from(bar.querySelectorAll('button')).find((b) =>
            normalizeText(b.textContent).startsWith('pokedex')
        );
        if (dexTrigger && isInteractable(dexTrigger)) {
            const desiredLabel = pokedexFilter || 'Todos';
            if (!normalizeText(dexTrigger.textContent).includes(normalizeText(desiredLabel))) {
                dexTrigger.click();
                const option = await waitFor(
                    () => findClickableByText(desiredLabel, modal, desiredLabel === 'Todos'),
                    1400
                );
                if (option) {
                    option.click();
                    await sleep(150);
                } else {
                    dexTrigger.click();
                    await sleep(120);
                }
            }
        }

        if (onlyUnlocked) {
            const nivelTrigger = Array.from(bar.querySelectorAll('button')).find((b) =>
                normalizeText(b.textContent).startsWith('nivel')
            );
            if (nivelTrigger && isInteractable(nivelTrigger)) {
                const findUnlockedCb = () =>
                    Array.from(modal.querySelectorAll('input[type="checkbox"]')).find((cb) => {
                        const parentTxt = normalizeText(cb.closest('label, div')?.textContent);
                        return parentTxt.includes('liberadas') && isVisible(cb);
                    });

                if (!findUnlockedCb()) {
                    nivelTrigger.click();
                    await waitFor(findUnlockedCb, 1400);
                    await sleep(120);
                }
                const cb = findUnlockedCb();
                if (cb && !cb.checked) {
                    cb.click();
                    await sleep(150);
                }
                if (findUnlockedCb()) {
                    nivelTrigger.click();
                    await sleep(120);
                }
            }
        }
    };

    const getMarkerSignature = (btn, regionName) => {
        const left = btn.style.left || '';
        const top = btn.style.top || '';
        const title = btn.getAttribute('title') || btn.getAttribute('aria-label') || '';
        const level = parseNumber(btn.textContent) ?? 0;
        return `${regionName}::${level}::${left},${top}::${title}`;
    };

    const selectMapRegionTab = async (modal, regionName) => {
        const regBtn = Array.from(
            modal.querySelectorAll('button.mapa-reg-bt:not(.mapa-area-travada)')
        ).find((b) => normalizeText(b.textContent).startsWith(normalizeText(regionName)));
        if (!regBtn) return false;
        if (!regBtn.classList.contains('on')) {
            regBtn.click();
            await sleep(randomDelay(220, 340));
        }
        return true;
    };

    const collectCandidatesFromOpenMap = async (modal, poke, useTypeAdvantage, pokedexFilter, ascending = false) => {
        await ensureMapViewMode(modal, 'MAPA');
        await applyMapFilters(modal, {
            pokemonTypes: poke?.types || [],
            useTypeAdvantage,
            onlyUnlocked: CONFIG.map.onlyUnlocked,
            pokedexFilter,
        });

        const unlockedRegions = Array.from(
            modal.querySelectorAll('button.mapa-reg-bt:not(.mapa-area-travada)')
        );

        const candidates = [];
        const pokeLevel = poke?.level ?? 1;
        const trainerLevel = getTrainerHeaderInfo().level ?? pokeLevel;
        const maxLevel = Math.min(trainerLevel, pokeLevel + CONFIG.map.maxLevelAbovePokemon);

        for (const regBtn of unlockedRegions) {
            const regionName = (regBtn.textContent || '').split('\n')[0].trim();
            if (!regBtn.classList.contains('on')) {
                regBtn.click();
                await sleep(randomDelay(220, 340));
            }
            const markers = Array.from(
                modal.querySelectorAll('button.marcador:not(.travado)')
            ).filter(isInteractable);

            markers.forEach((btn, idx) => {
                const areaLevel = parseNumber(btn.textContent) ?? 1;
                if (areaLevel > maxLevel) return;
                candidates.push({
                    regionName,
                    areaLevel,
                    indexInRegion: idx,
                    signature: getMarkerSignature(btn, regionName),
                    isCurrent: btn.classList.contains('on'),
                });
            });
        }

        candidates.sort((a, b) => (ascending ? a.areaLevel - b.areaLevel : b.areaLevel - a.areaLevel));
        return candidates;
    };

    const waitForAreaSwitchCooldown = async () => {
        const remaining = CONFIG.map.switchCooldownMs - (Date.now() - state.lastAreaSwitchAt);
        if (remaining > 0) {
            state.lastActionNote = `Trava de área (${(remaining / 1000).toFixed(1)}s)`;
            updateHud();
            await sleep(remaining);
        }
    };

    const travelToMarkerMeta = async (meta) => {
        if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return false;
        await waitForAreaSwitchCooldown();
        if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return false;

        const modal = await openMapModal();
        if (!modal) return false;

        await ensureMapViewMode(modal, 'MAPA');
        await applyMapFilters(modal, {
            pokemonTypes: [],
            useTypeAdvantage: false,
            onlyUnlocked: CONFIG.map.onlyUnlocked,
            pokedexFilter: null,
        });

        const switched = await selectMapRegionTab(modal, meta.regionName);
        if (!switched) {
            await closeActiveModal();
            return false;
        }

        const markers = Array.from(
            modal.querySelectorAll('button.marcador:not(.travado)')
        ).filter(isInteractable);

        let targetBtn = markers.find((b) => getMarkerSignature(b, meta.regionName) === meta.signature);
        if (!targetBtn && markers[meta.indexInRegion]) targetBtn = markers[meta.indexInRegion];

        if (!targetBtn) {
            await closeActiveModal();
            return false;
        }

        if (targetBtn.classList.contains('on')) {
            await closeActiveModal();
            state.lastMarkerMeta = meta;
            return true;
        }

        const prevHuntKey = getCurrentHunt()?.key || null;
        targetBtn.click();

        const traveled = await waitFor(() => {
            if (!getVisibleModal()) return true;
            const currKey = getCurrentHunt()?.key || null;
            if (prevHuntKey && currKey && currKey !== prevHuntKey) return true;
            const activeModal = getVisibleModal();
            if (activeModal) {
                const confirmBtn =
                    document.getElementById('confirmar-sim') ||
                    Array.from(activeModal.querySelectorAll('button')).find((b) => {
                        if (!isInteractable(b) || b.closest('.mapa-barra') || b.closest('.mapa-mundi')) return false;
                        const t = normalizeText(b.textContent);
                        return t === 'ir' || t.includes('viajar') || t.includes('cacar') || t.includes('entrar');
                    });
                if (confirmBtn && isInteractable(confirmBtn)) confirmBtn.click();
            }
            return false;
        }, 2800, 140);

        if (getVisibleModal()) await closeActiveModal();

        if (traveled) {
            state.lastAreaSwitchAt = Date.now();
            state.lastMarkerMeta = meta;
            state.stats.regionSwitches++;
            await sleep(randomDelay(300, 480));
        }
        return Boolean(traveled);
    };

    const saveHuntQueueState = () => {
        saveJson(STORAGE_HUNT_QUEUE_KEY, {
            mode: CONFIG.mode,
            updatedAt: Date.now(),
            index: state.huntQueueIndex,
            items: state.huntQueue,
        });
    };

    const definirFilaHunt = (list) => {
        if (!Array.isArray(list)) return [];
        state.huntQueue = list
            .map((entry) =>
                typeof entry === 'string'
                    ? { name: entry.trim(), raw: entry.trim(), mode: CONFIG.mode }
                    : { ...entry, name: String(entry?.name || '').trim() }
            )
            .filter((x) => x.name.length > 0);
        state.huntQueueIndex = 0;
        saveHuntQueueState();
        state.lastActionNote = `Fila /hunt: ${state.huntQueue.length} áreas`;
        updateHud();
        return state.huntQueue;
    };

    const syncHuntGuideQueue = async (force = false) => {
        return withModalLock(
            'Sync /hunt',
            async () => {
                let items = [];
                if (typeof window.__POKEBOT_SYNC_HUNT_GUIDE__ === 'function') {
                    const res = await window.__POKEBOT_SYNC_HUNT_GUIDE__(CONFIG.mode);
                    if (res?.ok && Array.isArray(res.items) && res.items.length > 0) {
                        items = res.items;
                    } else if (res?.reason) {
                        state.lastActionNote = `Guia /hunt: ${res.reason}`;
                    }
                }

                // Fallback local: monta fila ordenada a partir das áreas seguras/liberadas do mapa
                if (items.length === 0) {
                    const poke = getActivePokemon();
                    const modal = await openMapModal();
                    if (modal) {
                        const candidates = await collectCandidatesFromOpenMap(
                            modal,
                            poke,
                            CONFIG.map.preferTypeAdvantage,
                            CONFIG.mode === 'topcatch' ? 'Top Catch' : null,
                            CONFIG.mode === 'topcatch'
                        );
                        await closeActiveModal();
                        items = candidates.slice(0, 8).map((c) => ({
                            name: c.regionName,
                            regionName: c.regionName,
                            areaLevel: c.areaLevel,
                            markerMeta: c,
                            mode: CONFIG.mode,
                        }));
                    }
                }

                if (items.length > 0) {
                    state.huntQueue = items;
                    state.huntQueueIndex = 0;
                    saveHuntQueueState();
                    state.lastActionNote = `Fila /hunt pronta (${items.length} áreas)`;
                } else if (!state.lastActionNote.startsWith('Guia /hunt:')) {
                    state.lastActionNote = 'Nenhuma área encontrada para a fila';
                }
                return state.huntQueue;
            },
            { force }
        );
    };

    const irProximaHuntGuia = async (force = false) => {
        return withModalLock(
            'Fila /hunt',
            async () => {
                if (state.huntQueue.length === 0) {
                    await syncHuntGuideQueue(true);
                }
                if (state.huntQueue.length === 0) {
                    state.lastActionNote = 'Fila /hunt vazia';
                    return false;
                }

                const poke = getActivePokemon();
                const modal = await openMapModal();
                if (!modal) return false;
                const liveCandidates = await collectCandidatesFromOpenMap(
                    modal,
                    poke,
                    false,
                    null,
                    CONFIG.mode === 'topcatch'
                );
                await closeActiveModal();

                for (let attempt = 0; attempt < state.huntQueue.length; attempt++) {
                    const idx = (state.huntQueueIndex + attempt) % state.huntQueue.length;
                    const entry = state.huntQueue[idx];
                    const needle = normalizeText(entry.regionName || entry.name);

                    const matchedMeta =
                        entry.markerMeta ||
                        liveCandidates.find(
                            (c) =>
                                normalizeText(c.regionName).includes(needle) ||
                                needle.includes(normalizeText(c.regionName))
                        );

                    if (!matchedMeta) continue;

                    state.huntQueueIndex = (idx + 1) % state.huntQueue.length;
                    saveHuntQueueState();
                    state.lastActionNote = `Fila -> ${matchedMeta.regionName} Nv${matchedMeta.areaLevel}`;
                    const ok = await travelToMarkerMeta(matchedMeta);
                    if (ok) {
                        state.session = createSession(getCurrentHunt(), getActivePokemon(), matchedMeta);
                        return true;
                    }
                }

                state.lastActionNote = 'Fila /hunt: sem área elegível agora';
                return false;
            },
            { force }
        );
    };

    const copiarFichaHunt = async (abrirSite = false) => {
        const poke = getActivePokemon();
        const native = readNativeSessionPanel();
        const farm = state.session ? computeSessionMetrics(state.session) : null;
        const pokeCardTxt = (document.getElementById('ativo-card')?.textContent || '').replace(/\s+/g, ' ').trim();

        const lines = [
            `Pokémon: ${pokeCardTxt || (poke ? `${poke.name} Nv ${poke.level} (${poke.types.join('/')})` : 'Nenhum')}`,
            `Modo Bot: ${CONFIG.mode} | Região: ${farm?.regiao || '-'}`,
            `Ritmo: ${native ? `${native.xpPokemonH.toLocaleString('pt-BR')} XP/h · ${native.goldH.toLocaleString('pt-BR')} Gold/h · ${native.lucroH.toLocaleString('pt-BR')} Lucro/h` : `${(farm?.xpPokeMin ?? 0) * 60} XP/h · ${(farm?.lucroLiqMin ?? 0) * 60} Lucro/h`}`,
            `Guia: ${HUNT_GUIDE_URL}`,
        ];
        const text = lines.join('\n');

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            }
        } catch {}

        state.lastActionNote = 'Ficha copiada p/ pokeidleguide.io/#hunt';
        updateHud();
        if (abrirSite) {
            window.open(HUNT_GUIDE_URL, '_blank', 'noopener,noreferrer');
        }
        return text;
    };

    const hopNextTopCatchArea = async (force = false) => {
        return withModalLock(
            'TopCatch Hop',
            async () => {
                const poke = getActivePokemon();
                const modal = await openMapModal();
                if (!modal) return false;

                let candidates = await collectCandidatesFromOpenMap(modal, poke, false, 'Top Catch', true);
                candidates = candidates.filter((c) => !c.isCurrent);
                await closeActiveModal();

                if (candidates.length === 0) {
                    state.lastActionNote = 'Top Catch: todas as áreas liberadas capturadas!';
                    return false;
                }

                const nextArea = candidates[0];
                state.lastActionNote = `Top Catch -> ${nextArea.regionName} Nv${nextArea.areaLevel}`;
                const ok = await travelToMarkerMeta(nextArea);
                if (ok) {
                    state.session = createSession(getCurrentHunt(), getActivePokemon(), nextArea);
                }
                return ok;
            },
            { force }
        );
    };

    const otimizarRegiao = async ({
        modo = CONFIG.mode,
        tempoPorRegiaoSeg = CONFIG.map.benchmarkSecPerArea,
        maxRegioes = CONFIG.map.maxAreasToTest,
        usarVantagemTipo = CONFIG.map.preferTypeAdvantage,
        force = false,
    } = {}) => {
        return withModalLock(
            'Otimizando',
            async () => {
                state.lastOptimizeAt = Date.now();
                const poke = getActivePokemon();
                const trainerLv = getTrainerHeaderInfo().level;
                if (trainerLv !== null) state.lastOptimizedTrainerLevel = trainerLv;

                const dexFilter = modo === 'topcatch' ? 'Top Catch' : null;
                const modal = await openMapModal();
                if (!modal) return null;

                let candidates = await collectCandidatesFromOpenMap(
                    modal,
                    poke,
                    usarVantagemTipo,
                    dexFilter,
                    modo === 'topcatch'
                );
                if (candidates.length === 0 && usarVantagemTipo) {
                    candidates = await collectCandidatesFromOpenMap(modal, poke, false, dexFilter, modo === 'topcatch');
                }
                if (candidates.length === 0 && dexFilter) {
                    candidates = await collectCandidatesFromOpenMap(modal, poke, false, null, false);
                }
                await closeActiveModal();

                if (candidates.length === 0) return null;

                const toTest = candidates.slice(0, maxRegioes);
                const results = [];

                for (let i = 0; i < toTest.length; i++) {
                    if (!state.running || (state.paused && !force)) break;
                    if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) {
                        state.lastActionNote = 'Benchmark pausado: Shiny em campo!';
                        return null;
                    }

                    const cand = toTest[i];
                    state.lastActionNote = `Testando ${i + 1}/${toTest.length} (${cand.regionName} Nv${cand.areaLevel})`;
                    updateHud();

                    const ok = await travelToMarkerMeta(cand);
                    if (!ok) continue;

                    const preWarm = readNativeSessionPanel();
                    let aborted = false;
                    const warmupEnd = Date.now() + CONFIG.map.warmupMaxSec * 1000;
                    while (Date.now() < warmupEnd && state.running) {
                        await sleep(450);
                        if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return null;
                        const livePoke = getActivePokemon();
                        const nowSnap = readNativeSessionPanel();
                        if (
                            (livePoke?.hpPercent !== null && livePoke.hpPercent < CONFIG.map.abortHpThreshold) ||
                            (preWarm && nowSnap && nowSnap.revivesUsados > preWarm.revivesUsados)
                        ) {
                            aborted = true;
                            break;
                        }
                        if (preWarm && nowSnap && nowSnap.abates > preWarm.abates) break;
                    }

                    state.session = createSession(getCurrentHunt(), getActivePokemon(), cand);

                    if (!aborted && state.running) {
                        const measureEnd = Date.now() + tempoPorRegiaoSeg * 1000;
                        while (Date.now() < measureEnd && state.running) {
                            await sleep(1000);
                            if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return null;
                            updateFarmTelemetry();
                            updateHud();
                            const livePoke = getActivePokemon();
                            const m = computeSessionMetrics(state.session);
                            if (
                                (livePoke?.hpPercent !== null && livePoke.hpPercent < CONFIG.map.abortHpThreshold) ||
                                m.revivesMin > 0
                            ) {
                                aborted = true;
                                break;
                            }
                        }
                    }

                    const saved = persistCurrentSession(true);
                    const metrics = saved || computeSessionMetrics(state.session);
                    const isSafe = !aborted && metrics.segura && metrics.abates > 0;
                    results.push({
                        ...metrics,
                        segura: isSafe,
                        markerMeta: cand,
                        score: Math.round(scoreRecord({ ...metrics, segura: isSafe }, modo)),
                    });
                }

                if (results.length === 0) return null;
                results.sort((a, b) => b.score - a.score);
                console.table(
                    results.map((r) => ({
                        regiao: r.regiao,
                        abatesMin: r.abatesMin,
                        xpPokeMin: r.xpPokeMin,
                        lucroLiqMin: r.lucroLiqMin,
                        pocoesMin: r.pocoesMin,
                        segura: r.segura,
                        score: r.score,
                    }))
                );

                const winner = results[0];
                await travelToMarkerMeta(winner.markerMeta);
                state.session = createSession(getCurrentHunt(), getActivePokemon(), winner.markerMeta);
                state.lastActionNote = `Melhor (${modo}): ${winner.regiao}`;
                return winner;
            },
            { force }
        );
    };

    const checkAutoRegionProgression = async () => {
        if (!state.running || state.paused || !CONFIG.autoRegion.enabled) return;
        if (state.modalLockOwner || isInSpecialArena() || getVisibleModal() || state.shinyAlertActive) return;

        const { level: trainerLv } = getTrainerHeaderInfo();
        if (trainerLv !== null && state.lastOptimizedTrainerLevel === null) {
            state.lastOptimizedTrainerLevel = trainerLv;
        }
        if (Date.now() - state.lastOptimizeAt < CONFIG.autoRegion.minIntervalMs) return;

        if (
            trainerLv !== null &&
            state.lastOptimizedTrainerLevel !== null &&
            trainerLv >= state.lastOptimizedTrainerLevel + CONFIG.autoRegion.levelStep
        ) {
            if (state.huntQueue.length > 0) {
                await irProximaHuntGuia(false);
            } else {
                await otimizarRegiao({ modo: CONFIG.mode });
            }
            return;
        }

        if (state.session && getCurrentHunt()) {
            const m = computeSessionMetrics(state.session);
            if (m.abates >= 3 && (m.revivesMin > 0 || m.pocoesMin > CONFIG.farm.maxPotionsPerMinSafe)) {
                if (state.huntQueue.length > 0) {
                    await irProximaHuntGuia(false);
                } else {
                    await otimizarRegiao({ modo: CONFIG.mode });
                }
            }
        }
    };

    // --- 13. HUD 3 Abas (Isolado com CSS contain + Dirty-Checking) ---
    const injectHudStyles = () => {
        document.getElementById(STYLE_ID)?.remove();
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${HUD_ID} {
                position: fixed; z-index: 99999; width: 304px;
                contain: layout style paint;
                font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
                font-size: 11.5px; color: #e8eef8;
                background: rgba(13, 18, 29, 0.94); backdrop-filter: blur(8px);
                border: 1px solid rgba(114, 152, 255, 0.38); border-radius: 10px;
                box-shadow: 0 10px 28px rgba(0, 0, 0, 0.58); user-select: none; overflow: hidden;
            }
            #${HUD_ID}.min { width: auto; min-width: 210px; }
            #${HUD_ID} .pb-head {
                display: flex; align-items: center; justify-content: space-between;
                padding: 7px 9px; background: rgba(34, 48, 78, 0.88); cursor: grab;
                border-bottom: 1px solid rgba(255,255,255,0.08);
            }
            #${HUD_ID} .pb-head:active { cursor: grabbing; }
            #${HUD_ID} .pb-title { display: flex; align-items: center; gap: 6px; font-weight: 700; }
            #${HUD_ID} .pb-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px #22c55e; }
            #${HUD_ID} .pb-dot.warn { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
            #${HUD_ID} .pb-dot.shiny { background: #fde047; box-shadow: 0 0 8px #fde047; }
            #${HUD_ID} .pb-dot.off { background: #ef4444; box-shadow: none; }
            #${HUD_ID} .pb-head-btns { display: flex; gap: 4px; }
            #${HUD_ID} .pb-icon-btn {
                border: none; background: rgba(255,255,255,0.12); color: #e8eef8;
                width: 20px; height: 20px; border-radius: 5px; cursor: pointer; font-size: 12px; padding: 0;
            }
            #${HUD_ID} .pb-tabs { display: grid; grid-template-columns: repeat(3, 1fr); background: rgba(255,255,255,0.04); }
            #${HUD_ID} .pb-tab {
                border: none; background: transparent; color: #94a3b8; padding: 6px 4px;
                font-size: 11px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent;
            }
            #${HUD_ID} .pb-tab.on { color: #ffffff; border-bottom-color: #60a5fa; background: rgba(59,130,246,0.14); }
            #${HUD_ID}.min .pb-tabs, #${HUD_ID}.min .pb-body { display: none; }
            #${HUD_ID} .pb-body { padding: 8px 9px; display: flex; flex-direction: column; gap: 7px; }
            #${HUD_ID} .pb-pane { display: none; flex-direction: column; gap: 7px; }
            #${HUD_ID} .pb-pane.on { display: flex; }
            #${HUD_ID} .pb-grid {
                display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px;
                background: rgba(255,255,255,0.04); padding: 6px 7px; border-radius: 6px;
            }
            #${HUD_ID} .pb-row { display: flex; justify-content: space-between; gap: 4px; }
            #${HUD_ID} .pb-lbl { color: #94a3b8; font-size: 10.5px; }
            #${HUD_ID} .pb-val { font-weight: 600; color: #f8fafc; font-size: 10.5px; text-align: right; }
            #${HUD_ID} .pb-span2 { grid-column: span 2; }
            #${HUD_ID} .pb-sec { font-size: 10px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.4px; }
            #${HUD_ID} .pb-modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
            #${HUD_ID} .pb-btn {
                border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06);
                color: #dbe6f6; border-radius: 6px; padding: 5px 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;
            }
            #${HUD_ID} .pb-btn:hover { background: rgba(114, 152, 255, 0.22); }
            #${HUD_ID} .pb-btn.on { background: rgba(59, 130, 246, 0.35); border-color: #60a5fa; color: #fff; }
            #${HUD_ID} .pb-toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
            #${HUD_ID} .pb-tog {
                display: flex; align-items: center; justify-content: space-between;
                padding: 4px 6px; border-radius: 6px; background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08); cursor: pointer; font-size: 10.5px;
            }
            #${HUD_ID} .pb-tog.on { border-color: rgba(34, 197, 94, 0.55); background: rgba(34, 197, 94, 0.13); }
            #${HUD_ID} .pb-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
            #${HUD_ID} .pb-actions3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
            #${HUD_ID} .pb-actions4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
            #${HUD_ID} .pb-form { display: grid; grid-template-columns: 1fr 74px 54px; gap: 4px; }
            #${HUD_ID} input, #${HUD_ID} select {
                background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15);
                color: #f8fafc; border-radius: 5px; padding: 4px 5px; font-size: 10.5px; width: 100%; box-sizing: border-box;
            }
            #${HUD_ID} .pb-list {
                max-height: 78px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px;
                background: rgba(255,255,255,0.03); padding: 4px 5px; border-radius: 6px;
            }
            #${HUD_ID} .pb-chips { display: flex; flex-wrap: wrap; gap: 4px; }
            #${HUD_ID} .pb-chip {
                border: 1px solid rgba(96,165,250,0.45); background: rgba(59,130,246,0.18);
                color: #e0f2fe; border-radius: 5px; padding: 2px 6px; font-size: 10.5px; cursor: pointer;
            }
            #${HUD_ID} .pb-chip:hover { background: rgba(59,130,246,0.38); }
            #${HUD_ID} .pb-item { display: flex; justify-content: space-between; align-items: center; gap: 4px; font-size: 10.5px; }
            #${HUD_ID} .pb-del { border: none; background: rgba(239,68,68,0.22); color: #fca5a5; border-radius: 4px; cursor: pointer; padding: 1px 5px; font-size: 10px; }
            #${HUD_ID} .pb-note {
                font-size: 10px; color: #93c5fd; white-space: nowrap; overflow: hidden;
                text-overflow: ellipsis; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 5px;
            }
        `;
        document.head.appendChild(style);
    };

    const renderAlertList = () => {
        const alertList = state.hudEl?.querySelector('[data-pb="alertList"]');
        if (!alertList) return;
        alertList.innerHTML =
            CONFIG.radar.alerts.length === 0
                ? 'Nenhum alerta configurado.'
                : CONFIG.radar.alerts
                      .map(
                          (a, idx) =>
                              `<div class="pb-item"><span>${escapeHtml(a.nome)} ≤ ${a.maxPreco.toLocaleString('pt-BR')} ${escapeHtml(a.moeda)}</span><button class="pb-del" data-pb-del="${idx}">×</button></div>`
                      )
                      .join('');
    };

    const renderQuizCandidates = () => {
        const quizList = state.hudEl?.querySelector('[data-pb="quizList"]');
        if (!quizList) return;

        const sig = `${state.dexCatalog.length}|${state.miniGameMatches.join(',')}`;
        if (sig === state.lastQuizSigRendered) return;
        state.lastQuizSigRendered = sig;

        if (state.dexCatalog.length === 0) {
            quizList.textContent = 'Baixe o .csv na Pokedex e importe abaixo.';
        } else if (state.miniGameMatches.length === 0) {
            quizList.textContent = 'Abra o Mini Games durante uma rodada com pistas.';
        } else {
            quizList.innerHTML = `<div class="pb-chips">${state.miniGameMatches
                .map((name) => `<button class="pb-chip" data-pb-guess="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
                .join('')}</div>`;
        }
    };

    const mountHud = () => {
        document.getElementById(HUD_ID)?.remove();
        injectHudStyles();
        state.hudCache = {};

        const hud = document.createElement('div');
        hud.id = HUD_ID;
        if (CONFIG.hud.minimized) hud.classList.add('min');
        hud.style.left = `${CONFIG.hud.left}px`;
        hud.style.top = `${CONFIG.hud.top}px`;

        hud.innerHTML = `
            <div class="pb-head" data-pb-drag="1">
                <div class="pb-title">
                    <span class="pb-dot" data-pb="dot"></span>
                    <span data-pb="headTitle">PokeBot v6.3</span>
                </div>
                <div class="pb-head-btns">
                    <button class="pb-icon-btn" data-pb-act="min" title="Minimizar">—</button>
                    <button class="pb-icon-btn" data-pb-act="stop" title="Encerrar">×</button>
                </div>
            </div>
            <div class="pb-tabs">
                <button class="pb-tab" data-pb-tab="geral">Geral</button>
                <button class="pb-tab" data-pb-tab="modulos">Módulos</button>
                <button class="pb-tab" data-pb-tab="radar">Radar/Quiz</button>
            </div>
            <div class="pb-body">
                <div class="pb-pane" data-pb-pane="geral">
                    <div class="pb-grid">
                        <div class="pb-row pb-span2"><span class="pb-lbl">Pokémon</span><span class="pb-val" data-pb="poke">-</span></div>
                        <div class="pb-row pb-span2"><span class="pb-lbl">Região</span><span class="pb-val" data-pb="regiao">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">XP/h</span><span class="pb-val" data-pb="xpH">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">Lucro/h</span><span class="pb-val" data-pb="lucroH">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">Bônus / Dia</span><span class="pb-val" data-pb="xpBonus">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">Fila /hunt</span><span class="pb-val" data-pb="huntQueue">0</span></div>
                        <div class="pb-row"><span class="pb-lbl">Capturas</span><span class="pb-val" data-pb="caps">0</span></div>
                        <div class="pb-row"><span class="pb-lbl">B/P/R</span><span class="pb-val" data-pb="inv">-</span></div>
                    </div>
                    <div class="pb-sec">Modo de Farm</div>
                    <div class="pb-modes">
                        <button class="pb-btn" data-pb-mode="xp">XP</button>
                        <button class="pb-btn" data-pb-mode="ouro">Ouro</button>
                        <button class="pb-btn" data-pb-mode="equilibrado">Equil.</button>
                        <button class="pb-btn" data-pb-mode="topcatch">Catch</button>
                    </div>
                    <div class="pb-actions3">
                        <button class="pb-btn" data-pb-act="syncGuide">Sync /hunt</button>
                        <button class="pb-btn" data-pb-act="nextQueue">Próx. Fila</button>
                        <button class="pb-btn" data-pb-act="copyHunt">Copiar Ficha</button>
                    </div>
                    <div class="pb-actions">
                        <button class="pb-btn" data-pb-act="optimize">Otimizar Mapa</button>
                        <button class="pb-btn" data-pb-act="hop">Próx. TopCatch</button>
                        <button class="pb-btn" data-pb-act="restock">Restock Agora</button>
                        <button class="pb-btn" data-pb-act="pause" data-pb="pauseBtn">Pausar</button>
                    </div>
                </div>

                <div class="pb-pane" data-pb-pane="modulos">
                    <div class="pb-toggles">
                        <div class="pb-tog" data-pb-tog="caidos"><span>Auto-Catch</span><b data-pb-tval="caidos">ON</b></div>
                        <div class="pb-tog" data-pb-tog="smartBall"><span>Bola Intelig.</span><b data-pb-tval="smartBall">ON</b></div>
                        <div class="pb-tog" data-pb-tog="shinyGuard"><span>Shiny Guard</span><b data-pb-tval="shinyGuard">ON</b></div>
                        <div class="pb-tog" data-pb-tog="restock"><span>Restock</span><b data-pb-tval="restock">ON</b></div>
                        <div class="pb-tog" data-pb-tog="upgradeBalls"><span>Upgrade Bola</span><b data-pb-tval="upgradeBalls">ON</b></div>
                        <div class="pb-tog" data-pb-tog="restockRevive"><span>Restock Revive</span><b data-pb-tval="restockRevive">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="topCatchHop"><span>TopCatch Hop</span><b data-pb-tval="topCatchHop">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="dailyPass"><span>Auto-Passe</span><b data-pb-tval="dailyPass">ON</b></div>
                        <div class="pb-tog" data-pb-tog="incubator"><span>Chocadeira</span><b data-pb-tval="incubator">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="autoRegion"><span>Auto-Mapa</span><b data-pb-tval="autoRegion">ON</b></div>
                        <div class="pb-tog" data-pb-tog="evolve"><span>Auto-Evoluir</span><b data-pb-tval="evolve">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="depotMode"><span>Depot</span><b data-pb-tval="depotMode">OFF</b></div>
                        <div class="pb-tog pb-span2" data-pb-tog="teamMode"><span>Equipe / Dia Sazonal</span><b data-pb-tval="teamMode">OFF</b></div>
                        <div class="pb-tog pb-span2" data-pb-tog="bossPriority"><span>Auto-Boss (Rotação)</span><b data-pb-tval="bossPriority">OFF</b></div>
                    </div>
                    <div class="pb-sec">Executar Agora</div>
                    <div class="pb-actions4">
                        <button class="pb-btn" data-pb-act="runDepot">Depot</button>
                        <button class="pb-btn" data-pb-act="runPass">Passe</button>
                        <button class="pb-btn" data-pb-act="runEggs">Ovos</button>
                        <button class="pb-btn" data-pb-act="runBoss">Boss</button>
                    </div>
                </div>

                <div class="pb-pane" data-pb-pane="radar">
                    <div class="pb-sec">Radar RMT (Mercado da Comunidade)</div>
                    <div class="pb-form">
                        <input type="text" data-pb-in="rName" placeholder="Ex: Garchomp" />
                        <input type="number" data-pb-in="rPrice" placeholder="Máx $" />
                        <select data-pb-in="rCur">
                            <option value="coins">Coins</option>
                            <option value="gemas">Gemas</option>
                        </select>
                    </div>
                    <button class="pb-btn" data-pb-act="addAlert">+ Adicionar Alerta RMT</button>
                    <div class="pb-list" data-pb="alertList">Nenhum alerta.</div>
                    <div class="pb-sec">Mini Games (<span data-pb="dexCount">0</span> espécies · clique p/ enviar)</div>
                    <div class="pb-tog" data-pb-tog="autoGuess"><span>Auto-Palpite (≤3 candid.)</span><b data-pb-tval="autoGuess">OFF</b></div>
                    <div class="pb-list" data-pb="quizList">Importe o .csv da Pokedex.</div>
                    <button class="pb-btn" data-pb-act="importDex">Importar Pokedex (.csv)</button>
                </div>

                <div class="pb-note" data-pb="note">Pronto</div>
            </div>
        `;

        document.body.appendChild(hud);
        state.hudEl = hud;

        const head = hud.querySelector('[data-pb-drag="1"]');
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        const onMouseDown = (e) => {
            if (e.target.closest('button')) return;
            dragging = true;
            const rect = hud.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
        };
        const onMouseMove = (e) => {
            if (!dragging) return;
            const left = Math.max(4, Math.min(window.innerWidth - 60, e.clientX - offsetX));
            const top = Math.max(4, Math.min(window.innerHeight - 40, e.clientY - offsetY));
            hud.style.left = `${left}px`;
            hud.style.top = `${top}px`;
            CONFIG.hud.left = Math.round(left);
            CONFIG.hud.top = Math.round(top);
        };
        const onMouseUp = () => {
            if (!dragging) return;
            dragging = false;
            persistPrefs();
        };

        head.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        state.cleanupListeners.push(() => {
            head.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        });

        const onHudClick = (e) => {
            const tabBtn = e.target.closest('[data-pb-tab]');
            if (tabBtn) {
                CONFIG.hud.tab = tabBtn.getAttribute('data-pb-tab');
                persistPrefs();
                updateHud();
                return;
            }
            const modeBtn = e.target.closest('[data-pb-mode]');
            if (modeBtn) {
                setMode(modeBtn.getAttribute('data-pb-mode'), false);
                return;
            }
            const delBtn = e.target.closest('[data-pb-del]');
            if (delBtn) {
                removerAlertaRadar(parseInt(delBtn.getAttribute('data-pb-del'), 10));
                return;
            }
            const guessBtn = e.target.closest('[data-pb-guess]');
            if (guessBtn) {
                const name = guessBtn.getAttribute('data-pb-guess');
                if (name && applyMiniGameGuess(name, true)) {
                    state.roundTriedNames.add(cleanKey(name));
                    state.lastActionNote = `Palpite enviado: ${name}`;
                    renderQuizCandidates();
                    updateHud();
                }
                return;
            }
            const tog = e.target.closest('[data-pb-tog]');
            if (tog) {
                const key = tog.getAttribute('data-pb-tog');
                if (key === 'caidos') CONFIG.caidos.enabled = !CONFIG.caidos.enabled;
                if (key === 'smartBall') CONFIG.caidos.smartBallSelect = !CONFIG.caidos.smartBallSelect;
                if (key === 'shinyGuard') CONFIG.shinyGuard.enabled = !CONFIG.shinyGuard.enabled;
                if (key === 'restock') CONFIG.restock.enabled = !CONFIG.restock.enabled;
                if (key === 'upgradeBalls') CONFIG.restock.autoUpgradeBalls = !CONFIG.restock.autoUpgradeBalls;
                if (key === 'restockRevive') CONFIG.restock.restockRevive = !CONFIG.restock.restockRevive;
                if (key === 'topCatchHop') CONFIG.topCatchHop.enabled = !CONFIG.topCatchHop.enabled;
                if (key === 'dailyPass') CONFIG.dailyPass.enabled = !CONFIG.dailyPass.enabled;
                if (key === 'incubator') {
                    CONFIG.incubator.enabled = !CONFIG.incubator.enabled;
                    state.nextIncubatorCheckAt = 0;
                }
                if (key === 'autoRegion') CONFIG.autoRegion.enabled = !CONFIG.autoRegion.enabled;
                if (key === 'evolve') CONFIG.evolve.enabled = !CONFIG.evolve.enabled;
                if (key === 'autoGuess') CONFIG.minigame.autoGuess = !CONFIG.minigame.autoGuess;
                if (key === 'depotMode') {
                    CONFIG.depot.mode = DEPOT_MODES[(DEPOT_MODES.indexOf(CONFIG.depot.mode) + 1) % DEPOT_MODES.length];
                }
                if (key === 'teamMode') {
                    CONFIG.team.mode = TEAM_MODES[(TEAM_MODES.indexOf(CONFIG.team.mode) + 1) % TEAM_MODES.length];
                }
                if (key === 'bossPriority') {
                    CONFIG.boss.priority = BOSS_PRIORITIES[(BOSS_PRIORITIES.indexOf(CONFIG.boss.priority) + 1) % BOSS_PRIORITIES.length];
                }
                persistPrefs();
                updateHud();
                return;
            }
            const actBtn = e.target.closest('[data-pb-act]');
            if (!actBtn) return;
            const act = actBtn.getAttribute('data-pb-act');

            if (act === 'min') {
                CONFIG.hud.minimized = !CONFIG.hud.minimized;
                hud.classList.toggle('min', CONFIG.hud.minimized);
                persistPrefs();
            } else if (act === 'stop') {
                stop();
            } else if (act === 'pause') {
                state.paused ? retomar() : pausar();
            } else if (act === 'syncGuide') {
                syncHuntGuideQueue(true);
            } else if (act === 'nextQueue') {
                irProximaHuntGuia(true);
            } else if (act === 'copyHunt') {
                copiarFichaHunt(false);
            } else if (act === 'optimize') {
                otimizarRegiao({ modo: CONFIG.mode, force: true });
            } else if (act === 'hop') {
                hopNextTopCatchArea(true);
            } else if (act === 'restock') {
                smartRestock(true);
            } else if (act === 'runDepot') {
                if (CONFIG.depot.mode === 'off') {
                    state.lastActionNote = 'Selecione Venda, Oferenda ou Sacrifício';
                    updateHud();
                } else {
                    runDepotManager(true);
                }
            } else if (act === 'runPass') {
                checkDailyPass(true);
            } else if (act === 'runEggs') {
                checkIncubator(true);
            } else if (act === 'runBoss') {
                checkBosses(true);
            } else if (act === 'importDex') {
                abrirSeletorCsvPokedex();
            } else if (act === 'addAlert') {
                const nameEl = hud.querySelector('[data-pb-in="rName"]');
                const priceEl = hud.querySelector('[data-pb-in="rPrice"]');
                const curEl = hud.querySelector('[data-pb-in="rCur"]');
                if (nameEl?.value && priceEl?.value) {
                    adicionarAlertaRadar({
                        nome: nameEl.value,
                        maxPreco: parseInt(priceEl.value, 10),
                        moeda: curEl?.value || 'coins',
                    });
                    nameEl.value = '';
                    priceEl.value = '';
                }
            }
        };

        hud.addEventListener('click', onHudClick);
        state.cleanupListeners.push(() => hud.removeEventListener('click', onHudClick));

        renderAlertList();
        renderQuizCandidates();
    };

    const updateHud = () => {
        const hud = state.hudEl;
        if (!hud || !hud.isConnected) return;

        const native = readNativeSessionPanel();
        const poke = getActivePokemon();
        const inv = getInventorySnapshot();
        const farm = state.session ? computeSessionMetrics(state.session) : null;
        const dayType = getSeasonalDayType();

        const setText = (attr, val) => {
            const strVal = String(val);
            if (state.hudCache[attr] === strVal) return;
            state.hudCache[attr] = strVal;
            const el = hud.querySelector(`[data-pb="${attr}"]`);
            if (el) el.textContent = strVal;
        };

        const dotMode = state.paused
            ? 'off'
            : state.shinyAlertActive
            ? 'shiny'
            : state.modalLockOwner
            ? 'warn'
            : 'on';

        if (state.hudCache.__dot !== dotMode) {
            state.hudCache.__dot = dotMode;
            const dot = hud.querySelector('[data-pb="dot"]');
            if (dot) {
                dot.classList.remove('warn', 'off', 'shiny');
                if (dotMode !== 'on') dot.classList.add(dotMode);
            }
        }

        if (state.hudCache.__tab !== CONFIG.hud.tab) {
            state.hudCache.__tab = CONFIG.hud.tab;
            hud.querySelectorAll('[data-pb-tab]').forEach((b) =>
                b.classList.toggle('on', b.getAttribute('data-pb-tab') === CONFIG.hud.tab)
            );
            hud.querySelectorAll('[data-pb-pane]').forEach((p) =>
                p.classList.toggle('on', p.getAttribute('data-pb-pane') === CONFIG.hud.tab)
            );
        }

        setText('headTitle', `PokeBot v6.3 · ${state.shinyAlertActive ? '✨ SHINY!' : state.statusText}`);
        setText('poke', poke ? `${poke.name} Nv${poke.level ?? '?'} (${poke.types.join('/') || '-'})` : '-');
        setText('regiao', farm ? farm.regiao : '-');
        setText(
            'xpH',
            native ? `${native.xpPokemonH.toLocaleString('pt-BR')}/h` : `${((farm?.xpPokeMin ?? 0) * 60).toLocaleString('pt-BR')}/h`
        );
        setText(
            'lucroH',
            native ? `${native.lucroH.toLocaleString('pt-BR')}/h` : `${((farm?.lucroLiqMin ?? 0) * 60).toLocaleString('pt-BR')}/h`
        );
        setText('xpBonus', `${native ? native.xpBonusText : '-'} · ${dayType || '-'}`);
        setText(
            'huntQueue',
            state.huntQueue.length > 0
                ? `${Math.min(state.huntQueueIndex + 1, state.huntQueue.length)}/${state.huntQueue.length}`
                : '0'
        );
        setText('caps', native ? String(native.capturas) : String(state.stats.captures));
        setText(
            'inv',
            inv.panelOpen
                ? `${inv.totalBalls ?? '-'}/${inv.smallPotions ?? '-'}/${inv.totalRevives ?? '-'}`
                : 'Abra Auto!'
        );
        setText('pauseBtn', state.paused ? 'Retomar' : 'Pausar');
        setText('dexCount', String(state.dexCatalog.length));
        setText('note', isInSpecialArena() ? 'Arena especial (protegido)' : state.lastActionNote);

        if (state.hudCache.__mode !== CONFIG.mode) {
            state.hudCache.__mode = CONFIG.mode;
            hud.querySelectorAll('[data-pb-mode]').forEach((btn) =>
                btn.classList.toggle('on', btn.getAttribute('data-pb-mode') === CONFIG.mode)
            );
        }

        const toggles = {
            caidos: [CONFIG.caidos.enabled, CONFIG.caidos.enabled ? 'ON' : 'OFF'],
            smartBall: [CONFIG.caidos.smartBallSelect, CONFIG.caidos.smartBallSelect ? 'ON' : 'OFF'],
            shinyGuard: [CONFIG.shinyGuard.enabled, CONFIG.shinyGuard.enabled ? 'ON' : 'OFF'],
            restock: [CONFIG.restock.enabled, CONFIG.restock.enabled ? 'ON' : 'OFF'],
            upgradeBalls: [CONFIG.restock.autoUpgradeBalls, CONFIG.restock.autoUpgradeBalls ? 'ON' : 'OFF'],
            restockRevive: [CONFIG.restock.restockRevive, CONFIG.restock.restockRevive ? 'ON' : 'OFF'],
            topCatchHop: [CONFIG.topCatchHop.enabled, CONFIG.topCatchHop.enabled ? 'ON' : 'OFF'],
            dailyPass: [CONFIG.dailyPass.enabled, CONFIG.dailyPass.enabled ? 'ON' : 'OFF'],
            incubator: [CONFIG.incubator.enabled, CONFIG.incubator.enabled ? 'ON' : 'OFF'],
            autoRegion: [CONFIG.autoRegion.enabled, CONFIG.autoRegion.enabled ? 'ON' : 'OFF'],
            evolve: [CONFIG.evolve.enabled, CONFIG.evolve.enabled ? 'ON' : 'OFF'],
            autoGuess: [CONFIG.minigame.autoGuess, CONFIG.minigame.autoGuess ? 'ON' : 'OFF'],
            depotMode: [CONFIG.depot.mode !== 'off', CONFIG.depot.mode.toUpperCase()],
            teamMode: [CONFIG.team.mode !== 'off', CONFIG.team.mode.toUpperCase()],
            bossPriority: [CONFIG.boss.priority !== 'off', CONFIG.boss.priority.toUpperCase()],
        };

        Object.entries(toggles).forEach(([key, [isOn, label]]) => {
            const sig = `${isOn}|${label}`;
            if (state.hudCache[`__t_${key}`] === sig) return;
            state.hudCache[`__t_${key}`] = sig;
            const box = hud.querySelector(`[data-pb-tog="${key}"]`);
            const val = hud.querySelector(`[data-pb-tval="${key}"]`);
            if (box) box.classList.toggle('on', isOn);
            if (val) val.textContent = label;
        });

        renderQuizCandidates();
    };

    const unmountHud = () => {
        state.cleanupListeners.forEach((fn) => fn());
        state.cleanupListeners = [];
        document.getElementById(HUD_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
        state.hudEl = null;
        state.hudCache = {};
    };

    // --- Controle Geral ---
    const setMode = (newMode, trocarAgora = false) => {
        const normalized = normalizeText(newMode);
        if (!VALID_MODES.includes(normalized)) return false;
        CONFIG.mode = normalized;
        if (normalized === 'topcatch') CONFIG.topCatchHop.enabled = true;
        persistPrefs();
        state.lastActionNote = `Modo: ${normalized}`;
        updateHud();
        if (trocarAgora) {
            normalized === 'topcatch'
                ? hopNextTopCatchArea(true)
                : otimizarRegiao({ modo: normalized, force: true });
        }
        return true;
    };

    const pausar = () => {
        state.paused = true;
        setStatus('Pausado', 'Pausado pelo usuário');
    };

    const retomar = () => {
        state.paused = false;
        setStatus('Ativo', 'Retomado');
        if (state.observedCaidosNode) processCaidos(state.observedCaidosNode);
    };

    const stop = () => {
        if (!state.running) return;
        persistCurrentSession(false);
        state.running = false;
        state.throwPending = false;
        state.timers.forEach(clearInterval);
        state.timers = [];
        if (state.caidosObserver) {
            state.caidosObserver.disconnect();
            state.caidosObserver = null;
            state.observedCaidosNode = null;
        }
        if (state.logObserver) {
            state.logObserver.disconnect();
            state.logObserver = null;
            state.observedLogNode = null;
        }
        unmountHud();
        console.log('[PokeBot v6.3] Encerrado.');
    };

    const status = () => {
        updateFarmTelemetry();
        const native = readNativeSessionPanel();
        const { level, gold, diamonds, gems } = getTrainerHeaderInfo();
        const poke = getActivePokemon();
        const farm = state.session ? computeSessionMetrics(state.session) : null;

        const info = {
            ativo: state.running && !state.paused,
            modo: CONFIG.mode,
            treinadorNv: level,
            ouro: gold,
            diamantes: diamonds,
            gemas: gems,
            diaSazonal: getSeasonalDayType() || '-',
            bolaAlvo: getTargetBallTier().itemName,
            bonusXp: native?.xpBonusText ?? '-',
            boostSacrificio: Boolean(native?.boosts?.sacrificio),
            localSessao: native?.lugar || '-',
            pokemon: poke ? `${poke.name} Nv${poke.level ?? '?'} (${poke.types.join('/') || '-'})` : '-',
            regiao: farm ? farm.regiao : '-',
            filaHuntTotal: state.huntQueue.length,
            xpPokeHora: native?.xpPokemonH ?? (farm ? farm.xpPokeMin * 60 : 0),
            lucroHora: native?.lucroH ?? (farm ? farm.lucroLiqMin * 60 : 0),
            capturasSessao: native?.capturas ?? state.stats.captures,
            shiniesVistos: native?.shiniesVistos ?? state.stats.shiniesSpotted,
            dexImportada: state.dexCatalog.length,
        };
        console.table(info);
        return info;
    };

    window.PokeBot = {
        config: CONFIG,
        modo: setMode,
        pausar,
        retomar,
        status,
        lerSessaoNativa: readNativeSessionPanel,
        otimizarRegiao,
        syncHuntGuide: () => syncHuntGuideQueue(true),
        proximaHuntGuia: () => irProximaHuntGuia(true),
        definirFilaHunt,
        copiarFichaHunt,
        hopTopCatch: () => hopNextTopCatchArea(true),
        rodarDepot: () => runDepotManager(true),
        checarPasse: () => checkDailyPass(true),
        checarOvos: () => checkIncubator(true),
        checarBoss: () => checkBosses(true),
        restockNow: () => smartRestock(true),
        adicionarAlertaRadar,
        removerAlertaRadar,
        importarPokedexCsv: abrirSeletorCsvPokedex,
        efetividadeHunt: getHuntTypeMultiplier,
        stop,
    };

    // --- Inicialização ---
    state.lastOptimizedTrainerLevel = getTrainerHeaderInfo().level;
    state.session = createSession(getCurrentHunt(), getActivePokemon());
    const initSnap = readNativeSessionPanel();
    if (initSnap) {
        state.lastSessionCaptures = initSnap.capturas;
        state.lastShiniesVistos = initSnap.shiniesVistos;
        state.teamSwapPotionSnap = {
            pocoes: initSnap.pocoesUsadas,
            revives: initSnap.revivesUsados,
        };
    }

    mountHud();
    ensureCaidosObserver();
    ensureCombatLogObserver();

    state.timers.push(setInterval(ensureCaidosObserver, CONFIG.caidos.reattachIntervalMs));
    state.timers.push(setInterval(() => smartRestock(false), CONFIG.restock.checkIntervalMs));
    state.timers.push(setInterval(updateFarmTelemetry, CONFIG.farm.tickIntervalMs));
    state.timers.push(setInterval(checkAutoRegionProgression, CONFIG.autoRegion.checkIntervalMs));
    state.timers.push(setInterval(() => checkDailyPass(false), CONFIG.dailyPass.checkIntervalMs));
    state.timers.push(setInterval(() => runDepotManager(false), 60000));
    state.timers.push(setInterval(checkTeamRotation, CONFIG.team.checkIntervalMs));
    state.timers.push(setInterval(() => checkIncubator(false), 15000));
    state.timers.push(setInterval(() => checkBosses(false), 60000));
    state.timers.push(setInterval(dismissBossLoot, 3000));
    state.timers.push(setInterval(autoEvolveCheck, CONFIG.evolve.checkIntervalMs));
    state.timers.push(setInterval(scanMarketRadar, CONFIG.radar.checkIntervalMs));
    state.timers.push(setInterval(updateMiniGameHelper, CONFIG.minigame.checkIntervalMs));
    state.timers.push(setInterval(() => scheduleIdle(updateHud), CONFIG.hud.refreshMs));

    updateHud();
    console.log('[PokeBot v6.3] Ativo!');
})();