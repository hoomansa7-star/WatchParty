@echo off
chcp 65001 > nul
title WatchParty Runner

echo =======================================================
echo       Cinema Social (WatchParty) - راه انداز خودکار
echo =======================================================
echo.
echo [1/2] اجرای سرور ریل تایم Socket.IO (پورت 3003)...
start "WatchParty Realtime Service (Port 3003)" cmd /k "cd /d "%~dp0mini-services\realtime-service" && npx tsx index.ts"

timeout /t 2 /nobreak > nul

echo [2/2] اجرای وب اپلیکیشن Next.js...
start "WatchParty Web App" cmd /k "cd /d "%~dp0" && npm run dev"

echo.
echo =======================================================
echo تمام سرویس ها اجرا شدند!
echo وب اپلیکیشن: http://localhost:3000 (یا 3001)
echo سوکت واچ پارتی: http://localhost:3003
echo =======================================================
pause
