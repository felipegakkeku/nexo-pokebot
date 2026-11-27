'use strict';
// Camada de interface do Hub: carregado depois do renderer.js e usa os globais dele
// (snapshots, activeAccount, viewMode, $ ...). O renderer chama os ganchos via hubHook().
(function () {
    const params = new URLSearchParams(location.search);
    const POPOUT = params.get('popout') || '';
    const IC = (name, cls = '') => (window.nexoIcons ? window.nexoIcons.icon(name, cls) : '');
    const LS = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw == null ? fallback : JSON.parse(raw);
            } catch { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
        },
    };
    const esc = (s) => escapeHtml(s).replace(/"/g, '&quot;');
    const RUNNING = new Set(['connected', 'bridge']);

    // ===== utilitários =====
    function fmtCompact(n) {
        const v = Number(n);
        if (!Number.isFinite(v)) return '0';
        const a = Math.abs(v);
        if (a >= 1e9) return `${(v / 1e9).toFixed(1).replace('.', ',')} bi`;
        if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace('.', ',')} mi`;
        if (a >= 1e4) return `${Math.round(v / 1e3)} mil`;
        return Math.round(v).toLocaleString('pt-BR');
    }
    const signed = (n) => `${Number(n || 0) >= 0 ? '+' : ''}${fmtCompact(n)}`;
    function relTime(ts) {
        const d = Math.max(0, Date.now() - Number(ts || 0));
        if (d < 45_000) return 'agora';
        if (d < 3_600_000) return `há ${Math.round(d / 60_000)} min`;
        if (d < 86_400_000) return `há ${Math.floor(d / 3_600_000)} h`;
        return `há ${Math.floor(d / 86_400_000)} d`;
    }
    const clockOf = (ts) => new Date(Number(ts || 0)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    function nickOf(acc) {
        const s = snapshots[acc];
        if (s?.trainer?.nick && s.trainer.nick !== '-') return s.trainer.nick;
        return s?.session?.nick || `Conta ${acc}`;
    }
    const statusOf = (acc) => snapshots[acc]?.status || 'disconnected';
    const isEmbedded = (acc) => webviews.has(acc);

    // ===== S15: histórico curto para as minicurvas =====
    const HIST_EVERY_MS = 30_000;
    const HIST_MAX = 60;
    const hist = { 1: [], 2: [], 3: [], 4: [] };
    function sampleHistory() {
        const now = Date.now();
        for (const acc of ACCOUNTS) {
            const st = snapshots[acc]?.stats;
            if (!st) continue;
            const list = hist[acc];
            const last = list[list.length - 1];
            if (last && now - last.t < HIST_EVERY_MS) continue;
            const xp = Number(st.xpGained || 0);
            const gold = Number(st.goldGained || 0) - Number(st.spentGold || 0);
            const kills = Number(st.kills || 0);
            const captures = Number(st.captures || 0);
            if (last && (xp < last.xp || kills < last.kills || captures < last.captures)) list.length = 0; // sessão zerada
            const prev = list[list.length - 1];
            const h = prev ? (now - prev.t) / 3_600_000 : 0;
            const dKills = prev ? kills - prev.kills : 0;
            const dCaps = prev ? captures - prev.captures : 0;
            const capPerKill = dKills > 0
                ? (dCaps / dKills) * 100
                : (kills > 0 ? Number(st.capturePerKillPct ?? ((captures / kills) * 100)) : 0);
            list.push({
                t: now, xp, gold, kills, captures,
                xpRate: prev && h > 0 ? (xp - prev.xp) / h : Number(st.xpPerHour || 0),
                goldRate: prev && h > 0 ? (gold - prev.gold) / h : Number(st.netGoldPerHour || 0),
                capRate: prev && h > 0 ? dCaps / h : (Number(st.uptimeSec || 0) > 0 ? (captures / (Number(st.uptimeSec) / 3600)) : 0),
                capPerKill,
            });
            if (list.length > HIST_MAX) list.shift();
        }
    }
    function sparkSvg(values, cls = '') {
        const vals = values.filter((v) => Number.isFinite(v));
        if (vals.length < 2) return `<svg class="spark ${cls} empty" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="26" x2="100" y2="26"/></svg>`;
        const min = Math.min(0, ...vals);
        const max = Math.max(...vals);
        const span = max - min || 1;
        const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 100).toFixed(1)},${(26 - ((v - min) / span) * 23).toFixed(1)}`);
        return `<svg class="spark ${cls}" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path class="spark-area" d="M0,28 L${pts.join(' L')} L100,28 Z"/><polyline points="${pts.join(' ')}"/></svg>`;
    }
    function trendOf(acc, key) {
        const list = hist[acc];
        if (list.length < 4) return 0;
        const recent = list.slice(-3).reduce((a, b) => a + b[key], 0) / 3;
        const older = list.slice(-8, -3);
        if (!older.length) return 0;
        const base = older.reduce((a, b) => a + b[key], 0) / older.length;
        if (!base) return 0;
        return (recent - base) / Math.abs(base);
    }
    const trendHtml = (t) => {
        if (Math.abs(t) < 0.08) return '<span class="trend flat" title="Estável">→</span>';
        return t > 0
            ? `<span class="trend up" title="Subindo ${Math.round(t * 100)}% nos últimos minutos">↑</span>`
            : `<span class="trend down" title="Caindo ${Math.round(-t * 100)}% nos últimos minutos">↓</span>`;
    };

    // ===== S15: três números grandes no Desempenho =====
    let lastHeroSig = '';
    function renderHero() {
        const box = $('heroKpis');
        if (!box) return;
        const acc = activeAccount;
        const s = snapshots[acc] || {};
        const st = s.stats || {};
        const list = hist[acc];
        const xpVals = list.map((p) => p.xpRate);
        const goldVals = list.map((p) => p.goldRate);
        const capVals = list.map((p) => p.capPerKill);
        const gold = Number(st.netGoldPerHour || 0);
        const kills = Number(st.kills || 0);
        const caps = Number(st.captures || 0);
        const capPct = kills > 0 ? Number(st.capturePerKillPct ?? ((caps / kills) * 100)) : null;
        const capPctTxt = capPct !== null ? `${String(Number(capPct.toFixed(1))).replace('.', ',')}%` : '-';
        const capPerHour = Number(st.uptimeSec || 0) > 0 ? Math.round(caps / (Number(st.uptimeSec) / 3600)) : 0;
        const kpcTxt = st.killsPerCapture > 0
            ? `1 a cada ${String(st.killsPerCapture).replace('.', ',')} abates`
            : (kills > 0 ? 'sem capturas ainda' : 'aguardando abates');
        const own = Array.isArray(s.ownShinies) ? s.ownShinies.slice(0, 3) : [];
        const missed = Number(st.shiniesMissed || 0);
        const sig = `${acc}|${st.xpPerHour}|${gold}|${caps}|${kills}|${st.capturePerKillPct}|${st.shiniesCaptured}|${st.shiniesSeen}|${missed}|${list.length}|${list[list.length - 1]?.t || 0}|${own.map((o) => o.ts).join(',')}`;
        if (sig === lastHeroSig) return;
        lastHeroSig = sig;
        box.innerHTML = `
          <div class="hero xp" title="XP do Pokémon por hora desde o início da sessão. A curva mostra o ritmo a cada 30 s.">
            <div class="hero-top"><span class="hero-lbl">${IC('zap')}XP por hora</span>${trendHtml(trendOf(acc, 'xpRate'))}</div>
            <div class="hero-val">${fmtCompact(st.xpPerHour)}</div>
            <div class="hero-sub">Treinador ${fmtCompact(st.xpTrainerPerHour)}/h</div>
            ${sparkSvg(xpVals, 'xp')}
          </div>
          <div class="hero gold ${gold < 0 ? 'neg' : 'pos'}" title="Ouro ganho menos o gasto em itens, por hora.">
            <div class="hero-top"><span class="hero-lbl">${IC('coins')}Lucro por hora</span>${trendHtml(trendOf(acc, 'goldRate'))}</div>
            <div class="hero-val">${signed(gold)}</div>
            <div class="hero-sub">Já descontado o gasto em itens</div>
            ${sparkSvg(goldVals, gold < 0 ? 'neg' : 'gold')}
          </div>
          <div class="hero catch" title="Capturas na sessão e taxa de capturas por abate. A curva mostra a variação de capturas por abate a cada 30 s.">
            <div class="hero-top"><span class="hero-lbl">${IC('pokeball')}Capturas</span>${trendHtml(trendOf(acc, 'capPerKill'))}</div>
            <div class="hero-val">${fmtCompact(caps)}<span class="hero-rate-pill" title="Capturas por abate">${capPctTxt} / abate</span></div>
            <div class="hero-sub">${kpcTxt}${capPerHour > 0 ? ` · ${fmtCompact(capPerHour)}/h` : ''}</div>
            ${sparkSvg(capVals, 'catch')}
          </div>
          <div class="hero shiny${missed ? ' has-miss' : ''}" title="Shinies capturados e vistos nesta sessão.">
            <div class="hero-top"><span class="hero-lbl">${IC('sparkles')}Shinies</span></div>
            <div class="hero-val">${Number(st.shiniesCaptured || 0)}<small> / ${Number(st.shiniesSeen || 0)} vistos</small></div>
            <div class="hero-sprites">${own.length
                ? own.map((o) => {
                    const dex = resolvePokemonSpriteDex(o.speciesId, o.name, o.spriteDex);
                    const url = pokemonSpriteUrl(o.speciesId, true, dex, o.name);
                    return url ? `<img src="${url}" data-sprite-dex="${dex}" data-sprite-shiny="1" alt="${esc(o.name)}" title="${esc(o.name)} · ${relTime(o.ts)}" loading="lazy" />` : '';
                }).join('')
                : '<span class="hero-sub">Nenhum capturado ainda</span>'}${missed ? `<span class="miss-tag" title="Vistos e não capturados">${missed} escap${missed > 1 ? 'aram' : 'ou'}</span>` : ''}</div>
          </div>`;
    }

    // ===== S1 e S9: abas compactas e bordas de estado =====
    const shinySeenByAcc = {};
    const flashUntil = {};
    function updateShinyFlash() {
        const now = Date.now();
        for (const acc of ACCOUNTS) {
            const seen = Number(snapshots[acc]?.stats?.shiniesSeen || 0);
            const prev = shinySeenByAcc[acc];
            shinySeenByAcc[acc] = seen;
            if (prev != null && seen > prev) flashUntil[acc] = now + 8000;
        }
    }
    function stateClass(acc) {
        const st = statusOf(acc);
        if (st === 'error') return 'st-error';
        if (st === 'paused' || st === 'standby') return 'st-paused';
        const warns = snapshots[acc]?.modeWarnings || [];
        if (warns.some((w) => w.severity === 'danger')) return 'st-error';
        if (warns.length) return 'st-warn';
        if (RUNNING.has(st)) return 'st-ok';
        if (st === 'connecting') return 'st-busy';
        return 'st-idle';
    }
    const STATE_CLASSES = ['st-error', 'st-paused', 'st-warn', 'st-ok', 'st-busy', 'st-idle'];
    function setStateClass(el, cls, flash) {
        if (!el) return;
        for (const c of STATE_CLASSES) el.classList.toggle(c, c === cls);
        el.classList.toggle('flash-shiny', Boolean(flash));
    }
    function renderTabs() {
        const now = Date.now();
        for (const acc of ACCOUNTS) {
            const s = snapshots[acc] || {};
            const tab = document.querySelector(`.acc-tab[data-acc="${acc}"]`);
            const flash = (flashUntil[acc] || 0) > now;
            const cls = stateClass(acc);
            setStateClass(tab, cls, flash);
            setStateClass($(`wv-slot-${acc}`), cls, flash);
            setStateClass(document.querySelector(`.pcard[data-acc="${acc}"]`), cls, flash);
            if (!tab) continue;
            const img = $(`tabSprite-${acc}`);
            const poke = s.activePokemon;
            if (img) {
                setPokemonSpriteImg(img, poke?.speciesId, poke?.shiny, poke?.spriteDex, poke?.name);
            }
            const st = s.stats || {};
            const hunt = s.trainer?.huntName && s.trainer.huntName !== '-' ? s.trainer.huntName : '';
            const lines = [
                `Conta ${acc} · ${nickOf(acc)} (tecla ${acc})`,
                [STATUS_LABELS[statusOf(acc)] || statusOf(acc), hunt].filter(Boolean).join(' · '),
            ];
            if (RUNNING.has(statusOf(acc))) lines.push(`${fmtCompact(st.xpPerHour)} XP/h · ${signed(st.netGoldPerHour)} ouro/h · ${Number(st.shiniesCaptured || 0)} shiny`);
            if (poke) lines.push(`${poke.name} Nv ${poke.level} · ${poke.hpPercent}% HP`);
            const title = lines.join('\n');
            if (tab.title !== title) {
                tab.title = title;
                tab.setAttribute('aria-label', lines.slice(0, 2).join(', '));
            }
        }
    }

    // ===== S7: painel vivo no lugar do aviso de Headless =====
    // O que entra em "Últimos eventos": a pessoa escolhe (fica salvo).
    const EV_FILTERS = [
        { id: 'catch', label: 'Capturas', kinds: ['catch'] },
        { id: 'shiny', label: 'Shiny', kinds: ['shiny', 'shiny-miss'] },
        { id: 'reward', label: 'Drops e bônus', kinds: ['reward'] },
        { id: 'farm', label: 'Hunt e loja', kinds: ['hunt', 'shop', 'prey'] },
        { id: 'live', label: 'Lives', kinds: ['live'] },
        { id: 'alert', label: 'Avisos', kinds: ['warn', 'error'] },
    ];
    let evFilter = LS.get('nexo.stageEvFilter', ['catch', 'shiny', 'reward', 'alert']);
    if (!Array.isArray(evFilter)) evFilter = ['catch', 'shiny', 'reward', 'alert'];
    let stagePrefs = LS.get('nexo.stagePrefs', { hidden: [], swapped: false, stacked: false });
    if (!stagePrefs || typeof stagePrefs !== 'object') stagePrefs = { hidden: [], swapped: false, stacked: false };
    if (!Array.isArray(stagePrefs.hidden)) stagePrefs.hidden = [];
    const STAGE_SEC_LABELS = [
        ['poke', 'Pokémon'],
        ['kpis', 'KPIs'],
        ['events', 'Eventos'],
        ['buffs', 'Buffs'],
        ['drops', 'Drops'],
    ];
    const STAGE_HTML = `
      <div class="sl-custom-bar">
        <span class="sl-cb-lbl">Exibir:</span>
        ${STAGE_SEC_LABELS.map(([id, lbl]) => `<button type="button" class="sl-cb-btn" data-sl-vis="${id}" aria-pressed="true">${lbl}</button>`).join('')}
        <button type="button" class="sl-cb-btn" data-sl-opt="swap" aria-pressed="false" title="Inverte Eventos e Buffs/Drops de lado">Inverter</button>
        <button type="button" class="sl-cb-btn" data-sl-opt="stack" aria-pressed="false" title="Alterna entre 2 colunas ou 1 coluna">1 coluna</button>
      </div>
      <div class="sl-hero">
        <div class="sl-poke">
          <div class="sl-ring"><img class="sl-sprite" alt="" /></div>
          <div class="sl-poke-name"></div>
          <div class="sl-poke-hp"></div>
        </div>
        <div class="sl-main">
          <div class="sl-title"><span class="acc-dot"></span><span class="sl-pill"></span></div>
          <div class="sl-hunt"></div>
          <div class="sl-kpis">
            <div class="sl-kpi xp"><span>${IC('zap')}XP/h</span><b data-k="xp"></b><i data-k="xpSpark"></i></div>
            <div class="sl-kpi gold"><span>${IC('coins')}Lucro/h</span><b data-k="gold"></b><i data-k="goldSpark"></i></div>
            <div class="sl-kpi catch"><span>${IC('pokeball')}Capturas</span><b data-k="captures"></b><small data-k="capturesSub"></small><i data-k="capSpark"></i></div>
            <div class="sl-kpi kills"><span>${IC('swords')}Abates</span><b data-k="kills"></b><small data-k="killsSub"></small></div>
            <div class="sl-kpi shiny"><span>${IC('sparkles')}Shinies</span><b data-k="shiny"></b><small data-k="shinySub"></small></div>
          </div>
          <div class="sl-meta-strip" data-k="metaStrip"></div>
        </div>
      </div>
      <div class="sl-bottom">
        <div class="sl-col">
          <div class="sl-ev-head"><h4>${IC('activity')}Últimos eventos</h4><div class="sl-ev-filter" role="group" aria-label="O que aparece aqui">${EV_FILTERS.map((f) => `<button type="button" data-ev-f="${f.id}" aria-pressed="false">${f.label}</button>`).join('')}<button type="button" class="ev-size" data-ev-size title="Altura do card (clique para alternar)"></button></div></div>
          <ul class="sl-events"></ul>
        </div>
        <div class="sl-col sl-side">
          <div class="sl-ev-head"><h4>${IC('tv')}Buffs das lives</h4><div class="bview-seg" role="radiogroup" aria-label="Como mostrar os buffs"><button type="button" data-bview-pick="flat" role="radio">Flat</button><button type="button" data-bview-pick="detalhe" role="radio">Detalhado</button></div></div>
          <div class="sl-buffs"></div>
          <h4>${IC('package')}Drops da sessão</h4>
          <div class="sl-drops"></div>
        </div>
      </div>`;
    // Flat ou detalhado: a mesma escolha vale para Visão geral, aba Lives e tela grande.
    let buffView = LS.get('nexo.buffView', 'flat') === 'detalhe' ? 'detalhe' : 'flat';
    document.documentElement.dataset.buffView = buffView;
    document.addEventListener('click', (ev) => {
        const b = ev.target.closest?.('[data-bview-pick]');
        if (!b) return;
        buffView = b.dataset.bviewPick === 'detalhe' ? 'detalhe' : 'flat';
        LS.set('nexo.buffView', buffView);
        document.documentElement.dataset.buffView = buffView;
        syncBuffViewButtons();
        renderOverviewExtras();
        for (const acc of ACCOUNTS) renderStageLive(acc);
    });
    function syncBuffViewButtons(scope = document) {
        scope.querySelectorAll('[data-bview-pick]').forEach((b) => b.setAttribute('aria-checked', b.dataset.bviewPick === buffView ? 'true' : 'false'));
    }
    const MISS_BALL_LABELS = { 1: 'Poke Ball', 2: 'Great Ball', 3: 'Super Ball', 4: 'Ultra Ball', 5: 'Beast Ball' };
    function recentEvents(acc, n) {
        const logs = snapshots[acc]?.logs || [];
        const kinds = new Set(EV_FILTERS.filter((f) => evFilter.includes(f.id)).flatMap((f) => f.kinds));
        const out = [];
        for (let i = logs.length - 1; i >= 0 && out.length < n; i--) {
            if (kinds.has(classifyLogEntry(logs[i]).vKind)) out.push(logs[i]);
        }
        return out;
    }
    // Altura do card: auto (preenche) / compacto / médio / alto. Fica salvo.
    const EV_SIZES = [['auto', 'Altura: auto'], ['s', 'Altura: baixa'], ['m', 'Altura: média'], ['l', 'Altura: alta']];
    let evSize = LS.get('nexo.stageEvSize', 'auto');
    if (!EV_SIZES.some((x) => x[0] === evSize)) evSize = 'auto';
    function applyEvSize() {
        document.documentElement.dataset.evHeight = evSize;
        const label = EV_SIZES.find((x) => x[0] === evSize)[1];
        document.querySelectorAll('button[data-ev-size]').forEach((b) => { b.textContent = label; });
    }
    applyEvSize();
    document.addEventListener('click', (ev) => {
        if (!ev.target.closest?.('button[data-ev-size]')) return;
        evSize = EV_SIZES[(EV_SIZES.findIndex((x) => x[0] === evSize) + 1) % EV_SIZES.length][0];
        LS.set('nexo.stageEvSize', evSize);
        applyEvSize();
    });
    document.addEventListener('click', (ev) => {
        const slVis = ev.target.closest?.('[data-sl-vis]');
        if (slVis) {
            const k = slVis.dataset.slVis;
            stagePrefs.hidden = stagePrefs.hidden.includes(k)
                ? stagePrefs.hidden.filter((x) => x !== k)
                : [...stagePrefs.hidden, k];
            LS.set('nexo.stagePrefs', stagePrefs);
            for (const acc of ACCOUNTS) applyStagePrefs(acc);
            return;
        }
        const slOpt = ev.target.closest?.('[data-sl-opt]');
        if (slOpt) {
            if (slOpt.dataset.slOpt === 'swap') stagePrefs.swapped = !stagePrefs.swapped;
            else if (slOpt.dataset.slOpt === 'stack') stagePrefs.stacked = !stagePrefs.stacked;
            LS.set('nexo.stagePrefs', stagePrefs);
            for (const acc of ACCOUNTS) applyStagePrefs(acc);
            return;
        }
        const b = ev.target.closest?.('[data-ev-f]');
        if (!b) return;
        const id = b.dataset.evF;
        evFilter = evFilter.includes(id) ? evFilter.filter((x) => x !== id) : [...evFilter, id];
        LS.set('nexo.stageEvFilter', evFilter);
        for (const acc of ACCOUNTS) {
            const ul = $(`stageLive-${acc}`)?.querySelector('.sl-events');
            if (ul) ul.dataset.sig = '';
            renderStageLive(acc);
        }
    });
    function applyStagePrefs(acc) {
        const host = $(`stageLive-${acc}`);
        if (!host) return;
        for (const [id] of STAGE_SEC_LABELS) {
            const hidden = stagePrefs.hidden.includes(id);
            host.classList.toggle(`sl-hide-${id}`, hidden);
            const btn = host.querySelector(`[data-sl-vis="${id}"]`);
            if (btn) btn.setAttribute('aria-pressed', hidden ? 'false' : 'true');
        }
        host.classList.toggle('sl-swapped', Boolean(stagePrefs.swapped));
        host.classList.toggle('sl-stacked', Boolean(stagePrefs.stacked));
        const swBtn = host.querySelector('[data-sl-opt="swap"]');
        if (swBtn) swBtn.setAttribute('aria-pressed', stagePrefs.swapped ? 'true' : 'false');
        const stBtn = host.querySelector('[data-sl-opt="stack"]');
        if (stBtn) stBtn.setAttribute('aria-pressed', stagePrefs.stacked ? 'true' : 'false');
    }
    function renderStageLive(acc) {
        const host = $(`stageLive-${acc}`);
        const ph = $(`wv-ph-${acc}`);
        if (!host || !ph) return;
        const s = snapshots[acc] || {};
        const status = statusOf(acc);
        const live = Boolean(s.session) && ['connected', 'paused', 'connecting', 'standby', 'error'].includes(status) && !isEmbedded(acc);
        ph.classList.toggle('has-live', live);
        const hlBtn = ph.querySelector('[data-slot-act="headless"]');
        if (hlBtn) {
            const farming = live && (status === 'connected' || status === 'connecting');
            hlBtn.style.display = farming ? 'none' : '';
            hlBtn.textContent = live && status === 'paused' ? 'Retomar Headless' : 'Iniciar Headless';
        }
        if (!live) return;
        if (!host.dataset.built) {
            host.dataset.built = '1';
            host.innerHTML = STAGE_HTML;
        }
        applyStagePrefs(acc);
        const q = (sel) => host.querySelector(sel);
        const st = s.stats || {};
        const poke = s.activePokemon;
        const hunt = s.trainer?.huntName && s.trainer.huntName !== '-' ? s.trainer.huntName : '';
        q('.acc-dot').className = `acc-dot ${status}`;
        host.querySelectorAll('[data-ev-f]').forEach((b) => b.setAttribute('aria-pressed', evFilter.includes(b.dataset.evF) ? 'true' : 'false'));
        q('.sl-pill').textContent = status === 'connected' ? 'Farmando em Headless' : (STATUS_LABELS[status] || status);
        q('.sl-pill').className = `sl-pill ${status}`;
        q('.sl-hunt').textContent = [hunt ? `Hunt ${hunt}` : 'Sem hunt', s.trainer?.level ? `Nv ${s.trainer.level}` : '', s.trainer?.gold != null ? `${fmtCompact(s.trainer.gold)} gold` : '', s.huntGuide?.note ? `/hunt: ${s.huntGuide.note}` : ''].filter(Boolean).join(' · ');
        const img = q('.sl-sprite');
        setPokemonSpriteImg(img, poke?.speciesId, poke?.shiny, poke?.spriteDex, poke?.name);
        const hp = poke ? Math.max(0, Math.min(100, Number(poke.hpPercent || 0))) : 0;
        q('.sl-ring').style.setProperty('--hp', `${hp}`);
        q('.sl-ring').className = `sl-ring ${hp > 50 ? 'ok' : hp > 20 ? 'mid' : 'low'}`;
        q('.sl-poke-name').textContent = poke ? `${poke.name}${poke.shiny ? ' ★' : ''} · Nv ${poke.level}` : 'Aguardando Pokémon';
        q('.sl-poke-hp').textContent = poke ? `${fmtNum(poke.hp)} / ${fmtNum(poke.maxHp)} HP` : '';
        const set = (k, v) => { const el = host.querySelector(`[data-k="${k}"]`); if (el && el.innerHTML !== v) el.innerHTML = v; };
        const fmtSlUptime = (sec) => {
            const sn = Math.max(0, Math.floor(Number(sec) || 0));
            const h = Math.floor(sn / 3600);
            const m = Math.floor((sn % 3600) / 60);
            const sc = sn % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}`;
        };
        set('xp', fmtCompact(st.xpPerHour));
        set('gold', signed(st.netGoldPerHour));
        host.querySelector('.sl-kpi.gold').classList.toggle('neg', Number(st.netGoldPerHour || 0) < 0);
        set('xpSpark', sparkSvg(hist[acc].map((p) => p.xpRate), 'xp'));
        set('goldSpark', sparkSvg(hist[acc].map((p) => p.goldRate), 'gold'));
        const slCapPctVal = Number(st.kills || 0) > 0 ? `${String(st.capturePerKillPct || 0).replace('.', ',')}%` : '-';
        const capPerHour = Number(st.uptimeSec || 0) > 0 ? Math.round((Number(st.captures || 0)) / (Number(st.uptimeSec) / 3600)) : 0;
        set('captures', fmtCompact(st.captures));
        set('capturesSub', `${slCapPctVal}/abate${capPerHour > 0 ? ` · ${fmtCompact(capPerHour)}/h` : ''}`);
        set('capSpark', sparkSvg(hist[acc].map((p) => p.capPerKill), 'catch'));
        set('kills', fmtCompact(st.kills));
        set('killsSub', `${String(st.killsPerMin || 0).replace('.', ',')}/min · ${st.avgKillSec ? `${String(st.avgKillSec).replace('.', ',')}s cada` : '-'}`);
        set('shiny', `${Number(st.shiniesCaptured || 0)}<small> / ${Number(st.shiniesSeen || 0)}</small>`);
        set('shinySub', Number(st.shiniesMissed || 0)
            ? `${st.shiniesMissed} escaparam`
            : `${fmtNum(st.ballsThrown || 0)} bolas`);
        const avgKillTxt = st.avgKillSec > 0 ? `${String(st.avgKillSec).replace('.', ',')}s` : '-';
        const ballPerCapTxt = Number(st.ballsPerCapture || 0) > 0 ? `${String(st.ballsPerCapture).replace('.', ',')}` : '-';
        set('metaStrip',
            `<span>Tempo/abate: <b>${avgKillTxt}</b></span>` +
            `<span>Cap./abate: <b>${slCapPctVal}</b></span>` +
            `<span>Bolas/cap.: <b>${ballPerCapTxt}</b></span>` +
            `<span>Ativo: <b>${fmtSlUptime(st.uptimeSec)}</b></span>`
        );
        host.querySelectorAll('button[data-ev-size]:empty').forEach((b) => { b.textContent = EV_SIZES.find((x) => x[0] === evSize)[1]; });
        syncBuffViewButtons(host);
        const bbox = q('.sl-buffs');
        const bHtml = buffView === 'detalhe'
            ? buffManagerHtml(s.lives, { head: false })
            : flatBuffsHtml(acc, { foot: true });
        const bSig = `${buffView}|${bHtml}`;
        if (bbox.dataset.sig !== bSig) {
            bbox.dataset.sig = bSig;
            bbox.className = `sl-buffs ${buffView === 'detalhe' ? 'buff-manager' : 'pbuffs-host'}`;
            bbox.innerHTML = bHtml || '<span class="hint-text">Sem dados das lives ainda.</span>';
        }
        const drops = (s.drops?.featured || []).filter((d) => d.qty > 0).slice(0, 10);
        const dropSig = drops.map((d) => `${d.key}:${d.qty}`).join(',') || '-';
        const dbox = q('.sl-drops');
        if (dbox.dataset.sig !== dropSig) {
            dbox.dataset.sig = dropSig;
            dbox.innerHTML = drops.length
                ? drops.map((d) => {
                    const tip = window.nexoDropInsight ? window.nexoDropInsight(d, s) : `${d.name}: ${d.qty} na sessão (${String(d.perHour).replace('.', ',')}/h)`;
                    return `<span class="sl-drop${d.rare ? ' rare' : ''}" title="${esc(tip)}">${IC(d.rare ? 'gift' : 'package')}<span>${escapeHtml(d.name)}</span><b>${fmtNum(d.qty)}</b></span>`;
                }).join('')
                : '<span class="hint-text">Nenhum drop ainda nesta sessão.</span>';
        }
        const evs = recentEvents(acc, 40);
        const evSig = evs.map((e) => e.id).join(',') + Math.floor(Date.now() / 30_000);
        const ul = q('.sl-events');
        const accColor = window.nexoIcons?.accountAccent?.(acc) || 'azul';
        if (ul.dataset.sig !== `${evSig}|${accColor}`) {
            ul.dataset.sig = `${evSig}|${accColor}`;
            ul.innerHTML = evs.length
                ? evs.map((e) => {
                    const meta = classifyLogEntry(e);
                    return `<li class="ev ${esc(meta.vKind)}" data-acc="${acc}" data-acc-color="${esc(accColor)}">${IC(meta.icon)}<span class="ev-text">${escapeHtml(meta.cleanText)}</span><time title="${clockOf(e.ts)}">${relTime(e.ts)}</time></li>`;
                }).join('')
                : `<li class="ev empty">${evFilter.length ? 'Nada desse tipo ainda nesta sessão.' : 'Escolha acima o que mostrar aqui.'}</li>`;
        }
    }

    // ===== S8: barra fina sobre o jogo embutido =====
    let hudPos = LS.get('nexo.hudPos', 'top');
    function renderHud(acc) {
        const body = $(`wv-body-${acc}`);
        if (!body) return;
        let hud = body.querySelector('.wv-hud');
        const show = isEmbedded(acc) && hudPos !== 'off' && !POPOUT;
        if (!show) {
            if (hud) hud.hidden = true;
            return;
        }
        if (!hud) {
            hud = document.createElement('div');
            hud.className = 'wv-hud';
            hud.innerHTML = `<span class="hud-grip" title="Arraste para mover a barra (duplo clique volta para cima)" aria-hidden="true"></span><span class="acc-dot"></span><img class="hud-sprite" alt="" hidden /><span class="hud-poke"><b></b><span class="hud-hp"><i></i></span></span>
              <span class="hud-stat" data-h="xp" title="XP por hora">${IC('zap')}<b></b></span>
              <span class="hud-stat" data-h="gold" title="Lucro por hora">${IC('coins')}<b></b></span>
              <span class="hud-stat" data-h="kills" title="Abates na sessão">${IC('swords')}<b></b></span>
              <span class="hud-stat shiny" data-h="shiny" title="Shinies capturados / vistos">${IC('sparkles')}<b></b></span>
              <button type="button" class="hud-btn" data-hud-act="panel" title="Ver o painel desta conta" aria-label="Ver o painel desta conta">${IC('panel')}</button>
              <button type="button" class="hud-btn" data-hud-act="hide" title="Esconder a barra (volta no menu ⋯)" aria-label="Esconder a barra sobre o jogo">${IC('eyeoff')}</button>`;
            hud.addEventListener('click', (ev) => {
                const btn = ev.target.closest('[data-hud-act]');
                if (!btn) return;
                if (btn.dataset.hudAct === 'hide') setHudPos('off');
                if (btn.dataset.hudAct === 'panel') {
                    selectAccount(acc);
                    if (viewMode === 'grid') setViewMode('split');
                    setSubtab('overview');
                }
            });
            hud.querySelector('.hud-grip').addEventListener('pointerdown', (ev) => startHudDrag(ev, hud, body));
            hud.querySelector('.hud-grip').addEventListener('dblclick', () => setHudPos('top'));
            body.append(hud);
        }
        hud.hidden = false;
        hud.classList.toggle('bottom', hudPos === 'bottom');
        placeFreeHud(hud, body);
        const s = snapshots[acc] || {};
        const st = s.stats || {};
        const poke = s.activePokemon;
        hud.querySelector('.acc-dot').className = `acc-dot ${statusOf(acc)}`;
        const img = hud.querySelector('.hud-sprite');
        setPokemonSpriteImg(img, poke?.speciesId, poke?.shiny, poke?.spriteDex, poke?.name);
        hud.querySelector('.hud-poke b').textContent = poke ? `${poke.name} ${poke.level}` : nickOf(acc);
        const hp = poke ? Number(poke.hpPercent || 0) : 0;
        const bar = hud.querySelector('.hud-hp i');
        bar.style.width = `${hp}%`;
        bar.className = hp > 50 ? 'ok' : hp > 20 ? 'mid' : 'low';
        hud.querySelector('[data-h="xp"] b').textContent = fmtCompact(st.xpPerHour);
        const g = hud.querySelector('[data-h="gold"]');
        g.querySelector('b').textContent = signed(st.netGoldPerHour);
        g.classList.toggle('neg', Number(st.netGoldPerHour || 0) < 0);
        hud.querySelector('[data-h="kills"] b').textContent = fmtCompact(st.kills);
        hud.querySelector('[data-h="shiny"] b').textContent = `${Number(st.shiniesCaptured || 0)}/${Number(st.shiniesSeen || 0)}`;
    }
    let hudXY = LS.get('nexo.hudXY', { x: 0.5, y: 0 });
    function placeFreeHud(hud, body) {
        const free = hudPos === 'free';
        hud.classList.toggle('free', free);
        if (!free) { hud.style.left = ''; hud.style.top = ''; return; }
        const maxX = Math.max(0, body.clientWidth - hud.offsetWidth);
        const maxY = Math.max(0, body.clientHeight - hud.offsetHeight);
        hud.style.left = `${Math.round(Math.min(1, Math.max(0, Number(hudXY.x) || 0)) * maxX)}px`;
        hud.style.top = `${Math.round(Math.min(1, Math.max(0, Number(hudXY.y) || 0)) * maxY)}px`;
    }
    function startHudDrag(ev, hud, body) {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const r0 = hud.getBoundingClientRect();
        const offX = ev.clientX - r0.left;
        const offY = ev.clientY - r0.top;
        if (hudPos !== 'free') {
            const b = body.getBoundingClientRect();
            const maxX = Math.max(1, b.width - r0.width);
            const maxY = Math.max(1, b.height - r0.height);
            hudXY = { x: (r0.left - b.left) / maxX, y: (r0.top - b.top) / maxY };
            hudPos = 'free';
            LS.set('nexo.hudPos', hudPos);
            syncMenuState();
            for (const acc of ACCOUNTS) renderHud(acc);
        }
        document.body.classList.add('hud-dragging');
        hud.classList.add('dragging');
        const move = (e) => {
            const b = body.getBoundingClientRect();
            const maxX = Math.max(1, b.width - hud.offsetWidth);
            const maxY = Math.max(1, b.height - hud.offsetHeight);
            const x = Math.min(maxX, Math.max(0, e.clientX - b.left - offX));
            const y = Math.min(maxY, Math.max(0, e.clientY - b.top - offY));
            hudXY = { x: x / maxX, y: y / maxY };
            hud.style.left = `${Math.round(x)}px`;
            hud.style.top = `${Math.round(y)}px`;
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            document.body.classList.remove('hud-dragging');
            hud.classList.remove('dragging');
            LS.set('nexo.hudXY', hudXY);
            for (const acc of ACCOUNTS) renderHud(acc);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }
    function setHudPos(pos) {
        hudPos = ['top', 'bottom', 'free', 'off'].includes(pos) ? pos : 'top';
        LS.set('nexo.hudPos', hudPos);
        syncMenuState();
        for (const acc of ACCOUNTS) renderHud(acc);
    }

    // ===== S10: avisos dentro da tela da conta, na grade =====
    function slotVisibleInGrid(acc) {
        if (viewMode !== 'grid') return false;
        if (Array.isArray(gridState?.hidden) && gridState.hidden.includes(acc)) return false;
        if (gridState?.max && gridState.max !== acc) return false;
        return Boolean($(`wv-slot-${acc}`));
    }
    function slotToast(acc, { kind, category, title, text, card, onClick, actionLabel }) {
        const slot = $(`wv-slot-${acc}`);
        let stack = slot.querySelector('.slot-toasts');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'slot-toasts';
            stack.setAttribute('aria-live', 'polite');
            slot.append(stack);
        }
        while (stack.children.length >= 3) stack.firstElementChild.remove();
        const item = document.createElement('div');
        const meta = classifyLogEntry({ kind, text });
        const tone = category === 'live' || meta.cat === 'live' ? (kind === 'warn' ? 'warn' : 'live') : (kind || 'info');
        const accColor = window.nexoIcons?.accountAccent?.(acc) || 'azul';
        item.className = `slot-toast ${tone}`;
        item.dataset.acc = String(acc);
        item.dataset.accColor = accColor;
        item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        const sprite = card?.sprite ? `<img src="${esc(card.sprite)}" alt="" />` : IC(meta.icon || KIND_ICON[kind] || 'info');
        const body = card ? `${escapeHtml(card.name || '')}${card.level ? ` Nv ${card.level}` : ''}` : escapeHtml(meta.cleanText || text);
        const headLabel = meta.cat === 'live' ? `Conta ${acc} · Live` : String(title || `Conta ${acc}`).split(' · ')[0];
        item.innerHTML = `${sprite}<span class="st-text"><b>${escapeHtml(headLabel)}</b><span>${body}</span></span>${onClick && actionLabel ? `<button type="button" class="st-act">${escapeHtml(actionLabel)}</button>` : ''}`;
        const life = kind === 'shiny' ? 9000 : 6000;
        const kill = () => { item.classList.add('out'); setTimeout(() => item.remove(), 220); };
        item.addEventListener('click', () => {
            if (typeof onClick === 'function') { try { onClick(); } catch { /* ignore */ } }
            kill();
        });
        stack.append(item);
        setTimeout(kill, life);
    }

    // ===== registro de eventos (para "Enquanto você estava fora") =====
    const eventLog = [];
    let suppressToastsUntil = 0;

    // ===== S3: central "Precisa de você" =====
    const DISMISS_KEY = 'nexo.bellDismissed';
    let dismissed = LS.get(DISMISS_KEY, {});
    (function pruneDismissed() {
        const cut = Date.now() - 7 * 86_400_000;
        for (const [k, ts] of Object.entries(dismissed)) if (ts < cut) delete dismissed[k];
    })();
    function collectAlerts() {
        const items = [];
        const now = Date.now();
        for (const acc of ACCOUNTS) {
            const s = snapshots[acc];
            if (!s) continue;
            const who = `Conta ${acc} · ${nickOf(acc)}`;
            for (const w of s.modeWarnings || []) {
                items.push({
                    key: `mw:${acc}:${w.code}`, sev: w.severity === 'danger' ? 'danger' : 'warn', icon: 'alert', acc,
                    title: w.title, text: `${who}. ${w.detail || ''}`,
                    actions: w.fixConfig ? [['Corrigir', () => void applyConfigTo(acc, w.fixConfig)]] : [['Ver conta', () => goAccount(acc, 'overview')]],
                });
            }
            if (s.status === 'error') {
                items.push({
                    key: `err:${acc}:${s.lastError || ''}`, sev: 'danger', icon: 'x', acc,
                    title: 'Conta com erro', text: `${who}. ${s.lastError || 'Veja o registro para detalhes.'}`,
                    actions: [['Iniciar de novo', () => void sendAction('start', {}, acc)], ['Ver registro', () => goAccount(acc, 'activity')]],
                });
            }
            if (s.status === 'paused' && s.session) {
                items.push({
                    key: `pause:${acc}:${s.stats?.startedAt || ''}`, sev: 'warn', icon: 'pause', acc,
                    title: 'Conta pausada', text: `${who} não está farmando.`,
                    actions: [['Retomar', () => void sendAction('start', {}, acc)]],
                });
            }
            if (s.config?.liveAutoClaimChest === false) {
                for (const [ch, stt] of Object.entries(s.lives?.twitch || {})) {
                    if (!stt?.manualChest) continue;
                    items.push({
                        key: `chest:${acc}:${ch}:${Math.floor(now / 3_600_000)}`, sev: 'reward', icon: 'gift', acc,
                        title: 'Caixinha +50 liberada', text: `${who} em ${ch}.`,
                        actions: [['Resgatar', () => void claimTwitchChest(ch, acc)]],
                    });
                }
            }
            if (s.vote?.available) {
                items.push({
                    key: `vote:${acc}:${new Date().toDateString()}`, sev: 'reward', icon: 'thumbs', acc,
                    title: 'Voto diário liberado', text: `${who} pode votar pelo jogo, no menu Vote & Ganhe.`,
                });
            }
            for (const m of s.missedShinies || []) {
                if (now - Number(m.ts || 0) > 30 * 60_000) continue;
                items.push({
                    key: `miss:${acc}:${m.id}:${m.ts}`, sev: 'shiny', icon: 'sparkles', acc, ts: m.ts,
                    title: `Shiny escapou: ${m.name || '?'}`, text: `${who}${m.level ? `, Nv ${m.level}` : ''}${m.hunt ? `, hunt ${m.hunt}` : ''}${MISS_BALL_LABELS[m.ballId] ? `, escapou da ${MISS_BALL_LABELS[m.ballId]}` : ''}. ${relTime(m.ts)}.`,
                    actions: [['Ver registro', () => goAccount(acc, 'activity')]],
                });
            }
        }
        if (typeof currentUpdateState === 'object' && currentUpdateState?.hasUpdate) {
            items.push({
                key: `upd:${currentUpdateState.updateId || currentUpdateState.latestVersion}`, sev: 'info', icon: 'download', acc: 0,
                title: `Versão ${String(currentUpdateState.latestVersion || '').replace(/\.0$/, '')} disponível`, text: 'Contas e sessões ficam preservadas.',
                actions: [['Ver atualização', () => $('btnUpdateToggle')?.click()]],
            });
        }
        return items.filter((it) => !dismissed[it.key]);
    }
    function goAccount(acc, tab) {
        selectAccount(acc);
        if (viewMode === 'panels-grid') setViewMode('split');
        if (tab) setSubtab(tab);
        setPopover('bell', false);
    }
    let bellItems = [];
    let lastBellSig = '';
    function renderBell() {
        bellItems = collectAlerts();
        const count = bellItems.length;
        const badge = $('bellCount');
        const btn = $('btnBell');
        if (!badge || !btn) return;
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.classList.toggle('hidden', count === 0);
        btn.classList.toggle('has-alerts', count > 0);
        btn.classList.toggle('danger', bellItems.some((i) => i.sev === 'danger'));
        btn.setAttribute('aria-label', count ? `Precisa de você: ${count} aviso${count > 1 ? 's' : ''}` : 'Precisa de você: nada pendente');
        const ni = window.nexoIcons;
        const sig = bellItems.map((i) => `${i.key}|${i.text}|${i.acc ? ni?.accountAccent?.(i.acc) || 'azul' : ''}`).join('§');
        if (sig === lastBellSig) return;
        lastBellSig = sig;
        const list = $('bellList');
        list.innerHTML = count
            ? bellItems.map((it, idx) => {
                const hasAcc = ACCOUNTS.includes(Number(it.acc));
                const accColor = hasAcc ? (ni?.accountAccent?.(it.acc) || 'azul') : '';
                const accTag = hasAcc
                    ? `<span class="acc-pill" data-acc="${it.acc}" data-acc-color="${esc(accColor)}"><i class="acc-pill-dot"></i>Conta ${it.acc} · ${escapeHtml(nickOf(it.acc))}</span>`
                    : '';
                const bodyTxt = hasAcc ? String(it.text || '').replace(/^Conta \d+ · [^.:]+(?:\.\s*|\s+)/, '') : String(it.text || '');
                return `<li class="bell-item ${it.sev}"${hasAcc ? ` data-acc="${it.acc}" data-acc-color="${esc(accColor)}"` : ''}>
                <span class="bell-ico">${IC(it.icon)}</span>
                <div class="bell-body">${accTag}<b>${escapeHtml(it.title)}</b><span>${escapeHtml(bodyTxt)}</span>
                  <div class="bell-acts">${it.actions.map(([label], ai) => `<button type="button" class="btn sm" data-bell="${idx}" data-bell-act="${ai}">${escapeHtml(label)}</button>`).join('')}</div>
                </div>
                <button type="button" class="bell-x" data-bell-dismiss="${idx}" title="Dispensar" aria-label="Dispensar aviso">${IC('x')}</button>
              </li>`;
            }).join('')
            : `<li class="bell-empty">${IC('check')}<span>Tudo certo. Nada pede atenção agora.</span></li>`;
    }
    function dismissBell(keys) {
        const now = Date.now();
        for (const k of keys) dismissed[k] = now;
        LS.set(DISMISS_KEY, dismissed);
        lastBellSig = '';
        renderBell();
    }

    // ===== S17: registro legível (componente usado na aba e na coluna fixa) =====
    const KIND_ICON = {
        shiny: 'sparkles',
        'shiny-miss': 'alert',
        live: 'tv',
        reward: 'gift',
        error: 'x',
        warn: 'alert',
        ok: 'check',
        info: 'info',
        catch: 'pokeball',
        hunt: 'trend',
        shop: 'cart',
        prey: 'crosshair',
    };
    const LOG_FILTERS = [
        ['all', 'Tudo'],
        ['shiny', 'Shiny'],
        ['live', 'Lives'],
        ['reward', 'Drops & Marcos'],
        ['farm', 'Farm & Hunt'],
        ['warn', 'Avisos'],
        ['error', 'Erros'],
    ];
    const LIVE_TEXT_RE = /^(?:Lives:|Twitch\b|Kick\b|Cookies Twitch)/i;
    const HUNT_TEXT_RE = /^\/hunt\b|^Troca (?:de hunt|para )|^(?:Pokédex|Pokedex|Top Catch \()|Centro Médico|Equipe curada/i;
    function classifyLogEntry(entry = {}) {
        const k = String(entry.kind || 'info');
        const txt = String(entry.text || '');
        if (k === 'shiny') {
            return { vKind: 'shiny', cats: ['shiny'], tag: 'SHINY', icon: 'sparkles', cleanText: txt };
        }
        if (k === 'shiny-miss') {
            return { vKind: 'shiny-miss', cats: ['shiny', 'warn'], tag: 'SHINY PERDIDO', icon: 'alert', cleanText: txt };
        }
        if (k === 'error') {
            const cats = LIVE_TEXT_RE.test(txt) ? ['error', 'live'] : ['error'];
            return { vKind: 'error', cats, tag: 'ERRO', icon: 'x', cleanText: txt };
        }
        if (k === 'warn') {
            const isLive = LIVE_TEXT_RE.test(txt) || /\b429\b/i.test(txt);
            const cleanText = isLive ? txt.replace(/^Lives:\s*/i, '') : txt;
            return { vKind: 'warn', cats: isLive ? ['warn', 'live'] : ['warn'], tag: isLive ? 'LIVE' : 'AVISO', icon: 'alert', cleanText };
        }
        if (k === 'live' || LIVE_TEXT_RE.test(txt)) {
            return {
                vKind: 'live',
                cats: ['live'],
                tag: 'LIVE',
                icon: 'tv',
                cleanText: txt.replace(/^Lives:\s*/i, ''),
            };
        }
        if (k === 'reward') {
            let tag = 'BÔNUS';
            let icon = 'gift';
            if (/^Drop:/i.test(txt)) tag = 'DROP';
            else if (/^Sniper/i.test(txt)) { tag = 'SNIPER'; icon = 'cart'; }
            else if (/top catch/i.test(txt)) tag = 'TOP CATCH';
            else if (/passe/i.test(txt)) tag = 'PASSE';
            else if (/diamante|voto/i.test(txt)) tag = 'VOTO';
            return { vKind: 'reward', cats: ['reward'], tag, icon, cleanText: txt };
        }
        if (/^(?:Treinador|Exp\. Share):/i.test(txt)) {
            return { vKind: 'hunt', cats: ['farm'], tag: 'TREINO', icon: 'trend', cleanText: txt };
        }
        if (k === 'catch') {
            return { vKind: 'catch', cats: ['farm'], tag: 'CAPTURA', icon: 'pokeball', cleanText: txt };
        }
        if (k === 'shop') {
            return { vKind: 'shop', cats: ['farm'], tag: 'LOJA', icon: 'cart', cleanText: txt };
        }
        if (k === 'prey') {
            return { vKind: 'prey', cats: ['farm'], tag: 'PREY', icon: 'crosshair', cleanText: txt };
        }
        if (HUNT_TEXT_RE.test(txt)) {
            return { vKind: 'hunt', cats: ['farm'], tag: 'HUNT', icon: 'trend', cleanText: txt };
        }
        return { vKind: k === 'ok' ? 'ok' : 'info', cats: ['farm'], tag: 'SISTEMA', icon: k === 'ok' ? 'check' : 'info', cleanText: txt };
    }
    const logViews = new Map();
    function mountLogView(host, key, defaults = {}) {
        if (!host) return null;
        if (logViews.has(key)) return logViews.get(key);
        const state = { filter: 'all', query: '', scope: 'acc', ...defaults, ...LS.get(`nexo.log.${key}`, {}) };
        host.innerHTML = `
          <div class="log-tools">
            <div class="log-chips" role="group" aria-label="Filtrar registro">${LOG_FILTERS.map(([f, label]) => `<button type="button" class="log-chip" data-f="${f}">${label}</button>`).join('')}</div>
            <label class="log-search">${IC('search')}<input type="search" placeholder="Buscar no registro" aria-label="Buscar no registro" spellcheck="false" /></label>
            <button type="button" class="log-scope" title="Alternar entre a conta escolhida e as 4 contas"></button>
          </div>
          <ol class="log-list" aria-live="off"></ol>`;
        const view = { host, key, state, sig: '' };
        const save = () => LS.set(`nexo.log.${key}`, { filter: state.filter, scope: state.scope });
        host.querySelector('.log-chips').addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-f]');
            if (!b) return;
            state.filter = b.dataset.f;
            save();
            renderLogView(view, true);
        });
        const input = host.querySelector('input[type="search"]');
        input.value = state.query;
        input.addEventListener('input', () => { state.query = input.value; renderLogView(view, true); });
        host.querySelector('.log-scope').addEventListener('click', () => {
            state.scope = state.scope === 'all' ? 'acc' : 'all';
            save();
            renderLogView(view, true);
        });
        logViews.set(key, view);
        return view;
    }
    function gatherLogs(scope) {
        const accs = scope === 'all' ? ACCOUNTS : [activeAccount];
        const out = [];
        for (const acc of accs) {
            for (const l of snapshots[acc]?.logs || []) out.push({ ...l, acc });
        }
        if (accs.length > 1) out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
        return out;
    }
    function renderLogView(view, force = false) {
        if (!view) return;
        const { state, host } = view;
        const ni = window.nexoIcons;
        const accSig = ACCOUNTS.map((a) => ni?.accountAccent?.(a) || 'azul').join(',');
        const all = gatherLogs(state.scope);
        const last = all[all.length - 1];
        const sig = `${activeAccount}|${state.scope}|${state.filter}|${state.query}|${accSig}|${all.length}|${last?.id}|${last?.repeat || 1}|${last?.acc}|${Math.floor(Date.now() / 20_000)}`;
        if (!force && sig === view.sig) return;
        view.sig = sig;
        host.querySelectorAll('.log-chip').forEach((b) => {
            b.classList.toggle('active', b.dataset.f === state.filter);
            b.setAttribute('aria-pressed', b.dataset.f === state.filter ? 'true' : 'false');
        });
        const scopeBtn = host.querySelector('.log-scope');
        scopeBtn.innerHTML = state.scope === 'all' ? `${IC('columns')}4 contas` : `${IC('user')}Conta ${activeAccount}`;
        const wantFilter = LOG_FILTERS.some(([f]) => f === state.filter) ? state.filter : 'all';
        const q = state.query.trim().toLowerCase();
        const rows = [];
        // agrupa linhas iguais em sequência (×N)
        for (const l of all) {
            const meta = classifyLogEntry(l);
            if (wantFilter !== 'all' && !meta.cats.includes(wantFilter)) continue;
            if (q && !String(meta.cleanText || '').toLowerCase().includes(q) && !meta.tag.toLowerCase().includes(q)) continue;
            const prev = rows[rows.length - 1];
            const reps = Math.max(1, Number(l.repeat) || 1); // o controlador já junta repetições seguidas
            const lastTs = Number(l.lastTs) || l.ts;
            if (prev && prev.acc === l.acc && prev.meta.vKind === meta.vKind && prev.meta.cleanText === meta.cleanText) {
                prev.count += reps;
                prev.ts = lastTs;
                continue;
            }
            rows.push({ ...l, ts: lastTs, meta, count: reps, firstTs: l.ts });
        }
        const shown = rows.slice(-300).reverse();
        const list = host.querySelector('.log-list');
        const hl = (t) => {
            const safe = escapeHtml(t);
            if (!q) return safe;
            const i = safe.toLowerCase().indexOf(escapeHtml(q));
            if (i < 0) return safe;
            return `${safe.slice(0, i)}<mark>${safe.slice(i, i + escapeHtml(q).length)}</mark>${safe.slice(i + escapeHtml(q).length)}`;
        };
        list.innerHTML = shown.length
            ? shown.map((r) => {
                const m = r.meta;
                const accColor = ni?.accountAccent?.(r.acc) || 'azul';
                return `<li class="log-row ${esc(m.vKind)}" data-acc="${r.acc}" data-acc-color="${esc(accColor)}">
                <span class="log-ico">${IC(m.icon)}</span>
                ${state.scope === 'all' ? `<span class="log-acc" data-acc="${r.acc}" data-acc-color="${esc(accColor)}" title="${esc(`Conta ${r.acc} · ${nickOf(r.acc)}`)}">${r.acc}</span>` : ''}
                <span class="log-text"><span class="log-cat ${esc(m.vKind)}">${escapeHtml(m.tag.charAt(0) + m.tag.slice(1).toLowerCase())}</span>${hl(m.cleanText)}${r.count > 1 ? `<span class="log-count" title="Repetiu ${r.count} vezes">×${r.count}</span>` : ''}</span>
                <time class="log-time" title="${clockOf(r.ts)}${r.count > 1 ? ` (primeira às ${clockOf(r.firstTs)})` : ''}">${relTime(r.ts)}</time>
              </li>`;
            }).join('')
            : `<li class="log-empty">${q || wantFilter !== 'all' ? 'Nada com esse filtro.' : 'Sem eventos ainda.'}</li>`;
    }

    // contador de novidades na aba Atividade
    let activitySeenTs = Date.now();
    function renderActivityBadge() {
        const badge = $('activityBadge');
        if (!badge) return;
        const visible = !$('tab-activity')?.classList.contains('hidden') || activityPinned;
        if (visible) activitySeenTs = Date.now();
        let n = 0;
        for (const acc of ACCOUNTS) {
            for (const l of snapshots[acc]?.logs || []) {
                if (l.ts <= activitySeenTs) continue;
                if (l.kind === 'shiny' || l.kind === 'shiny-miss' || l.kind === 'error' || l.kind === 'reward') {
                    n++;
                } else if (l.kind === 'live' && /resgatad|resgatou|ba[uú] \+50/i.test(l.text || '')) {
                    n++;
                }
            }
        }
        badge.textContent = n > 9 ? '9+' : String(n);
        badge.classList.toggle('hidden', n === 0);
    }

    // ===== S11: Atividade fixa numa coluna ao lado =====
    let activityPinned = Boolean(LS.get('nexo.activityPinned', false));
    let dockWidth = Number(LS.get('nexo.activityDockW', 340)) || 340;
    function ensureActivityDock() {
        const ws = $('workspace');
        let dock = $('activityDock');
        if (!activityPinned || POPOUT) {
            dock?.remove();
            ws?.classList.remove('has-activity-dock');
            return null;
        }
        if (!dock) {
            dock = document.createElement('aside');
            dock.className = 'activity-dock';
            dock.id = 'activityDock';
            dock.setAttribute('aria-label', 'Atividade fixa');
            dock.innerHTML = `<div class="dock-gutter" title="Arraste para mudar a largura"></div>
              <header class="dock-head"><span>${IC('activity')}Atividade</span>
                <button type="button" class="icon-btn" data-dock-act="popout" title="Soltar numa janela" aria-label="Soltar a Atividade numa janela">${IC('external')}</button>
                <button type="button" class="icon-btn" data-dock-act="close" title="Desafixar (tecla A)" aria-label="Desafixar a Atividade">${IC('x')}</button></header>
              <div class="log-view" id="logViewDock"></div>`;
            ws.append(dock);
            dock.querySelector('.dock-head').addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-dock-act]');
                if (!b) return;
                if (b.dataset.dockAct === 'close') setActivityPinned(false);
                if (b.dataset.dockAct === 'popout') { void window.pokeHub.popout?.('activity', activeAccount); setActivityPinned(false); }
            });
            wireDockGutter(dock);
            logViews.delete('dock');
            mountLogView($('logViewDock'), 'dock', { scope: 'all' });
        }
        ws.classList.add('has-activity-dock');
        dock.style.width = `${dockWidth}px`;
        document.body.style.setProperty('--dock-w', `${dockWidth}px`);
        return dock;
    }
    function wireDockGutter(dock) {
        const g = dock.querySelector('.dock-gutter');
        g.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            g.setPointerCapture(ev.pointerId);
            const startX = ev.clientX;
            const startW = dock.getBoundingClientRect().width;
            document.body.classList.add('is-resizing');
            const move = (e) => {
                dockWidth = Math.round(Math.min(640, Math.max(260, startW - (e.clientX - startX))));
                dock.style.width = `${dockWidth}px`;
                document.body.style.setProperty('--dock-w', `${dockWidth}px`);
            };
            const up = () => {
                g.removeEventListener('pointermove', move);
                g.removeEventListener('pointerup', up);
                document.body.classList.remove('is-resizing');
                LS.set('nexo.activityDockW', dockWidth);
                if (viewMode === 'grid') applyGridLayout();
            };
            g.addEventListener('pointermove', move);
            g.addEventListener('pointerup', up);
        });
    }
    function setActivityPinned(on) {
        activityPinned = Boolean(on);
        LS.set('nexo.activityPinned', activityPinned);
        ensureActivityDock();
        syncMenuState();
        renderLogView(logViews.get('dock'), true);
        if (viewMode === 'grid') applyGridLayout();
    }

    // ===== S12: colunas livres no modo Só Painel e layouts com nome =====
    const PANELS = ['overview', 'automation', 'connections', 'lives', 'activity'];
    const PANEL_LABEL = { overview: 'Visão geral', automation: 'Automação', connections: 'Conexões', lives: 'Lives', activity: 'Atividade' };
    let dockCols = LS.get('nexo.dockCols', ['overview', 'automation', 'activity']);
    let dockWeights = LS.get('nexo.dockWeights', [1, 1, 1]);
    let focusCol = 0;
    const sanitizeCols = () => {
        const seen = new Set();
        dockCols = (Array.isArray(dockCols) ? dockCols : []).filter((p) => PANELS.includes(p) && !seen.has(p) && seen.add(p)).slice(0, 3);
        if (!dockCols.length) dockCols = ['overview'];
        if (!Array.isArray(dockWeights)) dockWeights = [];
        dockWeights = dockCols.map((_, i) => Math.max(0.3, Number(dockWeights[i]) || 1));
    };
    sanitizeCols();
    const dockActive = () => viewMode === 'panel-only' && !POPOUT;
    function saveDock() {
        LS.set('nexo.dockCols', dockCols);
        LS.set('nexo.dockWeights', dockWeights);
    }
    function panelEl(p) { return $(`tab-${p}`); }
    function buildDock() {
        const pane = document.querySelector('.control-pane');
        const scroll = pane?.querySelector('.pane-scroll');
        if (!scroll) return;
        let holder = scroll.querySelector('.dock-cols');
        if (!dockActive()) {
            if (holder) {
                for (const p of PANELS) scroll.append(panelEl(p));
                holder.remove();
                pane.classList.remove('docked');
                const active = document.querySelector('.subtab.active')?.dataset.subtab || 'overview';
                document.querySelectorAll('.tab-panel').forEach((el) => el.classList.toggle('hidden', el.id !== `tab-${active}`));
                document.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b.dataset.subtab === active));
            }
            renderDockTools();
            return;
        }
        pane.classList.add('docked');
        if (!holder) {
            holder = document.createElement('div');
            holder.className = 'dock-cols';
            scroll.prepend(holder);
        }
        const sig = dockCols.join(',');
        if (holder.dataset.sig !== sig) {
            holder.dataset.sig = sig;
            for (const p of PANELS) scroll.append(panelEl(p)); // devolve todos antes de remontar
            holder.replaceChildren();
            dockCols.forEach((p, i) => {
                if (i > 0) {
                    const gut = document.createElement('div');
                    gut.className = 'dock-col-gutter';
                    gut.title = 'Arraste para mudar a largura · duplo clique iguala';
                    wireColGutter(gut, i);
                    holder.append(gut);
                }
                const col = document.createElement('section');
                col.className = 'dock-col';
                col.dataset.col = String(i);
                col.dataset.panel = p;
                col.innerHTML = `<header class="dock-col-head">
                    <select aria-label="Painel da coluna ${i + 1}">${PANELS.map((x) => `<option value="${x}"${x === p ? ' selected' : ''}>${PANEL_LABEL[x]}</option>`).join('')}</select>
                    <button type="button" class="icon-btn" data-col-act="popout" title="Soltar numa janela" aria-label="Soltar este painel numa janela">${IC('external')}</button>
                    ${dockCols.length > 1 ? `<button type="button" class="icon-btn" data-col-act="close" title="Fechar coluna" aria-label="Fechar esta coluna">${IC('x')}</button>` : ''}
                  </header><div class="dock-col-body"></div>`;
                col.querySelector('.dock-col-body').append(panelEl(p));
                col.querySelector('select').addEventListener('change', (ev) => setColPanel(i, ev.target.value));
                col.addEventListener('pointerdown', () => { focusCol = i; markFocusCol(); }, true);
                col.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-col-act]');
                    if (!b) return;
                    if (b.dataset.colAct === 'close') removeCol(i);
                    if (b.dataset.colAct === 'popout') void window.pokeHub.popout?.(dockCols[i], activeAccount);
                });
                col.addEventListener('dragover', (ev) => { if (dragPanel) { ev.preventDefault(); col.classList.add('drop-hint'); } });
                col.addEventListener('dragleave', () => col.classList.remove('drop-hint'));
                col.addEventListener('drop', (ev) => {
                    ev.preventDefault();
                    col.classList.remove('drop-hint');
                    if (dragPanel) setColPanel(i, dragPanel);
                });
                holder.append(col);
            });
            requestAnimationFrame(() => renderActiveAccountPanel());
        }
        holder.querySelectorAll('.dock-col').forEach((col, i) => { col.style.flexGrow = String(dockWeights[i] || 1); });
        for (const p of PANELS) panelEl(p).classList.toggle('hidden', !dockCols.includes(p));
        document.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', dockCols.includes(b.dataset.subtab)));
        markFocusCol();
        renderDockTools();
    }
    function markFocusCol() {
        document.querySelectorAll('.dock-col').forEach((c, i) => c.classList.toggle('focused', i === focusCol && dockCols.length > 1));
    }
    function wireColGutter(gut, idx) {
        gut.addEventListener('dblclick', () => { dockWeights = dockCols.map(() => 1); saveDock(); buildDock(); });
        gut.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            gut.setPointerCapture(ev.pointerId);
            const cols = [...gut.parentElement.querySelectorAll('.dock-col')];
            const a = cols[idx - 1];
            const b = cols[idx];
            const wa = a.getBoundingClientRect().width;
            const wb = b.getBoundingClientRect().width;
            const ga = dockWeights[idx - 1];
            const gb = dockWeights[idx];
            const startX = ev.clientX;
            document.body.classList.add('is-resizing');
            const move = (e) => {
                const dx = Math.max(-wa + 180, Math.min(wb - 180, e.clientX - startX));
                dockWeights[idx - 1] = ga * ((wa + dx) / wa);
                dockWeights[idx] = gb * ((wb - dx) / wb);
                a.style.flexGrow = String(dockWeights[idx - 1]);
                b.style.flexGrow = String(dockWeights[idx]);
            };
            const up = () => {
                gut.removeEventListener('pointermove', move);
                gut.removeEventListener('pointerup', up);
                document.body.classList.remove('is-resizing');
                saveDock();
            };
            gut.addEventListener('pointermove', move);
            gut.addEventListener('pointerup', up);
        });
    }
    function setColPanel(i, p) {
        if (!PANELS.includes(p)) return;
        const existing = dockCols.indexOf(p);
        if (existing === i) return;
        if (existing >= 0) dockCols[existing] = dockCols[i]; // troca de lugar
        dockCols[i] = p;
        focusCol = i;
        saveDock();
        buildDock();
        if (p === 'lives') setTimeout(requestLivesRefresh, 0);
    }
    function addCol() {
        if (dockCols.length >= 3) return;
        const next = PANELS.find((p) => !dockCols.includes(p));
        if (!next) return;
        dockCols.push(next);
        dockWeights.push(1);
        focusCol = dockCols.length - 1;
        saveDock();
        buildDock();
    }
    function removeCol(i) {
        if (dockCols.length <= 1) return;
        dockCols.splice(i, 1);
        dockWeights.splice(i, 1);
        focusCol = 0;
        saveDock();
        buildDock();
    }
    let dragPanel = '';
    function renderDockTools() {
        const tools = document.querySelector('.subtab-tools');
        if (!tools) return;
        let add = $('btnAddCol');
        if (!add) {
            add = document.createElement('button');
            add.type = 'button';
            add.className = 'icon-btn';
            add.id = 'btnAddCol';
            add.title = 'Adicionar coluna (até 3). Arraste uma aba para uma coluna para trocar o painel.';
            add.setAttribute('aria-label', 'Adicionar coluna');
            add.innerHTML = IC('columns');
            add.addEventListener('click', addCol);
            tools.prepend(add);
        }
        add.hidden = !dockActive();
        add.disabled = dockCols.length >= 3;
    }

    const LAYOUTS_KEY = 'nexo.layouts';
    function currentLayout() {
        return {
            viewMode,
            grid: { layout: gridState.layout, order: [...(gridState.order || [])], hidden: [...(gridState.hidden || [])], max: gridState.max || 0, splitX: gridState.splitX, splitY: gridState.splitY },
            dockCols: [...dockCols], dockWeights: [...dockWeights],
            activityPinned, dockWidth, hudPos,
            cards: { hidden: [...cardState.hidden], collapsed: [...cardState.collapsed], resumo: [...cardState.resumo], order: { ...cardState.order } }, paneW,
        };
    }
    function applyLayout(l) {
        if (!l) return;
        if (l.grid) {
            Object.assign(gridState, l.grid);
            try { localStorage.setItem('nexo.gridLayout', JSON.stringify(gridState)); } catch { /* ignore */ }
        }
        if (Array.isArray(l.dockCols)) { dockCols = [...l.dockCols]; dockWeights = [...(l.dockWeights || [])]; sanitizeCols(); saveDock(); }
        if (l.dockWidth) { dockWidth = l.dockWidth; LS.set('nexo.activityDockW', dockWidth); }
        if (l.hudPos) setHudPos(l.hudPos);
        if (l.cards) { cardState = l.cards; sanitizeCards(); saveCards(); applyCards(); }
        if (l.paneW != null) { paneW = Number(l.paneW) || 0; LS.set('nexo.paneW', paneW); applyPaneWidth(); }
        setActivityPinned(Boolean(l.activityPinned));
        if (l.viewMode && l.viewMode !== viewMode) setViewMode(l.viewMode);
        else { applyGridLayout(); renderGridToolbar(); buildDock(); }
        renderAll();
    }
    function renderLayoutSelect() {
        const sel = $('layoutSelect');
        if (!sel) return;
        const layouts = LS.get(LAYOUTS_KEY, {});
        const cur = sel.value;
        sel.innerHTML = `<option value="">${Object.keys(layouts).length ? 'Escolha um layout' : 'Nenhum layout salvo'}</option>`
            + Object.keys(layouts).sort().map((n) => `<option value="${esc(n)}">${escapeHtml(n)}</option>`).join('');
        if (layouts[cur]) sel.value = cur;
    }

    // ===== S19 e S20: configuração salva sozinha, desfazer e copiar =====
    let saveTimer = null;
    let savePending = false;
    let undoState = null; // { acc, prev, until }
    let prevCfgForUndo = null;
    function setSaveState(html, cls = '') {
        const hint = $('cfgHint');
        if (!hint) return;
        hint.className = `hint-text save-state ${cls}`;
        hint.innerHTML = html;
    }
    function onConfigDirty(dirty) {
        if (!dirty) return true; // o renderer chama isto a cada atualização; o estado é nosso
        if (!savePending) {
            prevCfgForUndo = { acc: activeAccount, cfg: { ...(snapshots[activeAccount]?.config || {}) } };
        }
        savePending = true;
        setSaveState(`${IC('clock')}Salvando…`, 'busy');
        clearTimeout(saveTimer);
        const typing = document.activeElement?.matches?.('input[type="text"], input[type="number"]');
        saveTimer = setTimeout(flushSave, typing ? 1100 : 450);
        return true;
    }
    async function flushSave() {
        clearTimeout(saveTimer);
        if (!savePending) return;
        savePending = false;
        const acc = activeAccount;
        const keys = Object.keys(readConfigForm());
        const res = await saveConfig();
        if (res?.ok === false) {
            setSaveState(`${IC('alert')}Não salvou: ${escapeHtml(res.error || 'erro')}`, 'err');
            return;
        }
        const prev = prevCfgForUndo && prevCfgForUndo.acc === acc ? prevCfgForUndo.cfg : null;
        undoState = prev ? { acc, prev: Object.fromEntries(keys.filter((k) => k in prev).map((k) => [k, prev[k]])), until: Date.now() + 20_000 } : null;
        const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        setSaveState(`${IC('check')}Salvo às ${time}${undoState ? ' · <button type="button" class="link-btn" id="btnCfgUndo">Desfazer</button>' : ''}`, 'ok');
    }
    async function undoSave() {
        if (!undoState || Date.now() > undoState.until) return;
        const { acc, prev } = undoState;
        undoState = null;
        await applyConfigTo(acc, prev);
        dirtyByAcc[acc] = false;
        setSaveState(`${IC('undo')}Alteração desfeita`, 'ok');
    }
    let copyArmed = 0;
    async function copyConfigToOthers() {
        const btn = $('btnCopyCfg');
        const others = ACCOUNTS.filter((a) => a !== activeAccount);
        if (Date.now() > copyArmed) {
            copyArmed = Date.now() + 5000;
            btn.classList.add('armed');
            btn.lastChild.textContent = `Confirmar: copiar para ${others.join(', ')}`;
            setTimeout(() => { if (Date.now() > copyArmed) resetCopyBtn(); }, 5200);
            return;
        }
        copyArmed = 0;
        await flushSave();
        const cfg = readConfigForm();
        btn.disabled = true;
        const results = await Promise.all(others.map((a) => applyConfigTo(a, cfg).catch(() => null)));
        btn.disabled = false;
        resetCopyBtn();
        const ok = results.filter((r) => r?.ok !== false).length;
        setSaveState(`${IC('copy')}Copiado para ${ok} de ${others.length} contas`, ok === others.length ? 'ok' : 'err');
    }
    function resetCopyBtn() {
        const btn = $('btnCopyCfg');
        if (!btn) return;
        btn.classList.remove('armed');
        btn.lastChild.textContent = 'Copiar para as outras contas';
    }
    function renderScope() {
        const badge = $('cfgScopeBadge');
        if (!badge) return;
        const txt = `Só a Conta ${activeAccount} · ${nickOf(activeAccount)}`;
        if (badge.lastChild?.textContent !== txt) badge.lastChild.textContent = txt;
    }

    // ===== S21: dicas ⓘ no lugar do guia longo =====
    const TIPS = {
        cCaidos: 'Joga a Pokébola em Pokémon caídos. O jogo só sorteia o shiny na hora do arremesso, então não dá para saber antes: toda bola jogada é uma chance, e um shiny que escapa vai embora com o corpo. Funciona também no Modo Economia do jogo, com 0% de GPU.',
        cNativeHeal: 'Liga a cura automática e o Revive do próprio jogo, com as poções marcadas mais abaixo.',
        cPvpQueue: 'Mantém a conta na fila do PvP ranqueado: entra, e depois de cada partida (e da espera que o jogo pede entre elas) entra de novo. Funciona sem VIP. O placar da sessão aparece no registro.',
        cRestock: 'Compra bolas, poções e revives no mercado quando ficam abaixo dos alvos, sem passar da reserva mínima de gold.',
        cPass: 'Resgata a recompensa diária do passe assim que libera.',
        cPrey: 'Rola o Prey diário automaticamente.',
        cIncubator: 'Coloca ovos da mochila nos slots livres da chocadeira automaticamente (prioridade: Shiny > P4 > P3 > P2).',
        cAutoSeasonalSwap: 'Em hunts do Mapa (fora da Outland), troca automaticamente para o Pokémon saudável da equipe do tipo do Dia Sazonal (2x dano e 1/4 recebido), respeitando teto Nv+5.',
        cAutoTeamManage: 'Gerencia trocas automáticas na equipe ao atingir teto Nv+5 (exceto Starter), com HP <= 25% sem poção ou em desvantagem elemental forte.',
        cRevivePotionCombo: 'Usa uma poção imediatamente após um Revive normal (que devolve só 10% do HP) quando o HP ativo estiver abaixo de 40%.',
        cAutoPokedexEvolve: 'Evolui automaticamente espécies prontas na equipe/coleção que ainda faltam na Pokédex.',
        cTopCatchPreferEasyStage: 'No modo Top Catch, prioriza estágios iniciais com teto de captura mais fácil antes de evoluções avançadas.',
        cLives: 'Assiste Twitch e Kick em protocolo leve (sem vídeo, ~40 lives para 4 contas) e resgata as recompensas.',
        cLiveStreak: 'Assiste os primeiros 15 min de cada live no player real da Twitch, invisível, em 160p e sem som, para contar a sequência.',
        cLiveFollow: 'Segue os canais das lives para liberar as recompensas que pedem follow.',
        cLiveSmart: 'Aplica a meta de forma independente na Kick e na Twitch: cada plataforma completa os próprios buffs na ordem (XP, depois Captura, depois Shiny) sem travar a outra.',
        cLiveSyncPlatforms: 'Opcional: quando marcado junto com o gestor inteligente, faz uma plataforma aguardar a outra bater a meta do buff atual antes de avançar para o próximo.',
        cEconomy: 'Corta o feed de campo no servidor no modo Headless. Economiza banda, mas o bot passa a achar os caídos pelos eventos de batalha e pode perder alguns. No jogo embutido, prefira o Modo Economia visual do jogo.',
        cEconomyPingOnly: 'Com a economia ligada, só mantém a conexão viva e as lives. Pausa captura, restock, passe, prey e /hunt.',
        cStandby: 'Quando o servidor devolve o erro 4001 (sessão em outro lugar), espera em vez de reconectar sem parar.',
        cBall: 'Bola de todo arremesso. Como o shiny é sorteado no próprio arremesso, é esta bola que tenta segurar o shiny: bola melhor segura mais shinies e custa mais. "auto" escolhe pelo gold que você tem.',
        cTargetBalls: 'Quantas bolas manter na mochila. O restock completa até esse número.',
        cTargetPotions: 'Quantas poções manter. 0 desliga a compra de poções.',
        cMinBalls: 'Quando as bolas caírem abaixo deste número, o bot compra até o alvo. Vazio usa 35% do alvo.',
        cMinPotions: 'Quando as poções caírem abaixo deste número, o bot compra até o alvo. Vazio usa 35% do alvo.',
        cMinRevives: 'Quando os revives caírem abaixo deste número, o bot compra até o alvo. Vazio usa 35% do alvo.',
        cRestockPotion: 'Qual poção comprar no restock. "Mais econômica" calcula o gold por HP que cada poção cura de verdade no Pokémon ativo e compra e usa a que rende mais: em Pokémon de muito HP a Small vira uma por segundo e sai mais cara que uma Hyper ou Ultimate. Automático usa a primeira marcada no Auto-Heal.',
        cReserve: 'O restock nunca deixa o gold abaixo deste valor.',
        cTargetRevives: 'Quantos revives manter. 0 desliga a compra.',
        cGuideMode: 'Acompanha a recomendação do /hunt: só avisa ou troca de hunt sozinho, sempre no tempo exato de saída de combate.',
        cGuideMetric: 'O que o /hunt deve priorizar ao recomendar hunt.',
        cFarmObjective: 'Alterna entre farm normal, Completar Pokédex, Modo Top Catch e Bestiário (degraus 25k/50k/100k).',
        cFarmObjectiveFocus: 'Define qual trajeto do /hunt priorizar ao escolher o próximo mapa da Pokédex ou Top Catch (XP/h, Ouro/h, Shiny/h ou menor nível).',
        cAutoCraftShinyEgg: 'Fabrica automaticamente um Ovo Shiny sempre que juntar 10 fragmentos.',
        cAutoSacrificeRedeem: 'Resgata automaticamente a barra de Sacrifício ao atingir >= 50 pontos (sem boost ativo).',
        cAutoOferendaOnFull: 'Gira automaticamente a Oferenda quando completar 5/5.',
        cAutoOptimizeGear: 'Equipa automaticamente a melhor Bicicleta e otimiza o uso das Casas.',
        cAutoExtendListings: 'Renova anúncios do mercado antes que expirem.',
        cAutoRaidEnroll: 'Inscreve automaticamente a conta na Raid semanal (segunda 16h).',
        cAutoRaidTeam: 'Envia automaticamente a melhor equipe calculada para a Raid semanal (segunda).',
        cAutoShowdownEnroll: 'Inscreve automaticamente a conta no Showdown semanal (quarta 20h).',
        cAutoMisticoEnter: 'Entra automaticamente no Místico quando estiver disponível.',
        cAutoBossEnabled: 'Na rotação diária das 18h BRT, ativa o Auto-Boss na maior região desbloqueada com o prêmio escolhido (Fragmento Mega, TM ou Tickets).',
        cAutoSafariSmart: 'Entra automaticamente no Safari em múltiplos de 6 tickets quando Lure, Shiny da Twitch e Shiny da Kick estão ativos juntos.',
        cLiveTargetHours: 'Quantas horas guardar de cada buff das lives.',
        cLiveTier: 'Qual pacote de recompensa comprar com os pontos das lives.',
    };
    function installTips() {
        for (const [id, tip] of Object.entries(TIPS)) {
            const input = $(id);
            if (!input) continue;
            const host = input.closest('.toggle-item') || input.closest('.field')?.querySelector('label');
            if (!host || host.querySelector('.tip')) continue;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tip';
            b.dataset.tip = tip;
            b.setAttribute('aria-label', `Sobre esta opção: ${tip}`);
            b.innerHTML = IC('info');
            host.append(b);
            const label = input.closest('.toggle-item');
            if (label) label.removeAttribute('title');
        }
        // texto auxiliar que não é aviso vira só dica; aviso aparece quando a opção está ligada
        document.querySelectorAll('#cfgToggles .toggle-sub:not(.warn)').forEach((el) => el.classList.add('moved-to-tip'));
    }
    let tipPop = null;
    function showTip(btn) {
        if (!tipPop) {
            tipPop = document.createElement('div');
            tipPop.className = 'tip-pop';
            tipPop.setAttribute('role', 'tooltip');
            document.body.append(tipPop);
        }
        tipPop.textContent = btn.dataset.tip;
        tipPop.hidden = false;
        const r = btn.getBoundingClientRect();
        const w = Math.min(320, window.innerWidth - 24);
        tipPop.style.maxWidth = `${w}px`;
        const left = Math.min(window.innerWidth - w - 12, Math.max(12, r.left - 12));
        tipPop.style.left = `${left}px`;
        const below = r.bottom + 8;
        tipPop.style.top = `${below}px`;
        const h = tipPop.getBoundingClientRect().height;
        if (below + h > window.innerHeight - 8) tipPop.style.top = `${Math.max(8, r.top - h - 8)}px`;
    }
    const hideTip = () => { if (tipPop) tipPop.hidden = true; };

    // ===== S4: "Enquanto você estava fora" =====
    const AWAY_MIN_MS = 30 * 60_000;
    let awayStart = 0;
    let awayBase = null;
    function markAway() {
        if (awayStart) return;
        awayStart = Date.now();
        awayBase = {};
        for (const acc of ACCOUNTS) {
            const st = snapshots[acc]?.stats;
            if (!st) continue;
            awayBase[acc] = {
                kills: Number(st.kills || 0), xp: Number(st.xpGained || 0), gold: Number(st.goldGained || 0) - Number(st.spentGold || 0),
                caps: Number(st.captures || 0), shinies: Number(st.shiniesCaptured || 0), missed: Number(st.shiniesMissed || 0),
            };
        }
    }
    function markBack(fromHidden) {
        if (!awayStart) return;
        const since = awayStart;
        const base = awayBase;
        awayStart = 0;
        awayBase = null;
        if (Date.now() - since < AWAY_MIN_MS || POPOUT) return;
        if (fromHidden) suppressToastsUntil = Date.now() + 4000; // o resumo já mostra o que aconteceu
        setTimeout(() => showAwaySummary(since, base), 1600);
    }
    // O que o resumo destaca: cada pessoa escolhe (lives vêm desligadas, são muitas e repetitivas).
    const AWAY_CATS = [
        ['farm', 'Farm por conta'],
        ['shiny', 'Shinies'],
        ['market', 'Compras e vendas'],
        ['drops', 'Drops e marcos'],
        ['live', 'Lives (Twitch e Kick)'],
        ['error', 'Erros'],
    ];
    const AWAY_DEFAULT = { farm: true, shiny: true, market: true, drops: true, live: false, error: true };
    const awayCats = () => ({ ...AWAY_DEFAULT, ...LS.get('nexo.awayCats', {}) });
    const AWAY_MARKET_RE = /^(?:Sniper|Mercado|Consultor|Destino dos drops)\b/i;
    const AWAY_LIVE_RE = /^(?:Lives:|Twitch\b|Kick\b)|caixinha|ba[úu] \+\d+/i;
    function awayCatOf(e) {
        const txt = String(e.text || e.title || '');
        if (AWAY_MARKET_RE.test(txt)) return 'market';
        if (e.event === 'chest' || e.kind === 'live' || AWAY_LIVE_RE.test(txt)) return 'live';
        if (e.kind === 'error') return 'error';
        if (e.kind === 'reward') return 'drops';
        return e.event ? 'drops' : '';
    }
    function showAwaySummary(since, base) {
        const cats = awayCats();
        const rows = [];
        const highlights = [];
        for (const acc of ACCOUNTS) {
            const s = snapshots[acc];
            const st = s?.stats;
            const b = base?.[acc];
            if (!st || !b) continue;
            const d = {
                kills: Number(st.kills || 0) - b.kills, xp: Number(st.xpGained || 0) - b.xp,
                gold: Number(st.goldGained || 0) - Number(st.spentGold || 0) - b.gold, caps: Number(st.captures || 0) - b.caps,
            };
            if (d.kills < 0 || d.xp < 0) continue; // sessão foi zerada no meio
            if (!d.kills && !d.xp && !d.caps) continue;
            if (cats.farm) rows.push(`<tr><th>${acc} · ${escapeHtml(nickOf(acc))}</th><td>${fmtCompact(d.xp)}</td><td class="${d.gold < 0 ? 'neg' : 'pos'}">${signed(d.gold)}</td><td>${fmtCompact(d.kills)}</td><td>${fmtCompact(d.caps)}</td></tr>`);
            if (cats.shiny) for (const o of s.ownShinies || []) if (Number(o.ts) > since) {
                const dex = resolvePokemonSpriteDex(o.speciesId, o.name, o.spriteDex);
                const url = pokemonSpriteUrl(o.speciesId, true, dex, o.name);
                highlights.push({ ts: o.ts, cls: 'shiny', icon: 'star', html: `${url ? `<img src="${url}" data-sprite-dex="${dex}" data-sprite-shiny="1" alt="" />` : ''}<span><b>${escapeHtml(o.name)}</b> capturado · Conta ${acc}</span>` });
            }
            if (cats.shiny) for (const m of s.missedShinies || []) if (Number(m.ts) > since) highlights.push({ ts: m.ts, cls: 'miss', icon: 'alert', html: `<span><b>${escapeHtml(m.name || 'Shiny')}</b> escapou · Conta ${acc}</span>` });
        }
        for (const e of eventLog) {
            if (e.ts <= since || e.event === 'shinyCaught' || e.event === 'shinyMiss') continue;
            const cat = awayCatOf(e);
            if (!cat || !cats[cat]) continue;
            highlights.push({ ts: e.ts, cls: e.kind, icon: KIND_ICON[e.kind] || 'info', html: `<span>${escapeHtml(e.text || e.title)}${e.account ? ` · Conta ${e.account}` : ''}</span>` });
        }
        if (!rows.length && !highlights.length && !$('hubOverlay')?.classList.contains('ov-away')) return;
        highlights.sort((a, b) => b.ts - a.ts);
        const mins = Math.round((Date.now() - since) / 60_000);
        const dur = mins >= 120 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
        openOverlay('away', `
          <header class="ov-head"><h2>${IC('moon')}Enquanto você estava fora</h2><span class="ov-sub">${dur}</span>
            <button type="button" class="icon-btn" data-ov-close aria-label="Fechar">${IC('x')}</button></header>
          ${rows.length ? `<table class="away-table"><thead><tr><th>Conta</th><th>XP</th><th>Lucro</th><th>Abates</th><th>Capturas</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : ''}
          ${highlights.length ? `<ul class="away-list">${highlights.slice(0, 12).map((h) => `<li class="${h.cls}">${IC(h.icon)}${h.html}<time>${relTime(h.ts)}</time></li>`).join('')}</ul>` : '<p class="hint-text">Nenhum evento especial no período.</p>'}
          <div class="away-cats" role="group" aria-label="O que destacar no resumo"><span>Destacar:</span>${AWAY_CATS.map(([k, label]) => `<label class="pill-chk"><input type="checkbox" data-away-cat="${k}"${cats[k] ? ' checked' : ''} /> ${label}</label>`).join('')}</div>
          <footer class="ov-foot"><button type="button" class="btn primary" data-ov-close>Beleza</button></footer>`);
        $('hubOverlay')?.querySelectorAll('[data-away-cat]').forEach((chk) => chk.addEventListener('change', () => {
            LS.set('nexo.awayCats', { ...awayCats(), [chk.dataset.awayCat]: chk.checked });
            showAwaySummary(since, base);
        }));
    }

    // ===== sobreposições (atalhos e resumo) =====
    function openOverlay(name, html) {
        closeOverlay();
        const ov = document.createElement('div');
        ov.className = `overlay ov-${name}`;
        ov.id = 'hubOverlay';
        ov.innerHTML = `<div class="ov-card" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
        ov.addEventListener('click', (ev) => {
            if (ev.target === ov || ev.target.closest('[data-ov-close]')) closeOverlay();
        });
        document.body.append(ov);
        ov.querySelector('.ov-card').focus();
    }
    function closeOverlay() { $('hubOverlay')?.remove(); }
    const SHORTCUTS = [
        ['1 a 4', 'Escolher a conta'],
        ['S', 'Painel + Jogo'], ['G', 'Grade das 4 telas'], ['P', 'Só Painel em colunas'], ['C', 'Painéis das 4 contas'],
        ['[  ]', 'Aba anterior / próxima'],
        ['A', 'Fixar ou soltar a Atividade ao lado'], ['B', 'Abrir "Precisa de você"'], ['H', 'Mini-HUD sempre visível'],
        ['M', 'Mutar ou ligar o som do jogo da conta'], ['?', 'Esta lista'], ['Esc', 'Fechar menus e janelas'],
    ];
    function showShortcuts() {
        setPopover('more', false);
        openOverlay('kbd', `
          <header class="ov-head"><h2>${IC('keyboard')}Atalhos do teclado</h2>
            <button type="button" class="icon-btn" data-ov-close aria-label="Fechar">${IC('x')}</button></header>
          <dl class="kbd-list">${SHORTCUTS.map(([k, d]) => `<div><dt>${k.split(/\s+a\s+|\s{2}/).map((x) => `<kbd>${escapeHtml(x.trim())}</kbd>`).join(k.includes(' a ') ? ' a ' : ' ')}</dt><dd>${escapeHtml(d)}</dd></div>`).join('')}</dl>
          <p class="hint-text">Os atalhos não funcionam enquanto você digita num campo.</p>`);
    }

    // ===== S2: menus do topo =====
    const POPOVERS = { bell: ['btnBell', 'bellPopover'], more: ['btnMore', 'moreMenu'] };
    function setPopover(name, open) {
        const [btnId, popId] = POPOVERS[name];
        const btn = $(btnId);
        const pop = $(popId);
        if (!btn || !pop) return;
        pop.classList.toggle('hidden', !open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            for (const other of Object.keys(POPOVERS)) if (other !== name) setPopover(other, false);
            $('updatePopover')?.classList.add('hidden');
            $('pixPopover')?.classList.add('hidden');
            if (name === 'bell') { lastBellSig = ''; renderBell(); }
            if (name === 'more') { syncMenuState(); renderLayoutSelect(); }
        }
    }
    let miniHudOpen = false;
    function syncMenuState() {
        const theme = window.nexoIcons?.getTheme() || 'marinho';
        const accent = window.nexoIcons?.accountAccent?.(activeAccount) || window.nexoIcons?.getAccent() || 'azul';
        document.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-checked', b.dataset.themePick === theme ? 'true' : 'false'));
        const bg = window.nexoIcons?.getBackdrop?.() || 'liso';
        document.querySelectorAll('[data-bg-pick]').forEach((b) => b.setAttribute('aria-checked', b.dataset.bgPick === bg ? 'true' : 'false'));
        $('bgCustom')?.classList.toggle('hidden', bg !== 'custom');
        $('bgIntSeg')?.classList.toggle('hidden', bg === 'liso');
        const bgi = window.nexoIcons?.getBackdropIntensity?.() || 'medio';
        document.querySelectorAll('[data-bgint-pick]').forEach((b) => b.setAttribute('aria-checked', b.dataset.bgintPick === bgi ? 'true' : 'false'));
        const cus = window.nexoIcons?.getBackdropCustom?.();
        if (cus) {
            if ($('bgC1') && document.activeElement !== $('bgC1')) $('bgC1').value = cus.c1;
            if ($('bgC2') && document.activeElement !== $('bgC2')) $('bgC2').value = cus.c2;
            if ($('bgElem')) $('bgElem').value = cus.elem;
        }
        document.querySelectorAll('[data-accent-pick]').forEach((b) => b.setAttribute('aria-checked', b.dataset.accentPick === accent ? 'true' : 'false'));
        document.querySelectorAll('[data-hud-pos]').forEach((b) => b.setAttribute('aria-checked', b.dataset.hudPos === hudPos ? 'true' : 'false'));
        window.applyToastPosition?.();
        $('btnPinActivityMenu')?.setAttribute('aria-checked', activityPinned ? 'true' : 'false');
        $('btnPinActivity')?.setAttribute('aria-pressed', activityPinned ? 'true' : 'false');
        $('btnPinActivity')?.classList.toggle('active-toggle', activityPinned);
        $('btnMiniHud')?.setAttribute('aria-checked', miniHudOpen ? 'true' : 'false');
        $('btnWvAutoZoom')?.setAttribute('aria-checked', window.nexoWvZoom?.isOn() ? 'true' : 'false');
        $('btnAwake')?.setAttribute('aria-checked', $('btnAwake')?.classList.contains('active-toggle') ? 'true' : 'false');
    }
    async function toggleMiniHud() {
        if (!window.pokeHub.toggleMiniHud) return;
        miniHudOpen = await window.pokeHub.toggleMiniHud();
        syncMenuState();
    }

    // ===== S27: acessibilidade e atalhos =====
    let lastAriaPass = 0;
    function ensureAria(force = false) {
        const now = Date.now();
        if (!force && now - lastAriaPass < 3000) return;
        lastAriaPass = now;
        document.querySelectorAll('button:not([aria-label])').forEach((b) => {
            if (b.textContent.trim()) return;
            const label = b.title || b.dataset.tip || '';
            if (label) b.setAttribute('aria-label', label);
        });
    }
    function isTyping(ev) {
        const t = ev.target;
        return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    }
    function onKey(ev) {
        if (ev.key === 'Escape') {
            if ($('hubOverlay')) { closeOverlay(); return; }
            for (const name of Object.keys(POPOVERS)) setPopover(name, false);
            hideTip();
            return;
        }
        if (ev.ctrlKey || ev.altKey || ev.metaKey || isTyping(ev)) return;
        const k = ev.key;
        if (k === '?') { ev.preventDefault(); showShortcuts(); return; }
        if (POPOUT) return;
        if (/^[1-4]$/.test(k)) { flushSave(); selectAccount(Number(k)); return; }
        const lower = k.toLowerCase();
        const modes = { s: 'split', g: 'grid', p: 'panel-only', c: 'panels-grid' };
        if (modes[lower]) { setViewMode(modes[lower]); return; }
        if (lower === 'a') { setActivityPinned(!activityPinned); return; }
        if (lower === 'b') { setPopover('bell', $('bellPopover')?.classList.contains('hidden')); return; }
        if (lower === 'h') { void toggleMiniHud(); return; }
        if (lower === 'm' && webviews.has(activeAccount)) { setAccountMuted(activeAccount, !isAccountMuted(activeAccount)); return; }
        if (k === '[' || k === ']') {
            const cur = document.querySelector('.subtab.active')?.dataset.subtab || 'overview';
            const i = PANELS.indexOf(cur);
            setSubtab(PANELS[(i + (k === ']' ? 1 : PANELS.length - 1)) % PANELS.length]);
        }
    }

    // ===== S13: modo janela solta =====
    function setupPopout() {
        document.body.classList.add('is-popout');
        document.body.dataset.popout = POPOUT;
        const acc = Number(params.get('acc')) || 1;
        const bar = document.createElement('header');
        bar.className = 'popout-bar';
        bar.innerHTML = `<span class="popout-title">${IC(POPOUT === 'activity' ? 'activity' : 'panel')}${PANEL_LABEL[POPOUT] || 'Painel'}</span>
          <nav class="popout-accs" aria-label="Contas">${ACCOUNTS.map((a) => `<button type="button" class="popout-acc" data-pop-acc="${a}" aria-label="Conta ${a}">${a}</button>`).join('')}</nav>
          <button type="button" class="icon-btn" id="btnPopoutHome" title="Mostrar o Hub" aria-label="Mostrar o Hub">${IC('external')}</button>`;
        document.querySelector('.control-pane')?.prepend(bar);
        bar.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-pop-acc]');
            if (b) selectAccount(Number(b.dataset.popAcc));
            if (ev.target.closest('#btnPopoutHome')) void window.pokeHub.showMain?.(activeAccount);
        });
        document.title = `${PANEL_LABEL[POPOUT] || 'Painel'} · Nexo PokeBot`;
        // mostra só o painel pedido
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${POPOUT}`));
        document.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b.dataset.subtab === POPOUT));
        if (acc !== activeAccount) selectAccount(acc);
    }
    function renderPopoutBar() {
        document.querySelectorAll('[data-pop-acc]').forEach((b) => {
            const a = Number(b.dataset.popAcc);
            b.classList.toggle('active', a === activeAccount);
            b.className = `popout-acc ${stateClass(a)}${a === activeAccount ? ' active' : ''}`;
            b.title = `Conta ${a} · ${nickOf(a)}`;
        });
    }

    // ===== S14: cartões das 4 contas mais completos =====
    function renderPcardsExtra() {
        if (viewMode !== 'panels-grid') return;
        for (const card of document.querySelectorAll('#panelsGrid .pcard')) {
            const acc = Number(card.dataset.acc);
            let extra = card.querySelector('.pcard-extra');
            if (!extra) {
                extra = document.createElement('div');
                extra.className = 'pcard-extra';
                extra.innerHTML = '<div class="pcard-spark"></div><div class="pcard-sec-title" title="Quanto de cada buff das lives já foi assistido, perto da meta">Buffs das lives</div><div class="pcard-buffs"></div><div class="pcard-sec-title">Eventos recentes</div><ul class="pcard-events"></ul>';
                card.querySelector('.pcard-drops')?.after(extra);
                const panelBtn = card.querySelector('[data-pc-act="panel"]');
                if (panelBtn && !panelBtn.dataset.icon) { panelBtn.dataset.icon = 'panel'; window.nexoIcons?.hydrate(card); }
                const gameBtn = card.querySelector('[data-pc-act="game"]');
                if (gameBtn && !gameBtn.dataset.icon) { gameBtn.dataset.icon = 'gamepad'; window.nexoIcons?.hydrate(card); }
            }
            const list = hist[acc];
            const spark = extra.querySelector('.pcard-spark');
            const sparkSig = `${list.length}|${list[list.length - 1]?.t || 0}`;
            if (spark.dataset.sig !== sparkSig) {
                spark.dataset.sig = sparkSig;
                spark.innerHTML = `<span>${IC('zap')}XP/h</span>${sparkSvg(list.map((p) => p.xpRate), 'xp')}<span>${IC('coins')}Lucro/h</span>${sparkSvg(list.map((p) => p.goldRate), 'gold')}`;
            }
            const buffs = flatBuffsHtml(acc);
            const bbox = extra.querySelector('.pcard-buffs');
            if (bbox.innerHTML !== buffs) bbox.innerHTML = buffs;
            const evs = recentEvents(acc, 6);
            const ul = extra.querySelector('.pcard-events');
            const sig = evs.map((e) => e.id).join(',') + Math.floor(Date.now() / 30_000);
            if (ul.dataset.sig !== sig) {
                ul.dataset.sig = sig;
                const accColor = window.nexoIcons?.accountAccent?.(acc) || 'azul';
                ul.innerHTML = evs.map((e) => {
                    const meta = classifyLogEntry(e);
                    return `<li class="ev ${esc(meta.vKind)}" data-acc="${acc}" data-acc-color="${esc(accColor)}">${IC(meta.icon)}<span class="ev-text">${escapeHtml(meta.cleanText)}</span><time>${relTime(e.ts)}</time></li>`;
                }).join('') || '<li class="ev empty">Sem eventos ainda.</li>';
            }
        }
    }

    function fmtSumUptime(sec) {
        const sNum = Math.max(0, Math.floor(Number(sec) || 0));
        const h = Math.floor(sNum / 3600);
        const m = Math.floor((sNum % 3600) / 60);
        const sc = sNum % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}`;
    }

    function renderWvSummaries() {
        for (const acc of ACCOUNTS) {
            const box = $(`wv-summary-${acc}`);
            if (!box || box.hidden) continue;
            const s = snapshots[acc] || {};
            const st = s.stats || {};
            const pk = s.activePokemon;
            const dr = s.drops || {};
            const hitDrops = (dr.featured || []).filter((d) => d.qty > 0).slice(0, 3);
            const list = hist[acc] || [];
            const evs = recentEvents(acc, 4);
            const buffs = flatBuffsHtml(acc);
            const profitH = Number(st.netGoldPerHour ?? st.goldPerHour ?? 0) || 0;
            const pct = pk ? Math.max(0, Math.min(100, Number(pk.hpPercent) || 0)) : 0;
            const hpColor = pct > 55 ? 'var(--green)' : pct > 25 ? 'var(--amber)' : 'var(--red)';
            const pkDex = pk ? resolvePokemonSpriteDex(pk.speciesId, pk.name, pk.spriteDex) : 0;
            const url = pkDex > 0 ? pokemonSpriteUrl(pk.speciesId, Boolean(pk.shiny), pkDex, pk.name) : '';
            const curDock = box.closest('.wv-slot')?.dataset?.summaryDock || 'right';
            const density = box.dataset.sumDensity === 'full' ? 'full' : 'compact';

            const sig = [
                acc, curDock, density,
                pk?.speciesId, pk?.shiny, pk?.name, pk?.level, pk?.hp, pk?.maxHp, pct,
                st.xpPerHour, profitH, st.kills, st.captures, st.shiniesCaptured,
                st.avgKillSec, st.capturePerKillPct,
                density === 'full' ? hitDrops.map((d) => `${d.key}:${d.qty}`).join(',') : '',
                list.length, list[list.length - 1]?.t || 0,
                density === 'full' ? evs.map((e) => e.id).join(',') : '',
                density === 'full' ? Math.floor(Date.now() / 30_000) : 0,
                density === 'full' ? buffs.length : 0,
            ].join('|');
            // O tempo ativo muda todo segundo: fica fora da assinatura e é trocado só no próprio
            // texto, em vez de redesenhar o resumo inteiro (4 telas x 1 vez por segundo).
            const uptimeTxt = fmtSumUptime(st.uptimeSec);
            if (box.dataset.sig === sig) {
                const up = box.querySelector('[data-sum-uptime]');
                if (up && up.textContent !== uptimeTxt) up.textContent = uptimeTxt;
                continue;
            }
            box.dataset.sig = sig;


            const capPctStr = st.kills > 0 ? `${String(st.capturePerKillPct || 0).replace('.', ',')}%` : '-';
            const headHtml = `
              <div class="wv-sum-head">
                <span class="wv-sum-title">${density === 'compact' ? 'Resumo' : 'Visão geral'}</span>
                <div class="wv-sum-pos" role="group" aria-label="Sidebar da conta ${acc}">
                  <button type="button" class="wv-sum-btn" data-sum-density="${density === 'compact' ? 'full' : 'compact'}" data-slot="${acc}" title="${density === 'compact' ? 'Mostrar detalhes completos nesta conta' : 'Mostrar só o resumo nesta conta'}">${density === 'compact' ? 'Detalhes' : 'Resumir'}</button>
                  <button type="button" class="wv-sum-btn${curDock === 'left' ? ' active' : ''}" data-sum-pos="left" data-slot="${acc}" title="Sidebar à esquerda nesta conta">Esq</button>
                  <button type="button" class="wv-sum-btn${curDock === 'right' ? ' active' : ''}" data-sum-pos="right" data-slot="${acc}" title="Sidebar à direita nesta conta">Dir</button>
                  <button type="button" class="wv-sum-btn${curDock === 'bottom' ? ' active' : ''}" data-sum-pos="bottom" data-slot="${acc}" title="Sidebar embaixo nesta conta">Baixo</button>
                  <button type="button" class="wv-sum-btn close" data-sum-pos="close" data-slot="${acc}" title="Remover sidebar desta conta">×</button>
                </div>
              </div>`;

            const pokeHtml = `
              <div class="wv-sum-poke">
                <div class="wv-sum-sprite${pk?.shiny ? ' shiny' : ''}">${url ? `<img src="${esc(url)}" alt="" data-sprite-dex="${pkDex}" data-sprite-shiny="${pk?.shiny ? '1' : '0'}" data-sprite-step="0" data-sprite-fallback-text="?" />` : '?'}</div>
                <div class="wv-sum-poke-info">
                  <div class="wv-sum-poke-name">${pk ? `${pk.shiny ? '★ ' : ''}${escapeHtml(pk.name)} Nv ${pk.level}` : 'Aguardando Pokémon'}</div>
                  <div class="wv-sum-hp"><i style="width:${pct}%;background:${hpColor}"></i></div>
                  <div class="wv-sum-hp-txt">${pk ? `${fmtNum(pk.hp)} / ${fmtNum(pk.maxHp)} HP (${pct}%)` : ''}</div>
                </div>
              </div>`;

            const sparkHtml = `<div class="wv-sum-spark">
              <span>${IC('zap')}XP/h</span>${sparkSvg(list.map((p) => p.xpRate), 'xp')}
              <span>${IC('coins')}Lucro/h</span>${sparkSvg(list.map((p) => p.goldRate), 'gold')}
            </div>`;

            if (density === 'compact') {
                const compactTiles = [
                    ['XP/h', fmtCompact(st.xpPerHour), ''],
                    ['Lucro/h', signed(profitH), profitH < 0 ? 'neg' : ''],
                    ['Capturas', `${fmtNum(st.captures)}${capPctStr !== '-' ? ` (${capPctStr})` : ''}`, ''],
                    ['Shinies', fmtNum(st.shiniesCaptured), ''],
                ];
                const kpisHtml = `<dl class="wv-sum-kpis">${compactTiles.map(([k, v, cls]) =>
                    `<div${cls ? ` class="${cls}"` : ''}><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`
                ).join('')}</dl>`;
                const metaHtml = `<div class="wv-sum-compact-meta">Abates: <b>${fmtNum(st.kills)}</b> · Ativo: <b data-sum-uptime>${uptimeTxt}</b></div>`;
                box.innerHTML = headHtml + pokeHtml + kpisHtml + metaHtml + sparkHtml;
                continue;
            }

            const tiles = [
                ['XP/h', fmtCompact(st.xpPerHour), ''],
                ['Lucro/h', signed(profitH), profitH < 0 ? 'neg' : ''],
                ['Abates', fmtNum(st.kills), ''],
                ['Capturas', fmtNum(st.captures), ''],
                ['Shinies', fmtNum(st.shiniesCaptured), ''],
                ['Tempo/abate', st.avgKillSec > 0 ? `${String(st.avgKillSec).replace('.', ',')}s` : '-', ''],
                ['Cap./abate', capPctStr, ''],
                ['Ativo', uptimeTxt, 'uptime'],
            ];

            const kpisHtml = `<dl class="wv-sum-kpis">${tiles.map(([k, v, cls]) =>
                `<div${cls ? ` class="${cls}"` : ''}><dt>${escapeHtml(k)}</dt><dd${cls === 'uptime' ? ' data-sum-uptime' : ''}>${escapeHtml(String(v))}</dd></div>`
            ).join('')}</dl>`;

            const dropsHtml = `<div class="wv-sum-drops">${hitDrops.length
                ? `Drops: ${hitDrops.map((d) => `${escapeHtml(d.name)} x${d.qty}`).join(' · ')}`
                : 'Drops da sessão: nenhum ainda'}</div>`;

            const buffsSection = buffs
                ? `<div class="wv-sum-sec">Buffs das lives</div><div class="pcard-buffs wv-sum-buffs">${buffs}</div>`
                : '';

            const accColor = window.nexoIcons?.accountAccent?.(acc) || 'azul';
            const eventsHtml = `<div class="wv-sum-sec">Eventos recentes</div><ul class="wv-sum-events">${evs.map((e) => {
                const meta = classifyLogEntry(e);
                return `<li class="ev ${esc(meta.vKind)}" data-acc="${acc}" data-acc-color="${esc(accColor)}">${IC(meta.icon)}<span class="ev-text">${escapeHtml(meta.cleanText)}</span><time>${relTime(e.ts)}</time></li>`;
            }).join('') || '<li class="ev empty">Sem eventos ainda.</li>'}</ul>`;

            box.innerHTML = headHtml + pokeHtml + kpisHtml + dropsHtml + sparkHtml + buffsSection + eventsHtml;
        }
    }

    // ===== ganchos chamados pelo renderer =====
    function applyAccountColors() {
        const ni = window.nexoIcons;
        if (!ni?.accountAccent) return;
        ni.applyAccountAccent(activeAccount);
        for (const acc of ACCOUNTS) {
            const c = ni.accountAccent(acc);
            for (const el of document.querySelectorAll(`[data-acc="${acc}"], [data-pop-acc="${acc}"], #wv-slot-${acc}`)) {
                if (el.dataset.accColor !== c) el.dataset.accColor = c;
            }
        }
        const name = $('accentAccName');
        const label = `Conta ${activeAccount}`;
        if (name && name.textContent !== label) name.textContent = label;
    }
    function afterRender() {
        sampleHistory();
        updateShinyFlash();
        applyAccountColors();
        if (POPOUT) {
            renderPopoutBar();
            renderHero();
            renderOverviewExtras();
            renderScope();
            ensureAria();
            return;
        }
        renderTabs();
        renderHero();
        updateAllRecords();
        renderRecordsStrip();
        renderCustomPresets();
        renderOverviewExtras();
        for (const acc of ACCOUNTS) {
            renderStageLive(acc);
            renderHud(acc);
        }
        renderPcardsExtra();
        renderWvSummaries();
        renderBell();
        renderScope();
        renderActivityBadge();
        if (activityPinned) renderLogView(logViews.get('dock'));
        if (undoState && Date.now() > undoState.until) {
            undoState = null;
            $('btnCfgUndo')?.remove();
        }
        ensureAria();
    }
    function onSubtab(tab) {
        if (POPOUT) {
            document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
            return true;
        }
        if (!dockActive()) return false;
        if (dockCols.includes(tab)) {
            const col = document.querySelectorAll('.dock-col')[dockCols.indexOf(tab)];
            col?.classList.add('pulse');
            setTimeout(() => col?.classList.remove('pulse'), 600);
            return true;
        }
        setColPanel(Math.min(focusCol, dockCols.length - 1), tab);
        return true;
    }
    function routeToast(opts) {
        if (POPOUT) return true;
        if (Date.now() < suppressToastsUntil) return true;
        if (opts.account && slotVisibleInGrid(opts.account) && isEmbedded(opts.account)) {
            slotToast(opts.account, opts);
            return true;
        }
        return false;
    }
    function recordEvent(e) {
        eventLog.push(e);
        if (eventLog.length > 200) eventLog.splice(0, eventLog.length - 200);
    }
    function renderMainLog() {
        const view = logViews.get('main') || mountLogView($('logViewMain'), 'main', { scope: 'acc' });
        if (!view) return false;
        renderLogView(view);
        return true;
    }

    // ===== Buffs das lives: resumo usado na Visão geral e no painel vivo =====
    const LB_KINDS = [['xp', 'XP'], ['captura', 'Captura'], ['shiny', 'Shiny']];
    const LB_KIND_LABEL = { xp: 'XP', captura: 'Captura', shiny: 'Shiny' };
    const fmtBuffMin = (m) => {
        const v = Math.max(0, Math.round(Number(m) || 0));
        if (v >= 1440) return `${Math.floor(v / 1440)}d ${Math.floor((v % 1440) / 60)}h`;
        return v >= 60 ? `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m` : `${v}m`;
    };
    /** Barras flat dos buffs (uma por tipo, Kick + Twitch juntas) com o tempo de cada plataforma. */
    function flatBuffsHtml(acc, { foot = false } = {}) {
        const lv = snapshots[acc]?.lives;
        if (!lv) return '';
        const bonus = lv.activeBonuses || {};
        const target = Math.max(30, Number(lv.targetHours || 24) * 60);
        const twList = Array.isArray(lv.twitchRewards) ? lv.twitchRewards : [lv.rewardType || 'xp'];
        const kkList = Array.isArray(lv.kickRewards) ? lv.kickRewards : [lv.rewardType || 'xp'];
        const fmtMinShort = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);
        const rows = BUFF_KINDS.map(([k, label]) => {
            const twOn = Boolean(lv.hasTwitchToken) && twList.includes(k);
            const kkOn = Boolean(lv.hasKickToken) && kkList.includes(k);
            const twMin = Number(bonus.twitch?.[k] || 0);
            const kkMin = Number(bonus.kick?.[k] || 0);
            let pct;
            if (twOn && kkOn) pct = ((Math.min(twMin, target) + Math.min(kkMin, target)) / (2 * target)) * 100;
            else if (twOn) pct = (twMin / target) * 100;
            else if (kkOn) pct = (kkMin / target) * 100;
            else pct = (Math.max(twMin, kkMin) / target) * 100;
            pct = Math.min(100, pct);
            const parts = [];
            if (kkOn || kkMin > 0) parts.push(`Kick ${kkMin > 0 ? fmtMinShort(kkMin) : '-'}`);
            if (twOn || twMin > 0) parts.push(`Twitch ${twMin > 0 ? fmtMinShort(twMin) : '-'}`);
            const val = parts.length ? parts.join(' · ') : 'não coleta';
            const tip = `${label}: Kick ${fmtMinShort(kkMin)} + Twitch ${fmtMinShort(twMin)} (meta individual: ${fmtMinShort(target)} cada)`;
            return `<span class="pbuff ${k}" title="${esc(tip)}"><b>${label}</b><i><u style="width:${pct.toFixed(0)}%"></u></i><small>${escapeHtml(val)}</small></span>`;
        }).join('');
        if (!foot) return rows;
        const next = [];
        for (const [p, pl] of [['kick', 'Kick'], ['twitch', 'Twitch']]) {
            const k = lv.smartStatus?.[p]?.nextKind;
            if (lv.smartBalance && k) next.push(`${LB_KIND_LABEL[k] || k} na ${pl}`);
        }
        const f = [lv.enabled ? 'Coleta ligada' : 'Coleta desligada', `meta ${fmtMinShort(target)}`, next.length ? `próximo: ${next.join(', ')}` : ''].filter(Boolean).join(' · ');
        return `<div class="pcard-buffs pbuffs-wide">${rows}</div><div class="lb-foot">${escapeHtml(f)}</div>`;
    }
    function buffsHtml(acc, compact = false) {
        const lv = snapshots[acc]?.lives;
        if (!lv) return '';
        const bonus = lv.activeBonuses || {};
        const plats = [
            ['kick', 'Kick', 'kk', Boolean(lv.hasKickToken), lv.kickRewards],
            ['twitch', 'Twitch', 'tw', Boolean(lv.hasTwitchToken), lv.twitchRewards],
        ];
        const kinds = LB_KINDS.map(([k, label]) => {
            let activeCount = 0;
            const rows = plats.map(([p, pl, cls, tok, listRaw]) => {
                const list = Array.isArray(listRaw) ? listRaw : [lv.rewardType || 'xp'];
                const m = Math.max(0, Number(bonus[p]?.[k]) || 0);
                if (m > 0) activeCount += 1;
                const collects = tok && list.includes(k);
                const txt = !tok ? 'sem conta' : m > 0 ? fmtBuffMin(m) : collects ? 'sem buff' : 'não coleta';
                const st = !tok ? 'off' : m <= 0 ? (collects ? 'empty' : 'off') : m <= 30 ? 'low' : 'ok';
                return `<div class="lb-row ${st}"><span class="plat-badge ${cls}">${pl}</span><span class="lb-time">${txt}</span></div>`;
            }).join('');
            const tag = activeCount ? `+${activeCount * 15}%` : 'parado';
            return `<div class="lb-kind ${k}${activeCount ? ' on' : ''}"><div class="lb-head"><i></i><b>${label}</b><span class="lb-tag" title="Cada plataforma com o buff ativo soma +15%">${tag}</span></div>${rows}</div>`;
        }).join('');
        const next = [];
        for (const [p, pl] of plats) {
            const k = lv.smartStatus?.[p]?.nextKind;
            if (lv.smartBalance && k) next.push(`${LB_KIND_LABEL[k] || k} na ${pl}`);
        }
        const foot = [
            lv.enabled ? 'Coleta ligada' : 'Coleta desligada',
            next.length ? `próximo: ${next.join(', ')}` : '',
            compact ? '' : `${fmtNum(lv.minutesWatched || 0)} min assistidos`,
            compact ? '' : `${fmtNum(lv.chestsClaimed || 0)} baús +50`,
        ].filter(Boolean).join(' · ');
        return `<div class="lb-grid">${kinds}</div><div class="lb-foot">${escapeHtml(foot)}</div>`;
    }
    const COL_MODE_LABEL = { off: 'Farm normal', pokedex: 'Completar Pokédex', topcatch: 'Top Catch', bestiary: 'Bestiário', 'team-pvp': 'Montar Time PvP' };
    function renderOverviewExtras() {
        const s = snapshots[activeAccount] || {};
        const box = $('ovBuffs');
        if (box) {
            const html = buffsHtml(activeAccount) || '<span class="hint-text">Conecte a conta para ver os buffs.</span>';
            if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
        }
        const flatHtml = flatBuffsHtml(activeAccount, { foot: true }) || '<span class="hint-text">Conecte a conta para ver os buffs.</span>';
        for (const id of ['ovBuffsFlat', 'buffFlat']) {
            const fb = $(id);
            if (fb && fb.dataset.sig !== flatHtml) { fb.dataset.sig = flatHtml; fb.innerHTML = flatHtml; }
        }
        syncBuffViewButtons();
        const pill = $('colModePill');
        if (pill) {
            const mode = s.collection?.mode || s.config?.farmObjective || 'off';
            const txt = COL_MODE_LABEL[mode] || mode;
            if (pill.textContent !== txt) pill.textContent = txt;
            pill.classList.toggle('on', mode !== 'off');
        }
    }

    // ===== Recordes Históricos da Conta (nexo.records.v1) & Perfis de Farm (Presets) =====
    const RECORDS_KEY = 'nexo.records.v1';
    const streakTracker = {};
    function readRecordsMap() {
        const raw = LS.get(RECORDS_KEY, {});
        return raw && typeof raw === 'object' ? raw : {};
    }
    function updateAllRecords() {
        const map = readRecordsMap();
        let changed = false;
        const now = Date.now();
        for (const acc of ACCOUNTS) {
            const s = snapshots[acc];
            const st = s?.stats;
            if (!st) continue;
            const key = String(acc);
            const rec = map[key] || { xpH: 0, profitH: 0, capPct: 0, noDeathStreak: 0 };
            const kills = Number(st.kills || 0);
            const deaths = Number(st.playerDeaths || 0);
            const tr = streakTracker[acc] || { lastKills: kills, lastDeaths: deaths, streak: 0 };
            if (kills < tr.lastKills || deaths > tr.lastDeaths) {
                tr.streak = 0;
            } else {
                tr.streak += Math.max(0, kills - tr.lastKills);
            }
            tr.lastKills = kills;
            tr.lastDeaths = deaths;
            streakTracker[acc] = tr;

            const xpH = Number(st.xpPerHour || 0);
            const profitH = Number(st.netGoldPerHour ?? st.goldPerHour ?? 0);
            const capPct = kills >= 15 ? Number(st.capturePerKillPct ?? ((Number(st.captures || 0) / kills) * 100)) : 0;

            if (xpH > Number(rec.xpH || 0)) { rec.xpH = Math.round(xpH); rec.xpAt = now; changed = true; }
            if (profitH > Number(rec.profitH || 0)) { rec.profitH = Math.round(profitH); rec.profitAt = now; changed = true; }
            if (capPct > Number(rec.capPct || 0)) { rec.capPct = Math.round(capPct * 10) / 10; rec.capAt = now; changed = true; }
            if (tr.streak > Number(rec.noDeathStreak || 0)) { rec.noDeathStreak = tr.streak; rec.streakAt = now; changed = true; }
            map[key] = rec;
        }
        if (changed) LS.set(RECORDS_KEY, map);
    }
    function renderRecordsStrip() {
        const box = $('recordsStrip');
        if (!box) return;
        const rec = readRecordsMap()[String(activeAccount)] || {};
        const hasAny = rec.xpH > 0 || rec.profitH > 0 || rec.capPct > 0 || rec.noDeathStreak > 0;
        box.classList.toggle('hidden', !hasAny);
        if (!hasAny) return;
        const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('pt-BR') : '');
        const sig = `${activeAccount}|${rec.xpH}|${rec.profitH}|${rec.capPct}|${rec.noDeathStreak}`;
        if (box.dataset.sig === sig) return;
        box.dataset.sig = sig;
        box.innerHTML = `<div class="records-head"><span>${IC('trophy')}Recordes da Conta ${activeAccount}</span><button type="button" class="link-btn" id="btnResetRecords" title="Zerar recordes históricos desta conta">Limpar</button></div>` +
            `<div class="records-grid">` +
            `<span class="rec-pill" title="Maior XP/h (${fmtDate(rec.xpAt)})">XP/h: <b>${fmtCompact(rec.xpH || 0)}</b></span>` +
            `<span class="rec-pill" title="Maior Lucro/h (${fmtDate(rec.profitAt)})">Lucro/h: <b>${signed(rec.profitH || 0)}</b></span>` +
            `<span class="rec-pill" title="Melhor Capturas/abate com >=15 abates (${fmtDate(rec.capAt)})">Cap/abate: <b>${String(rec.capPct || 0).replace('.', ',')}%</b></span>` +
            `<span class="rec-pill" title="Maior sequência sem morte (${fmtDate(rec.streakAt)})">Sem morte: <b>${fmtNum(rec.noDeathStreak || 0)}</b></span>` +
            `</div>`;
    }

    const PRESETS_KEY = 'nexo.farmPresets.v1';
    const BUILTIN_PRESETS = {
        topcatch: {
            label: 'Top Catch',
            config: { farmObjective: 'topcatch', farmObjectiveFocus: 'fast', huntGuideMode: 'auto', caidosEnabled: true, ballEconomy: false, preferredBall: 'auto', restockEnabled: true },
        },
        outland: {
            label: 'Outland Lucro',
            config: { farmObjective: 'off', huntGuideMetric: 'ouro', huntGuideMode: 'auto', caidosEnabled: true, ballEconomy: true, autoCraftShinyEgg: true, autoExtendListings: true, autoOptimizeGear: true },
        },
        shiny: {
            label: 'Shiny & Safari',
            config: { farmObjective: 'off', huntGuideMetric: 'shiny', huntGuideMode: 'auto', caidosEnabled: true, ballEconomy: false, preferredBall: 'ultra', autoCraftShinyEgg: true, autoMisticoEnter: true },
        },
        afk: {
            label: 'Madrugada AFK',
            config: { caidosEnabled: true, ensureNativeAutoHeal: true, restockEnabled: true, minGoldReserve: 250000, targetPotions: 80, targetRevives: 40, ballEconomy: true, standbyOn4001: true, autoCraftShinyEgg: true },
        },
    };
    async function applyFarmPreset(label, config) {
        if (!config) return;
        const res = await applyConfigTo(activeAccount, config);
        dirtyByAcc[activeAccount] = false;
        renderActiveAccountPanel();
        if (res?.ok !== false) {
            setSaveState(`${IC('check')}Perfil "${escapeHtml(label)}" aplicado`, 'ok');
            window.nexoToast?.({ kind: 'ok', title: `Perfil: ${label}`, text: `Configurações aplicadas na Conta ${activeAccount}.`, account: activeAccount });
        }
    }
    function renderCustomPresets() {
        const list = $('presetCustomList');
        if (!list) return;
        const custom = LS.get(PRESETS_KEY, {});
        const names = Object.keys(custom).sort();
        const sig = names.join('|');
        if (list.dataset.sig === sig) return;
        list.dataset.sig = sig;
        list.innerHTML = names.length
            ? names.map((n) => `<span class="preset-chip"><button type="button" class="preset-chip-apply" data-custom-preset="${esc(n)}">${escapeHtml(n)}</button><button type="button" class="preset-chip-del" data-del-preset="${esc(n)}" aria-label="Excluir perfil ${esc(n)}">×</button></span>`).join('')
            : '';
    }

    // ===== Cards: fechar, recolher e devolver =====
    const CARD_LABEL = {
        poke: 'Pokémon ativo', buffs: 'Buffs das lives', collection: 'Pokédex e Top Catch', perf: 'Desempenho',
        events: 'Eventos, Bosses e PvP',
        drops: 'Drops', inv: 'Mochila', quick: 'Ações rápidas',
        presets: 'Perfis de Farm', hunt: 'Hunt e objetivo', routines: 'Rotinas',
        prefs: 'Preferências', prey: 'Prey e Auto-Coleção', utilities: 'Sacrifício, Refino e Utilidades',
        trainer: 'Treinador (Exp. Share e Casas)', sniper: 'Sniper do Mercado',
        advisor: 'Consultor de Economia',
        alerts: 'Alertas', conn: 'Contas vinculadas', liveStats: 'Recompensas da conta',
        channels: 'Canais e chat', activityLog: 'Registro de eventos', shinyFeed: 'Shinies do servidor',
    };
    let cardState = LS.get('nexo.cards', null);
    function sanitizeCards() {
        if (!cardState || typeof cardState !== 'object') cardState = {};
        const clean = (a) => (Array.isArray(a) ? [...new Set(a.filter((k) => CARD_LABEL[k]))] : []);
        const order = {};
        if (cardState.order && typeof cardState.order === 'object') {
            for (const [panel, keys] of Object.entries(cardState.order)) {
                if (/^tab-[a-z]+$/.test(panel)) { const k = clean(keys); if (k.length) order[panel] = k; }
            }
        }
        cardState = { hidden: clean(cardState.hidden), collapsed: clean(cardState.collapsed), resumo: clean(cardState.resumo), order };
    }
    const DEFAULT_ORDER = {};
    // Cards com versão resumida: o CSS esconde o que é detalhe em .card.is-resumo.
    const RESUMO_CARDS = new Set(['poke', 'collection', 'perf', 'events', 'drops', 'inv', 'routines', 'prefs', 'prey', 'utilities', 'trainer', 'advisor', 'alerts', 'conn', 'liveStats', 'channels', 'activityLog', 'shinyFeed']);
    const panelCards = (panel) => [...panel.querySelectorAll(':scope > .card[data-card]')];
    // Reposiciona os cards na ordem salva usando os lugares que eles já ocupam:
    // barras e avisos que não são card ficam onde estão.
    function applyCardOrder() {
        document.querySelectorAll('.tab-panel').forEach((panel) => {
            const cards = panelCards(panel);
            if (cards.length < 2) return;
            const want = cardState.order[panel.id] || DEFAULT_ORDER[panel.id];
            if (!want) return;
            const rank = (c) => { const i = want.indexOf(c.dataset.card); return i < 0 ? 999 + cards.indexOf(c) : i; };
            const sorted = [...cards].sort((a, b) => rank(a) - rank(b));
            if (sorted.every((c, i) => c === cards[i])) return;
            const marks = cards.map((c) => { const m = document.createComment(''); c.before(m); return m; });
            sorted.forEach((c, i) => marks[i].replaceWith(c));
        });
    }
    function saveCardOrder(panel) {
        const keys = panelCards(panel).map((c) => c.dataset.card);
        if (keys.join() === (DEFAULT_ORDER[panel.id] || []).join()) delete cardState.order[panel.id];
        else cardState.order[panel.id] = keys;
        saveCards();
        applyCards();
    }
    let dragCard = null;
    function setupCardDrag() {
        document.addEventListener('pointerdown', (ev) => {
            const grip = ev.target.closest('[data-card-act="drag"]');
            const card = grip?.closest('.card[data-card]');
            if (card) card.draggable = true;
        });
        document.addEventListener('pointerup', () => {
            if (!dragCard) document.querySelectorAll('.card[draggable="true"]').forEach((c) => { c.draggable = false; });
        });
        document.addEventListener('dragstart', (ev) => {
            const card = ev.target.closest?.('.card[data-card][draggable="true"]');
            if (!card) return;
            dragCard = card;
            ev.dataTransfer.effectAllowed = 'move';
            try { ev.dataTransfer.setData('text/plain', card.dataset.card); } catch { /* ignore */ }
            document.body.classList.add('dragging-card');
            setTimeout(() => card.classList.add('card-dragging'), 0);
        });
        document.addEventListener('dragover', (ev) => {
            if (!dragCard) return;
            const over = ev.target.closest?.('.card[data-card]');
            if (!over || over.parentElement !== dragCard.parentElement) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'move';
            if (over === dragCard) return;
            const r = over.getBoundingClientRect();
            const after = ev.clientY > r.top + r.height / 2;
            if (after && over.nextElementSibling !== dragCard) over.after(dragCard);
            else if (!after && over.previousElementSibling !== dragCard) over.before(dragCard);
        });
        document.addEventListener('drop', (ev) => { if (dragCard) ev.preventDefault(); });
        document.addEventListener('dragend', () => {
            if (!dragCard) return;
            const card = dragCard;
            dragCard = null;
            card.draggable = false;
            card.classList.remove('card-dragging');
            document.body.classList.remove('dragging-card');
            const panel = card.closest('.tab-panel');
            if (panel) saveCardOrder(panel);
        });
    }
    sanitizeCards();
    const saveCards = () => LS.set('nexo.cards', cardState);
    function setupCards() {
        document.querySelectorAll('.card[data-card]').forEach((card) => {
            if (card.dataset.cardReady) return;
            let head = card.querySelector(':scope > .card-head-row');
            if (!head) {
                const h3 = card.querySelector(':scope > h3');
                if (!h3) return;
                head = document.createElement('div');
                head.className = 'card-head-row';
                h3.before(head);
                head.append(h3);
            }
            card.dataset.cardReady = '1';
            head.classList.add('has-tools');
            const name = CARD_LABEL[card.dataset.card] || 'card';
            const tools = document.createElement('span');
            tools.className = 'card-tools';
            const dense = RESUMO_CARDS.has(card.dataset.card)
                ? `<button type="button" class="icon-btn card-tool card-dense" data-card-act="dense" aria-label="Resumo ou detalhado: ${esc(name)}">${IC('layout')}</button>`
                : '';
            tools.innerHTML = dense + `<button type="button" class="icon-btn card-tool card-grip" data-card-act="drag" title="Arraste para mudar a ordem dos cards" aria-label="Mover ${esc(name)}">${IC('grip')}</button>`
                + `<button type="button" class="icon-btn card-tool" data-card-act="collapse" title="Recolher ou abrir (clique no título também)" aria-label="Recolher ${esc(name)}">${IC('chevron')}</button>`
                + `<button type="button" class="icon-btn card-tool" data-card-act="hide" title="Fechar este card. Ele volta pelo rodapé da aba." aria-label="Fechar ${esc(name)}">${IC('x')}</button>`;
            head.append(tools);
        });
        document.querySelectorAll('.tab-panel').forEach((panel) => {
            if (!DEFAULT_ORDER[panel.id]) DEFAULT_ORDER[panel.id] = panelCards(panel).map((c) => c.dataset.card);
            if (!panel.querySelector('.card[data-card]') || panel.querySelector(':scope > .cards-restore')) return;
            const bar = document.createElement('div');
            bar.className = 'cards-restore hidden';
            panel.append(bar);
        });
        applyCards();
    }
    function applyCards() {
        applyCardOrder();
        const hidden = new Set(cardState.hidden);
        const collapsed = new Set(cardState.collapsed);
        const resumo = new Set(cardState.resumo);
        document.querySelectorAll('.card[data-card]').forEach((card) => {
            const k = card.dataset.card;
            const short = RESUMO_CARDS.has(k) && resumo.has(k);
            card.classList.toggle('is-resumo', short);
            const dense = card.querySelector('[data-card-act="dense"]');
            if (dense) {
                dense.setAttribute('aria-pressed', String(short));
                dense.title = short ? 'Versão resumida. Clique para ver a detalhada' : 'Versão detalhada. Clique para resumir';
            }
            card.classList.toggle('card-off', hidden.has(k));
            card.classList.toggle('is-collapsed', collapsed.has(k));
            card.querySelector('[data-card-act="collapse"]')?.setAttribute('aria-expanded', String(!collapsed.has(k)));
        });
        document.querySelectorAll('.tab-panel > .cards-restore').forEach((bar) => {
            const keys = [...bar.parentElement.querySelectorAll('.card[data-card].card-off')].map((c) => c.dataset.card);
            const custom = Boolean(cardState.order[bar.parentElement.id]);
            bar.classList.toggle('hidden', !keys.length && !custom);
            const html = (keys.length
                ? `<span>${IC('eyeoff')}Cards fechados:</span>${keys.map((k) => `<button type="button" class="filter-pill" data-card-show="${esc(k)}" title="Mostrar de novo">${escapeHtml(CARD_LABEL[k] || k)}</button>`).join('')}`
                : '')
                + (custom ? `<button type="button" class="link-btn cards-reset" data-card-reset="${esc(bar.parentElement.id)}" title="Volta os cards desta aba para a ordem original">Ordem padrão</button>` : '');
            if (bar.dataset.sig !== html) { bar.dataset.sig = html; bar.innerHTML = html; }
        });
    }
    function toggleCardKey(list, k, on) {
        const set = new Set(cardState[list]);
        if (on) set.add(k); else set.delete(k);
        cardState[list] = [...set];
        saveCards();
        applyCards();
    }
    function onCardClick(ev) {
        const reset = ev.target.closest('[data-card-reset]');
        if (reset) { delete cardState.order[reset.dataset.cardReset]; saveCards(); applyCards(); return; }
        const show = ev.target.closest('[data-card-show]');
        if (show) { toggleCardKey('hidden', show.dataset.cardShow, false); return; }
        const act = ev.target.closest('[data-card-act]');
        const card = ev.target.closest('.card[data-card]');
        if (!card) return;
        const k = card.dataset.card;
        if (act?.dataset.cardAct === 'hide') { toggleCardKey('hidden', k, true); return; }
        if (act?.dataset.cardAct === 'drag') return;
        if (act?.dataset.cardAct === 'dense') { toggleCardKey('resumo', k, !cardState.resumo.includes(k)); return; }
        const onTitle = !act && ev.target.closest('.card-head-row > h3');
        if (act?.dataset.cardAct === 'collapse' || onTitle) toggleCardKey('collapsed', k, !cardState.collapsed.includes(k));
    }

    // ===== Painel lateral com largura arrastável (modo Painel + Jogo) =====
    const PANE_MIN = 380;
    let paneW = Number(LS.get('nexo.paneW', 0)) || 0;
    function applyPaneWidth() {
        const pane = document.querySelector('.control-pane');
        if (!pane) return;
        if (POPOUT || !paneW) {
            pane.style.removeProperty('width');
            pane.style.removeProperty('max-width');
            pane.style.removeProperty('min-width');
            return;
        }
        const max = Math.max(PANE_MIN, Math.round(window.innerWidth * 0.72));
        pane.style.width = `${Math.max(PANE_MIN, Math.min(max, paneW))}px`;
        pane.style.maxWidth = 'none';
        pane.style.minWidth = `${PANE_MIN}px`;
    }
    function ensurePaneResizer() {
        const pane = document.querySelector('.control-pane');
        if (!pane || POPOUT || pane.querySelector(':scope > .pane-resizer')) return;
        const grip = document.createElement('div');
        grip.className = 'pane-resizer';
        grip.title = 'Arraste para alargar o painel · duplo clique volta ao tamanho padrão';
        grip.setAttribute('role', 'separator');
        grip.setAttribute('aria-orientation', 'vertical');
        grip.setAttribute('aria-label', 'Largura do painel');
        pane.append(grip);
        grip.addEventListener('dblclick', () => { paneW = 0; LS.set('nexo.paneW', 0); applyPaneWidth(); });
        grip.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            grip.setPointerCapture(ev.pointerId);
            const startX = ev.clientX;
            const startW = pane.getBoundingClientRect().width;
            const dockRight = $('workspace')?.classList.contains('split-dock-right');
            document.body.classList.add('is-resizing');
            const move = (e) => {
                const delta = dockRight ? -(e.clientX - startX) : (e.clientX - startX);
                paneW = Math.round(startW + delta);
                applyPaneWidth();
            };
            const up = () => {
                grip.removeEventListener('pointermove', move);
                grip.removeEventListener('pointerup', up);
                document.body.classList.remove('is-resizing');
                paneW = Math.round(pane.getBoundingClientRect().width);
                LS.set('nexo.paneW', paneW);
            };
            grip.addEventListener('pointermove', move);
            grip.addEventListener('pointerup', up);
        });
        applyPaneWidth();
        window.addEventListener('resize', applyPaneWidth);
    }

    window.hubUi = {
        afterRender,
        onSubtab,
        onViewMode: () => { setPopover('more', false); },
        afterViewMode: () => { buildDock(); if (viewMode === 'grid') applyGridLayout(); renderWvSummaries(); },
        renderWvSummaries,
        onConfigDirty,
        routeToast,
        recordEvent,
        renderMainLog,
        isPopout: () => Boolean(POPOUT),
    };

    // ===== ligação dos controles =====
    function wire() {
        if (POPOUT) setupPopout();
        installTips();
        document.addEventListener('keydown', onKey);
        document.addEventListener('click', (ev) => {
            const tip = ev.target.closest('.tip');
            if (tip) { ev.preventDefault(); ev.stopPropagation(); showTip(tip); return; }
            hideTip();
            if (!ev.target.closest('#bellWrap')) setPopover('bell', false);
            if (!ev.target.closest('#moreWrap')) setPopover('more', false);
        }, true);
        document.addEventListener('mouseover', (ev) => {
            const tip = ev.target.closest?.('.tip');
            if (tip) showTip(tip);
        });
        document.addEventListener('mouseout', (ev) => { if (ev.target.closest?.('.tip')) hideTip(); });
        document.addEventListener('focusin', (ev) => { if (ev.target.classList?.contains('tip')) showTip(ev.target); });
        document.addEventListener('focusout', (ev) => { if (ev.target.classList?.contains('tip')) hideTip(); });

        $('btnBell')?.addEventListener('click', () => setPopover('bell', $('bellPopover').classList.contains('hidden')));
        $('btnMore')?.addEventListener('click', () => setPopover('more', $('moreMenu').classList.contains('hidden')));
        $('btnUpdateToggle')?.addEventListener('click', () => { setPopover('bell', false); setPopover('more', false); });
        $('btnPixToggle')?.addEventListener('click', () => { setPopover('bell', false); setPopover('more', false); });
        $('bellList')?.addEventListener('click', (ev) => {
            const act = ev.target.closest('[data-bell-act]');
            if (act) {
                const item = bellItems[Number(act.dataset.bell)];
                const fn = item?.actions?.[Number(act.dataset.bellAct)]?.[1];
                if (fn) fn();
                if (item && !/^(mw|err|pause|upd):/.test(item.key)) dismissBell([item.key]);
                return;
            }
            const x = ev.target.closest('[data-bell-dismiss]');
            if (x) dismissBell([bellItems[Number(x.dataset.bellDismiss)]?.key].filter(Boolean));
        });
        $('btnBellClear')?.addEventListener('click', () => dismissBell(bellItems.map((i) => i.key)));

        document.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => { window.nexoIcons?.setTheme(b.dataset.themePick); syncMenuState(); }));
        document.querySelectorAll('[data-bg-pick]').forEach((b) => b.addEventListener('click', () => { window.nexoIcons?.setBackdrop?.(b.dataset.bgPick); syncMenuState(); }));
        for (const [id, key] of [['bgC1', 'c1'], ['bgC2', 'c2']]) {
            $(id)?.addEventListener('input', (ev) => window.nexoIcons?.setBackdropCustom?.({ [key]: ev.target.value }));
        }
        document.querySelectorAll('[data-bgint-pick]').forEach((b) => b.addEventListener('click', () => { window.nexoIcons?.setBackdropIntensity?.(b.dataset.bgintPick); syncMenuState(); }));
        $('bgElem')?.addEventListener('change', (ev) => window.nexoIcons?.setBackdropCustom?.({ elem: ev.target.value }));
        document.querySelectorAll('[data-accent-pick]').forEach((b) => b.addEventListener('click', () => {
            const ni = window.nexoIcons;
            if (ni?.setAccountAccent) ni.setAccountAccent(activeAccount, b.dataset.accentPick);
            else ni?.setAccent(b.dataset.accentPick);
            applyAccountColors();
            syncMenuState();
        }));
        $('btnAccentAll')?.addEventListener('click', () => {
            const ni = window.nexoIcons;
            ni?.setAccountAccent?.(activeAccount, ni.accountAccent(activeAccount), true);
            applyAccountColors();
            syncMenuState();
        });
        document.querySelectorAll('[data-hud-pos]').forEach((b) => b.addEventListener('click', () => setHudPos(b.dataset.hudPos)));
        $('btnPinActivityMenu')?.addEventListener('click', () => setActivityPinned(!activityPinned));
        $('btnPinActivity')?.addEventListener('click', () => setActivityPinned(!activityPinned));
        $('btnMiniHud')?.addEventListener('click', () => void toggleMiniHud());
        $('btnWvAutoZoom')?.addEventListener('click', () => { window.nexoWvZoom?.set(!window.nexoWvZoom.isOn()); syncMenuState(); });
        $('btnShortcuts')?.addEventListener('click', showShortcuts);
        $('btnAwake')?.addEventListener('click', () => setTimeout(syncMenuState, 400));
        $('btnPopoutTab')?.addEventListener('click', () => {
            const tab = dockActive() && dockCols.length > 1 ? dockCols[focusCol] : (document.querySelector('.subtab.active')?.dataset.subtab || 'overview');
            void window.pokeHub.popout?.(tab, activeAccount);
        });
        window.pokeHub.onMiniHudState?.((open) => { miniHudOpen = open; syncMenuState(); });
        window.pokeHub.getMiniHudState?.().then((open) => { miniHudOpen = Boolean(open); syncMenuState(); }).catch(() => {});

        // layouts com nome
        $('btnLayoutSave')?.addEventListener('click', () => {
            $('layoutNameRow').classList.remove('hidden');
            $('layoutName').value = $('layoutSelect').value || '';
            $('layoutName').focus();
        });
        const saveNamed = () => {
            const name = $('layoutName').value.trim().slice(0, 32);
            if (!name) return;
            const layouts = LS.get(LAYOUTS_KEY, {});
            layouts[name] = currentLayout();
            LS.set(LAYOUTS_KEY, layouts);
            $('layoutNameRow').classList.add('hidden');
            renderLayoutSelect();
            $('layoutSelect').value = name;
        };
        $('btnLayoutNameOk')?.addEventListener('click', saveNamed);
        $('layoutName')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveNamed(); });
        $('layoutSelect')?.addEventListener('change', (ev) => {
            const layouts = LS.get(LAYOUTS_KEY, {});
            if (layouts[ev.target.value]) applyLayout(layouts[ev.target.value]);
        });
        $('btnLayoutDelete')?.addEventListener('click', () => {
            const sel = $('layoutSelect');
            const layouts = LS.get(LAYOUTS_KEY, {});
            if (!sel.value || !layouts[sel.value]) return;
            delete layouts[sel.value];
            LS.set(LAYOUTS_KEY, layouts);
            renderLayoutSelect();
        });

        // arrastar abas para as colunas do modo Só Painel
        document.querySelectorAll('.subtab[draggable]').forEach((b) => {
            b.addEventListener('dragstart', (ev) => {
                dragPanel = b.dataset.subtab;
                ev.dataTransfer.effectAllowed = 'move';
                ev.dataTransfer.setData('text/plain', dragPanel);
                document.body.classList.add('dragging-panel');
            });
            b.addEventListener('dragend', () => { dragPanel = ''; document.body.classList.remove('dragging-panel'); });
        });

        // configuração salva sozinha: o estado fica visível na barra do topo da aba
        if ($('cfgHint') && $('cfgScopeBar')) $('cfgScopeBar').append($('cfgHint'));
        $('cfgHint')?.addEventListener('click', (ev) => { if (ev.target.closest('#btnCfgUndo')) void undoSave(); });
        $('btnCopyCfg')?.addEventListener('click', () => void copyConfigToOthers());
        $('accountTabs')?.addEventListener('pointerdown', () => { if (savePending) void flushSave(); }, true);
        window.addEventListener('beforeunload', () => { if (savePending) void flushSave(); });

        // ausência
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) markAway();
            else markBack(true);
        });
        window.addEventListener('blur', () => { if (!document.hidden) markAway(); });
        window.addEventListener('focus', () => markBack(false));

        setupCards();
        setupCardDrag();
        document.addEventListener('click', onCardClick);
        $('recordsStrip')?.addEventListener('click', (ev) => {
            if (!ev.target.closest('#btnResetRecords')) return;
            const map = readRecordsMap();
            delete map[String(activeAccount)];
            LS.set(RECORDS_KEY, map);
            if ($('recordsStrip')) $('recordsStrip').dataset.sig = '';
            renderRecordsStrip();
        });
        $('presetBar')?.addEventListener('click', (ev) => {
            const btn = ev.target.closest('button[data-farm-preset]');
            if (!btn) return;
            const preset = BUILTIN_PRESETS[btn.dataset.farmPreset];
            if (preset) void applyFarmPreset(preset.label, preset.config);
        });
        $('btnSavePreset')?.addEventListener('click', () => {
            const inp = $('presetCustomName');
            const name = String(inp?.value || '').trim().slice(0, 24);
            if (!name) return;
            const custom = LS.get(PRESETS_KEY, {});
            custom[name] = readConfigForm();
            LS.set(PRESETS_KEY, custom);
            if (inp) inp.value = '';
            renderCustomPresets();
            setSaveState(`${IC('save')}Perfil "${escapeHtml(name)}" salvo`, 'ok');
        });
        $('presetCustomList')?.addEventListener('click', (ev) => {
            const applyBtn = ev.target.closest('button[data-custom-preset]');
            if (applyBtn) {
                const name = applyBtn.dataset.customPreset;
                const custom = LS.get(PRESETS_KEY, {});
                if (custom[name]) void applyFarmPreset(name, custom[name]);
                return;
            }
            const delBtn = ev.target.closest('button[data-del-preset]');
            if (delBtn) {
                const name = delBtn.dataset.delPreset;
                const custom = LS.get(PRESETS_KEY, {});
                delete custom[name];
                LS.set(PRESETS_KEY, custom);
                renderCustomPresets();
            }
        });
        $('btnOvGoLives')?.addEventListener('click', () => goAccount(activeAccount, 'lives'));
        if (!POPOUT) {
            ensureActivityDock();
            buildDock();
            ensurePaneResizer();
        }
        syncMenuState();
        ensureAria(true); // depois disso o afterRender de cada tique chama, com limite de 3s
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true });
    else wire();
})();
