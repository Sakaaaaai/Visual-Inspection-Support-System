@echo off
setlocal
cd /d "%~dp0"

where uv >nul 2>nul
if not %errorlevel%==0 (
  echo uv is not installed.
  echo Install it first: https://docs.astral.sh/uv/getting-started/installation/
  pause
  exit /b 1
)

if exist ".venv\Scripts\python.exe" goto :environment_ready

echo Setting up the application environment...
uv sync
if errorlevel 1 goto :error

:environment_ready

echo Starting Animal Image Review Assistant...
echo Close this window to stop the application.
uv run python app.py
exit /b 0

:error
echo.
echo Setup failed. Check your network connection and uv installation.
pause
exit /b 1
