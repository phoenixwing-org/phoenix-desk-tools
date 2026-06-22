@echo off
setlocal
REM Dev setup wrapper (calls setup_dev.ps1)
REM Usage: scripts\setup_dev.bat
REM        scripts\setup_dev.bat -SolidWorks
REM        scripts\setup_dev.bat -SkipPnpm

set "SCRIPT=%~dp0setup_dev.ps1"
where pwsh >nul 2>&1
if %ERRORLEVEL%==0 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
    exit /b %ERRORLEVEL%
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
exit /b %ERRORLEVEL%
