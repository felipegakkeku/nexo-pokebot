// Avisos enviados pelo repositório: os Hubs leem avisos.json do main e mostram
// cada aviso novo uma vez (toast no Hub e notificação do Windows).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_UPDATE_REPO, compareSemver } from './updater.mjs';

export const AVISOS_URL = `https://raw.githubusercontent.com/${DEFAULT_UPDATE_REPO}/main/avisos.json`;
const SEEN_FILE = 'avisos-vistos.json';
const KINDS = new Set(['info', 'ok', 'warn', 'error']);
const KIND_ALIAS = { aviso: 'warn', alerta: 'warn', erro: 'error', sucesso: 'ok' };

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Data "AAAA-MM-DD" vale até o fim do dia; outro formato passa pelo Date. */
function parseUntil(raw) {
    const s = str(raw, 40);
    if (!s) return 0;
    const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T23:59:59`) : Date.parse(s);
    return Number.isFinite(t) ? t : 0;
}

/**
 * Filtra o JSON do repositório e devolve só os avisos que valem para este Hub e ainda não foram vistos.
 * @param {unknown} json Conteúdo de avisos.json.
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

/** Busca avisos.json; sem internet ou arquivo ausente devolve null. */
export async function fetchAvisos({ fetchImpl = fetch, signal } = {}) {
    try {
        const res = await fetchImpl(`${AVISOS_URL}?t=${Math.floor(Date.now() / 60_000)}`, { signal, cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}
