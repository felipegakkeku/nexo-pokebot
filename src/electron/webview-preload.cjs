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
        } catch {}
    };

    const origSend = NativeWS.prototype.send;
    NativeWS.prototype.send = function () {
        bindSocket(this);
        return origSend.apply(this, arguments);
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
            return {
                slug: best.slug,
                name: best.nome,
                pokemonId: pokemon.id,
                pokemonLevel: pokemon.level,
                level: best.nivel,
                region: best.regiao,
                value,
                unsafe: Boolean(best.umHit || Number(best.mortesH || 0) >= 0.5),
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

try {
    webFrame.executeJavaScript(MAIN_WORLD_HOOK, false);
} catch {
    // Re-injetado no dom-ready caso falhe antes da carga inicial
}

// Garante a interface nativa da extensao "/hunt for PokeIdle" na aba embutida
// caso o loadExtension MV3 do Electron nao injete scripts world:"MAIN" no <webview>.
try {
    const isPokeIdleHost = /pokeidle\.io$/i.test(String(location.hostname || ''));
    if (isPokeIdleHost) {
        const huntBundle = ipcRenderer.sendSync('hub:get-hunt-extension-bundle');
        if (huntBundle && Array.isArray(huntBundle.scripts) && huntBundle.scripts.length > 0) {
            const injectHuntUi = () => {
                try {
                    const alreadyLoaded = webFrame.executeJavaScript('Boolean(globalThis.__pokeidleHunt)', false);
                    Promise.resolve(alreadyLoaded).then((hasGuide) => {
                        if (hasGuide) return;
                        if (Array.isArray(huntBundle.styles) && huntBundle.styles.length > 0) {
                            const injectCss = () => {
                                if (document.getElementById('nexo-hunt-ext-css')) return;
                                const style = document.createElement('style');
                                style.id = 'nexo-hunt-ext-css';
                                style.textContent = huntBundle.styles.join('\n');
                                (document.head || document.documentElement)?.appendChild(style);
                            };
                            if (document.head || document.documentElement) injectCss();
                            else window.addEventListener('DOMContentLoaded', injectCss, { once: true });
                        }
                        for (const src of huntBundle.scripts) {
                            try {
                                webFrame.executeJavaScript(src, false);
                            } catch {
                                // ignora script individual que falhar
                            }
                        }
                    }).catch(() => {});
                } catch {
                    // extensao opcional
                }
            };
            injectHuntUi();
        }
    }
} catch {
    // extensao /hunt opcional
}

window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || typeof ev.data !== 'object') return;
    if (ev.data.__pbHub === 'ws-frame' && typeof ev.data.data === 'string') {
        ipcRenderer.sendToHost('pb-ws-frame', ev.data.data);
    } else if (ev.data.__pbHub === 'session' && ev.data.session) {
        ipcRenderer.sendToHost('pb-session', ev.data.session);
    }
});
