# Análise de interface do Nexo PokeBot Hub

Feita em 24/11/2026 com o metaprompt `docs/METAPROMPT-ANALISE-UI.md`. Telas capturadas numa prévia com dados falsos a 1280×720 e 1600×900, nos 4 modos e nas 5 subabas. Medidas tiradas do CSS e do DOM.

## Capa

| Número | O que mede |
|---|---|
| **2 de 4** | contas visíveis na barra do topo a 1280 px. A conta 3, que estava pausada com aviso, aparecia em 12%. A conta 4 não aparecia. |
| **70%** | da janela a 1600 px ocupada por um aviso de "Farmando em Headless" quando a conta não tem jogo aberto (1130 de 1600 px) |
| **185** | cores fixas distintas fora dos tokens (72 hex e 113 `rgba`). É isso que impede trocar o tema numa linha. |
| **17** | tamanhos de fonte distintos, de 8 a 30 px. Há 31 textos abaixo de 11 px só na tela inicial. |
| **1 em 100** | regra de foco visível para 100 botões. Nenhum tem `aria-label`, 25 têm `title`. |
| **3,56:1** | contraste do rótulo dos indicadores (`--dim` sobre `--card`, 10 px). O mínimo AA é 4,5:1. |

---

## Barra do topo e abas de conta

### A 1280 px as contas 3 e 4 somem da barra, e com elas o aviso de pausa

- **S1 · Abas de conta compactas que sempre cabem**
  - Área: barra do topo · Lente: UX · Impacto: Alto, para todos · Esforço: P · Risco: baixo
  - Hoje: `#accountTabs` usa `overflow: auto` (`styles.css:76`). Medido a 1280 px: rolagem de 546 px num espaço de 292 px; conta 3 visível em 12%, conta 4 em 0%. A 1600 px as 3 primeiras abas já truncam o texto.
  - Proposta: cada aba poderia virar um chip de largura fixa com número, ponto de status colorido com ícone, nick curto e o sprite do Pokémon ativo em 20 px. O texto de status ("FARMANDO · Rota 7") iria para um tooltip e para o cabeçalho da conta.
  - Como ficaria: `[1 ● 🐉 Gakke] [2 ● ⚡ FarmTwo] [3 ⚠ 🐟 Brisa] [4 ○ Conta 4]`, uns 120 px cada, 480 px no total. Uma conta com problema ganha borda âmbar ou vermelha, que não depende de ler o texto.

### O topo tem 13 botões com o mesmo peso visual

- **S2 · Separar navegação de utilitários**
  - Área: barra do topo · Lente: Beleza · Impacto: Médio · Esforço: P · Risco: baixo
  - Hoje: 4 abas, 4 modos de exibição e 5 utilitários (Atualizar, Apoiar, Modo Eco, PC Acordado, Bandeja), todos como botões de texto do mesmo tamanho.
  - Proposta: os modos poderiam virar um seletor só de ícones (quatro desenhos de layout) com tooltip. Atualizar, Apoiar e Bandeja iriam para um menu `⋯`. PC Acordado e Modo Eco ficariam como interruptores pequenos com estado visível (ligado ou desligado).
  - Como ficaria: `[logo] [abas de conta ...........] [▣ ▦ ▤ ▩] [⚡Eco ●] [☾Acordado ○] [🔔 3] [⋯]`

---

## Atenção e alertas

### Não existe um lugar único que diga "isto precisa de você"

- **S3 · Central "Precisa de você"**
  - Área: barra do topo, toasts · Lente: UX · Impacto: Alto · Esforço: M · Risco: baixo
  - Hoje: as pendências se espalham. Conta pausada é um texto na aba. Sessão expirada aparece no registro em vermelho. O baú, o voto e o shiny perdido viram toasts que somem sozinhos (`showToast`, `renderer.js:1923`). A versão nova é uma faixa no topo. Quem volta da bandeja não tem onde ver o que perdeu.
  - Proposta: um sino com contador no topo. Ao abrir, uma lista de pendências ainda abertas, cada uma com o botão que resolve: Reconectar, Resgatar baú, Votar, Atualizar, Ver conta. O item sai da lista quando a pendência é resolvida, não depois de um tempo.
  - Como ficaria: `🔔 3` → painel com `⚠ Conta 3 pausada pelo aviso de versão [Ver]`, `🎁 Baú +50 em canalum [Resgatar]`, `✦ Shiny perdido: Abra Nv 20, há 4 min`.

- **S4 · "Enquanto você estava fora"**
  - Área: bandeja, Visão geral · Lente: UX · Impacto: Alto · Esforço: M · Risco: baixo
  - Hoje: ao voltar da bandeja o Hub mostra o estado atual, sem o que aconteceu no meio.
  - Proposta: se a janela passou mais de 30 min escondida, mostrar ao reabrir um cartão com o resumo por conta: XP, gold, capturas, shinies capturados e perdidos, erros e tempo parado. Some com um clique.
  - Como ficaria: uma linha por conta, `Gakke  +1,2M XP  +310k gold  38 capt.  ✦1  ✕0  ⏸ 0 min`.

- **S5 · Alertas por evento: som, toast ou Windows**
  - Área: Automação (cartão Sons) · Lente: Melhoria · Impacto: Médio · Esforço: M · Risco: baixo
  - Hoje: o cartão Sons tem um evento só. Shiny capturado, drop raro, baú, voto, sessão expirada e versão nova não têm escolha de canal.
  - Proposta: o cartão poderia virar "Alertas", com uma linha por evento e três interruptores (som, toast, notificação do Windows), mais o link de som de cada um e um modo não perturbe com horário.

### O ícone da bandeja é sempre o mesmo

- **S6 · Ícone da bandeja com estado**
  - Área: bandeja · Lente: Polimento · Impacto: Médio · Esforço: P · Risco: baixo
  - Hoje: `main.mjs` só troca o tooltip (`setToolTip`, linha 404), nunca a imagem. O menu tem ações, mas não mostra o estado das contas.
  - Proposta: sobrepor ao ícone um ponto de cor (verde com tudo farmando, âmbar com algo pausado, vermelho com erro, dourado por 10 min depois de um shiny). No menu, 4 linhas de status (`1 Gakke · Rota 7 · 84k XP/h`) acima das ações.

---

## Modos de exibição e o jogo embutido

### Em Headless, 70% da janela vira um aviso estático

- **S7 · O palco em Headless vira painel ao vivo**
  - Área: Painel + Jogo, Grade · Lente: UX e Beleza · Impacto: Alto · Esforço: M · Risco: baixo
  - Hoje: sem jogo aberto, o palco mostra "Farmando em Headless" e uma linha de chips (`renderer.js:1222`). Isso ocupa 1130 × 843 px a 1600 px. Na Grade em Destaque 1+3 o mesmo aviso aparece repetido em cada tela.
  - Proposta: usar esse espaço para o painel ao vivo da conta:
    - sprite grande do Pokémon ativo com HP;
    - gráfico de XP/h e lucro/h da sessão;
    - os últimos eventos;
    - drops com ícone;
    - buffs ativos.
    
    Na Grade, cada tela sem jogo mostraria o cartão de `Painéis 2x2` (`PANEL_CARD_HTML`), que já existe. O botão "Abrir jogo" continua ali, menor.
  - Como ficaria: à esquerda o sprite em 160 px com a barra de HP. À direita, 3 números grandes com gráfico pequeno (XP/h, Lucro/h, Shinies). Embaixo, a linha do tempo dos eventos.

### O jogo embutido e o Hub não conversam visualmente

- **S8 · Barra de status sobre o jogo**
  - Área: Painel + Jogo, Grade · Lente: Melhoria · Impacto: Alto · Esforço: M · Risco: médio (pode cobrir a interface do jogo)
  - Hoje: nada do Hub aparece por cima do `<webview>`. Para ver XP/h ou buff com o jogo aberto é preciso olhar o painel lateral.
  - Proposta: uma faixa semitransparente de 28 px, desenhada pelo Hub por cima do webview e sem injetar nada no jogo, com HP, XP/h, lucro/h, buff ativo com tempo restante e contagem de shinies. Esmaece com o mouse em cima e pode ir para o topo ou para a base de cada tela.
  - Como ficaria: `♥ 140/180 ▮▮▮▮▯  ⚡84k XP/h  💰23k/h  🟢Captura +15% 1h12  ✦2`

- **S9 · Borda da tela com o estado da conta**
  - Área: Grade, Painel + Jogo · Lente: Polimento · Impacto: Médio · Esforço: P · Risco: baixo
  - Hoje: o estado da conta só aparece no texto da barra de cada tela.
  - Proposta: borda de 2 px que comunica sem precisar ler:
    - dourada com um brilho único quando um shiny aparece;
    - âmbar fixa quando a conta está pausada;
    - vermelha quando está parada ou com erro;
    - nada quando está tudo bem.
    
    Respeita `prefers-reduced-motion`.

- **S10 · Avisos dentro da tela da conta**
  - Área: Grade, toasts · Lente: UX · Impacto: Médio · Esforço: M · Risco: baixo
  - Hoje: os toasts das 4 contas empilham no mesmo canto (`.toast-stack`, `styles.css:1343`), e na Grade é preciso ler o título para saber de qual conta veio.
  - Proposta: no modo Grade, o aviso aparece no canto da tela da própria conta. Nos outros modos fica como está.

### "Só Painel" deixa as laterais vazias e esconde Atividade atrás de uma aba

- **S11 · Atividade fixável em qualquer modo**
  - Área: todos os modos · Lente: UX · Impacto: Alto · Esforço: M · Risco: baixo
  - Hoje: o painel tem largura fixa de 470 px (`styles.css:210`). Visão geral e Atividade são abas: não dá para ver as duas juntas. Em Só Painel, a coluna fica centralizada com margens vazias dos dois lados.
  - Proposta: um botão 📌 na subaba Atividade que a transforma numa coluna fixa de 300 px à direita, presente em qualquer modo, com o registro de todas as contas (etiqueta colorida por conta). É a versão simples do encaixe de painéis.

- **S12 · Painéis encaixáveis e layouts salvos**
  - Área: todos os modos · Lente: Melhoria · Impacto: Alto · Esforço: G · Risco: médio (refatora o painel)
  - Hoje: as 5 subabas são exclusivas entre si. A Grade já salva divisórias e ordem (`nexo.gridLayout`), mas só para os jogos.
  - Proposta:
    - cada subaba vira um painel com barra de título;
    - o painel pode ser arrastado para esquerda, direita ou base, ou empilhado como aba;
    - as divisórias redimensionam;
    - layouts salvos com nome ("Farm", "Lives", "Conferência rápida") aparecem no seletor de modo.
    
    A mecânica de arrastar e das divisórias da Grade (`wireGridGutter`, `wireGridDrag`) pode ser reaproveitada.
  - Como ficaria: em Só Painel a 1600 px, três colunas: Visão geral | Lives | Atividade.

- **S13 · Painel em janela própria e mini-HUD**
  - Área: todos os modos · Lente: Melhoria · Impacto: Alto · Esforço: M para o mini-HUD, G para qualquer painel · Risco: médio
  - Hoje: tudo vive numa janela só.
  - Proposta:
    - um botão ⧉ em cada painel abre `renderer.html?panel=activity&acc=1` numa `BrowserWindow` com o mesmo preload. O snapshot já chega por `getAllSnapshots`, então não precisa de canal novo.
    - um **mini-HUD** de 320 × 140 px, sempre no topo e semitransparente, com uma linha por conta (ponto de status, nick, XP/h, ✦, alerta), para deixar sobre outro jogo ou em outro monitor.
  - Limite do Electron: o webview do jogo não muda de janela. Destacar o jogo recarrega a página (a sessão `persist:contaN` se mantém, mas a reconexão leva alguns segundos).

### Painéis 2x2 deixam 40% de cada cartão vazio

- **S14 · Preencher os cartões de Painéis 2x2**
  - Área: Painéis 2x2 · Lente: Beleza · Impacto: Médio · Esforço: P · Risco: baixo
  - Hoje: a 1600×900 cada cartão tem o Pokémon, 8 números e uma linha de drops, e os botões ficam colados no fundo com um vão grande no meio.
  - Proposta: usar o vão para:
    - os 3 últimos eventos da conta;
    - a barra do buff ativo;
    - um gráfico pequeno de XP/h da sessão.
    
    Os botões podem ganhar ícone (▶ ⏸ ⧉ 🎮).

---

## Visão geral

### Os 13 indicadores têm quase o mesmo peso, e a cor no topo de cada um é enfeite

- **S15 · Três números principais com gráfico e o resto em linha**
  - Área: Visão geral · Lente: Beleza · Impacto: Alto · Esforço: M · Risco: baixo
  - Hoje: 4 indicadores com borda colorida (azul, verde, âmbar, roxo: `styles.css:397-401`) sem significado de estado, mais 9 secundários do mesmo tamanho. O rótulo usa 10 px em `--dim`, com contraste de 3,56:1 (`styles.css:402`).
  - Proposta:
    - **XP/h, Lucro/h e Shinies** em destaque, com valor em 22 px, gráfico pequeno da sessão e variação contra a média;
    - os outros (tempo por abate, captura por abate, gasto, sobrevivência...) numa grade compacta de rótulo e valor;
    - a cor passa a indicar estado (verde acima da média, âmbar abaixo), não categoria.

- **S16 · Drops e mochila com ícone do item**
  - Área: Visão geral · Lente: Beleza · Impacto: Médio · Esforço: M · Risco: baixo (ícones do jogo precisam ir junto no ZIP ou vir do raw.githubusercontent, que a CSP já libera)
  - Hoje: drops são cartões só com texto ("Rare Candy x3").
  - Proposta: ícone do item em 24 px, quantidade em selo e brilho dourado nos raros.

---

## Atividade

### O registro é texto mono colorido, sem ícone, filtro nem agrupamento

- **S17 · Registro legível**
  - Área: Atividade · Lente: UX e Beleza · Impacto: Alto · Esforço: M · Risco: baixo
  - Hoje: `renderer.js:1779` monta `<div class="log-line kind">[hora] texto</div>`. São 10 tipos (catch, shiny, shiny-miss, shop, prey, reward, ok, info, warn, error) diferenciados só pela cor. Na amostra, "Restock: +50 Small Potion" aparece três vezes seguidas. Não há filtro, busca nem visão das 4 contas juntas.
  - Proposta:
    - linha com ícone por tipo, texto em fonte normal e hora discreta à direita em formato relativo ("há 3 min", com a hora exata no tooltip);
    - repetidos seguidos viram uma linha só com "×3";
    - chips de filtro por tipo e por conta, e um campo de busca;
    - a opção "Todas as contas" mostra a etiqueta da conta.
  - Como ficaria: `🛒 Restock: +50 Small Potion ×3 · há 2 min`, `✦ Capturado SHINY: Charmander Nv 9 · há 6 min` (linha com fundo dourado).

- **S18 · Shinies do servidor com sprite**
  - Área: Atividade · Lente: Beleza · Impacto: Baixo · Esforço: P · Risco: baixo
  - Hoje: "Dratini · Ash99 · Captura · 10:59:17", só texto.
  - Proposta: sprite shiny de 32 px, nome, treinador, um selo para Ovo ou Captura e o tempo relativo.

---

## Automação e configuração

### Os interruptores esperam o botão Salvar, que fica no fim do cartão seguinte, e o cartão Sons salva na hora

- **S19 · Salvar ao mudar, com confirmação curta**
  - Área: Automação · Lente: UX · Impacto: Alto · Esforço: M · Risco: baixo
  - Hoje: mudar um interruptor em "Rotinas automáticas" só marca alterações pendentes (`renderer.js:2630`). O botão Salvar fica no fim de "Preferências e limites", fora da tela na maioria das alturas. O cartão Sons aplica na hora. São dois comportamentos na mesma aba.
  - Proposta: interruptores e seletores aplicam na hora. Números aplicam ao sair do campo. Cada controle mostra um "✓ salvo" breve ao lado, e um toast oferece "Desfazer" por 5 s. O botão Salvar sai.

- **S20 · Escopo visível: esta conta ou todas**
  - Área: Automação, Lives · Lente: UX · Impacto: Médio · Esforço: M · Risco: baixo
  - Hoje: só o cartão Sons diz que vale para as 4 contas. Nos outros não fica claro se a configuração é da conta ativa.
  - Proposta: um selo "Conta 1" ou "Todas" no título de cada cartão, e o botão "Copiar para as outras contas" nos cartões por conta.

- **S21 · Ajuda ao lado do controle em vez do guia longo**
  - Área: Automação · Lente: UX · Impacto: Baixo · Esforço: P · Risco: baixo
  - Hoje: o cartão "Como funciona" tem 5 parágrafos longos no fim da aba, e alguns interruptores têm subtítulos em âmbar de duas linhas.
  - Proposta: um ícone ⓘ ao lado de cada controle, com a explicação curta no tooltip. As limitações aparecem só quando o interruptor está ligado. O guia longo pode sair.

---

## Fundação visual

### 185 cores fixas, 17 tamanhos de fonte e 16 raios: o tema não troca e o visual oscila

- **S22 · Tokens semânticos**
  - Área: todas · Lente: Polimento · Impacto: Alto (pré-requisito de S23) · Esforço: G · Risco: médio (mexe em 2150 linhas de CSS, pede conferência visual tela a tela)
  - Hoje: `:root` tem 18 tokens, mas há 72 hex e 113 `rgba` distintos escritos direto no CSS. Só de verde são 7 tons (`#86efac`, `#22c55e`, `#4ade80`, `#6ee7b7`, `#10b981`, `#a7f3d0`, `#16a34a`). Os mais usados: `#fcd34d` (10 vezes), `#86efac` (8), `#fbbf24` (8), `#93c5fd` (8).
  - Proposta: cerca de 30 tokens com papel definido:
    - fundos: `--surface-0` a `--surface-3`;
    - texto: `--text-1` a `--text-3`;
    - borda: `--line`, `--line-strong`;
    - destaque: `--accent`, `--accent-soft`;
    - estados: `--ok`, `--warn`, `--err`, `--shiny`, `--info`, cada um com uma versão `-soft` para fundo.
    
    Cada cor fixa passa a apontar para um desses tokens. As transparências viram `color-mix()`, que o Chromium do Electron suporta.

- **S23 · Temas escuros e cor de destaque**
  - Área: todas · Lente: Melhoria · Impacto: Alto · Esforço: M (depois de S22) · Risco: baixo
  - Proposta: `data-theme` no `<html>`, salvo localmente, com quatro opções:
    - **Marinho**: o atual;
    - **Grafite**: cinza neutro, base `#0e0f12`;
    - **OLED**: preto puro, base `#000`, cartões `#0a0a0b`, bordas `#1c1c1f`, sem sombras;
    - **Alto contraste**: texto `#fff`, bordas `#5b6478`, estados mais saturados.
    
    A cor de destaque fica à escolha do usuário entre 6 opções (azul, verde, roxo, âmbar, ciano, rosa). A troca é instantânea, com prévia no próprio seletor.

- **S24 · Escala de tipo, raio, espaço e movimento**
  - Área: todas · Lente: Polimento · Impacto: Médio · Esforço: P (junto com S22) · Risco: baixo
  - Hoje: 17 tamanhos de fonte (de 8 a 30 px), 16 raios, 14 valores de `gap`, 43 de `padding` e 13 transições diferentes. Só 6 lugares usam `tabular-nums`, e os números atualizados a cada 1,25 s mudam de largura.
  - Proposta:
    - fonte em 5 degraus: 11, 12, 13, 16 e 22 px;
    - raio em 3 valores: 6, 10 e 999 px;
    - espaço em múltiplos de 4;
    - duração em 2 valores: 120 e 200 ms;
    - `font-variant-numeric: tabular-nums` em todo número que muda.

- **S25 · Contraste mínimo nos textos secundários**
  - Área: todas · Lente: Polimento · Impacto: Médio · Esforço: P · Risco: baixo
  - Hoje: `--dim` (`#64748b`) tem 3,56:1 sobre os cartões e aparece em rótulos de 10 e 11 px. O azul `--blue` como texto tem 3,28:1.
  - Proposta: subir `--dim` para cerca de `#8a97ab` (perto de 4,6:1) e usar o azul mais claro (`--blue-hi` ou `#93c5fd`) sempre que for texto.

- **S26 · Um conjunto só de ícones**
  - Área: todas · Lente: Beleza · Impacto: Médio · Esforço: M · Risco: baixo (os SVGs vão junto no ZIP, sem CDN)
  - Hoje: a interface mistura caracteres (✕ ★ ✓ ♥ ⚠ 💎 ✦) com botões só de texto. Há 2 SVGs no JS, os do alto-falante.
  - Proposta: um sprite SVG local com uns 30 ícones de traço igual (play, pausa, alerta, shiny, pokébola, presente, carrinho, sino, alfinete, janela, layout...), usados em botões, registro, abas e toasts.

- **S27 · Foco visível, nomes acessíveis e atalhos**
  - Área: todas · Lente: Polimento · Impacto: Médio · Esforço: P · Risco: baixo
  - Hoje: existe 1 regra `:focus-visible` para 100 botões, nenhum `aria-label`, e só 2 tratadores de teclado.
  - Proposta:
    - anel de foco de 2 px em `--accent` em todo elemento clicável;
    - `aria-label` nos botões que só têm ícone;
    - atalhos: Ctrl+1 a 4 troca de conta, Ctrl+Shift+1 a 4 troca de modo, Ctrl+L abre a Atividade, Ctrl+K a central de alertas;
    - um "?" que lista os atalhos.

---

## Tabela-resumo

Ordenada por impacto sobre esforço.

| # | Sugestão | Lente | Impacto | Esforço |
|---|---|---|---|---|
| S1 | Abas de conta compactas que sempre cabem | UX | Alto | P |
| S25 | Contraste mínimo nos textos secundários | Polimento | Médio | P |
| S9 | Borda da tela com o estado da conta | Polimento | Médio | P |
| S6 | Ícone da bandeja com estado | Polimento | Médio | P |
| S2 | Separar navegação de utilitários | Beleza | Médio | P |
| S14 | Preencher os cartões de Painéis 2x2 | Beleza | Médio | P |
| S24 | Escala de tipo, raio, espaço e movimento | Polimento | Médio | P |
| S27 | Foco visível, nomes acessíveis e atalhos | Polimento | Médio | P |
| S18 | Shinies do servidor com sprite | Beleza | Baixo | P |
| S21 | Ajuda ao lado do controle | UX | Baixo | P |
| S7 | Palco em Headless vira painel ao vivo | UX e Beleza | Alto | M |
| S3 | Central "Precisa de você" | UX | Alto | M |
| S11 | Atividade fixável em qualquer modo | UX | Alto | M |
| S17 | Registro legível | UX e Beleza | Alto | M |
| S19 | Salvar ao mudar | UX | Alto | M |
| S15 | Três números principais com gráfico | Beleza | Alto | M |
| S8 | Barra de status sobre o jogo | Melhoria | Alto | M |
| S4 | "Enquanto você estava fora" | UX | Alto | M |
| S13 | Painel em janela própria e mini-HUD | Melhoria | Alto | M a G |
| S23 | Temas escuros e cor de destaque | Melhoria | Alto | M |
| S10 | Avisos dentro da tela da conta | UX | Médio | M |
| S5 | Alertas por evento | Melhoria | Médio | M |
| S16 | Drops e mochila com ícone | Beleza | Médio | M |
| S20 | Escopo visível | UX | Médio | M |
| S26 | Um conjunto só de ícones | Beleza | Médio | M |
| S22 | Tokens semânticos | Polimento | Alto | G |
| S12 | Painéis encaixáveis e layouts salvos | Melhoria | Alto | G |

## Pacotes

Sugestões que funcionam melhor juntas:

- **Fundação e temas**: S22 + S24 + S25 + S23 + S26. Os temas, incluindo o OLED, dependem dos tokens. A escala e os ícones aproveitam a mesma passada pelo CSS.
- **Layout livre**: S11 + S12 + S13. A Atividade fixa é o primeiro degrau do encaixe. A janela própria reaproveita o mesmo painel com barra de título.
- **Jogo integrado**: S7 + S8 + S9 + S10. O palco, a barra sobre o jogo, a borda de estado e os avisos por tela usam o mesmo componente de status da conta.
- **Atenção**: S3 + S4 + S5 + S6. A central, o resumo da volta, os canais por evento e a bandeja leem a mesma lista de pendências.
- **Leitura rápida**: S1 + S2 + S15 + S17. O topo, os indicadores e o registro passam no teste dos 2 segundos.

## Hipóteses não verificadas

- O jogo de verdade dentro do webview não foi visto nesta prévia. A altura ideal da barra de S8, e se ela cobre botões do jogo, precisa ser conferida com o jogo aberto.
- A tela de 2560×1440 não foi medida. O painel tem largura máxima de 520 px (`styles.css:213`), então o espaço vazio deve crescer.
- A aparência real do menu e do ícone da bandeja não foi capturada.
