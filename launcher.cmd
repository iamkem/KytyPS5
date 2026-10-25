@echo off
setlocal
rem Single active launcher: packaged latest build in this checkout, or portable release bundle.
set "ROOT=%~dp0"
if exist "%ROOT%_Build\latest\launcher\DemonsSoulsLauncher-win32-x64\DemonsSoulsLauncher.exe" (
  start "" "%ROOT%_Build\latest\launcher\DemonsSoulsLauncher-win32-x64\DemonsSoulsLauncher.exe"
  exit /b 0
)
if exist "%ROOT%Launcher\DemonsSoulsLauncher.exe" (
  start "" "%ROOT%Launcher\DemonsSoulsLauncher.exe"
  exit /b 0
)
echo Demon's Souls PC Launcher not found. Build the latest Electron launcher:
echo   cd launcher-electron
echo   npm ci
echo   npm run build
pause
exit /b 1
