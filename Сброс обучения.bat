@echo off
cd /d "%~dp0"
echo Resetting LEARNING (genome.json, genome-b.json, spider_genome.json) and world (snapshot.json)...
del /f /q "%~dp0genome.json" 2>nul
del /f /q "%~dp0genome-b.json" 2>nul
del /f /q "%~dp0spider_genome.json" 2>nul
del /f /q "%~dp0snapshot.json" 2>nul
echo Done. Now run Zapusk/Restart for a fresh start on the new fitness scale.
timeout /t 4 >nul
