# PokeBot

Script de automação para o [Pokeidle](https://pokeidle.io/app): captura com bola inteligente, restock, equipe, auto-evoluir, bosses, mapa/hunt, mini games e um HUD flutuante com 3 abas (Geral, Módulos, Radar).

## Instalar

1. Instale o [Tampermonkey](https://www.tampermonkey.net/) (ou Violentmonkey) no navegador.
2. Abra o arquivo `dist/pokebot.user.js` deste repositório em "Raw" e confirme a instalação.
3. Recarregue o jogo (F5). Deve aparecer `[PokeBot v6.5] Ativo!` no console e o HUD na tela.

O script tem `@updateURL` apontando para o `dist/pokebot.user.js` da branch `main` (veja *Como publicar* para migrar para as Releases): depois de um `git push`, o Tampermonkey se atualiza sozinho (a verificação roda a cada algumas horas; para forçar, use "Verificar atualizações" no painel do Tampermonkey).

Não existe mais o loader separado nem o `@require file:///...`: o `dist/` já é o script completo, sem ponte externa.

## Como usar

- **Fila /hunt manual:** na aba Geral, cole a lista do ranking do [PokéIdle Hub](https://pokeidleguide.io/#hunt) em *Fila Manual* e clique em **Carregar** (só monta a fila) ou **Carregar e ir** (monta e viaja para o primeiro item). Aceita linhas como `1. Kakuna Nv 10 38,1 mil XP/h ✓ 6%`, ou itens separados por `>`, `|` e vírgula. Não recarrega a página.
  - O nome do ranking é de espécie, e o mapa do jogo trabalha com região/nível. O bot tenta casar o nome com o marcador (preferindo o nível igual); se nada casar, usa uma área liberada de nível não acima do seu Pokémon (toggle *Fila: Fallback Seguro*).
- **Copiar Ficha:** abre a ficha do Pokémon ativo, aciona o botão nativo **Copiar p/ ChatGPT** do jogo e fecha o modal. É exatamente o texto que o Hub espera no campo da ficha. *Ficha + abrir Hub* também abre `pokeidleguide.io/#hunt` em outra aba.
- **Auto-Evoluir:** desligado por padrão. Abre a confirmação de evolução do jogo, lê os requisitos (nível mínimo e pedra na mochila) e só confirma se todos estiverem ok; se faltar algo, cancela e olha de novo em 10 min. Ignora Eevee e evoluções que exigem Shiny Stone, e respeita arena especial, pausa e Shiny Guard.

> O Hub também tem a extensão oficial **/hunt for PokeIdle** (links na própria página), que mostra o ranking dentro do jogo sem copiar a ficha. O PokeBot não depende dela.

### API no console

`PokeBot.status()`, `pausar()`, `retomar()`, `stop()`, `syncHuntGuide()` (monta a fila a partir do mapa), `proximaHuntGuia()`, `definirFilaHunt([...])`, `carregarFilaManual()`, `limparFilaHunt()`, `copiarFichaHunt()`, `verificarEvolucao()`.

## Estrutura

```
src/            fragmentos numerados, juntados em ordem pelo build
  00-core.js      constantes, CONFIG, estado (abre a IIFE)
  05-pure.js      funções puras, sem DOM (testadas)
  10-utils.js ... 30-dom-readers.js
  40..50-*.js     automações (captura, restock, passe, depot, chocadeira, boss, equipe, evoluir, RMT, mini games, telemetria)
  60..63-*.js     mapa, fila /hunt, ficha do Hub, hop/otimização
  70-hud.js       HUD
  80-control.js   API pública e stop()
  89-runtime.js   ponte para os módulos (monta o ctx e registra cada módulo migrado)
  90-init.js      inicialização (fecha a IIFE)
src/modules/    módulos ES de verdade (agendador, runtime, selectors.js, passe diário); empacotados com esbuild
tests/          testes (node:test + jsdom)
dist/           pokebot.user.js gerado (é este que se instala)
legacy/         versões antigas, só para consulta
build.mjs       junta src/ em dist/ (e confere a tag com --check-tag)
CHANGELOG.md    uma linha por versão; vira a nota da Release
```

Os fragmentos numerados de `src/` **não são módulos ES**: são pedaços de um mesmo escopo, e a ordem dos nomes importa. Foi uma escolha para dividir o código sem mudar nenhum comportamento. Funções novas sem dependência de DOM devem ir em `05-pure.js` para poderem ser testadas.

## Desenvolver

Requer Node 18+.

```bash
npm install        # só para os testes (jsdom)
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

O workflow roda `npm ci` + `npm run check`, confere que a tag bate com o `package.json` (`npm run check-tag`) e que o `dist/` commitado está atualizado, e anexa `pokebot.user.js` e `pokebot.user.js.sha256` à Release. Se algo falhar, nada é publicado: corrija, apague a tag (`git tag -d v6.6.0 && git push origin :refs/tags/v6.6.0`) e crie de novo.

### Trocar o auto-update para as Releases (só depois da primeira Release)

Hoje o `@updateURL` aponta para a branch `main`, e isso continua funcionando. Para passar a usar `releases/latest/download/pokebot.user.js`:

1. Publique a primeira Release pelo fluxo acima.
2. Em `build.mjs`, troque `UPDATE_CHANNEL` de `'main'` para `'release'`.
3. Publique **mais uma versão** assim: quem ainda usa a URL antiga recebe esse script pela `main` e migra sozinho para a URL nova.

Para ver o resultado antes: `POKEBOT_UPDATE_CHANNEL=release npm run build`.

## Limitações conhecidas

- Os testes usam um DOM falso baseado no do jogo (conferido em 20/11/2026). Se o jogo mudar ids/classes, o smoke test continua passando: confira o HUD no jogo depois de atualizações do Pokeidle.
- Mapa, captura e demais módulos não têm teste automatizado; foram só reorganizados, sem mudança de lógica.

**Migração em andamento (Fase 2):** automação nova ou migrada vai para `src/modules/` com o contrato `{ id, everyMs, tick(ctx), dispose?(ctx) }`. O módulo só usa o que vem em `ctx` (config, estado, leitores do DOM, storage), então é testável sem o resto. Para migrar um fragmento: mover a lógica para um módulo, registrá-lo em `89-runtime.js`, tirar o `setInterval` correspondente de `90-init.js` e apagar o fragmento antigo.
