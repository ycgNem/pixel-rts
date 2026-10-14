@echo off
rem Double-click to play Pixel RTS. Starts the game server and opens your browser.
rem Keep this window open while you play; close it to stop the game.
title Pixel RTS
cd /d "%~dp0"

rem Use the portable Node.js on this PC if Node isn't already installed system-wide.
set "NODE_DIR=%USERPROFILE%\tools\node-v22.20.0-win-x64"
where node >nul 2>nul
if errorlevel 1 if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install the LTS version from https://nodejs.org , then double-click Play.bat again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing the game's tools. This takes a minute...
  call npm install
  if errorlevel 1 (
    echo npm install failed. See the messages above.
    pause
    exit /b 1
  )
)

echo.
echo Starting Pixel RTS... your browser will open at http://localhost:5173
echo Keep this window open while you play. Close it to stop the game.
echo.
call npm run dev -- --open
pause
