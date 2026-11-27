// A API local do painel só responde a quem tem o token da execução.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGuiServer } from '../src/headless/gui-server.mjs';
import {
    cookieNameForPort,
    generateApiToken,
    normalizeProvidedToken,
    parseCookies,
    tokensMatch,
} from '../src/headless/api-auth.mjs';

const stubController = () => {
    const calls = [];
    return {
        calls,
        stop() {},
        start() {},
        pause() { calls.push('pause'); },
        getSnapshot: () => ({ ok: true, status: 'idle' }),
        triggerAction: (action) => { calls.push(action); return true; },
    };
};

const withServer = async (options, fn) => {
    const controller = stubController();
    const srv = await startGuiServer({ port: 0, host: '127.0.0.1', controller, autoStart: false, ...options });
    try {
        await fn(srv, controller);
    } finally {
        await srv.close();
    }
};

const post = (srv, action, headers = {}) => fetch(`${srv.url}/api/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ action }),
});

test('token: gerado, comparado em tempo constante e validado quando vem de fora', () => {
    const a = generateApiToken();
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, generateApiToken());
    assert.equal(tokensMatch(a, a), true);
    assert.equal(tokensMatch(a, `${a}x`), false);
    assert.equal(tokensMatch(a, ''), false);
    assert.equal(tokensMatch('', ''), false);
    assert.equal(normalizeProvidedToken(a), a);
    for (const bad of ['', 'curto', 'tem espaço e é longo o bastante para passar', null, undefined]) {
        assert.equal(normalizeProvidedToken(bad), '');
    }
    assert.deepEqual(parseCookies('a=1; nexo_gui_17890=abc%20d; ruim; =x'), { a: '1', nexo_gui_17890: 'abc d' });
    assert.equal(cookieNameForPort(17890), 'nexo_gui_17890');
});

test('API local: sem token (ou com token errado) é 401 e nada é executado', async () => {
    await withServer({}, async (srv, controller) => {
        assert.equal((await fetch(`${srv.url}/api/status`)).status, 401);
        assert.equal((await fetch(`${srv.url}/api/status`, { headers: { 'X-Nexo-Token': 'errado' } })).status, 401);
        assert.equal((await post(srv, 'pause')).status, 401);
        assert.equal((await post(srv, 'pause', { 'X-Nexo-Token': srv.token.replace(/.$/, 'z') })).status, 401);
        assert.deepEqual(controller.calls, []);

        const ok = await fetch(`${srv.url}/api/status`, { headers: { 'X-Nexo-Token': srv.token } });
        assert.equal(ok.status, 200);
        assert.equal((await ok.json()).status, 'idle');
        assert.equal((await post(srv, 'pause', { 'X-Nexo-Token': srv.token })).status, 200);
        assert.deepEqual(controller.calls, ['pause']);
    });
});

test('API local: o link do painel troca o token por cookie HttpOnly e a página só abre com ele', async () => {
    await withServer({}, async (srv) => {
        const bare = await fetch(`${srv.url}/`);
        assert.equal(bare.status, 401);
        assert.doesNotMatch(await bare.text(), /PokeBot GUI|api\/action/);

        const wrong = await fetch(`${srv.url}/?nexo_token=errado`, { redirect: 'manual' });
        assert.equal(wrong.status, 401);
        assert.equal(wrong.headers.get('set-cookie'), null);

        const link = await fetch(srv.panelUrl, { redirect: 'manual' });
        assert.equal(link.status, 302);
        assert.equal(link.headers.get('location'), '/');
        const cookie = link.headers.get('set-cookie');
        assert.match(cookie, new RegExp(`^${cookieNameForPort(srv.port)}=${srv.token}; Path=/; HttpOnly; SameSite=Strict`));

        const pair = cookie.split(';')[0];
        const page = await fetch(`${srv.url}/`, { headers: { Cookie: pair } });
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type'), /text\/html/);
        assert.equal((await fetch(`${srv.url}/api/status`, { headers: { Cookie: pair } })).status, 200);
        // cookie de outra porta não vale aqui
        assert.equal((await fetch(`${srv.url}/api/status`, { headers: { Cookie: `${cookieNameForPort(srv.port + 1)}=${srv.token}` } })).status, 401);
    });
});

test('API local: duas execuções têm tokens diferentes, e o launcher pode fornecer o dele', async () => {
    const fixed = generateApiToken();
    await withServer({ apiToken: fixed }, async (a) => {
        assert.equal(a.token, fixed);
        await withServer({}, async (b) => {
            assert.notEqual(b.token, fixed);
            assert.equal((await fetch(`${b.url}/api/status`, { headers: { 'X-Nexo-Token': fixed } })).status, 401);
        });
    });
    // token fornecido com cara de lixo é ignorado em favor de um aleatório
    await withServer({ apiToken: 'curto' }, async (srv) => assert.match(srv.token, /^[0-9a-f]{64}$/));
});

test('API local: a checagem de Host/Origin continua valendo mesmo com token certo', async () => {
    await withServer({}, async (srv) => {
        const cross = await post(srv, 'pause', { 'X-Nexo-Token': srv.token, Origin: 'https://example.com' });
        assert.equal(cross.status, 403);
    });
});
