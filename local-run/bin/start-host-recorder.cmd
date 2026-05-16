@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "LOCAL_RUN_DIR=%SCRIPT_DIR%.."
set "REPO_DIR=%LOCAL_RUN_DIR%\.."
set "ENGINE_DIR=%REPO_DIR%\testengine\backend"
if "%QAIRA_PLAYWRIGHT_BROWSERS_PATH%"=="" set "QAIRA_PLAYWRIGHT_BROWSERS_PATH=%LOCAL_RUN_DIR%\.playwright-browsers"
if "%QAIRA_HOST_RECORDER_ARTIFACT_ROOT%"=="" set "QAIRA_HOST_RECORDER_ARTIFACT_ROOT=%LOCAL_RUN_DIR%\artifacts\host-recorder"
if "%QAIRA_HOST_RECORDER_PORT%"=="" set "QAIRA_HOST_RECORDER_PORT=4311"
if "%QAIRA_HOST_RECORDER_BIN%"=="" set "QAIRA_HOST_RECORDER_BIN=%LOCAL_RUN_DIR%\bin\qaira-host-recorder.exe"

if not exist "%QAIRA_PLAYWRIGHT_BROWSERS_PATH%" mkdir "%QAIRA_PLAYWRIGHT_BROWSERS_PATH%"
if not exist "%QAIRA_HOST_RECORDER_ARTIFACT_ROOT%" mkdir "%QAIRA_HOST_RECORDER_ARTIFACT_ROOT%"

curl -fsS "http://localhost:%QAIRA_HOST_RECORDER_PORT%/health" >nul 2>nul
if "%ERRORLEVEL%"=="0" (
  echo QAira host recorder is already running
  echo   Browser URL: http://localhost:%QAIRA_HOST_RECORDER_PORT%
  echo   API/container URL: http://host.docker.internal:%QAIRA_HOST_RECORDER_PORT%
  exit /b 0
)

if exist "%QAIRA_HOST_RECORDER_BIN%" (
  echo Starting QAira host recorder from packaged binary
  echo   Binary: %QAIRA_HOST_RECORDER_BIN%
  echo   Browser URL: http://localhost:%QAIRA_HOST_RECORDER_PORT%
  echo   API/container URL: http://host.docker.internal:%QAIRA_HOST_RECORDER_PORT%
  echo   Browser binaries: %QAIRA_PLAYWRIGHT_BROWSERS_PATH%
  set "PORT=%QAIRA_HOST_RECORDER_PORT%"
  set "ENGINE_NAME=qaira-host-recorder"
  set "ENGINE_PUBLIC_URL=http://localhost:%QAIRA_HOST_RECORDER_PORT%"
  set "ARTIFACT_ROOT=%QAIRA_HOST_RECORDER_ARTIFACT_ROOT%"
  set "RECORDER_HEADLESS=false"
  set "PLAYWRIGHT_BROWSERS_PATH=%QAIRA_PLAYWRIGHT_BROWSERS_PATH%"
  "%QAIRA_HOST_RECORDER_BIN%"
  exit /b %ERRORLEVEL%
)

cd /d "%ENGINE_DIR%" || exit /b 1

if not exist node_modules (
  npm install || exit /b 1
)

set "PLAYWRIGHT_BROWSERS_PATH=%QAIRA_PLAYWRIGHT_BROWSERS_PATH%"
npx playwright install chromium || exit /b 1
npm run build || exit /b 1

echo Starting QAira host recorder from source fallback
echo   Browser URL: http://localhost:%QAIRA_HOST_RECORDER_PORT%
echo   API/container URL: http://host.docker.internal:%QAIRA_HOST_RECORDER_PORT%
echo   Browser binaries: %QAIRA_PLAYWRIGHT_BROWSERS_PATH%
set "PORT=%QAIRA_HOST_RECORDER_PORT%"
set "ENGINE_NAME=qaira-host-recorder"
set "ENGINE_PUBLIC_URL=http://localhost:%QAIRA_HOST_RECORDER_PORT%"
set "ARTIFACT_ROOT=%QAIRA_HOST_RECORDER_ARTIFACT_ROOT%"
set "RECORDER_HEADLESS=false"
node dist\server.js
