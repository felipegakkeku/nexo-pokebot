    // --- Módulos (Fase 2) ---
    // Ponte entre o código legado (este escopo) e os módulos ES empacotados em PokeBotModules.
    // Cada módulo migrado sai de src/4x-*.js, vai para src/modules/ e ganha uma entrada aqui.
    const moduleCtx = {
        CONFIG,
        state,
        sleep,
        randomDelay,
        withModalLock,
        updateHud,
        setStatus,
        playBeep,
        keys: {
            passNext: STORAGE_PASS_NEXT_KEY,
            dex: STORAGE_DEX_KEY,
            history: STORAGE_HISTORY_KEY,
            huntQueue: STORAGE_HUNT_QUEUE_KEY,
        },
        storage: {
            get: (key) => localStorage.getItem(key),
            set: (key, value) => localStorage.setItem(key, value),
            saveJson,
            persistPrefs,
        },
        consts: { VALID_TYPES, TYPE_ALIASES, ESPERA_TROCA_ATIVO_MS, HUNT_GUIDE_URL },
        hud: { renderAlertList, renderQuizCandidates },
        dom: {
            $: (selector) => document.querySelector(selector),
            $$: (selector) => Array.from(document.querySelectorAll(selector)),
            isVisible,
            confirmModalDialog,
            getInventorySnapshot,
            getTargetBallTier,
            getCurrentHunt,
            readNativeSessionPanel,
            getVisibleModal,
            closeActiveModal,
            findMenuButtonByImg,
            findClickableByText,
            waitFor,
            isInteractable,
            getTrainerHeaderInfo,
            isInSpecialArena,
            getActivePokemon,
            getDirectText,
            playBeep,
            getSeasonalDayType,
        },
    };
    const runtime = PokeBotModules.createRuntime(moduleCtx);
    runtime.register(PokeBotModules.dailyPass);
    runtime.register(PokeBotModules.autoEvolve);
    runtime.register(PokeBotModules.capture);
    runtime.register(PokeBotModules.restock);
    runtime.register(PokeBotModules.depot);
    runtime.register(PokeBotModules.hatchery);
    runtime.register(PokeBotModules.bosses);
    runtime.register(PokeBotModules.bossLoot);
    runtime.register(PokeBotModules.teamSeason);
    runtime.register(PokeBotModules.rmtRadar);
    runtime.register(PokeBotModules.miniGames);
    runtime.register(PokeBotModules.telemetry);
    runtime.register(PokeBotModules.huntQueue);
    runtime.register(PokeBotModules.hubSheet);
    runtime.register(PokeBotModules.mapHop);

    const checkDailyPass = (force = false) => runtime.call('dailyPass', 'claim', { force });
    const autoEvolveCheck = () => runtime.call('autoEvolve', 'tick');
    const processCaidos = (container) => runtime.call('capture', 'process', container);
    const ensureCaidosObserver = () => runtime.call('capture', 'ensureObserver');
    const smartRestock = (force = false) => runtime.call('restock', 'run', { force });
    const runDepotManager = (force = false) => runtime.call('depot', 'run', { force });
    const checkIncubator = (force = false) => runtime.call('hatchery', 'check', { force });
    const checkBosses = (force = false) => runtime.call('bosses', 'check', { force });
    const adicionarAlertaRadar = (alerta) => runtime.call('rmtRadar', 'addAlert', alerta);
    const removerAlertaRadar = (index) => runtime.call('rmtRadar', 'removeAlert', index);
    const applyMiniGameGuess = (pokemonName, submit = false) => runtime.call('miniGames', 'applyGuess', pokemonName, submit);
    const abrirSeletorCsvPokedex = () => runtime.call('miniGames', 'openCsvPicker');

    // Telemetria, mapa/hop, fila /hunt e ficha do Hub (lote C): nomes antigos usados por HUD, API pública e init
    const createSession = (hunt, pokemon, markerMeta) => runtime.call('telemetry', 'createSession', hunt, pokemon, markerMeta);
    const computeSessionMetrics = (session, now) => runtime.call('telemetry', 'computeSessionMetrics', session, now);
    const persistCurrentSession = (forceSave) => runtime.call('telemetry', 'persistCurrentSession', forceSave);
    const updateFarmTelemetry = () => runtime.call('telemetry', 'updateFarmTelemetry');
    const hopNextTopCatchArea = (force) => runtime.call('mapHop', 'hopNextTopCatchArea', force);
    const otimizarRegiao = (options) => runtime.call('mapHop', 'otimizarRegiao', options);
    const definirFilaHunt = (list) => runtime.call('huntQueue', 'definirFilaHunt', list);
    const loadManualQueue = (irAgora) => runtime.call('huntQueue', 'loadManualQueue', irAgora);
    const limparFilaHunt = () => runtime.call('huntQueue', 'limparFilaHunt');
    const syncHuntGuideQueue = (force) => runtime.call('huntQueue', 'syncHuntGuideQueue', force);
    const irProximaHuntGuia = (force) => runtime.call('huntQueue', 'irProximaHuntGuia', force);
    const copyActiveSheet = (options) => runtime.call('hubSheet', 'copyActiveSheet', options);
    const copiarFichaHunt = (abrirSite) => runtime.call('hubSheet', 'copiarFichaHunt', abrirSite);

