@echo off
cd /d "%~dp0"
title AntColonyAI - reset
set "npm_execpath="
set "NPM_CLI_JS="
set "npm_config_prefix="
for %%i in (node.exe) do set "NODEDIR=%%~dp$PATH:i"
set "PATH=%NODEDIR%;%PATH%"
echo Stopping server...
taskkill /F /IM node.exe >nul 2>nul
timeout /t 2 >nul
echo Deleting saved world...
del /f /q "%~dp0snapshot.json" 2>nul
echo Starting a fresh colony...
echo.
call "%NODEDIR%npm.cmd" run dev
echo.
echo Server stopped. You can close this window.
pause
