// Gera um ZIP limpo e pronto para compartilhar (release/Nexo-PokeBot-v1.0.zip) sem sessoes, tokens ou cookies pessoais.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDesktopExecutable } from './build-exe.mjs';
import { BRAND_EXE_NAME, ensureElectronDist, patchElectronExecutable } from './brand-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const FORBIDDEN_PATTERNS = [
    /^\.pokebot-/i,
    /^\.env(?:\.|$)/i,
    /^\.git$/i,
    /^local state$/i,
    /cookies/i,
];

function assertNoPrivateFiles(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (FORBIDDEN_PATTERNS.some((re) => re.test(entry.name))) {
            throw new Error(`Arquivo/pasta privada detectada no pacote de distribuicao: ${full}`);
        }
        if (entry.isDirectory()) {
            assertNoPrivateFiles(full);
        }
    }
}

function buildFriendReadme(shortVersion) {
    return [
        `Nexo PokeBot v${shortVersion} (PokeIdle) - Como usar`,
        '=============================================',
        '',
        'Desenvolvido especificamente para o PokeIdle (pokeidle.io).',
        '',
        '1. EXTRAIA TODO O CONTEUDO DESTE ZIP para uma pasta (ex: C:\\Nexo-PokeBot).',
        '   IMPORTANTE: nao abra o Nexo PokeBot.exe direto de dentro do ZIP nem copie so o .exe.',
        '',
        '2. Abra o arquivo Nexo PokeBot.exe (nao precisa instalar Node.js nem rodar npm install).',
        '',
        '3. Na primeira vez, clique em "Abrir jogo embutido" (ou na aba Conexoes -> Logar PokeIdle)',
        '   para entrar em cada uma das suas contas (Contas 1 a 4, todas isoladas).',
        '   Depois de logar uma vez, pode clicar em "Modo Eco" para farmar em 2o plano sem peso.',
        '',
        '4. (Opcional) Para usar /hunt automatico sem abas abertas, instale a extensao',
        '   "/hunt for PokeIdle" no seu Google Chrome (ou Edge/Brave).',
        '',
        'Dica: todas as suas sessoes e configuracoes ficam salvas localmente na propria pasta.',
        '',
    ].join('\r\n');
}

/**
 * Monta uma pasta limpa sem credenciais pessoais e compacta em release/Nexo-PokeBot-vX.Y.zip.
 * @param {object} [options] Opcoes de destino e nome do ZIP.
 * @returns {{ zipPath: string, sizeMb: number }} Caminho e tamanho do ZIP gerado.
 */
export function buildFriendPackage(options = {}) {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const fullVersion = String(pkg.version || '1.0.0');
    const shortVersion = fullVersion.replace(/\.0$/, '');
    const outDir = resolve(options.outDir || join(ROOT, 'release'));
    const folderName = options.folderName || `Nexo-PokeBot-v${shortVersion}`;
    const zipName = options.zipName || `${folderName}.zip`;
    const zipPath = join(outDir, zipName);

    const { electronDist, electronExe } = ensureElectronDist(ROOT);
    const { distExePath } = buildDesktopExecutable();
    const icoPath = join(ROOT, 'assets', 'nexo-pokebot.ico');

    const stagingParent = mkdtempSync(join(tmpdir(), 'nexo-pokebot-pkg-'));
    const pkgRoot = join(stagingParent, folderName);
    mkdirSync(pkgRoot, { recursive: true });

    try {
        const copyFiles = [
            'Abrir Nexo PokeBot.bat',
            'Abrir Nexo PokeBot Eco (1 Processo).bat',
            'package.json',
            'README.md',
        ];
        for (const rel of copyFiles) {
            const src = join(ROOT, rel);
            if (existsSync(src)) cpSync(src, join(pkgRoot, rel));
        }
        cpSync(distExePath, join(pkgRoot, BRAND_EXE_NAME));

        cpSync(join(ROOT, 'src'), join(pkgRoot, 'src'), { recursive: true });
        if (existsSync(join(ROOT, 'assets'))) {
            cpSync(join(ROOT, 'assets'), join(pkgRoot, 'assets'), { recursive: true });
        }

        mkdirSync(join(pkgRoot, 'dist'), { recursive: true });
        for (const rel of ['nexo-pokebot.ico', 'pokebot.ico', 'pokebot.user.js']) {
            const src = join(ROOT, 'dist', rel);
            if (existsSync(src)) cpSync(src, join(pkgRoot, 'dist', rel));
        }

        // Copia o runtime Electron sem o electron.exe bruto e gera o binario com marca/icone/metadados PE proprios
        const dstElectronDist = join(pkgRoot, 'node_modules', 'electron', 'dist');
        mkdirSync(dstElectronDist, { recursive: true });
        cpSync(electronDist, dstElectronDist, {
            recursive: true,
            filter: (srcPath) => {
                const lower = srcPath.toLowerCase();
                if (lower.endsWith('\\electron.exe') || lower.endsWith('/electron.exe')) return false;
                if (lower.endsWith(`\\${BRAND_EXE_NAME.toLowerCase()}`) || lower.endsWith(`/${BRAND_EXE_NAME.toLowerCase()}`)) return false;
                if (lower.endsWith('.nexo-runtime-brand.json')) return false;
                return true;
            },
        });
        patchElectronExecutable({
            sourceExe: electronExe,
            targetExe: join(dstElectronDist, BRAND_EXE_NAME),
            icoPath,
            version: fullVersion,
        });

        writeFileSync(join(pkgRoot, 'LEIA-ME.txt'), buildFriendReadme(shortVersion), 'utf8');

        // Verificacao de seguranca: garante zero arquivos pessoais no pacote
        assertNoPrivateFiles(pkgRoot);

        mkdirSync(outDir, { recursive: true });
        rmSync(zipPath, { force: true });

        execFileSync('tar.exe', ['-a', '-c', '-f', zipPath, '-C', stagingParent, folderName], {
            stdio: 'pipe',
        });

        const sizeMb = Number((statSync(zipPath).size / (1024 * 1024)).toFixed(1));
        return { zipPath, sizeMb };
    } finally {
        rmSync(stagingParent, { recursive: true, force: true });
    }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
    const out = buildFriendPackage();
    console.log(`OK  ${out.zipPath} (${out.sizeMb} MB)`);
}
