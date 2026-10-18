@echo off
chcp 65001 >nul
echo 正在关闭糯糯...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:17890/api/control' -ContentType 'application/json' -Body '{\"cmd\":\"shutdown\"}' | Out-Null; Write-Host '已关闭。' } catch { Write-Host '糯糯没有在运行（或端口不是 17890）。' }"
timeout /t 3 >nul
