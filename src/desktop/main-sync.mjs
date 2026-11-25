// Sincronização com o main do GitHub: o Hub instalado acompanha o último commit sem esperar Release.
// Baixa o código do commit novo em segundo plano e deixa pronto; aplica quando o Hub reinicia
// (ou na hora, se a pessoa pedir). Só troca src, assets, docs e o userscript: o runtime do Electron
// e o .exe continuam vindo das Releases. Se o commit mudar dependências, espera a Release.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
    DEFAULT_APP_ROOT,
    DEFAULT_UPDATE_REPO,
    compareCommits,
    downloadAndStageUpdate,
    readInstalledBuild,
    readInstalledVersion,
    sameCommit,
} from './updater.mjs';

export const MAIN_SYNC_FILE = '.pokebot-main-sync.json';
export const MAIN_SYNC_BRANCH = 'main';
/** Espelhadas com o main; dist só recebe arquivos (os ícones do pacote não estão no git). */
export const MAIN_SYNC_APPLY = Object.freeze({ mirrorDirs: ['src', 'assets', 'docs'], copyDirs: ['dist'] });
const MAX_APPLY_ATTEMPTS = 2;

/** Dependências que precisam do pacote da Release (node_modules e Electron não vêm do main). */
export function depsSignature(pkg) {
    const deps = pkg?.dependencies || {};
    const opt = pkg?.optionalDependencies || {};
    const electron = pkg?.devDependencies?.electron || '';
    const sorted = (o) => Object.keys(o).sort().map((k) => `${k}@${o[k]}`).join(',');
    return `${sorted(deps)}|${sorted(opt)}|electron@${electron}`;
}

const readJson = (path) => {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
};

export function readMainSyncState(rootDir = DEFAULT_APP_ROOT) {
    return readJson(join(rootDir, MAIN_SYNC_FILE)) || {};
}

export function writeMainSyncState(rootDir, state) {
    try {
        writeFileSync(join(rootDir, MAIN_SYNC_FILE), JSON.stringify(state), 'utf8');
    } catch { /* sem disco: tenta de novo na próxima checagem */ }
}

/** Descarta um pacote preparado (pasta temporária e marcador). */
export function discardStagedMain(rootDir = DEFAULT_APP_ROOT) {
    const st = readMainSyncState(rootDir);
    if (st.tempRoot) {
        try { rmSync(st.tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    try { rmSync(join(rootDir, MAIN_SYNC_FILE), { force: true }); } catch { /* ignore */ }
}

/** Pacote do main pronto para aplicar (script ainda existe e é de outro commit). */
export function stagedMainReady(rootDir = DEFAULT_APP_ROOT) {
    const st = readMainSyncState(rootDir);
    if (!st.sha || !st.scriptPath || !existsSync(st.scriptPath)) return null;
    if (sameCommit(st.sha, readInstalledBuild(rootDir).commit)) return null;
    if (Number(st.attempts || 0) >= MAX_APPLY_ATTEMPTS) return null;
    return st;
}

/**
 * Confere se o main está à frente do commit instalado.
 * @returns {Promise<{ok:boolean, ahead:boolean, reason?:string, headSha?:string, aheadBy?:number, lastMessage?:string, installedCommit?:string}>}
 */
export async function checkMainAhead({ rootDir = DEFAULT_APP_ROOT, repo = DEFAULT_UPDATE_REPO, fetchImpl = fetch, timeoutMs = 8_000 } = {}) {
    const root = resolve(rootDir);
    if (existsSync(join(root, '.git'))) return { ok: true, ahead: false, reason: 'git' };
    const installedCommit = readInstalledBuild(root).commit;
    if (!installedCommit) return { ok: true, ahead: false, reason: 'sem-commit' };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const rel = await compareCommits({ repo, base: installedCommit, head: MAIN_SYNC_BRANCH, fetchImpl, signal: ac.signal, version: readInstalledVersion(root) });
        if (!rel) return { ok: false, ahead: false, reason: 'github' };
        const ahead = rel.status === 'ahead' && rel.aheadBy > 0 && /^[0-9a-f]{40}$/.test(rel.headSha);
        return { ok: true, ahead, installedCommit, headSha: rel.headSha, aheadBy: rel.aheadBy, lastMessage: rel.lastMessage, status: rel.status };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Baixa o código do commit do main e deixa o script de aplicação pronto.
 * @returns {Promise<{ok:boolean, sha?:string, scriptPath?:string, reason?:string}>}
 */
export async function stageMainCommit({ rootDir = DEFAULT_APP_ROOT, repo = DEFAULT_UPDATE_REPO, sha, aheadBy = 0, lastMessage = '', fetchImpl, signal, waitPids } = {}) {
    const root = resolve(rootDir);
    if (!/^[0-9a-f]{40}$/.test(String(sha || ''))) return { ok: false, reason: 'commit inválido' };
    const prev = readMainSyncState(root);
    if (prev.sha === sha && prev.scriptPath && existsSync(prev.scriptPath)) return { ok: true, sha, scriptPath: prev.scriptPath, cached: true };
    if (prev.sha === sha && prev.blocked) return { ok: false, reason: prev.blocked };
    discardStagedMain(root);
    const installedPkg = readJson(join(root, 'package.json')) || {};
    let version = readInstalledVersion(root);
    try {
        const staged = await downloadAndStageUpdate({
            rootDir: root,
            releaseInfo: {
                latestVersion: version,
                asset: { name: `nexo-pokebot-${sha.slice(0, 7)}.zip`, size: 0, downloadUrl: `https://codeload.github.com/${repo}/zip/${sha}` },
            },
            fetchImpl,
            signal,
            waitPids,
            applyOptions: MAIN_SYNC_APPLY,
            prepareStage: (stageRoot) => {
                const pkg = readJson(join(stageRoot, 'package.json'));
                if (!pkg) throw new Error('Pacote do main sem package.json');
                if (depsSignature(pkg) !== depsSignature(installedPkg)) {
                    const err = new Error('Este commit muda dependências: chega pela próxima Release.');
                    err.code = 'DEPS';
                    throw err;
                }
                version = String(pkg.version || version);
                writeFileSync(join(stageRoot, 'build-info.json'), JSON.stringify({ version, commit: sha, channel: 'main', builtAt: new Date().toISOString() }), 'utf8');
            },
        });
        writeMainSyncState(root, { sha, version, scriptPath: staged.scriptPath, tempRoot: staged.tempRoot, aheadBy, lastMessage, at: Date.now(), attempts: 0 });
        return { ok: true, sha, version, scriptPath: staged.scriptPath };
    } catch (err) {
        if (err?.code === 'DEPS') writeMainSyncState(root, { sha, blocked: err.message, at: Date.now() });
        return { ok: false, reason: err?.message || String(err) };
    }
}

/** Conta uma tentativa de aplicar (evita reiniciar em loop se a cópia falhar). */
export function markMainApplyAttempt(rootDir = DEFAULT_APP_ROOT) {
    const st = readMainSyncState(rootDir);
    if (!st.sha) return st;
    st.attempts = Number(st.attempts || 0) + 1;
    writeMainSyncState(rootDir, st);
    return st;
}
