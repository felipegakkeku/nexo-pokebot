// Junta os fragmentos de src/ (em ordem numérica) em um único userscript: dist/pokebot.user.js
// Os fragmentos compartilham o mesmo escopo (uma IIFE aberta em 00-core.js e fechada em 90-init.js),
// então a ordem dos arquivos importa. Sem dependências: só Node 18+.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version.replace(/\.0$/, ''); // 6.5.0 -> 6.5

const REPO = 'felipegakkeku/nexo-pokebot';

// Uso: `node build.mjs --check-tag [vX.Y.Z]` só confere se a tag bate com o package.json (sem buildar).
// Sem argumento, lê GITHUB_REF_NAME (é o que o workflow de release usa). Falha com exit 1 se não bater.
if (process.argv.includes('--check-tag')) {
    const idx = process.argv.indexOf('--check-tag');
    const next = process.argv[idx + 1];
    const tag = (next && !next.startsWith('--') ? next : process.env.GITHUB_REF_NAME || '').trim();
    const expected = `v${pkg.version}`;
    if (tag !== expected) {
        console.error(`ERRO: a tag "${tag || '(vazia)'}" não bate com o package.json (esperado "${expected}").`);
        process.exit(1);
    }
    console.log(`OK  tag ${tag} == package.json ${pkg.version}`);
    process.exit(0);
}

// De onde o Tampermonkey busca as atualizações (@updateURL/@downloadURL):
//   'main'    -> dist/pokebot.user.js da branch main (hoje, enquanto não existe nenhuma Release)
//   'release' -> asset da última Release do GitHub (trocar para este DEPOIS que a primeira Release existir,
//                e publicar uma versão nova assim para quem usa a URL antiga migrar sozinho)
// Para testar sem editar o arquivo: POKEBOT_UPDATE_CHANNEL=release npm run build
const UPDATE_CHANNEL = process.env.POKEBOT_UPDATE_CHANNEL || 'main';
const CHANNEL_URLS = {
    main: `https://raw.githubusercontent.com/${REPO}/main/dist/pokebot.user.js`,
    release: `https://github.com/${REPO}/releases/latest/download/pokebot.user.js`,
};
const RAW = CHANNEL_URLS[UPDATE_CHANNEL];
if (!RAW) {
    console.error(`ERRO: canal de atualização inválido "${UPDATE_CHANNEL}" (use: ${Object.keys(CHANNEL_URLS).join(', ')})`);
    process.exit(1);
}

const header = `// ==UserScript==
// @name         Nexo PokeBot (PokeIdle)
// @namespace    https://github.com/${REPO}
// @version      ${version}
// @description  Automação desenvolvida especificamente para o PokeIdle (pokeidle.io): captura, restock, equipe, auto-evoluir, bosses, mapa/hunt, lives e HUD flutuante
// @match        https://pokeidle.io/app*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @grant        unsafeWindow
// @connect      twitch.tv
// @connect      gql.twitch.tv
// @connect      usher.ttvnw.net
// @connect      ttvnw.net
// @connect      kick.com
// @connect      websockets.kick.com
// @connect      *
// @updateURL    ${RAW}
// @downloadURL  ${RAW}
// ==/UserScript==

`;

const files = readdirSync(join(root, 'src'))
    .filter((f) => f.endsWith('.js'))
    .sort();

const body = files.map((f) => readFileSync(join(root, 'src', f), 'utf8').replace(/\s+$/, '')).join('\n\n');
// Módulos ES (src/modules) -> um bloco IIFE que vira `PokeBotModules` dentro do escopo do userscript
const modules = buildSync({
    entryPoints: [join(root, 'src', 'modules', 'index.js')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'PokeBotModules',
    target: 'es2020',
    legalComments: 'none',
}).outputFiles[0].text.trim();
const MARK = '/*__MODULES_BUNDLE__*/';
if (!body.includes(MARK)) {
    console.error(`ERRO: marcador ${MARK} não encontrado em src/00-core.js`);
    process.exit(1);
}
const out = (header + body.replace(MARK, () => modules).replaceAll('__VERSION__', version) + '\n').replace(/\r\n/g, '\n');

mkdirSync(join(root, 'dist'), { recursive: true });
const target = join(root, 'dist', 'pokebot.user.js');
writeFileSync(target, out);

// Falha o build se o resultado não for JavaScript válido
execFileSync(process.execPath, ['--check', target], { stdio: 'inherit' });
console.log(`OK  dist/pokebot.user.js  v${version}  (${files.length} arquivos + módulos, ${out.split('\n').length} linhas)`);
