@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title NuoNuo Self Check
set "NODE="
if exist "%~dp0runtime\node\node.exe" set "NODE=%~dp0runtime\node\node.exe"
if not defined NODE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE=node"
)
if not defined NODE (
  echo 还没有准备好运行环境，请先双击 启动糯糯.bat 运行一次。
  pause
  exit /b 1
)
echo ========== 1/2 程序自检 ==========
"%NODE%" "%~dp0tools\selftest.mjs"
echo.
echo ========== 2/2 直播监听链路自检（会短暂启动一个后台浏览器） ==========
"%NODE%" "%~dp0tools\test-listener.mjs"
echo.
echo 自检结束。如有失败项，请把本窗口内容截图发给技术人员。
pause
