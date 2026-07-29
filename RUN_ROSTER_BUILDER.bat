@echo off
title NCAA Roster Builder
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo The application is not installed yet.
  echo Run INSTALL_WINDOWS.bat first.
  echo.
  pause
  exit /b 1
)
call npm start
echo.
echo The application closed.
pause
