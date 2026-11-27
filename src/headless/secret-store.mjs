// Criptografia em repouso dos segredos (JWT da sessão, tokens de live).
//
// Os dados ficam em %LOCALAPPDATA%, fora da nuvem, mas ainda em texto puro: qualquer coisa que leia a pasta
// do usuário (backup, outro programa, quem copia a pasta) veria os tokens. Aqui os arquivos passam a ser
// AES-256-GCM e a chave mestra fica protegida pelo DPAPI do Windows (escopo do usuário atual): só esta conta
// do Windows, nesta máquina, consegue abrir a chave.
//
// Como o Node não tem DPAPI nativo, a chave é protegida/aberta uma vez por processo pelo PowerShell do
// Windows (os dados vão por stdin, nunca pela linha de comando). Sem DPAPI (fora do Windows ou PowerShell
// bloqueado) nada é criptografado e os arquivos seguem em texto puro, com aviso no log.
import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveDataRoot } from './data-dir.mjs';

export const ENCRYPTED_PREFIX = 'nexo-enc:1:';
const KEY_FILE_NAME = '.pokebot-secret-key.json';
const DPAPI_ENTROPY = 'nexo-pokebot/v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

let customProvider = null;
let cachedKey; // undefined = ainda não tentou; null = indisponível; Buffer = pronta
let warned = false;

/** Só para testes: troca a origem da chave mestra (função que devolve Buffer de 32 bytes ou null). */
export function setSecretKeyProvider(provider) {
    customProvider = typeof provider === 'function' ? provider : null;
    cachedKey = undefined;
}

function warnOnce(message) {
    if (warned) return;
    warned = true;
    console.warn(`[segurança] ${message}`);
}

function powershellPath() {
    return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

// `mode` é sempre 'protect' ou 'unprotect' (constante interna), nunca dado externo.
function dpapi(mode, base64In) {
    const script = [
        'Add-Type -AssemblyName System.Security',
        '$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
        `$entropy = [Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}')`,
        mode === 'protect'
            ? "$out = [Security.Cryptography.ProtectedData]::Protect($data, $entropy, 'CurrentUser')"
            : "$out = [Security.Cryptography.ProtectedData]::Unprotect($data, $entropy, 'CurrentUser')",
        '[Convert]::ToBase64String($out)',
    ].join('; ');
    return execFileSync(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', script], {
        input: base64In,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
        stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
}

function keyFilePath() {
    return join(resolveDataRoot(), KEY_FILE_NAME);
}

function loadOrCreateDpapiKey() {
    if (process.platform !== 'win32') return null;
    const file = keyFilePath();
    if (existsSync(file)) {
        // Arquivo existe mas não abre (outro usuário/máquina): nunca gerar chave nova por cima, perderia os dados.
        const meta = JSON.parse(readFileSync(file, 'utf8'));
        const key = Buffer.from(dpapi('unprotect', meta.key), 'base64');
        if (key.length !== KEY_BYTES) throw new Error('chave mestra com tamanho inesperado');
        return key;
    }
    const key = randomBytes(KEY_BYTES);
    const wrapped = dpapi('protect', key.toString('base64'));
    mkdirSync(dirname(file), { recursive: true });
    try {
        writeFileSync(file, JSON.stringify({ v: 1, wrap: 'dpapi-currentuser', key: wrapped }) + '\n', { encoding: 'utf8', flag: 'wx' });
        return key;
    } catch (err) {
        if (err?.code !== 'EEXIST') throw err;
        // outro processo criou a chave no mesmo instante: usa a dele
        const meta = JSON.parse(readFileSync(file, 'utf8'));
        return Buffer.from(dpapi('unprotect', meta.key), 'base64');
    }
}

function masterKey() {
    if (cachedKey !== undefined) return cachedKey;
    try {
        const key = customProvider ? customProvider() : loadOrCreateDpapiKey();
        cachedKey = Buffer.isBuffer(key) && key.length === KEY_BYTES ? key : null;
    } catch (err) {
        cachedKey = null;
        warnOnce(`não consegui usar o DPAPI do Windows (${err?.message?.split('\n')[0] || err}); sessões ficam sem criptografia.`);
    }
    if (cachedKey === null && !customProvider && process.platform !== 'win32') {
        warnOnce('criptografia de sessão só existe no Windows (DPAPI); sessões ficam sem criptografia.');
    }
    return cachedKey;
}

/** Há chave mestra utilizável neste processo? */
export function isSecretStoreAvailable() {
    return masterKey() !== null;
}

export function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Criptografa um texto. `context` entra como dado autenticado, então um valor cifrado para um campo não
 * abre em outro. Devolve null se não houver chave (quem chama grava em texto puro).
 */
export function encryptText(plain, context = '') {
    const key = masterKey();
    if (!key) return null;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(String(context), 'utf8'));
    const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return ENCRYPTED_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Abre um texto criptografado. Devolve null se estiver adulterado, for de outro contexto ou sem chave. */
export function decryptText(value, context = '') {
    if (!isEncrypted(value)) return null;
    const key = masterKey();
    if (!key) return null;
    try {
        const raw = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
        if (raw.length < IV_BYTES + TAG_BYTES) return null;
        const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
        decipher.setAAD(Buffer.from(String(context), 'utf8'));
        decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}
