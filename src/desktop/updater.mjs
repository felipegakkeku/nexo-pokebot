// Auto-updater de Releases do GitHub para o Nexo PokeBot (preserva 100% das sessoes .pokebot-*).
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_APP_ROOT = resolve(HERE, '..', '..');
export const DEFAULT_UPDATE_REPO = 'felipegakkeku/nexo-pokebot';

/**
 * Normaliza versao semver (ex: "v1.2.0" -> { major: 1, minor: 2, patch: 0, prerelease: '' }).
 * @param {string} raw Texto da versao ou tag.
 * @returns {{ major: number, minor: number, patch: number, prerelease: string, raw: string }}
 */
export function parseSemver(raw) {
    const clean = String(raw || '').trim().replace(/^v/i, '');
    const [core, ...preParts] = clean.split('-');
    const [maj = '0', min = '0', pat = '0'] = core.split('.');
    return {
        major: Number.parseInt(maj, 10) || 0,
        minor: Number.parseInt(min, 10) || 0,
        patch: Number.parseInt(pat, 10) || 0,
        prerelease: preParts.join('-').trim(),
        raw: clean,
    };
}

/**
 * Compara duas versoes semver. Retorna >0 se a > b, <0 se a < b, 0 se iguais.
 * @param {string} a Versao A.
 * @param {string} b Versao B.
 * @returns {number}
 */
export function compareSemver(a, b) {
    const va = parseSemver(a);
    const vb = parseSemver(b);
    if (va.major !== vb.major) return va.major - vb.major;
    if (va.minor !== vb.minor) return va.minor - vb.minor;
    if (va.patch !== vb.patch) return va.patch - vb.patch;
    if (va.prerelease === vb.prerelease) return 0;
    if (!va.prerelease) return 1;
    if (!vb.prerelease) return -1;
    return va.prerelease.localeCompare(vb.prerelease);
}

/**
 * Le a versao instalada a partir do package.json na raiz do app.
 * @param {string} [rootDir] Pasta raiz do app.
 * @returns {string}
 */
export function readInstalledVersion(rootDir = DEFAULT_APP_ROOT) {
    try {
        const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
        return String(pkg?.version || '1.0.0').trim();
    } catch {
        return '1.0.0';
    }
}

/** Arquivo que o pacote da Release leva com o commit de onde foi gerado. */
export const BUILD_INFO_FILE = 'build-info.json';

/** Commit e versão do pacote instalado (null quando a pasta não tem o arquivo, ex.: versões antigas ou git). */
export function readInstalledBuild(rootDir = DEFAULT_APP_ROOT) {
    try {
        const info = JSON.parse(readFileSync(join(rootDir, BUILD_INFO_FILE), 'utf8'));
        const commit = String(info?.commit || '').trim().toLowerCase();
        return { version: String(info?.version || ''), commit: /^[0-9a-f]{7,40}$/.test(commit) ? commit : '' };
    } catch {
        return { version: '', commit: '' };
    }
}

/**
 * Compara dois commits no GitHub. status: ahead (head à frente), behind, identical ou diverged.
 * @returns {Promise<{status:string, aheadBy:number, behindBy:number, headSha:string, lastMessage:string}|null>}
 */
export async function compareCommits({ repo = DEFAULT_UPDATE_REPO, base, head, fetchImpl = fetch, signal, version = '' } = {}) {
    if (!base || !head) return null;
    try {
        const res = await fetchImpl(`https://api.github.com/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Nexo-PokeBot/${version || 'updater'}` },
            signal,
        });
        if (!res?.ok) return null;
        const j = await res.json();
        const commits = Array.isArray(j?.commits) ? j.commits : [];
        const last = commits[commits.length - 1];
        return {
            status: String(j?.status || ''),
            aheadBy: Number(j?.ahead_by) || 0,
            behindBy: Number(j?.behind_by) || 0,
            headSha: String(last?.sha || '').toLowerCase(),
            lastMessage: String(last?.commit?.message || '').split('\n')[0].slice(0, 140),
        };
    } catch {
        return null;
    }
}

/** Mesmo commit? Aceita um dos lados abreviado. */
export function sameCommit(a, b) {
    const x = String(a || '').toLowerCase();
    const y = String(b || '').toLowerCase();
    if (!x || !y) return true; // sem os dois lados não dá para afirmar que mudou
    return x.startsWith(y) || y.startsWith(x);
}

/**
 * Escolhe o asset ZIP principal do Windows em uma Release do GitHub.
 * @param {object} release JSON da GitHub Releases API.
 * @returns {{ name: string, size: number, downloadUrl: string } | null}
 */
export function selectReleaseZipAsset(release) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const valid = assets.filter((a) => (
        a &&
        typeof a.name === 'string' &&
        typeof a.browser_download_url === 'string' &&
        /^https:\/\//i.test(a.browser_download_url)
    ));
    const preferred = valid.find((a) => /^Nexo-PokeBot-.*\.zip$/i.test(a.name))
        || valid.find((a) => /\.zip$/i.test(a.name));
    if (!preferred) return null;
    return {
        name: preferred.name,
        size: Number(preferred.size || 0),
        downloadUrl: preferred.browser_download_url,
    };
}

/**
 * Consulta a GitHub Releases API para verificar se ha versao mais nova disponivel.
 * @param {object} [options] Opcoes de checagem.
 * @returns {Promise<object>}
 */
export async function checkForUpdate(options = {}) {
    const rootDir = resolve(options.rootDir || DEFAULT_APP_ROOT);
    const repo = String(options.repo || DEFAULT_UPDATE_REPO).trim();
    const fetchImpl = options.fetchImpl || fetch;
    const timeoutMs = Number(options.timeoutMs || 12_000);
    const currentVersion = String(options.currentVersion || readInstalledVersion(rootDir));
    const isGitRepo = existsSync(join(rootDir, '.git'));
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetchImpl(apiUrl, {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': `Nexo-PokeBot/${currentVersion}`,
            },
            signal: ac.signal,
        });
        if (!res.ok) {
            throw new Error(`GitHub API retornou HTTP ${res.status}`);
        }
        const release = await res.json();
        const tagName = String(release?.tag_name || '').trim();
        const latestVersion = parseSemver(tagName || release?.name || currentVersion).raw || currentVersion;
        const asset = selectReleaseZipAsset(release);
        const cmp = compareSemver(latestVersion, currentVersion);
        // Além do número: mesma versão publicada de novo a partir de outro commit também é atualização.
        const installedCommit = String(options.installedCommit ?? readInstalledBuild(rootDir).commit ?? '');
        let latestCommit = '';
        if (cmp === 0 && installedCommit && tagName) {
            try {
                const r = await fetchImpl(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(tagName)}`, {
                    headers: { Accept: 'application/vnd.github.sha', 'User-Agent': `Nexo-PokeBot/${currentVersion}` },
                    signal: ac.signal,
                });
                const txt = r?.ok && typeof r.text === 'function' ? String(await r.text()).trim().toLowerCase() : '';
                if (/^[0-9a-f]{40}$/.test(txt)) latestCommit = txt;
            } catch {
                // sem o commit da tag, vale só a versão
            }
        }
        let rebuild = cmp === 0 && Boolean(latestCommit) && !sameCommit(latestCommit, installedCommit);
        if (rebuild) {
            // Quem segue o main pode estar à frente da tag: aí a "correção" seria voltar no tempo.
            const rel = await compareCommits({ repo, base: installedCommit, head: latestCommit, fetchImpl, signal: ac.signal, version: currentVersion });
            if (rel && rel.status !== 'ahead' && rel.status !== 'diverged') rebuild = false;
        }
        const hasUpdate = cmp > 0 || rebuild;
        const releaseUrl = typeof release?.html_url === 'string' && /^https:\/\//i.test(release.html_url)
            ? release.html_url
            : `https://github.com/${repo}/releases/latest`;
        return {
            ok: true,
            currentVersion,
            latestVersion,
            tagName: tagName || `v${latestVersion}`,
            releaseName: String(release?.name || `Nexo PokeBot v${latestVersion}`),
            releaseNotes: String(release?.body || '').trim(),
            releaseUrl,
            publishedAt: release?.published_at || null,
            hasUpdate,
            rebuild,
            installedCommit,
            latestCommit,
            updateId: rebuild ? `${latestVersion}+${latestCommit.slice(0, 7)}` : latestVersion,
            isGitRepo,
            asset,
        };
    } catch (err) {
        return {
            ok: false,
            currentVersion,
            latestVersion: currentVersion,
            hasUpdate: false,
            isGitRepo,
            asset: null,
            releaseUrl: `https://github.com/${repo}/releases/latest`,
            error: err?.name === 'AbortError' ? 'Tempo esgotado ao consultar GitHub Releases.' : (err?.message || String(err)),
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Localiza a raiz valida do Nexo PokeBot dentro de uma pasta extraida de ZIP.
 * @param {string} extractDir Pasta onde o ZIP foi extraido.
 * @returns {string}
 */
export function findExtractedAppRoot(extractDir) {
    const isAppRoot = (dir) => (
        existsSync(join(dir, 'package.json')) &&
        existsSync(join(dir, 'src', 'electron', 'main.mjs'))
    );
    if (isAppRoot(extractDir)) return extractDir;
    const entries = readdirSync(extractDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const entry of entries) {
        const sub = join(extractDir, entry.name);
        if (isAppRoot(sub)) return sub;
    }
    throw new Error('Pacote ZIP invalido: arquivos do Nexo PokeBot nao encontrados apos extracao.');
}

function escapePsSingle(str) {
    return String(str || '').replace(/'/g, "''");
}

/**
 * Gera script PowerShell seguro para aplicar a atualizacao preservando 100% das pastas/arquivos .pokebot-*.
 * @param {object} params Parametros de aplicacao.
 * @returns {string}
 */
export function buildWindowsApplyScript({
    stageRoot,
    appDir,
    launchExe,
    waitPids = [],
    tempRoot,
    logPath = join(tmpdir(), 'nexo-pokebot-last-update.log'),
    mirrorDirs = ['src', 'assets', 'docs', 'dist', 'node_modules\\electron\\dist'],
    copyDirs = [],
}) {
    const psList = (arr) => arr.map((d) => `"${String(d).replace(/"/g, '')}"`).join(', ');
    const pidList = (Array.isArray(waitPids) ? waitPids : [])
        .map((p) => Number.parseInt(String(p), 10))
        .filter((p) => Number.isFinite(p) && p > 0);
    const pidArrayPs = pidList.length > 0 ? `@(${pidList.join(', ')})` : '@()';

    return [
        '$ErrorActionPreference = "Stop"',
        `$stageRoot = '${escapePsSingle(resolve(stageRoot))}'`,
        `$appDir = '${escapePsSingle(resolve(appDir))}'`,
        `$launchExe = '${escapePsSingle(resolve(launchExe))}'`,
        `$tempRoot = '${escapePsSingle(resolve(tempRoot))}'`,
        `$logPath = '${escapePsSingle(resolve(logPath))}'`,
        `$waitPids = ${pidArrayPs}`,
        '',
        'function Write-Log($msg) {',
        '    $line = ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg)',
        '    try { Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 } catch {}',
        '}',
        '',
        'Write-Log "Iniciando atualizacao em $appDir"',
        'try {',
        '    # 1. Aguarda encerramento dos processos atuais (ate 20s)',
        '    $deadline = (Get-Date).AddSeconds(20)',
        '    while ((Get-Date) -lt $deadline) {',
        '        $alive = @()',
        '        foreach ($wpid in $waitPids) {',
        '            if (Get-Process -Id $wpid -ErrorAction SilentlyContinue) { $alive += $wpid }',
        '        }',
        '        if ($alive.Count -eq 0) { break }',
        '        Start-Sleep -Milliseconds 350',
        '    }',
        '    # Fecha qualquer processo remanescente executando de dentro desta pasta do app',
        '    $appPrefix = $appDir.TrimEnd("\\", "/") + "\\"',
        '    try {',
        '        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {',
        '            $_.ExecutablePath -and $_.ExecutablePath.StartsWith($appPrefix, [System.StringComparison]::OrdinalIgnoreCase)',
        '        } | ForEach-Object {',
        '            Write-Log ("Encerrando processo residual PID " + $_.ProcessId + " (" + $_.Name + ")")',
        '            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue',
        '        }',
        '    } catch {}',
        '    Start-Sleep -Milliseconds 700',
        '',
        '    # 2. Backup leve das sessoes e configs antes de aplicar (nunca remove os originais)',
        '    $backupDir = Join-Path $appDir ".pokebot-update-backup"',
        '    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null',
        '    foreach ($f in @(".pokebot-session.json", ".pokebot-headless-config.json")) {',
        '        $src = Join-Path $appDir $f',
        '        if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $backupDir $f) -Force -ErrorAction SilentlyContinue }',
        '    }',
        '    foreach ($acc in 2..4) {',
        '        $accSrc = Join-Path $appDir ".pokebot-accounts\\$acc"',
        '        if (Test-Path -LiteralPath $accSrc) {',
        '            $accBak = Join-Path $backupDir "accounts\\$acc"',
        '            New-Item -ItemType Directory -Path $accBak -Force | Out-Null',
        '            foreach ($f in @(".pokebot-session.json", ".pokebot-headless-config.json")) {',
        '                $sf = Join-Path $accSrc $f',
        '                if (Test-Path -LiteralPath $sf) { Copy-Item -LiteralPath $sf -Destination (Join-Path $accBak $f) -Force -ErrorAction SilentlyContinue }',
        '            }',
        '        }',
        '    }',
        '',
        '    # 3. Atualiza somente subpastas de codigo/runtime (JAMAIS faz /MIR na raiz para preservar .pokebot-*)',
        `    foreach ($sub in @(${psList(mirrorDirs)})) {`,
        '        $sDir = Join-Path $stageRoot $sub',
        '        if (Test-Path -LiteralPath $sDir) {',
        '            $dDir = Join-Path $appDir $sub',
        '            New-Item -ItemType Directory -Path $dDir -Force | Out-Null',
        '            $null = robocopy $sDir $dDir /MIR /R:6 /W:1 /NFL /NDL /NJH /NJS /NC /NS',
        '            if ($LASTEXITCODE -ge 8) { throw "Falha ao atualizar pasta $sub (robocopy exit $LASTEXITCODE)" }',
        '            Write-Log "Atualizado: $sub"',
        '        }',
        '    }',
        '',
        ...(copyDirs.length ? [
            '    # 3b. Pastas que recebem arquivos novos sem apagar os que só existem no pacote da Release',
            `    foreach ($sub in @(${psList(copyDirs)})) {`,
            '        $sDir = Join-Path $stageRoot $sub',
            '        if (Test-Path -LiteralPath $sDir) {',
            '            $dDir = Join-Path $appDir $sub',
            '            New-Item -ItemType Directory -Path $dDir -Force | Out-Null',
            '            $null = robocopy $sDir $dDir /E /R:6 /W:1 /NFL /NDL /NJH /NJS /NC /NS',
            '            if ($LASTEXITCODE -ge 8) { throw "Falha ao atualizar pasta $sub (robocopy exit $LASTEXITCODE)" }',
            '            Write-Log "Atualizado (sem apagar): $sub"',
            '        }',
            '    }',
            '',
        ] : []),
        '    # 4. Atualiza arquivos soltos da raiz (bloqueando qualquer nome .pokebot-*, .git*, .env*)',
        '    Get-ChildItem -LiteralPath $stageRoot -File -Force | ForEach-Object {',
        '        if ($_.Name -match "^\\.pokebot-|^\\.git|^\\.env") { return }',
        '        $dst = Join-Path $appDir $_.Name',
        '        for ($try = 1; $try -le 6; $try++) {',
        '            try {',
        '                Copy-Item -LiteralPath $_.FullName -Destination $dst -Force',
        '                break',
        '            } catch {',
        '                if ($try -eq 6) { throw }',
        '                Start-Sleep -Milliseconds 600',
        '            }',
        '        }',
        '    }',
        '    Write-Log "Arquivos da raiz atualizados com sucesso."',
        '',
        '    # 5. Reabre o Nexo PokeBot atualizado',
        '    if (Test-Path -LiteralPath $launchExe) {',
        '        Start-Process -FilePath $launchExe -WorkingDirectory $appDir',
        '        Write-Log "Relancado: $launchExe"',
        '    } else {',
        '        $fallbackBat = Join-Path $appDir "Abrir Nexo PokeBot.bat"',
        '        if (Test-Path -LiteralPath $fallbackBat) {',
        '            Start-Process -FilePath $fallbackBat -WorkingDirectory $appDir',
        '            Write-Log "Relancado: $fallbackBat"',
        '        }',
        '    }',
        '} catch {',
        '    Write-Log ("ERRO: " + $_.Exception.Message)',
        '    exit 1',
        '} finally {',
        '    Start-Sleep -Milliseconds 500',
        '    if ($tempRoot -and (Test-Path -LiteralPath $tempRoot)) {',
        '        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue',
        '    }',
        '}',
        '',
    ].join('\r\n');
}

/**
 * Baixa um arquivo com callback de progresso.
 * @param {string} url URL HTTPS do arquivo.
 * @param {string} destPath Caminho de destino.
 * @param {object} [options] Opcoes de download.
 */
export async function downloadFileWithProgress(url, destPath, options = {}) {
    const fetchImpl = options.fetchImpl || fetch;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const res = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Nexo-PokeBot-Updater' },
        signal: options.signal,
    });
    if (!res.ok) {
        throw new Error(`Falha ao baixar atualizacao (HTTP ${res.status}).`);
    }
    const totalBytes = Number(res.headers?.get?.('content-length') || options.expectedSize || 0);
    mkdirSync(dirname(destPath), { recursive: true });
    const out = createWriteStream(destPath);
    let downloadedBytes = 0;
    let lastEmit = 0;

    const emitProgress = (force = false) => {
        const now = Date.now();
        if (!force && now - lastEmit < 150) return;
        lastEmit = now;
        const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
        onProgress({ phase: 'downloading', downloadedBytes, totalBytes, percent });
    };

    try {
        if (res.body && typeof res.body.getReader === 'function') {
            const reader = res.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = Buffer.from(value);
                downloadedBytes += chunk.length;
                if (!out.write(chunk)) {
                    await new Promise((resDrain) => out.once('drain', resDrain));
                }
                emitProgress(false);
            }
        } else {
            const buf = Buffer.from(await res.arrayBuffer());
            downloadedBytes = buf.length;
            out.write(buf);
        }
        await new Promise((resEnd, rejEnd) => {
            out.once('error', rejEnd);
            out.end(resEnd);
        });
        emitProgress(true);
        return { downloadedBytes, totalBytes: totalBytes || downloadedBytes };
    } catch (err) {
        try { out.destroy(); } catch { /* ignore */ }
        throw err;
    }
}

async function extractZipWindows(zipPath, extractDir, execFileImpl = execFileAsync) {
    mkdirSync(extractDir, { recursive: true });
    try {
        await execFileImpl('tar.exe', ['-xf', zipPath, '-C', extractDir], { windowsHide: true });
        return;
    } catch {
        // fallback para PowerShell Expand-Archive em sistemas sem tar.exe
    }
    const cmd = `Expand-Archive -LiteralPath '${escapePsSingle(zipPath)}' -DestinationPath '${escapePsSingle(extractDir)}' -Force`;
    await execFileImpl('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true });
}

/**
 * Baixa, extrai, valida o pacote da Release e gera o script apply-update.ps1 pronto para executar.
 * @param {object} options Opcoes de staging.
 * @returns {Promise<{ ok: boolean, scriptPath: string, tempRoot: string, stageRoot: string, version: string }>}
 */
export async function downloadAndStageUpdate(options = {}) {
    const rootDir = resolve(options.rootDir || DEFAULT_APP_ROOT);
    const releaseInfo = options.releaseInfo;
    if (!releaseInfo?.asset?.downloadUrl) {
        throw new Error('Release nao contem um pacote ZIP do Nexo PokeBot para Windows.');
    }
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const tempRoot = join(tmpdir(), `nexo-update-${stamp}`);
    const zipPath = join(tempRoot, releaseInfo.asset.name || 'Nexo-PokeBot-update.zip');
    const extractDir = join(tempRoot, 'extracted');
    mkdirSync(tempRoot, { recursive: true });

    try {
        await downloadFileWithProgress(releaseInfo.asset.downloadUrl, zipPath, {
            fetchImpl: options.fetchImpl,
            expectedSize: releaseInfo.asset.size,
            signal: options.signal,
            onProgress,
        });
        onProgress({ phase: 'extracting', percent: 100 });
        await extractZipWindows(zipPath, extractDir, options.execFileImpl);
        const stageRoot = findExtractedAppRoot(extractDir);
        if (typeof options.prepareStage === 'function') await options.prepareStage(stageRoot);
        const launchExe = join(rootDir, 'Nexo PokeBot.exe');
        const scriptPath = join(tempRoot, 'apply-update.ps1');
        const scriptContent = buildWindowsApplyScript({
            stageRoot,
            appDir: rootDir,
            launchExe,
            waitPids: options.waitPids || [process.pid],
            tempRoot,
            ...(options.applyOptions || {}),
        });
        // UTF-8 com BOM para Windows PowerShell 5.1 interpretar acentos corretamente
        writeFileSync(scriptPath, `\uFEFF${scriptContent}`, 'utf8');
        onProgress({ phase: 'ready', percent: 100 });
        return {
            ok: true,
            scriptPath,
            tempRoot,
            stageRoot,
            version: releaseInfo.latestVersion || releaseInfo.tagName || '',
        };
    } catch (err) {
        rmSync(tempRoot, { recursive: true, force: true });
        throw err;
    }
}

/**
 * Monta o comando PowerShell que cria o processo do apply-update.ps1 via WMI (Win32_Process.Create).
 * O processo nasce filho do WmiPrvSE, fora da arvore e do Job Object do app: sobrevive ao app fechar.
 * @param {string} scriptPath Caminho do apply-update.ps1.
 * @returns {string}
 */
export function buildDetachedLaunchCommand(scriptPath) {
    const cmdLine = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${resolve(scriptPath)}"`;
    return [
        "$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }",
        `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${escapePsSingle(cmdLine)}'; ProcessStartupInformation = $si }`,
        'if ($r.ReturnValue -ne 0) { exit 1 }',
        'Write-Output $r.ProcessId',
    ].join('; ');
}

/**
 * Dispara o script que aplica a atualizacao depois que o app fechar.
 * Antes era um spawn "detached", mas o PowerShell morria junto com o app (mesmo Job
 * Object do processo pai) e o update nunca era aplicado. Agora cria via WMI e so
 * cai no spawn se o WMI falhar.
 * @param {string} scriptPath Caminho do apply-update.ps1.
 * @param {object} [options] Opcoes (execFileImpl/spawnImpl para teste).
 * @returns {Promise<{ pid: number, method: 'wmi' | 'spawn' }>}
 */
export async function launchApplyUpdateScript(scriptPath, options = {}) {
    const execFileImpl = options.execFileImpl || execFileAsync;
    const spawnImpl = options.spawnImpl || spawn;
    try {
        const { stdout } = await execFileImpl(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', buildDetachedLaunchCommand(scriptPath)],
            { windowsHide: true, timeout: 20_000 }
        );
        const pid = Number.parseInt(String(stdout || '').trim().split(/\s+/).pop(), 10);
        if (Number.isFinite(pid) && pid > 0) return { pid, method: 'wmi' };
    } catch {
        // segue para o spawn
    }
    const child = spawnImpl(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
        { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref?.();
    return { pid: Number(child.pid) || 0, method: 'spawn' };
}

async function runCli() {
    const args = new Set(process.argv.slice(2));
    const apply = args.has('--apply');
    const force = args.has('--force');
    const info = await checkForUpdate({ rootDir: DEFAULT_APP_ROOT });
    if (!info.ok) {
        console.error(`[Nexo Updater] Erro: ${info.error}`);
        process.exit(1);
    }
    console.log(`[Nexo Updater] Instalado: v${info.currentVersion} | Ultima Release: v${info.latestVersion}`);
    if (!info.hasUpdate && !force) {
        console.log('[Nexo Updater] Voce ja esta na versao mais recente.');
        return;
    }
    if (!apply) {
        console.log(`[Nexo Updater] Nova versao disponivel: ${info.releaseUrl}`);
        return;
    }
    if (info.isGitRepo && !force) {
        console.log('[Nexo Updater] Pasta Git detectada (.git). Use "git pull" ou passe --force.');
        return;
    }
    const staged = await downloadAndStageUpdate({
        rootDir: DEFAULT_APP_ROOT,
        releaseInfo: info,
        waitPids: [process.pid],
        onProgress: (p) => {
            if (p.phase === 'downloading') {
                process.stdout.write(`\r[Nexo Updater] Baixando... ${p.percent}%`);
            } else if (p.phase === 'extracting') {
                process.stdout.write('\n[Nexo Updater] Extraindo pacote...\n');
            }
        },
    });
    console.log(`[Nexo Updater] Aplicando atualizacao para v${staged.version}...`);
    await launchApplyUpdateScript(staged.scriptPath);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
    runCli().catch((err) => {
        console.error(`[Nexo Updater] Falha: ${err?.message || err}`);
        process.exit(1);
    });
}
