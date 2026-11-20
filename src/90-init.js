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
    console.log(`[PokeBot v${VERSION}] Ativo!`);
})();
