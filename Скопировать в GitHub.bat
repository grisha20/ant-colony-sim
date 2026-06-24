@echo off
cd /d "%~dp0"
title Copy AntColonyAI to GitHub repo
set "DEST=F:\GitHub\ant-colony-sim"
echo ====================================
echo   Copy project to %DEST%
echo ====================================
echo.
echo Copying source (skipping node_modules, .git and local runtime files)...
robocopy "." "%DEST%" /E /XD node_modules .git dist .vite /XF snapshot.json genome.json spider_genome.json /NFL /NDL /NJH /NJS /NP
echo.
echo Installing dependencies in the repo folder (npm install)...
set "npm_execpath="
set "NPM_CLI_JS="
set "npm_config_prefix="
for %%i in (node.exe) do set "NODEDIR=%%~dp$PATH:i"
set "PATH=%NODEDIR%;%PATH%"
cd /d "%DEST%"
call "%NODEDIR%npm.cmd" install
echo.
echo Done. Now in GitHub Desktop: write a Summary, click "Commit to main", then "Push origin".
pause
