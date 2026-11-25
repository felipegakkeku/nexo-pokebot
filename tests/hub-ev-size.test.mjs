import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regressao 1.0.24: o seletor [data-ev-size] casava com o <html> e apagava a pagina inteira.
test('seletores de tamanho do card de eventos nao casam com o <html>', () => {
    const js = readFileSync(new URL('../src/electron/hub-ui.js', import.meta.url), 'utf8');
    assert.ok(!/['"`]\[data-ev-size\][^'"`]*['"`]/.test(js), 'use button[data-ev-size], nunca [data-ev-size] solto');
    assert.ok(js.includes('dataset.evHeight'));
});
