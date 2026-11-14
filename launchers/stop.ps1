$Host.UI.RawUI.WindowTitle = "Stop Cinema Social - WatchParty"
Write-Host "================================================================" -ForegroundColor Red
Write-Host "         🛑 بستن سرویس‌های سینما سوشال (WatchParty)" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Red
Write-Host ""

# Stop Socket.IO on 3003
$sockConn = Get-NetTCPConnection -LocalPort 3003 -State Listen -ErrorAction SilentlyContinue
if ($sockConn) {
    foreach ($c in $sockConn) {
        try {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Host " [✓] سرویس سوکت (پورت 3003) متوقف شد." -ForegroundColor Green
        } catch {}
    }
}

# Stop WatchParty node processes
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*WatchParty*" -or $_.CommandLine -like "*nextjs_tailwind*" } | ForEach-Object {
    try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host " [✓] پروسه وب‌سرور (PID: $($_.ProcessId)) متوقف شد." -ForegroundColor Green
    } catch {}
}

Write-Host "`n================================================================" -ForegroundColor Red
Write-Host " تمام سرویس‌های سینما سوشال متوقف شدند." -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Red
Start-Sleep -Seconds 3
