import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { rmtRadar, parseRmtPriceEl } from '../src/modules/rmt-radar.js';
import { createRuntime } from '../src/modules/runtime.js';

const card = (nome, preco, { orb = false, retido = false } = {}) =>
    `<div class="cm-card"><span class="cm-nome-txt"> ${nome} </span><div class="cm-rodape"><span class="cm-preco${orb ? ' orb' : ''}">${preco}</span><button class="cm-btn comprar${retido ? ' cm-retido' : ''}">Comprar</button></div></div>`;
const itemRow = (nome, precos) =>
    `<button class="cmi-linha"><span class="cmi-nome"><b>${nome}</b></span><span class="cmi-precos">${precos.map(([v, nada]) => `<span class="cmi-de${nada ? ' nada' : ''}"><span class="cm-preco">${v}</span></span>`).join('')}</span></button>`;

const makeCtx = ({ body, title = 'Mercado da Comunidade', alerts, enabled = true, sound = true, interactable = true } = {}) => {
    const doc = new JSDOM(`<div id="modal-titulo">${title}</div><div id="modal-corpo">${body ?? ''}</div>`).window.document;
    const log = { clicks: 0, beeps: [], persist: 0, renders: 0 };
    for (const b of doc.querySelectorAll('button.cm-btn')) b.click = () => log.clicks++;
    const ctx = {
        CONFIG: { radar: { enabled, soundAlert: sound, checkIntervalMs: 1800, alerts: alerts ?? [{ nome: 'Pikachu', maxPreco: 1000, moeda: 'coins', autoComprar: false }] } },
        state: { running: true, radarNotifiedKeys: new Set(), radarHits: [], lastActionNote: '' },
        dom: { $: (s) => doc.querySelector(s), isVisible: () => true, isInteractable: () => interactable, playBeep: (f, d) => log.beeps.push([f, d]) },
        storage: { persistPrefs: () => log.persist++ },
        hud: { renderAlertList: () => log.renders++ },
    };
    return { ctx, log, doc };
};

test('radar: parseRmtPriceEl reconhece coins e gemas (classe orb ou imagem) e descarta valor inválido', () => {
    const d = new JSDOM('<span id="a" class="cm-preco">1.500</span><span id="b" class="cm-preco orb">20</span><span id="c" class="cm-preco"><img src="x/moeda-gema.png">7</span><span id="d">0</span>').window.document;
    assert.deepEqual(parseRmtPriceEl(d.getElementById('a')), { value: 1500, currency: 'coins' });
    assert.deepEqual(parseRmtPriceEl(d.getElementById('b')), { value: 20, currency: 'gemas' });
    assert.deepEqual(parseRmtPriceEl(d.getElementById('c')), { value: 7, currency: 'gemas' });
    assert.equal(parseRmtPriceEl(d.getElementById('d')), null);
    assert.equal(parseRmtPriceEl(null), null);
});

test('radar: desligado, sem alertas, parado ou fora do Mercado não varre', () => {
    for (const opt of [{ enabled: false }, { alerts: [] }, { title: 'Outra tela' }]) {
        const { ctx, log, doc } = makeCtx({ body: card('Pikachu', '500'), ...opt });
        rmtRadar.tick(ctx);
        assert.equal(log.beeps.length, 0);
        assert.equal(doc.querySelector('.cm-card').style.outline, '');
    }
    const { ctx, log } = makeCtx({ body: card('Pikachu', '500') });
    ctx.state.running = false;
    rmtRadar.tick(ctx);
    assert.equal(log.beeps.length, 0);
});

test('radar: oferta dentro do alerta destaca, avisa uma vez (som + nota) e registra o hit', () => {
    const { ctx, log, doc } = makeCtx({ body: card('Pikachu Shiny', '500') });
    rmtRadar.tick(ctx);
    const el = doc.querySelector('.cm-card');
    assert.equal(el.style.outline, '2px solid #22c55e');
    assert.deepEqual(log.beeps, [[960, 0.18]]);
    assert.equal(ctx.state.lastActionNote, 'RMT! Pikachu Shiny por 500 coins');
    assert.deepEqual(ctx.state.radarHits, [{ nome: 'Pikachu Shiny', preco: 500, moeda: 'coins' }]);
    assert.ok(ctx.state.radarNotifiedKeys.has('pk_pikachu shiny_500_coins'));

    ctx.state.lastActionNote = '';
    rmtRadar.tick(ctx); // mesma oferta: não repete aviso
    assert.equal(log.beeps.length, 1);
    assert.equal(ctx.state.lastActionNote, '');
    assert.equal(ctx.state.radarHits.length, 1);
});

test('radar: preço acima do máximo, nome diferente ou moeda diferente não casam', () => {
    const { ctx, log } = makeCtx({ body: card('Pikachu', '1.001') + card('Raichu', '10') + card('Pikachu', '10', { orb: true }) });
    rmtRadar.tick(ctx);
    assert.equal(log.beeps.length, 0);
    assert.deepEqual(ctx.state.radarHits, []);
    const t = makeCtx({ body: card('Pikachu', '10', { orb: true }), alerts: [{ nome: 'pikachu', maxPreco: 50, moeda: 'todas', autoComprar: false }] });
    rmtRadar.tick(t.ctx);
    assert.equal(t.ctx.state.radarHits[0].moeda, 'gemas');
});

test('radar: sem som quando soundAlert está desligado', () => {
    const { ctx, log } = makeCtx({ body: card('Pikachu', '500'), sound: false });
    rmtRadar.tick(ctx);
    assert.equal(log.beeps.length, 0);
    assert.equal(ctx.state.radarHits.length, 1);
});

test('radar: autoComprar clica em Comprar, exceto se não interativo ou retido', () => {
    const rule = [{ nome: 'Pikachu', maxPreco: 1000, moeda: 'coins', autoComprar: true }];
    const a = makeCtx({ body: card('Pikachu', '500'), alerts: rule });
    rmtRadar.tick(a.ctx);
    assert.equal(a.log.clicks, 1);
    assert.equal(a.ctx.state.lastActionNote, 'Compra RMT: Pikachu');

    const b = makeCtx({ body: card('Pikachu', '500', { retido: true }), alerts: rule });
    rmtRadar.tick(b.ctx);
    assert.equal(b.log.clicks, 0);

    const c = makeCtx({ body: card('Pikachu', '500'), alerts: rule, interactable: false });
    rmtRadar.tick(c.ctx);
    assert.equal(c.log.clicks, 0);
});

test('radar: linhas de item usam só preços ativos (sem .nada) e a chave "it_"', () => {
    const { ctx, log, doc } = makeCtx({
        body: itemRow('Pokébola', [['300', false], ['5', true]]),
        alerts: [{ nome: 'pokebola', maxPreco: 400, moeda: 'coins', autoComprar: true }],
    });
    rmtRadar.tick(ctx);
    assert.equal(doc.querySelector('.cmi-linha').style.outline, '2px solid #22c55e');
    assert.equal(ctx.state.lastActionNote, 'RMT Item! Pokébola por 300 coins');
    assert.deepEqual(ctx.state.radarHits, [{ nome: 'Pokébola', preco: 300, moeda: 'coins' }]);
    assert.ok(ctx.state.radarNotifiedKeys.has('it_pokebola_300_coins'));
    assert.equal(log.clicks, 0); // itens não compram sozinhos
});

test('radar: addAlert normaliza, persiste e redesenha; entradas inválidas são recusadas', () => {
    const { ctx, log } = makeCtx({ alerts: [] });
    assert.equal(rmtRadar.addAlert(ctx, { nome: '  Mew ', maxPreco: '999', moeda: 'Gemas', autoComprar: 1 }), true);
    assert.deepEqual(ctx.CONFIG.radar.alerts, [{ nome: 'Mew', maxPreco: 999, moeda: 'gemas', autoComprar: true }]);
    assert.deepEqual([log.persist, log.renders], [1, 1]);
    assert.equal(rmtRadar.addAlert(ctx, { nome: '', maxPreco: 5 }), false);
    assert.equal(rmtRadar.addAlert(ctx, { nome: 'x', maxPreco: 0 }), false);
    assert.equal(rmtRadar.addAlert(ctx, { nome: 'Y', maxPreco: 5 }), true);
    assert.equal(ctx.CONFIG.radar.alerts[1].moeda, 'coins');
    assert.equal(ctx.CONFIG.radar.alerts[1].autoComprar, false);
});

test('radar: removeAlert tira pelo índice e ignora índice fora do intervalo', () => {
    const { ctx, log } = makeCtx({ alerts: [{ nome: 'a' }, { nome: 'b' }] });
    rmtRadar.removeAlert(ctx, 5);
    rmtRadar.removeAlert(ctx, -1);
    assert.equal(ctx.CONFIG.radar.alerts.length, 2);
    assert.equal(log.persist, 0);
    rmtRadar.removeAlert(ctx, 0);
    assert.deepEqual(ctx.CONFIG.radar.alerts, [{ nome: 'b' }]);
    assert.deepEqual([log.persist, log.renders], [1, 1]);
});

test('radar: via runtime (agendamento e métodos extras)', () => {
    const { ctx } = makeCtx({ alerts: [] });
    const added = [];
    const rt = createRuntime(ctx, { scheduler: { add: (t) => added.push(t), dispose() {}, start() {} } });
    rt.register(rmtRadar);
    assert.deepEqual(added.map((t) => [t.id, t.everyMs]), [['rmtRadar', 1800]]);
    assert.equal(rt.call('rmtRadar', 'addAlert', { nome: 'Mew', maxPreco: 10 }), true);
    assert.equal(ctx.CONFIG.radar.alerts.length, 1);
});
