@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "LOCAL_RUN_DIR=%SCRIPT_DIR%.."
set "REPO_DIR=%LOCAL_RUN_DIR%\.."
set "ENGINE_DIR=%REPO_DIR%\testengine\backend"
if "%HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%"=="" set "HELLOTEST_PLAYWRIGHT_BROWSERS_PATH=%LOCAL_RUN_DIR%\.playwright-browsers"
if "%HELLOTEST_HOST_RECORDER_ARTIFACT_ROOT%"=="" set "HELLOTEST_HOST_RECORDER_ARTIFACT_ROOT=%LOCAL_RUN_DIR%\artifacts\host-recorder"
if "%HELLOTEST_HOST_RECORDER_PORT%"=="" set "HELLOTEST_HOST_RECORDER_PORT=4313"
if "%HELLOTEST_HOST_RECORDER_BIN%"=="" set "HELLOTEST_HOST_RECORDER_BIN=%LOCAL_RUN_DIR%\bin\hellotest-host-recorder.exe"

if not exist "%HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%" mkdir "%HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%"
if not exist "%HELLOTEST_HOST_RECORDER_ARTIFACT_ROOT%" mkdir "%HELLOTEST_HOST_RECORDER_ARTIFACT_ROOT%"

where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 20 or newer and npm, then start the local Playwright runner again.
  exit /b 1
)
node "%LOCAL_RUN_DIR%\lib\probe-runner.mjs" "http://localhost:%HELLOTEST_HOST_RECORDER_PORT%"
if "%ERRORLEVEL%"=="0" (
  echo HelloTest host recorder is already running
  echo   Browser URL: http://localhost:%HELLOTEST_HOST_RECORDER_PORT%
  echo   API/container URL: http://host.docker.internal:%HELLOTEST_HOST_RECORDER_PORT%
  exit /b 0
)

if exist "%ENGINE_DIR%\src\server.ts" goto source_runner

if exist "%HELLOTEST_HOST_RECORDER_BIN%" (
  echo Starting HelloTest host recorder from packaged binary
  echo   Binary: %HELLOTEST_HOST_RECORDER_BIN%
  echo   Browser URL: http://localhost:%HELLOTEST_HOST_RECORDER_PORT%
  echo   API/container URL: http://host.docker.internal:%HELLOTEST_HOST_RECORDER_PORT%
  echo   Browser binaries: %HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%
  set "PORT=%HELLOTEST_HOST_RECORDER_PORT%"
  set "ENGINE_NAME=hellotest-host-recorder"
  set "ENGINE_PUBLIC_URL=http://localhost:%HELLOTEST_HOST_RECORDER_PORT%"
  set "ARTIFACT_ROOT=%HELLOTEST_HOST_RECORDER_ARTIFACT_ROOT%"
  set "RECORDER_HEADLESS=false"
  set "PLAYWRIGHT_BROWSERS_PATH=%HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%"
  node "%SCRIPT_DIR%start-local-runner.mjs" "%HELLOTEST_HOST_RECORDER_BIN%"
  exit /b %ERRORLEVEL%
)

:source_runner
cd /d "%ENGINE_DIR%" || exit /b 1

call npm ci --include=dev --no-audit --no-fund || exit /b 1

set "PLAYWRIGHT_BROWSERS_PATH=%HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%"
node node_modules\playwright\cli.js install chromium || exit /b 1
call npm run build || exit /b 1

echo Starting HelloTest host recorder from source fallback
echo   Browser URL: http://localhost:%HELLOTEST_HOST_RECORDER_PORT%
echo   API/container URL: http://host.docker.internal:%HELLOTEST_HOST_RECORDER_PORT%
echo   Browser binaries: %HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%
set "PORT=%HELLOTEST_HOST_RECORDER_PORT%"
set "ENGINE_NAME=hellotest-host-recorder"
set "ENGINE_PUBLIC_URL=http://localhost:%HELLOTEST_HOST_RECORDER_PORT%"
set "ARTIFACT_ROOT=%HELLOTEST_HOST_RECORDER_ARTIFACT_ROOT%"
set "RECORDER_HEADLESS=false"
node "%SCRIPT_DIR%start-local-runner.mjs" node dist\server.js
