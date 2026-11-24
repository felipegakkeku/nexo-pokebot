// Processo principal Electron do Nexo PokeBot: 1 janela, 1 bandeja, 4 contas isoladas + navegador embutido por conta.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerSaveBlocker, session, shell, Tray } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startGuiServer } from '../headless/gui-server.mjs';
import { createHeadlessHuntGuideEvaluator, findHuntExtensionDir } from '../headless/hunt-guide.mjs';
import { loadAppIconBuffer } from '../desktop/build-exe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const GAME_ORIGIN = 'https://pokeidle.io';
const ACCOUNT_IDS = [1, 2, 3, 4];

app.setName('Nexo PokeBot');
app.setAppUserModelId('com.nexo.pokebot');
app.setPath('userData', join(ROOT, '.pokebot-hub-data'));
app.commandLine.appendSwitch('disk-cache-size', String(32 * 1024 * 1024));
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaRouter');

const singleLock = app.requestSingleInstanceLock();
if (!singleLock) {
    app.quit();
    process.exit(0);
}

let mainWindow = null;
let tray = null;
let awakeId = null;
let minToTray = true;
let isQuitting = false;
let lastTraySignature = '';

const sharedHuntGuide = createHeadlessHuntGuideEvaluator({ cwd: ROOT });
const servers = new Map(); // account (1..4) -> { instance, port, attached: { onFrame, onDetach, bridgeId } | null }
let nextBridgeId = 1;
const pendingHuntQueries = new Map();
let nextHuntQueryId = 1;

let cachedAppIcon = null;

function getAppIcon() {
    if (cachedAppIcon && !cachedAppIcon.isEmpty()) return cachedAppIcon;
    const pngPath = join(ROOT, 'assets', 'nexo-pokebot-icon.png');
    if (existsSync(pngPath)) {
        const fromPng = nativeImage.createFromPath(pngPath);
        if (!fromPng.isEmpty()) {
            cachedAppIcon = fromPng;
            return cachedAppIcon;
        }
    }
    const icoCandidates = [
        join(ROOT, 'assets', 'nexo-pokebot.ico'),
        join(ROOT, 'dist', 'nexo-pokebot.ico'),
        join(ROOT, 'dist', 'pokebot.ico'),
    ];
    for (const icoPath of icoCandidates) {
        if (!existsSync(icoPath)) continue;
        const fromIco = nativeImage.createFromPath(icoPath);
        if (!fromIco.isEmpty()) {
            cachedAppIcon = fromIco;
            return cachedAppIcon;
        }
    }
    const fallbackIco = join(ROOT, 'dist', 'nexo-pokebot.ico');
    try {
        mkdirSync(dirname(fallbackIco), { recursive: true });
        writeFileSync(fallbackIco, loadAppIconBuffer());
        const fromFile = nativeImage.createFromPath(fallbackIco);
        cachedAppIcon = fromFile.isEmpty() ? null : fromFile;
        return cachedAppIcon;
    } catch {
        return null;
    }
}

async function startAccountServer(account) {
    const basePort = 17889 + account;
    const isPrimary = account === 1;
    const cwd = isPrimary ? ROOT : resolve(ROOT, '.pokebot-accounts', String(account));
    const opts = {
        port: basePort,
        host: '127.0.0.1',
        cwd,
        useExistingBrowser: isPrimary,
        enableBrowserProfilePicker: true,
        useEmbeddedBrowser: true,
        isolatedAccount: !isPrimary,
        autoStart: false,
        autoLoginOnMissingSession: false,
        headlessHuntGuide: sharedHuntGuide,
    };

    let instance;
    try {
        instance = await startGuiServer(opts);
    } catch (err) {
        if (err?.code === 'EADDRINUSE') {
            instance = await startGuiServer({ ...opts, port: 0 });
        } else {
            throw err;
        }
    }

    // Inicia farm headless automaticamente apenas se a conta ja tiver sessao salva valida
    const rawSess = instance.controller.getRawSession();
    if (rawSess?.token && rawSess?.nick) {
        instance.controller.start();
    }

    const entry = { account, instance, port: instance.port, attached: null };
    servers.set(account, entry);
    return entry;
}

async function loadHuntExtensionIntoPartitions() {
    const extDir = findHuntExtensionDir({ cwd: ROOT });
    if (!extDir) return null;
    for (const acc of ACCOUNT_IDS) {
        const ses = session.fromPartition(`persist:conta${acc}`);
        try {
            if (typeof ses.extensions?.loadExtension === 'function') {
                await ses.extensions.loadExtension(extDir, { allowFileAccess: false });
            } else if (typeof ses.loadExtension === 'function') {
                await ses.loadExtension(extDir, { allowFileAccess: false });
            }
        } catch {
            // Extensao opcional; o avaliador /hunt headless no Node continua ativo mesmo sem carregar no webview
        }
    }
    return extDir;
}

function getAllSnapshots() {
    const out = {};
    for (const acc of ACCOUNT_IDS) {
        const entry = servers.get(acc);
        if (!entry) continue;
        const snap = entry.instance.controller.getSnapshot({ includeHunts: false });
        out[acc] = {
            ...snap,
            account: acc,
            port: entry.port,
            embeddedActive: Boolean(entry.attached),
        };
    }
    return out;
}

function showMainWindow(focusAccount = null) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (focusAccount && ACCOUNT_IDS.includes(focusAccount)) {
        mainWindow.webContents.send('hub:focus-account', focusAccount);
    }
}

function statusShortLabel(snap) {
    if (!snap) return 'Offline';
    if (snap.embeddedActive && snap.status === 'bridge') return 'Embutido';
    if (snap.status === 'bridge') return 'Acoplado';
    if (snap.status === 'connected') return 'Farmando';
    if (snap.status === 'paused') return 'Pausado';
    if (snap.status === 'standby') return 'Standby';
    if (snap.status === 'connecting') return 'Conectando';
    if (snap.status === 'error') return 'Erro';
    return 'Offline';
}

function refreshTrayMenu() {
    if (!tray || tray.isDestroyed()) return;
    const snaps = getAllSnapshots();
    const sigParts = [];
    const tooltipParts = [];
    const accountItems = [];

    for (const acc of ACCOUNT_IDS) {
        const s = snaps[acc];
        const nick = s?.trainer?.nick && s.trainer.nick !== '-'
            ? s.trainer.nick
            : (s?.session?.nick || `Conta ${acc}`);
        const st = statusShortLabel(s);
        const hunt = s?.trainer?.huntName && s.trainer.huntName !== '-' ? ` · ${s.trainer.huntName}` : '';
        sigParts.push(`${acc}:${nick}:${st}:${hunt}`);
        if (s?.status === 'connected' || s?.status === 'bridge') {
            tooltipParts.push(`${nick} (${st})`);
        }
        accountItems.push({
            label: `Conta ${acc} · ${nick} [${st}]${hunt}`,
            click: () => showMainWindow(acc),
        });
    }

    const sig = sigParts.join('|');
    if (sig === lastTraySignature) return;
    lastTraySignature = sig;

    const tooltip = tooltipParts.length > 0
        ? `Nexo PokeBot: ${tooltipParts.join(' | ')}`
        : 'Nexo PokeBot (4 contas)';
    tray.setToolTip(tooltip.slice(0, 125));

    const menu = Menu.buildFromTemplate([
        { label: 'Abrir Nexo PokeBot', click: () => showMainWindow() },
        { type: 'separator' },
        ...accountItems,
        { type: 'separator' },
        {
            label: 'Modo Eco (fechar embutidos -> Headless)',
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('hub:eco-all-headless');
                }
            },
        },
        {
            label: 'Iniciar todas logadas (Headless)',
            click: () => {
                for (const acc of ACCOUNT_IDS) {
                    const entry = servers.get(acc);
                    if (!entry || entry.attached) continue;
                    if (entry.instance.controller.getRawSession()) {
                        entry.instance.controller.start();
                    }
                }
            },
        },
        {
            label: 'Pausar todas',
            click: () => {
                for (const acc of ACCOUNT_IDS) {
                    servers.get(acc)?.instance?.controller?.pause();
                }
            },
        },
        { type: 'separator' },
        {
            label: 'Sair do Nexo PokeBot',
            click: () => {
                isQuitting = true;
                app.quit();
            },
        },
    ]);
    tray.setContextMenu(menu);
}

function setupTray() {
    const icon = getAppIcon();
    if (!icon) return;
    try {
        tray = new Tray(icon);
        tray.on('click', () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            if (mainWindow.isVisible()) mainWindow.hide();
            else showMainWindow();
        });
        tray.on('double-click', () => showMainWindow());
        refreshTrayMenu();
        const timer = setInterval(refreshTrayMenu, 5000);
        timer.unref?.();
    } catch {
        tray = null;
    }
}

function registerWebviewSecurity() {
    const preloadPath = join(HERE, 'webview-preload.cjs');

    app.on('web-contents-created', (_event, contents) => {
        contents.on('will-attach-webview', (ev, webPreferences, params) => {
            const partition = String(params.partition || '');
            if (!/^persist:conta[1-4]$/.test(partition)) {
                ev.preventDefault();
                return;
            }
            const src = String(params.src || '');
            let allowedSrc = src === 'about:blank' || src === '';
            if (!allowedSrc) {
                try {
                    allowedSrc = new URL(src).origin === GAME_ORIGIN;
                } catch {
                    allowedSrc = false;
                }
            }
            if (!allowedSrc) {
                ev.preventDefault();
                return;
            }
            delete webPreferences.enableBlinkFeatures;
            Object.assign(webPreferences, {
                nodeIntegration: false,
                nodeIntegrationInSubFrames: false,
                nodeIntegrationInWorker: false,
                contextIsolation: true,
                sandbox: false,
                webSecurity: true,
                webviewTag: false,
                backgroundThrottling: false,
                preload: preloadPath,
            });
        });

        if (contents.getType() !== 'webview') return;
        try { contents.setAudioMuted(true); } catch { /* ignore */ }

        contents.setWindowOpenHandler(({ url }) => {
            try {
                const parsed = new URL(url);
                // Permite popups de autenticacao OAuth (Google/Discord) dentro do proprio fluxo ou abre links externos no perfil da conta
                if (/^(?:accounts\.google\.com|discord\.com|pokeidle\.io)$/i.test(parsed.hostname)) {
                    return { action: 'allow' };
                }
                if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                    const isLiveHost = /(?:^|\.)(?:twitch\.tv|kick\.com)$/i.test(parsed.hostname);
                    let ownerAccount = 1;
                    for (const acc of ACCOUNT_IDS) {
                        if (contents.session === session.fromPartition(`persist:conta${acc}`)) {
                            ownerAccount = acc;
                            break;
                        }
                    }
                    const ctrl = servers.get(ownerAccount)?.instance?.controller;
                    if (ctrl?.openExternalUrl) {
                        ctrl.openExternalUrl(parsed.toString(), { forLives: isLiveHost })
                            .then((opened) => {
                                if (!opened) shell.openExternal(parsed.toString()).catch(() => {});
                            })
                            .catch(() => shell.openExternal(parsed.toString()).catch(() => {}));
                    } else {
                        shell.openExternal(url).catch(() => {});
                    }
                }
            } catch {
                // ignora URL invalida
            }
            return { action: 'deny' };
        });
    });
}

function registerIpcHandlers() {
    ipcMain.handle('hub:get-all-snapshots', () => getAllSnapshots());

    ipcMain.handle('hub:get-hunts', (_ev, { account } = {}) => {
        const preferred = servers.get(Number(account));
        const preferredList = preferred?.instance?.controller?.getHunts?.() || [];
        if (preferredList.length > 0) return preferredList;
        for (const entry of servers.values()) {
            const list = entry.instance?.controller?.getHunts?.() || [];
            if (list.length > 0) return list;
        }
        return [];
    });

    ipcMain.handle('hub:get-webview-preload', () => pathToFileURL(join(HERE, 'webview-preload.cjs')).href);

    ipcMain.handle('hub:action', async (_ev, { account, action, payload = {} } = {}) => {
        const acc = Number(account);
        const entry = servers.get(acc);
        if (!entry) return { ok: false, error: `Conta ${acc} nao inicializada.` };
        const { controller, port } = entry.instance;
        const act = String(action || '');
        let ok = true;

        if (act === 'start' || act === 'reconnect') {
            if (entry.attached) {
                entry.attached.onDetach();
                entry.attached = null;
            }
            ok = Boolean(controller.reconnect());
        } else if (act === 'pause') {
            controller.pause();
        } else if (act === 'set-hunt') {
            ok = controller.setHunt(payload.slug);
        } else if (act === 'go-center') {
            ok = controller.triggerAction('go-center');
        } else if (act === 'cancel-pending-hunt') {
            ok = controller.triggerAction('cancel-pending-hunt');
        } else if (act === 'set-config') {
            controller.updateConfig(payload.config || payload);
        } else if (act === 'restock-now') {
            ok = controller.triggerAction('restock');
        } else if (act === 'claim-pass') {
            ok = controller.triggerAction('pass');
        } else if (act === 'roll-prey') {
            ok = controller.triggerAction('prey');
        } else if (act === 'heal-now') {
            ok = controller.triggerAction('heal');
        } else if (act === 'reload-session') {
            ok = controller.triggerAction('reload-session');
        } else if (act === 'cancel-login') {
            ok = controller.triggerAction('cancel-login');
        } else if (act === 'run-lives') {
            ok = controller.triggerAction('run-lives');
        } else if (act === 'reset-stats') {
            ok = controller.triggerAction('reset-stats');
        } else if (act === 'login-twitch') {
            ok = controller.startLogin('twitch', { interactive: payload.interactive === true });
        } else if (act === 'login-kick') {
            ok = controller.startLogin('kick', { interactive: payload.interactive === true });
        } else if (act === 'login-pokeidle') {
            ok = controller.startLogin('pokeidle', { interactive: payload.interactive === true });
        } else if (act === 'open-lives') {
            ok = await controller.openLives(payload.url);
        } else if (act === 'open-live-chat') {
            ok = typeof payload.url === 'string' && await controller.openLives(payload.url, { chatOnly: true });
        } else if (act === 'open-extensions') {
            ok = await controller.openPanel(port, { extensions: true });
        } else if (act === 'open-panel') {
            ok = await controller.openPanel(port);
        } else if (act === 'open-game') {
            ok = await controller.openGame();
        } else if (act === 'import-session') {
            const imported = controller.importSession(payload || {});
            if (!imported?.ok) {
                return { ok: false, error: imported?.error || 'Sessão inválida', snapshots: getAllSnapshots() };
            }
            ok = true;
        } else if (act === 'import-live-tokens') {
            const imported = controller.importLiveTokens(payload || {});
            if (!imported?.ok) {
                return { ok: false, error: imported?.error || 'Tokens inválidos', snapshots: getAllSnapshots() };
            }
            ok = true;
        } else if (act === 'clear-webview-data') {
            const ses = session.fromPartition(`persist:conta${acc}`);
            await ses.clearStorageData();
            await ses.clearCache();
            ok = true;
        } else {
            return { ok: false, error: `Acao desconhecida: ${act}` };
        }

        refreshTrayMenu();
        return { ok, snapshots: getAllSnapshots() };
    });

    ipcMain.handle('hub:webview-attach', (_ev, { account } = {}) => {
        const acc = Number(account);
        const entry = servers.get(acc);
        if (!entry) return { ok: false, error: 'Conta invalida.' };

        const { controller } = entry.instance;
        const seedSession = controller.getRawSession();
        const bridgeId = nextBridgeId++;

        const bridge = {
            isReady: () => Boolean(entry.attached && entry.attached.bridgeId === bridgeId && mainWindow && !mainWindow.isDestroyed()),
            send: (frame) => {
                if (!bridge.isReady()) return false;
                mainWindow.webContents.send('hub:webview-send', { account: acc, rawJson: JSON.stringify(frame) });
                return true;
            },
            readHuntGuide: (metric) => new Promise((resolveQuery) => {
                if (!bridge.isReady()) {
                    resolveQuery(null);
                    return;
                }
                const qid = nextHuntQueryId++;
                const timer = setTimeout(() => {
                    pendingHuntQueries.delete(qid);
                    resolveQuery(null);
                }, 4000);
                pendingHuntQueries.set(qid, (val) => {
                    clearTimeout(timer);
                    resolveQuery(val ?? null);
                });
                mainWindow.webContents.send('hub:webview-read-hunt', { account: acc, metric, queryId: qid });
            }),
            close: () => {
                if (entry.attached?.bridgeId === bridgeId) {
                    entry.attached = null;
                }
            },
        };

        const hooks = controller.attachExternalBridge(bridge, { waitForWelcome: true });
        entry.attached = { bridgeId, ...hooks };
        refreshTrayMenu();
        return { ok: true, bridgeId, seedSession };
    });

    ipcMain.handle('hub:webview-detach', (_ev, { account, startHeadless = false } = {}) => {
        const acc = Number(account);
        const entry = servers.get(acc);
        if (!entry) return { ok: false };
        if (entry.attached) {
            const { onDetach } = entry.attached;
            entry.attached = null;
            onDetach();
        }
        if (startHeadless && entry.instance.controller.getRawSession()) {
            entry.instance.controller.start();
        }
        refreshTrayMenu();
        return { ok: true, snapshots: getAllSnapshots() };
    });

    ipcMain.on('hub:webview-ws-frame', (_ev, { account, raw } = {}) => {
        const entry = servers.get(Number(account));
        if (entry?.attached?.onFrame && typeof raw === 'string') {
            entry.attached.onFrame(raw);
        }
    });

    ipcMain.on('hub:webview-session', (_ev, { account, session: rawSess } = {}) => {
        const entry = servers.get(Number(account));
        if (entry && rawSess) {
            entry.instance.controller.syncWebviewSession(rawSess);
        }
    });

    ipcMain.on('hub:webview-hunt-result', (_ev, { queryId, result } = {}) => {
        const resolver = pendingHuntQueries.get(queryId);
        if (resolver) {
            pendingHuntQueries.delete(queryId);
            resolver(result ?? null);
        }
    });

    ipcMain.handle('hub:window-minimize-tray', () => {
        if (mainWindow && !mainWindow.isDestroyed() && tray) {
            mainWindow.hide();
            return true;
        }
        mainWindow?.minimize();
        return false;
    });

    ipcMain.handle('hub:awake-set', (_ev, enabled) => {
        if (enabled && awakeId === null) {
            awakeId = powerSaveBlocker.start('prevent-app-suspension');
        } else if (!enabled && awakeId !== null) {
            powerSaveBlocker.stop(awakeId);
            awakeId = null;
        }
        return awakeId !== null;
    });

    ipcMain.handle('hub:mintray-set', (_ev, enabled) => {
        minToTray = Boolean(enabled);
        return minToTray;
    });

    ipcMain.handle('hub:open-external', async (_ev, url, account = 1) => {
        try {
            const parsed = new URL(String(url));
            if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                const isLiveHost = /(?:^|\.)(?:twitch\.tv|kick\.com)$/i.test(parsed.hostname);
                const ctrl = servers.get(Number(account) || 1)?.instance?.controller;
                if (ctrl?.openExternalUrl) {
                    const opened = await ctrl.openExternalUrl(parsed.toString(), { forLives: isLiveHost }).catch(() => false);
                    if (opened) return true;
                }
                return shell.openExternal(parsed.toString()).then(() => true).catch(() => false);
            }
        } catch {
            // URL invalida
        }
        return false;
    });
}

async function createMainWindow() {
    const icon = getAppIcon();
    mainWindow = new BrowserWindow({
        width: 1480,
        height: 880,
        minWidth: 1020,
        minHeight: 680,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#0a0f19',
        title: 'Nexo PokeBot v1.0',
        ...(icon ? { icon } : {}),
        webPreferences: {
            webviewTag: true,
            preload: join(HERE, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: true,
        },
    });

    mainWindow.once('ready-to-show', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.show();
    });

    mainWindow.on('minimize', () => {
        if (minToTray && tray) {
            mainWindow.hide();
        }
    });

    mainWindow.on('close', () => {
        isQuitting = true;
    });

    await mainWindow.loadFile(join(HERE, 'renderer.html'));
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
    }
}

app.on('second-instance', () => {
    showMainWindow();
});

let cleanedUp = false;
app.on('before-quit', (ev) => {
    isQuitting = true;
    if (cleanedUp) return;
    ev.preventDefault();
    cleanedUp = true;
    if (awakeId !== null) {
        try { powerSaveBlocker.stop(awakeId); } catch { /* ignore */ }
        awakeId = null;
    }
    const closing = [...servers.values()].map((entry) => entry.instance.close().catch(() => {}));
    servers.clear();
    try { sharedHuntGuide?.dispose?.(); } catch { /* ignore */ }
    Promise.allSettled(closing).finally(() => app.exit(0));
});

app.on('window-all-closed', () => {
    if (isQuitting) app.quit();
});

registerWebviewSecurity();
registerIpcHandlers();

app.whenReady().then(async () => {
    await Promise.all(ACCOUNT_IDS.map((acc) => startAccountServer(acc)));
    await loadHuntExtensionIntoPartitions();
    await createMainWindow();
    setupTray();
}).catch((err) => {
    console.error('[Nexo PokeBot] Falha ao iniciar:', err);
    isQuitting = true;
    app.quit();
});
