// Instala o /hunt no próprio Hub: baixa o pacote oficial da Chrome Web Store (o mesmo que o Chrome instalaria),
// guarda em .pokebot-hunt-ext/<versão> na pasta do Hub e confere atualização uma vez por dia.
// Assim ninguém precisa instalar a extensão no navegador para o bot ter o /hunt.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { HUNT_EXTENSION_ID, isValidHuntExtensionVersionDir } from './hunt-guide.mjs';

export const HUNT_EXT_LOCAL_DIR = '.pokebot-hunt-ext';
const STATE_FILE = 'state.json';
const CHECK_EVERY_MS = 24 * 3600_000;
const MAX_DOWNLOAD = 40 * 1024 * 1024;
const MAX_UNPACKED = 120 * 1024 * 1024;

/** Endereço oficial de download da Chrome Web Store para uma extensão. */
export function webStoreCrxUrl(id = HUNT_EXTENSION_ID, prodVersion = '130.0.0.0') {
    const x = encodeURIComponent(`id=${id}&uc`);
    return `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${prodVersion}&acceptformat=crx2,crx3&x=${x}`;
}

/** Tira o cabeçalho do CRX (versão 2 ou 3) e devolve o zip de dentro. */
export function crxToZip(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 16) throw new Error('Pacote vazio');
    if (buf.readUInt32LE(0) === 0x04034b50) return buf; // já é zip
    if (buf.toString('latin1', 0, 4) !== 'Cr24') throw new Error('Não é um pacote de extensão');
    const ver = buf.readUInt32LE(4);
    let start;
    if (ver === 3) start = 12 + buf.readUInt32LE(8);
    else if (ver === 2) start = 16 + buf.readUInt32LE(8) + buf.readUInt32LE(12);
    else throw new Error(`Versão de pacote desconhecida (${ver})`);
    if (start >= buf.length || buf.readUInt32LE(start) !== 0x04034b50) throw new Error('Pacote corrompido');
    return buf.subarray(start);
}

/** Lê os arquivos de um zip (só deflate e sem compressão), recusando caminhos que saem da pasta. */
export function readZipEntries(zip) {
    let eocd = -1;
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
        if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Zip sem diretório central');
    const count = zip.readUInt16LE(eocd + 10);
    let off = zip.readUInt32LE(eocd + 16);
    const out = [];
    let total = 0;
    for (let n = 0; n < count; n++) {
        if (zip.readUInt32LE(off) !== 0x02014b50) throw new Error('Zip corrompido');
        const method = zip.readUInt16LE(off + 10);
        const csize = zip.readUInt32LE(off + 20);
        const usize = zip.readUInt32LE(off + 24);
        const nameLen = zip.readUInt16LE(off + 28);
        const extraLen = zip.readUInt16LE(off + 30);
        const commentLen = zip.readUInt16LE(off + 32);
        const local = zip.readUInt32LE(off + 42);
        const name = zip.toString('utf8', off + 46, off + 46 + nameLen).replace(/\\/g, '/');
        off += 46 + nameLen + extraLen + commentLen;
        if (name.endsWith('/')) continue;
        const clean = normalize(name);
        if (!name || isAbsolute(name) || clean.startsWith('..') || clean.split(sep).includes('..')) {
            throw new Error(`Caminho inválido no pacote: ${name}`);
        }
        if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('Zip corrompido');
        const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        const raw = zip.subarray(dataAt, dataAt + csize);
        let data;
        if (method === 0) data = Buffer.from(raw);
        else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) });
        else throw new Error(`Compressão não suportada (${method})`);
        total += data.length;
        if (total > MAX_UNPACKED) throw new Error('Pacote grande demais');
        out.push({ name: clean, data });
    }
    return out;
}

/** Extrai o pacote para <base>/<versão do manifest> e devolve a pasta. */
export function unpackHuntExtension(crxBuf, baseDir) {
    const entries = readZipEntries(crxToZip(crxBuf));
    const manifest = entries.find((e) => e.name === 'manifest.json');
    if (!manifest) throw new Error('Pacote sem manifest.json');
    const version = String(JSON.parse(manifest.data.toString('utf8').replace(/^﻿/, '')).version || '').trim();
    if (!/^[\d.]+$/.test(version)) throw new Error('Versão inválida no manifest');
    const finalDir = join(baseDir, version);
    if (isValidHuntExtensionVersionDir(finalDir)) return { dir: resolve(finalDir), version, fresh: false };
    const tmp = join(baseDir, `.tmp-${process.pid}-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    try {
        for (const e of entries) {
            const dest = join(tmp, e.name);
            if (!resolve(dest).startsWith(resolve(tmp) + sep)) throw new Error(`Caminho inválido: ${e.name}`);
            mkdirSync(dirname(dest), { recursive: true });
            writeFileSync(dest, e.data);
        }
        // O Chrome recusa carregar pasta com _metadata gerada por outra instalação; não precisamos dela.
        rmSync(join(tmp, '_metadata'), { recursive: true, force: true });
        if (!isValidHuntExtensionVersionDir(tmp)) throw new Error('Pacote do /hunt sem os arquivos esperados');
        rmSync(finalDir, { recursive: true, force: true });
        renameSync(tmp, finalDir);
    } catch (err) {
        rmSync(tmp, { recursive: true, force: true });
        throw err;
    }
    return { dir: resolve(finalDir), version, fresh: true };
}

const readState = (path) => {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return {};
    }
};

/**
 * Garante uma cópia local do /hunt. Sem internet ou com a loja fora, segue com o que já tiver.
 * @returns {Promise<{dir:string|null, version?:string, updated:boolean, error?:string}>}
 */
export async function ensureHuntExtension({ root, fetchImpl = globalThis.fetch, prodVersion, nowFn = Date.now, force = false } = {}) {
    const base = join(root, HUNT_EXT_LOCAL_DIR);
    const statePath = join(base, STATE_FILE);
    const state = readState(statePath);
    const current = state.version && isValidHuntExtensionVersionDir(join(base, state.version)) ? resolve(join(base, state.version)) : null;
    if (!force && current && nowFn() - (Number(state.checkedAt) || 0) < CHECK_EVERY_MS) {
        return { dir: current, version: state.version, updated: false };
    }
    try {
        if (typeof fetchImpl !== 'function') throw new Error('Sem fetch');
        const res = await fetchImpl(webStoreCrxUrl(HUNT_EXTENSION_ID, prodVersion), { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
        if (!res?.ok) throw new Error(`Loja respondeu ${res?.status}`);
        const len = Number(res.headers?.get?.('content-length')) || 0;
        if (len > MAX_DOWNLOAD) throw new Error('Pacote grande demais');
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_DOWNLOAD) throw new Error('Pacote grande demais');
        mkdirSync(base, { recursive: true });
        const got = unpackHuntExtension(buf, base);
        writeFileSync(statePath, JSON.stringify({ version: got.version, checkedAt: nowFn() }));
        // Guarda só a versão em uso.
        if (state.version && state.version !== got.version) rmSync(join(base, state.version), { recursive: true, force: true });
        return { dir: got.dir, version: got.version, updated: got.fresh || got.version !== state.version };
    } catch (err) {
        if (current) {
            try { writeFileSync(statePath, JSON.stringify({ ...state, checkedAt: nowFn() - CHECK_EVERY_MS + 3600_000 })); } catch { /* sem disco */ }
        }
        return { dir: current, version: state.version, updated: false, error: err?.message || String(err) };
    }
}
