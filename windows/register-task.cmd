@echo off
REM Usage: edit the PATH_TO_SCRIPT below to match where you saved start-bot.ps1
SET "PATH_TO_SCRIPT=C:\scripts\start-bot.ps1"

REM Create scheduled task to run at user logon
SCHTASKS /Create /SC ONLOGON /TN "StartMessengerBot" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"%PATH_TO_SCRIPT%\"" /RL HIGHEST /F

echo Task registered. To delete: SCHTASKS /Delete /TN "StartMessengerBot" /F
