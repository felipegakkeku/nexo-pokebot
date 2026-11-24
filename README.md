# Nexo PokeBot

Hub multi-contas, motor Headless Eco e userscript de automação desenvolvidos **especificamente para o [PokeIdle](https://pokeidle.io/app) (Poke Idle World)**: captura inteligente em caídos, restock, equipe, auto-evoluir, bosses, Centro Médico integrado à troca de hunt, acompanhamento `/hunt`, recompensas de lives (Twitch e Kick) e HUD flutuante.

> **Palavras-chave:** `pokeidle` · `poke-idle-world` · `pokeidle.io` · `nexo-pokebot` · `pokebot` · `multi-account` · `pokegrid` · `pokeidle-deck` · `hunt-for-pokeidle` · `electron` · `websocket` · `userscript` · `tampermonkey`

## Instalar (Userscript no navegador)

1. Instale o [Tampermonkey](https://www.tampermonkey.net/) (ou Violentmonkey) no navegador.
2. Abra o arquivo `dist/pokebot.user.js` deste repositório em "Raw" e confirme a instalação.
3. Recarregue o jogo (F5). Deve aparecer `[Nexo PokeBot v1.0] Ativo!` no console e o HUD na tela.

O script tem `@updateURL` apontando para o `dist/pokebot.user.js` da branch `main` (veja *Como publicar* para migrar para as Releases): depois de um `git push`, o Tampermonkey se atualiza sozinho (a verificação roda a cada algumas horas; para forçar, use "Verificar atualizações" no painel do Tampermonkey).

Não existe mais o loader separado nem o `@require file:///...`: o `dist/` já é o script completo, sem ponte externa.

## Como usar

- **Fila /hunt manual:** na aba Geral, cole a lista do ranking do [PokéIdle Hub](https://pokeidleguide.io/#hunt) em *Fila Manual* e clique em **Carregar** (só monta a fila) ou **Carregar e ir** (monta e viaja para o primeiro item). Aceita linhas como `1. Kakuna Nv 10 38,1 mil XP/h ✓ 6%`, ou itens separados por `>`, `|` e vírgula. Não recarrega a página.
  - O nome do ranking é de espécie, e o mapa do jogo trabalha com região/nível. O bot tenta casar o nome com o marcador (preferindo o nível igual); se nada casar, usa uma área liberada de nível não acima do seu Pokémon (toggle *Fila: Fallback Seguro*).
- **Copiar Ficha:** abre a ficha do Pokémon ativo, aciona o botão nativo **Copiar p/ ChatGPT** do jogo e fecha o modal. É exatamente o texto que o Hub espera no campo da ficha. *Ficha + abrir Hub* também abre `pokeidleguide.io/#hunt` em outra aba.
- **Auto-Evoluir:** desligado por padrão. Abre a confirmação de evolução do jogo, lê os requisitos (nível mínimo e pedra na mochila) e só confirma se todos estiverem ok; se faltar algo, cancela e olha de novo em 10 min. Ignora Eevee e evoluções que exigem Shiny Stone, e respeita arena especial, pausa e Shiny Guard.

> O Hub também tem a extensão oficial **/hunt for PokeIdle** (links na própria página), que mostra o ranking dentro do jogo sem copiar a ficha. O PokeBot não depende dela.

### Nexo PokeBot (1 janela para 4 contas + navegador embutido)

No Windows, baixe o ZIP **`Nexo-PokeBot-v1.0.zip`** na página [Releases](https://github.com/felipegakkeku/pokebotfarm/releases), extraia todo o conteúdo e abra **`Nexo PokeBot.exe`** na pasta extraída. O ZIP já inclui o runtime Electron identificado como **Nexo PokeBot** no Gerenciador de Tarefas e com ícone próprio.

Se você clonou o repositório ou baixou **Code -> Download ZIP**, instale o Node.js 24 LTS e dê dois cliques em **`Abrir Nexo PokeBot.bat`**. No terminal, a sequência equivalente é:

```powershell
npm.cmd ci
npm.cmd run hub
```

O Nexo PokeBot abre **uma única janela** com:

- **Troca de contas no topo (Contas 1 a 4)**: mostra o nick, status e hunt atual de cada conta com troca em 1 clique.
- **Navegador embutido isolado por conta** (`<webview partition="persist:conta1..4">`): cada conta tem sua própria sessão separada, sem precisar abrir várias janelas do Chrome, com suporte à extensão `/hunt for PokeIdle` ativa dentro da aba embutida.
- **3 modos de exibição**: **Painel + Jogo** (painel à esquerda + jogo embutido à direita), **Grade 2x2** (todas as contas juntas na mesma janela) e **Só Painel (Eco)** (modo headless leve sem navegador aberto).
- **Centro Médico integrado à troca de hunt**: exibe a mesma contagem de saída de combate do jogo no botão **Centro Médico** e permite agendar a troca de hunt automaticamente assim que sair de combate.
- **Perfil configurado respeitado nas aberturas**: lives oficiais da Twitch/Kick, chat, extensões e links abrem sempre no perfil configurado daquela conta.
- **Notificações toast de atividade**: avisos flutuantes para shinies, drops raros, recompensas de live, trocas de hunt e alertas de sessão.
- **Acompanhamento `/hunt` em modo Headless e Embutido**: detecta automaticamente a extensão `/hunt for PokeIdle` instalada no Chrome para exibir no embutido e calcular/trocar hunts em Worker thread sem travar a interface.
- **Drops e eficiência no painel Eco**: identifica foco do mapa (Outland, Unova, Boss ou Hunt), contabiliza drops com filtros clicáveis (ex: ocultar Stones comuns ou qualquer item individual) e exibe tempo/abate, capturas/abate e lucro líquido/h.
- **Bandeja única**: ao minimizar para a bandeja, um único ícone mostra todas as contas pelo nick e permite saltar direto para qualquer uma.
- **Compartilhar com amigos**: rode `npm run package:friend` para gerar `release/Nexo-PokeBot-v1.0.zip` já com o runtime Electron identificado e sem nenhum dado pessoal (sessões, cookies ou tokens).

Para consumo mínimo absoluto em **1 único processo Node (~60 MB RAM, sem Electron/GPU)**, execute `Nexo PokeBot.exe --eco`, abra **`Abrir Nexo PokeBot Eco (1 Processo).bat`** ou rode `npm run eco`. Para abrir o painel clássico WinForms de uma conta isolada, passe `--legacy` ou `--account 2`.

### Desktop com quatro contas (modo clássico)

Feche o executável antigo e use o PowerShell na pasta do projeto. Em uma cópia do código-fonte, execute `npm.cmd ci` e `npm.cmd run build:exe` para gerar o executável clássico antes de rodar o comando abaixo.

```powershell
1..4 | ForEach-Object { Start-Process ".\dist\Nexo PokeBot.exe" -ArgumentList "--account $_" }
```

A conta 1 conserva a configuração existente. As contas 2 a 4 usam sessões, perfis de navegador e configurações próprias. Você também pode abrir outra conta pelo menu **Painéis por conta**, no ícone do bot na bandeja do Windows. Em cada painel, use **Logar PokeIdle** e conecte Twitch e Kick. Para trocar uma conta já conectada, abra o botão de login, saia do usuário anterior na janela do navegador e entre com o novo usuário. O desktop requer Node.js 22 ou superior.

Na **Conta 1**, **Abrir Jogo** e **Web** usam o último perfil existente do Chrome ou Edge, quando localizado. O login do Pokeidle lê a sessão do jogo desse perfil. Twitch e Kick usam o login do próprio navegador para o chat. Nas contas adicionais (2 a 4), o login do Pokeidle abre o navegador sem depuração remota e lê a sessão gravada no perfil. Em **Conexões**, você também pode escolher qualquer perfil existente do Chrome/Edge em **Perfil do navegador** ou usar **Colar sessão** com o JSON copiado pelo botão **Copiar Sessão Headless** do HUD.

Se você já está logado no Chrome, clique em **Conexões → Usar sessão do Chrome**. O bot lê a sessão do jogo sem pedir outro login. Para retomar o farm em segundo plano, feche a aba do jogo e clique em **Iniciar**.

**Jogar com o bot** abre o jogo em uma janela normal do navegador e vincula as automações àquela aba. Na Conta 1, aproveita o navegador habitual quando a conexão de depuração já está disponível. Caso contrário, abre o perfil separado do bot.

Com a extensão **/hunt for PokeIdle** instalada no perfil usado para jogar, escolha **Acompanhamento /hunt** em **Automação**. **Avisar** registra a sugestão no painel e mostra uma notificação na bandeja do Windows. **Trocar automaticamente** segue o ranking de XP/h, ouro/h ou shiny/h após confirmar a mesma recomendação em duas leituras. O bot respeita a região selecionada na extensão quando ela tiver hunts elegíveis e só troca para hunts liberadas, reconhecidas pelo jogo e sem risco alto de morte estimado. O ranking precisa da janela vinculada.

Para instalar a extensão no navegador usado pelo bot, abra o perfil da conta desejada (troque `2` pelo número da conta):

```powershell
Start-Process ".\dist\Nexo PokeBot.exe" -ArgumentList '--account 2 --extensions'
```

Instale a extensão nessa janela. Repita nos perfis que vão usá-la. Para uma extensão exclusiva do Edge, defina `POKEBOT_BROWSER_EXE` com o caminho do `msedge.exe` no PowerShell antes de abrir o bot e os perfis.

Abra o painel web da conta em `http://127.0.0.1:17890` até `http://127.0.0.1:17893`. O bot lê a lista de canais oficiais online do jogo. **Abrir Lives Oficiais**, no painel web e no menu da bandeja, abre até 12 canais oficiais por plataforma no navegador do perfil. O número de lives que recebe pontos depende da plataforma. Canais extras são opcionais. O painel mostra erros por canal. Se a Twitch exigir o resgate do baú no navegador, use a janela da live no perfil da conta para resgatar.

Para mandar uma mensagem, clique em **Web** no desktop e escolha o canal em **Chat de live oficial**. Escreva e envie pelo próprio chat no painel. Se a plataforma bloquear o chat incorporado, **Abrir só o chat** abre a conversa no navegador da conta.

### API no console

`PokeBot.status()`, `pausar()`, `retomar()`, `stop()`, `syncHuntGuide()` (monta a fila a partir do mapa), `proximaHuntGuia()`, `definirFilaHunt([...])`, `carregarFilaManual()`, `limparFilaHunt()`, `copiarFichaHunt()`, `verificarEvolucao()`.

## Estrutura

```
src/modules/    toda a lógica das automações, em módulos ES de verdade (um por automação) + agendador, runtime e funções puras
  scheduler.js    agendador central (um laço, prioridade, sem sobreposição)
  runtime.js      contrato de módulo { id, everyMs, tick(ctx), ... } e registro
  pure.js         funções puras (parse, normalização), fonte única
  *.js            capture, restock, depot, hatchery, boss-loot, team-season, rmt-radar, minigames,
                  telemetry, map-benchmark, map-hop-optimize, hunt-queue, hub-sheet, daily-pass, auto-evolve
src/            núcleo legado, fragmentos numerados juntados em ordem pelo build (uma IIFE)
  00-core.js      constantes, CONFIG, estado (abre a IIFE; recebe o bundle dos módulos)
  05-pure.js      ponte para modules/pure.js
  10-utils.js ... 30-dom-readers.js   utilitários, modal lock, leitores do DOM
  70-hud.js       HUD
  80-control.js   API pública (window.PokeBot) e stop()
  89-runtime.js   ponte: monta o ctx, registra os módulos, define os nomes antigos
  90-init.js      inicialização (fecha a IIFE)
tests/          testes (node:test + jsdom); cada módulo tem o seu, com ctx falso
dist/           pokebot.user.js gerado (é este que se instala)
legacy/         versões e fragmentos antigos (v6.5-*), só para consulta
build.mjs       empacota src/modules com esbuild, junta src/ e gera dist/ (e confere a tag com --check-tag)
eslint.config.js  no-undef e no-unused-vars nos módulos: acusa dependência esquecida antes do jogo quebrar
CHANGELOG.md    uma linha por versão; vira a nota da Release
```

Os fragmentos numerados de `src/` **não são módulos ES**: são pedaços de um mesmo escopo, e a ordem dos nomes importa. Foi uma escolha para dividir o código sem mudar nenhum comportamento. Funções novas sem dependência de DOM devem ir em `05-pure.js` para poderem ser testadas.

## Desenvolver

Requer Node 18+.

```bash
npm ci             # instala as versões do package-lock.json, incluindo Electron e jsdom
npm run build      # gera dist/pokebot.user.js e valida a sintaxe
npm test           # parsers + smoke test do script inteiro num DOM falso
npm run check      # build + testes
```

## Como publicar

Cada versão vira uma Release do GitHub pelo workflow `.github/workflows/release.yml`, que roda ao enviar uma tag `vX.Y.Z`.

```bash
# 1. suba "version" no package.json (ex.: 6.6.0) e mova o texto de "Unreleased" para "## 6.6.0" no CHANGELOG.md
npm run check                 # build + testes; gera o dist/ novo
git add .
git commit -m "release: v6.6.0"   # o dist/pokebot.user.js vai junto
git push
git tag v6.6.0
git push --tags               # dispara a Release
```

O workflow roda `npm ci` e `npm run check` no Windows, confere a tag e o userscript gerado, e anexa o ZIP do Hub, o userscript e o checksum à Release.

### Trocar o auto-update para as Releases (só depois da primeira Release)

Hoje o `@updateURL` aponta para a branch `main`, e isso continua funcionando. Para passar a usar `releases/latest/download/pokebot.user.js`:

1. Publique a primeira Release pelo fluxo acima.
2. Em `build.mjs`, troque `UPDATE_CHANNEL` de `'main'` para `'release'`.
3. Publique **mais uma versão** assim: quem ainda usa a URL antiga recebe esse script pela `main` e migra sozinho para a URL nova.

Para ver o resultado antes: `POKEBOT_UPDATE_CHANNEL=release npm run build`.

## Referências e Ecossistema PokeIdle

O **Nexo PokeBot** foi desenvolvido especificamente para o **[PokeIdle (pokeidle.io)](https://pokeidle.io/app)** e dialoga com ferramentas e referências abertas criadas pela comunidade:

- **[PokeGrid (`soufoka/PokeGrid`)](https://github.com/soufoka/PokeGrid)** e **[PokeGrid-source (`soufoka/PokeGrid-source`)](https://github.com/soufoka/PokeGrid-source)**: referência da comunidade para rodar até 4 contas isoladas de Poke Idle World em uma única janela em grade.
- **[pokeidleDeck (`darlanhms/pokeidleDeck`)](https://github.com/darlanhms/pokeidleDeck)**: deck desktop multi-contas para PokeIdle com coleta de recompensas de lives e recompra de itens.
- **[PokéIdle Hub e extensão `/hunt for PokeIdle`](https://pokeidleguide.io/#hunt)**: guia de hunts e extensão da comunidade para ranking de XP/h, ouro/h e shiny/h integrada opcionalmente pelo Nexo PokeBot no modo embutido e no modo Eco.

## Limitações conhecidas

- Os testes usam um DOM falso baseado no do jogo (conferido em 20/11/2026). Se o jogo mudar ids/classes, o smoke test continua passando: confira o HUD no jogo depois de atualizações do Pokeidle.
- Mapa, captura e demais módulos não têm teste automatizado; foram só reorganizados, sem mudança de lógica.

**Como adicionar ou mudar uma automação:** módulo novo em `src/modules/` com o contrato `{ id, everyMs, tick(ctx), dispose?(ctx) }`, exportado em `index.js` e registrado em `89-runtime.js`. O módulo só usa o que vem em `ctx` (config, estado, leitores do DOM, storage) e funções puras importadas de `pure.js`, então é testável sem o resto. Se algo ainda for usado pelo HUD ou pela API, deixe um alias com o nome antigo em `89-runtime.js` (sempre como função seta, por causa da ordem de definição). `npm run check` roda lint, build e testes.
