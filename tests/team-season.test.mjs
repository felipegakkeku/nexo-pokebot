import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { teamSeason, getTeamCards } from '../src/modules/team-season.js';
import { createRuntime } from '../src/modules/runtime.js';

const VALID_TYPES = new Set(['FIRE', 'WATER', 'GRASS', 'NORMAL', 'ELECTRIC']);

const row = ({ id, name, lv, title = '', hp = 100, active = false }) =>
    `<div class="poke-linha${active ? ' ativo' : ''}" data-id="${id}" title="${title}"><div class="pl-info"><span class="pl-nome">${name}<span class="pl-lv">Nv ${lv}</span></span></div><div class="mini-hp"><i style="width:${hp}%"></i></div></div>`;

// Equipe padrão: ativo Charmander Nv20 (id a); Bulbasaur Nv10 (b); Squirtle Nv15 (c)
const makeCtx = ({ rows, mode = 'equilibrar', active = { name: 'Charmander', level: 20, hpPercent: 100, power: 50, types: ['FIRE'] }, trainerLv = 30, dayType = null, snap = null, now = 1e12, hunt = null } = {}) => {
    const html = `<div id="time">${rows ?? [
        row({ id: 'a', name: 'Charmander', lv: 20, title: 'FIRE · poder 50', active: true }),
        row({ id: 'b', name: 'Bulbasaur', lv: 10, title: 'GRASS · poder 20' }),
        row({ id: 'c', name: 'Squirtle', lv: 15, title: 'WATER · poder 30' }),
    ].join('')}</div>`;
    const doc = new JSDOM(html).window.document;
    const log = { clicks: [], beeps: 0 };
    for (const el of doc.querySelectorAll('.pl-info')) el.click = () => log.clicks.push(el.closest('.poke-linha').getAttribute('data-id'));
    const ctx = {
        CONFIG: { team: { mode, checkIntervalMs: 4000, swapCooldownMs: 12000, failedSwapBackoffMs: 60000, unsafeBackoffMs: 180000, maxGapBelowHunt: 0, minTrainPower: 2, minTrainHpPercent: 75, rescueHpPercent: 55 } },
        state: { running: true, paused: false, modalLockOwner: null, lastTeamSwapAt: 0, teamSwapPotionSnap: null, failedSwapUntil: {}, unsafeTrainUntil: {}, stats: { teamSwaps: 0 }, lastActionNote: '' },
        consts: { VALID_TYPES, ESPERA_TROCA_ATIVO_MS: 3250 },
        dom: {
            $: (sel) => doc.querySelector(sel),
            getDirectText: (el) => (el ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() || 'Desconhecido' : 'Desconhecido'),
            isVisible: () => true,
            isInSpecialArena: () => false,
            getActivePokemon: () => active,
            getCurrentHunt: () => hunt,
            getTrainerHeaderInfo: () => ({ level: trainerLv }),
            getSeasonalDayType: () => dayType,
            readNativeSessionPanel: () => snap,
        },
    };
    return { ctx, log, doc, now };
};

// setTimeout falso: guarda a função para rodar a verificação de troca na hora
const withFakeTimeout = async (fn) => {
    const real = globalThis.setTimeout;
    const pending = [];
    globalThis.setTimeout = (cb, ms) => { pending.push({ cb, ms }); return 0; };
    try { return await fn(pending); } finally { globalThis.setTimeout = real; }
};

test('equipe: getTeamCards lê nível, poder, tipos, hp e chave', () => {
    const { ctx } = makeCtx({ rows: [row({ id: '', name: 'Pikachu', lv: 12, title: 'ELECTRIC / NORMAL · poder 1.234', hp: 40 })].join('') });
    const [c] = getTeamCards(ctx);
    assert.deepEqual({ name: c.name, level: c.level, power: c.power, types: c.types, hp: c.hpPercent, key: c.key }, { name: 'Pikachu', level: 12, power: 1234, types: ['ELECTRIC', 'NORMAL'], hp: 40, key: 'Pikachu_12' });
    assert.equal(getTeamCards({ ...ctx, dom: { ...ctx.dom, $: () => null } }).length, 0);
});

test('equipe: modo off, pausado, modal travado ou arena não fazem nada', async () => {
    for (const patch of [{ mode: 'off' }, { paused: true }, { modalLockOwner: 'x' }]) {
        const { ctx, log } = makeCtx({ mode: patch.mode ?? 'equilibrar' });
        Object.assign(ctx.state, { paused: patch.paused ?? false, modalLockOwner: patch.modalLockOwner ?? null });
        teamSeason.tick(ctx);
        assert.equal(log.clicks.length, 0);
    }
    const { ctx, log } = makeCtx();
    ctx.dom.isInSpecialArena = () => true;
    teamSeason.tick(ctx);
    assert.equal(log.clicks.length, 0);
});

test('equipe: equilibrar treina o mais fraco seguro (nível+1 < ativo) e confirma a troca', async () => {
    await withFakeTimeout(async (pending) => {
        const { ctx, log, doc } = makeCtx();
        teamSeason.tick(ctx);
        assert.deepEqual(log.clicks, ['b']);
        assert.ok(Date.now() - ctx.state.lastTeamSwapAt < 1000);
        assert.equal(pending[0].ms, 1600);
        // jogo troca o ativo
        doc.querySelector('.ativo').classList.remove('ativo');
        doc.querySelector('[data-id=b]').classList.add('ativo');
        pending[0].cb();
        assert.equal(ctx.state.stats.teamSwaps, 1);
        assert.equal(ctx.state.lastActionNote, 'Equipe: Bulbasaur Nv10');
    });
});

test('equipe: troca que não aconteceu gera backoff de falha; parado, nada acontece', async () => {
    await withFakeTimeout(async (pending) => {
        const { ctx } = makeCtx();
        teamSeason.tick(ctx);
        const before = Date.now();
        pending[0].cb();
        assert.equal(ctx.state.stats.teamSwaps, 0);
        assert.ok(ctx.state.failedSwapUntil.b >= before + 60000);
        const b = makeCtx();
        teamSeason.tick(b.ctx);
        b.ctx.state.running = false;
        pending[1].cb();
        assert.equal(b.ctx.state.stats.teamSwaps, 0);
        assert.deepEqual(b.ctx.state.failedSwapUntil, {});
    });
});

test('equipe: respeita o cooldown da última troca e o backoff de falha', async () => {
    await withFakeTimeout(async () => {
        const a = makeCtx();
        a.ctx.state.lastTeamSwapAt = Date.now() - 5000; // < 12000
        teamSeason.tick(a.ctx);
        assert.equal(a.log.clicks.length, 0);

        const b = makeCtx();
        b.ctx.state.failedSwapUntil.b = Date.now() + 30000; // b inelegível, só sobra c (nível 15 < 20-1 ok)
        teamSeason.tick(b.ctx);
        assert.deepEqual(b.log.clicks, ['c']);
    });
});

test('equipe: resgate (hp baixo) troca para o mais forte, marca o ativo como inseguro e ignora cooldown de 12s', async () => {
    await withFakeTimeout(async () => {
        const { ctx, log } = makeCtx({
            rows: [
                row({ id: 'a', name: 'Charmander', lv: 12, title: 'FIRE · poder 50', active: true }),
                row({ id: 'b', name: 'Bulbasaur', lv: 25, title: 'GRASS · poder 90' }),
            ].join(''),
            active: { name: 'Charmander', level: 12, hpPercent: 30, power: 50, types: ['FIRE'] },
        });
        ctx.state.lastTeamSwapAt = Date.now() - 4000; // > 3250, < 12000
        teamSeason.tick(ctx);
        assert.deepEqual(log.clicks, ['b']);
        assert.ok(ctx.state.unsafeTrainUntil.a > Date.now() + 170000);
        // dentro dos 3,25 s: não troca (e nem cai no modo normal)
        const w = makeCtx({ rows: [row({ id: 'a', name: 'C', lv: 12, title: 'FIRE', active: true }), row({ id: 'b', name: 'B', lv: 25 })].join(''), active: { name: 'C', level: 12, hpPercent: 30, power: 50, types: [] } });
        w.ctx.state.lastTeamSwapAt = Date.now() - 1000;
        teamSeason.tick(w.ctx);
        assert.equal(w.log.clicks.length, 0);
    });
});

test('equipe: resgate também dispara quando gastou poção/revive desde a última troca', async () => {
    await withFakeTimeout(async () => {
        const { ctx, log } = makeCtx({
            rows: [row({ id: 'a', name: 'C', lv: 12, title: 'FIRE', active: true }), row({ id: 'b', name: 'B', lv: 25 })].join(''),
            active: { name: 'C', level: 12, hpPercent: 100, power: 50, types: [] },
            snap: { pocoesUsadas: 3, revivesUsados: 0 },
        });
        ctx.state.teamSwapPotionSnap = { pocoes: 2, revives: 0 };
        teamSeason.tick(ctx);
        assert.deepEqual(log.clicks, ['b']);
        assert.match(ctx.state.lastActionNote, /^$/); // a nota só muda quando a troca é confirmada (timer)
    });
});

test('equipe: treinador com nível baixo exclui quem passa de nível+5; menos de 2 elegíveis não troca', async () => {
    await withFakeTimeout(async () => {
        const { ctx, log } = makeCtx({ trainerLv: 8 }); // só b (10) <= 13 ... a e c > 13
        teamSeason.tick(ctx);
        assert.equal(log.clicks.length, 0);
    });
});

test('equipe: sazonal troca para quem tem o tipo do dia, só se o ativo não tem', async () => {
    await withFakeTimeout(async () => {
        const a = makeCtx({ mode: 'sazonal', dayType: 'GRASS' });
        teamSeason.tick(a.ctx);
        assert.deepEqual(a.log.clicks, ['b']);

        const b = makeCtx({ mode: 'sazonal', dayType: 'FIRE' }); // ativo já é FIRE
        teamSeason.tick(b.ctx);
        assert.equal(b.log.clicks.length, 0);

        const c = makeCtx({ mode: 'sazonal', dayType: null });
        teamSeason.tick(c.ctx);
        assert.equal(c.log.clicks.length, 0);
    });
});

test('equipe: contrato do módulo e agendamento via runtime', () => {
    assert.equal(teamSeason.id, 'teamSeason');
    const { ctx } = makeCtx();
    assert.equal(teamSeason.everyMs(ctx), 4000);
    const added = [];
    const rt = createRuntime(ctx, { scheduler: { add: (t) => added.push(t), dispose() {}, start() {} } });
    rt.register(teamSeason);
    assert.deepEqual(added.map((t) => [t.id, t.everyMs]), [['teamSeason', 4000]]);
});
