$Host.UI.RawUI.WindowTitle = "Cinema Social - WatchParty"
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "         🎬 سینما سوشال (WatchParty) - لانچر خودکار" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $root) { $root = "D:\WatchParty" }
$appDir = Join-Path $root "-cinema-social"
$socketDir = Join-Path $appDir "mini-services\realtime-service"

# 1. Check & start Socket.IO service (port 3003)
Write-Host "[1/3] بررسی سرویس ریل‌تایم واچ‌پارتی (Socket.IO)..." -ForegroundColor White
$sockListening = Get-NetTCPConnection -LocalPort 3003 -State Listen -ErrorAction SilentlyContinue
if (-not $sockListening) {
    Write-Host "   » در حال اجرای سرور سوکت روی پورت 3003..." -ForegroundColor Gray
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d `"$socketDir`" && npx tsx index.ts" -WindowStyle Minimized
} else {
    Write-Host "   » سرور سوکت روی پورت 3003 فعال است." -ForegroundColor Green
}

# 2. Check & start Next.js web app (port 3000)
Write-Host "`n[2/3] بررسی وب‌اپلیکیشن (Next.js)..." -ForegroundColor White
$webListening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $webListening) {
    Write-Host "   » در حال اجرای وب‌سرور..." -ForegroundColor Gray
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d `"$appDir`" && npm run dev" -WindowStyle Minimized
} else {
    Write-Host "   » وب‌سرور روی پورت 3000 فعال است." -ForegroundColor Green
}

# 3. Wait until server responds and open browser
Write-Host "`n[3/3] در حال اتصال و باز کردن مرورگر..." -ForegroundColor White
$targetPort = 3000
$ready = $false
for ($i = 1; $i -le 25; $i++) {
    Start-Sleep -Seconds 1
    # Test port 3000
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient("127.0.0.1", 3000)
        $tcp.Close()
        $targetPort = 3000
        $ready = $true
        break
    } catch {
        # Check fallback port 3001
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient("127.0.0.1", 3001)
            $tcp.Close()
            $targetPort = 3001
            $ready = $true
            break
        } catch {}
    }
    Write-Host "   ... منتظر آماده شدن وب‌سرور (تلاش $i از 25)" -ForegroundColor DarkGray
}

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "   🚀 برنامه آماده شد! در حال باز کردن در مرورگر..." -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " آدرس وب‌سایت: http://localhost:$targetPort" -ForegroundColor Yellow
Write-Host " آدرس سوکت:   http://localhost:3003" -ForegroundColor Yellow
Write-Host " ورود سریع ادمین: admin / 12345" -ForegroundColor White
Write-Host "================================================================" -ForegroundColor Cyan

Start-Process "http://localhost:$targetPort"
Start-Sleep -Seconds 3
