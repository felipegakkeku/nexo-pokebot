// Runner CLI do motor headless via WebSocket nativo (Node 22+), sem dependencias externas.
import { resolve } from 'node:path';
import {
    resolveHeadlessSession,
    saveSessionCache,
    decodeJwtPayload,
} from './session-extractor.mjs';
import {
    DEFAULT_WS_URL,
    DEFAULT_ORIGIN,
    createStateMerger,
    createFieldTracker,
    evaluateHeadlessTick,
} from './protocol-engine.mjs';
import { createLiveRewardsBridge, trySilentProfileCookieSync } from './gui-server.mjs';

const USER_AGENT = 'Nexo-PokeBot-Headless/1.0';
const PING_INTERVAL_MS = 25_000;
const WATCHDOG_INTERVAL_MS = 10_000;
const WATCHDOG_TIMEOUT_MS = 35_000;
const MIN_RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 30_000;

/**
 * Faz o parse de argumentos CLI para o runner headless.
 * @param {string[]} argv Lista de argumentos (sem node e script).
 * @returns {object} Opcoes normalizadas de execucao.
 */
export function parseCliArgs(argv = []) {
    const args = {
        checkSession: false,
        nick: null,
        token: null,
        dispositivo: null,
        sessionFile: null,
        hunt: null,
        economy: 'auto',
        pingOnly: false,
        standby: false,
        standbySec: 180,
        durationSec: 0,
        statusIntervalSec: 15,
        help: false,
    };

    const list = Array.isArray(argv) ? argv : [];
    for (let i = 0; i < list.length; i++) {
        const raw = String(list[i] ?? '');
        const eqIdx = raw.startsWith('--') ? raw.indexOf('=') : -1;
        const flag = eqIdx > 0 ? raw.slice(0, eqIdx) : raw;
        const inlineVal = eqIdx > 0 ? raw.slice(eqIdx + 1) : null;

        const readNextValue = () => {
            if (inlineVal !== null) return inlineVal;
            if (i + 1 < list.length) {
                i += 1;
                return String(list[i] ?? '');
            }
            return null;
        };

        if (flag === '--check-session' || flag === '--dry-run') {
            args.checkSession = true;
        } else if (flag === '--help' || flag === '-h') {
            args.help = true;
        } else if (flag === '--economy') {
            args.economy = 'on';
        } else if (flag === '--ping-only') {
            args.economy = 'on';
            args.pingOnly = true;
        } else if (flag === '--no-economy') {
            args.economy = 'off';
        } else if (flag === '--standby') {
            args.standby = true;
        } else if (flag === '--nick') {
            const v = readNextValue();
            if (v) args.nick = v;
        } else if (flag === '--token') {
            const v = readNextValue();
            if (v) args.token = v;
        } else if (flag === '--dispositivo') {
            const v = readNextValue();
            if (v) args.dispositivo = v;
        } else if (flag === '--session-file') {
            const v = readNextValue();
            if (v) args.sessionFile = v;
        } else if (flag === '--hunt') {
            const v = readNextValue();
            if (v) args.hunt = v;
        } else if (flag === '--standby-sec') {
            const n = Number(readNextValue());
            if (Number.isFinite(n)) args.standbySec = Math.max(5, n);
        } else if (flag === '--duration') {
            const n = Number(readNextValue());
            if (Number.isFinite(n) && n > 0) args.durationSec = n;
        } else if (flag === '--status-interval') {
            const n = Number(readNextValue());
            if (Number.isFinite(n)) args.statusIntervalSec = Math.max(1, n);
        }
    }

    return args;
}

function printHelp() {
    console.log([
        'Nexo PokeBot Headless v1.0 (PokeIdle WebSocket Standalone)',
        '',
        'Uso:',
        '  node headless-farm.mjs [opcoes]',
        '',
        'Opcoes:',
        '  --check-session, --dry-run   Valida e exibe resumo da sessao sem conectar',
        '  --nick <nick>                Nick da conta (ou POKEIDLE_NICK)',
        '  --token <jwt>                JWT de sessao (ou POKEIDLE_TOKEN)',
        '  --dispositivo <uuid>         UUID do dispositivo (ou POKEIDLE_DISPOSITIVO)',
        '  --session-file <path>        Caminho alternativo do arquivo de sessao JSON',
        '  --hunt <slug>                Seleciona a hunt alvo ao conectar',
        '  --economy                    Forca modo economia ligado no servidor',
        '  --no-economy                 Forca modo economia desligado (recebe campo)',
        '  --lives / --no-lives         Liga/desliga farm automatico de Twitch e Kick',
        '  --standby                    Aguarda e reconecta apos close 4001 (navegador)',
        '  --standby-sec <n>            Segundos de espera no standby (padrao: 180, min: 5)',
        '  --duration <sec>             Tempo maximo em segundos antes de encerrar (0 = infinito)',
        '  --status-interval <sec>      Intervalo do log de status (padrao: 15, min: 1)',
        '  -h, --help                   Exibe esta ajuda',
    ].join('\n'));
}

function formatTokenValidity(exp) {
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return 'sem expiracao informada';
    const expMs = exp < 1e12 ? exp * 1000 : exp;
    const iso = new Date(expMs).toISOString();
    const diffMs = expMs - Date.now();
    if (diffMs <= 0) return `expirado em ${iso}`;
    const mins = Math.floor(diffMs / 60_000);
    return `valido ate ${iso} (${mins} min restantes)`;
}

function buildHeadlessConfig(prefs, targetHunt) {
    const p = prefs && typeof prefs === 'object' ? prefs : {};
    return {
        caidosEnabled: p.caidosEnabled ?? true,
        smartBallSelect: p.smartBallSelect ?? true,
        preferredBall: p.preferredBall || 'auto',
        shinyBall: p.shinyBall || 'best',
        highLevelUltraThreshold: typeof p.highLevelUltraThreshold === 'number' ? p.highLevelUltraThreshold : 20,
        prioritizeExpiring: p.prioritizeExpiring ?? true,
        restockEnabled: p.restockEnabled ?? true,
        autoUpgradeBalls: p.autoUpgradeBalls ?? true,
        minGoldReserve: typeof p.minGoldReserve === 'number' ? p.minGoldReserve : 50000,
        minBalls: typeof p.minBalls === 'number' ? p.minBalls : 10,
        targetBalls: typeof p.targetBalls === 'number' ? p.targetBalls : 50,
        restockSmallPotion: p.restockSmallPotion ?? true,
        minPotions: typeof p.minPotions === 'number' ? p.minPotions : 10,
        targetPotions: typeof p.targetPotions === 'number' ? p.targetPotions : 40,
        minRevives: typeof p.minRevives === 'number' ? p.minRevives : 5,
        targetRevives: typeof p.targetRevives === 'number' ? p.targetRevives : 20,
        restockRevive: p.restockRevive ?? false,
        ensureNativeAutoHeal: p.ensureNativeAutoHeal ?? true,
        dailyPassEnabled: p.dailyPassEnabled ?? true,
        preyEnabled: p.preyEnabled ?? true,
        targetHuntSlug: targetHunt || null,
        liveEnabled: p.liveEnabled ?? true,
        liveWatchTwitch: p.liveWatchTwitch ?? true,
        liveWatchKick: p.liveWatchKick ?? true,
        liveAutoClaimChest: p.liveAutoClaimChest ?? true,
        liveAutoRedeem: p.liveAutoRedeem ?? true,
        liveRewardType: ['xp', 'captura', 'shiny'].includes(p.liveRewardType) ? p.liveRewardType : 'xp',
        liveGuardThresholdMin: typeof p.liveGuardThresholdMin === 'number' ? p.liveGuardThresholdMin : 30,
        liveMaxSlots: typeof p.liveMaxSlots === 'number' ? p.liveMaxSlots : 4,
        liveMaxTwitchSlots: typeof p.liveMaxTwitchSlots === 'number'
            ? p.liveMaxTwitchSlots
            : (typeof p.liveMaxSlots === 'number' ? p.liveMaxSlots : 4),
        liveMaxKickSlots: typeof p.liveMaxKickSlots === 'number' ? p.liveMaxKickSlots : 2,
        liveTwitchToken: typeof p.liveTwitchToken === 'string' && p.liveTwitchToken ? p.liveTwitchToken : (process.env.TWITCH_AUTH_TOKEN || ''),
        liveTwitchDeviceId: typeof p.liveTwitchDeviceId === 'string' ? p.liveTwitchDeviceId : '',
        liveKickToken: typeof p.liveKickToken === 'string' && p.liveKickToken ? p.liveKickToken : (process.env.KICK_SESSION_TOKEN || ''),
        liveCustomTwitch: typeof p.liveCustomTwitch === 'string' ? p.liveCustomTwitch : '',
        liveCustomKick: typeof p.liveCustomKick === 'string' ? p.liveCustomKick : '',
    };
}

function createEmptyCatalog() {
    return {
        ballPrices: {},
        itemPrices: {},
        prices: {},
        itemNames: {},
        huntSpeciesBySlug: {},
        huntSpeciesId: null,
        huntNames: {},
        pokemonNames: {},
    };
}

function ingestPriceEntries(source, targetPrices, combinedPrices, targetNames) {
    if (!source) return;
    const entries = Array.isArray(source)
        ? source.map((item) => [item?.id ?? item?.chave ?? item?.slug ?? item?.key, item])
        : Object.entries(source);

    for (const [rawId, item] of entries) {
        if (item == null) continue;
        const id = typeof item === 'object' ? (item.id ?? item.chave ?? rawId) : rawId;
        if (id === undefined || id === null || id === '') continue;

        const price = typeof item === 'number'
            ? item
            : Number(item.priceGold ?? item.precoGold ?? item.preco ?? item.price ?? item.gold ?? NaN);
        if (Number.isFinite(price) && price >= 0) {
            targetPrices[id] = price;
            combinedPrices[id] = price;
        }
        if (typeof item === 'object') {
            const name = item.nome ?? item.name ?? item.label ?? item.titulo;
            if (name) targetNames[id] = String(name);
        }
    }
}

function ingestWelcomeCatalog(welcomeMsg, catalog) {
    ingestPriceEntries(welcomeMsg?.catalogoBolas, catalog.ballPrices, catalog.prices, catalog.itemNames);
    ingestPriceEntries(welcomeMsg?.itensNossos, catalog.itemPrices, catalog.prices, catalog.itemNames);
    ingestPriceEntries(welcomeMsg?.itensCompraveis, catalog.itemPrices, catalog.prices, catalog.itemNames);

    const hunts = welcomeMsg?.hunts;
    if (!hunts) return;
    const entries = Array.isArray(hunts)
        ? hunts.map((h) => [h?.slug, h])
        : Object.entries(hunts);

    for (const [rawSlug, hunt] of entries) {
        if (!hunt || typeof hunt !== 'object') continue;
        const slug = hunt.slug ?? rawSlug;
        if (!slug) continue;

        const especies = Array.isArray(hunt.especies) ? hunt.especies : [];
        let primarySpecies = null;
        let primaryWeight = -1;
        for (const sp of especies) {
            if (!sp || sp.pokeId == null) continue;
            if (sp.nome) catalog.pokemonNames[sp.pokeId] = String(sp.nome);
            const weight = Number(sp.pontos || 0);
            if (primarySpecies == null || weight > primaryWeight) {
                primarySpecies = sp.pokeId;
                primaryWeight = weight;
            }
        }

        const speciesId = primarySpecies ?? hunt.speciesId ?? hunt.especieId ?? hunt.pokemonId ?? hunt.idEspecie ?? hunt.pokemon?.speciesId ?? hunt.pokemon?.id ?? null;
        if (speciesId !== null && speciesId !== undefined) {
            catalog.huntSpeciesBySlug[slug] = speciesId;
        }
        const huntName = hunt.nome ?? hunt.name ?? hunt.titulo;
        if (huntName) catalog.huntNames[slug] = String(huntName);

        const pokeName = hunt.pokemonNome ?? hunt.pokemonName ?? hunt.especieNome ?? hunt.pokemon?.nome ?? hunt.pokemon?.name;
        if (speciesId !== null && speciesId !== undefined && pokeName && !catalog.pokemonNames[speciesId]) {
            catalog.pokemonNames[speciesId] = String(pokeName);
        }
    }
}

function attachWsListeners(ws, { onOpen, onMessage, onClose, onError }) {
    if (typeof ws.addEventListener === 'function') {
        ws.addEventListener('open', onOpen);
        ws.addEventListener('message', onMessage);
        ws.addEventListener('close', onClose);
        ws.addEventListener('error', onError);
    } else {
        ws.onopen = onOpen;
        ws.onmessage = onMessage;
        ws.onclose = onClose;
        ws.onerror = onError;
    }
}

function formatStatusLine(state, tracker, catalog, stats, livesSnap) {
    const slug = state?.huntSlug || tracker.lastHuntSlug || '-';
    const huntLabel = catalog.huntNames?.[slug] ? `${catalog.huntNames[slug]} (${slug})` : slug;
    const gold = Number(state?.treinador?.ouro ?? state?.treinador?.gold ?? state?.ouro ?? state?.gold ?? 0);
    const shinySuffix = stats.shiniesCaptured > 0 ? ` (${stats.shiniesCaptured} shiny)` : '';
    const livesPart = livesSnap?.enabled
        ? ` | Lives: ${livesSnap.minutesWatched}m/${livesSnap.chestsClaimed}b/${livesSnap.rewardsRedeemed}r`
        : '';
    return [
        `[Headless] Hunt: ${huntLabel}`,
        `Gold: ${gold.toLocaleString('pt-BR')}`,
        `Kills: ${stats.kills}`,
        `XP: ${stats.xpGained.toLocaleString('pt-BR')}`,
        `Capturas: ${stats.captures}${shinySuffix}`,
        `Bolas: ${stats.ballsThrown}`,
        `Pongs: ${stats.pongs}${livesPart}`,
    ].join(' | ');
}

/**
 * Executa o cliente headless WebSocket do Pokeidle ate encerramento ou duracao limite.
 * @param {string[]} argv Argumentos CLI (padrao: process.argv.slice(2)).
 * @returns {Promise<number>} Codigo de saida (0 em encerramento limpo, 1 em falha).
 */
export async function runHeadlessFarm(argv = process.argv.slice(2), options = {}) {
    const args = parseCliArgs(argv);
    if (args.help) {
        printHelp();
        return 0;
    }

    const sessionOpts = {
        nick: args.nick,
        token: args.token,
        dispositivo: args.dispositivo,
        sessionFile: args.sessionFile ? resolve(args.sessionFile) : null,
    };

    let session;
    try {
        session = await resolveHeadlessSession(sessionOpts);
    } catch (err) {
        console.error(`[Headless] Erro ao resolver sessao: ${err?.message || err}`);
        return 1;
    }

    if (!session || !session.token || !session.nick) {
        console.error('[Headless] Sessao invalida: nick ou token ausente.');
        return 1;
    }

    const config = buildHeadlessConfig(session.prefs, args.hunt);
    const rawList = Array.isArray(argv) ? argv : [];
    if (rawList.includes('--lives')) config.liveEnabled = true;
    if (rawList.includes('--no-lives')) config.liveEnabled = false;

    if (args.checkSession) {
        const payload = session.payload || decodeJwtPayload(session.token);
        const contaId = payload?.contaId ?? payload?.id ?? payload?.sub ?? '-';
        const provedor = session.provedor || payload?.provedor || '-';
        console.log('[Headless] Resumo da sessao:');
        console.log(`  nick: ${session.nick}`);
        console.log(`  contaId: ${contaId}`);
        console.log(`  provedor: ${provedor}`);
        console.log(`  dispositivo: ${session.dispositivo || '-'}`);
        console.log(`  source: ${session.source || '-'}`);
        console.log(`  token: ${formatTokenValidity(payload?.exp)}`);
        console.log(`  hunt: ${config.targetHuntSlug || '(atual do jogo)'}`);
        return 0;
    }

    if (config.liveEnabled && (!config.liveTwitchToken || !config.liveKickToken) && !options.disableBrowserProfileSync) {
        try {
            const synced = await trySilentProfileCookieSync({ cwd: options.cwd || process.cwd() });
            if (synced) {
                if (synced.twitchToken && !config.liveTwitchToken) config.liveTwitchToken = synced.twitchToken;
                if (synced.twitchDeviceId && !config.liveTwitchDeviceId) config.liveTwitchDeviceId = synced.twitchDeviceId;
                if (synced.kickToken && !config.liveKickToken) config.liveKickToken = synced.kickToken;
                if (synced.twitchToken || synced.kickToken) {
                    console.log('[Headless][ok] Cookies Twitch/Kick sincronizados automaticamente do navegador ativo!');
                }
            }
        } catch {
            // segue sem cookies externos se CDP nao estiver acessivel
        }
    }

    const merger = createStateMerger();
    const field = createFieldTracker();
    const catalog = createEmptyCatalog();
    const tracker = { lastHuntSlug: config.targetHuntSlug || null };
    const stats = {
        attacks: 0,
        heals: 0,
        kills: 0,
        xpGained: 0,
        goldGained: 0,
        ballsThrown: 0,
        captures: 0,
        shiniesCaptured: 0,
        pongs: 0,
    };

    const liveBridge = createLiveRewardsBridge({
        getConfig: () => config,
        onLog: (kind, text) => console.log(`[Headless][${kind}] ${text}`),
    });

    return await new Promise((resolveDone) => {
        let ws = null;
        let pingTimer = null;
        let watchdogTimer = null;
        let statusTimer = null;
        let reconnectTimer = null;
        let durationTimer = null;
        let lastMsgAt = Date.now();
        let backoffMs = MIN_RECONNECT_MS;
        let shuttingDown = false;
        let settled = false;

        const clearSocketTimers = () => {
            if (pingTimer) {
                clearInterval(pingTimer);
                pingTimer = null;
            }
            if (watchdogTimer) {
                clearInterval(watchdogTimer);
                watchdogTimer = null;
            }
        };

        const cleanupAll = () => {
            liveBridge.dispose();
            clearSocketTimers();
            if (statusTimer) {
                clearInterval(statusTimer);
                statusTimer = null;
            }
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (durationTimer) {
                clearTimeout(durationTimer);
                durationTimer = null;
            }
            process.removeListener('SIGINT', onSignal);
            process.removeListener('SIGTERM', onSignal);
        };

        const finish = (code) => {
            if (settled) return;
            settled = true;
            cleanupAll();
            resolveDone(code);
        };

        const sendFrame = (frame) => {
            if (ws && ws.readyState === 1 && frame) {
                ws.send(JSON.stringify(frame));
            }
        };

        const sendActions = (actions) => {
            if (!Array.isArray(actions)) return;
            for (const a of actions) sendFrame(a);
        };

        const requestShutdown = (code = 0, reason = '') => {
            if (shuttingDown) return;
            shuttingDown = true;
            if (reason) console.log(`[Headless] ${reason}`);
            console.log(formatStatusLine(merger.getState(), tracker, catalog, stats, liveBridge.getLivesSnapshot()));
            if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
                try {
                    ws.close(1000, 'shutdown');
                } catch {
                    // socket ja encerrando
                }
            }
            finish(code);
        };

        const onSignal = (sig) => {
            requestShutdown(0, `Sinal ${sig} recebido. Encerrando...`);
        };

        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);

        if (args.durationSec > 0) {
            durationTimer = setTimeout(() => {
                requestShutdown(0, `Duracao de ${args.durationSec}s concluida. Encerrando limpo.`);
            }, args.durationSec * 1000);
        }

        statusTimer = setInterval(() => {
            if (!shuttingDown) {
                console.log(formatStatusLine(merger.getState(), tracker, catalog, stats, liveBridge.getLivesSnapshot()));
            }
        }, args.statusIntervalSec * 1000);

        const runTickForState = (state) => {
            if (args.pingOnly || config.economyPingOnly) return;
            const evalCatalog = {
                ...catalog,
                huntSpeciesId: catalog.huntSpeciesBySlug?.[state?.huntSlug] ?? null,
            };
            sendActions(evaluateHeadlessTick({
                state,
                field,
                catalog: evalCatalog,
                config,
                tracker,
                nowMs: Date.now(),
            }));
        };

        const handleBattleEvents = (msg) => {
            const eventos = Array.isArray(msg.ev)
                ? msg.ev
                : (Array.isArray(msg.eventos) ? msg.eventos : (msg.evento ? [msg.evento] : [msg]));
            const ts = Date.now();
            let addedCorpse = false;
            for (const e of eventos) {
                if (!e || typeof e !== 'object') continue;
                if (field.applyBattleEvent?.(e, ts)) {
                    addedCorpse = true;
                }
                const kind = e.k || e.t || e.tipo || e.acao || e.evento;
                if (kind === 'ataque') {
                    stats.attacks += 1;
                } else if (kind === 'cura') {
                    stats.heals += 1;
                } else if (kind === 'morte' && e.quem !== 'jogador') {
                    stats.kills += 1;
                    stats.xpGained += Number(e.xpPokemon || 0);
                    stats.goldGained += Number(e.ouro || 0);
                } else if (kind === 'bola') {
                    stats.ballsThrown += 1;
                } else if (kind === 'capturado') {
                    stats.captures += 1;
                    const isShiny = Boolean(e.pokemon?.shiny);
                    if (isShiny) stats.shiniesCaptured += 1;
                    const name = e.pokemon?.nome || e.pokemon?.name || catalog.pokemonNames?.[e.pokemon?.speciesId] || `#${e.pokemon?.speciesId ?? '?'}`;
                    const level = e.pokemon?.level ?? e.pokemon?.nivel ?? '?';
                    console.log(`[Headless] Capturado${isShiny ? ' SHINY' : ''}: ${name} (Nv ${level})`);
                }
            }
            if (addedCorpse && config.caidosEnabled !== false) {
                runTickForState(merger.getState());
            }
        };

        const handleMessage = (rawData) => {
            let m;
            try {
                m = JSON.parse(String(rawData));
            } catch {
                return;
            }
            if (!m || typeof m !== 'object') return;
            lastMsgAt = Date.now();

            if (m.t === 'pong') {
                stats.pongs += 1;
                return;
            }

            if (m.t === 'sessao.renovada') {
                if (m.token) {
                    session.token = m.token;
                    session.payload = decodeJwtPayload(m.token) || session.payload;
                    try {
                        saveSessionCache(session.cachePath, {
                            nick: session.nick,
                            token: session.token,
                            provedor: session.provedor,
                            dispositivo: session.dispositivo,
                        });
                    } catch (err) {
                        console.warn(`[Headless] Aviso ao salvar cache da sessao: ${err?.message || err}`);
                    }
                }
                return;
            }

            if (m.t === 'welcome') {
                liveBridge.ingestWsMessage(m);
                ingestWelcomeCatalog(m, catalog);
                if (m.estado) merger.merge(m.estado);
                const state = merger.getState();
                tracker.lastHuntSlug = state?.huntSlug || tracker.lastHuntSlug;

                if (args.hunt && state?.huntSlug !== args.hunt) {
                    console.log(`[Headless] Trocando hunt para ${args.hunt}`);
                    sendFrame({ t: 'hunt.select', slug: args.hunt });
                }

                const ecoActive = args.economy === 'on'
                    ? true
                    : args.economy === 'off'
                        ? false
                        : Boolean(state?.loja?.vip && (state?.automation?.autoBallSemParar || state?.automation?.autoBallAteCapturar));
                sendFrame({ t: 'cliente.economia', ativo: ecoActive });
                runTickForState(state);
                liveBridge.startTimer();
                liveBridge.runOnce({ force: false });
                return;
            }

            if (m.t === 'estado') {
                liveBridge.ingestWsMessage(m);
                if (m.estado) merger.merge(m.estado);
                const state = merger.getState();
                tracker.lastHuntSlug = state?.huntSlug || tracker.lastHuntSlug;
                runTickForState(state);
                return;
            }

            if (m.t === 'campo.init') {
                field.applyCampoInit(m, Date.now());
                return;
            }

            if (m.t === 'campo') {
                field.applyCampo(m, Date.now());
                runTickForState(merger.getState());
                return;
            }

            if (m.t === 'batalha') {
                handleBattleEvents(m);
                return;
            }

            if (m.t === 'erro') {
                console.error(`[Headless] Erro do servidor: ${m.chave || m.msg || 'desconhecido'}`);
            }
        };

        const scheduleReconnect = (delayMs) => {
            if (shuttingDown || reconnectTimer) return;
            reconnectTimer = setTimeout(async () => {
                reconnectTimer = null;
                if (shuttingDown) return;
                try {
                    const refreshed = await resolveHeadlessSession(sessionOpts);
                    if (refreshed?.token && refreshed?.nick) {
                        session = refreshed;
                    }
                } catch {
                    // mantem sessao em memoria se cache/Chrome estiver indisponivel
                }
                connect();
            }, delayMs);
        };

        const connect = () => {
            if (shuttingDown) return;
            clearSocketTimers();
            field.reset();
            lastMsgAt = Date.now();

            console.log(`[Headless] Conectando em ${DEFAULT_WS_URL} como ${session.nick}...`);
            const socket = new WebSocket(DEFAULT_WS_URL, {
                headers: {
                    Origin: DEFAULT_ORIGIN,
                    'User-Agent': USER_AGENT,
                },
            });
            ws = socket;

            attachWsListeners(socket, {
                onOpen: () => {
                    if (ws !== socket || shuttingDown) return;
                    backoffMs = MIN_RECONNECT_MS;
                    lastMsgAt = Date.now();
                    sendFrame({
                        t: 'hello',
                        nick: session.nick,
                        token: session.token,
                        delta: 1,
                        dispositivo: session.dispositivo,
                    });
                    pingTimer = setInterval(() => {
                        sendFrame({ t: 'ping' });
                    }, PING_INTERVAL_MS);
                    watchdogTimer = setInterval(() => {
                        if (Date.now() - lastMsgAt > WATCHDOG_TIMEOUT_MS) {
                            console.warn('[Headless] Watchdog sem resposta do servidor (>35s). Reiniciando conexao...');
                            try {
                                socket.close(4000, 'watchdog timeout');
                            } catch {
                                // socket ja fechado
                            }
                        }
                    }, WATCHDOG_INTERVAL_MS);
                },
                onMessage: (event) => {
                    if (ws !== socket || shuttingDown) return;
                    handleMessage(event?.data ?? event);
                },
                onError: (err) => {
                    if (ws !== socket || shuttingDown) return;
                    const msg = err?.message || err?.error?.message || 'falha na conexao WebSocket';
                    console.error(`[Headless] Erro WebSocket: ${msg}`);
                },
                onClose: (event) => {
                    if (ws !== socket) return;
                    clearSocketTimers();
                    if (shuttingDown) return;

                    const code = Number(event?.code ?? 0);
                    if (code === 4001) {
                        if (!args.standby) {
                            console.log('Sessão assumida no navegador (4001). Encerrando headless.');
                            requestShutdown(0);
                            return;
                        }
                        console.log(`[Headless] Sessao assumida no navegador (4001). Aguardando ${args.standbySec}s em standby...`);
                        scheduleReconnect(args.standbySec * 1000);
                        return;
                    }

                    const waitMs = backoffMs;
                    backoffMs = Math.min(MAX_RECONNECT_MS, backoffMs * 2);
                    console.warn(`[Headless] Conexao fechada (code=${code}). Reconectando em ${Math.round(waitMs / 1000)}s...`);
                    scheduleReconnect(waitMs);
                },
            });
        };

        connect();
    });
}
