@echo off
title EdgeSurf Executor
echo ========================================
echo   EdgeSurf Executor - Quick Launcher
echo ========================================
echo.

:: Check if Node.js is available
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

:: Check if node_modules exists
if not exist "%~dp0node_modules" (
    echo [Setup] Installing dependencies...
    cd /d "%~dp0"
    npm install
    echo.
)

:: Run the PowerShell launcher
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1"

pause
