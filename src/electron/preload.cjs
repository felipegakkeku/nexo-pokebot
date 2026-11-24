'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pokeHub', {
    getAllSnapshots: () => ipcRenderer.invoke('hub:get-all-snapshots'),
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
    openExternal: (url) => ipcRenderer.invoke('hub:open-external', url),
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
