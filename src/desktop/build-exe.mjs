// Gera/copia o icone dist/nexo-pokebot.ico e compila Nexo PokeBot.exe via csc.exe (.NET Framework 4.x).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ASSET_ICO_PATH = join(ROOT, 'assets', 'nexo-pokebot.ico');

/**
 * Retorna o buffer do icone multi-resolucao oficial do Nexo PokeBot (16..256px),
 * com fallback procedural de 32x32 em estilo orbe ciano/obsidiana caso o asset nao exista.
 * @returns {Buffer} Conteudo binario do arquivo .ico.
 */
export function buildPokeballIconBuffer() {
    if (existsSync(ASSET_ICO_PATH)) {
        return readFileSync(ASSET_ICO_PATH);
    }
    const size = 32;
    const pixelBytes = size * size * 4;
    const maskBytes = size * 4;
    const headerSize = 40;
    const imageSize = headerSize + pixelBytes + maskBytes;

    const buf = Buffer.alloc(6 + 16 + imageSize);

    // ICONDIR (6 bytes)
    buf.writeUInt16LE(0, 0);
    buf.writeUInt16LE(1, 2);
    buf.writeUInt16LE(1, 4);

    // ICONDIRENTRY (16 bytes)
    buf[6] = size;
    buf[7] = size;
    buf[8] = 0;
    buf[9] = 0;
    buf.writeUInt16LE(1, 10);
    buf.writeUInt16LE(32, 12);
    buf.writeUInt32LE(imageSize, 14);
    buf.writeUInt32LE(22, 18);

    // BITMAPINFOHEADER (40 bytes)
    const bmpOff = 22;
    buf.writeUInt32LE(headerSize, bmpOff);
    buf.writeInt32LE(size, bmpOff + 4);
    buf.writeInt32LE(size * 2, bmpOff + 8); // XOR + AND masks
    buf.writeUInt16LE(1, bmpOff + 12);
    buf.writeUInt16LE(32, bmpOff + 14);
    buf.writeUInt32LE(0, bmpOff + 16);
    buf.writeUInt32LE(pixelBytes, bmpOff + 20);

    const cx = 15.5;
    const cy = 15.5;
    const outerR = 14.4;
    const innerR = 11.9;
    const centerOuterR = 4.6;
    const centerInnerR = 2.6;

    const setPixel = (x, yTop, r, g, b, a) => {
        const yBottom = size - 1 - yTop;
        const off = bmpOff + headerSize + (yBottom * size + x) * 4;
        buf[off] = b;
        buf[off + 1] = g;
        buf[off + 2] = r;
        buf[off + 3] = a;
    };

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.hypot(dx, dy);

            if (dist > outerR + 0.6) {
                setPixel(x, y, 0, 0, 0, 0);
                continue;
            }

            const alpha = dist > outerR - 0.6
                ? Math.max(0, Math.min(255, Math.round((outerR + 0.6 - dist) * 210)))
                : 255;

            if (dist <= centerInnerR) {
                setPixel(x, y, 165, 243, 252, alpha);
            } else if (dist <= centerOuterR || dist >= innerR || Math.abs(dy) <= 1.65) {
                setPixel(x, y, 11, 19, 36, alpha);
            } else if (dy < 0) {
                const hi = Math.hypot(dx + 4.2, dy + 4.2) < 3.6;
                setPixel(x, y, hi ? 56 : 14, hi ? 189 : 165, hi ? 248 : 233, alpha);
            } else {
                setPixel(x, y, 30, 41, 59, alpha);
            }
        }
    }

    return buf;
}

export const loadAppIconBuffer = buildPokeballIconBuffer;

function findCscExe() {
    const candidates = [
        'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',
        'C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe',
    ];
    for (const c of candidates) {
        if (existsSync(c)) return c;
    }
    throw new Error('Compilador csc.exe (.NET Framework 4.0) nao encontrado no Windows.');
}

/**
 * Compila PokeBotApp.cs em dist/Nexo PokeBot.exe e copia para Nexo PokeBot.exe na raiz do projeto.
 * @param {object} [options] Caminhos opcionais para teste ou customizacao.
 * @returns {{ icoPath: string, distExePath: string, rootExePath: string, rootUpdated: boolean }} Caminhos gerados.
 */
export function buildDesktopExecutable(options = {}) {
    const rootDir = options.rootDir || ROOT;
    const distDir = join(rootDir, 'dist');
    mkdirSync(distDir, { recursive: true });

    const icoBuf = loadAppIconBuffer();
    const icoPath = join(distDir, 'nexo-pokebot.ico');
    writeFileSync(icoPath, icoBuf);
    writeFileSync(join(distDir, 'pokebot.ico'), icoBuf);

    const csPath = join(rootDir, 'src', 'desktop', 'PokeBotApp.cs');
    const distExePath = join(distDir, 'Nexo PokeBot.exe');
    const rootExePath = join(rootDir, 'Nexo PokeBot.exe');
    const cscExe = findCscExe();

    execFileSync(
        cscExe,
        [
            '/nologo',
            '/target:winexe',
            '/optimize+',
            '/codepage:65001',
            `/win32icon:${icoPath}`,
            `/out:${distExePath}`,
            '/r:System.dll',
            '/r:System.Core.dll',
            '/r:System.Drawing.dll',
            '/r:System.Windows.Forms.dll',
            '/r:System.Web.Extensions.dll',
            csPath,
        ],
        { cwd: rootDir, stdio: 'pipe', encoding: 'utf8' }
    );

    let rootUpdated = false;
    try {
        copyFileSync(distExePath, rootExePath);
        rootUpdated = true;
    } catch (err) {
        if (err?.code !== 'EBUSY' && err?.code !== 'EPERM') throw err;
    }
    return { icoPath, distExePath, rootExePath, rootUpdated };
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
    const res = buildDesktopExecutable();
    console.log(`OK  ${res.distExePath}`);
    if (res.rootUpdated) {
        console.log(`OK  ${res.rootExePath}`);
    } else {
        console.log(`WARN ${res.rootExePath} em uso (EBUSY); feche o app para atualizar o executavel da raiz.`);
    }
}
