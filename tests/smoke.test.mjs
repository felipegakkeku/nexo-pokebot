// Smoke test: carrega o userscript gerado num DOM falso (jsdom) parecido com o do jogo,
// e confere HUD, API pública, fila manual (sem reload) e limpeza no stop().
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = readFileSync(join(root, 'dist', 'pokebot.user.js'), 'utf8');

const GAME_HTML = `<!doctype html><html><body>
<div id="tr-level">16</div><div id="tr-gold">8.771.347</div><div id="tr-diamantes">0</div><div id="tr-gemas">0</div>
<div id="hud-hunt">Paras · nível 1</div>
<div id="ativo-card"><div class="ativo-nome">Charmander<span class="pl-lv">Nv 16</span></div><div class="ativo-sub"><span class="tipo">FIRE</span> poder 47</div>
  <div class="barra hp"><div class="fill" style="width:55%"></div><span>158 / 288</span></div></div>
<button id="btn-evoluir" style="opacity:1">Evoluir</button>
<div id="caidos-lista"></div><div id="hud-log"></div><div id="sessao-painel"></div><div id="time"></div>
</body></html>`;

const boot = () => {
    const dom = new JSDOM(GAME_HTML, { runScripts: 'outside-only', url: 'https://pokeidle.io/app', pretendToBeVisual: true });
    const { window } = dom;
    // jsdom não faz layout: considera todo elemento conectado como visível (estrutura do HTML abaixo conferida no DOM real do jogo)
    Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return this.parentNode; } });
    window.requestIdleCallback = (fn) => setTimeout(fn, 0);
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    window.eval(script);
    return window;
};

test('o userscript carrega, monta o HUD e expõe a API', async () => {
    const w = boot();
    try {
        assert.ok(w.document.getElementById('pokebot-hud'), 'HUD deveria existir');
        for (const fn of ['status', 'pausar', 'retomar', 'stop', 'definirFilaHunt', 'carregarFilaManual', 'copiarFichaHunt', 'proximaHuntGuia', 'syncHuntGuide']) {
            assert.equal(typeof w.PokeBot[fn], 'function', `PokeBot.${fn}`);
        }
        const st = w.PokeBot.status();
        assert.equal(st.autoEvoluir, false, 'Auto-Evoluir começa desligado');
        assert.equal(st.filaHuntTotal, 0);
        assert.match(st.pokemon, /^Charmander Nv ?16/);
    } finally {
        w.PokeBot?.stop();
    }
});

test('fila manual: carrega da caixa do HUD, persiste e não recarrega a página', async () => {
    const w = boot();
    try {
        const box = w.document.getElementById('pb-manual-queue');
        assert.ok(box, 'caixa da fila manual');
        box.value = '1. Kakuna Nv 10 38,1 mil XP/h ✓ 6%\n2. Magnemite Nv 10 ⚠ 9%';
        w.document.querySelector('[data-pb-act="loadManual"]').click();
        await new Promise((r) => setTimeout(r, 50));
        const st = w.PokeBot.status();
        assert.equal(st.filaHuntTotal, 2);
        assert.equal(st.filaHuntProximo, 'Kakuna');
        const saved = JSON.parse(w.localStorage.getItem('pokeidle_hunt_queue_v63'));
        assert.equal(saved.items.length, 2);
        assert.equal(saved.index, 0);
    } finally {
        w.PokeBot?.stop();
    }
});

test('stop() remove o HUD e libera a instância', async () => {
    const w = boot();
    w.PokeBot.stop();
    assert.equal(w.document.getElementById('pokebot-hud'), null);
});

test('recarregar o script não duplica o HUD', async () => {
    const w = boot();
    try {
        w.eval(script);
        assert.equal(w.document.querySelectorAll('#pokebot-hud').length, 1);
    } finally {
        w.PokeBot?.stop();
    }
});

const enableEvolve = (w) => {
    if (!w.PokeBot.status().autoEvoluir) w.document.querySelector('[data-pb-tog="evolve"]').click();
    assert.equal(w.PokeBot.status().autoEvoluir, true);
};

// Imita a confirmação real do jogo: clicar em #btn-evoluir abre .modal-caixa com linhas .dlg-req ("falta" = não atendido)
const fakeEvolveDialog = (w, { metAll }) => {
    const calls = { evolve: 0, confirm: 0, cancel: 0 };
    w.document.getElementById('btn-evoluir').addEventListener('click', () => {
        calls.evolve++;
        const box = w.document.createElement('div');
        box.className = 'modal-caixa';
        box.style.opacity = '1';
        const miss = metAll ? '' : ' falta';
        box.innerHTML =
            '<h2>Evoluir pokemon</h2>' +
            `<div class="dlg-req${miss}"><small>Fire Stone na mochila</small><span class="dlg-req-qtd"><span class="tem">${metAll ? 1 : 0}</span><small>/1</small></span></div>` +
            `<div class="dlg-req${miss}"><small>nível mínimo</small><span class="dlg-req-qtd"><span class="tem">Nv ${metAll ? 40 : 18}</span></span></div>` +
            '<button id="confirmar-nao" style="opacity:1">Cancelar</button><button id="confirmar-sim" style="opacity:1">Confirmar</button>';
        w.document.body.appendChild(box);
        box.querySelector('#confirmar-nao').addEventListener('click', () => { calls.cancel++; box.remove(); });
        box.querySelector('#confirmar-sim').addEventListener('click', () => { calls.confirm++; box.remove(); });
    });
    return calls;
};

test('auto-evoluir: com requisito faltando, abre a confirmação, cancela e não confirma', async () => {
    const w = boot();
    try {
        const calls = fakeEvolveDialog(w, { metAll: false });
        enableEvolve(w);
        await w.PokeBot.verificarEvolucao();
        assert.deepEqual({ ...calls }, { evolve: 1, confirm: 0, cancel: 1 });
        assert.equal(w.document.querySelector('.modal-caixa'), null, 'confirmação deveria ter sido fechada');
        assert.match(w.document.querySelector('#pokebot-hud').textContent, /Evolução adiada: falta Fire Stone/);
    } finally {
        w.PokeBot?.stop();
    }
});

test('auto-evoluir: depois de adiar, não reabre a confirmação dentro da janela de espera', async () => {
    const w = boot();
    try {
        const calls = fakeEvolveDialog(w, { metAll: false });
        enableEvolve(w);
        await w.PokeBot.verificarEvolucao();
        await w.PokeBot.verificarEvolucao();
        await w.PokeBot.verificarEvolucao();
        assert.equal(calls.evolve, 1);
    } finally {
        w.PokeBot?.stop();
    }
});

test('auto-evoluir: com todos os requisitos ok, confirma uma vez', async () => {
    const w = boot();
    try {
        const calls = fakeEvolveDialog(w, { metAll: true });
        enableEvolve(w);
        await w.PokeBot.verificarEvolucao();
        await w.PokeBot.verificarEvolucao(); // cooldown pós-evolução: não repete
        assert.deepEqual({ ...calls }, { evolve: 1, confirm: 1, cancel: 0 });
    } finally {
        w.PokeBot?.stop();
    }
});

test('auto-evoluir: desligado (padrão) nunca clica em Evoluir', async () => {
    const w = boot();
    try {
        const calls = fakeEvolveDialog(w, { metAll: true });
        await w.PokeBot.verificarEvolucao();
        assert.equal(calls.evolve, 0);
    } finally {
        w.PokeBot?.stop();
    }
});

test('ficha: abre a ficha, aciona "Copiar p/ ChatGPT" do jogo, confere o texto e fecha o modal', async () => {
    const w = boot();
    try {
        const SHEET = '# Charmander — ficha do PokeIdle\n\n' + '- Espécie: Charmander (#4) — FIRE\n'.repeat(20);
        const copied = [];
        Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t); } }, configurable: true });

        // imita o jogo: clicar no card abre o modal da ficha, com #fi-gpt e #ficha-fechar
        w.document.getElementById('ativo-card').addEventListener('click', () => {
            if (w.document.getElementById('ficha-corpo')) return;
            const modal = w.document.createElement('div');
            modal.id = 'ficha-corpo';
            modal.innerHTML = '<button id="fi-gpt" style="opacity:1">Copiar p/ ChatGPT</button><button id="ficha-fechar" style="opacity:1">×</button>';
            w.document.body.appendChild(modal);
            modal.querySelector('#fi-gpt').addEventListener('click', () => w.navigator.clipboard.writeText(SHEET));
            modal.querySelector('#ficha-fechar').addEventListener('click', () => modal.remove());
        });

        const text = await w.PokeBot.copiarFichaHunt(false);
        assert.equal(text, SHEET);
        assert.equal(copied.length, 1);
        assert.equal(w.document.getElementById('ficha-corpo'), null, 'modal deveria ter sido fechado');
        assert.equal(typeof w.navigator.clipboard.writeText, 'function');
    } finally {
        w.PokeBot?.stop();
    }
});

test('ficha: se o jogo não copiar a ficha, avisa em vez de fingir que deu certo', async () => {
    const w = boot();
    try {
        Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
        w.document.getElementById('ativo-card').addEventListener('click', () => {
            if (w.document.getElementById('ficha-corpo')) return;
            const modal = w.document.createElement('div');
            modal.id = 'ficha-corpo';
            modal.innerHTML = '<button id="fi-gpt" style="opacity:1">x</button><button id="ficha-fechar" style="opacity:1">×</button>';
            w.document.body.appendChild(modal);
            modal.querySelector('#fi-gpt').addEventListener('click', () => w.navigator.clipboard.writeText('texto qualquer'));
            modal.querySelector('#ficha-fechar').addEventListener('click', () => modal.remove());
        });
        const text = await w.PokeBot.copiarFichaHunt(false);
        assert.equal(text, 'texto qualquer');
        assert.match(w.document.querySelector('#pokebot-hud').textContent, /Ficha: O jogo não copiou/);
    } finally {
        w.PokeBot?.stop();
    }
});

test('módulos: checarPasse roda pelo runtime sem travar e o stop() libera o agendador', async () => {
    const w = boot();
    try {
        await w.PokeBot.checarPasse(); // sem botão de Passe no DOM falso: volta sem erro
        assert.ok(w.document.getElementById('pokebot-hud'), 'HUD continua montado');
    } finally {
        w.PokeBot?.stop();
    }
    assert.equal(w.document.getElementById('pokebot-hud'), null);
});
