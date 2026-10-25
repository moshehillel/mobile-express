@echo off
cd /d "%~dp0"
title Mobile Express setup
echo ========================================
echo   Mobile Express — one-click setup
echo ========================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo Install Node.js first: https://nodejs.org
  pause
  exit /b 1
)

where netlify >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo Installing Netlify CLI...
  call npm install -g netlify-cli
  if %ERRORLEVEL% NEQ 0 goto failed
)

node scripts\setup-all.js
if %ERRORLEVEL% NEQ 0 goto failed

echo.
pause
exit /b 0

:failed
echo.
echo Setup stopped. Run this file again. Values already entered are kept.
pause
exit /b 1
