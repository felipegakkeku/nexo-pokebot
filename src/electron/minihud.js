'use strict';
// Mini-HUD: janela pequena sempre visível com o resumo das contas.
(function () {
    const $ = (id) => document.getElementById(id);
    const OUTLAND_DEX = {
        2001: 9, 2002: 160, 2003: 154, 2004: 3, 2005: 214, 2006: 123, 2007: 203, 2008: 26,
        2009: 181, 2010: 125, 2011: 148, 2012: 91, 2013: 87, 2014: 124, 2015: 221, 2016: 241,
        2017: 232, 2018: 28, 2019: 76, 2020: 112, 2021: 6, 2022: 157, 2023: 34, 2024: 31,
        2025: 169, 2026: 94, 2027: 200, 2028: 107, 2029: 106, 2030: 237, 2031: 59, 2032: 126,
        2033: 247, 2034: 208, 2035: 40, 2036: 178, 2037: 65, 2038: 97, 2039: 130, 2040: 226,
        2041: 127, 2042: 36, 2043: 210, 2044: 227, 2045: 164, 2046: 18, 2047: 105, 2048: 248,
        2049: 142, 2050: 212, 2051: 149, 2052: 547, 2053: 219, 2054: 454, 2055: 103, 2056: 429,
        2057: 699, 2058: 560,
    };
    const SPECIAL_DEX = { 8017: 1017, 9017: 1017, 12017: 1017, 10001: 9 };
    const resolveDex = (poke) => {
        const direct = Number(poke?.spriteDex);
        if (Number.isInteger(direct) && direct >= 1 && direct <= 1025) return direct;
        let id = Number(poke?.speciesId);
        if (!Number.isInteger(id) || id <= 0) return 0;
        if (id >= 10501 && id <= 10548) id -= 8500;
        if (SPECIAL_DEX[id]) return SPECIAL_DEX[id];
        if (OUTLAND_DEX[id]) return OUTLAND_DEX[id];
        if (id <= 1025) return id;
        const mod = id % 1000;
        return mod >= 1 && mod <= 999 ? mod : 0;
    };
    const spriteUrls = (dex, shiny) => {
        if (!dex) return [];
        const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
        return shiny
            ? [`${base}/shiny/${dex}.png`, `${base}/other/home/shiny/${dex}.png`, `${base}/other/official-artwork/shiny/${dex}.png`, `${base}/${dex}.png`]
            : [`${base}/${dex}.png`, `${base}/other/home/${dex}.png`, `${base}/other/official-artwork/${dex}.png`];
    };
    const SPRITE = (poke) => {
        const dex = resolveDex(poke);
        return spriteUrls(dex, Boolean(poke?.shiny))[0] || '';
    };
    const fmt = (n) => {
        const v = Number(n || 0);
        const a = Math.abs(v);
        if (a >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')} mi`;
        if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',')} mil`;
        return String(Math.round(v));
    };
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const STATE = {
        connected: ['ok', 'Farmando'], bridge: ['ok', 'Embutido'], connecting: ['info', 'Conectando'],
        standby: ['idle', 'Standby'], paused: ['warn', 'Pausado'], error: ['err', 'Erro'], disconnected: ['idle', 'Offline'],
    };

    async function tick() {
        let snaps = {};
        try { snaps = await window.pokeHub.getAllSnapshots(); } catch { return; }
        const rows = [];
        let totalXp = 0;
        let totalGold = 0;
        for (const acc of [1, 2, 3, 4]) {
            const s = snaps[acc];
            if (!s) continue;
            const hasSession = Boolean(s.session) || s.status === 'connected' || s.status === 'bridge';
            if (!hasSession) continue;
            const [cls, label] = STATE[s.status] || STATE.disconnected;
            const nick = s.trainer?.nick && s.trainer.nick !== '-' ? s.trainer.nick : (s.session?.nick || `Conta ${acc}`);
            const st = s.stats || {};
            const running = s.status === 'connected' || s.status === 'bridge';
            if (running) {
                totalXp += Number(st.xpPerHour || 0);
                totalGold += Number(st.netGoldPerHour || 0);
            }
            const poke = s.activePokemon;
            const hp = poke ? Math.max(0, Math.min(100, Number(poke.hpPercent || 0))) : 0;
            const gold = Number(st.netGoldPerHour || 0);
            const dex = resolveDex(poke);
            const spUrl = SPRITE(poke);
            rows.push(`<li class="mh-row ${cls}" data-acc="${acc}" title="Conta ${acc} · ${esc(nick)}: ${label}">
                <span class="mh-num">${acc}</span>
                ${poke && spUrl ? `<img class="mh-sprite" alt="" src="${spUrl}" data-sprite-dex="${dex}" data-sprite-shiny="${poke.shiny ? '1' : '0'}" />` : '<span class="mh-sprite"></span>'}
                <span class="mh-main"><span class="mh-nick">${esc(nick)}</span>
                  <span class="mh-hp"><i style="width:${hp}%"></i></span></span>
                <span class="mh-val" title="XP por hora">${running ? fmt(st.xpPerHour) : label}</span>
                <span class="mh-val ${gold < 0 ? 'neg' : ''}" title="Lucro por hora">${running ? `${gold >= 0 ? '+' : ''}${fmt(gold)}` : ''}</span>
                <span class="mh-val shiny" title="Shinies capturados">${Number(st.shiniesCaptured || 0) ? `★${st.shiniesCaptured}` : ''}</span>
            </li>`);
        }
        $('mhList').innerHTML = rows.join('') || '<li class="mh-empty">Nenhuma conta ativa</li>';
        $('mhTotal').textContent = totalXp ? `${fmt(totalXp)} XP/h · ${totalGold >= 0 ? '+' : ''}${fmt(totalGold)} ouro/h` : '';
    }

    $('mhList').addEventListener('error', (ev) => {
        const img = ev.target;
        if (!img || img.tagName !== 'IMG' || !img.dataset.spriteDex) return;
        const dex = Number(img.dataset.spriteDex);
        const shiny = img.dataset.spriteShiny === '1';
        const urls = spriteUrls(dex, shiny);
        const nextIdx = Number(img.dataset.spriteStep || 0) + 1;
        if (nextIdx < urls.length) {
            img.dataset.spriteStep = String(nextIdx);
            img.src = urls[nextIdx];
        } else {
            img.hidden = true;
        }
    }, true);

    $('mhList').addEventListener('click', (ev) => {
        const row = ev.target.closest('.mh-row');
        if (row) void window.pokeHub.showMain(Number(row.dataset.acc));
    });
    $('mhOpen').addEventListener('click', () => void window.pokeHub.showMain());
    $('mhClose').addEventListener('click', () => void window.pokeHub.closeMiniHud());
    void tick();
    setInterval(tick, 2000);
})();
