// ==UserScript==
// @name         PokeBot (Pokeidle)
// @namespace    https://github.com/felipegakkeku/pokebotfarm
// @version      6.6
// @description  Automação para o Pokeidle: captura, bolas, equipe, evolução, mapa e fila /hunt com HUD flutuante
// @match        https://pokeidle.io/app*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/felipegakkeku/pokebotfarm/main/dist/pokebot.user.js
// @downloadURL  https://raw.githubusercontent.com/felipegakkeku/pokebotfarm/main/dist/pokebot.user.js
// ==/UserScript==

(() => {
    var PokeBotModules = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/modules/index.js
  var index_exports = {};
  __export(index_exports, {
    SEL: () => SEL,
    SEL_ALWAYS_PRESENT: () => SEL_ALWAYS_PRESENT,
    autoEvolve: () => autoEvolve,
    bossLoot: () => bossLoot,
    bosses: () => bosses,
    capture: () => capture,
    createRuntime: () => createRuntime,
    createScheduler: () => createScheduler,
    dailyPass: () => dailyPass,
    depot: () => depot,
    dexNumberToRegion: () => dexNumberToRegion,
    evaluateEvolveRequirements: () => evaluateEvolveRequirements,
    getTeamCards: () => getTeamCards,
    hatchery: () => hatchery,
    hubSheet: () => hubSheet,
    huntQueue: () => huntQueue,
    mapHop: () => mapHop,
    miniGames: () => miniGames,
    normalizeText: () => normalizeText,
    parseRmtPriceEl: () => parseRmtPriceEl,
    pure: () => pure_exports,
    restock: () => restock,
    rmtRadar: () => rmtRadar,
    teamSeason: () => teamSeason,
    telemetry: () => telemetry,
    triggerTeamSwap: () => triggerTeamSwap
  });

  // src/modules/scheduler.js
  var createScheduler = ({
    now = () => Date.now(),
    setIntervalFn = (fn, ms) => setInterval(fn, ms),
    clearIntervalFn = (id) => clearInterval(id),
    tickMs = 100,
    onError = (id, err) => console.error(`[PokeBot] tarefa "${id}" falhou:`, err)
  } = {}) => {
    const tasks = /* @__PURE__ */ new Map();
    let timer = null;
    let paused = false;
    let disposed = false;
    const add = ({ id, everyMs, run, priority = 0, enabled = () => true, runImmediately = false }) => {
      if (disposed) return false;
      if (tasks.has(id)) throw new Error(`tarefa duplicada: ${id}`);
      tasks.set(id, { id, everyMs, run, priority, enabled, busy: false, nextAt: now() + (runImmediately ? 0 : everyMs) });
      return true;
    };
    const remove = (id) => tasks.delete(id);
    const runTask = async (task) => {
      task.busy = true;
      try {
        await task.run();
      } catch (err) {
        onError(task.id, err);
      } finally {
        task.busy = false;
      }
    };
    const tick4 = () => {
      if (disposed || paused) return Promise.resolve();
      const t = now();
      const due = [...tasks.values()].filter((task) => !task.busy && task.nextAt <= t).sort((a, b) => b.priority - a.priority || a.nextAt - b.nextAt);
      const started = [];
      for (const task of due) {
        task.nextAt = t + task.everyMs;
        if (!task.enabled()) continue;
        started.push(runTask(task));
      }
      return Promise.all(started);
    };
    const start = () => {
      if (disposed || timer !== null) return;
      timer = setIntervalFn(tick4, tickMs);
    };
    const dispose2 = () => {
      disposed = true;
      if (timer !== null) clearIntervalFn(timer);
      timer = null;
      tasks.clear();
    };
    return {
      add,
      remove,
      tick: tick4,
      start,
      dispose: dispose2,
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
      isPaused: () => paused,
      list: () => [...tasks.keys()]
    };
  };

  // src/modules/runtime.js
  var createRuntime = (ctx, { scheduler = createScheduler() } = {}) => {
    const mods = /* @__PURE__ */ new Map();
    const register = (mod) => {
      if (mods.has(mod.id)) throw new Error(`m\xF3dulo duplicado: ${mod.id}`);
      mods.set(mod.id, mod);
      mod.init?.(ctx);
      if (typeof mod.tick === "function") {
        const everyMs = typeof mod.everyMs === "function" ? mod.everyMs(ctx) : mod.everyMs;
        scheduler.add({ id: mod.id, everyMs, priority: mod.priority ?? 0, run: () => mod.tick(ctx) });
      }
      return mod;
    };
    const call = (id, method, ...args) => {
      const mod = mods.get(id);
      if (!mod || typeof mod[method] !== "function") return void 0;
      return mod[method](ctx, ...args);
    };
    const dispose2 = () => {
      scheduler.dispose();
      for (const mod of mods.values()) {
        try {
          mod.dispose?.(ctx);
        } catch (err) {
          console.error(`[PokeBot] dispose de "${mod.id}" falhou:`, err);
        }
      }
      mods.clear();
    };
    return { register, call, start: () => scheduler.start(), dispose: dispose2, scheduler, has: (id) => mods.has(id) };
  };

  // src/modules/selectors.js
  var SEL = {
    // Passe diário
    passResgatar: "button.ps-resgatar",
    passRelogio: "b[data-ps-relogio]",
    // Confirmação de evolução / diálogos de confirmação
    btnEvoluir: "#btn-evoluir",
    confirmarSim: "#confirmar-sim",
    confirmarNao: "#confirmar-nao",
    dlgReq: ".dlg-req",
    // Pokémon ativo e ficha
    ativoCard: "#ativo-card",
    ativoNome: ".ativo-nome",
    fichaGpt: "#fi-gpt",
    fichaFechar: "#ficha-fechar"
  };
  var SEL_ALWAYS_PRESENT = ["btnEvoluir", "ativoCard", "ativoNome"];

  // src/modules/daily-pass.js
  var claim = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, dom, storage, keys, sleep, randomDelay, withModalLock } = ctx;
    if (!CONFIG.dailyPass.enabled && !force) return;
    const { level } = dom.getTrainerHeaderInfo();
    if (!force && level !== null && level < 10) return;
    const nextAllowedMs = parseInt(storage.get(keys.passNext) || "0", 10);
    if (!force && nextAllowedMs > Date.now()) return;
    await withModalLock(
      "Passe",
      async () => {
        if (dom.getVisibleModal()) await dom.closeActiveModal();
        const passBtn = dom.findMenuButtonByImg("passe-") || dom.findClickableByText("Passe");
        if (!passBtn) return;
        passBtn.click();
        const resgatarBtn = await dom.waitFor(() => dom.$(SEL.passResgatar), 3500);
        if (!resgatarBtn) {
          await dom.closeActiveModal();
          return;
        }
        await sleep(randomDelay(220, 360));
        if (!resgatarBtn.disabled && dom.isInteractable(resgatarBtn)) {
          resgatarBtn.click();
          state.stats.passClaims++;
          state.lastActionNote = "Passe Di\xE1rio resgatado!";
          await sleep(randomDelay(450, 700));
        }
        const updatedBtn = dom.$(SEL.passResgatar);
        const nextTs = parseInt(updatedBtn?.querySelector(SEL.passRelogio)?.getAttribute("data-ps-relogio") || "0", 10);
        if (nextTs > Date.now()) {
          storage.set(keys.passNext, String(nextTs + 5e3));
          if (resgatarBtn.disabled) {
            state.lastActionNote = `Passe j\xE1 resgatado (${updatedBtn.textContent.trim()})`;
          }
        } else {
          storage.set(keys.passNext, String(Date.now() + 36e5));
        }
        await dom.closeActiveModal();
      },
      { force }
    );
  };
  var dailyPass = {
    id: "dailyPass",
    everyMs: (ctx) => ctx.CONFIG.dailyPass.checkIntervalMs,
    tick: (ctx) => claim(ctx, { force: false }),
    claim
  };

  // src/modules/text.js
  var normalizeText = (str) => (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

  // src/modules/auto-evolve.js
  var evaluateEvolveRequirements = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) return { ok: false, reason: "requisitos n\xE3o encontrados" };
    if (list.some((r) => /shiny/.test(normalizeText(r.text)))) {
      return { ok: false, reason: "exige Shiny Stone (ignorado)" };
    }
    const missing = list.filter((r) => !r.ok);
    if (missing.length > 0) {
      return { ok: false, reason: `falta ${missing.map((r) => r.text).join(" + ")}` };
    }
    return { ok: true, reason: "" };
  };
  var readRequirements = ({ dom }) => {
    const dialog = dom.$(SEL.confirmarSim)?.closest(".modal-caixa") || dom.getVisibleModal();
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll(SEL.dlgReq)).map((row) => ({
      ok: !row.classList.contains("falta"),
      text: (row.innerText || row.textContent || "").replace(/\s+/g, " ").trim()
    }));
  };
  var dismissDialog = async ({ dom }) => {
    const cancel = dom.$(SEL.confirmarNao);
    if (cancel && dom.isInteractable(cancel)) {
      cancel.click();
      await dom.waitFor(() => {
        const sim = dom.$(SEL.confirmarSim);
        return !sim || !dom.isInteractable(sim);
      }, 1500);
    }
    if (dom.getVisibleModal()) await dom.closeActiveModal();
  };
  var tick = async (ctx) => {
    const { CONFIG, state, dom, sleep, randomDelay, withModalLock, updateHud } = ctx;
    if (!state.running || state.paused || !CONFIG.evolve.enabled) return;
    if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return;
    if (state.modalLockOwner || dom.getVisibleModal() || dom.isInSpecialArena()) return;
    if (Date.now() < state.evolveNextAt) return;
    const evolveBtn = dom.$(SEL.btnEvoluir);
    if (!evolveBtn || !dom.isInteractable(evolveBtn)) return;
    if (normalizeText(dom.getActivePokemon()?.name) === "eevee") {
      state.evolveNextAt = Date.now() + CONFIG.evolve.recheckMs;
      return;
    }
    await withModalLock("Evoluindo", async () => {
      state.evolveNextAt = Date.now() + CONFIG.evolve.recheckMs;
      evolveBtn.click();
      const confirmBtn = await dom.waitFor(() => {
        const btn = dom.$(SEL.confirmarSim);
        return btn && dom.isInteractable(btn) ? btn : null;
      }, 2500);
      if (!confirmBtn) {
        state.lastActionNote = "Evolu\xE7\xE3o: confirma\xE7\xE3o n\xE3o abriu";
        if (dom.getVisibleModal()) await dom.closeActiveModal();
        updateHud();
        return;
      }
      const verdict = evaluateEvolveRequirements(readRequirements(ctx));
      if (!verdict.ok) {
        await dismissDialog(ctx);
        state.lastActionNote = `Evolu\xE7\xE3o adiada: ${verdict.reason}`;
        updateHud();
        return;
      }
      confirmBtn.click();
      await sleep(randomDelay(260, 420));
      state.evolveNextAt = Date.now() + CONFIG.evolve.cooldownMs;
      state.lastActionNote = "Pok\xE9mon evolu\xEDdo!";
      updateHud();
    });
  };
  var autoEvolve = {
    id: "autoEvolve",
    everyMs: (ctx) => ctx.CONFIG.evolve.checkIntervalMs,
    tick
  };

  // src/modules/pure.js
  var pure_exports = {};
  __export(pure_exports, {
    cleanKey: () => cleanKey,
    looksLikeSheet: () => looksLikeSheet,
    normalizeText: () => normalizeText2,
    parseNumber: () => parseNumber,
    parseQueueEntry: () => parseQueueEntry,
    parseQueueText: () => parseQueueText,
    parseSignedNumber: () => parseSignedNumber
  });
  var normalizeText2 = (str) => (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  var cleanKey = (str) => normalizeText2(str).replace(/[^a-z0-9]/g, "");
  var parseNumber = (text) => {
    const digits = (text || "").replace(/\D/g, "");
    if (!digits) return null;
    const n = parseInt(digits, 10);
    return Number.isNaN(n) ? null : n;
  };
  var parseSignedNumber = (text) => {
    const raw = (text || "").trim();
    const negative = raw.startsWith("-") || raw.startsWith("\u2212");
    const n = parseNumber(raw);
    if (n === null) return null;
    return negative ? -n : n;
  };
  var parseQueueEntry = (rawText, mode = null) => {
    const raw = String(rawText || "").trim();
    const m = raw.match(/^(.*?)\s+(?:n[ií]vel|nv\.?|lv\.?)\s*(\d+)\b/i);
    const name = (m ? m[1] : raw).trim();
    const level = m ? parseInt(m[2], 10) : null;
    return { name, level, raw, mode };
  };
  var parseQueueText = (rawText, mode = null) => {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    String(rawText || "").split(/[\n>|]+/).flatMap((chunk) => chunk.split(/,(?!\d)/)).forEach((piece) => {
      const cleaned = piece.replace(/[✓✗✔✘⚠☠]/g, "").replace(/^[\s\d.)\-•*]+/, "").replace(/\s+/g, " ").trim();
      if (cleaned.length < 3) return;
      const entry = parseQueueEntry(cleaned, mode);
      if (!/[a-zà-ÿ]{3,}/i.test(entry.name)) return;
      const key = `${normalizeText2(entry.name)}|${entry.level ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(entry);
    });
    return out;
  };
  var looksLikeSheet = (text) => /ficha do poke\s*idle/i.test(text || "") && (text || "").length > 300;

  // src/modules/restock.js
  var SEL_LOCAL = {
    marketCards: "#mk-corpo .mk-card",
    marketModes: "#mk-modos",
    cardName: ".mk-nome",
    cardOwned: ".mk-tem",
    cardShortcuts: ".mk-atalhos button",
    categoryBtns: "#mk-corpo .mk-lado button.mk-cat",
    categoryText: ".mk-cat-txt",
    marketTab: (abaKey) => `#mk-modos .cmp-op[data-aba="${abaKey}"]`
  };
  var getVisibleMarketCards = ({ dom }) => dom.$$(SEL_LOCAL.marketCards).filter(dom.isInteractable);
  var isMarketOpen = ({ dom }) => Boolean(dom.$(SEL_LOCAL.marketModes) && dom.isVisible(dom.$(SEL_LOCAL.marketModes)));
  var findMarketCard = (ctx, itemName) => {
    const target = normalizeText2(itemName);
    return getVisibleMarketCards(ctx).find((card) => {
      const nameEl = card.querySelector(SEL_LOCAL.cardName);
      return nameEl && normalizeText2(nameEl.textContent) === target;
    }) || getVisibleMarketCards(ctx).find((card) => {
      const nameEl = card.querySelector(SEL_LOCAL.cardName);
      return nameEl && normalizeText2(nameEl.textContent).includes(target);
    }) || null;
  };
  var findCardBuyButton = ({ dom }, card) => {
    if (!card) return null;
    return Array.from(card.querySelectorAll("button")).find(
      (btn) => normalizeText2(btn.textContent).includes("comprar") && dom.isInteractable(btn)
    ) || null;
  };
  var selectBatchShortcut = async ({ dom, sleep, randomDelay }, card, batchLabel) => {
    if (!card || !batchLabel) return;
    const target = normalizeText2(batchLabel).replace("\xD7", "x");
    const shortcutBtn = Array.from(card.querySelectorAll(SEL_LOCAL.cardShortcuts)).find((btn) => {
      const txt = normalizeText2(btn.textContent).replace("\xD7", "x");
      return txt === target && dom.isInteractable(btn);
    });
    if (shortcutBtn) {
      shortcutBtn.click();
      await sleep(randomDelay(120, 220));
    }
  };
  var ensureMarketTab = async ({ CONFIG, dom, sleep, randomDelay }, abaKey) => {
    const tab = dom.$(SEL_LOCAL.marketTab(abaKey));
    if (tab && !tab.classList.contains("on") && dom.isInteractable(tab)) {
      tab.click();
      await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
    }
  };
  var switchMarketCategory = async ({ CONFIG, dom, sleep, randomDelay }, categoryName) => {
    const target = normalizeText2(categoryName);
    const catBtn = dom.$$(SEL_LOCAL.categoryBtns).find((btn) => {
      if (!dom.isInteractable(btn)) return false;
      const txt = normalizeText2(btn.querySelector(SEL_LOCAL.categoryText)?.textContent || btn.textContent);
      return txt.startsWith(target) || txt === target;
    });
    if (catBtn && !catBtn.classList.contains("on")) {
      catBtn.click();
      await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
    }
  };
  var smartRestock = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, dom, sleep, randomDelay, withModalLock } = ctx;
    if (!CONFIG.restock.enabled && !force) return;
    const ballTier = dom.getTargetBallTier();
    const inv = dom.getInventorySnapshot();
    const toBuy = [];
    const currentTierBalls = inv.balls ? inv.balls[ballTier.chipIndex] : null;
    if (force || currentTierBalls !== null && currentTierBalls < CONFIG.restock.minBalls) {
      toBuy.push({
        itemName: ballTier.itemName,
        categoryName: "Pokebolas",
        targetAmount: CONFIG.restock.targetBalls
      });
    }
    if (CONFIG.restock.restockSmallPotion && (force || inv.smallPotions !== null && inv.smallPotions < CONFIG.restock.minPotions)) {
      toBuy.push({
        itemName: "Small Potion",
        categoryName: "Po\xE7\xF5es",
        targetAmount: CONFIG.restock.targetPotions
      });
    }
    if (CONFIG.restock.restockRevive && (force || inv.totalRevives !== null && inv.totalRevives < CONFIG.restock.minRevives)) {
      toBuy.push({
        itemName: "Revive",
        categoryName: "Revives",
        targetAmount: CONFIG.restock.targetRevives
      });
    }
    if (toBuy.length === 0) return;
    await withModalLock(
      "Restock",
      async () => {
        let openedByBot = false;
        try {
          if (!isMarketOpen(ctx)) {
            if (dom.getVisibleModal()) await dom.closeActiveModal();
            const marketBtn = dom.findMenuButtonByImg("menu-market") || dom.findClickableByText("Market");
            if (!marketBtn) return;
            marketBtn.click();
            openedByBot = true;
            const loaded = await dom.waitFor(() => isMarketOpen(ctx), 3500);
            if (!loaded) return;
            await sleep(randomDelay(CONFIG.delays.uiMinMs, CONFIG.delays.uiMaxMs));
          }
          await ensureMarketTab(ctx, "compra");
          for (const item of toBuy) {
            if (!state.running) break;
            let card = findMarketCard(ctx, item.itemName);
            if (!card) {
              await switchMarketCategory(ctx, item.categoryName);
              card = await dom.waitFor(() => findMarketCard(ctx, item.itemName), 2800);
            }
            if (!card) continue;
            for (let i = 0; i < CONFIG.restock.maxPurchases; i++) {
              if (!state.running) break;
              const currCard = findMarketCard(ctx, item.itemName);
              if (!currCard) break;
              const countBefore = parseNumber(currCard.querySelector(SEL_LOCAL.cardOwned)?.textContent);
              if (countBefore !== null && countBefore >= item.targetAmount) break;
              await selectBatchShortcut(ctx, currCard, CONFIG.restock.batchButton);
              const buyBtn = findCardBuyButton(ctx, currCard);
              if (!buyBtn) break;
              buyBtn.click();
              state.stats.purchases++;
              const countAfter = await dom.waitFor(() => {
                const upd = findMarketCard(ctx, item.itemName);
                const val = parseNumber(upd?.querySelector(SEL_LOCAL.cardOwned)?.textContent);
                return val !== null && countBefore !== null && val > countBefore ? val : null;
              }, CONFIG.restock.buyConfirmTimeoutMs, 100);
              if (countAfter === null) break;
              state.lastActionNote = `${item.itemName}: ${countAfter}`;
              await sleep(randomDelay(160, 280));
            }
          }
        } finally {
          if (openedByBot && CONFIG.restock.closeMarketAfter && state.running) {
            await dom.closeActiveModal();
          }
        }
      },
      { force }
    );
  };
  var restock = {
    id: "restock",
    everyMs: (ctx) => ctx.CONFIG.restock.checkIntervalMs,
    tick: (ctx) => smartRestock(ctx, { force: false }),
    run: smartRestock
  };

  // src/modules/capture.js
  var SEL_LOCAL2 = {
    ballOpts: "#auto-ball-opts",
    ballChip: ".auto-chip",
    chipQty: ".q",
    caidoWho: ".caido-quem"
  };
  var isShinyCaidoButton = (btn) => {
    if (!btn) return false;
    const cls = (btn.className || "").toLowerCase();
    const txt = btn.textContent || "";
    return cls.includes("shiny") || btn.dataset.shiny === "1" || btn.dataset.shiny === "true" || txt.includes("\u2728") || normalizeText2(txt).includes("shiny");
  };
  var ensureBestBallSelected = (ctx, targetBtn) => {
    const { CONFIG, dom } = ctx;
    const container = dom.$(SEL_LOCAL2.ballOpts);
    if (!container) return;
    const chips = Array.from(container.querySelectorAll(SEL_LOCAL2.ballChip));
    if (chips.length === 0) return;
    const counts = chips.map((c) => parseNumber(c.querySelector(SEL_LOCAL2.chipQty)?.textContent ?? c.textContent) ?? 0);
    const currentIdx = chips.findIndex((c) => c.classList.contains("on"));
    const isShiny = isShinyCaidoButton(targetBtn);
    let desiredIdx = currentIdx;
    if (isShiny) {
      for (const idx of [4, 3, 2, 1, 0]) {
        if (chips[idx] && counts[idx] > 0) {
          desiredIdx = idx;
          break;
        }
      }
    } else if (CONFIG.caidos.smartBallSelect) {
      const targetLv = parseNumber(targetBtn?.textContent) ?? dom.getCurrentHunt()?.targetLevel ?? 1;
      const order = targetLv >= CONFIG.caidos.highLevelUltraThreshold ? [3, 2, 1, 0] : [0, 1, 2, 3];
      for (const idx of order) {
        if (chips[idx] && counts[idx] > 0) {
          desiredIdx = idx;
          break;
        }
      }
    } else if (currentIdx === -1 || counts[currentIdx] <= 0) {
      const firstAvailable = counts.findIndex((n) => n > 0);
      if (firstAvailable !== -1) desiredIdx = firstAvailable;
    }
    if (desiredIdx !== -1 && desiredIdx !== currentIdx && chips[desiredIdx] && dom.isInteractable(chips[desiredIdx])) {
      chips[desiredIdx].click();
    }
  };
  var processCaidos = (ctx, container) => {
    const { CONFIG, state, dom, randomDelay, playBeep, updateHud } = ctx;
    if (!state.running || state.paused || !container) return;
    const allButtons = Array.from(container.querySelectorAll(CONFIG.caidos.buttonSelector)).filter(dom.isInteractable);
    const shinyButtons = allButtons.filter(isShinyCaidoButton);
    if (shinyButtons.length > 0) {
      state.shinyAlertActive = true;
      shinyButtons.forEach((b) => {
        const slot = b.dataset.slot || b.textContent;
        if (!state.shinyNotifiedSlots.has(slot)) {
          state.shinyNotifiedSlots.add(slot);
          state.stats.shiniesSpotted++;
          if (CONFIG.shinyGuard.soundAlert) playBeep(1180, 0.25);
          state.lastActionNote = `\u2728 SHINY DETECTADO: ${(b.querySelector(SEL_LOCAL2.caidoWho)?.textContent || "Alvo").trim()}`;
          updateHud();
        }
      });
    } else {
      state.shinyAlertActive = false;
    }
    if (!CONFIG.caidos.enabled) return;
    if (state.modalLockOwner && !(CONFIG.shinyGuard.enabled && shinyButtons.length > 0)) return;
    if (state.throwPending) return;
    const inv = dom.getInventorySnapshot();
    if (inv.totalBalls === 0) {
      smartRestock(ctx, { force: false });
      return;
    }
    const now = Date.now();
    const ordered = shinyButtons.length > 0 ? [...shinyButtons, ...allButtons] : allButtons;
    const nextBtn = ordered.find((btn) => {
      const lastTry = parseInt(btn.dataset.pbTriedAt || "0", 10);
      const retryMs = isShinyCaidoButton(btn) ? 1400 : CONFIG.caidos.retryAfterMs;
      return now - lastTry >= retryMs;
    });
    if (!nextBtn) return;
    const elapsed = now - state.lastThrowAt;
    const baseWait = Math.max(0, CONFIG.caidos.minThrowIntervalMs - elapsed);
    const jitter = randomDelay(CONFIG.delays.clickMinMs, CONFIG.delays.clickMaxMs);
    state.throwPending = true;
    setTimeout(() => {
      window.requestAnimationFrame(() => {
        state.throwPending = false;
        if (!state.running || state.paused) return;
        if (state.modalLockOwner && !isShinyCaidoButton(nextBtn)) return;
        if (dom.getInventorySnapshot().totalBalls === 0) {
          smartRestock(ctx, { force: false });
          return;
        }
        if (dom.isInteractable(nextBtn)) {
          ensureBestBallSelected(ctx, nextBtn);
          nextBtn.dataset.pbTriedAt = String(Date.now());
          state.lastThrowAt = Date.now();
          nextBtn.click();
          state.stats.caidosClicked++;
        }
        if (state.observedCaidosNode) {
          processCaidos(ctx, state.observedCaidosNode);
        }
      });
    }, baseWait + jitter);
  };
  var ensureCaidosObserver = (ctx) => {
    const { CONFIG, state, dom } = ctx;
    if (!state.running || state.paused) return;
    const targetNode = dom.$(CONFIG.caidos.containerSelector);
    if (targetNode !== state.observedCaidosNode) {
      if (state.caidosObserver) {
        state.caidosObserver.disconnect();
        state.caidosObserver = null;
        state.observedCaidosNode = null;
      }
      if (targetNode) {
        state.observedCaidosNode = targetNode;
        state.caidosObserver = new MutationObserver(() => processCaidos(ctx, targetNode));
        state.caidosObserver.observe(targetNode, { childList: true });
      }
    }
    if (state.observedCaidosNode) {
      processCaidos(ctx, state.observedCaidosNode);
    }
  };
  var capture = {
    id: "capture",
    everyMs: (ctx) => ctx.CONFIG.caidos.reattachIntervalMs,
    tick: (ctx) => ensureCaidosObserver(ctx),
    process: processCaidos,
    ensureObserver: ensureCaidosObserver,
    dispose: ({ state }) => {
      if (state.caidosObserver) {
        state.caidosObserver.disconnect();
        state.caidosObserver = null;
        state.observedCaidosNode = null;
      }
    }
  };

  // src/modules/depot.js
  var SEL_LOCAL3 = {
    bagBtn: "#btn-bolsa",
    pocket: (abaKey) => `.mochila-bolso[data-aba="${abaKey}"]`,
    bagBody: "#bolsa-corpo",
    sellInfo: ".mk-vt-info",
    sellAllBtn: ".mk-vender-tudo button.mk-acao",
    offerAll: "#ofr-tudo",
    offerAuto: "#ofr-auto",
    offerFast: "#ofr-rapida",
    offerSpin: "#ofr-girar",
    sacSelectAll: "#sac-todos",
    sacDo: "#sac-sacrificar",
    sacClaim: "#sac-resgatar"
  };
  var openBackpackPocket = async ({ dom, sleep, randomDelay }, abaKey) => {
    if (dom.getVisibleModal()) await dom.closeActiveModal();
    const bagBtn = dom.$(SEL_LOCAL3.bagBtn);
    if (!bagBtn || !dom.isInteractable(bagBtn)) return null;
    bagBtn.click();
    const bolsoBtn = await dom.waitFor(() => dom.$(SEL_LOCAL3.pocket(abaKey)), 3500);
    if (!bolsoBtn || !dom.isInteractable(bolsoBtn)) {
      await dom.closeActiveModal();
      return null;
    }
    bolsoBtn.click();
    await sleep(randomDelay(320, 480));
    return dom.$(SEL_LOCAL3.bagBody);
  };
  var runDepotManager = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, dom, sleep, randomDelay, withModalLock } = ctx;
    const mode = CONFIG.depot.mode;
    if (mode === "off") return;
    if (!force && Date.now() - state.lastDepotRunAt < CONFIG.depot.intervalMs) return;
    await withModalLock(
      `Depot:${mode}`,
      async () => {
        state.lastDepotRunAt = Date.now();
        try {
          if (mode === "venda") {
            if (dom.getVisibleModal()) await dom.closeActiveModal();
            const marketBtn = dom.findMenuButtonByImg("menu-market") || dom.findClickableByText("Market");
            if (!marketBtn) return;
            marketBtn.click();
            if (!await dom.waitFor(() => isMarketOpen(ctx), 3500)) return;
            await ensureMarketTab(ctx, "pokemons");
            await sleep(randomDelay(250, 400));
            const infoTxt = dom.$(SEL_LOCAL3.sellInfo)?.textContent || "";
            const countToSell = parseNumber(infoTxt.split("para vender")[0]);
            const sellAllBtn = dom.$(SEL_LOCAL3.sellAllBtn);
            if (sellAllBtn && dom.isInteractable(sellAllBtn) && (countToSell === null || countToSell > 0)) {
              sellAllBtn.click();
              await dom.confirmModalDialog(["confirmar", "vender", "sim"]);
              state.stats.depotRuns++;
              state.lastActionNote = `Depot vendido (${countToSell ?? "?"} pkm)`;
            } else {
              state.lastActionNote = "Depot sem Pok\xE9mon para vender";
            }
          } else if (mode === "oferenda") {
            const corpo = await openBackpackPocket(ctx, "oferenda");
            if (!corpo) return;
            const allBtn = dom.$(SEL_LOCAL3.offerAll);
            if (allBtn && dom.isInteractable(allBtn)) {
              allBtn.click();
              await dom.confirmModalDialog(["confirmar", "oferendar", "sim"]);
              state.stats.depotRuns++;
              state.lastActionNote = "Oferenda em lote executada";
            } else {
              const autoBtn = dom.$(SEL_LOCAL3.offerAuto);
              if (autoBtn && dom.isInteractable(autoBtn)) {
                autoBtn.click();
                await sleep(randomDelay(260, 400));
              }
              const fastBtn = dom.$(SEL_LOCAL3.offerFast) || dom.$(SEL_LOCAL3.offerSpin);
              if (fastBtn && dom.isInteractable(fastBtn)) {
                fastBtn.click();
                await dom.confirmModalDialog(["confirmar", "oferendar", "sim"]);
                state.stats.depotRuns++;
                state.lastActionNote = "Oferenda r\xE1pida executada";
              } else {
                state.lastActionNote = "Oferenda: sem Pok\xE9mon eleg\xEDveis";
              }
            }
          } else if (mode === "sacrificio") {
            const corpo = await openBackpackPocket(ctx, "sacrificio");
            if (!corpo) return;
            const selBtn = dom.$(SEL_LOCAL3.sacSelectAll);
            if (selBtn && dom.isInteractable(selBtn)) {
              selBtn.click();
              await sleep(randomDelay(260, 400));
            }
            const sacBtn = dom.$(SEL_LOCAL3.sacDo);
            if (sacBtn && dom.isInteractable(sacBtn)) {
              sacBtn.click();
              await dom.confirmModalDialog(["confirmar", "sacrificar", "sim"]);
              state.stats.depotRuns++;
              state.lastActionNote = "Sacrif\xEDcio conclu\xEDdo";
              await sleep(randomDelay(300, 450));
            }
            const native = dom.readNativeSessionPanel();
            const boostOn = Boolean(native?.boosts?.sacrificio);
            const claimBtn = dom.$(SEL_LOCAL3.sacClaim);
            if (claimBtn && dom.isInteractable(claimBtn) && (!boostOn || force)) {
              claimBtn.click();
              await dom.confirmModalDialog(["confirmar", "resgatar", "sim"]);
              state.lastActionNote = "Boost +20% XP resgatado!";
            }
          }
        } finally {
          await dom.closeActiveModal();
        }
      },
      { force }
    );
  };
  var depot = {
    id: "depot",
    everyMs: 6e4,
    tick: (ctx) => runDepotManager(ctx, { force: false }),
    run: runDepotManager
  };

  // src/modules/hatchery.js
  var EGG_PRIORITY_KEYWORDS = ["ovo shiny", "shiny", "p4", "p3", "p2", "mystery egg"];
  var SEL_LOCAL4 = {
    slotButtons: ".chc-slot button",
    release: "chc-liberar",
    // classe do botão "liberar" (nunca clicar)
    freeSlot: ".chc-slot.livre",
    slots: ".chc-slot"
  };
  var checkIncubator = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, dom, sleep, randomDelay, withModalLock } = ctx;
    if (!CONFIG.incubator.enabled && !force) return;
    if (!force && Date.now() < state.nextIncubatorCheckAt) return;
    await withModalLock(
      "Chocadeira",
      async () => {
        let hasActiveOrEgg = false;
        try {
          const corpo = await openBackpackPocket(ctx, "chocadeira");
          if (!corpo) return;
          const readyBtns = Array.from(corpo.querySelectorAll(SEL_LOCAL4.slotButtons)).filter((b) => {
            if (!dom.isInteractable(b) || b.classList.contains(SEL_LOCAL4.release)) return false;
            const t = normalizeText2(b.textContent);
            return t.includes("chocar") || t.includes("recolher") || t.includes("abrir") || t.includes("nascer");
          });
          for (const btn of readyBtns) {
            btn.click();
            state.stats.eggsHandled++;
            state.lastActionNote = "Ovo chocado!";
            hasActiveOrEgg = true;
            await sleep(randomDelay(400, 650));
          }
          const freeSlot = corpo.querySelector(SEL_LOCAL4.freeSlot);
          if (freeSlot) {
            const slotBtns = Array.from(freeSlot.querySelectorAll("button")).filter(
              (b) => dom.isInteractable(b) && !b.classList.contains(SEL_LOCAL4.release)
            );
            if (slotBtns.length > 0) {
              let chosenBtn = null;
              for (const kw of EGG_PRIORITY_KEYWORDS) {
                chosenBtn = slotBtns.find((b) => normalizeText2(b.textContent).includes(kw));
                if (chosenBtn) break;
              }
              chosenBtn = chosenBtn || slotBtns[0];
              chosenBtn.click();
              await dom.confirmModalDialog(["confirmar", "colocar", "incubar", "sim"]);
              state.stats.eggsHandled++;
              state.lastActionNote = `Ovo incubado: ${chosenBtn.textContent.trim().slice(0, 24)}`;
              hasActiveOrEgg = true;
            }
          }
          const occupied = Array.from(corpo.querySelectorAll(SEL_LOCAL4.slots)).some(
            (s) => !s.classList.contains("livre") && !s.classList.contains("trancado")
          );
          if (occupied) hasActiveOrEgg = true;
        } finally {
          state.nextIncubatorCheckAt = Date.now() + (hasActiveOrEgg ? CONFIG.incubator.activeIntervalMs : CONFIG.incubator.emptyBackoffMs);
          await dom.closeActiveModal();
        }
      },
      { force }
    );
  };
  var hatchery = {
    id: "hatchery",
    everyMs: 15e3,
    tick: (ctx) => checkIncubator(ctx, { force: false }),
    check: checkIncubator
  };

  // src/modules/boss-loot.js
  var SEL_LOCAL5 = {
    lootOk: "#boss-loot-ok",
    bossList: "#boss-lista",
    bossItems: 'button.boss-item:not([data-key="@raid"])',
    modalBody: "#modal-corpo",
    challengeBtn: "button.boss-desafiar",
    bossName: ".boss-nome"
  };
  var dismissBossLoot = ({ CONFIG, state, dom }) => {
    if (!state.running || !CONFIG.boss.autoDismissLoot) return;
    const okBtn = dom.$(SEL_LOCAL5.lootOk);
    if (okBtn && dom.isInteractable(okBtn)) {
      okBtn.click();
      state.lastActionNote = "Loot de Boss coletado!";
    }
  };
  var bossMatchesPriority = (detailEl, priority) => {
    if (priority === "qualquer") return true;
    const html = (detailEl?.innerHTML || "").toLowerCase();
    const txt = normalizeText2(detailEl?.textContent || "");
    if (priority === "mega") return html.includes("fragmento-mega") || txt.includes("mega");
    if (priority === "tm") return html.includes("tm_disk") || html.includes("zmove") || txt.includes("tm ");
    if (priority === "tickets") return html.includes("mystic-ticket") || html.includes("safari-ticket") || txt.includes("ticket");
    return true;
  };
  var checkBosses = async (ctx, { force = false } = {}) => {
    const { CONFIG, state, dom, sleep, randomDelay, withModalLock } = ctx;
    const prio = CONFIG.boss.priority;
    if (prio === "off" && !force) return;
    if (!force && Date.now() - state.lastBossCheckAt < CONFIG.boss.checkIntervalMs) return;
    await withModalLock(
      "Bosses",
      async () => {
        state.lastBossCheckAt = Date.now();
        let entered = false;
        try {
          if (dom.getVisibleModal()) await dom.closeActiveModal();
          const bossBtn = dom.findMenuButtonByImg("boss-cabeca") || dom.findMenuButtonByImg("menu-bosses");
          if (!bossBtn) return;
          bossBtn.click();
          const listEl = await dom.waitFor(() => dom.$(SEL_LOCAL5.bossList), 3500);
          if (!listEl) return;
          await sleep(randomDelay(240, 380));
          const items = Array.from(listEl.querySelectorAll(SEL_LOCAL5.bossItems)).filter(dom.isInteractable);
          for (const item of items) {
            if (!state.running) break;
            item.click();
            await sleep(randomDelay(220, 340));
            const modalBody = dom.$(SEL_LOCAL5.modalBody);
            const challengeBtn = modalBody?.querySelector(SEL_LOCAL5.challengeBtn);
            if (!challengeBtn || challengeBtn.disabled || !dom.isInteractable(challengeBtn)) continue;
            if (!bossMatchesPriority(modalBody, prio === "off" ? "qualquer" : prio)) continue;
            const bossName = modalBody.querySelector(SEL_LOCAL5.bossName)?.textContent?.trim() || "Boss";
            challengeBtn.click();
            await dom.confirmModalDialog(["desafiar", "entrar", "confirmar", "sim"]);
            state.stats.bossEntries++;
            state.lastActionNote = `Entrou no Boss: ${bossName}`;
            entered = true;
            break;
          }
          if (!entered) {
            state.lastActionNote = `Bosses (${prio}): nenhum dispon\xEDvel agora`;
          }
        } finally {
          if (!entered) await dom.closeActiveModal();
        }
      },
      { force }
    );
  };
  var bosses = {
    id: "bosses",
    everyMs: 6e4,
    tick: (ctx) => checkBosses(ctx, { force: false }),
    check: checkBosses
  };
  var bossLoot = {
    id: "bossLoot",
    everyMs: 3e3,
    tick: (ctx) => dismissBossLoot(ctx),
    dismiss: dismissBossLoot
  };

  // src/modules/map-benchmark.js
  var SEL_LOCAL6 = {
    mapBar: ".mapa-barra",
    mapWorld: ".mapa-mundi",
    viewModeButtons: ".mapa-modo button.mapa-modo-bt",
    regionTabsUnlocked: "button.mapa-reg-bt:not(.mapa-area-travada)",
    markersUnlocked: "button.marcador:not(.travado)",
    checkbox: 'input[type="checkbox"]',
    checkboxHolder: "label, div"
  };
  var computeMaxAreaLevel = (trainerLevel, pokeLevel, maxLevelAbovePokemon) => Math.min(trainerLevel ?? pokeLevel, pokeLevel + maxLevelAbovePokemon);
  var sortCandidates = (candidates, ascending = false) => candidates.sort((a, b) => ascending ? a.areaLevel - b.areaLevel : b.areaLevel - a.areaLevel);
  var isTravelConfirmText = (text) => {
    const t = normalizeText2(text);
    return t === "ir" || t.includes("viajar") || t.includes("cacar") || t.includes("entrar");
  };
  var getMarkerSignature = (btn, regionName) => {
    const left = btn.style.left || "";
    const top = btn.style.top || "";
    const title = btn.getAttribute("title") || btn.getAttribute("aria-label") || "";
    const level = parseNumber(btn.textContent) ?? 0;
    return `${regionName}::${level}::${left},${top}::${title}`;
  };
  var isMapModalOpen = ({ dom }) => {
    const modal = dom.getVisibleModal();
    return Boolean(modal && modal.querySelector(SEL_LOCAL6.mapBar));
  };
  var openMapModal = async (ctx) => {
    const { dom, sleep, randomDelay } = ctx;
    if (isMapModalOpen(ctx)) return dom.getVisibleModal();
    if (dom.getVisibleModal()) await dom.closeActiveModal();
    const mapBtn = dom.findMenuButtonByImg("menu-mapa") || dom.findClickableByText("Mapa");
    if (!mapBtn) return null;
    mapBtn.click();
    const modal = await dom.waitFor(() => isMapModalOpen(ctx) ? dom.getVisibleModal() : null, 3800);
    if (modal) await sleep(randomDelay(240, 380));
    return modal;
  };
  var ensureMapViewMode = async ({ dom, sleep, randomDelay }, modal, modeLabel = "MAPA") => {
    const btns = Array.from(modal.querySelectorAll(SEL_LOCAL6.viewModeButtons));
    const target = btns.find((b) => normalizeText2(b.textContent) === normalizeText2(modeLabel));
    if (target && !target.classList.contains("on") && dom.isInteractable(target)) {
      target.click();
      await sleep(randomDelay(200, 340));
    }
  };
  var applyMapFilters = async ({ dom, sleep }, modal, { pokemonTypes = [], useTypeAdvantage = true, onlyUnlocked = true, pokedexFilter = null } = {}) => {
    const bar = modal.querySelector(SEL_LOCAL6.mapBar);
    if (!bar) return;
    const tipoTrigger = Array.from(bar.querySelectorAll("button")).find(
      (b) => normalizeText2(b.textContent).startsWith("tipo")
    );
    if (tipoTrigger && dom.isInteractable(tipoTrigger)) {
      const ensureTipoOpen = async () => {
        if (!dom.findClickableByText("todos os tipos", modal, true)) {
          tipoTrigger.click();
          await dom.waitFor(() => dom.findClickableByText("todos os tipos", modal, true), 1400);
          await sleep(120);
        }
      };
      await ensureTipoOpen();
      const resetBtn = dom.findClickableByText("todos os tipos", modal, true);
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
        const weakBtn = dom.findClickableByText("Fraco contra", modal, true);
        if (weakBtn) {
          weakBtn.click();
          await sleep(150);
        }
      }
      if (dom.findClickableByText("todos os tipos", modal, true)) {
        tipoTrigger.click();
        await sleep(120);
      }
    }
    const dexTrigger = Array.from(bar.querySelectorAll("button")).find(
      (b) => normalizeText2(b.textContent).startsWith("pokedex")
    );
    if (dexTrigger && dom.isInteractable(dexTrigger)) {
      const desiredLabel = pokedexFilter || "Todos";
      if (!normalizeText2(dexTrigger.textContent).includes(normalizeText2(desiredLabel))) {
        dexTrigger.click();
        const option = await dom.waitFor(
          () => dom.findClickableByText(desiredLabel, modal, desiredLabel === "Todos"),
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
      const nivelTrigger = Array.from(bar.querySelectorAll("button")).find(
        (b) => normalizeText2(b.textContent).startsWith("nivel")
      );
      if (nivelTrigger && dom.isInteractable(nivelTrigger)) {
        const findUnlockedCb = () => Array.from(modal.querySelectorAll(SEL_LOCAL6.checkbox)).find((cb2) => {
          const parentTxt = normalizeText2(cb2.closest(SEL_LOCAL6.checkboxHolder)?.textContent);
          return parentTxt.includes("liberadas") && dom.isVisible(cb2);
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
  var selectMapRegionTab = async ({ dom, sleep, randomDelay }, modal, regionName) => {
    const regBtn = Array.from(modal.querySelectorAll(SEL_LOCAL6.regionTabsUnlocked)).find(
      (b) => normalizeText2(b.textContent).startsWith(normalizeText2(regionName))
    );
    if (!regBtn) return false;
    if (!regBtn.classList.contains("on")) {
      regBtn.click();
      await sleep(randomDelay(220, 340));
    }
    return true;
  };
  var collectCandidatesFromOpenMap = async (ctx, modal, poke, useTypeAdvantage, pokedexFilter, ascending = false) => {
    const { CONFIG, dom, sleep, randomDelay } = ctx;
    await ensureMapViewMode(ctx, modal, "MAPA");
    await applyMapFilters(ctx, modal, {
      pokemonTypes: poke?.types || [],
      useTypeAdvantage,
      onlyUnlocked: CONFIG.map.onlyUnlocked,
      pokedexFilter
    });
    const unlockedRegions = Array.from(modal.querySelectorAll(SEL_LOCAL6.regionTabsUnlocked));
    const candidates = [];
    const pokeLevel = poke?.level ?? 1;
    const trainerLevel = dom.getTrainerHeaderInfo().level ?? pokeLevel;
    const maxLevel = computeMaxAreaLevel(trainerLevel, pokeLevel, CONFIG.map.maxLevelAbovePokemon);
    for (const regBtn of unlockedRegions) {
      const regionName = (regBtn.textContent || "").split("\n")[0].trim();
      if (!regBtn.classList.contains("on")) {
        regBtn.click();
        await sleep(randomDelay(220, 340));
      }
      const markers = Array.from(modal.querySelectorAll(SEL_LOCAL6.markersUnlocked)).filter(dom.isInteractable);
      markers.forEach((btn, idx) => {
        const areaLevel = parseNumber(btn.textContent) ?? 1;
        if (areaLevel > maxLevel) return;
        candidates.push({
          regionName,
          areaLevel,
          title: btn.getAttribute("title") || btn.getAttribute("aria-label") || "",
          indexInRegion: idx,
          signature: getMarkerSignature(btn, regionName),
          isCurrent: btn.classList.contains("on")
        });
      });
    }
    return sortCandidates(candidates, ascending);
  };
  var waitForAreaSwitchCooldown = async ({ CONFIG, state, updateHud, sleep }) => {
    const remaining = CONFIG.map.switchCooldownMs - (Date.now() - state.lastAreaSwitchAt);
    if (remaining > 0) {
      state.lastActionNote = `Trava de \xE1rea (${(remaining / 1e3).toFixed(1)}s)`;
      updateHud();
      await sleep(remaining);
    }
  };
  var travelToMarkerMeta = async (ctx, meta) => {
    const { CONFIG, state, dom, sleep, randomDelay } = ctx;
    if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return false;
    await waitForAreaSwitchCooldown(ctx);
    if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return false;
    const modal = await openMapModal(ctx);
    if (!modal) return false;
    await ensureMapViewMode(ctx, modal, "MAPA");
    await applyMapFilters(ctx, modal, {
      pokemonTypes: [],
      useTypeAdvantage: false,
      onlyUnlocked: CONFIG.map.onlyUnlocked,
      pokedexFilter: null
    });
    const switched = await selectMapRegionTab(ctx, modal, meta.regionName);
    if (!switched) {
      await dom.closeActiveModal();
      return false;
    }
    const markers = Array.from(modal.querySelectorAll(SEL_LOCAL6.markersUnlocked)).filter(dom.isInteractable);
    let targetBtn = markers.find((b) => getMarkerSignature(b, meta.regionName) === meta.signature);
    if (!targetBtn && markers[meta.indexInRegion]) targetBtn = markers[meta.indexInRegion];
    if (!targetBtn) {
      await dom.closeActiveModal();
      return false;
    }
    if (targetBtn.classList.contains("on")) {
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
        const confirmBtn = dom.$(SEL.confirmarSim) || Array.from(activeModal.querySelectorAll("button")).find((b) => {
          if (!dom.isInteractable(b) || b.closest(SEL_LOCAL6.mapBar) || b.closest(SEL_LOCAL6.mapWorld)) return false;
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
  var saveHuntQueueState = ({ CONFIG, state, storage, keys }) => {
    storage.saveJson(keys.huntQueue, {
      mode: CONFIG.mode,
      updatedAt: Date.now(),
      index: state.huntQueueIndex,
      items: state.huntQueue
    });
  };

  // src/modules/hunt-queue.js
  var SEL_LOCAL7 = {
    manualQueueBox: "#pb-manual-queue"
  };
  var normalizeQueueList = (list, mode) => list.map(
    (entry) => typeof entry === "string" ? parseQueueEntry(entry, mode) : { ...entry, name: String(entry?.name || "").trim() }
  ).filter((x) => x.name.length > 0);
  var findQueueMatch = (entry, candidates) => {
    if (entry.markerMeta) return entry.markerMeta;
    const needle = normalizeText2(entry.regionName || entry.name);
    if (!needle) return null;
    const byName = candidates.filter((c) => {
      const region = normalizeText2(c.regionName);
      const title = normalizeText2(c.title);
      return region && (region.includes(needle) || needle.includes(region)) || title && title.includes(needle);
    });
    return entry.level && byName.find((c) => c.areaLevel === entry.level) || byName[0] || null;
  };
  var pickSafeFallback = (entry, candidates, poke) => {
    const pokeLevel = poke?.level ?? null;
    const pool = candidates.filter((c) => !c.isCurrent && (pokeLevel === null || c.areaLevel <= pokeLevel));
    if (pool.length === 0) return null;
    return entry?.level && pool.find((c) => c.areaLevel === entry.level) || pool[0];
  };
  var definirFilaHunt = (ctx, list) => {
    const { CONFIG, state, updateHud } = ctx;
    if (!Array.isArray(list)) return [];
    state.huntQueue = normalizeQueueList(list, CONFIG.mode);
    state.huntQueueIndex = 0;
    saveHuntQueueState(ctx);
    state.lastActionNote = `Fila /hunt: ${state.huntQueue.length} \xE1reas`;
    updateHud();
    return state.huntQueue;
  };
  var loadManualQueue = async (ctx, irAgora = false) => {
    const { CONFIG, state, updateHud } = ctx;
    const raw = state.hudEl?.querySelector(SEL_LOCAL7.manualQueueBox)?.value || "";
    const entries = parseQueueText(raw, CONFIG.mode);
    if (entries.length === 0) {
      if (irAgora && state.huntQueue.length > 0) {
        return irProximaHuntGuia(ctx, true);
      }
      state.lastActionNote = "Cole ao menos 1 \xE1rea v\xE1lida";
      updateHud();
      return false;
    }
    definirFilaHunt(ctx, entries);
    state.lastActionNote = `Fila /hunt: ${state.huntQueue.length} itens (pr\xF3x: ${state.huntQueue[0].name})`;
    updateHud();
    if (irAgora) {
      return irProximaHuntGuia(ctx, true);
    }
    return true;
  };
  var limparFilaHunt = (ctx) => {
    const { state, updateHud } = ctx;
    state.huntQueue = [];
    state.huntQueueIndex = 0;
    saveHuntQueueState(ctx);
    state.lastActionNote = "Fila /hunt limpa";
    updateHud();
  };
  var buildHuntQueueItems = async (ctx) => {
    const { CONFIG, dom } = ctx;
    let items = [];
    if (items.length === 0) {
      const poke = dom.getActivePokemon();
      const modal = await openMapModal(ctx);
      if (modal) {
        const candidates = await collectCandidatesFromOpenMap(
          ctx,
          modal,
          poke,
          CONFIG.map.preferTypeAdvantage,
          CONFIG.mode === "topcatch" ? "Top Catch" : null,
          CONFIG.mode === "topcatch"
        );
        await dom.closeActiveModal();
        items = candidates.slice(0, 8).map((c) => ({
          name: c.regionName,
          regionName: c.regionName,
          areaLevel: c.areaLevel,
          markerMeta: c,
          mode: CONFIG.mode
        }));
      }
    }
    return items;
  };
  var adoptHuntQueue = (ctx, items) => {
    const { state } = ctx;
    state.huntQueue = items;
    state.huntQueueIndex = 0;
    saveHuntQueueState(ctx);
    state.lastActionNote = `Fila /hunt pronta (${items.length} \xE1reas)`;
  };
  var syncHuntGuideQueue = async (ctx, force = false) => {
    const { state, withModalLock } = ctx;
    return withModalLock(
      "Montando fila",
      async () => {
        const items = await buildHuntQueueItems(ctx);
        if (items.length > 0) {
          adoptHuntQueue(ctx, items);
        } else if (!state.lastActionNote.startsWith("Guia /hunt:")) {
          state.lastActionNote = "Nenhuma \xE1rea encontrada para a fila";
        }
        return state.huntQueue;
      },
      { force }
    );
  };
  var irProximaHuntGuia = async (ctx, force = false) => {
    const { CONFIG, state, dom, withModalLock } = ctx;
    return withModalLock(
      "Fila /hunt",
      async () => {
        if (state.huntQueue.length === 0) {
          const built = await buildHuntQueueItems(ctx);
          if (built.length > 0) adoptHuntQueue(ctx, built);
        }
        if (state.huntQueue.length === 0) {
          state.lastActionNote = "Fila /hunt vazia";
          return false;
        }
        const poke = dom.getActivePokemon();
        const modal = await openMapModal(ctx);
        if (!modal) return false;
        const liveCandidates = await collectCandidatesFromOpenMap(
          ctx,
          modal,
          poke,
          false,
          null,
          CONFIG.mode === "topcatch"
        );
        await dom.closeActiveModal();
        for (let attempt = 0; attempt < state.huntQueue.length; attempt++) {
          const idx = (state.huntQueueIndex + attempt) % state.huntQueue.length;
          const entry = state.huntQueue[idx];
          const matchedMeta = findQueueMatch(entry, liveCandidates);
          if (!matchedMeta) continue;
          state.huntQueueIndex = (idx + 1) % state.huntQueue.length;
          saveHuntQueueState(ctx);
          state.lastActionNote = `Fila -> ${matchedMeta.regionName} Nv${matchedMeta.areaLevel}`;
          const ok = await travelToMarkerMeta(ctx, matchedMeta);
          if (ok) {
            state.session = createSession(ctx, dom.getCurrentHunt(), dom.getActivePokemon(), matchedMeta);
            return true;
          }
        }
        if (CONFIG.huntQueue.fallbackToSafeArea) {
          const entry = state.huntQueue[state.huntQueueIndex % state.huntQueue.length];
          const fallback = pickSafeFallback(entry, liveCandidates, poke);
          if (fallback) {
            state.huntQueueIndex = (state.huntQueueIndex + 1) % state.huntQueue.length;
            saveHuntQueueState(ctx);
            state.lastActionNote = `Fila sem match (${entry.name}) -> fallback ${fallback.regionName} Nv${fallback.areaLevel}`;
            const ok = await travelToMarkerMeta(ctx, fallback);
            if (ok) {
              state.session = createSession(ctx, dom.getCurrentHunt(), dom.getActivePokemon(), fallback);
              return true;
            }
          }
        }
        state.lastActionNote = "Fila /hunt: sem \xE1rea eleg\xEDvel agora";
        return false;
      },
      { force }
    );
  };
  var huntQueue = {
    id: "huntQueue",
    definirFilaHunt,
    loadManualQueue,
    limparFilaHunt,
    syncHuntGuideQueue,
    irProximaHuntGuia
  };

  // src/modules/map-hop-optimize.js
  var shouldAbortWarmup = (livePoke, preWarm, nowSnap, hpThreshold) => livePoke?.hpPercent !== null && livePoke.hpPercent < hpThreshold || Boolean(preWarm && nowSnap && nowSnap.revivesUsados > preWarm.revivesUsados);
  var warmupDone = (preWarm, nowSnap) => Boolean(preWarm && nowSnap && nowSnap.abates > preWarm.abates);
  var shouldAbortMeasure = (livePoke, metrics, hpThreshold) => livePoke?.hpPercent !== null && livePoke.hpPercent < hpThreshold || metrics.revivesMin > 0;
  var buildBenchmarkResult = (metrics, { aborted, cand, modo }) => {
    const isSafe = !aborted && metrics.segura && metrics.abates > 0;
    return {
      ...metrics,
      segura: isSafe,
      markerMeta: cand,
      score: Math.round(scoreRecord({ ...metrics, segura: isSafe }, modo))
    };
  };
  var rankResults = (results) => [...results].sort((a, b) => b.score - a.score);
  var trainerLevelReached = (trainerLv, lastOptimizedLv, levelStep) => trainerLv !== null && lastOptimizedLv !== null && trainerLv >= lastOptimizedLv + levelStep;
  var sessionIsDangerous = (metrics, maxPotionsPerMinSafe) => metrics.abates >= 3 && (metrics.revivesMin > 0 || metrics.pocoesMin > maxPotionsPerMinSafe);
  var hopNextTopCatchArea = async (ctx, force = false) => {
    const { state, dom, withModalLock } = ctx;
    return withModalLock(
      "TopCatch Hop",
      async () => {
        const poke = dom.getActivePokemon();
        const modal = await openMapModal(ctx);
        if (!modal) return false;
        let candidates = await collectCandidatesFromOpenMap(ctx, modal, poke, false, "Top Catch", true);
        candidates = candidates.filter((c) => !c.isCurrent);
        await dom.closeActiveModal();
        if (candidates.length === 0) {
          state.lastActionNote = "Top Catch: todas as \xE1reas liberadas capturadas!";
          return false;
        }
        const nextArea = candidates[0];
        state.lastActionNote = `Top Catch -> ${nextArea.regionName} Nv${nextArea.areaLevel}`;
        const ok = await travelToMarkerMeta(ctx, nextArea);
        if (ok) {
          state.session = createSession(ctx, dom.getCurrentHunt(), dom.getActivePokemon(), nextArea);
        }
        return ok;
      },
      { force }
    );
  };
  var otimizarRegiao = async (ctx, options = {}) => {
    const { CONFIG, state, dom, sleep, updateHud, withModalLock } = ctx;
    const {
      modo = CONFIG.mode,
      tempoPorRegiaoSeg = CONFIG.map.benchmarkSecPerArea,
      maxRegioes = CONFIG.map.maxAreasToTest,
      usarVantagemTipo = CONFIG.map.preferTypeAdvantage,
      force = false
    } = options;
    return withModalLock(
      "Otimizando",
      async () => {
        state.lastOptimizeAt = Date.now();
        const poke = dom.getActivePokemon();
        const trainerLv = dom.getTrainerHeaderInfo().level;
        if (trainerLv !== null) state.lastOptimizedTrainerLevel = trainerLv;
        const dexFilter = modo === "topcatch" ? "Top Catch" : null;
        const modal = await openMapModal(ctx);
        if (!modal) return null;
        let candidates = await collectCandidatesFromOpenMap(
          ctx,
          modal,
          poke,
          usarVantagemTipo,
          dexFilter,
          modo === "topcatch"
        );
        if (candidates.length === 0 && usarVantagemTipo) {
          candidates = await collectCandidatesFromOpenMap(ctx, modal, poke, false, dexFilter, modo === "topcatch");
        }
        if (candidates.length === 0 && dexFilter) {
          candidates = await collectCandidatesFromOpenMap(ctx, modal, poke, false, null, false);
        }
        await dom.closeActiveModal();
        if (candidates.length === 0) return null;
        const toTest = candidates.slice(0, maxRegioes);
        const results = [];
        for (let i = 0; i < toTest.length; i++) {
          if (!state.running || state.paused && !force) break;
          if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) {
            state.lastActionNote = "Benchmark pausado: Shiny em campo!";
            return null;
          }
          const cand = toTest[i];
          state.lastActionNote = `Testando ${i + 1}/${toTest.length} (${cand.regionName} Nv${cand.areaLevel})`;
          updateHud();
          const ok = await travelToMarkerMeta(ctx, cand);
          if (!ok) continue;
          const preWarm = dom.readNativeSessionPanel();
          let aborted = false;
          const warmupEnd = Date.now() + CONFIG.map.warmupMaxSec * 1e3;
          while (Date.now() < warmupEnd && state.running) {
            await sleep(450);
            if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return null;
            const livePoke = dom.getActivePokemon();
            const nowSnap = dom.readNativeSessionPanel();
            if (shouldAbortWarmup(livePoke, preWarm, nowSnap, CONFIG.map.abortHpThreshold)) {
              aborted = true;
              break;
            }
            if (warmupDone(preWarm, nowSnap)) break;
          }
          state.session = createSession(ctx, dom.getCurrentHunt(), dom.getActivePokemon(), cand);
          if (!aborted && state.running) {
            const measureEnd = Date.now() + tempoPorRegiaoSeg * 1e3;
            while (Date.now() < measureEnd && state.running) {
              await sleep(1e3);
              if (CONFIG.shinyGuard.enabled && state.shinyAlertActive) return null;
              updateFarmTelemetry(ctx);
              updateHud();
              const livePoke = dom.getActivePokemon();
              const m = computeSessionMetrics(ctx, state.session);
              if (shouldAbortMeasure(livePoke, m, CONFIG.map.abortHpThreshold)) {
                aborted = true;
                break;
              }
            }
          }
          const saved = persistCurrentSession(ctx, true);
          const metrics = saved || computeSessionMetrics(ctx, state.session);
          results.push(buildBenchmarkResult(metrics, { aborted, cand, modo }));
        }
        if (results.length === 0) return null;
        const ranked = rankResults(results);
        console.table(
          ranked.map((r) => ({
            regiao: r.regiao,
            abatesMin: r.abatesMin,
            xpPokeMin: r.xpPokeMin,
            lucroLiqMin: r.lucroLiqMin,
            pocoesMin: r.pocoesMin,
            segura: r.segura,
            score: r.score
          }))
        );
        const winner = ranked[0];
        await travelToMarkerMeta(ctx, winner.markerMeta);
        state.session = createSession(ctx, dom.getCurrentHunt(), dom.getActivePokemon(), winner.markerMeta);
        state.lastActionNote = `Melhor (${modo}): ${winner.regiao}`;
        return winner;
      },
      { force }
    );
  };
  var changeArea = async (ctx) => {
    if (ctx.state.huntQueue.length > 0) {
      await irProximaHuntGuia(ctx, false);
    } else {
      await otimizarRegiao(ctx, { modo: ctx.CONFIG.mode });
    }
  };
  var checkAutoRegionProgression = async (ctx) => {
    const { CONFIG, state, dom } = ctx;
    if (!state.running || state.paused || !CONFIG.autoRegion.enabled) return;
    if (state.modalLockOwner || dom.isInSpecialArena() || dom.getVisibleModal() || state.shinyAlertActive) return;
    const { level: trainerLv } = dom.getTrainerHeaderInfo();
    if (trainerLv !== null && state.lastOptimizedTrainerLevel === null) {
      state.lastOptimizedTrainerLevel = trainerLv;
    }
    if (Date.now() - state.lastOptimizeAt < CONFIG.autoRegion.minIntervalMs) return;
    if (trainerLevelReached(trainerLv, state.lastOptimizedTrainerLevel, CONFIG.autoRegion.levelStep)) {
      await changeArea(ctx);
      return;
    }
    if (state.session && dom.getCurrentHunt()) {
      const m = computeSessionMetrics(ctx, state.session);
      if (sessionIsDangerous(m, CONFIG.farm.maxPotionsPerMinSafe)) {
        await changeArea(ctx);
      }
    }
  };
  var mapHop = {
    id: "mapHop",
    everyMs: (ctx) => ctx.CONFIG.autoRegion.checkIntervalMs,
    tick: (ctx) => checkAutoRegionProgression(ctx),
    hopNextTopCatchArea,
    otimizarRegiao,
    checkAutoRegionProgression
  };

  // src/modules/telemetry.js
  var SEL_LOCAL8 = {
    hudLog: "#hud-log",
    avisoVersao: "#aviso-versao"
  };
  var ELEMENT_NODE = 1;
  var computeMetrics = (s, farm, now = Date.now()) => {
    const elapsedSec = Math.max(1, Math.floor((now - s.startedAt) / 1e3));
    const minutes = elapsedSec / 60;
    const a = s.startSnap;
    const b = s.latestSnap || a;
    const useNative = Boolean(a && b);
    const dKills = useNative ? Math.max(0, b.abates - a.abates) : s.logKills;
    const dXpPoke = useNative ? Math.max(0, b.xpPokemon - a.xpPokemon) : s.logXpPoke;
    const dGold = useNative ? Math.max(0, b.gold - a.gold) : s.logGold;
    const dLucro = useNative ? b.lucro - a.lucro : s.logGold;
    const dPotions = useNative ? Math.max(0, b.pocoesUsadas - a.pocoesUsadas) : 0;
    const dRevives = useNative ? Math.max(0, b.revivesUsados - a.revivesUsados) : 0;
    const killsPerMin = +(dKills / minutes).toFixed(2);
    const xpPokePerMin = Math.round(dXpPoke / minutes);
    const goldGrossPerMin = Math.round(dGold / minutes);
    const lucroPerMin = Math.round(dLucro / minutes);
    const potionsPerMin = +(dPotions / minutes).toFixed(2);
    const revivesPerMin = +(dRevives / minutes).toFixed(2);
    const safe = revivesPerMin === 0 && potionsPerMin <= farm.maxPotionsPerMinSafe && s.minHpPercent >= farm.minHpPercentSafe;
    return {
      regiao: s.regionKey,
      pokemon: `${s.pokemonName} Nv${s.pokemonLevel ?? "?"}`,
      tempoSeg: elapsedSec,
      abates: dKills,
      abatesMin: killsPerMin,
      xpPokeMin: xpPokePerMin,
      ouroBrutoMin: goldGrossPerMin,
      lucroLiqMin: lucroPerMin,
      pocoesMin: potionsPerMin,
      revivesMin: revivesPerMin,
      minHpPct: s.minHpPercent,
      segura: safe
    };
  };
  var scoreRecord = (r, modo) => {
    const safetyWeight = r.segura ? 1 : 0.25;
    if (modo === "xp") return r.xpPokeMin * safetyWeight;
    if (modo === "ouro") return Math.max(0, r.lucroLiqMin) * safetyWeight;
    if (modo === "topcatch") return (r.abatesMin * 100 + r.xpPokeMin * 0.2) * safetyWeight;
    return (r.xpPokeMin * 0.65 + Math.max(0, r.lucroLiqMin) * 0.35) * safetyWeight;
  };
  var shouldSaveMetrics = (metrics, farm, forceSave = false) => forceSave || !(metrics.tempoSeg < farm.minSampleSec || metrics.abates < farm.minKillsToSave);
  var trackCounter = (last, current) => ({
    next: current,
    delta: last === null ? 0 : Math.max(0, current - last)
  });
  var planSessionStep = (session, hunt, poke) => {
    if (!session) return "create";
    if (hunt && hunt.key !== session.regionKey) return "rotate";
    if (poke && poke.name !== session.pokemonName) return "rotate";
    return "update";
  };
  var updateSessionReadings = (session, poke, snap, now = Date.now()) => {
    if (poke) {
      session.pokemonLevel = poke.level;
      if (poke.hpPercent !== null && poke.hpPercent < session.minHpPercent) {
        session.minHpPercent = poke.hpPercent;
      }
    }
    if (snap) {
      if (session.startSnap && snap.abates < session.startSnap.abates) {
        session.startSnap = snap;
        session.startedAt = now;
      }
      if (!session.startSnap) session.startSnap = snap;
      session.latestSnap = snap;
    }
  };
  var shouldTopCatchHop = (topCatchHop, state, now = Date.now()) => Boolean(
    topCatchHop.enabled && !state.modalLockOwner && !state.shinyAlertActive && now - state.lastHopAt >= topCatchHop.hopCooldownMs
  );
  var parseCombatLogText = (txt) => {
    if (txt.includes("derrotado!")) {
      const xpMatch = txt.match(/\+([\d.]+)\s*xp\s*pok[eé]mon/i);
      const goldMatch = txt.match(/\+([\d.]+)\s*ouro/i);
      return {
        kind: "kill",
        xp: xpMatch ? parseNumber(xpMatch[1]) ?? 0 : 0,
        gold: goldMatch ? parseNumber(goldMatch[1]) ?? 0 : 0
      };
    }
    if (normalizeText2(txt).includes("capturado")) return { kind: "capture" };
    return null;
  };
  var createSession = (ctx, hunt, pokemon, markerMeta = null) => ({
    regionKey: hunt ? hunt.key : "Centro / Fora",
    targetName: hunt ? hunt.targetName : "Nenhum",
    targetLevel: hunt ? hunt.targetLevel : null,
    markerMeta,
    pokemonName: pokemon ? pokemon.name : "Desconhecido",
    pokemonLevel: pokemon ? pokemon.level : null,
    pokemonTypes: pokemon ? pokemon.types : [],
    startedAt: Date.now(),
    startSnap: ctx.dom.readNativeSessionPanel(),
    latestSnap: ctx.dom.readNativeSessionPanel(),
    logKills: 0,
    logXpPoke: 0,
    logGold: 0,
    minHpPercent: pokemon?.hpPercent ?? 100
  });
  var handleCombatLogNode = ({ state }, node) => {
    if (!state.running || !state.session || node.nodeType !== ELEMENT_NODE) return;
    const parsed = parseCombatLogText(node.textContent || "");
    if (!parsed) return;
    if (parsed.kind === "kill") {
      state.session.logKills++;
      state.session.logXpPoke += parsed.xp;
      state.session.logGold += parsed.gold;
    } else {
      state.stats.captures++;
    }
  };
  var ensureCombatLogObserver = (ctx) => {
    const { state, dom } = ctx;
    const logNode = dom.$(SEL_LOCAL8.hudLog);
    if (logNode === state.observedLogNode) return;
    if (state.logObserver) {
      state.logObserver.disconnect();
      state.logObserver = null;
      state.observedLogNode = null;
    }
    if (logNode) {
      state.observedLogNode = logNode;
      state.logObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const added of m.addedNodes) {
            handleCombatLogNode(ctx, added);
          }
        }
      });
      state.logObserver.observe(logNode, { childList: true });
    }
  };
  var computeSessionMetrics = ({ CONFIG }, s, now = Date.now()) => computeMetrics(s, CONFIG.farm, now);
  var persistCurrentSession = (ctx, forceSave = false) => {
    const { CONFIG, state, storage, keys } = ctx;
    const s = state.session;
    if (!s || !s.regionKey || s.regionKey === "Centro / Fora") return null;
    const metrics = computeSessionMetrics(ctx, s);
    if (!shouldSaveMetrics(metrics, CONFIG.farm, forceSave)) return null;
    const recordKey = `${s.pokemonName}__${s.regionKey}`;
    const prev = state.history[recordKey];
    const record = {
      ...metrics,
      pokemonName: s.pokemonName,
      pokemonLevel: s.pokemonLevel,
      targetLevel: s.targetLevel,
      markerMeta: s.markerMeta || prev?.markerMeta || null,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    state.history[recordKey] = record;
    storage.saveJson(keys.history, state.history);
    return record;
  };
  var checkVersionAlert = ({ state, dom, setStatus, playBeep }) => {
    const aviso = dom.$(SEL_LOCAL8.avisoVersao);
    if (aviso && dom.isVisible(aviso) && !state.paused) {
      state.paused = true;
      setStatus("Atualiza\xE7\xE3o!", "Nova vers\xE3o detectada \u2014 recarregue o jogo");
      playBeep(520, 0.25);
    }
  };
  var updateFarmTelemetry = (ctx) => {
    const { CONFIG, state, dom, playBeep } = ctx;
    if (!state.running || !CONFIG.farm.enabled) return;
    ensureCombatLogObserver(ctx);
    checkVersionAlert(ctx);
    const hunt = dom.getCurrentHunt();
    const poke = dom.getActivePokemon();
    const snap = dom.readNativeSessionPanel();
    if (snap) {
      const shiny = trackCounter(state.lastShiniesVistos, snap.shiniesVistos);
      if (shiny.delta > 0) {
        state.stats.shiniesSpotted++;
        if (CONFIG.shinyGuard.soundAlert) playBeep(1180, 0.25);
        state.lastActionNote = "\u2728 Shiny apareceu na sess\xE3o!";
      }
      state.lastShiniesVistos = shiny.next;
      const caps = trackCounter(state.lastSessionCaptures, snap.capturas);
      state.lastSessionCaptures = caps.next;
      if (caps.delta > 0) {
        state.stats.captures += caps.delta;
        if (shouldTopCatchHop(CONFIG.topCatchHop, state)) {
          state.lastHopAt = Date.now();
          setTimeout(() => {
            if (state.running && !state.shinyAlertActive) hopNextTopCatchArea(ctx, false);
          }, 1e3);
        }
      }
    }
    const step = planSessionStep(state.session, hunt, poke);
    if (step === "create") {
      state.session = createSession(ctx, hunt, poke, state.lastMarkerMeta);
    } else if (step === "rotate") {
      persistCurrentSession(ctx, false);
      state.session = createSession(ctx, hunt, poke, state.lastMarkerMeta);
    } else {
      updateSessionReadings(state.session, poke, snap);
    }
    persistCurrentSession(ctx, false);
  };
  var dispose = ({ state }) => {
    if (state.logObserver) {
      state.logObserver.disconnect();
      state.logObserver = null;
      state.observedLogNode = null;
    }
  };
  var telemetry = {
    id: "telemetry",
    everyMs: (ctx) => ctx.CONFIG.farm.tickIntervalMs,
    init: (ctx) => ensureCombatLogObserver(ctx),
    tick: (ctx) => updateFarmTelemetry(ctx),
    dispose,
    createSession,
    ensureCombatLogObserver,
    computeSessionMetrics,
    persistCurrentSession,
    updateFarmTelemetry
  };

  // src/modules/hub-sheet.js
  var evaluateSheetCopy = ({ hooked, captured }) => {
    const valid = hooked ? looksLikeSheet(captured) : true;
    return valid ? { ok: true, text: captured, reason: "" } : { ok: false, text: captured, reason: "O jogo n\xE3o copiou a ficha (clipboard bloqueado?)" };
  };
  var describeSheetResult = (res, openSite = false) => {
    if (!res) return "Ficha: bot ocupado, tente de novo";
    if (res.ok) {
      const size = res.text ? ` (${res.text.length} car.)` : "";
      return openSite ? `Ficha copiada${size} \u2014 cole no Hub` : `Ficha copiada${size}!`;
    }
    return `Ficha: ${res.reason}`;
  };
  var closeSheetModal = async ({ dom, sleep, randomDelay }) => {
    const closeBtn = dom.$(SEL.fichaFechar);
    if (closeBtn && dom.isInteractable(closeBtn)) {
      closeBtn.click();
      await dom.waitFor(() => !dom.$(SEL.fichaGpt) || !dom.isInteractable(dom.$(SEL.fichaGpt)), 1400);
      await sleep(randomDelay(120, 200));
    } else {
      await dom.closeActiveModal();
    }
  };
  var copyNativeSheet = async (ctx) => {
    const { dom, sleep } = ctx;
    const card = dom.$(SEL.ativoCard);
    if (!card) return { ok: false, reason: "Pok\xE9mon ativo n\xE3o encontrado" };
    const clip = navigator.clipboard;
    const originalWrite = clip && typeof clip.writeText === "function" ? clip.writeText.bind(clip) : null;
    const hadOwnWrite = Boolean(clip) && Object.prototype.hasOwnProperty.call(clip, "writeText");
    let captured = null;
    let hooked = false;
    if (originalWrite) {
      try {
        clip.writeText = (t) => {
          captured = String(t ?? "");
          return originalWrite(t);
        };
        hooked = true;
      } catch {
      }
    }
    try {
      let btn = dom.$(SEL.fichaGpt);
      if (!btn || !dom.isInteractable(btn)) {
        card.click();
        btn = await dom.waitFor(() => {
          const el = dom.$(SEL.fichaGpt);
          return el && dom.isInteractable(el) ? el : null;
        }, 2500);
      }
      if (!btn) return { ok: false, reason: 'Bot\xE3o "Copiar p/ ChatGPT" n\xE3o apareceu' };
      btn.click();
      if (hooked) await dom.waitFor(() => captured, 1500);
      else await sleep(300);
      return evaluateSheetCopy({ hooked, captured });
    } finally {
      if (hooked) {
        try {
          if (hadOwnWrite) clip.writeText = originalWrite;
          else delete clip.writeText;
        } catch {
        }
      }
      await closeSheetModal(ctx);
    }
  };
  var copyActiveSheet = async (ctx, { openSite = false } = {}) => {
    const { state, updateHud, withModalLock, consts } = ctx;
    const res = await withModalLock("Copiando ficha", () => copyNativeSheet(ctx), { force: true });
    state.lastActionNote = describeSheetResult(res, openSite);
    if (res?.ok && openSite) window.open(consts.HUNT_GUIDE_URL, "_blank", "noopener,noreferrer");
    updateHud();
    return res?.text ?? null;
  };
  var copiarFichaHunt = (ctx, abrirSite = false) => copyActiveSheet(ctx, { openSite: abrirSite });
  var hubSheet = {
    id: "hubSheet",
    copyActiveSheet,
    copiarFichaHunt
  };

  // src/modules/team-season.js
  var SEL_LOCAL9 = {
    timeList: "#time",
    teamRow: ".poke-linha",
    activeRow: "#time .poke-linha.ativo",
    rowName: ".pl-nome",
    rowLevel: ".pl-lv",
    rowHp: ".mini-hp i",
    rowInfo: ".pl-info"
  };
  var getTeamCards = ({ dom, consts }) => {
    const list = dom.$(SEL_LOCAL9.timeList);
    if (!list) return [];
    return Array.from(list.querySelectorAll(SEL_LOCAL9.teamRow)).map((el) => {
      const id = el.getAttribute("data-id") || "";
      const isActive = el.classList.contains("ativo");
      const nomeEl = el.querySelector(SEL_LOCAL9.rowName);
      const lvEl = el.querySelector(SEL_LOCAL9.rowLevel);
      const level = parseNumber(lvEl?.textContent) ?? 1;
      const name = dom.getDirectText(nomeEl);
      const titleAttr = el.getAttribute("title") || "";
      const powerMatch = titleAttr.match(/poder\s+([\d.]+)/i);
      const power = powerMatch ? parseNumber(powerMatch[1]) : null;
      const types = [];
      titleAttr.toUpperCase().split(/[\s/·,]+/).forEach((tok) => {
        if (consts.VALID_TYPES.has(tok) && !types.includes(tok)) types.push(tok);
      });
      const hpStyle = el.querySelector(SEL_LOCAL9.rowHp)?.style?.width || "";
      const hpPercent = hpStyle.endsWith("%") ? Math.round(parseFloat(hpStyle)) : 100;
      return { el, id, key: id || `${name}_${level}`, name, level, power, types, hpPercent, isActive };
    });
  };
  var triggerTeamSwap = (ctx, chosen, noteLabel) => {
    const { CONFIG, state, dom } = ctx;
    const clickTarget = chosen.el.querySelector(SEL_LOCAL9.rowInfo) || chosen.el;
    if (!dom.isVisible(clickTarget)) return;
    const snap = dom.readNativeSessionPanel();
    state.teamSwapPotionSnap = snap ? { pocoes: snap.pocoesUsadas, revives: snap.revivesUsados } : null;
    clickTarget.click();
    state.lastTeamSwapAt = Date.now();
    setTimeout(() => {
      if (!state.running) return;
      const currentActiveRow = dom.$(SEL_LOCAL9.activeRow);
      const swapped = chosen.id && currentActiveRow?.getAttribute("data-id") === chosen.id || dom.getActivePokemon()?.name.toLowerCase() === chosen.name.toLowerCase();
      if (swapped) {
        state.stats.teamSwaps++;
        state.lastActionNote = noteLabel || `Equipe: ${chosen.name} Nv${chosen.level}`;
      } else {
        state.failedSwapUntil[chosen.key] = Date.now() + CONFIG.team.failedSwapBackoffMs;
      }
    }, 1600);
  };
  var tick2 = (ctx) => {
    const { CONFIG, state, dom, consts } = ctx;
    if (!state.running || state.paused || CONFIG.team.mode === "off") return;
    if (state.modalLockOwner || dom.isInSpecialArena()) return;
    const now = Date.now();
    const active = dom.getActivePokemon();
    const hunt = dom.getCurrentHunt();
    const { level: trainerLv } = dom.getTrainerHeaderInfo();
    const team = getTeamCards(ctx);
    if (!active || team.length < 2) return;
    const eligible = team.filter((p) => {
      if (trainerLv !== null && p.level > trainerLv + 5) return false;
      if (p.hpPercent <= 0) return false;
      if ((state.failedSwapUntil[p.key] || 0) > now) return false;
      return true;
    });
    if (eligible.length < 2) return;
    const activeRow = team.find((p) => p.isActive) || null;
    const strongest = [...eligible].sort(
      (a, b) => b.level - a.level || (b.power ?? 0) - (a.power ?? 0)
    )[0];
    if (CONFIG.team.mode === "equilibrar" && activeRow && strongest && activeRow.key !== strongest.key) {
      const snap = dom.readNativeSessionPanel();
      const spentSupply = Boolean(
        snap && state.teamSwapPotionSnap && (snap.pocoesUsadas > state.teamSwapPotionSnap.pocoes || snap.revivesUsados > state.teamSwapPotionSnap.revives)
      );
      const lowHp = active.hpPercent !== null && active.hpPercent < CONFIG.team.rescueHpPercent;
      const tooWeak = active.power !== null && active.power < CONFIG.team.minTrainPower;
      if (spentSupply || lowHp || tooWeak) {
        if (now - state.lastTeamSwapAt >= consts.ESPERA_TROCA_ATIVO_MS) {
          state.unsafeTrainUntil[activeRow.key] = now + CONFIG.team.unsafeBackoffMs;
          triggerTeamSwap(ctx, strongest, `Resgate: ${strongest.name} (${activeRow.name} fr\xE1gil)`);
        }
        return;
      }
    }
    const cooldown = Math.max(CONFIG.team.swapCooldownMs, consts.ESPERA_TROCA_ATIVO_MS);
    if (now - state.lastTeamSwapAt < cooldown) return;
    let chosen = null;
    if (CONFIG.team.mode === "sazonal") {
      const dayType = dom.getSeasonalDayType();
      if (dayType && !active.types.includes(dayType)) {
        const matching = eligible.filter((p) => p.types.includes(dayType) && !p.isActive).sort((a, b) => b.level - a.level || (b.power ?? 0) - (a.power ?? 0));
        if (matching.length > 0) chosen = matching[0];
      }
    } else if (CONFIG.team.mode === "equilibrar") {
      const minSafeLevel = hunt ? Math.max(1, hunt.targetLevel - CONFIG.team.maxGapBelowHunt) : 1;
      const safeToTrain = eligible.filter((p) => {
        if (p.level < minSafeLevel) return false;
        if (p.hpPercent < CONFIG.team.minTrainHpPercent) return false;
        if (p.power !== null && p.power < CONFIG.team.minTrainPower) return false;
        if ((state.unsafeTrainUntil[p.key] || 0) > now) return false;
        return true;
      }).sort((a, b) => a.level - b.level || (b.power ?? 0) - (a.power ?? 0));
      if (safeToTrain.length > 0 && !safeToTrain[0].isActive && safeToTrain[0].level + 1 < (active.level ?? 1)) {
        chosen = safeToTrain[0];
      }
    }
    if (chosen && !chosen.isActive) {
      triggerTeamSwap(ctx, chosen, `Equipe: ${chosen.name} Nv${chosen.level}`);
    }
  };
  var teamSeason = {
    id: "teamSeason",
    everyMs: (ctx) => ctx.CONFIG.team.checkIntervalMs,
    tick: tick2
  };

  // src/modules/rmt-radar.js
  var SEL_LOCAL10 = {
    modalTitulo: "#modal-titulo",
    modalCorpo: "#modal-corpo",
    card: ".cm-card",
    cardNome: ".cm-nome-txt",
    cardPreco: ".cm-rodape .cm-preco",
    cardComprar: "button.cm-btn.comprar",
    itemLinha: "button.cmi-linha",
    itemNome: ".cmi-nome b",
    itemPrecos: ".cmi-precos .cmi-de:not(.nada) .cm-preco",
    gemaImg: 'img[src*="moeda-gema"]'
  };
  var parseRmtPriceEl = (priceEl) => {
    if (!priceEl) return null;
    const isGems = priceEl.classList.contains("orb") || Boolean(priceEl.querySelector(SEL_LOCAL10.gemaImg));
    const value = parseNumber(priceEl.textContent);
    if (!value || value <= 0) return null;
    return { value, currency: isGems ? "gemas" : "coins" };
  };
  var scan = (ctx) => {
    const { CONFIG, state, dom } = ctx;
    if (!state.running || !CONFIG.radar.enabled || CONFIG.radar.alerts.length === 0) return;
    const title = normalizeText2(dom.$(SEL_LOCAL10.modalTitulo)?.textContent);
    if (!title.includes("mercado da comunidade")) return;
    const corpo = dom.$(SEL_LOCAL10.modalCorpo);
    if (!corpo || !dom.isVisible(corpo)) return;
    const hits = [];
    corpo.querySelectorAll(SEL_LOCAL10.card).forEach((card) => {
      if (!dom.isVisible(card)) return;
      const nameText = card.querySelector(SEL_LOCAL10.cardNome)?.textContent?.trim() || "";
      const priceInfo = parseRmtPriceEl(card.querySelector(SEL_LOCAL10.cardPreco));
      if (!nameText || !priceInfo) return;
      const normName = normalizeText2(nameText);
      for (const rule of CONFIG.radar.alerts) {
        if (!normName.includes(normalizeText2(rule.nome))) continue;
        if (rule.moeda !== "todas" && rule.moeda !== priceInfo.currency) continue;
        if (priceInfo.value > rule.maxPreco) continue;
        card.style.outline = "2px solid #22c55e";
        card.style.boxShadow = "0 0 12px rgba(34,197,94,0.55)";
        const hitKey = `pk_${normName}_${priceInfo.value}_${priceInfo.currency}`;
        hits.push({ nome: nameText, preco: priceInfo.value, moeda: priceInfo.currency });
        if (!state.radarNotifiedKeys.has(hitKey)) {
          state.radarNotifiedKeys.add(hitKey);
          if (CONFIG.radar.soundAlert) dom.playBeep(960, 0.18);
          state.lastActionNote = `RMT! ${nameText} por ${priceInfo.value.toLocaleString("pt-BR")} ${priceInfo.currency}`;
        }
        if (rule.autoComprar) {
          const buyBtn = card.querySelector(SEL_LOCAL10.cardComprar);
          if (buyBtn && dom.isInteractable(buyBtn) && !buyBtn.classList.contains("cm-retido")) {
            buyBtn.click();
            state.lastActionNote = `Compra RMT: ${nameText}`;
          }
        }
      }
    });
    corpo.querySelectorAll(SEL_LOCAL10.itemLinha).forEach((row) => {
      if (!dom.isVisible(row)) return;
      const itemName = row.querySelector(SEL_LOCAL10.itemNome)?.textContent?.trim() || "";
      if (!itemName) return;
      const normName = normalizeText2(itemName);
      const priceNodes = Array.from(row.querySelectorAll(SEL_LOCAL10.itemPrecos));
      for (const pNode of priceNodes) {
        const priceInfo = parseRmtPriceEl(pNode);
        if (!priceInfo) continue;
        for (const rule of CONFIG.radar.alerts) {
          if (!normName.includes(normalizeText2(rule.nome))) continue;
          if (rule.moeda !== "todas" && rule.moeda !== priceInfo.currency) continue;
          if (priceInfo.value > rule.maxPreco) continue;
          row.style.outline = "2px solid #22c55e";
          row.style.boxShadow = "0 0 12px rgba(34,197,94,0.55)";
          const hitKey = `it_${normName}_${priceInfo.value}_${priceInfo.currency}`;
          hits.push({ nome: itemName, preco: priceInfo.value, moeda: priceInfo.currency });
          if (!state.radarNotifiedKeys.has(hitKey)) {
            state.radarNotifiedKeys.add(hitKey);
            if (CONFIG.radar.soundAlert) dom.playBeep(960, 0.18);
            state.lastActionNote = `RMT Item! ${itemName} por ${priceInfo.value.toLocaleString("pt-BR")} ${priceInfo.currency}`;
          }
        }
      }
    });
    state.radarHits = hits;
  };
  var addAlert = ({ CONFIG, storage, hud }, { nome, maxPreco, moeda = "coins", autoComprar = false }) => {
    if (!nome || !maxPreco) return false;
    CONFIG.radar.alerts.push({
      nome: String(nome).trim(),
      maxPreco: Number(maxPreco),
      moeda: normalizeText2(moeda),
      autoComprar: Boolean(autoComprar)
    });
    storage.persistPrefs();
    hud.renderAlertList();
    return true;
  };
  var removeAlert = ({ CONFIG, storage, hud }, index) => {
    if (index < 0 || index >= CONFIG.radar.alerts.length) return;
    CONFIG.radar.alerts.splice(index, 1);
    storage.persistPrefs();
    hud.renderAlertList();
  };
  var rmtRadar = {
    id: "rmtRadar",
    everyMs: (ctx) => ctx.CONFIG.radar.checkIntervalMs,
    tick: scan,
    addAlert,
    removeAlert
  };

  // src/modules/minigames.js
  var SEL_LOCAL11 = {
    mgInput: "#mg-input",
    mgEnviar: "#mg-enviar",
    mgTela: "#mg-tela",
    mgBarra: "#mg-barra",
    pistas: ".mg-pistas",
    tipoSel: ".mg-tipo-sel",
    parLivre: ".mg-par:not(.trava)",
    pistaRot: ".mg-pista-rot",
    pistaVal: ".mg-pista-val",
    pistaLetras: ".mg-pista-letras"
  };
  var dexNumberToRegion = (num) => {
    if (!num || num <= 0) return "";
    if (num <= 151) return "kanto";
    if (num <= 251) return "johto";
    if (num <= 386) return "hoenn";
    if (num <= 493) return "sinnoh";
    if (num <= 649) return "unova";
    if (num <= 721) return "kalos";
    if (num <= 809) return "alola";
    if (num <= 905) return "galar";
    if (num <= 1025) return "paldea";
    return "";
  };
  var parsePokedexCsv = ({ state, keys, storage, consts, updateHud }, csvText) => {
    const lines = (csvText || "").split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];
    const sep = lines[0].includes(";") ? ";" : ",";
    const headers = lines[0].split(sep).map((h) => normalizeText2(h.replace(/^"|"$/g, "")));
    const col = (candidates) => headers.findIndex((h) => candidates.some((c) => h.includes(c)));
    const idIdx = col(["#", "id", "num", "dex"]);
    const nameIdx = col(["nome", "name", "especie", "pokemon"]);
    const type1Idx = col(["tipo1", "tipo 1", "type1", "tipo", "type"]);
    const type2Idx = col(["tipo2", "tipo 2", "type2"]);
    const regIdx = col(["regiao", "region", "geracao", "gen"]);
    if (nameIdx === -1) return [];
    const map = /* @__PURE__ */ new Map();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map((v) => v.replace(/^"|"$/g, "").trim());
      const name = cols[nameIdx];
      if (!name || map.has(name)) continue;
      const types = [];
      const rawTypes = `${cols[type1Idx] || ""} ${type2Idx !== -1 ? cols[type2Idx] || "" : ""}`;
      rawTypes.split(/[\s/|,]+/).forEach((rawTok) => {
        const canonical = consts.TYPE_ALIASES[normalizeText2(rawTok)];
        if (canonical && !types.includes(canonical)) types.push(canonical);
      });
      const dexId = idIdx !== -1 ? parseNumber(cols[idIdx]) : null;
      const region = regIdx !== -1 && cols[regIdx] ? normalizeText2(cols[regIdx]) : dexNumberToRegion(dexId);
      map.set(name, {
        id: dexId,
        name,
        cleanName: cleanKey(name),
        types,
        region
      });
    }
    const list = Array.from(map.values());
    state.dexCatalog = list;
    storage.saveJson(keys.dex, list);
    state.lastActionNote = `Pokedex importada: ${list.length} esp\xE9cies`;
    updateHud();
    return list;
  };
  var openCsvPicker = (ctx) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      parsePokedexCsv(ctx, text);
    };
    input.click();
  };
  var applyGuess = ({ dom }, pokemonName, submit = false) => {
    const input = dom.$(SEL_LOCAL11.mgInput);
    if (!input || !dom.isInteractable(input)) return false;
    input.value = pokemonName;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    if (submit) {
      const sendBtn = dom.$(SEL_LOCAL11.mgEnviar);
      if (sendBtn && dom.isInteractable(sendBtn)) {
        sendBtn.click();
        return true;
      }
      const form = input.closest("form");
      if (form) {
        form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        return true;
      }
      return false;
    }
    return true;
  };
  var tick3 = (ctx) => {
    const { CONFIG, state, dom, consts, hud } = ctx;
    if (!state.running || !CONFIG.minigame.enabled || state.dexCatalog.length === 0) return;
    const tela = dom.$(SEL_LOCAL11.mgTela);
    if (!tela || !dom.isVisible(tela) || tela.getAttribute("data-fase") !== "palpites") {
      if (state.miniGameMatches.length > 0) {
        state.miniGameMatches = [];
        hud.renderQuizCandidates();
      }
      return;
    }
    const barraSig = dom.$(SEL_LOCAL11.mgBarra)?.getAttribute("data-sig") || "";
    const roundId = barraSig.split("|")[0] || "";
    if (roundId && roundId !== state.currentMiniGameRoundId) {
      state.currentMiniGameRoundId = roundId;
      state.roundTriedNames.clear();
      state.lastGuessedStageKey = "";
    }
    const pistasEl = tela.querySelector(SEL_LOCAL11.pistas);
    if (!pistasEl) return;
    const clueTypes = [];
    pistasEl.querySelectorAll(SEL_LOCAL11.tipoSel).forEach((badge) => {
      for (const cls of badge.classList) {
        const up = cls.toUpperCase();
        if (consts.VALID_TYPES.has(up) && !clueTypes.includes(up)) clueTypes.push(up);
      }
    });
    let clueRegion = null;
    const regions = ["kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"];
    pistasEl.querySelectorAll(SEL_LOCAL11.parLivre).forEach((par) => {
      const rot = normalizeText2(par.querySelector(SEL_LOCAL11.pistaRot)?.textContent);
      const val = normalizeText2(par.querySelector(SEL_LOCAL11.pistaVal)?.textContent);
      if (rot.includes("regiao")) {
        const found = regions.find((r) => val.includes(r));
        if (found) clueRegion = found;
      }
    });
    let letterPattern = null;
    const letrasEl = pistasEl.querySelector(SEL_LOCAL11.pistaLetras);
    if (letrasEl) {
      const cells = Array.from(letrasEl.querySelectorAll("span, i, b")).filter((c) => {
        const t = (c.textContent || "").trim();
        return c.children.length === 0 && t.length <= 2;
      });
      if (cells.length >= 3) {
        const chars = cells.map((c) => {
          const ch = cleanKey(c.textContent);
          return ch.length === 1 ? ch : ".";
        });
        letterPattern = new RegExp(`^${chars.join("")}$`);
      }
    }
    if (clueTypes.length === 0 && !clueRegion && !letterPattern) {
      if (state.miniGameMatches.length > 0) {
        state.miniGameMatches = [];
        hud.renderQuizCandidates();
      }
      return;
    }
    let matches = state.dexCatalog;
    if (clueTypes.length > 0) {
      matches = matches.filter((p) => clueTypes.every((t) => p.types.includes(t)));
      if (clueTypes.length === 1) {
        matches = [...matches].sort((a, b) => a.types.length - b.types.length);
      }
    }
    if (clueRegion) {
      matches = matches.filter((p) => !p.region || p.region.includes(clueRegion));
    }
    if (letterPattern) {
      matches = matches.filter((p) => letterPattern.test(p.cleanName));
    }
    const untried = matches.filter((p) => !state.roundTriedNames.has(p.cleanName));
    state.miniGameMatches = untried.slice(0, 8).map((p) => p.name);
    hud.renderQuizCandidates();
    if (CONFIG.minigame.autoGuess && untried.length >= 1 && untried.length <= CONFIG.minigame.autoGuessMaxCandidates) {
      const stageKey = `${roundId || "mg"}_${tela.getAttribute("data-estagio") || "0"}`;
      if (state.lastGuessedStageKey !== stageKey) {
        const pick = untried[0];
        if (applyGuess(ctx, pick.name, true)) {
          state.lastGuessedStageKey = stageKey;
          state.roundTriedNames.add(pick.cleanName);
          state.lastActionNote = `Quiz auto (${untried.length} op\xE7.): ${pick.name}`;
          hud.renderQuizCandidates();
        }
      }
    }
  };
  var miniGames = {
    id: "miniGames",
    everyMs: (ctx) => ctx.CONFIG.minigame.checkIntervalMs,
    tick: tick3,
    applyGuess,
    openCsvPicker,
    parsePokedexCsv
  };
  return __toCommonJS(index_exports);
})();
    // Se o gerenciador de userscripts isolar o script (@grant), unsafeWindow é a janela real da página
    const pageWin = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
    [window, pageWin].forEach((w) => {
        try {
            if (w.PokeBot && typeof w.PokeBot.stop === 'function') w.PokeBot.stop();
        } catch {
            // instância antiga já encerrada
        }
    });
    if (window.FarmAnalyzer && typeof window.FarmAnalyzer.stop === 'function') {
        window.FarmAnalyzer.stop();
    }

    const VERSION = '6.6'; // preenchido no build a partir do package.json
    const HUD_ID = 'pokebot-hud';
    const STYLE_ID = 'pokebot-hud-style';
    // Mantém chaves v60 para preservar Pokédex importada, alertas e preferências
    const STORAGE_HISTORY_KEY = 'pokeidle_farm_benchmarks_v60';
    const STORAGE_PREFS_KEY = 'pokeidle_hud_prefs_v60';
    const STORAGE_DEX_KEY = 'pokeidle_minigame_dex_v60';
    const STORAGE_PASS_NEXT_KEY = 'pokeidle_pass_next_ms_v60';
    const STORAGE_HUNT_QUEUE_KEY = 'pokeidle_hunt_queue_v63';

    const HUNT_GUIDE_URL = 'https://pokeidleguide.io/#hunt';
    const TETO_DEPOT = 3000;
    const ESPERA_TROCA_ATIVO_MS = 3250;

    const BALL_TIERS = [
        { minGold: 0,       itemName: 'Poke Ball',  chipIndex: 0, unitCost: 5   },
        { minGold: 50000,   itemName: 'Great Ball', chipIndex: 1, unitCost: 20  },
        { minGold: 300000,  itemName: 'Super Ball', chipIndex: 2, unitCost: 50  },
        { minGold: 2500000, itemName: 'Ultra Ball', chipIndex: 3, unitCost: 130 },
    ];

    const SEASONAL_DAYS = {
        'dia de ceu limpo': 'NORMAL',
        'dia escaldante': 'FIRE',
        'dia chuvoso': 'WATER',
        'dia florido': 'GRASS',
        'dia de tempestade': 'ELECTRIC',
        'dia de nevasca': 'ICE',
        'dia de treino': 'FIGHTING',
        'dia toxico': 'POISON',
        'dia de terremoto': 'GROUND',
        'dia de ventania': 'FLYING',
        'dia telepatico': 'PSYCHIC',
        'dia do enxame': 'BUG',
        'dia de avalanche': 'ROCK',
        'dia assombrado': 'GHOST',
        'dia do dragao': 'DRAGON',
        'noite eterna': 'DARK',
        'dia da forja': 'STEEL',
        'dia encantado': 'FAIRY',
    };

    const TYPE_ALIASES = {
        normal: 'NORMAL',
        fire: 'FIRE', fogo: 'FIRE',
        water: 'WATER', agua: 'WATER',
        electric: 'ELECTRIC', eletrico: 'ELECTRIC',
        grass: 'GRASS', planta: 'GRASS', grama: 'GRASS',
        ice: 'ICE', gelo: 'ICE',
        fighting: 'FIGHTING', lutador: 'FIGHTING', luta: 'FIGHTING',
        poison: 'POISON', venenoso: 'POISON', veneno: 'POISON',
        ground: 'GROUND', terra: 'GROUND', terrestre: 'GROUND',
        flying: 'FLYING', voador: 'FLYING', voo: 'FLYING',
        psychic: 'PSYCHIC', psiquico: 'PSYCHIC',
        bug: 'BUG', inseto: 'BUG',
        rock: 'ROCK', pedra: 'ROCK', rocha: 'ROCK',
        ghost: 'GHOST', fantasma: 'GHOST',
        dragon: 'DRAGON', dragao: 'DRAGON',
        dark: 'DARK', sombrio: 'DARK', noturno: 'DARK',
        steel: 'STEEL', aco: 'STEEL', metal: 'STEEL',
        fairy: 'FAIRY', fada: 'FAIRY',
    };

    const TYPE_CHART = {
        NORMAL:   { ROCK: 0.5, GHOST: 0, STEEL: 0.5 },
        FIRE:     { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 2, BUG: 2, ROCK: 0.5, DRAGON: 0.5, STEEL: 2 },
        WATER:    { FIRE: 2, WATER: 0.5, GRASS: 0.5, GROUND: 2, ROCK: 2, DRAGON: 0.5 },
        ELECTRIC: { WATER: 2, ELECTRIC: 0.5, GRASS: 0.5, GROUND: 0, FLYING: 2, DRAGON: 0.5 },
        GRASS:    { FIRE: 0.5, WATER: 2, GRASS: 0.5, POISON: 0.5, GROUND: 2, FLYING: 0.5, BUG: 0.5, ROCK: 2, DRAGON: 0.5, STEEL: 0.5 },
        ICE:      { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 0.5, GROUND: 2, FLYING: 2, DRAGON: 2, STEEL: 0.5 },
        FIGHTING: { NORMAL: 2, ICE: 2, POISON: 0.5, FLYING: 0.5, PSYCHIC: 0.5, BUG: 0.5, ROCK: 2, GHOST: 0, DARK: 2, STEEL: 2, FAIRY: 0.5 },
        POISON:   { GRASS: 2, POISON: 0.5, GROUND: 0.5, ROCK: 0.5, GHOST: 0.5, STEEL: 0, FAIRY: 2 },
        GROUND:   { FIRE: 2, ELECTRIC: 2, GRASS: 0.5, POISON: 2, FLYING: 0, BUG: 0.5, ROCK: 2, STEEL: 2 },
        FLYING:   { ELECTRIC: 0.5, GRASS: 2, FIGHTING: 2, BUG: 2, ROCK: 0.5, STEEL: 0.5 },
        PSYCHIC:  { FIGHTING: 2, POISON: 2, PSYCHIC: 0.5, DARK: 0, STEEL: 0.5 },
        BUG:      { FIRE: 0.5, GRASS: 2, FIGHTING: 0.5, POISON: 0.5, FLYING: 0.5, PSYCHIC: 2, GHOST: 0.5, DARK: 2, STEEL: 0.5, FAIRY: 0.5 },
        ROCK:     { FIRE: 2, ICE: 2, FIGHTING: 0.5, GROUND: 0.5, FLYING: 2, BUG: 2, STEEL: 0.5 },
        GHOST:    { NORMAL: 0, PSYCHIC: 2, GHOST: 2, DARK: 0.5 },
        DRAGON:   { DRAGON: 2, STEEL: 0.5, FAIRY: 0 },
        DARK:     { FIGHTING: 0.5, PSYCHIC: 2, GHOST: 2, DARK: 0.5, FAIRY: 0.5 },
        STEEL:    { FIRE: 0.5, WATER: 0.5, ELECTRIC: 0.5, ICE: 2, ROCK: 2, STEEL: 0.5, FAIRY: 2 },
        FAIRY:    { FIRE: 0.5, FIGHTING: 2, POISON: 0.5, DRAGON: 2, DARK: 2, STEEL: 0.5 },
    };

    const HUNT_AMP = { 0: 0, 0.25: 0.167, 0.5: 0.333, 1: 1, 2: 2.5, 4: 5.5 };
    const VALID_TYPES = new Set(Object.keys(TYPE_CHART));
    const VALID_MODES = ['xp', 'ouro', 'equilibrado', 'topcatch'];
    const DEPOT_MODES = ['off', 'venda', 'oferenda', 'sacrificio'];
    const TEAM_MODES = ['off', 'equilibrar', 'sazonal'];
    const BOSS_PRIORITIES = ['off', 'qualquer', 'mega', 'tm', 'tickets'];

    const loadJson = (key, fallback) => {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    };

    const saveJson = (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.warn('[PokeBot] Erro ao salvar localStorage:', err);
        }
    };

    const savedPrefs = loadJson(STORAGE_PREFS_KEY, {});
    const savedQueueStore = loadJson(STORAGE_HUNT_QUEUE_KEY, { items: [], index: 0 });

    const CONFIG = {
        mode: VALID_MODES.includes(savedPrefs.mode) ? savedPrefs.mode : 'equilibrado',
        caidos: {
            enabled: savedPrefs.caidosEnabled ?? true,
            smartBallSelect: savedPrefs.smartBallSelect ?? true,
            highLevelUltraThreshold: 20,
            containerSelector: '#caidos-lista',
            buttonSelector: 'button.caido',
            minThrowIntervalMs: 1200,
            retryAfterMs: 4500,
            reattachIntervalMs: 3000,
        },
        shinyGuard: {
            enabled: savedPrefs.shinyGuardEnabled ?? true,
            soundAlert: true,
        },
        restock: {
            enabled: savedPrefs.restockEnabled ?? true,
            autoUpgradeBalls: savedPrefs.autoUpgradeBalls ?? true,
            minGoldReserve: savedPrefs.minGoldReserve ?? 50000,
            minBalls: 10,
            targetBalls: 50,
            restockSmallPotion: true,
            minPotions: 10,
            targetPotions: 40,
            restockRevive: savedPrefs.restockRevive ?? false,
            minRevives: 5,
            targetRevives: 20,
            batchButton: '×10',
            maxPurchases: 6,
            buyConfirmTimeoutMs: 2600,
            checkIntervalMs: 15000,
            closeMarketAfter: true,
        },
        topCatchHop: {
            enabled: savedPrefs.topCatchHopEnabled ?? false,
            hopCooldownMs: 15000,
        },
        depot: {
            mode: DEPOT_MODES.includes(savedPrefs.depotMode) ? savedPrefs.depotMode : 'off',
            intervalMs: 600000,
            tetoMax: TETO_DEPOT,
        },
        dailyPass: {
            enabled: savedPrefs.dailyPassEnabled ?? true,
            checkIntervalMs: 60000,
        },
        team: {
            mode: TEAM_MODES.includes(savedPrefs.teamMode) ? savedPrefs.teamMode : 'off',
            checkIntervalMs: 4000,
            swapCooldownMs: 12000,
            failedSwapBackoffMs: 60000,
            unsafeBackoffMs: 180000,
            maxGapBelowHunt: 0,
            minTrainPower: 2,
            minTrainHpPercent: 75,
            rescueHpPercent: 55,
        },
        incubator: {
            enabled: savedPrefs.incubatorEnabled ?? false,
            activeIntervalMs: 30000,
            emptyBackoffMs: 180000,
        },
        boss: {
            priority: BOSS_PRIORITIES.includes(savedPrefs.bossPriority) ? savedPrefs.bossPriority : 'off',
            checkIntervalMs: 300000,
            autoDismissLoot: true,
        },
        radar: {
            enabled: savedPrefs.radarEnabled ?? true,
            checkIntervalMs: 1800,
            soundAlert: true,
            alerts: Array.isArray(savedPrefs.radarAlerts) ? savedPrefs.radarAlerts : [],
        },
        minigame: {
            enabled: savedPrefs.minigameEnabled ?? true,
            autoGuess: savedPrefs.minigameAutoGuess ?? false,
            autoGuessMaxCandidates: 3,
            checkIntervalMs: 1200,
        },
        autoRegion: {
            enabled: savedPrefs.autoRegionEnabled ?? true,
            checkIntervalMs: 12000,
            levelStep: 5,
            minIntervalMs: 180000,
        },
        evolve: {
            enabled: savedPrefs.evolveEnabled ?? false,
            checkIntervalMs: 8000,
            cooldownMs: 15000, // depois de evoluir de verdade
            recheckMs: 600000, // depois de abrir a confirmação e ver que falta requisito
        },
        huntQueue: {
            fallbackToSafeArea: savedPrefs.queueFallback ?? true,
        },
        farm: {
            enabled: true,
            tickIntervalMs: 3000,
            minSampleSec: 15,
            minKillsToSave: 2,
            maxPotionsPerMinSafe: 2,
            minHpPercentSafe: 25,
        },
        map: {
            preferTypeAdvantage: true,
            onlyUnlocked: true,
            switchCooldownMs: 10500,
            warmupMaxSec: 11,
            benchmarkSecPerArea: 30,
            maxAreasToTest: 4,
            maxLevelAbovePokemon: 5,
            abortHpThreshold: 25,
        },
        hud: {
            tab: savedPrefs.hudTab || 'geral',
            minimized: savedPrefs.hudMinimized ?? false,
            left: typeof savedPrefs.hudLeft === 'number' ? savedPrefs.hudLeft : 14,
            top: typeof savedPrefs.hudTop === 'number' ? savedPrefs.hudTop : 14,
            refreshMs: 2500,
        },
        delays: {
            clickMinMs: 70,
            clickMaxMs: 170,
            uiMinMs: 220,
            uiMaxMs: 380,
        },
    };

    const persistPrefs = () => {
        saveJson(STORAGE_PREFS_KEY, {
            mode: CONFIG.mode,
            caidosEnabled: CONFIG.caidos.enabled,
            smartBallSelect: CONFIG.caidos.smartBallSelect,
            shinyGuardEnabled: CONFIG.shinyGuard.enabled,
            restockEnabled: CONFIG.restock.enabled,
            autoUpgradeBalls: CONFIG.restock.autoUpgradeBalls,
            minGoldReserve: CONFIG.restock.minGoldReserve,
            restockRevive: CONFIG.restock.restockRevive,
            topCatchHopEnabled: CONFIG.topCatchHop.enabled,
            depotMode: CONFIG.depot.mode,
            dailyPassEnabled: CONFIG.dailyPass.enabled,
            teamMode: CONFIG.team.mode,
            incubatorEnabled: CONFIG.incubator.enabled,
            bossPriority: CONFIG.boss.priority,
            radarEnabled: CONFIG.radar.enabled,
            radarAlerts: CONFIG.radar.alerts,
            minigameEnabled: CONFIG.minigame.enabled,
            minigameAutoGuess: CONFIG.minigame.autoGuess,
            autoRegionEnabled: CONFIG.autoRegion.enabled,
            evolveEnabled: CONFIG.evolve.enabled,
            queueFallback: CONFIG.huntQueue.fallbackToSafeArea,
            hudTab: CONFIG.hud.tab,
            hudMinimized: CONFIG.hud.minimized,
            hudLeft: CONFIG.hud.left,
            hudTop: CONFIG.hud.top,
        });
    };

    const state = {
        running: true,
        paused: false,
        modalLockOwner: null,
        statusText: 'Ativo',
        lastActionNote: `Conectado (PokeBot v${VERSION})`,
        throwPending: false,
        lastThrowAt: 0,
        evolveNextAt: 0,
        lastAreaSwitchAt: 0,
        lastOptimizeAt: 0,
        lastHopAt: 0,
        lastDepotRunAt: 0,
        lastTeamSwapAt: 0,
        teamSwapPotionSnap: null,
        failedSwapUntil: {},
        unsafeTrainUntil: {},
        nextIncubatorCheckAt: 0,
        lastBossCheckAt: 0,
        lastOptimizedTrainerLevel: null,
        lastMarkerMeta: null,
        huntQueue: Array.isArray(savedQueueStore?.items) ? savedQueueStore.items : [],
        huntQueueIndex: typeof savedQueueStore?.index === 'number' ? savedQueueStore.index : 0,
        lastSessionCaptures: null,
        lastShiniesVistos: null,
        shinyAlertActive: false,
        shinyNotifiedSlots: new Set(),
        seasonalDayType: null,
        radarHits: [],
        radarNotifiedKeys: new Set(),
        miniGameMatches: [],
        currentMiniGameRoundId: '',
        roundTriedNames: new Set(),
        lastQuizSigRendered: '',
        lastGuessedStageKey: '',
        dexCatalog: loadJson(STORAGE_DEX_KEY, []),
        startedAt: Date.now(),
        timers: [],
        cleanupListeners: [],
        caidosObserver: null,
        observedCaidosNode: null,
        logObserver: null,
        observedLogNode: null,
        history: loadJson(STORAGE_HISTORY_KEY, {}),
        session: null,
        hudEl: null,
        hudCache: {},
        stats: {
            caidosClicked: 0,
            captures: 0,
            purchases: 0,
            regionSwitches: 0,
            depotRuns: 0,
            passClaims: 0,
            teamSwaps: 0,
            eggsHandled: 0,
            bossEntries: 0,
            shiniesSpotted: 0,
        },
    };

    // --- Funções puras: a fonte única é src/modules/pure.js (testada em tests/pure.test.mjs) ---
    const { normalizeText, cleanKey, parseNumber, parseSignedNumber, looksLikeSheet } = PokeBotModules.pure;
    // As de fila carregam o modo atual da CONFIG
    const parseQueueEntry = (rawText) => PokeBotModules.pure.parseQueueEntry(rawText, CONFIG.mode);
    const parseQueueText = (rawText) => PokeBotModules.pure.parseQueueText(rawText, CONFIG.mode);

    // --- Utilitários ---
    const isInsideHud = (el) => Boolean(el && el.closest && el.closest(`#${HUD_ID}`));
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    const scheduleIdle = (fn) => {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => fn(), { timeout: 1000 });
        } else {
            setTimeout(fn, 0);
        }
    };

    const escapeHtml = (str) =>
        String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

    const getDirectText = (el) => {
        if (!el) return 'Desconhecido';
        let text = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
        }
        return text.trim() || 'Desconhecido';
    };

    const playBeep = (freq = 880, dur = 0.14) => {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.value = 0.08;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + dur);
        } catch {
            // Ignora bloqueio de áudio
        }
    };

    const isVisible = (el) => {
        if (!el || !el.isConnected || isInsideHud(el)) return false;
        if (el.offsetParent === null) {
            const style = window.getComputedStyle(el);
            if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }
        }
        return true;
    };

    const isInteractable = (el) => {
        if (!isVisible(el)) return false;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        const style = window.getComputedStyle(el);
        return style.pointerEvents !== 'none' && parseFloat(style.opacity) >= 0.45;
    };

    const findClickableByText = (text, root = document, exact = false) => {
        const target = normalizeText(text);
        const matchFn = (el) => {
            const txt = normalizeText(el.textContent);
            return exact ? txt === target : txt.includes(target);
        };

        const primary = Array.from(root.querySelectorAll('button, a, [role="button"]')).filter(
            (el) => matchFn(el) && isInteractable(el)
        );
        if (primary.length > 0) {
            primary.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
            return primary[0];
        }

        const fallback = Array.from(root.querySelectorAll('div, li, label')).filter((el) => {
            if (!isInteractable(el) || el.children.length > 4) return false;
            const style = window.getComputedStyle(el);
            return style.cursor === 'pointer' && matchFn(el);
        });
        fallback.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
        return fallback[0] || null;
    };

    const findMenuButtonByImg = (srcPart) =>
        Array.from(document.querySelectorAll('button')).find(
            (btn) => isInteractable(btn) && Boolean(btn.querySelector(`img[src*="${srcPart}"]`))
        ) || null;

    const waitFor = async (conditionFn, timeoutMs = 4000, pollMs = 90) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (!state.running) return null;
            const res = conditionFn();
            if (res) return res;
            await sleep(pollMs);
        }
        return null;
    };

    const setStatus = (label, note = null) => {
        state.statusText = label;
        if (note) state.lastActionNote = note;
        updateHud();
    };

    const getVisibleModal = () => {
        const modals = Array.from(document.querySelectorAll('.modal-caixa, .modal')).filter(isVisible);
        return modals[modals.length - 1] || null;
    };

    const closeActiveModal = async () => {
        const closeById = document.getElementById('modal-fechar');
        if (closeById && isInteractable(closeById)) {
            closeById.click();
            await waitFor(() => !getVisibleModal(), 1400);
            await sleep(randomDelay(160, 240));
            return;
        }

        const modal = getVisibleModal();
        if (!modal) return;

        const closeBtn =
            modal.querySelector('.modal-acoes button') ||
            Array.from(modal.querySelectorAll('button, a')).find((btn) => {
                if (!isInteractable(btn)) return false;
                const txt = normalizeText(btn.textContent);
                const aria = normalizeText(btn.getAttribute('aria-label'));
                return (
                    txt === 'x' ||
                    txt === '×' ||
                    txt === '✕' ||
                    txt === 'fechar' ||
                    aria.includes('fechar') ||
                    aria.includes('close')
                );
            });

        if (closeBtn && isInteractable(closeBtn)) {
            closeBtn.click();
        } else {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
            );
        }

        await waitFor(() => !getVisibleModal(), 1400);
        await sleep(randomDelay(160, 240));
    };

    const confirmModalDialog = async (keywords = ['confirmar', 'vender', 'oferendar', 'sacrificar', 'evoluir', 'sim']) => {
        await sleep(randomDelay(220, 360));
        const directConfirm = document.getElementById('confirmar-sim');
        if (directConfirm && isInteractable(directConfirm)) {
            directConfirm.click();
            await sleep(randomDelay(260, 420));
            return true;
        }

        const topModal = getVisibleModal();
        if (!topModal) return false;

        const btn = Array.from(topModal.querySelectorAll('button')).find((b) => {
            if (!isInteractable(b)) return false;
            const txt = normalizeText(b.textContent);
            return keywords.some((kw) => txt === kw || txt.includes(kw));
        });
        if (btn) {
            btn.click();
            await sleep(randomDelay(260, 420));
            return true;
        }
        return false;
    };

    // --- Leitor Nativo do #sessao-painel ---
    const readNativeSessionPanel = () => {
        const panel = document.getElementById('sessao-painel');
        if (!panel) return null;

        const hasData = panel.querySelector('b[data-k]');
        if (!hasData) return null;

        const getDataK = (k, signed = false) => {
            const el = panel.querySelector(`b[data-k="${k}"]`);
            if (!el) return 0;
            const fn = signed ? parseSignedNumber : parseNumber;
            return fn(el.textContent) ?? 0;
        };

        const sumPrefix = (prefix) => {
            let total = 0;
            panel.querySelectorAll(`b[data-k^="${prefix}"]`).forEach((el) => {
                total += parseNumber(el.textContent) ?? 0;
            });
            return total;
        };

        const getById = (id, signed = false) => {
            const el = panel.querySelector(`#${id}`);
            if (!el) return 0;
            const fn = signed ? parseSignedNumber : parseNumber;
            return fn(el.textContent) ?? 0;
        };

        const boosts = {};
        panel.querySelectorAll('.bxp-f[data-f]').forEach((icon) => {
            boosts[icon.getAttribute('data-f')] = icon.classList.contains('on');
        });

        const lugar = (panel.querySelector('.ss-lugar')?.textContent || '').replace('·', '').trim();

        return {
            xpBonusText: panel.querySelector('.bxp-total b')?.textContent?.trim() || '+0%',
            boosts,
            lugar,
            xpTreinador: getDataK('xpTreinador'),
            xpPokemon: getDataK('xpPokemon'),
            gold: getDataK('gold'),
            abates: getDataK('abates'),
            capturas: getDataK('capturas'),
            gasto: getDataK('gasto'),
            lucro: getDataK('lucro', true),
            shiniesVistos: getDataK('shiniesVistos'),
            shinies: getDataK('shinies'),
            pocoesUsadas: sumPrefix('pocao:'),
            revivesUsados: sumPrefix('revive:'),
            bolasUsadas: sumPrefix('bola:'),
            xpPokemonH: getById('sessao-xp-pokemon-h'),
            goldH: getById('sessao-gold-h'),
            lucroH: getById('sessao-lucro-h', true),
            abatesH: getById('sessao-abates-h'),
            tempo: panel.querySelector('#sessao-tempo')?.textContent?.trim() || '0:00:00',
        };
    };

    const isInSpecialArena = () => {
        const native = readNativeSessionPanel();
        if (native?.lugar) {
            const loc = normalizeText(native.lugar);
            if (loc.includes('boss') || loc.includes('mistica') || loc.includes('safari') || loc.includes('raid')) {
                return true;
            }
        }
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            if (isInsideHud(btn)) continue;
            const txt = normalizeText(btn.textContent);
            if ((txt.includes('abandonar arena') || txt.includes('sair de casa')) && isInteractable(btn)) {
                return true;
            }
        }
        return false;
    };

    const withModalLock = async (ownerLabel, fn, { force = false } = {}) => {
        if (!state.running || (state.paused && !force)) return null;
        if (!force && isInSpecialArena()) return null;
        if (!force && CONFIG.shinyGuard.enabled && state.shinyAlertActive) return null;
        if (state.modalLockOwner) return null;

        state.modalLockOwner = ownerLabel;
        setStatus(ownerLabel);
        try {
            return await fn();
        } finally {
            state.modalLockOwner = null;
            setStatus(state.paused ? 'Pausado' : 'Ativo');
            if (state.observedCaidosNode) {
                processCaidos(state.observedCaidosNode);
            }
        }
    };

    const getHuntTypeMultiplier = (attackerTypes, defenderTypes) => {
        if (!attackerTypes?.length || !defenderTypes?.length) return 1;
        let best = 0;
        for (const atk of attackerTypes) {
            const chart = TYPE_CHART[atk.toUpperCase()] || {};
            let raw = 1;
            for (const def of defenderTypes) {
                const factor = chart[def.toUpperCase()];
                raw *= factor !== undefined ? factor : 1;
            }
            const amp = HUNT_AMP[raw] !== undefined ? HUNT_AMP[raw] : raw;
            if (amp > best) best = amp;
        }
        return best;
    };

    // --- Leitores de Estado Travados no DOM Real (O(1)) ---
    const getTrainerHeaderInfo = () => ({
        level: parseNumber(document.getElementById('tr-level')?.textContent),
        gold: parseNumber(document.getElementById('tr-gold')?.textContent),
        diamonds: parseNumber(document.getElementById('tr-diamantes')?.textContent),
        gems: parseNumber(document.getElementById('tr-gemas')?.textContent),
    });

    const getActivePokemon = () => {
        const card = document.getElementById('ativo-card');
        if (!card || !isVisible(card)) return null;

        const nameEl = card.querySelector('.ativo-nome');
        const lvEl = card.querySelector('.pl-lv');
        const level = parseNumber(lvEl?.textContent);
        const name = getDirectText(nameEl);

        const types = [];
        card.querySelectorAll('.ativo-sub .tipo').forEach((el) => {
            const t = normalizeText(el.textContent).toUpperCase();
            if (VALID_TYPES.has(t) && !types.includes(t)) types.push(t);
        });

        const subTxt = card.querySelector('.ativo-sub')?.textContent || '';
        const powerMatch = subTxt.match(/poder\s+([\d.]+)/i);
        const power = powerMatch ? parseNumber(powerMatch[1]) : null;

        const hpTxt = card.querySelector('.barra.hp span')?.textContent || '';
        const hpMatch = hpTxt.match(/([\d.]+)\s*\/\s*([\d.]+)/);
        const hpCurrent = hpMatch ? parseNumber(hpMatch[1]) : null;
        const hpMax = hpMatch ? parseNumber(hpMatch[2]) : null;

        let hpPercent = null;
        if (hpCurrent !== null && hpMax) {
            hpPercent = Math.round((hpCurrent / hpMax) * 100);
        } else {
            const fillW = card.querySelector('.barra.hp .fill')?.style?.width;
            if (fillW && fillW.endsWith('%')) hpPercent = Math.round(parseFloat(fillW));
        }

        return { name, level, types, power, hpCurrent, hpMax, hpPercent };
    };

    const getCurrentHunt = () => {
        const el = document.getElementById('hud-hunt');
        if (!el || !isVisible(el)) return null;

        const text = (el.textContent || '').trim();
        const match = text.match(/^(.+?)\s*·\s*n[ií]vel\s*([\d.]+)$/i);
        if (!match) return null;

        return {
            key: text,
            pokeId: el.getAttribute('data-poke-id') || null,
            targetName: match[1].trim(),
            targetLevel: parseNumber(match[2]),
        };
    };

    const getSeasonalDayType = () => {
        const btn = document.getElementById('cena-dia-tipo');
        if (btn) {
            const dataTipo = (btn.getAttribute('data-tipo') || '').toUpperCase();
            if (VALID_TYPES.has(dataTipo)) {
                state.seasonalDayType = dataTipo;
                return dataTipo;
            }
            const imgSrc = btn.querySelector('img')?.getAttribute('src') || '';
            const typeMatch = imgSrc.match(/\/tipos\/([a-z]+)\./i);
            if (typeMatch) {
                const candidate = typeMatch[1].toUpperCase();
                if (VALID_TYPES.has(candidate)) {
                    state.seasonalDayType = candidate;
                    return candidate;
                }
            }
            const probe = normalizeText(btn.getAttribute('title') || btn.textContent || '');
            for (const [dayName, type] of Object.entries(SEASONAL_DAYS)) {
                if (probe.includes(dayName)) {
                    state.seasonalDayType = type;
                    return type;
                }
            }
        }
        return state.seasonalDayType;
    };

    const readChipsByContainer = (id) => {
        const container = document.getElementById(id);
        if (!container) return null;
        return Array.from(container.querySelectorAll('.auto-chip')).map((chip) =>
            parseNumber(chip.querySelector('.q')?.textContent ?? chip.textContent)
        );
    };

    const getInventorySnapshot = () => {
        const balls = readChipsByContainer('auto-ball-opts');
        const revives = readChipsByContainer('auto-revive-opts');
        const potions = readChipsByContainer('auto-potion-opts');
        const sumValid = (arr) => {
            if (!arr) return null;
            const valid = arr.filter((n) => n !== null);
            return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
        };
        return {
            panelOpen: Boolean(balls),
            balls,
            revives,
            potions,
            pokeBalls: balls ? balls[0] : null,
            totalBalls: sumValid(balls),
            maxRevives: revives ? revives[0] : null,
            reviveNormal: revives && revives.length > 1 ? revives[1] : revives ? revives[0] : null,
            totalRevives: sumValid(revives),
            smallPotions: potions && potions.length ? potions[potions.length - 1] : null,
        };
    };

    const getTargetBallTier = () => {
        if (!CONFIG.restock.autoUpgradeBalls) return BALL_TIERS[0];
        const { gold } = getTrainerHeaderInfo();
        const available = Math.max(0, (gold ?? 0) - CONFIG.restock.minGoldReserve);
        let chosen = BALL_TIERS[0];
        for (const tier of BALL_TIERS) {
            if (available >= tier.minGold) chosen = tier;
        }
        return chosen;
    };

    // --- 13. HUD 3 Abas (Isolado com CSS contain + Dirty-Checking) ---
    const injectHudStyles = () => {
        document.getElementById(STYLE_ID)?.remove();
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${HUD_ID} {
                position: fixed; z-index: 99999; width: 304px;
                contain: layout style paint;
                font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
                font-size: 11.5px; color: #e8eef8;
                background: rgba(13, 18, 29, 0.94); backdrop-filter: blur(8px);
                border: 1px solid rgba(114, 152, 255, 0.38); border-radius: 10px;
                box-shadow: 0 10px 28px rgba(0, 0, 0, 0.58); user-select: none; overflow: hidden;
            }
            #${HUD_ID}.min { width: auto; min-width: 210px; }
            #${HUD_ID} .pb-head {
                display: flex; align-items: center; justify-content: space-between;
                padding: 7px 9px; background: rgba(34, 48, 78, 0.88); cursor: grab;
                border-bottom: 1px solid rgba(255,255,255,0.08);
            }
            #${HUD_ID} .pb-head:active { cursor: grabbing; }
            #${HUD_ID} .pb-title { display: flex; align-items: center; gap: 6px; font-weight: 700; }
            #${HUD_ID} .pb-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px #22c55e; }
            #${HUD_ID} .pb-dot.warn { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
            #${HUD_ID} .pb-dot.shiny { background: #fde047; box-shadow: 0 0 8px #fde047; }
            #${HUD_ID} .pb-dot.off { background: #ef4444; box-shadow: none; }
            #${HUD_ID} .pb-head-btns { display: flex; gap: 4px; }
            #${HUD_ID} .pb-icon-btn {
                border: none; background: rgba(255,255,255,0.12); color: #e8eef8;
                width: 20px; height: 20px; border-radius: 5px; cursor: pointer; font-size: 12px; padding: 0;
            }
            #${HUD_ID} .pb-tabs { display: grid; grid-template-columns: repeat(3, 1fr); background: rgba(255,255,255,0.04); }
            #${HUD_ID} .pb-tab {
                border: none; background: transparent; color: #94a3b8; padding: 6px 4px;
                font-size: 11px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent;
            }
            #${HUD_ID} .pb-tab.on { color: #ffffff; border-bottom-color: #60a5fa; background: rgba(59,130,246,0.14); }
            #${HUD_ID}.min .pb-tabs, #${HUD_ID}.min .pb-body { display: none; }
            #${HUD_ID} .pb-body { padding: 8px 9px; display: flex; flex-direction: column; gap: 7px; }
            #${HUD_ID} .pb-pane { display: none; flex-direction: column; gap: 7px; }
            #${HUD_ID} .pb-pane.on { display: flex; }
            #${HUD_ID} .pb-grid {
                display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px;
                background: rgba(255,255,255,0.04); padding: 6px 7px; border-radius: 6px;
            }
            #${HUD_ID} .pb-row { display: flex; justify-content: space-between; gap: 4px; }
            #${HUD_ID} .pb-lbl { color: #94a3b8; font-size: 10.5px; }
            #${HUD_ID} .pb-val { font-weight: 600; color: #f8fafc; font-size: 10.5px; text-align: right; }
            #${HUD_ID} .pb-span2 { grid-column: span 2; }
            #${HUD_ID} .pb-sec { font-size: 10px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.4px; }
            #${HUD_ID} .pb-modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
            #${HUD_ID} .pb-btn {
                border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06);
                color: #dbe6f6; border-radius: 6px; padding: 5px 4px; font-size: 10.5px; font-weight: 600; cursor: pointer;
            }
            #${HUD_ID} .pb-btn:hover { background: rgba(114, 152, 255, 0.22); }
            #${HUD_ID} .pb-btn.on { background: rgba(59, 130, 246, 0.35); border-color: #60a5fa; color: #fff; }
            #${HUD_ID} .pb-toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
            #${HUD_ID} .pb-tog {
                display: flex; align-items: center; justify-content: space-between;
                padding: 4px 6px; border-radius: 6px; background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08); cursor: pointer; font-size: 10.5px;
            }
            #${HUD_ID} .pb-tog.on { border-color: rgba(34, 197, 94, 0.55); background: rgba(34, 197, 94, 0.13); }
            #${HUD_ID} .pb-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
            #${HUD_ID} .pb-actions3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
            #${HUD_ID} .pb-actions4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
            #${HUD_ID} .pb-form { display: grid; grid-template-columns: 1fr 74px 54px; gap: 4px; }
            #${HUD_ID} input, #${HUD_ID} select, #${HUD_ID} textarea {
                background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15);
                color: #f8fafc; border-radius: 5px; padding: 4px 5px; font-size: 10.5px; width: 100%; box-sizing: border-box;
                user-select: text; -webkit-user-select: text; font-family: inherit;
            }
            #${HUD_ID} textarea { resize: vertical; min-height: 34px; max-height: 120px; }
            #${HUD_ID} .pb-list {
                max-height: 78px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px;
                background: rgba(255,255,255,0.03); padding: 4px 5px; border-radius: 6px;
            }
            #${HUD_ID} .pb-chips { display: flex; flex-wrap: wrap; gap: 4px; }
            #${HUD_ID} .pb-chip {
                border: 1px solid rgba(96,165,250,0.45); background: rgba(59,130,246,0.18);
                color: #e0f2fe; border-radius: 5px; padding: 2px 6px; font-size: 10.5px; cursor: pointer;
            }
            #${HUD_ID} .pb-chip:hover { background: rgba(59,130,246,0.38); }
            #${HUD_ID} .pb-item { display: flex; justify-content: space-between; align-items: center; gap: 4px; font-size: 10.5px; }
            #${HUD_ID} .pb-del { border: none; background: rgba(239,68,68,0.22); color: #fca5a5; border-radius: 4px; cursor: pointer; padding: 1px 5px; font-size: 10px; }
            #${HUD_ID} .pb-note {
                font-size: 10px; color: #93c5fd; white-space: nowrap; overflow: hidden;
                text-overflow: ellipsis; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 5px;
            }
        `;
        document.head.appendChild(style);
    };

    const renderAlertList = () => {
        const alertList = state.hudEl?.querySelector('[data-pb="alertList"]');
        if (!alertList) return;
        alertList.innerHTML =
            CONFIG.radar.alerts.length === 0
                ? 'Nenhum alerta configurado.'
                : CONFIG.radar.alerts
                      .map(
                          (a, idx) =>
                              `<div class="pb-item"><span>${escapeHtml(a.nome)} ≤ ${a.maxPreco.toLocaleString('pt-BR')} ${escapeHtml(a.moeda)}</span><button class="pb-del" data-pb-del="${idx}">×</button></div>`
                      )
                      .join('');
    };

    const renderQuizCandidates = () => {
        const quizList = state.hudEl?.querySelector('[data-pb="quizList"]');
        if (!quizList) return;

        const sig = `${state.dexCatalog.length}|${state.miniGameMatches.join(',')}`;
        if (sig === state.lastQuizSigRendered) return;
        state.lastQuizSigRendered = sig;

        if (state.dexCatalog.length === 0) {
            quizList.textContent = 'Baixe o .csv na Pokedex e importe abaixo.';
        } else if (state.miniGameMatches.length === 0) {
            quizList.textContent = 'Abra o Mini Games durante uma rodada com pistas.';
        } else {
            quizList.innerHTML = `<div class="pb-chips">${state.miniGameMatches
                .map((name) => `<button class="pb-chip" data-pb-guess="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
                .join('')}</div>`;
        }
    };

    const mountHud = () => {
        document.getElementById(HUD_ID)?.remove();
        injectHudStyles();
        state.hudCache = {};

        const hud = document.createElement('div');
        hud.id = HUD_ID;
        if (CONFIG.hud.minimized) hud.classList.add('min');
        hud.style.left = `${CONFIG.hud.left}px`;
        hud.style.top = `${CONFIG.hud.top}px`;

        hud.innerHTML = `
            <div class="pb-head" data-pb-drag="1">
                <div class="pb-title">
                    <span class="pb-dot" data-pb="dot"></span>
                    <span data-pb="headTitle">PokeBot v${VERSION}</span>
                </div>
                <div class="pb-head-btns">
                    <button class="pb-icon-btn" data-pb-act="min" title="Minimizar">—</button>
                    <button class="pb-icon-btn" data-pb-act="stop" title="Encerrar">×</button>
                </div>
            </div>
            <div class="pb-tabs">
                <button class="pb-tab" data-pb-tab="geral">Geral</button>
                <button class="pb-tab" data-pb-tab="modulos">Módulos</button>
                <button class="pb-tab" data-pb-tab="radar">Radar/Quiz</button>
            </div>
            <div class="pb-body">
                <div class="pb-pane" data-pb-pane="geral">
                    <div class="pb-grid">
                        <div class="pb-row pb-span2"><span class="pb-lbl">Pokémon</span><span class="pb-val" data-pb="poke">-</span></div>
                        <div class="pb-row pb-span2"><span class="pb-lbl">Região</span><span class="pb-val" data-pb="regiao">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">XP/h</span><span class="pb-val" data-pb="xpH">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">Lucro/h</span><span class="pb-val" data-pb="lucroH">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">Bônus / Dia</span><span class="pb-val" data-pb="xpBonus">-</span></div>
                        <div class="pb-row"><span class="pb-lbl">Fila /hunt</span><span class="pb-val" data-pb="huntQueue">0</span></div>
                        <div class="pb-row"><span class="pb-lbl">Capturas</span><span class="pb-val" data-pb="caps">0</span></div>
                        <div class="pb-row"><span class="pb-lbl">B/P/R</span><span class="pb-val" data-pb="inv">-</span></div>
                    </div>
                    <div class="pb-sec">Modo de Farm</div>
                    <div class="pb-modes">
                        <button class="pb-btn" data-pb-mode="xp">XP</button>
                        <button class="pb-btn" data-pb-mode="ouro">Ouro</button>
                        <button class="pb-btn" data-pb-mode="equilibrado">Equil.</button>
                        <button class="pb-btn" data-pb-mode="topcatch">Catch</button>
                    </div>
                    <div class="pb-actions3">
                        <button class="pb-btn" data-pb-act="syncGuide">Montar Fila</button>
                        <button class="pb-btn" data-pb-act="nextQueue">Próx. Fila</button>
                        <button class="pb-btn" data-pb-act="copyActiveSheet">Copiar Ficha</button>
                    </div>
                    <div class="pb-actions">
                        <button class="pb-btn" data-pb-act="copyHub">Ficha + abrir Hub</button>
                    </div>
                    <div class="pb-sec">Fila Manual (cole do Hub)</div>
                    <textarea id="pb-manual-queue" rows="2" placeholder="Kakuna Nv 10 &gt; Magnemite Nv 10 ..."></textarea>
                    <div class="pb-actions3">
                        <button class="pb-btn" data-pb-act="loadManual">Carregar</button>
                        <button class="pb-btn" data-pb-act="loadManualGo">Carregar e ir</button>
                        <button class="pb-btn" data-pb-act="clearQueue">Limpar</button>
                    </div>
                    <div class="pb-actions">
                        <button class="pb-btn" data-pb-act="optimize">Otimizar Mapa</button>
                        <button class="pb-btn" data-pb-act="hop">Próx. TopCatch</button>
                        <button class="pb-btn" data-pb-act="restock">Restock Agora</button>
                        <button class="pb-btn" data-pb-act="pause" data-pb="pauseBtn">Pausar</button>
                    </div>
                </div>

                <div class="pb-pane" data-pb-pane="modulos">
                    <div class="pb-toggles">
                        <div class="pb-tog" data-pb-tog="caidos"><span>Auto-Catch</span><b data-pb-tval="caidos">ON</b></div>
                        <div class="pb-tog" data-pb-tog="smartBall"><span>Bola Intelig.</span><b data-pb-tval="smartBall">ON</b></div>
                        <div class="pb-tog" data-pb-tog="shinyGuard"><span>Shiny Guard</span><b data-pb-tval="shinyGuard">ON</b></div>
                        <div class="pb-tog" data-pb-tog="restock"><span>Restock</span><b data-pb-tval="restock">ON</b></div>
                        <div class="pb-tog" data-pb-tog="upgradeBalls"><span>Upgrade Bola</span><b data-pb-tval="upgradeBalls">ON</b></div>
                        <div class="pb-tog" data-pb-tog="restockRevive"><span>Restock Revive</span><b data-pb-tval="restockRevive">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="topCatchHop"><span>TopCatch Hop</span><b data-pb-tval="topCatchHop">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="dailyPass"><span>Auto-Passe</span><b data-pb-tval="dailyPass">ON</b></div>
                        <div class="pb-tog" data-pb-tog="incubator"><span>Chocadeira</span><b data-pb-tval="incubator">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="autoRegion"><span>Auto-Mapa</span><b data-pb-tval="autoRegion">ON</b></div>
                        <div class="pb-tog" data-pb-tog="evolve"><span>Auto-Evoluir</span><b data-pb-tval="evolve">OFF</b></div>
                        <div class="pb-tog" data-pb-tog="depotMode"><span>Depot</span><b data-pb-tval="depotMode">OFF</b></div>
                        <div class="pb-tog pb-span2" data-pb-tog="teamMode"><span>Equipe / Dia Sazonal</span><b data-pb-tval="teamMode">OFF</b></div>
                        <div class="pb-tog pb-span2" data-pb-tog="queueFallback"><span>Fila: Fallback Seguro</span><b data-pb-tval="queueFallback">ON</b></div>
                        <div class="pb-tog pb-span2" data-pb-tog="bossPriority"><span>Auto-Boss (Rotação)</span><b data-pb-tval="bossPriority">OFF</b></div>
                    </div>
                    <div class="pb-sec">Executar Agora</div>
                    <div class="pb-actions4">
                        <button class="pb-btn" data-pb-act="runDepot">Depot</button>
                        <button class="pb-btn" data-pb-act="runPass">Passe</button>
                        <button class="pb-btn" data-pb-act="runEggs">Ovos</button>
                        <button class="pb-btn" data-pb-act="runBoss">Boss</button>
                    </div>
                </div>

                <div class="pb-pane" data-pb-pane="radar">
                    <div class="pb-sec">Radar RMT (Mercado da Comunidade)</div>
                    <div class="pb-form">
                        <input type="text" data-pb-in="rName" placeholder="Ex: Garchomp" />
                        <input type="number" data-pb-in="rPrice" placeholder="Máx $" />
                        <select data-pb-in="rCur">
                            <option value="coins">Coins</option>
                            <option value="gemas">Gemas</option>
                        </select>
                    </div>
                    <button class="pb-btn" data-pb-act="addAlert">+ Adicionar Alerta RMT</button>
                    <div class="pb-list" data-pb="alertList">Nenhum alerta.</div>
                    <div class="pb-sec">Mini Games (<span data-pb="dexCount">0</span> espécies · clique p/ enviar)</div>
                    <div class="pb-tog" data-pb-tog="autoGuess"><span>Auto-Palpite (≤3 candid.)</span><b data-pb-tval="autoGuess">OFF</b></div>
                    <div class="pb-list" data-pb="quizList">Importe o .csv da Pokedex.</div>
                    <button class="pb-btn" data-pb-act="importDex">Importar Pokedex (.csv)</button>
                </div>

                <div class="pb-note" data-pb="note">Pronto</div>
            </div>
        `;

        document.body.appendChild(hud);
        state.hudEl = hud;

        const head = hud.querySelector('[data-pb-drag="1"]');
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        const onMouseDown = (e) => {
            if (e.target.closest('button')) return;
            dragging = true;
            const rect = hud.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
        };
        const onMouseMove = (e) => {
            if (!dragging) return;
            const left = Math.max(4, Math.min(window.innerWidth - 60, e.clientX - offsetX));
            const top = Math.max(4, Math.min(window.innerHeight - 40, e.clientY - offsetY));
            hud.style.left = `${left}px`;
            hud.style.top = `${top}px`;
            CONFIG.hud.left = Math.round(left);
            CONFIG.hud.top = Math.round(top);
        };
        const onMouseUp = () => {
            if (!dragging) return;
            dragging = false;
            persistPrefs();
        };

        head.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        state.cleanupListeners.push(() => {
            head.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        });

        const onHudClick = (e) => {
            const tabBtn = e.target.closest('[data-pb-tab]');
            if (tabBtn) {
                CONFIG.hud.tab = tabBtn.getAttribute('data-pb-tab');
                persistPrefs();
                updateHud();
                return;
            }
            const modeBtn = e.target.closest('[data-pb-mode]');
            if (modeBtn) {
                setMode(modeBtn.getAttribute('data-pb-mode'), false);
                return;
            }
            const delBtn = e.target.closest('[data-pb-del]');
            if (delBtn) {
                removerAlertaRadar(parseInt(delBtn.getAttribute('data-pb-del'), 10));
                return;
            }
            const guessBtn = e.target.closest('[data-pb-guess]');
            if (guessBtn) {
                const name = guessBtn.getAttribute('data-pb-guess');
                if (name && applyMiniGameGuess(name, true)) {
                    state.roundTriedNames.add(cleanKey(name));
                    state.lastActionNote = `Palpite enviado: ${name}`;
                    renderQuizCandidates();
                    updateHud();
                }
                return;
            }
            const tog = e.target.closest('[data-pb-tog]');
            if (tog) {
                const key = tog.getAttribute('data-pb-tog');
                if (key === 'caidos') CONFIG.caidos.enabled = !CONFIG.caidos.enabled;
                if (key === 'smartBall') CONFIG.caidos.smartBallSelect = !CONFIG.caidos.smartBallSelect;
                if (key === 'shinyGuard') CONFIG.shinyGuard.enabled = !CONFIG.shinyGuard.enabled;
                if (key === 'restock') CONFIG.restock.enabled = !CONFIG.restock.enabled;
                if (key === 'upgradeBalls') CONFIG.restock.autoUpgradeBalls = !CONFIG.restock.autoUpgradeBalls;
                if (key === 'restockRevive') CONFIG.restock.restockRevive = !CONFIG.restock.restockRevive;
                if (key === 'topCatchHop') CONFIG.topCatchHop.enabled = !CONFIG.topCatchHop.enabled;
                if (key === 'dailyPass') CONFIG.dailyPass.enabled = !CONFIG.dailyPass.enabled;
                if (key === 'incubator') {
                    CONFIG.incubator.enabled = !CONFIG.incubator.enabled;
                    state.nextIncubatorCheckAt = 0;
                }
                if (key === 'autoRegion') CONFIG.autoRegion.enabled = !CONFIG.autoRegion.enabled;
                if (key === 'evolve') CONFIG.evolve.enabled = !CONFIG.evolve.enabled;
                if (key === 'queueFallback') CONFIG.huntQueue.fallbackToSafeArea = !CONFIG.huntQueue.fallbackToSafeArea;
                if (key === 'autoGuess') CONFIG.minigame.autoGuess = !CONFIG.minigame.autoGuess;
                if (key === 'depotMode') {
                    CONFIG.depot.mode = DEPOT_MODES[(DEPOT_MODES.indexOf(CONFIG.depot.mode) + 1) % DEPOT_MODES.length];
                }
                if (key === 'teamMode') {
                    CONFIG.team.mode = TEAM_MODES[(TEAM_MODES.indexOf(CONFIG.team.mode) + 1) % TEAM_MODES.length];
                }
                if (key === 'bossPriority') {
                    CONFIG.boss.priority = BOSS_PRIORITIES[(BOSS_PRIORITIES.indexOf(CONFIG.boss.priority) + 1) % BOSS_PRIORITIES.length];
                }
                persistPrefs();
                updateHud();
                return;
            }
            const actBtn = e.target.closest('[data-pb-act]');
            if (!actBtn) return;
            const act = actBtn.getAttribute('data-pb-act');

            if (act === 'min') {
                CONFIG.hud.minimized = !CONFIG.hud.minimized;
                hud.classList.toggle('min', CONFIG.hud.minimized);
                persistPrefs();
            } else if (act === 'stop') {
                stop();
            } else if (act === 'pause') {
                state.paused ? retomar() : pausar();
            } else if (act === 'syncGuide') {
                syncHuntGuideQueue(true);
            } else if (act === 'nextQueue') {
                irProximaHuntGuia(true);
            } else if (act === 'copyActiveSheet') {
                copyActiveSheet();
            } else if (act === 'copyHub') {
                copyActiveSheet({ openSite: true });
            } else if (act === 'loadManual') {
                loadManualQueue(false);
            } else if (act === 'loadManualGo') {
                loadManualQueue(true);
            } else if (act === 'clearQueue') {
                limparFilaHunt();
            } else if (act === 'optimize') {
                otimizarRegiao({ modo: CONFIG.mode, force: true });
            } else if (act === 'hop') {
                hopNextTopCatchArea(true);
            } else if (act === 'restock') {
                smartRestock(true);
            } else if (act === 'runDepot') {
                if (CONFIG.depot.mode === 'off') {
                    state.lastActionNote = 'Selecione Venda, Oferenda ou Sacrifício';
                    updateHud();
                } else {
                    runDepotManager(true);
                }
            } else if (act === 'runPass') {
                checkDailyPass(true);
            } else if (act === 'runEggs') {
                checkIncubator(true);
            } else if (act === 'runBoss') {
                checkBosses(true);
            } else if (act === 'importDex') {
                abrirSeletorCsvPokedex();
            } else if (act === 'addAlert') {
                const nameEl = hud.querySelector('[data-pb-in="rName"]');
                const priceEl = hud.querySelector('[data-pb-in="rPrice"]');
                const curEl = hud.querySelector('[data-pb-in="rCur"]');
                if (nameEl?.value && priceEl?.value) {
                    adicionarAlertaRadar({
                        nome: nameEl.value,
                        maxPreco: parseInt(priceEl.value, 10),
                        moeda: curEl?.value || 'coins',
                    });
                    nameEl.value = '';
                    priceEl.value = '';
                }
            }
        };

        hud.addEventListener('click', onHudClick);
        state.cleanupListeners.push(() => hud.removeEventListener('click', onHudClick));

        // Digitar/colar nos campos do HUD não deve disparar atalhos do jogo
        const stopKeys = (e) => {
            if (e.target.closest('input, textarea, select')) e.stopPropagation();
        };
        ['keydown', 'keyup', 'keypress'].forEach((evt) => hud.addEventListener(evt, stopKeys));
        state.cleanupListeners.push(() =>
            ['keydown', 'keyup', 'keypress'].forEach((evt) => hud.removeEventListener(evt, stopKeys))
        );

        renderAlertList();
        renderQuizCandidates();
    };

    const updateHud = () => {
        const hud = state.hudEl;
        if (!hud || !hud.isConnected) return;

        const native = readNativeSessionPanel();
        const poke = getActivePokemon();
        const inv = getInventorySnapshot();
        const farm = state.session ? computeSessionMetrics(state.session) : null;
        const dayType = getSeasonalDayType();

        const setText = (attr, val) => {
            const strVal = String(val);
            if (state.hudCache[attr] === strVal) return;
            state.hudCache[attr] = strVal;
            const el = hud.querySelector(`[data-pb="${attr}"]`);
            if (el) el.textContent = strVal;
        };

        const dotMode = state.paused
            ? 'off'
            : state.shinyAlertActive
            ? 'shiny'
            : state.modalLockOwner
            ? 'warn'
            : 'on';

        if (state.hudCache.__dot !== dotMode) {
            state.hudCache.__dot = dotMode;
            const dot = hud.querySelector('[data-pb="dot"]');
            if (dot) {
                dot.classList.remove('warn', 'off', 'shiny');
                if (dotMode !== 'on') dot.classList.add(dotMode);
            }
        }

        if (state.hudCache.__tab !== CONFIG.hud.tab) {
            state.hudCache.__tab = CONFIG.hud.tab;
            hud.querySelectorAll('[data-pb-tab]').forEach((b) =>
                b.classList.toggle('on', b.getAttribute('data-pb-tab') === CONFIG.hud.tab)
            );
            hud.querySelectorAll('[data-pb-pane]').forEach((p) =>
                p.classList.toggle('on', p.getAttribute('data-pb-pane') === CONFIG.hud.tab)
            );
        }

        setText('headTitle', `PokeBot v${VERSION} · ${state.shinyAlertActive ? '✨ SHINY!' : state.statusText}`);
        setText('poke', poke ? `${poke.name} Nv${poke.level ?? '?'} (${poke.types.join('/') || '-'})` : '-');
        setText('regiao', farm ? farm.regiao : '-');
        setText(
            'xpH',
            native ? `${native.xpPokemonH.toLocaleString('pt-BR')}/h` : `${((farm?.xpPokeMin ?? 0) * 60).toLocaleString('pt-BR')}/h`
        );
        setText(
            'lucroH',
            native ? `${native.lucroH.toLocaleString('pt-BR')}/h` : `${((farm?.lucroLiqMin ?? 0) * 60).toLocaleString('pt-BR')}/h`
        );
        setText('xpBonus', `${native ? native.xpBonusText : '-'} · ${dayType || '-'}`);
        setText(
            'huntQueue',
            state.huntQueue.length > 0
                ? `${Math.min(state.huntQueueIndex + 1, state.huntQueue.length)}/${state.huntQueue.length}`
                : '0'
        );
        setText('caps', native ? String(native.capturas) : String(state.stats.captures));
        setText(
            'inv',
            inv.panelOpen
                ? `${inv.totalBalls ?? '-'}/${inv.smallPotions ?? '-'}/${inv.totalRevives ?? '-'}`
                : 'Abra Auto!'
        );
        setText('pauseBtn', state.paused ? 'Retomar' : 'Pausar');
        setText('dexCount', String(state.dexCatalog.length));
        setText('note', isInSpecialArena() ? 'Arena especial (protegido)' : state.lastActionNote);

        if (state.hudCache.__mode !== CONFIG.mode) {
            state.hudCache.__mode = CONFIG.mode;
            hud.querySelectorAll('[data-pb-mode]').forEach((btn) =>
                btn.classList.toggle('on', btn.getAttribute('data-pb-mode') === CONFIG.mode)
            );
        }

        const toggles = {
            caidos: [CONFIG.caidos.enabled, CONFIG.caidos.enabled ? 'ON' : 'OFF'],
            smartBall: [CONFIG.caidos.smartBallSelect, CONFIG.caidos.smartBallSelect ? 'ON' : 'OFF'],
            shinyGuard: [CONFIG.shinyGuard.enabled, CONFIG.shinyGuard.enabled ? 'ON' : 'OFF'],
            restock: [CONFIG.restock.enabled, CONFIG.restock.enabled ? 'ON' : 'OFF'],
            upgradeBalls: [CONFIG.restock.autoUpgradeBalls, CONFIG.restock.autoUpgradeBalls ? 'ON' : 'OFF'],
            restockRevive: [CONFIG.restock.restockRevive, CONFIG.restock.restockRevive ? 'ON' : 'OFF'],
            topCatchHop: [CONFIG.topCatchHop.enabled, CONFIG.topCatchHop.enabled ? 'ON' : 'OFF'],
            dailyPass: [CONFIG.dailyPass.enabled, CONFIG.dailyPass.enabled ? 'ON' : 'OFF'],
            incubator: [CONFIG.incubator.enabled, CONFIG.incubator.enabled ? 'ON' : 'OFF'],
            autoRegion: [CONFIG.autoRegion.enabled, CONFIG.autoRegion.enabled ? 'ON' : 'OFF'],
            evolve: [CONFIG.evolve.enabled, CONFIG.evolve.enabled ? 'ON' : 'OFF'],
            queueFallback: [CONFIG.huntQueue.fallbackToSafeArea, CONFIG.huntQueue.fallbackToSafeArea ? 'ON' : 'OFF'],
            autoGuess: [CONFIG.minigame.autoGuess, CONFIG.minigame.autoGuess ? 'ON' : 'OFF'],
            depotMode: [CONFIG.depot.mode !== 'off', CONFIG.depot.mode.toUpperCase()],
            teamMode: [CONFIG.team.mode !== 'off', CONFIG.team.mode.toUpperCase()],
            bossPriority: [CONFIG.boss.priority !== 'off', CONFIG.boss.priority.toUpperCase()],
        };

        Object.entries(toggles).forEach(([key, [isOn, label]]) => {
            const sig = `${isOn}|${label}`;
            if (state.hudCache[`__t_${key}`] === sig) return;
            state.hudCache[`__t_${key}`] = sig;
            const box = hud.querySelector(`[data-pb-tog="${key}"]`);
            const val = hud.querySelector(`[data-pb-tval="${key}"]`);
            if (box) box.classList.toggle('on', isOn);
            if (val) val.textContent = label;
        });

        renderQuizCandidates();
    };

    const unmountHud = () => {
        state.cleanupListeners.forEach((fn) => fn());
        state.cleanupListeners = [];
        document.getElementById(HUD_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
        state.hudEl = null;
        state.hudCache = {};
    };

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
        runtime.dispose();
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
        otimizarRegiao: (options) => otimizarRegiao(options),
        syncHuntGuide: () => syncHuntGuideQueue(true),
        proximaHuntGuia: () => irProximaHuntGuia(true),
        definirFilaHunt: (list) => definirFilaHunt(list),
        carregarFilaManual: (irAgora) => loadManualQueue(irAgora),
        verificarEvolucao: () => autoEvolveCheck(),
        limparFilaHunt: () => limparFilaHunt(),
        copiarFichaHunt: (abrirSite) => copiarFichaHunt(abrirSite),
        copiarFichaAtivo: (options) => copyActiveSheet(options),
        hopTopCatch: () => hopNextTopCatchArea(true),
        rodarDepot: () => runDepotManager(true),
        checarPasse: () => checkDailyPass(true),
        checarOvos: () => checkIncubator(true),
        checarBoss: () => checkBosses(true),
        restockNow: () => smartRestock(true),
        adicionarAlertaRadar: (alerta) => adicionarAlertaRadar(alerta),
        removerAlertaRadar: (index) => removerAlertaRadar(index),
        importarPokedexCsv: () => abrirSeletorCsvPokedex(),
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
