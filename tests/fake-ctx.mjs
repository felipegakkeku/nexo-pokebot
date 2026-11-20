// Ctx falso e "jogo" falso (mapa) para testar os módulos do lote C sem DOM.
// Não termina em .test.mjs, então o `node --test tests/*.test.mjs` não o executa como teste.

export const makeConfig = (over = {}) => ({
    mode: 'xp',
    farm: { enabled: true, tickIntervalMs: 1000, minSampleSec: 20, minKillsToSave: 3, maxPotionsPerMinSafe: 2, minHpPercentSafe: 25 },
    shinyGuard: { enabled: false, soundAlert: true },
    topCatchHop: { enabled: true, hopCooldownMs: 30000 },
    map: {
        onlyUnlocked: true,
        maxLevelAbovePokemon: 5,
        switchCooldownMs: 3000,
        benchmarkSecPerArea: 3,
        maxAreasToTest: 2,
        preferTypeAdvantage: false,
        warmupMaxSec: 0,
        abortHpThreshold: 30,
    },
    huntQueue: { fallbackToSafeArea: true },
    autoRegion: { enabled: true, checkIntervalMs: 20000, minIntervalMs: 60000, levelStep: 5 },
    ...over,
});

export const makeState = (over = {}) => ({
    running: true,
    paused: false,
    modalLockOwner: null,
    lastActionNote: '',
    lastAreaSwitchAt: 0,
    lastOptimizeAt: 0,
    lastHopAt: 0,
    lastOptimizedTrainerLevel: null,
    lastMarkerMeta: null,
    huntQueue: [],
    huntQueueIndex: 0,
    lastSessionCaptures: null,
    lastShiniesVistos: null,
    shinyAlertActive: false,
    logObserver: null,
    observedLogNode: null,
    history: {},
    session: null,
    hudEl: null,
    stats: { captures: 0, regionSwitches: 0, shiniesSpotted: 0 },
    ...over,
});

// ctx base: o que o módulo precisa, com registros (log) do que foi chamado
export const makeCtx = ({ config, state, dom = {}, sleep } = {}) => {
    const log = { locks: [], saved: [], beeps: [], status: [], huds: 0 };
    const ctx = {
        CONFIG: config ?? makeConfig(),
        state: state ?? makeState(),
        sleep: sleep ?? (async () => {}),
        randomDelay: () => 0,
        updateHud: () => { log.huds++; },
        withModalLock: async (label, fn) => {
            if (ctx.state.modalLockOwner) return null;
            log.locks.push(label);
            ctx.state.modalLockOwner = label;
            try {
                return await fn();
            } finally {
                ctx.state.modalLockOwner = null;
            }
        },
        keys: { history: 'hist', huntQueue: 'queue' },
        storage: { saveJson: (key, value) => log.saved.push({ key, value: JSON.parse(JSON.stringify(value)) }) },
        consts: { HUNT_GUIDE_URL: 'https://guia.test/#hunt' },
        setStatus: (a, b) => log.status.push([a, b]),
        playBeep: (f, d) => log.beeps.push([f, d]),
        dom: {
            $: () => null,
            getVisibleModal: () => null,
            closeActiveModal: async () => {},
            findMenuButtonByImg: () => null,
            findClickableByText: () => null,
            waitFor: async (fn) => fn() || null,
            isInteractable: () => true,
            isVisible: () => true,
            getTrainerHeaderInfo: () => ({ level: 16 }),
            isInSpecialArena: () => false,
            getActivePokemon: () => ({ name: 'Charmander', level: 16, types: ['FIRE'], hpPercent: 100 }),
            getCurrentHunt: () => null,
            readNativeSessionPanel: () => null,
            ...dom,
        },
    };
    return { ctx, log };
};

// Mapa falso: regiões com marcadores (nível + título). Clicar no marcador viaja para a área e fecha o modal.
export const makeMapGame = (regions, { current = null, pokeLevel = 16, trainerLevel = 16 } = {}) => {
    const game = { modalOpen: false, tab: null, current, clicks: [], panelReads: 0 };
    const regionNames = Object.keys(regions);
    const cls = (name, on) => ({ contains: (c) => c === 'on' && on(name) });

    const regionButtons = () =>
        regionNames.map((name) => ({
            textContent: `${name}\n(${regions[name].length})`,
            classList: cls(name, (n) => game.tab === n),
            click: () => { game.tab = name; },
        }));
    const markerButtons = () =>
        (regions[game.tab] || []).map((m, idx) => ({
            textContent: String(m.level),
            style: { left: `${idx * 10}%`, top: '5%' },
            getAttribute: (a) => (a === 'title' ? m.title : null),
            classList: { contains: (c) => c === 'on' && game.current?.region === game.tab && game.current.idx === idx },
            closest: () => null,
            click: () => {
                game.clicks.push(`${game.tab}#${idx}`);
                game.current = { region: game.tab, idx };
                game.modalOpen = false;
            },
        }));

    const bar = { querySelectorAll: () => [] };
    const modal = {
        querySelector: (sel) => (sel === '.mapa-barra' ? bar : null),
        querySelectorAll: (sel) => {
            if (sel === 'button.mapa-reg-bt:not(.mapa-area-travada)') return regionButtons();
            if (sel === 'button.marcador:not(.travado)') return markerButtons();
            return [];
        },
    };

    const dom = {
        getVisibleModal: () => (game.modalOpen ? modal : null),
        closeActiveModal: async () => { game.modalOpen = false; },
        findMenuButtonByImg: (src) => (src === 'menu-mapa' ? { click: () => { game.modalOpen = true; } } : null),
        waitFor: async (fn) => {
            for (let i = 0; i < 4; i++) {
                const v = fn();
                if (v) return v;
            }
            return null;
        },
        getCurrentHunt: () =>
            game.current
                ? { key: `${regions[game.current.region][game.current.idx].title} · nível ${regions[game.current.region][game.current.idx].level}`, targetName: 'X', targetLevel: 1 }
                : null,
        getActivePokemon: () => ({ name: 'Charmander', level: pokeLevel, types: ['FIRE'], hpPercent: 100 }),
        getTrainerHeaderInfo: () => ({ level: trainerLevel }),
    };
    return { game, dom };
};
