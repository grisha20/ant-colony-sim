@echo off
title AntColonyAI - firewall
echo Opening firewall ports 5173 and 8787 for AntColonyAI...
echo.
netsh advfirewall firewall add rule name="AntColonyAI 5173" dir=in action=allow protocol=TCP localport=5173
netsh advfirewall firewall add rule name="AntColonyAI 8787" dir=in action=allow protocol=TCP localport=8787
echo.
echo If you see "Ok." above twice - ports are open.
echo If you see an elevation error - run this file as Administrator.
echo.
pause
