@echo off
cd /d "%~dp0"
echo ========================================
echo   Publishing to Twilio...
echo ========================================
echo.

REM Check Twilio CLI
where twilio >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Twilio CLI not found.
    echo Install it by running:  npm install -g twilio-cli
    echo.
    pause
    exit /b 1
)

if not exist "twilio.json" (
    echo ERROR: twilio.json not found.
    echo Open EDIT-IVR.bat and make a change to generate the file first.
    echo.
    pause
    exit /b 1
)

REM ── Step 1: Deploy the phones_total function ─────────────────────────────
echo [1/2] Deploying phones_total function...
echo.

if not exist "twilio-local.json" (
    echo WARNING: twilio-local.json not found — skipping function deployment.
    echo To enable function deployment, create twilio-local.json with:
    echo   { "accountSid": "ACxxx", "authToken": "xxx", "serviceSid": "ZSxxx" }
    echo Find these values at console.twilio.com
    echo.
) else (
    node scripts\deploy-function.js
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo WARNING: Function deployment failed. See error above.
        echo Continuing to Studio Flow publish...
        echo.
    ) else (
        echo.
    )
)

REM ── Step 2: Publish the Studio Flow ──────────────────────────────────────
echo [2/2] Publishing Studio Flow...
echo.

node scripts\publish-flow.js

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo   Published successfully!
    echo ========================================
) else (
    echo.
    echo ========================================
    echo   Studio Flow publish failed.
    echo ========================================
)

echo.
pause
