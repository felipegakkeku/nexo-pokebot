// Dados de execução (tokens, cookies, perfis) ficam fora da pasta do app e a migração nunca perde nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listLegacyDataItems, migrateLegacyData, resolveDataRoot } from '../src/headless/data-dir.mjs';

const makeLegacy = (dir) => {
    mkdirSync(join(dir, '.pokebot-accounts', '2'), { recursive: true });
    mkdirSync(join(dir, '.pokebot-browser-profile', 'Default'), { recursive: true });
    writeFileSync(join(dir, '.pokebot-session.json'), '{"token":"jwt-1"}');
    writeFileSync(join(dir, '.pokebot-headless-config.json'), '{"browserProfile":"isolated"}');
    writeFileSync(join(dir, '.pokebot-accounts', '2', '.pokebot-session.json'), '{"token":"jwt-2"}');
    writeFileSync(join(dir, '.pokebot-browser-profile', 'Default', 'Cookies'), 'cookies');
    // pertencem ao programa/atualizador ou não são dados
    writeFileSync(join(dir, '.pokebot-update-pending.json'), '{}');
    writeFileSync(join(dir, '.pokebot-main-sync-optin.json'), '{}');
    writeFileSync(join(dir, 'package.json'), '{}');
};

const sandbox = () => {
    const base = mkdtempSync(join(tmpdir(), 'nexo-data-'));
    const legacy = join(base, 'app');
    const data = join(base, 'data');
    mkdirSync(legacy);
    makeLegacy(legacy);
    return { base, legacy, data, done: () => rmSync(base, { recursive: true, force: true }) };
};

test('pasta de dados: LOCALAPPDATA no Windows, NEXO_DATA_DIR manda, XDG fora do Windows', () => {
    assert.equal(resolveDataRoot({ env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, platform: 'win32', home: 'C:\\Users\\x' }),
        join('C:\\Users\\x\\AppData\\Local', 'Nexo PokeBot'));
    assert.equal(resolveDataRoot({ env: {}, platform: 'win32', home: 'C:\\Users\\x' }),
        join('C:\\Users\\x', 'AppData', 'Local', 'Nexo PokeBot'));
    assert.equal(resolveDataRoot({ env: { NEXO_DATA_DIR: join(tmpdir(), 'forcada') }, platform: 'win32' }), join(tmpdir(), 'forcada'));
    assert.equal(resolveDataRoot({ env: { XDG_DATA_HOME: '/d' }, platform: 'linux', home: '/h' }), join('/d', 'nexo-pokebot'));
});

test('migração: leva só os dados, deixa o que é do programa e preserva o conteúdo', () => {
    const t = sandbox();
    try {
        assert.deepEqual(listLegacyDataItems(t.legacy).sort(),
            ['.pokebot-accounts', '.pokebot-browser-profile', '.pokebot-headless-config.json', '.pokebot-session.json']);
        const res = migrateLegacyData({ legacyRoot: t.legacy, dataRoot: t.data });
        assert.equal(res.failed.length, 0);
        assert.equal(res.moved.length, 4);
        assert.equal(readFileSync(join(t.data, '.pokebot-session.json'), 'utf8'), '{"token":"jwt-1"}');
        assert.equal(readFileSync(join(t.data, '.pokebot-accounts', '2', '.pokebot-session.json'), 'utf8'), '{"token":"jwt-2"}');
        assert.equal(readFileSync(join(t.data, '.pokebot-browser-profile', 'Default', 'Cookies'), 'utf8'), 'cookies');
        for (const gone of ['.pokebot-session.json', '.pokebot-headless-config.json', '.pokebot-accounts', '.pokebot-browser-profile']) {
            assert.equal(existsSync(join(t.legacy, gone)), false, `${gone} não devia ficar na pasta do app`);
        }
        for (const stays of ['.pokebot-update-pending.json', '.pokebot-main-sync-optin.json', 'package.json']) {
            assert.equal(existsSync(join(t.legacy, stays)), true, `${stays} devia ficar`);
            assert.equal(existsSync(join(t.data, stays)), false);
        }
        // segunda execução não tem mais nada a fazer
        assert.deepEqual(migrateLegacyData({ legacyRoot: t.legacy, dataRoot: t.data }), { moved: [], skipped: [], failed: [] });
    } finally {
        t.done();
    }
});

test('migração: nunca sobrescreve o que já existe na pasta nova', () => {
    const t = sandbox();
    try {
        mkdirSync(t.data, { recursive: true });
        writeFileSync(join(t.data, '.pokebot-session.json'), '{"token":"novo"}');
        const res = migrateLegacyData({ legacyRoot: t.legacy, dataRoot: t.data });
        assert.deepEqual(res.skipped.map((s) => s.name), ['.pokebot-session.json']);
        assert.equal(readFileSync(join(t.data, '.pokebot-session.json'), 'utf8'), '{"token":"novo"}');
        assert.equal(readFileSync(join(t.legacy, '.pokebot-session.json'), 'utf8'), '{"token":"jwt-1"}');
    } finally {
        t.done();
    }
});

test('migração: se renomear não der, copia, confere e só então apaga a origem', () => {
    const t = sandbox();
    try {
        const res = migrateLegacyData({
            legacyRoot: t.legacy,
            dataRoot: t.data,
            renameImpl: () => { throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); },
        });
        assert.equal(res.failed.length, 0);
        assert.equal(res.moved.length, 4);
        assert.equal(readFileSync(join(t.data, '.pokebot-browser-profile', 'Default', 'Cookies'), 'utf8'), 'cookies');
        assert.equal(existsSync(join(t.legacy, '.pokebot-browser-profile')), false);
    } finally {
        t.done();
    }
});

test('migração: cópia incompleta ou com erro deixa a origem intacta e não deixa lixo no destino', () => {
    const t = sandbox();
    try {
        const failRename = () => { throw new Error('EBUSY'); };
        // cópia que perde um arquivo
        let res = migrateLegacyData({
            legacyRoot: t.legacy,
            dataRoot: t.data,
            renameImpl: failRename,
            copyImpl: (src, dst, opts) => {
                cpSync(src, dst, opts);
                rmSync(join(dst, 'Default', 'Cookies'), { force: true });
            },
        });
        assert.ok(res.failed.some((f) => f.name === '.pokebot-browser-profile' && /incompleta/.test(f.reason)));
        assert.equal(res.moved.length, 3, 'o que copiou direito migra; só o item com problema fica');
        assert.equal(existsSync(join(t.data, '.pokebot-browser-profile')), false);
        assert.equal(readFileSync(join(t.legacy, '.pokebot-browser-profile', 'Default', 'Cookies'), 'utf8'), 'cookies');

        // cópia que lança no meio: o destino parcial é removido e a origem continua
        res = migrateLegacyData({
            legacyRoot: t.legacy,
            dataRoot: t.data,
            renameImpl: failRename,
            copyImpl: (src, dst) => { mkdirSync(dst, { recursive: true }); throw new Error('arquivo em uso'); },
        });
        assert.equal(res.moved.length, 0);
        assert.deepEqual(res.failed.map((f) => f.name), ['.pokebot-browser-profile']);
        assert.equal(existsSync(join(t.data, '.pokebot-browser-profile')), false);
        assert.equal(readFileSync(join(t.legacy, '.pokebot-browser-profile', 'Default', 'Cookies'), 'utf8'), 'cookies');

        // na próxima abertura, sem o travamento, o que faltava passa
        res = migrateLegacyData({ legacyRoot: t.legacy, dataRoot: t.data });
        assert.deepEqual(res.moved, ['.pokebot-browser-profile']);
        assert.equal(readFileSync(join(t.data, '.pokebot-browser-profile', 'Default', 'Cookies'), 'utf8'), 'cookies');
    } finally {
        t.done();
    }
});

test('migração: origem igual ao destino e pasta antiga inexistente não fazem nada', () => {
    const t = sandbox();
    try {
        assert.deepEqual(migrateLegacyData({ legacyRoot: t.legacy, dataRoot: t.legacy }), { moved: [], skipped: [], failed: [] });
        assert.deepEqual(migrateLegacyData({ legacyRoot: join(t.base, 'nao-existe'), dataRoot: t.data }), { moved: [], skipped: [], failed: [] });
        assert.equal(existsSync(join(t.legacy, '.pokebot-session.json')), true);
    } finally {
        t.done();
    }
});
