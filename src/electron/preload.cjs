'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pokeHub', {
    getAllSnapshots: () => ipcRenderer.invoke('hub:get-all-snapshots'),
    getPerf: () => ipcRenderer.invoke('hub:get-perf'),
    getAdvisor: (account) => ipcRenderer.invoke('hub:get-advisor', { account }),
    inspectShiny: (account, entry) => ipcRenderer.invoke('hub:inspect-shiny', { account, entry }),
    getHunts: (account) => ipcRenderer.invoke('hub:get-hunts', { account }),
    getWebviewPreload: () => ipcRenderer.invoke('hub:get-webview-preload'),
    action: (account, action, payload) => ipcRenderer.invoke('hub:action', { account, action, payload }),
    attachWebview: (account) => ipcRenderer.invoke('hub:webview-attach', { account }),
    detachWebview: (account, opts) => ipcRenderer.invoke('hub:webview-detach', { account, ...(opts || {}) }),
    sendWsFrame: (account, raw) => ipcRenderer.send('hub:webview-ws-frame', { account, raw }),
    syncWebviewSession: (account, session) => ipcRenderer.send('hub:webview-session', { account, session }),
    replyHuntResult: (queryId, result) => ipcRenderer.send('hub:webview-hunt-result', { queryId, result }),
    minimizeToTray: () => ipcRenderer.invoke('hub:window-minimize-tray'),
    setAwake: (enabled) => ipcRenderer.invoke('hub:awake-set', Boolean(enabled)),
    setMinToTray: (enabled) => ipcRenderer.invoke('hub:mintray-set', Boolean(enabled)),
    openExternal: (url, account) => ipcRenderer.invoke('hub:open-external', url, account),
    getSoundConfig: () => ipcRenderer.invoke('hub:sound-get'),
    setSoundConfig: (patch) => ipcRenderer.invoke('hub:sound-set', patch || {}),
    setSoundLink: (event, url) => ipcRenderer.invoke('hub:sound-link', { event, url }),
    resetSound: (event) => ipcRenderer.invoke('hub:sound-reset', { event }),
    getSoundData: (event) => ipcRenderer.invoke('hub:sound-data', { event }),
    onPlaySound: (cb) => {
        const fn = (_ev, data) => cb(data);
        ipcRenderer.on('hub:play-sound', fn);
        return () => ipcRenderer.removeListener('hub:play-sound', fn);
    },
    onSoundConfigChanged: (cb) => {
        const fn = (_ev, data) => cb(data);
        ipcRenderer.on('hub:sound-cfg-changed', fn);
        return () => ipcRenderer.removeListener('hub:sound-cfg-changed', fn);
    },
    popout: (panel, account) => ipcRenderer.invoke('hub:popout', { panel, account }),
    toggleMiniHud: (force) => ipcRenderer.invoke('hub:minihud-toggle', force),
    getMiniHudState: () => ipcRenderer.invoke('hub:minihud-state'),
    closeMiniHud: () => ipcRenderer.invoke('hub:minihud-close'),
    showMain: (account) => ipcRenderer.invoke('hub:show-main', account),
    onMiniHudState: (cb) => {
        const fn = (_ev, open) => cb(Boolean(open));
        ipcRenderer.on('hub:minihud-state', fn);
        return () => ipcRenderer.removeListener('hub:minihud-state', fn);
    },
    getUpdateState: () => ipcRenderer.invoke('hub:update-get-state'),
    checkUpdate: () => ipcRenderer.invoke('hub:update-check'),
    installUpdate: () => ipcRenderer.invoke('hub:update-install'),
    onUpdateState: (cb) => {
        const fn = (_ev, data) => cb(data);
        ipcRenderer.on('hub:update-state', fn);
        return () => ipcRenderer.removeListener('hub:update-state', fn);
    },
    onUpdateOpen: (cb) => {
        const fn = () => cb();
        ipcRenderer.on('hub:update-open', fn);
        return () => ipcRenderer.removeListener('hub:update-open', fn);
    },
    onWebviewSend: (cb) => {
        const fn = (_ev, data) => cb(data);
        ipcRenderer.on('hub:webview-send', fn);
        return () => ipcRenderer.removeListener('hub:webview-send', fn);
    },
    onWebviewReadHunt: (cb) => {
        const fn = (_ev, data) => cb(data);
        ipcRenderer.on('hub:webview-read-hunt', fn);
        return () => ipcRenderer.removeListener('hub:webview-read-hunt', fn);
    },
    onFocusAccount: (cb) => {
        const fn = (_ev, account) => cb(account);
        ipcRenderer.on('hub:focus-account', fn);
        return () => ipcRenderer.removeListener('hub:focus-account', fn);
    },
    onEcoAllHeadless: (cb) => {
        const fn = () => cb();
        ipcRenderer.on('hub:eco-all-headless', fn);
        return () => ipcRenderer.removeListener('hub:eco-all-headless', fn);
    },
});
