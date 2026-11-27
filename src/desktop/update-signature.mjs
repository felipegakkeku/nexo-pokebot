// Assinatura das Releases: o auto-update só instala um ZIP se o dono assinou aquele pacote.
// A chave privada fica fora do repositório e do GitHub (veja sign-release.mjs); aqui só existe a pública.
// A assinatura (Ed25519) cobre a tag e o SHA-256 do ZIP, então um pacote assinado não vale para outra tag
// (impede voltar o usuário para uma versão antiga e vulnerável).
import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const UPDATE_SIGNING_PUBLIC_KEY = 'MCowBQYDK2VwAyEAmaHh+2rvfbVVkwtR8CzsHTIW5ZQcwHc5+xw6ooB8EKg=';
const STATEMENT_DOMAIN = 'nexo-pokebot-update/v1';
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Texto exato que o dono assina e o app confere. */
export function updateStatement({ tag, sha256 }) {
    const t = String(tag || '').trim();
    const h = String(sha256 || '').trim().toLowerCase();
    if (!t || /[\r\n]/.test(t)) throw new Error('Tag inválida para a assinatura.');
    if (!SHA256_HEX.test(h)) throw new Error('SHA-256 inválido para a assinatura.');
    return `${STATEMENT_DOMAIN}\n${t}\n${h}\n`;
}

/** SHA-256 (hex) de um arquivo, lendo em fluxo para não carregar o ZIP inteiro na memória. */
export function sha256File(path) {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(path);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

/**
 * Confere a assinatura de uma Release. Nunca lança: qualquer problema devolve false.
 * @param {{ tag: string, sha256: string, signature: string, publicKey?: string }} params signature em base64.
 */
export function verifyUpdateSignature({ tag, sha256, signature, publicKey = UPDATE_SIGNING_PUBLIC_KEY }) {
    try {
        const sig = Buffer.from(String(signature || '').trim(), 'base64');
        if (sig.length !== 64) return false;
        const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
        return verify(null, Buffer.from(updateStatement({ tag, sha256 }), 'utf8'), key, sig);
    } catch {
        return false;
    }
}

/** Assina (uso do sign-release.mjs e dos testes). privateKeyPem é a chave PKCS#8 em PEM. */
export function signUpdate({ tag, sha256, privateKeyPem }) {
    return sign(null, Buffer.from(updateStatement({ tag, sha256 }), 'utf8'), privateKeyPem).toString('base64');
}
