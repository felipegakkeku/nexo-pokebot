// Motor puro para Treinador Automático (Exp. Share 70050 e Casas) e Sniper do Mercado da Comunidade (Gold/Gemas).

export const XP_SHARE_HELD_ID = 70050;
export const XP_SHARE_HELD_COOLDOWN_MS = 60_000;
export const HOUSE_SWAP_COOLDOWN_MS = 5_000;

/**
 * Resolve o local atual de um Pokémon no formato oficial do PokeIdle.
 * @param {object|null} pk Objeto do Pokémon em state.pokemons.
 * @param {object|null} [state] Estado do jogador contendo automation.pokemonTravado.
 * @returns {'equipe'|'colecao'|'depot'} Localização do Pokémon.
 */
export function getPokemonLocation(pk, state = null) {
    if (!pk || typeof pk !== 'object') return 'depot';
    if (pk.slot != null) return 'equipe';
    const travados = Array.isArray(state?.automation?.pokemonTravado)
        ? state.automation.pokemonTravado.map(Number)
        : [];
    if (travados.includes(Number(pk.id))) return 'colecao';
    return 'depot';
}

/**
 * Lista as casas ativas e disponíveis para treino (não anunciadas e em uso).
 * @param {object|null} state Estado atual do jogador.
 * @returns {Array<object>} Casas em uso.
 */
export function getActiveHouses(state = null) {
    const list = state?.casa?.lista;
    if (!Array.isArray(list)) return [];
    return list.filter((c) => c && !c.anunciada && c.emUso !== false);
}

function getHouseSlots(casa, state) {
    if (Array.isArray(casa?.postos)) return casa.postos;
    if (state?.xpShare && state.xpShare.casaId === casa?.id && Array.isArray(state.xpShare.slots)) {
        return state.xpShare.slots.map((s) => s?.id ?? null);
    }
    const cap = Math.max(0, Number(casa?.slots ?? casa?.postosQtd ?? 0) || 0);
    return Array.from({ length: cap }, () => null);
}

/**
 * Avalia o plano de treino automático para Exp. Share (70050) e Casas de XP.
 * Sempre retorna resumo completo para a HUD; só gera ações quando config.trainerEnabled === true.
 * @param {object} params Contexto contendo state, config, tracker, nowMs e catalog.
 * @returns {{ actions: Array<object>, logs: Array<{kind: string, text: string}>, summary: object }}
 */
export function evaluateTrainerPlan({
    state = null,
    config = {},
    tracker = {},
    nowMs = Date.now(),
    catalog = {},
} = {}) {
    tracker.houseSlotAt ??= {};

    const actions = [];
    const logs = [];
    const pokemons = Array.isArray(state?.pokemons) ? state.pokemons : [];
    const byId = new Map();
    for (const pk of pokemons) {
        if (pk && pk.id != null) byId.set(String(pk.id), pk);
    }

    const expShareBag = Math.max(
        0,
        Number(state?.items?.[XP_SHARE_HELD_ID] ?? state?.items?.[String(XP_SHARE_HELD_ID)] ?? 0) || 0
    );
    const equippedExpShare = pokemons.filter((p) => Number(p?.heldItemId) === XP_SHARE_HELD_ID);
    const houses = getActiveHouses(state);

    const houseSlots = [];
    const inHouseIds = new Set();
    const houseByPokemonId = new Map();
    for (const casa of houses) {
        const postos = getHouseSlots(casa, state);
        for (let slotIdx = 0; slotIdx < postos.length; slotIdx++) {
            const rawOccupant = postos[slotIdx];
            const occupantId = rawOccupant != null && typeof rawOccupant === 'object' ? rawOccupant.id : rawOccupant;
            const occupantStr = occupantId != null ? String(occupantId) : null;
            if (occupantStr) {
                inHouseIds.add(occupantStr);
                houseByPokemonId.set(occupantStr, { casaId: casa.id, slot: slotIdx });
            }
            houseSlots.push({
                casaId: casa.id,
                rarity: casa.rar || 'comum',
                slot: slotIdx,
                occupantId: occupantId ?? null,
            });
        }
    }

    const rawQueue = Array.isArray(config?.trainerQueue) ? config.trainerQueue : [];
    const mode = config?.trainerMode === 'sequential' ? 'sequential' : 'step';
    const stepLevels = Math.max(5, Math.min(1000, Math.floor(Number(config?.trainerStepLevels || 50) || 50)));
    const activeIdStr = state?.activeId != null ? String(state.activeId) : null;

    const queueItems = [];
    for (let idx = 0; idx < rawQueue.length; idx++) {
        const raw = rawQueue[idx];
        if (!raw || raw.pokemonId == null) continue;
        const idStr = String(raw.pokemonId);
        const pk = byId.get(idStr) || null;
        const speciesId = pk?.speciesId ?? raw.speciesId ?? null;
        const resolvedName = pk?.apelido || pk?.nome || pk?.name || raw.name || (speciesId != null ? catalog?.pokemonNames?.[speciesId] : '') || `#${idStr}`;
        const level = pk ? Math.max(1, Number(pk.level ?? pk.nivel ?? 1) || 1) : null;
        const targetLevel = Math.max(2, Math.min(10000, Math.floor(Number(raw.targetLevel || 200) || 200)));
        const hasExpShare = pk ? Number(pk.heldItemId) === XP_SHARE_HELD_ID : false;
        const inHouse = Boolean(pk && inHouseIds.has(idStr));
        const isActive = Boolean(pk && activeIdStr === idStr);
        const done = pk ? level >= targetLevel : false;
        const location = pk ? getPokemonLocation(pk, state) : 'missing';

        queueItems.push({
            order: idx,
            pokemonId: pk ? pk.id : raw.pokemonId,
            idStr,
            name: resolvedName,
            speciesId,
            shiny: Boolean(pk?.shiny),
            level,
            targetLevel,
            location,
            hasExpShare,
            inHouse,
            houseSlot: houseByPokemonId.get(idStr) || null,
            isActive,
            done,
            missing: !pk,
            eligible: Boolean(pk && !isActive && !done),
            stepGoal: targetLevel,
        });
    }

    const queueById = new Map(queueItems.map((q) => [q.idStr, q]));
    const pendingEligible = queueItems.filter((q) => q.eligible);

    let currentStepCeiling = null;
    if (mode === 'step' && pendingEligible.length > 0) {
        const minLvl = Math.min(...pendingEligible.map((q) => q.level));
        currentStepCeiling = (Math.floor(minLvl / stepLevels) + 1) * stepLevels;
        for (const q of pendingEligible) {
            q.stepGoal = Math.min(q.targetLevel, currentStepCeiling);
        }
    }

    const prioritizedPending = [...pendingEligible].sort((a, b) => {
        if (mode === 'step') {
            const aBehind = a.level < a.stepGoal ? 0 : 1;
            const bBehind = b.level < b.stepGoal ? 0 : 1;
            if (aBehind !== bBehind) return aBehind - bBehind;
        }
        return a.order - b.order;
    });

    const assignFreeHouseIds = new Set();
    if (config?.trainerEnabled === true && state) {
        // 1) Alocacao nas Casas (somente Equipe e Colecao, sem Exp. Share Held)
        if (config?.trainerUseHouses !== false && houseSlots.length > 0) {
            const houseEligible = () =>
                prioritizedPending.filter(
                    (q) => q.location !== 'depot' && !q.hasExpShare && !q.inHouse && !assignFreeHouseIds.has(q.idStr)
                );

            for (const slotInfo of houseSlots) {
                const slotKey = `${slotInfo.casaId}:${slotInfo.slot}`;
                if (nowMs - (tracker.houseSlotAt[slotKey] || 0) < HOUSE_SWAP_COOLDOWN_MS) continue;

                const occStr = slotInfo.occupantId != null ? String(slotInfo.occupantId) : null;
                if (occStr != null) {
                    const occQueue = queueById.get(occStr);
                    // Nunca remove Pokemon que nao pertence a fila gerenciada
                    if (!occQueue) continue;

                    const behindCandidates = houseEligible().filter((q) => mode !== 'step' || q.level < q.stepGoal);
                    const hitStep = mode === 'step' && occQueue.level >= occQueue.stepGoal && behindCandidates.length > 0;
                    const shouldVacate = occQueue.done || occQueue.isActive || hitStep;
                    if (!shouldVacate) continue;

                    const replacement = behindCandidates[0] || houseEligible()[0] || null;
                    tracker.houseSlotAt[slotKey] = nowMs;
                    actions.push({
                        t: 'xpshare.escolher',
                        casaId: slotInfo.casaId,
                        slot: slotInfo.slot,
                        pokemonId: replacement ? replacement.pokemonId : null,
                    });
                    if (replacement) {
                        assignFreeHouseIds.add(replacement.idStr);
                        logs.push({
                            kind: 'ok',
                            text: `Treinador: Casa #${slotInfo.casaId} trocou ${occQueue.name} (Nv ${occQueue.level}) por ${replacement.name} (Nv ${replacement.level} -> alvo Nv ${replacement.targetLevel}).`,
                        });
                    } else {
                        logs.push({
                            kind: 'ok',
                            text: `Treinador: ${occQueue.name} atingiu Nv ${occQueue.level}, liberando posto na Casa #${slotInfo.casaId}.`,
                        });
                    }
                    occQueue.inHouse = false;
                } else {
                    const candidate = houseEligible()[0] || null;
                    if (!candidate) continue;
                    tracker.houseSlotAt[slotKey] = nowMs;
                    assignFreeHouseIds.add(candidate.idStr);
                    candidate.inHouse = true;
                    actions.push({
                        t: 'xpshare.escolher',
                        casaId: slotInfo.casaId,
                        slot: slotInfo.slot,
                        pokemonId: candidate.pokemonId,
                    });
                    logs.push({
                        kind: 'ok',
                        text: `Treinador: ${candidate.name} entrou na Casa #${slotInfo.casaId} (Nv ${candidate.level} -> alvo Nv ${candidate.targetLevel}).`,
                    });
                }
            }
        }

        // 2) Alocacao de Exp. Share (70050) com cooldown oficial de 60s
        const expShareReady = nowMs - (tracker.lastExpShareAt || 0) >= XP_SHARE_HELD_COOLDOWN_MS;
        if (config?.trainerUseExpShare !== false && expShareReady) {
            const expEligible = prioritizedPending.filter(
                (q) => !q.hasExpShare && !q.inHouse && !assignFreeHouseIds.has(q.idStr)
            );
            const behindExpEligible = expEligible.filter((q) => mode !== 'step' || q.level < q.stepGoal);

            let swappedOrRemoved = false;
            for (const pk of equippedExpShare) {
                const q = queueById.get(String(pk.id));
                if (!q) continue;
                const hitStepWait = mode === 'step' && q.level >= q.stepGoal && expShareBag === 0 && behindExpEligible.length > 0;
                if (q.done || q.isActive || hitStepWait) {
                    tracker.lastExpShareAt = nowMs;
                    actions.push({ t: 'xpshareheld.remover', pokemonId: pk.id });
                    logs.push({
                        kind: 'ok',
                        text: q.done
                            ? `Treinador: ${q.name} atingiu o alvo Nv ${q.targetLevel}, removendo Exp. Share.`
                            : `Treinador: ${q.name} concluiu o degrau Nv ${q.level}, removendo Exp. Share para revezamento.`,
                    });
                    swappedOrRemoved = true;
                    break;
                }
            }

            if (!swappedOrRemoved && expShareBag >= 1 && expEligible.length > 0) {
                const next = behindExpEligible[0] || expEligible[0];
                tracker.lastExpShareAt = nowMs;
                actions.push({ t: 'xpshareheld.equipar', pokemonId: next.pokemonId });
                logs.push({
                    kind: 'ok',
                    text: `Treinador: Exp. Share equipado em ${next.name} (Nv ${next.level} -> alvo Nv ${next.targetLevel}).`,
                });
            }
        }
    }

    const totalHouseSlots = houseSlots.length;
    const occupiedHouseSlots = houseSlots.filter((s) => s.occupantId != null).length;
    const summary = {
        enabled: Boolean(config?.trainerEnabled),
        mode,
        stepLevels,
        currentStepCeiling,
        expShareBag,
        expShareEquipped: equippedExpShare.length,
        expShareTotal: expShareBag + equippedExpShare.length,
        houseCount: houses.length,
        houseSlotsTotal: totalHouseSlots,
        houseSlotsOccupied: occupiedHouseSlots,
        pendingCount: pendingEligible.length,
        doneCount: queueItems.filter((q) => q.done).length,
        queue: queueItems,
    };

    return { actions, logs, summary };
}

/**
 * Verifica no resumo de mercado (aba 'itens') quais regras de sniper tiveram menor preco <= alvo
 * e retorna comandos market.item respeitando cooldown de consulta por par item/moeda.
 * @param {object} params Contexto com resumo, rules, nowMs e tracker.
 * @returns {Array<{ t: 'market.item', itemId: number, moeda: 'gold'|'orb' }>} Comandos de consulta.
 */
export function evaluateSniperSummary({
    resumo = {},
    rules = [],
    nowMs = Date.now(),
    tracker = {},
} = {}) {
    tracker.itemQueryAt ??= {};
    if (!resumo || typeof resumo !== 'object' || !Array.isArray(rules) || rules.length === 0) {
        return [];
    }

    const commands = [];
    const seenPair = new Set();

    for (const rule of rules) {
        if (!rule || rule.enabled === false) continue;
        const itemId = Number(rule.itemId);
        if (!Number.isInteger(itemId) || itemId <= 0) continue;
        const maxQty = Math.max(0, Math.floor(Number(rule.maxQty || 0) || 0));
        const boughtQty = Math.max(0, Math.floor(Number(rule.boughtQty || 0) || 0));
        if (maxQty > 0 && boughtQty >= maxQty) continue;

        const moeda = rule.currency === 'orb' ? 'orb' : 'gold';
        const pairKey = `${itemId}:${moeda}`;
        if (seenPair.has(pairKey)) continue;

        const entry = resumo[itemId] || resumo[String(itemId)] || null;
        if (!entry || !entry.anuncios) continue;

        const minPrice = moeda === 'orb' ? entry.minOrb : entry.minGold;
        if (typeof minPrice !== 'number' || minPrice <= 0 || minPrice > Number(rule.maxPrice || 0)) {
            continue;
        }

        if (nowMs - (tracker.itemQueryAt[pairKey] || 0) < 5_000) continue;
        tracker.itemQueryAt[pairKey] = nowMs;
        seenPair.add(pairKey);
        commands.push({ t: 'market.item', itemId, moeda });
    }

    return commands;
}

/**
 * Avalia os anuncios detalhados de um item no Mercado da Comunidade e decide alertas/compras
 * respeitando preco maximo, saldo disponivel acima das reservas, retencao e posse do anuncio.
 * @param {object} params Contexto com itemId, moeda, linhas, rules, state, config, tracker, syncedNowMs.
 * @returns {{ actions: Array<object>, logs: Array<{kind: string, text: string}>, hits: Array<object>, purchases: Array<object>, recheckAtMs: number|null }}
 */
export function evaluateSniperItemListings({
    itemId,
    moeda = 'gold',
    linhas = [],
    rules = [],
    state = null,
    config = {},
    tracker = {},
    syncedNowMs = Date.now(),
} = {}) {
    tracker.alertedListings ??= new Map();
    tracker.attemptedListings ??= new Map();
    tracker.retentionNotified ??= new Map();

    const cleanId = Number(itemId);
    const currency = moeda === 'orb' ? 'orb' : 'gold';
    const currencyLabel = currency === 'orb' ? 'gemas' : 'gold';

    const activeRules = (Array.isArray(rules) ? rules : []).filter((r) => {
        if (!r || r.enabled === false) return false;
        if (Number(r.itemId) !== cleanId) return false;
        if ((r.currency === 'orb' ? 'orb' : 'gold') !== currency) return false;
        const maxQty = Math.max(0, Math.floor(Number(r.maxQty || 0) || 0));
        const boughtQty = Math.max(0, Math.floor(Number(r.boughtQty || 0) || 0));
        return maxQty === 0 || boughtQty < maxQty;
    });

    if (activeRules.length === 0 || !Array.isArray(linhas) || linhas.length === 0) {
        return { actions: [], logs: [], hits: [], purchases: [], recheckAtMs: null };
    }

    const sortedListings = [...linhas].sort((a, b) => Number(a?.preco || 0) - Number(b?.preco || 0));
    const reserve = currency === 'orb'
        ? Math.max(0, Math.floor(Number(config?.sniperMinOrbsReserve || 0) || 0))
        : Math.max(0, Math.floor(Number(config?.sniperMinGoldReserve || 0) || 0));
    const rawBalance = currency === 'orb'
        ? Math.floor(Number(state?.orbs ?? 0) || 0)
        : Math.floor(Number(state?.gold ?? 0) || 0);
    let availableBalance = Math.max(0, rawBalance - reserve);

    const actions = [];
    const logs = [];
    const hits = [];
    const purchases = [];
    let recheckAtMs = null;

    // Evita crescimento infinito dos mapas de controle
    if (tracker.alertedListings.size > 200) {
        for (const [k, ts] of tracker.alertedListings) {
            if (syncedNowMs - ts > 600_000) tracker.alertedListings.delete(k);
        }
    }
    if (tracker.attemptedListings.size > 200) {
        for (const [k, ts] of tracker.attemptedListings) {
            if (syncedNowMs - ts > 120_000) tracker.attemptedListings.delete(k);
        }
    }

    const simulatedBought = new Map(activeRules.map((r) => [r.id, Math.max(0, Math.floor(Number(r.boughtQty || 0) || 0))]));

    for (const listing of sortedListings) {
        if (!listing || listing.id == null) continue;
        const price = Number(listing.preco || 0);
        const qtyAvail = Math.max(0, Math.floor(Number(listing.qtd || 0) || 0));
        if (price <= 0 || qtyAvail <= 0) continue;
        if (listing.vendedorId != null && state?.id != null && Number(listing.vendedorId) === Number(state.id)) {
            continue;
        }

        const rule = activeRules.find((r) => {
            if (price > Number(r.maxPrice || 0)) return false;
            const maxQty = Math.max(0, Math.floor(Number(r.maxQty || 0) || 0));
            const curBought = simulatedBought.get(r.id) || 0;
            return maxQty === 0 || curBought < maxQty;
        });
        if (!rule) continue;

        const itemLabel = rule.itemName || `Item #${cleanId}`;
        const compravelEm = Number(listing.compravelEm || 0);
        if (compravelEm > syncedNowMs) {
            const candidateRecheck = compravelEm + 150;
            if (recheckAtMs == null || candidateRecheck < recheckAtMs) {
                recheckAtMs = candidateRecheck;
            }
            if (tracker.retentionNotified.get(listing.id) !== compravelEm) {
                tracker.retentionNotified.set(listing.id, compravelEm);
                const waitSec = Math.max(1, Math.ceil((compravelEm - syncedNowMs) / 1000));
                logs.push({
                    kind: 'info',
                    text: `Sniper: ${itemLabel} por ${price.toLocaleString('pt-BR')} ${currencyLabel} em retenção (libera em ${waitSec}s).`,
                });
            }
            continue;
        }

        if (!rule.autoBuy) {
            const prevAlertTs = tracker.alertedListings.get(listing.id) || 0;
            if (syncedNowMs - prevAlertTs >= 120_000) {
                tracker.alertedListings.set(listing.id, syncedNowMs);
                const hit = {
                    ts: syncedNowMs,
                    listingId: listing.id,
                    itemId: cleanId,
                    itemName: itemLabel,
                    qty: qtyAvail,
                    price,
                    currency,
                    seller: listing.vendedor || 'Desconhecido',
                    bought: false,
                };
                hits.push(hit);
                logs.push({
                    kind: 'reward',
                    text: `Sniper encontrou: ${itemLabel} x${qtyAvail} por ${price.toLocaleString('pt-BR')} ${currencyLabel} (${hit.seller}).`,
                });
            }
            continue;
        }

        const prevAttempt = tracker.attemptedListings.get(listing.id) || 0;
        if (syncedNowMs - prevAttempt < 30_000) continue;

        const maxQty = Math.max(0, Math.floor(Number(rule.maxQty || 0) || 0));
        const curBought = simulatedBought.get(rule.id) || 0;
        const remNeed = maxQty > 0 ? Math.max(0, maxQty - curBought) : qtyAvail;
        const maxAfford = Math.floor(availableBalance / price);
        const buyQty = Math.min(qtyAvail, remNeed, maxAfford);

        if (buyQty >= 1) {
            availableBalance -= buyQty * price;
            simulatedBought.set(rule.id, curBought + buyQty);
            tracker.attemptedListings.set(listing.id, syncedNowMs);

            actions.push({
                t: 'market.comprar',
                id: listing.id,
                qtd: buyQty,
                preco: price,
                moeda: currency,
            });
            const purchase = {
                ts: syncedNowMs,
                ruleId: rule.id,
                listingId: listing.id,
                itemId: cleanId,
                itemName: itemLabel,
                qty: buyQty,
                price,
                currency,
                seller: listing.vendedor || 'Desconhecido',
                bought: true,
            };
            purchases.push(purchase);
            hits.push(purchase);
            logs.push({
                kind: 'reward',
                text: `Sniper comprou: ${itemLabel} x${buyQty} por ${price.toLocaleString('pt-BR')} ${currencyLabel} (${purchase.seller}).`,
            });
        }
    }

    return { actions, logs, hits, purchases, recheckAtMs };
}
