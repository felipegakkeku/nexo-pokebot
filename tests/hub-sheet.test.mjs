import test from 'node:test';
import assert from 'node:assert/strict';
import {
    hubSheet,
    evaluateSheetCopy,
    describeSheetResult,
    copyNativeSheet,
    copyActiveSheet,
    copiarFichaHunt,
    closeSheetModal,
} from '../src/modules/hub-sheet.js';
import { makeCtx } from './fake-ctx.mjs';

const SHEET = '# Charmander — ficha do PokeIdle\n\n' + '- Espécie: Charmander (#4) — FIRE\n'.repeat(20);

// Jogo falso: clicar no card abre a ficha (#fi-gpt e #ficha-fechar); #fi-gpt chama navigator.clipboard.writeText
const makeGame = ({ hasCard = true, opensSheet = true, copyText = SHEET } = {}) => {
    const game = { open: false, clicks: 0, closed: 0, closeActive: 0 };
    const gpt = { click: () => { game.clicks++; globalThis.navigator.clipboard.writeText(copyText); } };
    const fechar = { click: () => { game.closed++; game.open = false; } };
    const card = { click: () => { if (opensSheet) game.open = true; } };
    const dom = {
        $: (sel) => {
            if (sel === '#ativo-card') return hasCard ? card : null;
            if (sel === '#fi-gpt') return game.open ? gpt : null;
            if (sel === '#ficha-fechar') return game.open ? fechar : null;
            return null;
        },
        waitFor: async (fn) => fn() || null,
        closeActiveModal: async () => { game.closeActive++; game.open = false; },
    };
    return { game, dom };
};

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const realWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const withClipboard = (clipboard, fn) => async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true, writable: true });
    try {
        await fn();
    } finally {
        if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
        else delete globalThis.navigator;
        if (realWindow) Object.defineProperty(globalThis, 'window', realWindow);
        else delete globalThis.window;
    }
};

test('conferência da cópia: com gancho precisa parecer ficha; sem gancho aceita', () => {
    assert.deepEqual(evaluateSheetCopy({ hooked: true, captured: SHEET }), { ok: true, text: SHEET, reason: '' });
    const bad = evaluateSheetCopy({ hooked: true, captured: 'texto qualquer' });
    assert.deepEqual([bad.ok, bad.text, bad.reason], [false, 'texto qualquer', 'O jogo não copiou a ficha (clipboard bloqueado?)']);
    assert.equal(evaluateSheetCopy({ hooked: true, captured: null }).ok, false);
    assert.deepEqual(evaluateSheetCopy({ hooked: false, captured: null }), { ok: true, text: null, reason: '' });
});

test('mensagem do HUD: ocupado, copiada (com/sem tamanho e Hub), falha', () => {
    assert.equal(describeSheetResult(null), 'Ficha: bot ocupado, tente de novo');
    assert.equal(describeSheetResult({ ok: true, text: 'abc' }), 'Ficha copiada (3 car.)!');
    assert.equal(describeSheetResult({ ok: true, text: 'abc' }, true), 'Ficha copiada (3 car.) — cole no Hub');
    assert.equal(describeSheetResult({ ok: true, text: null }), 'Ficha copiada!');
    assert.equal(describeSheetResult({ ok: false, reason: 'motivo' }), 'Ficha: motivo');
});

test('copiar ficha nativa: abre a ficha, aciona o botão do jogo, devolve o texto, fecha e restaura o clipboard', withClipboard(
    { writeText: async () => {} },
    async () => {
        const clip = Object.create({ writeText: async () => {} });
        Object.defineProperty(globalThis, 'navigator', { value: { clipboard: clip }, configurable: true, writable: true });
        const { game, dom } = makeGame();
        const { ctx } = makeCtx({ dom });
        const res = await copyNativeSheet(ctx);
        assert.deepEqual(res, { ok: true, text: SHEET, reason: '' });
        assert.equal(game.clicks, 1);
        assert.equal(game.open, false, 'modal fechado');
        assert.equal(game.closed, 1);
        assert.equal(Object.prototype.hasOwnProperty.call(clip, 'writeText'), false, 'cópia própria removida (volta ao protótipo)');
    }
));

test('copiar ficha nativa: restaura writeText próprio do clipboard', withClipboard(
    null,
    async () => {
        const calls = [];
        const clip = { writeText: async (t) => { calls.push(t); } };
        const hooked = clip.writeText;
        Object.defineProperty(globalThis, 'navigator', { value: { clipboard: clip }, configurable: true, writable: true });
        const { dom } = makeGame();
        const { ctx } = makeCtx({ dom });
        await copyNativeSheet(ctx);
        assert.notEqual(clip.writeText, hooked, 'volta a uma função que chama o original');
        await clip.writeText('depois');
        assert.equal(calls.at(-1), 'depois');
        assert.equal(Object.prototype.hasOwnProperty.call(clip, 'writeText'), true);
    }
));

test('ficha: sem card do Pokémon ativo, ou botão que não aparece, devolve o motivo (e fecha o que abriu)', withClipboard(
    { writeText: async () => {} },
    async () => {
        const a = makeGame({ hasCard: false });
        assert.deepEqual(await copyNativeSheet(makeCtx({ dom: a.dom }).ctx), { ok: false, reason: 'Pokémon ativo não encontrado' });

        const b = makeGame({ opensSheet: false });
        const res = await copyNativeSheet(makeCtx({ dom: b.dom }).ctx);
        assert.deepEqual(res, { ok: false, reason: 'Botão "Copiar p/ ChatGPT" não apareceu' });
        assert.equal(b.game.closeActive, 1, 'sem botão de fechar da ficha: fecha o modal ativo');
    }
));

test('ficha: texto copiado que não é ficha vira falha; clipboard impossível de sobrescrever segue sem conferir', withClipboard(
    { writeText: async () => {} },
    async () => {
        const bad = makeGame({ copyText: 'texto qualquer' });
        const res = await copyNativeSheet(makeCtx({ dom: bad.dom }).ctx);
        assert.equal(res.ok, false);
        assert.equal(res.text, 'texto qualquer');

        const frozen = Object.freeze({ writeText: async () => {} });
        Object.defineProperty(globalThis, 'navigator', { value: { clipboard: frozen }, configurable: true, writable: true });
        const ok = makeGame();
        const r2 = await copyNativeSheet(makeCtx({ dom: ok.dom }).ctx);
        assert.deepEqual(r2, { ok: true, text: null, reason: '' });
    }
));

test('fechar a ficha: pelo botão dela, ou pelo modal ativo se não houver', async () => {
    const a = makeGame();
    a.game.open = true;
    await closeSheetModal(makeCtx({ dom: a.dom }).ctx);
    assert.deepEqual([a.game.closed, a.game.closeActive], [1, 0]);

    const b = makeGame();
    await closeSheetModal(makeCtx({ dom: b.dom }).ctx);
    assert.deepEqual([b.game.closed, b.game.closeActive], [0, 1]);
});

test('copyActiveSheet: usa o lock "Copiando ficha" (force), escreve a nota e abre o Hub só quando pedido', withClipboard(
    { writeText: async () => {} },
    async () => {
        const opened = [];
        Object.defineProperty(globalThis, 'window', { value: { open: (...a) => opened.push(a) }, configurable: true, writable: true });

        const a = makeGame();
        const ca = makeCtx({ dom: a.dom });
        assert.equal(await copyActiveSheet(ca.ctx), SHEET);
        assert.deepEqual(ca.log.locks, ['Copiando ficha']);
        assert.equal(ca.ctx.state.lastActionNote, `Ficha copiada (${SHEET.length} car.)!`);
        assert.deepEqual(opened, []);

        const b = makeGame();
        const cb = makeCtx({ dom: b.dom });
        assert.equal(await copiarFichaHunt(cb.ctx, true), SHEET);
        assert.equal(cb.ctx.state.lastActionNote, `Ficha copiada (${SHEET.length} car.) — cole no Hub`);
        assert.deepEqual(opened, [['https://guia.test/#hunt', '_blank', 'noopener,noreferrer']]);
        assert.ok(cb.log.huds >= 1);
    }
));

test('copyActiveSheet: falha mostra o motivo e não abre o Hub; bot ocupado devolve null', withClipboard(
    { writeText: async () => {} },
    async () => {
        const opened = [];
        Object.defineProperty(globalThis, 'window', { value: { open: (...a) => opened.push(a) }, configurable: true, writable: true });

        const a = makeGame({ copyText: 'x' });
        const ca = makeCtx({ dom: a.dom });
        assert.equal(await copyActiveSheet(ca.ctx, { openSite: true }), 'x');
        assert.equal(ca.ctx.state.lastActionNote, 'Ficha: O jogo não copiou a ficha (clipboard bloqueado?)');
        assert.deepEqual(opened, []);

        const b = makeCtx({ dom: makeGame().dom });
        b.ctx.withModalLock = async () => null;
        assert.equal(await copyActiveSheet(b.ctx), null);
        assert.equal(b.ctx.state.lastActionNote, 'Ficha: bot ocupado, tente de novo');
    }
));

test('módulo expõe os métodos usados pelos aliases', () => {
    assert.equal(hubSheet.id, 'hubSheet');
    assert.equal(typeof hubSheet.copyActiveSheet, 'function');
    assert.equal(typeof hubSheet.copiarFichaHunt, 'function');
});
