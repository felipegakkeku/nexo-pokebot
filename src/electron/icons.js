'use strict';
// Carregado no <head>: aplica tema e destaque antes da primeira pintura
// e injeta um único conjunto de ícones SVG (traço 2px, grade 24x24).
(function () {
    const root = document.documentElement;
    const THEMES = ['marinho', 'grafite', 'oled', 'contraste'];
    const ACCENTS = ['azul', 'ciano', 'violeta', 'rosa', 'esmeralda', 'laranja'];
    const read = (k, fallback) => {
        try { return localStorage.getItem(k) || fallback; } catch { return fallback; }
    };
    const theme = read('nexo.theme', 'marinho');
    const accent = read('nexo.accent', 'azul');
    if (THEMES.includes(theme) && theme !== 'marinho') root.dataset.theme = theme;

    // Cada conta tem a própria cor de destaque. Sem nada salvo, a conta 1 herda
    // a cor antiga do app e as outras pegam cores bem diferentes entre si.
    const ACC_DEFAULT = ['azul', 'esmeralda', 'laranja', 'violeta', 'rosa', 'ciano'];
    function readAccMap() {
        let m = null;
        try { m = JSON.parse(localStorage.getItem('nexo.accentByAcc') || 'null'); } catch { m = null; }
        const out = {};
        if (m && typeof m === 'object') {
            for (const k of ['1', '2', '3', '4']) if (ACCENTS.includes(m[k])) out[k] = m[k];
        }
        if (Object.keys(out).length === 4) return out;
        const first = out['1'] || (ACCENTS.includes(accent) ? accent : 'azul');
        out['1'] = first;
        const pool = ACC_DEFAULT.filter((a) => a !== first);
        for (const k of ['2', '3', '4']) if (!out[k]) out[k] = pool.shift();
        return out;
    }
    let accMap = readAccMap();
    function paintAccent(a) {
        if (!a || a === 'azul') delete root.dataset.accent;
        else root.dataset.accent = a;
    }
    paintAccent(accMap['1']);

    const P = {
        play: '<path d="M6 4l14 8-14 8z"/>',
        pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
        x: '<path d="M18 6 6 18M6 6l12 12"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
        bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
        sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
        star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
        gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
        cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 2h3l2.7 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
        pin: '<path d="M12 17v5"/><path d="M9 10.8V5h6v5.8l3 3.2v2H6v-2z"/><path d="M8 5h8"/>',
        external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
        maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
        split: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
        grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
        panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
        cards: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
        columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
        more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
        leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
        coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/>',
        tray: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
        heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
        info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
        search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        pokeball: '<circle cx="12" cy="12" r="10"/><path d="M2 12h7M15 12h7"/><circle cx="12" cy="12" r="3"/>',
        coins: '<circle cx="8" cy="8" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.3 18"/><path d="M7 6h1v4M16.7 13.9l.7.7-2.8 2.8"/>',
        zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
        swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
        refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 16H3v5"/>',
        plug: '<path d="M12 22v-5M9 8V2M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
        clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
        thumbs: '<path d="M7 10v12"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z"/>',
        tv: '<rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/>',
        activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
        sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
        link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
        gamepad: '<path d="M6 12h4M8 10v4M15 13h.01M18 11h.01"/><rect x="2" y="6" width="20" height="12" rx="2"/>',
        package: '<path d="M11 21.7a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7z"/><path d="M12 22V12M3.3 7 12 12l8.7-5"/>',
        crosshair: '<circle cx="12" cy="12" r="10"/><path d="M22 12h-4M6 12H2M12 6V2M12 22v-4"/>',
        palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-.5a2 2 0 0 1 2-2h1.5A4.5 4.5 0 0 0 22 13 10.5 10 0 0 0 12 2"/>',
        keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
        undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
        volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
        mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
        eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
        eyeoff: '<path d="M10.7 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20"/>',
        trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.8 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.2.6 2 2 2 3.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>',
        heartpulse: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/><path d="M3.2 12H9l.5-1 2 4.5 2-7 1.5 3.5h5.3"/>',
        trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
        copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
        save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7"/>',
        trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
        layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
        hud: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M6 7h5"/>',
        moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/>',
        user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
        filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
        chevron: '<path d="m6 9 6 6 6-6"/>',
        grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
        hospital: '<path d="M12 6v4M14 14h-4M14 18h-4M14 8h-4"/><path d="M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"/><path d="M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"/>',
    };

    const SVGNS = 'http://www.w3.org/2000/svg';
    function injectSprite() {
        if (document.getElementById('nexoIconSprite')) return;
        const holder = document.createElementNS(SVGNS, 'svg');
        holder.setAttribute('id', 'nexoIconSprite');
        holder.setAttribute('aria-hidden', 'true');
        holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        holder.innerHTML = Object.entries(P).map(([name, body]) => (
            `<symbol id="i-${name}" viewBox="0 0 24 24" fill="var(--ico-fill, none)" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`
        )).join('');
        document.body.prepend(holder);
    }

    function icon(name, cls = '') {
        if (!P[name]) return '';
        return `<svg class="ico${cls ? ` ${cls}` : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
    }

    // <span data-icon="bell"></span> vira o ícone; em botão, entra antes do texto
    function hydrate(scope = document) {
        for (const el of scope.querySelectorAll('[data-icon]:not([data-icon-done])')) {
            el.setAttribute('data-icon-done', '');
            if (el.querySelector('svg.ico')) continue;
            el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
        }
    }

    function setTheme(theme) {
        const t = THEMES.includes(theme) ? theme : 'marinho';
        if (t === 'marinho') delete root.dataset.theme;
        else root.dataset.theme = t;
        try { localStorage.setItem('nexo.theme', t); } catch { /* ignore */ }
    }
    function setAccent(accent) {
        const a = ACCENTS.includes(accent) ? accent : 'azul';
        paintAccent(a);
        try { localStorage.setItem('nexo.accent', a); } catch { /* ignore */ }
    }
    const saveAccMap = () => { try { localStorage.setItem('nexo.accentByAcc', JSON.stringify(accMap)); } catch { /* ignore */ } };
    const accountAccent = (acc) => accMap[String(acc)] || 'azul';
    function setAccountAccent(acc, accent, all = false) {
        const a = ACCENTS.includes(accent) ? accent : 'azul';
        if (all) for (const k of Object.keys(accMap)) accMap[k] = a;
        else accMap[String(acc)] = a;
        saveAccMap();
        applyAccountAccent(acc);
    }
    function applyAccountAccent(acc) {
        const a = accountAccent(acc);
        if ((root.dataset.accent || 'azul') !== a) paintAccent(a);
    }

    window.nexoIcons = {
        icon, hydrate, setTheme, setAccent, THEMES, ACCENTS,
        getTheme: () => root.dataset.theme || 'marinho',
        getAccent: () => root.dataset.accent || 'azul',
        accountAccent, setAccountAccent, applyAccountAccent,
    };

    const ready = () => { injectSprite(); hydrate(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();

    // Outras janelas (pop-out e mini-HUD) acompanham a troca de tema
    window.addEventListener('storage', (ev) => {
        if (ev.key === 'nexo.theme') setTheme(ev.newValue || 'marinho');
        if (ev.key === 'nexo.accent' && !document.querySelector('.acc-tab, .popout-acc')) setAccent(ev.newValue || 'azul');
        if (ev.key === 'nexo.accentByAcc') accMap = readAccMap();
    });
})();
