// Processo principal Electron do Nexo PokeBot: 1 janela, 1 bandeja, 4 contas isoladas + navegador embutido por conta.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, powerSaveBlocker, session, shell, Tray } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

    const updSig = `${updateState.status}:${updateState.latestVersion}:${updateState.hasUpdate}`;
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
    stopLiveWatchJobs();
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
