@echo off
title Install NCAA Roster Builder
cd /d "%~dp0"
echo Installing NCAA Roster Builder...
echo.
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or Windows cannot find npm.
  echo Install Node.js LTS from https://nodejs.org
  echo Then restart the computer and run this file again.
  echo.
  pause
  exit /b 1
)
call npm install
if errorlevel 1 (
  echo.
  echo Installation failed. The error is shown above.
  pause
  exit /b 1
)
echo.
echo Installation finished successfully.
echo Double-click RUN_ROSTER_BUILDER.bat to open the utility.
pause
