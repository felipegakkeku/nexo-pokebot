# Changelog

Uma linha por versão. Ao publicar, mova o conteúdo de "Unreleased" para a nova versão (o workflow usa o texto da seção como nota da Release).

## Unreleased

## 1.0.10

Gestão inteligente coordenada entre Kick e Twitch, novos sons padrão de alerta, correção de áudio no jogo embutido e ajustes de interface:

- **Gestão inteligente de buffs individual para Kick e Twitch (`src/modules/live-rewards.js`, `gui-server.mjs`, `renderer.js`, `hub-ui.js`)**: a meta (ex.: 24h ou 30 min para manter ligado) agora vale individualmente em cada plataforma porque os bônus se somam (+15% Kick + 15% Twitch). O bot prioriza a Kick e depois a Twitch em ordem fixa (`XP -> Captura -> Shiny`), acumula pontos sem vazar para o próximo buff durante o resgate otimista e só avança para o próximo buff quando a meta do buff atual estiver preenchida nas duas plataformas ativas. As barras dos cartões `Painéis` e o resumo da aba `Lives` também refletem o progresso combinado das duas plataformas e mostram quando uma plataforma está aguardando a outra.
- **Novos sons padrão de alerta (`src/electron/main.mjs`, `src/electron/renderer.js`)**: os 4 alertas principais já vêm pré-configurados com os sons do MyInstants (baixados e cacheados automaticamente em `.pokebot-sounds/` no primeiro uso, com fallback para bipe offline): **Erro** (`Low HP Pokemon`), **Shiny capturado** (`Pokemon Item Received`), **Drop raro** (`Ex Pull`) e **Shiny fugiu** (`Pokemon Escape`).
- **Áudio confiável no jogo embutido e em segundo plano (`src/electron/main.mjs`, `renderer.js`, `preload.cjs`, `gui-server.mjs`)**: habilitado `autoplay-policy=no-user-gesture-required` globalmente (inclusive nas webviews embutidas ao desmutar), removido `backgroundThrottling` da janela principal para alertas nunca travarem em 2º plano, adicionado fallback WebAudio (`AudioContext.decodeAudioData`), sincronização imediata de configuração entre janelas soltas, captura de `drop.raro` de Casa/Bicicleta Lendária ou Mítica via `recentRare` sem perda por filtro/sobreposição e registro de `shiny.captura` da própria conta (como Shiny chocado de ovo no jogo embutido).
- **Correções visuais na Grade e no topo (`src/electron/renderer.html`, `icons.js`, `renderer.js`, `styles.css`)**: corrigido o ícone duplicado no botão **Maximizar tela** dos slots na Grade (e hidratação idempotente em `icons.js`) e destacado o botão **Apoiar** no topo com coração maior preenchido em rosa e rótulo legível.

## 1.0.9

Correção definitiva das fotos/sprites de Pokémon e Shinies em todo o Hub, notificações, Mini-HUD e Painel Web:

- **Conversão completa dos IDs internos do PokeIdle para a National Dex (`src/headless/protocol-engine.mjs`, `gui-server.mjs`, `renderer.js`, `hub-ui.js`, `minihud.js`, `gui-dashboard.html`)**: resolve automaticamente Pokémon de Hoenn e gerações seguintes (`13xxx`, como Snorunt `#13361 -> #361`), todas as 58 variantes de Outland (`2001..2058` e legadas `10501..10547`, como Ancient Pupitar `#2033 -> #247`), Megas (`3xxx`, `9xxx`, `14xxx`), formas regionais/especiais (`1479`, `4xxx..12xxx`, Ogerpon `8017/9017/12017 -> #1017`) e fallback por nome quando o anúncio não informa `speciesId`.
- **Fallback automático em 4 níveis para sprites**: se um sprite pixel falhar ao carregar, qualquer imagem de Pokémon no Hub (abas, Desempenho, Atividade, toasts, Painéis, Headless, barra do jogo e Mini-HUD) tenta automaticamente `other/home/shiny`, `other/official-artwork/shiny` e sprite normal antes de desistir, sem quebrar ícones.

## 1.0.8

Correção de falso positivo no alerta **"Shiny visto e não capturado"** e controle de **volume individual por alerta**:

- **Filtro completo de entidades não selvagens no campo (`src/headless/protocol-engine.mjs`, `src/headless/gui-server.mjs`)**: Pokémon pertencentes a outros jogadores no Centro Médico / Praça (`b.dn`), pets em treino na Casa (`b.ti`), Pokémon de PvP (`b.eq`), bonecos de treino (`b.bn`), NPCs (`cura`/`tm`/`depot`), Boss Arena e Arena Mística agora são ignorados na captura, no contador de Shinies vistos e no alerta de Shiny perdido, evitando falsos alertas como pets de nível alto de outros treinadores.
- **Proteção contra frames atrasados da Praça e sincronização de `shiniesSeen`**: deltas `campo` com tag de sala (`m.sl`) de outra cena são descartados (igual ao `deltaDaCenaAtual` do jogo), o campo é limpo ao receber um novo `welcome` e `shiniesSeen` passa a usar exatamente a mesma lista validada de Shinies selvagens que o rastreador de Shiny perdido.
- **Volume individual por alerta (`src/electron/main.mjs`, `renderer.html`, `renderer.js`, `styles.css`)**: cada um dos 6 alertas (Shiny perdido, Shiny capturado, Drop raro, Erro, Caixinha +50 e Voto) agora tem seu próprio controle deslizante de volume (`0%` a `100%`) com botão **Testar** ao lado, combinado com o **Volume geral** e salvo em `.pokebot-sounds/sounds.json`.

## 1.0.7

Interface nova do Hub, pensada para acompanhar as 4 contas de relance, e alerta de shiny visto e não capturado:

- **Shiny que escapou (`src/headless/gui-server.mjs`)**: quando um shiny aparece no campo e some sem captura (fugiu, o corpo expirou ou a bola falhou), vira um evento próprio no registro, no Hub e no Windows. O som pode ser trocado por qualquer link do myinstants.com ou de um arquivo .mp3.
- **Alertas por evento**: shiny perdido, shiny capturado, drop raro, erro, caixinha da live e voto diário. Cada um escolhe entre **Som**, **Hub** e **Windows**; a notificação do Windows sai com o Hub minimizado e o clique leva direto para a conta.
- **Bandeja**: o ícone muda de cor pelo estado das contas (verde, amarelo, vermelho), o menu mostra XP/h, ouro/h e shinies de cada conta e liga o mini-HUD.
- **Temas escuros e cor de destaque**: Marinho, Grafite, Preto OLED e Alto contraste, com 6 cores de destaque, no menu **⋯** do topo.
- **Topo enxuto**: abas de conta com o sprite do Pokémon ativo e borda pelo estado, ícones no lugar dos textos e a central **Precisa de você** (sino), que junta avisos de modo com botão **Corrigir**, erros, contas pausadas, caixinha para resgatar, voto e shinies que escaparam.
- **Números grandes**: XP/h, Lucro/h e Shinies no topo do Desempenho, com minicurva e tendência.
- **Painel vivo no Headless**: a tela de cada conta sem jogo aberto mostra Pokémon com anel de HP, ritmo, últimos eventos e drops da sessão.
- **Jogo embutido mais integrado**: barra fina sobre o jogo com HP, XP/h, lucro, abates e shinies (em cima, embaixo ou desligada); na Grade, os avisos aparecem dentro da tela da conta.
- **Registro legível**: filtros (Shiny, Recompensas, Avisos, Erros), busca, conta escolhida ou as 4, repetições agrupadas e hora relativa.
- **Layout livre**: Atividade fixa numa coluna ao lado (tecla **A**), **Só Painel** em até 3 colunas montadas arrastando as abas, layouts com nome e qualquer aba numa **janela solta**.
- **Mini-HUD**: janela pequena sempre visível com as 4 contas (tecla **H** ou pela bandeja).
- **Configuração que salva sozinha**: aviso "Salvo às HH:MM" com **Desfazer**, selo mostrando que a regra vale só para a conta escolhida e cópia para as outras contas com confirmação. O guia longo virou dicas ⓘ ao lado de cada opção.
- **Enquanto você estava fora**: depois de 30 min longe, um resumo por conta no lugar da rajada de avisos.
- **Atalhos de teclado**: 1 a 4, S/G/P/C, A, B, H, M, [ ] e **?** para ver a lista.

## 1.0.6

Atualização que aplica de verdade, aviso proativo de versão nova, grade livre das 4 contas, sequência de lives contada pela Twitch e gestor de buffs redesenhado:

- **Atualização que aplica (`src/desktop/updater.mjs`, `src/electron/main.mjs`)**: o script que troca os arquivos morria junto com o Hub ao fechar, e o app reabria na versão antiga. Agora ele roda fora da árvore de processos do Hub, e na abertura seguinte o Hub confere se a versão nova entrou (avisa com o caminho do log se não entrou). **Quem está na 1.0.4 ou 1.0.5 precisa baixar este ZIP e extrair por cima da pasta uma vez**; depois disso as atualizações aplicam sozinhas.
- **Launcher proativo**: o Hub confere versão nova a cada 30 min, mostra uma faixa no topo com **Atualizar agora**, **Novidades** e **Depois**, e manda notificação do Windows. Depois de atualizar, a faixa confirma a versão nova.
- **Grade livre (`src/electron/renderer.*`, `styles.css`)**: layouts 2x2, Destaque 1+3, Colunas e Linhas; divisórias que redimensionam (duplo clique centraliza); arrastar uma tela pela barra para trocar de lugar; maximizar e ocultar telas. Tudo fica salvo.
- **Som por conta**: ícone de alto-falante em cada aba e em cada tela (vermelho mudo, verde com som, pulsando quando toca), com clique para alternar e **Mutar todas** na grade.
- **Painéis 2x2**: as 4 contas em cartões lado a lado, sem abrir o jogo, com Pokémon ativo, HP, XP/h, lucro/h, kills, capturas, shinies, drops e botões de Iniciar/Pausar, Painel completo e Abrir jogo.
- **Sequência de lives na Twitch (`src/electron/main.mjs`)**: os pings simulados contavam minutos e pontos, mas não a sequência. Agora o Hub assiste os primeiros 15 min de cada transmissão no player real da Twitch, numa janela invisível da conta, em 160p e sem som (no máximo 2 ao mesmo tempo). A linha do canal mostra o andamento.
- **Seguir automático**: na mesma visita o Hub segue o canal se a conta ainda não segue. As duas opções ficam em Automação.
- **Pontos das lives sempre atualizados (`src/modules/live-rewards.js`, `src/headless/gui-server.mjs`)**: com a aba Lives aberta, os pontos de todos os canais são lidos a cada 20 s numa consulta leve, mesmo com o bot pausado.
- **Gestor inteligente de buffs**: barras por buff (XP, Captura, Shiny) na Twitch e no Kick mostrando o tempo guardado em relação à meta, qual buff é o próximo resgate e se o gestor está ligado.

## 1.0.5

Caixinha +50 da Twitch resgatada sozinha, sem abrir o chat, e notificações redesenhadas com a ficha do shiny capturado:

- **Caixinha +50 sem abrir o chat (`src/electron/main.mjs`)**: o clique na caixinha acontece dentro do chat popout da Twitch numa janela oculta da própria conta (sem foco, fora da barra de tarefas e sem capturar o mouse), passando na checagem anti-robô que barra o resgate pela API. O botão **Resgatar +50** da HUD resolve em 1 clique, e o chat leve visível só abre como plano B.
- **Resgate automático em segundo plano**: quando a Twitch marca a caixinha como manual, o Hub resgata sozinho, uma por vez entre as 4 contas, e espera 2 min (sem caixinha) ou 10 min (falha) antes de tentar de novo. Segue a opção de auto-resgate do baú.
- **Contador e log (`src/headless/gui-server.mjs`)**: caixinha resgatada pela HUD ou no automático entra em **Baús +50** e no log de recompensas.
- **Notificações novas (`src/electron/renderer.js`, `styles.css`)**: ícone e cor por tipo, barra de tempo que pausa com o mouse em cima, botão de fechar e rótulo de ação (**Resgatar agora**, **Abrir voto**).
- **Ficha do shiny capturado**: cartão dourado com sprite shiny animado, nível, hunt, número da Pokédex e os campos que o jogo envia do Pokémon; **Shiny no servidor** também mostra o sprite.

## 1.0.4

Captura garantida em todos os modos de economia, autorecuperação do feed de campo e avisos claros de limitações e capacidades na HUD:

- **Captura e detecção de Shiny garantidas em contas VIP no Modo Eco (`src/headless/gui-server.mjs`, `src/headless/cli-runner.mjs`)**: no modo `auto`, o Headless não ativa mais `cliente.economia: true` enquanto a captura de caídos estiver ligada, garantindo que contas VIP continuem recebendo `campo` com `sh: true` para priorizar Shinies e jogar a Bola Shiny.
- **Autorecuperação automática do feed de campo + fila AoE (`src/headless/protocol-engine.mjs`, `src/headless/gui-server.mjs`, `src/electron/webview-preload.cjs`)**: fila de múltiplos slots em combate (`recentBattleSlots`) para abates simultâneos em fallback de batalha, watchdog que reativa o feed leve automaticamente caso `campo` suma durante o combate (mantendo 0% GPU no Modo Economia visual do jogo) e re-injeção garantida no `DOMContentLoaded`.
- **Avisos de limitações ao trocar de modo + guia de capacidades (`src/electron/renderer.html`, `renderer.js`, `styles.css`, `src/headless/gui-dashboard.html`)**: banner com botão 1-clique **Restaurar captura + Shiny**, toast instantâneo ao ativar modos que limitam funções (como **Economia do servidor** sem detecção prévia de Shiny ou **Somente Ping**), aviso nas abas de conta e cartão recolhível explicando como cada modo e capacidade do Nexo PokeBot funciona.

## 1.0.3

Correção de captura automática (**Auto-Catch**) com o **Modo Economia / ULTRA Economia** do PokeIdle ativado:

- **Auto-Catch ativo no Modo Economia / ULTRA Economia do jogo (`src/electron/webview-preload.cjs`, `src/electron/renderer.js`, `src/headless/gui-server.mjs`)**: mantém o canvas local do PokeIdle 100% desligado (0% GPU) quando o jogador ativa o Modo Economia do jogo, mas preserva o feed leve de caídos do servidor sempre que "Capturar Pokémon caídos" estiver ligado, garantindo o arremesso de Pokébolas (incluindo shinies).
- **Fallback por eventos de batalha no Modo Headless (`src/headless/protocol-engine.mjs`, `src/headless/gui-server.mjs`, `src/headless/cli-runner.mjs`)**: quando `cliente.economia: true` está ativo no servidor e os frames `campo` são omitidos, o rastreador de campo passa a identificar o slot caído pelos eventos `batalha` (`ataque` + `morte`) e disparar `ball.throw` automaticamente.

## 1.0.2

Popups leves direto na HUD para **Vote & Ganhe** e **Caixinha +50 da Twitch** sem abrir navegador externo nem player de vídeo:

- **Votar direto da HUD (`Votar aqui`)**: abre uma janela compacta (`560x740`) isolada por conta (`persist:conta1..4`) direto no `IdleHub.io` já com o nick preenchido para confirmação manual em segundos; ao fechar, atualiza automaticamente a contagem de votos e diamantes (mantendo botão `↗` opcional para navegador externo).
- **Resgatar caixinha `+50` da Twitch sem vídeo (`Resgatar +50 aqui`)**: abre apenas o chat popout leve (`400x580`, zero player de vídeo) já logado na conta Twitch daquela aba para clicar manualmente na caixinha verde `+50`, atualizando o saldo ao fechar.
- **Toasts flutuantes clicáveis**: notificações de caixinha `+50` disponível e voto diário liberado abrem o popup leve correspondente com 1 clique.

## 1.0.1

Correções de estabilidade no **Gestor Inteligente de Buffs** e isolamento multi-conta das lives:

- **Isolamento completo por conta nas lives (`src/modules/live-rewards.js`, `src/headless/gui-server.mjs`)**: cada uma das 4 contas agora mantém seu próprio estado de execução (pings da Twitch, WebSockets e leitura de pontos da Kick, `guardReads`, cooldowns de resgate, cache de integridade e `dispose` individual), eliminando o bloqueio mútuo entre a Conta 1 e as Contas 2 a 4.
- **Gestor Inteligente sem starvation de XP**: quando há buffs zerados ou atrasados disponíveis no canal (ex.: Captura ou Shiny), o gestor agora reserva os pontos do canal em vez de gastar repetidamente em XP, aplica desempate LRU em empates, mantém a mesma regra no `runBonusGuard` (canais offline), estima o bônus recém-resgatado imediatamente e respeita a meta no clique manual de **Coletar das lives**.
- **Visibilidade por canal na aba Lives**: exibe logo abaixo do canal o motivo de espera (ex.: `guardando p/ CAPTURA (500 pts)` ou `próx. CAPTURA (5000 pts · 10h)`).
- **Título e versão dinâmicos no Hub**: versão lida automaticamente do `package.json` na barra superior e título da janela.

## 1.0.0

Primeiro lançamento oficial do **Nexo PokeBot** (versão 1.0), desenvolvido especificamente para o **PokeIdle (`pokeidle.io`)**, consolidando a linhagem 6.x do userscript em um hub desktop multi-contas completo:

- **Identidade Nexo PokeBot e Processo Windows**:
  - Novo ícone original multi-resolução (`16` a `256 px`) em `assets/nexo-pokebot-icon.png` e `assets/nexo-pokebot.ico`.
  - Runtime Electron e launcher renomeados para `Nexo PokeBot.exe` com metadados PE (`FileDescription`, `ProductName`, `OriginalFilename`, ícone) e AUMID `com.nexo.pokebot` corretos no Gerenciador de Tarefas, Barra de Tarefas e Bandeja do Windows.
  - Pacote Windows pronto para distribuição (`npm run package:friend` -> `release/Nexo-PokeBot-v1.0.zip`) limpo (sem sessões, cookies ou credenciais locais) anexado automaticamente à Release pelo GitHub Actions.
- **Hub Multi-Contas em Electron (`src/electron/`, `Abrir Nexo PokeBot.bat`, `npm run hub`)**:
  - Janela única para até 4 contas isoladas (`persist:conta1..4`) com navegador embutido por conta, bandeja única por nick e 3 modos de exibição (Painel + Jogo, Grade 2x2 e Só Painel Eco).
  - Extensão `/hunt for PokeIdle` ativa também na tela embutida do jogo, além do cálculo em Worker thread no modo Headless Eco (`src/headless/hunt-guide-worker.mjs`).
  - **Centro Médico integrado à troca de hunt**: botão **Centro Médico** sincronizado à mesma contagem de saída de combate do jogo (`centroLivreEm` / `trocaHuntLivreEm`) e agendamento automático da troca de hunt quando o jogador está tomando dano.
  - **Perfil configurado respeitado**: abertura de lives oficiais (Twitch/Kick), chat, painel web, extensões e links externos sempre no perfil configurado da conta (`--user-data-dir` + `--profile-directory` ou perfil isolado de lives).
  - **Notificações toast de atividade**: toasts flutuantes (com toggle na aba Atividade) para shinies, drops raros, recompensas de live, trocas de hunt e alertas de erro/sessão.
  - Botão discreto **Apoiar** no topo com popover da chave Pix do projeto (ou gold para `"gake"` no jogo).
- **Modo Ultra-Eco em 1 Processo (`src/headless/multi-daemon.mjs`, `Abrir Nexo PokeBot Eco (1 Processo).bat`, `Nexo PokeBot.exe --eco`, `npm run eco`)**: roda as 4 contas em um único processo Node sem Electron/Chromium, com painel de drops e eficiência clicáveis.
- **Motor Headless WebSocket Standalone e Dashboard Web (`headless-farm.mjs`, `src/headless/`, `src/desktop/`)**:
  - Extrator de sessão/preferências, automação via WebSocket nativo (captura em caídos, restock, passe diário, prey, reconexão/`--standby` no `4001`), dashboard web em `http://127.0.0.1:17890` e ponte 1-click **Copiar Sessão Headless** no userscript (`window.PokeBot.exportarSessaoHeadless()`).
- **Alta eficiência de memória**: roda até **4 contas + cerca de 40 lives simultâneas (Twitch e Kick) com média de ~400 MB de RAM** no Hub (vs. ~2 GB+ em apps similares com múltiplas abas/WebView2) e **~60 MB de RAM total** no Modo Ultra-Eco em 1 processo.
- **Atualização automática via GitHub Releases (`src/desktop/updater.mjs`, `Nexo PokeBot.exe --update` e botão `Atualizar` no topo)**: verifica novas Releases automaticamente, baixa com barra de progresso, aplica os arquivos novos e reinicia o app preservando 100% das sessões e configurações locais (`.pokebot-*`).
- **Monitor de Vote & Ganhe (`IdleHub.io`) em 1 clique**: acompanha `/idlehub/me` e o evento `votoCreditado` nas 4 contas com contagem regressiva, toast automático quando liberar/creditar diamantes e botão para abrir o link oficial no perfil configurado da conta.
- **Importador / Recuperador de Sessões (`Recuperar Sessoes Nexo PokeBot.bat`)**: importa em 1 clique as 4 contas já logadas (**PokeIdle + Twitch + Kick**) de **PokeIdleMulti**, **IdleDeck**, **PokeGrid**, pastas antigas do PokeBot ou Lixeira do Windows, usando DPAPI local e o runtime embutido (`ELECTRON_RUN_AS_NODE=1` + `node:sqlite`) sem exigir Node.js instalado.
- **Referências da comunidade PokeIdle**: documentação e metadados atualizados com palavras-chave de PokeIdle e referências a `soufoka/PokeGrid`, `soufoka/PokeGrid-source`, `darlanhms/pokeidleDeck`, `artbruno35/PokeIdleMulti` e `/hunt for PokeIdle`.

## 6.8.1

- Melhorias no módulo `liveRewards`:
  - Listas oficiais fallback (`DEFAULT_TWITCH_OFFICIALS` e `DEFAULT_KICK_OFFICIALS`) + consulta em lote (`checkTwitchLiveBatch`) para descobrir lives no ar mesmo se o userscript carregar após o `welcome`.
  - Janela de confirmação de 5 min (`ConfirmWithin`) por plataforma evitando resgate duplo no mesmo ciclo + backoff de 30 min em caso de recusa.
  - Guarda de Bônus (`BonusGuard`) completa em canais extras/offline com pontos parados quando o bônus está prestes a vencer.
  - WebSocket da Kick agora envia `channel_handshake`, `ping` e `tracking.user.watch.livestream` imediatamente no evento `open` e mantém heartbeat a cada 15 s.

## 6.8.0

- Novo módulo `liveRewards` (`src/modules/live-rewards.js`) e aba **Lives** no HUD para farmar pontos e resgatar recompensas de live (Twitch e Kick) sem precisar manter a aba do stream aberta:
  - Twitch leve: envia ping `minute-watched` (`spade_url`) + `HEAD` no segmento HLS, coleta o baú `+50` (`claimCommunityPoints`) e resgata o bônus escolhido (`xp`, `captura` ou `shiny`) via GQL quando estiver perto de vencer.
  - Kick leve: mantém conexão WebSocket de espectador (`channel_handshake`, `ping` e `tracking.user.watch.livestream`) e resgata a recompensa via REST quando a guarda vencer.
  - Captura automática de cookies via `GM_cookie` (quando autorizado no Tampermonkey) ou tokens colados no HUD, além de leitura automática de canais ao vivo do WebSocket/modal do jogo.

## 6.7.0

- Seleção real de pokébola nos caídos (`#caidos-bolas` além de `#auto-ball-opts`), priorização de corpos prestes a expirar (`.acabando`) e fallback de leitura de bolas via `#caidos-bolas`.
- Configurações editáveis e persistentes no HUD (aba Módulos): Bola Normal, Bola Shiny, Nível para Ultra Ball, Alvo de Bolas, Alvo de Poções e Reserva de Gold.
- Novo módulo Auto-Prey (`src/modules/prey.js`): gira a roleta grátis do dia e seleciona o Pokémon adequado conforme hunt atual, fila ou nível.
- Auto-Loot de Boss atualizado para `#recompensa` (`#rc-todos` / `#rc-ok`) e Arena Mística (`#recompensa.rc-mistico` / `.mst-bola`), além de guardião no Restock para manter `#auto-revive`, `#auto-potion` e `#auto-voltar-hunt` ligados.

## 6.6.0

- Auto-Evoluir só confirma quando os requisitos (nível e pedra) estão ✓; desligado por padrão e sem trava de HP (Fase 0).
- Fase 2: todas as automações viraram módulos ES em `src/modules/` (agendador central, contrato de módulo, funções puras e `selectors.js`), com ESLint e 200+ testes; o `dist` agora é empacotado com esbuild. Comportamento mantido; os períodos passam a rodar no laço do agendador (100 ms de resolução).

## 6.5.0

- Projeto reorganizado em `src/` com build e testes; ficha copiada pelo botão nativo "Copiar p/ ChatGPT"; fila /hunt manual sem reload.

## 6.4.0

- Fila /hunt manual, copiar ficha para o Hub, auto-evoluir com trava de HP e aba Geral mais limpa.

## 6.3.0

- Versão base anterior ao projeto (arquivo único, hoje em `legacy/pokebot-v6.3.js`).
