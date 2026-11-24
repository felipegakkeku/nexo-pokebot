@echo off
title Nexo PokeBot Eco (1 Processo · 4 Contas Headless + /hunt)
cd /d "%~dp0"
echo Iniciando Nexo PokeBot Eco em 1 unico processo Node (sem Electron/Chromium)...
echo.
node src/headless/multi-daemon.mjs
if errorlevel 1 (
  echo.
  echo Falha ao iniciar Nexo PokeBot Eco. Verifique se Node.js esta instalado.
  pause
)
