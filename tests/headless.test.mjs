// Testes unitarios do motor headless (extrator LevelDB/Snappy, engine de protocolo e parser CLI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    parseSemver,
    compareSemver,
    selectReleaseZipAsset,
    checkForUpdate,
    buildWindowsApplyScript,
    downloadAndStageUpdate,
} from '../src/desktop/updater.mjs';

import {
    snappyDecompress,
    decodeJwtPayload,
    discoverBrowserUserDataDirs,
    extractSessionFromLevelDbDir,
    loadSessionCache,
    saveSessionCache,
    resolveHeadlessSession,
} from '../src/headless/session-extractor.mjs';
import {
    BALL_IDS,
    DEFAULT_BALL_PRICES,
    ITEM_IDS,
    DEFAULT_ITEM_PRICES,
    getSeasonalDayKey,
    computePassStatus,
    createStateMerger,
    createFieldTracker,
    isWildCampoMob,
    resolvePokemonSpriteDex,
    pickHeadlessBallForCorpse,
    resolveRestockBallId,
    resolveRestockPotionId,
    evaluateHeadlessTick,
    computeModeWarnings,
    getPokedexCapturedSet,
    getTopCatchWeekWindow,
    selectObjectiveHunt,
} from '../src/headless/protocol-engine.mjs';
import { parseCliArgs } from '../src/headless/cli-runner.mjs';
import {
    createHeadlessController,
    detectProfileBrowserKind,
    startGuiServer,
    openInteractiveLogin,
    trySilentProfileCookieSync,
    createCdpBrowserBridge,
    findExistingBrowserProfile,
    listExistingBrowserProfiles,
    parseImportedSessionInput,
    resolveHuntFocus,
} from '../src/headless/gui-server.mjs';
import { buildDesktopExecutable, buildPokeballIconBuffer } from '../src/desktop/build-exe.mjs';
import { startMultiAccountDaemon } from '../src/headless/multi-daemon.mjs';

test('coleção: Pokédex e Top Catch usam conjuntos diferentes e o Top Catch troca de mapa após captura', () => {
    const hunts = [
        { slug: 'perto', nome: 'Perto', nivel: 8, especies: [{ pokeId: 1 }, { pokeId: 2 }] },
        { slug: 'longe', nome: 'Longe', nivel: 12, especies: [{ pokeId: 3 }] },
        { slug: 'travada', nome: 'Travada', nivel: 100, especies: [{ pokeId: 4 }] },
    ];
    const options = { focus: 'ouro', currentSlug: 'perto', activeTargetSlug: 'perto', trainerLevel: 20, hunts,
        huntRanking: [{ slug: 'perto', goldH: 300 }, { slug: 'longe', goldH: 250 }, { slug: 'travada', goldH: 999 }] };
    const dex = getPokedexCapturedSet({ 1: { c: 3 }, 2: { c: 1 }, 13003: { c: 0 } });
    const dexHunt = selectObjectiveHunt({ ...options, mode: 'pokedex', capturedSet: dex });
    assert.equal(dexHunt.targetSlug, 'longe');
    const weekly = new Set(['1']);
    const topCatch = selectObjectiveHunt({ ...options, mode: 'topcatch', capturedSet: weekly });
    assert.equal(topCatch.targetSlug, 'perto');
    assert.deepEqual(topCatch.targetMissing.map((sp) => sp.key), ['2']);
    const next = selectObjectiveHunt({ ...options, mode: 'topcatch', capturedSet: weekly, rotateAfterCatch: true });
    assert.equal(next.targetSlug, 'longe');
    assert.equal(next.metricValue, 250);
    const rollover = getTopCatchWeekWindow('2026-11-22', Date.UTC(2026, 10, 29, 2, 59));
    assert.equal(rollover.endMs, Date.UTC(2026, 10, 29, 3));
    assert.equal(rollover.remainingMs, 60_000);
});

test('coleção: lança bola só em espécies pendentes e desliga a captura VIP que ignora o objetivo', () => {
    const state = { gold: 1000, balls: { 1: 10 }, automation: { autoBallSemParar: true }, loja: { vip: true } };
    const field = { getFallenCorpses: () => [
        { slot: 'ja', speciesId: 1, shiny: true },
        { slot: 'pendente', speciesId: 2 },
    ] };
    const config = { farmObjective: 'pokedex', ensureNativeAutoHeal: false, restockEnabled: false,
        dailyPassEnabled: false, preyEnabled: false, preferredBall: 'poke' };
    const actions = evaluateHeadlessTick({ state, field, config, desiredMissingKeys: new Set(['2']), nowMs: 60_000 });
    assert.deepEqual(actions.find((action) => action.t === 'ball.throw'), { t: 'ball.throw', slot: 'pendente', ballId: 1 });
    const auto = actions.find((action) => action.t === 'auto.set');
    assert.equal(auto.autoBallSemParar, false);
    assert.equal(auto.autoBallAteCapturar, false);
    const noTarget = evaluateHeadlessTick({ state, field, config, desiredMissingKeys: new Set(), nowMs: 60_000 });
    assert.equal(noTarget.some((action) => action.t === 'ball.throw'), false);
});
import { syncCookiesToConfig } from '../src/modules/live-rewards.js';
import {
    HUNT_EXTENSION_ID,
    findHuntExtensionDir,
    readHuntGuideInPage,
} from '../src/headless/hunt-guide.mjs';

const LEVELDB_MAGIC = 0xdb4775248b80fb57n;

test('hunt guide: usa o cálculo da extensão, a meta escolhida e a região preferida', async () => {
    const pokemon = { id: 45, level: 150 };
    let analysisOptions;
    globalThis.__pokeidleHunt = {
        carregarJogo: async () => 'jogo',
        calculo: {
            pronto: () => true,
            pkAtivo: () => pokemon,
            opcoes: () => ({ regiao: 'johto' }),
            contexto: (game, pk) => ({ game, pk }),
        },
        engine: {
            analisar: (_pk, _context, options) => {
                analysisOptions = options;
                return { linhas: [
                    { slug: 'locked', liberada: false, regiao: 'johto', ouroH: 9000 },
                    { slug: 'kanto1', liberada: true, regiao: 'kanto', ouroH: 8000 },
                    { slug: 'johto1', nome: 'Hoppip', nivel: 80, liberada: true, regiao: 'johto', ouroH: 7000 },
                ] };
            },
        },
    };
    try {
        const recommendation = await readHuntGuideInPage('ouro');
        assert.equal(analysisOptions.ordem, 'ouro');
        assert.equal(analysisOptions.soLiberadas, true);
        assert.equal(recommendation.slug, 'johto1');
        assert.equal(recommendation.value, 7000);
    } finally {
        delete globalThis.__pokeidleHunt;
    }
});

test('hunt guide: avisa sem mover e exige duas leituras no automático', async () => {
    const sent = [];
    let frame;
    let best = { slug: 'alvo', name: 'Alvo', level: 50, pokemonId: 2, pokemonLevel: 90, value: 1000, unsafe: false };
    let reads = 0;
    const controller = createHeadlessController({
        configPath: null,
        disableBrowserProfileSync: true,
        initialConfig: { huntGuideMode: 'notify', liveEnabled: false, ensureNativeAutoHeal: false },
        huntGuideIntervalMs: 10,
        resolveSession: () => ({ nick: 'Treinador' }),
        browserBridgeFactory: async (options) => {
            frame = options.onFrame;
            return {
                close() {},
                isReady: () => true,
                send(action) { sent.push(action); return true; },
                readHuntGuide: async () => { reads++; return best; },
            };
        },
    });
    const until = async (done) => {
        for (let n = 0; n < 100 && !done(); n++) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.ok(done());
    };
    try {
        controller.attachBrowser({ waitForWelcome: true, seedSession: false });
        await until(() => frame);
        frame(JSON.stringify({
            t: 'welcome', hunts: [{ slug: 'alvo', nome: 'Alvo', nivel: 50 }],
            estado: { cheio: true, nick: 'Treinador', level: 90, activeId: 2, huntSlug: 'atual',
                pokemons: [{ id: 2, level: 90 }] },
        }));
        await until(() => controller.getSnapshot().huntGuide?.slug === 'alvo');
        assert.equal(sent.some((action) => action.t === 'hunt.select'), false);

        best = { ...best, unsafe: true };
        const before = reads;
        controller.updateConfig({ huntGuideMode: 'auto' });
        await until(() => reads >= before + 3);
        assert.equal(sent.some((action) => action.t === 'hunt.select'), false);
        best = { ...best, unsafe: false };
        await until(() => sent.some((action) => action.t === 'hunt.select'));
        assert.deepEqual(sent.filter((action) => action.t === 'hunt.select'), [{ t: 'hunt.select', slug: 'alvo' }]);
    } finally {
        controller.stop();
    }
});

test('desktop: reusa o último perfil do Chrome em vez do perfil isolado ou do Edge', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-existing-profile-'));
    try {
        const chrome = join(dir, 'Google', 'Chrome', 'User Data');
        const edge = join(dir, 'Microsoft', 'Edge', 'User Data');
        const isolated = join(dir, '.pokebot-browser-profile');
        for (const root of [chrome, edge, isolated]) {
            mkdirSync(join(root, 'Profile 2'), { recursive: true });
            writeFileSync(join(root, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 2' } }));
        }
        assert.deepEqual(findExistingBrowserProfile('chrome.exe', [isolated, edge, chrome]), {
            root: chrome,
            name: 'Profile 2',
            levelDb: join(chrome, 'Profile 2', 'Local Storage', 'leveldb'),
        });
        assert.equal(findExistingBrowserProfile('chrome.exe', [isolated, edge]), null);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('desktop: sessão rejeitada encerra a conexão e permite nova tentativa com sessão atualizada', () => {
    const sockets = [];
    let token = 'tokenAntigo';
    const controller = createHeadlessController({
        configPath: null,
        disableBrowserProfileSync: true,
        resolveSession: () => ({ nick: 'Trainer', token }),
        wsFactory: () => {
            const socket = {
                readyState: 1,
                sent: [],
                send(frame) { this.sent.push(JSON.parse(frame)); },
                close() { this.readyState = 3; this.onclose?.({ code: 1000 }); },
            };
            sockets.push(socket);
            return socket;
        },
    });
    try {
        assert.equal(controller.start(), true);
        sockets[0].onopen();
        assert.equal(sockets[0].sent[0].token, 'tokenAntigo');
        sockets[0].onmessage({ data: JSON.stringify({ t: 'erro', chave: 'auth.sessaoInvalida' }) });
        assert.equal(sockets[0].readyState, 3);
        assert.equal(controller.getSnapshot().status, 'error');
        token = 'tokenNovo';
        assert.equal(controller.reconnect(), true);
        sockets[1].onopen();
        assert.equal(sockets[1].sent[0].token, 'tokenNovo');
    } finally {
        controller.stop();
    }
});

function encodeVarint(n) {
    let v = BigInt(n);
    const out = [];
    while (v >= 0x80n) {
        out.push(Number((v & 0x7fn) | 0x80n));
        v >>= 7n;
    }
    out.push(Number(v));
    return Buffer.from(out);
}

function encodeSnappyLiteral(bytes) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const len = buf.length;
    if (len <= 60) {
        return Buffer.concat([Buffer.from([((len - 1) << 2) | 0]), buf]);
    }
    if (len <= 256) {
        return Buffer.concat([Buffer.from([(60 << 2) | 0, len - 1]), buf]);
    }
    const extra = len - 1;
    return Buffer.concat([Buffer.from([(61 << 2) | 0, extra & 0xff, (extra >> 8) & 0xff]), buf]);
}

function encodeSnappyCopy1(len, off) {
    const c = ((off >> 8) << 5) | ((len - 4) << 2) | 1;
    return Buffer.from([c, off & 0xff]);
}

function encodeSnappyCopy2(len, off) {
    const out = Buffer.alloc(3);
    out[0] = ((len - 1) << 2) | 2;
    out.writeUInt16LE(off, 1);
    return out;
}

function encodeSnappyCopy4(len, off) {
    const out = Buffer.alloc(5);
    out[0] = ((len - 1) << 2) | 3;
    out.writeUInt32LE(off, 1);
    return out;
}

function encodeSnappyLiteralOnly(plainBuf) {
    const parts = [encodeVarint(plainBuf.length)];
    for (let i = 0; i < plainBuf.length; i += 65536) {
        parts.push(encodeSnappyLiteral(plainBuf.subarray(i, i + 65536)));
    }
    return Buffer.concat(parts);
}

function makeFakeJwt(payload, withHeader = false) {
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    if (withHeader) {
        const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString('base64url');
        return `${headerB64}.${payloadB64}.assinatura_teste`;
    }
    return `${payloadB64}.assinatura_teste`;
}

function makeTempDir(prefix = 'pokebot-headless-') {
    return mkdtempSync(join(tmpdir(), prefix));
}

function buildWriteBatch(entries) {
    const header = Buffer.alloc(12);
    header.writeBigUInt64LE(1n, 0);
    header.writeUInt32LE(entries.length, 8);
    const parts = [header];
    for (const entry of entries) {
        const type = entry.type ?? 1;
        const keyBuf = Buffer.isBuffer(entry.key) ? entry.key : Buffer.from(entry.key);
        parts.push(Buffer.from([type]), encodeVarint(keyBuf.length), keyBuf);
        if (type === 1) {
            const valBuf = Buffer.isBuffer(entry.value) ? entry.value : Buffer.from(entry.value);
            parts.push(encodeVarint(valBuf.length), valBuf);
        }
    }
    return Buffer.concat(parts);
}

function buildWalLog(batches) {
    const records = [];
    for (const batch of batches) {
        const chunkList = Array.isArray(batch) ? batch : [batch];
        if (chunkList.length === 1) {
            const chunk = chunkList[0];
            const hdr = Buffer.alloc(7);
            hdr.writeUInt16LE(chunk.length, 4);
            hdr[6] = 1; // FULL
            records.push(hdr, chunk);
        } else {
            chunkList.forEach((chunk, idx) => {
                const hdr = Buffer.alloc(7);
                hdr.writeUInt16LE(chunk.length, 4);
                hdr[6] = idx === 0 ? 2 : (idx === chunkList.length - 1 ? 4 : 3);
                records.push(hdr, chunk);
            });
        }
    }
    return Buffer.concat(records);
}

function buildDataBlock(entries) {
    const parts = [];
    for (const { key, value } of entries) {
        parts.push(encodeVarint(0), encodeVarint(key.length), encodeVarint(value.length), key, value);
    }
    const trailer = Buffer.alloc(8);
    trailer.writeUInt32LE(0, 0);
    trailer.writeUInt32LE(1, 4);
    parts.push(trailer);
    return Buffer.concat(parts);
}

function wrapSstBlock(rawBlock, compressSnappy) {
    const payload = compressSnappy ? encodeSnappyLiteralOnly(rawBlock) : rawBlock;
    const trailer = Buffer.alloc(5);
    trailer[0] = compressSnappy ? 1 : 0;
    return { full: Buffer.concat([payload, trailer]), payloadSize: payload.length };
}

function buildSstFile(entries, { compressSnappy = false } = {}) {
    const dataRaw = buildDataBlock(entries);
    const dataWrapped = wrapSstBlock(dataRaw, compressSnappy);
    const dataOffset = 0;

    const lastKey = entries[entries.length - 1].key;
    const handleBuf = Buffer.concat([encodeVarint(dataOffset), encodeVarint(dataWrapped.payloadSize)]);
    const indexRaw = buildDataBlock([{ key: lastKey, value: handleBuf }]);
    const indexWrapped = wrapSstBlock(indexRaw, false);
    const indexOffset = dataWrapped.full.length;

    const footer = Buffer.alloc(48);
    const handles = Buffer.concat([
        encodeVarint(0),
        encodeVarint(0),
        encodeVarint(indexOffset),
        encodeVarint(indexWrapped.payloadSize),
    ]);
    handles.copy(footer, 0);
    footer.writeBigUInt64LE(LEVELDB_MAGIC, 40);

    return Buffer.concat([dataWrapped.full, indexWrapped.full, footer]);
}

function makeInternalKey(userKey, valueType = 1, seq = 1n) {
    const trailer = Buffer.alloc(8);
    trailer.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(valueType), 0);
    return Buffer.concat([userKey, trailer]);
}

function makeChromiumKey(origin, keyName, { utf16Key = false } = {}) {
    const originBuf = Buffer.from(`_${origin}`, 'utf8');
    if (utf16Key) {
        return Buffer.concat([originBuf, Buffer.from([0x00, 0x00]), Buffer.from(keyName, 'utf16le')]);
    }
    return Buffer.concat([originBuf, Buffer.from([0x00, 0x01]), Buffer.from(keyName, 'utf8')]);
}

function makeChromiumValue(text, { utf16 = false } = {}) {
    if (utf16) {
        return Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'utf16le')]);
    }
    return Buffer.concat([Buffer.from([0x01]), Buffer.from(text, 'utf8')]);
}

test('snappyDecompress: literais curtos, literais > 60 bytes, copy-1, copy-2, copy-4 e RLE overlap', () => {
    const shortText = Buffer.from('PokeBot-Headless', 'utf8');
    const shortStream = Buffer.concat([encodeVarint(shortText.length), encodeSnappyLiteral(shortText)]);
    assert.deepEqual(snappyDecompress(shortStream), shortText);

    const long75 = Buffer.alloc(75, 0x41);
    long75.write('HEAD-', 0);
    long75.write('-TAIL', 70);
    const long75Stream = Buffer.concat([encodeVarint(long75.length), encodeSnappyLiteral(long75)]);
    assert.deepEqual(snappyDecompress(long75Stream), long75);

    const long300 = Buffer.alloc(300);
    for (let i = 0; i < 300; i++) long300[i] = 65 + (i % 26);
    const long300Stream = Buffer.concat([encodeVarint(long300.length), encodeSnappyLiteral(long300)]);
    assert.deepEqual(snappyDecompress(long300Stream), long300);

    // copy-1 com offset < 256 e copy-1 com offset >= 256 (bits altos em c & 0xe0)
    const block300 = Buffer.from(long300);
    const copy1Expected = Buffer.concat([
        block300,
        block300.subarray(block300.length - 260, block300.length - 260 + 7),
        Buffer.from('END'),
    ]);
    const copy1Stream = Buffer.concat([
        encodeVarint(copy1Expected.length),
        encodeSnappyLiteral(block300),
        encodeSnappyCopy1(7, 260),
        encodeSnappyLiteral(Buffer.from('END')),
    ]);
    assert.deepEqual(snappyDecompress(new Uint8Array(copy1Stream)), copy1Expected);

    // copy-2 e copy-4
    const base = Buffer.from('0123456789ABCDEF', 'utf8');
    const copy24Expected = Buffer.from('0123456789ABCDEF' + '012345' + 'ABCDEF', 'utf8');
    const copy24Stream = Buffer.concat([
        encodeVarint(copy24Expected.length),
        encodeSnappyLiteral(base),
        encodeSnappyCopy2(6, 16),
        encodeSnappyCopy4(6, 12),
    ]);
    assert.deepEqual(snappyDecompress(copy24Stream), copy24Expected);

    // RLE overlap (off < len) com copy-1 (off=2, len=10) e copy-2 (off=1, len=8)
    const rleExpected = Buffer.from('ABABABABABABZZZZZZZZZ', 'utf8');
    const rleStream = Buffer.concat([
        encodeVarint(rleExpected.length),
        encodeSnappyLiteral(Buffer.from('AB', 'utf8')),
        encodeSnappyCopy1(10, 2),
        encodeSnappyLiteral(Buffer.from('Z', 'utf8')),
        encodeSnappyCopy2(8, 1),
    ]);
    assert.deepEqual(snappyDecompress(rleStream), rleExpected);
});

test('snappyDecompress: lanca erro em stream vazio, tipo invalido ou corrompido', () => {
    assert.throws(() => snappyDecompress(Buffer.alloc(0)), /vazio/i);
    assert.throws(() => snappyDecompress('invalido'), TypeError);
    assert.throws(() => snappyDecompress(Buffer.from([0x80])), /truncado/i);
    assert.throws(() => snappyDecompress(Buffer.from([10, (4 << 2) | 0, 1, 2])), /excede|incompleto/i);
    assert.throws(() => snappyDecompress(Buffer.from([8, (0 << 2) | 0, 65, 1])), /copy-1/i);
    assert.throws(() => snappyDecompress(Buffer.from([8, (0 << 2) | 0, 65, 2, 1])), /copy-2/i);
    assert.throws(() => snappyDecompress(Buffer.from([8, (0 << 2) | 0, 65, 3, 1, 0])), /copy-4/i);
    assert.throws(() => snappyDecompress(Buffer.from([5, (0 << 2) | 0, 65, (0 << 2) | 1, 5])), /Offset.*invalido/i);
    assert.throws(() => snappyDecompress(Buffer.from([10, (2 << 2) | 0, 65, 66, 67])), /incompleto/i);
    assert.throws(() => snappyDecompress(Buffer.from([2, (4 << 2) | 0, 65, 66, 67, 68, 69])), /excede/i);
});

test('decodeJwtPayload: decodifica tokens de 2 e 3 partes e rejeita invalidos', () => {
    const p2 = { contaId: 42, nick: 'Red', provedor: 'google', exp: 9_999_999_999_000 };
    assert.deepEqual(decodeJwtPayload(makeFakeJwt(p2, false)), p2);
    assert.deepEqual(decodeJwtPayload(`  ${makeFakeJwt(p2, true)}  `), p2);

    assert.equal(decodeJwtPayload(''), null);
    assert.equal(decodeJwtPayload(null), null);
    assert.equal(decodeJwtPayload('so_uma_parte'), null);
    assert.equal(decodeJwtPayload('a.b.c.d'), null);
    assert.equal(decodeJwtPayload('.sig'), null);
    assert.equal(decodeJwtPayload('@@@.sig'), null);
    assert.equal(
        decodeJwtPayload(`${Buffer.from('[1,2,3]').toString('base64url')}.sig`),
        null
    );
    assert.equal(
        decodeJwtPayload(`${Buffer.from('nao-json').toString('base64url')}.sig`),
        null
    );
});

test('extractSessionFromLevelDbDir: extrai de .log WAL e .ldb, suporta UTF-16LE e ignora outros sites/META:', () => {
    const dir = makeTempDir('pokebot-ldb-');
    try {
        const now = Date.now();
        const validExp = now + 3_600_000;
        const newerExp = now + 7_200_000;
        const realToken = makeFakeJwt({ contaId: 101, provedor: 'discord', exp: validExp });
        const otherSiteToken = makeFakeJwt({ contaId: 999, provedor: 'evil', exp: newerExp });
        const metaToken = makeFakeJwt({ contaId: 888, provedor: 'meta', exp: newerExp });
        const uuid = 'a1b2c3d4-e5f6-4789-abcd-0123456789ef';
        const prefsObj = { preferredBall: 'ultra', targetBalls: 150, autoRevive: true };

        // 1) Diretorio contendo apenas outro site e META: deve retornar null
        const ignoredDir = join(dir, 'ignored');
        mkdirSync(ignoredDir, { recursive: true });
        const ignoredBatch = buildWriteBatch([
            {
                key: makeChromiumKey('https://outrosite.com', 'sessao'),
                value: makeChromiumValue(JSON.stringify({ nick: 'Intruso', token: otherSiteToken })),
            },
            {
                key: Buffer.from('META:https://pokeidle.io\x00\x01sessao', 'utf8'),
                value: makeChromiumValue(JSON.stringify({ nick: 'MetaFake', token: metaToken })),
            },
            {
                key: Buffer.from('METAACCESS:https://pokeidle.io\x00\x01sessao', 'utf8'),
                value: makeChromiumValue(JSON.stringify({ nick: 'MetaAccessFake', token: metaToken })),
            },
        ]);
        writeFileSync(join(ignoredDir, '000001.log'), buildWalLog([ignoredBatch]));
        assert.equal(extractSessionFromLevelDbDir(ignoredDir), null);

        // 2) Diretorio com .log WAL valido (incluindo registro fragmentado e prefs v60 em UTF-16LE)
        const walDir = join(dir, 'wal');
        mkdirSync(walDir, { recursive: true });
        const batchNoise = buildWriteBatch([
            {
                key: makeChromiumKey('https://outrosite.com', 'sessao'),
                value: makeChromiumValue(JSON.stringify({ nick: 'OutroSite', token: otherSiteToken })),
            },
            {
                key: Buffer.from('META:https://pokeidle.io\x00\x01sessao', 'utf8'),
                value: makeChromiumValue(JSON.stringify({ nick: 'MetaEntry', token: metaToken })),
            },
        ]);
        const batchReal = buildWriteBatch([
            {
                key: makeChromiumKey('https://pokeidle.io', 'sessao'),
                value: makeChromiumValue(JSON.stringify({ nick: 'Misty', token: realToken, provedor: 'discord' })),
            },
            {
                key: makeChromiumKey('https://pokeidle.io', 'id-dispositivo'),
                value: makeChromiumValue(uuid, { utf16: true }),
            },
            {
                key: makeChromiumKey('https://pokeidle.io', 'pokeidle_hud_prefs_v60', { utf16Key: true }),
                value: makeChromiumValue(JSON.stringify(prefsObj), { utf16: true }),
            },
        ]);
        const mid = Math.floor(batchReal.length / 2);
        const walBuf = buildWalLog([batchNoise, [batchReal.subarray(0, mid), batchReal.subarray(mid)]]);
        writeFileSync(join(walDir, '000003.log'), walBuf);

        const extractedWal = extractSessionFromLevelDbDir(walDir);
        assert.ok(extractedWal, 'deveria extrair sessao do .log WAL');
        assert.equal(extractedWal.nick, 'Misty');
        assert.equal(extractedWal.token, realToken);
        assert.equal(extractedWal.provedor, 'discord');
        assert.equal(extractedWal.dispositivo, uuid);
        assert.deepEqual(extractedWal.prefs, prefsObj);

        // 3) Diretorio com .ldb SSTable comprimido em Snappy e entrada deletada (valueType = 0) ignorada
        const ldbDir = join(dir, 'sst');
        mkdirSync(ldbDir, { recursive: true });
        const sstToken = makeFakeJwt({ contaId: 202, provedor: 'google', exp: validExp });
        const sstEntries = [
            {
                key: makeInternalKey(makeChromiumKey('https://outrosite.com', 'sessao'), 1, 1n),
                value: makeChromiumValue(JSON.stringify({ nick: 'Outro', token: otherSiteToken })),
            },
            {
                key: makeInternalKey(makeChromiumKey('https://pokeidle.io', 'sessao'), 1, 2n),
                value: makeChromiumValue(JSON.stringify({ nick: 'Brock', token: sstToken })),
            },
            {
                key: makeInternalKey(makeChromiumKey('https://pokeidle.io', 'id-dispositivo'), 1, 3n),
                value: makeChromiumValue(uuid),
            },
            {
                key: makeInternalKey(makeChromiumKey('https://pokeidle.io', 'pokeidle_hud_prefs_v60', { utf16Key: true }), 1, 4n),
                value: makeChromiumValue(JSON.stringify(prefsObj), { utf16: true }),
            },
            {
                key: makeInternalKey(makeChromiumKey('https://pokeidle.io', 'sessao'), 0, 5n),
                value: Buffer.alloc(0),
            },
        ];
        writeFileSync(join(ldbDir, '000005.ldb'), buildSstFile(sstEntries, { compressSnappy: true }));

        const extractedSst = extractSessionFromLevelDbDir(ldbDir);
        assert.ok(extractedSst, 'deveria extrair sessao do .ldb Snappy');
        assert.equal(extractedSst.nick, 'Brock');
        assert.equal(extractedSst.token, sstToken);
        assert.equal(extractedSst.provedor, 'google');
        assert.equal(extractedSst.dispositivo, uuid);
        assert.deepEqual(extractedSst.prefs, prefsObj);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('resolveHeadlessSession & cache: prioridade explicit > env > cache/leveldb e persistencia', () => {
    const dir = makeTempDir('pokebot-session-');
    try {
        const nowMs = 1_760_000_000_000;
        const emptyHome = join(dir, 'empty-home');
        const emptyLocal = join(dir, 'empty-local');
        const ldbDir = join(dir, 'browser-leveldb');
        const cachePath = join(dir, '.pokebot-session.json');
        mkdirSync(emptyHome, { recursive: true });
        mkdirSync(emptyLocal, { recursive: true });
        mkdirSync(ldbDir, { recursive: true });

        const tokenDb = makeFakeJwt({ contaId: 1, provedor: 'google', exp: nowMs + 600_000 });
        const tokenCacheNewer = makeFakeJwt({ contaId: 2, provedor: 'discord', exp: nowMs + 1_200_000 });
        const tokenEnv = makeFakeJwt({ contaId: 3, provedor: 'twitch', exp: nowMs + 1_800_000 });
        const tokenExplicit = makeFakeJwt({ contaId: 4, provedor: 'kick', exp: nowMs + 2_400_000 });
        const devDb = '11111111-1111-4111-8111-111111111111';
        const devCache = '22222222-2222-4222-8222-222222222222';
        const devEnv = '33333333-3333-4333-8333-333333333333';
        const devExplicit = '44444444-4444-4444-8444-444444444444';

        // Sem cache nem leveldb: erro
        assert.throws(
            () => resolveHeadlessSession({
                sessionFile: cachePath,
                cwd: dir,
                homeDir: emptyHome,
                localAppData: emptyLocal,
                env: {},
                nowMs,
            }),
            /Nenhuma sessao valida/i
        );

        // Cria LevelDB sem cache: resolve do leveldb e grava cache .pokebot-session.json
        const logFile = join(ldbDir, '000010.log');
        const batchDb = buildWriteBatch([
            {
                key: makeChromiumKey('https://pokeidle.io', 'sessao'),
                value: makeChromiumValue(JSON.stringify({ nick: 'DbPlayer', token: tokenDb, provedor: 'google' })),
            },
            {
                key: makeChromiumKey('https://pokeidle.io', 'id-dispositivo'),
                value: makeChromiumValue(devDb),
            },
            {
                key: makeChromiumKey('https://pokeidle.io', 'pokeidle_hud_prefs_v60'),
                value: makeChromiumValue(JSON.stringify({ preferredBall: 'great' })),
            },
        ]);
        writeFileSync(logFile, buildWalLog([batchDb]));
        utimesSync(logFile, new Date(nowMs - 5000), new Date(nowMs - 5000));

        const otherAccount = join(dir, 'account2');
        const embeddedDb = join(otherAccount, '.pokebot-browser-profile', 'Default', 'Local Storage', 'leveldb');
        const isolatedOptions = { cwd: otherAccount, env: {}, nowMs, onlyEmbeddedProfile: true };
        assert.throws(() => resolveHeadlessSession(isolatedOptions), /Nenhuma sessao valida/i);
        mkdirSync(embeddedDb, { recursive: true });
        writeFileSync(join(embeddedDb, '000010.log'), buildWalLog([batchDb]));
        assert.equal(resolveHeadlessSession(isolatedOptions).nick, 'DbPlayer');
        assert.equal(loadSessionCache(cachePath), null);

        const fromDb = resolveHeadlessSession({
            cwd: dir,
            sessionFile: cachePath,
            extraDirs: [ldbDir],
            homeDir: emptyHome,
            localAppData: emptyLocal,
            env: {},
            nowMs,
        });
        assert.equal(fromDb.source, 'leveldb');
        assert.equal(fromDb.nick, 'DbPlayer');
        assert.equal(fromDb.token, tokenDb);
        assert.equal(fromDb.dispositivo, devDb);
        assert.deepEqual(fromDb.prefs, { preferredBall: 'great' });

        const savedOnDisk = loadSessionCache(cachePath);
        assert.equal(savedOnDisk.nick, 'DbPlayer');
        assert.equal(savedOnDisk.token, tokenDb);
        assert.equal(savedOnDisk.dispositivo, devDb);

        // Atualiza cache com token mais novo: cache vence leveldb
        saveSessionCache(cachePath, {
            nick: 'CachePlayer',
            token: tokenCacheNewer,
            provedor: 'discord',
            dispositivo: devCache,
            updatedAt: nowMs,
        });
        const fromCache = resolveHeadlessSession({
            cwd: dir,
            sessionFile: cachePath,
            extraDirs: [ldbDir],
            homeDir: emptyHome,
            localAppData: emptyLocal,
            env: {},
            nowMs,
        });
        assert.equal(fromCache.source, 'cache');
        assert.equal(fromCache.nick, 'CachePlayer');
        assert.equal(fromCache.dispositivo, devCache);

        // env vence cache e leveldb
        const fromEnv = resolveHeadlessSession({
            cwd: dir,
            sessionFile: cachePath,
            extraDirs: [ldbDir],
            homeDir: emptyHome,
            localAppData: emptyLocal,
            env: {
                POKEIDLE_NICK: 'EnvPlayer',
                POKEIDLE_TOKEN: tokenEnv,
                POKEIDLE_DISPOSITIVO: devEnv,
            },
            nowMs,
        });
        assert.equal(fromEnv.source, 'env');
        assert.equal(fromEnv.nick, 'EnvPlayer');
        assert.equal(fromEnv.token, tokenEnv);
        assert.equal(fromEnv.dispositivo, devEnv);

        // explicit vence env, cache e leveldb
        const fromExplicit = resolveHeadlessSession({
            cwd: dir,
            nick: 'ExplicitPlayer',
            token: tokenExplicit,
            dispositivo: devExplicit,
            sessionFile: cachePath,
            extraDirs: [ldbDir],
            homeDir: emptyHome,
            localAppData: emptyLocal,
            env: {
                POKEIDLE_NICK: 'EnvPlayer',
                POKEIDLE_TOKEN: tokenEnv,
                POKEIDLE_DISPOSITIVO: devEnv,
            },
            nowMs,
        });
        assert.equal(fromExplicit.source, 'explicit');
        assert.equal(fromExplicit.nick, 'ExplicitPlayer');
        assert.equal(fromExplicit.token, tokenExplicit);
        assert.equal(fromExplicit.provedor, 'kick');
        assert.equal(fromExplicit.dispositivo, devExplicit);

        // loadSessionCache em arquivo ausente ou invalido retorna null
        assert.equal(loadSessionCache(join(dir, 'inexistente.json')), null);
        const badCache = join(dir, 'bad.json');
        writeFileSync(badCache, '[1,2,3]');
        assert.equal(loadSessionCache(badCache), null);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('getSeasonalDayKey e computePassStatus: dia sazonal e regras do Passe Diario (PASSE_NIVEL_MIN = 10)', () => {
    // Dia sazonal vira as 21:00 UTC (00:00 BRT + 3h de antecipacao = -3h deslocamento)
    assert.equal(getSeasonalDayKey(Date.UTC(2026, 10, 21, 20, 59, 59)), '2026-11-21');
    assert.equal(getSeasonalDayKey(Date.UTC(2026, 10, 21, 21, 0, 0)), '2026-11-22');

    // Passe Diario vira as 03:00 UTC (PASSE_FUSO_MS = +3h)
    const beforeReset = Date.UTC(2026, 10, 22, 2, 59, 59);
    const atReset = Date.UTC(2026, 10, 22, 3, 0, 0);
    const dayBefore = computePassStatus({ ultimo: null, degrau: 0 }, 10, beforeReset).hoje;
    const dayAt = computePassStatus({ ultimo: null, degrau: 0 }, 10, atReset).hoje;
    assert.equal(dayAt, dayBefore + 1);

    // Nivel < 10 nao pode resgatar
    const lowLevel = computePassStatus({ ultimo: dayAt - 1, degrau: 3 }, 9, atReset);
    assert.equal(lowLevel.canClaim, false);

    // Nivel >= 10 e ultimo anterior: pode resgatar
    const canFirst = computePassStatus({ ultimo: dayAt - 1, degrau: 3 }, 10, atReset);
    assert.equal(canFirst.jaPegouHoje, false);
    assert.equal(canFirst.canClaim, true);

    // Ja pegou hoje sem VIP: nao pode resgatar
    const alreadyClaimed = computePassStatus({ ultimo: dayAt, degrau: 4, vipAte: atReset - 1000 }, 25, atReset);
    assert.equal(alreadyClaimed.jaPegouHoje, true);
    assert.equal(alreadyClaimed.vipAtivo, false);
    assert.equal(alreadyClaimed.vipPendenteHoje, false);
    assert.equal(alreadyClaimed.canClaim, false);

    // Ja pegou hoje, VIP ativo e ultimoVip != hoje: VIP pendente hoje
    const vipPending = computePassStatus(
        { ultimo: dayAt, degrau: 4, vipAte: atReset + 86_400_000, ultimoVip: dayAt - 1 },
        25,
        atReset
    );
    assert.equal(vipPending.jaPegouHoje, true);
    assert.equal(vipPending.vipAtivo, true);
    assert.equal(vipPending.vipPendenteHoje, true);
    assert.equal(vipPending.canClaim, true);

    // Ja pegou hoje e ultimoVip === hoje: nada pendente
    const vipDone = computePassStatus(
        { ultimo: dayAt, degrau: 4, vipAte: atReset + 86_400_000, ultimoVip: dayAt },
        25,
        atReset
    );
    assert.equal(vipDone.vipAtivo, true);
    assert.equal(vipDone.vipPendenteHoje, false);
    assert.equal(vipDone.canClaim, false);
});

test('createStateMerger: estado cheio inicial e deltas incrementais', () => {
    const merger = createStateMerger();
    assert.equal(merger.getState(), null);

    const init = merger.merge({
        cheio: true,
        gold: 10_000,
        balls: { 1: 20, 2: 5 },
        items: { 200: 15, 205: 2 },
        pokedex: { '1': 1, '4': 1 },
        pokemons: [
            { id: 101, nome: 'Charmander', hp: 100 },
            { id: 102, nome: 'Pidgey', hp: 40 },
        ],
    });
    assert.equal(init.gold, 10_000);
    assert.equal(init.pokemons.length, 2);

    const afterDelta = merger.merge({
        gold: 12_500,
        balls: { 1: 18, 2: 5, 4: 1 },
        items: { 200: 14, 205: 3 },
        pkMud: [
            { id: 101, nome: 'Charmander', hp: 85 },
            { id: 103, nome: 'Pikachu', hp: 60 },
        ],
        pkFora: [102],
        dexMud: { '25': 1 },
        dexFora: ['4'],
    });
    assert.equal(afterDelta.gold, 12_500);
    assert.deepEqual(afterDelta.balls, { 1: 18, 2: 5, 4: 1 });
    assert.deepEqual(afterDelta.items, { 200: 14, 205: 3 });
    assert.deepEqual(afterDelta.pokedex, { '1': 1, '25': 1 });
    assert.deepEqual(
        afterDelta.pokemons.map((p) => p.id).sort(),
        [101, 103]
    );
    assert.equal(afterDelta.pokemons.find((p) => p.id === 101).hp, 85);
});

test('createFieldTracker: reset em applyCampoInit, vivos, caidos, treinadores, fora e ordenacao', () => {
    const t0 = 1_760_000_000_000;
    const tracker = createFieldTracker();

    tracker.applyCampoInit({
        ts: t0,
        mobs: [{ s: 99, n: 'OldMob', nv: 5, x: true, xr: 10_000 }],
    });
    assert.equal(tracker.getFallenCorpses(t0).length, 1);

    // Novo applyCampoInit limpa mobs antigos
    tracker.applyCampoInit({ ts: t0, mobs: [] });
    assert.equal(tracker.getMobs().length, 0);

    tracker.applyCampo({
        ts: t0,
        mobs: [
            { s: 1, n: 'Rattata', nv: 5, x: false, hp: 20, mhp: 20 },
            { s: 2, n: 'Rival', nv: 80, sh: true, tr: true, x: true, xr: 5_000 },
            { s: 3, n: 'Snorlax', nv: 50, x: true, xr: 15_000 },
            { s: 4, n: 'Pidgey', nv: 12, x: true, xr: 4_000 },
            { s: 5, n: 'Caterpie', nv: 20, x: true, xr: 3_000 },
            { s: 6, n: 'Weedle', nv: 20, x: true, xr: 5_000 },
            { s: 7, n: 'Dragonite', nv: 10, sh: true, x: true, xr: 20_000 },
            { s: 8, n: 'Removido', nv: 99, x: true, xr: 10_000 },
        ],
        fora: [8],
    });

    const corpses = tracker.getFallenCorpses(t0);
    // Deve conter apenas s: 7 (shiny), 5 (exp <6s, nv20, 3s), 6 (exp <6s, nv20, 5s), 4 (exp <6s, nv12), 3 (nv50, >=6s)
    assert.deepEqual(
        corpses.map((c) => c.slot),
        [7, 5, 6, 4, 3]
    );
    assert.equal(corpses.some((c) => c.slot === 1 || c.slot === 2 || c.slot === 8), false);

    // Sem priorizar expirando, level maior vence
    assert.deepEqual(
        tracker.getFallenCorpses(t0, false).map((c) => c.slot),
        [7, 3, 5, 6, 4]
    );
});

test('pickHeadlessBallForCorpse e resolveRestockBallId: IDs reais, Shiny, faixas de gold, threshold e fallback', () => {
    assert.deepEqual(BALL_IDS, { POKE: 1, GREAT: 2, SUPER: 3, ULTRA: 4, BEAST: 5 });

    // Shiny com shinyBall: 'best' -> 5 -> 4 -> 3 -> 2 -> 1
    const shinyCorpse = { shiny: true, level: 10 };
    assert.equal(pickHeadlessBallForCorpse(shinyCorpse, { 1: 5, 2: 5, 3: 5, 4: 5, 5: 1 }, { shinyBall: 'best' }), 5);
    assert.equal(pickHeadlessBallForCorpse(shinyCorpse, { 1: 5, 2: 5, 3: 5, 4: 2, 5: 0 }, { shinyBall: 'best' }), 4);
    assert.equal(pickHeadlessBallForCorpse(shinyCorpse, { 1: 5, 2: 5, 3: 2, 4: 0, 5: 0 }, { shinyBall: 'best' }), 3);
    assert.equal(pickHeadlessBallForCorpse(shinyCorpse, { 1: 5, 2: 2, 3: 0, 4: 0, 5: 0 }, { shinyBall: 'best' }), 2);
    assert.equal(pickHeadlessBallForCorpse(shinyCorpse, { 1: 5, 2: 0, 3: 0, 4: 0, 5: 0 }, { shinyBall: 'best' }), 1);

    // Normal com preferredBall: 'auto' respeita faixas de gold sem gastar Beast (5)
    const allBalls = { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 };
    const lowLvCorpse = { shiny: false, level: 15 };
    const cfgAuto = { preferredBall: 'auto', highLevelUltraThreshold: 50 };
    assert.equal(pickHeadlessBallForCorpse(lowLvCorpse, allBalls, cfgAuto, 2_500_000), 4);
    assert.equal(pickHeadlessBallForCorpse(lowLvCorpse, allBalls, cfgAuto, 300_000), 3);
    assert.equal(pickHeadlessBallForCorpse(lowLvCorpse, allBalls, cfgAuto, 50_000), 2);
    assert.equal(pickHeadlessBallForCorpse(lowLvCorpse, allBalls, cfgAuto, 49_999), 1);

    // Normal >= highLevelUltraThreshold usa Ultra (4) mesmo com pouco gold
    assert.equal(pickHeadlessBallForCorpse({ shiny: false, level: 50 }, allBalls, cfgAuto, 1_000), 4);

    // Nunca desperdiça Beast Ball (5) em mob normal no modo auto
    assert.equal(pickHeadlessBallForCorpse(lowLvCorpse, { 5: 50 }, cfgAuto, 5_000_000), null);

    // Fallback de estoque
    assert.equal(pickHeadlessBallForCorpse(lowLvCorpse, { 1: 0, 2: 3, 3: 0, 4: 0 }, cfgAuto, 0), 2);

    // resolveRestockBallId sempre retorna 1..4
    assert.equal(resolveRestockBallId({ preferredBall: 'poke' }, 5_000_000), 1);
    assert.equal(resolveRestockBallId({ preferredBall: 'great' }, 0), 2);
    assert.equal(resolveRestockBallId({ preferredBall: 'super' }, 0), 3);
    assert.equal(resolveRestockBallId({ preferredBall: 'ultra' }, 0), 4);
    assert.equal(resolveRestockBallId({ preferredBall: 'beast' }, 0), 4);
    assert.equal(resolveRestockBallId({ preferredBall: 'auto' }, 2_500_000), 4);
    assert.equal(resolveRestockBallId({ preferredBall: 'auto' }, 300_000), 3);
    assert.equal(resolveRestockBallId({ preferredBall: 'auto' }, 50_000), 2);
    assert.equal(resolveRestockBallId({ preferredBall: 'auto' }, 10_000), 1);
});

test('evaluateHeadlessTick: auto.set, mistico.bola, ball.throw (VIP/sem VIP), shop.buy, centro.curar, passe e prey', () => {
    const nowMs = Date.UTC(2026, 10, 22, 12, 0, 0);
    const dia = getSeasonalDayKey(nowMs);

    assert.deepEqual(DEFAULT_BALL_PRICES, { 1: 5, 2: 20, 3: 50, 4: 130 });
    assert.equal(DEFAULT_ITEM_PRICES[ITEM_IDS.SMALL_POTION], 50);
    assert.equal(DEFAULT_ITEM_PRICES[ITEM_IDS.REVIVE], 600);

    // 1) auto.set + mistico.bola [5,4,3,2,1] + ball.throw sem VIP + centro.curar + hunt.select + passe.resgatar + prey.roletar
    const field1 = createFieldTracker();
    field1.applyCampoInit({
        ts: nowMs,
        mobs: [
            { s: 2, n: 'Zubat', nv: 12, x: true, xr: 9_000 },
            { s: 5, n: 'Pikachu', nv: 8, sh: true, x: true, xr: 15_000 },
        ],
    });
    const tracker1 = { lastHuntSlug: 'caverna-cerulean' };
    const actions1 = evaluateHeadlessTick({
        nowMs,
        field: field1,
        tracker: tracker1,
        config: {
            preferredBall: 'auto',
            shinyBall: 'best',
            restockEnabled: false,
        },
        state: {
            level: 15,
            gold: 10_000,
            noCentro: true,
            centroLivreEm: nowMs - 100,
            balls: { 1: 5, 4: 2, 5: 1 },
            mistico: { prazo: nowMs + 30_000 },
            passe: { ultimo: 0, degrau: 0 },
            loja: { vip: false },
            automation: {
                autoBallSemParar: false,
                autoRevive: false,
                autoPotion: true,
                autoVoltarHunt: false,
                prey: { dia: '2026-11-21', cartelas: [null, null] },
            },
        },
    });

    const autoAct = actions1.find((a) => a.t === 'auto.set');
    assert.ok(autoAct);
    assert.equal(autoAct.autoRevive, true);
    assert.equal(autoAct.autoPotion, true);
    assert.equal(autoAct.autoVoltarHunt, true);

    assert.deepEqual(actions1.find((a) => a.t === 'mistico.bola'), { t: 'mistico.bola', ballId: 5 });
    assert.deepEqual(actions1.find((a) => a.t === 'ball.throw'), { t: 'ball.throw', ballId: 5, slot: 5 });
    assert.deepEqual(actions1.find((a) => a.t === 'centro.curar'), { t: 'centro.curar' });
    assert.deepEqual(actions1.find((a) => a.t === 'hunt.select'), { t: 'hunt.select', slug: 'caverna-cerulean' });
    assert.deepEqual(actions1.find((a) => a.t === 'passe.resgatar'), { t: 'passe.resgatar' });
    assert.deepEqual(actions1.find((a) => a.t === 'prey.roletar'), {
        t: 'prey.roletar',
        cartela: 0,
        categoria: 'tudo',
        dia,
    });

    // 2) VIP + autoBallSemParar nao lanca manualmente em mob normal, mas lanca em shiny
    const field2 = createFieldTracker();
    field2.applyCampoInit({
        ts: nowMs,
        mobs: [{ s: 3, n: 'Rattata', nv: 10, sh: false, x: true, xr: 10_000 }],
    });
    const actionsVipNormal = evaluateHeadlessTick({
        nowMs,
        field: field2,
        tracker: {},
        config: { restockEnabled: false, dailyPassEnabled: false, preyEnabled: false },
        state: {
            gold: 100_000,
            balls: { 1: 10, 4: 10 },
            loja: { vip: true },
            automation: { autoBallSemParar: true, autoRevive: true, autoPotion: true, autoVoltarHunt: true },
        },
    });
    assert.equal(actionsVipNormal.some((a) => a.t === 'ball.throw'), false);

    field2.applyCampo({
        ts: nowMs,
        mobs: [{ s: 4, n: 'Eevee', nv: 10, sh: true, x: true, xr: 10_000 }],
    });
    const actionsVipShiny = evaluateHeadlessTick({
        nowMs,
        field: field2,
        tracker: {},
        config: { restockEnabled: false, dailyPassEnabled: false, preyEnabled: false },
        state: {
            gold: 100_000,
            balls: { 1: 10, 4: 10, 5: 0 },
            loja: { vip: true },
            automation: { autoBallSemParar: true, autoRevive: true, autoPotion: true, autoVoltarHunt: true },
        },
    });
    assert.deepEqual(actionsVipShiny.find((a) => a.t === 'ball.throw'), { t: 'ball.throw', ballId: 4, slot: 4 });

    // 3) shop.buy respeita minGoldReserve e precos reais + prey.escolher prioriza catalog.huntSpeciesId
    // Gold = 51.000, reserve = 50.000 -> disponivel = 1.000.
    // Precisa de Poke Ball (id=1, price=5, min=25, target=100, cur=5 -> deficit=95 -> custo=475 -> sobra 525)
    // Precisa de Small Potion (id=200, price=50, min=20, target=50, cur=10 -> deficit=40, mas 525/50 = 10 -> custo=500 -> sobra 25)
    // Precisa de Revive (id=205, price=600, min=10, target=20, cur=0 -> 25/600 = 0 -> nao compra!)
    const actionsShopPrey = evaluateHeadlessTick({
        nowMs,
        field: null,
        tracker: {},
        catalog: { huntSpeciesId: 133 },
        config: {
            preferredBall: 'poke',
            minGoldReserve: 50_000,
            minBalls: 25,
            targetBalls: 100,
            minPotions: 20,
            targetPotions: 50,
            minRevives: 10,
            targetRevives: 20,
            restockSmallPotion: true,
            restockRevive: true,
            dailyPassEnabled: false,
        },
        state: {
            gold: 51_000,
            balls: { 1: 5 },
            items: { 200: 10, 205: 0 },
            automation: {
                autoRevive: true,
                autoPotion: true,
                autoVoltarHunt: true,
                preyCartela2: 1,
                prey: {
                    dia,
                    cartelas: [
                        { pk: 25, lista: [25, 16] },
                        { pk: null, lista: [16, 133, 19] },
                    ],
                },
            },
        },
    });

    const buys = actionsShopPrey.filter((a) => a.t === 'shop.buy');
    assert.deepEqual(buys, [
        { t: 'shop.buy', kind: 'ball', id: 1, qty: 95 },
        { t: 'shop.buy', kind: 'item', id: 200, qty: 10 },
    ]);
    assert.deepEqual(actionsShopPrey.find((a) => a.t === 'prey.escolher'), {
        t: 'prey.escolher',
        cartela: 1,
        dia,
        pk: 133,
    });
});

test('parseCliArgs: analisa todas as flags, valores com = e limites minimos', () => {
    assert.deepEqual(parseCliArgs([]), {
        checkSession: false,
        nick: null,
        token: null,
        dispositivo: null,
        sessionFile: null,
        hunt: null,
        economy: 'auto',
        pingOnly: false,
        standby: false,
        standbySec: 180,
        durationSec: 0,
        statusIntervalSec: 15,
        help: false,
    });

    const full = parseCliArgs([
        '--check-session',
        '--nick', 'Red',
        '--token=tok.abc',
        '--dispositivo', 'uuid-123',
        '--session-file', './sess.json',
        '--hunt=floresta-viridian',
        '--economy',
        '--standby',
        '--standby-sec', '60',
        '--duration', '12',
        '--status-interval=5',
        '--help',
    ]);
    assert.deepEqual(full, {
        checkSession: true,
        nick: 'Red',
        token: 'tok.abc',
        dispositivo: 'uuid-123',
        sessionFile: './sess.json',
        hunt: 'floresta-viridian',
        economy: 'on',
        pingOnly: false,
        standby: true,
        standbySec: 60,
        durationSec: 12,
        statusIntervalSec: 5,
        help: true,
    });

    const dryNoEco = parseCliArgs([
        '--dry-run',
        '--no-economy',
        '--standby-sec', '1',
        '--status-interval', '0',
        '--duration', '-5',
    ]);
    assert.equal(dryNoEco.checkSession, true);
    assert.equal(dryNoEco.economy, 'off');
    assert.equal(dryNoEco.standbySec, 5);
    assert.equal(dryNoEco.statusIntervalSec, 1);
    assert.equal(dryNoEco.durationSec, 0);
});

test('createHeadlessController e startGuiServer: expoe dashboard, /api/status e /api/action com mock WS', async () => {
    const dir = makeTempDir('pokebot-gui-');
    try {
        const sentFrames = [];
        let fakeWs = null;
        const fakeToken = makeFakeJwt({ nick: 'GuiTrainer', contaId: 77, provedor: 'google', exp: Date.now() + 3_600_000 });
        const configPath = join(dir, 'headless-config.json');

        let liveCalls = 0;
        let disposedLives = false;
        const controller = createHeadlessController({
            cwd: dir,
            configPath,
            liveRunner: async (ctx, opts) => {
                liveCalls += 1;
                assert.ok(ctx.CONFIG.live.enabled);
                ctx.state.liveStatus.twitch.axtlol = { balance: 400, live: true };
                ctx.state.liveStatus.kick.biscoitao = { balance: 500, live: true };
                ctx.state.stats.liveMinutesWatched += 1;
                if (opts?.force) {
                    ctx.state.stats.liveChestsClaimed += 1;
                    ctx.state.stats.liveRewardsRedeemed += 1;
                    ctx.state.lastActionNote = 'Twitch baú +50 (axtlol) & resgate';
                }
            },
            liveDisposer: () => {
                disposedLives = true;
            },
            resolveSession: () => ({
                nick: 'GuiTrainer',
                token: fakeToken,
                provedor: 'google',
                dispositivo: 'uuid-gui-1',
                prefs: { targetBalls: 80, liveTwitchToken: 'secret-tw-tok', liveRewardType: 'shiny' },
                payload: { nick: 'GuiTrainer', contaId: 77, provedor: 'google', exp: Date.now() + 3_600_000 },
                source: 'mock',
                cachePath: join(dir, 'sess.json'),
            }),
            wsFactory: () => {
                fakeWs = {
                    readyState: 1,
                    sent: sentFrames,
                    send(raw) { sentFrames.push(JSON.parse(raw)); },
                    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); },
                };
                queueMicrotask(() => {
                    fakeWs.onopen?.();
                    fakeWs.onmessage?.({
                        data: JSON.stringify({
                            t: 'welcome',
                            hunts: [{ slug: 'pinsir', nome: 'Pinsir', nivel: 90, especies: [{ pokeId: 127, nome: 'Pinsir', pontos: 10 }] }],
                            catalogoBolas: [{ id: 1, nome: 'Poke Ball', priceGold: 5 }],
                            estado: {
                                cheio: true,
                                nick: 'GuiTrainer',
                                level: 95,
                                gold: 500_000,
                                huntSlug: 'pinsir',
                                activeId: 10,
                                balls: { 1: 45 },
                                items: { 200: 30, 205: 12 },
                                automation: { autoRevive: true, autoPotion: true, autoVoltarHunt: true },
                                pokemons: [{ id: 10, speciesId: 6, nome: 'Charizard', level: 95, hp: 900, maxHp: 1200, shiny: false }],
                            },
                        }),
                    });
                    fakeWs.onmessage?.({
                        data: JSON.stringify({
                            t: 'batalha',
                            ev: [{ k: 'morte', quem: 'selvagem', xpPokemon: 5000, ouro: 450 }],
                        }),
                    });
                });
                return fakeWs;
            },
        });

        const srv = await startGuiServer({ port: 0, host: '127.0.0.1', controller, autoStart: true });
        try {
            await new Promise((r) => setTimeout(r, 40));

            const htmlRes = await fetch(`${srv.url}/`);
            assert.equal(htmlRes.status, 200);
            const html = await htmlRes.text();
            assert.match(html, /Nexo PokeBot/);
            assert.match(html, /Auto-Lives/);

            const statusRes = await fetch(`${srv.url}/api/status`);
            assert.equal(statusRes.status, 200);
            const snap = await statusRes.json();
            assert.equal(snap.status, 'connected');
            assert.equal(snap.trainer.nick, 'GuiTrainer');
            assert.equal(snap.trainer.gold, 500_000);
            assert.equal(snap.activePokemon.name, 'Charizard');
            assert.equal(snap.activePokemon.hpPercent, 75);
            assert.equal(snap.stats.kills, 1);
            assert.equal(snap.stats.xpGained, 5000);
            assert.equal(snap.session.token, undefined, 'nunca vaza JWT bruto no /api/status');
            assert.equal(snap.config.liveTwitchToken, undefined, 'nunca vaza token Twitch no /api/status');
            assert.equal(snap.lives.hasTwitchToken, true);
            assert.equal(snap.lives.rewardType, 'shiny');
            assert.ok(liveCalls >= 1);

            const liveActionRes = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'run-lives' }),
            });
            const liveJson = await liveActionRes.json();
            assert.equal(liveJson.ok, true);
            assert.equal(liveJson.snapshot.lives.chestsClaimed, 1);
            assert.equal(liveJson.snapshot.lives.rewardsRedeemed, 1);
            assert.equal(liveJson.snapshot.lives.twitch.axtlol.balance, 400);

            const cfgRes = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set-config', config: { targetBalls: 250, economyMode: 'on' } }),
            });
            const cfgJson = await cfgRes.json();
            assert.equal(cfgJson.ok, true);
            assert.equal(cfgJson.snapshot.config.targetBalls, 250);
            assert.ok(sentFrames.some((f) => f.t === 'cliente.economia' && f.ativo === true));

            const pauseRes = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'pause' }),
            });
            const pauseJson = await pauseRes.json();
            assert.equal(pauseJson.snapshot.status, 'paused');
        } finally {
            await srv.close();
            assert.equal(disposedLives, true);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('headless login-twitch, login-kick, login-pokeidle e syncCookiesToConfig salvam credenciais sem copiar token', async () => {
    const dir = makeTempDir('pokebot-oauth-');
    try {
        let persistedCount = 0;
        const fakeCtx = {
            CONFIG: {
                live: { twitchToken: '', twitchDeviceId: '', kickToken: '' },
            },
            persistPrefs: () => { persistedCount += 1; },
            net: {
                readCookie: async (_domain, name) => {
                    if (name === 'auth-token') return 'tw_cookie_auto';
                    if (name === 'unique_id') return 'tw_dev_123';
                    if (name === 'session_token') return '999%7Ckick_cookie_auto';
                    return null;
                },
            },
        };
        const synced = await syncCookiesToConfig(fakeCtx);
        assert.equal(synced.twitchToken, 'tw_cookie_auto');
        assert.equal(synced.kickToken, '999|kick_cookie_auto');
        assert.equal(fakeCtx.CONFIG.live.twitchToken, 'tw_cookie_auto');
        assert.equal(fakeCtx.CONFIG.live.kickToken, '999|kick_cookie_auto');
        assert.equal(persistedCount, 1);

        const launched = [];
        const newJwt = makeFakeJwt({ nick: 'OAuthTrainer', contaId: 99, provedor: 'google', exp: Date.now() + 3_600_000 });
        const initJwt = makeFakeJwt({ nick: 'InitTrainer', contaId: 88, provedor: 'google', exp: Date.now() + 3_600_000 });
        let currentNick = 'InitTrainer';
        let currentToken = initJwt;

        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, 'cfg.json'),
            sessionFile: join(dir, '.pokebot-session.json'),
            disableBrowserProfileSync: true,
            liveRunner: async () => {},
            liveDisposer: () => {},
            resolveSession: () => ({
                nick: currentNick,
                token: currentToken,
                provedor: 'google',
                dispositivo: 'uuid-oauth',
                prefs: {},
                payload: { nick: currentNick, contaId: 99, provedor: 'google', exp: Date.now() + 3_600_000 },
                source: 'mock',
                cachePath: join(dir, '.pokebot-session.json'),
            }),
            wsFactory: () => {
                const ws = { readyState: 1, send() {}, close() { this.readyState = 3; } };
                queueMicrotask(() => {
                    ws.onopen?.();
                    ws.onmessage?.({
                        data: JSON.stringify({
                            t: 'welcome',
                            hunts: [],
                            catalogoBolas: [],
                            estado: { cheio: true, nick: currentNick, level: 50, gold: 1000, pokemons: [] },
                        }),
                    });
                });
                return ws;
            },
            loginLauncher: async (provider, opts) => {
                launched.push(provider);
                if (provider === 'twitch') return { provider: 'twitch', twitchToken: 'tw_cdp_tok', twitchDeviceId: 'dev_tw' };
                if (provider === 'kick') return { provider: 'kick', kickToken: 'kk_cdp_tok' };
                if (provider === 'pokeidle') {
                    assert.equal(opts.interactive, true);
                    assert.equal(opts.previousNick, 'InitTrainer');
                    currentNick = 'OAuthTrainer';
                    currentToken = newJwt;
                    return { provider: 'pokeidle', nick: 'OAuthTrainer', token: newJwt, provedor: 'google', dispositivo: 'uuid-oauth' };
                }
                return null;
            },
        });

        const srv = await startGuiServer({ port: 0, host: '127.0.0.1', controller, autoStart: true });
        try {
            await new Promise((r) => setTimeout(r, 30));
            const crossOrigin = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login-pokeidle' }),
            });
            assert.equal(crossOrigin.status, 403);
            assert.deepEqual(launched, []);

            for (const act of ['login-twitch', 'login-kick', 'login-pokeidle']) {
                const res = await fetch(`${srv.url}/api/action`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: act, interactive: true }),
                });
                const j = await res.json();
                assert.equal(j.ok, true);
                await new Promise((r) => setTimeout(r, 30));
            }

            assert.deepEqual(launched, ['twitch', 'kick', 'pokeidle']);
            const snap = await (await fetch(`${srv.url}/api/status`)).json();
            assert.equal(snap.lives.hasTwitchToken, true);
            assert.equal(snap.lives.hasKickToken, true);
            assert.equal(snap.trainer.nick, 'OAuthTrainer');
            assert.equal(snap.config.liveMaxTwitchSlots, 4);
            assert.equal(snap.config.liveMaxKickSlots, 2);

            const upRes = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'set-config',
                    config: { liveMaxTwitchSlots: 6, liveMaxKickSlots: 3 },
                }),
            });
            assert.equal((await upRes.json()).ok, true);
            const snap2 = await (await fetch(`${srv.url}/api/status`)).json();
            assert.equal(snap2.config.liveMaxTwitchSlots, 6);
            assert.equal(snap2.config.liveMaxKickSlots, 3);
            assert.equal(snap2.lives.maxTwitchSlots, 6);
            assert.equal(snap2.lives.maxKickSlots, 3);

            const pingRes = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set-config', config: { economyPingOnly: true } }),
            });
            assert.equal((await pingRes.json()).ok, true);
            const snap3 = await (await fetch(`${srv.url}/api/status`)).json();
            assert.equal(snap3.config.economyPingOnly, true);
        } finally {
            await srv.close();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('desktop: captura direta do navegador ativo via DevToolsActivePort (sem Browser.close)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-cdp-active-'));
    const wsSockets = new Set();
    let currentCookies = [
        { domain: '.twitch.tv', name: 'auth-token', value: 'tw_active_tok' },
        { domain: '.twitch.tv', name: 'unique_id', value: 'tw_active_dev' },
        { domain: '.kick.com', name: 'session_token', value: '12345%7Ckick_active_tok' },
    ];
    let currentTargets = [];
    const commands = [];
    let browserClosed = false;

    const sendWsJson = (socket, obj) => {
        const payload = Buffer.from(JSON.stringify(obj), 'utf8');
        let header;
        if (payload.length < 126) {
            header = Buffer.from([0x81, payload.length]);
        } else {
            header = Buffer.alloc(4);
            header[0] = 0x81;
            header[1] = 126;
            header.writeUInt16BE(payload.length, 2);
        }
        socket.write(Buffer.concat([header, payload]));
    };

    const server = createHttpServer();
    server.on('upgrade', (req, socket) => {
        const key = req.headers['sec-websocket-key'];
        const accept = createHash('sha1')
            .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
            .digest('base64');
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n'
            + 'Upgrade: websocket\r\n'
            + 'Connection: Upgrade\r\n'
            + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        wsSockets.add(socket);
        let buf = Buffer.alloc(0);

        socket.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            while (buf.length >= 2) {
                const opcode = buf[0] & 0x0f;
                const masked = (buf[1] & 0x80) !== 0;
                let len = buf[1] & 0x7f;
                let offset = 2;
                if (len === 126) {
                    if (buf.length < 4) return;
                    len = buf.readUInt16BE(2);
                    offset = 4;
                }
                const maskLen = masked ? 4 : 0;
                if (buf.length < offset + maskLen + len) return;
                let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
                if (masked) {
                    const mask = buf.subarray(offset, offset + 4);
                    const unmasked = Buffer.alloc(len);
                    for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ mask[i % 4];
                    payload = unmasked;
                }
                buf = buf.subarray(offset + maskLen + len);

                if (opcode === 8) {
                    socket.end();
                    return;
                }
                if (opcode !== 1) continue;

                const msg = JSON.parse(payload.toString('utf8'));
                commands.push({ method: msg.method, params: msg.params || {} });

                if (msg.method === 'Storage.getCookies') {
                    sendWsJson(socket, { id: msg.id, result: { cookies: currentCookies } });
                } else if (msg.method === 'Target.createTarget') {
                    currentTargets = [{ targetId: 'tab-login-1', type: 'page', url: msg.params?.url || '' }];
                    setTimeout(() => {
                        currentCookies = [{ domain: '.kick.com', name: 'session_token', value: '999%7Ckick_new_tok' }];
                    }, 60);
                    sendWsJson(socket, { id: msg.id, result: { targetId: 'tab-login-1' } });
                } else if (msg.method === 'Target.getTargets') {
                    sendWsJson(socket, { id: msg.id, result: { targetInfos: currentTargets } });
                } else if (msg.method === 'Target.closeTarget') {
                    currentTargets = currentTargets.filter((t) => t.targetId !== msg.params?.targetId);
                    sendWsJson(socket, { id: msg.id, result: { success: true } });
                } else if (msg.method === 'Browser.close') {
                    browserClosed = true;
                    sendWsJson(socket, { id: msg.id, result: {} });
                } else {
                    sendWsJson(socket, { id: msg.id, result: {} });
                }
            }
        });
        socket.once('close', () => {
            wsSockets.delete(socket);
        });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
        writeFileSync(join(dir, 'DevToolsActivePort'), `${port}\n/devtools/browser/mock-active\n`, 'utf8');

        const foundDirs = discoverBrowserUserDataDirs({ extraUserDataDirs: [dir], onlyExtraUserDataDirs: true });
        assert.deepEqual(foundDirs, [dir]);

        const silent = await trySilentProfileCookieSync({ extraUserDataDirs: [dir], onlyExtraUserDataDirs: true });
        assert.equal(silent.twitchToken, 'tw_active_tok');
        assert.equal(silent.twitchDeviceId, 'tw_active_dev');
        assert.equal(silent.kickToken, '12345|kick_active_tok');
        assert.equal(silent.fromActiveBrowser, true);
        assert.equal(commands.some((c) => c.method === 'Target.createTarget'), false);

        const immediateTw = await openInteractiveLogin('twitch', { extraUserDataDirs: [dir], onlyExtraUserDataDirs: true });
        assert.equal(immediateTw.twitchToken, 'tw_active_tok');
        assert.equal(immediateTw.fromActiveBrowser, true);
        assert.equal(commands.some((c) => c.method === 'Target.createTarget'), false);

        const interactiveKk = await openInteractiveLogin('kick', {
            extraUserDataDirs: [dir],
            onlyExtraUserDataDirs: true,
            pollIntervalMs: 40,
            timeoutMs: 3000,
            interactive: true,
            previousToken: '12345|kick_active_tok',
        });
        assert.equal(interactiveKk.kickToken, '999|kick_new_tok');
        assert.equal(interactiveKk.fromActiveBrowser, true);
        assert.equal(commands.some((c) => c.method === 'Target.createTarget' && c.params.url === 'https://kick.com' && c.params.newWindow), true);
        assert.equal(commands.some((c) => c.method === 'Target.closeTarget' && c.params.targetId === 'tab-login-1'), true);
        assert.equal(browserClosed, false);
    } finally {
        for (const s of wsSockets) s.destroy();
        await new Promise((resolve) => server.close(resolve));
        rmSync(dir, { recursive: true, force: true });
    }
});

test('desktop: bridge CDP acopla na tela vinculada, recebe campo e dispara Auto-Catch sem Browser.close', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-cdp-bridge-'));
    const wsSockets = new Set();
    const sentGameFrames = [];
    let browserClosed = false;
    let activeSocket = null;

    const sendWsJson = (socket, obj) => {
        const payload = Buffer.from(JSON.stringify(obj), 'utf8');
        let header;
        if (payload.length < 126) {
            header = Buffer.from([0x81, payload.length]);
        } else {
            header = Buffer.alloc(4);
            header[0] = 0x81;
            header[1] = 126;
            header.writeUInt16BE(payload.length, 2);
        }
        socket.write(Buffer.concat([header, payload]));
    };

    const server = createHttpServer();
    server.on('upgrade', (req, socket) => {
        const key = req.headers['sec-websocket-key'];
        const accept = createHash('sha1')
            .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
            .digest('base64');
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n'
            + 'Upgrade: websocket\r\n'
            + 'Connection: Upgrade\r\n'
            + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        activeSocket = socket;
        wsSockets.add(socket);
        let buf = Buffer.alloc(0);

        socket.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            while (buf.length >= 2) {
                const opcode = buf[0] & 0x0f;
                const masked = (buf[1] & 0x80) !== 0;
                let len = buf[1] & 0x7f;
                let offset = 2;
                if (len === 126) {
                    if (buf.length < 4) return;
                    len = buf.readUInt16BE(2);
                    offset = 4;
                }
                const maskLen = masked ? 4 : 0;
                if (buf.length < offset + maskLen + len) return;
                let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
                if (masked) {
                    const mask = buf.subarray(offset, offset + 4);
                    const unmasked = Buffer.alloc(len);
                    for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ mask[i % 4];
                    payload = unmasked;
                }
                buf = buf.subarray(offset + maskLen + len);

                if (opcode === 8) {
                    socket.end();
                    return;
                }
                if (opcode !== 1) continue;

                const msg = JSON.parse(payload.toString('utf8'));
                if (msg.method === 'Target.getTargets') {
                    sendWsJson(socket, {
                        id: msg.id,
                        result: { targetInfos: [{ targetId: 'poke-tab-1', type: 'page', url: 'https://pokeidle.io/app' }] },
                    });
                } else if (msg.method === 'Target.attachToTarget') {
                    sendWsJson(socket, { id: msg.id, result: { sessionId: 'sess-poke-1' } });
                } else if (msg.method === 'Runtime.evaluate') {
                    const expr = String(msg.params?.expression || '');
                    const m = expr.match(/ws\.send\((.*)\); return true/);
                    if (m) {
                        sentGameFrames.push(JSON.parse(JSON.parse(m[1])));
                        sendWsJson(socket, { id: msg.id, result: { result: { value: true } } });
                    } else {
                        sendWsJson(socket, { id: msg.id, result: { result: { value: { hooked: true, hasWs: true } } } });
                    }
                } else if (msg.method === 'Browser.close') {
                    browserClosed = true;
                    sendWsJson(socket, { id: msg.id, result: {} });
                } else {
                    sendWsJson(socket, { id: msg.id, result: {} });
                }
            }
        });
        socket.once('close', () => wsSockets.delete(socket));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
        writeFileSync(join(dir, 'DevToolsActivePort'), `${port}\n/devtools/browser/mock-bridge\n`, 'utf8');
        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, 'cfg.json'),
            sessionFile: join(dir, 'sess.json'),
            disableBrowserProfileSync: true,
            liveRunner: async () => {},
            liveDisposer: () => {},
            browserBridgeFactory: (opts) => createCdpBrowserBridge({
                ...opts,
                extraUserDataDirs: [dir],
                onlyExtraUserDataDirs: true,
                preferNewTarget: false,
                autoReloadIfMissedWs: false,
            }),
            resolveSession: () => ({
                nick: 'BridgeUser',
                token: makeFakeJwt({ nick: 'BridgeUser', contaId: 1, provedor: 'google', exp: Date.now() + 3_600_000 }),
                provedor: 'google',
                dispositivo: 'uuid-b',
                prefs: {},
                payload: { nick: 'BridgeUser', contaId: 1, provedor: 'google', exp: Date.now() + 3_600_000 },
                source: 'mock',
                cachePath: join(dir, 'sess.json'),
            }),
            wsFactory: () => ({ readyState: 1, send() {}, close() { this.readyState = 3; } }),
        });

        const srv = await startGuiServer({ port: 0, host: '127.0.0.1', controller, autoStart: false });
        try {
            const attachRes = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'attach-browser', preferNewTarget: false }),
            });
            assert.equal((await attachRes.json()).ok, true);
            await new Promise((r) => setTimeout(r, 120));

            assert.ok(activeSocket, 'CDP deve ter conectado');
            sendWsJson(activeSocket, {
                method: 'Network.webSocketFrameReceived',
                sessionId: 'sess-poke-1',
                params: {
                    requestId: 'req-1',
                    response: {
                        opcode: 1,
                        payloadData: JSON.stringify({
                            t: 'welcome',
                            hunts: [],
                            catalogoBolas: [],
                            estado: {
                                cheio: true,
                                nick: 'BridgeUser',
                                level: 50,
                                gold: 100000,
                                balls: { 1: 50, 4: 50 },
                                pokemons: [{ id: 1, speciesId: 6, nome: 'Charizard', level: 50, hp: 200, maxHp: 200 }],
                                activeId: 1,
                            },
                        }),
                    },
                },
            });
            sendWsJson(activeSocket, {
                method: 'Network.webSocketFrameReceived',
                sessionId: 'sess-poke-1',
                params: {
                    requestId: 'req-1',
                    response: {
                        opcode: 1,
                        payloadData: JSON.stringify({
                            t: 'campo',
                            mobs: [{ s: 7, n: 'Pinsir', nv: 40, sh: true, x: true, xr: 5000 }],
                        }),
                    },
                },
            });
            await new Promise((r) => setTimeout(r, 120));

            const snap = await (await fetch(`${srv.url}/api/status`)).json();
            assert.equal(snap.status, 'bridge');
            assert.equal(snap.mode, 'browser-bridge');
            assert.equal(snap.trainer.nick, 'BridgeUser');
            assert.ok(sentGameFrames.some((f) => f.t === 'ball.throw' && f.slot === 7), 'Auto-Catch deve enviar ball.throw pela ponte CDP');
            assert.equal(sentGameFrames.some((f) => f.t === 'cliente.economia'), false, 'Bridge nunca envia cliente.economia para nao congelar o mapa visual');
            assert.equal(browserClosed, false);
        } finally {
            await srv.close();
        }
    } finally {
        for (const s of wsSockets) s.destroy();
        await new Promise((resolve) => server.close(resolve));
        rmSync(dir, { recursive: true, force: true });
    }
});

test('desktop: lista perfis do Chrome, abre login da Conta 2 sem CDP, troca perfil e importa sessao', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-acc2-login-'));
    try {
        const chromeRoot = join(dir, 'Google', 'Chrome', 'User Data');
        mkdirSync(join(chromeRoot, 'Default', 'Local Storage', 'leveldb'), { recursive: true });
        mkdirSync(join(chromeRoot, 'Profile 2', 'Local Storage', 'leveldb'), { recursive: true });
        writeFileSync(join(chromeRoot, 'Local State'), JSON.stringify({
            profile: {
                last_used: 'Default',
                info_cache: {
                    Default: { name: 'Principal' },
                    'Profile 2': { name: 'Secundario' },
                },
            },
        }));

        const listed = listExistingBrowserProfiles('chrome.exe', [chromeRoot]);
        assert.equal(listed.length, 2);
        assert.equal(listed[0].name, 'Default');
        assert.equal(listed[0].label, 'Chrome · Principal (Default)');
        assert.equal(listed[1].name, 'Profile 2');
        assert.equal(listed[1].label, 'Chrome · Secundario (Profile 2)');
        assert.equal(findExistingBrowserProfile('chrome.exe', [chromeRoot], 'Profile 2')?.name, 'Profile 2');

        const account2Dir = join(dir, 'account2');
        const isolatedLevelDb = join(account2Dir, '.pokebot-browser-profile', 'Default', 'Local Storage', 'leveldb');
        mkdirSync(isolatedLevelDb, { recursive: true });

        const nowMs = Date.now();
        const isoToken = makeFakeJwt({ nick: 'ContaDois', contaId: 202, provedor: 'email', exp: nowMs + 3_600_000 });
        const prof2Token = makeFakeJwt({ nick: 'PerfilDois', contaId: 203, provedor: 'google', exp: nowMs + 3_600_000 });
        const importToken = makeFakeJwt({ nick: 'Importado', contaId: 204, provedor: 'google', exp: nowMs + 3_600_000 });
        const expiredToken = makeFakeJwt({ nick: 'Expirado', contaId: 205, provedor: 'google', exp: nowMs - 60_000 });

        assert.equal(parseImportedSessionInput(`'${JSON.stringify({ nick: 'Importado', token: importToken })}'`).nick, 'Importado');
        assert.throws(() => parseImportedSessionInput(JSON.stringify({ nick: 'Expirado', token: expiredToken })), /expirou/i);
        assert.throws(() => parseImportedSessionInput('invalido'), /Cole o JSON/i);

        let silentSyncCalls = 0;
        const launchCalls = [];
        const controller = createHeadlessController({
            cwd: account2Dir,
            configPath: join(account2Dir, '.pokebot-headless-config.json'),
            sessionFile: join(account2Dir, '.pokebot-session.json'),
            isolatedAccount: true,
            useExistingBrowser: false,
            enableBrowserProfilePicker: true,
            browserExecutablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
            browserUserDataRoots: [chromeRoot],
            loginPollIntervalMs: 50,
            loginTimeoutMs: 5_000,
            liveRunner: async () => {},
            liveDisposer: () => {},
            silentCookieSync: async () => { silentSyncCalls += 1; return null; },
            browserLauncher: async (_exe, profileDir, urls, existingProfile, opts) => {
                launchCalls.push({ profileDir, urls, existingProfile, opts });
                if (!existingProfile) {
                    const batch = buildWriteBatch([
                        {
                            key: makeChromiumKey('https://pokeidle.io', 'sessao'),
                            value: makeChromiumValue(JSON.stringify({ nick: 'ContaDois', token: isoToken, provedor: 'email' })),
                        },
                    ]);
                    writeFileSync(join(isolatedLevelDb, '000001.log'), buildWalLog([batch]));
                }
            },
            wsFactory: () => ({ readyState: 1, send() {}, close() { this.readyState = 3; } }),
        });

        const srv = await startGuiServer({ port: 0, host: '127.0.0.1', controller, autoStart: false });
        try {
            // Sem sessao ainda: openConnection nao dispara silentCookieSync antes do loadSession
            assert.equal(controller.start(), false);
            assert.equal(silentSyncCalls, 0);

            // Login da Conta 2 no perfil isolado abre SEM --remote-debugging-port=0 e captura do LevelDB
            const loginRes = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login-pokeidle', interactive: true }),
            });
            assert.equal((await loginRes.json()).ok, true);

            let snap = null;
            for (let i = 0; i < 40; i++) {
                await new Promise((r) => setTimeout(r, 40));
                snap = await (await fetch(`${srv.url}/api/status`)).json();
                if (snap.session?.nick === 'ContaDois') break;
            }
            assert.equal(launchCalls.length, 1);
            assert.equal(launchCalls[0].opts.enableRemoteDebugging, false);
            assert.equal(snap.session?.nick, 'ContaDois');
            assert.equal(snap.status, 'paused');
            assert.ok(snap.browserProfiles.some((p) => p.id === 'Profile 2'));

            // Selecionar Profile 2 do Chrome e importar sessao dele via reload-session
            const prof2Batch = buildWriteBatch([
                {
                    key: makeChromiumKey('https://pokeidle.io', 'sessao'),
                    value: makeChromiumValue(JSON.stringify({ nick: 'PerfilDois', token: prof2Token, provedor: 'google' })),
                },
            ]);
            writeFileSync(join(chromeRoot, 'Profile 2', 'Local Storage', 'leveldb', '000001.log'), buildWalLog([prof2Batch]));

            await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set-config', config: { browserProfile: 'Profile 2' } }),
            });
            const reloadRes = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reload-session' }),
            });
            const reloadJson = await reloadRes.json();
            assert.equal(reloadJson.ok, true);
            assert.equal(reloadJson.snapshot.browserProfile, 'Profile 2');
            assert.equal(reloadJson.snapshot.session?.nick, 'PerfilDois');

            // Importacao direta via JSON colado e rejeicao de token expirado
            const badImport = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'import-session', raw: JSON.stringify({ nick: 'Expirado', token: expiredToken }) }),
            });
            assert.equal(badImport.status, 400);

            const goodImport = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'import-session', raw: JSON.stringify({ nick: 'Importado', token: importToken, dispositivo: 'uuid-imp' }) }),
            });
            assert.equal(goodImport.status, 200);
            const goodJson = await goodImport.json();
            assert.equal(goodJson.ok, true);
            assert.equal(goodJson.snapshot.session?.nick, 'Importado');
            assert.equal(goodJson.snapshot.session?.token, undefined);
        } finally {
            await srv.close();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('hunt guide: escolhe melhor hunt segura quando #1 tem risco de morte e aceita level up', async () => {
    const pokemon = { id: 45, level: 10 };
    globalThis.__pokeidleHunt = {
        carregarJogo: async () => 'jogo',
        calculo: {
            pronto: () => true,
            pkAtivo: () => pokemon,
            opcoes: () => ({ regiao: '' }),
            contexto: (game, pk) => ({ game, pk }),
        },
        engine: {
            analisar: () => ({
                linhas: [
                    { slug: 'perigosa', nome: 'Perigosa', nivel: 30, liberada: true, xpPokemonH: 90_000, umHit: true, mortesH: 2 },
                    { slug: 'segura', nome: 'Segura', nivel: 12, liberada: true, xpPokemonH: 50_000, umHit: false, mortesH: 0 },
                ],
            }),
        },
    };
    try {
        const rec = await readHuntGuideInPage('xp');
        assert.equal(rec.slug, 'segura');
        assert.equal(rec.unsafe, false);
    } finally {
        delete globalThis.__pokeidleHunt;
    }

    const sent = [];
    let frame;
    const controller = createHeadlessController({
        configPath: null,
        disableBrowserProfileSync: true,
        initialConfig: { huntGuideMode: 'auto', targetHuntSlug: 'atual', liveEnabled: false, ensureNativeAutoHeal: false },
        huntGuideIntervalMs: 15,
        resolveSession: () => ({ nick: 'Treinador' }),
        browserBridgeFactory: async (options) => {
            frame = options.onFrame;
            return {
                close() {},
                isReady: () => true,
                send(action) { sent.push(action); return true; },
                // Extensao reporta level 10 enquanto o Pokemon acabou de subir para 11 no WS
                readHuntGuide: async () => ({
                    slug: 'segura', name: 'Segura', level: 12, pokemonId: 2, pokemonLevel: 10, value: 50_000, unsafe: false,
                }),
            };
        },
    });
    const until = async (done) => {
        for (let n = 0; n < 100 && !done(); n++) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.ok(done());
    };
    try {
        controller.attachBrowser({ waitForWelcome: true, seedSession: false });
        await until(() => frame);
        frame(JSON.stringify({
            t: 'welcome', hunts: [{ slug: 'segura', nome: 'Segura', nivel: 12 }],
            estado: { cheio: true, nick: 'Treinador', level: 11, activeId: 2, huntSlug: 'atual', pokemons: [{ id: 2, level: 11 }] },
        }));
        await until(() => sent.some((action) => action.t === 'hunt.select' && action.slug === 'segura'));
        assert.equal(controller.getSnapshot().config.targetHuntSlug, 'segura');
    } finally {
        controller.stop();
    }
});

test('restock: escala limiar proporcional ao alvo, forca no botao manual, respeita potionIds e avisa reserva de gold', async () => {
    assert.equal(resolveRestockPotionId({ automation: { potionIds: [201, 202] } }), 201);
    assert.equal(resolveRestockPotionId({ automation: { potionIds: [200, 201] } }), 200);

    // forceRestock compra mesmo com current >= min (ex.: 100/250) e usa Great Potion (201) se 200 desmarcado
    const forced = evaluateHeadlessTick({
        nowMs: 100_000,
        field: null,
        tracker: {},
        forceRestock: true,
        config: {
            restockEnabled: false,
            preferredBall: 'poke',
            minGoldReserve: 0,
            minBalls: 10,
            targetBalls: 250,
            minPotions: 10,
            targetPotions: 200,
            restockRevive: true,
            minRevives: 5,
            targetRevives: 30,
            dailyPassEnabled: false,
            preyEnabled: false,
            ensureNativeAutoHeal: false,
        },
        state: {
            gold: 100_000,
            balls: { 1: 100 },
            items: { 201: 80, 205: 10 },
            automation: { potionIds: [201, 202], autoRevive: true, autoPotion: true, autoVoltarHunt: true },
        },
    });
    assert.deepEqual(forced, [
        { t: 'shop.buy', kind: 'ball', id: 1, qty: 150 },
        { t: 'shop.buy', kind: 'item', id: 201, qty: 120 },
        { t: 'shop.buy', kind: 'item', id: 205, qty: 20 },
    ]);

    // Conta isolada: padrao minGoldReserve=0, restockRevive=true, limiar proporcional e aviso claro quando reserva bloqueia
    const dir = makeTempDir('pokebot-restock-');
    const sent = [];
    const controller = createHeadlessController({
        cwd: dir,
        configPath: join(dir, '.pokebot-headless-config.json'),
        isolatedAccount: true,
        disableBrowserProfileSync: true,
        liveRunner: async () => {},
        liveDisposer: () => {},
        resolveSession: () => ({
            nick: 'ContaDois',
            token: makeFakeJwt({ nick: 'ContaDois', exp: Date.now() + 3_600_000 }),
            dispositivo: 'uuid-r',
            prefs: {},
            payload: { nick: 'ContaDois', exp: Date.now() + 3_600_000 },
            source: 'mock',
        }),
        wsFactory: () => {
            const ws = {
                readyState: 1,
                send(raw) { sent.push(JSON.parse(raw)); },
                close() { this.readyState = 3; },
            };
            queueMicrotask(() => {
                ws.onopen?.();
                ws.onmessage?.({
                    data: JSON.stringify({
                        t: 'welcome',
                        hunts: [],
                        estado: {
                            cheio: true,
                            nick: 'ContaDois',
                            level: 7,
                            gold: 5_000,
                            balls: { 1: 100 },
                            items: { 200: 50, 205: 5 },
                            automation: { autoRevive: true, autoPotion: true, autoVoltarHunt: true },
                            pokemons: [],
                        },
                    }),
                });
            });
            return ws;
        },
    });
    try {
        assert.equal(controller.getSnapshot().config.minGoldReserve, 0);
        assert.equal(controller.getSnapshot().config.restockRevive, true);
        controller.updateConfig({ targetBalls: 1000, targetPotions: 200, minGoldReserve: 50_000 });
        assert.equal(controller.getSnapshot().config.minBalls, 350);
        assert.equal(controller.getSnapshot().config.minPotions, 70);

        controller.start();
        await new Promise((r) => setTimeout(r, 40));
        // Reserva de 50.000 bloqueia gold de 5.000 -> gera aviso no log no restock manual
        assert.equal(controller.triggerAction('restock'), true);
        assert.equal(sent.some((f) => f.t === 'shop.buy'), false);
        assert.ok(controller.getSnapshot().logs.some((l) => /reserva/i.test(l.text)));

        // Zerando a reserva -> restock manual compra bolas/pocoes/revives imediatamente
        controller.updateConfig({ minGoldReserve: 0 });
        assert.equal(controller.triggerAction('restock'), true);
        assert.ok(sent.some((f) => f.t === 'shop.buy' && f.kind === 'ball' && f.id === 1));
    } finally {
        controller.stop();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('desktop: login Twitch/Kick na Conta 2 usa perfil limpo sem CDP e aceita import-live-tokens', async () => {
    const dir = makeTempDir('pb-live-clean-');
    try {
        const launchCalls = [];
        const cookieCalls = [];
        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, '.pokebot-headless-config.json'),
            sessionFile: join(dir, '.pokebot-session.json'),
            isolatedAccount: true,
            useExistingBrowser: false,
            disableBrowserProfileSync: true,
            browserExecutablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
            liveRunner: async () => {},
            liveDisposer: () => {},
            browserLauncher: async (_exe, profileDir, urls, existingProfile, opts) => {
                launchCalls.push({ profileDir, urls, existingProfile, opts });
                return { exitedQuickly: false };
            },
            cookieReader: async (profileDir) => {
                cookieCalls.push(profileDir);
                return {
                    provider: 'all',
                    twitchToken: 'tw_clean_token',
                    twitchDeviceId: 'tw_dev_clean',
                    kickToken: '999|kick_clean_token',
                };
            },
            resolveSession: () => ({
                nick: 'ContaDois',
                token: makeFakeJwt({ nick: 'ContaDois', exp: Date.now() + 3_600_000 }),
                dispositivo: 'uuid-clean',
                prefs: {},
                payload: { nick: 'ContaDois', exp: Date.now() + 3_600_000 },
                source: 'mock',
            }),
            wsFactory: () => ({ readyState: 1, send() {}, close() { this.readyState = 3; } }),
        });

        const srv = await startGuiServer({ port: 0, host: '127.0.0.1', controller, autoStart: false });
        try {
            const twRes = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login-twitch', interactive: true }),
            });
            assert.equal((await twRes.json()).ok, true);

            let snap = null;
            for (let i = 0; i < 40; i++) {
                await new Promise((r) => setTimeout(r, 40));
                snap = await (await fetch(`${srv.url}/api/status`)).json();
                if (snap.lives.hasTwitchToken) break;
            }
            assert.equal(launchCalls.length, 1);
            assert.ok(launchCalls[0].profileDir.endsWith('.pokebot-live-profile'));
            assert.equal(launchCalls[0].opts.enableRemoteDebugging, false);
            assert.equal(launchCalls[0].opts.waitForExit, true);
            assert.equal(cookieCalls.length, 1);
            assert.equal(snap.lives.hasTwitchToken, true);
            assert.equal(snap.lives.hasKickToken, true);
            assert.equal(snap.config.liveTwitchToken, undefined);
            assert.equal(snap.config.liveKickToken, undefined);

            const emptyRes = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'import-live-tokens', twitchToken: '', kickToken: '' }),
            });
            assert.equal(emptyRes.status, 400);

            const impRes = await fetch(`${srv.url}/api/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'import-live-tokens', twitchToken: 'tw_manual', kickToken: '555%7Ckick_manual' }),
            });
            assert.equal(impRes.status, 200);
            const impJson = await impRes.json();
            assert.equal(impJson.ok, true);
            assert.equal(impJson.snapshot.lives.hasTwitchToken, true);
            assert.equal(impJson.snapshot.lives.hasKickToken, true);
        } finally {
            await srv.close();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('hub: encontra extensao /hunt, roda /hunt em modo headless puro e acopla ponte externa de webview', async () => {
    const dir = makeTempDir('pb-hub-headless-hunt-');
    try {
        // 1) findHuntExtensionDir escolhe a versao mais nova valida
        const extBase = join(dir, 'Chrome', 'User Data', 'Default', 'Extensions', HUNT_EXTENSION_ID);
        for (const ver of ['1.0.20_0', '1.0.23_0']) {
            mkdirSync(join(extBase, ver, 'src'), { recursive: true });
            writeFileSync(join(extBase, ver, 'manifest.json'), '{"name":"/hunt"}');
            for (const f of ['boot.js', 'jogo-bundle.js', 'game.js', 'ritmo.js', 'engine.js']) {
                writeFileSync(join(extBase, ver, 'src', f), '// ok');
            }
        }
        const foundExt = findHuntExtensionDir({
            extensionDir: '',
            extraRoots: [join(dir, 'Chrome', 'User Data')],
            onlyExtraRoots: true,
        });
        assert.ok(foundExt && foundExt.endsWith('1.0.23_0'));

        // 2) /hunt funciona em modo HEADLESS puro (status === 'connected', sem navegador aberto!)
        const sentWs = [];
        const tok = makeFakeJwt({ nick: 'HeadlessHunt', contaId: 501, provedor: 'google', exp: Date.now() + 3_600_000 });
        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, '.pokebot-headless-config.json'),
            sessionFile: join(dir, '.pokebot-session.json'),
            disableBrowserProfileSync: true,
            huntGuideIntervalMs: 15,
            initialConfig: { huntGuideMode: 'auto', huntGuideMetric: 'xp', liveEnabled: false, ensureNativeAutoHeal: false, restockEnabled: false },
            headlessHuntGuide: {
                isAvailable: () => true,
                evaluate: async () => ({
                    slug: 'melhor-headless', name: 'Melhor Headless', level: 25, pokemonId: 7, pokemonLevel: 30, value: 85_000, unsafe: false,
                }),
            },
            resolveSession: () => ({
                nick: 'HeadlessHunt',
                token: tok,
                provedor: 'google',
                dispositivo: 'uuid-hh',
                prefs: {},
                payload: { nick: 'HeadlessHunt', exp: Date.now() + 3_600_000 },
                source: 'mock',
                cachePath: join(dir, '.pokebot-session.json'),
            }),
            wsFactory: () => {
                const ws = {
                    readyState: 1,
                    send(raw) { sentWs.push(JSON.parse(raw)); },
                    close() { this.readyState = 3; },
                };
                queueMicrotask(() => {
                    ws.onopen?.();
                    ws.onmessage?.({
                        data: JSON.stringify({
                            t: 'welcome',
                            hunts: [{ slug: 'melhor-headless', nome: 'Melhor Headless', nivel: 25 }],
                            estado: {
                                cheio: true,
                                nick: 'HeadlessHunt',
                                level: 30,
                                activeId: 7,
                                huntSlug: 'atual',
                                pokemons: [{ id: 7, level: 30, stats: { hp: 100 } }],
                            },
                        }),
                    });
                });
                return ws;
            },
        });
        try {
            assert.equal(controller.start(), true);
            for (let i = 0; i < 60 && !sentWs.some((f) => f.t === 'hunt.select' && f.slug === 'melhor-headless'); i++) {
                await new Promise((r) => setTimeout(r, 15));
            }
            assert.ok(sentWs.some((f) => f.t === 'hunt.select' && f.slug === 'melhor-headless'), 'deve trocar de hunt no modo headless sem navegador');
            assert.equal(controller.getRawSession()?.nick, 'HeadlessHunt');

            // 3) attachExternalBridge (Electron webview) + syncWebviewSession
            const bridgeSent = [];
            const extHooks = controller.attachExternalBridge({
                isReady: () => true,
                send(frame) { bridgeSent.push(frame); return true; },
                readHuntGuide: async () => null,
                close() {},
            });
            assert.ok(extHooks?.onFrame);
            extHooks.onFrame(JSON.stringify({
                t: 'welcome',
                hunts: [{ slug: 'melhor-headless', nome: 'Melhor Headless', nivel: 25 }],
                estado: {
                    cheio: true,
                    nick: 'WebviewUser',
                    level: 40,
                    activeId: 9,
                    huntSlug: 'atual',
                    balls: { 4: 10 },
                    pokemons: [{ id: 9, level: 40 }],
                },
            }));
            extHooks.onFrame(JSON.stringify({
                t: 'campo',
                mobs: [{ s: 3, n: 'Pikachu', nv: 20, sh: true, x: true, xr: 5000 }],
            }));
            assert.equal(controller.getSnapshot().status, 'bridge');
            assert.ok(bridgeSent.some((f) => f.t === 'ball.throw' && f.slot === 3));

            const newTok = makeFakeJwt({ nick: 'WebviewUser', exp: Date.now() + 3_600_000 });
            assert.equal(controller.syncWebviewSession({ nick: 'WebviewUser', token: newTok, dispositivo: 'uuid-wv' }), true);
            assert.equal(controller.getRawSession()?.nick, 'WebviewUser');
            extHooks.onDetach();
            assert.equal(controller.getSnapshot().status, 'paused');
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('desktop: gera icone ICO valido multi-resolucao e compila Nexo PokeBot.exe', () => {
    const ico = buildPokeballIconBuffer();
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1);
    const frameCount = ico.readUInt16LE(4);
    assert.ok(frameCount >= 1, 'ICO deve conter ao menos 1 resolucao');
    assert.ok(ico.length > 6 + 16 * frameCount);

    const out = buildDesktopExecutable();
    assert.ok(out.rootExePath.endsWith('Nexo PokeBot.exe'));
    assert.ok(out.distExePath.endsWith('Nexo PokeBot.exe'));
});

test('potions e lives: escolhe pocoes para auto.set/restock e salva buff por canal no gui-server', () => {
    // 1) resolveRestockPotionId respeita restockPotionId > preferredPotionIds > state.automation.potionIds
    assert.equal(resolveRestockPotionId({ automation: { potionIds: [200] } }, { restockPotionId: 203, preferredPotionIds: [201] }), 203);
    assert.equal(resolveRestockPotionId({ automation: { potionIds: [200] } }, { restockPotionId: 0, preferredPotionIds: [202, 203] }), 202);
    assert.equal(resolveRestockPotionId({ automation: { potionIds: [201, 204] } }, { restockPotionId: 0, preferredPotionIds: [] }), 201);

    // 2) evaluateHeadlessTick envia auto.set com preferredPotionIds e compra a pocao escolhida no restock
    const actions = evaluateHeadlessTick({
        nowMs: 100_000,
        field: null,
        tracker: {},
        config: {
            ensureNativeAutoHeal: true,
            preferredPotionIds: [202, 203],
            restockPotionId: 203,
            restockEnabled: true,
            minGoldReserve: 0,
            targetBalls: 0,
            targetPotions: 20,
            minPotions: 10,
            targetRevives: 0,
            restockRevive: false,
            dailyPassEnabled: false,
            preyEnabled: false,
        },
        state: {
            gold: 100_000,
            balls: { 1: 50 },
            items: { 200: 100, 203: 5 },
            automation: {
                autoRevive: true,
                autoPotion: true,
                autoVoltarHunt: true,
                potionIds: [200],
            },
        },
    });
    const autoSet = actions.find((a) => a.t === 'auto.set');
    assert.deepEqual(autoSet?.potionIds, [202, 203], 'envia potionIds escolhidas ao servidor');
    const potionBuy = actions.find((a) => a.t === 'shop.buy' && a.kind === 'item');
    assert.deepEqual(potionBuy, { t: 'shop.buy', kind: 'item', id: 203, qty: 15 });

    // 3) controller persiste preferredPotionIds, restockPotionId, liveTwitchRewards, liveKickRewards e liveChannelRewards
    const dir = mkdtempSync(join(tmpdir(), 'pokebot-potlive-'));
    try {
        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, 'cfg.json'),
            sessionPath: join(dir, 'sess.json'),
            autoLoadSession: false,
            disableHeadlessHuntGuide: true,
        });
        try {
            const saved = controller.updateConfig({
                preferredPotionIds: [203, 204, 999999],
                restockPotionId: 204,
                liveTwitchRewards: ['xp', 'shiny'],
                liveKickRewards: ['captura'],
                liveRewardTier: 'largest',
                liveChannelRewards: {
                    'twitch:biscoitao': 'shiny',
                    'twitch:tftoddy': 'off',
                    'kick:yetz': 'all',
                    'invalid:key': 'xp',
                },
            });
            assert.deepEqual(saved.preferredPotionIds, [203, 204]);
            assert.equal(saved.restockPotionId, 204);
            assert.deepEqual(saved.liveTwitchRewards, ['xp', 'shiny']);
            assert.deepEqual(saved.liveKickRewards, ['captura']);
            assert.equal(saved.liveRewardTier, 'largest');
            assert.deepEqual(saved.liveChannelRewards, {
                'twitch:biscoitao': 'shiny',
                'twitch:tftoddy': 'off',
                'kick:yetz': 'all',
            });

            const snap = controller.getSnapshot();
            assert.deepEqual(snap.lives.twitchRewards, ['xp', 'shiny']);
            assert.deepEqual(snap.lives.kickRewards, ['captura']);
            assert.equal(snap.lives.rewardTier, 'largest');
            const biscoitao = snap.lives.channels.find((c) => c.key === 'twitch:biscoitao');
            const yetz = snap.lives.channels.find((c) => c.key === 'kick:yetz');
            assert.equal(biscoitao?.override, 'shiny');
            assert.deepEqual(biscoitao?.effectiveKinds, ['shiny']);
            assert.equal(yetz?.override, 'all');
            assert.deepEqual(yetz?.effectiveKinds, ['xp', 'captura', 'shiny']);
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('eco: startMultiAccountDaemon sobe 4 contas em 1 processo unico e encerra limpo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokebot-eco-'));
    try {
        const logs = [];
        const daemon = await startMultiAccountDaemon({
            rootDir: dir,
            accountIds: [1, 2],
            port: 0,
            autoStart: false,
            headlessHuntGuide: null,
            log: (m) => logs.push(m),
        });
        try {
            assert.equal(daemon.accounts.size, 2);
            const acc1 = daemon.accounts.get(1);
            const acc2 = daemon.accounts.get(2);
            assert.ok(acc1.port > 0 && acc2.port > 0 && acc1.port !== acc2.port);
            assert.equal(logs.length, 2);
        } finally {
            await daemon.close();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('telemetria eco: mapeia foco Outland/Unova/Boss/Hunt, contabiliza drops, tempo/abate, cap/abate e lucro liquido', () => {
    assert.deepEqual(resolveHuntFocus({ area: 'outland', nivel: 300 }, null), { focus: 'outland', label: 'Itens (Outland)' });
    assert.deepEqual(resolveHuntFocus({ area: 'unova', nivel: 5200 }, null), { focus: 'unova', label: 'Shiny + Ovo Shiny (Unova)' });
    assert.deepEqual(resolveHuntFocus({ area: 'kanto', nivel: 50 }, { boss: { arena: true } }), { focus: 'boss', label: 'Drops de Boss' });
    assert.deepEqual(resolveHuntFocus({ area: 'kanto', nivel: 50 }, null), { focus: 'hunt', label: 'XP / Gold / Shiny' });

    const dir = mkdtempSync(join(tmpdir(), 'pokebot-drops-'));
    try {
        let fakeNow = 1_700_000_000_000;
        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, 'cfg.json'),
            sessionPath: join(dir, 'sess.json'),
            autoLoadSession: false,
            disableHeadlessHuntGuide: true,
            nowFn: () => fakeNow,
        });
        try {
            const hooks = controller.attachExternalBridge({
                send: () => true,
                close: () => {},
                isReady: () => true,
            }, { waitForWelcome: true });

            hooks.onFrame(JSON.stringify({
                t: 'welcome',
                catalogoBolas: [{ id: 1, preco: 5 }, { id: 4, preco: 130 }],
                itensNossos: [{ id: 200, nome: 'Small Potion', preco: 50 }, { id: 205, nome: 'Revive', preco: 600 }],
                hunts: [{ slug: 'out-charizard', nome: 'Outland Charizard', area: 'outland', nivel: 350 }],
                estado: {
                    cheio: true,
                    nick: 'EcoTester',
                    level: 100,
                    activeId: 1,
                    huntSlug: 'out-charizard',
                    balls: { 1: 50, 4: 50 },
                    items: { 200: 100, 205: 20, 70011: 9 },
                    pokemons: [{ id: 1, level: 100 }],
                },
            }));

            // 4 abates espacados exatamente 2,5s entre si (tempo medio = 2,5s)
            const fireKill = (drops = []) => {
                hooks.onFrame(JSON.stringify({
                    t: 'batalha',
                    ev: [{ k: 'morte', quem: 'selvagem', xpPokemon: 1000, xpTreinador: 500, ouro: 500, drops }],
                }));
            };
            fireKill([{ itemId: 70011, nome: 'Key Fragment', qtd: 2 }]);
            fakeNow += 2500;
            fireKill([{ itemId: 9001, nome: 'Fire Stone', qtd: 1 }]);
            fakeNow += 2500;
            fireKill();
            fakeNow += 2500;
            fireKill();

            // 2 bolas (1 Ultra 130g shiny + 1 Poke 5g), 1 captura, 1 cura (50g), 1 revive (600g), 1 morte do jogador
            hooks.onFrame(JSON.stringify({ t: 'shiny.captura', nick: 'Luna', pokemon: { nome: 'Eevee' }, ovo: true }));
            hooks.onFrame(JSON.stringify({
                t: 'batalha',
                ev: [
                    { k: 'bola', ballId: 4, slot: 1, shiny: true },
                    { k: 'bola', ballId: 1, slot: 2, shiny: false },
                    { k: 'capturado', pokemon: { speciesId: 6, nome: 'Charizard', level: 100, shiny: true } },
                    { k: 'cura', itemId: 200 },
                    { k: 'revive', itemId: 205 },
                    { k: 'morte', quem: 'jogador' },
                ],
            }));

            // drop.raro do proprio jogador (item distinto entra; de outro jogador e ignorado)
            fakeNow += 5000;
            hooks.onFrame(JSON.stringify({ t: 'drop.raro', nick: 'OutroCara', itemId: 70012, nome: 'Shiny Stone Fragment', qtd: 1 }));
            hooks.onFrame(JSON.stringify({ t: 'drop.raro', nick: 'EcoTester', itemId: 70012, nome: 'Shiny Stone Fragment', qtd: 1 }));

            const snap = controller.getSnapshot({ includeHunts: false });
            assert.equal(snap.stats.kills, 4);
            assert.equal(snap.stats.avgKillSec, 2.5);
            assert.equal(snap.stats.capturePerKillPct, 25);
            assert.equal(snap.stats.killsPerCapture, 4);
            assert.equal(snap.stats.ballsPerCapture, 2);
            assert.equal(snap.stats.catchPerBallPct, 50);
            assert.equal(snap.stats.goldGained, 2000);
            assert.equal(snap.stats.spentGold, 785, '130 + 5 + 50 + 600 = 785');
            assert.equal(snap.stats.netGold, 1215, '2000 - 785 = 1215');
            assert.equal(snap.stats.shiniesSeen, 1);
            assert.equal(snap.stats.shiniesCaptured, 1);
            assert.deepEqual(snap.recentShinies.map(({ name, trainer, egg }) => [name, trainer, egg]), [['Eevee', 'Luna', true]]);
            assert.equal(snap.stats.playerDeaths, 1);
            assert.equal(snap.stats.revivesUsed, 1);
            assert.equal(snap.stats.dropsTotal, 4, '2 Key Frag + 1 Fire Stone + 1 Shiny Stone Frag');

            assert.equal(snap.drops.focus, 'outland');
            assert.equal(snap.drops.focusLabel, 'Itens (Outland)');
            const keyFrag = snap.drops.featured.find((d) => d.key === 'fragChave');
            const shinyFrag = snap.drops.featured.find((d) => d.key === 'fragShiny');
            assert.equal(keyFrag?.qty, 2);
            assert.equal(keyFrag?.bagQty, 9);
            assert.equal(shinyFrag?.qty, 1);
            // Por padrao 'stone' vem oculto -> Fire Stone nao aparece enquanto 'stone' esta em dropHideCategories
            assert.equal(snap.drops.featured.find((d) => d.name === 'Fire Stone'), undefined);
            assert.equal(snap.drops.recent[0]?.name, 'Shiny Stone Fragment');

            // Reativando Stones, Fire Stone aparece; ocultando item especifico 'fragChave', Key Fragment some
            controller.updateConfig({ dropHideCategories: [], dropHideItems: ['fragChave'] });
            const snapFiltered = controller.getSnapshot({ includeHunts: false });
            assert.equal(snapFiltered.drops.featured.find((d) => d.name === 'Fire Stone')?.qty, 1);
            assert.equal(snapFiltered.drops.featured.find((d) => d.key === 'fragChave'), undefined);

            // Zerar sessao limpa contadores e drops
            assert.equal(controller.triggerAction('reset-stats'), true);
            const afterReset = controller.getSnapshot({ includeHunts: false });
            assert.equal(afterReset.stats.kills, 0);
            assert.equal(afterReset.stats.dropsTotal, 0);
            assert.equal(afterReset.drops.recent.length, 0);
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('centro medico + troca de hunt: bloqueia durante combate, agenda troca e libera ao zerar contagem', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokebot-center-'));
    try {
        let fakeNow = 1_700_000_100_000;
        const sent = [];
        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, 'cfg.json'),
            sessionPath: join(dir, 'sess.json'),
            autoLoadSession: false,
            disableHeadlessHuntGuide: true,
            nowFn: () => fakeNow,
        });
        try {
            const hooks = controller.attachExternalBridge({
                send: (raw) => { sent.push(typeof raw === 'string' ? JSON.parse(raw) : raw); return true; },
                close: () => {},
                isReady: () => true,
            }, { waitForWelcome: true });

            hooks.onFrame(JSON.stringify({
                t: 'welcome',
                hunts: [
                    { slug: 'hunt-a', nome: 'Hunt A', area: 'kanto', nivel: 10 },
                    { slug: 'hunt-b', nome: 'Hunt B', area: 'kanto', nivel: 20 },
                ],
                estado: {
                    cheio: true,
                    nick: 'CenterTester',
                    level: 50,
                    activeId: 1,
                    huntSlug: 'hunt-a',
                    noCentro: false,
                    servidorAgora: fakeNow,
                    centroLivreEm: fakeNow + 3000,
                    pokemons: [{ id: 1, level: 50, hp: 100, maxHp: 100 }],
                },
            }));

            // Em combate: Centro bloqueado e setHunt agenda em vez de enviar imediatamente
            const lockedSnap = controller.getSnapshot({ includeHunts: false });
            assert.equal(lockedSnap.trainer.combatLockMs, 3000);
            assert.equal(lockedSnap.trainer.canGoCenter, false);
            assert.equal(lockedSnap.trainer.canSwapHunt, false);
            assert.equal(controller.triggerAction('go-center'), false);
            assert.equal(controller.setHunt('hunt-b'), true);
            assert.equal(sent.some((m) => m.t === 'hunt.select'), false);
            assert.equal(controller.getSnapshot({ includeHunts: false }).trainer.pendingHuntSlug, 'hunt-b');

            // Ao terminar a contagem de combate, estado dispara a troca agendada e libera Centro
            fakeNow += 3100;
            hooks.onFrame(JSON.stringify({
                t: 'estado',
                estado: { servidorAgora: fakeNow, centroLivreEm: fakeNow - 100 },
            }));
            assert.deepEqual(sent.find((m) => m.t === 'hunt.select'), { t: 'hunt.select', slug: 'hunt-b' });
            assert.equal(controller.getSnapshot({ includeHunts: false }).trainer.pendingHuntSlug, null);

            // Fora de combate, go-center envia centro.ir; quando ja noCentro, envia centro.curar
            assert.equal(controller.triggerAction('go-center'), true);
            assert.deepEqual(sent.at(-1), { t: 'centro.ir' });

            hooks.onFrame(JSON.stringify({
                t: 'estado',
                estado: { noCentro: true, servidorAgora: fakeNow },
            }));
            assert.equal(controller.triggerAction('go-center'), true);
            assert.deepEqual(sent.at(-1), { t: 'centro.curar' });
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('perfil configurado: openLives, openPanel e openExternalUrl usam o perfil escolhido da conta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokebot-profopen-'));
    try {
        const chromeRoot = join(dir, 'Google', 'Chrome', 'User Data');
        mkdirSync(join(chromeRoot, 'Default'), { recursive: true });
        mkdirSync(join(chromeRoot, 'Profile 2'), { recursive: true });
        writeFileSync(join(chromeRoot, 'Local State'), JSON.stringify({
            profile: {
                last_used: 'Default',
                info_cache: {
                    Default: { name: 'Pessoal' },
                    'Profile 2': { name: 'Lives' },
                },
            },
        }), 'utf8');

        const launches = [];
        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, 'cfg.json'),
            sessionPath: join(dir, 'sess.json'),
            autoLoadSession: false,
            disableHeadlessHuntGuide: true,
            disableBrowserProfileSync: true,
            enableBrowserProfilePicker: true,
            browserExecutablePath: 'C:/Fake/chrome.exe',
            browserUserDataRoots: [chromeRoot],
            browserLauncher: async (exe, profileDir, urls, existingProfile) => {
                launches.push({ exe, profileDir, urls, existingProfile });
                return { exitedQuickly: false };
            },
        });
        try {
            controller.updateConfig({ browserProfile: 'Profile 2' });
            const hooks = controller.attachExternalBridge({
                send: () => true,
                close: () => {},
                isReady: () => true,
            }, { waitForWelcome: true });
            hooks.onFrame(JSON.stringify({
                t: 'welcome',
                estado: {
                    cheio: true,
                    nick: 'ProfTester',
                    level: 10,
                    twitch: { oficiais: [{ login: 'biscoitao', aoVivo: true }] },
                    pokemons: [],
                },
            }));

            assert.equal(await controller.openLives('https://www.twitch.tv/biscoitao'), true);
            assert.equal(await controller.openExternalUrl('https://kick.com/yetz', { forLives: true }), true);
            assert.equal(await controller.openPanel(17890), true);

            assert.equal(launches.length, 3);
            for (const call of launches) {
                assert.equal(call.existingProfile?.name, 'Profile 2');
                assert.equal(call.existingProfile?.root, chromeRoot);
                assert.equal(call.profileDir, null);
            }

            // detectProfileBrowserKind diferencia perfil isolado criado no Edge vs Chrome
            const edgeIso = join(dir, 'iso-edge');
            const chromeIso = join(dir, 'iso-chrome');
            mkdirSync(join(edgeIso, 'Default'), { recursive: true });
            mkdirSync(join(chromeIso, 'Default'), { recursive: true });
            writeFileSync(join(edgeIso, 'Local State'), JSON.stringify({ edge_work: {} }), 'utf8');
            writeFileSync(join(chromeIso, 'Local State'), JSON.stringify({ profile: { last_used: 'Default' } }), 'utf8');
            assert.equal(detectProfileBrowserKind(edgeIso), 'edge');
            assert.equal(detectProfileBrowserKind(chromeIso), 'chrome');
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('vote: monitora /idlehub/me, abre IdleHub no perfil configurado e reage a votoCreditado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokebot-vote-'));
    try {
        const chromeRoot = join(dir, 'Google', 'Chrome', 'User Data');
        mkdirSync(join(chromeRoot, 'Profile 3', 'Local Storage', 'leveldb'), { recursive: true });
        writeFileSync(
            join(chromeRoot, 'Local State'),
            JSON.stringify({ profile: { info_cache: { 'Profile 3': { name: 'Google Vote' } } } }),
            'utf8'
        );
        const launches = [];
        let voteChecks = 0;
        let waitingMs = 0;
        const fakeVoteFetch = async (url, init) => {
            voteChecks += 1;
            assert.equal(url, 'https://pokeidle.io/idlehub/me');
            const body = JSON.parse(String(init?.body || '{}'));
            assert.equal(body.token, 'tok-vote-123');
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    ativo: true,
                    esperaMs: waitingMs,
                    votos: 7,
                    noPar: 1,
                    votosPorDiamante: 2,
                    porPar: 1,
                    diamantes: 3,
                    url: 'https://idlehub.io/vote/pokeidle?nick=VoteNick',
                    identificador: 'VoteNick',
                }),
            };
        };

        const controller = createHeadlessController({
            cwd: dir,
            token: 'tok-vote-123',
            nick: 'VoteNick',
            useExistingBrowser: true,
            enableBrowserProfilePicker: true,
            browserExecutablePath: 'C:\\Fake\\chrome.exe',
            browserUserDataRoots: [chromeRoot],
            browserLauncher: async (exe, profileDir, urls, existingProfile) => {
                launches.push({ exe, profileDir, urls, existingProfile });
            },
            voteFetch: fakeVoteFetch,
            disableHeadlessHuntGuide: true,
            wsFactory: () => { throw new Error('nao esperado'); },
        });

        try {
            controller.updateConfig({ browserProfile: 'Profile 3' });
            const hooks = controller.attachExternalBridge({
                send: () => true,
                close: () => {},
                isReady: () => true,
            }, { waitForWelcome: true });
            hooks.onFrame(JSON.stringify({
                t: 'welcome',
                estado: { cheio: true, nick: 'VoteNick', level: 20, pokemons: [] },
            }));
            await controller.refreshVoteStatus({ force: true });

            const snap1 = controller.getSnapshot({ includeHunts: false });
            assert.equal(snap1.vote.ativo, true);
            assert.equal(snap1.vote.available, true);
            assert.equal(snap1.vote.votos, 7);
            assert.equal(snap1.vote.url, 'https://idlehub.io/vote/pokeidle?nick=VoteNick');
            assert.ok(snap1.logs.some((l) => l.kind === 'reward' && /Voto diario disponivel/i.test(l.text)));

            const opened = await controller.openVote();
            assert.equal(opened, true);
            assert.equal(launches.length, 1);
            assert.deepEqual(launches[0].urls, ['https://idlehub.io/vote/pokeidle?nick=VoteNick']);
            assert.equal(launches[0].existingProfile?.name, 'Profile 3');

            waitingMs = 24 * 3_600_000;
            const beforeChecks = voteChecks;
            hooks.onFrame(JSON.stringify({ t: 'votoCreditado', qtd: 1 }));
            await new Promise((r) => setTimeout(r, 30));
            assert.ok(voteChecks > beforeChecks);
            const snap2 = controller.getSnapshot({ includeHunts: false });
            assert.equal(snap2.vote.available, false);
            assert.ok(snap2.vote.remainingMs > 23 * 3_600_000);
            assert.ok(snap2.logs.some((l) => l.kind === 'reward' && /\+1 diamante.*IdleHub/i.test(l.text)));
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('updater: semver, selecao de ZIP, checkForUpdate, script seguro e staging de ZIP', async () => {
    assert.deepEqual(parseSemver('v1.2.3-beta.1'), { major: 1, minor: 2, patch: 3, prerelease: 'beta.1', raw: '1.2.3-beta.1' });
    assert.ok(compareSemver('1.1.0', '1.0.0') > 0);
    assert.ok(compareSemver('1.0.0', '1.0.0-rc.1') > 0);
    assert.equal(compareSemver('v1.0.0', '1.0'), 0);

    const picked = selectReleaseZipAsset({
        assets: [
            { name: 'pokebot.user.js', size: 100, browser_download_url: 'https://github.com/a/b/pokebot.user.js' },
            { name: 'Nexo-PokeBot-v1.1.zip', size: 140_000_000, browser_download_url: 'https://github.com/a/b/Nexo-PokeBot-v1.1.zip' },
        ],
    });
    assert.equal(picked?.name, 'Nexo-PokeBot-v1.1.zip');

    const dir = mkdtempSync(join(tmpdir(), 'pokebot-upd-'));
    try {
        const fakeApp = join(dir, 'app');
        mkdirSync(fakeApp, { recursive: true });
        writeFileSync(join(fakeApp, 'package.json'), JSON.stringify({ name: 'nexo-pokebot', version: '1.0.0' }), 'utf8');

        const info = await checkForUpdate({
            rootDir: fakeApp,
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    tag_name: 'v1.1.0',
                    name: 'Nexo PokeBot v1.1',
                    body: 'Auto-updater e monitor de voto',
                    html_url: 'https://github.com/felipegakkeku/nexo-pokebot/releases/tag/v1.1.0',
                    assets: [
                        { name: 'Nexo-PokeBot-v1.1.zip', size: 1234, browser_download_url: 'https://github.com/felipegakkeku/nexo-pokebot/releases/download/v1.1.0/Nexo-PokeBot-v1.1.zip' },
                    ],
                }),
            }),
        });
        assert.equal(info.ok, true);
        assert.equal(info.hasUpdate, true);
        assert.equal(info.latestVersion, '1.1.0');
        assert.equal(info.isGitRepo, false);
        assert.equal(info.asset?.name, 'Nexo-PokeBot-v1.1.zip');

        const pkgSrc = join(dir, 'pkg-src', 'Nexo-PokeBot-v1.1');
        mkdirSync(join(pkgSrc, 'src', 'electron'), { recursive: true });
        writeFileSync(join(pkgSrc, 'package.json'), JSON.stringify({ name: 'nexo-pokebot', version: '1.1.0' }), 'utf8');
        writeFileSync(join(pkgSrc, 'src', 'electron', 'main.mjs'), '// updated main\n', 'utf8');
        const zipFile = join(dir, 'Nexo-PokeBot-v1.1.zip');
        execFileSync('tar.exe', ['-a', '-c', '-f', zipFile, '-C', join(dir, 'pkg-src'), 'Nexo-PokeBot-v1.1'], { stdio: 'pipe' });
        const zipBuf = readFileSync(zipFile);

        const progressEvents = [];
        const staged = await downloadAndStageUpdate({
            rootDir: fakeApp,
            releaseInfo: info,
            waitPids: [999999],
            onProgress: (p) => progressEvents.push(p.phase),
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-length': String(zipBuf.length) }),
                arrayBuffer: async () => zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength),
            }),
        });
        try {
            assert.equal(staged.ok, true);
            assert.equal(staged.version, '1.1.0');
            assert.ok(progressEvents.includes('downloading'));
            assert.ok(progressEvents.includes('extracting'));
            assert.ok(progressEvents.includes('ready'));
            const psText = readFileSync(staged.scriptPath, 'utf8');
            assert.ok(psText.includes('.pokebot-update-backup'));
            assert.ok(psText.includes('^\\.pokebot-|^\\.git|^\\.env'));
            assert.doesNotMatch(psText, /robocopy\s+\$stageRoot\s+\$appDir\s+\/MIR/i);
        } finally {
            rmSync(staged.tempRoot, { recursive: true, force: true });
        }

        const psSample = buildWindowsApplyScript({
            stageRoot: "C:\\Tmp\\O'Brien\\stage",
            appDir: "C:\\Apps\\Nexo's Bot",
            launchExe: "C:\\Apps\\Nexo's Bot\\Nexo PokeBot.exe",
            tempRoot: 'C:\\Tmp\\upd',
        });
        assert.ok(psSample.includes("O''Brien"));
        assert.ok(psSample.includes("Nexo''s Bot"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('modo economia: Auto-Catch lanca pokebola via eventos batalha no headless e preserva feed campo no jogo embutido', async () => {
    // 1) createFieldTracker.applyBattleEvent registra caido pelo slot do ataque + morte e limpa no bola/fugiu
    const trackerField = createFieldTracker();
    assert.equal(trackerField.applyBattleEvent({ k: 'ataque', por: 'jogador', slot: 4 }, 10_000), false);
    assert.equal(trackerField.applyBattleEvent({ k: 'morte', quem: 'selvagem', nome: 'Zubat', level: 18 }, 10_200), true);
    const corpses = trackerField.getFallenCorpses(10_500);
    assert.equal(corpses.length, 1);
    assert.equal(corpses[0].slot, 4);
    assert.equal(corpses[0].nome, 'Zubat');
    assert.equal(corpses[0].level, 18);
    // Morte subsequente sem novo ataque nao reaproveita slot stale
    assert.equal(trackerField.applyBattleEvent({ k: 'morte', quem: 'selvagem', nome: 'Outro', level: 19 }, 10_600), false);
    // Evento bola (mesmo sucesso: false) remove o caido consumido
    trackerField.applyBattleEvent({ k: 'bola', sucesso: false, slot: 4, ballId: 1 }, 10_800);
    assert.equal(trackerField.getFallenCorpses(10_900).length, 0);

    // 2) Headless com economyMode: 'on' (sem frames campo) lanca ball.throw ao receber batalha (ataque + morte)
    const dir = makeTempDir('pokebot-eco-catch-');
    const sent = [];
    let sock = null;
    try {
        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, '.pokebot-headless-config.json'),
            disableBrowserProfileSync: true,
            disableHeadlessHuntGuide: true,
            disableVotePolling: true,
            initialConfig: {
                economyMode: 'on',
                caidosEnabled: true,
                preferredBall: 'ultra',
                restockEnabled: false,
                dailyPassEnabled: false,
                preyEnabled: false,
                liveEnabled: false,
                ensureNativeAutoHeal: false,
            },
            liveRunner: async () => {},
            liveDisposer: () => {},
            resolveSession: () => ({
                nick: 'EcoCatcher',
                token: makeFakeJwt({ nick: 'EcoCatcher', exp: Date.now() + 3_600_000 }),
                dispositivo: 'uuid-eco',
                prefs: {},
                payload: { nick: 'EcoCatcher', exp: Date.now() + 3_600_000 },
                source: 'mock',
            }),
            wsFactory: () => {
                sock = {
                    readyState: 1,
                    send(raw) { sent.push(JSON.parse(raw)); },
                    close() { this.readyState = 3; },
                };
                queueMicrotask(() => {
                    sock.onopen?.();
                    sock.onmessage?.({
                        data: JSON.stringify({
                            t: 'welcome',
                            hunts: [],
                            estado: {
                                cheio: true,
                                nick: 'EcoCatcher',
                                level: 30,
                                gold: 100_000,
                                huntSlug: 'floresta',
                                balls: { 1: 50, 4: 20 },
                                items: {},
                                automation: { autoRevive: true, autoPotion: true, autoVoltarHunt: true },
                                pokemons: [{ id: 1, level: 30 }],
                            },
                        }),
                    });
                });
                return sock;
            },
        });
        try {
            controller.start();
            await new Promise((r) => setTimeout(r, 30));
            assert.ok(sent.some((f) => f.t === 'cliente.economia' && f.ativo === true));
            // Nenhum frame campo chega; apenas batalha (ataque com slot + morte selvagem)
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'batalha',
                    ev: [
                        { k: 'ataque', por: 'jogador', slot: 9 },
                        { k: 'morte', quem: 'selvagem', nome: 'Haunter', level: 28, xpPokemon: 200, ouro: 50 },
                    ],
                }),
            });
            assert.ok(
                sent.some((f) => f.t === 'ball.throw' && f.slot === 9 && f.ballId === 4),
                'Headless em economia do servidor deve lancar ball.throw via eventos de batalha'
            );
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    // 3) webview-preload.cjs: preserva cliente.economia=false no fio quando Auto-Catch ativo e libera quando desligado
    const preloadSrc = readFileSync(join(process.cwd(), 'src', 'electron', 'webview-preload.cjs'), 'utf8');
    const hookMatch = preloadSrc.match(/const MAIN_WORLD_HOOK = `([\s\S]*?)`;/);
    assert.ok(hookMatch, 'MAIN_WORLD_HOOK deve existir em webview-preload.cjs');
    const hookCode = hookMatch[1].replace(/\\\\/g, '\\');
    const { runInNewContext } = await import('node:vm');
    const wireSent = [];
    class FakeWS {
        constructor(url) {
            this.url = url;
            this.readyState = 0;
        }
        addEventListener() {}
        send(data) { wireSent.push(JSON.parse(String(data))); }
    }
    const sandboxWindow = {
        WebSocket: FakeWS,
        location: { hostname: 'pokeidle.io' },
        localStorage: { getItem: () => null },
        postMessage() {},
    };
    sandboxWindow.window = sandboxWindow;
    sandboxWindow.setInterval = () => 0;
    sandboxWindow.setTimeout = () => 0;
    runInNewContext(hookCode, sandboxWindow);

    const gameWs = new sandboxWindow.WebSocket('wss://pokeidle.io/ws');
    gameWs.readyState = 1;
    // Jogo ativa Modo Economia com Auto-Catch ligado -> envia ativo: false no fio
    gameWs.send(JSON.stringify({ t: 'cliente.economia', ativo: true }));
    assert.deepEqual(wireSent[0], { t: 'cliente.economia', ativo: false });

    // Usuario desliga Capturar caidos -> jogo consegue enviar ativo: true normalmente
    sandboxWindow.__pbSetNeedCampoFeed(false);
    gameWs.send(JSON.stringify({ t: 'cliente.economia', ativo: true }));
    assert.deepEqual(wireSent[1], { t: 'cliente.economia', ativo: true });

    // Usuario religa Capturar caidos -> preload reenvia ativo: false imediatamente
    sandboxWindow.__pbSetNeedCampoFeed(true);
    assert.deepEqual(wireSent[2], { t: 'cliente.economia', ativo: false });
});

test('garantia de captura e avisos: AoE multi-kill, VIP preserva campo, watchdog auto-recupera e computeModeWarnings alerta limitacoes', async () => {
    // 1) computeModeWarnings: vazio no modo completo/embutido, alerta claro em modos limitados
    assert.deepEqual(computeModeWarnings({ config: { caidosEnabled: true, economyMode: 'auto', economyPingOnly: false }, status: 'connected', mode: 'headless' }), []);
    assert.deepEqual(computeModeWarnings({ config: { caidosEnabled: true, economyMode: 'on', economyPingOnly: false }, status: 'bridge', mode: 'browser-bridge' }), []);
    const wEco = computeModeWarnings({ config: { caidosEnabled: true, economyMode: 'on', economyPingOnly: false }, status: 'connected', mode: 'headless' });
    assert.equal(wEco.length, 1);
    assert.equal(wEco[0].code, 'server-economy-no-shiny');
    assert.match(wEco[0].title, /Shiny/i);
    assert.deepEqual(wEco[0].fixConfig, { economyMode: 'auto', caidosEnabled: true });

    const wPing = computeModeWarnings({ config: { caidosEnabled: true, economyMode: 'auto', economyPingOnly: true }, status: 'connected', mode: 'headless' });
    assert.equal(wPing.length, 1);
    assert.equal(wPing[0].code, 'economy-ping-only');
    assert.equal(wPing[0].severity, 'danger');

    const wDegraded = computeModeWarnings({ config: { caidosEnabled: true, economyMode: 'auto', economyPingOnly: false }, status: 'connected', mode: 'headless', campoFeedDegraded: true });
    assert.equal(wDegraded.length, 1);
    assert.equal(wDegraded[0].code, 'campo-feed-missing');

    // 2) AoE multi-kill em fallback de batalha: captura TODOS os slots abatidos na mesma onda
    const aoeField = createFieldTracker();
    aoeField.applyBattleEvent({ k: 'ataque', por: 'jogador', slot: 2 }, 20_000);
    aoeField.applyBattleEvent({ k: 'ataque', por: 'jogador', slot: 5 }, 20_050);
    assert.equal(aoeField.applyBattleEvent({ k: 'morte', quem: 'selvagem', nome: 'MobA', level: 15 }, 20_100), true);
    assert.equal(aoeField.applyBattleEvent({ k: 'morte', quem: 'selvagem', nome: 'MobB', level: 16 }, 20_120), true);
    const aoeSlots = aoeField.getFallenCorpses(20_200).map((c) => c.slot).sort((a, b) => a - b);
    assert.deepEqual(aoeSlots, [2, 5]);

    // 3) VIP com autoBallSemParar no Headless auto + caidosEnabled=true preserva cliente.economia=false + watchdog auto-recupera feed campo
    const dir = makeTempDir('pokebot-vip-guard-');
    const sent = [];
    let sock = null;
    try {
        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, '.pokebot-headless-config.json'),
            disableBrowserProfileSync: true,
            disableHeadlessHuntGuide: true,
            disableVotePolling: true,
            initialConfig: {
                economyMode: 'auto',
                caidosEnabled: true,
                preferredBall: 'ultra',
                shinyBall: 'beast',
                restockEnabled: false,
                dailyPassEnabled: false,
                preyEnabled: false,
                liveEnabled: false,
                ensureNativeAutoHeal: false,
            },
            liveRunner: async () => {},
            liveDisposer: () => {},
            resolveSession: () => ({
                nick: 'VipGuard',
                token: makeFakeJwt({ nick: 'VipGuard', exp: Date.now() + 3_600_000 }),
                dispositivo: 'uuid-vip',
                prefs: {},
                payload: { nick: 'VipGuard', exp: Date.now() + 3_600_000 },
                source: 'mock',
            }),
            wsFactory: () => {
                sock = {
                    readyState: 1,
                    send(raw) { sent.push(JSON.parse(raw)); },
                    close() { this.readyState = 3; },
                };
                queueMicrotask(() => {
                    sock.onopen?.();
                    sock.onmessage?.({
                        data: JSON.stringify({
                            t: 'welcome',
                            hunts: [],
                            estado: {
                                cheio: true,
                                nick: 'VipGuard',
                                level: 50,
                                gold: 100_000,
                                huntSlug: 'abra',
                                loja: { vip: true },
                                balls: { 4: 20, 5: 5 },
                                items: {},
                                automation: { autoBallSemParar: true, autoRevive: true, autoPotion: true, autoVoltarHunt: true },
                                pokemons: [{ id: 1, level: 50 }],
                            },
                        }),
                    });
                });
                return sock;
            },
        });
        try {
            controller.start();
            await new Promise((r) => setTimeout(r, 30));
            const initialEco = sent.filter((f) => f.t === 'cliente.economia');
            assert.equal(initialEco.length, 1);
            assert.equal(initialEco[0].ativo, false, 'VIP com caidosEnabled=true deve manter cliente.economia=false para detectar Shiny');
            assert.deepEqual(controller.getSnapshot({ includeHunts: false }).modeWarnings, []);

            // Simula 3 mortes sem nenhum frame campo chegar -> watchdog reenvia cliente.economia=false e sinaliza degradacao
            for (const sl of [1, 2, 3]) {
                sock.onmessage?.({
                    data: JSON.stringify({
                        t: 'batalha',
                        ev: [
                            { k: 'ataque', por: 'jogador', slot: sl },
                            { k: 'morte', quem: 'selvagem', nome: 'Abra', level: 10 },
                        ],
                    }),
                });
            }
            const ecoAfterWatchdog = sent.filter((f) => f.t === 'cliente.economia' && f.ativo === false);
            assert.ok(ecoAfterWatchdog.length >= 2, 'Watchdog deve reenviar cliente.economia=false se campo sumir em combate');
            const snapDeg = controller.getSnapshot({ includeHunts: false });
            assert.equal(snapDeg.campoFeedDegraded, true);
            assert.ok(snapDeg.modeWarnings.some((w) => w.code === 'campo-feed-missing'));

            // Assim que um frame campo chega (inclusive com Shiny), degradacao limpa e Bola Shiny e lancada
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'campo',
                    ts: Date.now(),
                    mobs: [{ s: 7, n: 'Abra', nv: 10, sh: true, x: true, xr: 15_000 }],
                }),
            });
            const snapOk = controller.getSnapshot({ includeHunts: false });
            assert.equal(snapOk.campoFeedDegraded, false);
            assert.deepEqual(snapOk.modeWarnings, []);
            assert.ok(sent.some((f) => f.t === 'ball.throw' && f.slot === 7 && f.ballId === 5), 'Shiny deve receber Beast Ball (#5)');

            // Ligar economyMode: 'on' gera aviso imediato no snapshot e log
            controller.updateConfig({ economyMode: 'on' });
            const snapWarn = controller.getSnapshot({ includeHunts: false });
            assert.ok(snapWarn.modeWarnings.some((w) => w.code === 'server-economy-no-shiny'));
            assert.ok(snapWarn.logs.some((l) => l.kind === 'warn' && /Shiny/i.test(l.text)));
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('shiny-miss e shiniesSeen: ignora pets de jogadores (dn), treino na casa (ti), PvP (eq), NPCs, Centro/Casa e deltas atrasados da Praca', async () => {
    // 1) isWildCampoMob exclui todas as entidades nao selvagens
    assert.equal(isWildCampoMob({ slot: 1, nome: 'Shedinja', shiny: true }), true);
    assert.equal(isWildCampoMob({ slot: 2, nome: 'Machamp', level: 1902, shiny: true, dono: 'OutroTreinador' }), false);
    assert.equal(isWildCampoMob({ slot: 3, nome: 'Machamp', level: 1902, shiny: true, emTreino: true }), false);
    assert.equal(isWildCampoMob({ slot: 4, nome: 'Machamp', level: 1902, shiny: true, equipe: 'A' }), false);
    assert.equal(isWildCampoMob({ slot: 5, nome: 'Treinador', shiny: true, ehTreinador: true }), false);
    assert.equal(isWildCampoMob({ slot: 6, nome: 'Boneco', shiny: true, ehBoneco: true }), false);
    assert.equal(isWildCampoMob({ slot: 7, nome: 'Enfermeira', shiny: true, ehNpc: true }), false);

    // 2) createFieldTracker descarta corpos em Centro/Casa e ignora delta atrasado da Praca (m.sl) apos voltar pra hunt
    const f = createFieldTracker();
    f.applyCampoInit({
        slug: 'centro_medico',
        centro: true,
        sl: 3,
        ts: 10_000,
        mobs: [
            { s: 10, n: 'Machamp', nv: 1902, sh: true, dn: 'TopPlayer', x: true, xr: 20_000 },
            { s: 11, n: 'Nurse', cura: true },
        ],
    }, 10_000);
    assert.equal(f.getScene().isWild, false);
    assert.deepEqual(f.getFallenCorpses(10_500), []);

    f.applyCampoInit({
        slug: 'shedinja_hoenn',
        ts: 11_000,
        mobs: [{ s: 1, n: 'Shedinja', nv: 100, sh: false, x: false }],
    }, 11_000);
    assert.equal(f.getScene().isWild, true);
    // Delta atrasado da Praca (sl: 3) com Machamp Nv 1902 shiny deve ser descartado
    f.applyCampo({
        sl: 3,
        ts: 11_100,
        mobs: [{ s: 10, n: 'Machamp', nv: 1902, sh: true }],
    }, 11_100);
    assert.equal(f.getMobs().some((m) => m.nome === 'Machamp'), false);

    // 3) Controlador completo: visitar Centro/Casa com Shiny Machamp Nv 1902 e voltar para hunt gera ZERO shiniesSeen e ZERO shiny-miss;
    //    ja um Shedinja Shiny selvagem que some sem captura registra shiniesSeen=1 e shiniesMissed=1.
    const dir = makeTempDir('pokebot-shiny-filter-');
    let fakeNow = 1_000_000;
    let sock = null;
    try {
        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, '.pokebot-headless-config.json'),
            disableBrowserProfileSync: true,
            disableHeadlessHuntGuide: true,
            disableVotePolling: true,
            nowFn: () => fakeNow,
            initialConfig: {
                caidosEnabled: false,
                restockEnabled: false,
                dailyPassEnabled: false,
                preyEnabled: false,
                liveEnabled: false,
                ensureNativeAutoHeal: false,
            },
            liveRunner: async () => {},
            liveDisposer: () => {},
            resolveSession: () => ({
                nick: 'FilterTester',
                token: makeFakeJwt({ nick: 'FilterTester', exp: Date.now() + 3_600_000 }),
                dispositivo: 'uuid-sf',
                prefs: {},
                payload: { nick: 'FilterTester', exp: Date.now() + 3_600_000 },
                source: 'mock',
            }),
            wsFactory: () => {
                sock = { readyState: 1, send() {}, close() { this.readyState = 3; } };
                queueMicrotask(() => {
                    sock.onopen?.();
                    sock.onmessage?.({
                        data: JSON.stringify({
                            t: 'welcome',
                            hunts: [{ slug: 'shedinja_hoenn', nome: 'Shedinja', nivel: 100 }],
                            estado: {
                                cheio: true,
                                nick: 'FilterTester',
                                level: 500,
                                gold: 100_000,
                                huntSlug: 'shedinja_hoenn',
                                noCentro: false,
                                balls: { 4: 20 },
                                items: {},
                                automation: {},
                                pokemons: [{ id: 1, level: 500 }],
                            },
                        }),
                    });
                });
                return sock;
            },
        });
        try {
            controller.start();
            await new Promise((r) => setTimeout(r, 30));

            // Entra no Centro Medico com Shiny Machamp Nv 1902 de outro jogador (dn)
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'campo.init',
                    slug: 'centro',
                    centro: true,
                    sl: 2,
                    ts: fakeNow,
                    mobs: [
                        { s: 50, n: 'OutroPlayer', tr: true },
                        { s: 51, n: 'Machamp', nv: 1902, sh: true, dn: 'OutroPlayer' },
                    ],
                }),
            });
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'campo',
                    sl: 2,
                    ts: fakeNow + 500,
                    mobs: [{ s: 51, c: 5, r: 5 }],
                }),
            });

            // Entra na Casa com Shiny Machamp Nv 1902 em treino (ti)
            fakeNow += 2_000;
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'campo.init',
                    slug: 'casa',
                    casa: true,
                    ts: fakeNow,
                    mobs: [
                        { s: 60, n: 'Machamp', nv: 1902, sh: true, ti: 0 },
                        { s: 61, n: 'Boneco', bn: true, bi: 0 },
                    ],
                }),
            });

            // Volta para a hunt (Shedinja) e avanca 20s -> nenhum falso alerta de Machamp!
            fakeNow += 20_000;
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'campo.init',
                    slug: 'shedinja_hoenn',
                    ts: fakeNow,
                    mobs: [{ s: 1, n: 'Shedinja', nv: 100, sh: false }],
                }),
            });
            // Mesmo se um pet com dn ou eq aparecer em delta solto na hunt, continua ignorado
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'campo',
                    ts: fakeNow + 500,
                    mobs: [
                        { s: 99, n: 'Machamp', nv: 1902, sh: true, dn: 'Alguem' },
                        { s: 98, n: 'Machamp', nv: 1902, sh: true, eq: 'B' },
                    ],
                }),
            });
            fakeNow += 20_000;
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'campo',
                    ts: fakeNow,
                    fora: [99, 98],
                    mobs: [],
                }),
            });
            fakeNow += 20_000;
            sock.onmessage?.({
                data: JSON.stringify({ t: 'campo', ts: fakeNow, mobs: [] }),
            });

            const snapClean = controller.getSnapshot({ includeHunts: false });
            assert.equal(snapClean.stats.shiniesSeen, 0);
            assert.equal(snapClean.stats.shiniesMissed, 0);
            assert.equal(snapClean.missedShinies.length, 0);
            assert.equal(snapClean.logs.some((l) => l.kind === 'shiny-miss'), false);

            // Agora um Shedinja Shiny SELVAGEM nasce na hunt e some sem captura -> deve alertar corretamente!
            fakeNow += 1_000;
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'campo',
                    ts: fakeNow,
                    mobs: [{ s: 3, n: 'Shedinja', nv: 100, sh: true, x: false }],
                }),
            });
            fakeNow += 2_000;
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'campo',
                    ts: fakeNow,
                    fora: [3],
                    mobs: [],
                }),
            });
            fakeNow += 15_000;
            sock.onmessage?.({
                data: JSON.stringify({ t: 'campo', ts: fakeNow, mobs: [] }),
            });

            const snapReal = controller.getSnapshot({ includeHunts: false });
            assert.equal(snapReal.stats.shiniesSeen, 1);
            assert.equal(snapReal.stats.shiniesMissed, 1);
            assert.equal(snapReal.missedShinies[0]?.name, 'Shedinja');
            assert.ok(snapReal.logs.some((l) => l.kind === 'shiny-miss' && /Shedinja \(Nv 100\)/.test(l.text)));
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('sprites: resolvePokemonSpriteDex mapeia Hoenn (13xxx), Outland (2001..2058 e 10501..), Megas, Formas e nome fallback no gui-server', async () => {
    // 1) National Dex direta (Gen 1..9)
    assert.equal(resolvePokemonSpriteDex(6), 6);
    assert.equal(resolvePokemonSpriteDex(1025), 1025);
    // 2) Hoenn / Geracoes 3+ (13xxx -> id % 1000)
    assert.equal(resolvePokemonSpriteDex(13361, 'Snorunt'), 361);
    assert.equal(resolvePokemonSpriteDex(13292, 'Shedinja'), 292);
    // 3) Outland (2001..2058 e legado 10501..10548)
    assert.equal(resolvePokemonSpriteDex(2001, 'Brave Blastoise'), 9);
    assert.equal(resolvePokemonSpriteDex(2033, 'Ancient Pupitar'), 247);
    assert.equal(resolvePokemonSpriteDex(2058, 'War Scrafty'), 560);
    assert.equal(resolvePokemonSpriteDex(10533, 'Ancient Pupitar'), 247);
    // 4) Megas e Formas regionais / especiais
    assert.equal(resolvePokemonSpriteDex(3006, 'Mega Charizard Y'), 6);
    assert.equal(resolvePokemonSpriteDex(9006, 'Mega Charizard X'), 6);
    assert.equal(resolvePokemonSpriteDex(14009, 'Mega Blastoise'), 9);
    assert.equal(resolvePokemonSpriteDex(4037, 'Alolan Vulpix'), 37);
    assert.equal(resolvePokemonSpriteDex(5052, 'Galarian Meowth'), 52);
    assert.equal(resolvePokemonSpriteDex(6058, 'Hisuian Growlithe'), 58);
    assert.equal(resolvePokemonSpriteDex(1479, 'Mow Rotom'), 479);
    assert.equal(resolvePokemonSpriteDex(8017, 'Ogerpon Hearthflame'), 1017);
    assert.equal(resolvePokemonSpriteDex(9017, 'Ogerpon Wellspring'), 1017);
    assert.equal(resolvePokemonSpriteDex(12017, 'Ogerpon Cornerstone'), 1017);
    assert.equal(resolvePokemonSpriteDex(10001, 'Blastoise'), 9);
    // 5) Fallback por nome quando speciesId esta ausente
    assert.equal(resolvePokemonSpriteDex(null, 'Ancient Pupitar'), 247);
    assert.equal(resolvePokemonSpriteDex(0, 'Shiny Snorunt', { snorunt: 361 }), 361);

    // 6) gui-server popula spriteDex em activePokemon, recentShinies e ownShinies
    const dir = makeTempDir('pokebot-sprite-dex-');
    let sock = null;
    try {
        const controller = createHeadlessController({
            cwd: dir,
            configPath: join(dir, '.pokebot-headless-config.json'),
            disableBrowserProfileSync: true,
            disableHeadlessHuntGuide: true,
            disableVotePolling: true,
            initialConfig: { caidosEnabled: false, restockEnabled: false, dailyPassEnabled: false, preyEnabled: false, liveEnabled: false, ensureNativeAutoHeal: false },
            liveRunner: async () => {},
            liveDisposer: () => {},
            resolveSession: () => ({
                nick: 'SpriteTester',
                token: makeFakeJwt({ nick: 'SpriteTester', exp: Date.now() + 3_600_000 }),
                dispositivo: 'uuid-sp',
                prefs: {},
                payload: { nick: 'SpriteTester', exp: Date.now() + 3_600_000 },
                source: 'mock',
            }),
            wsFactory: () => {
                sock = { readyState: 1, send() {}, close() { this.readyState = 3; } };
                queueMicrotask(() => {
                    sock.onopen?.();
                    sock.onmessage?.({
                        data: JSON.stringify({
                            t: 'welcome',
                            hunts: [
                                { slug: 'snorunt', nome: 'Snorunt', nivel: 40, especies: [{ pokeId: 13361, nome: 'Snorunt', pontos: 100 }] },
                            ],
                            estado: {
                                cheio: true,
                                nick: 'SpriteTester',
                                level: 200,
                                gold: 100_000,
                                activeId: 1,
                                huntSlug: 'snorunt',
                                pokemons: [{ id: 1, speciesId: 2033, nome: 'Ancient Pupitar', level: 100, shiny: true, hp: 100, maxHp: 100 }],
                            },
                        }),
                    });
                });
                return sock;
            },
        });
        try {
            controller.start();
            await new Promise((r) => setTimeout(r, 30));
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'shiny.captura',
                    nick: 'Meimei',
                    ovo: false,
                    pokemon: { nome: 'Snorunt', speciesId: 13361 },
                }),
            });
            sock.onmessage?.({
                data: JSON.stringify({
                    t: 'batalha',
                    ev: [{ k: 'capturado', pokemon: { nome: 'Snorunt', speciesId: 13361, level: 40, shiny: true } }],
                }),
            });
            const snap = controller.getSnapshot({ includeHunts: false });
            assert.equal(snap.activePokemon?.spriteDex, 247);
            assert.equal(snap.recentShinies?.[0]?.spriteDex, 361);
            assert.equal(snap.ownShinies?.[0]?.spriteDex, 361);
        } finally {
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('gui: bridge embutido registra drop.raro (casa/bicicleta), recentRare sem filtro e shiny.captura proprio (ovo)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pokebot-alert-bridge-'));
    try {
        const controller = createHeadlessController({
            cwd: dir,
            autoStart: false,
            autoLoginOnMissingSession: false,
            disableBrowserProfileSync: true,
            liveRunner: async () => {},
            liveDisposer: () => {},
            initialConfig: { dropHideCategories: ['stone', 'other'] },
            sessionResolver: () => ({ nick: 'Gake', token: 'tok', provedor: 'google', source: 'cache' }),
        });
        const hooks = controller.attachExternalBridge({
            isReady: () => true,
            send: () => true,
            close: () => {},
        }, { waitForWelcome: true });
        try {
            hooks.onFrame(JSON.stringify({
                t: 'welcome',
                estado: { nick: 'Gake', huntSlug: 'nincada_hoenn' },
            }));
            // Drop raro de casa lendaria seguido imediatamente de pedra comum -> recentRare preserva id e nao e filtrado
            hooks.onFrame(JSON.stringify({ t: 'drop.raro', nick: 'Gake', tipo: 'casa', raridade: 'lendaria', id: 42 }));
            hooks.onFrame(JSON.stringify({
                t: 'batalha',
                ev: [{ k: 'morte', quem: 'selvagem', drops: [{ itemId: 100, nome: 'Fire Stone', qtd: 1 }] }],
            }));
            // Shiny chocado de ovo no jogo embutido (chega via shiny.captura sem batalha.capturado)
            hooks.onFrame(JSON.stringify({
                t: 'shiny.captura',
                nick: 'Gake',
                ovo: true,
                pokemon: { nome: 'Snorunt', speciesId: 13361, level: 1 },
            }));
            const snap = controller.getSnapshot({ includeHunts: false });
            assert.equal(snap.status, 'bridge');
            assert.equal(snap.drops.recentRare.length, 1);
            assert.equal(snap.drops.recentRare[0].name, 'Casa Lendária');
            assert.ok(Number(snap.drops.recentRare[0].id) > 0);
            assert.equal(snap.ownShinies.length, 1);
            assert.equal(snap.ownShinies[0].name, 'Snorunt');
            assert.equal(snap.ownShinies[0].spriteDex, 361);
            assert.equal(snap.ownShinies[0].hunt, 'Ovo Shiny');
        } finally {
            hooks.onDetach();
            controller.stop();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
