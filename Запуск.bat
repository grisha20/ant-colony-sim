@echo off
cd /d "%~dp0"
title AntColonyAI
set "npm_execpath="
set "NPM_CLI_JS="
set "npm_config_prefix="
for %%i in (node.exe) do set "NODEDIR=%%~dp$PATH:i"
set "PATH=%NODEDIR%;%PATH%"
echo Node dir: %NODEDIR%
echo Starting AntColonyAI server...
echo.
call "%NODEDIR%npm.cmd" run dev
echo.
echo Server stopped. You can close this window.
pause
