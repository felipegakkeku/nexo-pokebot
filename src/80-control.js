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
        console.log(`[PokeBot v${VERSION}] Encerrado.`);
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
            filaHuntProximo: state.huntQueue.length ? state.huntQueue[state.huntQueueIndex % state.huntQueue.length]?.name : '-',
            filaFallbackSeguro: CONFIG.huntQueue.fallbackToSafeArea,
            autoEvoluir: CONFIG.evolve.enabled,
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
        carregarFilaManual: loadManualQueue,
        verificarEvolucao: autoEvolveCheck,
        limparFilaHunt,
        copiarFichaHunt,
        copiarFichaAtivo: copyActiveSheet,
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
    if (pageWin !== window) {
        try {
            pageWin.PokeBot = window.PokeBot;
        } catch {
            // sem acesso à janela da página: o console só enxerga PokeBot dentro do sandbox
        }
    }
