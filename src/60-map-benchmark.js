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
                    title: btn.getAttribute('title') || btn.getAttribute('aria-label') || '',
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
