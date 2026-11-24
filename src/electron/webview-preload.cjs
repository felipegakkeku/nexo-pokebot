'use strict';
const { ipcRenderer, webFrame } = require('electron');

const MAIN_WORLD_HOOK = `(() => {
    if (window.__pbHubHooked) return;
    window.__pbHubHooked = true;

    const NativeWS = window.WebSocket;
    const isPokeWsUrl = (u) => {
        try {
            return /pokeidle\\.io/i.test(String(u || ''));
        } catch {
            return false;
        }
    };

    window.__pbNeedCampoFeed = true;

    const origSend = NativeWS.prototype.send;
    const bindSocket = (sock) => {
        try {
            if (!sock || sock.__pbBound || !isPokeWsUrl(sock.url)) return;
            sock.__pbBound = true;
            window.__pbGameWs = sock;
            sock.addEventListener('message', (ev) => {
                if (typeof ev.data !== 'string' || !ev.data.startsWith('{')) return;
                if (!ev.data.includes('"t":')) return;
                window.postMessage({ __pbHub: 'ws-frame', data: ev.data }, '*');
            });
            if (window.__pbNeedCampoFeed !== false && sock.readyState === 1) {
                try {
                    origSend.call(sock, JSON.stringify({ t: 'cliente.economia', ativo: false }));
                } catch {}
            }
        } catch {}
    };

    NativeWS.prototype.send = function (data) {
        bindSocket(this);
        try {
            if (
                window.__pbNeedCampoFeed !== false &&
                isPokeWsUrl(this?.url) &&
                typeof data === 'string' &&
                data.includes('"cliente.economia"') &&
                data.includes('true')
            ) {
                const parsed = JSON.parse(data);
                if (parsed && parsed.t === 'cliente.economia' && parsed.ativo === true) {
                    // Mantem o Modo Economia visual do jogo (canvas desligado / 0% GPU),
                    // mas preserva o feed leve de caidos no servidor para o Auto-Catch lancar Pokebolas.
                    if (!this.__pbEcoNotified) {
                        this.__pbEcoNotified = true;
                        window.postMessage({ __pbHub: 'game-eco-preserved' }, '*');
                    }
                    return origSend.call(this, JSON.stringify({ t: 'cliente.economia', ativo: false }));
                }
            }
        } catch {}
        return origSend.apply(this, arguments);
    };

    window.__pbSetNeedCampoFeed = (need) => {
        const next = Boolean(need);
        const prev = window.__pbNeedCampoFeed !== false;
        window.__pbNeedCampoFeed = next;
        if (next && !prev && window.__pbGameWs && window.__pbGameWs.readyState === 1) {
            try {
                origSend.call(window.__pbGameWs, JSON.stringify({ t: 'cliente.economia', ativo: false }));
            } catch {}
        }
    };

    if (typeof NativeWS === 'function') {
        try {
            window.WebSocket = new Proxy(NativeWS, {
                construct(target, args, newTarget) {
                    const ws = Reflect.construct(target, args, newTarget);
                    if (isPokeWsUrl(args[0])) bindSocket(ws);
                    return ws;
                },
            });
        } catch {}
    }

    window.__pbHubSend = (rawJson) => {
        try {
            const ws = window.__pbGameWs;
            if (!ws || ws.readyState !== 1) return false;
            ws.send(String(rawJson));
            return true;
        } catch {
            return false;
        }
    };

    window.__pbHubReadHunt = async (metric) => {
        try {
            const guide = globalThis.__pokeidleHunt;
            const calc = guide?.calculo;
            if (!guide?.engine?.analisar || !guide.carregarJogo || !calc?.pronto?.()) return null;
            const pokemon = calc.pkAtivo();
            const game = await guide.carregarJogo();
            if (!pokemon?.id || calc.pkAtivo()?.id !== pokemon.id) return null;
            const opts = calc.opcoes();
            const result = guide.engine.analisar(pokemon, calc.contexto(game, pokemon), {
                ...opts,
                ordem: metric || 'xp',
                soLiberadas: true,
            });
            const eligible = (result?.linhas || []).filter((row) => row.liberada && !row.inviavel);
            const regional = opts.regiao && eligible.filter((row) => row.regiao === opts.regiao);
            const pool = regional?.length ? regional : eligible;
            const isSafe = (row) => !row.umHit && !(Number(row.mortesH || 0) >= 0.5);
            const best = pool.find(isSafe) || pool[0];
            if (!best?.slug) return null;
            const value = { xp: best.xpPokemonH, ouro: best.ouroH, shiny: best.shinyH }[metric || 'xp'];
            if (!Number.isFinite(value) || value <= 0) return null;
            const ranked = pool
                .filter((row) => row?.slug)
                .map((row) => ({
                    slug: String(row.slug),
                    name: String(row.nome || row.slug),
                    level: Number(row.nivel || 0),
                    region: String(row.regiao || ''),
                    value: Number({ xp: row.xpPokemonH, ouro: row.ouroH, shiny: row.shinyH }[metric || 'xp'] || 0),
                    xpH: Number(row.xpPokemonH || 0),
                    goldH: Number(row.ouroH || 0),
                    shinyH: Number(row.shinyH || 0),
                    unsafe: Boolean(row.umHit || Number(row.mortesH || 0) >= 0.5),
                }));
            return {
                slug: best.slug,
                name: best.nome,
                pokemonId: pokemon.id,
                pokemonLevel: pokemon.level,
                level: best.nivel,
                region: best.regiao,
                value,
                unsafe: Boolean(best.umHit || Number(best.mortesH || 0) >= 0.5),
                ranked,
            };
        } catch {
            return null;
        }
    };

    let lastSessionSig = '';
    const checkSession = () => {
        try {
            if (!/pokeidle\\.io/i.test(location.hostname || '')) return;
            const raw = localStorage.getItem('sessao');
            if (!raw) return;
            const dispositivo = localStorage.getItem('id-dispositivo') || '';
            const sig = raw + '|' + dispositivo;
            if (sig === lastSessionSig) return;
            lastSessionSig = sig;
            const parsed = JSON.parse(raw);
            if (parsed && parsed.nick && parsed.token) {
                window.postMessage({
                    __pbHub: 'session',
                    session: {
                        nick: parsed.nick,
                        token: parsed.token,
                        provedor: parsed.provedor || null,
                        dispositivo: dispositivo || null,
                    },
                }, '*');
            }
        } catch {}
    };
    setInterval(checkSession, 2500);
    setTimeout(checkSession, 800);
})();`;

const injectMainWorldHook = () => {
    try {
        webFrame.executeJavaScript(MAIN_WORLD_HOOK, false);
    } catch {
        // Re-injetado no DOMContentLoaded caso falhe antes da carga inicial
    }
};
injectMainWorldHook();
window.addEventListener('DOMContentLoaded', injectMainWorldHook, { once: true });

window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || typeof ev.data !== 'object') return;
    if (ev.data.__pbHub === 'ws-frame' && typeof ev.data.data === 'string') {
        ipcRenderer.sendToHost('pb-ws-frame', ev.data.data);
    } else if (ev.data.__pbHub === 'session' && ev.data.session) {
        ipcRenderer.sendToHost('pb-session', ev.data.session);
    } else if (ev.data.__pbHub === 'game-eco-preserved') {
        ipcRenderer.sendToHost('pb-game-eco', true);
    }
});
