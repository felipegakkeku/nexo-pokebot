'use strict';

const GAME_URL = 'https://pokeidle.io/app';
const ACCOUNTS = [1, 2, 3, 4];
const STATUS_LABELS = {
    connected: 'FARMANDO',
    bridge: 'EMBUTIDO · ON',
    connecting: 'CONECTANDO',
    standby: 'STANDBY',
    paused: 'PAUSADO',
    error: 'ERRO',
    disconnected: 'OFFLINE',
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
    return Number(n || 0).toLocaleString('pt-BR');
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
const GRID_LAYOUTS = ['2x2', 'focus', 'cols', 'rows'];
const RUNNING_STATUSES = ['connected', 'bridge', 'connecting'];
const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const audioState = new Map(); // conta -> { muted, playing } enquanto o jogo esta embutido
let gridState = loadGridState();
let gridGutters = { v: false, h: false };

function clampSplit(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(0.8, Math.max(0.2, n)) : 0.5;
}

function loadGridState() {
    const st = { layout: '2x2', order: [...ACCOUNTS], hidden: [], max: 0, colSplit: 0.5, rowSplit: 0.5 };
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
    return st;
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

    let visible = gridState.order.filter((acc) => !gridState.hidden.includes(acc));
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
    const gutters = { v: false, h: false };

    if (n <= 1) {
        if (n === 1) place.set(visible[0], ['2', '1']);
    } else if (gridState.layout === 'cols') {
        cols = `repeat(${n}, minmax(0, 1fr))`;
        visible.forEach((acc, i) => place.set(acc, ['2', String(i + 1)]));
    } else if (gridState.layout === 'rows') {
        rows = `repeat(${n}, minmax(0, 1fr))`;
        visible.forEach((acc, i) => place.set(acc, [String(i + 2), '1']));
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
    if (!gutters.v && !gutters.h) return;
    const sr = stage.getBoundingClientRect();
    const tb = $('gridToolbar')?.getBoundingClientRect();
    const top = (tb ? tb.bottom : sr.top) - sr.top + 4;
    const visible = gridState.order.filter((acc) => !gridState.hidden.includes(acc));
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
            const order = [...gridState.order];
            const i = order.indexOf(from);
            const j = order.indexOf(acc);
            if (i < 0 || j < 0) return;
            [order[i], order[j]] = [order[j], order[i]];
            gridState.order = order;
            saveGridState();
            applyGridLayout();
        });
    }
}

function renderGridToolbar() {
    document.querySelectorAll('[data-grid-layout]').forEach((b) => {
        b.classList.toggle('active', b.dataset.gridLayout === gridState.layout);
    });
    const wrap = $('gridHiddenWrap');
    const chips = $('gridHiddenChips');
    if (wrap && chips) {
        wrap.hidden = gridState.hidden.length === 0;
        chips.replaceChildren(...gridState.hidden.map((acc) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'grid-chip';
            b.dataset.gridShow = String(acc);
            b.title = 'Mostrar de novo na grade';
            b.textContent = `+ ${acc}. ${accountNick(acc)}`;
            return b;
        }));
    }
    const muteBtn = $('btnGridMuteAll');
    if (muteBtn) {
        const embedded = [...webviews.keys()];
        const anyOn = embedded.some((acc) => !isAccountMuted(acc));
        muteBtn.disabled = embedded.length === 0;
        muteBtn.innerHTML = `${anyOn ? ICON_SOUND_OFF : ICON_SOUND_ON}<span>${anyOn ? 'Mutar todas' : 'Som em todas'}</span>`;
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
        tabIcon.innerHTML = st.muted ? ICON_SOUND_OFF : ICON_SOUND_ON;
        tabIcon.classList.toggle('is-muted', st.muted);
        tabIcon.classList.toggle('is-playing', playing && !st.muted);
        tabIcon.title = tip;
        tabIcon.setAttribute('aria-label', tip);
    }
    const btn = $(`slotAudio-${acc}`);
    if (btn) {
        btn.hidden = !embedded;
        btn.innerHTML = `${st.muted ? ICON_SOUND_OFF : ICON_SOUND_ON}<span>${st.muted ? 'Mudo' : 'Som'}</span>`;
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
    const want = gridState.order.join(',');
    if (box.dataset.order !== want) {
        box.dataset.order = want;
        box.replaceChildren(...gridState.order.map((acc) => {
            const card = document.createElement('article');
            card.className = 'pcard';
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
        card.querySelector('.acc-dot').className = `acc-dot ${status}`;
        card.querySelector('.pcard-nick').textContent = `${acc}. ${accountNick(acc)}`;
        card.querySelector('.pcard-sub').textContent = [STATUS_LABELS[status] || status.toUpperCase(), hunt].filter(Boolean).join(' · ');
        card.querySelector('.pcard-badge').textContent = `Nv ${t.level || 0} · ${fmtNum(t.gold)} gold`;
        const warnEl = card.querySelector('.pcard-warn');
        warnEl.hidden = warns.length === 0;
        warnEl.textContent = warns.length ? `⚠ ${warns.map((w) => w.title).join(' | ')}` : '';

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
                spriteBox.textContent = '?';
            }
        }
        const pct = pk ? Math.max(0, Math.min(100, Number(pk.hpPercent) || 0)) : 0;
        card.querySelector('.pcard-poke-name').textContent = pk ? `${pk.shiny ? '★ ' : ''}${pk.name} Nv ${pk.level}` : 'Aguardando Pokémon';
        const fill = card.querySelector('.pcard-hp i');
        fill.style.width = `${pct}%`;
        fill.style.background = pct > 55 ? '#10b981' : pct > 25 ? '#f59e0b' : '#ef4444';
        card.querySelector('.pcard-hp-txt').textContent = pk ? `${fmtNum(pk.hp)} / ${fmtNum(pk.maxHp)} HP (${pct}%)` : '';

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
        runBtn.textContent = running ? 'Pausar' : status === 'paused' ? 'Retomar Headless' : 'Iniciar Headless';
        runBtn.className = running ? 'btn sm' : 'btn sm primary';
    }
}

function fmtShortNum(n) {
    const v = Number(n || 0);
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
    el.textContent = text || '';
    el.className = `sound-status hint-text${kind ? ` ${kind}` : ''}`;
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
        document.getElementById('sndVolumeVal').textContent = `${Math.round(v * 100)}%`;
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
        const showBtn = ev.target.closest('[data-grid-show]');
        if (layoutBtn) {
            gridState.layout = layoutBtn.dataset.gridLayout;
            gridState.max = 0;
        } else if (showBtn) {
            const acc = Number(showBtn.dataset.gridShow);
            gridState.hidden = gridState.hidden.filter((a) => a !== acc);
        } else if (ev.target.closest('#btnGridMuteAll')) {
            const embedded = [...webviews.keys()];
            const anyOn = embedded.some((acc) => !isAccountMuted(acc));
            embedded.forEach((acc) => setAccountMuted(acc, anyOn));
            return;
        } else if (ev.target.closest('#btnGridReset')) {
            gridState = { layout: '2x2', order: [...ACCOUNTS], hidden: [], max: 0, colSplit: 0.5, rowSplit: 0.5 };
        } else {
            return;
        }
        saveGridState();
        applyGridLayout();
        renderGridToolbar();
    });
    wireGridGutter($('gridGutterV'), 'v');
    wireGridGutter($('gridGutterH'), 'h');
    wireGridDrag();
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
    applyGridLayout();
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
    applyGridLayout();
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
        btn.textContent = 'Resgatando…';
    }
    let res = null;
    try {
        res = await sendAction('claim-twitch-chest', { channel }, acc);
    } finally {
        chestClaimsPending.delete(key);
        // A lista pode ter sido redesenhada; se o botao ainda existe, restaura
        if (btn?.isConnected) {
            btn.disabled = false;
            btn.textContent = 'Resgatar +50';
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
    hint.textContent = dirty ? 'Alterações pendentes' : '';
    hint.className = dirty ? 'hint-text dirty' : 'hint-text';
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
        $('cfgHint').textContent = 'Alterações salvas';
    }
    return res;
}

let lastModeWarnSig = '';

function renderModeWarningsBanner(data) {
    const host = $('modeWarnBanner');
    if (!host) return;
    const list = Array.isArray(data?.modeWarnings) ? data.modeWarnings : [];
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
        card.className = `mode-warn-item ${w.severity === 'danger' ? 'danger' : 'warn'}`;
        const title = document.createElement('div');
        title.className = 'mode-warn-title';
        title.textContent = w.title;
        const detail = document.createElement('div');
        detail.className = 'mode-warn-detail';
        detail.textContent = w.detail;
        card.append(title, detail);
        if (w.fixConfig) {
            const actRow = document.createElement('div');
            actRow.className = 'mode-warn-actions';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn sm primary';
            btn.textContent = w.fixLabel || 'Restaurar modo completo';
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
            const objLabel = objMode === 'pokedex' ? 'Completar Pokédex' : (objMode === 'topcatch' ? 'Modo Top Catch' : '');
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
        el.className = `mode-warn-item ${it.cls}`;
        const t = document.createElement('div');
        t.className = 'mode-warn-title';
        t.textContent = it.title;
        const d = document.createElement('div');
        d.className = 'mode-warn-detail';
        d.textContent = it.detail;
        el.append(t, d);
        frag.appendChild(el);
    }
    box.replaceChildren(frag);
}

function renderTopTabsAndSlots() {
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
            tabSub.textContent = warns.length > 0 ? `⚠ ${baseSub}` : baseSub;
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
            toggleBtn.textContent = isEmbedded ? 'Ir p/ Headless' : 'Abrir Embutido';
            toggleBtn.className = isEmbedded ? 'btn sm primary grid-only' : 'btn sm teal grid-only';
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

    $('hdrNick').textContent = `Conta ${activeAccount} · ${nick}`;
    const pill = $('hdrStatus');
    pill.textContent = STATUS_LABELS[status] || status.toUpperCase();
    pill.className = `status-pill ${status}`;

    const errText = data.lastError && status !== 'connected' && status !== 'bridge'
        ? ` · ${data.lastError}`
        : '';
    $('hdrTrainerLine').textContent =
        `Nv ${t.level || 0} · ${fmtNum(t.gold)} gold · ativo há ${fmtUptime(st.uptimeSec)}${errText}`;

    const btnEmb = $('btnToggleEmbedded');
    btnEmb.textContent = isEmbedded ? 'Voltar para Headless' : 'Abrir no Embutido';
    btnEmb.title = isEmbedded ? 'Fecha o jogo embutido e segue farmando em segundo plano' : 'Abre o jogo desta conta aqui dentro';
    const runningNow = RUNNING_STATUSES.includes(status);
    const btnStart = $('btnStartHeadless');
    btnStart.style.display = runningNow || isEmbedded ? 'none' : '';
    btnStart.textContent = status === 'paused' ? 'Retomar Headless' : 'Iniciar Headless';
    $('btnPause').style.display = runningNow || isEmbedded ? '' : 'none';

    renderModeWarningsBanner(data);

    // Active Pokemon & Hunt
    const pk = data.activePokemon;
    $('pokeName').textContent = pk ? `${pk.shiny ? '★ ' : ''}${pk.name} Nv ${pk.level}` : 'Aguardando Pokémon';
    $('pokeHpTxt').textContent = pk ? `${fmtNum(pk.hp)} / ${fmtNum(pk.maxHp)} HP (${pk.hpPercent}%)` : '0 / 0 HP';
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
            box.textContent = '?';
        }
    }

    $('huntLine').textContent = `Hunt atual: ${t.huntName || '-'}${t.noCentro ? ' (Centro)' : ''}${t.economyActive ? ' · Economia do servidor ligada' : ''}`;
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
    renderVoteBar(data);

    // KPIs e Eficiência
    $('kKills').textContent = fmtNum(st.kills);
    $('kKillsSub').textContent = `${st.killsPerMin || 0}/min`;
    $('kXp').textContent = fmtNum(st.xpGained);
    $('kXpSub').textContent = `${fmtNum(st.xpPerHour)}/h · treinador ${fmtNum(st.xpTrainerPerHour)}/h`;
    const netGold = st.netGold ?? st.goldGained ?? 0;
    const netPerH = st.netGoldPerHour ?? st.goldPerHour ?? 0;
    $('kGold').textContent = `${netGold >= 0 ? '' : '-'}${fmtNum(Math.abs(netGold))}`;
    $('kGoldSub').textContent = `${netPerH >= 0 ? '+' : '-'}${fmtNum(Math.abs(netPerH))}/h líq.`;
    $('kCaps').textContent = fmtNum(st.captures);
    $('kCapsSub').textContent = `${Number(st.shiniesCaptured || 0) === 1 ? '1 shiny' : `${st.shiniesCaptured || 0} shinies`} · ${fmtNum(st.ballsThrown)} bolas`;

    const fmtDec = (n) => String(Number(n || 0)).replace('.', ',');
    $('eAvgKill').textContent = st.avgKillSec > 0 ? `${fmtDec(st.avgKillSec)}s` : '-';
    $('eAvgKillSub').textContent = `${fmtDec(st.killsPerMin || 0)} abates/min`;
    $('eCapKill').textContent = st.kills > 0 ? `${fmtDec(st.capturePerKillPct || 0)}%` : '-';
    $('eCapKillSub').textContent = st.killsPerCapture > 0 ? `1 a cada ${fmtDec(st.killsPerCapture)} abates` : 'sem capturas';
    $('eBallCap').textContent = st.ballsPerCapture > 0 ? fmtDec(st.ballsPerCapture) : '-';
    $('eBallCapSub').textContent = `${fmtDec(st.catchPerBallPct || 0)}% acerto/bola`;
    $('eSpent').textContent = `-${fmtNum(st.spentGold || 0)}`;
    $('eBrutoSub').textContent = `bruto: +${fmtNum(st.goldGained || 0)}`;
    $('eShinies').textContent = `${fmtNum(st.shiniesCaptured || 0)} / ${fmtNum(st.shiniesSeen || 0)}`;
    $('eShiniesSub').textContent = 'cap / vistos';
    $('eSurv').textContent = `${fmtNum(st.heals || 0)} poções · ${fmtNum(st.revivesUsed || 0)} revives`;
    $('eSurvSub').textContent = `${fmtNum(st.playerDeaths || 0)} mortes · ${fmtDec(st.potionsPerHour || 0)} poç/h`;

    // Drops da sessão & foco do mapa (memoizado por assinatura)
    const dr = data.drops || {};
    const focusKey = dr.focus || 'hunt';
    const focusBadge = $('dropsFocusBadge');
    focusBadge.textContent = `${dr.focusLabel || 'XP / Gold / Shiny'} · ${fmtNum(dr.total || 0)} drops`;
    focusBadge.className = `focus-badge ${focusKey}`;

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
            restoreBtn.textContent = `${hiddenItems.length} oculto${hiddenItems.length > 1 ? 's' : ''} · restaurar`;
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
                return `<div class="drop-chip${d.qty > 0 ? ' hit' : ''}">` +
                    `<div class="drop-chip-left"><span class="drop-chip-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>` +
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
    const selectedPotions = new Set([
        ...(data.config?.preferredPotionIds || []),
        ...(data.automation?.potionIds || []),
        ...(data.config?.restockPotionId ? [Number(data.config.restockPotionId)] : []),
    ]);
    const chips = [
        ['Poke Ball', balls[1]], ['Great Ball', balls[2]], ['Super Ball', balls[3]],
        ['Ultra Ball', balls[4]], ['Beast Ball', balls[5]],
    ];
    for (const pid of [200, 201, 202, 203, 204, 70070]) {
        const qty = Number(items[pid] || 0);
        if (pid === 200 || qty > 0 || selectedPotions.has(pid)) {
            chips.push([POTION_LABELS[pid], qty]);
        }
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
        $('cGuideMode').value = cfg.huntGuideMode || 'off';
        $('cGuideMetric').value = cfg.huntGuideMetric || 'xp';
        if ($('cFarmObjective')) $('cFarmObjective').value = cfg.farmObjective || 'off';
        if ($('cFarmObjectiveFocus')) $('cFarmObjectiveFocus').value = cfg.farmObjectiveFocus || 'xp';
        $('cLiveTier').value = cfg.liveRewardTier || 'smart';
        $('cLiveMaxTw').value = cfg.liveMaxTwitchSlots ?? 4;
        $('cLiveMaxKk').value = cfg.liveMaxKickSlots ?? 2;
        $('cLiveCustomTw').value = cfg.liveCustomTwitch || '';
        $('cLiveCustomKk').value = cfg.liveCustomKick || '';

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
    $('pokeLoginState').textContent = `PokeIdle · ${lp === 'pokeidle' ? 'Aguardando login no navegador…' : (gameOk ? nick : `Conta ${activeAccount}`)}`;
    $('twitchLoginState').textContent = `Twitch · ${lp === 'twitch' ? 'Faça login no Chrome e feche a janela…' : (lv.hasTwitchToken ? 'Conectada' : 'Desconectada')}`;
    $('kickLoginState').textContent = `Kick · ${lp === 'kick' ? 'Faça login no Chrome e feche a janela…' : (lv.hasKickToken ? 'Conectada' : 'Desconectada')}`;

    const bPk = $('btnLoginPokeIdle');
    const bTw = $('btnLoginTwitch');
    const bKk = $('btnLoginKick');
    bPk.disabled = Boolean(lp) && lp !== 'pokeidle';
    bTw.disabled = Boolean(lp) && lp !== 'twitch';
    bKk.disabled = Boolean(lp) && lp !== 'kick';
    bPk.textContent = lp === 'pokeidle' ? 'Cancelar login' : (gameOk ? 'Trocar conta' : 'Logar PokeIdle');
    bTw.textContent = lp === 'twitch' ? 'Cancelar login' : (lv.hasTwitchToken ? 'Reconectar Twitch' : 'Conectar Twitch');
    bKk.textContent = lp === 'kick' ? 'Cancelar login' : (lv.hasKickToken ? 'Reconectar Kick' : 'Conectar Kick');
    $('btnReloadSess').textContent = data.browserProfile ? 'Usar sessão do Chrome' : 'Recarregar sessão';

    if (!$('tab-lives').classList.contains('hidden')) renderLives(lv);
    if ($('tab-activity').classList.contains('hidden')) return;
    renderActivity(data);
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
    chip.className = 'watch-chip';
    if (w.watching) {
        chip.classList.add('watching');
        chip.textContent = `▶ Sequência ${w.minutes || 0}/${w.targetMinutes || 15} min`;
        chip.title = 'Assistindo no player real da Twitch (invisível, sem som) para a live contar na sequência.';
    } else if (w.kind === 'watch' && w.ok) {
        chip.classList.add('ok');
        chip.textContent = '✓ Sequência';
        chip.title = `Live assistida ${w.minutes || 0} min no player real ${fmtAgo(w.at)}. Conta para a sequência de lives.`;
    } else if (w.kind === 'watch' && w.ok === false) {
        chip.classList.add('warn');
        chip.textContent = '! Sequência';
        chip.title = `Não deu para assistir no player: ${w.reasonText || 'erro'}. Tento de novo em alguns minutos.`;
    } else if (w.following) {
        chip.classList.add('follow');
        chip.textContent = '♥ Seguindo';
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
function renderBuffManager(lv) {
    const box = $('buffManager');
    if (!box) return;
    const smartOn = Boolean(lv.smartBalance);
    const targetH = Number(lv.targetHours || 24);
    const guardMin = Number(lv.guardThresholdMin || 30);
    const platforms = [
        ['kick', 'Kick', 'kk', lv.kickRewards],
        ['twitch', 'Twitch', 'tw', lv.twitchRewards],
    ];
    const html = [];
    const syncOn = Boolean(lv.syncPlatforms);
    html.push(`<div class="bm-head"><div class="bm-title"><b>Gestor inteligente de buffs</b><span>${smartOn
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
    html.push('<div class="bm-legend"><span class="lg full">na meta</span><span class="lg mid">guardando</span><span class="lg low">acabando</span><span class="lg empty">sem buff</span></div>');
    const sig = html.join('');
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
    $('liveMinutes').textContent = fmtNum(lv.minutesWatched || 0);
    $('liveChests').textContent = fmtNum(lv.chestsClaimed || 0);
    $('liveRedeemed').textContent = fmtNum(lv.rewardsRedeemed || 0);
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
            row.className = 'live-chan-row';

            const info = document.createElement('div');
            info.className = 'live-chan-info';
            const badge = document.createElement('span');
            badge.className = `plat-badge ${ch.platform === 'twitch' ? 'tw' : 'kk'}`;
            badge.textContent = ch.platform === 'twitch' ? 'Twitch' : 'Kick';
            info.appendChild(badge);
            if (ch.live) {
                const onTag = document.createElement('span');
                onTag.className = 'live-on-tag';
                onTag.textContent = 'Ao vivo';
                info.appendChild(onTag);
            }
            const nameEl = document.createElement('span');
            nameEl.className = 'live-chan-name';
            nameEl.textContent = ch.channel;
            nameEl.title = ch.channel;
            info.appendChild(nameEl);
            const watchChip = buildWatchChip(ch);
            if (watchChip) info.appendChild(watchChip);
            if (typeof ch.balance === 'number') {
                const ptsEl = document.createElement('span');
                ptsEl.className = 'live-chan-pts';
                ptsEl.textContent = `${fmtNum(ch.balance)} pts`;
                info.appendChild(ptsEl);
            }

            const sel = document.createElement('select');
            sel.className = `live-chan-sel${ch.override ? ' custom-set' : ''}`;
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
                note.className = noteInfo.soft ? 'channel-smart-note' : 'channel-warning';
                note.textContent = noteInfo.text;
                row.append(note);
            } else if (ch.smartNote) {
                const note = document.createElement('small');
                note.className = 'channel-smart-note';
                note.textContent = ch.smartNote;
                row.append(note);
            }
            const url = (ch.platform === 'twitch' ? 'https://www.twitch.tv/' : 'https://kick.com/') + ch.channel;
            const hasManualChest = ch.platform === 'twitch' && Boolean(lv.twitch?.[ch.channel]?.manualChest);
            if (hasManualChest) {
                const chestBtn = document.createElement('button');
                chestBtn.className = 'btn sm chest-quick-btn';
                const pending = chestClaimsPending.has(`${activeAccount}:${ch.channel}`);
                chestBtn.textContent = pending ? 'Resgatando…' : 'Resgatar +50';
                chestBtn.disabled = pending;
                chestBtn.title = 'Resgata a caixinha +50 direto daqui, sem abrir o chat. Se a Twitch recusar, abre o chat leve como plano B.';
                chestBtn.onclick = () => void claimTwitchChest(ch.channel, activeAccount, chestBtn);
                row.append(chestBtn);
            }
            if (lv.officialUrls?.includes(url)) {
                for (const [title, action] of [['Abrir chat', 'open-live-chat'], ['Abrir live', 'open-lives']]) {
                    const button = document.createElement('button');
                    button.className = 'btn sm';
                    button.textContent = title;
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
            item.className = 'shiny-feed-item clickable';
            item.title = 'Clique para abrir o card completo deste shiny';
            const entryDex = resolvePokemonSpriteDex(entry.speciesId, entry.name, entry.spriteDex);
            const entryUrl = pokemonSpriteUrl(entry.speciesId, true, entryDex, entry.name);
            if (entryUrl) {
                const img = document.createElement('img');
                img.className = 'shiny-feed-sprite';
                img.alt = '';
                img.loading = 'lazy';
                img.src = entryUrl;
                img.dataset.spriteDex = String(entryDex);
                img.dataset.spriteShiny = '1';
                img.dataset.spriteStep = '0';
                item.append(img);
            }
            const txt = document.createElement('span');
            txt.className = 'shiny-feed-text';
            const name = document.createElement('strong');
            const lvTxt = entry.level && entry.level !== '?' ? ` (Nv ${entry.level})` : '';
            name.textContent = `${entry.name}${lvTxt}`;
            const meta = document.createElement('small');
            meta.textContent = `${entry.trainer} · ${entry.egg ? 'Ovo' : 'Captura'} · ${new Date(entry.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
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

function refreshHuntAndCenterButtons() {
    const data = snapshots[activeAccount];
    const btnCenter = $('btnGoCenter');
    const btnHunt = $('btnChangeHunt');
    const pendingBar = $('pendingHuntBar');
    const pendingText = $('pendingHuntText');
    if (!btnCenter || !btnHunt) return;

    const status = data?.status || 'disconnected';
    const isOnline = status === 'connected' || status === 'bridge';
    const t = data?.trainer || {};
    const now = Date.now();
    const combatLeftMs = t.centroLivreAt > now ? t.centroLivreAt - now : 0;
    const swapLeftMs = t.trocaHuntLivreAt > now ? t.trocaHuntLivreAt - now : 0;
    const lockLeftMs = Math.max(combatLeftMs, swapLeftMs);
    const fmtSec = (ms) => (ms / 1000).toFixed(1).replace('.', ',');

    if (!isOnline) {
        btnCenter.disabled = true;
        btnCenter.classList.remove('locked');
        btnCenter.textContent = 'Centro Médico';
        btnHunt.textContent = 'Trocar hunt';
    } else if (t.noCentro) {
        btnCenter.disabled = false;
        btnCenter.classList.remove('locked');
        btnCenter.textContent = 'Curar no Centro';
        btnHunt.textContent = swapLeftMs > 0 ? `Agendar (${fmtSec(swapLeftMs)}s)` : 'Trocar hunt';
    } else if (combatLeftMs > 0) {
        btnCenter.disabled = true;
        btnCenter.classList.add('locked');
        btnCenter.textContent = `Centro (${fmtSec(combatLeftMs)}s)`;
        btnHunt.textContent = t.pendingHuntSlug
            ? `Agendada (${fmtSec(lockLeftMs)}s)`
            : `Agendar (${fmtSec(lockLeftMs)}s)`;
    } else {
        btnCenter.disabled = !t.huntSlug;
        btnCenter.classList.remove('locked');
        btnCenter.textContent = 'Centro Médico';
        btnHunt.textContent = swapLeftMs > 0
            ? (t.pendingHuntSlug ? `Agendada (${fmtSec(swapLeftMs)}s)` : `Agendar (${fmtSec(swapLeftMs)}s)`)
            : 'Trocar hunt';
    }

    if (pendingBar && pendingText) {
        if (t.pendingHuntSlug && isOnline) {
            const label = t.pendingHuntName || t.pendingHuntSlug;
            pendingText.textContent = lockLeftMs > 0
                ? `Troca agendada: ${label} (${fmtSec(lockLeftMs)}s)`
                : `Trocando para ${label}...`;
            pendingBar.classList.remove('hidden');
        } else {
            pendingBar.classList.add('hidden');
        }
    }
    refreshTopCatchTimer(data);
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
        titleEl.textContent = entry.own ? `Seu Shiny: ${entry.name}` : `Shiny no servidor: ${entry.name}`;
    }
    if (metaEl) {
        const parts = [
            entry.trainer ? `Treinador: ${entry.trainer}` : '',
            entry.egg ? 'Origem: Ovo' : 'Origem: Captura',
            entry.hunt && entry.hunt !== 'Ovo Shiny' ? `Mapa: ${entry.hunt}` : '',
            when,
        ].filter(Boolean);
        metaEl.textContent = parts.join(' · ');
    }
    if (bodyEl) {
        bodyEl.replaceChildren();
        const cardEl = buildToastCard({
            speciesId: entry.speciesId,
            spriteDex: dex,
            sprite: pokemonSpriteUrl(entry.speciesId, true, dex, entry.name),
            name: entry.name,
            level: entry.level,
            subtitle: [dex ? `#${dex}` : '', entry.speciesId && entry.speciesId !== dex ? `ID ${entry.speciesId}` : ''].filter(Boolean).join(' · '),
            rows: Array.isArray(entry.details) ? entry.details : [],
        });
        bodyEl.append(cardEl);
        if (!Array.isArray(entry.details) || entry.details.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'hint-text';
            hint.style.marginTop = '8px';
            hint.textContent = 'O servidor não enviou atributos extras (IVs/natureza) neste anúncio.';
            bodyEl.append(hint);
        }
    }
    modal.classList.remove('hidden');
}

function buildToastCard(card) {
    const wrap = document.createElement('div');
    wrap.className = 'toast-card';
    const art = document.createElement('div');
    art.className = 'toast-card-art';
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
        art.textContent = '★';
    }
    for (let i = 0; i < 3; i++) {
        const sp = document.createElement('span');
        sp.className = `sparkle s${i + 1}`;
        sp.textContent = '✦';
        art.append(sp);
    }
    const info = document.createElement('div');
    info.className = 'toast-card-info';
    const name = document.createElement('div');
    name.className = 'toast-card-name';
    name.textContent = card.name || '';
    if (card.level !== undefined && card.level !== null && card.level !== '?') {
        const lv = document.createElement('span');
        lv.className = 'toast-card-level';
        lv.textContent = `Nv ${card.level}`;
        name.append(' ', lv);
    }
    info.append(name);
    if (card.subtitle) {
        const sub = document.createElement('div');
        sub.className = 'toast-card-sub';
        sub.textContent = card.subtitle;
        info.append(sub);
    }
    const rows = Array.isArray(card.rows) ? card.rows.slice(0, 8) : [];
    if (rows.length) {
        const dl = document.createElement('dl');
        dl.className = 'toast-card-rows';
        for (const [k, v] of rows) {
            const dt = document.createElement('dt');
            dt.textContent = labelPokemonDetail(k);
            const dd = document.createElement('dd');
            dd.textContent = String(v);
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
        if (event === 'rareDrop' || /^Drop\b/i.test(txt)) tag = 'DROP RARO';
        else if (event === 'vote' || /voto|diamante/i.test(txt)) tag = 'VOTO';
        else if (/top catch/i.test(txt)) tag = 'TOP CATCH';
        else if (/passe/i.test(txt)) tag = 'PASSE';
        return { tone: 'reward', cat: 'reward', tag, icon: 'gift', cleanText: txt };
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
    item.className = `toast-item ${meta.tone}${hasAcc ? ' has-acc' : ''}${card ? ' has-card' : ''}${onClick ? ' actionable' : ''}`;
    if (hasAcc) {
        item.dataset.acc = String(accNum);
        item.dataset.accColor = accColor;
    }
    item.setAttribute('role', meta.tone === 'error' ? 'alert' : 'status');

    const icon = document.createElement('div');
    icon.className = 'toast-icon';
    const svg = window.nexoIcons?.icon?.(meta.icon);
    if (svg) icon.innerHTML = svg;
    else icon.textContent = TOAST_ICONS[kind] || TOAST_ICONS.info;

    const main = document.createElement('div');
    main.className = 'toast-main';
    const head = document.createElement('div');
    head.className = 'toast-head';
    const badges = document.createElement('div');
    badges.className = 'toast-badges';

    let headline = String(title || '').trim();
    if (hasAcc) {
        let nickLabel = '';
        const accMatch = headline.match(new RegExp(`^(?:(.+?)\\s*·\\s*)?Conta\\s+${accNum}(?:\\s*·\\s*(.+))?$`));
        if (accMatch) {
            headline = (accMatch[1] || '').trim();
            nickLabel = (accMatch[2] || '').trim();
        }
        const accPill = document.createElement('span');
        accPill.className = 'toast-acc-pill';
        const dot = document.createElement('i');
        dot.className = 'acc-pill-dot';
        accPill.append(dot, document.createTextNode(nickLabel ? `C${accNum} · ${nickLabel}` : `Conta ${accNum}`));
        badges.append(accPill);
    }

    const catPill = document.createElement('span');
    catPill.className = `toast-cat-pill ${meta.tone}`;
    catPill.textContent = meta.tag;
    badges.append(catPill);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'toast-time';
    timeSpan.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    head.append(badges, timeSpan);
    main.append(head);

    if (headline && headline.toUpperCase() !== meta.tag) {
        const titleEl = document.createElement('div');
        titleEl.className = 'toast-title';
        titleEl.textContent = headline;
        main.append(titleEl);
    }
    if (card) main.append(buildToastCard(card));
    if (bodyTxt) {
        const body = document.createElement('div');
        body.className = 'toast-body';
        body.textContent = bodyTxt;
        main.append(body);
    }
    if (onClick && actionLabel) {
        const act = document.createElement('span');
        act.className = 'toast-action';
        act.textContent = actionLabel;
        main.append(act);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Fechar notificação');
    close.textContent = '×';

    const life = duration || (card ? 15_000 : (meta.tone === 'shiny' || onClick ? 8_000 : 5_500));
    const bar = document.createElement('div');
    bar.className = 'toast-progress';
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
    if (k === 'ok') return /troca de hunt|centro m[eé]dico|equipe curada|conectad|cookies|sincronizad|salva|pok[eé]dex|top catch/i.test(txt);
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
                    text: 'Voto diário liberado no IdleHub.io.',
                    account: acc,
                    actionLabel: 'Abrir voto',
                    event: 'vote',
                    onClick: () => void sendAction('open-vote-embedded', {}, acc),
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

function fmtShortDuration(ms) {
    const totalSec = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m`;
    return `${Math.max(1, totalSec)}s`;
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
        if (timerEl.textContent !== 'Sem dados') timerEl.textContent = 'Sem dados';
        timerEl.classList.remove('ending');
        return;
    }
    const remMs = Number.isFinite(tc.remainingMs)
        ? Math.max(0, Number(tc.remainingMs) - Math.max(0, Date.now() - Number(data?._receivedAt || Date.now())))
        : Math.max(0, Number(tc.endMs) - Date.now());
    const label = remMs > 0 ? `Falta ${fmtEventCountdown(remMs)}` : 'Virando semana...';
    if (timerEl.textContent !== label) timerEl.textContent = label;
    timerEl.classList.toggle('ending', remMs > 0 && remMs < 12 * 3600_000);
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
        countEl.textContent = `${fmtNum(tc.count || 0)} espécies`;
    }
    if (countSubEl) {
        if (tc.loaded && Number(tc.unlockedTotal || 0) > 0) {
            countSubEl.textContent = `${fmtNum(tc.unlockedCaptured)}/${fmtNum(tc.unlockedTotal)} liberadas (${tc.pct || 0}%) · ${fmtNum(tc.unlockedPendingHunts)} hunts`;
        } else if (isOnline) {
            countSubEl.textContent = 'clique em ↻ para carregar lista semanal';
        } else {
            countSubEl.textContent = 'conecte para sincronizar';
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
            rankEl.textContent = `#${fmtNum(rk.pos)}${prizeTag}`;
            if (rk.inPrizeZone && rk.above) {
                const diff = Math.max(1, Number(rk.above.count || 0) - Number(tc.count || 0));
                rankSubEl.textContent = `Acima: ${rk.above.nick || '#'} (+${fmtNum(diff)}) · 1º: ${fmtNum(rk.top1Count)}`;
            } else if (rk.inPrizeZone) {
                rankSubEl.textContent = rk.pos === 1 ? 'Líder do Top Catch semanal!' : `1º lugar: ${fmtNum(rk.top1Count)} espécies`;
            } else if (rk.top100Cutoff != null) {
                const diff100 = Math.max(1, Number(rk.top100Cutoff) - Number(tc.count || 0));
                rankSubEl.textContent = `Top 100: ${fmtNum(rk.top100Cutoff)} (+${fmtNum(diff100)}) · 1º: ${fmtNum(rk.top1Count)}`;
            } else {
                rankSubEl.textContent = `${fmtNum(rk.totalRanked)} no ranking`;
            }
        } else if (rk && rk.top1Count != null) {
            rankEl.textContent = 'Sem captura';
            rankSubEl.textContent = `1º: ${fmtNum(rk.top1Count)} · Top 100: ${fmtNum(rk.top100Cutoff ?? 0)}`;
        } else {
            rankEl.textContent = '-';
            rankSubEl.textContent = isOnline ? 'clique em ↻ para buscar ranking' : 'sem ranking';
        }
    }

    const ms = tc.milestone || null;
    const msTxt = $('tcMilestoneTxt');
    const msRew = $('tcMilestoneReward');
    const msFill = $('tcMilestoneFill');
    if (ms && msTxt && msRew && msFill) {
        if (ms.completedAll) {
            msTxt.textContent = `Marcos: ${fmtNum(ms.current)} / 600`;
            msRew.textContent = 'Todos concluídos ✓';
            msFill.style.width = '100%';
            msFill.classList.add('done');
        } else {
            msTxt.textContent = `Marco: ${fmtNum(ms.current)} / ${fmtNum(ms.next)} (faltam ${fmtNum(ms.remainingToNext)})`;
            msRew.textContent = ms.nextRewardLabel || '';
            msFill.style.width = `${Math.max(0, Math.min(100, Number(ms.progressPct || 0)))}%`;
            msFill.classList.remove('done');
        }
    }

    const dexEl = $('dexSummary');
    if (dexEl) {
        if (Number(dex.unlockedTotal || 0) > 0) {
            dexEl.textContent = `Pokédex: ${fmtNum(dex.unlockedCaptured)} / ${fmtNum(dex.unlockedTotal)} liberadas (${dex.pct || 0}%) · faltam ${fmtNum(dex.unlockedPendingHunts)} hunts · ${fmtNum(dex.capturedTotal)} registradas`;
        } else if (Number(dex.capturedTotal || 0) > 0) {
            dexEl.textContent = `Pokédex: ${fmtNum(dex.capturedTotal)} espécies registradas`;
        } else {
            dexEl.textContent = 'Pokédex: conecte para carregar hunts liberadas';
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

function renderVoteBar(data = snapshots[activeAccount]) {
    const bar = $('voteBar');
    if (!bar) return;
    const pill = $('votePill');
    const sub = $('voteSub');
    const btn = $('btnOpenVote');
    const btnExt = $('btnOpenVoteExt');
    const v = data?.vote;
    if (!v || !v.checkedAt) {
        bar.classList.remove('ready');
        btn.classList.remove('ready');
        const noSession = !data?.session?.nick && (!data?.trainer?.nick || data.trainer.nick === '-');
        btn.disabled = noSession;
        if (btnExt) btnExt.disabled = noSession;
        pill.textContent = 'IdleHub.io';
        sub.textContent = v?.error
            ? `Erro: ${v.error}`
            : 'Conecte a conta ou clique em ↻ para verificar';
        return;
    }
    const now = Date.now();
    const remMs = v.availableAt > now ? v.availableAt - now : (v.availableAt > 0 ? 0 : Number(v.remainingMs || 0));
    const ready = Boolean(v.ativo && remMs <= 0 && v.url);
    bar.classList.toggle('ready', ready);
    btn.classList.toggle('ready', ready);
    btn.disabled = !v.url;
    if (btnExt) btnExt.disabled = !v.url;
    if (!v.ativo) {
        pill.textContent = 'Desligado';
        sub.textContent = 'Vote & Ganhe inativo no servidor';
        return;
    }
    const progress = `${v.noPar || 0}/${v.votosPorDiamante || 2} p/ 💎 · ${fmtNum(v.votos || 0)} votos (${fmtNum(v.diamantes || 0)} 💎)`;
    if (ready) {
        pill.textContent = 'Disponível agora';
        sub.textContent = `${progress}`;
    } else {
        pill.textContent = `Em ${fmtShortDuration(remMs)}`;
        sub.textContent = progress;
    }
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
        sub.textContent = 'Suas 4 contas, sessões e configurações ficam preservadas.';
    } else if (st.failedTarget && st.hasUpdate) {
        mode = 'error';
        title.textContent = `A atualização para v${shortVer(st.failedTarget)} não foi aplicada`;
        sub.textContent = `Clique em Tentar de novo. Detalhes em ${st.logPath || 'nexo-pokebot-last-update.log'}`;
    } else if (st.hasUpdate && readUpdateSnooze() !== st.latestVersion) {
        mode = 'available';
        title.textContent = `Nova versão disponível: v${shortVer(st.latestVersion)}`;
        const size = st.assetSize ? ` · ${formatBytesMb(st.assetSize)}` : '';
        sub.textContent = st.isGitRepo
            ? 'Pasta de desenvolvimento: atualize com git pull.'
            : `Você está na v${shortVer(st.currentVersion)}${size}. Atualiza em 1 clique sem perder as contas.`;
    } else if (st.justUpdatedFrom && !updateDoneBannerDismissed) {
        mode = 'done';
        title.textContent = `Atualizado para v${shortVer(st.currentVersion)}`;
        sub.textContent = `Antes: v${shortVer(st.justUpdatedFrom)}. Veja o que mudou em Novidades.`;
    }

    bar.classList.toggle('hidden', !mode);
    bar.classList.toggle('error', mode === 'error');
    bar.classList.toggle('done', mode === 'done');
    if (!mode) return;
    icon.textContent = mode === 'error' ? '!' : mode === 'done' ? '✓' : '⬇';
    btnInstall.classList.toggle('hidden', !(canInstall && (mode === 'available' || mode === 'error')));
    btnInstall.textContent = mode === 'error' ? 'Tentar de novo' : 'Atualizar agora';
    btnNotes.classList.toggle('hidden', busy);
    btnLater.classList.toggle('hidden', busy);
    btnLater.textContent = mode === 'done' ? 'Fechar' : 'Depois';
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
        btn.textContent = `Baixando ${st.percent || 0}%`;
    } else if (st.status === 'extracting' || st.status === 'applying') {
        btn.textContent = 'Aplicando...';
    } else if (hasUpd) {
        btn.textContent = `v${(st.latestVersion || '').replace(/\.0$/, '')}`;
    } else {
        btn.textContent = 'Atualizar';
    }

    verTag.textContent = hasUpd ? `v${curVer} -> v${st.latestVersion}` : `v${curVer}`;
    btnCheck.disabled = busy;

    if (st.status === 'checking') {
        title.textContent = 'Verificando atualizações';
        desc.textContent = 'Consultando Releases em felipegakkeku/nexo-pokebot...';
        progWrap.classList.add('hidden');
        btnInstall.classList.add('hidden');
    } else if (st.status === 'downloading') {
        title.textContent = `Baixando v${st.latestVersion}`;
        const mbDone = formatBytesMb(st.downloadedBytes);
        const mbTot = formatBytesMb(st.totalBytes || st.assetSize);
        desc.textContent = mbTot ? `${mbDone} / ${mbTot}` : 'Baixando pacote Windows...';
        progWrap.classList.remove('hidden');
        progFill.style.width = `${Math.max(0, Math.min(100, Number(st.percent || 0)))}%`;
        progTxt.textContent = `${st.percent || 0}%`;
        btnInstall.classList.add('hidden');
    } else if (st.status === 'extracting') {
        title.textContent = `Extraindo v${st.latestVersion}`;
        desc.textContent = 'Validando pacote antes de aplicar...';
        progWrap.classList.remove('hidden');
        progFill.style.width = '100%';
        progTxt.textContent = 'Extraindo...';
        btnInstall.classList.add('hidden');
    } else if (st.status === 'applying') {
        title.textContent = 'Aplicando atualização';
        desc.textContent = 'Fechando para atualizar e reabrir automaticamente...';
        progWrap.classList.remove('hidden');
        progFill.style.width = '100%';
        progTxt.textContent = 'Reiniciando...';
        btnInstall.classList.add('hidden');
    } else if (hasUpd) {
        title.textContent = `Nova Release: v${st.latestVersion}`;
        const sizeLabel = st.assetSize ? ` (${formatBytesMb(st.assetSize)})` : '';
        desc.textContent = st.isGitRepo
            ? 'Ambiente Git (.git) detectado. Use git pull ou abra a Release no GitHub.'
            : `Versão v${st.latestVersion} pronta para instalar${sizeLabel}.`;
        progWrap.classList.add('hidden');
        btnInstall.classList.toggle('hidden', Boolean(st.isGitRepo) || !st.assetName);
        btnInstall.disabled = false;
        if (st.latestVersion && st.latestVersion !== lastNotifiedUpdateVersion) {
            lastNotifiedUpdateVersion = st.latestVersion;
            showToast({
                kind: 'ok',
                title: `Nova versão: v${st.latestVersion}`,
                text: 'Clique em Atualizar agora na faixa do topo. Suas contas ficam preservadas.',
            });
        }
    } else if (st.status === 'error') {
        title.textContent = 'Erro na atualização';
        desc.textContent = st.error || 'Não foi possível consultar o GitHub agora.';
        progWrap.classList.add('hidden');
        btnInstall.classList.add('hidden');
    } else {
        title.textContent = 'Tudo atualizado';
        desc.textContent = st.checkedAt
            ? `Você já está na última Release (v${curVer}).`
            : 'Clique em Verificar para buscar novas Releases no GitHub.';
        progWrap.classList.add('hidden');
        btnInstall.classList.add('hidden');
    }

    if (hasUpd && st.releaseNotes) {
        notesEl.textContent = st.releaseNotes.slice(0, 900);
        notesEl.classList.remove('hidden');
    } else {
        notesEl.classList.add('hidden');
    }
}

function renderAll() {
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
        $('pixKey').textContent = pixKey;
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
                $('pixStatus').textContent = 'Chave Pix copiada ✓';
            } catch {
                $('pixStatus').textContent = 'Selecione a chave para copiar.';
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
            if (st.hasUpdate) writeUpdateSnooze(st.latestVersion);
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
        btn.addEventListener('click', () => selectAccount(Number(btn.dataset.acc)));
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
    $('btnOpenVote')?.addEventListener('click', () => sendAction('open-vote-embedded'));
    $('btnOpenVoteExt')?.addEventListener('click', () => sendAction('open-vote'));
    $('btnRefreshVote')?.addEventListener('click', () => sendAction('refresh-vote'));
    $('btnOpenLives').addEventListener('click', () => sendAction('open-lives'));
    $('chatReminder').addEventListener('change', event => {
        clearInterval(chatReminderTimer);
        const note = $('chatReminderNote');
        note.textContent = event.target.checked ? 'Próximo lembrete em 20 minutos.' : '';
        if (event.target.checked) chatReminderTimer = setInterval(() => {
            note.textContent = 'Hora de visitar o chat. Escolha um canal ao vivo.';
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
        $('importLiveStatus').textContent = '';
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
            $('importLiveStatus').textContent = res?.error || 'Tokens inválidos.';
        }
    });

    // Inline import session
    $('btnImportSessToggle').addEventListener('click', () => {
        $('importSessBox').classList.toggle('hidden');
        $('importSessStatus').textContent = '';
    });
    $('btnImportSessCancel').addEventListener('click', () => $('importSessBox').classList.add('hidden'));
    $('btnImportSessSubmit').addEventListener('click', async () => {
        const raw = $('importSessInput').value.trim();
        const res = await sendAction('import-session', { raw });
        if (res?.ok) {
            $('importSessInput').value = '';
            $('importSessBox').classList.add('hidden');
        } else {
            $('importSessStatus').textContent = res?.error || 'Sessão inválida.';
        }
    });

    // Per-slot browser actions
    document.querySelectorAll('[data-slot-act]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const acc = Number(btn.dataset.slot);
            const act = btn.dataset.slotAct;
            if (act === 'mute') {
                setAccountMuted(acc, !isAccountMuted(acc));
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
    huntCountdownTimer = setInterval(() => {
        if (!document.hidden) {
            refreshHuntAndCenterButtons();
        }
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
