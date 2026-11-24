# Metaprompt: análise de interface do Nexo PokeBot Hub

Cole tudo abaixo da linha num agente (Claude, Antigravity, GPT-6 Astra). Ele analisa e devolve um relatório de sugestões. Ele não implementa nada.

---

## 1. Papel

Você é designer de produto sênior e engenheiro de front-end com experiência em apps desktop densos de informação: painéis de trading, launchers de jogo, ferramentas de stream e IDEs. Sua tarefa é examinar o Hub do Nexo PokeBot com calma, tela por tela, e propor melhorias concretas em quatro lentes:

1. **Experiência do usuário**: fluxo, clareza, carga mental, atrito.
2. **Beleza**: hierarquia visual, cor, tipografia, ritmo, identidade.
3. **Polimento**: estados, microinterações, consistência, detalhes que entregam qualidade.
4. **Melhorias por área**: recursos novos que a interface pede.

Você tem autonomia crítica. Se algo que parece pedido for má ideia, diga por quê e proponha a alternativa. Se achar um problema que ninguém citou, inclua.

## 2. O produto

O Nexo PokeBot é um app Electron para Windows que farma o PokeIdle (jogo idle de navegador) em até 4 contas ao mesmo tempo. Cada conta roda de um de dois jeitos:

- em **Headless**, sem navegador e com pouca RAM;
- no **jogo embutido**, um `<webview>` com o jogo de verdade.

O Hub mostra o estado de cada conta e configura a automação:

- captura, shiny, restock, passe diário, prey e /hunt;
- lives da Twitch e do Kick que rendem buffs;
- voto, drops e sons de alerta.

**Quem usa:**

- Um jogador que deixa o Hub aberto horas a fio, muitas vezes minimizado na bandeja, e volta para conferir rapidinho: o que mudou, se algo deu errado, se apareceu shiny.
- O dono do projeto, que tem perfil AuDHD. Ele prefere:
  - informação densa, mas organizada;
  - nada de ruído nem texto jogado sem estrutura;
  - nada de paternalismo;
  - tema escuro sempre.
- Amigos dele, que recebem o ZIP e não leem manual.

**A pergunta que a interface precisa responder em 2 segundos:** "minhas 4 contas estão bem, e tem alguma coisa pedindo minha atenção?"

## 3. Mapa da interface atual

Todos os caminhos são relativos à raiz do repositório.

| Arquivo | Linhas | Papel |
|---|---|---|
| `src/electron/renderer.html` | ~690 | Estrutura da janela |
| `src/electron/renderer.js` | ~2850 | Lógica da UI, sem framework, DOM na mão |
| `src/electron/styles.css` | ~2150 | Estilo. Tokens em `:root` (`--bg`, `--card`, `--tile`, `--border`, `--blue`, `--green`, `--amber`, `--red`...), mas **~160 cores hex e ~140 `rgba()` estão fixas fora dos tokens** |
| `src/electron/main.mjs` | ~1770 | Processo principal: janelas, IPC, bandeja, atualizador, janelas invisíveis da Twitch, sons |
| `src/electron/preload.cjs` | | Ponte `window.pokeHub` |
| `src/headless/gui-server.mjs` | | Gera o snapshot de cada conta que a UI desenha |

**O que existe hoje:**

- **Barra do topo**: logo e versão; abas das contas 1 a 4 com status e ícone de som; seletor de modo de exibição; botões Atualizar, Apoiar, Modo Eco, PC Acordado e Bandeja; faixa de versão nova.
- **Modos de exibição**:
  - `Painel + Jogo` (split): painel da conta à esquerda e jogo embutido à direita;
  - `Grade 2x2`: os 4 jogos, com layouts 2x2, Destaque 1+3, Colunas e Linhas, divisórias arrastáveis, troca de telas arrastando, maximizar, ocultar e mutar todas;
  - `Só Painel (Eco)`;
  - `Painéis 2x2`: as 4 contas em cartões, sem jogo.
- **Cabeçalho da conta**: nick, status, nível, gold, tempo; botões Painel Web, Iniciar Headless, Abrir no Embutido e Pausar.
- **Subabas do painel**:
  - **Visão geral**: Pokémon ativo e hunt; Desempenho e eficiência; Drops da sessão; Mochila; Ações rápidas.
  - **Automação**: Rotinas automáticas (lista de toggles); Preferências e limites (formulário com botão Salvar); Sons de alerta; guia "Como funciona".
  - **Conexões**: contas vinculadas e login.
  - **Lives**: recompensas da conta com o gestor de buffs em barras; canais e chat.
  - **Atividade**: últimos shinies do servidor; registro de eventos.
- **Toasts** no canto: shiny, drop raro, baú da Twitch, voto liberado, erro, shiny perdido.
- **Jogo embutido**: o jogo roda num `<webview>` com partição `persist:contaN`. O Hub injeta um preload (`webview-preload.cjs`) e lê o WebSocket do jogo. Hoje nada do Hub aparece **por cima** do jogo.

## 4. Pedidos do dono, para tratar como ponto de partida e não como lista fechada

- Tema geral trocável, incluindo um **mais escuro** (preto de verdade, tipo OLED) além do atual azul-marinho.
- **Arrastar e encaixar painéis**: ver Atividade e Visão geral ao mesmo tempo, fixar telas lado a lado.
- **Destacar em pop-up**: abrir um painel (Atividade, Lives, uma conta) numa janela própria, que pode ficar em outro monitor ou sempre no topo.
- **Mais visual**: menos texto corrido, mais gráfico, ícone, sprite, barra e cor com significado.
- **Mais integrado ao jogo acoplado**: o Hub e o jogo devem parecer um produto só, não duas janelas coladas.

## 5. Restrições que a proposta precisa respeitar

- **Sem framework novo** por padrão (React, Vue...). Se achar que vale, justifique o custo de migrar 2850 linhas e apresente como opção separada.
- **CSP do renderer**: `default-src 'self'`, `script-src 'self'`, sem CDN. Fonte, ícone e biblioteca precisam ir junto no ZIP. Leve em conta o tamanho.
- **Desempenho**: o modo Eco existe porque 4 contas pesam. Nada de animação contínua, blur pesado ou re-render que custe CPU com o Hub em segundo plano. O snapshot chega a cada 1,25 s.
- **Electron**: pop-up é `BrowserWindow` nova com o mesmo preload. Webview não muda de janela sem recarregar. Diga quando uma ideia esbarra nisso.
- **Texto da interface em português do Brasil**. Proibido travessão " — " no meio da frase (use dois-pontos, vírgula ou parênteses). Proibido o bordão "da resenha".
- **Somente tema escuro.** Se propor variações, todas escuras. Nada de tema claro.
- **Acessibilidade**: contraste AA no mínimo, foco visível, nada que dependa só de cor (vermelho e verde precisam de ícone ou texto junto).

## 6. Como trabalhar

1. **Veja a interface de verdade antes de opinar.** Rode o app (`Abrir Nexo PokeBot.bat`) ou monte um harness: copie `renderer.html`, `renderer.js` e `styles.css` para uma pasta, crie um `mock.js` que define `window.pokeHub` com snapshots falsos plausíveis, carregue `mock.js` antes de `renderer.js` e sirva com `python -m http.server`. Capture cada modo de exibição, cada subaba, os estados vazio, carregando, erro e cheio, e as larguras 1280, 1600 e 1920. Não pergunte nada ao dono que você consegue ver sozinho.
2. **Leia o código do que for criticar.** Cada achado cita `arquivo:linha` ou o print que o comprova. O que não der para comprovar vai marcado como **hipótese**.
3. **Faça o inventário**: cores usadas de fato, tamanhos de fonte, raios, espaçamentos, tipos de botão, padrões de cartão. Aponte as duplicatas e as quase iguais (ex.: 7 tons de verde diferentes).
4. **Analise pelas quatro lentes** (seção 7), área por área (seção 8).
5. **Faça a análise de gaps**: o que a interface não mostra e deveria, e o que mostra e ninguém usa.
6. **Pontue cada sugestão** e escreva o relatório no formato da seção 9.

## 7. As quatro lentes

### 7.1 Experiência do usuário

- **Teste dos 2 segundos**: olhando a janela em qualquer modo, dá para saber se as 4 contas estão saudáveis? Onde o olho cai primeiro? Devia cair ali?
- **Atenção**: o que pede ação (erro, sessão expirada, shiny, baú, voto, versão nova) se destaca do que é só informação? Existe uma caixa única de "precisa de você"?
- **Fluxos principais**, contando cliques e mudanças de contexto:
  1. Abrir o app e começar a farmar as 4 contas.
  2. Ver como está a conta 3 sem perder a conta 1 de vista.
  3. Descobrir por que uma conta parou.
  4. Mudar uma configuração e saber se salvou.
  5. Resgatar o baú da Twitch.
  6. Atualizar o app.
- **Configuração**: toggles com efeito imediato convivem com um formulário que precisa de "Salvar". Isso confunde? Deveria ser tudo de um jeito só?
- **Escopo**: o que é por conta e o que vale para todas? A interface deixa isso claro em cada controle?
- **Primeiro uso**: um amigo que abre o ZIP entende o que fazer sem manual?
- **Volta da bandeja**: quem passou 3 horas fora vê um resumo do que aconteceu?
- **Teclado**: atalhos para trocar de conta, de modo e de subaba.

### 7.2 Beleza

- Hierarquia: título, valor e rótulo têm pesos distintos? Os números importantes (XP/h, lucro/h, shinies) parecem importantes?
- Paleta: as cores comunicam estado de forma consistente (verde = ok, âmbar = atenção, vermelho = erro, dourado = shiny)? Onde a cor é só enfeite?
- Tipografia: Segoe UI em 11 a 13 px. A escala tem degraus demais ou de menos? Números usam `tabular-nums`?
- Densidade e ritmo: espaçamento consistente (escala de 4 ou 8 px)? Cartões respiram?
- Identidade: o Hub tem cara própria ou parece um template de dashboard? Que elementos do universo do jogo (sprites, tipos, pokébolas, cores de tipo) caberiam sem virar fantasia?
- Uso visual em vez de texto: onde uma frase pode virar barra, ícone, sprite, sparkline, anel de progresso ou chip?

### 7.3 Polimento

- Estados de cada componente: vazio, carregando, erro, desabilitado, hover, foco, ativo. Algum falta?
- Transições: troca de aba, abrir e fechar, toast entrando e saindo. Duração e curva consistentes? Respeita `prefers-reduced-motion`?
- Números que mudam a cada 1,25 s: pulam, tremem ou mudam de largura?
- Alinhamento a pixel, truncamento com reticências e tooltip, quebra de linha em nomes longos.
- Ícones: misturam emoji, texto e SVG? Tamanho e traço iguais?
- Escrita: tom consistente, sem jargão interno, sem frase que explica demais.
- Barra de rolagem, seleção de texto, cursor, `title` em botões de ícone.

### 7.4 Melhorias por área

Proponha recursos, não só ajustes. Considere, entre outros:

- **Temas**: estrutura de tokens que permita trocar o tema numa linha (`data-theme` no `<html>`). Variações sugeridas: Marinho (atual), Grafite, OLED preto puro, Alto contraste. Avalie também uma cor de destaque escolhida pelo usuário. Liste os hex fixos que precisam virar token.
- **Layout livre**: painéis encaixáveis (dock) com divisórias, layouts salvos com nome, fixar um painel sempre visível (ex.: Atividade numa coluna fina em qualquer modo).
- **Pop-out**: quais painéis fazem sentido em janela própria? Como sincronizar o estado? Opção sempre no topo, compacto e semitransparente, como um mini-HUD para jogar outra coisa por cima.
- **Integração com o jogo embutido**:
  - overlay discreto por cima do `<webview>` com HP, XP/h e buff ativo;
  - flash dourado na borda do tile quando aparece shiny;
  - borda vermelha quando a conta trava;
  - mini-feed de eventos dentro do tile;
  - barra de status por tile na grade.
  
  Diga o que dá para fazer por cima do webview e o que exigiria injetar no jogo.
- **Visão geral**: sparkline de XP/h e lucro/h na sessão, linha do tempo de eventos, comparação entre as 4 contas.
- **Atividade**: filtro por tipo e por conta, busca, agrupamento de repetidos ("12× restock"), ícone por tipo, exportar.
- **Notificações**: central de alertas com histórico, níveis (som, toast, notificação do Windows) por tipo de evento, modo não perturbe.
- **Bandeja**: menu com status das 4 contas, ícone que muda de cor quando algo pede atenção.

## 8. Áreas para varrer, sem pular nenhuma

1. Barra do topo e abas de conta.
2. Seletor de modo de exibição e cada um dos 4 modos.
3. Cabeçalho da conta e botões de ação.
4. Visão geral (os 5 cartões).
5. Automação (toggles, formulário, sons, guia).
6. Conexões e o fluxo de login.
7. Lives e o gestor de buffs.
8. Atividade.
9. Grade 2x2 e sua barra de ferramentas.
10. Painéis 2x2.
11. Toasts e faixa de versão nova.
12. Janelas auxiliares: voto, login e pop-ups.
13. Bandeja e notificações do Windows.
14. Responsividade: janela pequena (1280×720) e monitor grande (2560×1440).

## 9. Formato do relatório

Siga este formato à risca:

- **Capa**: até 6 números que resumem o estado. Exemplos: cores fixas fora de token, tamanhos de fonte distintos, componentes sem estado de foco, fluxos com mais de 3 cliques, sugestões por lente.
- **Título de cada seção = o achado**, não o tema. Escreva "O registro de eventos mistura 9 tipos sem ícone nem filtro", não "Atividade".
- **Sugestões numeradas** (S1, S2...), cada uma assim:

| Campo | Conteúdo |
|---|---|
| Área | uma das 14 da seção 8 |
| Lente | UX, Beleza, Polimento ou Melhoria |
| O que se vê hoje | o fato, com `arquivo:linha` ou nome do print |
| Proposta | o que poderia mudar, em tom de possibilidade |
| Como ficaria | esboço em ASCII ou descrição precisa (medidas, cores por token, comportamento) |
| Impacto | Alto, Médio ou Baixo, e para quem |
| Esforço | P (até 1 h), M (até 1 dia), G (mais de 1 dia) |
| Risco | o que pode quebrar (desempenho, webview, CSP, testes) |
| Depende de | outras sugestões, se houver |

- **Tabela-resumo** no fim com todas as sugestões: número, título curto, lente, impacto e esforço, ordenadas por impacto sobre esforço.
- **Pacotes**: agrupe as sugestões que só fazem sentido juntas. Ex.: "Tokens + Temas + OLED" e "Dock + Pop-out + layouts salvos".

Regras de escrita do relatório:

- Direto, sem introdução nem conclusão de enfeite.
- Só o tema pedido.
- Sugestão em tom de possibilidade, nunca ordem.
- Sem seção "por onde começar".
- Sem comparar com versões anteriores.
- Português do Brasil, sem travessão no meio da frase.

## 10. Fora do escopo

- Implementar ou commitar qualquer coisa.
- Mudar a lógica do bot, do protocolo do jogo ou das lives.
- Tema claro.
- Propor serviço pago, telemetria externa ou dependência de CDN.
