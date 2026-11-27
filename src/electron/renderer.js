'use strict';

const GAME_URL = 'https://pokeidle.io/app';
const ACCOUNTS = [1, 2, 3, 4];
const STATUS_LABELS = {
    connected: 'Farmando',
    bridge: 'Embutido',
    connecting: 'Conectando',
    standby: 'Em espera',
    paused: 'Pausado',
    error: 'Erro',
    disconnected: 'Offline',
};

let activeAccount = 1;
let viewMode = 'split'; // 'split' | 'grid' | 'panel-only' | 'panels-grid'
let snapshots = {};
let webviewPreloadUrl = '';
let awakeEnabled = false;
const webviews = new Map(); // account -> webview element
const dirtyByAcc = { 1: false, 2: false, 3: false, 4: false };
const lastProfileSigByAcc = {};
let sharedHunts = [];
let huntsLoading = false;
let huntsPopulatedCount = 0;
let lastRenderedAccount = 0;
let lastSpriteKey = '';
let lastInvSig = '';
let lastLogSig = '';
let lastLiveChanSig = '';
let lastShinySig = '';
let chatReminderTimer = null;
let lastDropsSig = '';
let lastTrainerSig = '';
let lastSniperSig = '';
let lastAdvisorSig = '';
// Listas do consultor vêm à parte, só com o card à vista (o snapshot de 1,25 s traz só o resumo).
const ADVISOR_FETCH_MS = 15_000;
let advisorLists = { account: 0, at: 0, data: null, busy: false };
let advisorFilter = 'todos';
let advisorShowAll = false;
let pollTimer = null;
let huntCountdownTimer = null;
let toastPos = (() => {
    try {
        if (localStorage.getItem('nexo_toast_enabled') === '0') return 'off';
        const saved = localStorage.getItem('nexo_toast_pos');
        if (saved && ['top-right', 'top-center', 'bottom-right'].includes(saved)) return saved;
        return 'top-right';
    } catch {
        return 'top-right';
    }
})();
let toastsEnabled = toastPos !== 'off';
const toastBaselineByAcc = {};
const recentToastMap = new Map();
let serverShinyToastBaselineDone = false;
let lastServerShinyToastKey = '';
let lastNotifiedUpdateVersion = '';
let currentUpdateState = null;

const POTION_LABELS = {
    200: 'Small Potion',
    201: 'Great Potion',
    202: 'Ultra Potion',
    203: 'Hyper Potion',
    204: 'Ultimate Potion',
    70070: 'Golden Potion',
};
const LIVE_CHANNEL_REWARD_OPTIONS = [
    ['', 'Padrão da plataforma'],
    ['xp', 'Só XP (+15%)'],
    ['captura', 'Só Captura (+15%)'],
    ['shiny', 'Só Shiny (+15%)'],
    ['xp,captura', 'XP + Captura'],
    ['xp,shiny', 'XP + Shiny'],
    ['captura,shiny', 'Captura + Shiny'],
    ['all', 'Todos (XP + Cap + Shiny)'],
    ['off', 'Não resgatar (só pts)'],
];

const $ = (id) => document.getElementById(id);
// hub-ui.js preenche window.hubUi; aqui só chamamos se existir
const hubHook = (name, ...args) => {
    const fn = window.hubUi?.[name];
    if (typeof fn !== 'function') return undefined;
    try { return fn(...args); } catch (err) { console.error(`hubUi.${name}`, err); return undefined; }
};

function fmtNum(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v.toLocaleString('pt-BR') : '0';
}

function fmtUptime(sec) {
    const s = Math.max(0, Math.floor(Number(sec || 0)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return [h, m, r].map((v) => String(v).padStart(2, '0')).join(':');
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function buildSeedJs(seed) {
    if (!seed || !seed.token || !seed.nick) return null;
    const sessJson = JSON.stringify({
        nick: seed.nick,
        token: seed.token,
        provedor: seed.provedor || 'google',
    });
    const dev = seed.dispositivo || '';
    return `(() => {
        try {
            if (!/pokeidle\\.io/i.test(location.hostname || '')) return false;
            const cur = localStorage.getItem('sessao');
            let curTok = '';
            try { curTok = cur ? JSON.parse(cur).token || '' : ''; } catch {}
            const dev = ${JSON.stringify(dev)};
            if (dev && !localStorage.getItem('id-dispositivo')) {
                localStorage.setItem('id-dispositivo', dev);
            }
            if (curTok !== ${JSON.stringify(seed.token)}) {
                localStorage.setItem('sessao', ${JSON.stringify(sessJson)});
                return true;
            }
            return false;
        } catch {
            return false;
        }
    })()`;
}

// Vigia do jogo travado: a pagina carregou mas o jogo ficou na tela de abertura (logo com a barra de carga)
// sem conectar. Recarrega em 60 s, depois espera mais a cada vez (ate 5 min); da 2a vez em diante sem cache.
// Nao recarrega com aviso de conta aberta em outro lugar ou aviso da conta (tomaria a sessao ou nao adiantaria).
const STUCK_BASE_MS = 60_000;
const STUCK_PROBE_JS = `(() => {
  const shown = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden'); };
  if (shown('sessao-tomada')) return 'aberta em outro lugar';
  if (shown('alerta-conta')) return 'aviso da conta';
  if (/just a moment|um momento/i.test(document.title)) return 'cloudflare';
  for (const id of ['login', 'confirmar-email', 'escolher-nick', 'app']) {
    const e = document.getElementById(id);
    if (e && !e.classList.contains('hidden') && e.offsetParent !== null) return id;
  }
  const p = document.getElementById('carga-pct'), t = document.getElementById('carga-etapa');
  if (!p && !t) return 'outra pagina';
  return ('carga ' + (p ? p.textContent : '?') + '% ' + (t ? t.textContent : '')).trim();
})()`;
function markWebviewStuck(acc, wv, why, retry) {
    wv.__openSince = null;
    wv.__failedSince = null;
    wv.__stuckReloads = (wv.__stuckReloads || 0) + 1;
    showToast({ kind: 'warn', title: `Conta ${acc}: jogo travado no carregamento`, text: `${why}. Recarregando (${wv.__stuckReloads}ª vez).`, account: acc });
    try { retry(); } catch { /* ignore */ }
}
async function checkStuckWebview(acc, wv) {
    if (wv.__checking || webviews.get(acc) !== wv) return;
    const wait = STUCK_BASE_MS * Math.min((wv.__stuckReloads || 0) + 1, 5);
    const now = Date.now();
    if (wv.__failedSince) {
        if (now - wv.__failedSince >= wait / 2) markWebviewStuck(acc, wv, `A página não carregou em ${Math.round(wait / 2000)} s`, () => wv.reload());
        return;
    }
    if (!wv.__openSince) return;
    wv.__checking = true;
    let state = '';
    try { state = String(await wv.executeJavaScript(STUCK_PROBE_JS)); } catch { return; } finally { wv.__checking = false; }
    if (!state.startsWith('carga')) {
        wv.__openSince = null;
        wv.__stuckReloads = 0;
        return;
    }
    if (now - wv.__openSince >= wait) {
        const clean = (wv.__stuckReloads || 0) >= 1;
        markWebviewStuck(acc, wv, `O jogo não abriu em ${Math.round(wait / 1000)} s (${state})${clean ? ', sem cache' : ''}`, clean ? () => wv.reloadIgnoringCache() : () => wv.reload());
    }
}
setInterval(() => {
    for (const [acc, wv] of webviews) void checkStuckWebview(acc, wv);
}, 5_000);

const wvZoomObservers = new Map();
function wvAutoZoomOn() {
    try { return localStorage.getItem('nexo.wvAutoZoom') !== '0'; } catch { return true; }
}
// Em telas baixas da grade o jogo some com o mapa; afasta o zoom para caber (altura de referência ~700px).
function applyWebviewZoom(acc) {
    const wv = webviews.get(acc);
    const body = $(`wv-body-${acc}`);
    if (!wv || !body || !wv.__ready) return;
    let z = 1;
    if (wvAutoZoomOn() && body.clientHeight > 0) z = Math.max(0.6, Math.min(1, body.clientHeight / 700));
    z = Math.round(z * 20) / 20;
    if (wv.__zoom === z) return;
    try { wv.setZoomFactor(z); wv.__zoom = z; } catch { /* ainda carregando */ }
}
function setWebviewAutoZoom(on) {
    try { localStorage.setItem('nexo.wvAutoZoom', on ? '1' : '0'); } catch { /* ignore */ }
    for (const acc of webviews.keys()) applyWebviewZoom(acc);
}
window.nexoWvZoom = { isOn: wvAutoZoomOn, set: setWebviewAutoZoom };

async function openEmbeddedForAccount(acc) {
    if (webviews.has(acc)) return;
    const body = $(`wv-body-${acc}`);
    const ph = $(`wv-ph-${acc}`);
    if (!body) return;

    const res = await window.pokeHub.attachWebview(acc);
    if (!res?.ok) return;

    const wv = document.createElement('webview');
    wv.setAttribute('partition', `persist:conta${acc}`);
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('webpreferences', 'backgroundThrottling=no');
    if (webviewPreloadUrl) {
        wv.setAttribute('preload', webviewPreloadUrl);
    }

    let seedDone = false;
    audioState.set(acc, { muted: true, playing: false });
    wv.addEventListener('media-started-playing', () => {
        const st = audioState.get(acc);
        if (st) { st.playing = true; updateAudioIndicators(acc); }
    });
    wv.addEventListener('media-paused', () => {
        const st = audioState.get(acc);
        if (st) { st.playing = false; updateAudioIndicators(acc); }
    });
    wv.addEventListener('dom-ready', async () => {
        try { wv.setAudioMuted(isAccountMuted(acc)); } catch { /* ignore */ }
        wv.__ready = true;
        wv.__zoom = null;
        applyWebviewZoom(acc);
        const needCampo = snapshots[acc]?.config?.caidosEnabled !== false;
        wv.executeJavaScript(`window.__pbSetNeedCampoFeed && window.__pbSetNeedCampoFeed(${JSON.stringify(needCampo)})`).catch(() => {});
        if (!seedDone && res.seedSession) {
            seedDone = true;
            const script = buildSeedJs(res.seedSession);
            if (script) {
                try {
                    const seeded = await wv.executeJavaScript(script);
                    if (seeded) {
                        wv.reload();
                    }
                } catch {
                    // ignora erro de seed
                }
            }
        }
    });

    wv.addEventListener('did-start-loading', () => { wv.__failedSince = null; });
    wv.addEventListener('did-finish-load', () => { wv.__openSince = Date.now(); });
    wv.addEventListener('did-fail-load', (ev) => {
        if (ev.isMainFrame && ev.errorCode !== -3) wv.__failedSince = Date.now();
    });
    wv.addEventListener('ipc-message', (ev) => {
        if (ev.channel === 'pb-ws-frame' && typeof ev.args?.[0] === 'string') {
            if (wv.__openSince) { wv.__openSince = null; wv.__stuckReloads = 0; }
            window.pokeHub.sendWsFrame(acc, ev.args[0]);
        } else if (ev.channel === 'pb-session' && ev.args?.[0]) {
            window.pokeHub.syncWebviewSession(acc, ev.args[0]);
        } else if (ev.channel === 'pb-game-eco') {
            showToast({
                kind: 'ok',
                title: `Modo Economia do jogo · Conta ${acc}`,
                text: 'Canvas em 0% GPU com a captura automática 100% preservada.',
                account: acc,
            });
        }
    });

    wv.src = GAME_URL;
    webviews.set(acc, wv);
    if (ph) ph.hidden = true;
    body.appendChild(wv);
    if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => applyWebviewZoom(acc));
        ro.observe(body);
        wvZoomObservers.set(acc, ro);
    }
    updateAudioIndicators(acc);
    await pollSnapshots();
}

async function closeEmbeddedForAccount(acc, { startHeadless = false } = {}) {
    const wv = webviews.get(acc);
    wvZoomObservers.get(acc)?.disconnect();
    wvZoomObservers.delete(acc);
    if (wv) {
        webviews.delete(acc);
        try { wv.src = 'about:blank'; } catch { /* ignore */ }
        try { wv.remove(); } catch { /* ignore */ }
    }
    audioState.delete(acc);
    updateAudioIndicators(acc);
    const ph = $(`wv-ph-${acc}`);
    if (ph) ph.hidden = false;
    const res = await window.pokeHub.detachWebview(acc, { startHeadless });
    if (res?.snapshots) {
        snapshots = res.snapshots;
        renderAll();
    } else {
        await pollSnapshots();
    }
}

async function closeAllEmbeddedToHeadless(targetMode = 'panel-only') {
    const openAccs = [...webviews.keys()];
    for (const acc of openAccs) {
        const snap = snapshots[acc];
        const hasSession = Boolean(snap?.session?.nick || (snap?.trainer?.nick && snap.trainer.nick !== '-'));
        await closeEmbeddedForAccount(acc, { startHeadless: hasSession });
    }
    setViewMode(targetMode, { skipAutoClose: true });
    if (openAccs.length > 0) {
        showToast({
            kind: 'ok',
            title: 'Modo Eco (Headless)',
            text: 'Navegador fechado (~90% menos RAM e 0% GPU). Captura, lives e /hunt continuam 100% ativos.',
        });
    }
}

function selectAccount(acc) {
    if (!ACCOUNTS.includes(acc)) return;
    activeAccount = acc;
    for (const id of ACCOUNTS) {
        const tab = document.querySelector(`.acc-tab[data-acc="${id}"]`);
        tab?.classList.toggle('active', id === acc);
        $(`wv-slot-${id}`)?.classList.toggle('slot-active', id === acc);
    }
    lastRenderedAccount = 0;
    lastSpriteKey = '';
    lastInvSig = '';
    lastLogSig = '';
    lastLiveChanSig = '';
    lastDropsSig = '';
    renderAll();
}

// ===== Grade livre, som por conta e Paineis 2x2 =====
const GRID_STATE_KEY = 'nexo.gridLayout';
const ACC_SORT_KEY = 'nexo.accSort';
const SPLIT_DOCK_KEY = 'nexo.splitDock';
const SLOT_SIDEBAR_KEY = 'nexo.slotSidebar.v1';
const DISMISSED_BF_KEY = 'nexo.dismissedBf';
const DISMISSED_ALERTS_KEY = 'nexo.dismissedAlerts';
const GRID_LAYOUTS = ['2x2', 'focus', 'cols', 'rows'];
const ACC_SORT_MODES = ['manual', 'level', 'pokeLevel', 'xp', 'profit', 'name'];
const SPLIT_DOCK_MODES = ['left', 'right', 'hidden'];
const SUMMARY_DOCK_MODES = ['right', 'left', 'bottom', 'off'];
const SUMMARY_DENSITY_MODES = ['compact', 'full'];
const RUNNING_STATUSES = ['connected', 'bridge', 'connecting'];
const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const audioState = new Map(); // conta -> { muted, playing } enquanto o jogo esta embutido
let gridState = loadGridState();
let gridGutters = { v: false, h: false };
let accSortMode = loadAccSortMode();
let splitDockMode = loadSplitDockMode();
let slotSidebarState = loadSlotSidebarState();
const dismissedModeWarns = new Set();
let dismissedAlerts = loadDismissedAlerts();

function loadAccSortMode() {
    try {
        const v = localStorage.getItem(ACC_SORT_KEY);
        return ACC_SORT_MODES.includes(v) ? v : 'manual';
    } catch {
        return 'manual';
    }
}
function saveAccSortMode() {
    try { localStorage.setItem(ACC_SORT_KEY, accSortMode); } catch { /* ignore */ }
}

function loadSplitDockMode() {
    try {
        const v = localStorage.getItem(SPLIT_DOCK_KEY);
        return SPLIT_DOCK_MODES.includes(v) ? v : 'left';
    } catch {
        return 'left';
    }
}
function saveSplitDockMode() {
    try { localStorage.setItem(SPLIT_DOCK_KEY, splitDockMode); } catch { /* ignore */ }
}

function makeDefaultSlotSidebars() {
    const mk = (defDock, defDensity) => Object.fromEntries(ACCOUNTS.map((a) => [a, { dock: defDock, density: defDensity, size: 0 }]));
    return {
        grid: mk('right', 'compact'),
        split: mk('off', 'compact'),
    };
}

function loadSlotSidebarState() {
    const def = makeDefaultSlotSidebars();
    try {
        const raw = JSON.parse(localStorage.getItem(SLOT_SIDEBAR_KEY) || 'null');
        if (!raw || typeof raw !== 'object') return def;
        for (const viewKey of ['grid', 'split']) {
            const src = raw[viewKey];
            if (!src || typeof src !== 'object') continue;
            for (const acc of ACCOUNTS) {
                const item = src[acc] || src[String(acc)];
                if (!item || typeof item !== 'object') continue;
                if (SUMMARY_DOCK_MODES.includes(item.dock)) def[viewKey][acc].dock = item.dock;
                if (SUMMARY_DENSITY_MODES.includes(item.density)) def[viewKey][acc].density = item.density;
                const sz = Number(item.size);
                if (Number.isFinite(sz) && sz > 0) def[viewKey][acc].size = Math.round(sz);
            }
        }
        return def;
    } catch {
        return def;
    }
}
function saveSlotSidebarState() {
    try { localStorage.setItem(SLOT_SIDEBAR_KEY, JSON.stringify(slotSidebarState)); } catch { /* ignore */ }
}

function loadDismissedAlerts() {
    try {
        const raw = JSON.parse(localStorage.getItem(DISMISSED_ALERTS_KEY) || '[]');
        return new Set(Array.isArray(raw) ? raw.map(String) : []);
    } catch {
        return new Set();
    }
}
function saveDismissedAlerts() {
    try { localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify([...dismissedAlerts])); } catch { /* ignore */ }
}

function getSlotSidebarBucket() {
    return viewMode === 'grid' ? 'grid' : 'split';
}

function getSlotSidebarCfg(acc) {
    const bucket = getSlotSidebarBucket();
    return slotSidebarState[bucket]?.[acc] || { dock: bucket === 'grid' ? 'right' : 'off', density: 'compact' };
}

function applySummaryLayout() {
    const bucket = getSlotSidebarBucket();
    const map = slotSidebarState[bucket] || {};
    const docks = ACCOUNTS.map((a) => map[a]?.dock || (bucket === 'grid' ? 'right' : 'off'));
    const allSameDock = docks.every((d) => d === docks[0]) ? docks[0] : '';
    document.querySelectorAll('[data-grid-summary]').forEach((b) => {
        b.classList.toggle('active', b.dataset.gridSummary === allSameDock);
    });
    const densities = ACCOUNTS.map((a) => map[a]?.density || 'compact');
    const allCompact = densities.every((d) => d === 'compact');
    const densBtn = $('btnGridSummaryDensity');
    if (densBtn) {
        densBtn.textContent = allCompact ? 'Modo: Resumido' : 'Modo: Completo';
        densBtn.classList.toggle('active', !allCompact);
    }
    for (const acc of ACCOUNTS) {
        const cfg = getSlotSidebarCfg(acc);
        const show = viewMode !== 'panel-only' && viewMode !== 'panels-grid' && cfg.dock !== 'off';
        const slot = $(`wv-slot-${acc}`);
        if (slot) slot.dataset.summaryDock = show ? cfg.dock : 'off';
        const resizer = slot?.querySelector('.wv-sum-resizer');
        if (resizer) resizer.hidden = !show;
        const sumEl = $(`wv-summary-${acc}`);
        if (sumEl) {
            sumEl.hidden = !show;
            sumEl.dataset.sumDensity = cfg.density;
            const sz = Number(cfg.size || 0);
            if (!show || sz <= 0) {
                sumEl.style.width = '';
                sumEl.style.height = '';
            } else if (cfg.dock === 'bottom') {
                sumEl.style.width = '';
                sumEl.style.height = `${Math.max(86, Math.min(380, sz))}px`;
            } else {
                sumEl.style.height = '';
                sumEl.style.width = `${Math.max(160, Math.min(540, sz))}px`;
            }
        }
        const btn = document.querySelector(`[data-slot-act="summary"][data-slot="${acc}"]`);
        if (btn) btn.classList.toggle('active-toggle', show);
        applyWebviewZoom(acc);
    }
    requestAnimationFrame(() => {
        for (const acc of ACCOUNTS) applyWebviewZoom(acc);
        if (viewMode === 'grid') positionGridGutters(gridGutters);
    });
    window.hubUi?.renderWvSummaries?.();
}

function getEffectiveAccountOrder() {
    const base = [...gridState.order];
    if (accSortMode === 'manual') return base;
    const rankIndex = new Map(base.map((acc, idx) => [acc, idx]));
    const metricVal = (acc) => {
        const s = snapshots[acc] || {};
        if (accSortMode === 'level') return Number(s.trainer?.level || 0);
        if (accSortMode === 'pokeLevel') return Number(s.activePokemon?.level || 0);
        if (accSortMode === 'xp') return Number(s.stats?.xpPerHour || 0);
        if (accSortMode === 'profit') return Number(s.stats?.netGoldPerHour ?? s.stats?.goldPerHour ?? 0);
        return 0;
    };
    return [...ACCOUNTS].sort((a, b) => {
        if (accSortMode === 'name') {
            const cmp = accountNick(a).localeCompare(accountNick(b), 'pt-BR', { sensitivity: 'base' });
            if (cmp !== 0) return cmp;
        } else {
            const diff = metricVal(b) - metricVal(a);
            if (diff !== 0) return diff;
        }
        return (rankIndex.get(a) ?? a) - (rankIndex.get(b) ?? b);
    });
}

function applyAccountTabOrder() {
    const order = getEffectiveAccountOrder();
    order.forEach((acc, idx) => {
        const tab = document.querySelector(`.acc-tab[data-acc="${acc}"]`);
        if (tab) tab.style.order = String(idx);
    });
    const selTop = $('accSortSelect');
    if (selTop && selTop.value !== accSortMode) selTop.value = accSortMode;
    const selGrid = $('gridSortSelect');
    if (selGrid && selGrid.value !== accSortMode) selGrid.value = accSortMode;
}

function applySplitDock() {
    const ws = $('workspace');
    if (!ws) return;
    ws.classList.toggle('split-dock-right', splitDockMode === 'right');
    ws.classList.toggle('split-dock-hidden', splitDockMode === 'hidden');
    const reopen = $('btnReopenControlPane');
    if (reopen) reopen.classList.toggle('hidden', !(viewMode === 'split' && splitDockMode === 'hidden'));
    document.querySelectorAll('[data-split-dock]').forEach((b) => {
        const on = b.dataset.splitDock === splitDockMode;
        b.classList.toggle('active-toggle', on);
        if (b.getAttribute('role') === 'radio') b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
}

function clampSplit(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(0.8, Math.max(0.2, n)) : 0.5;
}

function loadGridState() {
    const st = {
        layout: '2x2',
        order: [...ACCOUNTS],
        hidden: [],
        max: 0,
        colSplit: 0.5,
        rowSplit: 0.5,
        colWeights: [1, 1, 1, 1],
        rowWeights: [1, 1, 1, 1],
    };
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(GRID_STATE_KEY) || 'null'); } catch { raw = null; }
    if (!raw || typeof raw !== 'object') return st;
    if (GRID_LAYOUTS.includes(raw.layout)) st.layout = raw.layout;
    if (Array.isArray(raw.order)) {
        const ord = raw.order.map(Number).filter((n) => ACCOUNTS.includes(n));
        if (new Set(ord).size === ACCOUNTS.length) st.order = ord;
    }
    if (Array.isArray(raw.hidden)) st.hidden = [...new Set(raw.hidden.map(Number).filter((n) => ACCOUNTS.includes(n)))];
    if (ACCOUNTS.includes(Number(raw.max))) st.max = Number(raw.max);
    st.colSplit = clampSplit(raw.colSplit);
    st.rowSplit = clampSplit(raw.rowSplit);
    const normWeights = (arr) => (Array.isArray(arr) && arr.length === 4
        ? arr.map((w) => (Number.isFinite(Number(w)) && Number(w) >= 0.2 ? Math.min(5, Number(w)) : 1))
        : [1, 1, 1, 1]);
    st.colWeights = normWeights(raw.colWeights);
    st.rowWeights = normWeights(raw.rowWeights);
    return st;
}

/**
 * Clique na aba da conta com a grade aberta: a conta clicada entra no lugar de quem está em foco.
 * Maximizada: troca a tela maximizada. Layout Foco: troca a tela grande (1 + 3 vira 2 + 3).
 * Outros layouts: uma conta oculta entra no lugar da conta ativa.
 */
function focusAccountInGrid(acc) {
    if (viewMode !== 'grid' || !ACCOUNTS.includes(acc)) return;
    const visible = gridState.order.filter((a) => !gridState.hidden.includes(a));
    const swapWith = (cur) => {
        if (!cur || cur === acc) return false;
        const order = [...gridState.order];
        const i = order.indexOf(acc);
        const j = order.indexOf(cur);
        [order[i], order[j]] = [order[j], order[i]];
        gridState.order = order;
        if (gridState.hidden.includes(acc)) {
            gridState.hidden = [...gridState.hidden.filter((a) => a !== acc), cur];
        }
        return true;
    };
    let changed = false;
    if (gridState.max && visible.includes(gridState.max)) {
        if (gridState.max !== acc) {
            gridState.max = acc;
            gridState.hidden = gridState.hidden.filter((a) => a !== acc);
            changed = true;
        }
    } else if (gridState.layout === 'focus') {
        changed = swapWith(visible[0]);
    } else if (gridState.hidden.includes(acc)) {
        changed = swapWith(visible.includes(activeAccount) ? activeAccount : visible[0]);
        if (!changed && !visible.length) {
            gridState.hidden = gridState.hidden.filter((a) => a !== acc);
            changed = true;
        }
    }
    if (!changed) return;
    saveGridState();
    applyGridLayout();
    renderGridToolbar();
}

function saveGridState() {
    try { localStorage.setItem(GRID_STATE_KEY, JSON.stringify(gridState)); } catch { /* ignore */ }
}

function accountNick(acc) {
    const s = snapshots[acc];
    if (s?.trainer?.nick && s.trainer.nick !== '-') return s.trainer.nick;
    return s?.session?.nick || `Conta ${acc}`;
}

function applyGridLayout() {
    const stage = $('browserStage');
    if (!stage) return;
    const inGrid = viewMode === 'grid';
    for (const acc of ACCOUNTS) {
        const bar = $(`wv-slot-${acc}`)?.querySelector('.wv-bar');
        if (bar) bar.draggable = inGrid;
    }
    if (!inGrid) {
        stage.style.gridTemplateColumns = '';
        stage.style.gridTemplateRows = '';
        for (const acc of ACCOUNTS) {
            const el = $(`wv-slot-${acc}`);
            if (!el) continue;
            el.style.gridRow = '';
            el.style.gridColumn = '';
            el.classList.remove('grid-hidden');
        }
        positionGridGutters({ v: false, h: false });
        return;
    }

    const order = getEffectiveAccountOrder();
    let visible = order.filter((acc) => !gridState.hidden.includes(acc));
    if (gridState.max && visible.includes(gridState.max)) {
        visible = [gridState.max];
    } else {
        gridState.max = 0;
    }
    const n = visible.length;
    const cs = gridState.colSplit;
    const rs = gridState.rowSplit;
    const fr = (a) => `minmax(0, ${a.toFixed(3)}fr)`;
    const place = new Map(); // conta -> [linha, coluna] (linha 1 e a barra de ferramentas)
    let cols = 'minmax(0, 1fr)';
    let rows = 'minmax(0, 1fr)';
    const gutters = { v: false, h: false, multiV: 0, multiH: 0 };

    if (n <= 1) {
        if (n === 1) place.set(visible[0], ['2', '1']);
    } else if (gridState.layout === 'cols') {
        cols = visible.map((_, i) => fr(gridState.colWeights[i] || 1)).join(' ');
        visible.forEach((acc, i) => place.set(acc, ['2', String(i + 1)]));
        gutters.multiV = Math.max(0, n - 1);
    } else if (gridState.layout === 'rows') {
        rows = visible.map((_, i) => fr(gridState.rowWeights[i] || 1)).join(' ');
        visible.forEach((acc, i) => place.set(acc, [String(i + 2), '1']));
        gutters.multiH = Math.max(0, n - 1);
    } else if (gridState.layout === 'focus') {
        cols = `${fr(cs)} ${fr(1 - cs)}`;
        rows = `repeat(${n - 1}, minmax(0, 1fr))`;
        place.set(visible[0], [`2 / ${n + 1}`, '1']);
        visible.slice(1).forEach((acc, i) => place.set(acc, [String(i + 2), '2']));
        gutters.v = true;
    } else {
        const rowCount = Math.ceil(n / 2);
        cols = `${fr(cs)} ${fr(1 - cs)}`;
        rows = rowCount === 2 ? `${fr(rs)} ${fr(1 - rs)}` : 'minmax(0, 1fr)';
        visible.forEach((acc, i) => {
            const spanAll = n === 3 && i === 2;
            place.set(acc, [String(Math.floor(i / 2) + 2), spanAll ? '1 / -1' : String((i % 2) + 1)]);
        });
        gutters.v = true;
        gutters.h = rowCount === 2;
    }

    stage.style.gridTemplateColumns = cols;
    stage.style.gridTemplateRows = n > 0 ? `auto ${rows}` : 'auto';
    for (const acc of ACCOUNTS) {
        const el = $(`wv-slot-${acc}`);
        if (!el) continue;
        const p = place.get(acc);
        el.classList.toggle('grid-hidden', !p);
        el.style.gridRow = p ? p[0] : '';
        el.style.gridColumn = p ? p[1] : '';
    }
    const hint = $('gridHint');
    if (hint) {
        hint.textContent = n === 0
            ? 'Todas as telas estão ocultas: clique numa conta em Ocultas para trazer de volta.'
            : gridState.max
                ? 'Tela maximizada: clique em ⤡ na barra dela para voltar à grade.'
                : 'Arraste a barra de uma tela para trocar de lugar · arraste a divisória para redimensionar';
    }
    requestAnimationFrame(() => positionGridGutters(gutters));
}

function positionGridGutters(gutters) {
    gridGutters = gutters;
    const stage = $('browserStage');
    const gv = $('gridGutterV');
    const gh = $('gridGutterH');
    if (!stage || !gv || !gh) return;
    gv.hidden = !gutters.v;
    gh.hidden = !gutters.h;
    const sr = stage.getBoundingClientRect();
    const tb = $('gridToolbar')?.getBoundingClientRect();
    const top = (tb ? tb.bottom : sr.top) - sr.top + 4;
    const visible = getEffectiveAccountOrder().filter((acc) => !gridState.hidden.includes(acc));
    const rect = (acc) => $(`wv-slot-${acc}`)?.getBoundingClientRect();
    if (gutters.v && visible.length >= 2) {
        const a = rect(visible[0]);
        const b = rect(visible[1]);
        if (a && b) {
            gv.style.left = `${(a.right + b.left) / 2 - sr.left}px`;
            gv.style.top = `${top}px`;
            gv.style.height = `${sr.height - top - 8}px`;
        }
    }
    if (gutters.h && visible.length >= 3) {
        const a = rect(visible[0]);
        const c = rect(visible[2]);
        if (a && c) {
            gh.style.top = `${(a.bottom + c.top) / 2 - sr.top}px`;
            gh.style.left = '8px';
            gh.style.width = `${sr.width - 16}px`;
        }
    }
    for (let idx = 0; idx < 3; idx++) {
        let dv = stage.querySelector(`.grid-gutter.dyn.v[data-idx="${idx}"]`);
        if (idx < (gutters.multiV || 0) && visible.length > idx + 1) {
            if (!dv) {
                dv = document.createElement('div');
                dv.className = 'grid-gutter v dyn';
                dv.dataset.idx = String(idx);
                dv.title = 'Arraste para mudar a largura · duplo clique iguala';
                wireMultiGridGutter(dv, 'v', idx);
                stage.appendChild(dv);
            }
            const a = rect(visible[idx]);
            const b = rect(visible[idx + 1]);
            dv.hidden = !(a && b);
            if (a && b) {
                dv.style.left = `${(a.right + b.left) / 2 - sr.left}px`;
                dv.style.top = `${top}px`;
                dv.style.height = `${sr.height - top - 8}px`;
            }
        } else if (dv) {
            dv.hidden = true;
        }
        let dh = stage.querySelector(`.grid-gutter.dyn.h[data-idx="${idx}"]`);
        if (idx < (gutters.multiH || 0) && visible.length > idx + 1) {
            if (!dh) {
                dh = document.createElement('div');
                dh.className = 'grid-gutter h dyn';
                dh.dataset.idx = String(idx);
                dh.title = 'Arraste para mudar a altura · duplo clique iguala';
                wireMultiGridGutter(dh, 'h', idx);
                stage.appendChild(dh);
            }
            const a = rect(visible[idx]);
            const b = rect(visible[idx + 1]);
            dh.hidden = !(a && b);
            if (a && b) {
                dh.style.top = `${(a.bottom + b.top) / 2 - sr.top}px`;
                dh.style.left = '8px';
                dh.style.width = `${sr.width - 16}px`;
            }
        } else if (dh) {
            dh.hidden = true;
        }
    }
}

function wireMultiGridGutter(el, axis, idx) {
    el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        const stage = $('browserStage');
        const visible = getEffectiveAccountOrder().filter((acc) => !gridState.hidden.includes(acc));
        const aEl = $(`wv-slot-${visible[idx]}`);
        const bEl = $(`wv-slot-${visible[idx + 1]}`);
        if (!aEl || !bEl) return;
        const weights = axis === 'v' ? gridState.colWeights : gridState.rowWeights;
        const ar = aEl.getBoundingClientRect();
        const br = bEl.getBoundingClientRect();
        const sizeA = axis === 'v' ? ar.width : ar.height;
        const sizeB = axis === 'v' ? br.width : br.height;
        const totalSize = sizeA + sizeB;
        if (totalSize <= 10) return;
        const wA = weights[idx] || 1;
        const wB = weights[idx + 1] || 1;
        const totalWeight = wA + wB;
        const startCoord = axis === 'v' ? ev.clientX : ev.clientY;
        stage.classList.add('resizing');
        stage.classList.toggle('row', axis === 'h');
        try { el.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
        const move = (e) => {
            const delta = (axis === 'v' ? e.clientX : e.clientY) - startCoord;
            const minSz = totalSize * 0.14;
            const nextA = Math.max(minSz, Math.min(totalSize - minSz, sizeA + delta));
            const ratio = nextA / totalSize;
            weights[idx] = totalWeight * ratio;
            weights[idx + 1] = totalWeight * (1 - ratio);
            applyGridLayout();
        };
        const up = () => {
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', up);
            stage.classList.remove('resizing', 'row');
            saveGridState();
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', () => {
        if (axis === 'v') gridState.colWeights = [1, 1, 1, 1];
        else gridState.rowWeights = [1, 1, 1, 1];
        saveGridState();
        applyGridLayout();
    });
}

function wireSummaryResizers() {
    document.querySelectorAll('.wv-sum-resizer[data-sum-resize]').forEach((rz) => {
        const acc = Number(rz.dataset.sumResize);
        rz.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            const bucket = getSlotSidebarBucket();
            const cfg = slotSidebarState[bucket]?.[acc];
            const sumEl = $(`wv-summary-${acc}`);
            const stage = $('browserStage');
            if (!cfg || !sumEl || cfg.dock === 'off') return;
            const dock = cfg.dock;
            const rect = sumEl.getBoundingClientRect();
            const startX = ev.clientX;
            const startY = ev.clientY;
            const startW = rect.width;
            const startH = rect.height;
            stage?.classList.add('resizing');
            stage?.classList.toggle('row', dock === 'bottom');
            try { rz.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
            const move = (e) => {
                if (dock === 'bottom') {
                    cfg.size = Math.round(Math.max(86, Math.min(380, startH - (e.clientY - startY))));
                } else {
                    const delta = dock === 'left' ? (e.clientX - startX) : (startX - e.clientX);
                    cfg.size = Math.round(Math.max(160, Math.min(540, startW + delta)));
                }
                applySummaryLayout();
            };
            const up = () => {
                rz.removeEventListener('pointermove', move);
                rz.removeEventListener('pointerup', up);
                rz.removeEventListener('pointercancel', up);
                stage?.classList.remove('resizing', 'row');
                saveSlotSidebarState();
            };
            rz.addEventListener('pointermove', move);
            rz.addEventListener('pointerup', up);
            rz.addEventListener('pointercancel', up);
        });
        rz.addEventListener('dblclick', () => {
            const bucket = getSlotSidebarBucket();
            if (slotSidebarState[bucket]?.[acc]) {
                slotSidebarState[bucket][acc].size = 0;
                saveSlotSidebarState();
                applySummaryLayout();
            }
        });
    });
}

function wireGridGutter(el, axis) {
    if (!el) return;
    el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        const stage = $('browserStage');
        stage.classList.add('resizing');
        stage.classList.toggle('row', axis === 'h');
        try { el.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
        const move = (e) => {
            const r = stage.getBoundingClientRect();
            if (axis === 'v') {
                gridState.colSplit = clampSplit((e.clientX - r.left - 8) / Math.max(1, r.width - 16));
            } else {
                const tb = $('gridToolbar').getBoundingClientRect();
                const top = tb.bottom + 8;
                gridState.rowSplit = clampSplit((e.clientY - top) / Math.max(1, r.bottom - 8 - top));
            }
            applyGridLayout();
        };
        const up = () => {
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', up);
            stage.classList.remove('resizing', 'row');
            saveGridState();
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', () => {
        if (axis === 'v') gridState.colSplit = 0.5;
        else gridState.rowSplit = 0.5;
        saveGridState();
        applyGridLayout();
    });
}

function wireGridDrag() {
    const stage = $('browserStage');
    let dragAcc = 0;
    const clearMarks = () => {
        stage.classList.remove('dragging');
        document.querySelectorAll('.wv-slot.drag-src, .wv-slot.drag-over').forEach((el) => {
            el.classList.remove('drag-src', 'drag-over');
        });
    };
    for (const acc of ACCOUNTS) {
        const slot = $(`wv-slot-${acc}`);
        const bar = slot?.querySelector('.wv-bar');
        if (!slot || !bar) continue;
        bar.addEventListener('dragstart', (ev) => {
            if (viewMode !== 'grid' || ev.target.closest?.('button')) {
                ev.preventDefault();
                return;
            }
            dragAcc = acc;
            ev.dataTransfer.effectAllowed = 'move';
            try { ev.dataTransfer.setData('text/plain', String(acc)); } catch { /* ignore */ }
            stage.classList.add('dragging');
            slot.classList.add('drag-src');
        });
        bar.addEventListener('dragend', () => {
            dragAcc = 0;
            clearMarks();
        });
        slot.addEventListener('dragover', (ev) => {
            if (!dragAcc || dragAcc === acc) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'move';
            slot.classList.add('drag-over');
        });
        slot.addEventListener('dragleave', (ev) => {
            if (!slot.contains(ev.relatedTarget)) slot.classList.remove('drag-over');
        });
        slot.addEventListener('drop', (ev) => {
            ev.preventDefault();
            const from = dragAcc;
            dragAcc = 0;
            clearMarks();
            if (!from || from === acc) return;
            const order = getEffectiveAccountOrder();
            const i = order.indexOf(from);
            const j = order.indexOf(acc);
            if (i < 0 || j < 0) return;
            [order[i], order[j]] = [order[j], order[i]];
            gridState.order = order;
            accSortMode = 'manual';
            saveAccSortMode();
            saveGridState();
            applyAccountTabOrder();
            applyGridLayout();
            renderPanelsGrid();
        });
    }
}

function wireAccountTabDrag() {
    const nav = $('accountTabs');
    if (!nav) return;
    let dragAcc = 0;
    const clearTabMarks = () => {
        nav.querySelectorAll('.acc-tab.tab-drag-src, .acc-tab.tab-drag-over').forEach((el) => {
            el.classList.remove('tab-drag-src', 'tab-drag-over');
        });
    };
    nav.querySelectorAll('.acc-tab[data-acc]').forEach((tab) => {
        const acc = Number(tab.dataset.acc);
        tab.addEventListener('dragstart', (ev) => {
            dragAcc = acc;
            ev.dataTransfer.effectAllowed = 'move';
            try { ev.dataTransfer.setData('text/plain', String(acc)); } catch { /* ignore */ }
            tab.classList.add('tab-drag-src');
        });
        tab.addEventListener('dragend', () => {
            dragAcc = 0;
            clearTabMarks();
        });
        tab.addEventListener('dragover', (ev) => {
            if (!dragAcc || dragAcc === acc) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'move';
            tab.classList.add('tab-drag-over');
        });
        tab.addEventListener('dragleave', (ev) => {
            if (!tab.contains(ev.relatedTarget)) tab.classList.remove('tab-drag-over');
        });
        tab.addEventListener('drop', (ev) => {
            ev.preventDefault();
            const from = dragAcc;
            dragAcc = 0;
            clearTabMarks();
            if (!from || from === acc) return;
            const order = getEffectiveAccountOrder();
            const i = order.indexOf(from);
            const j = order.indexOf(acc);
            if (i < 0 || j < 0) return;
            [order[i], order[j]] = [order[j], order[i]];
            gridState.order = order;
            accSortMode = 'manual';
            saveAccSortMode();
            saveGridState();
            applyAccountTabOrder();
            if (viewMode === 'grid') applyGridLayout();
            renderPanelsGrid();
        });
    });
}

function renderGridToolbar() {
    document.querySelectorAll('[data-grid-layout]').forEach((b) => {
        b.classList.toggle('active', b.dataset.gridLayout === gridState.layout);
    });
    const wrap = $('gridHiddenWrap');
    const chips = $('gridHiddenChips');
    const chipsSig = gridState.hidden.map((acc) => `${acc}:${accountNick(acc)}`).join('|');
    if (wrap && chips && chips.__nexoSig !== chipsSig) {
        chips.__nexoSig = chipsSig;
        wrap.hidden = gridState.hidden.length === 0;
        chips.replaceChildren(...gridState.hidden.map((acc) => {
            const b = document.createElement('button');
            b.type = 'button';
            setClass(b, 'grid-chip');
            b.dataset.gridShow = String(acc);
            b.title = 'Mostrar de novo na grade';
            setText(b, `+ ${acc}. ${accountNick(acc)}`);
            return b;
        }));
    }
    const muteBtn = $('btnGridMuteAll');
    if (muteBtn) {
        const embedded = [...webviews.keys()];
        const anyOn = embedded.some((acc) => !isAccountMuted(acc));
        muteBtn.disabled = embedded.length === 0;
        setHtml(muteBtn, `${anyOn ? ICON_SOUND_OFF : ICON_SOUND_ON}<span>${anyOn ? 'Mutar todas' : 'Som em todas'}</span>`);
        muteBtn.title = embedded.length === 0 ? 'Nenhum jogo aberto na grade' : '';
    }
    for (const acc of ACCOUNTS) {
        const mb = document.querySelector(`[data-slot-act="max"][data-slot="${acc}"]`);
        if (!mb) continue;
        const on = gridState.max === acc;
        const want = on ? 'grid' : 'maximize';
        if (mb.dataset.ico !== want) {
            mb.dataset.ico = want;
            mb.setAttribute('data-icon-done', '');
            mb.innerHTML = window.nexoIcons ? window.nexoIcons.icon(want) : (on ? '⤡' : '⤢');
        }
        mb.title = on ? 'Voltar para a grade' : 'Maximizar esta tela';
        mb.classList.toggle('active-toggle', on);
    }
}

function isAccountMuted(acc) {
    return audioState.get(acc)?.muted !== false;
}

function setAccountMuted(acc, muted) {
    const wv = webviews.get(acc);
    if (!wv) return;
    const st = audioState.get(acc) || { muted: true, playing: false };
    st.muted = Boolean(muted);
    audioState.set(acc, st);
    try { wv.setAudioMuted(st.muted); } catch { /* antes do dom-ready: o dom-ready aplica */ }
    updateAudioIndicators(acc);
}

function updateAudioIndicators(acc) {
    const embedded = webviews.has(acc);
    const st = audioState.get(acc) || { muted: true, playing: false };
    const playing = embedded && st.playing;
    const tip = `${st.muted ? 'Mudo' : 'Som ligado'}${playing ? ' · tocando agora' : ''} · clique para ${st.muted ? 'ativar o som' : 'silenciar'}`;
    const tabIcon = $(`tabAudio-${acc}`);
    if (tabIcon) {
        tabIcon.hidden = !embedded;
        setHtml(tabIcon, st.muted ? ICON_SOUND_OFF : ICON_SOUND_ON);
        tabIcon.classList.toggle('is-muted', st.muted);
        tabIcon.classList.toggle('is-playing', playing && !st.muted);
        tabIcon.title = tip;
        tabIcon.setAttribute('aria-label', tip);
    }
    const btn = $(`slotAudio-${acc}`);
    if (btn) {
        btn.hidden = !embedded;
        setHtml(btn, `${st.muted ? ICON_SOUND_OFF : ICON_SOUND_ON}<span>${st.muted ? 'Mudo' : 'Som'}</span>`);
        btn.classList.toggle('is-muted', st.muted);
        btn.classList.toggle('is-playing', playing && !st.muted);
        btn.title = tip;
    }
    renderGridToolbar();
}

const PANEL_CARD_HTML = `
  <header class="pcard-head" data-pc-act="select" title="Selecionar esta conta">
    <span class="acc-dot"></span>
    <div class="pcard-id"><b class="pcard-nick"></b><span class="pcard-sub"></span></div>
    <span class="pcard-badge"></span>
  </header>
  <div class="pcard-warn" hidden></div>
  <div class="pcard-poke">
    <div class="pcard-sprite">?</div>
    <div class="pcard-poke-info">
      <div class="pcard-poke-name"></div>
      <div class="pcard-hp"><i></i></div>
      <div class="pcard-hp-txt"></div>
    </div>
  </div>
  <dl class="pcard-stats"></dl>
  <div class="pcard-drops"></div>
  <div class="pcard-actions">
    <button type="button" class="btn sm" data-pc-act="run"></button>
    <button type="button" class="btn sm" data-pc-act="panel">Painel completo</button>
    <button type="button" class="btn sm teal" data-pc-act="game">Abrir jogo</button>
  </div>`;

function renderPanelsGrid() {
    const box = $('panelsGrid');
    if (!box || viewMode !== 'panels-grid') return;
    const order = getEffectiveAccountOrder();
    const want = order.join(',');
    if (box.dataset.order !== want) {
        box.dataset.order = want;
        box.replaceChildren(...order.map((acc) => {
            const card = document.createElement('article');
            setClass(card, 'pcard');
            card.dataset.acc = String(acc);
            card.innerHTML = PANEL_CARD_HTML;
            return card;
        }));
    }
    for (const card of box.children) {
        const acc = Number(card.dataset.acc);
        const s = snapshots[acc] || {};
        const t = s.trainer || {};
        const st = s.stats || {};
        const status = s.status || 'disconnected';
        const hunt = t.huntName && t.huntName !== '-' ? t.huntName : '';
        const warns = Array.isArray(s.modeWarnings) ? s.modeWarnings : [];
        card.classList.toggle('active', acc === activeAccount);
        setClass(card.querySelector('.acc-dot'), `acc-dot ${status}`);
        setText(card.querySelector('.pcard-nick'), `${acc}. ${accountNick(acc)}`);
        setText(card.querySelector('.pcard-sub'), [STATUS_LABELS[status] || status.toUpperCase(), hunt].filter(Boolean).join(' · '));
        setText(card.querySelector('.pcard-badge'), `Nv ${t.level || 0} · ${fmtNum(t.gold)} gold`);
        const warnEl = card.querySelector('.pcard-warn');
        warnEl.hidden = warns.length === 0;
        setText(warnEl, warns.length ? `⚠ ${warns.map((w) => w.title).join(' | ')}` : '');

        const pk = s.activePokemon;
        const spriteBox = card.querySelector('.pcard-sprite');
        const pkDex = pk ? resolvePokemonSpriteDex(pk.speciesId, pk.name, pk.spriteDex) : 0;
        const spKey = pkDex > 0 ? `${pkDex}:${pk.shiny ? 1 : 0}` : '';
        if (spriteBox.dataset.key !== spKey) {
            spriteBox.dataset.key = spKey;
            spriteBox.classList.toggle('shiny', Boolean(pk?.shiny));
            const url = spKey ? pokemonSpriteUrl(pk.speciesId, Boolean(pk.shiny), pkDex, pk.name) : '';
            if (url) {
                const img = document.createElement('img');
                img.src = url;
                img.alt = '';
                img.dataset.spriteDex = String(pkDex);
                img.dataset.spriteShiny = pk.shiny ? '1' : '0';
                img.dataset.spriteStep = '0';
                img.dataset.spriteFallbackText = '?';
                spriteBox.replaceChildren(img);
            } else {
                setText(spriteBox, '?');
            }
        }
        const pct = pk ? Math.max(0, Math.min(100, Number(pk.hpPercent) || 0)) : 0;
        setText(card.querySelector('.pcard-poke-name'), pk ? `${pk.shiny ? '★ ' : ''}${pk.name} Nv ${pk.level}` : 'Aguardando Pokémon');
        const fill = card.querySelector('.pcard-hp i');
        fill.style.width = `${pct}%`;
        fill.style.background = pct > 55 ? '#10b981' : pct > 25 ? '#f59e0b' : '#ef4444';
        setText(card.querySelector('.pcard-hp-txt'), pk ? `${fmtNum(pk.hp)} / ${fmtNum(pk.maxHp)} HP (${pct}%)` : '');

        const profitH = Number(st.netGoldPerHour ?? st.goldPerHour ?? 0);
        const tiles = [
            ['XP/h', fmtShortNum(st.xpPerHour), ''],
            ['Lucro/h', `${profitH < 0 ? '-' : '+'}${fmtShortNum(Math.abs(profitH))}`, profitH < 0 ? 'neg' : ''],
            ['Abates', fmtNum(st.kills), ''],
            ['Capturas', fmtNum(st.captures), ''],
            ['Shinies', fmtNum(st.shiniesCaptured), ''],
            ['Tempo/abate', st.avgKillSec > 0 ? `${String(st.avgKillSec).replace('.', ',')}s` : '-', ''],
            ['Captura/abate', st.kills > 0 ? `${String(st.capturePerKillPct || 0).replace('.', ',')}%` : '-', ''],
            ['Tempo ativo', fmtUptime(st.uptimeSec), ''],
        ];
        const statsHtml = tiles.map(([k, v, cls]) => `<div${cls ? ` class="${cls}"` : ''}><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('');
        const statsEl = card.querySelector('.pcard-stats');
        if (statsEl.dataset.sig !== statsHtml) {
            statsEl.dataset.sig = statsHtml;
            statsEl.innerHTML = statsHtml;
        }
        const dr = s.drops || {};
        const hitDrops = (dr.featured || []).filter((d) => d.qty > 0).slice(0, 4);
        card.querySelector('.pcard-drops').textContent = hitDrops.length
            ? `Drops da sessão: ${hitDrops.map((d) => `${d.name} x${d.qty}`).join(' · ')}`
            : 'Drops da sessão: nenhum ainda';

        const running = RUNNING_STATUSES.includes(status);
        const runBtn = card.querySelector('[data-pc-act="run"]');
        setText(runBtn, running ? 'Pausar' : status === 'paused' ? 'Retomar Headless' : 'Iniciar Headless');
        setClass(runBtn, running ? 'btn sm' : 'btn sm primary');
    }
}

function fmtShortNum(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    const a = Math.abs(v);
    const one = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
    if (a >= 1e9) return `${one(v / 1e9)} bi`;
    if (a >= 1e6) return `${one(v / 1e6)} mi`;
    if (a >= 1e4) return `${one(v / 1e3)} mil`;
    return fmtNum(v);
}

async function handlePanelCardAction(acc, act) {
    if (act === 'select') {
        selectAccount(acc);
    } else if (act === 'run') {
        const running = RUNNING_STATUSES.includes(snapshots[acc]?.status);
        await sendAction(running ? 'pause' : 'start', {}, acc);
    } else if (act === 'panel') {
        selectAccount(acc);
        setViewMode('panel-only');
    } else if (act === 'game') {
        selectAccount(acc);
        setViewMode('split');
        await openEmbeddedForAccount(acc);
    }
}

// ===== Sons de alerta =====
// A configuracao fica no main (.pokebot-sounds), que tambem avisa quando tocar.
let soundCfg = null;
const soundDataCache = new Map(); // evento -> data URL do som escolhido
let soundCtx = null;

function setSoundStatus(event, text, kind = '') {
    const el = document.querySelector(`[data-snd-status="${event}"]`);
    if (!el) return;
    setText(el, text || '');
    setClass(el, `sound-status hint-text${kind ? ` ${kind}` : ''}`);
}

function renderSoundCard() {
    const cfg = soundCfg;
    if (!cfg) return;
    const card = document.getElementById('soundCard');
    const en = document.getElementById('sndEnabled');
    const vol = document.getElementById('sndVolume');
    const volVal = document.getElementById('sndVolumeVal');
    const masterVol = Math.min(1, Math.max(0, Number(cfg.volume ?? 0.8)));
    if (en) en.checked = cfg.enabled !== false;
    if (vol && document.activeElement !== vol) vol.value = String(Math.round(masterVol * 100));
    if (volVal) volVal.textContent = `${Math.round(masterVol * 100)}%`;
    card?.classList.toggle('is-off', cfg.enabled === false);
    for (const [event, ev] of Object.entries(cfg.events || {})) {
        const tg = document.querySelector(`[data-snd-toggle="${event}"]`);
        if (tg) tg.checked = ev.enabled !== false;
        for (const ch of ['toast', 'os']) {
            const box = document.querySelector(`[data-alert-ch="${ch}"][data-alert-ev="${event}"]`);
            if (box) box.checked = ev[ch] !== false;
        }
        const evVol = Math.min(1, Math.max(0, Number(ev.volume ?? 1)));
        const evPct = Math.round(evVol * 100);
        const effPct = Math.round(masterVol * evVol * 100);
        const evVolInput = document.querySelector(`[data-snd-vol="${event}"]`);
        const evVolVal = document.querySelector(`[data-snd-vol-val="${event}"]`);
        const evVolRow = document.querySelector(`[data-snd-vol-row="${event}"]`);
        if (evVolInput && document.activeElement !== evVolInput) evVolInput.value = String(evPct);
        if (evVolInput) evVolInput.title = `Volume deste alerta: ${evPct}% (efetivo: ${effPct}% com geral em ${Math.round(masterVol * 100)}%)`;
        if (evVolVal) evVolVal.textContent = `${evPct}%`;
        if (evVolRow) evVolRow.classList.toggle('is-muted', ev.enabled === false);
        const cur = document.querySelector(`[data-snd-current="${event}"]`);
        if (cur) {
            cur.textContent = ev.custom
                ? (ev.title || 'Som escolhido')
                : (ev.defaultTitle ? `Padrão · ${ev.defaultTitle}` : 'Som padrão');
            cur.title = ev.custom ? ev.url : (ev.defaultUrl || 'Bipe do Nexo');
            cur.classList.toggle('custom', Boolean(ev.custom));
        }
        const input = document.querySelector(`[data-snd-url="${event}"]`);
        if (input && document.activeElement !== input && !input.dataset.touched) input.value = ev.url || '';
    }
}

// Bipe de contingencia quando nao ha som padrao ou sem internet no primeiro cache.
const DEFAULT_BEEPS = {
    shinyMiss: [880, 660, 440],
    shinyCaught: [523, 659, 784, 1047],
    rareDrop: [784, 988, 1175],
    error: [330, 262],
    chest: [659, 880],
    vote: [587, 784],
};
const activeSoundNodes = new Set();

function ensureSoundContext() {
    if (!soundCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        soundCtx = new Ctx();
    }
    return soundCtx;
}

function dataUrlToArrayBuffer(dataUrl) {
    const comma = String(dataUrl || '').indexOf(',');
    if (comma < 0) return null;
    const b64 = dataUrl.slice(comma + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

async function playBufferViaWebAudio(dataUrl, volume) {
    const ctx = ensureSoundContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
    }
    if (ctx.state !== 'running') return false;
    const arr = dataUrlToArrayBuffer(dataUrl);
    if (!arr) return false;
    const decoded = await ctx.decodeAudioData(arr);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = decoded;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    src.connect(gain).connect(ctx.destination);
    activeSoundNodes.add(src);
    src.onended = () => activeSoundNodes.delete(src);
    src.start(0);
    return true;
}

async function playDefaultBeep(volume, event = 'shinyMiss') {
    if (volume <= 0) return;
    try {
        const ctx = ensureSoundContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            await ctx.resume().catch(() => {});
        }
        const notes = DEFAULT_BEEPS[event] || DEFAULT_BEEPS.shinyMiss;
        notes.forEach((freq, i) => {
            const t0 = ctx.currentTime + i * 0.17;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, t0);
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.35 * volume), t0 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
            osc.connect(gain).connect(ctx.destination);
            osc.start(t0);
            osc.stop(t0 + 0.18);
        });
    } catch {
        // sem WebAudio
    }
}

async function playSoundEvent(event, { force = false } = {}) {
    const cfg = soundCfg || (soundCfg = await window.pokeHub.getSoundConfig?.().catch(() => null));
    if (!cfg) return false;
    const ev = cfg.events?.[event];
    if (!force && (cfg.enabled === false || ev?.enabled === false)) return false;
    const masterVol = Math.min(1, Math.max(0, Number(cfg.volume ?? 0.8)));
    const eventVol = Math.min(1, Math.max(0, Number(ev?.volume ?? 1)));
    const volume = Math.min(1, Math.max(0, masterVol * eventVol));
    if (volume <= 0) return false;
    if (ev?.custom || ev?.hasAudio) {
        let src = soundDataCache.get(event);
        if (!src) {
            src = await window.pokeHub.getSoundData?.(event).catch(() => null);
            if (src) soundDataCache.set(event, src);
        }
        if (src) {
            try {
                const audio = new Audio(src);
                audio.volume = volume;
                activeSoundNodes.add(audio);
                const cleanup = () => activeSoundNodes.delete(audio);
                audio.addEventListener('ended', cleanup, { once: true });
                audio.addEventListener('error', cleanup, { once: true });
                await audio.play();
                return true;
            } catch {
                try {
                    if (await playBufferViaWebAudio(src, volume)) return true;
                } catch {
                    // cai no bipe padrao
                }
            }
        }
    }
    await playDefaultBeep(volume, event);
    return true;
}

async function initSoundControls() {
    if (!window.pokeHub.getSoundConfig) return;
    soundCfg = await window.pokeHub.getSoundConfig().catch(() => null);
    renderSoundCard();

    document.getElementById('sndEnabled')?.addEventListener('change', async (e) => {
        soundCfg = await window.pokeHub.setSoundConfig({ enabled: e.target.checked });
        renderSoundCard();
    });
    const vol = document.getElementById('sndVolume');
    let volTimer = null;
    vol?.addEventListener('input', () => {
        const v = Number(vol.value) / 100;
        setText(document.getElementById('sndVolumeVal'), `${Math.round(v * 100)}%`);
        if (soundCfg) soundCfg.volume = v;
        clearTimeout(volTimer);
        volTimer = setTimeout(async () => {
            soundCfg = await window.pokeHub.setSoundConfig({ volume: v });
            renderSoundCard();
        }, 300);
    });
    const evVolTimers = new Map();
    document.querySelectorAll('[data-snd-vol]').forEach((slider) => {
        slider.addEventListener('input', () => {
            const event = slider.dataset.sndVol;
            const v = Math.min(1, Math.max(0, Number(slider.value) / 100));
            const pct = Math.round(v * 100);
            const valEl = document.querySelector(`[data-snd-vol-val="${event}"]`);
            if (valEl) valEl.textContent = `${pct}%`;
            const masterVol = Math.min(1, Math.max(0, Number(soundCfg?.volume ?? 0.8)));
            slider.title = `Volume deste alerta: ${pct}% (efetivo: ${Math.round(masterVol * v * 100)}% com geral em ${Math.round(masterVol * 100)}%)`;
            if (soundCfg?.events?.[event]) soundCfg.events[event].volume = v;
            clearTimeout(evVolTimers.get(event));
            evVolTimers.set(event, setTimeout(async () => {
                soundCfg = await window.pokeHub.setSoundConfig({ event, eventVolume: v });
                renderSoundCard();
            }, 250));
        });
    });
    document.querySelectorAll('[data-snd-toggle]').forEach((tg) => {
        tg.addEventListener('change', async () => {
            soundCfg = await window.pokeHub.setSoundConfig({ event: tg.dataset.sndToggle, eventEnabled: tg.checked });
            renderSoundCard();
        });
    });
    document.querySelectorAll('[data-alert-ch]').forEach((tg) => {
        tg.addEventListener('change', async () => {
            soundCfg = await window.pokeHub.setSoundConfig({ event: tg.dataset.alertEv, channel: tg.dataset.alertCh, value: tg.checked });
            renderSoundCard();
        });
    });
    document.querySelectorAll('[data-snd-url]').forEach((input) => {
        input.addEventListener('input', () => { input.dataset.touched = '1'; });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.querySelector(`[data-snd-act="save"][data-snd-event="${input.dataset.sndUrl}"]`)?.click();
        });
    });
    document.querySelectorAll('[data-snd-act]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const event = btn.dataset.sndEvent;
            const act = btn.dataset.sndAct;
            if (act === 'test') {
                await playSoundEvent(event, { force: true });
                return;
            }
            if (act === 'reset') {
                soundCfg = await window.pokeHub.resetSound(event);
                soundDataCache.delete(event);
                const input = document.querySelector(`[data-snd-url="${event}"]`);
                if (input) { input.value = ''; delete input.dataset.touched; }
                renderSoundCard();
                const defTitle = soundCfg?.events?.[event]?.defaultTitle;
                setSoundStatus(event, defTitle ? `Voltou para o padrão (${defTitle}).` : 'Voltou para o som padrão.', 'ok');
                return;
            }
            if (act === 'save') {
                const input = document.querySelector(`[data-snd-url="${event}"]`);
                const url = String(input?.value || '').trim();
                if (!url) {
                    setSoundStatus(event, 'Cole um link primeiro.', 'err');
                    return;
                }
                btn.disabled = true;
                setSoundStatus(event, 'Baixando o som...', 'busy');
                const res = await window.pokeHub.setSoundLink(event, url).catch((err) => ({ ok: false, error: err?.message || String(err) }));
                btn.disabled = false;
                if (!res?.ok) {
                    setSoundStatus(event, `Não deu: ${res?.error || 'erro desconhecido'}.`, 'err');
                    return;
                }
                soundCfg = res.cfg;
                soundDataCache.delete(event);
                if (input) delete input.dataset.touched;
                renderSoundCard();
                setSoundStatus(event, `Pronto: "${soundCfg.events?.[event]?.title || 'som'}" salvo. Tocando para conferir.`, 'ok');
                void playSoundEvent(event, { force: true });
            }
        });
    });

    window.pokeHub.onPlaySound?.(({ event } = {}) => {
        if (event && !window.hubUi?.isPopout?.()) void playSoundEvent(event);
    });
    window.pokeHub.onSoundConfigChanged?.(({ cfg, invalidateEvent } = {}) => {
        if (cfg) {
            soundCfg = cfg;
            if (invalidateEvent) soundDataCache.delete(invalidateEvent);
            renderSoundCard();
        }
    });

    const srvShinyChk = $('cNotifyServerShiny');
    if (srvShinyChk) {
        try {
            srvShinyChk.checked = localStorage.getItem('nexo_notify_server_shiny') !== '0';
        } catch {
            srvShinyChk.checked = true;
        }
        srvShinyChk.addEventListener('change', () => {
            try {
                localStorage.setItem('nexo_notify_server_shiny', srvShinyChk.checked ? '1' : '0');
            } catch { /* ignore */ }
        });
    }
    $('notifyDropCats')?.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-notify-drop-cat]');
        if (!btn) return;
        const cat = btn.dataset.notifyDropCat;
        if (!cat) return;
        const cur = new Set(snapshots[activeAccount]?.config?.dropNotifyCategories || ['outland', 'unova', 'boss', 'other']);
        if (cur.has(cat)) cur.delete(cat);
        else cur.add(cat);
        await sendAction('set-config', { config: { dropNotifyCategories: [...cur] } });
    });
    $('cNotifyDropCommon')?.addEventListener('change', async (ev) => {
        await sendAction('set-config', { config: { dropNotifyCommon: ev.target.checked } });
    });
    $('cNotifyNewSpecies')?.addEventListener('change', async (ev) => {
        await sendAction('set-config', { config: { notifyCatchNewSpecies: ev.target.checked } });
    });
    $('cNotifyDropAllow')?.addEventListener('change', async (ev) => {
        const items = String(ev.target.value || '')
            .split(/[,;\n]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        await sendAction('set-config', { config: { dropNotifyAllowItems: items } });
    });
    $('btnCloseShinyInspect')?.addEventListener('click', () => closeShinyInspectCard());
    $('shinyInspectModal')?.addEventListener('click', (ev) => {
        if (ev.target === $('shinyInspectModal')) closeShinyInspectCard();
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') closeShinyInspectCard();
    });
}

function initGridControls() {
    $('gridToolbar')?.addEventListener('click', (ev) => {
        const layoutBtn = ev.target.closest('[data-grid-layout]');
        const sumBtn = ev.target.closest('[data-grid-summary]');
        const showBtn = ev.target.closest('[data-grid-show]');
        if (layoutBtn) {
            gridState.layout = layoutBtn.dataset.gridLayout;
            gridState.max = 0;
        } else if (sumBtn) {
            const nextDock = sumBtn.dataset.gridSummary;
            for (const acc of ACCOUNTS) slotSidebarState.grid[acc].dock = nextDock;
            saveSlotSidebarState();
            applySummaryLayout();
            return;
        } else if (ev.target.closest('#btnGridSummaryDensity')) {
            const allCompact = ACCOUNTS.every((a) => slotSidebarState.grid[a]?.density === 'compact');
            const nextDensity = allCompact ? 'full' : 'compact';
            for (const acc of ACCOUNTS) slotSidebarState.grid[acc].density = nextDensity;
            saveSlotSidebarState();
            applySummaryLayout();
            return;
        } else if (showBtn) {
            const acc = Number(showBtn.dataset.gridShow);
            gridState.hidden = gridState.hidden.filter((a) => a !== acc);
        } else if (ev.target.closest('#btnGridMuteAll')) {
            const embedded = [...webviews.keys()];
            const anyOn = embedded.some((acc) => !isAccountMuted(acc));
            embedded.forEach((acc) => setAccountMuted(acc, anyOn));
            return;
        } else if (ev.target.closest('#btnGridReset')) {
            gridState = {
                layout: '2x2',
                order: [...ACCOUNTS],
                hidden: [],
                max: 0,
                colSplit: 0.5,
                rowSplit: 0.5,
                colWeights: [1, 1, 1, 1],
                rowWeights: [1, 1, 1, 1],
            };
            accSortMode = 'manual';
            saveAccSortMode();
            slotSidebarState = makeDefaultSlotSidebars();
            saveSlotSidebarState();
        } else {
            return;
        }
        saveGridState();
        applyAccountTabOrder();
        applyGridLayout();
        applySummaryLayout();
        renderGridToolbar();
    });
    const onSortChange = (nextMode) => {
        if (!ACC_SORT_MODES.includes(nextMode)) return;
        accSortMode = nextMode;
        saveAccSortMode();
        applyAccountTabOrder();
        if (viewMode === 'grid') applyGridLayout();
        renderPanelsGrid();
    };
    $('accSortSelect')?.addEventListener('change', (ev) => onSortChange(ev.target.value));
    $('gridSortSelect')?.addEventListener('change', (ev) => onSortChange(ev.target.value));
    document.querySelectorAll('[data-split-dock]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const m = btn.dataset.splitDock;
            if (!SPLIT_DOCK_MODES.includes(m)) return;
            splitDockMode = m;
            saveSplitDockMode();
            applySplitDock();
        });
    });
    $('btnReopenControlPane')?.addEventListener('click', () => {
        splitDockMode = 'left';
        saveSplitDockMode();
        applySplitDock();
    });
    $('btnCloseBfBanner')?.addEventListener('click', () => {
        const endsAt = snapshots[activeAccount]?.gameIntel?.blackFriday?.endsAt || 'active';
        try { localStorage.setItem(DISMISSED_BF_KEY, String(endsAt)); } catch { /* ignore */ }
        $('blackFridayBanner')?.classList.add('hidden');
    });
    $('probAlertsHost')?.addEventListener('click', (ev) => {
        const xBtn = ev.target.closest('[data-dismiss-alert]');
        if (!xBtn) return;
        const alertId = xBtn.dataset.dismissAlert;
        if (!alertId) return;
        dismissedAlerts.add(`${activeAccount}:${alertId}`);
        saveDismissedAlerts();
        renderTopIntelBar(snapshots[activeAccount]);
    });
    $('browserStage')?.addEventListener('click', (ev) => {
        const densBtn = ev.target.closest('button[data-sum-density]');
        if (densBtn) {
            const acc = Number(densBtn.dataset.slot || densBtn.closest('.wv-summary')?.dataset?.slot || 0);
            const nextDensity = densBtn.dataset.sumDensity;
            if (ACCOUNTS.includes(acc) && SUMMARY_DENSITY_MODES.includes(nextDensity)) {
                const bucket = getSlotSidebarBucket();
                slotSidebarState[bucket][acc].density = nextDensity;
                saveSlotSidebarState();
                applySummaryLayout();
            }
            return;
        }
        const posBtn = ev.target.closest('[data-sum-pos]');
        if (!posBtn) return;
        const acc = Number(posBtn.dataset.slot || posBtn.closest('.wv-summary')?.dataset?.slot || 0);
        const pos = posBtn.dataset.sumPos;
        if (!ACCOUNTS.includes(acc)) return;
        const bucket = getSlotSidebarBucket();
        if (pos === 'close') {
            slotSidebarState[bucket][acc].dock = 'off';
        } else if (SUMMARY_DOCK_MODES.includes(pos)) {
            slotSidebarState[bucket][acc].dock = pos;
        }
        saveSlotSidebarState();
        applySummaryLayout();
    });
    wireGridGutter($('gridGutterV'), 'v');
    wireGridGutter($('gridGutterH'), 'h');
    wireSummaryResizers();
    wireGridDrag();
    wireAccountTabDrag();
    for (const acc of ACCOUNTS) {
        const icon = $(`tabAudio-${acc}`);
        icon?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            setAccountMuted(acc, !isAccountMuted(acc));
        });
        updateAudioIndicators(acc);
    }
    $('panelsGrid')?.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-pc-act]');
        const card = ev.target.closest('.pcard');
        if (!btn || !card) return;
        void handlePanelCardAction(Number(card.dataset.acc), btn.dataset.pcAct);
    });
    const stage = $('browserStage');
    if (stage && typeof ResizeObserver === 'function') {
        new ResizeObserver(() => {
            if (viewMode === 'grid') positionGridGutters(gridGutters);
        }).observe(stage);
    }
    applyAccountTabOrder();
    applySplitDock();
    applyGridLayout();
    applySummaryLayout();
    renderGridToolbar();
}

function setViewMode(mode, { skipAutoClose = false } = {}) {
    viewMode = mode;
    hubHook('onViewMode', mode);
    const ws = $('workspace');
    ws.classList.remove('mode-split', 'mode-grid', 'mode-panel-only', 'mode-panels-grid');
    ws.classList.add(`mode-${mode}`);
    document.querySelectorAll('.seg-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.view === mode);
    });
    if ((mode === 'panel-only' || mode === 'panels-grid') && !skipAutoClose && webviews.size > 0) {
        void closeAllEmbeddedToHeadless(mode);
    }
    applySplitDock();
    applyGridLayout();
    applySummaryLayout();
    renderGridToolbar();
    renderPanelsGrid();
    hubHook('afterViewMode', mode);
}

// A aba aparece no mesmo quadro do clique; o refresh dos dados vem no quadro
// seguinte (e trocas rápidas viram um render só). Com o jogo embutido isso
// evita que o clique espere o render inteiro do painel.
let subtabRenderPending = false;
function scheduleSubtabRender() {
    if (subtabRenderPending) return;
    subtabRenderPending = true;
    requestAnimationFrame(() => setTimeout(() => {
        subtabRenderPending = false;
        renderActiveAccountPanel();
    }, 0));
}

function setSubtab(tab) {
    if (hubHook('onSubtab', tab) === true) {
        if (tab === 'lives') setTimeout(requestLivesRefresh, 0);
        scheduleSubtabRender();
        return;
    }
    document.querySelectorAll('.subtab').forEach((b) => {
        b.classList.toggle('active', b.dataset.subtab === tab);
    });
    if (tab === 'lives') setTimeout(requestLivesRefresh, 0);
    document.querySelectorAll('.tab-panel').forEach((p) => {
        p.classList.toggle('hidden', p.id !== `tab-${tab}`);
    });
    scheduleSubtabRender();
}

async function sendAction(action, payload = {}, acc = activeAccount) {
    if (action === 'set-config' && Object.keys(payload?.config || {}).some((k) => /^(drop|advisor)/.test(k))) advisorLists.at = 0;
    const res = await window.pokeHub.action(acc, action, payload);
    if (res?.snapshots) {
        snapshots = res.snapshots;
        renderAll();
    } else {
        await pollSnapshots();
    }
    return res;
}

const chestClaimsPending = new Set();

async function claimTwitchChest(channel, acc = activeAccount, btn = null) {
    const key = `${acc}:${channel}`;
    if (chestClaimsPending.has(key)) return null;
    chestClaimsPending.add(key);
    if (btn) {
        btn.disabled = true;
        setText(btn, 'Resgatando…');
    }
    let res = null;
    try {
        res = await sendAction('claim-twitch-chest', { channel }, acc);
    } finally {
        chestClaimsPending.delete(key);
        // A lista pode ter sido redesenhada; se o botao ainda existe, restaura
        if (btn?.isConnected) {
            btn.disabled = false;
            setText(btn, 'Resgatar +50');
        }
    }
    // O sucesso ja chega como log 'reward' da conta (vira aviso pelo fluxo normal)
    if (!res?.ok) {
        showToast({
            kind: res?.fallback ? 'warn' : 'error',
            title: `Caixinha +50 · Conta ${acc}`,
            text: res?.error || 'Falha ao resgatar a caixinha.',
            account: acc,
        });
    }
    return res;
}

function setConfigDirty(dirty) {
    dirtyByAcc[activeAccount] = dirty;
    $('btnSaveCfg').disabled = !dirty;
    const hint = $('cfgHint');
    if (hubHook('onConfigDirty', dirty) === true) return;
    setText(hint, dirty ? 'Alterações pendentes' : '');
    setClass(hint, dirty ? 'hint-text dirty' : 'hint-text');
}

function readCheckedPotions() {
    return Array.from(document.querySelectorAll('#cfgChips input[data-potion]:checked'))
        .map((el) => Number(el.dataset.potion))
        .filter((n) => Number.isFinite(n));
}

function readCheckedRewards(attr) {
    return Array.from(document.querySelectorAll(`#cfgChips input[${attr}]:checked`))
        .map((el) => el.getAttribute(attr))
        .filter(Boolean);
}

function formatBonusMins(mins) {
    const m = Math.max(0, Math.floor(Number(mins || 0)));
    if (m <= 0) return 'off';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h > 0 ? `${h}h${String(r).padStart(2, '0')}m` : `${r}m`;
}

/** Campo vazio = o servidor usa 35% do alvo. */
function readMinField(id) {
    const raw = String($(id)?.value ?? '').trim();
    if (!raw) return undefined;
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 1 ? n : undefined;
}

function readConfigForm() {
    const targetRevives = Math.max(0, Number($('cTargetRevives').value) || 0);
    const liveTwitchRewards = readCheckedRewards('data-tw-reward');
    const liveKickRewards = readCheckedRewards('data-kk-reward');
    const fallbackKind = liveTwitchRewards[0] || liveKickRewards[0] || 'xp';
    const config = {
        caidosEnabled: $('cCaidos').checked,
        ensureNativeAutoHeal: $('cNativeHeal').checked,
        restockEnabled: $('cRestock').checked,
        dailyPassEnabled: $('cPass').checked,
        preyEnabled: $('cPrey').checked,
        incubatorEnabled: Boolean($('cIncubator')?.checked),
        liveEnabled: $('cLives').checked,
        liveStreakWatch: $('cLiveStreak').checked,
        liveAutoFollow: $('cLiveFollow').checked,
        liveSmartBalance: $('cLiveSmart').checked,
        liveSyncPlatforms: Boolean($('cLiveSyncPlatforms')?.checked),
        liveTargetHours: Number($('cLiveTargetHours').value) || 24,
        economyMode: $('cEconomy').checked ? 'on' : 'auto',
        economyPingOnly: $('cEconomyPingOnly').checked,
        standbyOn4001: $('cStandby').checked,
        preferredBall: $('cBall').value,
        targetBalls: Number($('cTargetBalls').value) || 50,
        targetPotions: Math.max(0, Number($('cTargetPotions').value) || 0),
        preferredPotionIds: readCheckedPotions(),
        restockPotionId: $('cRestockPotion').value === 'opt' ? 0 : (Number($('cRestockPotion').value) || 0),
        potionOptimize: $('cRestockPotion').value === 'opt',
        ballEconomy: $('cBallEconomy').checked,
        pvpQueue: $('cPvpQueue').checked,
        targetRevives,
        restockRevive: targetRevives > 0,
        minBalls: readMinField('cMinBalls'),
        minPotions: readMinField('cMinPotions'),
        minRevives: readMinField('cMinRevives'),
        minGoldReserve: Math.max(0, Number($('cReserve').value) || 0),
        huntGuideMode: $('cGuideMode').value,
        huntGuideMetric: $('cGuideMetric').value,
        farmObjective: $('cFarmObjective')?.value || 'off',
        farmObjectiveFocus: $('cFarmObjectiveFocus')?.value || 'xp',
        liveRewardType: fallbackKind,
        liveTwitchRewards,
        liveKickRewards,
        liveRewardTier: $('cLiveTier').value,
        liveMaxTwitchSlots: Number($('cLiveMaxTw').value) || 4,
        liveMaxKickSlots: Number($('cLiveMaxKk').value) || 2,
        liveCustomTwitch: $('cLiveCustomTw').value.trim(),
        liveCustomKick: $('cLiveCustomKk').value.trim(),
        autoCraftShinyEgg: Boolean($('cAutoCraftShinyEgg')?.checked ?? true),
        autoSacrificeRedeem: Boolean($('cAutoSacrificeRedeem')?.checked),
        autoOferendaOnFull: Boolean($('cAutoOferendaOnFull')?.checked),
        autoRaidEnroll: Boolean($('cAutoRaidEnroll')?.checked),
        autoShowdownEnroll: Boolean($('cAutoShowdownEnroll')?.checked),
        autoMisticoEnter: Boolean($('cAutoMisticoEnter')?.checked),
        autoExtendListings: Boolean($('cAutoExtendListings')?.checked),
        autoOptimizeGear: Boolean($('cAutoOptimizeGear')?.checked),
    };
    return config;
}

async function applyConfigTo(acc, config) {
    const res = await sendAction('set-config', { config }, acc);
    const wv = webviews.get(acc);
    if (wv && 'caidosEnabled' in config) {
        wv.executeJavaScript(`window.__pbSetNeedCampoFeed && window.__pbSetNeedCampoFeed(${JSON.stringify(Boolean(config.caidosEnabled))})`).catch(() => {});
    }
    return res;
}

async function saveConfig() {
    const acc = activeAccount;
    const config = readConfigForm();
    setConfigDirty(false);
    const res = await applyConfigTo(acc, config);
    if (res?.ok) {
        setText($('cfgHint'), 'Alterações salvas');
    }
    return res;
}

let lastModeWarnSig = '';

function renderModeWarningsBanner(data) {
    const host = $('modeWarnBanner');
    if (!host) return;
    const rawList = Array.isArray(data?.modeWarnings) ? data.modeWarnings : [];
    const rawCodes = new Set(rawList.map((w) => String(w.code)));
    for (const key of [...dismissedModeWarns]) {
        if (key.startsWith(`${activeAccount}:`) && !rawCodes.has(key.slice(`${activeAccount}:`.length))) {
            dismissedModeWarns.delete(key);
        }
    }
    const list = rawList.filter((w) => !dismissedModeWarns.has(`${activeAccount}:${w.code}`));
    const sig = `${activeAccount}|${list.map((w) => `${w.code}:${w.severity}`).join(',')}`;
    if (sig === lastModeWarnSig) return;
    lastModeWarnSig = sig;
    host.classList.toggle('hidden', list.length === 0);
    if (list.length === 0) {
        host.replaceChildren();
        return;
    }
    const frag = document.createDocumentFragment();
    for (const w of list) {
        const card = document.createElement('div');
        setClass(card, `mode-warn-item ${w.severity === 'danger' ? 'danger' : 'warn'}`);
        const head = document.createElement('div');
        setClass(head, 'mode-warn-head');
        const title = document.createElement('div');
        setClass(title, 'mode-warn-title');
        setText(title, w.title);
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        setClass(closeBtn, 'mode-warn-close');
        closeBtn.title = 'Fechar aviso';
        closeBtn.setAttribute('aria-label', 'Fechar aviso');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => {
            dismissedModeWarns.add(`${activeAccount}:${w.code}`);
            lastModeWarnSig = '';
            renderModeWarningsBanner(snapshots[activeAccount]);
        });
        head.append(title, closeBtn);
        const detail = document.createElement('div');
        setClass(detail, 'mode-warn-detail');
        setText(detail, w.detail);
        card.append(head, detail);
        if (w.fixConfig) {
            const actRow = document.createElement('div');
            setClass(actRow, 'mode-warn-actions');
            const btn = document.createElement('button');
            btn.type = 'button';
            setClass(btn, 'btn sm primary');
            setText(btn, w.fixLabel || 'Restaurar modo completo');
            btn.addEventListener('click', async () => {
                dirtyByAcc[activeAccount] = false;
                await sendAction('set-config', { config: w.fixConfig });
                const activeWv = webviews.get(activeAccount);
                if (activeWv && w.fixConfig.caidosEnabled !== false) {
                    activeWv.executeJavaScript('window.__pbSetNeedCampoFeed && window.__pbSetNeedCampoFeed(true)').catch(() => {});
                }
                showToast({
                    kind: 'ok',
                    title: `Conta ${activeAccount}`,
                    text: 'Captura automática restaurada.',
                    account: activeAccount,
                });
            });
            actRow.appendChild(btn);
            card.appendChild(actRow);
        }
        frag.appendChild(card);
    }
    host.replaceChildren(frag);
}

function renderConfigModePreview() {
    const box = $('cfgModeWarnBox');
    if (!box) return;
    const pingOnly = Boolean($('cEconomyPingOnly')?.checked);
    const serverEco = Boolean($('cEconomy')?.checked);
    const caidosOn = Boolean($('cCaidos')?.checked);
    const livesOn = Boolean($('cLives')?.checked);
    const smartOn = Boolean($('cLiveSmart')?.checked);
    const objMode = $('cFarmObjective')?.value || 'off';

    const items = [];
    if (pingOnly) {
        items.push({
            cls: 'danger',
            title: 'Limitação ativa: Modo Somente Ping',
            detail: 'Pausa captura automática, restock, passe diário, prey e /hunt (mantém só a conexão viva e as lives).',
        });
    } else {
        if (!caidosOn) {
            const objLabel = objMode === 'pokedex'
                ? 'Completar Pokédex'
                : (objMode === 'topcatch' ? 'Modo Top Catch' : (objMode === 'bestiary' ? 'Bestiário' : (objMode === 'team-pvp' ? 'Montar Time PvP' : '')));
            items.push({
                cls: objLabel ? 'danger' : 'warn',
                title: objLabel ? `Limitação ativa: ${objLabel} exige captura automática` : 'Limitação ativa: Captura automática desligada',
                detail: objLabel
                    ? `Sem "Capturar Pokémon caídos", o modo ${objLabel} não captura os Pokémon pendentes para avançar de mapa.`
                    : 'O bot não vai lançar Pokébolas em Pokémon caídos nem em Shinies.',
            });
        }
        if (serverEco) {
            items.push({
                cls: 'warn',
                title: 'Limitação ativa: Economia do servidor (caídos pelo fallback de batalha)',
                detail: 'No Headless, o servidor corta o feed de campo. O bot tenta capturar pelo fallback de batalha e pode perder caídos (cada caído perdido é uma chance de shiny a menos). Deixe desmarcado para manter 0% GPU + captura 100% garantida.',
            });
        }
    }

    if (items.length === 0) {
        items.push({
            cls: 'ok',
            title: 'Modo completo: captura garantida',
            detail: `Captura em caídos ativa: toda bola jogada é uma chance de shiny (inclusive no Modo Eco Headless e no Modo Economia visual do jogo com 0% GPU)${livesOn ? (smartOn ? ' · Gestor Inteligente de Buffs ligado.' : ' · Lives ligadas.') : '.'}`,
        });
    }

    const frag = document.createDocumentFragment();
    for (const it of items) {
        const el = document.createElement('div');
        setClass(el, `mode-warn-item ${it.cls}`);
        const t = document.createElement('div');
        setClass(t, 'mode-warn-title');
        setText(t, it.title);
        const d = document.createElement('div');
        setClass(d, 'mode-warn-detail');
        setText(d, it.detail);
        el.append(t, d);
        frag.appendChild(el);
    }
    box.replaceChildren(frag);
}

function renderTopTabsAndSlots() {
    applyAccountTabOrder();
    if (viewMode === 'grid' && accSortMode !== 'manual') {
        applyGridLayout();
    }
    for (const acc of ACCOUNTS) {
        const s = snapshots[acc];
        const status = s?.status || 'disconnected';
        const nick = s?.trainer?.nick && s.trainer.nick !== '-'
            ? s.trainer.nick
            : (s?.session?.nick || `Conta ${acc}`);
        const hunt = s?.trainer?.huntName && s.trainer.huntName !== '-' ? s.trainer.huntName : '';
        const stLabel = STATUS_LABELS[status] || status.toUpperCase();
        const isEmbedded = webviews.has(acc);
        const warns = Array.isArray(s?.modeWarnings) ? s.modeWarnings : [];

        const tabBtn = document.querySelector(`.acc-tab[data-acc="${acc}"]`);
        if (tabBtn) {
            tabBtn.classList.toggle('has-mode-warn', warns.length > 0);
            tabBtn.title = warns.length > 0 ? warns.map((w) => w.title).join(' | ') : '';
        }
        const dot = $(`dot-${acc}`);
        if (dot) dot.className = `acc-dot ${status}`;
        const tabName = $(`tabName-${acc}`);
        if (tabName) tabName.textContent = `${acc}. ${nick}`;
        const tabSub = $(`tabSub-${acc}`);
        if (tabSub) {
            const baseSub = hunt ? `${stLabel} · ${hunt}` : stLabel;
            setText(tabSub, warns.length > 0 ? `⚠ ${baseSub}` : baseSub);
        }

        // Browser slot header & placeholder
        const sDot = $(`slotDot-${acc}`);
        if (sDot) sDot.className = `acc-dot ${status}`;
        const sTitle = $(`slotTitle-${acc}`);
        if (sTitle) sTitle.textContent = `Conta ${acc} · ${nick}`;
        const sHunt = $(`slotHunt-${acc}`);
        if (sHunt) sHunt.textContent = hunt ? `${hunt} · ${stLabel}` : stLabel;

        const toggleBtn = document.querySelector(`[data-slot-act="toggle"][data-slot="${acc}"]`);
        if (toggleBtn) {
            setText(toggleBtn, isEmbedded ? 'Ir p/ Headless' : 'Abrir Embutido');
            setClass(toggleBtn, isEmbedded ? 'btn sm primary grid-only' : 'btn sm teal grid-only');
        }
        const reloadBtn = document.querySelector(`[data-slot-act="reload"][data-slot="${acc}"]`);
        if (reloadBtn) reloadBtn.hidden = !isEmbedded;

        if (!isEmbedded) {
            const phTitle = $(`phTitle-${acc}`);
            const phSub = $(`phSub-${acc}`);
            const phStats = $(`phStats-${acc}`);
            if (phTitle) {
                phTitle.textContent = status === 'connected'
                    ? `${nick} · Farmando em Headless`
                    : `Conta ${acc} (${nick}) · ${stLabel}`;
            }
            if (phSub) {
                const guideNote = s?.huntGuide?.note ? ` /hunt: ${s.huntGuide.note}` : '';
                phSub.textContent = status === 'connected'
                    ? `Rodando em 2º plano sem abrir navegador (economia máxima de RAM/CPU).${guideNote}`
                    : 'Use "Abrir no Embutido" no painel ao lado para jogar/logar aqui dentro ou "Iniciar Headless" para farmar em 2º plano.';
            }
            if (phStats) {
                if (status === 'connected' || status === 'paused') {
                    const st = s?.stats || {};
                    const dr = s?.drops || {};
                    const hitDrops = (dr.featured || []).filter((d) => d.qty > 0).slice(0, 3);
                    const dropsSummary = hitDrops.length > 0
                        ? hitDrops.map((d) => `${d.name} x${d.qty}`).join(' · ')
                        : (dr.focusLabel ? `${dr.focusLabel} · 0 drops` : '0 drops');
                    const avgKillTxt = st.avgKillSec > 0 ? `${String(st.avgKillSec).replace('.', ',')}s` : '-';
                    const capPctTxt = st.kills > 0 ? `${String(st.capturePerKillPct || 0).replace('.', ',')}%` : '-';
                    const markup = [
                        `<span class="mini-stat">Hunt: <b>${escapeHtml(hunt || '-')}</b></span>`,
                        `<span class="mini-stat">XP/h: <b>${fmtNum(st.xpPerHour)}</b></span>`,
                        `<span class="mini-stat">Líq./h: <b>${fmtNum(st.netGoldPerHour ?? st.goldPerHour)}</b></span>`,
                        `<span class="mini-stat">Abate: <b>${avgKillTxt}</b> · Cap/abate: <b>${capPctTxt}</b></span>`,
                        `<span class="mini-stat${hitDrops.length ? ' drop-hi' : ''}">Drops: <b>${escapeHtml(dropsSummary)}</b></span>`,
                    ].join('');
                    if (phStats.dataset.signature !== markup) {
                        phStats.dataset.signature = markup;
                        phStats.innerHTML = markup;
                    }
                } else if (phStats.childElementCount) {
                    delete phStats.dataset.signature;
                    phStats.replaceChildren();
                }
            }
        }
    }
}

function renderActiveAccountPanel() {
    const data = snapshots[activeAccount];
    if (!data) return;

    const status = data.status || 'disconnected';
    const isEmbedded = webviews.has(activeAccount);
    const t = data.trainer || {};
    const st = data.stats || {};
    const nick = t.nick && t.nick !== '-' ? t.nick : (data.session?.nick || `Conta ${activeAccount}`);

    setText($('hdrNick'), `Conta ${activeAccount} · ${nick}`);
    const pill = $('hdrStatus');
    setText(pill, STATUS_LABELS[status] || status.toUpperCase());
    setClass(pill, `status-pill ${status}`);

    const errText = data.lastError && status !== 'connected' && status !== 'bridge'
        ? ` · ${data.lastError}`
        : '';
    $('hdrTrainerLine').textContent =
        `Nv ${t.level || 0} · ${fmtNum(t.gold)} gold · ativo há ${fmtUptime(st.uptimeSec)}${errText}`;

    const btnEmb = $('btnToggleEmbedded');
    setText(btnEmb, isEmbedded ? 'Voltar para Headless' : 'Abrir no Embutido');
    btnEmb.title = isEmbedded ? 'Fecha o jogo embutido e segue farmando em segundo plano' : 'Abre o jogo desta conta aqui dentro';
    const runningNow = RUNNING_STATUSES.includes(status);
    const btnStart = $('btnStartHeadless');
    btnStart.style.display = runningNow || isEmbedded ? 'none' : '';
    setText(btnStart, status === 'paused' ? 'Retomar Headless' : 'Iniciar Headless');
    $('btnPause').style.display = runningNow || isEmbedded ? '' : 'none';

    renderModeWarningsBanner(data);

    // Active Pokemon & Hunt
    const pk = data.activePokemon;
    setText($('pokeName'), pk ? `${pk.shiny ? '★ ' : ''}${pk.name} Nv ${pk.level}` : 'Aguardando Pokémon');
    setText($('pokeHpTxt'), pk ? `${fmtNum(pk.hp)} / ${fmtNum(pk.maxHp)} HP (${pk.hpPercent}%)` : '0 / 0 HP');
    const pct = pk ? pk.hpPercent : 0;
    const fill = $('pokeHpFill');
    fill.style.width = `${pct}%`;
    fill.style.background = pct > 55 ? '#10b981' : pct > 25 ? '#f59e0b' : '#ef4444';

    const pkDex = pk ? resolvePokemonSpriteDex(pk.speciesId, pk.name, pk.spriteDex) : 0;
    const spKey = pk && pkDex > 0 ? `${activeAccount}:${pkDex}:${pk.shiny ? 1 : 0}` : '';
    if (spKey !== lastSpriteKey) {
        lastSpriteKey = spKey;
        const box = $('pokeSprite');
        const url = spKey ? pokemonSpriteUrl(pk.speciesId, Boolean(pk.shiny), pkDex, pk.name) : '';
        if (url) {
            const img = document.createElement('img');
            img.alt = '';
            img.dataset.spriteFallbackText = '?';
            setPokemonSpriteImg(img, pk.speciesId, Boolean(pk.shiny), pkDex, pk.name);
            box.replaceChildren(img);
        } else {
            setText(box, '?');
        }
    }

    setText($('huntLine'), `Hunt atual: ${t.huntName || '-'}${t.noCentro ? ' (Centro)' : ''}${t.economyActive ? ' · Economia do servidor ligada' : ''}`);
    const guideMode = data.config?.huntGuideMode || 'off';
    $('huntGuideLine').textContent = guideMode !== 'off' && data.huntGuide?.note
        ? `/hunt: ${data.huntGuide.note}`
        : '';

    const huntSel = $('huntSelect');
    const huntsCount = Number(data.huntsCount || data.hunts?.length || 0);
    if (huntsCount > 0 && sharedHunts.length === 0 && !huntsLoading) {
        huntsLoading = true;
        window.pokeHub.getHunts(activeAccount)
            .then((list) => {
                if (Array.isArray(list) && list.length > 0) {
                    sharedHunts = list;
                    renderActiveAccountPanel();
                }
            })
            .catch(() => {})
            .finally(() => { huntsLoading = false; });
    }
    if (sharedHunts.length !== huntsPopulatedCount && document.activeElement !== huntSel) {
        huntsPopulatedCount = sharedHunts.length;
        const frag = document.createDocumentFragment();
        if (sharedHunts.length > 0) {
            for (const h of sharedHunts) {
                frag.appendChild(new Option(`${h.nome} (Nv ${h.nivel})`, h.slug));
            }
        } else {
            frag.appendChild(new Option('Conecte para listar hunts', ''));
        }
        huntSel.replaceChildren(frag);
    }
    if (t.huntSlug && document.activeElement !== huntSel && huntSel.value !== t.huntSlug) {
        huntSel.value = t.huntSlug;
    }
    refreshHuntAndCenterButtons();
    renderCollectionCard(data);

    // KPIs e Eficiência
    setText($('kKills'), fmtNum(st.kills));
    setText($('kKillsSub'), `${st.killsPerMin || 0}/min`);
    setText($('kXp'), fmtNum(st.xpGained));
    setText($('kXpSub'), `treinador +${fmtNum(st.xpTrainerGained || 0)}`);
    const netGold = st.netGold ?? st.goldGained ?? 0;
    setText($('kGold'), `${netGold >= 0 ? '' : '-'}${fmtNum(Math.abs(netGold))}`);
    setText($('kGoldSub'), `bruto +${fmtNum(st.goldGained || 0)} · gasto ${fmtNum(st.spentGold || 0)}`);
    setText($('kCaps'), fmtNum(st.captures));
    setText($('kCapsSub'), `${Number(st.shiniesCaptured || 0) === 1 ? '1 shiny' : `${st.shiniesCaptured || 0} shinies`} · ${fmtNum(st.ballsThrown)} bolas`);

    const fmtDec = (n) => String(Number(n || 0)).replace('.', ',');
    setText($('eAvgKill'), st.avgKillSec > 0 ? `${fmtDec(st.avgKillSec)}s` : '-');
    setText($('eAvgKillSub'), '');
    setText($('eCapKill'), st.kills > 0 ? `${fmtDec(st.capturePerKillPct || 0)}%` : '-');
    setText($('eCapKillSub'), st.killsPerCapture > 0 ? `1 a cada ${fmtDec(st.killsPerCapture)} abates` : 'sem capturas');
    setText($('eBallCap'), st.ballsPerCapture > 0 ? fmtDec(st.ballsPerCapture) : '-');
    setText($('eBallCapSub'), `${fmtDec(st.catchPerBallPct || 0)}% acerto/bola`);
    setText($('eSurv'), `${fmtNum(st.heals || 0)} poções · ${fmtNum(st.revivesUsed || 0)} revives`);
    setText($('eSurvSub'), `${fmtNum(st.playerDeaths || 0)} mortes · ${fmtDec(st.potionsPerHour || 0)} poç/h`);

    // Drops da sessão & foco do mapa (memoizado por assinatura)
    const dr = data.drops || {};
    const focusKey = dr.focus || 'hunt';
    const focusBadge = $('dropsFocusBadge');
    setText(focusBadge, `${dr.focusLabel || 'XP / Gold / Shiny'} · ${fmtNum(dr.total || 0)} drops`);
    setClass(focusBadge, `focus-badge ${focusKey}`);

    const featured = Array.isArray(dr.featured) ? dr.featured : [];
    const recent = Array.isArray(dr.recent) ? dr.recent : [];
    const hiddenCats = Array.isArray(dr.hiddenCategories) ? dr.hiddenCategories : ['stone'];
    const hiddenItems = Array.isArray(dr.hiddenItems) ? dr.hiddenItems : [];
    const hiddenCatSet = new Set(hiddenCats);
    document.querySelectorAll('#dropFilterBar [data-drop-cat]').forEach((btn) => {
        btn.classList.toggle('active', !hiddenCatSet.has(btn.dataset.dropCat));
    });
    const restoreBtn = $('btnRestoreDrops');
    if (restoreBtn) {
        restoreBtn.classList.toggle('hidden', hiddenItems.length === 0);
        if (hiddenItems.length > 0) {
            setText(restoreBtn, `${hiddenItems.length} oculto${hiddenItems.length > 1 ? 's' : ''} · restaurar`);
        }
    }

    const dropsSig = `${activeAccount}|${focusKey}|${dr.total || 0}|${hiddenCats.join(',')}|${hiddenItems.join(',')}|${featured.map((d) => `${d.key}:${d.qty}:${d.bagQty ?? ''}`).join(';')}|${recent[0]?.time || ''}:${recent[0]?.name || ''}:${recent.length}`;
    if (dropsSig !== lastDropsSig) {
        lastDropsSig = dropsSig;
        const gridEl = $('dropsGrid');
        if (featured.length > 0) {
            gridEl.innerHTML = featured.map((d) => {
                const bagTxt = typeof d.bagQty === 'number' ? `bolsa: ${fmtNum(d.bagQty)}` : '';
                const rateTxt = d.qty > 0 && d.perHour > 0 ? `${fmtDec(d.perHour)}/h` : (d.lastTime || '');
                const meta = [rateTxt, bagTxt].filter(Boolean).join(' · ') || 'sem drop ainda';
                const insight = buildDropInsightTitle(d, data);
                return `<div class="drop-chip${d.qty > 0 ? ' hit' : ''}" title="${escapeHtml(insight)}">` +
                    `<div class="drop-chip-left"><span class="drop-chip-name">${escapeHtml(d.name)}</span>` +
                    `<span class="drop-chip-meta">${escapeHtml(meta)}</span></div>` +
                    `<div class="drop-chip-right"><span class="drop-chip-qty">x${fmtNum(d.qty)}</span>` +
                    `<button type="button" class="drop-hide-btn" data-hide-drop="${escapeHtml(d.key)}" title="Ocultar este item">×</button></div></div>`;
            }).join('');
        } else {
            gridEl.innerHTML = `<div class="hint-text" style="grid-column:1/-1;">Mapa atual com foco em ${escapeHtml(dr.focusLabel || 'XP / Shiny')}. Qualquer item visível nos filtros aparece aqui automaticamente.</div>`;
        }
        const recEl = $('recentDropsList');
        if (recent.length > 0) {
            recEl.innerHTML = recent.slice(0, 8).map((r) => (
                `<div class="recent-drop-line${r.rare ? ' rare' : ''}">` +
                `<span>[${escapeHtml(r.time)}] <b>${escapeHtml(r.name)}</b> x${fmtNum(r.qty)}</span>` +
                `<span>${escapeHtml(r.hunt || '')}</span></div>`
            )).join('');
        } else {
            recEl.innerHTML = '';
        }
    }

    // Inventory (bolas + pocoes em uso/estoque + revives)
    const balls = data.inventory?.balls || {};
    const items = data.inventory?.items || {};
    const chips = [
        ['Poke Ball', balls[1]], ['Great Ball', balls[2]], ['Super Ball', balls[3]],
        ['Ultra Ball', balls[4]], ['Beast Ball', balls[5]],
    ];
    for (const pid of [200, 201, 202, 203, 204, 70070]) {
        chips.push([POTION_LABELS[pid], Number(items[pid] || 0)]);
    }
    chips.push(['Revive', items[205]]);
    if (Number(items[206] || 0) > 0) chips.push(['Max Revive', items[206]]);

    const invSig = `${activeAccount}:${chips.map(([k, q]) => `${k}=${q ?? 0}`).join(',')}`;
    if (invSig !== lastInvSig) {
        lastInvSig = invSig;
        $('invGrid').innerHTML = chips
            .map(([label, qty]) => `<div class="inv-chip"><span>${label}</span><b>${fmtNum(qty)}</b></div>`)
            .join('');
    }

    const gamePots = Array.isArray(data.automation?.potionIds) ? data.automation.potionIds : [];
    $('activePotionsHint').textContent = gamePots.length
        ? `No jogo: ${gamePots.map((id) => (POTION_LABELS[id] || `#${id}`).replace(' Potion', '')).join(', ')}`
        : 'vazio = usa as do jogo';

    // Config (only sync if not dirty or switched account)
    const cfg = data.config;
    if (cfg && (!dirtyByAcc[activeAccount] || lastRenderedAccount !== activeAccount)) {
        lastRenderedAccount = activeAccount;
        $('cCaidos').checked = Boolean(cfg.caidosEnabled);
        $('cNativeHeal').checked = Boolean(cfg.ensureNativeAutoHeal);
        $('cRestock').checked = Boolean(cfg.restockEnabled);
        $('cPass').checked = Boolean(cfg.dailyPassEnabled);
        $('cPrey').checked = Boolean(cfg.preyEnabled);
    if ($('cIncubator')) $('cIncubator').checked = cfg.incubatorEnabled !== false;
        $('cLives').checked = Boolean(cfg.liveEnabled);
        $('cLiveStreak').checked = cfg.liveStreakWatch !== false;
        $('cLiveFollow').checked = cfg.liveAutoFollow !== false;
        $('cLiveSmart').checked = cfg.liveSmartBalance !== false;
        if ($('cLiveSyncPlatforms')) $('cLiveSyncPlatforms').checked = Boolean(cfg.liveSyncPlatforms);
        $('cLiveTargetHours').value = String(cfg.liveTargetHours ?? 24);
        $('cEconomy').checked = cfg.economyMode === 'on';
        $('cEconomyPingOnly').checked = Boolean(cfg.economyPingOnly);
        $('cStandby').checked = Boolean(cfg.standbyOn4001);
        $('cBall').value = cfg.preferredBall || 'auto';
        $('cTargetBalls').value = cfg.targetBalls ?? 50;
        $('cTargetPotions').value = cfg.targetPotions ?? 40;
        $('cRestockPotion').value = cfg.potionOptimize ? 'opt' : String(cfg.restockPotionId || 0);
        $('cBallEconomy').checked = Boolean(cfg.ballEconomy);
        $('cPvpQueue').checked = Boolean(cfg.pvpQueue);
        $('cTargetRevives').value = cfg.restockRevive === false ? 0 : (cfg.targetRevives ?? 20);
        $('cReserve').value = cfg.minGoldReserve ?? 0;
        // Mostra o mínimo só quando foge do padrão (35% do alvo); vazio continua automático.
        const autoMin = (target, floor) => Math.min(target, Math.max(floor, Math.round(target * 0.35)));
        const showMin = (id, val, target, floor) => {
            if (!$(id)) return;
            const t = Number(target || 0);
            $(id).value = val != null && t > 0 && Number(val) !== autoMin(t, floor) ? String(val) : '';
        };
        showMin('cMinBalls', cfg.minBalls, cfg.targetBalls ?? 50, 15);
        showMin('cMinPotions', cfg.minPotions, cfg.targetPotions ?? 40, 15);
        showMin('cMinRevives', cfg.minRevives, cfg.restockRevive === false ? 0 : (cfg.targetRevives ?? 20), 5);
        $('cGuideMode').value = cfg.huntGuideMode || 'off';
        $('cGuideMetric').value = cfg.huntGuideMetric || 'xp';
        if ($('cFarmObjective')) $('cFarmObjective').value = cfg.farmObjective || 'off';
        if ($('cFarmObjectiveFocus')) $('cFarmObjectiveFocus').value = cfg.farmObjectiveFocus || 'xp';
        $('cLiveTier').value = cfg.liveRewardTier || 'smart';
        $('cLiveMaxTw').value = cfg.liveMaxTwitchSlots ?? 4;
        $('cLiveMaxKk').value = cfg.liveMaxKickSlots ?? 2;
        $('cLiveCustomTw').value = cfg.liveCustomTwitch || '';
        $('cLiveCustomKk').value = cfg.liveCustomKick || '';
        if ($('cAutoCraftShinyEgg')) $('cAutoCraftShinyEgg').checked = cfg.autoCraftShinyEgg !== false;
        if ($('cAutoSacrificeRedeem')) $('cAutoSacrificeRedeem').checked = Boolean(cfg.autoSacrificeRedeem);
        if ($('cAutoOferendaOnFull')) $('cAutoOferendaOnFull').checked = Boolean(cfg.autoOferendaOnFull);
        if ($('cAutoRaidEnroll')) $('cAutoRaidEnroll').checked = Boolean(cfg.autoRaidEnroll);
        if ($('cAutoShowdownEnroll')) $('cAutoShowdownEnroll').checked = Boolean(cfg.autoShowdownEnroll);
        if ($('cAutoMisticoEnter')) $('cAutoMisticoEnter').checked = Boolean(cfg.autoMisticoEnter);
        if ($('cAutoExtendListings')) $('cAutoExtendListings').checked = Boolean(cfg.autoExtendListings);
        if ($('cAutoOptimizeGear')) $('cAutoOptimizeGear').checked = Boolean(cfg.autoOptimizeGear);

        const prefPots = new Set(Array.isArray(cfg.preferredPotionIds) ? cfg.preferredPotionIds.map(Number) : []);
        document.querySelectorAll('#cfgChips input[data-potion]').forEach((el) => {
            el.checked = prefPots.has(Number(el.dataset.potion));
        });
        const twRews = new Set(Array.isArray(cfg.liveTwitchRewards) ? cfg.liveTwitchRewards : [cfg.liveRewardType || 'xp']);
        document.querySelectorAll('#cfgChips input[data-tw-reward]').forEach((el) => {
            el.checked = twRews.has(el.dataset.twReward);
        });
        const kkRews = new Set(Array.isArray(cfg.liveKickRewards) ? cfg.liveKickRewards : [cfg.liveRewardType || 'xp']);
        document.querySelectorAll('#cfgChips input[data-kk-reward]').forEach((el) => {
            el.checked = kkRews.has(el.dataset.kkReward);
        });
        setConfigDirty(Boolean(dirtyByAcc[activeAccount]));
        renderConfigModePreview();
    }
    if (cfg) {
        const notifyCats = new Set(Array.isArray(cfg.dropNotifyCategories) ? cfg.dropNotifyCategories : ['outland', 'unova', 'boss', 'other']);
        document.querySelectorAll('#notifyDropCats [data-notify-drop-cat]').forEach((btn) => {
            btn.classList.toggle('active', notifyCats.has(btn.dataset.notifyDropCat));
        });
        if ($('cNotifyDropCommon')) $('cNotifyDropCommon').checked = Boolean(cfg.dropNotifyCommon);
        if ($('cNotifyNewSpecies')) $('cNotifyNewSpecies').checked = cfg.notifyCatchNewSpecies !== false;
        const allowInp = $('cNotifyDropAllow');
        if (allowInp && document.activeElement !== allowInp) {
            allowInp.value = Array.isArray(cfg.dropNotifyAllowItems) ? cfg.dropNotifyAllowItems.join(', ') : '';
        }
    }
    renderTrainerCard(data);
    renderSniperCard(data);
    renderAdvisorCard(data);
    renderGameIntel(data);

    // Connections
    const profSel = $('cBrowserProfile');
    const profiles = Array.isArray(data.browserProfiles) ? data.browserProfiles : [];
    const profSetting = data.browserProfileSetting || '';
    const profSig = `${activeAccount}|${profSetting}|${profiles.map((p) => `${p.id}=${p.label}`).join(';')}`;
    if (profSig !== lastProfileSigByAcc[activeAccount] && document.activeElement !== profSel) {
        lastProfileSigByAcc[activeAccount] = profSig;
        profSel.replaceChildren(
            ...(profiles.length
                ? profiles.map((p) => new Option(p.label, p.id))
                : [new Option('Perfil isolado desta conta', '')])
        );
        profSel.value = profSetting;
    }

    const lp = data.loginInProgress || '';
    const lv = data.lives || {};
    const gameOk = status === 'connected' || status === 'bridge';
    setText($('pokeLoginState'), `PokeIdle · ${lp === 'pokeidle' ? 'Aguardando login no navegador…' : (gameOk ? nick : `Conta ${activeAccount}`)}`);
    setText($('twitchLoginState'), `Twitch · ${lp === 'twitch' ? 'Faça login no Chrome e feche a janela…' : (lv.hasTwitchToken ? 'Conectada' : 'Desconectada')}`);
    setText($('kickLoginState'), `Kick · ${lp === 'kick' ? 'Faça login no Chrome e feche a janela…' : (lv.hasKickToken ? 'Conectada' : 'Desconectada')}`);

    const bPk = $('btnLoginPokeIdle');
    const bTw = $('btnLoginTwitch');
    const bKk = $('btnLoginKick');
    bPk.disabled = Boolean(lp) && lp !== 'pokeidle';
    bTw.disabled = Boolean(lp) && lp !== 'twitch';
    bKk.disabled = Boolean(lp) && lp !== 'kick';
    setText(bPk, lp === 'pokeidle' ? 'Cancelar login' : (gameOk ? 'Trocar conta' : 'Logar PokeIdle'));
    setText(bTw, lp === 'twitch' ? 'Cancelar login' : (lv.hasTwitchToken ? 'Reconectar Twitch' : 'Conectar Twitch'));
    setText(bKk, lp === 'kick' ? 'Cancelar login' : (lv.hasKickToken ? 'Reconectar Kick' : 'Conectar Kick'));
    setText($('btnReloadSess'), data.browserProfile ? 'Usar sessão do Chrome' : 'Recarregar sessão');

    if (!$('tab-lives').classList.contains('hidden')) renderLives(lv);
    if ($('tab-activity').classList.contains('hidden')) return;
    renderActivity(data);
}

function renderTrainerCard(data) {
    const tr = data?.xpTrainer;
    const cfg = data?.config || {};
    if (!tr) return;

    const badge = $('trainerBadge');
    if (badge) {
        setText(badge, `${tr.expShareBag ?? 0} livre${tr.expShareBag === 1 ? '' : 's'} · ${tr.expShareEquipped ?? 0} Exp. Share · ${tr.houseSlotsOccupied ?? 0}/${tr.houseSlotsTotal ?? 0} Casa`);
    }
    if ($('cTrainerEnabled')) $('cTrainerEnabled').checked = Boolean(cfg.trainerEnabled);
    if ($('cTrainerUseExpShare')) $('cTrainerUseExpShare').checked = cfg.trainerUseExpShare !== false;
    if ($('cTrainerUseHouses')) $('cTrainerUseHouses').checked = cfg.trainerUseHouses !== false;
    const modeEl = $('cTrainerMode');
    if (modeEl && document.activeElement !== modeEl) modeEl.value = cfg.trainerMode === 'sequential' ? 'sequential' : 'step';
    const stepEl = $('cTrainerStep');
    if (stepEl && document.activeElement !== stepEl) stepEl.value = String(cfg.trainerStepLevels ?? 50);

    const pokes = Array.isArray(tr.availablePokemons) ? tr.availablePokemons : [];
    const sel = $('trainerPokeSelect');
    if (sel && document.activeElement !== sel) {
        const queuedIds = new Set((tr.queue || []).map((q) => String(q.pokemonId)));
        const selList = pokes.filter((p) => !queuedIds.has(String(p.id)));
        const selSig = `${activeAccount}|${selList.map((p) => `${p.id}:${p.level}:${p.location}`).join(';')}`;
        if (sel.dataset.sig !== selSig) {
            sel.dataset.sig = selSig;
            sel.replaceChildren(
                ...(selList.length
                    ? selList.map((p) => {
                        const locLabel = p.location === 'equipe' ? 'Equipe' : (p.location === 'colecao' ? 'Coleção' : 'Depot');
                        return new Option(`${p.shiny ? '★ ' : ''}${p.name} (Nv ${p.level} · ${locLabel})`, String(p.id));
                    })
                    : [new Option(pokes.length ? 'Todos os listados já estão na fila' : 'Conecte a conta para listar Pokémon', '')])
            );
        }
    }

    const qList = Array.isArray(tr.queue) ? tr.queue : [];
    const trSig = `${activeAccount}|${tr.mode}|${tr.stepLevels}|${tr.currentStepCeiling}|${qList.map((q) => `${q.idStr}:${q.level}:${q.targetLevel}:${q.hasExpShare}:${q.inHouse}:${q.isActive}:${q.done}`).join(';')}`;
    if (trSig !== lastTrainerSig) {
        lastTrainerSig = trSig;
        const ul = $('trainerQueueList');
        if (ul) {
            if (!qList.length) {
                ul.innerHTML = '<li class="hint-text">Nenhum Pokémon na fila de treino. Escolha um acima e defina o nível alvo.</li>';
            } else {
                ul.innerHTML = qList.map((q, idx) => {
                    const pct = q.level != null && q.targetLevel > 0 ? Math.min(100, Math.round((q.level / q.targetLevel) * 100)) : 0;
                    const locTxt = q.location === 'equipe' ? 'Equipe' : (q.location === 'colecao' ? 'Coleção' : (q.location === 'depot' ? 'Depot' : 'Fora'));
                    let tagHtml = '<span class="trainer-tag">Na fila</span>';
                    if (q.done) tagHtml = '<span class="trainer-tag done">Concluído</span>';
                    else if (q.inHouse) tagHtml = '<span class="trainer-tag house">Na Casa</span>';
                    else if (q.hasExpShare) tagHtml = '<span class="trainer-tag">Exp. Share 5%</span>';
                    else if (q.isActive) tagHtml = '<span class="trainer-tag">Ativo</span>';
                    const stepNote = tr.mode === 'step' && !q.done && q.stepGoal && q.stepGoal < q.targetLevel ? ` · degrau ${q.stepGoal}` : '';
                    return `<li class="trainer-row${q.done ? ' done' : ''}">` +
                        `<div class="trainer-row-main">` +
                        `<div class="trainer-row-head"><b>${q.shiny ? '★ ' : ''}${escapeHtml(q.name)}</b>${tagHtml}</div>` +
                        `<div class="trainer-row-sub">Nv ${q.level ?? '?'} / alvo Nv ${q.targetLevel}${stepNote} · ${locTxt}</div>` +
                        `<div class="trainer-bar"><span style="width:${pct}%"></span></div></div>` +
                        `<div class="trainer-row-acts">` +
                        `<button type="button" class="btn sm" data-tr-act="up" data-tr-id="${escapeHtml(q.idStr)}" ${idx === 0 ? 'disabled' : ''} title="Subir">↑</button>` +
                        `<button type="button" class="btn sm" data-tr-act="down" data-tr-id="${escapeHtml(q.idStr)}" ${idx === qList.length - 1 ? 'disabled' : ''} title="Descer">↓</button>` +
                        `<button type="button" class="btn sm danger" data-tr-act="del" data-tr-id="${escapeHtml(q.idStr)}" title="Remover">×</button>` +
                        `</div></li>`;
                }).join('');
            }
        }
    }
}

function renderSniperCard(data) {
    const sn = data?.sniper;
    const cfg = data?.config || {};
    if (!sn) return;

    const badge = $('sniperSaldoBadge');
    if (badge) {
        setText(badge, `Gold ${fmtNum(sn.gold || 0)} · Gemas ${fmtNum(sn.orbs || 0)}`);
    }
    if ($('cSniperEnabled')) $('cSniperEnabled').checked = Boolean(cfg.sniperEnabled);
    const intEl = $('cSniperInterval');
    if (intEl && document.activeElement !== intEl) intEl.value = String(cfg.sniperIntervalSec ?? 30);
    const mgEl = $('cSniperMinGold');
    if (mgEl && document.activeElement !== mgEl) mgEl.value = String(cfg.sniperMinGoldReserve ?? 0);
    const moEl = $('cSniperMinOrbs');
    if (moEl && document.activeElement !== moEl) moEl.value = String(cfg.sniperMinOrbsReserve ?? 0);

    const catList = Array.isArray(sn.marketItems) ? sn.marketItems : [];
    const dl = $('sniperItemsList');
    if (dl && dl.dataset.count !== String(catList.length)) {
        dl.dataset.count = String(catList.length);
        dl.replaceChildren(...catList.map((it) => {
            const opt = document.createElement('option');
            opt.value = `${it.name} (#${it.id})`;
            return opt;
        }));
    }

    const spList = Array.isArray(sn.marketSpecies) ? sn.marketSpecies : [];
    const spDl = $('sniperSpeciesList');
    if (spDl && spDl.dataset.count !== String(spList.length)) {
        spDl.dataset.count = String(spList.length);
        spDl.replaceChildren(...spList.map((sp) => {
            const opt = document.createElement('option');
            opt.value = `${sp.name} (#${sp.id})`;
            return opt;
        }));
    }

    const rules = Array.isArray(sn.rules) ? sn.rules : [];
    const hits = Array.isArray(sn.recentHits) ? sn.recentHits : [];
    const snSig = `${activeAccount}|${rules.map((r) => `${r.id}:${r.kind || 'item'}:${r.speciesId || 0}:${r.speciesName || ''}:${r.minLevel || 1}:${r.maxLevel || 0}:${r.onlyShiny ? 1 : 0}:${r.maxPrice}:${r.maxQty}:${r.boughtQty}:${r.autoBuy}:${r.enabled}:${r.currentMinPrice}:${r.pendingQty || 0}`).join(';')}|${hits.length}:${hits[0]?.ts || 0}:${hits.slice(0, 6).map((h) => h.status || '').join(',')}`;
    if (snSig !== lastSniperSig) {
        lastSniperSig = snSig;
        const rList = $('sniperRulesList');
        if (rList) {
            if (!rules.length) {
                rList.innerHTML = '<li class="hint-text">Nenhuma regra de snipe criada. Escolha Item ou Pokémon, moeda e preço máximo acima.</li>';
            } else {
                rList.innerHTML = rules.map((r) => {
                    const moedaTxt = r.currency === 'orb' ? 'gemas' : 'gold';
                    const minTxt = typeof r.currentMinPrice === 'number' ? ` · menor atual ${fmtNum(r.currentMinPrice)}` : '';
                    const avgTxt = typeof r.avgPrice === 'number' ? ` · média ${fmtNum(r.avgPrice)}` : '';
                    const pendTxt = r.pendingQty > 0 ? ` · ${fmtNum(r.pendingQty)} aguardando sorteio` : '';
                    const qtyTxt = (r.maxQty > 0 ? ` · ${r.boughtQty || 0}/${r.maxQty} comprados` : (r.boughtQty > 0 ? ` · ${r.boughtQty} comprados` : '')) + pendTxt;
                    const isPoke = r.kind === 'pokemon';
                    const titleTxt = isPoke
                        ? (r.speciesName || (r.speciesId > 0 ? `Espécie #${r.speciesId}` : 'Qualquer Pokémon'))
                        : (r.itemName || `Item #${r.itemId}`);
                    const lvlTxt = isPoke
                        ? (r.maxLevel > 0 ? `Nv ${fmtNum(r.minLevel || 1)}-${fmtNum(r.maxLevel)} · ` : `Nv ≥ ${fmtNum(r.minLevel || 1)} · `)
                        : '';
                    return `<li class="sniper-rule-row">` +
                        `<div class="sniper-rule-main">` +
                        `<div class="sniper-rule-head"><b>${escapeHtml(titleTxt)}</b>` +
                        `${isPoke ? '<span class="sniper-tag poke">POKÉ</span>' : ''}` +
                        `${isPoke && r.onlyShiny ? '<span class="sniper-tag shiny">SHINY</span>' : ''}` +
                        `<span class="sniper-tag${r.currency === 'orb' ? ' orb' : ''}">${moedaTxt.toUpperCase()}</span>` +
                        `${r.autoBuy ? '<span class="sniper-tag auto">AUTO</span>' : '<span class="sniper-tag">AVISO</span>'}</div>` +
                        `<div class="sniper-rule-sub">${lvlTxt}Máx ${fmtNum(r.maxPrice)} ${moedaTxt}${minTxt}${avgTxt}${qtyTxt}</div></div>` +
                        `<div class="sniper-rule-acts">` +
                        `<button type="button" class="btn sm" data-sn-act="toggle-auto" data-sn-id="${escapeHtml(r.id)}" title="Alternar compra automática / só avisar">${r.autoBuy ? 'Auto' : 'Aviso'}</button>` +
                        `<button type="button" class="btn sm" data-sn-act="toggle-on" data-sn-id="${escapeHtml(r.id)}" title="Ativar/pausar regra">${r.enabled !== false ? 'Ativa' : 'Pausada'}</button>` +
                        `<button type="button" class="btn sm danger" data-sn-act="del" data-sn-id="${escapeHtml(r.id)}" title="Remover regra">×</button>` +
                        `</div></li>`;
                }).join('');
            }
        }
        const hList = $('sniperHitsList');
        if (hList) {
            hList.innerHTML = hits.slice(0, 6).map((h) => {
                const tm = h.ts ? new Date(h.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
                const moedaTxt = h.currency === 'orb' ? 'gemas' : 'gold';
                const labelTxt = h.kind === 'pokemon'
                    ? `${h.shiny ? '★ ' : ''}${escapeHtml(h.itemName || `Espécie #${h.speciesId || '?'}`)} Nv ${fmtNum(h.level || 1)}`
                    : `${escapeHtml(h.itemName || `Item #${h.itemId}`)} x${fmtNum(h.qty)}`;
                const st = h.bought ? 'comprado' : (h.status || '');
                const stInfo = {
                    comprado: ['bought', 'Comprou'],
                    pendente: ['pending', 'Pedido enviado'],
                    sorteio: ['pending', 'No sorteio'],
                    perdeu: ['lost', 'Perdeu o sorteio'],
                    falhou: ['lost', 'Não comprou'],
                    'sem-resposta': ['lost', 'Sem resultado'],
                }[st] || ['', 'Oferta'];
                return `<li class="sniper-hit-line${stInfo[0] ? ` ${stInfo[0]}` : ''}">` +
                    `<span><b>${stInfo[1]}</b> ${labelTxt}</span>` +
                    `<span>${fmtNum(h.price)} ${moedaTxt} · ${tm}</span></li>`;
            }).join('');
        }
    }
}

const ADVISOR_ACTIONS = {
    mercado: ['Mercado', 'market'],
    evoluir: ['Evoluir', 'evolve'],
    guardar: ['Guardar', 'collect'],
    sacrificar: ['Sacrificar', 'sacrifice'],
    depot: ['Depot', 'depot'],
    manter: ['Manter', 'keep'],
};
const ADVISOR_ITEM_ACTIONS = { vender: ['Vender', 'market'], 'aos-poucos': ['Aos poucos', 'sacrifice'], manter: ['Manter', 'keep'] };
const ADVISOR_PAGE = 25;

function advisorCardVisible() {
    const card = $('advisorCard');
    return Boolean(card && card.offsetParent !== null && !card.classList.contains('is-collapsed'));
}

function refreshAdvisorLists({ force = false } = {}) {
    if (advisorLists.busy || !window.pokeHub?.getAdvisor) return;
    const acc = activeAccount;
    const fresh = advisorLists.account === acc && Date.now() - advisorLists.at < ADVISOR_FETCH_MS;
    if (!force && fresh) return;
    if (!advisorCardVisible()) return;
    advisorLists.busy = true;
    window.pokeHub.getAdvisor(acc).then((data) => {
        advisorLists = { account: acc, at: Date.now(), data, busy: false };
        if (acc === activeAccount && snapshots[acc]) renderAdvisorCard(snapshots[acc]);
    }).catch(() => {
        advisorLists.busy = false;
    });
}

function renderAdvisorCard(data) {
    const lite = data?.advisor;
    const cfg = data?.config || {};
    const chk = $('cAdvisorEnabled');
    if (chk) chk.checked = cfg.advisorEnabled !== false;
    if (!lite) return;
    if (lite.enabled) refreshAdvisorLists();
    const full = lite.lite && advisorLists.account === activeAccount ? advisorLists.data : null;
    const adv = lite.lite ? { ...lite, items: full?.items, pokemons: full?.pokemons } : lite;
    const pokes = Array.isArray(adv.pokemons) ? adv.pokemons : [];
    const items = Array.isArray(adv.items) ? adv.items : [];
    const b = adv.base || {};
    renderDropRouting(adv, cfg);
    const sig = `${activeAccount}|${adv.enabled}|${adv.syncing}|${adv.speciesReady}|${b.total}|${b.lastSyncAt}|${b.mediasAt}|${adv.sacrificePts}|${advisorFilter}|${advisorShowAll}|` +
        pokes.map((p) => `${p.id}:${p.action}:${p.level}:${p.market?.price || 0}`).join(',') + '|' + items.map((i) => `${i.id}:${i.qty}:${i.valueGold}`).join(',');
    if (sig === lastAdvisorSig) return;
    lastAdvisorSig = sig;

    const badge = $('advisorBaseBadge');
    const pList = $('advisorPokeList');
    const iList = $('advisorItemList');
    const more = $('btnAdvisorMore');
    const filt = $('advisorPokeFilter');
    if (!adv.enabled) {
        if (badge) badge.textContent = 'Desligado';
        if (pList) pList.innerHTML = '<li class="hint-text">Consultor desligado nesta conta.</li>';
        if (iList) iList.innerHTML = '';
        if (filt) filt.innerHTML = '';
        more?.classList.add('hidden');
        return;
    }
    if (badge) {
        const syncTxt = adv.syncing ? 'atualizando' : (b.lastSyncAt ? `atualizada ${fmtAgo(b.lastSyncAt)}` : 'aguardando a 1ª leitura');
        setText(badge, `${fmtNum(b.total || 0)} vendas · ${syncTxt}`);
        badge.title = `${fmtNum(b.pokemon || 0)} vendas de Pokémon e ${fmtNum(b.item || 0)} de itens, últimos 30 dias.`;
    }
    const sac = $('advisorSacHint');
    if (sac) sac.textContent = adv.sacrificePts > 0 ? `Barra de sacrifício: ${fmtNum(adv.sacrificePts)}/1000` : '';

    const counts = { todos: pokes.length };
    for (const p of pokes) counts[p.action] = (counts[p.action] || 0) + 1;
    if (filt) {
        const keys = ['todos', 'mercado', 'evoluir', 'guardar', 'sacrificar', 'depot', 'manter'].filter((k) => k === 'todos' || counts[k]);
        if (!keys.includes(advisorFilter)) advisorFilter = 'todos';
        filt.innerHTML = keys.map((k) => `<button type="button" class="adv-chip${k === advisorFilter ? ' active' : ''}" data-adv-filter="${k}">${k === 'todos' ? 'Todos' : ADVISOR_ACTIONS[k][0]} <span>${fmtNum(counts[k] || 0)}</span></button>`).join('');
    }
    if (pList) {
        const shown = pokes.filter((p) => advisorFilter === 'todos' || p.action === advisorFilter);
        const page = advisorShowAll ? shown : shown.slice(0, ADVISOR_PAGE);
        if (adv.lite && !Array.isArray(adv.pokemons)) {
            pList.innerHTML = '<li class="hint-text">Montando a lista...</li>';
        } else if (!pokes.length) {
            pList.innerHTML = `<li class="hint-text">${adv.speciesReady ? 'Nenhum Pokémon fora da equipe para avaliar.' : 'Carregando o catálogo de espécies do jogo...'}</li>`;
        } else {
            pList.innerHTML = page.map((p) => {
                const [label, cls] = ADVISOR_ACTIONS[p.action] || ['?', ''];
                const mk = p.market ? `${fmtNum(p.market.price)} ${p.market.currency === 'orb' ? 'gemas' : 'gold'}` : '';
                const meta = [
                    `Nv ${fmtNum(p.level)}`,
                    p.nota != null ? `nota ${Number(p.nota).toFixed(1)}` : '',
                    `depot ${fmtNum(p.depot || 0)}`,
                    p.sacPoints > 0 ? `${fmtNum(p.sacPoints)} pts` : '',
                    mk ? `mercado ~${mk}` : '',
                ].filter(Boolean).join(' · ');
                const pt = p.potential;
                const finalTxt = pt ? `Final: ${escapeHtml(pt.name)}${pt.level ? ` Nv ${fmtNum(pt.level)}` : ''}` +
                    `${pt.nota != null ? ` · nota ${Number(pt.nota).toFixed(1)}` : ''}` +
                    `${pt.market?.currency === 'gold' ? ` · vende ~${fmtNum(pt.market.price)} gold` : ''}` +
                    `${pt.stones?.length ? ` · ${pt.stones.length} pedra${pt.stones.length > 1 ? 's' : ''}${pt.stoneCost ? ` (~${fmtNum(pt.stoneCost)})` : ''}` : ''}` : '';
                return `<li class="adv-row">` +
                    `<span class="adv-act ${cls}">${label}</span>` +
                    `<div class="adv-main"><div class="adv-name">${p.shiny ? '<span class="sniper-tag shiny">SHINY</span> ' : ''}<b>${escapeHtml(p.name)}</b><small>${meta}</small></div>` +
                    `<div class="adv-reason">${escapeHtml(p.reason || '')}</div>` +
                    `${finalTxt ? `<div class="adv-final">${finalTxt}</div>` : ''}</div></li>`;
            }).join('') || '<li class="hint-text">Nada nesta categoria.</li>';
        }
        if (more) {
            more.classList.toggle('hidden', shown.length <= ADVISOR_PAGE);
            setText(more, advisorShowAll ? 'Mostrar menos' : `Mostrar todos (${fmtNum(shown.length)})`);
        }
    }
    if (iList) {
        iList.innerHTML = items.length ? items.map((i) => {
            const [label, cls] = ADVISOR_ITEM_ACTIONS[i.action] || ['?', ''];
            const vals = [
                i.gold ? `~${fmtNum(Math.round(i.gold.avg))} gold/un` : '',
                i.orb ? `~${fmtNum(Math.round(i.orb.avg))} gemas/un` : '',
                i.valueGold ? `total ${fmtNum(i.valueGold)} gold` : (i.valueOrb ? `total ${fmtNum(i.valueOrb)} gemas` : ''),
                `saída ${i.liquidity}`,
            ].filter(Boolean).join(' · ');
            return `<li class="adv-row">` +
                `<span class="adv-act ${cls}">${label}</span>` +
                `<div class="adv-main"><div class="adv-name"><b>${escapeHtml(i.name)}</b><small>x${fmtNum(i.qty)} · ${vals}</small></div>` +
                `<div class="adv-reason">${escapeHtml(i.reason || '')}</div></div></li>`;
        }).join('') : `<li class="hint-text">${b.mediasAt ? 'Nenhum item da mochila com venda nos últimos 7 dias.' : 'Aguardando as médias do mercado.'}</li>`;
    }
}

const DROP_ACTIONS = { guardar: ['Guardar', 'collect'], anunciar: ['Anunciar', 'market'], vender: ['Vender', 'depot'], deixar: ['Depot', 'keep'] };
const DROP_FIELDS = [
    ['cDropKeepNota', 'dropKeepNota', 7],
    ['cDropKeepMult', 'dropKeepFinalMult', 3],
    ['cDropPricePct', 'dropPricePct', 100],
    ['cDropListDays', 'dropListDays', 1],
    ['cDropMinProfit', 'dropMinProfitPct', 50],
    ['cDropMaxHour', 'dropMaxListingsHour', 6],
];
const DROP_SELECTS = [['cDropMode', 'dropRouteMode', 'sugerir'], ['cDropRest', 'dropRest', 'deixar'], ['cDropConfidence', 'dropMinConfidence', 'media']];
let lastDropSig = '';

function renderDropRouting(adv, cfg) {
    const on = $('cDropRoute');
    if (on) on.checked = cfg.dropRouteEnabled === true;
    const sm = $('cDropSellMarket');
    if (sm) sm.checked = cfg.dropSellMarket !== false;
    for (const [id, key, def] of [...DROP_FIELDS, ...DROP_SELECTS]) {
        const el = $(id);
        if (el && document.activeElement !== el) el.value = String(cfg[key] ?? def);
    }
    const dr = adv?.drops || {};
    $('dropWarn')?.classList.toggle('hidden', !(dr.enabled && dr.gameAutoSell));
    const st = $('dropStatus');
    if (st) {
        st.textContent = !dr.enabled ? 'desligado'
            : `${dr.mode === 'auto' ? 'fazendo sozinho' : 'só mostrando'}${dr.watching ? '' : ' · começando a olhar'}${dr.queued ? ` · ${dr.queued} na fila` : ''}`;
    }
    const fee = $('dropFeeHint');
    if (fee) fee.textContent = dr.diaria ? `O jogo cobra ${fmtNum(dr.diaria)} gold por dia de anúncio e ${dr.taxaPct}% da venda. O Hub só anuncia se, depois disso, sobrar o lucro mínimo sobre o depot.` : '';
    const recent = Array.isArray(dr.recent) ? dr.recent : [];
    const sig = `${activeAccount}|${dr.enabled}|${recent.map((e) => `${e.id}:${e.action}:${e.done ? 1 : 0}:${e.skipped ? 1 : 0}`).join(',')}`;
    if (sig === lastDropSig) return;
    lastDropSig = sig;
    const list = $('dropRecentList');
    if (!list) return;
    if (!dr.enabled) { list.innerHTML = ''; return; }
    list.innerHTML = recent.length ? recent.map((e) => {
        const [label, cls] = DROP_ACTIONS[e.action] || ['?', ''];
        const tm = e.ts ? new Date(e.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        const state = e.auto ? (e.done ? 'feito' : (e.skipped ? 'não deu' : (e.action === 'deixar' ? '' : 'na fila'))) : 'sugestão';
        return `<li class="adv-row">` +
            `<span class="adv-act ${cls}">${label}</span>` +
            `<div class="adv-main"><div class="adv-name">${e.shiny ? '<span class="sniper-tag shiny">SHINY</span> ' : ''}<b>${escapeHtml(e.name)}</b><small>Nv ${fmtNum(e.level)} · ${tm}${state ? ` · ${state}` : ''}</small></div>` +
            `<div class="adv-reason">${escapeHtml(e.reason || '')}</div></div></li>`;
    }).join('') : '<li class="hint-text">Nenhum drop novo desde que ligou.</li>';
}

function fmtAgo(ts) {
    const sec = Math.max(0, Math.round((Date.now() - Number(ts || 0)) / 1000));
    if (sec < 5) return 'agora';
    if (sec < 60) return `há ${sec}s`;
    const min = Math.floor(sec / 60);
    return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)}h`;
}

// Chip da linha do canal: sequencia no player real e se a conta segue o canal
function buildWatchChip(ch) {
    const w = ch.watch;
    if (ch.platform !== 'twitch' || !w) return null;
    const chip = document.createElement('span');
    setClass(chip, 'watch-chip');
    if (w.watching) {
        chip.classList.add('watching');
        setText(chip, `▶ Sequência ${w.minutes || 0}/${w.targetMinutes || 15} min`);
        chip.title = 'Assistindo no player real da Twitch (invisível, sem som) para a live contar na sequência.';
    } else if (w.kind === 'watch' && w.ok) {
        chip.classList.add('ok');
        setText(chip, '✓ Sequência');
        chip.title = `Live assistida ${w.minutes || 0} min no player real ${fmtAgo(w.at)}. Conta para a sequência de lives.`;
    } else if (w.kind === 'watch' && w.ok === false) {
        chip.classList.add('warn');
        setText(chip, '! Sequência');
        chip.title = `Não deu para assistir no player: ${w.reasonText || 'erro'}. Tento de novo em alguns minutos.`;
    } else if (w.following) {
        chip.classList.add('follow');
        setText(chip, '♥ Seguindo');
        chip.title = 'Esta conta segue o canal na Twitch.';
    } else {
        return null;
    }
    if (w.following && !chip.classList.contains('follow')) chip.textContent += ' · ♥';
    return chip;
}

const BUFF_KINDS = [['xp', 'XP', '#60a5fa'], ['captura', 'Captura', '#34d399'], ['shiny', 'Shiny', '#facc15']];
let lastBuffSig = '';

// Gestor inteligente: uma barra por buff mostrando quanto tempo falta em relacao a meta
/** HTML do gestor de buffs; `head:false` tira o título e a legenda (versão da tela grande). */
function buffManagerHtml(lv, { head = true } = {}) {
    if (!lv) return '';
    const smartOn = Boolean(lv.smartBalance);
    const targetH = Number(lv.targetHours || 24);
    const guardMin = Number(lv.guardThresholdMin || 30);
    const platforms = [
        ['kick', 'Kick', 'kk', lv.kickRewards],
        ['twitch', 'Twitch', 'tw', lv.twitchRewards],
    ];
    const html = [];
    const syncOn = Boolean(lv.syncPlatforms);
    if (head) html.push(`<div class="bm-head"><div class="bm-title"><b>Gestor inteligente de buffs</b><span>${smartOn
        ? (syncOn
            ? `Meta de <b>${targetH}h</b> na Kick e <b>${targetH}h</b> na Twitch (sincronizadas): completa cada buff nas duas plataformas antes de avançar para o próximo.`
            : `Meta independente de <b>${targetH}h</b> por buff na Kick e <b>${targetH}h</b> na Twitch: cada plataforma completa os próprios buffs na ordem (XP, Captura, Shiny) sem travar a outra.`)
        : `Desligado: só resgata um buff quando faltam ${guardMin} min ou menos.`}</span></div>`
        + `<span class="bm-state ${smartOn ? 'on' : 'off'}">${smartOn ? 'Ligado' : 'Desligado'}</span></div>`);
    for (const [plat, label, cls, kindsRaw] of platforms) {
        const mins = lv.activeBonuses?.[plat] || {};
        const st = lv.smartStatus?.[plat] || {};
        const kinds = Array.isArray(kindsRaw) ? kindsRaw : [lv.rewardType || 'xp'];
        const scaleMin = smartOn ? Math.max(1, Number(st.targetMin) || targetH * 60) : 24 * 60;
        let summary = '';
        if (!kinds.length) summary = '<span class="bm-sum muted">Nenhum buff marcado</span>';
        else if (smartOn && st.allReached) summary = '<span class="bm-sum ok">✓ Todos na meta</span>';
        else if (smartOn && st.waitingPlatform && st.waitingKind) {
            const wk = BUFF_KINDS.find(([k]) => k === st.waitingKind);
            const wp = st.waitingPlatform === 'kick' ? 'Kick' : 'Twitch';
            summary = `<span class="bm-sum muted">Aguardando <b>${escapeHtml(wk ? wk[1] : st.waitingKind)}</b> na ${wp}</span>`;
        } else if (smartOn && st.nextKind) {
            const nk = BUFF_KINDS.find(([k]) => k === st.nextKind);
            summary = `<span class="bm-sum next">Próximo resgate: <b>${escapeHtml(nk ? nk[1] : st.nextKind)}</b></span>`;
        }
        html.push(`<div class="bm-plat"><div class="bm-plat-head"><span class="plat-badge ${cls}">${label}</span>${summary}</div>`);
        for (const [kind, kLabel, color] of BUFF_KINDS) {
            const on = kinds.includes(kind);
            const m = Math.max(0, Number(mins[kind]) || 0);
            const pct = Math.max(0, Math.min(100, (m / scaleMin) * 100));
            let state = 'mid';
            if (!on) state = 'off';
            else if (m <= 0) state = 'empty';
            else if (smartOn && pct >= 99.5) state = 'full';
            else if (m <= Math.max(guardMin, scaleMin * 0.15)) state = 'low';
            const isNext = smartOn && on && st.nextKind === kind && !st.waitingPlatform;
            const timeTxt = !on
                ? 'não coletado'
                : m <= 0
                    ? 'sem buff'
                    : `${formatBonusMins(m)}${smartOn ? ` <small>de ${targetH}h</small>` : ''}`;
            html.push(`<div class="bm-row ${state}${isNext ? ' is-next' : ''}">`
                + `<span class="bm-kind"><i style="background:${color}"></i>${kLabel}${isNext ? '<em>próximo</em>' : ''}</span>`
                + `<span class="bm-bar"><span style="width:${pct.toFixed(1)}%"></span></span>`
                + `<span class="bm-time">${timeTxt}</span></div>`);
        }
        html.push('</div>');
    }
    if (head) html.push('<div class="bm-legend"><span class="lg full">na meta</span><span class="lg mid">guardando</span><span class="lg low">acabando</span><span class="lg empty">sem buff</span></div>');
    return html.join('');
}

function renderBuffManager(lv) {
    const box = $('buffManager');
    if (!box) return;
    const sig = buffManagerHtml(lv);
    if (sig === lastBuffSig) return;
    lastBuffSig = sig;
    box.innerHTML = sig;
}

function requestLivesRefresh() {
    if (document.hidden || $('tab-lives')?.classList.contains('hidden')) return;
    void window.pokeHub.action(activeAccount, 'refresh-lives', {}).catch?.(() => {});
}

function renderLives(lv) {
    const twSummary = (lv.twitchRewards || [lv.rewardType || 'xp']).join('+').toUpperCase() || 'OFF';
    const kkSummary = (lv.kickRewards || [lv.rewardType || 'xp']).join('+').toUpperCase() || 'OFF';
    setText($('liveMinutes'), fmtNum(lv.minutesWatched || 0));
    setText($('liveChests'), fmtNum(lv.chestsClaimed || 0));
    setText($('liveRedeemed'), fmtNum(lv.rewardsRedeemed || 0));
    const fresh = lv.balancesAt ? ` · pontos atualizados ${fmtAgo(lv.balancesAt)}` : '';
    $('livesHead').textContent = lv.enabled
        ? `Coleta ativa · Twitch ${twSummary} · Kick ${kkSummary}${fresh}`
        : 'Coleta desativada';
    renderBuffManager(lv);

    // Lista de lives com seletor individual de buff por canal
    const chanListEl = $('liveChannelList');
    const channels = Array.isArray(lv.channels) ? lv.channels : [];
    const autoChestOn = lv.autoClaimChest !== false;
    const channelNotes = channels.map(ch => {
        const status = lv[ch.platform]?.[ch.channel];
        if (status?.manualChest) {
            return {
                text: autoChestOn
                    ? 'Caixinha +50 detectada (resgate automático em andamento)'
                    : 'Caixinha +50 disponível: clique em Resgatar +50',
                soft: autoChestOn,
            };
        }
        return status?.error ? { text: status.error, soft: false } : null;
    });
    const chanSig = JSON.stringify([activeAccount, lv.officialUrls, channels, channelNotes]);
    if (chanSig !== lastLiveChanSig && !chanListEl.querySelector('select:focus')) {
        lastLiveChanSig = chanSig;
        const frag = document.createDocumentFragment();
        for (const [index, ch] of channels.entries()) {
            const row = document.createElement('div');
            setClass(row, 'live-chan-row');

            const info = document.createElement('div');
            setClass(info, 'live-chan-info');
            const badge = document.createElement('span');
            setClass(badge, `plat-badge ${ch.platform === 'twitch' ? 'tw' : 'kk'}`);
            setText(badge, ch.platform === 'twitch' ? 'Twitch' : 'Kick');
            info.appendChild(badge);
            if (ch.live) {
                const onTag = document.createElement('span');
                setClass(onTag, 'live-on-tag');
                setText(onTag, 'Ao vivo');
                info.appendChild(onTag);
            }
            const nameEl = document.createElement('span');
            setClass(nameEl, 'live-chan-name');
            setText(nameEl, ch.channel);
            nameEl.title = ch.channel;
            info.appendChild(nameEl);
            const watchChip = buildWatchChip(ch);
            if (watchChip) info.appendChild(watchChip);
            if (typeof ch.balance === 'number') {
                const ptsEl = document.createElement('span');
                setClass(ptsEl, 'live-chan-pts');
                setText(ptsEl, `${fmtNum(ch.balance)} pts`);
                info.appendChild(ptsEl);
            }

            const sel = document.createElement('select');
            setClass(sel, `live-chan-sel${ch.override ? ' custom-set' : ''}`);
            sel.dataset.chanKey = ch.key;
            for (const [val, label] of LIVE_CHANNEL_REWARD_OPTIONS) {
                sel.appendChild(new Option(label, val));
            }
            sel.value = ch.override || '';
            sel.setAttribute('aria-label', 'Bônus de ' + ch.channel);
            row.appendChild(info);
            row.appendChild(sel);
            const noteInfo = channelNotes[index];
            if (noteInfo?.text) {
                const note = document.createElement('small');
                setClass(note, noteInfo.soft ? 'channel-smart-note' : 'channel-warning');
                setText(note, noteInfo.text);
                row.append(note);
            } else if (ch.smartNote) {
                const note = document.createElement('small');
                setClass(note, 'channel-smart-note');
                setText(note, ch.smartNote);
                row.append(note);
            }
            const url = (ch.platform === 'twitch' ? 'https://www.twitch.tv/' : 'https://kick.com/') + ch.channel;
            const hasManualChest = ch.platform === 'twitch' && Boolean(lv.twitch?.[ch.channel]?.manualChest);
            if (hasManualChest) {
                const chestBtn = document.createElement('button');
                setClass(chestBtn, 'btn sm chest-quick-btn');
                const pending = chestClaimsPending.has(`${activeAccount}:${ch.channel}`);
                setText(chestBtn, pending ? 'Resgatando…' : 'Resgatar +50');
                chestBtn.disabled = pending;
                chestBtn.title = 'Resgata a caixinha +50 direto daqui, sem abrir o chat. Se a Twitch recusar, abre o chat leve como plano B.';
                chestBtn.onclick = () => void claimTwitchChest(ch.channel, activeAccount, chestBtn);
                row.append(chestBtn);
            }
            if (lv.officialUrls?.includes(url)) {
                for (const [title, action] of [['Abrir chat', 'open-live-chat'], ['Abrir live', 'open-lives']]) {
                    const button = document.createElement('button');
                    setClass(button, 'btn sm');
                    setText(button, title);
                    button.onclick = () => sendAction(action, { url });
                    row.append(button);
                }
            }
            frag.appendChild(row);
        }
        chanListEl.replaceChildren(frag);
        if (!channels.length) chanListEl.textContent = 'Aguardando canais da conta.';
    }
}

function renderActivity(data) {
    const feed = data.recentShinies || [];
    const signature = JSON.stringify(feed);
    if (signature !== lastShinySig) {
        lastShinySig = signature;
        const list = $('shinyFeed');
        list.replaceChildren();
        for (const entry of feed) {
            const item = document.createElement('li');
            setClass(item, 'shiny-feed-item clickable');
            item.title = 'Clique para abrir o card completo deste shiny';
            const entryDex = resolvePokemonSpriteDex(entry.speciesId, entry.name, entry.spriteDex);
            const entryUrl = pokemonSpriteUrl(entry.speciesId, true, entryDex, entry.name);
            if (entryUrl) {
                const img = document.createElement('img');
                setClass(img, 'shiny-feed-sprite');
                img.alt = '';
                img.loading = 'lazy';
                img.src = entryUrl;
                img.dataset.spriteDex = String(entryDex);
                img.dataset.spriteShiny = '1';
                img.dataset.spriteStep = '0';
                item.append(img);
            }
            const txt = document.createElement('span');
            setClass(txt, 'shiny-feed-text');
            const name = document.createElement('strong');
            const lvTxt = entry.level && entry.level !== '?' ? ` (Nv ${entry.level})` : '';
            setText(name, `${entry.name}${lvTxt}`);
            const meta = document.createElement('small');
            setText(meta, `${entry.trainer} · ${entry.egg ? 'Ovo' : 'Captura'} · ${new Date(entry.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
            txt.append(name, meta);
            item.append(txt);
            item.addEventListener('click', () => openShinyInspectCard(entry));
            list.append(item);
        }
        if (!feed.length) list.textContent = 'Aguardando o próximo anúncio do servidor. O histórico começa quando a conta se conecta.';
    }
    // Logs (so atualiza DOM quando houver linha nova)
    const logs = data.logs || [];
    const lastLog = logs[logs.length - 1];
    const logSig = `${activeAccount}:${logs.length}:${lastLog?.time || ''}:${lastLog?.text || ''}`;
    if (hubHook('renderMainLog', data) === true) return;
    if (logSig !== lastLogSig) {
        lastLogSig = logSig;
        const logBox = $('logBox');
        const atBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 28;
        logBox.innerHTML = logs
            .map((l) => `<div class="log-line ${escapeHtml(l.kind)}">[${escapeHtml(l.time)}] ${escapeHtml(l.text)}</div>`)
            .join('');
        if (atBottom) logBox.scrollTop = logBox.scrollHeight;
    }
}

// Escritas no DOM só quando o valor muda: evita relayout e mutações a cada tique.
function setText(el, txt) {
    if (!el) return;
    const v = txt == null ? '' : String(txt);
    if (el.textContent === v && el.childElementCount === 0) return;
    el.textContent = v;
}
/** innerHTML só quando o HTML gerado muda (guarda o último no próprio elemento). */
function setHtml(el, html) {
    if (!el || el.__nexoHtml === html) return;
    el.__nexoHtml = html;
    el.innerHTML = html;
}
function setClass(el, v) {
    if (el && el.className !== v) el.className = v;
}
function setCls(el, cls, on) {
    if (el && el.classList.contains(cls) !== Boolean(on)) el.classList.toggle(cls, Boolean(on));
}
function setDisabled(el, on) {
    if (el && el.disabled !== Boolean(on)) el.disabled = Boolean(on);
}

/** @returns {boolean} true quando há contagem de décimos rolando (o timer então roda rápido). */
function refreshHuntAndCenterButtons() {
    const data = snapshots[activeAccount];
    const btnCenter = $('btnGoCenter');
    const btnHunt = $('btnChangeHunt');
    const pendingBar = $('pendingHuntBar');
    const pendingText = $('pendingHuntText');
    if (!btnCenter || !btnHunt) return false;

    const status = data?.status || 'disconnected';
    const isOnline = status === 'connected' || status === 'bridge';
    const t = data?.trainer || {};
    const now = Date.now();
    const combatLeftMs = t.centroLivreAt > now ? t.centroLivreAt - now : 0;
    const swapLeftMs = t.trocaHuntLivreAt > now ? t.trocaHuntLivreAt - now : 0;
    const lockLeftMs = Math.max(combatLeftMs, swapLeftMs);
    const fmtSec = (ms) => (ms / 1000).toFixed(1).replace('.', ',');

    if (!isOnline) {
        setDisabled(btnCenter, true);
        setCls(btnCenter, 'locked', false);
        setText(btnCenter, 'Centro Médico');
        setText(btnHunt, 'Trocar hunt');
    } else if (t.noCentro) {
        setDisabled(btnCenter, false);
        setCls(btnCenter, 'locked', false);
        setText(btnCenter, 'Curar no Centro');
        setText(btnHunt, swapLeftMs > 0 ? `Agendar (${fmtSec(swapLeftMs)}s)` : 'Trocar hunt');
    } else if (combatLeftMs > 0) {
        setDisabled(btnCenter, true);
        setCls(btnCenter, 'locked', true);
        setText(btnCenter, `Centro (${fmtSec(combatLeftMs)}s)`);
        setText(btnHunt, t.pendingHuntSlug
            ? `Agendada (${fmtSec(lockLeftMs)}s)`
            : `Agendar (${fmtSec(lockLeftMs)}s)`);
    } else {
        setDisabled(btnCenter, !t.huntSlug);
        setCls(btnCenter, 'locked', false);
        setText(btnCenter, 'Centro Médico');
        setText(btnHunt, swapLeftMs > 0
            ? (t.pendingHuntSlug ? `Agendada (${fmtSec(swapLeftMs)}s)` : `Agendar (${fmtSec(swapLeftMs)}s)`)
            : 'Trocar hunt');
    }

    if (pendingBar && pendingText) {
        if (t.pendingHuntSlug && isOnline) {
            const label = t.pendingHuntName || t.pendingHuntSlug;
            setText(pendingText, lockLeftMs > 0
                ? `Troca agendada: ${label} (${fmtSec(lockLeftMs)}s)`
                : `Trocando para ${label}...`);
            setCls(pendingBar, 'hidden', false);
        } else {
            setCls(pendingBar, 'hidden', true);
        }
    }
    refreshTopCatchTimer(data);
    return isOnline && lockLeftMs > 0;
}

const TOAST_ICONS = {
    info: 'i', ok: '✓', reward: '◆', warn: '!', error: '✕', shiny: '★',
};
const POKEMON_DETAIL_LABELS = {
    natureza: 'Natureza', nature: 'Natureza', genero: 'Gênero', gender: 'Gênero', sexo: 'Gênero',
    habilidade: 'Habilidade', ability: 'Habilidade', ivs: 'IVs', iv: 'IV', evs: 'EVs',
    tier: 'Tier', raridade: 'Raridade', rarity: 'Raridade', potencial: 'Potencial',
    hp: 'HP', maxHp: 'HP máx.', ataque: 'Ataque', defesa: 'Defesa', velocidade: 'Velocidade',
    tipo: 'Tipo', tipos: 'Tipos', types: 'Tipos', xp: 'XP', exp: 'XP', item: 'Item',
};

const OUTLAND_DEX_BY_POKE_ID = {
    2001: 9, 2002: 160, 2003: 154, 2004: 3, 2005: 214, 2006: 123, 2007: 203, 2008: 26,
    2009: 181, 2010: 125, 2011: 148, 2012: 91, 2013: 87, 2014: 124, 2015: 221, 2016: 241,
    2017: 232, 2018: 28, 2019: 76, 2020: 112, 2021: 6, 2022: 157, 2023: 34, 2024: 31,
    2025: 169, 2026: 94, 2027: 200, 2028: 107, 2029: 106, 2030: 237, 2031: 59, 2032: 126,
    2033: 247, 2034: 208, 2035: 40, 2036: 178, 2037: 65, 2038: 97, 2039: 130, 2040: 226,
    2041: 127, 2042: 36, 2043: 210, 2044: 227, 2045: 164, 2046: 18, 2047: 105, 2048: 248,
    2049: 142, 2050: 212, 2051: 149, 2052: 547, 2053: 219, 2054: 454, 2055: 103, 2056: 429,
    2057: 699, 2058: 560,
};
const OUTLAND_DEX_BY_BASE_NAME = {
    blastoise: 9, feraligatr: 160, meganium: 154, venusaur: 3, heracross: 214, scyther: 123,
    girafarig: 203, raichu: 26, ampharos: 181, electabuzz: 125, dragonair: 148, cloyster: 91,
    dewgong: 87, jynx: 124, piloswine: 221, miltank: 241, donphan: 232, sandslash: 28,
    golem: 76, rhydon: 112, charizard: 6, typhlosion: 157, nidoking: 34, nidoqueen: 31,
    crobat: 169, gengar: 94, misdreavus: 200, hitmonchan: 107, hitmonlee: 106, hitmontop: 237,
    arcanine: 59, magmar: 126, pupitar: 247, steelix: 208, wigglytuff: 40, xatu: 178,
    alakazam: 65, hypno: 97, gyarados: 130, mantine: 226, pinsir: 127, clefable: 36,
    granbull: 210, skarmory: 227, noctowl: 164, pidgeot: 18, marowak: 105, tyranitar: 248,
    aerodactyl: 142, scizor: 212, dragonite: 149, whimsicott: 547, magcargo: 219, toxicroak: 454,
    exeggutor: 103, mismagius: 429, aurorus: 699, scrafty: 560,
};
const SPECIAL_DEX_BY_POKE_ID = { 8017: 1017, 9017: 1017, 12017: 1017, 10001: 9 };
const VARIANT_PREFIX_RE = /^(?:shiny|mega|alolan|galarian|hisuian|paldean|brave|tribal|ancient|war|furious|charged|magnetic|evil|freezing|psy|heavy|milch|roll|hard|brute|enraged|dark|trickmaster|banshee|taekwondo|enigmatic|magma|toxic)[\s-]+/i;

function resolvePokemonSpriteDex(speciesId, name = '', spriteDex = null) {
    const direct = Number(spriteDex);
    if (Number.isInteger(direct) && direct >= 1 && direct <= 1025) return direct;
    let id = Number(speciesId);
    if (Number.isInteger(id) && id > 0) {
        if (id >= 10501 && id <= 10548) id -= 8500;
        if (SPECIAL_DEX_BY_POKE_ID[id]) return SPECIAL_DEX_BY_POKE_ID[id];
        if (OUTLAND_DEX_BY_POKE_ID[id]) return OUTLAND_DEX_BY_POKE_ID[id];
        if (id <= 1025) return id;
        const mod = id % 1000;
        if (mod >= 1 && mod <= 999) return mod;
    }
    let stripped = String(name || '').trim().toLowerCase();
    for (let i = 0; i < 3 && stripped; i++) {
        const next = stripped.replace(VARIANT_PREFIX_RE, '').trim();
        if (next === stripped) break;
        stripped = next;
    }
    return OUTLAND_DEX_BY_BASE_NAME[stripped] || 0;
}

function pokemonSpriteFallbacks(dex, shiny = true) {
    const id = Number(dex);
    if (!Number.isInteger(id) || id <= 0) return [];
    const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
    return shiny
        ? [`${base}/shiny/${id}.png`, `${base}/other/home/shiny/${id}.png`, `${base}/other/official-artwork/shiny/${id}.png`, `${base}/${id}.png`]
        : [`${base}/${id}.png`, `${base}/other/home/${id}.png`, `${base}/other/official-artwork/${id}.png`];
}

function pokemonSpriteUrl(speciesId, shiny = true, spriteDex = null, name = '') {
    const dex = resolvePokemonSpriteDex(speciesId, name, spriteDex);
    return pokemonSpriteFallbacks(dex, Boolean(shiny))[0] || '';
}

function setPokemonSpriteImg(img, speciesId, shiny = false, spriteDex = null, name = '') {
    if (!img) return false;
    const dex = resolvePokemonSpriteDex(speciesId, name, spriteDex);
    const isShiny = Boolean(shiny);
    const src = pokemonSpriteFallbacks(dex, isShiny)[0] || '';
    const key = `${dex}:${isShiny ? 1 : 0}`;
    if (img.dataset.spriteKey !== key) {
        img.dataset.spriteKey = key;
        img.dataset.spriteDex = dex ? String(dex) : '';
        img.dataset.spriteShiny = isShiny ? '1' : '0';
        img.dataset.spriteStep = '0';
        if (src) img.src = src;
        else img.removeAttribute('src');
    }
    img.hidden = !src;
    return Boolean(src);
}

document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!img || img.tagName !== 'IMG' || !img.dataset?.spriteDex) return;
    const dex = Number(img.dataset.spriteDex);
    const shiny = img.dataset.spriteShiny === '1';
    const urls = pokemonSpriteFallbacks(dex, shiny);
    const nextIdx = Number(img.dataset.spriteStep || 0) + 1;
    if (nextIdx < urls.length) {
        img.dataset.spriteStep = String(nextIdx);
        img.src = urls[nextIdx];
        return;
    }
    img.dataset.spriteDex = '';
    if (img.dataset.spriteFallbackText) {
        img.replaceWith(document.createTextNode(img.dataset.spriteFallbackText));
    } else {
        img.hidden = true;
    }
}, true);

function labelPokemonDetail(key) {
    if (POKEMON_DETAIL_LABELS[key]) return POKEMON_DETAIL_LABELS[key];
    const spaced = String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function closeShinyInspectCard() {
    $('shinyInspectModal')?.classList.add('hidden');
}

function openShinyInspectCard(entry) {
    const modal = $('shinyInspectModal');
    const titleEl = $('shinyInspectTitle');
    const metaEl = $('shinyInspectMeta');
    const bodyEl = $('shinyInspectBody');
    if (!modal || !entry) return;
    const dex = resolvePokemonSpriteDex(entry.speciesId, entry.name, entry.spriteDex);
    const when = entry.ts ? new Date(entry.ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : 'Agora';
    if (titleEl) {
        setText(titleEl, entry.own ? `Seu Shiny: ${entry.name}` : `Shiny no servidor: ${entry.name}`);
    }
    if (metaEl) {
        const parts = [
            entry.trainer ? `Treinador: ${entry.trainer}` : '',
            entry.egg ? 'Origem: Ovo' : 'Origem: Captura',
            entry.hunt && entry.hunt !== 'Ovo Shiny' ? `Mapa: ${entry.hunt}` : '',
            when,
        ].filter(Boolean);
        setText(metaEl, parts.join(' · '));
    }
    const extra = (Array.isArray(entry.details) ? entry.details : []).filter(([k]) => !/^(looktype|outfit)$/i.test(String(k)));
    const paint = (info) => {
        if (!bodyEl) return;
        bodyEl.replaceChildren();
        bodyEl.append(buildToastCard({
            speciesId: entry.speciesId,
            spriteDex: dex,
            sprite: pokemonSpriteUrl(entry.speciesId, true, dex, entry.name),
            name: entry.name,
            level: entry.level,
            subtitle: [dex ? `#${dex}` : '', entry.speciesId && entry.speciesId !== dex ? `ID ${entry.speciesId}` : ''].filter(Boolean).join(' · '),
            rows: [...(info?.rows || []), ...extra],
            maxRows: 16,
        }));
        const stats = Array.isArray(info?.stats) ? info.stats : [];
        if (stats.length) bodyEl.append(buildShinyStats(stats));
        const txt = info ? info.hint : 'Buscando a ficha do Pokémon...';
        if (txt) {
            const hint = document.createElement('div');
            setClass(hint, 'hint-text');
            hint.style.marginTop = '8px';
            setText(hint, txt);
            bodyEl.append(hint);
        }
    };
    paint(null);
    modal.classList.remove('hidden');
    const token = (openShinyInspectCard.token = (openShinyInspectCard.token || 0) + 1);
    Promise.resolve(window.pokeHub?.inspectShiny?.(activeAccount, entry))
        .then((info) => {
            if (token === openShinyInspectCard.token) paint(info || { rows: [], hint: 'Sem dados extras deste shiny.' });
        })
        .catch(() => {
            if (token === openShinyInspectCard.token) paint({ rows: [], hint: 'Não consegui ler os dados agora.' });
        });
}

/** Stats atuais com a barra e o IV de cada um (1 a 32), no estilo da ficha do jogo. */
function buildShinyStats(stats) {
    const box = document.createElement('div');
    setClass(box, 'shiny-stats');
    const title = document.createElement('div');
    setClass(title, 'shiny-stats-title');
    const ivSum = stats.reduce((s, r) => s + (Number(r.iv) || 0), 0);
    setText(title, stats.some((r) => r.iv != null) ? `Stats atuais · IV ${ivSum}/192` : 'Stats atuais');
    box.append(title);
    const top = Math.max(1, ...stats.map((r) => Number(r.value) || 0));
    for (const r of stats) {
        const row = document.createElement('div');
        setClass(row, 'shiny-stat');
        const lbl = document.createElement('span');
        setClass(lbl, 'shiny-stat-lbl');
        setText(lbl, r.label);
        const bar = document.createElement('i');
        setClass(bar, 'shiny-stat-bar');
        const fill = document.createElement('u');
        fill.style.width = `${Math.round(((Number(r.value) || 0) / top) * 100)}%`;
        bar.append(fill);
        const val = document.createElement('b');
        setText(val, r.value != null ? String(r.value) : '-');
        const iv = document.createElement('small');
        const ivN = Number(r.iv);
        setClass(iv, `shiny-stat-iv${r.iv == null ? ' none' : ivN >= 24 ? ' hi' : ivN <= 8 ? ' lo' : ''}`);
        setText(iv, r.iv != null ? `IV ${ivN}` : '');
        row.append(lbl, bar, val, iv);
        box.append(row);
    }
    return box;
}

function buildToastCard(card) {
    const wrap = document.createElement('div');
    setClass(wrap, 'toast-card');
    const art = document.createElement('div');
    setClass(art, 'toast-card-art');
    const dex = resolvePokemonSpriteDex(card.speciesId, card.name, card.spriteDex);
    const spriteSrc = card.sprite || pokemonSpriteUrl(card.speciesId, true, dex, card.name);
    if (spriteSrc) {
        const img = document.createElement('img');
        img.src = spriteSrc;
        img.alt = '';
        if (dex > 0) {
            img.dataset.spriteDex = String(dex);
            img.dataset.spriteShiny = '1';
            img.dataset.spriteStep = '0';
            img.dataset.spriteFallbackText = '★';
        } else {
            img.addEventListener('error', () => {
                img.remove();
                art.prepend('★');
            });
        }
        art.append(img);
    } else {
        setText(art, '★');
    }
    for (let i = 0; i < 3; i++) {
        const sp = document.createElement('span');
        setClass(sp, `sparkle s${i + 1}`);
        setText(sp, '✦');
        art.append(sp);
    }
    const info = document.createElement('div');
    setClass(info, 'toast-card-info');
    const name = document.createElement('div');
    setClass(name, 'toast-card-name');
    setText(name, card.name || '');
    if (card.level !== undefined && card.level !== null && card.level !== '?') {
        const lv = document.createElement('span');
        setClass(lv, 'toast-card-level');
        setText(lv, `Nv ${card.level}`);
        name.append(' ', lv);
    }
    info.append(name);
    if (card.subtitle) {
        const sub = document.createElement('div');
        setClass(sub, 'toast-card-sub');
        setText(sub, card.subtitle);
        info.append(sub);
    }
    const rows = Array.isArray(card.rows) ? card.rows.slice(0, card.maxRows || 8) : [];
    if (rows.length) {
        const dl = document.createElement('dl');
        setClass(dl, 'toast-card-rows');
        for (const [k, v] of rows) {
            const dt = document.createElement('dt');
            setText(dt, labelPokemonDetail(k));
            const dd = document.createElement('dd');
            setText(dd, String(v));
            dl.append(dt, dd);
        }
        info.append(dl);
    }
    wrap.append(art, info);
    return wrap;
}

const TOAST_LIVE_RE = /^(?:Lives:|Twitch\b|Kick\b|Cookies Twitch)/i;

function toastVisualMeta({ kind = 'info', text = '', event = '', card = null } = {}) {
    const k = String(kind || 'info');
    const txt = String(text || '');
    if (k === 'shiny' || card) {
        return { tone: 'shiny', cat: 'shiny', tag: 'SHINY', icon: 'sparkles', cleanText: txt };
    }
    if (k === 'shiny-miss' || event === 'shinyMiss') {
        return { tone: 'warn', cat: 'shiny', tag: 'SHINY PERDIDO', icon: 'alert', cleanText: txt };
    }
    if (k === 'error' || event === 'error') {
        const isLiveErr = TOAST_LIVE_RE.test(txt);
        return { tone: 'error', cat: isLiveErr ? 'live' : 'error', tag: isLiveErr ? 'ERRO LIVE' : 'ERRO', icon: 'x', cleanText: txt };
    }
    const isLive = k === 'live' || event === 'chest' || TOAST_LIVE_RE.test(txt) || /\b429\b/i.test(txt);
    if (k === 'warn') {
        return {
            tone: 'warn',
            cat: isLive ? 'live' : 'warn',
            tag: isLive ? 'LIVE' : 'AVISO',
            icon: 'alert',
            cleanText: isLive ? txt.replace(/^Lives:\s*/i, '') : txt,
        };
    }
    if (isLive) {
        return {
            tone: 'live',
            cat: 'live',
            tag: 'LIVE',
            icon: 'tv',
            cleanText: txt.replace(/^Lives:\s*/i, ''),
        };
    }
    if (k === 'reward' || event === 'rareDrop' || event === 'vote') {
        let tag = 'BÔNUS';
        let icon = 'gift';
        if (event === 'rareDrop' || /^Drop\b/i.test(txt)) tag = 'DROP RARO';
        else if (/^Sniper/i.test(txt)) { tag = 'SNIPER'; icon = 'cart'; }
        else if (event === 'vote' || /voto|diamante/i.test(txt)) tag = 'VOTO';
        else if (/top catch/i.test(txt)) tag = 'TOP CATCH';
        else if (/passe/i.test(txt)) tag = 'PASSE';
        return { tone: 'reward', cat: 'reward', tag, icon, cleanText: txt };
    }
    if (/^(?:Treinador|Exp\. Share):/i.test(txt)) {
        return { tone: 'ok', cat: 'hunt', tag: 'TREINO', icon: 'trend', cleanText: txt };
    }
    const isHunt = /hunt|centro m[eé]dico|equipe curada|pok[eé]dex|top catch/i.test(txt);
    if (k === 'ok') {
        return { tone: 'ok', cat: isHunt ? 'hunt' : 'ok', tag: isHunt ? 'HUNT' : 'CONTA', icon: isHunt ? 'trend' : 'check', cleanText: txt };
    }
    return { tone: 'info', cat: isHunt ? 'hunt' : 'info', tag: isHunt ? 'HUNT' : 'SISTEMA', icon: isHunt ? 'trend' : 'info', cleanText: txt };
}

function applyToastPosition() {
    const stack = $('toastStack');
    if (stack) {
        stack.classList.remove('pos-top-right', 'pos-top-center', 'pos-bottom-right');
        const cls = toastPos === 'top-center'
            ? 'pos-top-center'
            : (toastPos === 'bottom-right' ? 'pos-bottom-right' : 'pos-top-right');
        stack.classList.add(cls);
        stack.hidden = toastPos === 'off';
    }
    document.querySelectorAll('#toastPosSeg [data-toast-pos]').forEach((btn) => {
        const active = btn.dataset.toastPos === toastPos;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-checked', String(active));
    });
    const chk = $('cToastEnabled');
    if (chk) chk.checked = toastsEnabled;
}
window.applyToastPosition = applyToastPosition;

function setToastPos(pos) {
    const valid = ['top-right', 'top-center', 'bottom-right', 'off'].includes(pos) ? pos : 'top-right';
    toastPos = valid;
    toastsEnabled = valid !== 'off';
    try {
        localStorage.setItem('nexo_toast_enabled', toastsEnabled ? '1' : '0');
        if (valid !== 'off') localStorage.setItem('nexo_toast_pos', valid);
    } catch { /* ignore */ }
    applyToastPosition();
    hubHook('syncMenuState');
}

function showToast({
    kind = 'info', title = 'Nexo PokeBot', text = '', account = null, onClick = null,
    actionLabel = '', card = null, duration = 0, event = '',
} = {}) {
    if (event && soundCfg?.events?.[event]?.toast === false) return;
    const meta = toastVisualMeta({ kind, text, event, card });
    hubHook('recordEvent', { kind, title, text, account, event, card, ts: Date.now() });
    if (!toastsEnabled || (!text && !card)) return;
    if (hubHook('routeToast', { kind, category: meta.cat, title, text: meta.cleanText || text, account, onClick, actionLabel, card, duration, event }) === true) return;
    const stack = $('toastStack');
    if (!stack) return;
    applyToastPosition();
    const now = Date.now();
    const bodyTxt = meta.cleanText || text || '';
    const dedupeKey = `${account || 0}|${meta.tone}|${bodyTxt}|${card?.name || ''}`;
    const prevTs = recentToastMap.get(dedupeKey) || 0;
    if (now - prevTs < 8000) return;
    recentToastMap.set(dedupeKey, now);
    if (recentToastMap.size > 40) {
        for (const [k, ts] of recentToastMap) {
            if (now - ts > 15_000) recentToastMap.delete(k);
        }
    }

    while (stack.children.length >= 4) {
        stack.firstElementChild?.remove();
    }

    const accNum = Number(account);
    const hasAcc = Number.isInteger(accNum) && ACCOUNTS.includes(accNum);
    const accColor = hasAcc ? (window.nexoIcons?.accountAccent?.(accNum) || 'azul') : '';

    const item = document.createElement('div');
    setClass(item, `toast-item ${meta.tone}${hasAcc ? ' has-acc' : ''}${card ? ' has-card' : ''}${onClick ? ' actionable' : ''}`);
    if (hasAcc) {
        item.dataset.acc = String(accNum);
        item.dataset.accColor = accColor;
    }
    item.setAttribute('role', meta.tone === 'error' ? 'alert' : 'status');

    const icon = document.createElement('div');
    setClass(icon, 'toast-icon');
    const svg = window.nexoIcons?.icon?.(meta.icon);
    if (svg) icon.innerHTML = svg;
    else icon.textContent = TOAST_ICONS[kind] || TOAST_ICONS.info;

    const main = document.createElement('div');
    setClass(main, 'toast-main');
    const head = document.createElement('div');
    setClass(head, 'toast-head');
    const badges = document.createElement('div');
    setClass(badges, 'toast-badges');

    let headline = String(title || '').trim();
    if (hasAcc) {
        let nickLabel = '';
        const accMatch = headline.match(new RegExp(`^(?:(.+?)\\s*·\\s*)?Conta\\s+${accNum}(?:\\s*·\\s*(.+))?$`));
        if (accMatch) {
            headline = (accMatch[1] || '').trim();
            nickLabel = (accMatch[2] || '').trim();
        }
        const accPill = document.createElement('span');
        setClass(accPill, 'toast-acc-pill');
        const dot = document.createElement('i');
        setClass(dot, 'acc-pill-dot');
        accPill.append(dot, document.createTextNode(nickLabel ? `C${accNum} · ${nickLabel}` : `Conta ${accNum}`));
        badges.append(accPill);
    }

    const catPill = document.createElement('span');
    setClass(catPill, `toast-cat-pill ${meta.tone}`);
    setText(catPill, meta.tag);
    badges.append(catPill);

    const timeSpan = document.createElement('span');
    setClass(timeSpan, 'toast-time');
    setText(timeSpan, new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    head.append(badges, timeSpan);
    main.append(head);

    if (headline && headline.toUpperCase() !== meta.tag) {
        const titleEl = document.createElement('div');
        setClass(titleEl, 'toast-title');
        setText(titleEl, headline);
        main.append(titleEl);
    }
    if (card) main.append(buildToastCard(card));
    if (bodyTxt) {
        const body = document.createElement('div');
        setClass(body, 'toast-body');
        setText(body, bodyTxt);
        main.append(body);
    }
    if (onClick && actionLabel) {
        const act = document.createElement('span');
        setClass(act, 'toast-action');
        setText(act, actionLabel);
        main.append(act);
    }

    const close = document.createElement('button');
    close.type = 'button';
    setClass(close, 'toast-close');
    close.setAttribute('aria-label', 'Fechar notificação');
    setText(close, '×');

    const life = duration || (card ? 15_000 : (meta.tone === 'shiny' || onClick ? 8_000 : 5_500));
    const bar = document.createElement('div');
    setClass(bar, 'toast-progress');
    bar.style.animationDuration = `${life}ms`;

    item.append(icon, main, close, bar);

    let dismissed = false;
    let timer = null;
    let remaining = life;
    let startedAt = Date.now();
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        clearTimeout(timer);
        item.classList.add('out');
        setTimeout(() => item.remove(), 240);
    };
    const arm = () => {
        startedAt = Date.now();
        timer = setTimeout(dismiss, remaining);
    };
    // Pausa enquanto o mouse esta em cima, para dar tempo de ler a ficha
    item.addEventListener('mouseenter', () => {
        clearTimeout(timer);
        remaining = Math.max(800, remaining - (Date.now() - startedAt));
        item.classList.add('paused');
    });
    item.addEventListener('mouseleave', () => {
        item.classList.remove('paused');
        if (!dismissed) arm();
    });
    close.addEventListener('click', (ev) => {
        ev.stopPropagation();
        dismiss();
    });
    item.addEventListener('click', () => {
        if (hasAcc) {
            selectAccount(accNum);
        }
        if (typeof onClick === 'function') {
            try { onClick(); } catch { /* ignore */ }
        }
        dismiss();
    });
    stack.appendChild(item);
    arm();
}

function shouldNotifyDrop(drop, cfg = null) {
    if (!drop || !drop.name) return false;
    const hiddenItems = new Set((Array.isArray(cfg?.dropHideItems) ? cfg.dropHideItems : []).map((s) => String(s).toLowerCase()));
    if (hiddenItems.has(String(drop.key || '').toLowerCase()) || hiddenItems.has(String(drop.name || '').toLowerCase())) {
        return false;
    }
    const allowList = (Array.isArray(cfg?.dropNotifyAllowItems) ? cfg.dropNotifyAllowItems : [])
        .map((s) => String(s || '').trim().toLowerCase())
        .filter(Boolean);
    const nameLow = String(drop.name || '').toLowerCase();
    const keyLow = String(drop.key || '').toLowerCase();
    if (allowList.some((a) => nameLow.includes(a) || keyLow === a)) return true;

    const notifyCats = new Set(
        Array.isArray(cfg?.dropNotifyCategories)
            ? cfg.dropNotifyCategories
            : ['outland', 'unova', 'boss', 'other']
    );
    const cat = String(drop.category || 'other').toLowerCase();
    if (!notifyCats.has(cat)) return false;
    if (!drop.rare && !cfg?.dropNotifyCommon) return false;
    return true;
}

function isToastWorthyLog(entry, cfg = null) {
    if (!entry || !entry.text) return false;
    const k = String(entry.kind || '');
    const txt = String(entry.text || '');
    if (/exige clique no navegador/i.test(txt)) return false;
    if (/^Drop:/i.test(txt)) return false; // recentRare / recentDrops tratam drops com filtro personalizado
    if (k === 'reward' && /top catch: nova esp[eé]cie/i.test(txt) && cfg?.notifyCatchNewSpecies === false) return false;
    if (k === 'shiny' || k === 'shiny-miss' || k === 'reward' || k === 'error') return true;
    if (k === 'live') return /caixinha|ba[úu] \+\d+|resgatad|coletad|b[ôo]nus|cookies|sincronizad|429/i.test(txt);
    if (k === 'warn') return /sess[aã]o|combate|falha|desconect|expir|erro|morreu|morte|cancelad|limita|shiny|captura|somente ping|feed de campo|429|live/i.test(txt);
    if (k === 'ok') return /troca de hunt|centro m[eé]dico|equipe curada|conectad|cookies|sincronizad|salva|pok[eé]dex|top catch|treinador: .* (?:atingiu|concluiu|equipado)/i.test(txt);
    if (k === 'info') return /\/hunt recomenda|troca .* agendada|indo para o centro|pok[eé]dex|top catch/i.test(txt);
    return false;
}

function processActivityToasts(allSnaps) {
    let newestShiny = null;
    for (const acc of ACCOUNTS) {
        const snap = allSnaps[acc];
        if (!snap) continue;
        const nick = snap.trainer?.nick && snap.trainer.nick !== '-'
            ? snap.trainer.nick
            : (snap.session?.nick || `Conta ${acc}`);
        const accLabel = `Conta ${acc} · ${nick}`;

        const logs = Array.isArray(snap.logs) ? snap.logs : [];
        const sigOf = (l) => `${l.time || ''}|${l.kind || ''}|${l.text || ''}`;
        const allDrops = Array.isArray(snap.drops?.recent) ? snap.drops.recent : [];
        const rareList = Array.isArray(snap.drops?.recentRare)
            ? snap.drops.recentRare
            : allDrops.filter((d) => d?.rare);
        const dropKeyOf = (d) => (Number(d?.id) > 0 ? Number(d.id) : Number(d?.ts || 0));
        const maxRareKey = rareList.reduce((m, d) => Math.max(m, dropKeyOf(d)), 0);
        const maxDropKey = allDrops.reduce((m, d) => Math.max(m, dropKeyOf(d)), 0);
        const base = toastBaselineByAcc[acc];
        if (!base) {
            const initChests = new Set(
                Object.entries(snap.lives?.twitch || {})
                    .filter(([, st]) => st?.manualChest)
                    .map(([ch]) => ch)
            );
            toastBaselineByAcc[acc] = {
                lastSig: logs.length > 0 ? sigOf(logs[logs.length - 1]) : '',
                lastRareKey: maxRareKey,
                lastDropKey: maxDropKey,
                manualChests: initChests,
                voteReady: Boolean(snap.vote?.available),
                lastOwnShinyTs: Number(snap.ownShinies?.[0]?.ts || 0),
            };
        } else {
            if (logs.length > 0) {
                let startIdx = -1;
                if (base.lastSig) {
                    for (let i = logs.length - 1; i >= 0; i--) {
                        if (sigOf(logs[i]) === base.lastSig) {
                            startIdx = i;
                            break;
                        }
                    }
                }
                const fresh = startIdx >= 0 ? logs.slice(startIdx + 1) : logs.slice(-2);
                const hasShinyCards = Array.isArray(snap.ownShinies);
                for (const entry of fresh) {
                    // A captura shiny ganha o cartao com a ficha logo abaixo; nao repete em texto
                    if (hasShinyCards && entry.kind === 'shiny' && /^(?:Capturado|Chocado) SHINY/i.test(entry.text || '')) continue;
                    if (isToastWorthyLog(entry, snap.config)) {
                        const isChest = /caixinha|ba[úu] \+\d+/i.test(entry.text || '');
                        const ev = entry.kind === 'shiny-miss'
                            ? 'shinyMiss'
                            : (entry.kind === 'error' ? 'error' : (isChest ? 'chest' : ''));
                        const toastKind = entry.kind === 'shiny-miss' ? 'warn' : (entry.kind || 'info');
                        showToast({ kind: toastKind, title: accLabel, text: entry.text, account: acc, event: ev });
                    }
                }
                base.lastSig = sigOf(logs[logs.length - 1]);
            }
            const autoChestOn = snap.lives?.autoClaimChest !== false && snap.config?.liveAutoClaimChest !== false;
            const curChests = new Set(
                Object.entries(snap.lives?.twitch || {})
                    .filter(([, st]) => st?.manualChest)
                    .map(([ch]) => ch)
            );
            if (!autoChestOn) {
                for (const ch of curChests) {
                    if (!base.manualChests?.has(ch)) {
                        showToast({
                            kind: 'reward',
                            title: `Caixinha +50 · ${accLabel}`,
                            text: `Disponível em ${ch}.`,
                            account: acc,
                            actionLabel: 'Resgatar agora',
                            event: 'chest',
                            onClick: () => void claimTwitchChest(ch, acc),
                        });
                    }
                }
            }
            base.manualChests = curChests;

            const voteReadyNow = Boolean(snap.vote?.available);
            if (voteReadyNow && !base.voteReady) {
                showToast({
                    kind: 'reward',
                    title: `Vote & Ganhe · ${accLabel}`,
                    text: 'Voto diário liberado. Vote pelo jogo, no menu Vote & Ganhe.',
                    account: acc,
                    event: 'vote',
                });
            }
            base.voteReady = voteReadyNow;
            const freshDrops = (snap.config?.dropNotifyCommon || (snap.config?.dropNotifyAllowItems?.length > 0))
                ? allDrops.filter((d) => dropKeyOf(d) > Number(base.lastDropKey || 0)).reverse()
                : rareList.filter((d) => dropKeyOf(d) > Number(base.lastRareKey || 0)).reverse();
            for (const dropItem of freshDrops) {
                if (shouldNotifyDrop(dropItem, snap.config)) {
                    showToast({
                        kind: 'reward',
                        title: `${dropItem.rare ? 'Drop raro' : 'Drop'} · ${accLabel}`,
                        event: 'rareDrop',
                        text: `${dropItem.name} x${dropItem.qty || 1}`,
                        account: acc,
                    });
                }
                base.lastRareKey = Math.max(Number(base.lastRareKey || 0), dropKeyOf(dropItem));
                base.lastDropKey = Math.max(Number(base.lastDropKey || 0), dropKeyOf(dropItem));
            }
            base.lastRareKey = Math.max(Number(base.lastRareKey || 0), maxRareKey);
            base.lastDropKey = Math.max(Number(base.lastDropKey || 0), maxDropKey);
        }

        if (base) {
            const fresh = (Array.isArray(snap.ownShinies) ? snap.ownShinies : [])
                .filter((sh) => Number(sh?.ts || 0) > base.lastOwnShinyTs)
                .reverse();
            for (const sh of fresh) {
                const shDex = resolvePokemonSpriteDex(sh.speciesId, sh.name, sh.spriteDex);
                showToast({
                    kind: 'shiny',
                    title: `Shiny capturado · ${accLabel}`,
                    account: acc,
                    event: 'shinyCaught',
                    actionLabel: 'Ver ficha',
                    onClick: () => openShinyInspectCard({ ...sh, trainer: nick, own: true }),
                    card: {
                        speciesId: sh.speciesId,
                        spriteDex: shDex,
                        sprite: pokemonSpriteUrl(sh.speciesId, true, shDex, sh.name),
                        name: sh.name,
                        level: sh.level,
                        subtitle: [sh.hunt ? `Hunt ${sh.hunt}` : '', shDex ? `#${shDex}` : (sh.speciesId ? `#${sh.speciesId}` : '')].filter(Boolean).join(' · '),
                        rows: sh.details,
                    },
                });
                base.lastOwnShinyTs = Math.max(base.lastOwnShinyTs, Number(sh.ts || 0));
            }
        }

        const topShiny = snap.recentShinies?.[0];
        if (topShiny && (!newestShiny || Number(topShiny.ts || 0) > Number(newestShiny.ts || 0))) {
            newestShiny = topShiny;
        }
    }

    if (newestShiny) {
        const shinyKey = `${newestShiny.ts}|${newestShiny.trainer}|${newestShiny.name}`;
        if (!serverShinyToastBaselineDone) {
            serverShinyToastBaselineDone = true;
            lastServerShinyToastKey = shinyKey;
        } else if (shinyKey !== lastServerShinyToastKey) {
            lastServerShinyToastKey = shinyKey;
            let srvToastOn = true;
            try { srvToastOn = localStorage.getItem('nexo_notify_server_shiny') !== '0'; } catch { /* ignore */ }
            if (srvToastOn) {
                const lvTxt = newestShiny.level && newestShiny.level !== '?' ? ` Nv ${newestShiny.level}` : '';
                showToast({
                    kind: 'shiny',
                    title: 'Shiny no servidor',
                    text: `${newestShiny.name}${lvTxt} · ${newestShiny.egg ? 'Ovo' : 'Captura'} por ${newestShiny.trainer}`,
                    duration: 8_000,
                    actionLabel: 'Ver card do drop',
                    onClick: () => openShinyInspectCard(newestShiny),
                });
            }
        }
    } else if (!serverShinyToastBaselineDone) {
        serverShinyToastBaselineDone = true;
    }
}

function fmtEventCountdown(ms) {
    const totalSec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    if (totalSec <= 0) return 'Encerrando...';
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (d > 0) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
}

function refreshTopCatchTimer(data = snapshots[activeAccount]) {
    const timerEl = $('tcTimer');
    if (!timerEl) return;
    const tc = data?.collection?.topCatch;
    if (!tc?.endMs) {
        setText(timerEl, 'Sem dados');
        setCls(timerEl, 'ending', false);
        return;
    }
    const remMs = Number.isFinite(tc.remainingMs)
        ? Math.max(0, Number(tc.remainingMs) - Math.max(0, Date.now() - Number(data?._receivedAt || Date.now())))
        : Math.max(0, Number(tc.endMs) - Date.now());
    const label = remMs > 0 ? `Falta ${fmtEventCountdown(remMs)}` : 'Virando semana...';
    if (timerEl.textContent !== label) timerEl.textContent = label;
    setCls(timerEl, 'ending', remMs > 0 && remMs < 12 * 3600_000);
    const tip = `Semana Top Catch ${tc.week || ''} (reseta domingo 00h Brasília)`;
    if (timerEl.title !== tip) timerEl.title = tip;
}

function renderCollectionCard(data = snapshots[activeAccount]) {
    const card = $('collectionCard');
    if (!card) return;
    const col = data?.collection || {};
    const mode = col.mode || data?.config?.farmObjective || 'off';
    const focus = col.focus || data?.config?.farmObjectiveFocus || 'xp';

    document.querySelectorAll('#colModeRow [data-col-mode]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.colMode === mode);
    });
    const focusSel = $('colFocusSelect');
    if (focusSel && document.activeElement !== focusSel && focusSel.value !== focus) {
        focusSel.value = focus;
    }
    $('colFocusRow')?.classList.toggle('is-dim', mode === 'off');

    refreshTopCatchTimer(data);

    const tc = col.topCatch || {};
    const dex = col.pokedex || {};
    const isOnline = data?.status === 'connected' || data?.status === 'bridge';

    const countEl = $('tcCount');
    const countSubEl = $('tcCountSub');
    if (countEl) {
        setText(countEl, `${fmtNum(tc.count || 0)} espécies`);
    }
    if (countSubEl) {
        if (tc.loaded && Number(tc.unlockedTotal || 0) > 0) {
            setText(countSubEl, `${fmtNum(tc.unlockedCaptured)}/${fmtNum(tc.unlockedTotal)} liberadas (${tc.pct || 0}%) · ${fmtNum(tc.unlockedPendingHunts)} hunts`);
        } else if (isOnline) {
            setText(countSubEl, 'clique em ↻ para carregar lista semanal');
        } else {
            setText(countSubEl, 'conecte para sincronizar');
        }
    }

    const rk = tc.ranking || null;
    const rankEl = $('tcRank');
    const rankSubEl = $('tcRankSub');
    const rankTile = rankEl?.closest('.tc-stat');
    if (rankTile) rankTile.classList.toggle('in-prize', Boolean(rk?.inPrizeZone));
    if (rankEl && rankSubEl) {
        if (rk && rk.pos != null) {
            const prizeTag = rk.prize ? ` · ${rk.prize.diamantes} 💎${rk.prize.selo ? ' ★' : ''}` : '';
            setText(rankEl, `#${fmtNum(rk.pos)}${prizeTag}`);
            if (rk.inPrizeZone && rk.above) {
                const diff = Math.max(1, Number(rk.above.count || 0) - Number(tc.count || 0));
                setText(rankSubEl, `Acima: ${rk.above.nick || '#'} (+${fmtNum(diff)}) · 1º: ${fmtNum(rk.top1Count)}`);
            } else if (rk.inPrizeZone) {
                setText(rankSubEl, rk.pos === 1 ? 'Líder do Top Catch semanal!' : `1º lugar: ${fmtNum(rk.top1Count)} espécies`);
            } else if (rk.top100Cutoff != null) {
                const diff100 = Math.max(1, Number(rk.top100Cutoff) - Number(tc.count || 0));
                setText(rankSubEl, `Top 100: ${fmtNum(rk.top100Cutoff)} (+${fmtNum(diff100)}) · 1º: ${fmtNum(rk.top1Count)}`);
            } else {
                setText(rankSubEl, `${fmtNum(rk.totalRanked)} no ranking`);
            }
        } else if (rk && rk.top1Count != null) {
            setText(rankEl, 'Sem captura');
            setText(rankSubEl, `1º: ${fmtNum(rk.top1Count)} · Top 100: ${fmtNum(rk.top100Cutoff ?? 0)}`);
        } else {
            setText(rankEl, '-');
            setText(rankSubEl, isOnline ? 'clique em ↻ para buscar ranking' : 'sem ranking');
        }
    }

    const ms = tc.milestone || null;
    const msTxt = $('tcMilestoneTxt');
    const msRew = $('tcMilestoneReward');
    const msFill = $('tcMilestoneFill');
    if (ms && msTxt && msRew && msFill) {
        if (ms.completedAll) {
            setText(msTxt, `Marcos: ${fmtNum(ms.current)} / 600`);
            setText(msRew, 'Todos concluídos ✓');
            msFill.style.width = '100%';
            msFill.classList.add('done');
        } else {
            setText(msTxt, `Marco: ${fmtNum(ms.current)} / ${fmtNum(ms.next)} (faltam ${fmtNum(ms.remainingToNext)})`);
            setText(msRew, ms.nextRewardLabel || '');
            msFill.style.width = `${Math.max(0, Math.min(100, Number(ms.progressPct || 0)))}%`;
            msFill.classList.remove('done');
        }
    }

    const dexEl = $('dexSummary');
    if (dexEl) {
        if (Number(dex.unlockedTotal || 0) > 0) {
            setText(dexEl, `Pokédex: ${fmtNum(dex.unlockedCaptured)} / ${fmtNum(dex.unlockedTotal)} liberadas (${dex.pct || 0}%) · faltam ${fmtNum(dex.unlockedPendingHunts)} hunts · ${fmtNum(dex.capturedTotal)} registradas`);
        } else if (Number(dex.capturedTotal || 0) > 0) {
            setText(dexEl, `Pokédex: ${fmtNum(dex.capturedTotal)} espécies registradas`);
        } else {
            setText(dexEl, 'Pokédex: conecte para carregar hunts liberadas');
        }
    }

    const stEl = $('colStatusLine');
    if (stEl) {
        const showStatus = mode !== 'off' && Boolean(col.statusText);
        stEl.classList.toggle('hidden', !showStatus);
        stEl.classList.toggle('done', Boolean(col.completed));
        stEl.classList.toggle('topcatch', mode === 'topcatch' && !col.completed);
        if (showStatus) stEl.textContent = col.statusText;
    }
}

const KNOWN_DROP_INSIGHTS = {
    'ovo shiny': { origin: 'Unova+ (Nv >= 5.000)', chance: '0,05% a 0,20% (ou 10 fragmentos)', avg: '~1,5M a 4M gold' },
    'fragmento de ovo shiny': { origin: 'Unova+ (Nv >= 5.000)', chance: '0,5% a 1,5% (10 = 1 Ovo)', avg: 'Crafta Ovo Shiny' },
    'fragmento': { origin: 'Unova+ (Nv >= 5.000)', chance: '10 fragmentos = 1 Ovo Shiny', avg: 'Crafta Ovo Shiny' },
    'lucky egg': { origin: 'Outland / Boss', chance: 'Raro', avg: '~800k+ gold' },
    'shiny stone': { origin: 'Craft / Evento / Boss', chance: 'Raro', avg: '~500k+ gold' },
    'master ball': { origin: 'Boss / Evento / Caixa', chance: 'Muito raro', avg: 'Captura garantida' },
    'beast ball': { origin: 'Outland / Mercado', chance: 'Incomum', avg: '~25k gold' },
    'mega stone': { origin: 'Boss / Craft Mega', chance: 'Rotação 3 dias', avg: 'Uso competitivo' },
    'tm': { origin: 'Boss Lendário', chance: 'Rotação 3 dias', avg: 'Uso equipe PvP' },
};

function buildDropInsightTitle(d, data = snapshots[activeAccount]) {
    if (!d) return '';
    const nameLow = String(d.name || '').toLowerCase();
    const cat = String(d.category || '').toLowerCase();
    const known = KNOWN_DROP_INSIGHTS[nameLow]
        || Object.entries(KNOWN_DROP_INSIGHTS).find(([k]) => nameLow.includes(k))?.[1]
        || null;
    const origin = d.origin || known?.origin || (
        cat === 'outland' ? 'Outland'
            : cat === 'boss' ? 'Boss Lendário'
                : cat === 'unova' ? 'Unova+ (Nv >= 5.000)'
                    : cat === 'stone' ? 'Drop de mapa (Stones)' : 'Drop de mapa'
    );
    const chance = d.chance || known?.chance || (d.rare ? 'Drop raro' : 'Drop comum');
    let avgTxt = d.avgPrice ? `${fmtNum(d.avgPrice)} gold` : '';
    if (!avgTxt) {
        const advItems = (advisorLists.account === activeAccount ? advisorLists.data?.items : null) || data?.advisor?.items || [];
        const match = advItems.find((it) => String(it.name || '').toLowerCase() === nameLow);
        if (match?.gold?.avg > 0) avgTxt = `~${fmtNum(Math.round(match.gold.avg))} gold`;
        else if (match?.orb?.avg > 0) avgTxt = `~${fmtNum(Math.round(match.orb.avg))} gemas`;
        else if (known?.avg) avgTxt = known.avg;
    }
    const parts = [`${d.name}: ${fmtNum(d.qty || 0)} na sessão (${String(d.perHour || 0).replace('.', ',')}/h)`];
    parts.push(`Origem: ${origin}`);
    parts.push(`Chance: ${chance}`);
    if (avgTxt) parts.push(`Preço médio: ${avgTxt}`);
    return parts.join('\n');
}
window.nexoDropInsight = buildDropInsightTitle;
window.nexoToast = showToast;

const PREY_REGIONS_LIST = ['kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea'];
let preyCartelaActive = 1;
const preySelectedByCartela = { 1: new Set(), 2: new Set() };

function parseTargetTs(val) {
    if (val == null || val === '') return 0;
    if (typeof val === 'number') {
        if (!Number.isFinite(val) || val <= 0) return 0;
        return val < 1e12 ? val * 1000 : val;
    }
    const parsed = Date.parse(String(val));
    return Number.isFinite(parsed) ? parsed : 0;
}

function fmtCountdownShort(target) {
    const ts = parseTargetTs(target);
    if (!ts) return '';
    const ms = Math.max(0, ts - Date.now());
    if (ms <= 0) return 'agora';
    return fmtEventCountdown(ms);
}

function calcCubicRefineCost(level) {
    const n = Math.max(1, Math.floor(Number(level || 0)) + 1);
    return 500 * n * n * n;
}

function getTeamChoices(data) {
    const giTeam = Array.isArray(data?.gameIntel?.pvpMeta?.team) ? data.gameIntel.pvpMeta.team : [];
    if (giTeam.length > 0) {
        return giTeam.map((p) => ({
            id: p.id,
            name: p.name || `#${p.id}`,
            level: p.level || 0,
            refino: p.refino || {},
        }));
    }
    const avail = Array.isArray(data?.xpTrainer?.availablePokemons) ? data.xpTrainer.availablePokemons : [];
    return avail
        .filter((p) => p.location === 'equipe')
        .map((p) => ({ id: p.id, name: p.name || `#${p.id}`, level: p.level || 0, refino: {} }));
}

async function runGameAction(action, payload = {}, label = '') {
    const res = await sendAction(action, payload);
    if (res?.ok === false) {
        showToast({
            kind: 'error',
            title: label || 'Ação falhou',
            text: res.error || 'Não foi possível executar agora.',
            account: activeAccount,
        });
    } else if (label) {
        showToast({
            kind: 'ok',
            title: label,
            text: res?.message || 'Comando enviado com sucesso.',
            account: activeAccount,
        });
    }
    return res;
}

function renderTopIntelBar(data) {
    const gi = data?.gameIntel || {};
    const bf = gi.blackFriday;
    const bfBanner = $('blackFridayBanner');
    if (bfBanner) {
        let bfDismissedVal = '';
        try { bfDismissedVal = localStorage.getItem(DISMISSED_BF_KEY) || ''; } catch { bfDismissedVal = ''; }
        const bfKey = String(bf?.endsAt || 'active');
        const active = Boolean(bf?.active) && bfDismissedVal !== bfKey;
        bfBanner.classList.toggle('hidden', !active);
        if (active) {
            setText($('blackFridayPct'), `${bf.pct || 50}% OFF`);
            setText($('blackFridayText'), 'Black Friday ativa no servidor');
            const left = fmtCountdownShort(bf.endsAt);
            setText($('blackFridayTimer'), left ? `Termina em ${left}` : '');
        }
    }

    const seasEl = $('seasonalBadge');
    const dz = gi.diaSazonal;
    let shownAny = false;
    if (seasEl) {
        const hasDz = Boolean(dz && dz.tipo);
        seasEl.classList.toggle('hidden', !hasDz);
        if (hasDz) {
            shownAny = true;
            const left = fmtCountdownShort(dz.endsAt);
            const multTxt = dz.activeMult && Number.isFinite(Number(dz.activeMult)) && Number(dz.activeMult) !== 1
                ? ` · ${Number(dz.activeMult)}x`
                : ' · 2x / ÷4';
            setText(seasEl, `Dia ${dz.tipo}${multTxt}${left ? ` (${left})` : ''}`);
            seasEl.classList.toggle('is-buff', Boolean(dz.activeHasBuff));
            seasEl.title = `Dia Sazonal: ${dz.tipo}${dz.activeHasBuff ? ' (buff ativo para sua hunt)' : ''}${left ? ` | até 18h BRT (${left})` : ''}`;
        }
    }

    const capEl = $('capBadge');
    const cap = gi.cap;
    if (capEl) {
        const hasCap = Boolean(cap && (cap.depot != null || cap.colecao != null));
        capEl.classList.toggle('hidden', !hasCap);
        if (hasCap) {
            shownAny = true;
            const dObj = cap.depot && typeof cap.depot === 'object' ? cap.depot : null;
            const cObj = cap.colecao && typeof cap.colecao === 'object' ? cap.colecao : null;
            const dCount = Number(dObj ? dObj.count : cap.depot) || 0;
            const dMax = Number(dObj ? dObj.max : cap.max) || 3000;
            const cCount = Number(cObj ? cObj.count : cap.colecao) || 0;
            const cMax = Number(cObj ? cObj.max : cap.max) || 3000;
            const dPct = Math.round(Number(dObj?.pct ?? cap.depotPct ?? (dCount / Math.max(1, dMax)) * 100) || 0);
            const cPct = Math.round(Number(cObj?.pct ?? cap.colecaoPct ?? (cCount / Math.max(1, cMax)) * 100) || 0);
            const warn = Boolean(cap.anyWarn || dObj?.warn || cObj?.warn || dPct >= 90 || cPct >= 90);
            const danger = Boolean(cap.anyDanger || dObj?.danger || cObj?.danger || dPct >= 95 || cPct >= 95);
            setText(capEl, `Depot ${fmtNum(dCount)}/${fmtNum(dMax)} · Col ${fmtNum(cCount)}/${fmtNum(cMax)}`);
            capEl.classList.toggle('is-warn', warn && !danger);
            capEl.classList.toggle('is-danger', danger);
            capEl.title = `Capacidade: Depot ${dPct}% · Coleção ${cPct}%`;
        }
    }

    const healthEl = $('serverHealthBadge');
    const sh = gi.serverHealth;
    if (healthEl) {
        const isOff = Boolean(sh && sh.ok === false);
        healthEl.classList.toggle('hidden', !isOff);
        if (isOff) {
            shownAny = true;
            setText(healthEl, 'Servidor offline');
            healthEl.title = [sh.note || 'Falha em /saude', sh.checkedAt ? `Checado às ${new Date(sh.checkedAt).toLocaleTimeString('pt-BR')}` : ''].filter(Boolean).join(' · ');
        }
    }

    const alertsHost = $('probAlertsHost');
    const rawAlerts = Array.isArray(gi.probAlerts) ? gi.probAlerts : [];
    const activeAlertIds = new Set(rawAlerts.map((a) => String(a.id)));
    let alertsChanged = false;
    for (const k of [...dismissedAlerts]) {
        if (k.startsWith(`${activeAccount}:`) && !activeAlertIds.has(k.slice(`${activeAccount}:`.length))) {
            dismissedAlerts.delete(k);
            alertsChanged = true;
        }
    }
    if (alertsChanged) saveDismissedAlerts();
    const probAlerts = rawAlerts.filter((a) => !dismissedAlerts.has(`${activeAccount}:${a.id}`));
    if (alertsHost) {
        alertsHost.classList.toggle('hidden', probAlerts.length === 0);
        if (probAlerts.length > 0) {
            shownAny = true;
            const html = probAlerts.map((a) => {
                const lvl = a.level === 'warn' ? 'warn' : (a.level === 'good' ? 'good' : 'info');
                return `<span class="intel-pill prob-${lvl}" title="${escapeHtml(a.detail || a.title)}">` +
                    `<span>${escapeHtml(a.title)}</span>` +
                    `<button type="button" class="pill-x" data-dismiss-alert="${escapeHtml(a.id)}" aria-label="Fechar aviso" title="Fechar aviso">×</button>` +
                    `</span>`;
            }).join('');
            setHtml(alertsHost, html);
        } else {
            setHtml(alertsHost, '');
        }
    }

    $('accIntelBar')?.classList.toggle('hidden', !shownAny);

    const claimBtn = $('btnClaimAll');
    const cp = gi.claimPending;
    if (claimBtn) {
        const count = Number(cp?.count || 0);
        const isOnline = data?.status === 'connected' || data?.status === 'bridge';
        claimBtn.disabled = !isOnline && count === 0;
        claimBtn.classList.toggle('claim-ready', count > 0);
        setText(claimBtn, count > 0 ? `Resgatar tudo (${count})` : 'Resgatar tudo');
        if (cp) {
            const items = [];
            if (cp.pass) items.push(`Passe: ${cp.pass}`);
            if (cp.sacrifice) items.push(`Sacrifício: ${cp.sacrifice}`);
            if (cp.affiliate) items.push(`Afiliado: ${cp.affiliate}`);
            claimBtn.title = items.length ? `Pendente: ${items.join(' · ')}` : 'Resgatar passe, sacrifício e recompensas pendentes';
        }
    }
}

function renderPokeAndHuntIntel(data) {
    const gi = data?.gameIntel || {};
    const asm = gi.activeStatsMeta;
    const statsRow = $('activeStatsRow');
    if (statsRow) {
        const team = getTeamChoices(data);
        const showRow = Boolean(asm || team.length > 0);
        statsRow.classList.toggle('hidden', !showRow);
        if (showRow) {
            const badges = $('activeStatBadges');
            if (badges) {
                if (asm) {
                    const potVal = Number(asm.potencia);
                    const multNum = Number(asm.potenciaMult);
                    const potBonusPct = Number.isFinite(multNum) && multNum > 1 ? Math.round((multNum - 1) * 100) : 0;
                    const potTxt = Number.isFinite(potVal) && potVal > 0 ? `P${potVal}${potBonusPct > 0 ? ` (+${potBonusPct}%)` : ''}` : '';
                    const cdrTxt = asm.speedCdrPct != null && Number.isFinite(Number(asm.speedCdrPct))
                        ? `CDR ${asm.speedCdrPct}%/${asm.maxSpeedCdrPct || 7}%`
                        : '';
                    const refTxt = asm.refino != null && typeof asm.refino !== 'object' ? `Refino +${asm.refino}` : '';
                    const tmTxt = [asm.tmElemental ? 'Z-Move' : '', asm.tmFisico ? 'Físico' : ''].filter(Boolean).join(' · ');
                    const html = [
                        potTxt ? `<span class="stat-badge pot" title="Potência do Pokémon ativo">${escapeHtml(potTxt)}</span>` : '',
                        cdrTxt ? `<span class="stat-badge cdr" title="Base Speed ${asm.baseSpeed ?? '?'} + IV ${asm.ivSpeed ?? '?'} (joelho 120)">${escapeHtml(cdrTxt)}</span>` : '',
                        refTxt ? `<span class="stat-badge">${escapeHtml(refTxt)}</span>` : '',
                        tmTxt ? `<span class="stat-badge tm" title="TMs equipados">${escapeHtml(tmTxt)}</span>` : '',
                    ].filter(Boolean).join('');
                    setHtml(badges, html);
                } else {
                    setHtml(badges, '');
                }
            }
            const teamSel = $('quickTeamSelect');
            if (teamSel && document.activeElement !== teamSel) {
                const sig = `${activeAccount}|${team.map((p) => `${p.id}:${p.name}:${p.level}`).join(';')}`;
                if (teamSel.dataset.sig !== sig) {
                    teamSel.dataset.sig = sig;
                    teamSel.replaceChildren(
                        ...(team.length
                            ? team.map((p) => new Option(`${p.name} (Nv ${p.level})`, String(p.id)))
                            : [new Option('Sem equipe', '')])
                    );
                }
                const curId = asm?.id ?? data?.activePokemon?.id;
                if (curId != null && teamSel.value !== String(curId)) teamSel.value = String(curId);
                teamSel.disabled = team.length === 0;
            }
            const zBtn = $('btnQuickZMove');
            if (zBtn) {
                const activeId = asm?.id ?? data?.activePokemon?.id ?? '';
                const isFisico = Boolean(asm?.tmFisico && !asm?.tmElemental);
                zBtn.disabled = !activeId;
                zBtn.dataset.pokeId = String(activeId);
                zBtn.dataset.fisico = isFisico ? '1' : '0';
                setText(zBtn, isFisico ? 'Z-Move: Físico' : 'Z-Move: Especial');
            }
        }
    }

    const pity = gi.pityShiny;
    const egg = gi.eggStep;
    const out = gi.outlandTier;
    const best = gi.bestiary;
    const hasIntel = Boolean(pity || egg || out || (best?.species?.length > 0));
    $('huntIntelBox')?.classList.toggle('hidden', !hasIntel);

    const pityBox = $('pityShinyBox');
    if (pityBox) {
        pityBox.classList.toggle('hidden', !pity);
        if (pity) {
            const pend = Number(pity.pendentes || 0);
            const hasResumo = pity.bolas != null && pity.maxBolas != null;
            const left = pity.expiraEm ? fmtCountdownShort(pity.expiraEm) : '';
            let mainTxt = 'Inativo';
            let subTxt = '+50 Beast Balls/h comprada sem Shiny';
            if (pity.garantido) {
                mainTxt = `Garantia ativa (${pity.bolas}/${pity.maxBolas})`;
                subTxt = '+50 Beast Balls/h comprada sem Shiny';
            } else if (pity.ativo || Number(pity.bolas) > 0) {
                mainTxt = hasResumo
                    ? `${fmtNum(pity.bolas)} / ${fmtNum(pity.maxBolas)} bolas (${pity.pct ?? 0}%)`
                    : `${pend}h pendente${pend > 1 ? 's' : ''}`;
                subTxt = `${left ? `Fecha hora em ${left} · ` : ''}+50 Beast Balls/h comprada sem Shiny`;
            } else if (pend > 0) {
                mainTxt = `${pend}h pendente${pend > 1 ? 's' : ''}`;
                subTxt = '+50 Beast Balls/h comprada sem Shiny';
            }
            if (pity.notice?.message) subTxt = `${pity.notice.message} · ${subTxt}`;
            const html = `<span class="intel-mini-lbl">Garantia Lure (Pity Shiny)</span>` +
                `<b>${escapeHtml(mainTxt)}</b>` +
                `<small>${escapeHtml(subTxt)}</small>`;
            setHtml(pityBox, html);
        }
    }

    const eggBox = $('eggStepBox');
    if (eggBox) {
        eggBox.classList.toggle('hidden', !egg);
        if (egg) {
            const frags = Number(egg.fragments || 0);
            const delta = Number(egg.deltaLevel || 0);
            const warnNear = delta > 0 && delta <= 250 ? `<span class="egg-near">Faltam ${fmtNum(delta)} nv p/ Degrau ${egg.nextStep}</span>` : '';
            const btnHtml = frags >= 10
                ? `<button type="button" class="btn sm primary" data-intel-act="craft-shiny-egg">Fabricar Ovo Shiny (${frags}/10)</button>`
                : `<small>Fragmentos: ${frags}/10</small>`;
            const rawChance = egg.chance;
            const chanceNum = Number(rawChance);
            const chanceTxt = typeof rawChance === 'number' && Number.isFinite(chanceNum)
                ? `${(chanceNum <= 1 ? chanceNum * 100 : chanceNum).toFixed(2).replace('.', ',')}%`
                : (rawChance ? String(rawChance) : '0%');
            const html = `<span class="intel-mini-lbl">Degrau Ovo Shiny</span>` +
                `<b>Degrau ${egg.step || 0}/${egg.maxSteps || 32} (${escapeHtml(chanceTxt)})</b>` +
                `${warnNear}${btnHtml}`;
            setHtml(eggBox, html);
        }
    }

    const outBox = $('outlandTierBox');
    if (outBox) {
        outBox.classList.toggle('hidden', !out);
        if (out) {
            const sel = $('outlandTierSel');
            const tiers = Array.isArray(out.tiers) && out.tiers.length > 0
                ? out.tiers
                : Array.from({ length: 40 }, (_, i) => ({ tier: i + 1, label: `Tier ${i + 1}` }));
            const sig = tiers.map((t) => `${t.tier ?? t}:${t.label || ''}`).join(';');
            if (sel && sel.dataset.sig !== sig) {
                sel.dataset.sig = sig;
                sel.replaceChildren(...tiers.map((t) => {
                    const val = typeof t === 'object' ? (t.tier ?? t.id ?? t.value) : t;
                    const lbl = typeof t === 'object' ? (t.label || `Tier ${val}`) : `Tier ${t}`;
                    return new Option(lbl, String(val));
                }));
            }
            if (sel && document.activeElement !== sel && out.current != null) {
                sel.value = String(out.current);
            }
            const sugObj = out.suggested && typeof out.suggested === 'object' ? out.suggested : null;
            const sugLabel = sugObj
                ? (sugObj.label || `Tier ${sugObj.tier}`)
                : (out.suggested != null ? `Tier ${out.suggested}` : '');
            const sugMult = sugObj?.mult ?? out.mult;
            const hint = sugLabel
                ? `Ideal: ${sugLabel}${sugMult ? ` (${sugMult}x)` : ''}`
                : (out.label || '');
            setText($('outlandTierHint'), hint);
        }
    }

    const bestBox = $('bestiaryBox');
    if (bestBox) {
        const list = Array.isArray(best?.species) ? best.species : [];
        bestBox.classList.toggle('hidden', list.length === 0);
        if (list.length > 0) {
            const rows = list.slice(0, 6).map((sp) => {
                const kills = Number(sp.kills || 0);
                const nextTarget = Number(sp.next?.abates ?? sp.nextTarget ?? 0);
                const tierVal = sp.tier ?? sp.step ?? 0;
                const nextPctVal = sp.next?.bp != null
                    ? (Number(sp.next.bp) / 100)
                    : Number(sp.nextPct ?? sp.bonusPct ?? 0);
                const pct = Number.isFinite(Number(sp.pct))
                    ? Math.min(100, Math.max(0, Math.round(Number(sp.pct))))
                    : (nextTarget > 0 ? Math.min(100, Math.round((kills / nextTarget) * 100)) : 100);
                const etaMinNum = sp.etaMin != null && Number.isFinite(Number(sp.etaMin)) ? Math.round(Number(sp.etaMin)) : null;
                const etaTxt = etaMinNum != null && etaMinNum > 0 ? ` · ~${fmtNum(etaMinNum)}m` : '';
                const spLabel = sp.name || sp.key || (sp.speciesId ? `#${sp.speciesId}` : '?');
                return `<div class="bestiary-row">` +
                    `<div class="bestiary-head"><span><b>${escapeHtml(spLabel)}</b> (degrau ${tierVal})</span>` +
                    `<small>${fmtNum(kills)}${nextTarget > 0 ? ` / ${fmtNum(nextTarget)}` : ''} · +${nextPctVal}%${etaTxt}</small></div>` +
                    `<div class="bestiary-bar"><span style="width:${pct}%"></span></div></div>`;
            }).join('');
            const totalBadge = best.nextPctTotal != null && Number.isFinite(Number(best.nextPctTotal))
                ? `<span class="hint-text">Próximo ganho total: +${best.nextPctTotal}%</span>`
                : '';
            setHtml(bestBox, `<div class="bestiary-title"><b>Bestiário da Hunt</b>${totalBadge}</div>${rows}`);
        }
    }
}

function renderEvolutionDexReady(data) {
    const box = $('evolutionDexBox');
    if (!box) return;
    const list = Array.isArray(data?.gameIntel?.evolutionDexReady) ? data.gameIntel.evolutionDexReady : [];
    box.classList.toggle('hidden', list.length === 0);
    if (!list.length) {
        setHtml(box, '');
        return;
    }
    const html = `<div class="evo-dex-head"><b>Pokédex por Evolução (${list.length} pronta${list.length > 1 ? 's' : ''})</b></div>` +
        list.slice(0, 8).map((ev) => (
            `<div class="evo-dex-row">` +
            `<span><b>${escapeHtml(ev.fromName)}</b> -> <b>${escapeHtml(ev.toName)}</b>` +
            `<small>Nv ${fmtNum(ev.currentLevel)}/${fmtNum(ev.requiredLevel)}${ev.stoneNeeded ? ` · ${escapeHtml(ev.stoneNeeded)}` : ''}</small></span>` +
            `<button type="button" class="btn sm primary" data-evo-poke="${escapeHtml(ev.pokemonId)}" data-evo-alvo="${escapeHtml(ev.alvoId)}" ${ev.ready === false ? 'disabled' : ''}>Evoluir</button>` +
            `</div>`
        )).join('');
    setHtml(box, html);
}

function renderEventsMetaCard(data) {
    const gi = data?.gameIntel || {};
    const events = gi.upcomingEvents || {};
    const bossRot = gi.bossRotation || {};
    const safari = gi.safari || {};
    const gyms = gi.gyms || {};
    const pvp = gi.pvpMeta || {};

    // Agenda
    const agPane = $('intelAgendaPane');
    if (agPane) {
        const r = events.raid || {};
        const sw = events.showdown || {};
        const cp = events.camp || {};
        const agHtml = `
          <div class="intel-event-list">
            <div class="intel-event-row">
              <div>
                <b>Raid (${escapeHtml(r.dayLabel || 'Segunda 16h')})</b>
                <small>${r.enrolled ? 'Inscrito ✓' : 'Não inscrito'}${r.hasToken ? ' · Token OK' : ''}${r.closesAt ? ` · fecha em ${fmtCountdownShort(r.closesAt)}` : ''}</small>
              </div>
              <button type="button" class="btn sm ${r.enrolled ? '' : 'primary'}" data-intel-act="raid-enroll" ${r.enrolled ? 'disabled' : ''}>${r.enrolled ? 'Inscrito' : 'Inscrever'}</button>
            </div>
            <div class="intel-event-row">
              <div>
                <b>Showdown (${escapeHtml(sw.dayLabel || 'Quarta 20h')})</b>
                <small>${sw.enrolled ? 'Inscrito ✓' : (sw.unlocked === false ? 'Bloqueado' : 'Disponível')}${sw.closesAt ? ` · fecha em ${fmtCountdownShort(sw.closesAt)}` : ''}</small>
              </div>
              <button type="button" class="btn sm ${sw.enrolled ? '' : 'primary'}" data-intel-act="showdown-enroll" ${sw.enrolled || sw.unlocked === false ? 'disabled' : ''}>${sw.enrolled ? 'Inscrito' : 'Inscrever'}</button>
            </div>
            <div class="intel-event-row">
              <div>
                <b>Campeonatos</b>
                <small>${escapeHtml(cp.nextLabel || 'Sem data informada')}${cp.enrolled ? ' · Inscrito ✓' : ''}</small>
              </div>
              <button type="button" class="btn sm ${cp.enrolled ? '' : 'primary'}" data-intel-act="camp-enroll" ${cp.enrolled ? 'disabled' : ''}>${cp.enrolled ? 'Inscrito' : 'Inscrever'}</button>
            </div>
          </div>`;
        setHtml(agPane, agHtml);
    }

    // Bosses Lendários (rotação 3 dias)
    const bsPane = $('intelBossesPane');
    if (bsPane) {
        const regions = Array.isArray(bossRot.regions) ? bossRot.regions : [];
        const headTxt = `Rotação: ${escapeHtml(bossRot.dayKey || '-')}${bossRot.nextAt ? ` · próxima em ${fmtCountdownShort(bossRot.nextAt)}` : ''}`;
        const regHtml = regions.length
            ? regions.map((reg) => {
                const bosses = Array.isArray(reg.bosses) ? reg.bosses : [];
                if (bosses.length === 0) {
                    const regName = reg.region || reg.nome || reg.regiao || '?';
                    const prize = reg.prize?.label || reg.prize?.tipo || (typeof reg.prize === 'string' ? reg.prize : '-');
                    const ch = Number(reg.chances || 1);
                    return `<div class="boss-reg-card">` +
                        `<div class="boss-reg-head"><b>${escapeHtml(String(regName).toUpperCase())}</b>` +
                        `<small>${escapeHtml(String(prize))} · ${ch}x</small></div></div>`;
                }
                const bRows = bosses.map((b) => (
                    `<div class="boss-row">` +
                    `<div class="boss-info"><b>${escapeHtml(b.key || `#${b.pokeId}`)}</b><span class="boss-prize">${escapeHtml(b.premio || '-')}</span></div>` +
                    `<div class="boss-acts">` +
                    `<button type="button" class="btn sm primary" data-boss-enter="${escapeHtml(b.key)}" ${reg.unlocked === false ? 'disabled' : ''}>Entrar</button>` +
                    `<button type="button" class="btn sm" data-boss-leave="1">Sair</button>` +
                    `<label class="pill-chk"><input type="checkbox" data-boss-auto="${escapeHtml(b.key)}" ${b.auto ? 'checked' : ''} /> Auto</label>` +
                    `</div></div>`
                )).join('');
                return `<div class="boss-reg-card${reg.unlocked === false ? ' locked' : ''}">` +
                    `<div class="boss-reg-head"><b>${escapeHtml(reg.nome || reg.regiao || reg.region)}</b>` +
                    `<small>Nv ${fmtNum(reg.nivelMin || 0)} · Par ${escapeHtml(reg.par || '-')} · ${reg.chances || 1}x</small></div>` +
                    `${bRows}</div>`;
            }).join('')
            : '<div class="hint-text">Conecte a conta para carregar os bosses de hoje.</div>';
        setHtml(bsPane, `<div class="intel-pane-sub">${headTxt}</div>${regHtml}`);
    }

    // Safari & Místico
    const sfPane = $('intelSafariPane');
    if (sfPane) {
        const batchObj = safari.optimalBatch && typeof safari.optimalBatch === 'object' ? safari.optimalBatch : null;
        const batch = Number(batchObj ? batchObj.ticketsToUse : safari.optimalBatch) || 6;
        const tickets = Number(safari.tickets || 0);
        const sfActive = fmtCountdownShort(safari.activeUntil);
        const multVal = Number(safari.multShiny || 3.04);
        const multTxt = (Number.isFinite(multVal) ? multVal : 3.04).toFixed(2).replace('.', ',');
        const sfHtml = `
          <div class="safari-grid">
            <div class="safari-card">
              <b>Safari</b>
              <div class="hint-text">Tickets: <b>${fmtNum(tickets)}</b> · Lote ótimo: <b>${fmtNum(batch)}</b> (múltiplo de 6)</div>
              <div class="hint-text">Bônus: <b>+${fmtNum(safari.bonusMin || 30)}m</b> · Shiny: <b>${multTxt}x</b>${sfActive ? ` · ativo (${sfActive})` : ''}</div>
              <div class="util-btn-row" style="margin-top:6px;">
                <button type="button" class="btn sm primary" data-safari-enter="${batch}" ${tickets < 6 ? 'disabled' : ''}>Entrar Safari (${batch})</button>
              </div>
            </div>
            <div class="safari-card">
              <b>Místico</b>
              <div class="hint-text">Entrada rápida para farm especial e eventos do Místico.</div>
              <div class="util-btn-row" style="margin-top:6px;">
                <button type="button" class="btn sm teal" data-intel-act="mistico-enter">Entrar no Místico</button>
              </div>
            </div>
          </div>`;
        setHtml(sfPane, sfHtml);
    }

    // Ginásios
    const gyPane = $('intelGymsPane');
    if (gyPane) {
        const podiums = Array.isArray(gyms.podiums) ? gyms.podiums : [];
        const cdLeft = fmtCountdownShort(gyms.nextCooldownAt);
        const podHtml = podiums.length
            ? podiums.map((p) => (
                `<div class="gym-row">` +
                `<span><b>${escapeHtml(p.tipo || '?')}</b> · ${fmtNum(p.lugar ?? p.pos ?? 1)}º lugar${p.pct != null ? ` (+${fmtNum(p.pct)}%)` : ''}</span>` +
                `<button type="button" class="btn sm" data-gym-challenge="${escapeHtml(p.tipo || '')}">Desafiar</button>` +
                `</div>`
            )).join('')
            : '<div class="hint-text">Nenhum pódio ativo no momento.</div>';
        const gyHtml = `
          <div class="intel-pane-sub">
            <span>Buff ativo: <b>+${fmtNum(gyms.activeBuffPct || 0)}%</b>${cdLeft ? ` · Cooldown 24h: ${cdLeft}` : ''}</span>
            <button type="button" class="btn sm" data-intel-act="gym-info">Atualizar</button>
          </div>
          ${podHtml}
          <div class="util-act-row" style="margin-top:6px;">
            <select id="gymChallengeTypeSel" aria-label="Tipo do ginásio para desafiar">
              ${['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy']
                .map((t) => `<option value="${t}">Ginásio: ${t}</option>`).join('')}
            </select>
            <button type="button" class="btn sm primary" id="btnGymChallengeSel">Desafiar</button>
          </div>`;
        setHtml(gyPane, gyHtml);
    }

    // PvP Meta (29/11/2026) + Montar Time PvP
    const pvpPane = $('intelPvpPane');
    if (pvpPane) {
        const team = Array.isArray(pvp.team) ? pvp.team : [];
        const gBoostLeft = fmtCountdownShort(pvp.guildBoostUntil);
        const sinceDate = pvp.passivesSince
            ? (typeof pvp.passivesSince === 'number'
                ? new Date(pvp.passivesSince).toLocaleDateString('pt-BR')
                : String(pvp.passivesSince))
            : '';
        const head = `<div class="intel-pane-sub">
          <span>Passivas: <b>${pvp.passivesActive ? 'Ativas' : 'Inativas'}</b>${sinceDate ? ` (${escapeHtml(sinceDate)})` : ''} · Guilda: <b>+${fmtNum(pvp.guildBoostPct || 0)}%</b>${gBoostLeft ? ` (${gBoostLeft})` : ''}</span>
          <button type="button" class="btn sm primary" data-intel-act="pvp-save-formation" ${team.length === 0 ? 'disabled' : ''}>Salvar formação</button>
        </div>`;
        const rows = team.length
            ? team.map((m) => {
                const passiveName = typeof m.passive === 'object' ? m.passive?.nome : m.passive;
                const passiveOn = Number(m.bst || 999) <= 500 || Boolean(passiveName);
                const gymStat = m.powerGym != null ? `Ginásio: <b>${fmtNum(m.powerGym)}</b>` : `Nv Ginásio: <b>${fmtNum(m.arenaLevel ?? m.level ?? 0)}</b>`;
                const warStat = m.powerWar != null ? `Guerra: <b>${fmtNum(m.powerWar)}</b>` : `Nv Guerra: <b>${fmtNum(m.warLevel ?? m.level ?? 0)}</b>`;
                return `<div class="pvp-row">` +
                    `<div class="pvp-row-top"><b>${escapeHtml(m.name)}</b> <small>Nv ${fmtNum(m.level)}${m.bst ? ` · BST ${fmtNum(m.bst)}` : ''}</small>` +
                    `${passiveOn ? `<span class="pvp-passive-badge">${escapeHtml(passiveName || 'Passiva <=500')}</span>` : ''}</div>` +
                    `<div class="pvp-row-sub">${gymStat} · ${warStat}` +
                    `${m.tmElemental ? ' · Z-Move' : ''}${m.tmFisico ? ' · Físico' : ''}</div>` +
                    `</div>`;
            }).join('')
            : '<div class="hint-text">Conecte a conta para analisar a equipe no meta PvP.</div>';

        const tb = gi.teamBuilder || null;
        const curObj = data?.config?.farmObjective || 'off';
        let tbHtml = '';
        if (tb) {
            const canApply = Array.isArray(tb.suggestedFormation?.pokemonIds) && tb.suggestedFormation.pokemonIds.length > 0;
            const slotsHtml = (tb.slots || []).map((s) => {
                const statusBadge = s.ready
                    ? '<span class="pvp-tb-badge ready">Pronto</span>'
                    : `<span class="pvp-tb-badge pending">${escapeHtml(s.huntName ? `Caçar: ${s.huntName}` : 'Pendente')}</span>`;
                const typesTxt = Array.isArray(s.types) && s.types.length ? s.types.join('/') : '';
                const pasTxt = s.passive?.nome ? `<span class="pvp-passive-badge">${escapeHtml(s.passive.nome)}</span>` : '';
                return `<div class="pvp-tb-slot">` +
                    `<div class="pvp-row-top"><b>#${s.slot} ${escapeHtml(s.name)}</b>${typesTxt ? ` <small>${escapeHtml(typesTxt)}</small>` : ''}${pasTxt}${statusBadge}</div>` +
                    `<div class="pvp-row-sub">${escapeHtml(s.reason || '')}</div>` +
                    `</div>`;
            }).join('');
            tbHtml = `<div class="pvp-tb-box">` +
                `<div class="intel-pane-sub">` +
                `<span><b>Montar Time PvP (${tb.readyCount || 0}/5)</b></span>` +
                `<div style="display:flex;gap:5px;flex-wrap:wrap;">` +
                (curObj !== 'team-pvp'
                    ? '<button type="button" class="btn sm teal" data-intel-act="start-team-pvp">Farmar pendentes</button>'
                    : '<span class="pvp-tb-badge ready">Modo ativo</span>') +
                `<button type="button" class="btn sm primary" data-intel-act="apply-pvp-team" ${canApply ? '' : 'disabled'}>Aplicar time no PvP</button>` +
                `</div></div>` +
                `<div class="hint-text" style="margin-bottom:5px;">${escapeHtml(tb.summaryText || '')}</div>` +
                slotsHtml +
                `</div>`;
        }
        setHtml(pvpPane, head + rows + tbHtml);
    }
}

function renderAutomationExtras(data) {
    const gi = data?.gameIntel || {};
    // Prey regions grid
    const pGrid = $('preyRegionsGrid');
    if (pGrid) {
        const activeSet = preySelectedByCartela[preyCartelaActive];
        const html = PREY_REGIONS_LIST.map((r) => {
            const on = activeSet.has(r);
            return `<button type="button" class="filter-pill${on ? ' active' : ''}" data-prey-reg="${r}">${r.charAt(0).toUpperCase() + r.slice(1)}</button>`;
        }).join('');
        setHtml(pGrid, html);
        const count = activeSet.size;
        setText($('preyRegionCount'), `${count}/9 selecionadas (mín. 2)`);
        const applyBtn = $('btnApplyPreyRegions');
        if (applyBtn) applyBtn.disabled = count < 2;
    }

    // Bikes & Houses
    const bh = gi.bikesAndHouses;
    const bhEl = $('bikeHouseSummary');
    if (bhEl) {
        if (bh) {
            const bestTxt = typeof bh.bestBikeUpgrade === 'object' ? (bh.bestBikeUpgrade?.name || `#${bh.bestBikeUpgrade?.id}`) : (bh.bestBikeUpgrade || 'nenhum upgrade');
            setText(bhEl, `Bike equipada: ${bh.equippedBikeId || '-'} · Melhor upgrade: ${bestTxt} · Bikes: ${bh.bikesCount || 0} (craft: ${bh.craftableBikes || 0}) · Casas: ${bh.housesUsed || 0}/${bh.maxHouses || 5} (total ${bh.housesTotal || 0}, craft: ${bh.craftableHouses || 0})`);
        } else {
            setText(bhEl, 'Conecte a conta para ver bicicletas e casas.');
        }
    }

    // Refino Cúbico
    const team = getTeamChoices(data);
    const refSel = $('refinePokeSel');
    if (refSel && document.activeElement !== refSel) {
        const sig = `${activeAccount}|${team.map((p) => `${p.id}:${p.name}`).join(';')}`;
        if (refSel.dataset.sig !== sig) {
            refSel.dataset.sig = sig;
            refSel.replaceChildren(
                ...(team.length
                    ? team.map((p) => new Option(`${p.name} (Nv ${p.level})`, String(p.id)))
                    : [new Option('Sem Pokémon', '')])
            );
        }
    }
    const statSel = $('refineStatSel');
    const chosenId = refSel?.value;
    const chosenPoke = team.find((p) => String(p.id) === String(chosenId)) || team[0];
    const asm = gi.activeStatsMeta;
    const chosenStat = statSel?.value || 'hp';
    const curRefMap = (asm && String(asm.id) === String(chosenPoke?.id) && typeof asm.refino === 'object')
        ? asm.refino
        : (chosenPoke?.refino || {});
    const curLvl = Number(curRefMap?.[chosenStat] ?? (typeof asm?.refino === 'number' ? asm.refino : 0)) || 0;
    const nextCost = calcCubicRefineCost(curLvl);
    const sugTxt = asm?.nextRefine ? ` · Sugestão ótima: ${typeof asm.nextRefine === 'object' ? `${asm.nextRefine.stat} (${fmtNum(asm.nextRefine.cost || calcCubicRefineCost(asm.nextRefine.level || 0))} gold)` : asm.nextRefine}` : '';
    setText($('refinePreview'), chosenPoke
        ? `${chosenPoke.name} · ${chosenStat} Nv ${curLvl} -> ${curLvl + 1}: ${fmtNum(nextCost)} gold${sugTxt}`
        : 'Conecte a conta para calcular o próximo refino ótimo.');
}

function renderGameIntel(data) {
    if (!data) return;
    renderTopIntelBar(data);
    renderPokeAndHuntIntel(data);
    renderEvolutionDexReady(data);
    renderEventsMetaCard(data);
    renderAutomationExtras(data);
}

function formatBytesMb(bytes) {
    const n = Number(bytes || 0);
    if (n <= 0) return '';
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const UPDATE_SNOOZE_KEY = 'nexo.updateSnooze';

function readUpdateSnooze() {
    try { return localStorage.getItem(UPDATE_SNOOZE_KEY) || ''; } catch { return ''; }
}

function writeUpdateSnooze(version) {
    try { localStorage.setItem(UPDATE_SNOOZE_KEY, version); } catch { /* ignore */ }
}

let updateDoneBannerDismissed = false;
const shortVer = (v) => String(v || '').replace(/\.0$/, '');

// Faixa no topo: aparece sozinha quando ha versao nova (sem precisar abrir o menu),
// quando a ultima atualizacao falhou e logo depois de atualizar.
function renderUpdateBanner(st) {
    const bar = $('updateBanner');
    if (!bar) return;
    const title = $('updateBannerTitle');
    const sub = $('updateBannerSub');
    const icon = $('updateBannerIcon');
    const btnInstall = $('btnBannerInstall');
    const btnNotes = $('btnBannerNotes');
    const btnLater = $('btnBannerLater');
    const busy = ['downloading', 'extracting', 'applying'].includes(st.status);
    const canInstall = Boolean(st.hasUpdate && st.assetName && !st.isGitRepo);
    let mode = '';

    if (busy) {
        mode = 'busy';
        title.textContent = st.status === 'downloading'
            ? `Baixando v${shortVer(st.latestVersion)} · ${st.percent || 0}%`
            : 'Aplicando atualização: o Hub vai fechar e reabrir sozinho';
        setText(sub, 'Suas 4 contas, sessões e configurações ficam preservadas.');
    } else if (st.failedTarget && st.hasUpdate) {
        mode = 'error';
        setText(title, `A atualização para v${shortVer(st.failedTarget)} não foi aplicada`);
        setText(sub, `Clique em Tentar de novo. Detalhes em ${st.logPath || 'nexo-pokebot-last-update.log'}`);
    } else if (st.hasUpdate && readUpdateSnooze() !== (st.updateId || st.latestVersion)) {
        mode = 'available';
        setText(title, st.rebuild
            ? `Correção da v${shortVer(st.latestVersion)} disponível`
            : `Nova versão disponível: v${shortVer(st.latestVersion)}`);
        const size = st.assetSize ? ` · ${formatBytesMb(st.assetSize)}` : '';
        sub.textContent = st.isGitRepo
            ? 'Pasta de desenvolvimento: atualize com git pull.'
            : `Você está na v${shortVer(st.currentVersion)}${size}. Atualiza em 1 clique sem perder as contas.`;
    } else if (st.mainReady && !st.isGitRepo && readUpdateSnooze() !== `main:${st.mainReady.sha}`) {
        mode = 'main';
        const n = Number(st.mainReady.aheadBy || 0);
        setText(title, `Atualização pronta${n ? `: ${n} mudança${n > 1 ? 's' : ''}` : ''}`);
        setText(sub, `Entra sozinha na próxima vez que o Hub abrir.${st.mainReady.lastMessage ? ` Última: ${st.mainReady.lastMessage}` : ''}`);
    } else if (st.justUpdatedFrom && !updateDoneBannerDismissed) {
        mode = 'done';
        if (st.justUpdatedChannel === 'main') {
            setText(title, 'Hub sincronizado com as últimas mudanças');
            setText(sub, `v${shortVer(st.currentVersion)} com os commits mais novos do GitHub.`);
        } else {
            setText(title, `Atualizado para v${shortVer(st.currentVersion)}`);
            setText(sub, `Antes: v${shortVer(st.justUpdatedFrom)}. Veja o que mudou em Novidades.`);
        }
    }

    bar.classList.toggle('hidden', !mode);
    bar.classList.toggle('error', mode === 'error');
    bar.classList.toggle('done', mode === 'done');
    if (!mode) return;
    setText(icon, mode === 'error' ? '!' : mode === 'done' ? '✓' : '⬇');
    btnInstall.classList.toggle('hidden', !((canInstall && (mode === 'available' || mode === 'error')) || mode === 'main'));
    setText(btnInstall, mode === 'error' ? 'Tentar de novo' : mode === 'main' ? 'Reiniciar e aplicar' : 'Atualizar agora');
    btnNotes.classList.toggle('hidden', busy || mode === 'main');
    btnLater.classList.toggle('hidden', busy);
    setText(btnLater, mode === 'done' ? 'Fechar' : 'Depois');
}

function renderUpdateUi(st) {
    if (!st) return;
    currentUpdateState = st;
    renderUpdateBanner(st);
    const btnEl = $('btnUpdateToggle');
    const btnLabel = btnEl.querySelector('.btn-label') || btnEl;
    const btn = {
        classList: btnEl.classList,
        set textContent(v) { btnLabel.textContent = v === 'Atualizar' ? '' : v; },
        set title(v) { btnEl.title = v; },
        set disabled(v) { btnEl.disabled = v; },
    };
    const title = $('updatePopTitle');
    const verTag = $('updatePopVer');
    const desc = $('updatePopDesc');
    const progWrap = $('updateProgWrap');
    const progFill = $('updateProgFill');
    const progTxt = $('updateProgTxt');
    const notesEl = $('updatePopNotes');
    const btnInstall = $('btnUpdateInstall');
    const btnCheck = $('btnUpdateCheck');
    const brandVer = document.querySelector('.brand-ver');

    const curVer = st.currentVersion || '1.0.17';
    const shortCur = curVer.replace(/\.0$/, '');
    if (brandVer) brandVer.textContent = `v${shortCur}`;
    document.title = `Nexo PokeBot v${shortCur}`;

    const hasUpd = Boolean(st.hasUpdate);
    const busy = st.status === 'checking' || st.status === 'downloading' || st.status === 'extracting' || st.status === 'applying';
    btn.classList.toggle('has-update', hasUpd);
    if (st.status === 'downloading') {
        setText(btn, `Baixando ${st.percent || 0}%`);
    } else if (st.status === 'extracting' || st.status === 'applying') {
        setText(btn, 'Aplicando...');
    } else if (hasUpd) {
        setText(btn, `v${(st.latestVersion || '').replace(/\.0$/, '')}`);
    } else {
        setText(btn, 'Atualizar');
    }

    setText(verTag, hasUpd ? `v${curVer} -> v${st.latestVersion}` : `v${curVer}`);
    btnCheck.disabled = busy;

    if (st.status === 'checking') {
        setText(title, 'Verificando atualizações');
        setText(desc, 'Consultando Releases e mudanças novas no GitHub...');
        progWrap.classList.add('hidden');
        btnInstall.classList.add('hidden');
    } else if (st.status === 'downloading') {
        setText(title, `Baixando v${st.latestVersion}`);
        const mbDone = formatBytesMb(st.downloadedBytes);
        const mbTot = formatBytesMb(st.totalBytes || st.assetSize);
        setText(desc, mbTot ? `${mbDone} / ${mbTot}` : 'Baixando pacote Windows...');
        progWrap.classList.remove('hidden');
        progFill.style.width = `${Math.max(0, Math.min(100, Number(st.percent || 0)))}%`;
        setText(progTxt, `${st.percent || 0}%`);
        btnInstall.classList.add('hidden');
    } else if (st.status === 'extracting') {
        setText(title, `Extraindo v${st.latestVersion}`);
        setText(desc, 'Validando pacote antes de aplicar...');
        progWrap.classList.remove('hidden');
        progFill.style.width = '100%';
        setText(progTxt, 'Extraindo...');
        btnInstall.classList.add('hidden');
    } else if (st.status === 'applying') {
        setText(title, 'Aplicando atualização');
        setText(desc, 'Fechando para atualizar e reabrir automaticamente...');
        progWrap.classList.remove('hidden');
        progFill.style.width = '100%';
        setText(progTxt, 'Reiniciando...');
        btnInstall.classList.add('hidden');
    } else if (hasUpd) {
        setText(title, st.rebuild ? `Correção da v${st.latestVersion}` : `Nova Release: v${st.latestVersion}`);
        const sizeLabel = st.assetSize ? ` (${formatBytesMb(st.assetSize)})` : '';
        desc.textContent = st.isGitRepo
            ? 'Ambiente Git (.git) detectado. Use git pull ou abra a Release no GitHub.'
            : `Versão v${st.latestVersion} pronta para instalar${sizeLabel}.`;
        progWrap.classList.add('hidden');
        setText(btnInstall, 'Baixar e atualizar');
        btnInstall.classList.toggle('hidden', Boolean(st.isGitRepo) || !st.assetName);
        btnInstall.disabled = false;
        const updId = st.updateId || st.latestVersion;
        if (updId && updId !== lastNotifiedUpdateVersion) {
            lastNotifiedUpdateVersion = updId;
            showToast({
                kind: 'ok',
                title: st.rebuild ? `Correção da v${st.latestVersion}` : `Nova versão: v${st.latestVersion}`,
                text: 'Clique em Atualizar agora na faixa do topo. Suas contas ficam preservadas.',
            });
        }
    } else if (st.status === 'error') {
        setText(title, 'Erro na atualização');
        setText(desc, st.error || 'Não foi possível consultar o GitHub agora.');
        progWrap.classList.add('hidden');
        btnInstall.classList.add('hidden');
    } else if (st.mainReady && !st.isGitRepo) {
        const n = Number(st.mainReady.aheadBy || 0);
        setText(title, 'Mudanças prontas');
        desc.textContent = `${n > 1 ? `${n} mudanças baixadas` : 'Mudanças baixadas'} do GitHub. Entram ao reabrir o Hub ou agora pelo botão.${st.mainReady.lastMessage ? ` Última: ${st.mainReady.lastMessage}` : ''}`;
        progWrap.classList.add('hidden');
        setText(btnInstall, 'Reiniciar e aplicar');
        btnInstall.classList.remove('hidden');
        btnInstall.disabled = false;
    } else {
        setText(title, 'Tudo atualizado');
        desc.textContent = st.checkedAt
            ? `Você está na v${curVer} com as últimas mudanças.`
            : 'Clique em Verificar para buscar Releases e mudanças novas no GitHub.';
        progWrap.classList.add('hidden');
        btnInstall.classList.add('hidden');
    }

    if (hasUpd && st.releaseNotes) {
        setText(notesEl, st.releaseNotes.slice(0, 900));
        notesEl.classList.remove('hidden');
    } else {
        notesEl.classList.add('hidden');
    }
}

// ===== Medidor de desempenho (Ctrl+Shift+D) =====
const perfRenderMs = [];
let perfPanel = null;
let perfTimer = null;
let perfObserver = null;
let perfMutations = 0;
let perfMutSince = 0;
const PERF_LABELS = {
    gpuCpuPct: ['CPU da GPU', '%'],
    mainCpuPct: ['CPU do processo principal', '%'],
    rendererCpuPct: ['CPU da tela do Hub', '%'],
    lagP95Ms: ['Atraso do principal (p95)', 'ms'],
    snapshotMs: ['Montar os snapshots (p95)', 'ms'],
    snapshotKb: ['Tamanho do snapshot', 'KB'],
    renderMs: ['Desenhar a tela (p95)', 'ms'],
    mutationsPerSec: ['Mudanças no DOM por segundo', ''],
};
const p95 = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
};
function perfPanelText(rows, info) {
    const lines = rows.map((r) => `${PERF_LABELS[r.key]?.[0] || r.key}: ${r.value}${PERF_LABELS[r.key]?.[1] || ''} (meta ${r.budget}) ${r.ok ? 'ok' : 'ACIMA'}`);
    if (info) lines.push(info);
    return lines.join('\n');
}
async function refreshPerfPanel() {
    if (!perfPanel || !window.pokeHub?.getPerf) return;
    let perf = null;
    try { perf = await window.pokeHub.getPerf(); } catch { return; }
    if (!perf || !perfPanel) return;
    const now = performance.now();
    const secs = Math.max(0.5, (now - perfMutSince) / 1000);
    const values = { ...perf.values, renderMs: p95(perfRenderMs), mutationsPerSec: perfMutations / secs };
    perfMutations = 0;
    perfMutSince = now;
    const rows = [];
    for (const [key, budget] of Object.entries(perf.budgets || {})) {
        const v = values[key];
        if (v == null || !Number.isFinite(v)) continue;
        rows.push({ key, value: Math.round(v * 10) / 10, budget, ok: v <= budget });
    }
    const wv = perf.cpu?.Webview;
    const info = `${wv != null ? `Jogos embutidos: ${wv}% de CPU somados · ` : ''}pior atraso: ${Math.round(perf.lagMaxMs || 0)} ms`;
    const body = perfPanel.querySelector('.perf-rows');
    setHtml(body, rows.map((r) => `<tr class="${r.ok ? 'ok' : 'over'}"><td>${escapeHtml(PERF_LABELS[r.key]?.[0] || r.key)}</td>` +
        `<td>${r.value}${PERF_LABELS[r.key]?.[1] || ''}</td><td>até ${r.budget}${PERF_LABELS[r.key]?.[1] || ''}</td><td>${r.ok ? 'ok' : 'acima'}</td></tr>`).join(''));
    setText(perfPanel.querySelector('.perf-info'), info);
    perfPanel.__text = perfPanelText(rows, info);
}
function togglePerfPanel() {
    if (perfPanel) {
        clearInterval(perfTimer);
        perfObserver?.disconnect();
        perfObserver = null;
        perfPanel.remove();
        perfPanel = null;
        return;
    }
    perfPanel = document.createElement('div');
    perfPanel.className = 'perf-panel';
    perfPanel.setAttribute('role', 'dialog');
    perfPanel.setAttribute('aria-label', 'Desempenho do Hub');
    perfPanel.innerHTML = '<div class="perf-head"><b>Desempenho do Hub</b><span>' +
        '<button type="button" class="btn sm" data-perf="copy">Copiar números</button>' +
        '<button type="button" class="icon-btn sm" data-perf="close" aria-label="Fechar">×</button></span></div>' +
        '<table><thead><tr><th>Medida</th><th>Agora</th><th>Meta</th><th></th></tr></thead><tbody class="perf-rows"></tbody></table>' +
        '<div class="perf-info hint-text"></div>';
    perfPanel.addEventListener('click', (ev) => {
        const act = ev.target.closest('[data-perf]')?.dataset.perf;
        if (act === 'close') togglePerfPanel();
        if (act === 'copy') {
            const btn = ev.target.closest('button');
            navigator.clipboard.writeText(perfPanel?.__text || '').then(() => {
                btn.textContent = 'Copiado';
                setTimeout(() => { btn.textContent = 'Copiar números'; }, 1500);
            }).catch(() => {});
        }
    });
    document.body.append(perfPanel);
    perfMutations = 0;
    perfMutSince = performance.now();
    perfObserver = new MutationObserver((list) => {
        for (const m of list) if (!perfPanel?.contains(m.target)) perfMutations++;
    });
    perfObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    void refreshPerfPanel();
    perfTimer = setInterval(refreshPerfPanel, 2000);
}
document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.shiftKey && !ev.altKey && (ev.key === 'D' || ev.key === 'd')) {
        ev.preventDefault();
        togglePerfPanel();
    }
});

function renderAll() {
    const t0 = performance.now();
    try {
        renderAllInner();
    } finally {
        perfRenderMs.push(performance.now() - t0);
        if (perfRenderMs.length > 120) perfRenderMs.shift();
    }
}

function renderAllInner() {
    if (hubHook('isPopout') === true) {
        renderActiveAccountPanel();
        hubHook('afterRender');
        return;
    }
    renderTopTabsAndSlots();
    renderPanelsGrid();
    if (viewMode === 'grid') renderGridToolbar();
    renderActiveAccountPanel();
    hubHook('afterRender');
}

async function pollSnapshots() {
    try {
        snapshots = await window.pokeHub.getAllSnapshots();
        processActivityToasts(snapshots);
        renderAll();
    } catch {
        // aguarda proximo ciclo
    }
}

function wireEvents() {
    const updPop = $('updatePopover');
    const updToggle = $('btnUpdateToggle');
    const setUpdateOpen = (open) => {
        if (!updPop || !updToggle) return;
        updPop.classList.toggle('hidden', !open);
        updToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    const support = $('pixSupport');
    const pixKey = support?.dataset?.pixKey?.trim() || '';
    let setPixOpen = () => {};
    if (support && pixKey) {
        support.classList.remove('hidden');
        setText($('pixKey'), pixKey);
        const pop = $('pixPopover');
        const toggleBtn = $('btnPixToggle');
        setPixOpen = (open) => {
            pop.classList.toggle('hidden', !open);
            toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (!open) $('pixStatus').textContent = '';
        };
        toggleBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const next = pop.classList.contains('hidden');
            setUpdateOpen(false);
            setPixOpen(next);
        });
        pop.addEventListener('click', (ev) => ev.stopPropagation());
        $('copyPix').onclick = async () => {
            try {
                await navigator.clipboard.writeText(pixKey);
                setText($('pixStatus'), 'Chave Pix copiada ✓');
            } catch {
                setText($('pixStatus'), 'Selecione a chave para copiar.');
            }
        };
    }

    if (updToggle && updPop) {
        updToggle.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const next = updPop.classList.contains('hidden');
            setPixOpen(false);
            setUpdateOpen(next);
        });
        updPop.addEventListener('click', (ev) => ev.stopPropagation());
        $('btnUpdateCheck')?.addEventListener('click', () => {
            void window.pokeHub.checkUpdate().then(renderUpdateUi);
        });
        $('btnUpdateInstall')?.addEventListener('click', () => {
            void window.pokeHub.installUpdate();
        });
        $('btnBannerInstall')?.addEventListener('click', () => {
            void window.pokeHub.installUpdate();
        });
        $('btnBannerNotes')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            setPixOpen(false);
            setUpdateOpen(true);
        });
        $('btnBannerLater')?.addEventListener('click', () => {
            const st = currentUpdateState || {};
            if (st.hasUpdate) writeUpdateSnooze(st.updateId || st.latestVersion);
            else if (st.mainReady?.sha) writeUpdateSnooze(`main:${st.mainReady.sha}`);
            updateDoneBannerDismissed = true;
            renderUpdateBanner(st);
        });
        if (typeof window.pokeHub.onUpdateOpen === 'function') {
            window.pokeHub.onUpdateOpen(() => {
                setPixOpen(false);
                setUpdateOpen(true);
            });
        }
        $('btnUpdateOpenRelease')?.addEventListener('click', () => {
            const url = currentUpdateState?.releaseUrl || 'https://github.com/felipegakkeku/nexo-pokebot/releases/latest';
            void window.pokeHub.openExternal(url, activeAccount);
        });
    }

    document.addEventListener('click', () => {
        setPixOpen(false);
        setUpdateOpen(false);
    });
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            setPixOpen(false);
            setUpdateOpen(false);
        }
    });

    applyToastPosition();
    const toastChk = $('cToastEnabled');
    if (toastChk) {
        toastChk.checked = toastsEnabled;
        toastChk.addEventListener('change', () => {
            let preferred = 'top-right';
            try {
                const stored = localStorage.getItem('nexo_toast_pos');
                if (stored && ['top-right', 'top-center', 'bottom-right'].includes(stored)) {
                    preferred = stored;
                }
            } catch { /* ignora storage bloqueado */ }
            setToastPos(toastChk.checked ? preferred : 'off');
        });
    }
    $('toastPosSeg')?.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-toast-pos]');
        if (!btn) return;
        setToastPos(btn.dataset.toastPos || 'top-right');
    });
    document.querySelectorAll('.acc-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            const acc = Number(btn.dataset.acc);
            focusAccountInGrid(acc);
            selectAccount(acc);
        });
    });

    document.querySelectorAll('.seg-btn').forEach((btn) => {
        btn.addEventListener('click', () => setViewMode(btn.dataset.view));
    });

    document.querySelectorAll('.subtab').forEach((btn) => {
        btn.addEventListener('click', () => setSubtab(btn.dataset.subtab));
    });

    $('btnAllHeadless').addEventListener('click', () => {
        void closeAllEmbeddedToHeadless();
    });
    $('btnTray').addEventListener('click', () => window.pokeHub.minimizeToTray());
    $('btnAwake').addEventListener('click', async () => {
        awakeEnabled = await window.pokeHub.setAwake(!awakeEnabled);
        $('btnAwake').classList.toggle('active-toggle', awakeEnabled);
    });

    $('btnStartHeadless').addEventListener('click', async () => {
        if (webviews.has(activeAccount)) {
            await closeEmbeddedForAccount(activeAccount, { startHeadless: true });
        } else {
            await sendAction('start');
        }
    });

    $('btnToggleEmbedded').addEventListener('click', async () => {
        if (webviews.has(activeAccount)) {
            await closeEmbeddedForAccount(activeAccount, { startHeadless: true });
        } else {
            if (viewMode === 'panel-only' || viewMode === 'panels-grid') setViewMode('split');
            await openEmbeddedForAccount(activeAccount);
        }
    });

    $('btnPause').addEventListener('click', async () => {
        if (webviews.has(activeAccount)) {
            await closeEmbeddedForAccount(activeAccount, { startHeadless: false });
        }
        await sendAction('pause');
    });

    $('btnOpenWeb').addEventListener('click', () => sendAction('open-panel'));

    $('btnChangeHunt').addEventListener('click', () => {
        const slug = $('huntSelect').value;
        if (slug) sendAction('set-hunt', { slug });
    });
    $('btnGoCenter').addEventListener('click', () => sendAction('go-center'));
    $('btnCancelPendingHunt').addEventListener('click', () => sendAction('cancel-pending-hunt'));
    $('colModeRow')?.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-col-mode]');
        if (!btn) return;
        const nextMode = btn.dataset.colMode || 'off';
        if ($('cFarmObjective')) $('cFarmObjective').value = nextMode;
        renderConfigModePreview();
        await sendAction('set-config', { config: { farmObjective: nextMode } });
    });
    $('colFocusSelect')?.addEventListener('change', async (ev) => {
        const nextFocus = ev.target.value || 'xp';
        if ($('cFarmObjectiveFocus')) $('cFarmObjectiveFocus').value = nextFocus;
        await sendAction('set-config', { config: { farmObjectiveFocus: nextFocus } });
    });
    $('btnRefreshTopCatch')?.addEventListener('click', () => sendAction('refresh-topcatch'));

    $('btnResetStats').addEventListener('click', () => sendAction('reset-stats'));
    $('dropFilterBar').addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;
        if (btn.id === 'btnRestoreDrops') {
            await sendAction('set-config', { config: { dropHideItems: [] } });
            return;
        }
        const cat = btn.dataset.dropCat;
        if (!cat) return;
        const cur = new Set(snapshots[activeAccount]?.drops?.hiddenCategories || ['stone']);
        if (cur.has(cat)) cur.delete(cat);
        else cur.add(cat);
        await sendAction('set-config', { config: { dropHideCategories: [...cur] } });
    });
    $('dropsGrid').addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-hide-drop]');
        if (!btn) return;
        const key = btn.dataset.hideDrop;
        if (!key) return;
        const cur = new Set(snapshots[activeAccount]?.drops?.hiddenItems || []);
        cur.add(key);
        await sendAction('set-config', { config: { dropHideItems: [...cur] } });
    });
    $('btnRestockNow').addEventListener('click', () => sendAction('restock-now'));
    $('btnPassNow').addEventListener('click', () => sendAction('claim-pass'));
    $('btnPreyNow').addEventListener('click', () => sendAction('roll-prey'));
    $('btnLivesNow').addEventListener('click', () => sendAction('run-lives'));
    $('btnOpenLives').addEventListener('click', () => sendAction('open-lives'));
    $('chatReminder').addEventListener('change', event => {
        clearInterval(chatReminderTimer);
        const note = $('chatReminderNote');
        setText(note, event.target.checked ? 'Próximo lembrete em 20 minutos.' : '');
        if (event.target.checked) chatReminderTimer = setInterval(() => {
            setText(note, 'Hora de visitar o chat. Escolha um canal ao vivo.');
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                new Notification('Lives do Nexo PokeBot', { body: note.textContent }).onclick = () => { window.focus(); setSubtab('lives'); };
            }
        }, 20 * 60 * 1000);
    });

    $('cfgToggles').addEventListener('change', (ev) => {
        setConfigDirty(true);
        renderConfigModePreview();
        const target = ev.target;
        if (!target || target.tagName !== 'INPUT') return;
        if (target.id === 'cEconomy' && target.checked) {
            showToast({
                kind: 'warn',
                title: 'Atenção: Economia do servidor',
                text: 'Este modo corta o feed de campo no Headless e o bot passa a achar os caídos pelos eventos de batalha, podendo perder alguns (já aplicado; use Desfazer para voltar).',
                account: activeAccount,
            });
        } else if (target.id === 'cEconomyPingOnly' && target.checked) {
            showToast({
                kind: 'error',
                title: 'Atenção: Modo Somente Ping',
                text: 'Pausa captura, restock, passe, prey e /hunt, mantendo só a conexão viva e as lives (já aplicado; use Desfazer para voltar).',
                account: activeAccount,
            });
        } else if (target.id === 'cCaidos' && !target.checked) {
            showToast({
                kind: 'warn',
                title: 'Captura automática desmarcada',
                text: 'O bot deixou de jogar Pokébolas em caídos e Shinies (use Desfazer para voltar).',
                account: activeAccount,
            });
        }
    });
    $('cfgFields').addEventListener('change', () => { setConfigDirty(true); renderConfigModePreview(); });
    $('cfgFields').addEventListener('input', () => setConfigDirty(true));
    $('cfgChips').addEventListener('change', () => setConfigDirty(true));
    $('btnSaveCfg').addEventListener('click', saveConfig);

    // Treinador (Exp. Share + Casas)
    $('cTrainerEnabled')?.addEventListener('change', (ev) => sendAction('set-config', { config: { trainerEnabled: ev.target.checked } }));
    $('cTrainerUseExpShare')?.addEventListener('change', (ev) => sendAction('set-config', { config: { trainerUseExpShare: ev.target.checked } }));
    $('cTrainerUseHouses')?.addEventListener('change', (ev) => sendAction('set-config', { config: { trainerUseHouses: ev.target.checked } }));
    $('cTrainerMode')?.addEventListener('change', (ev) => sendAction('set-config', { config: { trainerMode: ev.target.value } }));
    $('cTrainerStep')?.addEventListener('change', (ev) => sendAction('set-config', { config: { trainerStepLevels: Number(ev.target.value) || 50 } }));
    $('btnTrainerAdd')?.addEventListener('click', async () => {
        const idRaw = $('trainerPokeSelect')?.value;
        const targetLvl = Math.max(2, Math.floor(Number($('trainerTargetLvl')?.value || 200) || 200));
        if (!idRaw) return;
        const tr = snapshots[activeAccount]?.xpTrainer;
        const pk = (tr?.availablePokemons || []).find((p) => String(p.id) === String(idRaw));
        const curQueue = [...(snapshots[activeAccount]?.config?.trainerQueue || [])];
        if (curQueue.some((q) => String(q.pokemonId) === String(idRaw))) return;
        curQueue.push({
            pokemonId: pk ? pk.id : (Number.isFinite(Number(idRaw)) ? Number(idRaw) : idRaw),
            name: pk?.name || '',
            speciesId: pk?.speciesId ?? null,
            targetLevel: targetLvl,
        });
        await sendAction('set-config', { config: { trainerQueue: curQueue } });
    });
    $('trainerQueueList')?.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-tr-act]');
        if (!btn) return;
        const act = btn.dataset.trAct;
        const idStr = String(btn.dataset.trId || '');
        const curQueue = [...(snapshots[activeAccount]?.config?.trainerQueue || [])];
        const idx = curQueue.findIndex((q) => String(q.pokemonId) === idStr);
        if (idx === -1) return;
        if (act === 'del') curQueue.splice(idx, 1);
        else if (act === 'up' && idx > 0) [curQueue[idx - 1], curQueue[idx]] = [curQueue[idx], curQueue[idx - 1]];
        else if (act === 'down' && idx < curQueue.length - 1) [curQueue[idx + 1], curQueue[idx]] = [curQueue[idx], curQueue[idx + 1]];
        else return;
        await sendAction('set-config', { config: { trainerQueue: curQueue } });
    });

    // Sniper do Mercado
    $('cSniperEnabled')?.addEventListener('change', (ev) => sendAction('set-config', { config: { sniperEnabled: ev.target.checked } }));
    $('cAdvisorEnabled')?.addEventListener('change', (ev) => sendAction('set-config', { config: { advisorEnabled: ev.target.checked } }));
    $('cDropRoute')?.addEventListener('change', (ev) => sendAction('set-config', { config: { dropRouteEnabled: ev.target.checked } }));
    $('cDropSellMarket')?.addEventListener('change', (ev) => sendAction('set-config', { config: { dropSellMarket: ev.target.checked } }));
    for (const [id, key] of DROP_FIELDS) {
        $(id)?.addEventListener('change', (ev) => {
            const n = Number(ev.target.value);
            if (Number.isFinite(n)) sendAction('set-config', { config: { [key]: n } });
        });
    }
    for (const [id, key] of DROP_SELECTS) {
        $(id)?.addEventListener('change', (ev) => sendAction('set-config', { config: { [key]: ev.target.value } }));
    }
    const rerenderAdvisor = () => {
        lastAdvisorSig = '';
        refreshAdvisorLists();
        if (snapshots[activeAccount]) renderAdvisorCard(snapshots[activeAccount]);
    };
    $('advisorPokeFilter')?.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-adv-filter]');
        if (!btn) return;
        advisorFilter = btn.dataset.advFilter;
        advisorShowAll = false;
        rerenderAdvisor();
    });
    $('btnAdvisorMore')?.addEventListener('click', () => {
        advisorShowAll = !advisorShowAll;
        rerenderAdvisor();
    });
    $('btnSniperScanNow')?.addEventListener('click', () => sendAction('sniper-scan-now'));
    $('cSniperInterval')?.addEventListener('change', (ev) => sendAction('set-config', { config: { sniperIntervalSec: Number(ev.target.value) || 30 } }));
    $('cSniperMinGold')?.addEventListener('change', (ev) => sendAction('set-config', { config: { sniperMinGoldReserve: Math.max(0, Number(ev.target.value) || 0) } }));
    $('cSniperMinOrbs')?.addEventListener('change', (ev) => sendAction('set-config', { config: { sniperMinOrbsReserve: Math.max(0, Number(ev.target.value) || 0) } }));
    const syncSniperModeInputs = () => {
        const isPoke = $('sniperTargetKind')?.value === 'pokemon';
        $('sniperItemInput')?.classList.toggle('hidden', isPoke);
        $('sniperPokeInput')?.classList.toggle('hidden', !isPoke);
        $('sniperMinLevel')?.classList.toggle('hidden', !isPoke);
        $('sniperMaxLevel')?.classList.toggle('hidden', !isPoke);
        $('sniperOnlyShinyWrap')?.classList.toggle('hidden', !isPoke);
    };
    $('sniperTargetKind')?.addEventListener('change', syncSniperModeInputs);
    syncSniperModeInputs();
    $('btnSniperAdd')?.addEventListener('click', async () => {
        const kind = $('sniperTargetKind')?.value === 'pokemon' ? 'pokemon' : 'item';
        const maxPrice = Math.floor(Number($('sniperMaxPrice')?.value || 0));
        if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
            showToast({ kind: 'warn', title: 'Sniper', text: 'Informe um preço máximo válido.' });
            return;
        }
        const currency = $('sniperCurrency')?.value === 'orb' ? 'orb' : 'gold';
        const maxQty = Math.max(0, Math.floor(Number($('sniperMaxQty')?.value || 0) || 0));
        const autoBuy = Boolean($('sniperAutoBuy')?.checked);
        const curRules = [...(snapshots[activeAccount]?.config?.sniperRules || [])];

        if (kind === 'pokemon') {
            const rawSp = String($('sniperPokeInput')?.value || '').trim();
            const minRaw = String($('sniperMinLevel')?.value || '').trim();
            const maxRaw = String($('sniperMaxLevel')?.value || '').trim();
            const minLevel = minRaw === '' ? 1 : Math.floor(Number(minRaw));
            const maxLevel = maxRaw === '' ? 0 : Math.floor(Number(maxRaw));
            if (!Number.isFinite(minLevel) || minLevel < 1) {
                showToast({ kind: 'warn', title: 'Sniper Pokémon', text: 'Informe um nível mínimo válido (≥ 1).' });
                return;
            }
            const speciesList = snapshots[activeAccount]?.sniper?.marketSpecies || [];
            let speciesId = 0;
            let speciesName = '';
            if (rawSp) {
                const idMatch = rawSp.match(/#(\d+)\)?$/) || rawSp.match(/^(\d+)$/);
                let found = idMatch ? speciesList.find((sp) => Number(sp.id) === Number(idMatch[1])) : null;
                if (!found) {
                    const clean = rawSp.toLowerCase();
                    found = speciesList.find((sp) => sp.name.toLowerCase() === clean) || speciesList.find((sp) => sp.name.toLowerCase().includes(clean));
                }
                speciesId = found ? Number(found.id) : (idMatch ? Number(idMatch[1]) : 0);
                speciesName = found ? found.name : rawSp.replace(/\s*\(#\d+\)$/, '').trim();
            }
            curRules.push({
                id: `sr_pk_${speciesId || 'any'}_${Date.now()}`,
                kind: 'pokemon',
                speciesId,
                speciesName,
                minLevel,
                maxLevel: Number.isFinite(maxLevel) && maxLevel >= minLevel ? maxLevel : 0,
                onlyShiny: Boolean($('sniperOnlyShiny')?.checked),
                currency,
                maxPrice,
                maxQty,
                boughtQty: 0,
                autoBuy,
                enabled: true,
            });
            if ($('sniperPokeInput')) $('sniperPokeInput').value = '';
            await sendAction('set-config', { config: { sniperRules: curRules } });
            return;
        }

        const rawText = String($('sniperItemInput')?.value || '').trim();
        if (!rawText) return;
        const cat = snapshots[activeAccount]?.sniper?.marketItems || [];
        const idMatch = rawText.match(/#(\d+)\)?$/) || rawText.match(/^(\d+)$/);
        let found = idMatch ? cat.find((it) => Number(it.id) === Number(idMatch[1])) : null;
        if (!found) {
            const clean = rawText.toLowerCase();
            found = cat.find((it) => it.name.toLowerCase() === clean) || cat.find((it) => it.name.toLowerCase().includes(clean));
        }
        const itemId = found ? Number(found.id) : (idMatch ? Number(idMatch[1]) : 0);
        if (!itemId || itemId <= 0) {
            showToast({ kind: 'warn', title: 'Sniper', text: 'Escolha um item válido da lista ou informe #ID.' });
            return;
        }
        const itemName = found ? found.name : rawText.replace(/\s*\(#\d+\)$/, '').trim();
        curRules.push({
            id: `sr_${itemId}_${Date.now()}`,
            kind: 'item',
            itemId,
            itemName,
            currency,
            maxPrice,
            maxQty,
            boughtQty: 0,
            autoBuy,
            enabled: true,
        });
        if ($('sniperItemInput')) $('sniperItemInput').value = '';
        await sendAction('set-config', { config: { sniperRules: curRules } });
    });
    $('sniperRulesList')?.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-sn-act]');
        if (!btn) return;
        const act = btn.dataset.snAct;
        const id = btn.dataset.snId;
        let curRules = [...(snapshots[activeAccount]?.config?.sniperRules || [])];
        if (act === 'del') {
            curRules = curRules.filter((r) => r.id !== id);
        } else if (act === 'toggle-auto') {
            curRules = curRules.map((r) => (r.id === id ? { ...r, autoBuy: !r.autoBuy } : r));
        } else if (act === 'toggle-on') {
            curRules = curRules.map((r) => (r.id === id ? { ...r, enabled: r.enabled === false } : r));
        } else {
            return;
        }
        await sendAction('set-config', { config: { sniperRules: curRules } });
    });

    $('liveChannelList').addEventListener('change', async (ev) => {
        const sel = ev.target;
        if (!sel?.dataset?.chanKey) return;
        const currentMap = { ...(snapshots[activeAccount]?.config?.liveChannelRewards || {}) };
        const val = sel.value;
        if (val) currentMap[sel.dataset.chanKey] = val;
        else delete currentMap[sel.dataset.chanKey];
        sel.classList.toggle('custom-set', Boolean(val));
        await sendAction('set-config', { config: { liveChannelRewards: currentMap } });
    });

    $('cBrowserProfile').addEventListener('change', () => {
        sendAction('set-config', { config: { browserProfile: $('cBrowserProfile').value } });
    });

    $('btnLoginPokeIdle').addEventListener('click', () => {
        const lp = snapshots[activeAccount]?.loginInProgress;
        if (lp === 'pokeidle') sendAction('cancel-login');
        else sendAction('login-pokeidle', { interactive: true });
    });
    $('btnLoginTwitch').addEventListener('click', () => {
        const lp = snapshots[activeAccount]?.loginInProgress;
        if (lp === 'twitch') sendAction('cancel-login');
        else sendAction('login-twitch', { interactive: true });
    });
    $('btnLoginKick').addEventListener('click', () => {
        const lp = snapshots[activeAccount]?.loginInProgress;
        if (lp === 'kick') sendAction('cancel-login');
        else sendAction('login-kick', { interactive: true });
    });

    $('btnReloadSess').addEventListener('click', () => sendAction('reload-session'));
    $('btnClearWebview').addEventListener('click', async () => {
        if (webviews.has(activeAccount)) {
            await closeEmbeddedForAccount(activeAccount, { startHeadless: false });
        }
        await sendAction('clear-webview-data');
    });

    // Inline import live tokens
    $('btnImportLiveToggle').addEventListener('click', () => {
        $('importLiveBox').classList.toggle('hidden');
        setText($('importLiveStatus'), '');
    });
    $('btnImportLiveCancel').addEventListener('click', () => $('importLiveBox').classList.add('hidden'));
    $('btnImportLiveSubmit').addEventListener('click', async () => {
        const twitchToken = $('importTwTok').value.trim();
        const kickToken = $('importKkTok').value.trim();
        const res = await sendAction('import-live-tokens', { twitchToken, kickToken });
        if (res?.ok) {
            $('importTwTok').value = '';
            $('importKkTok').value = '';
            $('importLiveBox').classList.add('hidden');
        } else {
            setText($('importLiveStatus'), res?.error || 'Tokens inválidos.');
        }
    });

    // Inline import session
    $('btnImportSessToggle').addEventListener('click', () => {
        $('importSessBox').classList.toggle('hidden');
        setText($('importSessStatus'), '');
    });
    $('btnImportSessCancel').addEventListener('click', () => $('importSessBox').classList.add('hidden'));
    $('btnImportSessSubmit').addEventListener('click', async () => {
        const raw = $('importSessInput').value.trim();
        const res = await sendAction('import-session', { raw });
        if (res?.ok) {
            $('importSessInput').value = '';
            $('importSessBox').classList.add('hidden');
        } else {
            setText($('importSessStatus'), res?.error || 'Sessão inválida.');
        }
    });

    // Per-slot browser actions
    document.querySelectorAll('[data-slot-act]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const acc = Number(btn.dataset.slot);
            const act = btn.dataset.slotAct;
            if (act === 'mute') {
                setAccountMuted(acc, !isAccountMuted(acc));
            } else if (act === 'summary') {
                const bucket = getSlotSidebarBucket();
                const cur = getSlotSidebarCfg(acc);
                slotSidebarState[bucket][acc].dock = cur.dock === 'off' ? 'right' : 'off';
                saveSlotSidebarState();
                applySummaryLayout();
            } else if (act === 'max') {
                gridState.max = gridState.max === acc ? 0 : acc;
                gridState.hidden = gridState.hidden.filter((a) => a !== acc);
                saveGridState();
                applyGridLayout();
                renderGridToolbar();
            } else if (act === 'hide') {
                if (!gridState.hidden.includes(acc)) gridState.hidden.push(acc);
                if (gridState.max === acc) gridState.max = 0;
                saveGridState();
                applyGridLayout();
                renderGridToolbar();
            } else if (act === 'focus') {
                selectAccount(acc);
                setViewMode('split');
            } else if (act === 'reload') {
                webviews.get(acc)?.reload();
            } else if (act === 'headless') {
                if (webviews.has(acc)) {
                    await closeEmbeddedForAccount(acc, { startHeadless: true });
                } else {
                    await sendAction('start', {}, acc);
                }
            } else if (act === 'toggle') {
                if (webviews.has(acc)) {
                    await closeEmbeddedForAccount(acc, { startHeadless: true });
                } else {
                    await openEmbeddedForAccount(acc);
                }
            }
        });
    });

    initGridControls();
    void initSoundControls();

    // Game Intel, Quick Actions, Prey, Auto-Colecao, Eventos, Bosses, Safari, Ginasios, PvP e Utilidades
    $('btnClaimAll')?.addEventListener('click', () => {
        void runGameAction('claim-all', {}, 'Resgatar tudo');
    });
    $('quickTeamSelect')?.addEventListener('change', (ev) => {
        const val = ev.target.value;
        if (!val) return;
        const pokemonId = Number.isFinite(Number(val)) ? Number(val) : val;
        void runGameAction('team-active', { pokemonId }, 'Troca de Pokémon ativo');
    });
    $('btnQuickZMove')?.addEventListener('click', () => {
        const btn = $('btnQuickZMove');
        const idRaw = btn?.dataset?.pokeId;
        if (!idRaw) return;
        const pokemonId = Number.isFinite(Number(idRaw)) ? Number(idRaw) : idRaw;
        const fisico = btn.dataset.fisico !== '1';
        void runGameAction('zmove-toggle', { pokemonId, fisico }, 'Z-Move');
    });
    $('outlandTierSel')?.addEventListener('change', (ev) => {
        const tier = Number(ev.target.value);
        if (Number.isFinite(tier) && tier >= 1) {
            void runGameAction('outland-tier', { tier }, `Outland Tier ${tier}`);
        }
    });
    $('eggStepBox')?.addEventListener('click', (ev) => {
        if (ev.target.closest('button[data-intel-act="craft-shiny-egg"]')) {
            void runGameAction('craft-shiny-egg', {}, 'Fabricar Ovo Shiny');
        }
    });
    $('evolutionDexBox')?.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-evo-poke]');
        if (!btn) return;
        const pRaw = btn.dataset.evoPoke;
        const aRaw = btn.dataset.evoAlvo;
        const pokemonId = Number.isFinite(Number(pRaw)) ? Number(pRaw) : pRaw;
        const alvoId = Number.isFinite(Number(aRaw)) ? Number(aRaw) : aRaw;
        void runGameAction('evolve-pokemon', { pokemonId, alvoId }, 'Evolução Pokédex');
    });

    $('eventsTabs')?.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-intel-tab]');
        if (!btn) return;
        const nextTab = btn.dataset.intelTab;
        if (!nextTab) return;
        document.querySelectorAll('#eventsTabs button[data-intel-tab]').forEach((b) => {
            const on = b.dataset.intelTab === nextTab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
        });
        document.querySelectorAll('#eventsMetaCard .intel-pane').forEach((p) => {
            p.classList.toggle('hidden', p.dataset.intelPane !== nextTab);
        });
    });
    $('eventsMetaCard')?.addEventListener('click', (ev) => {
        const actBtn = ev.target.closest('button[data-intel-act]');
        if (actBtn) {
            const act = actBtn.dataset.intelAct;
            if (act === 'raid-enroll') void runGameAction('raid-enroll', {}, 'Inscrição Raid');
            else if (act === 'showdown-enroll') void runGameAction('showdown-enroll', {}, 'Inscrição Showdown');
            else if (act === 'camp-enroll') void runGameAction('camp-enroll', {}, 'Inscrição Campeonato');
            else if (act === 'mistico-enter') void runGameAction('mistico-enter', {}, 'Místico');
            else if (act === 'gym-info') void runGameAction('gym-info', {}, 'Ginásios');
            else if (act === 'apply-pvp-team') {
                void runGameAction('apply-pvp-team', {}, 'Time PvP recomendado');
            } else if (act === 'start-team-pvp') {
                if ($('cFarmObjective')) $('cFarmObjective').value = 'team-pvp';
                void sendAction('set-config', { config: { farmObjective: 'team-pvp' } });
            } else if (act === 'pvp-save-formation') {
                const pvp = snapshots[activeAccount]?.gameIntel?.pvpMeta || {};
                const pokemonIds = (pvp.team || []).map((m) => m.id).filter(Boolean);
                const casas = Array.isArray(pvp.casas) ? pvp.casas : [];
                void runGameAction('pvp-save-formation', { pokemonIds, casas }, 'Formação PvP');
            }
            return;
        }
        const bossEnter = ev.target.closest('button[data-boss-enter]');
        if (bossEnter) {
            void runGameAction('boss-enter', { key: bossEnter.dataset.bossEnter }, 'Entrar no Boss');
            return;
        }
        if (ev.target.closest('button[data-boss-leave]')) {
            void runGameAction('boss-leave', {}, 'Sair do Boss');
            return;
        }
        const safariBtn = ev.target.closest('button[data-safari-enter]');
        if (safariBtn) {
            const tickets = Math.max(6, Number(safariBtn.dataset.safariEnter) || 6);
            void runGameAction('safari-enter', { tickets }, `Safari (${tickets} tickets)`);
            return;
        }
        const gymBtn = ev.target.closest('button[data-gym-challenge]');
        if (gymBtn) {
            void runGameAction('gym-challenge', { tipo: gymBtn.dataset.gymChallenge }, `Desafiar Ginásio ${gymBtn.dataset.gymChallenge}`);
            return;
        }
        if (ev.target.closest('#btnGymChallengeSel')) {
            const tipo = $('gymChallengeTypeSel')?.value;
            if (tipo) void runGameAction('gym-challenge', { tipo }, `Desafiar Ginásio ${tipo}`);
        }
    });
    $('eventsMetaCard')?.addEventListener('change', (ev) => {
        const chk = ev.target.closest('input[data-boss-auto]');
        if (!chk) return;
        void runGameAction('boss-auto', { ativo: chk.checked, key: chk.dataset.bossAuto }, 'Boss Auto');
    });

    $('preyCartelaSeg')?.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-prey-cartela]');
        if (!btn) return;
        preyCartelaActive = Number(btn.dataset.preyCartela) === 2 ? 2 : 1;
        document.querySelectorAll('#preyCartelaSeg button[data-prey-cartela]').forEach((b) => {
            b.classList.toggle('active', Number(b.dataset.preyCartela) === preyCartelaActive);
        });
        if (snapshots[activeAccount]) renderAutomationExtras(snapshots[activeAccount]);
    });
    $('preyRegionsGrid')?.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-prey-reg]');
        if (!btn) return;
        const reg = btn.dataset.preyReg;
        const set = preySelectedByCartela[preyCartelaActive];
        if (set.has(reg)) set.delete(reg);
        else set.add(reg);
        if (snapshots[activeAccount]) renderAutomationExtras(snapshots[activeAccount]);
    });
    $('btnApplyPreyRegions')?.addEventListener('click', () => {
        const regioes = [...preySelectedByCartela[preyCartelaActive]];
        if (regioes.length < 2) {
            showToast({ kind: 'warn', title: 'Prey por Região', text: 'Escolha pelo menos 2 regiões.' });
            return;
        }
        void runGameAction('prey-regions', { cartela: preyCartelaActive, regioes }, `Prey Cartela ${preyCartelaActive}`);
    });

    const readAutoColRule = () => ({
        lendario: Boolean($('acLendario')?.checked),
        shiny: Boolean($('acShiny')?.checked),
        potenciaMin: Number($('acPotencia')?.value || 0),
        qualidadeMin: Number($('acQualidade')?.value || 0),
        ivMin: Math.max(0, Number($('acIvMin')?.value || 0)),
        notaMin: Math.max(0, Number($('acNotaMin')?.value || 0)),
    });
    $('btnApplyAutoCol')?.addEventListener('click', async () => {
        const regra = readAutoColRule();
        const ativo = Boolean($('acAutoVendaDepot')?.checked);
        await runGameAction('auto-colecao', { regra }, 'Auto-Coleção');
        await sendAction('auto-venda-depot', { ativo });
    });
    $('btnApplyAutoColAll')?.addEventListener('click', async () => {
        const regra = readAutoColRule();
        const ativo = Boolean($('acAutoVendaDepot')?.checked);
        const results = await Promise.all(ACCOUNTS.map(async (acc) => {
            const r1 = await sendAction('auto-colecao', { regra }, acc).catch(() => null);
            await sendAction('auto-venda-depot', { ativo }, acc).catch(() => null);
            return r1;
        }));
        const okCount = results.filter((r) => r?.ok !== false).length;
        showToast({ kind: 'ok', title: 'Auto-Coleção & Depot', text: `Regra aplicada em ${okCount} de ${ACCOUNTS.length} contas.` });
    });

    $('btnSacrificeRun')?.addEventListener('click', () => void runGameAction('sacrifice-run', {}, 'Sacrifício'));
    $('btnSacrificeBone')?.addEventListener('click', () => {
        const qtd = Math.max(1, Math.floor(Number($('boneQty')?.value || 1) || 1));
        void runGameAction('sacrifice-bone', { qtd }, `Osso (+20% XP) x${qtd}`);
    });
    $('btnOferendaRun')?.addEventListener('click', () => {
        const monoTypeOnly = Boolean($('chkOferendaMono')?.checked);
        void runGameAction('oferenda-run', { monoTypeOnly }, 'Oferenda 5/5');
    });
    $('btnBikeEquipBest')?.addEventListener('click', () => {
        const bh = snapshots[activeAccount]?.gameIntel?.bikesAndHouses;
        const bicicletaId = typeof bh?.bestBikeUpgrade === 'object'
            ? (bh.bestBikeUpgrade?.id ?? bh.bestBikeUpgrade?.bicicletaId)
            : (bh?.bestBikeUpgrade ?? bh?.equippedBikeId);
        if (!bicicletaId) {
            showToast({ kind: 'warn', title: 'Bicicletas', text: 'Nenhuma bicicleta melhor disponível para equipar.' });
            return;
        }
        void runGameAction('bike-equip', { bicicletaId }, 'Equipar Bicicleta');
    });
    $('btnBikeCraft')?.addEventListener('click', () => void runGameAction('bike-craft', {}, 'Craftar Bicicletas'));
    $('btnBikeFabricar')?.addEventListener('click', () => void runGameAction('bike-fabricar', {}, 'Fabricar Bicicleta'));
    $('btnHouseFill')?.addEventListener('click', () => {
        const bh = snapshots[activeAccount]?.gameIntel?.bikesAndHouses;
        const casaId = bh?.bestHouseId ?? bh?.nextHouseId ?? null;
        void runGameAction('house-use', { ...(casaId != null ? { casaId } : {}), usar: true }, 'Preencher Casas');
    });
    $('btnHouseCraft')?.addEventListener('click', () => void runGameAction('house-craft', {}, 'Craftar Casa'));

    $('refinePokeSel')?.addEventListener('change', () => {
        if (snapshots[activeAccount]) renderAutomationExtras(snapshots[activeAccount]);
    });
    $('refineStatSel')?.addEventListener('change', () => {
        if (snapshots[activeAccount]) renderAutomationExtras(snapshots[activeAccount]);
    });
    $('btnRefineNow')?.addEventListener('click', () => {
        const pRaw = $('refinePokeSel')?.value;
        const stat = $('refineStatSel')?.value || 'hp';
        if (!pRaw) return;
        const pokemonId = Number.isFinite(Number(pRaw)) ? Number(pRaw) : pRaw;
        void runGameAction('refine-pokemon', { pokemonId, stat }, `Refino (${stat})`);
    });
    $('btnReduceLevel')?.addEventListener('click', () => {
        const pRaw = $('refinePokeSel')?.value;
        const nivelAlvo = Math.floor(Number($('reduceLvlInput')?.value || 0));
        if (!pRaw || !Number.isFinite(nivelAlvo) || nivelAlvo < 1) {
            showToast({ kind: 'warn', title: 'Reduzir nível', text: 'Informe um Pokémon e um nível alvo válido.' });
            return;
        }
        const pokemonId = Number.isFinite(Number(pRaw)) ? Number(pRaw) : pRaw;
        void runGameAction('reduce-level', { pokemonId, nivelAlvo }, `Reduzir nível para ${nivelAlvo}`);
    });
    $('btnCsvExport')?.addEventListener('click', () => {
        const tipo = $('csvExportType')?.value || 'drops';
        void runGameAction('csv-export', { tipo }, `Exportar CSV (${tipo})`);
    });
    $('btnOpenBox')?.addEventListener('click', () => {
        const id = Math.floor(Number($('openBoxId')?.value || 0));
        if (!id || id < 1) {
            showToast({ kind: 'warn', title: 'Abrir caixa', text: 'Informe o ID da caixa.' });
            return;
        }
        void runGameAction('open-box', { id }, `Abrir caixa #${id}`);
    });
    $('btnCraftShinyStone')?.addEventListener('click', () => {
        const tipo = $('craftStoneType')?.value || 'fire';
        void runGameAction('craft-shiny-stone', { tipo }, `Fabricar Shiny Stone (${tipo})`);
    });
    $('btnCraftMega')?.addEventListener('click', () => {
        const dex = Math.floor(Number($('megaDexInput')?.value || 0));
        if (!dex || dex < 1) {
            showToast({ kind: 'warn', title: 'Craft Mega', text: 'Informe o número da Pokédex.' });
            return;
        }
        const shiny = Boolean($('megaShinyChk')?.checked);
        const segunda = Boolean($('megaSegundaChk')?.checked);
        void runGameAction('craft-mega', { dex, shiny, segunda }, `Craft Mega #${dex}`);
    });

    // IPC callbacks from main process
    window.pokeHub.onWebviewSend(({ account, rawJson }) => {
        const wv = webviews.get(Number(account));
        if (!wv || !rawJson) return;
        wv.executeJavaScript(`window.__pbHubSend && window.__pbHubSend(${JSON.stringify(rawJson)})`).catch(() => {});
    });

    window.pokeHub.onWebviewReadHunt(async ({ account, metric, queryId }) => {
        const wv = webviews.get(Number(account));
        if (!wv) {
            window.pokeHub.replyHuntResult(queryId, null);
            return;
        }
        try {
            const result = await wv.executeJavaScript(
                `window.__pbHubReadHunt ? window.__pbHubReadHunt(${JSON.stringify(metric || 'xp')}) : null`
            );
            window.pokeHub.replyHuntResult(queryId, result ?? null);
        } catch {
            window.pokeHub.replyHuntResult(queryId, null);
        }
    });

    window.pokeHub.onFocusAccount((acc) => {
        selectAccount(Number(acc));
    });

    window.pokeHub.onEcoAllHeadless(() => {
        void closeAllEmbeddedToHeadless();
    });

    if (typeof window.pokeHub.onAviso === 'function') {
        window.pokeHub.onAviso((a) => {
            if (!a) return;
            showToast({
                kind: a.kind || 'info',
                title: a.title || 'Nexo PokeBot',
                text: a.text || a.title || '',
                duration: 30_000,
                ...(a.link ? { actionLabel: 'Abrir', onClick: () => void window.pokeHub.openExternal?.(a.link) } : {}),
            });
        });
    }
    if (typeof window.pokeHub.onUpdateState === 'function') {
        window.pokeHub.onUpdateState((st) => renderUpdateUi(st));
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            void pollSnapshots();
        }
    });
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        if (!document.hidden) {
            void pollSnapshots();
        }
    }, 1250);
    // Pontos das lives: leitura leve a cada 45s enquanto a aba Lives estiver aberta (evita 429)
    setInterval(requestLivesRefresh, 45_000);
    if (huntCountdownTimer) clearInterval(huntCountdownTimer);
    // Décimos de segundo só enquanto há trava de centro/troca; sem contagem, um tique por segundo basta.
    let fastCountdown = true;
    let lastCountdownAt = 0;
    huntCountdownTimer = setInterval(() => {
        if (document.hidden) return;
        const now = Date.now();
        if (!fastCountdown && now - lastCountdownAt < 1000) return;
        lastCountdownAt = now;
        fastCountdown = refreshHuntAndCenterButtons();
    }, 120);
}

async function init() {
    webviewPreloadUrl = await window.pokeHub.getWebviewPreload();
    wireEvents();
    if (typeof window.pokeHub.getUpdateState === 'function') {
        window.pokeHub.getUpdateState().then(renderUpdateUi).catch(() => {});
    }
    await pollSnapshots();
    startPolling();
}

init();
