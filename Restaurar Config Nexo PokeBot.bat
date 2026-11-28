@echo off
setlocal
chcp 65001 >nul 2>&1
title Nexo PokeBot - Restaurar Configuracao
set "BAT_FILE=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-Content -LiteralPath $env:BAT_FILE -Raw -Encoding UTF8; $idx = $c.LastIndexOf('#__PS_START__'); if ($idx -lt 0) { exit 1 }; Invoke-Expression $c.Substring($idx)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%

#__PS_START__
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host $msg -ForegroundColor Green }
function Write-Warn($msg) { Write-Host $msg -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host $msg -ForegroundColor Red }

Write-Host '==============================================================' -ForegroundColor DarkCyan
Write-Host '  Nexo PokeBot - Restaurar Configuracao das 4 Contas' -ForegroundColor White
Write-Host '==============================================================' -ForegroundColor DarkCyan
Write-Host ''

$dataDir = if ($env:NEXO_DATA_DIR -and $env:NEXO_DATA_DIR.Trim()) { $env:NEXO_DATA_DIR.Trim() } else { Join-Path $(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }) 'Nexo PokeBot' }
$cfgName = '.pokebot-headless-config.json'
Write-Info "Dados: $dataDir"

if (-not (Test-Path -LiteralPath $dataDir)) {
    Write-Err 'Pasta de dados do Nexo nao encontrada. Abra o Nexo PokeBot ao menos uma vez antes.'
    exit 1
}

# Caminho relativo da config de cada conta (1 = raiz, 2..4 = .pokebot-accounts\N)
$rels = @{}
$rels[1] = $cfgName
foreach ($n in 2..4) { $rels[$n] = Join-Path (Join-Path '.pokebot-accounts' "$n") $cfgName }

$backups = @(Get-ChildItem -LiteralPath $dataDir -Directory -Force -Filter '.pokebot-backup-*' -ErrorAction SilentlyContinue | Sort-Object Name)
$withCfg = @()
foreach ($b in $backups) {
    $found = @()
    foreach ($n in 1..4) {
        $p = Join-Path $b.FullName $rels[$n]
        if (Test-Path -LiteralPath $p) { $found += $n }
    }
    if ($found.Count -gt 0) { $withCfg += [pscustomobject]@{ Dir = $b; Accounts = $found } }
}

if ($withCfg.Count -eq 0) {
    Write-Warn 'Nenhum backup com configuracao foi encontrado.'
    Write-Host "Eles ficam em: $dataDir\.pokebot-backup-<data>"
    Write-Host 'Se o Recuperar Sessoes nunca substituiu a config, nao ha o que restaurar.'
    exit 0
}

Write-Info 'Backups com configuracao:'
for ($i = 0; $i -lt $withCfg.Count; $i++) {
    $e = $withCfg[$i]
    $when = $e.Dir.LastWriteTime.ToString('dd/MM/yyyy HH:mm')
    Write-Host ("  [{0}] {1}  (contas: {2})  {3}" -f ($i + 1), $e.Dir.Name, ($e.Accounts -join ', '), $when)
}
Write-Host ''
Write-Host 'O MAIS ANTIGO costuma ser o de antes do reset (os mais novos podem ja ter a config resetada).' -ForegroundColor DarkGray
$ans = Read-Host 'Numero do backup a restaurar (Enter = [1], o mais antigo)'
$idx = 0
if ($ans -and $ans.Trim() -match '^\d+$') { $idx = [int]$ans.Trim() - 1 }
if ($idx -lt 0 -or $idx -ge $withCfg.Count) { Write-Err 'Numero invalido.'; exit 1 }
$chosen = $withCfg[$idx]
Write-Host ''

# Mostra o que muda por conta
$plan = @()
foreach ($n in $chosen.Accounts) {
    $src = Join-Path $chosen.Dir.FullName $rels[$n]
    $dst = Join-Path $dataDir $rels[$n]
    try { $null = Get-Content -LiteralPath $src -Raw -Encoding UTF8 | ConvertFrom-Json } catch {
        Write-Warn "Conta ${n}: config do backup nao e um JSON valido, ignorada."
        continue
    }
    $same = $false
    if (Test-Path -LiteralPath $dst) {
        $same = ((Get-FileHash -LiteralPath $src).Hash -eq (Get-FileHash -LiteralPath $dst).Hash)
    }
    $si = Get-Item -LiteralPath $src
    if ($same) {
        Write-Host ("  Conta {0}: ja esta igual ao backup, nada a fazer." -f $n) -ForegroundColor DarkGray
    } else {
        $cur = if (Test-Path -LiteralPath $dst) { (Get-Item -LiteralPath $dst).Length.ToString() + ' bytes' } else { 'nao existe' }
        Write-Host ("  Conta {0}: atual {1}  ->  backup {2} bytes ({3})" -f $n, $cur, $si.Length, $si.LastWriteTime.ToString('dd/MM/yyyy HH:mm'))
        $plan += [pscustomobject]@{ Account = $n; Src = $src; Dst = $dst }
    }
}
if ($plan.Count -eq 0) { Write-Ok 'Nada para restaurar.'; exit 0 }

Write-Host ''
$ok = Read-Host ('Restaurar a config de {0} conta(s)? O Nexo sera fechado. (S/N)' -f $plan.Count)
if ($ok.Trim().ToUpper() -notin @('S', 'SIM', 'Y')) { Write-Warn 'Cancelado, nada foi alterado.'; exit 0 }

# Fecha o Nexo para ele nao regravar a config por cima (NEXO_RECOVERY_NO_KILL=1 pula, so para testes)
if ($env:NEXO_RECOVERY_NO_KILL -ne '1') {
foreach ($procName in @('Nexo PokeBot', 'PokeBot')) {
    $running = Get-Process -Name $procName -ErrorAction SilentlyContinue
    if ($running) {
        Write-Warn "Fechando $procName..."
        $running | ForEach-Object { if ($_.MainWindowHandle -ne 0) { $null = $_.CloseMainWindow() } }
        Start-Sleep -Milliseconds 1200
        Get-Process -Name $procName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
}
try {
    Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -match 'pokebot|src[\\/]electron[\\/]main\.mjs'
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}
}
Start-Sleep -Milliseconds 800

# Guarda a config de agora antes de trocar (da para desfazer)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$undoDir = Join-Path $dataDir ".pokebot-config-antes-restaurar-$stamp"
foreach ($p in $plan) {
    if (Test-Path -LiteralPath $p.Dst) {
        $u = Join-Path $undoDir $rels[$p.Account]
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $u) | Out-Null
        Copy-Item -LiteralPath $p.Dst -Destination $u -Force
    }
}
foreach ($p in $plan) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p.Dst) | Out-Null
    Copy-Item -LiteralPath $p.Src -Destination $p.Dst -Force
    Write-Ok "Conta $($p.Account): configuracao restaurada."
}

Write-Host ''
Write-Ok 'Pronto. Abra o Nexo PokeBot de novo.'
Write-Host "Se algo ficar errado, a config de antes esta em: $undoDir" -ForegroundColor DarkGray
exit 0
