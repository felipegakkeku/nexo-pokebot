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
let viewMode = 'split'; // 'split' | 'grid' | 'panel-only'
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
let toastsEnabled = (() => {
    try {
        return localStorage.getItem('nexo_toast_enabled') !== '0';
    } catch {
        return true;
    }
})();
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
    wv.addEventListener('dom-ready', async () => {
        try { wv.setAudioMuted(true); } catch { /* ignore */ }
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

    wv.addEventListener('ipc-message', (ev) => {
        if (ev.channel === 'pb-ws-frame' && typeof ev.args?.[0] === 'string') {
            window.pokeHub.sendWsFrame(acc, ev.args[0]);
        } else if (ev.channel === 'pb-session' && ev.args?.[0]) {
            window.pokeHub.syncWebviewSession(acc, ev.args[0]);
        } else if (ev.channel === 'pb-game-eco') {
            showToast({
                kind: 'ok',
                title: `Modo Economia do jogo · Conta ${acc}`,
                text: 'Canvas em 0% GPU com captura automática e detecção de Shiny 100% preservadas.',
                account: acc,
            });
        }
    });

    wv.src = GAME_URL;
    webviews.set(acc, wv);
    if (ph) ph.hidden = true;
    body.appendChild(wv);
    await pollSnapshots();
}

async function closeEmbeddedForAccount(acc, { startHeadless = false } = {}) {
    const wv = webviews.get(acc);
    if (wv) {
        webviews.delete(acc);
        try { wv.src = 'about:blank'; } catch { /* ignore */ }
        try { wv.remove(); } catch { /* ignore */ }
    }
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

async function closeAllEmbeddedToHeadless() {
    const openAccs = [...webviews.keys()];
    for (const acc of openAccs) {
        const snap = snapshots[acc];
        const hasSession = Boolean(snap?.session?.nick || (snap?.trainer?.nick && snap.trainer.nick !== '-'));
        await closeEmbeddedForAccount(acc, { startHeadless: hasSession });
    }
    setViewMode('panel-only', { skipAutoClose: true });
    if (openAccs.length > 0) {
        showToast({
            kind: 'ok',
            title: 'Modo Eco (Headless)',
            text: 'Navegador fechado (~90% menos RAM e 0% GPU). Captura, detecção de Shiny, lives e /hunt continuam 100% ativos.',
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

function setViewMode(mode, { skipAutoClose = false } = {}) {
    viewMode = mode;
    const ws = $('workspace');
    ws.classList.remove('mode-split', 'mode-grid', 'mode-panel-only');
    ws.classList.add(`mode-${mode}`);
    document.querySelectorAll('.seg-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.view === mode);
    });
    if (mode === 'panel-only' && !skipAutoClose && webviews.size > 0) {
        void closeAllEmbeddedToHeadless();
    }
}

function setSubtab(tab) {
    document.querySelectorAll('.subtab').forEach((b) => {
        b.classList.toggle('active', b.dataset.subtab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
        p.classList.toggle('hidden', p.id !== `tab-${tab}`);
    });
    renderActiveAccountPanel();
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

function formatBonusLine(label, obj) {
    const b = obj || {};
    return `${label}: XP ${formatBonusMins(b.xp)} · Cap ${formatBonusMins(b.captura)} · Shiny ${formatBonusMins(b.shiny)}`;
}

async function saveConfig() {
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
        liveSmartBalance: $('cLiveSmart').checked,
        liveTargetHours: Number($('cLiveTargetHours').value) || 24,
        economyMode: $('cEconomy').checked ? 'on' : 'auto',
        economyPingOnly: $('cEconomyPingOnly').checked,
        standbyOn4001: $('cStandby').checked,
        preferredBall: $('cBall').value,
        shinyBall: $('cShinyBall').value,
        targetBalls: Number($('cTargetBalls').value) || 50,
        targetPotions: Math.max(0, Number($('cTargetPotions').value) || 0),
        preferredPotionIds: readCheckedPotions(),
        restockPotionId: Number($('cRestockPotion').value) || 0,
        targetRevives,
        restockRevive: targetRevives > 0,
        minGoldReserve: Math.max(0, Number($('cReserve').value) || 0),
        huntGuideMode: $('cGuideMode').value,
        huntGuideMetric: $('cGuideMetric').value,
        liveRewardType: fallbackKind,
        liveTwitchRewards,
        liveKickRewards,
        liveRewardTier: $('cLiveTier').value,
        liveMaxTwitchSlots: Number($('cLiveMaxTw').value) || 4,
        liveMaxKickSlots: Number($('cLiveMaxKk').value) || 2,
        liveCustomTwitch: $('cLiveCustomTw').value.trim(),
        liveCustomKick: $('cLiveCustomKk').value.trim(),
    };
    setConfigDirty(false);
    const res = await sendAction('set-config', { config });
    const activeWv = webviews.get(activeAccount);
    if (activeWv) {
        activeWv.executeJavaScript(`window.__pbSetNeedCampoFeed && window.__pbSetNeedCampoFeed(${JSON.stringify(Boolean(config.caidosEnabled))})`).catch(() => {});
    }
    if (res?.ok) {
        $('cfgHint').textContent = 'Alterações salvas';
    }
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
                    text: 'Captura automática e detecção de Shiny restauradas.',
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

    const items = [];
    if (pingOnly) {
        items.push({
            cls: 'danger',
            title: 'Limitação ativa: Modo Somente Ping',
            detail: 'Pausa captura automática, detecção de Shiny, restock, passe diário, prey e /hunt (mantém só keepalive e lives).',
        });
    } else {
        if (!caidosOn) {
            items.push({
                cls: 'warn',
                title: 'Limitação ativa: Captura automática desligada',
                detail: 'O bot não vai lançar Pokébolas em Pokémon caídos nem em Shinies.',
            });
        }
        if (serverEco) {
            items.push({
                cls: 'warn',
                title: 'Limitação ativa: Economia do servidor (sem detecção prévia de Shiny)',
                detail: 'No Headless, o servidor corta o feed de campo. O bot tenta capturar pelo fallback de batalha, mas não identifica Shiny antes de jogar a bola. Deixe desmarcado para manter 0% GPU + captura 100% garantida + Shiny.',
            });
        }
    }

    if (items.length === 0) {
        items.push({
            cls: 'ok',
            title: 'Modo completo: captura e detecção de Shiny garantidas',
            detail: `Captura em caídos ativa com detecção de Shiny antes da Pokébola (inclusive no Modo Eco Headless e no Modo Economia visual do jogo com 0% GPU)${livesOn ? (smartOn ? ' · Gestor Inteligente de Buffs ligado.' : ' · Lives ligadas.') : '.'}`,
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
            toggleBtn.className = isEmbedded ? 'btn sm primary' : 'btn sm teal';
        }

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
                    : 'Clique em "Abrir jogo embutido" para jogar/logar aqui dentro ou "Iniciar Headless" para farmar em 2º plano.';
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
        `Nv ${t.level || 0} · ${fmtNum(t.gold)} gold · ${fmtUptime(st.uptimeSec)} · ${st.pongs || 0} pings${errText}`;

    const btnEmb = $('btnToggleEmbedded');
    btnEmb.textContent = isEmbedded ? 'Fechar Embutido (Ir Headless)' : 'Abrir no Embutido';

    renderModeWarningsBanner(data);

    // Active Pokemon & Hunt
    const pk = data.activePokemon;
    $('pokeName').textContent = pk ? `${pk.shiny ? '★ ' : ''}${pk.name} Nv ${pk.level}` : 'Aguardando Pokémon';
    $('pokeHpTxt').textContent = pk ? `${fmtNum(pk.hp)} / ${fmtNum(pk.maxHp)} HP (${pk.hpPercent}%)` : '0 / 0 HP';
    const pct = pk ? pk.hpPercent : 0;
    const fill = $('pokeHpFill');
    fill.style.width = `${pct}%`;
    fill.style.background = pct > 55 ? '#10b981' : pct > 25 ? '#f59e0b' : '#ef4444';

    const spKey = pk ? `${activeAccount}:${pk.speciesId}:${pk.shiny ? 1 : 0}` : '';
    if (spKey !== lastSpriteKey) {
        lastSpriteKey = spKey;
        const box = $('pokeSprite');
        if (pk && pk.speciesId > 0) {
            const seg = pk.shiny ? 'shiny/' : '';
            const img = document.createElement('img');
            img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${seg}${pk.speciesId}.png`;
            img.alt = '';
            img.addEventListener('error', () => img.remove());
            box.replaceChildren(img);
        } else {
            box.textContent = '?';
        }
    }

    $('huntLine').textContent = `Hunt atual: ${t.huntName || '-'}${t.noCentro ? ' (Centro)' : ''} · Economia ${t.economyActive ? 'ativa' : 'inativa'}`;
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
    renderVoteBar(data);

    // KPIs e Eficiência
    $('kKills').textContent = fmtNum(st.kills);
    $('kKillsSub').textContent = `${st.killsPerMin || 0}/min`;
    $('kXp').textContent = fmtNum(st.xpGained);
    $('kXpSub').textContent = `${fmtNum(st.xpPerHour)}/h · Tr ${fmtNum(st.xpTrainerPerHour)}/h`;
    const netGold = st.netGold ?? st.goldGained ?? 0;
    const netPerH = st.netGoldPerHour ?? st.goldPerHour ?? 0;
    $('kGold').textContent = `${netGold >= 0 ? '' : '-'}${fmtNum(Math.abs(netGold))}`;
    $('kGoldSub').textContent = `${netPerH >= 0 ? '+' : '-'}${fmtNum(Math.abs(netPerH))}/h líq.`;
    $('kCaps').textContent = fmtNum(st.captures);
    $('kCapsSub').textContent = `${st.shiniesCaptured || 0} shinies · ${fmtNum(st.ballsThrown)} bolas`;

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
    $('eSurv').textContent = `${fmtNum(st.heals || 0)} poç · ${fmtNum(st.revivesUsed || 0)} rev`;
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
        $('cLiveSmart').checked = cfg.liveSmartBalance !== false;
        $('cLiveTargetHours').value = String(cfg.liveTargetHours ?? 24);
        $('cEconomy').checked = cfg.economyMode === 'on';
        $('cEconomyPingOnly').checked = Boolean(cfg.economyPingOnly);
        $('cStandby').checked = Boolean(cfg.standbyOn4001);
        $('cBall').value = cfg.preferredBall || 'auto';
        $('cShinyBall').value = cfg.shinyBall || 'best';
        $('cTargetBalls').value = cfg.targetBalls ?? 50;
        $('cTargetPotions').value = cfg.targetPotions ?? 40;
        $('cRestockPotion').value = String(cfg.restockPotionId || 0);
        $('cTargetRevives').value = cfg.restockRevive === false ? 0 : (cfg.targetRevives ?? 20);
        $('cReserve').value = cfg.minGoldReserve ?? 0;
        $('cGuideMode').value = cfg.huntGuideMode || 'off';
        $('cGuideMetric').value = cfg.huntGuideMetric || 'xp';
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

function renderLives(lv) {
    const twSummary = (lv.twitchRewards || [lv.rewardType || 'xp']).join('+').toUpperCase() || 'OFF';
    const kkSummary = (lv.kickRewards || [lv.rewardType || 'xp']).join('+').toUpperCase() || 'OFF';
    $('liveMinutes').textContent = fmtNum(lv.minutesWatched || 0);
    $('liveChests').textContent = fmtNum(lv.chestsClaimed || 0);
    $('liveRedeemed').textContent = fmtNum(lv.rewardsRedeemed || 0);
    $('livesHead').textContent = lv.enabled ? `Coleta ativa · Twitch ${twSummary} · Kick ${kkSummary}` : 'Coleta desativada';
    $('livesBonuses').textContent = `${formatBonusLine('TW', lv.activeBonuses?.twitch)}  |  ${formatBonusLine('KK', lv.activeBonuses?.kick)}`;
    const fmtSmart = (label, st) => {
        if (!st) return '';
        if (st.allReached) return `${label}: todos >= ${formatBonusMins(st.targetMin)} ✓`;
        return `${label}: próx. ${String(st.nextKind || '').toUpperCase()} (${formatBonusMins(st.nextMin)}/${formatBonusMins(st.targetMin)})`;
    };
    $('livesSmartLine').textContent = lv.smartBalance
        ? `Gestor Inteligente (meta ${lv.targetHours || 24}h): ${fmtSmart('TW', lv.smartStatus?.twitch)}  |  ${fmtSmart('KK', lv.smartStatus?.kick)}`
        : 'Gestor Inteligente: desligado (resgata apenas quando faltar <= 30m)';

    // Lista de lives com seletor individual de buff por canal
    const chanListEl = $('liveChannelList');
    const channels = Array.isArray(lv.channels) ? lv.channels : [];
    const channelNotes = channels.map(ch => {
        const status = lv[ch.platform]?.[ch.channel];
        return status?.manualChest ? 'Caixinha +50 disponível: clique em Resgatar +50' : status?.error;
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
            const error = channelNotes[index];
            if (error) {
                const note = document.createElement('small');
                note.className = 'channel-warning';
                note.textContent = error;
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
            const name = document.createElement('strong');
            name.textContent = entry.name;
            item.append(name, ` · ${entry.trainer} · ${entry.egg ? 'Ovo' : 'Captura'} · ${new Date(entry.ts).toLocaleTimeString('pt-BR')}`);
            list.append(item);
        }
        if (!feed.length) list.textContent = 'Aguardando o próximo anúncio do servidor. O histórico começa quando a conta se conecta.';
    }
    // Logs (so atualiza DOM quando houver linha nova)
    const logs = data.logs || [];
    const lastLog = logs[logs.length - 1];
    const logSig = `${activeAccount}:${logs.length}:${lastLog?.time || ''}:${lastLog?.text || ''}`;
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

function pokemonSpriteUrl(speciesId, shiny = true) {
    const id = Number(speciesId);
    if (!Number.isInteger(id) || id <= 0) return '';
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${shiny ? 'shiny/' : ''}${id}.png`;
}

function labelPokemonDetail(key) {
    if (POKEMON_DETAIL_LABELS[key]) return POKEMON_DETAIL_LABELS[key];
    const spaced = String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function buildToastCard(card) {
    const wrap = document.createElement('div');
    wrap.className = 'toast-card';
    const art = document.createElement('div');
    art.className = 'toast-card-art';
    if (card.sprite) {
        const img = document.createElement('img');
        img.src = card.sprite;
        img.alt = '';
        img.addEventListener('error', () => {
            img.remove();
            art.prepend('★');
        });
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

function showToast({
    kind = 'info', title = 'Nexo PokeBot', text = '', account = null, onClick = null,
    actionLabel = '', card = null, duration = 0,
} = {}) {
    if (!toastsEnabled || (!text && !card)) return;
    const stack = $('toastStack');
    if (!stack) return;
    const now = Date.now();
    const dedupeKey = `${account || 0}|${kind}|${text}|${card?.name || ''}`;
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

    const item = document.createElement('div');
    item.className = `toast-item ${kind}${card ? ' has-card' : ''}${onClick ? ' actionable' : ''}`;
    item.setAttribute('role', kind === 'error' ? 'alert' : 'status');

    const icon = document.createElement('div');
    icon.className = 'toast-icon';
    icon.textContent = TOAST_ICONS[kind] || TOAST_ICONS.info;

    const main = document.createElement('div');
    main.className = 'toast-main';
    const head = document.createElement('div');
    head.className = 'toast-head';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'toast-title';
    titleSpan.textContent = title;
    const timeSpan = document.createElement('span');
    timeSpan.className = 'toast-time';
    timeSpan.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    head.append(titleSpan, timeSpan);
    main.append(head);
    if (card) main.append(buildToastCard(card));
    if (text) {
        const body = document.createElement('div');
        body.className = 'toast-body';
        body.textContent = text;
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

    const life = duration || (card ? 15_000 : (kind === 'shiny' || onClick ? 8_000 : 5_000));
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
        if (account && ACCOUNTS.includes(account)) {
            selectAccount(account);
        }
        if (typeof onClick === 'function') {
            try { onClick(); } catch { /* ignore */ }
        }
        dismiss();
    });
    stack.appendChild(item);
    arm();
}

function isToastWorthyLog(entry) {
    if (!entry || !entry.text) return false;
    const k = String(entry.kind || '');
    const txt = String(entry.text || '');
    if (k === 'shiny' || k === 'reward' || k === 'error') return true;
    if (k === 'warn') return /sess[aã]o|combate|falha|desconect|expir|erro|morreu|morte|cancelad|limita|shiny|captura|somente ping|feed de campo/i.test(txt);
    if (k === 'ok') return /troca de hunt|centro m[eé]dico|equipe curada|conectad|cookies|sincronizad|salva/i.test(txt);
    if (k === 'info') return /\/hunt recomenda|troca .* agendada|indo para o centro/i.test(txt);
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
        const base = toastBaselineByAcc[acc];
        if (!base) {
            const initChests = new Set(
                Object.entries(snap.lives?.twitch || {})
                    .filter(([, st]) => st?.manualChest)
                    .map(([ch]) => ch)
            );
            toastBaselineByAcc[acc] = {
                lastSig: logs.length > 0 ? sigOf(logs[logs.length - 1]) : '',
                lastDropSig: snap.drops?.recent?.[0] ? `${snap.drops.recent[0].time}|${snap.drops.recent[0].name}|${snap.drops.recent[0].qty}` : '',
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
                    if (hasShinyCards && entry.kind === 'shiny' && /^Capturado SHINY/i.test(entry.text || '')) continue;
                    if (isToastWorthyLog(entry)) {
                        showToast({ kind: entry.kind || 'info', title: accLabel, text: entry.text, account: acc });
                    }
                }
                base.lastSig = sigOf(logs[logs.length - 1]);
            }
            const curChests = new Set(
                Object.entries(snap.lives?.twitch || {})
                    .filter(([, st]) => st?.manualChest)
                    .map(([ch]) => ch)
            );
            for (const ch of curChests) {
                if (!base.manualChests?.has(ch)) {
                    showToast({
                        kind: 'reward',
                        title: `Caixinha +50 · ${accLabel}`,
                        text: `Disponível em ${ch}. O bot resgata sozinho em instantes.`,
                        account: acc,
                        actionLabel: 'Resgatar agora',
                        onClick: () => void claimTwitchChest(ch, acc),
                    });
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
                    onClick: () => void sendAction('open-vote-embedded', {}, acc),
                });
            }
            base.voteReady = voteReadyNow;
            const topDrop = snap.drops?.recent?.[0];
            if (topDrop && topDrop.rare) {
                const dropSig = `${topDrop.time}|${topDrop.name}|${topDrop.qty}`;
                if (dropSig !== base.lastDropSig) {
                    base.lastDropSig = dropSig;
                    showToast({
                        kind: 'reward',
                        title: `Drop raro · ${accLabel}`,
                        text: `${topDrop.name} x${topDrop.qty || 1}`,
                        account: acc,
                    });
                }
            }
        }

        if (base) {
            const fresh = (Array.isArray(snap.ownShinies) ? snap.ownShinies : [])
                .filter((sh) => Number(sh?.ts || 0) > base.lastOwnShinyTs)
                .reverse();
            for (const sh of fresh) {
                showToast({
                    kind: 'shiny',
                    title: `Shiny capturado · ${accLabel}`,
                    account: acc,
                    card: {
                        sprite: pokemonSpriteUrl(sh.speciesId, true),
                        name: sh.name,
                        level: sh.level,
                        subtitle: [sh.hunt ? `Hunt ${sh.hunt}` : '', sh.speciesId ? `#${sh.speciesId}` : ''].filter(Boolean).join(' · '),
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
            showToast({
                kind: 'shiny',
                title: 'Shiny no servidor',
                duration: 9_000,
                card: {
                    sprite: pokemonSpriteUrl(newestShiny.speciesId, true),
                    name: newestShiny.name,
                    subtitle: `${newestShiny.egg ? 'Chocado de ovo' : 'Capturado'} por ${newestShiny.trainer}`,
                },
            });
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

function renderUpdateUi(st) {
    if (!st) return;
    currentUpdateState = st;
    const btn = $('btnUpdateToggle');
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

    const curVer = st.currentVersion || '1.0.5';
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
        btn.textContent = `⬇ v${(st.latestVersion || '').replace(/\.0$/, '')}`;
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
                text: 'Clique em Atualizar no topo para baixar sem perder suas contas.',
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
    renderTopTabsAndSlots();
    renderActiveAccountPanel();
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

    const toastChk = $('cToastEnabled');
    if (toastChk) {
        toastChk.checked = toastsEnabled;
        toastChk.addEventListener('change', () => {
            toastsEnabled = toastChk.checked;
            try {
                localStorage.setItem('nexo_toast_enabled', toastsEnabled ? '1' : '0');
            } catch {
                // ignora storage bloqueado
            }
        });
    }
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
            if (viewMode === 'panel-only') setViewMode('split');
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
                text: 'Este modo corta o feed de campo no Headless e impede detectar Shiny antes de jogar a Pokébola (clique em Salvar para aplicar).',
                account: activeAccount,
            });
        } else if (target.id === 'cEconomyPingOnly' && target.checked) {
            showToast({
                kind: 'error',
                title: 'Atenção: Modo Somente Ping',
                text: 'Pausa captura, Shiny, restock, passe, prey e /hunt, mantendo apenas keepalive e lives (clique em Salvar para aplicar).',
                account: activeAccount,
            });
        } else if (target.id === 'cCaidos' && !target.checked) {
            showToast({
                kind: 'warn',
                title: 'Captura automática desmarcada',
                text: 'O bot deixará de jogar Pokébolas em caídos e Shinies ao salvar.',
                account: activeAccount,
            });
        }
    });
    $('cfgFields').addEventListener('change', () => setConfigDirty(true));
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
                const wv = webviews.get(acc);
                if (wv) {
                    try {
                        const nextMuted = !wv.isAudioMuted();
                        wv.setAudioMuted(nextMuted);
                        btn.textContent = nextMuted ? 'Mudo' : 'Som ON';
                    } catch {
                        // ignora antes do dom-ready
                    }
                }
            } else if (act === 'focus') {
                selectAccount(acc);
                setViewMode('split');
            } else if (act === 'reload') {
                webviews.get(acc)?.reload();
            } else if (act === 'open') {
                await openEmbeddedForAccount(acc);
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
