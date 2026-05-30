<#
Installer: copies `start-bot.ps1` to C:\scripts and registers Scheduled Task to run at logon.
Run this PowerShell as Administrator on Windows once.
#>

param(
    [string]$SourceRepoPath = '',
    [string]$Distro = 'Ubuntu'
)

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error 'Please run this installer as Administrator.'
    exit 1
}

$destDir = 'C:\scripts'
New-Item -ItemType Directory -Path $destDir -Force | Out-Null

$sourceScript = Join-Path $SourceRepoPath 'windows\start-bot.ps1'
if (-not (Test-Path $sourceScript)) { Write-Error "Source script not found: $sourceScript"; exit 1 }

$destScript = Join-Path $destDir 'start-bot.ps1'
Copy-Item -Path $sourceScript -Destination $destScript -Force

Write-Output "Copied start script to $destScript"

# Use ScheduledTasks module so we do not have to fight schtasks quoting rules
$taskName = 'StartMessengerBot'
$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$destScript`""
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings | Out-Null

Write-Output 'Scheduled task StartMessengerBot created.'
Write-Output 'Enable Docker Desktop to start on login (Docker Desktop settings).'
