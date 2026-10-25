@echo off
cd /d "%~dp0"
echo ========================================
echo   Publishing to Netlify...
echo ========================================
echo.

REM Check if Netlify CLI is installed
where netlify >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Netlify CLI not found. Installing...
    npm install -g netlify-cli
    echo.
)

REM Check if project is linked
if not exist ".netlify\state.json" (
    echo Project not linked to Netlify. Please link first:
    echo   1. Run: netlify login
    echo   2. Run: netlify link
    echo.
    pause
    exit /b 1
)

REM Deploy to production
echo Deploying to production...
netlify deploy --prod

echo.
echo ========================================
echo   Deployment complete!
echo ========================================
echo.
pause
