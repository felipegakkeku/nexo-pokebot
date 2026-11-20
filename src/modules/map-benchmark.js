// Mapa do jogo: abre o modal, aplica filtros (tipo / pokédex / liberadas), lista as áreas candidatas e viaja até uma delas.
// É a base da fila /hunt, do Top Catch Hop e do benchmark de regiões. Comportamento idêntico ao da v6.5.
import { normalizeText, parseNumber } from './pure.js';
import { SEL } from './selectors.js';

const SEL_LOCAL = {
    mapBar: '.mapa-barra',
    mapWorld: '.mapa-mundi',
    viewModeButtons: '.mapa-modo button.mapa-modo-bt',
    regionTabsUnlocked: 'button.mapa-reg-bt:not(.mapa-area-travada)',
    markersUnlocked: 'button.marcador:not(.travado)',
    checkbox: 'input[type="checkbox"]',
    checkboxHolder: 'label, div',
};

// --- Funções puras ---

// Nível máximo de área aceito: não passa do treinador nem do Pokémon ativo + margem da CONFIG
export const computeMaxAreaLevel = (trainerLevel, pokeLevel, maxLevelAbovePokemon) =>
    Math.min(trainerLevel ?? pokeLevel, pokeLevel + maxLevelAbovePokemon);

// Ordena candidatas por nível da área (decrescente; crescente no modo Top Catch)
export const sortCandidates = (candidates, ascending = false) =>
    candidates.sort((a, b) => (ascending ? a.areaLevel - b.areaLevel : b.areaLevel - a.areaLevel));

// Botão do modal de confirmação que leva até a área ("ir", "viajar", "caçar", "entrar")
export const isTravelConfirmText = (text) => {
    const t = normalizeText(text);
    return t === 'ir' || t.includes('viajar') || t.includes('cacar') || t.includes('entrar');
};

// Assinatura estável de um marcador do mapa (região + nível + posição + título)
export const getMarkerSignature = (btn, regionName) => {
    const left = btn.style.left || '';
    const top = btn.style.top || '';
    const title = btn.getAttribute('title') || btn.getAttribute('aria-label') || '';
    const level = parseNumber(btn.textContent) ?? 0;
    return `${regionName}::${level}::${left},${top}::${title}`;
};

// --- Funções com ctx ---

export const isMapModalOpen = ({ dom }) => {
    const modal = dom.getVisibleModal();
    return Boolean(modal && modal.querySelector(SEL_LOCAL.mapBar));
};

export const openMapModal = async (ctx) => {
    const { dom, sleep, randomDelay } = ctx;
    if (isMapModalOpen(ctx)) return dom.getVisibleModal();
    if (dom.getVisibleModal()) await dom.closeActiveModal();
    const mapBtn = dom.findMenuButtonByImg('menu-mapa') || dom.findClickableByText('Mapa');
    if (!mapBtn) return null;
    mapBtn.click();
    const modal = await dom.waitFor(() => (isMapModalOpen(ctx) ? dom.getVisibleModal() : null), 3800);
    if (modal) await sleep(randomDelay(240, 380));
    return modal;
};

export const ensureMapViewMode = async ({ dom, sleep, randomDelay }, modal, modeLabel = 'MAPA') => {
    const btns = Array.from(modal.querySelectorAll(SEL_LOCAL.viewModeButtons));
    const target = btns.find((b) => normalizeText(b.textContent) === normalizeText(modeLabel));
    if (target && !target.classList.contains('on') && dom.isInteractable(target)) {
        target.click();
        await sleep(randomDelay(200, 340));
    }
};

export const applyMapFilters = async (
    { dom, sleep },
    modal,
    { pokemonTypes = [], useTypeAdvantage = true, onlyUnlocked = true, pokedexFilter = null } = {}
) => {
    const bar = modal.querySelector(SEL_LOCAL.mapBar);
    if (!bar) return;

    const tipoTrigger = Array.from(bar.querySelectorAll('button')).find((b) =>
        normalizeText(b.textContent).startsWith('tipo')
    );
    if (tipoTrigger && dom.isInteractable(tipoTrigger)) {
        const ensureTipoOpen = async () => {
            if (!dom.findClickableByText('todos os tipos', modal, true)) {
                tipoTrigger.click();
                await dom.waitFor(() => dom.findClickableByText('todos os tipos', modal, true), 1400);
                await sleep(120);
            }
        };
        await ensureTipoOpen();
        const resetBtn = dom.findClickableByText('todos os tipos', modal, true);
        if (resetBtn) {
            resetBtn.click();
            await sleep(150);
        }
        if (useTypeAdvantage && pokemonTypes.length > 0) {
            await ensureTipoOpen();
            for (const type of pokemonTypes) {
                const typeBtn = dom.findClickableByText(type, modal, true);
                if (typeBtn) {
                    typeBtn.click();
                    await sleep(120);
                }
            }
            const weakBtn = dom.findClickableByText('Fraco contra', modal, true);
            if (weakBtn) {
                weakBtn.click();
                await sleep(150);
            }
        }
        if (dom.findClickableByText('todos os tipos', modal, true)) {
            tipoTrigger.click();
            await sleep(120);
        }
    }

    const dexTrigger = Array.from(bar.querySelectorAll('button')).find((b) =>
        normalizeText(b.textContent).startsWith('pokedex')
    );
    if (dexTrigger && dom.isInteractable(dexTrigger)) {
        const desiredLabel = pokedexFilter || 'Todos';
        if (!normalizeText(dexTrigger.textContent).includes(normalizeText(desiredLabel))) {
            dexTrigger.click();
            const option = await dom.waitFor(
                () => dom.findClickableByText(desiredLabel, modal, desiredLabel === 'Todos'),
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
        if (nivelTrigger && dom.isInteractable(nivelTrigger)) {
            const findUnlockedCb = () =>
                Array.from(modal.querySelectorAll(SEL_LOCAL.checkbox)).find((cb) => {
                    const parentTxt = normalizeText(cb.closest(SEL_LOCAL.checkboxHolder)?.textContent);
                    return parentTxt.includes('liberadas') && dom.isVisible(cb);
                });

            if (!findUnlockedCb()) {
                nivelTrigger.click();
                await dom.waitFor(findUnlockedCb, 1400);
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

export const selectMapRegionTab = async ({ dom, sleep, randomDelay }, modal, regionName) => {
    const regBtn = Array.from(modal.querySelectorAll(SEL_LOCAL.regionTabsUnlocked)).find((b) =>
        normalizeText(b.textContent).startsWith(normalizeText(regionName))
    );
    if (!regBtn) return false;
    if (!regBtn.classList.contains('on')) {
        regBtn.click();
        await sleep(randomDelay(220, 340));
    }
    return true;
};

export const collectCandidatesFromOpenMap = async (ctx, modal, poke, useTypeAdvantage, pokedexFilter, ascending = false) => {
    const { CONFIG, dom, sleep, randomDelay } = ctx;
    await ensureMapViewMode(ctx, modal, 'MAPA');
    await applyMapFilters(ctx, modal, {
        pokemonTypes: poke?.types || [],
        useTypeAdvantage,
        onlyUnlocked: CONFIG.map.onlyUnlocked,
        pokedexFilter,
    });

    const unlockedRegions = Array.from(modal.querySelectorAll(SEL_LOCAL.regionTabsUnlocked));

    const candidates = [];
    const pokeLevel = poke?.level ?? 1;
    const trainerLevel = dom.getTrainerHeaderInfo().level ?? pokeLevel;
    const maxLevel = computeMaxAreaLevel(trainerLevel, pokeLevel, CONFIG.map.maxLevelAbovePokemon);

    for (const regBtn of unlockedRegions) {
        const regionName = (regBtn.textContent || '').split('\n')[0].trim();
        if (!regBtn.classList.contains('on')) {
            regBtn.click();
            await sleep(randomDelay(220, 340));
        }
        const markers = Array.from(modal.querySelectorAll(SEL_LOCAL.markersUnlocked)).filter(dom.isInteractable);

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

    return sortCandidates(candidates, ascending);
};

export const waitForAreaSwitchCooldown = async ({ CONFIG, state, updateHud, sleep }) => {
    const remaining = CONFIG.map.switchCooldownMs - (Date.now() - state.lastAreaSwitchAt);
    if (remaining > 0) {
        state.lastActionNote = `Trava de área (${(remaining / 1000).toFixed(1)}s)`;
        updateHud();
        await sleep(remaining);
    }
};

export const travelToMarkerMeta = async (ctx, meta) => {
    const { CONFIG, state, dom, sleep, randomDelay } = ctx;
    if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return false;
    await waitForAreaSwitchCooldown(ctx);
    if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return false;

    const modal = await openMapModal(ctx);
    if (!modal) return false;

    await ensureMapViewMode(ctx, modal, 'MAPA');
    await applyMapFilters(ctx, modal, {
        pokemonTypes: [],
        useTypeAdvantage: false,
        onlyUnlocked: CONFIG.map.onlyUnlocked,
        pokedexFilter: null,
    });

    const switched = await selectMapRegionTab(ctx, modal, meta.regionName);
    if (!switched) {
        await dom.closeActiveModal();
        return false;
    }

    const markers = Array.from(modal.querySelectorAll(SEL_LOCAL.markersUnlocked)).filter(dom.isInteractable);

    let targetBtn = markers.find((b) => getMarkerSignature(b, meta.regionName) === meta.signature);
    if (!targetBtn && markers[meta.indexInRegion]) targetBtn = markers[meta.indexInRegion];

    if (!targetBtn) {
        await dom.closeActiveModal();
        return false;
    }

    if (targetBtn.classList.contains('on')) {
        await dom.closeActiveModal();
        state.lastMarkerMeta = meta;
        return true;
    }

    const prevHuntKey = dom.getCurrentHunt()?.key || null;
    targetBtn.click();

    const traveled = await dom.waitFor(() => {
        if (!dom.getVisibleModal()) return true;
        const currKey = dom.getCurrentHunt()?.key || null;
        if (prevHuntKey && currKey && currKey !== prevHuntKey) return true;
        const activeModal = dom.getVisibleModal();
        if (activeModal) {
            const confirmBtn =
                dom.$(SEL.confirmarSim) ||
                Array.from(activeModal.querySelectorAll('button')).find((b) => {
                    if (!dom.isInteractable(b) || b.closest(SEL_LOCAL.mapBar) || b.closest(SEL_LOCAL.mapWorld)) return false;
                    return isTravelConfirmText(b.textContent);
                });
            if (confirmBtn && dom.isInteractable(confirmBtn)) confirmBtn.click();
        }
        return false;
    }, 2800, 140);

    if (dom.getVisibleModal()) await dom.closeActiveModal();

    if (traveled) {
        state.lastAreaSwitchAt = Date.now();
        state.lastMarkerMeta = meta;
        state.stats.regionSwitches++;
        await sleep(randomDelay(300, 480));
    }
    return Boolean(traveled);
};

export const saveHuntQueueState = ({ CONFIG, state, storage, keys }) => {
    storage.saveJson(keys.huntQueue, {
        mode: CONFIG.mode,
        updatedAt: Date.now(),
        index: state.huntQueueIndex,
        items: state.huntQueue,
    });
};
