@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0config\device.json" (
  echo Open START.bat inside the Buyer or Supplier folder.
  pause
  exit /b 1
)
if not exist "%~dp0node\runtime\node.exe" (
  echo Extract the whole ZIP. Bundled Node.js is missing.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-device.ps1"
if errorlevel 1 (
  echo Setup did not finish. See .runtime\setup-error.txt or retry START.bat.
  pause
  exit /b 1
)
"%~dp0node\runtime\node.exe" "%~dp0scripts\start-device.mjs"
if errorlevel 1 pause
