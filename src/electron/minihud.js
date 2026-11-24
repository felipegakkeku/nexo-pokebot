'use strict';
// Mini-HUD: janela pequena sempre visível com o resumo das contas.
(function () {
    const $ = (id) => document.getElementById(id);
    const SPRITE = (id, shiny) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${shiny ? 'shiny/' : ''}${Number(id) || 0}.png`;
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
            rows.push(`<li class="mh-row ${cls}" data-acc="${acc}" title="Conta ${acc} · ${esc(nick)}: ${label}">
                <span class="mh-num">${acc}</span>
                ${poke ? `<img class="mh-sprite" alt="" src="${SPRITE(poke.speciesId, poke.shiny)}" />` : '<span class="mh-sprite"></span>'}
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

    $('mhList').addEventListener('click', (ev) => {
        const row = ev.target.closest('.mh-row');
        if (row) void window.pokeHub.showMain(Number(row.dataset.acc));
    });
    $('mhOpen').addEventListener('click', () => void window.pokeHub.showMain());
    $('mhClose').addEventListener('click', () => void window.pokeHub.closeMiniHud());
    void tick();
    setInterval(tick, 2000);
})();
