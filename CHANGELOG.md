# Changelog

Uma linha por versão. Ao publicar, mova o conteúdo de "Unreleased" para a nova versão (o workflow usa o texto da seção como nota da Release).

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
