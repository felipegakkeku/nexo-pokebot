    // --- Módulos (Fase 2) ---
    // Ponte entre o código legado (este escopo) e os módulos ES empacotados em PokeBotModules.
    // Cada módulo migrado sai de src/4x-*.js, vai para src/modules/ e ganha uma entrada aqui.
    const moduleCtx = {
        CONFIG,
        state,
        sleep,
        randomDelay,
        withModalLock,
        keys: { passNext: STORAGE_PASS_NEXT_KEY },
        storage: {
            get: (key) => localStorage.getItem(key),
            set: (key, value) => localStorage.setItem(key, value),
        },
        dom: {
            $: (selector) => document.querySelector(selector),
            getVisibleModal,
            closeActiveModal,
            findMenuButtonByImg,
            findClickableByText,
            waitFor,
            isInteractable,
            getTrainerHeaderInfo,
        },
    };
    const runtime = PokeBotModules.createRuntime(moduleCtx);
    runtime.register(PokeBotModules.dailyPass);

    const checkDailyPass = (force = false) => runtime.call('dailyPass', 'claim', { force });

