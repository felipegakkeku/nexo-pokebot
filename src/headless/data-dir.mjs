// Onde ficam os dados de execução (sessões, cookies, perfis de navegador, configuração).
//
// Antes tudo morava na pasta do programa (`.pokebot-*`). Quando essa pasta está no Desktop ou em qualquer
// pasta sincronizada pelo OneDrive, tokens de login e cookies sobem para a nuvem em texto puro. Agora os
// dados ficam em %LOCALAPPDATA%\Nexo PokeBot (não sincroniza e herda a permissão só do usuário). Os nomes
// `.pokebot-*` dentro dela continuam iguais, então o resto do código segue funcionando por `cwd`.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const DATA_DIR_NAME = 'Nexo PokeBot';

/** Itens `.pokebot-*` que pertencem ao programa/atualizador e por isso ficam na pasta do app. */
export const APP_OWNED_ITEMS = new Set([
    '.pokebot-update-pending.json',
    '.pokebot-update-backup',
    '.pokebot-main-sync.json',
    '.pokebot-main-sync-optin.json',
]);

/** Pasta de dados: NEXO_DATA_DIR, senão %LOCALAPPDATA%\Nexo PokeBot (ou o equivalente fora do Windows). */
export function resolveDataRoot({ env = process.env, platform = process.platform, home = homedir() } = {}) {
    const forced = String(env.NEXO_DATA_DIR || '').trim();
    if (forced) return resolve(forced);
    if (platform === 'win32') {
        const base = String(env.LOCALAPPDATA || '').trim() || join(home, 'AppData', 'Local');
        return join(base, DATA_DIR_NAME);
    }
    const base = String(env.XDG_DATA_HOME || '').trim() || join(home, '.local', 'share');
    return join(base, 'nexo-pokebot');
}

/** Cria a pasta de dados se preciso e devolve o caminho. */
export function ensureDataRoot(options) {
    const root = resolveDataRoot(options);
    mkdirSync(root, { recursive: true });
    return root;
}

/** Itens de dados que ainda estão na pasta antiga do app. */
export function listLegacyDataItems(legacyRoot) {
    let names = [];
    try { names = readdirSync(legacyRoot); } catch { return []; }
    return names.filter((name) => name.startsWith('.pokebot-') && !APP_OWNED_ITEMS.has(name));
}

/** Soma arquivos e bytes de um item (para conferir a cópia antes de apagar a origem). */
function measure(path) {
    const st = lstatSync(path);
    if (!st.isDirectory()) return { files: 1, bytes: st.size };
    let files = 0;
    let bytes = 0;
    for (const name of readdirSync(path)) {
        const m = measure(join(path, name));
        files += m.files;
        bytes += m.bytes;
    }
    return { files, bytes };
}

/** Move um item (renomeia; se não der, copia, confere e só então apaga a origem). Lança erro e deixa a origem intacta. */
function moveItem(src, dst, { renameImpl, copyImpl }) {
    try {
        renameImpl(src, dst);
    } catch {
        const before = measure(src);
        try {
            copyImpl(src, dst, { recursive: true, errorOnExist: true, force: false });
            const after = measure(dst);
            if (after.files !== before.files || after.bytes !== before.bytes) {
                throw new Error(`cópia incompleta (${after.files}/${before.files} arquivos)`);
            }
        } catch (err) {
            rmSync(dst, { recursive: true, force: true });
            throw err;
        }
        rmSync(src, { recursive: true, force: true });
    }
}

/** Leva de `src` para `dst` só o que não existe em `dst`, descendo até `depth` níveis nas pastas que existem nos dois. */
function mergeMissing(src, dst, depth, impls) {
    const out = { moved: [], failed: [] };
    let names = [];
    try { names = readdirSync(src); } catch { return out; }
    for (const name of names) {
        const s = join(src, name);
        const d = join(dst, name);
        try {
            if (!existsSync(d)) {
                moveItem(s, d, impls);
                out.moved.push(name);
            } else if (depth > 1 && lstatSync(s).isDirectory() && lstatSync(d).isDirectory()) {
                const sub = mergeMissing(s, d, depth - 1, impls);
                for (const m of sub.moved) out.moved.push(`${name}/${m}`);
                for (const f of sub.failed) out.failed.push({ name: `${name}/${f.name}`, reason: f.reason });
            }
        } catch (err) {
            out.failed.push({ name, reason: err?.message || String(err) });
        }
    }
    return out;
}

/**
 * Move os dados antigos para a pasta nova. Nunca sobrescreve: se o destino já existe, o item antigo fica onde
 * está. Tenta renomear (atômico no mesmo volume); se não der, copia, confere arquivos e bytes e só então apaga
 * a origem. Qualquer falha deixa a origem intacta.
 * @returns {{ moved: string[], skipped: { name: string, reason: string }[], failed: { name: string, reason: string }[] }}
 */
export function migrateLegacyData({ legacyRoot, dataRoot, log = () => {}, renameImpl = renameSync, copyImpl = cpSync }) {
    const result = { moved: [], skipped: [], failed: [] };
    const from = resolve(legacyRoot);
    const to = resolve(dataRoot);
    if (from === to) return result;
    const items = listLegacyDataItems(from);
    if (!items.length) return result;
    mkdirSync(to, { recursive: true });

    for (const name of items) {
        const src = join(from, name);
        const dst = join(to, name);
        if (existsSync(dst)) {
            // `.pokebot-accounts` guarda uma pasta por conta (2 a 4). Se o app já criou a dele na pasta nova,
            // sessões importadas depois na pasta antiga (o .bat de recuperação gravava lá) ficariam presas
            // para sempre. Junta por conta/arquivo, só o que falta no destino, sem sobrescrever nada.
            if (name === '.pokebot-accounts' && lstatSync(src).isDirectory() && lstatSync(dst).isDirectory()) {
                const merged = mergeMissing(src, dst, 2, { renameImpl, copyImpl });
                for (const m of merged.moved) result.moved.push(`${name}/${m}`);
                for (const f of merged.failed) result.failed.push({ name: `${name}/${f.name}`, reason: f.reason });
                if (!merged.moved.length && !merged.failed.length) result.skipped.push({ name, reason: 'já existe na pasta nova' });
                continue;
            }
            result.skipped.push({ name, reason: 'já existe na pasta nova' });
            continue;
        }
        try {
            moveItem(src, dst, { renameImpl, copyImpl });
            result.moved.push(name);
        } catch (err) {
            result.failed.push({ name, reason: err?.message || String(err) });
        }
    }

    if (result.moved.length) log(`[dados] ${result.moved.length} item(ns) movido(s) para ${to}`);
    for (const f of result.failed) log(`[dados] não consegui mover ${f.name}: ${f.reason}. Vou tentar de novo na próxima abertura.`);
    return result;
}

/** Atalho dos pontos de entrada: garante a pasta nova e migra o que sobrou na pasta do app. */
export function prepareDataRoot({ legacyRoot, log, ...options } = {}) {
    const dataRoot = ensureDataRoot(options);
    let migration = null;
    if (legacyRoot) {
        try { migration = migrateLegacyData({ legacyRoot, dataRoot, log }); } catch (err) { log?.(`[dados] migração falhou: ${err?.message || err}`); }
    }
    return { dataRoot, migration };
}
