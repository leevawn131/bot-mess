<#
Start script for Windows to wait for Docker and start the compose stack.
Edit `$ComposeDir` to point to the folder that contains `docker-compose.yml` (or the repo root).
Save this file on the Windows host (e.g. C:\scripts\start-bot.ps1) and register it with Task Scheduler.
#>

param(
    [int]$DockerWaitTimeout = 300
)

$ErrorActionPreference = 'Stop'

function Wait-ForDockerWindows {
    param($timeoutSec)
    $start = Get-Date
    while ($true) {
        try { docker version > $null 2>&1; return $true } catch { }
        if ((Get-Date) - $start).TotalSeconds -gt $timeoutSec { return $false }
        Start-Sleep -Seconds 2
    }
}

function Wait-ForDockerWsl {
    param($distro, $timeoutSec)
    $start = Get-Date
    while ($true) {
        try { wsl -d $distro -- docker version > $null 2>&1; return $true } catch { }
        if ((Get-Date) - $start).TotalSeconds -gt $timeoutSec { return $false }
        Start-Sleep -Seconds 2
    }
}

Write-Output "Start-bot auto-start script"

# 1) Try to find repo on Windows drives: C:\Users\*\bot-mess
$winCandidates = Get-ChildItem C:\Users -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'bot-mess' } | Where-Object { Test-Path $_ }

# 2) Try to find repo in WSL (/home/*/bot-mess) by checking \wsl$ shares
$wslCandidates = @()
try {
    $wslShares = Get-ChildItem \\wsl$ -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
    foreach ($share in $wslShares) {
        $paths = Get-ChildItem (Join-Path $share 'home') -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'bot-mess' }
        foreach ($p in $paths) { if (Test-Path $p) { $wslCandidates += $p } }
    }
} catch { }

if ($winCandidates.Count -gt 0) {
    $composeDir = $winCandidates[0]
    Write-Output "Found Windows repo at: $composeDir"
    if (-not (Wait-ForDockerWindows -timeoutSec $DockerWaitTimeout)) { Write-Error 'Docker did not start in time on Windows'; exit 1 }
    Push-Location $composeDir
    try { docker compose up -d --build } finally { Pop-Location }
    Write-Output 'Docker compose started from Windows path.'
    exit 0
}

if ($wslCandidates.Count -gt 0) {
    # pick first candidate and convert to WSL path
    $sharePath = $wslCandidates[0]
    # \wsl$\Distro\home\user\bot-mess -> /home/user/bot-mess
    if ($sharePath -match '\\wsl\$\\([^\\]+)\\(.+)') {
        $distro = $matches[1]
        $rest = $matches[2].Replace('\','/')
        $wslPath = '/' + ($rest -replace '^home/', '')
        # ensure docker available in wsl
        if (-not (Wait-ForDockerWsl -distro $distro -timeoutSec $DockerWaitTimeout)) { Write-Error 'Docker did not start in WSL in time'; exit 1 }
        Write-Output "Running compose inside WSL distro $distro at /$rest"
        wsl -d $distro -- bash -lc "cd '/$rest' && docker compose up -d --build"
        Write-Output 'Docker compose started from WSL path.'
        exit 0
    }
}

Write-Error 'Could not find repository path on Windows or WSL. Place repo in C:\Users\<you>\bot-mess or /home/<you>/bot-mess in WSL, or edit this script.'
exit 1
