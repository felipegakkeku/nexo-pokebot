// Avisos em tempo real: o Hub fica conectado ao servidor do dono (WebSocket) e mostra cada
// aviso novo uma vez. O endereço do servidor vem de avisos-servidor.json no main (o túnel pode trocar).
// Todo aviso vem assinado com Ed25519; sem assinatura válida da chave abaixo, nada aparece.
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_UPDATE_REPO, compareSemver } from './updater.mjs';

export const AVISOS_PUBLIC_KEY = 'MCowBQYDK2VwAyEAPBXq2k4jnjcvThbdX68hm75qgHbSc6BJnIF9t+9sOx0=';
export const AVISOS_SERVER_URL = `https://raw.githubusercontent.com/${DEFAULT_UPDATE_REPO}/main/avisos-servidor.json`;
export const AVISOS_WS_PATH = '/api/nexo/avisos/ws';
const SEEN_FILE = 'avisos-vistos.json';
const KINDS = new Set(['info', 'ok', 'warn', 'error']);
const KIND_ALIAS = { aviso: 'warn', alerta: 'warn', erro: 'error', sucesso: 'ok' };
const PUB_KEY = createPublicKey({ key: Buffer.from(AVISOS_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' });

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Data "AAAA-MM-DD" vale até o fim do dia; outro formato passa pelo Date. */
function parseUntil(raw) {
    const s = str(raw, 40);
    if (!s) return 0;
    const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T23:59:59`) : Date.parse(s);
    return Number.isFinite(t) ? t : 0;
}

/**
 * Filtra avisos e devolve só os que valem para este Hub e ainda não foram vistos.
 * @param {unknown} json Lista de avisos (ou { avisos: [...] }).
 * @param {{ now?: number, version?: string, seen?: Set<string> }} ctx
 */
export function pickNewAvisos(json, { now = Date.now(), version = '', seen = new Set() } = {}) {
    const list = Array.isArray(json) ? json : (Array.isArray(json?.avisos) ? json.avisos : []);
    const out = [];
    for (const a of list.slice(0, 50)) {
        if (!a || typeof a !== 'object') continue;
        const id = str(a.id, 80);
        const title = str(a.titulo ?? a.title, 80);
        const text = str(a.texto ?? a.text, 400);
        if (!id || (!title && !text) || seen.has(id)) continue;
        const until = parseUntil(a.ate ?? a.until);
        if (until && now > until) continue;
        const min = str(a.versaoMin ?? a.minVersion, 20);
        const max = str(a.versaoMax ?? a.maxVersion, 20);
        if (version && min && compareSemver(version, min) < 0) continue;
        if (version && max && compareSemver(version, max) > 0) continue;
        const rawKind = str(a.tipo ?? a.kind, 12).toLowerCase();
        const kind = KINDS.has(rawKind) ? rawKind : (KIND_ALIAS[rawKind] || 'info');
        const link = str(a.link, 300);
        out.push({ id, title: title || 'Nexo PokeBot', text, kind, link: /^https:\/\//.test(link) ? link : '' });
    }
    return out;
}

/** Confere o envelope { payload, sig } assinado pelo dono e devolve o aviso, ou null. */
export function verifyAvisoEnvelope(env, key = PUB_KEY) {
    if (!env || typeof env.payload !== 'string' || typeof env.sig !== 'string' || env.payload.length > 3000) return null;
    try {
        if (!verify(null, Buffer.from(env.payload, 'utf8'), key, Buffer.from(env.sig, 'base64'))) return null;
        const a = JSON.parse(env.payload);
        return a && typeof a === 'object' ? a : null;
    } catch {
        return null;
    }
}

export function readSeenAvisos(dataDir) {
    try {
        const p = join(dataDir, SEEN_FILE);
        if (!existsSync(p)) return new Set();
        const arr = JSON.parse(readFileSync(p, 'utf8'));
        return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
    } catch {
        return new Set();
    }
}

export function saveSeenAvisos(dataDir, seen) {
    try {
        writeFileSync(join(dataDir, SEEN_FILE), JSON.stringify([...seen].slice(-300)), 'utf8');
    } catch { /* sem gravar, o aviso pode voltar uma vez */ }
}

/** Endereço atual do servidor de avisos (https), lido do main. */
export async function fetchAvisosServer({ fetchImpl = fetch, signal } = {}) {
    try {
        const res = await fetchImpl(`${AVISOS_SERVER_URL}?t=${Date.now()}`, { signal, cache: 'no-store' });
        if (!res.ok) return '';
        const j = await res.json();
        const url = str(j?.servidor, 200).replace(/\/+$/, '');
        return /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(url) ? url : '';
    } catch {
        return '';
    }
}

const sleep = (ms, signal) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/** Uma conexão WebSocket; resolve quando ela fecha. Devolve quanto tempo ficou aberta. */
function openOnce(url, { WebSocketImpl, signal, onAviso }) {
    return new Promise((resolve) => {
        let ws;
        try { ws = new WebSocketImpl(url); } catch { resolve(0); return; }
        let opened = 0;
        let idle = null;
        // O servidor manda {"t":1} a cada 25 s. Sem nada por 70 s a conexão morreu em silêncio
        // (PC suspenso, túnel trocado): fecha para reconectar.
        const arm = (ms) => { clearTimeout(idle); idle = setTimeout(() => { try { ws.close(); } catch { /* fecha */ } }, ms); };
        const done = () => {
            clearTimeout(idle);
            signal.removeEventListener('abort', stop);
            resolve(opened ? Date.now() - opened : 0);
        };
        arm(20_000);
        const stop = () => { try { ws.close(); } catch { /* fecha */ } };
        signal.addEventListener('abort', stop, { once: true });
        ws.addEventListener('open', () => { opened = Date.now(); arm(70_000); });
        ws.addEventListener('message', (ev) => {
            arm(70_000);
            let env;
            try { env = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
            const aviso = verifyAvisoEnvelope(env);
            if (aviso) { try { onAviso(aviso); } catch { /* um aviso ruim não derruba a conexão */ } }
        });
        ws.addEventListener('close', done, { once: true });
        ws.addEventListener('error', () => { try { ws.close(); } catch { /* fecha */ } });
    });
}

/**
 * Mantém a conexão com o servidor de avisos enquanto o Hub estiver aberto.
 * Cai a conexão: espera um pouco, relê o endereço (o túnel pode ter mudado) e reconecta.
 * @param {{ fetchImpl?: typeof fetch, WebSocketImpl?: typeof WebSocket, signal: AbortSignal, onAviso: (aviso: object) => void }} opts
 */
export async function runAvisosStream({ fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket, signal, onAviso }) {
    if (typeof WebSocketImpl !== 'function') return;
    let wait = 5_000;
    while (!signal.aborted) {
        const base = await fetchAvisosServer({ fetchImpl, signal });
        if (!base) { await sleep(60_000, signal); continue; }
        const lived = await openOnce(`${base.replace(/^http/, 'ws')}${AVISOS_WS_PATH}`, { WebSocketImpl, signal, onAviso });
        if (signal.aborted) break;
        wait = lived > 60_000 ? 5_000 : Math.min(wait * 2, 60_000);
        await sleep(wait, signal);
    }
}
