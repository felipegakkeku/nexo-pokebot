// Aviso de sessão: distingue "nunca teve" (silencioso) de "existe mas não abre" e "venceu".
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setSecretKeyProvider } from '../src/headless/secret-store.mjs';
import { inspectSessionCache, saveSessionCache } from '../src/headless/session-extractor.mjs';

const KEY = Buffer.alloc(32, 7);
const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);
let dir;
let file;

const jwt = (exp) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.sig`;

beforeEach(() => {
    setSecretKeyProvider(() => KEY);
    dir = mkdtempSync(join(tmpdir(), 'nexo-inspect-'));
    file = join(dir, '.pokebot-session.json');
});
afterEach(() => {
    setSecretKeyProvider(null);
    rmSync(dir, { recursive: true, force: true });
});

test('inspectSessionCache: sem arquivo é "missing" (não é defeito)', () => {
    assert.deepEqual(inspectSessionCache(file, NOW), { state: 'missing' });
});

test('inspectSessionCache: sessão válida volta ok com o nick', () => {
    saveSessionCache(file, { nick: 'Ash', token: jwt(NOW + 3_600_000) });
    assert.deepEqual(inspectSessionCache(file, NOW), { state: 'ok', nick: 'Ash' });
});

test('inspectSessionCache: token vencido volta expired com o nick', () => {
    saveSessionCache(file, { nick: 'Ash', token: jwt(NOW - 1000) });
    assert.deepEqual(inspectSessionCache(file, NOW), { state: 'expired', nick: 'Ash' });
});

test('inspectSessionCache: arquivo criptografado com outra chave não abre', () => {
    saveSessionCache(file, { nick: 'Ash', token: jwt(NOW + 3_600_000) });
    setSecretKeyProvider(() => Buffer.alloc(32, 1));
    const r = inspectSessionCache(file, NOW);
    assert.equal(r.state, 'unreadable');
    assert.match(r.reason, /outro PC ou usuário/);
});

test('inspectSessionCache: criptografado sem chave disponível é unreadable', () => {
    saveSessionCache(file, { nick: 'Ash', token: jwt(NOW + 3_600_000) });
    setSecretKeyProvider(() => null);
    const r = inspectSessionCache(file, NOW);
    assert.equal(r.state, 'unreadable');
    assert.match(r.reason, /DPAPI/);
});

test('inspectSessionCache: vazio, corrompido e sem token são unreadable', () => {
    writeFileSync(file, '');
    assert.equal(inspectSessionCache(file, NOW).state, 'unreadable');
    writeFileSync(file, '{ não é json');
    assert.match(inspectSessionCache(file, NOW).reason, /corrompido/);
    writeFileSync(file, JSON.stringify({ nick: 'Ash' }));
    assert.match(inspectSessionCache(file, NOW).reason, /nick ou token/);
});

test('snapshot: sessão ilegível vira aviso com botão de recuperar; sem arquivo não faz barulho', async () => {
    const { createHeadlessController } = await import('../src/headless/gui-server.mjs');
    const make = () => createHeadlessController({
        cwd: dir,
        sessionFile: file,
        configPath: join(dir, 'cfg.json'),
        disableBrowserProfileSync: true,
        liveRunner: async () => {},
        liveDisposer: () => {},
        resolveSession: () => { throw new Error('Nenhuma sessao valida do Pokeidle encontrada.'); },
    });

    const quiet = make();
    assert.ok(!quiet.getSnapshot().modeWarnings.some((w) => String(w.code).startsWith('session-')));
    quiet.stop();

    saveSessionCache(file, { nick: 'Ash', token: jwt(Date.now() + 3_600_000) });
    setSecretKeyProvider(() => Buffer.alloc(32, 1)); // chave de outro PC/usuário
    const broken = make();
    const warn = broken.getSnapshot().modeWarnings.find((w) => w.code === 'session-unreadable');
    broken.stop();
    assert.ok(warn, 'esperava o aviso de sessão ilegível');
    assert.equal(warn.severity, 'danger');
    assert.equal(warn.fixAction, 'recover-sessions');
});
