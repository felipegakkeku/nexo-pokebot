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

    state.timers.push(setInterval(() => scheduleIdle(updateHud), CONFIG.hud.refreshMs));

    runtime.start();

    updateHud();
    console.log(`[PokeBot v${VERSION}] Ativo!`);
})();
