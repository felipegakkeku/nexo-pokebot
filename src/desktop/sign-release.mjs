// Assina e publica uma Release (rodar na máquina do dono, nunca no CI).
//
// Fluxo: o workflow "release" gera o ZIP e deixa a Release como RASCUNHO (invisível para o auto-update).
// Este script baixa o ZIP do rascunho, mostra tag e SHA-256, assina com a chave privada local e só então
// sobe o .sig e publica. A chave privada nunca fica no GitHub: quem invadir a conta ou o repositório
// não consegue fabricar uma atualização que os apps aceitem.
//
// Uso: npm run sign-release -- v1.0.26 [--key caminho.pem] [--yes]
// Chave padrão: %USERPROFILE%\.nexo-signing\update-private.pem (ou a variável NEXO_SIGNING_KEY).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DEFAULT_UPDATE_REPO } from './updater.mjs';
import { sha256File, signUpdate, verifyUpdateSignature } from './update-signature.mjs';

const gh = (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });

async function main() {
    const argv = process.argv.slice(2);
    const flag = (name) => argv.includes(name);
    const valueOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : ''; };
    const tag = argv.find((a, i) => /^v\d+\.\d+\.\d+$/.test(a) && argv[i - 1] !== '--key') || '';
    if (!tag) throw new Error('Informe a tag da Release, ex.: npm run sign-release -- v1.0.26');

    const keyPath = valueOf('--key') || process.env.NEXO_SIGNING_KEY || join(homedir(), '.nexo-signing', 'update-private.pem');
    if (!existsSync(keyPath)) throw new Error(`Chave privada não encontrada em ${keyPath}`);
    const privateKeyPem = readFileSync(keyPath, 'utf8');

    const repo = DEFAULT_UPDATE_REPO;
    const rel = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'isDraft,assets,url,targetCommitish']));
    const zip = (rel.assets || []).find((a) => /^Nexo-PokeBot-.*\.zip$/i.test(a.name));
    if (!zip) throw new Error('A Release não tem o pacote Nexo-PokeBot-*.zip. O workflow terminou?');
    const sigName = `${zip.name}.sig`;

    const work = mkdtempSync(join(tmpdir(), 'nexo-sign-'));
    try {
        gh(['release', 'download', tag, '--repo', repo, '--pattern', zip.name, '--dir', work]);
        const zipPath = join(work, zip.name);
        const sha256 = await sha256File(zipPath);
        const tagCommit = gh(['api', `repos/${repo}/commits/${tag}`, '--jq', '.sha']).trim();

        console.log(`Release:  ${tag}${rel.isDraft ? ' (rascunho)' : ' (já publicada)'}`);
        console.log(`Commit:   ${tagCommit}`);
        console.log(`Pacote:   ${zip.name} (${(statSync(zipPath).size / 1048576).toFixed(1)} MB)`);
        console.log(`SHA-256:  ${sha256}`);

        if (!flag('--yes')) {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const ans = (await rl.question('Foi você quem gerou essa tag e esse commit é o esperado? Assinar? (s/N) ')).trim().toLowerCase();
            rl.close();
            if (ans !== 's' && ans !== 'sim') throw new Error('Cancelado, nada foi assinado.');
        }

        const signature = signUpdate({ tag, sha256, privateKeyPem });
        if (!verifyUpdateSignature({ tag, sha256, signature })) {
            throw new Error('A assinatura gerada não confere com a chave pública do app (UPDATE_SIGNING_PUBLIC_KEY). Chave errada?');
        }
        const sigPath = join(work, sigName);
        writeFileSync(sigPath, `${signature}\n`, 'utf8');
        gh(['release', 'upload', tag, sigPath, '--repo', repo, '--clobber']);
        if (rel.isDraft) gh(['release', 'edit', tag, '--repo', repo, '--draft=false']);
        console.log(`Assinada e publicada: ${rel.url}`);
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.error(`[sign-release] ${err?.message || err}`);
    process.exit(1);
});
