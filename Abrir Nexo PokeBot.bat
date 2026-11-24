@echo off
cd /d "%~dp0"
if exist "node_modules\electron\dist\Nexo PokeBot.exe" (
  start "" "node_modules\electron\dist\Nexo PokeBot.exe" "src\electron\main.mjs"
  exit /b 0
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Instalando dependencias do Nexo PokeBot...
  call npm.cmd ci
  if errorlevel 1 (
    echo Nao foi possivel instalar o Nexo PokeBot. Confira se o Node.js 24 LTS esta instalado.
    pause
    exit /b 1
  )
)
call npm.cmd run brand:runtime
if exist "node_modules\electron\dist\Nexo PokeBot.exe" (
  start "" "node_modules\electron\dist\Nexo PokeBot.exe" "src\electron\main.mjs"
  exit /b 0
)
start "" "node_modules\electron\dist\electron.exe" "src\electron\main.mjs"
