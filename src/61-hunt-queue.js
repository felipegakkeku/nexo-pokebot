    // --- Fila /hunt (v6.5) ---
    const definirFilaHunt = (list) => {
        if (!Array.isArray(list)) return [];
        state.huntQueue = list
            .map((entry) =>
                typeof entry === 'string'
                    ? parseQueueEntry(entry)
                    : { ...entry, name: String(entry?.name || '').trim() }
            )
            .filter((x) => x.name.length > 0);
        state.huntQueueIndex = 0;
        saveHuntQueueState();
        state.lastActionNote = `Fila /hunt: ${state.huntQueue.length} áreas`;
        updateHud();
        return state.huntQueue;
    };

    // Fila manual: lê a caixa de texto do HUD, atualiza state/storage/HUD na hora (sem reload, sem derrubar timers)
    const loadManualQueue = async (irAgora = false) => {
        const raw = state.hudEl?.querySelector('#pb-manual-queue')?.value || '';
        const entries = parseQueueText(raw);

        if (entries.length === 0) {
            if (irAgora && state.huntQueue.length > 0) {
                return irProximaHuntGuia(true);
            }
            state.lastActionNote = 'Cole ao menos 1 área válida';
            updateHud();
            return false;
        }

        definirFilaHunt(entries);
        state.lastActionNote = `Fila /hunt: ${state.huntQueue.length} itens (próx: ${state.huntQueue[0].name})`;
        updateHud();

        if (irAgora) {
            return irProximaHuntGuia(true);
        }
        return true;
    };

    const limparFilaHunt = () => {
        state.huntQueue = [];
        state.huntQueueIndex = 0;
        saveHuntQueueState();
        state.lastActionNote = 'Fila /hunt limpa';
        updateHud();
    };

    // Monta a fila sem tomar o lock (pode ser chamada de dentro de outra rotina com lock)
    const buildHuntQueueItems = async () => {
        let items = [];

        // Monta a fila a partir das áreas seguras/liberadas do mapa (a lista do Hub entra pela caixa "Fila Manual")
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
        return items;
    };

    const adoptHuntQueue = (items) => {
        state.huntQueue = items;
        state.huntQueueIndex = 0;
        saveHuntQueueState();
        state.lastActionNote = `Fila /hunt pronta (${items.length} áreas)`;
    };

    const syncHuntGuideQueue = async (force = false) => {
        return withModalLock(
            'Montando fila',
            async () => {
                const items = await buildHuntQueueItems();
                if (items.length > 0) {
                    adoptHuntQueue(items);
                } else if (!state.lastActionNote.startsWith('Guia /hunt:')) {
                    state.lastActionNote = 'Nenhuma área encontrada para a fila';
                }
                return state.huntQueue;
            },
            { force }
        );
    };

    // Casa uma entrada da fila (espécie/alvo do Hub ou nome de região) com um marcador liberado do mapa
    const findQueueMatch = (entry, candidates) => {
        if (entry.markerMeta) return entry.markerMeta;
        const needle = normalizeText(entry.regionName || entry.name);
        if (!needle) return null;
        const byName = candidates.filter((c) => {
            const region = normalizeText(c.regionName);
            const title = normalizeText(c.title);
            return (
                (region && (region.includes(needle) || needle.includes(region))) ||
                (title && title.includes(needle))
            );
        });
        // Se a entrada trouxe nível (ex.: "Kakuna Nv 10"), prefere a área com esse nível
        return (entry.level && byName.find((c) => c.areaLevel === entry.level)) || byName[0] || null;
    };

    // Fallback seguro: área liberada, diferente da atual e com nível não acima do Pokémon ativo
    const pickSafeFallback = (entry, candidates, poke) => {
        const pokeLevel = poke?.level ?? null;
        const pool = candidates.filter((c) => !c.isCurrent && (pokeLevel === null || c.areaLevel <= pokeLevel));
        if (pool.length === 0) return null;
        return (entry?.level && pool.find((c) => c.areaLevel === entry.level)) || pool[0];
    };

    const irProximaHuntGuia = async (force = false) => {
        return withModalLock(
            'Fila /hunt',
            async () => {
                if (state.huntQueue.length === 0) {
                    const built = await buildHuntQueueItems();
                    if (built.length > 0) adoptHuntQueue(built);
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
                    const matchedMeta = findQueueMatch(entry, liveCandidates);
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

                // Nenhuma entrada casou com marcador do mapa: usa área segura/liberada como fallback
                if (CONFIG.huntQueue.fallbackToSafeArea) {
                    const entry = state.huntQueue[state.huntQueueIndex % state.huntQueue.length];
                    const fallback = pickSafeFallback(entry, liveCandidates, poke);
                    if (fallback) {
                        state.huntQueueIndex = (state.huntQueueIndex + 1) % state.huntQueue.length;
                        saveHuntQueueState();
                        state.lastActionNote = `Fila sem match (${entry.name}) -> fallback ${fallback.regionName} Nv${fallback.areaLevel}`;
                        const ok = await travelToMarkerMeta(fallback);
                        if (ok) {
                            state.session = createSession(getCurrentHunt(), getActivePokemon(), fallback);
                            return true;
                        }
                    }
                }

                state.lastActionNote = 'Fila /hunt: sem área elegível agora';
                return false;
            },
            { force }
        );
    };
