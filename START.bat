@echo off
cd /d "%~dp0"
echo Starting Mobile Express Admin Server...
echo.

REM Check if server is already running on port 5173
netstat -an 2>nul | find "5173" | find "LISTENING" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Server is already running.
) else (
    start "" node server.js
    timeout /t 2 /nobreak >nul
    echo Server started.
)

echo.
start http://localhost:5173/admin-home.html
echo Admin opened at http://localhost:5173/admin-home.html
echo Close this window to stop the server.
echo.
pause
