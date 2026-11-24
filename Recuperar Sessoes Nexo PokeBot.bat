@echo off
setlocal
chcp 65001 >nul 2>&1
title Nexo PokeBot - Importar e Recuperar Sessoes
set "BAT_FILE=%~f0"
set "BAT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-Content -LiteralPath $env:BAT_FILE -Raw -Encoding UTF8; $idx = $c.LastIndexOf('#__PS_START__'); if ($idx -lt 0) { exit 1 }; Invoke-Expression $c.Substring($idx)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%

#__PS_START__
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue } catch {}

function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host $msg -ForegroundColor Green }
function Write-Warn($msg) { Write-Host $msg -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host $msg -ForegroundColor Red }

$targetDir = $env:BAT_DIR.TrimEnd('\', '/')
Write-Host '==============================================================' -ForegroundColor DarkCyan
Write-Host '  Nexo PokeBot - Importar / Recuperar Sessoes (4 Contas)' -ForegroundColor White
Write-Host '==============================================================' -ForegroundColor DarkCyan
Write-Host ''

function Test-IsNexoAppDir($dir) {
    return (Test-Path -LiteralPath (Join-Path $dir 'Nexo PokeBot.exe')) -or
           (Test-Path -LiteralPath (Join-Path $dir 'src\electron\main.mjs'))
}

if (-not (Test-IsNexoAppDir $targetDir)) {
    Write-Warn 'Este .bat nao esta dentro da pasta do Nexo PokeBot v1.0.'
    $appGuesses = @()
    $searchRoots = @(
        $targetDir,
        (Split-Path -Parent $targetDir),
        (Join-Path $env:USERPROFILE 'Desktop'),
        (Join-Path $env:USERPROFILE 'Downloads'),
        (Join-Path $env:USERPROFILE 'OneDrive\Desktop'),
        (Join-Path $env:USERPROFILE 'OneDrive\Downloads'),
        'C:\'
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

    foreach ($r in $searchRoots) {
        Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'nexo|pokebot' } | ForEach-Object {
            if (Test-IsNexoAppDir $_.FullName) { $appGuesses += $_.FullName }
            Get-ChildItem -LiteralPath $_.FullName -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'nexo|pokebot' } | ForEach-Object {
                if (Test-IsNexoAppDir $_.FullName) { $appGuesses += $_.FullName }
            }
        }
    }
    $appGuesses = @($appGuesses | Select-Object -Unique)
    if ($appGuesses.Count -ge 1) {
        Write-Info "Pasta do Nexo PokeBot v1.0 encontrada em: $($appGuesses[0])"
        $targetDir = $appGuesses[0]
    } else {
        $manualTarget = Read-Host 'Arraste aqui a pasta do Nexo PokeBot v1.0 (ou cole o caminho) e aperte Enter'
        $manualTarget = $manualTarget.Trim().Trim('"')
        if (-not $manualTarget -or -not (Test-Path -LiteralPath $manualTarget)) {
            Write-Err 'Pasta de destino invalida.'
            exit 1
        }
        $targetDir = $manualTarget
    }
}

Write-Info "Destino (Nexo PokeBot v1.0): $targetDir"
Write-Host ''

# 1. Fecha apps concorrentes para liberar bancos LevelDB e evitar desconexao mutua
Write-Info '[1/4] Verificando processos abertos...'
if ($env:NEXO_RECOVERY_NO_KILL -ne '1') {
    foreach ($procName in @('Nexo PokeBot', 'PokeBot', 'PokeIdleMulti', 'PokeGrid', 'IdleDeck')) {
        $running = Get-Process -Name $procName -ErrorAction SilentlyContinue
        if ($running) {
            Write-Warn "Fechando $procName..."
            $running | ForEach-Object { if ($_.MainWindowHandle -ne 0) { $null = $_.CloseMainWindow() } }
            Start-Sleep -Milliseconds 1200
            Get-Process -Name $procName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        }
    }
    try {
        Get-CimInstance Win32_Process -Filter "Name='electron.exe' OR Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -match 'pokebot|pokegrid|pokeidlemulti|idledeck|src[\\/]electron[\\/]main\.mjs'
        } | ForEach-Object {
            Write-Warn "Fechando processo auxiliar $($_.Name) (PID $($_.ProcessId))..."
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

$script:MasterKeyCache = @{}
function Get-ChromiumMasterKeyBase64($localStatePath) {
    if (-not $localStatePath -or -not (Test-Path -LiteralPath $localStatePath)) { return $null }
    if ($script:MasterKeyCache.ContainsKey($localStatePath)) { return $script:MasterKeyCache[$localStatePath] }
    $b64Out = $null
    try {
        $lsJson = Get-Content -LiteralPath $localStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $encB64 = $lsJson.os_crypt.encrypted_key
        if ($encB64) {
            $raw = [Convert]::FromBase64String([string]$encB64)
            if ($raw.Length -gt 5 -and [System.Text.Encoding]::ASCII.GetString($raw, 0, 5) -eq 'DPAPI') {
                $dpapi = New-Object byte[] ($raw.Length - 5)
                [Array]::Copy($raw, 5, $dpapi, 0, $dpapi.Length)
                $plainKey = [System.Security.Cryptography.ProtectedData]::Unprotect($dpapi, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
                if ($plainKey -and $plainKey.Length -ge 16) {
                    $b64Out = [Convert]::ToBase64String($plainKey)
                }
            }
        }
    } catch {}
    $script:MasterKeyCache[$localStatePath] = $b64Out
    return $b64Out
}

function Find-LocalStateForProfile($profileDir) {
    $cur = $profileDir
    for ($depth = 0; $depth -lt 4 -and $cur; $depth++) {
        $cand = Join-Path $cur 'Local State'
        if (Test-Path -LiteralPath $cand) { return $cand }
        $cur = Split-Path -Parent $cur
    }
    return $null
}

function Resolve-ProfileCookiesDb($profileDir) {
    $p1 = Join-Path $profileDir 'Network\Cookies'
    if (Test-Path -LiteralPath $p1) { return $p1 }
    $p2 = Join-Path $profileDir 'Cookies'
    if (Test-Path -LiteralPath $p2) { return $p2 }
    return $null
}

# Localiza motor Node embutido (Nexo PokeBot.exe com ELECTRON_RUN_AS_NODE=1) para extrair LevelDB sem exigir Node instalado
function Resolve-NodeRuntime($appDir) {
    $cands = @(
        @{ Exe = (Join-Path $appDir 'node_modules\electron\dist\Nexo PokeBot.exe'); AsNode = $true },
        @{ Exe = (Join-Path $appDir 'node_modules\electron\dist\electron.exe'); AsNode = $true }
    )
    foreach ($c in $cands) {
        if (Test-Path -LiteralPath $c.Exe) { return $c }
    }
    $sysNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($sysNode) { return @{ Exe = $sysNode.Source; AsNode = $false } }
    return $null
}

function Invoke-LevelDbExtractor($appDir, $mode, $payloadObj) {
    $rt = Resolve-NodeRuntime $appDir
    $extractorPath = Join-Path $appDir 'src\headless\session-extractor.mjs'
    if (-not $rt -or -not (Test-Path -LiteralPath $extractorPath)) { return $null }

    $tmpDir = Join-Path $env:TEMP ('nexo-imp-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    $scriptPath = Join-Path $tmpDir 'run.mjs'
    $inputPath = Join-Path $tmpDir 'in.json'
    $outputPath = Join-Path $tmpDir 'out.json'

    $js = @'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createDecipheriv, createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch {}

const [extractorPath, mode, inputPath, outputPath] = process.argv.slice(2);
const mod = await import(pathToFileURL(resolve(extractorPath)).href);
const payload = JSON.parse(readFileSync(inputPath, 'utf8'));

function normalizeUrlCookie(raw) {
    const clean = String(raw || '').trim();
    if (!clean) return '';
    if (!clean.includes('%')) return clean;
    try { return decodeURIComponent(clean); } catch { return clean; }
}

function decryptChromiumCookie(buf, hostKey, metaVer, masterKey) {
    if (!buf || buf.length < 31 || !masterKey) return '';
    const prefix = buf.subarray(0, 3).toString('ascii');
    if (prefix !== 'v10' && prefix !== 'v11') return '';
    const iv = buf.subarray(3, 15);
    const ct = buf.subarray(15, buf.length - 16);
    const tag = buf.subarray(buf.length - 16);
    const dec = createDecipheriv('aes-256-gcm', masterKey, iv);
    dec.setAuthTag(tag);
    const plain = Buffer.concat([dec.update(ct), dec.final()]);
    let valBuf = plain;
    if (plain.length >= 32) {
        const domainHash = createHash('sha256').update(String(hostKey || '')).digest();
        if (plain.subarray(0, 32).equals(domainHash) || metaVer >= 24) {
            valBuf = plain.subarray(32);
        }
    }
    const text = valBuf.toString('utf8').trim();
    return /^[\x20-\x7E]+$/.test(text) ? text : '';
}

function extractLiveCookies(cookiesDbPath, masterKeyB64, tmpRoot, idx) {
    const out = { twitchToken: '', twitchDeviceId: '', kickToken: '' };
    if (!DatabaseSync || !cookiesDbPath || !existsSync(cookiesDbPath)) return out;
    const masterKey = masterKeyB64 ? Buffer.from(masterKeyB64, 'base64') : null;
    const copyDir = join(tmpRoot, `ck-${idx}`);
    let db = null;
    try {
        mkdirSync(copyDir, { recursive: true });
        for (const suffix of ['', '-wal', '-shm']) {
            const src = cookiesDbPath + suffix;
            if (existsSync(src)) cpSync(src, join(copyDir, 'Cookies' + suffix));
        }
        db = new DatabaseSync(join(copyDir, 'Cookies'), { readOnly: true });
        let metaVer = 0;
        try {
            const m = db.prepare("SELECT value FROM meta WHERE key='version'").get();
            metaVer = Number(m?.value || 0);
        } catch {}
        const rows = db.prepare(
            "SELECT host_key, name, value, encrypted_value, CAST(expires_utc AS TEXT) AS expires_utc " +
            "FROM cookies " +
            "WHERE (host_key LIKE '%twitch.tv%' AND name IN ('auth-token', 'unique_id')) " +
            "   OR (host_key LIKE '%kick.com%' AND name = 'session_token') " +
            "ORDER BY last_update_utc DESC"
        ).all();
        const nowChromeUtc = BigInt(Date.now() + 11644473600000) * 1000n;
        const pick = (pred) => {
            let fallback = '';
            for (const r of rows) {
                if (!pred(r)) continue;
                let val = String(r.value || '').trim();
                if (!val && r.encrypted_value && masterKey) {
                    try { val = decryptChromiumCookie(Buffer.from(r.encrypted_value), r.host_key, metaVer, masterKey); } catch {}
                }
                if (!val) continue;
                let expBig = 0n;
                try { expBig = BigInt(r.expires_utc || '0'); } catch {}
                if (expBig === 0n || expBig > nowChromeUtc) return val;
                if (!fallback) fallback = val;
            }
            return fallback;
        };
        out.twitchToken = pick((r) => String(r.host_key).includes('twitch.tv') && r.name === 'auth-token');
        out.twitchDeviceId = pick((r) => String(r.host_key).includes('twitch.tv') && r.name === 'unique_id');
        out.kickToken = normalizeUrlCookie(pick((r) => String(r.host_key).includes('kick.com') && r.name === 'session_token'));
    } catch {} finally {
        try { db?.close(); } catch {}
        rmSync(copyDir, { recursive: true, force: true });
    }
    return out;
}

function extractSafe(levelDbDir, tmpRoot, idx) {
    let found = null;
    try { found = mod.extractSessionFromLevelDbDir(levelDbDir); } catch {}
    if (found?.nick && found?.token) return found;
    const copyDir = join(tmpRoot, `ldb-${idx}`);
    try {
        mkdirSync(copyDir, { recursive: true });
        cpSync(levelDbDir, copyDir, {
            recursive: true,
            filter: (p) => !/[\\/](LOCK|LOG|LOG\.old)$/i.test(p),
        });
        found = mod.extractSessionFromLevelDbDir(copyDir);
    } catch {} finally {
        rmSync(copyDir, { recursive: true, force: true });
    }
    return found;
}

if (mode === 'scan') {
    const now = Date.now();
    const results = [];
    for (let i = 0; i < (payload.slots || []).length; i++) {
        const slot = payload.slots[i];
        const found = extractSafe(slot.levelDb, payload.tmpDir, i);
        const live = extractLiveCookies(slot.cookiesDb, slot.masterKeyB64, payload.tmpDir, i);
        if (!found?.nick || !found?.token) continue;
        const exp = Number(found.payload?.exp || 0);
        const expired = exp > 0 && exp <= now + 60_000;
        results.push({
            slotIndex: slot.slotIndex,
            label: slot.label,
            levelDb: slot.levelDb,
            nick: found.nick,
            token: found.token,
            provedor: found.provedor || found.payload?.provedor || 'google',
            dispositivo: found.dispositivo || null,
            exp: exp || null,
            expired,
            twitchToken: live.twitchToken || '',
            twitchDeviceId: live.twitchDeviceId || '',
            kickToken: live.kickToken || '',
        });
    }
    writeFileSync(outputPath, JSON.stringify({ ok: true, results }), 'utf8');
} else if (mode === 'apply') {
    const targetDir = resolve(payload.targetDir);
    const saved = [];
    const accounts = (payload.accounts || []).slice(0, 4);
    for (let i = 0; i < accounts.length; i++) {
        const accNum = i + 1;
        const item = accounts[i];
        const accDir = accNum === 1 ? targetDir : join(targetDir, '.pokebot-accounts', String(accNum));
        mkdirSync(accDir, { recursive: true });
        const cachePath = join(accDir, '.pokebot-session.json');
        mod.saveSessionCache(cachePath, {
            nick: item.nick,
            token: item.token,
            provedor: item.provedor || 'google',
            dispositivo: item.dispositivo || null,
        });
        const hasLivePatch = Boolean(item.twitchToken || item.twitchDeviceId || item.kickToken);
        if (accNum === 1 || hasLivePatch) {
            const cfgPath = join(accDir, '.pokebot-headless-config.json');
            let cfg = {};
            if (existsSync(cfgPath)) {
                try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) || {}; } catch {}
            }
            if (accNum === 1) cfg.browserProfile = 'isolated';
            if (item.twitchToken) cfg.liveTwitchToken = item.twitchToken;
            if (item.twitchDeviceId) cfg.liveTwitchDeviceId = item.twitchDeviceId;
            if (item.kickToken) cfg.liveKickToken = item.kickToken;
            writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
        }
        saved.push({
            account: accNum,
            nick: item.nick,
            path: cachePath,
            hasTwitch: Boolean(item.twitchToken),
            hasKick: Boolean(item.kickToken),
        });
    }
    writeFileSync(outputPath, JSON.stringify({ ok: true, saved }), 'utf8');
}
'@
    try {
        [System.IO.File]::WriteAllText($scriptPath, $js, (New-Object System.Text.UTF8Encoding($false)))
        $payloadObj | Add-Member -NotePropertyName tmpDir -NotePropertyValue $tmpDir -Force
        [System.IO.File]::WriteAllText($inputPath, ($payloadObj | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $rt.Exe
        $psi.Arguments = "`"$scriptPath`" `"$extractorPath`" `"$mode`" `"$inputPath`" `"$outputPath`""
        $psi.WorkingDirectory = $appDir
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        if ($rt.AsNode) { $psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1' }
        $proc = [System.Diagnostics.Process]::Start($psi)
        $null = $proc.StandardOutput.ReadToEnd()
        $null = $proc.StandardError.ReadToEnd()
        $proc.WaitForExit()
        if ($proc.ExitCode -eq 0 -and (Test-Path -LiteralPath $outputPath)) {
            return (Get-Content -LiteralPath $outputPath -Raw -Encoding UTF8 | ConvertFrom-Json)
        }
        return $null
    } finally {
        Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 2. Procura fontes de sessoes: outros apps (PokeIdleMulti, IdleDeck, PokeGrid) + pastas antigas + Lixeira
Write-Info '[2/4] Procurando contas logadas (PokeIdleMulti, outros decks, pastas antigas e Lixeira)...'

$candidates = @()

function Scan-ExternalAppSlots($appName, $basePath, $slotList) {
    if (-not $slotList -or $slotList.Count -eq 0) { return $null }
    $scanRes = Invoke-LevelDbExtractor $targetDir 'scan' ([PSCustomObject]@{ slots = @($slotList) })
    if (-not $scanRes -or -not $scanRes.ok -or -not $scanRes.results) { return $null }

    $valid = @($scanRes.results | Where-Object { -not $_.expired })
    $pool = if ($valid.Count -gt 0) { $valid } else { @($scanRes.results) }
    $byNick = @{}
    foreach ($r in ($pool | Sort-Object -Property slotIndex)) {
        $k = $r.nick.ToLowerInvariant()
        if (-not $byNick.ContainsKey($k)) {
            $byNick[$k] = $r
        } else {
            $cur = $byNick[$k]
            if ([int64]($r.exp) -gt [int64]($cur.exp)) {
                if (-not $r.twitchToken -and $cur.twitchToken) { $r.twitchToken = $cur.twitchToken }
                if (-not $r.twitchDeviceId -and $cur.twitchDeviceId) { $r.twitchDeviceId = $cur.twitchDeviceId }
                if (-not $r.kickToken -and $cur.kickToken) { $r.kickToken = $cur.kickToken }
                $byNick[$k] = $r
            } else {
                if (-not $cur.twitchToken -and $r.twitchToken) { $cur.twitchToken = $r.twitchToken }
                if (-not $cur.twitchDeviceId -and $r.twitchDeviceId) { $cur.twitchDeviceId = $r.twitchDeviceId }
                if (-not $cur.kickToken -and $r.kickToken) { $cur.kickToken = $r.kickToken }
            }
        }
    }
    $accounts = @($byNick.Values | Sort-Object -Property slotIndex | Select-Object -First 4)
    if ($accounts.Count -eq 0) { return $null }

    $nickSummary = ($accounts | ForEach-Object -Begin { $n = 0 } -Process { $n++; "C$($n):$($_.nick)" }) -join ', '
    $twitchCount = @($accounts | Where-Object { $_.twitchToken }).Count
    $kickCount = @($accounts | Where-Object { $_.kickToken }).Count
    $liveCount = @($accounts | Where-Object { $_.twitchToken -or $_.kickToken }).Count
    $latest = [DateTime]::MinValue
    foreach ($a in $accounts) {
        try {
            $t = (Get-Item -LiteralPath $a.levelDb -Force).LastWriteTime
            if ($t -gt $latest) { $latest = $t }
        } catch {}
    }
    return [PSCustomObject]@{
        Kind        = 'external-leveldb'
        AppName     = $appName
        Path        = $basePath
        DisplayPath = "[$appName] $basePath"
        Nicks       = $nickSummary
        Accounts    = $accounts
        TwitchCount = $twitchCount
        KickCount   = $kickCount
        LiveCount   = $liveCount
        HasHub      = $false
        LastWrite   = $latest
        Score       = ($accounts.Count * 15) + ($twitchCount * 4) + ($kickCount * 4) + $(if ($valid.Count -gt 0) { 20 } else { 0 })
    }
}

function New-ExternalSlot($slotIndex, $label, $profileDir, $levelDb, $localStateOverride) {
    $lsPath = if ($localStateOverride -and (Test-Path -LiteralPath $localStateOverride)) { $localStateOverride } else { Find-LocalStateForProfile $profileDir }
    return [PSCustomObject]@{
        slotIndex    = $slotIndex
        label        = $label
        levelDb      = $levelDb
        cookiesDb    = (Resolve-ProfileCookiesDb $profileDir)
        masterKeyB64 = (Get-ChromiumMasterKeyBase64 $lsPath)
    }
}

# A1) PokeIdleMulti (%LOCALAPPDATA%\PokeIdleMulti\WebView2\EBWebView\WV2Profile_*)
$multiRoot = if ($env:NEXO_POKEIDLEMULTI_DIR) { $env:NEXO_POKEIDLEMULTI_DIR } else { Join-Path $env:LOCALAPPDATA 'PokeIdleMulti' }
$multiEb = Join-Path $multiRoot 'WebView2\EBWebView'
if (Test-Path -LiteralPath $multiEb) {
    $multiLs = Join-Path $multiEb 'Local State'
    $multiSlots = @()
    $wvDirs = Get-ChildItem -LiteralPath $multiEb -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'WV2Profile_*' } | Sort-Object {
        if ($_.Name -match '(\d+)$') { [int]$Matches[1] } else { 99 }
    }, Name
    $idx = 0
    foreach ($d in $wvDirs) {
        $ldb = Join-Path $d.FullName 'Local Storage\leveldb'
        if (Test-Path -LiteralPath $ldb) {
            $idx++
            $multiSlots += New-ExternalSlot $idx $d.Name $d.FullName $ldb $multiLs
        }
    }
    $multiCand = Scan-ExternalAppSlots 'PokeIdleMulti' $multiRoot $multiSlots
    if ($multiCand) { $candidates += $multiCand }
}

# A2) IdleDeck (Microsoft Store: %LOCALAPPDATA%\Packages\MacedoTI.IdleDeck_*)
$pkgBase = Join-Path $env:LOCALAPPDATA 'Packages'
if (Test-Path -LiteralPath $pkgBase) {
    Get-ChildItem -LiteralPath $pkgBase -Directory -Filter 'MacedoTI.IdleDeck_*' -ErrorAction SilentlyContinue | ForEach-Object {
        $deckData = Join-Path $_.FullName 'LocalCache\Roaming\IdleDeck'
        $deckLs = Join-Path $deckData 'Local State'
        $partDir = Join-Path $deckData 'Partitions'
        if (Test-Path -LiteralPath $partDir) {
            $deckSlots = @()
            $idx = 0
            Get-ChildItem -LiteralPath $partDir -Directory -Force -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object {
                $ldb = Join-Path $_.FullName 'Local Storage\leveldb'
                if (Test-Path -LiteralPath $ldb) {
                    $idx++
                    $deckSlots += New-ExternalSlot $idx $_.Name $_.FullName $ldb $deckLs
                }
            }
            $deckCand = Scan-ExternalAppSlots 'IdleDeck' $deckData $deckSlots
            if ($deckCand) { $candidates += $deckCand }
        }
    }
}

# A3) PokeGrid (%APPDATA%\PokeGrid\Partitions\*)
foreach ($pgName in @('PokeGrid', 'pokegrid')) {
    $pgRoot = Join-Path $env:APPDATA $pgName
    $pgLs = Join-Path $pgRoot 'Local State'
    $pgPart = Join-Path $pgRoot 'Partitions'
    if (Test-Path -LiteralPath $pgPart) {
        $pgSlots = @()
        $idx = 0
        Get-ChildItem -LiteralPath $pgPart -Directory -Force -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object {
            $ldb = Join-Path $_.FullName 'Local Storage\leveldb'
            if (Test-Path -LiteralPath $ldb) {
                $idx++
                $pgSlots += New-ExternalSlot $idx $_.Name $_.FullName $ldb $pgLs
            }
        }
        $pgCand = Scan-ExternalAppSlots 'PokeGrid' $pgRoot $pgSlots
        if ($pgCand) { $candidates += $pgCand }
    }
}

# --- B) Pastas antigas do PokeBot (disco + Lixeira $Recycle.Bin) ---
$sessionMarkers = @(
    '.pokebot-session.json',
    '.pokebot-headless-config.json',
    '.pokebot-accounts',
    '.pokebot-hub-data',
    '.pokebot-browser-profile',
    '.pokebot-live-profile'
)

function Inspect-PokeBotDataDir($dirPath) {
    $normDir = $dirPath.TrimEnd('\', '/')
    if ($normDir.Equals($targetDir.TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
    $foundItems = @()
    $latestTime = [DateTime]::MinValue
    foreach ($m in $sessionMarkers) {
        $full = Join-Path $normDir $m
        if (Test-Path -LiteralPath $full) {
            $item = Get-Item -LiteralPath $full -Force -ErrorAction SilentlyContinue
            if ($item) {
                $foundItems += $m
                if ($item.LastWriteTime -gt $latestTime) { $latestTime = $item.LastWriteTime }
            }
        }
    }
    if ($foundItems.Count -eq 0) { return $null }

    $nicks = @()
    $liveCount = 0
    $sess1 = Join-Path $normDir '.pokebot-session.json'
    if (Test-Path -LiteralPath $sess1) {
        try {
            $s = Get-Content -LiteralPath $sess1 -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($s.nick) { $nicks += "C1:$($s.nick)" }
        } catch {}
    }
    $cfg1 = Join-Path $normDir '.pokebot-headless-config.json'
    if (Test-Path -LiteralPath $cfg1) {
        try {
            $c = Get-Content -LiteralPath $cfg1 -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($c.liveTwitchToken -or $c.liveKickToken) { $liveCount++ }
        } catch {}
    }
    foreach ($acc in 2..4) {
        $accDir = Join-Path $normDir ".pokebot-accounts\$acc"
        if (Test-Path -LiteralPath (Join-Path $accDir '.pokebot-session.json')) {
            try {
                $s = Get-Content -LiteralPath (Join-Path $accDir '.pokebot-session.json') -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($s.nick) { $nicks += "C$($acc):$($s.nick)" }
            } catch {}
        }
        if (Test-Path -LiteralPath (Join-Path $accDir '.pokebot-headless-config.json')) {
            try {
                $c = Get-Content -LiteralPath (Join-Path $accDir '.pokebot-headless-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($c.liveTwitchToken -or $c.liveKickToken) { $liveCount++ }
            } catch {}
        }
    }
    $hasHub = Test-Path -LiteralPath (Join-Path $normDir '.pokebot-hub-data\Partitions')
    $score = ($nicks.Count * 10) + ($liveCount * 5) + $(if ($hasHub) { 8 } else { 0 }) + $foundItems.Count
    return [PSCustomObject]@{
        Kind        = 'pokebot-folder'
        Path        = $normDir
        DisplayPath = $normDir
        Items       = $foundItems
        Nicks       = ($nicks -join ', ')
        LiveCount   = $liveCount
        HasHub      = $hasHub
        LastWrite   = $latestTime
        Score       = $score
    }
}

$candidateRoots = New-Object System.Collections.Generic.List[string]
foreach ($base in @(
    (Split-Path -Parent $targetDir),
    (Join-Path $env:USERPROFILE 'Desktop'),
    (Join-Path $env:USERPROFILE 'Downloads'),
    (Join-Path $env:USERPROFILE 'Documents'),
    (Join-Path $env:USERPROFILE 'OneDrive\Desktop'),
    (Join-Path $env:USERPROFILE 'OneDrive\Downloads'),
    (Join-Path $env:USERPROFILE 'OneDrive\Documentos'),
    (Join-Path $env:USERPROFILE 'OneDrive\Documents'),
    $env:OneDrive,
    'C:\',
    'D:\'
)) {
    if ($base -and (Test-Path -LiteralPath $base)) { $candidateRoots.Add($base) }
}

$dirsToCheck = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
foreach ($root in ($candidateRoots | Select-Object -Unique)) {
    [void]$dirsToCheck.Add($root)
    Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Name -match 'pokebot|pokeidle|nexo|farm|hub') {
            [void]$dirsToCheck.Add($_.FullName)
            Get-ChildItem -LiteralPath $_.FullName -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.Name -notmatch '^node_modules$|^\.git$|^\.pokebot-') { [void]$dirsToCheck.Add($_.FullName) }
            }
        }
    }
}
foreach ($d in $dirsToCheck) {
    $info = Inspect-PokeBotDataDir $d
    if ($info) { $candidates += $info }
}

function Read-RecycleOriginalPath($iFilePath) {
    try {
        $bytes = [System.IO.File]::ReadAllBytes($iFilePath)
        if ($bytes.Length -lt 28) { return $null }
        $ver = [BitConverter]::ToInt64($bytes, 0)
        $offset = if ($ver -ge 2) { 28 } else { 24 }
        if ($bytes.Length -le $offset) { return $null }
        return ([System.Text.Encoding]::Unicode.GetString($bytes, $offset, $bytes.Length - $offset)).TrimEnd([char]0)
    } catch { return $null }
}

try {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $drives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.Root -match '^[A-Z]:\\$' }
    foreach ($drv in $drives) {
        $binDir = Join-Path (Join-Path $drv.Root '$Recycle.Bin') $sid
        if (-not (Test-Path -LiteralPath $binDir)) { continue }
        Get-ChildItem -LiteralPath $binDir -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '$R*' -and $_.PSIsContainer } | ForEach-Object {
            $rItem = $_
            $iFile = Join-Path $binDir ('$I' + $rItem.Name.Substring(2))
            $origPath = if (Test-Path -LiteralPath $iFile) { Read-RecycleOriginalPath $iFile } else { $rItem.FullName }
            $info = Inspect-PokeBotDataDir $rItem.FullName
            if ($info) {
                $info.DisplayPath = '[LIXEIRA] ' + $origPath
                $candidates += $info
            } else {
                Get-ChildItem -LiteralPath $rItem.FullName -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'pokebot|pokeidle|nexo|hub' } | ForEach-Object {
                    $subInfo = Inspect-PokeBotDataDir $_.FullName
                    if ($subInfo) {
                        $subInfo.DisplayPath = '[LIXEIRA] ' + (Join-Path $origPath $_.Name)
                        $candidates += $subInfo
                    }
                }
            }
        }
    }
} catch {}

$candidates = @($candidates | Sort-Object -Property @{Expression='Score';Descending=$true}, @{Expression='LastWrite';Descending=$true})

$selected = $null
if ($candidates.Count -gt 0) {
    Write-Ok "Encontrada(s) $($candidates.Count) origem(ns) com contas salvas:"
    Write-Host ''
    for ($i = 0; $i -lt $candidates.Count; $i++) {
        $c = $candidates[$i]
        $nickText = if ($c.Nicks) { $c.Nicks } else { 'dados do navegador embutido' }
        Write-Host ("  [{0}] {1}" -f ($i + 1), $c.DisplayPath) -ForegroundColor White
        if ($c.Kind -eq 'external-leveldb') {
            Write-Host ("      Importacao direta ({0}) | Contas: {1} | Twitch: {2} | Kick: {3} | Atualizado: {4}" -f $c.AppName, $nickText, $c.TwitchCount, $c.KickCount, $c.LastWrite.ToString('dd/MM/yyyy HH:mm')) -ForegroundColor Gray
        } else {
            Write-Host ("      Contas: {0} | Lives: {1} | Embutido: {2} | Atualizado: {3}" -f $nickText, $c.LiveCount, $(if ($c.HasHub) { 'Sim' } else { 'Nao' }), $c.LastWrite.ToString('dd/MM/yyyy HH:mm')) -ForegroundColor Gray
        }
    }
    Write-Host ''
    $pick = Read-Host 'Digite o numero da origem [Enter = 1] ou arraste/cole outra pasta'
    $pick = $pick.Trim().Trim('"')
    if (-not $pick) {
        $selected = $candidates[0]
    } elseif ($pick -match '^\d+$' -and [int]$pick -ge 1 -and [int]$pick -le $candidates.Count) {
        $selected = $candidates[[int]$pick - 1]
    } elseif (Test-Path -LiteralPath $pick) {
        $selected = Inspect-PokeBotDataDir $pick
        if (-not $selected) {
            $manualSlots = @()
            $idx = 0
            Get-ChildItem -LiteralPath $pick -Recurse -Directory -Depth 4 -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'leveldb' -and $_.Parent.Name -eq 'Local Storage' } | Sort-Object FullName | ForEach-Object {
                $idx++
                $profDir = $_.Parent.Parent.FullName
                $manualSlots += New-ExternalSlot $idx $_.Parent.Parent.Name $profDir $_.FullName $null
            }
            $selected = Scan-ExternalAppSlots 'Pasta personalizada' $pick $manualSlots
        }
    }
} else {
    Write-Warn 'Nenhuma origem de sessao encontrada automaticamente (PokeIdleMulti, IdleDeck, PokeGrid, pastas antigas ou Lixeira).'
    $manual = Read-Host 'Arraste aqui a pasta de dados de outro app/perfil e aperte Enter (ou Enter para sair)'
    $manual = $manual.Trim().Trim('"')
    if ($manual -and (Test-Path -LiteralPath $manual)) {
        $selected = Inspect-PokeBotDataDir $manual
        if (-not $selected) {
            $manualSlots = @()
            $idx = 0
            Get-ChildItem -LiteralPath $manual -Recurse -Directory -Depth 4 -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'leveldb' -and $_.Parent.Name -eq 'Local Storage' } | Sort-Object FullName | ForEach-Object {
                $idx++
                $profDir = $_.Parent.Parent.FullName
                $manualSlots += New-ExternalSlot $idx $_.Parent.Parent.Name $profDir $_.FullName $null
            }
            $selected = Scan-ExternalAppSlots 'Pasta personalizada' $manual $manualSlots
        }
    }
}

if (-not $selected) {
    Write-Err 'Nenhuma sessao valida encontrada na origem escolhida.'
    exit 1
}

# 3. Aplica importacao ou copia das sessoes
Write-Host ''
Write-Info "[3/4] Importando sessoes de: $($selected.DisplayPath)"

if ($selected.Kind -eq 'external-leveldb') {
    $applyRes = Invoke-LevelDbExtractor $targetDir 'apply' ([PSCustomObject]@{
        targetDir = $targetDir
        accounts  = @($selected.Accounts)
    })
    if (-not $applyRes -or -not $applyRes.ok) {
        Write-Err 'Falha ao gravar sessoes importadas.'
        exit 1
    }
    $twOk = 0
    $kkOk = 0
    foreach ($s in $applyRes.saved) {
        $tags = @('PokeIdle')
        if ($s.hasTwitch) { $tags += 'Twitch'; $twOk++ }
        if ($s.hasKick)   { $tags += 'Kick'; $kkOk++ }
        Write-Ok ("  + Conta {0} importada: {1} [{2}]" -f $s.account, $s.nick, ($tags -join ' + '))
    }
    Write-Host ''
    Write-Ok ("[4/4] Importacao concluida! Contas: {0} | Twitch: {1} | Kick: {2}" -f $applyRes.saved.Count, $twOk, $kkOk)
    Write-Info '  Ao abrir o Nexo PokeBot, o modo Headless, o jogo embutido e as lives importadas ja entram conectados.'
    if ($twOk -lt $applyRes.saved.Count -or $kkOk -lt $applyRes.saved.Count) {
        Write-Warn '  Obs.: contas sem Twitch ou Kick acima nao tinham login salvo na origem; conecte na aba Conexoes se precisar.'
    }
} else {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupDir = Join-Path $targetDir ".pokebot-backup-$stamp"
    $backedUp = $false
    foreach ($m in $selected.Items) {
        $srcPath = Join-Path $selected.Path $m
        $dstPath = Join-Path $targetDir $m
        if (Test-Path -LiteralPath $dstPath) {
            if (-not $backedUp) {
                New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
                $backedUp = $true
            }
            Move-Item -LiteralPath $dstPath -Destination (Join-Path $backupDir $m) -Force
        }
        if ((Get-Item -LiteralPath $srcPath -Force).PSIsContainer) {
            $null = robocopy $srcPath $dstPath /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NC /NS /XF "LOCK" "SingletonLock" "SingletonCookie" "SingletonSocket" "DevToolsActivePort" "lockfile"
            if ($LASTEXITCODE -ge 8) {
                Write-Err "Falha ao copiar pasta $m (robocopy exit $LASTEXITCODE)."
                exit 1
            }
            Write-Ok "  + Pasta recuperada: $m"
        } else {
            Copy-Item -LiteralPath $srcPath -Destination $dstPath -Force
            Write-Ok "  + Arquivo recuperado: $m"
        }
    }
    if ($backedUp) { Write-Host "  (Backup anterior salvo em: $backupDir)" -ForegroundColor DarkGray }
    Write-Host ''
    Write-Ok '[4/4] Sessoes recuperadas com sucesso!'
    if ($selected.Nicks) { Write-Ok "  Contas detectadas: $($selected.Nicks)" }
    if ($selected.LiveCount -gt 0) { Write-Ok "  Contas com Twitch/Kick conectadas: $($selected.LiveCount)" }
    if ($selected.HasHub) { Write-Ok '  Perfis do navegador embutido (Contas 1 a 4): restaurados' }
}

Write-Host ''
$exePath = Join-Path $targetDir 'Nexo PokeBot.exe'
$batLaunch = Join-Path $targetDir 'Abrir Nexo PokeBot.bat'
if (Test-Path -LiteralPath $exePath) {
    $openNow = Read-Host 'Abrir o Nexo PokeBot agora? [S/n]'
    if (-not $openNow -or $openNow -match '^[sSyY]') {
        Start-Process -FilePath $exePath -WorkingDirectory $targetDir
    }
} elseif (Test-Path -LiteralPath $batLaunch) {
    $openNow = Read-Host 'Abrir o Nexo PokeBot agora? [S/n]'
    if (-not $openNow -or $openNow -match '^[sSyY]') {
        Start-Process -FilePath $batLaunch -WorkingDirectory $targetDir
    }
}
