// Depuração do navegador do bot por canal privado (pipe), sem porta de rede.
//
// `--remote-debugging-port` abre um servidor TCP em 127.0.0.1 sem autenticação: qualquer programa do mesmo
// usuário lê o `DevToolsActivePort` do perfil, conecta e passa a controlar o navegador (lê cookies já
// descriptografados, abre páginas logadas). `--remote-debugging-pipe` fala CDP por dois descritores
// herdados (fd 3 e 4) que só o processo pai tem: não há porta, nem arquivo, nem como outro programa entrar.
//
// Mensagens são JSON terminado por NUL. Uma conexão só serve a todos: `handle()` entrega visões
// independentes (comandos, eventos e fechamento próprios) sobre o mesmo canal, com a interface do cliente
// por WebSocket (`send`, `onEvent`, `close`, `ws.addEventListener('close')`).
import { spawn } from 'node:child_process';

const COMMAND_TIMEOUT_MS = 8_000;

/**
 * @param {import('node:stream').Writable} writable Para onde vão os comandos (fd 3 do navegador).
 * @param {import('node:stream').Readable} readable De onde vêm respostas e eventos (fd 4 do navegador).
 * @returns {{ handle: () => object, isClosed: () => boolean, destroy: () => void, onClose: (fn: () => void) => void }}
 */
export function createPipeCdpHub(writable, readable, { commandTimeoutMs = COMMAND_TIMEOUT_MS } = {}) {
    let nextId = 1;
    let closed = false;
    let buffer = '';
    const pending = new Map(); // id -> { resolveCmd, rejectCmd, owner }
    const handles = new Set();
    const closeListeners = new Set();

    const rejectOwned = (owner, reason) => {
        for (const [id, p] of pending) {
            if (owner === undefined || p.owner === owner) {
                pending.delete(id);
                p.rejectCmd(new Error(reason));
            }
        }
    };

    const shutdown = () => {
        if (closed) return;
        closed = true;
        rejectOwned(undefined, 'CDP encerrado');
        for (const fn of [...closeListeners]) {
            try { fn(); } catch { /* ignora erro em listener de fechamento */ }
        }
        closeListeners.clear();
        handles.clear();
        try { readable.destroy(); } catch { /* ja fechado */ }
        try { writable.destroy(); } catch { /* ja fechado */ }
    };

    const dispatch = (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }
        if (msg?.id && pending.has(msg.id)) {
            const { resolveCmd, rejectCmd } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) rejectCmd(new Error(msg.error.message || 'Erro CDP'));
            else resolveCmd(msg.result || {});
        } else if (msg?.method) {
            for (const h of [...handles]) h.emit(msg);
        }
    };

    readable.setEncoding?.('utf8');
    readable.on('data', (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\0')) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (raw) dispatch(raw);
        }
    });
    readable.on('end', shutdown);
    readable.on('close', shutdown);
    readable.on('error', shutdown);
    writable.on('error', shutdown);

    const handle = () => {
        let handleClosed = false;
        const eventListeners = new Set();
        const wsCloseListeners = new Set();
        const owner = {};
        const view = {
            emit: (msg) => {
                for (const fn of eventListeners) {
                    try { fn(msg); } catch { /* ignora erro em listener de evento CDP */ }
                }
            },
            fireClose: () => {
                for (const fn of [...wsCloseListeners]) {
                    try { fn(); } catch { /* ignora */ }
                }
            },
        };
        const send = (method, params = {}, sessionId = undefined) => new Promise((resolveCmd, rejectCmd) => {
            if (closed || handleClosed) {
                rejectCmd(new Error('CDP fechado'));
                return;
            }
            const id = nextId++;
            const timer = setTimeout(() => {
                if (pending.delete(id)) rejectCmd(new Error(`Timeout no comando CDP: ${method}`));
            }, commandTimeoutMs);
            timer.unref?.();
            pending.set(id, {
                owner,
                resolveCmd: (val) => { clearTimeout(timer); resolveCmd(val); },
                rejectCmd: (err) => { clearTimeout(timer); rejectCmd(err); },
            });
            const payload = { id, method, params };
            if (sessionId) payload.sessionId = sessionId;
            try {
                writable.write(`${JSON.stringify(payload)}\0`);
            } catch (err) {
                pending.delete(id);
                clearTimeout(timer);
                rejectCmd(err);
            }
        });
        const onEvent = (fn) => {
            eventListeners.add(fn);
            return () => eventListeners.delete(fn);
        };
        const close = () => {
            if (handleClosed) return;
            handleClosed = true;
            eventListeners.clear();
            rejectOwned(owner, 'CDP encerrado');
            handles.delete(view);
            view.fireClose();
            wsCloseListeners.clear();
        };
        const ws = {
            get readyState() { return closed || handleClosed ? 3 : 1; },
            addEventListener(type, fn) {
                if (type === 'close' && typeof fn === 'function') wsCloseListeners.add(fn);
            },
        };
        const onHubClose = () => {
            handleClosed = true;
            view.fireClose();
        };
        if (closed) {
            handleClosed = true;
        } else {
            handles.add(view);
            closeListeners.add(onHubClose);
        }
        return { ws, send, onEvent, close: () => { closeListeners.delete(onHubClose); close(); } };
    };

    return {
        handle,
        isClosed: () => closed,
        destroy: shutdown,
        onClose: (fn) => { if (closed) fn(); else closeListeners.add(fn); },
    };
}

/**
 * Abre o navegador com `--remote-debugging-pipe` e liga o canal. O navegador fica preso a este processo:
 * se o canal fecha, ele encerra; é o preço de não haver porta de rede.
 * @param {string} exe Executável do Chrome/Edge/Brave.
 * @param {string[]} args Argumentos (sem a flag de depuração).
 * @param {{ spawnImpl?: typeof spawn }} [opts]
 * @returns {Promise<{ child: import('node:child_process').ChildProcess, hub: ReturnType<typeof createPipeCdpHub> }>}
 */
export async function spawnBrowserWithPipe(exe, args, { spawnImpl = spawn } = {}) {
    const child = spawnImpl(exe, [...args, '--remote-debugging-pipe'], {
        stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
        windowsHide: false,
    });
    await new Promise((resolveLaunch, rejectLaunch) => {
        child.once('spawn', resolveLaunch);
        child.once('error', rejectLaunch);
    });
    // fd 3: o navegador lê (nós escrevemos); fd 4: o navegador escreve (nós lemos).
    const hub = createPipeCdpHub(child.stdio[3], child.stdio[4]);
    child.once('exit', () => hub.destroy());
    return { child, hub };
}
