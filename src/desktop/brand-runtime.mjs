// Prepara uma copia do runtime Electron renomeada para "Nexo PokeBot.exe" com icone e metadados PE proprios
// para exibicao correta no Gerenciador de Tarefas, Barra de Tarefas e Bandeja do Windows.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

export const BRAND_APP_NAME = 'Nexo PokeBot';
export const BRAND_EXE_NAME = 'Nexo PokeBot.exe';
export const BRAND_COMPANY = 'Nexo';
export const BRAND_AUMID = 'com.nexo.pokebot';

function parseSemverParts(versionStr) {
    const parts = String(versionStr || '1.0.0').split('.').map((n) => Number.parseInt(n, 10) || 0);
    return [parts[0] || 1, parts[1] || 0, parts[2] || 0, 0];
}

/**
 * Garante que o binario base do Electron exista na versao declarada em node_modules/electron/package.json.
 * @param {string} [rootDir] Diretorio raiz do projeto.
 * @returns {{ electronDist: string, electronExe: string, electronVersion: string }} Caminhos do runtime base.
 */
export function ensureElectronDist(rootDir = ROOT) {
    const electronDir = join(rootDir, 'node_modules', 'electron');
    const electronDist = join(electronDir, 'dist');
    const electronExe = join(electronDist, 'electron.exe');
    const installer = join(electronDir, 'install.js');
    if (!existsSync(installer)) {
        throw new Error('Dependencias do Electron ausentes. Execute npm ci.');
    }
    const electronVersion = JSON.parse(readFileSync(join(electronDir, 'package.json'), 'utf8')).version;
    const distVersionPath = join(electronDist, 'version');
    const currentDistVersion = existsSync(distVersionPath) ? readFileSync(distVersionPath, 'utf8').trim() : '';
    if (!existsSync(electronExe) || currentDistVersion !== electronVersion) {
        execFileSync(process.execPath, [installer], { cwd: rootDir, stdio: 'inherit' });
    }
    if (!existsSync(electronExe)) {
        throw new Error(`Runtime Electron ausente em ${electronExe}.`);
    }
    return { electronDist, electronExe, electronVersion };
}

/**
 * Aplica icone multi-resolucao e metadados PE (FileDescription, ProductName, OriginalFilename, versao)
 * em um executavel Windows copiado do Electron.
 * @param {object} params Origem, destino, caminho do ICO e versao do app.
 * @returns {string} Caminho final do executavel gravado.
 */
export function patchElectronExecutable({ sourceExe, targetExe, icoPath, version = '1.0.0' }) {
    const exeBuf = readFileSync(sourceExe);
    const icoBuf = readFileSync(icoPath);
    const exe = NtExecutable.from(exeBuf, { ignoreCert: true });
    const res = NtExecutableResource.from(exe);

    const iconFile = Data.IconFile.from(icoBuf);
    const existingIcons = Resource.IconGroupEntry.fromEntries(res.entries);
    const iconGroupId = existingIcons[0]?.id ?? 1;
    const iconLang = existingIcons[0]?.lang ?? 1033;
    Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        iconGroupId,
        iconLang,
        iconFile.icons.map((item) => item.data)
    );

    const [maj, min, pat, rev] = parseSemverParts(version);
    const shortVersion = `${maj}.${min}`;
    const fileVersionStr = `${maj}.${min}.${pat}.${rev}`;
    const versionInfos = Resource.VersionInfo.fromEntries(res.entries);
    const vi = versionInfos[0] || Resource.VersionInfo.createEmpty();
    const langs = vi.getAllLanguagesForStringValues();
    const targetLangs = langs.length > 0 ? langs : [{ lang: 1033, codepage: 1200 }];
    for (const pair of targetLangs) {
        vi.setFileVersion(maj, min, pat, rev, pair.lang);
        vi.setProductVersion(maj, min, pat, rev, pair.lang);
        vi.setStringValues(pair, {
            CompanyName: BRAND_COMPANY,
            FileDescription: BRAND_APP_NAME,
            FileVersion: fileVersionStr,
            InternalName: BRAND_APP_NAME,
            LegalCopyright: `${BRAND_APP_NAME} (PokeIdle)`,
            OriginalFilename: BRAND_EXE_NAME,
            ProductName: BRAND_APP_NAME,
            ProductVersion: shortVersion,
        });
    }
    vi.outputToResourceEntries(res.entries);
    res.outputResource(exe);

    const patchedBuf = Buffer.from(exe.generate());
    mkdirSync(dirname(targetExe), { recursive: true });
    const tmpTarget = `${targetExe}.tmp-${process.pid}`;
    writeFileSync(tmpTarget, patchedBuf);
    try {
        renameSync(tmpTarget, targetExe);
    } catch (err) {
        rmSync(tmpTarget, { force: true });
        if ((err?.code === 'EBUSY' || err?.code === 'EPERM') && existsSync(targetExe)) {
            return targetExe;
        }
        throw err;
    }
    return targetExe;
}

/**
 * Garante o executavel de runtime "Nexo PokeBot.exe" atualizado dentro de node_modules/electron/dist/.
 * @param {object} [options] Diretorio raiz, executavel alvo e flag force.
 * @returns {{ runtimeExe: string, electronDist: string, electronVersion: string, appVersion: string, updated: boolean }} Resultado.
 */
export function prepareBrandedElectronRuntime(options = {}) {
    const rootDir = resolve(options.rootDir || ROOT);
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
    const appVersion = String(pkg.version || '1.0.0');
    const icoPath = resolve(options.icoPath || join(rootDir, 'assets', 'nexo-pokebot.ico'));
    if (!existsSync(icoPath)) {
        throw new Error(`Icone nao encontrado em ${icoPath}.`);
    }

    const { electronDist, electronExe, electronVersion } = ensureElectronDist(rootDir);
    const runtimeExe = resolve(options.targetExe || join(electronDist, BRAND_EXE_NAME));
    const stampPath = options.targetExe ? null : join(electronDist, '.nexo-runtime-brand.json');
    const icoHash = createHash('sha256').update(readFileSync(icoPath)).digest('hex').slice(0, 16);
    const expectedStamp = JSON.stringify({
        brand: BRAND_APP_NAME,
        exe: BRAND_EXE_NAME,
        appVersion,
        electronVersion,
        icoHash,
    });

    if (!options.force && stampPath && existsSync(runtimeExe) && existsSync(stampPath)) {
        const currentStamp = readFileSync(stampPath, 'utf8').trim();
        if (currentStamp === expectedStamp) {
            return { runtimeExe, electronDist, electronVersion, appVersion, updated: false };
        }
    }

    patchElectronExecutable({
        sourceExe: electronExe,
        targetExe: runtimeExe,
        icoPath,
        version: appVersion,
    });
    if (stampPath) {
        writeFileSync(stampPath, expectedStamp, 'utf8');
    }
    return { runtimeExe, electronDist, electronVersion, appVersion, updated: true };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
    const res = prepareBrandedElectronRuntime({ force: process.argv.includes('--force') });
    console.log(`OK  ${res.runtimeExe} (${res.updated ? 'atualizado' : 'em cache'})`);
}
