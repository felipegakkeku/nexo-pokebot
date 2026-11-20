import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPure } from './helpers.mjs';

const { normalizeText, cleanKey, parseNumber, parseSignedNumber, parseQueueEntry, parseQueueText, looksLikeSheet } = loadPure();
const names = (list) => JSON.parse(JSON.stringify(list.map((e) => [e.name, e.level]))); // JSON: evita comparar arrays de contextos vm diferentes

test('normalizeText tira acento e caixa', () => {
    assert.equal(normalizeText('  Elétrico/Água '), 'eletrico/agua');
    assert.equal(cleanKey('Mt. Moon!'), 'mtmoon');
});

test('parseNumber / parseSignedNumber', () => {
    assert.equal(parseNumber('8.771.347 ouro'), 8771347);
    assert.equal(parseNumber('sem número'), null);
    assert.equal(parseSignedNumber('-1.200'), -1200);
    assert.equal(parseSignedNumber('+35'), 35);
});

test('parseQueueEntry separa nome e nível', () => {
    assert.deepEqual(names([parseQueueEntry('Kakuna Nv 10')]), [['Kakuna', 10]]);
    assert.deepEqual(names([parseQueueEntry('Paras nível 1')]), [['Paras', 1]]);
    assert.deepEqual(names([parseQueueEntry('Viridian Forest')]), [['Viridian Forest', null]]);
    assert.deepEqual(names([parseQueueEntry('Pidgey LV.3')]), [['Pidgey', 3]]);
});

test('parseQueueText lê linhas coladas do ranking do Hub', () => {
    const txt = '1. Kakuna Nv 10 38,1 mil XP/h ✓ 6%\n2. Magnemite Nv 10 38 mil XP/h ⚠ 9%';
    assert.deepEqual(names(parseQueueText(txt)), [['Kakuna', 10], ['Magnemite', 10]]);
});

test('parseQueueText aceita separadores > | , e ignora duplicados', () => {
    const txt = 'Viridian Forest > Paras nível 1 | Kakuna Nv 10, Pidgey, Mt. Moon\nKakuna Nv 10';
    assert.deepEqual(names(parseQueueText(txt)), [
        ['Viridian Forest', null], ['Paras', 1], ['Kakuna', 10], ['Pidgey', null], ['Mt. Moon', null],
    ]);
});

test('parseQueueText não quebra vírgula decimal nem aceita lixo', () => {
    assert.equal(parseQueueText('').length, 0);
    assert.equal(parseQueueText('✓ ✗ 12 , 3').length, 0);
    assert.deepEqual(names(parseQueueText('Charmander Q 1,600 N 3,145')), [['Charmander Q 1,600 N 3,145', null]]);
});

test('looksLikeSheet reconhece a ficha nativa do jogo', () => {
    const sheet = '# Charmander — ficha do PokeIdle\n\n' + 'x'.repeat(400);
    assert.equal(looksLikeSheet(sheet), true);
    assert.equal(looksLikeSheet('Charmander Nv 16 FIRE'), false);
    assert.equal(looksLikeSheet(null), false);
});
