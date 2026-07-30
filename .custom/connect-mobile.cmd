@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0connect-mobile.ps1" %*
exit /b %ERRORLEVEL%
