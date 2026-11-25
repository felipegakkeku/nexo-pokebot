// Envia um aviso em tempo real para todos os Hubs conectados.
//
//   npm run aviso -- "Texto do aviso" [--titulo "Título"] [--tipo info|ok|aviso|erro]
//                    [--ate 2026-12-31] [--link https://...] [--versao-min 1.0.26] [--versao-max 1.0.30] [--id meu-id]
//
// Precisa de ~/.nexo-pokebot/aviso-chave.pem (chave privada Ed25519, fica só no PC do dono) e
// ~/.nexo-pokebot/avisos.json com { "publicar": "http://localhost:3334", "tunnelLog": "<log do cloudflared>" }.
// Se o túnel trocou de endereço, atualiza avisos-servidor.json no main antes de enviar.
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CFG_DIR = join(homedir(), '.nexo-pokebot');
const POINTER = join(ROOT, 'avisos-servidor.json');
const TUNNEL_RE = /\|\s+(https:\/\/[a-z0-9-]+\.trycloudflare\.com)\s+\|/g;

function fail(msg) { console.error(`Erro: ${msg}`); process.exit(1); }

function parseArgs(argv) {
    const out = { texto: '' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1] ?? ''; i++; } else if (!out.texto) out.texto = a;
    }
    return out;
}

function currentTunnel(logPath) {
    if (!logPath || !existsSync(logPath)) return '';
    let last = '';
    for (const m of readFileSync(logPath, 'utf8').matchAll(TUNNEL_RE)) last = m[1];
    return last;
}

function syncPointer(url) {
    let cur = '';
    try { cur = JSON.parse(readFileSync(POINTER, 'utf8')).servidor || ''; } catch { /* arquivo novo */ }
    if (!url || cur === url) return false;
    writeFileSync(POINTER, `${JSON.stringify({ servidor: url }, null, 2)}\n`, 'utf8');
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, stdio: 'inherit' });
    git('add', 'avisos-servidor.json');
    git('commit', '-m', 'Endereço do servidor de avisos', '--', 'avisos-servidor.json');
    git('push', '-q');
    return true;
}

const args = parseArgs(process.argv.slice(2));
if (!args.texto && !args.titulo) fail('passe o texto do aviso entre aspas.');
const keyPath = join(CFG_DIR, 'aviso-chave.pem');
if (!existsSync(keyPath)) fail(`chave não encontrada em ${keyPath}.`);
let cfg = {};
try { cfg = JSON.parse(readFileSync(join(CFG_DIR, 'avisos.json'), 'utf8')); } catch { /* usa o padrão */ }
const publicar = String(process.env.AVISO_PUBLICAR || cfg.publicar || 'http://localhost:3334').replace(/\/+$/, '');

const tunnel = currentTunnel(process.env.AVISO_TUNNEL_LOG || cfg.tunnelLog);
if (tunnel && syncPointer(tunnel)) console.log(`Endereço novo publicado: ${tunnel} (Hubs reconectam em até 1 min).`);

const tipo = String(args.tipo || 'info');
const aviso = {
    id: args.id || `aviso-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`,
    titulo: args.titulo || 'Nexo PokeBot',
    texto: args.texto || '',
    tipo,
    ...(args.ate ? { ate: args.ate } : {}),
    ...(args.link ? { link: args.link } : {}),
    ...(args['versao-min'] ? { versaoMin: args['versao-min'] } : {}),
    ...(args['versao-max'] ? { versaoMax: args['versao-max'] } : {}),
    ts: Date.now(),
};
const payload = JSON.stringify(aviso);
const sig = sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(readFileSync(keyPath, 'utf8'))).toString('base64');
const res = await fetch(`${publicar}/api/nexo/avisos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, sig }),
}).catch((e) => fail(`servidor fora do ar (${e.message}).`));
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.ok) fail(body.error || `HTTP ${res.status}`);
console.log(`Enviado "${aviso.titulo}" (${aviso.id}) para ${body.conectados} Hub(s) conectado(s) agora.`);
