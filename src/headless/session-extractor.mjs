import {
    chmodSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { randomUUID } from 'node:crypto';
import { decryptText, encryptText, isEncrypted, isSecretStoreAvailable } from './secret-store.mjs';

const MAX_SNAPPY_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const LEVELDB_FOOTER_SIZE = 48;
const LEVELDB_MAGIC = 0xdb4775248b80fb57n;
const LEVELDB_BLOCK_TRAILER_SIZE = 5;
const LEVELDB_LOG_BLOCK_SIZE = 32768;
const LEVELDB_LOG_HEADER_SIZE = 7;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_EXACT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64U_RE = /^[A-Za-z0-9_-]+={0,2}$/;

function toBuffer(input) {
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof Uint8Array) {
        return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    }
    throw new TypeError('Entrada Snappy deve ser Buffer ou Uint8Array');
}

function readVarint64(buf, startPos) {
    let pos = startPos;
    let result = 0n;
    let shift = 0n;
    while (pos < buf.length && shift <= 63n) {
        const b = BigInt(buf[pos++]);
        result |= (b & 0x7fn) << shift;
        if ((b & 0x80n) === 0n) {
            return { value: Number(result), nextPos: pos };
        }
        shift += 7n;
    }
    throw new Error('Varint truncado ou invalido');
}

function snappyDecompressCore(input, allowTrailing) {
    const src = toBuffer(input);
    if (src.length === 0) {
        throw new Error('Stream Snappy vazio');
    }

    let pos = 0;
    let uncompressedLen = 0;
    let shift = 0;
    while (true) {
        if (pos >= src.length) {
            throw new Error('Stream Snappy truncado no cabecalho varint');
        }
        const b = src[pos++];
        if (shift > 28 || (shift === 28 && b > 0x0f)) {
            throw new Error('Cabecalho varint Snappy excede 32 bits');
        }
        uncompressedLen |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
    }

    uncompressedLen = uncompressedLen >>> 0;
    if (uncompressedLen > MAX_SNAPPY_UNCOMPRESSED_BYTES) {
        throw new Error(`Tamanho Snappy excede 32MB: ${uncompressedLen}`);
    }

    const out = Buffer.allocUnsafe(uncompressedLen);
    let outPos = 0;

    while (pos < src.length && (!allowTrailing || outPos < uncompressedLen)) {
        const c = src[pos++];
        const tag = c & 0x03;

        if (tag === 0) {
            let len = (c >> 2) + 1;
            if (len > 60) {
                const extra = len - 60;
                if (pos + extra > src.length) {
                    throw new Error('Stream Snappy truncado no tamanho do literal');
                }
                let extraLen = 0;
                for (let i = 0; i < extra; i++) {
                    extraLen += src[pos++] * (256 ** i);
                }
                len = extraLen + 1;
            }
            if (len <= 0 || pos + len > src.length) {
                throw new Error('Literal Snappy excede o buffer de entrada');
            }
            if (outPos + len > uncompressedLen) {
                throw new Error('Literal Snappy excede o tamanho descomprimido');
            }
            src.copy(out, outPos, pos, pos + len);
            pos += len;
            outPos += len;
            continue;
        }

        let len;
        let off;
        if (tag === 1) {
            if (pos >= src.length) {
                throw new Error('Stream Snappy truncado em copy-1');
            }
            len = ((c >> 2) & 0x07) + 4;
            off = ((c & 0xe0) << 3) | src[pos++];
        } else if (tag === 2) {
            if (pos + 2 > src.length) {
                throw new Error('Stream Snappy truncado em copy-2');
            }
            len = (c >> 2) + 1;
            off = src.readUInt16LE(pos);
            pos += 2;
        } else {
            if (pos + 4 > src.length) {
                throw new Error('Stream Snappy truncado em copy-4');
            }
            len = (c >> 2) + 1;
            off = src.readUInt32LE(pos);
            pos += 4;
        }

        if (off === 0 || off > outPos) {
            throw new Error(`Offset de copia Snappy invalido: ${off} (outPos=${outPos})`);
        }
        if (outPos + len > uncompressedLen) {
            throw new Error('Copia Snappy excede o tamanho descomprimido');
        }

        if (off < len) {
            for (let i = 0; i < len; i++) {
                out[outPos] = out[outPos - off];
                outPos++;
            }
        } else {
            out.copy(out, outPos, outPos - off, outPos - off + len);
            outPos += len;
        }
    }

    if (outPos !== uncompressedLen) {
        throw new Error(`Stream Snappy incompleto: esperado ${uncompressedLen}, obtido ${outPos}`);
    }
    return out;
}

/**
 * Descomprime um buffer no formato Snappy puro (sem framing).
 * @param {Buffer|Uint8Array} buf Bytes comprimidos em Snappy.
 * @returns {Buffer} Bytes descomprimidos.
 */
export function snappyDecompress(buf) {
    return snappyDecompressCore(buf, false);
}

/**
 * Decodifica o payload JSON de um token no formato payloadB64.sig (ou header.payloadB64.sig).
 * @param {string} token Token assinado do Pokeidle.
 * @returns {object|null} Payload parseado ou null se invalido.
 */
export function decodeJwtPayload(token) {
    if (typeof token !== 'string' || !token) return null;
    const parts = token.trim().split('.');
    if (parts.length < 2 || parts.length > 3) return null;
    if (parts.some((p) => !p)) return null;

    const payloadB64 = parts.length === 2 ? parts[0] : parts[1];
    if (!B64U_RE.test(payloadB64)) return null;

    try {
        const jsonText = Buffer.from(payloadB64, 'base64url').toString('utf8');
        const parsed = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function isExistingDir(dirPath) {
    try {
        return existsSync(dirPath) && statSync(dirPath).isDirectory();
    } catch {
        return false;
    }
}

function collectBrowserUserDataRoots(plat, home, localAppDataOverride) {
    if (plat === 'win32') {
        const localBase = localAppDataOverride || join(home, 'AppData', 'Local');
        return [
            join(localBase, 'Google', 'Chrome', 'User Data'),
            join(localBase, 'Microsoft', 'Edge', 'User Data'),
            join(localBase, 'BraveSoftware', 'Brave-Browser', 'User Data'),
            join(localBase, 'Chromium', 'User Data'),
        ];
    }
    if (plat === 'darwin') {
        const appSupport = join(home, 'Library', 'Application Support');
        return [
            join(appSupport, 'Google', 'Chrome'),
            join(appSupport, 'Microsoft Edge'),
            join(appSupport, 'BraveSoftware', 'Brave-Browser'),
            join(appSupport, 'Chromium'),
        ];
    }
    const configBase = join(home, '.config');
    return [
        join(configBase, 'google-chrome'),
        join(configBase, 'microsoft-edge'),
        join(configBase, 'BraveSoftware', 'Brave-Browser'),
        join(configBase, 'chromium'),
    ];
}

/**
 * Descobre diretorios User Data de navegadores Chromium instalados e do perfil embutido.
 * @param {object} [options] Opcoes de ambiente, extras e cwd para descoberta/teste.
 * @returns {string[]} Caminhos unicos de diretorios User Data existentes.
 */
export function discoverBrowserUserDataDirs(options = {}) {
    const plat = options.platform || platform();
    const home = options.homeDir || homedir();
    const localAppData = options.localAppData !== undefined
        ? options.localAppData
        : (options.homeDir ? join(home, 'AppData', 'Local') : process.env.LOCALAPPDATA);

    const found = new Set();
    const addIfDir = (candidate) => {
        if (!candidate) return;
        const resolved = resolve(candidate);
        if (isExistingDir(resolved)) {
            found.add(resolved);
        }
    };

    if (Array.isArray(options.extraUserDataDirs)) {
        for (const extra of options.extraUserDataDirs) {
            addIfDir(extra);
        }
    }

    if (options.onlyExtraUserDataDirs) {
        return [...found];
    }

    const roots = collectBrowserUserDataRoots(plat, home, localAppData);
    for (const userDataRoot of roots) {
        addIfDir(userDataRoot);
    }

    const baseCwd = options.cwd || process.cwd();
    addIfDir(join(baseCwd, '.pokebot-browser-profile'));

    return [...found];
}

/**
 * Descobre diretorios existentes de Local Storage/leveldb de navegadores Chromium.
 * @param {object} [options] Opcoes de ambiente e diretorios extras para teste.
 * @returns {string[]} Caminhos unicos de diretorios leveldb encontrados.
 */
export function discoverBrowserLevelDbDirs(options = {}) {
    const plat = options.platform || platform();
    const home = options.homeDir || homedir();
    const localAppData = options.localAppData !== undefined
        ? options.localAppData
        : (options.homeDir ? join(home, 'AppData', 'Local') : process.env.LOCALAPPDATA);

    const found = new Set();
    const addIfDir = (candidate) => {
        if (!candidate) return;
        const resolved = resolve(candidate);
        if (isExistingDir(resolved)) {
            found.add(resolved);
        }
    };

    if (Array.isArray(options.extraDirs)) {
        for (const extra of options.extraDirs) {
            if (!extra) continue;
            const nested = join(extra, 'Local Storage', 'leveldb');
            if (isExistingDir(nested)) {
                found.add(resolve(nested));
            } else {
                addIfDir(extra);
            }
        }
    }
    if (options.onlyExtraDirs) return Array.from(found);

    const baseCwd = options.cwd || process.cwd();
    const embeddedRoot = join(baseCwd, '.pokebot-browser-profile');
    addIfDir(join(embeddedRoot, 'Default', 'Local Storage', 'leveldb'));
    addIfDir(join(embeddedRoot, 'Local Storage', 'leveldb'));
    if (options.onlyEmbeddedProfile) return Array.from(found);

    const roots = collectBrowserUserDataRoots(plat, home, localAppData);
    for (const userDataRoot of roots) {
        if (!isExistingDir(userDataRoot)) continue;
        let entries;
        try {
            entries = readdirSync(userDataRoot, { withFileTypes: true });
        } catch {
            continue;
        }
        const profileNames = entries
            .filter((entry) => entry.isDirectory() && (entry.name === 'Default' || entry.name.startsWith('Profile ')))
            .map((entry) => entry.name)
            .sort((a, b) => {
                if (a === 'Default') return -1;
                if (b === 'Default') return 1;
                return a.localeCompare(b);
            });

        for (const profileName of profileNames) {
            addIfDir(join(userDataRoot, profileName, 'Local Storage', 'leveldb'));
        }
    }

    return [...found];
}

function extractBalancedJson(text, startIdx) {
    if (!text || startIdx < 0 || startIdx >= text.length || text[startIdx] !== '{') {
        return null;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                const candidate = text.slice(startIdx, i + 1);
                try {
                    const obj = JSON.parse(candidate);
                    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

function decodeValueStrings(rawValue) {
    if (!rawValue || rawValue.length === 0) return [];
    const results = [];
    const tag = rawValue[0];
    if (tag === 0x01) {
        const body = rawValue.subarray(1);
        const utf8 = body.toString('utf8');
        results.push(utf8);
        if (utf8.includes('\ufffd')) {
            results.push(body.toString('latin1'));
        }
        return results;
    }
    if (tag === 0x00) {
        const body = rawValue.subarray(1);
        const evenLen = body.length - (body.length % 2);
        if (evenLen > 0) {
            results.push(body.subarray(0, evenLen).toString('utf16le'));
        }
        return results;
    }
    results.push(rawValue.toString('utf8'));
    return results;
}

function classifyLocalStorageKey(keyBuf) {
    if (!keyBuf || keyBuf.length === 0) return null;

    const parseParts = (originText, keyText) => {
        if (!originText || !keyText) return null;
        if (/^_?META(?:ACCESS)?:/i.test(originText)) return null;
        if (!/pokeidle\.io\b/i.test(originText)) return null;
        const cleanKey = keyText.replace(/\0+$/, '');
        if (cleanKey === 'sessao') return 'sessao';
        if (cleanKey === 'id-dispositivo') return 'id-dispositivo';
        if (cleanKey === 'pokeidle_hud_prefs_v60') return 'prefs-v60';
        if (cleanKey.endsWith('_hud_prefs_v4')) return 'prefs-v4';
        return null;
    };

    const sepIdx = keyBuf.indexOf(0x00);
    if (sepIdx > 0 && sepIdx + 1 < keyBuf.length) {
        const originText = keyBuf.subarray(0, sepIdx).toString('utf8');
        const marker = keyBuf[sepIdx + 1];
        if (marker === 0x01) {
            const matched = parseParts(originText, keyBuf.subarray(sepIdx + 2).toString('utf8'));
            if (matched) return matched;
        } else if (marker === 0x00) {
            const rest = keyBuf.subarray(sepIdx + 2);
            const evenLen = rest.length - (rest.length % 2);
            const matched = parseParts(originText, rest.subarray(0, evenLen).toString('utf16le'));
            if (matched) return matched;
        } else {
            const matched = parseParts(originText, keyBuf.subarray(sepIdx + 1).toString('utf8'));
            if (matched) return matched;
        }
    }

    if (keyBuf.length >= 4 && keyBuf[1] === 0x00) {
        const evenLen = keyBuf.length - (keyBuf.length % 2);
        const text16 = keyBuf.subarray(0, evenLen).toString('utf16le');
        const nullIdx = text16.indexOf('\0');
        if (nullIdx > 0) {
            const originText = text16.slice(0, nullIdx);
            const restText = text16.slice(nullIdx + 1).replace(/^[\u0000\u0001]/, '');
            const matched = parseParts(originText, restText);
            if (matched) return matched;
        }
    }

    return null;
}

function recordEntry(collector, keyKind, rawValue, meta) {
    const texts = decodeValueStrings(rawValue);
    if (keyKind === 'sessao') {
        for (const text of texts) {
            const braceIdx = text.indexOf('{');
            if (braceIdx === -1) continue;
            const parsed = extractBalancedJson(text, braceIdx);
            if (!parsed || typeof parsed.nick !== 'string' || !parsed.nick || typeof parsed.token !== 'string' || !parsed.token) {
                continue;
            }
            const payload = decodeJwtPayload(parsed.token);
            if (!payload) continue;
            collector.sessions.push({
                nick: parsed.nick,
                token: parsed.token,
                provedor: parsed.provedor || payload.provedor || null,
                payload,
                exp: Number(payload.exp || 0),
                ...meta,
            });
            return;
        }
        return;
    }

    if (keyKind === 'id-dispositivo') {
        for (const text of texts) {
            const cleaned = text.trim().replace(/^["']|["']$/g, '');
            if (UUID_EXACT_RE.test(cleaned)) {
                collector.devices.push({ uuid: cleaned, ...meta });
                return;
            }
            const match = text.match(UUID_RE);
            if (match) {
                collector.devices.push({ uuid: match[0], ...meta });
                return;
            }
        }
        return;
    }

    if (keyKind === 'prefs-v60' || keyKind === 'prefs-v4') {
        for (const text of texts) {
            const braceIdx = text.indexOf('{');
            if (braceIdx === -1) continue;
            const parsed = extractBalancedJson(text, braceIdx);
            if (parsed) {
                collector.prefs.push({
                    prefs: parsed,
                    isV60: keyKind === 'prefs-v60',
                    ...meta,
                });
                return;
            }
        }
    }
}

function parseLevelDbBlockEntries(block) {
    if (!block || block.length < 4) return [];
    const numRestarts = block.readUInt32LE(block.length - 4);
    const trailerBytes = (numRestarts + 1) * 4;
    if (trailerBytes > block.length) return [];
    const entriesEnd = block.length - trailerBytes;

    const entries = [];
    let pos = 0;
    let prevKey = Buffer.alloc(0);

    while (pos < entriesEnd) {
        let shared;
        let nonShared;
        let valLen;
        try {
            const r1 = readVarint64(block, pos);
            const r2 = readVarint64(block, r1.nextPos);
            const r3 = readVarint64(block, r2.nextPos);
            shared = r1.value;
            nonShared = r2.value;
            valLen = r3.value;
            pos = r3.nextPos;
        } catch {
            break;
        }
        if (shared < 0 || nonShared < 0 || valLen < 0 || shared > prevKey.length || pos + nonShared + valLen > entriesEnd) {
            break;
        }
        const key = Buffer.concat([prevKey.subarray(0, shared), block.subarray(pos, pos + nonShared)]);
        pos += nonShared;
        const value = block.subarray(pos, pos + valLen);
        pos += valLen;
        prevKey = key;
        entries.push({ key, value });
    }

    return entries;
}

function readLevelDbBlock(buf, offset, size) {
    if (offset < 0 || size < 0 || offset + size + LEVELDB_BLOCK_TRAILER_SIZE > buf.length) {
        throw new Error('Bloco LevelDB fora dos limites');
    }
    const compressionType = buf[offset + size];
    const slice = buf.subarray(offset, offset + size);
    if (compressionType === 0) return slice;
    if (compressionType === 1) return snappyDecompress(slice);
    throw new Error(`Tipo de compressao LevelDB desconhecido: ${compressionType}`);
}

function extractFromLdbStructured(buf, fileMeta, collector) {
    if (buf.length < LEVELDB_FOOTER_SIZE) return false;
    const magic = buf.readBigUInt64LE(buf.length - 8);
    if (magic !== LEVELDB_MAGIC) return false;

    const footerStart = buf.length - LEVELDB_FOOTER_SIZE;
    let indexHandle;
    try {
        const metaOff = readVarint64(buf, footerStart);
        const metaSize = readVarint64(buf, metaOff.nextPos);
        const idxOff = readVarint64(buf, metaSize.nextPos);
        const idxSize = readVarint64(buf, idxOff.nextPos);
        indexHandle = { offset: idxOff.value, size: idxSize.value };
    } catch {
        return false;
    }

    let indexBlock;
    try {
        indexBlock = readLevelDbBlock(buf, indexHandle.offset, indexHandle.size);
    } catch {
        return false;
    }

    const indexEntries = parseLevelDbBlockEntries(indexBlock);
    if (indexEntries.length === 0) return false;

    let decodedAnyBlock = false;
    for (const idxEntry of indexEntries) {
        let blockOffset;
        let blockSize;
        try {
            const h1 = readVarint64(idxEntry.value, 0);
            const h2 = readVarint64(idxEntry.value, h1.nextPos);
            blockOffset = h1.value;
            blockSize = h2.value;
        } catch {
            continue;
        }

        let dataBlock;
        try {
            dataBlock = readLevelDbBlock(buf, blockOffset, blockSize);
            decodedAnyBlock = true;
        } catch {
            continue;
        }

        const dataEntries = parseLevelDbBlockEntries(dataBlock);
        for (let i = 0; i < dataEntries.length; i++) {
            const { key, value } = dataEntries[i];
            if (value.length === 0) continue;

            let keyKind = null;
            if (key.length >= 8) {
                const valueType = key[key.length - 8];
                if (valueType === 0) continue;
                keyKind = classifyLocalStorageKey(key.subarray(0, key.length - 8));
            }
            if (!keyKind) {
                keyKind = classifyLocalStorageKey(key);
            }
            if (keyKind) {
                recordEntry(collector, keyKind, value, {
                    ...fileMeta,
                    offset: blockOffset + i,
                });
            }
        }

        scanRawBuffer(dataBlock, { ...fileMeta, baseOffset: blockOffset }, collector);
    }

    return decodedAnyBlock;
}

function parseWriteBatchRecords(batchBuf, baseMeta, collector) {
    if (batchBuf.length < 12) return;
    const count = batchBuf.readUInt32LE(8);
    let pos = 12;
    for (let i = 0; i < count && pos < batchBuf.length; i++) {
        const valType = batchBuf[pos++];
        let keyLen;
        try {
            const r = readVarint64(batchBuf, pos);
            keyLen = r.value;
            pos = r.nextPos;
        } catch {
            break;
        }
        if (keyLen < 0 || pos + keyLen > batchBuf.length) break;
        const keyBuf = batchBuf.subarray(pos, pos + keyLen);
        pos += keyLen;

        if (valType === 1) {
            let valLen;
            try {
                const r = readVarint64(batchBuf, pos);
                valLen = r.value;
                pos = r.nextPos;
            } catch {
                break;
            }
            if (valLen < 0 || pos + valLen > batchBuf.length) break;
            const valBuf = batchBuf.subarray(pos, pos + valLen);
            pos += valLen;

            const keyKind = classifyLocalStorageKey(keyBuf);
            if (keyKind) {
                recordEntry(collector, keyKind, valBuf, {
                    ...baseMeta,
                    offset: baseMeta.baseOffset + pos,
                });
            }
        } else if (valType !== 0) {
            break;
        }
    }
}

function extractFromLogWal(buf, fileMeta, collector) {
    let pos = 0;
    let fragments = [];
    let fragmentOffset = 0;

    while (pos < buf.length) {
        const blockOffset = pos % LEVELDB_LOG_BLOCK_SIZE;
        const blockRemaining = LEVELDB_LOG_BLOCK_SIZE - blockOffset;
        if (blockRemaining < LEVELDB_LOG_HEADER_SIZE) {
            pos += blockRemaining;
            continue;
        }
        if (pos + LEVELDB_LOG_HEADER_SIZE > buf.length) break;

        const len = buf.readUInt16LE(pos + 4);
        const type = buf[pos + 6];
        if (type === 0 && len === 0) {
            pos += blockRemaining;
            continue;
        }
        if (type < 1 || type > 4 || len > blockRemaining - LEVELDB_LOG_HEADER_SIZE || pos + LEVELDB_LOG_HEADER_SIZE + len > buf.length) {
            fragments = [];
            pos += blockRemaining;
            continue;
        }

        const chunk = buf.subarray(pos + LEVELDB_LOG_HEADER_SIZE, pos + LEVELDB_LOG_HEADER_SIZE + len);
        const chunkStart = pos;
        pos += LEVELDB_LOG_HEADER_SIZE + len;

        if (type === 1) {
            fragments = [];
            parseWriteBatchRecords(chunk, { ...fileMeta, baseOffset: chunkStart }, collector);
        } else if (type === 2) {
            fragments = [chunk];
            fragmentOffset = chunkStart;
        } else if (type === 3) {
            if (fragments.length > 0) fragments.push(chunk);
        } else if (type === 4) {
            if (fragments.length > 0) {
                fragments.push(chunk);
                const fullBatch = Buffer.concat(fragments);
                fragments = [];
                parseWriteBatchRecords(fullBatch, { ...fileMeta, baseOffset: fragmentOffset }, collector);
            }
        }
    }
}

function hasPokeidleOriginNearby(buf, keyPos) {
    const winStart = Math.max(0, keyPos - 384);
    const windowSlice = buf.subarray(winStart, keyPos);

    const checkTextOrigin = (text) => {
        if (!text) return false;
        const originMatches = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)];
        if (originMatches.length > 0) {
            const last = originMatches[originMatches.length - 1];
            const idx = last.index ?? 0;
            const prefix = text.slice(Math.max(0, idx - 11), idx);
            if (/META(?:ACCESS)?:$/i.test(prefix)) return false;
            return /(?:^|\.)pokeidle\.io$/i.test(last[1]);
        }
        return /pokeidle\.io/i.test(text);
    };

    const utf8Win = windowSlice.toString('utf8');
    if (checkTextOrigin(utf8Win)) return true;

    const evenStart = windowSlice.length % 2;
    if (windowSlice.length - evenStart >= 16) {
        const utf16Win = windowSlice.subarray(evenStart).toString('utf16le');
        if (checkTextOrigin(utf16Win)) return true;
    }
    return false;
}

function isKeyBoundaryValid(buf, keyPos, keyByteLen, isUtf16) {
    if (keyPos > 0) {
        const prev = buf[keyPos - 1];
        if ((prev >= 0x41 && prev <= 0x5a) || (prev >= 0x61 && prev <= 0x7a) || (prev >= 0x30 && prev <= 0x39)) {
            if (!isUtf16 || prev !== 0x00) return false;
        }
    }
    const afterPos = keyPos + keyByteLen;
    if (afterPos < buf.length) {
        const next = buf[afterPos];
        if ((next >= 0x41 && next <= 0x5a) || (next >= 0x61 && next <= 0x7a) || (next >= 0x30 && next <= 0x39) || next === 0x5f) {
            return false;
        }
    }
    return true;
}

function extractRawValueAfterKey(buf, afterKeyPos, kind) {
    const searchEnd = Math.min(buf.length, afterKeyPos + 40);

    if (kind === 'id-dispositivo') {
        const slice = buf.subarray(afterKeyPos, Math.min(buf.length, afterKeyPos + 128));
        const utf8 = slice.toString('utf8');
        const m8 = utf8.match(UUID_RE);
        if (m8) return m8[0];

        for (const offsetMod of [0, 1]) {
            const sub = slice.subarray(offsetMod);
            const evenLen = sub.length - (sub.length % 2);
            if (evenLen >= 72) {
                const utf16 = sub.subarray(0, evenLen).toString('utf16le');
                const m16 = utf16.match(UUID_RE);
                if (m16) return m16[0];
            }
        }
        return null;
    }

    for (let p = afterKeyPos; p < searchEnd; p++) {
        if (buf[p] !== 0x7b) continue;
        if (p + 3 < buf.length && buf[p + 1] === 0x00 && (buf[p + 2] === 0x22 || buf[p + 2] === 0x7d || buf[p + 2] === 0x20)) {
            const rawSlice = buf.subarray(p, Math.min(buf.length, p + 65536));
            const evenLen = rawSlice.length - (rawSlice.length % 2);
            const text16 = rawSlice.subarray(0, evenLen).toString('utf16le');
            const parsed16 = extractBalancedJson(text16, 0);
            if (parsed16) return parsed16;
        } else if (p + 1 >= buf.length || buf[p + 1] !== 0x00) {
            const text8 = buf.subarray(p, Math.min(buf.length, p + 65536)).toString('utf8');
            const parsed8 = extractBalancedJson(text8, 0);
            if (parsed8) return parsed8;
        }
    }

    return null;
}

const RAW_KEY_PATTERNS = [
    { kind: 'sessao', buf: Buffer.from('sessao', 'ascii'), utf16: false },
    { kind: 'sessao', buf: Buffer.from('sessao', 'utf16le'), utf16: true },
    { kind: 'id-dispositivo', buf: Buffer.from('id-dispositivo', 'ascii'), utf16: false },
    { kind: 'id-dispositivo', buf: Buffer.from('id-dispositivo', 'utf16le'), utf16: true },
    { kind: 'prefs-v60', buf: Buffer.from('pokeidle_hud_prefs_v60', 'ascii'), utf16: false },
    { kind: 'prefs-v60', buf: Buffer.from('pokeidle_hud_prefs_v60', 'utf16le'), utf16: true },
    { kind: 'prefs-v4', buf: Buffer.from('_hud_prefs_v4', 'ascii'), utf16: false },
    { kind: 'prefs-v4', buf: Buffer.from('_hud_prefs_v4', 'utf16le'), utf16: true },
];

function scanRawBuffer(buf, fileMeta, collector) {
    if (!buf || buf.length === 0) return;
    const baseOffset = fileMeta.baseOffset || 0;

    for (const pat of RAW_KEY_PATTERNS) {
        let searchPos = 0;
        while (searchPos < buf.length) {
            const hit = buf.indexOf(pat.buf, searchPos);
            if (hit === -1) break;
            searchPos = hit + pat.buf.length;

            if (!isKeyBoundaryValid(buf, hit, pat.buf.length, pat.utf16)) continue;
            if (!hasPokeidleOriginNearby(buf, hit)) continue;

            const afterKey = hit + pat.buf.length;
            const extracted = extractRawValueAfterKey(buf, afterKey, pat.kind);
            if (!extracted) continue;

            const offset = baseOffset + hit;
            if (pat.kind === 'sessao') {
                if (typeof extracted.nick === 'string' && extracted.nick && typeof extracted.token === 'string' && extracted.token) {
                    const payload = decodeJwtPayload(extracted.token);
                    if (payload) {
                        collector.sessions.push({
                            nick: extracted.nick,
                            token: extracted.token,
                            provedor: extracted.provedor || payload.provedor || null,
                            payload,
                            exp: Number(payload.exp || 0),
                            mtimeMs: fileMeta.mtimeMs,
                            isLog: fileMeta.isLog,
                            fileNum: fileMeta.fileNum,
                            offset,
                        });
                    }
                }
            } else if (pat.kind === 'id-dispositivo') {
                collector.devices.push({
                    uuid: extracted,
                    mtimeMs: fileMeta.mtimeMs,
                    isLog: fileMeta.isLog,
                    fileNum: fileMeta.fileNum,
                    offset,
                });
            } else {
                collector.prefs.push({
                    prefs: extracted,
                    isV60: pat.kind === 'prefs-v60',
                    mtimeMs: fileMeta.mtimeMs,
                    isLog: fileMeta.isLog,
                    fileNum: fileMeta.fileNum,
                    offset,
                });
            }
        }
    }
}

function scanLdbSnappyFallback(buf, fileMeta, collector) {
    const needles = [
        Buffer.from('pokeidle.io', 'ascii'),
        Buffer.from('sessao', 'ascii'),
        Buffer.from('id-dispositivo', 'ascii'),
        Buffer.from('pokeidle.io', 'utf16le'),
    ];
    const hitPositions = [];
    for (const needle of needles) {
        let pos = 0;
        while (pos < buf.length && hitPositions.length < 24) {
            const idx = buf.indexOf(needle, pos);
            if (idx === -1) break;
            hitPositions.push(idx);
            pos = idx + needle.length;
        }
    }
    if (hitPositions.length === 0) return;

    const triedStarts = new Set();
    for (const hitPos of hitPositions) {
        const winStart = Math.max(0, hitPos - 4096);
        for (let start = winStart; start < hitPos; start++) {
            if (triedStarts.has(start)) continue;
            const b0 = buf[start];
            let vLen;
            let firstTagPos;
            if ((b0 & 0x80) === 0) {
                vLen = b0;
                firstTagPos = start + 1;
            } else if (start + 2 < hitPos && (buf[start + 1] & 0x80) === 0) {
                vLen = (b0 & 0x7f) | (buf[start + 1] << 7);
                firstTagPos = start + 2;
            } else {
                continue;
            }
            if (vLen < 24 || vLen > 65536 || firstTagPos >= buf.length) continue;
            if ((buf[firstTagPos] & 0x03) !== 0) continue;

            triedStarts.add(start);
            try {
                const slice = buf.subarray(start, Math.min(buf.length, start + vLen + 64));
                const decompressed = snappyDecompressCore(slice, true);
                if (
                    decompressed.includes('pokeidle.io') ||
                    decompressed.includes('sessao') ||
                    decompressed.includes('id-dispositivo')
                ) {
                    const entries = parseLevelDbBlockEntries(decompressed);
                    for (let i = 0; i < entries.length; i++) {
                        const { key, value } = entries[i];
                        if (value.length === 0) continue;
                        let keyKind = key.length >= 8 && key[key.length - 8] !== 0
                            ? classifyLocalStorageKey(key.subarray(0, key.length - 8))
                            : null;
                        if (!keyKind) keyKind = classifyLocalStorageKey(key);
                        if (keyKind) {
                            recordEntry(collector, keyKind, value, {
                                ...fileMeta,
                                offset: start + i,
                            });
                        }
                    }
                    scanRawBuffer(decompressed, { ...fileMeta, baseOffset: start }, collector);
                }
            } catch {
                // inicio nao era bloco Snappy valido
            }
        }
    }
}

function compareSessionCandidates(a, b, nowMs) {
    const aValid = !a.exp || a.exp > nowMs + 60_000;
    const bValid = !b.exp || b.exp > nowMs + 60_000;
    if (aValid !== bValid) return bValid ? 1 : -1;

    if (Math.abs(b.mtimeMs - a.mtimeMs) > 1000) {
        return b.mtimeMs - a.mtimeMs;
    }
    if (a.exp !== b.exp) {
        return b.exp - a.exp;
    }
    if (a.isLog !== b.isLog) {
        return b.isLog ? 1 : -1;
    }
    if (a.fileNum !== b.fileNum) {
        return b.fileNum - a.fileNum;
    }
    if (a.mtimeMs !== b.mtimeMs) {
        return b.mtimeMs - a.mtimeMs;
    }
    return a.isLog ? b.offset - a.offset : a.offset - b.offset;
}

function compareGenericRecent(a, b) {
    if (Math.abs(b.mtimeMs - a.mtimeMs) > 1000) {
        return b.mtimeMs - a.mtimeMs;
    }
    if (a.isLog !== b.isLog) {
        return b.isLog ? 1 : -1;
    }
    if (a.fileNum !== b.fileNum) {
        return b.fileNum - a.fileNum;
    }
    if (a.mtimeMs !== b.mtimeMs) {
        return b.mtimeMs - a.mtimeMs;
    }
    return a.isLog ? b.offset - a.offset : a.offset - b.offset;
}

function parseFileNum(name) {
    const m = name.match(/^([0-9a-f]+)\.(ldb|log)$/i);
    if (!m) return 0;
    const parsed = Number.parseInt(m[1], 16);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Extrai sessao do Pokeidle, id-dispositivo e preferencias de um diretorio LevelDB.
 * @param {string} dirPath Caminho para pasta leveldb do navegador.
 * @returns {object|null} Dados da sessao mais recente ou null se ausente.
 */
export function extractSessionFromLevelDbDir(dirPath) {
    if (!dirPath || !isExistingDir(dirPath)) return null;

    let fileNames;
    try {
        fileNames = readdirSync(dirPath).filter((f) => f.endsWith('.ldb') || f.endsWith('.log'));
    } catch {
        return null;
    }
    if (fileNames.length === 0) return null;

    const collector = {
        sessions: [],
        devices: [],
        prefs: [],
    };

    for (const name of fileNames) {
        const fullPath = join(dirPath, name);
        let st;
        let buf;
        try {
            st = statSync(fullPath);
            if (!st.isFile() || st.size === 0) continue;
            buf = readFileSync(fullPath);
        } catch {
            continue;
        }

        const isLog = name.endsWith('.log');
        const fileMeta = {
            mtimeMs: st.mtimeMs,
            isLog,
            fileNum: parseFileNum(name),
            baseOffset: 0,
        };

        if (isLog) {
            extractFromLogWal(buf, fileMeta, collector);
            scanRawBuffer(buf, fileMeta, collector);
        } else {
            const beforeSess = collector.sessions.length;
            const beforeDev = collector.devices.length;
            const structuredOk = extractFromLdbStructured(buf, fileMeta, collector);
            scanRawBuffer(buf, fileMeta, collector);
            if (!structuredOk || (collector.sessions.length === beforeSess && collector.devices.length === beforeDev)) {
                if (collector.sessions.length === beforeSess || collector.devices.length === beforeDev) {
                    scanLdbSnappyFallback(buf, fileMeta, collector);
                }
            }
        }
    }

    if (collector.sessions.length === 0) return null;

    const nowMs = Date.now();
    collector.sessions.sort((a, b) => compareSessionCandidates(a, b, nowMs));
    const bestSession = collector.sessions[0];

    let dispositivo = null;
    if (collector.devices.length > 0) {
        collector.devices.sort(compareGenericRecent);
        dispositivo = collector.devices[0].uuid;
    }

    let prefs = null;
    if (collector.prefs.length > 0) {
        collector.prefs.sort((a, b) => {
            if (a.isV60 !== b.isV60) return b.isV60 ? 1 : -1;
            return compareGenericRecent(a, b);
        });
        prefs = collector.prefs[0].prefs;
    }

    return {
        nick: bestSession.nick,
        token: bestSession.token,
        provedor: bestSession.provedor,
        dispositivo,
        prefs,
        mtimeMs: bestSession.mtimeMs,
        payload: bestSession.payload,
        sourceDir: resolve(dirPath),
    };
}

function resolveDefaultCachePath(cachePath, cwd) {
    return cachePath ? resolve(cachePath) : resolve(cwd || process.cwd(), '.pokebot-session.json');
}

const SESSION_CONTEXT = 'pokebot-session';

/**
 * Carrega o cache local da sessao headless se existir e for JSON valido.
 * @param {string} [cachePath] Caminho do arquivo de cache.
 * @returns {object|null} Dados cacheados ou null.
 */
export function loadSessionCache(cachePath) {
    const target = resolveDefaultCachePath(cachePath);
    if (!existsSync(target)) return null;
    try {
        const raw = readFileSync(target, 'utf8').trim();
        const encrypted = isEncrypted(raw);
        const text = encrypted ? decryptText(raw, SESSION_CONTEXT) : raw;
        if (text === null) return null;
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        // Arquivo antigo em texto puro: assim que for lido, regrava criptografado.
        if (!encrypted && isSecretStoreAvailable()) {
            try { writeSessionFile(target, parsed); } catch { /* segue com a leitura */ }
        }
        return parsed;
    } catch {
        return null;
    }
}

function writeSessionFile(target, data) {
    const json = JSON.stringify(data, null, 2) + '\n';
    const sealed = encryptText(json, SESSION_CONTEXT);
    writeFileSync(target, sealed ? `${sealed}\n` : json, { encoding: 'utf8', mode: 0o600 });
    try {
        chmodSync(target, 0o600);
    } catch {
        // Ignora sistemas sem suporte a chmod POSIX
    }
}

/**
 * Grava o cache da sessao headless em JSON formatado com permissao restrita quando suportada.
 * @param {string} [cachePath] Caminho do arquivo de cache.
 * @param {object} sessionData Dados da sessao a persistir.
 * @returns {object} Objeto efetivamente gravado no cache.
 */
export function saveSessionCache(cachePath, sessionData) {
    const target = resolveDefaultCachePath(cachePath);
    mkdirSync(dirname(target), { recursive: true });
    const data = {
        nick: sessionData.nick,
        token: sessionData.token,
        provedor: sessionData.provedor ?? null,
        dispositivo: sessionData.dispositivo ?? null,
        updatedAt: sessionData.updatedAt ?? Date.now(),
    };
    writeSessionFile(target, data);
    return data;
}

function isTokenValid(payload, nowMs) {
    return Boolean(payload && (!payload.exp || Number(payload.exp) > nowMs + 60_000));
}

function scanAllLevelDbSessions(options, nowMs) {
    const dirs = discoverBrowserLevelDbDirs(options);
    const results = [];
    for (const dir of dirs) {
        const extracted = extractSessionFromLevelDbDir(dir);
        if (extracted) {
            results.push(extracted);
        }
    }
    results.sort((a, b) => {
        const aValid = isTokenValid(a.payload, nowMs);
        const bValid = isTokenValid(b.payload, nowMs);
        if (aValid !== bValid) return bValid ? 1 : -1;
        const aExp = Number(a.payload?.exp || 0);
        const bExp = Number(b.payload?.exp || 0);
        if (Math.abs(b.mtimeMs - a.mtimeMs) > 1000) return b.mtimeMs - a.mtimeMs;
        if (aExp !== bExp) return bExp - aExp;
        return b.mtimeMs - a.mtimeMs;
    });
    return results;
}

/**
 * Resolve a sessao headless ativa respeitando prioridade explicit > env > cache/LevelDB.
 * @param {object} [options] Opcoes de resolucao (nick, token, sessionFile, cwd, env, etc.).
 * @returns {object} Sessao resolvida com token, dispositivo, prefs, payload e origem.
 */
export function resolveHeadlessSession(options = {}) {
    const nowMs = Number(options.nowMs ?? Date.now());
    const cachePath = options.sessionFile
        ? resolve(options.sessionFile)
        : resolve(options.cwd || process.cwd(), '.pokebot-session.json');
    const cached = loadSessionCache(cachePath);
    const env = options.env || process.env;

    const resolveDeviceAndPrefs = (preferredDevice) => {
        let dispositivo = preferredDevice || cached?.dispositivo || null;
        let prefs = options.prefs ?? null;
        if (!dispositivo || prefs === null) {
            const dbList = scanAllLevelDbSessions(options, nowMs);
            if (!dispositivo) {
                dispositivo = dbList.find((item) => item.dispositivo)?.dispositivo || null;
            }
            if (prefs === null) {
                prefs = dbList.find((item) => item.prefs)?.prefs || null;
            }
        }
        if (!dispositivo) {
            dispositivo = randomUUID();
        }
        return { dispositivo, prefs };
    };

    if (options.nick && options.token) {
        const payload = decodeJwtPayload(options.token);
        const { dispositivo, prefs } = resolveDeviceAndPrefs(options.dispositivo);
        return {
            nick: options.nick,
            token: options.token,
            provedor: options.provedor ?? payload?.provedor ?? cached?.provedor ?? null,
            dispositivo,
            prefs,
            payload,
            source: 'explicit',
            cachePath,
        };
    }

    if (env.POKEIDLE_NICK && env.POKEIDLE_TOKEN) {
        const payload = decodeJwtPayload(env.POKEIDLE_TOKEN);
        const { dispositivo, prefs } = resolveDeviceAndPrefs(options.dispositivo || env.POKEIDLE_DISPOSITIVO);
        return {
            nick: env.POKEIDLE_NICK,
            token: env.POKEIDLE_TOKEN,
            provedor: options.provedor ?? payload?.provedor ?? cached?.provedor ?? null,
            dispositivo,
            prefs,
            payload,
            source: 'env',
            cachePath,
        };
    }

    const cachedPayload = cached?.token ? decodeJwtPayload(cached.token) : null;
    const cachedValid = Boolean(cached?.nick && cached?.token && isTokenValid(cachedPayload, nowMs));

    const dbList = scanAllLevelDbSessions(options, nowMs);
    const dbValidList = dbList.filter((item) => isTokenValid(item.payload, nowMs));
    const dbBest = dbValidList[0] || null;
    const dbAnyDevice = dbList.find((item) => item.dispositivo)?.dispositivo || null;
    const dbAnyPrefs = dbList.find((item) => item.prefs)?.prefs || null;

    if (!cachedValid && !dbBest) {
        throw new Error(
            'Nenhuma sessao valida do Pokeidle encontrada. Abra https://pokeidle.io/app e faca login no navegador, ou informe --nick e --token.'
        );
    }

    let chosenSource = 'cache';
    if (dbBest && !cachedValid) {
        chosenSource = 'leveldb';
    } else if (dbBest && cachedValid && !options.preferSessionCache) {
        const dbExp = Number(dbBest.payload?.exp || 0);
        const cacheExp = Number(cachedPayload?.exp || 0);
        const dbTs = Number(dbBest.mtimeMs || 0);
        const cacheTs = Number(cached.updatedAt || 0);

        if (dbExp !== cacheExp) {
            chosenSource = dbExp > cacheExp ? 'leveldb' : 'cache';
        } else if (dbTs !== cacheTs) {
            chosenSource = dbTs > cacheTs ? 'leveldb' : 'cache';
        }
    }

    if (chosenSource === 'leveldb') {
        const dispositivo = dbBest.dispositivo || cached?.dispositivo || dbAnyDevice || randomUUID();
        const prefs = dbBest.prefs || dbAnyPrefs || null;
        saveSessionCache(cachePath, {
            nick: dbBest.nick,
            token: dbBest.token,
            provedor: dbBest.provedor,
            dispositivo,
            updatedAt: nowMs,
        });
        return {
            nick: dbBest.nick,
            token: dbBest.token,
            provedor: dbBest.provedor,
            dispositivo,
            prefs,
            payload: dbBest.payload,
            source: 'leveldb',
            cachePath,
        };
    }

    const dispositivo = cached.dispositivo || dbAnyDevice || randomUUID();
    const prefs = dbBest?.prefs || dbAnyPrefs || null;
    if (!cached.dispositivo) {
        saveSessionCache(cachePath, {
            nick: cached.nick,
            token: cached.token,
            provedor: cached.provedor ?? cachedPayload?.provedor ?? null,
            dispositivo,
            updatedAt: cached.updatedAt ?? nowMs,
        });
    }

    return {
        nick: cached.nick,
        token: cached.token,
        provedor: cached.provedor ?? cachedPayload?.provedor ?? null,
        dispositivo,
        prefs,
        payload: cachedPayload,
        source: 'cache',
        cachePath,
    };
}
