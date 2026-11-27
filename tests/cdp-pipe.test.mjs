// Depuração por canal privado: o navegador do bot não abre porta TCP (--remote-debugging-pipe).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPipeCdpHub, spawnBrowserWithPipe } from '../src/headless/cdp-pipe.mjs';

// Navegador de mentira: lê comandos NUL-terminados em `toBrowser` e responde em `fromBrowser`.
function fakeBrowser() {
    const toBrowser = new PassThrough();
    const fromBrowser = new PassThrough();
    const received = [];
    let buf = '';
    toBrowser.setEncoding('utf8');
    toBrowser.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\0')) !== -1) {
            const msg = JSON.parse(buf.slice(0, i));
            buf = buf.slice(i + 1);
            received.push(msg);
            if (msg.method !== 'Never.answer') {
                fromBrowser.write(`${JSON.stringify({ id: msg.id, result: { echo: msg.method, sessionId: msg.sessionId ?? null } })}\0`);
            }
        }
    });
    const emit = (event) => fromBrowser.write(`${JSON.stringify(event)}\0`);
    return { toBrowser, fromBrowser, received, emit };
}

test('cdp-pipe: comandos voltam pela resposta certa e vários handles dividem o mesmo canal', async () => {
    const fb = fakeBrowser();
    const hub = createPipeCdpHub(fb.toBrowser, fb.fromBrowser);
    const a = hub.handle();
    const b = hub.handle();
    const [ra, rb] = await Promise.all([a.send('Browser.getVersion'), b.send('Target.getTargets', {}, 'sess-1')]);
    assert.equal(ra.echo, 'Browser.getVersion');
    assert.equal(rb.echo, 'Target.getTargets');
    assert.equal(rb.sessionId, 'sess-1');
    assert.equal(new Set(fb.received.map((m) => m.id)).size, 2, 'ids únicos entre handles');
    hub.destroy();
});

test('cdp-pipe: evento chega a todos os handles e some depois de close()', async () => {
    const fb = fakeBrowser();
    const hub = createPipeCdpHub(fb.toBrowser, fb.fromBrowser);
    const a = hub.handle();
    const b = hub.handle();
    const seenA = [];
    const seenB = [];
    a.onEvent((m) => seenA.push(m.method));
    b.onEvent((m) => seenB.push(m.method));
    fb.emit({ method: 'Target.targetCreated', params: {} });
    await new Promise((r) => setTimeout(r, 20));
    a.close();
    fb.emit({ method: 'Target.targetDestroyed', params: {} });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seenA, ['Target.targetCreated']);
    assert.deepEqual(seenB, ['Target.targetCreated', 'Target.targetDestroyed']);
    assert.equal(hub.isClosed(), false, 'fechar um handle não derruba o canal');
    await assert.rejects(a.send('Browser.getVersion'), /CDP fechado/);
    assert.equal((await b.send('Browser.getVersion')).echo, 'Browser.getVersion');
    hub.destroy();
});

test('cdp-pipe: mensagem partida em pedaços e várias numa leitura só', async () => {
    const toBrowser = new PassThrough();
    const fromBrowser = new PassThrough();
    const hub = createPipeCdpHub(toBrowser, fromBrowser);
    const h = hub.handle();
    const events = [];
    h.onEvent((m) => events.push(m.method));
    const p = h.send('X.y');
    const full = `${JSON.stringify({ method: 'A.one' })}\0${JSON.stringify({ id: 1, result: { ok: true } })}\0${JSON.stringify({ method: 'B.two' })}\0`;
    fromBrowser.write(full.slice(0, 11));
    fromBrowser.write(full.slice(11, 40));
    fromBrowser.write(full.slice(40));
    assert.deepEqual(await p, { ok: true });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(events, ['A.one', 'B.two']);
    hub.destroy();
});

test('cdp-pipe: erro do navegador rejeita só aquele comando e comando sem resposta estoura o tempo', async () => {
    const toBrowser = new PassThrough();
    const fromBrowser = new PassThrough();
    const hub = createPipeCdpHub(toBrowser, fromBrowser, { commandTimeoutMs: 60 });
    const h = hub.handle();
    const bad = h.send('Bad.call');
    fromBrowser.write(`${JSON.stringify({ id: 1, error: { message: 'nao existe' } })}\0`);
    await assert.rejects(bad, /nao existe/);
    await assert.rejects(h.send('Never.answer'), /Timeout no comando CDP: Never.answer/);
    hub.destroy();
});

test('cdp-pipe: canal fechado rejeita pendentes, avisa ws close e novos handles já nascem fechados', async () => {
    const fb = fakeBrowser();
    const hub = createPipeCdpHub(fb.toBrowser, fb.fromBrowser);
    const h = hub.handle();
    let closeEvents = 0;
    h.ws.addEventListener('close', () => { closeEvents++; });
    assert.equal(h.ws.readyState, 1);
    const pending = h.send('Never.answer');
    fb.fromBrowser.end(); // o navegador encerrou
    await assert.rejects(pending, /CDP encerrado/);
    assert.equal(closeEvents, 1);
    assert.equal(hub.isClosed(), true);
    assert.equal(h.ws.readyState, 3);
    const late = hub.handle();
    await assert.rejects(late.send('Browser.getVersion'), /CDP fechado/);
});

test('cdp-pipe: spawn passa --remote-debugging-pipe e nunca --remote-debugging-port', async () => {
    const fb = fakeBrowser();
    let captured;
    const fakeSpawn = (exe, args, opts) => {
        captured = { exe, args, opts };
        const handlers = {};
        return {
            stdio: [null, null, null, fb.toBrowser, fb.fromBrowser],
            once: (ev, fn) => {
                handlers[ev] = fn;
                if (ev === 'spawn') queueMicrotask(fn);
            },
        };
    };
    const { hub } = await spawnBrowserWithPipe('chrome.exe', ['--user-data-dir=X', '--new-window'], { spawnImpl: fakeSpawn });
    assert.ok(captured.args.includes('--remote-debugging-pipe'));
    assert.ok(!captured.args.some((a) => a.startsWith('--remote-debugging-port')));
    assert.equal(captured.opts.stdio.length, 5);
    assert.equal(captured.opts.stdio[3], 'pipe');
    assert.equal(captured.opts.stdio[4], 'pipe');
    assert.equal((await hub.handle().send('Browser.getVersion')).echo, 'Browser.getVersion');
    hub.destroy();
});

test('o código do bot não abre porta de depuração remota', () => {
    const src = readFileSync(new URL('../src/headless/gui-server.mjs', import.meta.url), 'utf8');
    assert.ok(!/['"]--remote-debugging-port/.test(src), 'gui-server.mjs voltou a abrir --remote-debugging-port');
});

const CHROME = process.env.NEXO_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
test('Chrome real (só se instalado): sem porta nem DevToolsActivePort, e encerra quando o canal fecha', {
    skip: !existsSync(CHROME) || process.env.NEXO_SKIP_REAL_BROWSER === '1',
    timeout: 60_000,
}, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexo-pipe-'));
    let child;
    try {
        const spawned = await spawnBrowserWithPipe(CHROME, [`--user-data-dir=${dir}`, '--headless=new', '--no-first-run', 'about:blank']);
        child = spawned.child;
        const h = spawned.hub.handle();
        // Chrome frio, com a suíte inteira rodando junto, pode passar dos 8s no primeiro comando.
        let version;
        for (let tries = 0; !version; tries++) {
            try {
                version = await h.send('Browser.getVersion');
            } catch (err) {
                if (tries >= 3 || !/Timeout/.test(String(err?.message))) throw err;
            }
        }
        assert.match(version.product, /Chrome|Edg/);
        assert.equal(existsSync(join(dir, 'DevToolsActivePort')), false);
        const exited = new Promise((r) => child.once('exit', r));
        spawned.hub.destroy();
        await Promise.race([exited, new Promise((_, rej) => setTimeout(() => rej(new Error('navegador não encerrou')), 15_000))]);
    } finally {
        try { child?.kill(); } catch { /* já encerrado */ }
        await new Promise((r) => setTimeout(r, 300));
        // limpeza é melhor esforço: o Windows pode segurar arquivos do perfil por alguns segundos
        try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* fica no %TEMP% */ }
    }
});
