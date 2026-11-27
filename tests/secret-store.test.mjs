// Sessão e tokens de live não ficam em texto puro em disco (chave mestra via DPAPI; aqui, chave de teste).
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    ENCRYPTED_PREFIX,
    decryptText,
    encryptText,
    isEncrypted,
    isSecretStoreAvailable,
    setSecretKeyProvider,
} from '../src/headless/secret-store.mjs';
import { loadSessionCache, saveSessionCache } from '../src/headless/session-extractor.mjs';
import { createHeadlessController } from '../src/headless/gui-server.mjs';

const KEY = Buffer.alloc(32, 9);
let dir;
beforeEach(() => {
    setSecretKeyProvider(() => KEY);
    dir = mkdtempSync(join(tmpdir(), 'nexo-secret-'));
});
afterEach(() => {
    setSecretKeyProvider(null);
    rmSync(dir, { recursive: true, force: true });
});

test('secret-store: ida e volta, contexto amarrado e adulteração detectada', () => {
    const sealed = encryptText('jwt-muito-secreto', 'ctx');
    assert.ok(isEncrypted(sealed));
    assert.ok(sealed.startsWith(ENCRYPTED_PREFIX));
    assert.ok(!sealed.includes('jwt-muito-secreto'));
    assert.equal(decryptText(sealed, 'ctx'), 'jwt-muito-secreto');
    assert.equal(decryptText(sealed, 'outro'), null, 'cifrado para um campo não abre em outro');
    assert.notEqual(encryptText('x', 'ctx'), encryptText('x', 'ctx'), 'IV novo a cada vez');

    const flipped = Buffer.from(sealed.slice(ENCRYPTED_PREFIX.length), 'base64');
    flipped[flipped.length - 1] ^= 1;
    assert.equal(decryptText(ENCRYPTED_PREFIX + flipped.toString('base64'), 'ctx'), null);
    for (const bad of ['', 'texto puro', `${ENCRYPTED_PREFIX}curto`, null, undefined]) {
        assert.equal(decryptText(bad, 'ctx'), null);
    }

    // outra chave não abre
    setSecretKeyProvider(() => Buffer.alloc(32, 1));
    assert.equal(decryptText(sealed, 'ctx'), null);
});

test('secret-store: sem chave nada é criptografado (quem chama grava como antes)', () => {
    setSecretKeyProvider(() => null);
    assert.equal(isSecretStoreAvailable(), false);
    assert.equal(encryptText('x', 'ctx'), null);
});

test('sessão: arquivo no disco não tem o token e volta íntegro', () => {
    const file = join(dir, '.pokebot-session.json');
    saveSessionCache(file, { nick: 'Treinador', token: 'JWT.abc.def', provedor: 'google', dispositivo: 'uuid-1' });
    const raw = readFileSync(file, 'utf8');
    assert.ok(raw.startsWith(ENCRYPTED_PREFIX));
    assert.ok(!raw.includes('JWT.abc.def') && !raw.includes('Treinador'));
    const back = loadSessionCache(file);
    assert.equal(back.token, 'JWT.abc.def');
    assert.equal(back.nick, 'Treinador');
    assert.equal(back.dispositivo, 'uuid-1');
});

test('sessão: arquivo antigo em texto puro é lido e regravado criptografado', () => {
    const file = join(dir, '.pokebot-session.json');
    writeFileSync(file, JSON.stringify({ nick: 'Velho', token: 'JWT.legado', updatedAt: 1 }, null, 2));
    assert.equal(loadSessionCache(file).token, 'JWT.legado');
    const raw = readFileSync(file, 'utf8');
    assert.ok(raw.startsWith(ENCRYPTED_PREFIX), 'regravou criptografado');
    assert.ok(!raw.includes('JWT.legado'));
    assert.equal(loadSessionCache(file).token, 'JWT.legado');
});

test('sessão: arquivo adulterado, de outra chave ou lixo não vira sessão', () => {
    const file = join(dir, '.pokebot-session.json');
    saveSessionCache(file, { nick: 'A', token: 'JWT.x' });
    setSecretKeyProvider(() => Buffer.alloc(32, 2));
    assert.equal(loadSessionCache(file), null);
    setSecretKeyProvider(() => KEY);
    writeFileSync(file, `${ENCRYPTED_PREFIX}lixo-lixo-lixo-lixo-lixo-lixo-lixo-lixo-lixo-lixo`);
    assert.equal(loadSessionCache(file), null);
});

test('sessão: sem DPAPI o arquivo segue em texto puro e continua funcionando', () => {
    setSecretKeyProvider(() => null);
    const file = join(dir, '.pokebot-session.json');
    saveSessionCache(file, { nick: 'Sem', token: 'JWT.plain' });
    assert.ok(readFileSync(file, 'utf8').includes('JWT.plain'));
    assert.equal(loadSessionCache(file).token, 'JWT.plain');
});

test('config: tokens de live vão criptografados, o resto fica legível e tudo volta ao abrir de novo', async () => {
    const cfgPath = join(dir, 'cfg.json');
    const make = () => createHeadlessController({
        cwd: dir,
        configPath: cfgPath,
        disableBrowserProfileSync: true,
        liveRunner: async () => {},
        liveDisposer: () => {},
        resolveSession: () => ({ nick: 'T', token: 'JWT.t', prefs: {} }),
    });
    const first = make();
    first.updateConfig({ liveTwitchToken: 'twitch-secreto', liveKickToken: 'kick-secreto', browserProfile: 'isolated' });
    first.stop();
    const raw = readFileSync(cfgPath, 'utf8');
    assert.ok(!raw.includes('twitch-secreto') && !raw.includes('kick-secreto'), 'token em texto puro no disco');
    const onDisk = JSON.parse(raw);
    assert.ok(onDisk.liveTwitchToken.startsWith(ENCRYPTED_PREFIX));
    assert.equal(onDisk.browserProfile, 'isolated', 'o launcher em C# lê browserProfile direto do arquivo');

    const second = make();
    const snap = second.getSnapshot();
    assert.equal(snap.lives.hasTwitchToken, true);
    assert.equal(snap.lives.hasKickToken, true);
    second.stop();
});

test('config: arquivo antigo com token em texto puro é aceito e regravado criptografado', () => {
    const cfgPath = join(dir, 'cfg.json');
    writeFileSync(cfgPath, JSON.stringify({ liveTwitchToken: 'twitch-legado', browserProfile: '' }, null, 2));
    const controller = createHeadlessController({
        cwd: dir,
        configPath: cfgPath,
        disableBrowserProfileSync: true,
        liveRunner: async () => {},
        liveDisposer: () => {},
        resolveSession: () => ({ nick: 'T', token: 'JWT.t', prefs: {} }),
    });
    assert.equal(controller.getSnapshot().lives.hasTwitchToken, true);
    controller.stop();
    assert.ok(!readFileSync(cfgPath, 'utf8').includes('twitch-legado'));
});

test('DPAPI real (só Windows): chave mestra protegida em disco e reaproveitada entre execuções', { skip: process.platform !== 'win32' }, () => {
    const dataDir = join(dir, 'dados');
    const previous = process.env.NEXO_DATA_DIR;
    process.env.NEXO_DATA_DIR = dataDir;
    try {
        setSecretKeyProvider(null); // usa o DPAPI de verdade, numa pasta temporária
        assert.equal(isSecretStoreAvailable(), true);
        const sealed = encryptText('jwt-real', 'ctx');
        const keyFile = readFileSync(join(dataDir, '.pokebot-secret-key.json'), 'utf8');
        assert.match(keyFile, /dpapi-currentuser/);
        const wrapped = JSON.parse(keyFile).key;
        assert.ok(wrapped.length > 80, 'blob DPAPI, não a chave crua');

        // "outro processo": zera o cache e abre a mesma chave pelo arquivo
        setSecretKeyProvider(null);
        assert.equal(decryptText(sealed, 'ctx'), 'jwt-real');
        assert.equal(JSON.parse(readFileSync(join(dataDir, '.pokebot-secret-key.json'), 'utf8')).key, wrapped, 'não regerou a chave');

        // arquivo de chave corrompido: nada de gerar chave nova por cima
        writeFileSync(join(dataDir, '.pokebot-secret-key.json'), JSON.stringify({ v: 1, wrap: 'dpapi-currentuser', key: 'AAAA' }));
        setSecretKeyProvider(null);
        const warn = console.warn;
        console.warn = () => {};
        try {
            assert.equal(isSecretStoreAvailable(), false);
        } finally {
            console.warn = warn;
        }
        assert.equal(JSON.parse(readFileSync(join(dataDir, '.pokebot-secret-key.json'), 'utf8')).key, 'AAAA');
    } finally {
        if (previous === undefined) delete process.env.NEXO_DATA_DIR; else process.env.NEXO_DATA_DIR = previous;
    }
});
