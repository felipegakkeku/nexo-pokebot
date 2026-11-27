// Autenticação da API local do painel (gui-server).
//
// A API escuta só em 127.0.0.1 e confere Host/Origin, mas isso não impede outro processo da máquina
// (ou de outro usuário) de chamar /api/action. Cada execução do servidor gera um token aleatório e só
// responde a quem o apresenta: no cabeçalho X-Nexo-Token (programas) ou no cookie HttpOnly que a
// própria página ganha ao abrir o link do painel com ?nexo_token=.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_HEADER = 'x-nexo-token';
export const TOKEN_QUERY_PARAM = 'nexo_token';
const MIN_TOKEN_LENGTH = 24;

/** Token novo (256 bits em hex). */
export function generateApiToken() {
    return randomBytes(32).toString('hex');
}

/** Aceita um token fornecido por quem iniciou o processo (ex.: o launcher) só se tiver cara de token. */
export function normalizeProvidedToken(value) {
    const token = String(value || '').trim();
    return /^[A-Za-z0-9_-]+$/.test(token) && token.length >= MIN_TOKEN_LENGTH ? token : '';
}

/** Cookies não isolam por porta no localhost; o nome leva a porta para as contas não se atropelarem. */
export function cookieNameForPort(port) {
    return `nexo_gui_${Number(port) || 0}`;
}

const digest = (value) => createHash('sha256').update(String(value)).digest();

/** Comparação em tempo constante (compara os hashes, então o tamanho não vaza). */
export function tokensMatch(expected, received) {
    if (!expected || !received) return false;
    return timingSafeEqual(digest(expected), digest(received));
}

export function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
        const idx = part.indexOf('=');
        if (idx <= 0) continue;
        const name = part.slice(0, idx).trim();
        if (!name || name in out) continue;
        try { out[name] = decodeURIComponent(part.slice(idx + 1).trim()); } catch { out[name] = part.slice(idx + 1).trim(); }
    }
    return out;
}

/** Diz se a requisição traz o token certo (cabeçalho ou cookie desta porta). */
export function isAuthorized(req, { token, port }) {
    const fromHeader = req.headers?.[TOKEN_HEADER];
    if (typeof fromHeader === 'string' && tokensMatch(token, fromHeader)) return true;
    const fromCookie = parseCookies(req.headers?.cookie)[cookieNameForPort(port)];
    return tokensMatch(token, fromCookie);
}

export function sessionCookie(token, port) {
    return `${cookieNameForPort(port)}=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

/** Link do painel que já entrega o token (a página troca por cookie e limpa a URL). */
export function panelUrl(baseUrl, token) {
    return token ? `${baseUrl.replace(/\/+$/, '')}/?${TOKEN_QUERY_PARAM}=${token}` : baseUrl;
}

export const UNAUTHORIZED_PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Nexo PokeBot</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b10;color:#e6e6ee;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:34rem;padding:2rem}h1{font-size:1.2rem}code{background:#1c1c26;padding:.1rem .35rem;border-radius:4px}</style></head>
<body><main><h1>Painel protegido</h1>
<p>Este painel só abre pelo link que o Nexo PokeBot gera a cada execução (botão <b>Abrir painel</b> no Hub, ou o endereço mostrado no console).</p>
<p>Se você chegou aqui digitando o endereço, volte ao Hub e use o botão. O link muda quando o programa reinicia.</p>
</main></body></html>`;
