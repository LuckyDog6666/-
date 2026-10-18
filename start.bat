@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title NuoNuo ASMR Pet
echo.
echo   ====================================================
echo        糯糯的 ASMR 奇遇  ·  抖音直播自动闯关
echo   ====================================================
echo.

set "NODE="
if exist "%~dp0runtime\node\node.exe" set "NODE=%~dp0runtime\node\node.exe"
if defined NODE goto have_node

where node >nul 2>nul
if errorlevel 1 goto get_node
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR goto get_node
if %NODE_MAJOR% GEQ 22 set "NODE=node"
if defined NODE goto have_node

:get_node
echo   第一次运行：正在自动准备 Node.js 运行环境（约 30MB，只需一次）...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\get-node.ps1"
if exist "%~dp0runtime\node\node.exe" set "NODE=%~dp0runtime\node\node.exe"
if defined NODE goto have_node
echo.
echo   [失败] 自动下载 Node.js 没有成功。
echo   请手动安装 Node.js 22 或更新版本： https://nodejs.org/zh-cn/download
echo   安装好以后，再双击本文件即可。
echo.
pause
exit /b 1

:have_node
if not exist "%~dp0config.json" copy /y "%~dp0config.example.json" "%~dp0config.json" >nul

:loop
"%NODE%" "%~dp0server\index.js" %*
set "CODE=%errorlevel%"
if "%CODE%"=="0" goto end
if "%CODE%"=="2" goto stop_pause
if "%CODE%"=="3" goto stop_pause
echo.
echo   程序意外退出（代码 %CODE%），5 秒后自动重启...
timeout /t 5 /nobreak >nul
goto loop

:stop_pause
echo.
pause

:end
endlocal
