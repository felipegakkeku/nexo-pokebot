import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { miniGames, dexNumberToRegion } from '../src/modules/minigames.js';
import { createRuntime } from '../src/modules/runtime.js';

// O módulo usa `new Event(...)` (global do navegador): aqui vem do jsdom, que só aceita os próprios eventos
const RealEvent = globalThis.Event;
globalThis.Event = new JSDOM('').window.Event;
after(() => { globalThis.Event = RealEvent; });

const VALID_TYPES = new Set(['FIRE', 'WATER', 'GRASS', 'POISON', 'ELECTRIC', 'FLYING']);
const TYPE_ALIASES = { fire: 'FIRE', fogo: 'FIRE', water: 'WATER', agua: 'WATER', grass: 'GRASS', planta: 'GRASS', poison: 'POISON', veneno: 'POISON', electric: 'ELECTRIC' };

const DEX = [
    { id: 1, name: 'Bulbasaur', cleanName: 'bulbasaur', types: ['GRASS', 'POISON'], region: 'kanto' },
    { id: 4, name: 'Charmander', cleanName: 'charmander', types: ['FIRE'], region: 'kanto' },
    { id: 5, name: 'Charmeleon', cleanName: 'charmeleon', types: ['FIRE'], region: 'kanto' },
    { id: 155, name: 'Cyndaquil', cleanName: 'cyndaquil', types: ['FIRE'], region: 'johto' },
    { id: 25, name: 'Pikachu', cleanName: 'pikachu', types: ['ELECTRIC'], region: '' },
];

const screen = ({ fase = 'palpites', sig = 'r1|x', estagio = '1', pistas = '' } = {}) =>
    `<div id="mg-tela" data-fase="${fase}" data-estagio="${estagio}"><div id="mg-barra" data-sig="${sig}"></div><div class="mg-pistas">${pistas}</div>
     <form id="f"><input id="mg-input"><button id="mg-enviar">Enviar</button></form></div>`;

const makeCtx = ({ html, dex = DEX, enabled = true, autoGuess = false, max = 3, interactable = true } = {}) => {
    const doc = new JSDOM(html ?? screen({ pistas: '<div class="mg-tipo-sel FIRE"></div>' })).window.document;
    const log = { renders: 0, sends: 0, saved: [], huds: 0 };
    const send = doc.getElementById('mg-enviar');
    if (send) send.click = () => log.sends++;
    const ctx = {
        CONFIG: { minigame: { enabled, autoGuess, autoGuessMaxCandidates: max, checkIntervalMs: 1200 } },
        state: { running: true, dexCatalog: dex, miniGameMatches: [], currentMiniGameRoundId: '', roundTriedNames: new Set(), lastGuessedStageKey: '', lastActionNote: '' },
        keys: { dex: 'dexkey' },
        consts: { VALID_TYPES, TYPE_ALIASES },
        storage: { saveJson: (k, v) => log.saved.push([k, v]) },
        updateHud: () => log.huds++,
        hud: { renderQuizCandidates: () => log.renders++ },
        dom: { $: (s) => doc.querySelector(s), isVisible: () => true, isInteractable: () => interactable },
    };
    return { ctx, log, doc };
};

test('minigame: dexNumberToRegion cobre as faixas e valores inválidos', () => {
    assert.deepEqual([1, 151, 152, 251, 386, 493, 649, 721, 809, 905, 1025].map(dexNumberToRegion),
        ['kanto', 'kanto', 'johto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea']);
    assert.deepEqual([0, -3, null, 1026].map(dexNumberToRegion), ['', '', '', '']);
});

test('minigame: parsePokedexCsv (separador ;, tipos em PT, região pelo número) salva e avisa', () => {
    const { ctx, log } = makeCtx({ dex: [] });
    const csv = '"#";"Nome";"Tipo 1";"Tipo 2"\r\n1;Bulbasaur;Planta;Veneno\r\n4;Charmander;Fogo;\r\n1;Bulbasaur;Fogo;\r\n155;Cyndaquil;Fogo;\r\n';
    const list = miniGames.parsePokedexCsv(ctx, csv);
    assert.deepEqual(list.map((p) => [p.id, p.name, p.cleanName, p.types, p.region]), [
        [1, 'Bulbasaur', 'bulbasaur', ['GRASS', 'POISON'], 'kanto'],
        [4, 'Charmander', 'charmander', ['FIRE'], 'kanto'],
        [155, 'Cyndaquil', 'cyndaquil', ['FIRE'], 'johto'],
    ]);
    assert.equal(ctx.state.dexCatalog, list);
    assert.deepEqual(log.saved, [['dexkey', list]]);
    assert.equal(ctx.state.lastActionNote, 'Pokedex importada: 3 espécies');
    assert.equal(log.huds, 1);
});

test('minigame: parsePokedexCsv usa coluna de região quando existe; rejeita CSV sem nome/linhas', () => {
    const { ctx } = makeCtx({ dex: [] });
    const list = miniGames.parsePokedexCsv(ctx, 'num,name,type,region\n25,Pikachu,Electric,Kanto\n');
    assert.deepEqual([list[0].region, list[0].types], ['kanto', ['ELECTRIC']]);
    assert.deepEqual(miniGames.parsePokedexCsv(ctx, 'so cabecalho'), []);
    assert.deepEqual(miniGames.parsePokedexCsv(ctx, 'a,b\n1,2'), []);
    assert.deepEqual(miniGames.parsePokedexCsv(ctx, ''), []);
});

test('minigame: desligado, parado ou sem Pokédex importada não faz nada', () => {
    for (const opt of [{ enabled: false }, { dex: [] }]) {
        const { ctx, log } = makeCtx(opt);
        miniGames.tick(ctx);
        assert.equal(log.renders, 0);
        assert.deepEqual(ctx.state.miniGameMatches, []);
    }
    const { ctx, log } = makeCtx();
    ctx.state.running = false;
    miniGames.tick(ctx);
    assert.equal(log.renders, 0);
});

test('minigame: filtra por tipo (1 tipo ordena por menos tipos) e lista só candidatos não tentados', () => {
    const { ctx, log } = makeCtx({ html: screen({ pistas: '<div class="mg-tipo-sel fire"></div>' }) });
    miniGames.tick(ctx);
    assert.deepEqual(ctx.state.miniGameMatches, ['Charmander', 'Charmeleon', 'Cyndaquil']);
    assert.equal(log.renders, 1);
    ctx.state.roundTriedNames.add('charmander');
    miniGames.tick(ctx);
    assert.deepEqual(ctx.state.miniGameMatches, ['Charmeleon', 'Cyndaquil']);
    assert.equal(ctx.state.currentMiniGameRoundId, 'r1');
});

test('minigame: filtra por região (mantém quem não tem região) e padrão de letras', () => {
    const regiao = '<div class="mg-par"><span class="mg-pista-rot">Região</span><span class="mg-pista-val">Kanto</span></div><div class="mg-par trava"><span class="mg-pista-rot">Região</span><span class="mg-pista-val">Johto</span></div>';
    const a = makeCtx({ html: screen({ pistas: regiao }) });
    miniGames.tick(a.ctx);
    assert.deepEqual(a.ctx.state.miniGameMatches, ['Bulbasaur', 'Charmander', 'Charmeleon', 'Pikachu']);

    const letras = '<div class="mg-pista-letras"><span>C</span><span>H</span><span>_</span><span>R</span><span>M</span><span>A</span><span>N</span><span>D</span><span>E</span><span>R</span></div>';
    const b = makeCtx({ html: screen({ pistas: letras }) });
    miniGames.tick(b.ctx);
    assert.deepEqual(b.ctx.state.miniGameMatches, ['Charmander']);
});

test('minigame: novo round limpa tentativas; fora da fase de palpites limpa candidatos uma vez', () => {
    const { ctx, log, doc } = makeCtx({ html: screen({ pistas: '<div class="mg-tipo-sel fire"></div>' }) });
    ctx.state.roundTriedNames.add('charmander');
    ctx.state.currentMiniGameRoundId = 'antigo';
    ctx.state.lastGuessedStageKey = 'k';
    miniGames.tick(ctx);
    assert.equal(ctx.state.lastGuessedStageKey, '');
    assert.equal(ctx.state.roundTriedNames.size, 0);
    assert.equal(ctx.state.miniGameMatches.length, 3);

    doc.getElementById('mg-tela').setAttribute('data-fase', 'resultado');
    const before = log.renders;
    miniGames.tick(ctx);
    assert.deepEqual(ctx.state.miniGameMatches, []);
    assert.equal(log.renders, before + 1);
    miniGames.tick(ctx);
    assert.equal(log.renders, before + 1);
});

test('minigame: sem pistas legíveis limpa candidatos', () => {
    const { ctx, log } = makeCtx({ html: screen({ pistas: '' }) });
    ctx.state.miniGameMatches = ['x'];
    miniGames.tick(ctx);
    assert.deepEqual(ctx.state.miniGameMatches, []);
    assert.equal(log.renders, 1);
});

test('minigame: auto-chute só com poucos candidatos, 1 vez por estágio, e registra a tentativa', () => {
    const pistas = '<div class="mg-tipo-sel water"></div>';
    // 0 candidatos -> nada
    const z = makeCtx({ html: screen({ pistas }), autoGuess: true });
    miniGames.tick(z.ctx);
    assert.equal(z.log.sends, 0);

    // candidatos demais (3 > max 2) -> nada
    const m = makeCtx({ html: screen({ pistas: '<div class="mg-tipo-sel fire"></div>' }), autoGuess: true, max: 2 });
    miniGames.tick(m.ctx);
    assert.equal(m.log.sends, 0);

    // 3 <= max 3 -> chuta o primeiro, uma vez por estágio
    const { ctx, log, doc } = makeCtx({ html: screen({ pistas: '<div class="mg-tipo-sel fire"></div>' }), autoGuess: true });
    miniGames.tick(ctx);
    assert.equal(log.sends, 1);
    assert.equal(doc.getElementById('mg-input').value, 'Charmander');
    assert.equal(ctx.state.lastGuessedStageKey, 'r1_1');
    assert.ok(ctx.state.roundTriedNames.has('charmander'));
    assert.equal(ctx.state.lastActionNote, 'Quiz auto (3 opç.): Charmander');
    miniGames.tick(ctx);
    assert.equal(log.sends, 1);
    // novo estágio -> chuta o próximo
    doc.getElementById('mg-tela').setAttribute('data-estagio', '2');
    miniGames.tick(ctx);
    assert.equal(log.sends, 2);
    assert.equal(doc.getElementById('mg-input').value, 'Charmeleon');
});

test('minigame: auto-chute desligado só lista; sem auto-chute não clica', () => {
    const { ctx, log } = makeCtx({ autoGuess: false });
    miniGames.tick(ctx);
    assert.equal(log.sends, 0);
    assert.ok(ctx.state.miniGameMatches.length > 0);
});

test('minigame: applyGuess preenche, envia pelo botão ou pelo form, e falha sem campo/interação', () => {
    const a = makeCtx();
    assert.equal(miniGames.applyGuess(a.ctx, 'Mew', false), true);
    assert.equal(a.doc.getElementById('mg-input').value, 'Mew');
    assert.equal(a.log.sends, 0);
    assert.equal(miniGames.applyGuess(a.ctx, 'Mew', true), true);
    assert.equal(a.log.sends, 1);

    // sem botão: usa o form
    const b = makeCtx({ html: '<form id="f"><input id="mg-input"></form>' });
    let submitted = 0;
    b.doc.getElementById('f').requestSubmit = () => submitted++;
    assert.equal(miniGames.applyGuess(b.ctx, 'Mew', true), true);
    assert.equal(submitted, 1);

    // sem botão e sem form
    const c = makeCtx({ html: '<input id="mg-input">' });
    assert.equal(miniGames.applyGuess(c.ctx, 'Mew', true), false);

    assert.equal(miniGames.applyGuess(makeCtx({ html: '<div></div>' }).ctx, 'Mew', true), false);
    assert.equal(miniGames.applyGuess(makeCtx({ interactable: false }).ctx, 'Mew', true), false);
});

test('minigame: via runtime (agendamento e métodos extras)', () => {
    const { ctx } = makeCtx();
    const added = [];
    const rt = createRuntime(ctx, { scheduler: { add: (t) => added.push(t), dispose() {}, start() {} } });
    rt.register(miniGames);
    assert.deepEqual(added.map((t) => [t.id, t.everyMs]), [['miniGames', 1200]]);
    assert.equal(rt.call('miniGames', 'applyGuess', 'Mew', false), true);
});
