import test from 'node:test';
import assert from 'node:assert/strict';
import { autoEvolve, evaluateEvolveRequirements } from '../src/modules/auto-evolve.js';
import { createRuntime } from '../src/modules/runtime.js';

// ctx falso (sem DOM): o módulo só usa o que vem em ctx
const makeCtx = ({ enabled = true, met = false, pokeName = 'Charmander', confirmOpens = true, btnVisible = true } = {}) => {
    const log = { evolveClicks: 0, confirm: 0, cancel: 0, locks: [], closes: 0 };
    let dialogOpen = false;
    const dlg = (ok, text) => ({ classList: { contains: (c) => c === 'falta' && !ok }, innerText: text });
    const btn = (key) => ({
        click: () => {
            if (key === 'evoluir') { log.evolveClicks++; dialogOpen = confirmOpens; }
            if (key === 'sim') { log.confirm++; dialogOpen = false; }
            if (key === 'nao') { log.cancel++; dialogOpen = false; }
        },
    });
    const sim = btn('sim');
    sim.closest = () => ({ querySelectorAll: () => [dlg(met, `Fire Stone na mochila ${met ? 1 : 0}/1`), dlg(met, `nível mínimo Nv ${met ? 40 : 18}`)] });
    const nao = btn('nao');
    const evoluir = btn('evoluir');
    const ctx = {
        CONFIG: { evolve: { enabled, checkIntervalMs: 8000, cooldownMs: 15000, recheckMs: 600000 }, shinyGuard: { enabled: false } },
        state: { running: true, paused: false, modalLockOwner: null, shinyAlertActive: false, evolveNextAt: 0, lastActionNote: '' },
        sleep: async () => {},
        randomDelay: () => 0,
        updateHud: () => {},
        withModalLock: async (label, fn) => { log.locks.push(label); return fn(); },
        dom: {
            $: (sel) => ({ '#btn-evoluir': btnVisible ? evoluir : null, '#confirmar-sim': dialogOpen ? sim : null, '#confirmar-nao': dialogOpen ? nao : null })[sel] ?? null,
            getVisibleModal: () => null,
            closeActiveModal: async () => { log.closes++; dialogOpen = false; },
            isInteractable: () => true,
            isInSpecialArena: () => false,
            getActivePokemon: () => ({ name: pokeName }),
            waitFor: async (fn) => fn(),
        },
    };
    return { ctx, log };
};

test('auto-evoluir (módulo): requisito faltando cancela e não confirma', async () => {
    const { ctx, log } = makeCtx({ met: false });
    await autoEvolve.tick(ctx);
    assert.deepEqual({ e: log.evolveClicks, c: log.confirm, x: log.cancel }, { e: 1, c: 0, x: 1 });
    assert.match(ctx.state.lastActionNote, /^Evolução adiada: falta Fire Stone na mochila 0\/1 \+ nível mínimo Nv 18$/);
});

test('auto-evoluir (módulo): depois de adiar espera 10 min; depois de evoluir espera o cooldown', async () => {
    const a = makeCtx({ met: false });
    await autoEvolve.tick(a.ctx);
    await autoEvolve.tick(a.ctx);
    assert.equal(a.log.evolveClicks, 1);
    assert.ok(a.ctx.state.evolveNextAt - Date.now() > 590000);

    const b = makeCtx({ met: true });
    await autoEvolve.tick(b.ctx);
    await autoEvolve.tick(b.ctx);
    assert.deepEqual({ e: b.log.evolveClicks, c: b.log.confirm, x: b.log.cancel }, { e: 1, c: 1, x: 0 });
    assert.ok(b.ctx.state.evolveNextAt - Date.now() <= 15000);
});

test('auto-evoluir (módulo): desligado, sem botão, pausado ou Eevee não clicam em nada', async () => {
    for (const opts of [{ enabled: false }, { btnVisible: false }, { pokeName: 'Eevee' }]) {
        const { ctx, log } = makeCtx(opts);
        await autoEvolve.tick(ctx);
        assert.equal(log.evolveClicks, 0, JSON.stringify(opts));
    }
    const { ctx, log } = makeCtx();
    ctx.state.paused = true;
    await autoEvolve.tick(ctx);
    assert.equal(log.evolveClicks, 0);
});

test('auto-evoluir (módulo): se a confirmação não abre, avisa e espera a janela', async () => {
    const { ctx, log } = makeCtx({ confirmOpens: false });
    await autoEvolve.tick(ctx);
    assert.equal(log.confirm, 0);
    assert.match(ctx.state.lastActionNote, /confirmação não abriu/);
    assert.ok(ctx.state.evolveNextAt > Date.now());
});

test('auto-evoluir (módulo): registra no runtime com o período da config', () => {
    const { ctx } = makeCtx();
    const rt = createRuntime(ctx);
    rt.register(autoEvolve);
    assert.deepEqual(rt.scheduler.list(), ['autoEvolve']);
    rt.dispose();
});

test('requisitos de evolução: só aprova com todas as linhas ok', () => {
    const ok = [{ ok: true, text: 'Fire Stone na mochila 1/1' }, { ok: true, text: 'nível mínimo Nv 40' }];
    assert.equal(evaluateEvolveRequirements(ok).ok, true);

    const falta = [{ ok: false, text: 'Fire Stone na mochila 0/1' }, { ok: false, text: 'nível mínimo Nv 18' }];
    const r = evaluateEvolveRequirements(falta);
    assert.equal(r.ok, false);
    assert.match(r.reason, /^falta Fire Stone na mochila 0\/1 \+ nível mínimo Nv 18$/);
});

test('requisitos de evolução: sem requisito legível ou com Shiny Stone, não confirma', () => {
    assert.equal(evaluateEvolveRequirements([]).ok, false);
    assert.equal(evaluateEvolveRequirements(null).ok, false);
    const shiny = [{ ok: true, text: 'Shiny Stone na mochila 1/1' }, { ok: true, text: 'nível mínimo Nv 40' }];
    assert.equal(evaluateEvolveRequirements(shiny).ok, false);
});
