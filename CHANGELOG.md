# Changelog

Uma linha por versão. Ao publicar, mova o conteúdo de "Unreleased" para a nova versão (o workflow usa o texto da seção como nota da Release).

## 6.6.0

- Auto-Evoluir só confirma quando os requisitos (nível e pedra) estão ✓; desligado por padrão e sem trava de HP (Fase 0).
- Fase 2: todas as automações viraram módulos ES em `src/modules/` (agendador central, contrato de módulo, funções puras e `selectors.js`), com ESLint e 200+ testes; o `dist` agora é empacotado com esbuild. Comportamento mantido; os períodos passam a rodar no laço do agendador (100 ms de resolução).

## 6.5.0

- Projeto reorganizado em `src/` com build e testes; ficha copiada pelo botão nativo "Copiar p/ ChatGPT"; fila /hunt manual sem reload.

## 6.4.0

- Fila /hunt manual, copiar ficha para o Hub, auto-evoluir com trava de HP e aba Geral mais limpa.

## 6.3.0

- Versão base anterior ao projeto (arquivo único, hoje em `legacy/pokebot-v6.3.js`).
