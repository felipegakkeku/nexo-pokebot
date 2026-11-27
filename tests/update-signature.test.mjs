// Segurança do auto-update: só instala o que o dono assinou; "Sincronizar tudo" é escolha da pessoa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    UPDATE_SIGNING_PUBLIC_KEY,
    sha256File,
    signUpdate,
    updateStatement,
    verifyUpdateSignature,
} from '../src/desktop/update-signature.mjs';
import { checkForUpdate, selectReleaseZipAsset, verifyDownloadedUpdate } from '../src/desktop/updater.mjs';
import {
    MAIN_SYNC_OPTIN_FILE,
    checkMainAhead,
    isMainSyncEnabled,
    setMainSyncEnabled,
    stageMainCommit,
    stagedMainReady,
} from '../src/desktop/main-sync.mjs';

const keys = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return {
        pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        pem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    };
};
const SHA = createHash('sha256').update('pacote').digest('hex');

test('assinatura: confere para a tag e o hash certos e recusa o resto', () => {
    const { pub, pem } = keys();
    const sig = signUpdate({ tag: 'v1.2.3', sha256: SHA, privateKeyPem: pem });
    assert.equal(verifyUpdateSignature({ tag: 'v1.2.3', sha256: SHA, signature: sig, publicKey: pub }), true);
    // pacote adulterado
    assert.equal(verifyUpdateSignature({ tag: 'v1.2.3', sha256: createHash('sha256').update('outro').digest('hex'), signature: sig, publicKey: pub }), false);
    // assinatura de uma versão antiga reaproveitada em outra tag
    assert.equal(verifyUpdateSignature({ tag: 'v1.2.4', sha256: SHA, signature: sig, publicKey: pub }), false);
    // chave de outra pessoa
    assert.equal(verifyUpdateSignature({ tag: 'v1.2.3', sha256: SHA, signature: sig, publicKey: keys().pub }), false);
    // lixo nunca lança
    for (const bad of ['', 'abc', null, undefined, 'A'.repeat(200)]) {
        assert.equal(verifyUpdateSignature({ tag: 'v1.2.3', sha256: SHA, signature: bad, publicKey: pub }), false);
    }
    assert.throws(() => updateStatement({ tag: 'v1\n2', sha256: SHA }));
    assert.throws(() => updateStatement({ tag: 'v1.0.0', sha256: 'zz' }));
});

test('assinatura: a chave pública embutida no app é uma chave Ed25519 válida', () => {
    const { pem } = keys();
    const sig = signUpdate({ tag: 'v1.0.0', sha256: SHA, privateKeyPem: pem });
    // com a chave embutida (que não é a de teste) a assinatura de teste tem que falhar, sem lançar erro de chave
    assert.equal(verifyUpdateSignature({ tag: 'v1.0.0', sha256: SHA, signature: sig }), false);
    assert.equal(Buffer.from(UPDATE_SIGNING_PUBLIC_KEY, 'base64').length, 44);
});

test('release sem .sig não é oferecida como atualização', async () => {
    const assets = (withSig) => [
        { name: 'Nexo-PokeBot-v1.1.zip', size: 10, browser_download_url: 'https://github.com/a/b/Nexo-PokeBot-v1.1.zip' },
        ...(withSig ? [{ name: 'Nexo-PokeBot-v1.1.zip.sig', size: 90, browser_download_url: 'https://github.com/a/b/Nexo-PokeBot-v1.1.zip.sig' }] : []),
    ];
    assert.equal(selectReleaseZipAsset({ assets: assets(false) }).sigUrl, '');
    assert.equal(selectReleaseZipAsset({ assets: assets(true) }).sigUrl, 'https://github.com/a/b/Nexo-PokeBot-v1.1.zip.sig');

    const dir = mkdtempSync(join(tmpdir(), 'nexo-sig-'));
    try {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
        const check = (withSig) => checkForUpdate({
            rootDir: dir,
            fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v1.1.0', assets: assets(withSig) }) }),
        });
        const unsigned = await check(false);
        assert.equal(unsigned.hasUpdate, false);
        assert.equal(unsigned.awaitingSignature, true);
        const signed = await check(true);
        assert.equal(signed.hasUpdate, true);
        assert.equal(signed.awaitingSignature, false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('verifyDownloadedUpdate: aceita pacote assinado e recusa adulterado, sem assinatura ou com .sig gigante', async () => {
    const { pub, pem } = keys();
    const dir = mkdtempSync(join(tmpdir(), 'nexo-sig-'));
    try {
        const zipPath = join(dir, 'Nexo-PokeBot-v1.1.zip');
        writeFileSync(zipPath, 'conteudo do pacote');
        const sha256 = await sha256File(zipPath);
        const sig = signUpdate({ tag: 'v1.1.0', sha256, privateKeyPem: pem });
        const info = { tagName: 'v1.1.0', asset: { sigUrl: 'https://github.com/a/b/x.zip.sig' } };
        const serve = (text) => async () => ({ ok: true, status: 200, text: async () => text });

        await verifyDownloadedUpdate({ zipPath, releaseInfo: info, fetchImpl: serve(`${sig}\n`), publicKey: pub });

        writeFileSync(zipPath, 'conteudo ADULTERADO');
        await assert.rejects(verifyDownloadedUpdate({ zipPath, releaseInfo: info, fetchImpl: serve(sig), publicKey: pub }), /inválida/);

        await assert.rejects(verifyDownloadedUpdate({ zipPath, releaseInfo: { tagName: 'v1.1.0', asset: { sigUrl: '' } }, fetchImpl: serve(sig), publicKey: pub }), /não foi assinada/);
        await assert.rejects(verifyDownloadedUpdate({ zipPath, releaseInfo: { asset: { sigUrl: info.asset.sigUrl } }, fetchImpl: serve(sig), publicKey: pub }), /não foi assinada/);
        await assert.rejects(verifyDownloadedUpdate({ zipPath, releaseInfo: info, fetchImpl: serve('A'.repeat(5000)), publicKey: pub }), /grande demais/);
        await assert.rejects(verifyDownloadedUpdate({ zipPath, releaseInfo: { tagName: 'v1.1.0', asset: { sigUrl: 'http://x/y.sig' } }, fetchImpl: serve(sig), publicKey: pub }), /https/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Sincronizar tudo: desligado por padrão, a pessoa liga e desliga, e nada baixado vale com ele desligado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexo-sync-'));
    try {
        writeFileSync(join(dir, 'build-info.json'), JSON.stringify({ version: '1.0.0', commit: 'a'.repeat(40) }));
        const noEnv = {};
        assert.equal(isMainSyncEnabled(dir, noEnv), false);

        // desligado: não consulta o GitHub, não baixa e não aplica pacote antigo
        let called = 0;
        const fetchImpl = async () => { called++; return { ok: false }; };
        assert.deepEqual(await checkMainAhead({ rootDir: dir, fetchImpl }), { ok: true, ahead: false, reason: 'desligado' });
        assert.equal((await stageMainCommit({ rootDir: dir, sha: 'b'.repeat(40), fetchImpl })).reason, 'desligado');
        writeFileSync(join(dir, '.pokebot-main-sync.json'), JSON.stringify({ sha: 'b'.repeat(40), scriptPath: join(dir, 'x.ps1'), attempts: 0 }));
        writeFileSync(join(dir, 'x.ps1'), '');
        assert.equal(stagedMainReady(dir), null);
        assert.equal(called, 0);

        // ligado pela pessoa
        assert.equal(setMainSyncEnabled(dir, true), true);
        assert.ok(existsSync(join(dir, MAIN_SYNC_OPTIN_FILE)));
        assert.equal(isMainSyncEnabled(dir, noEnv), true);
        assert.equal(stagedMainReady(dir)?.sha, 'b'.repeat(40));

        // desligado de novo: some a escolha e o pacote baixado é descartado
        assert.equal(setMainSyncEnabled(dir, false), false);
        assert.equal(isMainSyncEnabled(dir, noEnv), false);
        assert.equal(existsSync(join(dir, '.pokebot-main-sync.json')), false);

        // variável de ambiente continua valendo para quem desenvolve
        assert.equal(isMainSyncEnabled(dir, { NEXO_MAIN_SYNC: '1' }), true);
        assert.equal(JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf8')).version, '1.0.0');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
