// Processo principal Electron do Nexo PokeBot: 1 janela, 1 bandeja, 4 contas isoladas + navegador embutido por conta.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, powerSaveBlocker, session, shell, Tray } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startGuiServer } from '../headless/gui-server.mjs';
import { createHeadlessHuntGuideEvaluator, findHuntExtensionDir } from '../headless/hunt-guide.mjs';
import { loadAppIconBuffer } from '../desktop/build-exe.mjs';
import {
    checkForUpdate,
    compareSemver,
    downloadAndStageUpdate,
    launchApplyUpdateScript,
    readInstalledVersion,
} from '../desktop/updater.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const GAME_ORIGIN = 'https://pokeidle.io';
const ACCOUNT_IDS = [1, 2, 3, 4];

app.setName('Nexo PokeBot');
app.setAppUserModelId('com.nexo.pokebot');
app.setPath('userData', join(ROOT, '.pokebot-hub-data'));
app.commandLine.appendSwitch('disk-cache-size', String(32 * 1024 * 1024));
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaRouter');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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

const installedVersion = readInstalledVersion(ROOT);
let latestReleaseInfo = null;
let updateCheckTimer = null;
let updateBootTimer = null;
let updateBusy = false;
let updateState = {
    status: 'idle', // idle | checking | up-to-date | available | downloading | extracting | applying | error
    currentVersion: installedVersion,
    latestVersion: installedVersion,
    tagName: `v${installedVersion}`,
    releaseName: `Nexo PokeBot v${installedVersion}`,
    releaseNotes: '',
    releaseUrl: 'https://github.com/felipegakkeku/nexo-pokebot/releases/latest',
    hasUpdate: false,
    isGitRepo: existsSync(join(ROOT, '.git')),
    assetName: '',
    assetSize: 0,
    percent: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    checkedAt: 0,
    error: null,
    justUpdatedFrom: '', // preenchido no boot quando a atualizacao anterior foi aplicada
    failedTarget: '', // versao que o ultimo update tentou aplicar e nao conseguiu
    logPath: join(tmpdir(), 'nexo-pokebot-last-update.log'),
};

// Marcador gravado antes de fechar para atualizar; no boot seguinte confirma se a
// versao mudou de verdade (antes o update podia "terminar" sem trocar nada).
const UPDATE_MARKER_PATH = join(ROOT, '.pokebot-update-pending.json');
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
let lastNativeUpdateNotice = '';

function verifyPendingUpdateMarker() {
    if (!existsSync(UPDATE_MARKER_PATH)) return;
    let marker = null;
    try {
        marker = JSON.parse(readFileSync(UPDATE_MARKER_PATH, 'utf8'));
    } catch {
        marker = null;
    }
    try { rmSync(UPDATE_MARKER_PATH, { force: true }); } catch { /* ignore */ }
    const target = String(marker?.to || '').trim();
    if (!target) return;
    // Marcador velho (mais de 1 dia) nao diz nada sobre este boot
    if (Date.now() - Number(marker?.at || 0) > 24 * 3600 * 1000) return;
    if (compareSemver(installedVersion, target) >= 0) {
        updateState.justUpdatedFrom = String(marker?.from || '');
    } else {
        updateState.failedTarget = target;
        updateState.status = 'error';
        updateState.error = `A atualização para v${target} não foi aplicada. Tente de novo; se repetir, baixe o ZIP da Release e extraia por cima da pasta.`;
    }
}
verifyPendingUpdateMarker();

function broadcastUpdateState() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hub:update-state', updateState);
    }
    refreshTrayMenu();
}

// Aviso nativo do Windows (aparece mesmo com o Hub minimizado na bandeja)
function notifyUpdateAvailable(version) {
    if (!version || version === lastNativeUpdateNotice) return;
    lastNativeUpdateNotice = version;
    try {
        if (!Notification.isSupported()) return;
        const icon = getAppIcon();
        const n = new Notification({
            title: `Nexo PokeBot v${version} disponível`,
            body: 'Clique para abrir e atualizar. Suas contas e sessões ficam preservadas.',
            ...(icon ? { icon } : {}),
        });
        n.on('click', () => {
            showMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hub:update-open');
        });
        n.show();
    } catch {
        // notificacao e opcional
    }
}

function patchUpdateState(patch) {
    updateState = { ...updateState, ...patch };
    broadcastUpdateState();
    return updateState;
}

async function runUpdateCheck() {
    if (updateBusy) return updateState;
    updateBusy = true;
    patchUpdateState({ status: 'checking', error: null });
    try {
        const res = await checkForUpdate({ rootDir: ROOT, currentVersion: installedVersion });
        if (!res.ok) {
            return patchUpdateState({
                status: 'error',
                checkedAt: Date.now(),
                error: res.error || 'Falha ao verificar atualizacao.',
            });
        }
        latestReleaseInfo = res;
        if (res.hasUpdate && !res.isGitRepo) notifyUpdateAvailable(res.latestVersion);
        return patchUpdateState({
            status: res.hasUpdate ? 'available' : 'up-to-date',
            currentVersion: res.currentVersion,
            latestVersion: res.latestVersion,
            tagName: res.tagName,
            releaseName: res.releaseName,
            releaseNotes: res.releaseNotes,
            releaseUrl: res.releaseUrl,
            hasUpdate: res.hasUpdate,
            isGitRepo: res.isGitRepo,
            assetName: res.asset?.name || '',
            assetSize: Number(res.asset?.size || 0),
            percent: 0,
            downloadedBytes: 0,
            totalBytes: Number(res.asset?.size || 0),
            checkedAt: Date.now(),
            error: null,
        });
    } finally {
        updateBusy = false;
    }
}

async function runUpdateInstall() {
    if (updateBusy) return { ok: false, error: 'Atualizacao ja esta em andamento.' };
    if (!latestReleaseInfo?.hasUpdate || !latestReleaseInfo?.asset?.downloadUrl) {
        await runUpdateCheck();
    }
    if (!latestReleaseInfo?.hasUpdate) {
        return { ok: false, error: 'Voce ja esta na versao mais recente.' };
    }
    if (!latestReleaseInfo?.asset?.downloadUrl) {
        return { ok: false, error: 'A Release nao possui pacote ZIP para Windows.' };
    }
    if (latestReleaseInfo.isGitRepo) {
        return {
            ok: false,
            error: 'Pasta de desenvolvimento (.git) detectada. Atualize via git pull ou baixe a Release manualmente.',
        };
    }
    updateBusy = true;
    patchUpdateState({ status: 'downloading', percent: 0, downloadedBytes: 0, error: null });
    try {
        const staged = await downloadAndStageUpdate({
            rootDir: ROOT,
            releaseInfo: latestReleaseInfo,
            waitPids: [process.pid],
            onProgress: (p) => {
                if (p.phase === 'downloading') {
                    patchUpdateState({
                        status: 'downloading',
                        percent: p.percent || 0,
                        downloadedBytes: p.downloadedBytes || 0,
                        totalBytes: p.totalBytes || updateState.assetSize || 0,
                    });
                } else if (p.phase === 'extracting') {
                    patchUpdateState({ status: 'extracting', percent: 100 });
                }
            },
        });
        patchUpdateState({ status: 'applying', percent: 100 });
        try {
            writeFileSync(UPDATE_MARKER_PATH, JSON.stringify({
                from: installedVersion,
                to: staged.version,
                at: Date.now(),
            }), 'utf8');
        } catch { /* sem marcador o update segue igual */ }
        // Espera o processo do instalador existir (fora da arvore do app) antes de fechar
        await launchApplyUpdateScript(staged.scriptPath);
        setTimeout(() => {
            isQuitting = true;
            app.quit();
        }, 450);
        return { ok: true, version: staged.version };
    } catch (err) {
        const msg = err?.message || String(err);
        patchUpdateState({ status: 'error', error: msg });
        return { ok: false, error: msg };
    } finally {
        updateBusy = false;
    }
}

const sharedHuntGuide = createHeadlessHuntGuideEvaluator({ cwd: ROOT });
const servers = new Map(); // account (1..4) -> { instance, port, attached: { onFrame, onDetach, bridgeId } | null }
const actionPopups = new Map(); // key -> BrowserWindow (voto ou caixinha +50 embutido leve)
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

function fmtTrayNum(n) {
    const v = Number(n || 0);
    const a = Math.abs(v);
    if (a >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')} mi`;
    if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',')} mil`;
    return String(Math.round(v));
}

function refreshTrayMenu(snapsArg = null) {
    if (!tray || tray.isDestroyed()) return;
    const snaps = snapsArg || getAllSnapshots();
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
        const running = s?.status === 'connected' || s?.status === 'bridge';
        const rates = running
            ? `   ${fmtTrayNum(s?.stats?.xpPerHour)} XP/h · ${Number(s?.stats?.netGoldPerHour || 0) >= 0 ? '+' : ''}${fmtTrayNum(s?.stats?.netGoldPerHour)} ouro/h · ${Number(s?.stats?.shiniesCaptured || 0)} shiny`
            : '';
        sigParts.push(`${acc}:${nick}:${st}:${hunt}:${rates}`);
        if (running) {
            tooltipParts.push(`${nick} (${st})`);
        }
        accountItems.push({
            label: `Conta ${acc} · ${nick} [${st}]${hunt}`,
            click: () => showMainWindow(acc),
        });
        if (rates) accountItems.push({ label: rates, enabled: false });
    }

    const updSig = `${updateState.status}:${updateState.latestVersion}:${updateState.hasUpdate}:${miniHudWindow ? 1 : 0}`;
    const sig = `${sigParts.join('|')}||${updSig}`;
    if (sig === lastTraySignature) return;
    lastTraySignature = sig;

    const tooltip = tooltipParts.length > 0
        ? `Nexo PokeBot: ${tooltipParts.join(' | ')}`
        : 'Nexo PokeBot (4 contas)';
    tray.setToolTip(tooltip.slice(0, 125));

    const updateTrayItem = updateState.hasUpdate
        ? {
            label: `Atualizar para v${updateState.latestVersion} (nova Release)`,
            click: () => {
                showMainWindow();
                if (!updateState.isGitRepo) void runUpdateInstall();
            },
        }
        : {
            label: `Verificar atualizacoes (v${installedVersion})`,
            click: () => {
                showMainWindow();
                void runUpdateCheck();
            },
        };

    const menu = Menu.buildFromTemplate([
        { label: 'Abrir Nexo PokeBot', click: () => showMainWindow() },
        updateTrayItem,
        { type: 'separator' },
        ...accountItems,
        { type: 'separator' },
        {
            label: 'Mini-HUD sempre visível',
            type: 'checkbox',
            checked: Boolean(miniHudWindow),
            click: () => toggleMiniHud(),
        },
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
                autoplayPolicy: 'no-user-gesture-required',
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

function cleanBrowserUserAgent(rawUa) {
    return String(rawUa || '').replace(/\s*Electron\/[^\s]+/gi, '').trim();
}

async function seedTwitchCookiesInPartition(acc, creds) {
    if (!creds?.twitchToken) return;
    const ses = session.fromPartition(`persist:conta${acc}`);
    const exp = Math.floor(Date.now() / 1000) + 180 * 86400;
    try {
        const existing = await ses.cookies.get({ domain: 'twitch.tv', name: 'auth-token' });
        if (!existing.some((c) => c.value === creds.twitchToken)) {
            await ses.cookies.set({
                url: 'https://www.twitch.tv',
                domain: '.twitch.tv',
                path: '/',
                name: 'auth-token',
                value: creds.twitchToken,
                secure: true,
                httpOnly: false,
                sameSite: 'no_restriction',
                expirationDate: exp,
            });
        }
        if (creds.twitchDeviceId) {
            const existingDev = await ses.cookies.get({ domain: 'twitch.tv', name: 'unique_id' });
            if (!existingDev.some((c) => c.value === creds.twitchDeviceId)) {
                await ses.cookies.set({
                    url: 'https://www.twitch.tv',
                    domain: '.twitch.tv',
                    path: '/',
                    name: 'unique_id',
                    value: creds.twitchDeviceId,
                    secure: true,
                    httpOnly: false,
                    sameSite: 'no_restriction',
                    expirationDate: exp,
                });
            }
        }
    } catch {
        // segue mesmo se o cookie ja existir em outro formato
    }
}

function createCompactActionPopup({ key, account, title, width, height, url, allowedPopupHosts = [], onClosed = null }) {
    const existing = actionPopups.get(key);
    if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
        return existing;
    }

    const icon = getAppIcon();
    const popup = new BrowserWindow({
        width,
        height,
        minWidth: 360,
        minHeight: 460,
        parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
        autoHideMenuBar: true,
        backgroundColor: '#0e0e10',
        title,
        ...(icon ? { icon } : {}),
        webPreferences: {
            partition: `persist:conta${account}`,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    const cleanUa = cleanBrowserUserAgent(popup.webContents.getUserAgent());
    if (cleanUa) popup.webContents.setUserAgent(cleanUa);

    popup.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
        try {
            const parsed = new URL(nextUrl);
            if (allowedPopupHosts.some((re) => re.test(parsed.hostname))) {
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: {
                        autoHideMenuBar: true,
                        width: 520,
                        height: 680,
                        webPreferences: {
                            partition: `persist:conta${account}`,
                            contextIsolation: true,
                            nodeIntegration: false,
                            sandbox: true,
                        },
                    },
                };
            }
            if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                shell.openExternal(parsed.toString()).catch(() => {});
            }
        } catch {
            // ignora URL invalida
        }
        return { action: 'deny' };
    });

    actionPopups.set(key, popup);
    popup.on('closed', () => {
        if (actionPopups.get(key) === popup) actionPopups.delete(key);
        if (typeof onClosed === 'function') onClosed();
    });
    void popup.loadURL(url, cleanUa ? { userAgent: cleanUa } : undefined);
    return popup;
}

async function openEmbeddedVotePopup(acc) {
    const entry = servers.get(acc);
    if (!entry) return false;
    const { controller } = entry.instance;
    let snap = controller.getSnapshot({ includeHunts: false });
    if (!snap?.vote?.url) {
        await controller.refreshVoteStatus({ force: true });
        snap = controller.getSnapshot({ includeHunts: false });
    }
    const targetUrl = snap?.vote?.url;
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) return false;
    const nick = snap?.trainer?.nick && snap.trainer.nick !== '-'
        ? snap.trainer.nick
        : (snap?.session?.nick || `Conta ${acc}`);

    createCompactActionPopup({
        key: `vote:${acc}`,
        account: acc,
        title: `Vote & Ganhe · Conta ${acc} (${nick})`,
        width: 560,
        height: 740,
        url: targetUrl,
        allowedPopupHosts: [/(?:^|\.)(?:idlehub\.io|google\.com|gstatic\.com|pokeidle\.io)$/i],
        onClosed: () => {
            void controller.refreshVoteStatus({ force: true });
        },
    });
    return true;
}

async function openEmbeddedTwitchChestPopup(acc, rawChannel) {
    const entry = servers.get(acc);
    if (!entry) return false;
    const channel = String(rawChannel || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{1,40}$/.test(channel)) return false;
    const { controller } = entry.instance;
    const creds = controller.getLiveCredentials?.() || {};
    await seedTwitchCookiesInPartition(acc, creds);

    createCompactActionPopup({
        key: `chest:${acc}:${channel}`,
        account: acc,
        title: `Caixinha +50 · ${channel} (Conta ${acc})`,
        width: 400,
        height: 580,
        url: `https://www.twitch.tv/popout/${encodeURIComponent(channel)}/chat`,
        allowedPopupHosts: [/(?:^|\.)twitch\.tv$/i],
        onClosed: () => {
            controller.triggerAction('run-lives');
        },
    });
    return true;
}

// Resgate da caixinha +50 sem o usuario ver o chat: a API GQL barra o claim com
// IntegrityCheckFailed, entao o clique acontece dentro do proprio chat popout da
// Twitch (que gera o token de integridade sozinho), numa janela invisivel e
// sem foco na particao da conta.
const CHEST_PROBE_JS = `(() => {
    const re = /claim bonus|resgatar b[oô]nus|obter b[oô]nus|reivindicar b[oô]nus/i;
    const icon = document.querySelector('.claimable-bonus__icon');
    let btn = icon ? icon.closest('button') : null;
    if (!btn) {
        btn = Array.from(document.querySelectorAll('button[aria-label]'))
            .find((b) => re.test(b.getAttribute('aria-label') || '')) || null;
    }
    const points = Boolean(document.querySelector('[data-test-selector="community-points-summary"]'));
    if (!btn) return { state: 'waiting', points };
    btn.scrollIntoView({ block: 'center', inline: 'center' });
    const r = btn.getBoundingClientRect();
    return { state: 'claimable', points, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const CHEST_JS_CLICK = `(() => {
    const re = /claim bonus|resgatar b[oô]nus|obter b[oô]nus|reivindicar b[oô]nus/i;
    const icon = document.querySelector('.claimable-bonus__icon');
    const btn = (icon && icon.closest('button')) ||
        Array.from(document.querySelectorAll('button[aria-label]')).find((b) => re.test(b.getAttribute('aria-label') || ''));
    if (!btn) return false;
    btn.click();
    return true;
})()`;

const chestClaimsInFlight = new Map(); // `${acc}:${channel}` -> Promise

const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function runHiddenTwitchChestClaim(acc, channel) {
    const win = new BrowserWindow({
        width: 420,
        height: 640,
        show: false,
        frame: false,
        focusable: false,
        skipTaskbar: true,
        opacity: 0,
        backgroundColor: '#0e0e10',
        webPreferences: {
            partition: `persist:conta${acc}`,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    const probe = async () => {
        if (win.isDestroyed()) return { state: 'closed' };
        try {
            return await win.webContents.executeJavaScript(CHEST_PROBE_JS, true);
        } catch {
            return { state: 'waiting', points: false };
        }
    };
    try {
        win.setIgnoreMouseEvents(true);
        win.webContents.setAudioMuted(true);
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        const cleanUa = cleanBrowserUserAgent(win.webContents.getUserAgent());
        if (cleanUa) win.webContents.setUserAgent(cleanUa);
        // Janela "visivel" para o Chromium (opacidade 0, sem foco, ignora mouse)
        // para o chat nao ficar congelado como aba em segundo plano.
        win.once('ready-to-show', () => {
            if (!win.isDestroyed()) win.showInactive();
        });
        await win.loadURL(
            `https://www.twitch.tv/popout/${encodeURIComponent(channel)}/chat`,
            cleanUa ? { userAgent: cleanUa } : undefined
        ).catch(() => {});

        const deadline = Date.now() + 25_000;
        let pointsSince = 0;
        let found = null;
        while (Date.now() < deadline) {
            const st = await probe();
            if (st?.state === 'closed') return { ok: false, reason: 'closed' };
            if (st?.state === 'claimable') {
                found = st;
                break;
            }
            if (st?.points && !pointsSince) pointsSince = Date.now();
            // Pontos do canal carregaram e a caixinha nao apareceu: ja foi resgatada ou expirou
            if (pointsSince && Date.now() - pointsSince > 8_000) {
                return { ok: false, reason: 'no-chest' };
            }
            await waitMs(750);
        }
        if (!found) return { ok: false, reason: pointsSince ? 'no-chest' : 'not-loaded' };

        // 1) clique "real" injetado no renderer; 2) se nao sumir, clique via DOM
        for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
            win.webContents.sendInputEvent({ type, x: found.x, y: found.y, button: 'left', clickCount: 1 });
        }
        for (let attempt = 0; attempt < 2; attempt++) {
            for (let i = 0; i < 8; i++) {
                await waitMs(500);
                const st = await probe();
                if (st?.state !== 'claimable') return { ok: true };
            }
            if (attempt === 0) {
                await win.webContents.executeJavaScript(CHEST_JS_CLICK, true).catch(() => false);
            }
        }
        return { ok: false, reason: 'click-ignored' };
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
}

async function claimTwitchChestFromHud(acc, rawChannel, { fallbackPopup = true } = {}) {
    const entry = servers.get(acc);
    if (!entry) return { ok: false, error: `Conta ${acc} nao inicializada.` };
    const channel = String(rawChannel || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{1,40}$/.test(channel)) return { ok: false, error: 'Canal invalido.' };
    const { controller } = entry.instance;
    const creds = controller.getLiveCredentials?.() || {};
    if (!creds.twitchToken) {
        return { ok: false, error: 'Conecte a Twitch nesta conta para resgatar a caixinha pela HUD.' };
    }

    const key = `${acc}:${channel}`;
    if (!chestClaimsInFlight.has(key)) {
        const job = (async () => {
            await seedTwitchCookiesInPartition(acc, creds);
            try {
                return await runHiddenTwitchChestClaim(acc, channel);
            } catch (err) {
                return { ok: false, reason: 'error', detail: String(err?.message || err) };
            }
        })().finally(() => chestClaimsInFlight.delete(key));
        chestClaimsInFlight.set(key, job);
    }
    const res = await chestClaimsInFlight.get(key);
    if (res.ok) controller.noteLiveChestClaimed?.(channel, fallbackPopup ? 'hud' : 'auto');
    controller.triggerAction('run-lives');

    if (res.ok) return { ok: true, message: `Caixinha +50 resgatada em ${channel}.` };
    if (res.reason === 'no-chest') {
        return { ok: false, error: `Nenhuma caixinha disponivel em ${channel} agora (ja resgatada ou expirou).` };
    }
    if (!fallbackPopup) return { ok: false, reason: res.reason, error: `Resgate automatico falhou em ${channel} (${res.reason}).` };
    // Nao conseguiu sozinho: abre o chat leve visivel como plano B
    await openEmbeddedTwitchChestPopup(acc, channel);
    return {
        ok: false,
        fallback: true,
        error: `Nao deu para resgatar sozinho em ${channel}; abri o chat leve para voce clicar.`,
    };
}

// Resgate automatico: quando a Twitch marca a caixinha como manual (GQL barrado),
// o Hub resgata pela janela oculta, uma por vez, sem o usuario clicar.
const AUTO_CHEST_TICK_MS = 15_000;
const autoChestNextTry = new Map(); // `${acc}:${channel}` -> timestamp
let autoChestBusy = false;
let autoChestTimer = null;

function nextAutoChestCandidate() {
    const now = Date.now();
    for (const acc of ACCOUNT_IDS) {
        const entry = servers.get(acc);
        if (!entry) continue;
        const snap = entry.instance.controller.getSnapshot({ includeHunts: false });
        if (snap?.config?.liveAutoClaimChest === false) continue;
        for (const [channel, st] of Object.entries(snap?.lives?.twitch || {})) {
            if (!st?.manualChest) continue;
            const key = `${acc}:${channel}`;
            if (chestClaimsInFlight.has(key)) continue;
            if ((autoChestNextTry.get(key) || 0) > now) continue;
            return { acc, channel, key };
        }
    }
    return null;
}

async function autoChestTick() {
    if (autoChestBusy) return;
    const cand = nextAutoChestCandidate();
    if (!cand) return;
    autoChestBusy = true;
    try {
        const res = await claimTwitchChestFromHud(cand.acc, cand.channel, { fallbackPopup: false });
        if (res.ok) {
            autoChestNextTry.delete(cand.key);
        } else {
            // sem caixinha: confere de novo em 2 min; falha de verdade: espera 10 min
            const wait = res.reason === 'no-chest' ? 2 * 60_000 : 10 * 60_000;
            autoChestNextTry.set(cand.key, Date.now() + wait);
        }
    } catch {
        autoChestNextTry.set(cand.key, Date.now() + 10 * 60_000);
    } finally {
        autoChestBusy = false;
    }
}

function startAutoChestWatcher() {
    if (autoChestTimer) return;
    autoChestTimer = setInterval(() => void autoChestTick(), AUTO_CHEST_TICK_MS);
    autoChestTimer.unref?.();
}

// ===== Sequencia de lives e seguir automatico =====
// Os pings simulados do bot contam minutos e pontos, mas a sequencia de lives
// (watch streak) so aparece quando a Twitch ve um player de verdade tocando.
// O Hub abre a pagina do canal numa janela invisivel da particao da conta
// (160p, sem som), assiste os primeiros minutos de cada transmissao e fecha.
// Na mesma visita, clica em Seguir se a conta ainda nao segue o canal.
const LIVE_WATCH_TICK_MS = 30_000;
const LIVE_WATCH_MINUTES = 15;
const LIVE_WATCH_MAX_PARALLEL = 2;
const LIVE_WATCH_STATE_PATH = join(ROOT, '.pokebot-live-streaks.json');
const LIVE_WATCH_REASONS = {
    'not-logged': 'a Twitch não está logada nesta conta, reconecte a Twitch',
    'no-video': 'o player não carregou o vídeo',
    short: 'a live caiu antes de completar o tempo',
    closed: 'janela fechada',
    error: 'erro inesperado',
    'follow-failed': 'não encontrei o botão Seguir',
};
const liveWatchJobs = new Map(); // `${acc}:${channel}` -> { win }
const liveWatchRetryAt = new Map();
let liveWatchTimer = null;
let liveWatchState = loadLiveWatchState();

function loadLiveWatchState() {
    try {
        const raw = JSON.parse(readFileSync(LIVE_WATCH_STATE_PATH, 'utf8'));
        const cutoff = Date.now() - 7 * 86_400_000;
        const watched = {};
        for (const [k, v] of Object.entries(raw?.watched || {})) {
            if (v && Number(v.at) > cutoff) watched[k] = v;
        }
        const followed = raw?.followed && typeof raw.followed === 'object' ? raw.followed : {};
        return { watched, followed };
    } catch {
        return { watched: {}, followed: {} };
    }
}

function saveLiveWatchState() {
    try { writeFileSync(LIVE_WATCH_STATE_PATH, JSON.stringify(liveWatchState)); } catch { /* ignore */ }
}

const WATCH_QUALITY_JS = `(() => {
    try {
        const want = '{"default":"160p30"}';
        if (localStorage.getItem('video-quality') === want) return false;
        localStorage.setItem('video-quality', want);
        return true;
    } catch { return false; }
})()`;

const WATCH_PROBE_JS = `(() => {
    const q = (s) => document.querySelector(s);
    const gate = q('[data-a-target="content-classification-gate-overlay-start-watching-button"], [data-a-target="player-overlay-mature-accept"]');
    if (gate) gate.click();
    const v = q('video');
    if (v && v.paused) { try { v.play().catch(() => {}); } catch { /* ignore */ } }
    const fb = q('[data-a-target="follow-button"]');
    let follow = null;
    if (fb) {
        fb.scrollIntoView({ block: 'center', inline: 'center' });
        const r = fb.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) follow = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    // Deslogado a Twitch tambem mostra o menu de usuario: so o botao "Entrar" e confiavel
    const loggedOut = Boolean(q('[data-a-target="login-button"]'));
    return {
        loggedIn: !loggedOut && Boolean(q('[data-a-target="user-menu-toggle"]')),
        loggedOut,
        following: Boolean(q('[data-a-target="unfollow-button"]')),
        follow,
        playing: Boolean(v && !v.paused && v.readyState >= 2),
        t: v ? Number(v.currentTime) || 0 : -1,
    };
})()`;

const WATCH_FOLLOW_DOM_CLICK = `(() => {
    const fb = document.querySelector('[data-a-target="follow-button"]');
    if (!fb) return false;
    fb.click();
    return true;
})()`;

async function runHiddenTwitchWatch(acc, channel, job, { watchMs, follow, onProgress }) {
    const win = new BrowserWindow({
        width: 1100,
        height: 720,
        show: false,
        frame: false,
        focusable: false,
        skipTaskbar: true,
        opacity: 0,
        backgroundColor: '#0e0e10',
        webPreferences: {
            partition: `persist:conta${acc}`,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
            autoplayPolicy: 'no-user-gesture-required',
        },
    });
    job.win = win;
    const result = { ok: false, watchedSec: 0, following: false, followedNow: false, reason: '' };
    const probe = async () => {
        if (win.isDestroyed()) return null;
        try {
            return await win.webContents.executeJavaScript(WATCH_PROBE_JS, true);
        } catch {
            return {};
        }
    };
    try {
        win.setIgnoreMouseEvents(true);
        win.webContents.setAudioMuted(true);
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        const cleanUa = cleanBrowserUserAgent(win.webContents.getUserAgent());
        if (cleanUa) win.webContents.setUserAgent(cleanUa);
        // "Visivel" para o Chromium (opacidade 0, sem foco), senao o player pausa
        win.once('ready-to-show', () => {
            if (!win.isDestroyed()) win.showInactive();
        });
        const url = `https://www.twitch.tv/${encodeURIComponent(channel)}`;
        const load = () => win.loadURL(url, cleanUa ? { userAgent: cleanUa } : undefined).catch(() => {});
        await load();
        if (win.isDestroyed()) return { ...result, reason: 'closed' };
        const changedQuality = await win.webContents.executeJavaScript(WATCH_QUALITY_JS, true).catch(() => false);
        if (changedQuality) await load();

        const started = Date.now();
        const hardDeadline = started + (watchMs > 0 ? watchMs + 4 * 60_000 : 60_000);
        let lastT = -1;
        let followClicks = 0;
        let lastProgressMin = -1;
        while (Date.now() < hardDeadline) {
            await waitMs(5_000);
            const st = await probe();
            if (!st) {
                result.reason = 'closed';
                break;
            }
            if (st.loggedOut && !st.loggedIn && Date.now() - started > 15_000) {
                result.reason = 'not-logged';
                break;
            }
            if (st.following) result.following = true;
            if (follow && !result.following && st.loggedIn && st.follow && followClicks < 3) {
                followClicks += 1;
                if (followClicks < 3) {
                    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
                        win.webContents.sendInputEvent({ type, x: st.follow.x, y: st.follow.y, button: 'left', clickCount: 1 });
                    }
                } else {
                    await win.webContents.executeJavaScript(WATCH_FOLLOW_DOM_CLICK, true).catch(() => false);
                }
            }
            if (watchMs > 0 && st.playing && st.t > lastT) {
                if (lastT >= 0) result.watchedSec += 5;
                lastT = st.t;
            }
            const min = Math.floor(result.watchedSec / 60);
            if (watchMs > 0 && min !== lastProgressMin) {
                lastProgressMin = min;
                onProgress?.(min);
            }
            const elapsed = Date.now() - started;
            const watchDone = watchMs <= 0 || result.watchedSec * 1000 >= watchMs;
            const followDone = !follow || result.following || followClicks >= 3 || elapsed > 60_000;
            if (watchDone && followDone) break;
            if (watchMs > 0 && result.watchedSec === 0 && elapsed > 120_000) {
                result.reason = 'no-video';
                break;
            }
        }
        result.followedNow = follow && result.following && followClicks > 0;
        result.ok = watchMs > 0 ? result.watchedSec * 1000 >= watchMs : result.following;
        if (!result.ok && !result.reason) result.reason = watchMs > 0 ? 'short' : 'follow-failed';
        return result;
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
}

function liveWatchCandidates() {
    const now = Date.now();
    const out = [];
    for (const acc of ACCOUNT_IDS) {
        const entry = servers.get(acc);
        if (!entry) continue;
        const ctrl = entry.instance.controller;
        const creds = ctrl.getLiveCredentials?.() || {};
        if (!creds.twitchToken) continue;
        const snap = ctrl.getSnapshot({ includeHunts: false });
        const cfg = snap?.config || {};
        if (cfg.liveEnabled === false) continue;
        const wantWatch = cfg.liveStreakWatch !== false && cfg.liveWatchTwitch !== false;
        const wantFollow = cfg.liveAutoFollow !== false;
        if (!wantWatch && !wantFollow) continue;
        for (const [rawCh, st] of Object.entries(snap?.lives?.twitch || {})) {
            const channel = String(rawCh || '').toLowerCase();
            if (!/^[a-z0-9_]{1,40}$/.test(channel)) continue;
            const key = `${acc}:${channel}`;
            if (liveWatchJobs.has(key) || (liveWatchRetryAt.get(key) || 0) > now) continue;
            const watch = Boolean(wantWatch && st?.live && st.broadcastId &&
                liveWatchState.watched[key]?.broadcastId !== st.broadcastId);
            const follow = Boolean(wantFollow && !liveWatchState.followed[key]);
            if (watch || follow) {
                out.push({ acc, channel, key, ctrl, creds, watch, follow, broadcastId: st?.broadcastId || null });
            }
        }
    }
    return out.sort((a, b) => Number(b.watch) - Number(a.watch));
}

function startLiveWatchJob(cand) {
    const { acc, channel, key, ctrl, creds } = cand;
    const watchMs = cand.watch ? LIVE_WATCH_MINUTES * 60_000 : 0;
    const job = { win: null };
    liveWatchJobs.set(key, job);
    const progress = (minutes) => {
        if (!cand.watch) return;
        ctrl.noteLiveWatchSession?.(channel, {
            kind: 'watch', watching: true, ok: null, minutes, targetMinutes: LIVE_WATCH_MINUTES, reasonText: '',
        });
    };
    progress(0);
    void (async () => {
        let res;
        try {
            await seedTwitchCookiesInPartition(acc, creds);
            res = await runHiddenTwitchWatch(acc, channel, job, { watchMs, follow: cand.follow, onProgress: progress });
        } catch {
            res = { ok: false, watchedSec: 0, following: false, followedNow: false, reason: 'error' };
        } finally {
            liveWatchJobs.delete(key);
        }
        if (res.following) liveWatchState.followed[key] = Date.now();
        if (cand.watch && res.ok) {
            liveWatchState.watched[key] = {
                broadcastId: cand.broadcastId,
                at: Date.now(),
                minutes: Math.round(res.watchedSec / 60),
            };
        }
        saveLiveWatchState();
        if (!res.ok) {
            const waitMin = res.reason === 'follow-failed' ? 6 * 60 : res.reason === 'not-logged' ? 30 : 5;
            liveWatchRetryAt.set(key, Date.now() + waitMin * 60_000);
        }
        ctrl.noteLiveWatchSession?.(channel, {
            kind: cand.watch ? 'watch' : 'follow',
            watching: false,
            ok: res.ok,
            minutes: Math.round(res.watchedSec / 60),
            targetMinutes: LIVE_WATCH_MINUTES,
            following: res.following,
            followedNow: res.followedNow,
            reason: res.ok ? '' : res.reason,
            reasonText: res.ok ? '' : (LIVE_WATCH_REASONS[res.reason] || res.reason),
            broadcastId: cand.broadcastId,
        });
    })();
}

function liveWatchTick() {
    if (liveWatchJobs.size >= LIVE_WATCH_MAX_PARALLEL) return;
    for (const cand of liveWatchCandidates()) {
        if (liveWatchJobs.size >= LIVE_WATCH_MAX_PARALLEL) break;
        if (liveWatchJobs.has(cand.key)) continue;
        startLiveWatchJob(cand);
    }
}

// ===== Sons de alerta =====
// O som escolhido (link do myinstants ou de um arquivo de audio) e baixado uma vez
// para .pokebot-sounds e tocado pela janela do Hub, mesmo minimizada na bandeja.
const SOUND_DIR = join(ROOT, '.pokebot-sounds');
const SOUND_CFG_PATH = join(SOUND_DIR, 'sounds.json');
const SOUND_EVENTS = ['shinyMiss', 'shinyCaught', 'rareDrop', 'error', 'chest', 'vote'];
// canais padrão por evento: som, aviso no Hub (toast) e aviso do Windows
const ALERT_DEFAULTS = {
    shinyMiss: { enabled: true, toast: true, os: true },
    shinyCaught: { enabled: true, toast: true, os: true },
    rareDrop: { enabled: false, toast: true, os: false },
    error: { enabled: false, toast: true, os: true },
    chest: { enabled: false, toast: true, os: false },
    vote: { enabled: false, toast: true, os: false },
};
// Sons padrao por alerta (baixados e cacheados localmente em .pokebot-sounds na primeira execucao).
const DEFAULT_SOUND_PRESETS = {
    shinyMiss: {
        url: 'https://www.myinstants.com/pt/instant/pokemon-escape-27107/',
        title: 'Pokemon Escape',
    },
    shinyCaught: {
        url: 'https://www.myinstants.com/pt/instant/pokemon-item-received-55816/',
        title: 'Pokemon Item Received',
    },
    rareDrop: {
        url: 'https://www.myinstants.com/pt/instant/ex-pull-36121/',
        title: 'Ex Pull',
    },
    error: {
        url: 'https://www.myinstants.com/pt/instant/low-hp-pokemon-64176/',
        title: 'Low HP Pokemon',
    },
};
const SOUND_MAX_BYTES = 5 * 1024 * 1024;
const SOUND_TICK_MS = 2_000;
const SOUND_EXT_BY_TYPE = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm' };
const SOUND_MIME_BY_EXT = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm' };
const SOUND_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const presetFetchInFlight = new Map();
let soundTimer = null;
let soundStartedAt = Date.now();
let soundCfg = loadSoundCfg();

function defaultSoundCfg() {
    const events = {};
    for (const ev of SOUND_EVENTS) events[ev] = { ...ALERT_DEFAULTS[ev], volume: 1, url: '', file: '', title: '' };
    return { enabled: true, volume: 0.8, events };
}

function loadSoundCfg() {
    const base = defaultSoundCfg();
    try {
        const raw = JSON.parse(readFileSync(SOUND_CFG_PATH, 'utf8'));
        const out = { ...base, ...raw, events: { ...base.events } };
        for (const ev of SOUND_EVENTS) {
            const merged = { ...base.events[ev], ...(raw?.events?.[ev] || {}) };
            const rawEvVol = merged.volume;
            merged.volume = rawEvVol != null && Number.isFinite(Number(rawEvVol))
                ? Math.min(1, Math.max(0, Number(rawEvVol)))
                : 1;
            out.events[ev] = merged;
        }
        out.volume = Math.min(1, Math.max(0, Number(out.volume ?? 0.8)));
        out.enabled = out.enabled !== false;
        return out;
    } catch {
        return base;
    }
}

function saveSoundCfg() {
    try {
        mkdirSync(SOUND_DIR, { recursive: true });
        writeFileSync(SOUND_CFG_PATH, JSON.stringify(soundCfg, null, 2), 'utf8');
    } catch { /* ignore */ }
}

function publicSoundCfg() {
    const events = {};
    for (const ev of SOUND_EVENTS) {
        const e = soundCfg.events[ev] || {};
        const preset = DEFAULT_SOUND_PRESETS[ev] || null;
        const hasCustom = Boolean(e.file && existsSync(join(SOUND_DIR, e.file)));
        events[ev] = {
            enabled: e.enabled !== false,
            toast: e.toast !== false,
            os: e.os !== false,
            volume: e.volume != null && Number.isFinite(Number(e.volume))
                ? Math.min(1, Math.max(0, Number(e.volume)))
                : 1,
            url: hasCustom ? (e.url || '') : '',
            title: hasCustom ? (e.title || '') : (preset?.title || ''),
            defaultTitle: preset?.title || '',
            defaultUrl: preset?.url || '',
            custom: hasCustom,
            hasAudio: Boolean(hasCustom || preset),
        };
    }
    return { enabled: soundCfg.enabled, volume: soundCfg.volume, events };
}

async function fetchWithTimeout(url, ms = 12_000) {
    return fetch(url, { headers: { 'user-agent': SOUND_UA, accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
}

async function readLimited(res) {
    const len = Number(res.headers.get('content-length') || 0);
    if (len > SOUND_MAX_BYTES) throw new Error('arquivo de som grande demais (máx. 5 MB)');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > SOUND_MAX_BYTES) throw new Error('arquivo de som grande demais (máx. 5 MB)');
    return buf;
}

function decodeHtmlEntities(str) {
    return String(str || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function audioExtFrom(type, url) {
    const t = String(type || '').split(';')[0].trim().toLowerCase();
    if (SOUND_EXT_BY_TYPE[t]) return SOUND_EXT_BY_TYPE[t];
    const m = /\.(mp3|ogg|wav|m4a|aac|webm)(?:$|[?#])/i.exec(String(url || ''));
    return m ? m[1].toLowerCase() : null;
}

function soundNameFromPath(u) {
    let name = 'som';
    try { name = decodeURIComponent(u.pathname.split('/').pop() || 'som'); } catch { /* ignore */ }
    return name.replace(/\.[a-z0-9]+$/i, '');
}

// Aceita link direto de audio ou pagina que aponte o audio (og:audio, como no myinstants).
async function resolveSoundLink(rawUrl) {
    let parsed;
    try { parsed = new URL(String(rawUrl || '').trim()); } catch { throw new Error('link inválido'); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('use um link http ou https');
    const res = await fetchWithTimeout(parsed.toString());
    if (!res.ok) throw new Error(`o site respondeu ${res.status}`);
    const type = res.headers.get('content-type') || '';
    const directExt = /^audio\//i.test(type) || /octet-stream/i.test(type) ? audioExtFrom(type, res.url || parsed.toString()) : null;
    if (directExt) {
        return { buf: await readLimited(res), ext: directExt, title: soundNameFromPath(parsed) };
    }
    if (!/html/i.test(type)) throw new Error('o link não é de um som nem de uma página com som');
    const html = (await readLimited(res)).toString('utf8');
    const meta = (prop) => {
        const re = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i');
        const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*property=["']${prop}["']`, 'i');
        return decodeHtmlEntities((re.exec(html) || re2.exec(html) || [])[1] || '');
    };
    let audioUrl = meta('og:audio') || meta('og:audio:url') || meta('og:audio:secure_url');
    if (!audioUrl) {
        // myinstants e parecidos: o botao principal chama play('/media/sounds/x.mp3', ...)
        const m = /play\(\s*['"]([^'"]+\.(?:mp3|ogg|wav|m4a))['"]/i.exec(html)
            || /["'(]((?:https?:)?\/[^"'()\s]+\.(?:mp3|ogg|wav|m4a))(?:\?[^"'()\s]*)?["')]/i.exec(html);
        audioUrl = m ? decodeHtmlEntities(m[1]) : '';
    }
    if (!audioUrl) throw new Error('não achei o som nessa página');
    const abs = new URL(audioUrl, res.url || parsed.toString());
    if (abs.protocol !== 'https:' && abs.protocol !== 'http:') throw new Error('o som da página tem um link inválido');
    const audioRes = await fetchWithTimeout(abs.toString());
    if (!audioRes.ok) throw new Error(`o som respondeu ${audioRes.status}`);
    const ext = audioExtFrom(audioRes.headers.get('content-type'), abs.toString());
    if (!ext) throw new Error('o arquivo encontrado não é de áudio');
    const title = meta('og:title').replace(/\s+-\s+(?:Botão sonoro|Instant Sound Button|Myinstants).*$/i, '').trim()
        || soundNameFromPath(abs);
    return { buf: await readLimited(audioRes), ext, title };
}

function removeSoundFile(file) {
    if (!file) return;
    try { rmSync(join(SOUND_DIR, file), { force: true }); } catch { /* ignore */ }
}

async function setSoundFromLink(event, url) {
    if (!SOUND_EVENTS.includes(event)) return { ok: false, error: 'evento desconhecido' };
    try {
        const { buf, ext, title } = await resolveSoundLink(url);
        mkdirSync(SOUND_DIR, { recursive: true });
        const file = `${event}-${createHash('sha1').update(String(url)).digest('hex').slice(0, 10)}.${ext}`;
        writeFileSync(join(SOUND_DIR, file), buf);
        const prev = soundCfg.events[event] || {};
        if (prev.file && prev.file !== file) removeSoundFile(prev.file);
        soundCfg.events[event] = { ...prev, url: String(url).trim(), file, title: String(title || 'som').slice(0, 80) };
        saveSoundCfg();
        return { ok: true, cfg: publicSoundCfg() };
    } catch (err) {
        const msg = err?.name === 'TimeoutError' ? 'o site demorou demais para responder' : (err?.message || String(err));
        return { ok: false, error: msg };
    }
}

function findCachedPresetFile(event) {
    const preset = DEFAULT_SOUND_PRESETS[event];
    if (!preset?.url) return null;
    const hash = createHash('sha1').update(String(preset.url)).digest('hex').slice(0, 10);
    for (const ext of Object.keys(SOUND_MIME_BY_EXT)) {
        const candidate = `preset-${event}-${hash}.${ext}`;
        if (existsSync(join(SOUND_DIR, candidate))) return candidate;
    }
    return null;
}

async function ensureDefaultPresetFile(event) {
    const preset = DEFAULT_SOUND_PRESETS[event];
    if (!preset?.url) return null;
    const cached = findCachedPresetFile(event);
    if (cached) return cached;
    if (presetFetchInFlight.has(event)) return presetFetchInFlight.get(event);
    const task = (async () => {
        try {
            const { buf, ext } = await resolveSoundLink(preset.url);
            mkdirSync(SOUND_DIR, { recursive: true });
            const hash = createHash('sha1').update(String(preset.url)).digest('hex').slice(0, 10);
            const file = `preset-${event}-${hash}.${ext}`;
            writeFileSync(join(SOUND_DIR, file), buf);
            return file;
        } catch {
            return null;
        } finally {
            presetFetchInFlight.delete(event);
        }
    })();
    presetFetchInFlight.set(event, task);
    return task;
}

function warmDefaultSounds() {
    for (const ev of Object.keys(DEFAULT_SOUND_PRESETS)) {
        const e = soundCfg.events[ev];
        const hasCustom = Boolean(e?.file && existsSync(join(SOUND_DIR, e.file)));
        if (!hasCustom && !findCachedPresetFile(ev)) {
            void ensureDefaultPresetFile(ev);
        }
    }
}

async function soundDataUrl(event) {
    let file = soundCfg.events[event]?.file || null;
    if (file && !existsSync(join(SOUND_DIR, file))) {
        file = null;
    }
    if (!file && DEFAULT_SOUND_PRESETS[event]) {
        file = await ensureDefaultPresetFile(event);
    }
    if (!file) return null;
    try {
        const ext = file.split('.').pop().toLowerCase();
        return `data:${SOUND_MIME_BY_EXT[ext] || 'audio/mpeg'};base64,${readFileSync(join(SOUND_DIR, file)).toString('base64')}`;
    } catch {
        return null;
    }
}

function emitSound(event, info = {}) {
    if (!soundCfg.enabled || soundCfg.events[event]?.enabled === false) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('hub:play-sound', { event, ...info });
}

const alertBase = new Map(); // conta -> linha de base dos eventos ja vistos
let trayStateKey = '';
const trayIconCache = new Map();

function accountNickOf(snap, acc) {
    if (snap?.trainer?.nick && snap.trainer.nick !== '-') return snap.trainer.nick;
    return snap?.session?.nick || `Conta ${acc}`;
}

function notifyWindows(event, acc, title, body) {
    if (soundCfg.events[event]?.os === false) return;
    // com o Hub em foco o aviso ja aparece dentro dele
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) return;
    try {
        if (!Notification.isSupported()) return;
        const icon = getAppIcon();
        const n = new Notification({ title, body, silent: soundCfg.enabled && soundCfg.events[event]?.enabled !== false, ...(icon ? { icon } : {}) });
        n.on('click', () => showMainWindow(acc));
        n.show();
    } catch { /* aviso opcional */ }
}

function fireAlert(event, acc, title, body, info = {}) {
    emitSound(event, { account: acc, ...info });
    notifyWindows(event, acc, title, body);
}

function broadcastSoundCfg(invalidateEvent = null) {
    const payload = { cfg: publicSoundCfg(), invalidateEvent };
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hub:sound-cfg-changed', payload);
    }
    for (const win of popoutWindows.values()) {
        if (win && !win.isDestroyed()) {
            win.webContents.send('hub:sound-cfg-changed', payload);
        }
    }
}

function alertTick() {
    const snaps = getAllSnapshots();
    for (const acc of ACCOUNT_IDS) {
        const snap = snaps[acc];
        if (!snap) continue;
        const nick = accountNickOf(snap, acc);
        const missed = Array.isArray(snap.missedShinies) ? snap.missedShinies : [];
        const own = Array.isArray(snap.ownShinies) ? snap.ownShinies : [];
        const logs = Array.isArray(snap.logs) ? snap.logs : [];
        const rareList = Array.isArray(snap.drops?.recentRare)
            ? snap.drops.recentRare
            : (Array.isArray(snap.drops?.recent) ? snap.drops.recent.filter((d) => d?.rare) : []);
        const dropKeyOf = (d) => (Number(d?.id) > 0 ? Number(d.id) : Number(d?.ts || 0));
        const maxRareKey = rareList.reduce((m, d) => Math.max(m, dropKeyOf(d)), 0);
        const chests = new Set(Object.entries(snap.lives?.twitch || {}).filter(([, st]) => st?.manualChest).map(([ch]) => ch));
        const voteReady = Boolean(snap.vote?.available);
        const lastLogId = logs.length ? Number(logs[logs.length - 1].id || 0) : 0;
        const base = alertBase.get(acc);
        if (!base) {
            // primeira leitura: so marca a linha de base, sem tocar nada antigo
            alertBase.set(acc, {
                missTs: Math.max(soundStartedAt, ...missed.map((e) => Number(e?.ts) || 0)),
                ownTs: Math.max(0, ...own.map((e) => Number(e?.ts) || 0)),
                lastRareKey: maxRareKey,
                chests,
                voteReady,
                lastLogId,
            });
            continue;
        }
        const freshMiss = missed.filter((e) => Number(e?.ts) > base.missTs);
        if (freshMiss.length) {
            base.missTs = Math.max(...freshMiss.map((e) => Number(e.ts)));
            const m = freshMiss[0];
            fireAlert('shinyMiss', acc, `Shiny escapou · Conta ${acc}`, `${nick} viu ${m.name || 'um shiny'}${m.level ? ` (Nv ${m.level})` : ''} e não capturou.`, { name: m.name || '', count: freshMiss.length });
        }
        const freshOwn = own.filter((e) => Number(e?.ts) > base.ownTs);
        if (freshOwn.length) {
            base.ownTs = Math.max(...freshOwn.map((e) => Number(e.ts)));
            const o = freshOwn[0];
            fireAlert('shinyCaught', acc, `Shiny capturado · Conta ${acc}`, `${nick} capturou ${o.name || 'um shiny'}${o.level ? ` (Nv ${o.level})` : ''}.`, { name: o.name || '' });
        }
        const freshRare = rareList.filter((d) => dropKeyOf(d) > base.lastRareKey);
        if (freshRare.length) {
            base.lastRareKey = Math.max(base.lastRareKey, ...freshRare.map(dropKeyOf));
            const topRare = freshRare[0];
            fireAlert('rareDrop', acc, `Drop raro · Conta ${acc}`, `${nick}: ${topRare.name} x${topRare.qty || 1}`, { name: topRare.name || '', count: freshRare.length });
        }
        const freshErr = logs.filter((l) => Number(l.id || 0) > base.lastLogId && l.kind === 'error');
        if (freshErr.length) {
            fireAlert('error', acc, `Erro · Conta ${acc}`, `${nick}: ${String(freshErr[freshErr.length - 1].text || '').slice(0, 180)}`);
        }
        base.lastLogId = lastLogId;
        for (const ch of chests) {
            if (!base.chests.has(ch)) fireAlert('chest', acc, `Caixinha +50 · Conta ${acc}`, `Disponível em ${ch}.`, { name: ch });
        }
        base.chests = chests;
        if (voteReady && !base.voteReady) fireAlert('vote', acc, `Voto liberado · Conta ${acc}`, 'Voto diário liberado no IdleHub.io.');
        base.voteReady = voteReady;
    }
    updateTrayState(snaps);
}

// Estado geral para o ícone da bandeja: erro > atenção > farmando > parado
function overallTrayState(snaps) {
    let state = 'idle';
    const now = Date.now();
    for (const acc of ACCOUNT_IDS) {
        const s = snaps[acc];
        if (!s) continue;
        if (s.status === 'error') return 'error';
        const recentMiss = (s.missedShinies || []).some((e) => now - Number(e?.ts || 0) < 10 * 60_000);
        if (s.status === 'paused' || recentMiss || (s.modeWarnings || []).some((w) => w.severity === 'danger')) state = 'warn';
        else if (state === 'idle' && (s.status === 'connected' || s.status === 'bridge')) state = 'ok';
    }
    return state;
}

const TRAY_DOT = { ok: [16, 185, 129], warn: [245, 158, 11], error: [239, 68, 68], idle: [100, 116, 139] };

function trayIconFor(state) {
    if (trayIconCache.has(state)) return trayIconCache.get(state);
    const baseIcon = getAppIcon();
    if (!baseIcon) return null;
    const size = 32;
    const img = baseIcon.resize({ width: size, height: size, quality: 'best' });
    const buf = Buffer.from(img.toBitmap());
    const [r, g, b] = TRAY_DOT[state] || TRAY_DOT.idle;
    const cx = size - 8;
    const cy = size - 8;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
            if (d > 8) continue;
            const i = (y * size + x) * 4; // BGRA
            if (d > 6.2) {
                buf[i] = 12; buf[i + 1] = 13; buf[i + 2] = 17; buf[i + 3] = 255;
            } else {
                buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
            }
        }
    }
    const out = nativeImage.createFromBitmap(buf, { width: size, height: size });
    trayIconCache.set(state, out);
    return out;
}

function updateTrayState(snaps) {
    if (!tray || tray.isDestroyed()) return;
    const state = overallTrayState(snaps);
    if (state !== trayStateKey) {
        trayStateKey = state;
        const img = trayIconFor(state);
        if (img && !img.isEmpty()) {
            try { tray.setImage(img); } catch { /* ignore */ }
        }
    }
    refreshTrayMenu(snaps);
}

function startSoundWatcher() {
    if (soundTimer) return;
    soundStartedAt = Date.now();
    soundTimer = setInterval(() => {
        try { alertTick(); } catch { /* ignore */ }
    }, SOUND_TICK_MS);
    soundTimer.unref?.();
}

function stopSoundWatcher() {
    if (soundTimer) clearInterval(soundTimer);
    soundTimer = null;
}


// ===== Janelas soltas (pop-out de painel) e mini-HUD =====
const popoutWindows = new Map(); // painel -> janela
let miniHudWindow = null;
const POPOUT_PANELS = new Set(['overview', 'automation', 'connections', 'lives', 'activity']);

function hubWindowPrefs() {
    return {
        preload: join(HERE, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: true,
    };
}

function openPopout(panel, account) {
    const key = POPOUT_PANELS.has(panel) ? panel : 'activity';
    const acc = ACCOUNT_IDS.includes(Number(account)) ? Number(account) : 1;
    const existing = popoutWindows.get(key);
    if (existing && !existing.isDestroyed()) {
        existing.webContents.send('hub:focus-account', acc);
        existing.show();
        existing.focus();
        return { ok: true };
    }
    const icon = getAppIcon();
    const win = new BrowserWindow({
        width: key === 'overview' ? 560 : 520,
        height: 760,
        minWidth: 380,
        minHeight: 360,
        autoHideMenuBar: true,
        backgroundColor: '#080d17',
        title: 'Nexo PokeBot',
        ...(icon ? { icon } : {}),
        webPreferences: hubWindowPrefs(),
    });
    popoutWindows.set(key, win);
    win.on('closed', () => {
        if (popoutWindows.get(key) === win) popoutWindows.delete(key);
    });
    void win.loadFile(join(HERE, 'renderer.html'), { query: { popout: key, acc: String(acc) } });
    return { ok: true };
}

function toggleMiniHud(force = null) {
    const want = force == null ? !miniHudWindow : Boolean(force);
    if (!want) {
        if (miniHudWindow && !miniHudWindow.isDestroyed()) miniHudWindow.close();
        miniHudWindow = null;
        lastTraySignature = '';
        refreshTrayMenu();
        return false;
    }
    if (miniHudWindow && !miniHudWindow.isDestroyed()) {
        miniHudWindow.show();
        return true;
    }
    const win = new BrowserWindow({
        width: 340,
        height: 176,
        minWidth: 260,
        minHeight: 90,
        frame: false,
        resizable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        transparent: false,
        backgroundColor: '#080d17',
        title: 'Nexo PokeBot Mini-HUD',
        webPreferences: hubWindowPrefs(),
    });
    win.setAlwaysOnTop(true, 'floating');
    miniHudWindow = win;
    win.on('closed', () => {
        if (miniHudWindow === win) miniHudWindow = null;
        lastTraySignature = '';
        refreshTrayMenu();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hub:minihud-state', false);
    });
    void win.loadFile(join(HERE, 'minihud.html'));
    lastTraySignature = '';
    refreshTrayMenu();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hub:minihud-state', true);
    return true;
}

function closeExtraWindows() {
    for (const win of popoutWindows.values()) {
        try { if (!win.isDestroyed()) win.destroy(); } catch { /* ignore */ }
    }
    popoutWindows.clear();
    try { if (miniHudWindow && !miniHudWindow.isDestroyed()) miniHudWindow.destroy(); } catch { /* ignore */ }
    miniHudWindow = null;
}

function startLiveWatchManager() {
    if (liveWatchTimer) return;
    liveWatchTimer = setInterval(() => {
        try { liveWatchTick(); } catch { /* ignore */ }
    }, LIVE_WATCH_TICK_MS);
    liveWatchTimer.unref?.();
}

function stopLiveWatchJobs() {
    if (liveWatchTimer) {
        clearInterval(liveWatchTimer);
        liveWatchTimer = null;
    }
    for (const job of liveWatchJobs.values()) {
        try { if (job.win && !job.win.isDestroyed()) job.win.destroy(); } catch { /* ignore */ }
    }
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
        } else if (act === 'refresh-lives') {
            ok = controller.triggerAction('refresh-lives');
        } else if (act === 'reset-stats') {
            ok = controller.triggerAction('reset-stats');
        } else if (act === 'refresh-topcatch') {
            ok = controller.triggerAction('refresh-topcatch');
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
        } else if (act === 'open-vote') {
            ok = await controller.openVote();
        } else if (act === 'open-vote-embedded') {
            ok = await openEmbeddedVotePopup(acc);
        } else if (act === 'open-twitch-chest-embedded') {
            ok = await openEmbeddedTwitchChestPopup(acc, payload.channel);
        } else if (act === 'claim-twitch-chest') {
            const res = await claimTwitchChestFromHud(acc, payload.channel);
            refreshTrayMenu();
            return { ...res, snapshots: getAllSnapshots() };
        } else if (act === 'refresh-vote') {
            await controller.refreshVoteStatus({ force: true });
            ok = true;
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

    ipcMain.handle('hub:popout', (_ev, { panel, account } = {}) => openPopout(String(panel || ''), account));
    ipcMain.handle('hub:minihud-toggle', (_ev, force) => toggleMiniHud(typeof force === 'boolean' ? force : null));
    ipcMain.handle('hub:minihud-state', () => Boolean(miniHudWindow));
    ipcMain.handle('hub:minihud-close', () => toggleMiniHud(false));
    ipcMain.handle('hub:show-main', (_ev, account) => {
        showMainWindow(ACCOUNT_IDS.includes(Number(account)) ? Number(account) : null);
        return true;
    });
    ipcMain.handle('hub:sound-get', () => publicSoundCfg());
    ipcMain.handle('hub:sound-set', (_ev, patch = {}) => {
        if (typeof patch.enabled === 'boolean') soundCfg.enabled = patch.enabled;
        if (patch.volume != null && Number.isFinite(Number(patch.volume))) soundCfg.volume = Math.min(1, Math.max(0, Number(patch.volume)));
        if (patch.event && SOUND_EVENTS.includes(patch.event) && typeof patch.eventEnabled === 'boolean') {
            soundCfg.events[patch.event] = { ...(soundCfg.events[patch.event] || {}), enabled: patch.eventEnabled };
        }
        if (patch.event && SOUND_EVENTS.includes(patch.event) && patch.eventVolume != null && Number.isFinite(Number(patch.eventVolume))) {
            soundCfg.events[patch.event] = {
                ...(soundCfg.events[patch.event] || {}),
                volume: Math.min(1, Math.max(0, Number(patch.eventVolume))),
            };
        }
        if (patch.event && SOUND_EVENTS.includes(patch.event) && ['toast', 'os'].includes(patch.channel) && typeof patch.value === 'boolean') {
            soundCfg.events[patch.event] = { ...(soundCfg.events[patch.event] || {}), [patch.channel]: patch.value };
        }
        saveSoundCfg();
        broadcastSoundCfg(null);
        return publicSoundCfg();
    });
    ipcMain.handle('hub:sound-link', async (_ev, { event, url } = {}) => {
        const res = await setSoundFromLink(String(event || ''), String(url || ''));
        if (res?.ok) broadcastSoundCfg(String(event || ''));
        return res;
    });
    ipcMain.handle('hub:sound-reset', (_ev, { event } = {}) => {
        if (SOUND_EVENTS.includes(event)) {
            removeSoundFile(soundCfg.events[event]?.file);
            const prev = soundCfg.events[event] || {};
            soundCfg.events[event] = { ...defaultSoundCfg().events[event], enabled: prev.enabled !== false, toast: prev.toast !== false, os: prev.os !== false };
            saveSoundCfg();
            broadcastSoundCfg(event);
        }
        return publicSoundCfg();
    });
    ipcMain.handle('hub:sound-data', (_ev, { event } = {}) => soundDataUrl(String(event || '')));

    ipcMain.handle('hub:update-get-state', () => updateState);
    ipcMain.handle('hub:update-check', () => runUpdateCheck());
    ipcMain.handle('hub:update-install', () => runUpdateInstall());

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
        title: `Nexo PokeBot v${installedVersion}`,
        ...(icon ? { icon } : {}),
        webPreferences: {
            webviewTag: true,
            preload: join(HERE, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            // Mantem o renderer ativo para tocar alertas sonoros mesmo minimizado na bandeja ou atras do jogo
            backgroundThrottling: false,
            // o alerta sonoro precisa tocar com o Hub minimizado, sem clique antes
            autoplayPolicy: 'no-user-gesture-required',
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
        closeExtraWindows();
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
    stopLiveWatchJobs();
    stopSoundWatcher();
    closeExtraWindows();
    const closing = [...servers.values()].map((entry) => entry.instance.close().catch(() => {}));
    servers.clear();
    for (const popup of actionPopups.values()) {
        try { if (!popup.isDestroyed()) popup.destroy(); } catch { /* ignore */ }
    }
    actionPopups.clear();
    if (updateBootTimer) clearTimeout(updateBootTimer);
    if (updateCheckTimer) clearInterval(updateCheckTimer);
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
    startAutoChestWatcher();
    startLiveWatchManager();
    startSoundWatcher();
    const warmTimer = setTimeout(() => warmDefaultSounds(), 1500);
    warmTimer.unref?.();
    updateBootTimer = setTimeout(() => {
        updateBootTimer = null;
        void runUpdateCheck();
    }, 6000);
    updateBootTimer.unref?.();
    updateCheckTimer = setInterval(() => {
        void runUpdateCheck();
    }, UPDATE_CHECK_INTERVAL_MS);
    updateCheckTimer.unref?.();
}).catch((err) => {
    console.error('[Nexo PokeBot] Falha ao iniciar:', err);
    isQuitting = true;
    app.quit();
});
