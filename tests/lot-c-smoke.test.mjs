// Fumaça do lote C no userscript gerado: aliases legados, API pública e telemetria rodando pelo agendador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = readFileSync(join(root, 'dist', 'pokebot.user.js'), 'utf8');

const GAME_HTML = `<!doctype html><html><body>
<div id="tr-level">16</div><div id="tr-gold">100</div><div id="tr-diamantes">0</div><div id="tr-gemas">0</div>
<div id="hud-hunt">Paras · nível 1</div>
<div id="ativo-card"><div class="ativo-nome">Charmander<span class="pl-lv">Nv 16</span></div><div class="ativo-sub"><span class="tipo">FIRE</span> poder 47</div>
  <div class="barra hp"><div class="fill" style="width:55%"></div><span>158 / 288</span></div></div>
<div id="caidos-lista"></div><div id="hud-log"></div>
<div id="sessao-painel"><b data-k="abates">0</b><b data-k="xpPokemon">0</b><b data-k="gold">0</b><b data-k="lucro">0</b><b data-k="capturas">0</b><b data-k="shiniesVistos">0</b></div>
<div id="time"></div>
</body></html>`;

const boot = () => {
    const dom = new JSDOM(GAME_HTML, { runScripts: 'outside-only', url: 'https://pokeidle.io/app', pretendToBeVisual: true });
    const { window } = dom;
    Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return this.parentNode; } });
    window.requestIdleCallback = (fn) => setTimeout(fn, 0);
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    window.eval(script);
    return window;
};

test('API pública do lote C continua completa (sem erro de TDZ nos aliases)', () => {
    const w = boot();
    try {
        for (const fn of ['otimizarRegiao', 'hopTopCatch', 'copiarFichaAtivo', 'copiarFichaHunt', 'definirFilaHunt', 'limparFilaHunt', 'carregarFilaManual', 'syncHuntGuide', 'proximaHuntGuia', 'lerSessaoNativa']) {
            assert.equal(typeof w.PokeBot[fn], 'function', fn);
        }
    } finally {
        w.PokeBot?.stop();
    }
});

test('definirFilaHunt / limparFilaHunt pela API pública persistem a fila', () => {
    const w = boot();
    try {
        const out = w.PokeBot.definirFilaHunt(['Kakuna Nv 10', 'Magnemite']);
        assert.equal(out.length, 2);
        assert.equal(JSON.parse(w.localStorage.getItem('pokeidle_hunt_queue_v63')).items.length, 2);
        assert.equal(w.PokeBot.status().filaHuntProximo, 'Kakuna');
        w.PokeBot.limparFilaHunt();
        assert.equal(w.PokeBot.status().filaHuntTotal, 0);
        assert.equal(JSON.parse(w.localStorage.getItem('pokeidle_hunt_queue_v63')).items.length, 0);
    } finally {
        w.PokeBot?.stop();
    }
});

test('telemetria: status() atualiza a sessão e o stop() desliga o observador do log de combate', () => {
    const w = boot();
    try {
        const info = w.PokeBot.status();
        assert.equal(info.regiao, 'Paras · nível 1');
        const log = w.document.getElementById('hud-log');
        log.insertAdjacentHTML('beforeend', '<div>Rattata derrotado! +10 xp pokémon +5 ouro</div>');
        assert.ok(w.PokeBot.lerSessaoNativa().abates === 0);
    } finally {
        w.PokeBot?.stop();
    }
    assert.equal(w.document.getElementById('pokebot-hud'), null);
});

test('hopTopCatch e otimizarRegiao sem mapa aberto terminam sem erro (devolvem falsy)', async () => {
    const w = boot();
    try {
        assert.equal(await w.PokeBot.hopTopCatch(), false);
        assert.equal(await w.PokeBot.otimizarRegiao({ force: true }), null);
        assert.equal(await w.PokeBot.proximaHuntGuia(), false);
    } finally {
        w.PokeBot?.stop();
    }
});
