// Todos os ids/classes do jogo que os módulos usam, num lugar só.
// Se o Pokeidle mudar o HTML, é aqui que se corrige (e o teste de contrato avisa antes do farm quebrar).
// `where` diz de qual tela vem; `needsState` marca o que só existe com algo aberto/na tela.
export const SEL = {
    // Passe diário
    passResgatar: 'button.ps-resgatar',
    passRelogio: 'b[data-ps-relogio]',
    // Confirmação de evolução / diálogos de confirmação
    btnEvoluir: '#btn-evoluir',
    confirmarSim: '#confirmar-sim',
    confirmarNao: '#confirmar-nao',
    dlgReq: '.dlg-req',
    // Pokémon ativo e ficha
    ativoCard: '#ativo-card',
    ativoNome: '.ativo-nome',
    fichaGpt: '#fi-gpt',
    fichaFechar: '#ficha-fechar',
};

// Seletores que existem na tela principal sem nada aberto: são os que o teste de contrato confere no jogo de verdade.
export const SEL_ALWAYS_PRESENT = ['btnEvoluir', 'ativoCard', 'ativoNome'];
