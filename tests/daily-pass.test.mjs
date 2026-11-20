import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyPass } from '../src/modules/daily-pass.js';
import { createRuntime } from '../src/modules/runtime.js';

// ctx falso: o módulo não toca em global nenhuma, então dá para testar sem DOM
const makeCtx = ({ enabled = true, level = 20, stored = '0', hasPassBtn = true, claimable = true, nextTs = 0 } = {}) => {
    const log = { clicks: [], locks: [], closes: 0, saved: {} };
    const resgatar = {
        disabled: !claimable,
        click: () => log.clicks.push('resgatar'),
        textContent: ' 03:12:00 ',
        querySelector: () => ({ getAttribute: () => String(nextTs) }),
    };
    const ctx = {
        CONFIG: { dailyPass: { enabled, checkIntervalMs: 60000 } },
        state: { stats: { passClaims: 0 }, lastActionNote: '' },
        sleep: async () => {},
        randomDelay: () => 0,
        withModalLock: async (label, fn) => { log.locks.push(label); return fn(); },
        keys: { passNext: 'k' },
        storage: { get: () => stored, set: (k, v) => { log.saved[k] = v; } },
        dom: {
            $: () => (hasPassBtn ? resgatar : null),
            getVisibleModal: () => null,
            closeActiveModal: async () => { log.closes++; },
            findMenuButtonByImg: () => ({ click: () => log.clicks.push('menu') }),
            findClickableByText: () => null,
            waitFor: async (fn) => fn(),
            isInteractable: () => true,
            getTrainerHeaderInfo: () => ({ level }),
        },
    };
    return { ctx, log };
};

test('passe: resgata, conta, guarda o próximo horário e fecha o modal', async () => {
    const next = Date.now() + 3 * 3600 * 1000;
    const { ctx, log } = makeCtx({ nextTs: next });
    await dailyPass.claim(ctx, { force: false });
    assert.deepEqual(log.clicks, ['menu', 'resgatar']);
    assert.equal(ctx.state.stats.passClaims, 1);
    assert.equal(log.saved.k, String(next + 5000));
    assert.equal(log.closes, 1);
});

test('passe: não tenta antes do horário guardado, nível baixo ou desligado', async () => {
    for (const opts of [{ stored: String(Date.now() + 60000) }, { level: 9 }, { enabled: false }]) {
        const { ctx, log } = makeCtx(opts);
        await dailyPass.claim(ctx, { force: false });
        assert.equal(log.locks.length, 0, JSON.stringify(opts));
    }
});

test('passe: force ignora horário, nível e liga/desliga', async () => {
    const { ctx, log } = makeCtx({ enabled: false, level: 1, stored: String(Date.now() + 99999), nextTs: Date.now() + 1000 });
    await dailyPass.claim(ctx, { force: true });
    assert.deepEqual(log.locks, ['Passe']);
});

test('passe: já resgatado só guarda o horário, sem clicar em resgatar', async () => {
    const next = Date.now() + 2 * 3600 * 1000;
    const { ctx, log } = makeCtx({ claimable: false, nextTs: next });
    await dailyPass.claim(ctx, { force: false });
    assert.deepEqual(log.clicks, ['menu']);
    assert.equal(ctx.state.stats.passClaims, 0);
    assert.equal(log.saved.k, String(next + 5000));
    assert.match(ctx.state.lastActionNote, /Passe já resgatado/);
});

test('passe: sem botão de resgate fecha o modal e não guarda nada', async () => {
    const { ctx, log } = makeCtx({ hasPassBtn: false });
    await dailyPass.claim(ctx, { force: false });
    assert.equal(log.closes, 1);
    assert.deepEqual(log.saved, {});
});

test('runtime: registra o módulo no agendador, chama método extra e limpa no dispose', async () => {
    const { ctx } = makeCtx();
    const rt = createRuntime(ctx);
    rt.register(dailyPass);
    assert.deepEqual(rt.scheduler.list(), ['dailyPass']);
    assert.equal(typeof rt.call('dailyPass', 'claim', { force: true })?.then, 'function');
    assert.equal(rt.call('naoExiste', 'claim'), undefined);
    assert.throws(() => rt.register(dailyPass), /duplicado/);
    rt.dispose();
    assert.deepEqual(rt.scheduler.list(), []);
});
