@echo off
title Build Portable NCAA Roster Builder
call npm run build:win
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo.
echo Finished. Look inside the dist folder for the portable EXE.
pause
