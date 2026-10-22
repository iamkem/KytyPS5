@echo off
setlocal
rem Personal Demon's Souls PC launcher. Emulator backend scripts remain required.
set "ROOT=%~dp0"
if exist "%ROOT%_Build\demons-souls-launcher-v6\DemonsSoulsLauncher-win32-x64\DemonsSoulsLauncher.exe" (
  start "" "%ROOT%_Build\demons-souls-launcher-v6\DemonsSoulsLauncher-win32-x64\DemonsSoulsLauncher.exe"
  exit /b 0
)
if exist "%ROOT%_Build\demons-souls-launcher-v5\DemonsSoulsLauncher-win32-x64\DemonsSoulsLauncher.exe" (
  start "" "%ROOT%_Build\demons-souls-launcher-v5\DemonsSoulsLauncher-win32-x64\DemonsSoulsLauncher.exe"
  exit /b 0
)
if exist "%ROOT%Launcher\DemonsSoulsLauncher.exe" (
  start "" "%ROOT%Launcher\DemonsSoulsLauncher.exe"
  exit /b 0
)
echo Demon's Souls PC Launcher not found. To build it:
echo   cd launcher-electron
echo   npm ci
echo   npm run build
pause
exit /b 1
