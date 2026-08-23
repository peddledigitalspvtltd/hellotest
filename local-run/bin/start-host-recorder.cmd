@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "LOCAL_RUN_DIR=%SCRIPT_DIR%.."
set "REPO_DIR=%LOCAL_RUN_DIR%\.."
set "ENGINE_DIR=%REPO_DIR%\testengine\backend"
if "%HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%"=="" set "HELLOTEST_PLAYWRIGHT_BROWSERS_PATH=%LOCAL_RUN_DIR%\.playwright-browsers"
if "%HELLOTEST_HOST_RECORDER_ARTIFACT_ROOT%"=="" set "HELLOTEST_HOST_RECORDER_ARTIFACT_ROOT=%LOCAL_RUN_DIR%\artifacts\host-recorder"
if "%HELLOTEST_HOST_RECORDER_PORT%"=="" set "HELLOTEST_HOST_RECORDER_PORT=4311"
if "%HELLOTEST_HOST_RECORDER_BIN%"=="" set "HELLOTEST_HOST_RECORDER_BIN=%LOCAL_RUN_DIR%\bin\hellotest-host-recorder.exe"

if not exist "%HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%" mkdir "%HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%"
if not exist "%HELLOTEST_HOST_RECORDER_ARTIFACT_ROOT%" mkdir "%HELLOTEST_HOST_RECORDER_ARTIFACT_ROOT%"

curl -fsS "http://localhost:%HELLOTEST_HOST_RECORDER_PORT%/health" >nul 2>nul
if "%ERRORLEVEL%"=="0" (
  echo HelloTest host recorder is already running
  echo   Browser URL: http://localhost:%HELLOTEST_HOST_RECORDER_PORT%
  echo   API/container URL: http://host.docker.internal:%HELLOTEST_HOST_RECORDER_PORT%
  exit /b 0
)

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
  "%HELLOTEST_HOST_RECORDER_BIN%"
  exit /b %ERRORLEVEL%
)

cd /d "%ENGINE_DIR%" || exit /b 1

if not exist node_modules (
  npm install || exit /b 1
)

set "PLAYWRIGHT_BROWSERS_PATH=%HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%"
npx playwright install chromium || exit /b 1
npm run build || exit /b 1

echo Starting HelloTest host recorder from source fallback
echo   Browser URL: http://localhost:%HELLOTEST_HOST_RECORDER_PORT%
echo   API/container URL: http://host.docker.internal:%HELLOTEST_HOST_RECORDER_PORT%
echo   Browser binaries: %HELLOTEST_PLAYWRIGHT_BROWSERS_PATH%
set "PORT=%HELLOTEST_HOST_RECORDER_PORT%"
set "ENGINE_NAME=hellotest-host-recorder"
set "ENGINE_PUBLIC_URL=http://localhost:%HELLOTEST_HOST_RECORDER_PORT%"
set "ARTIFACT_ROOT=%HELLOTEST_HOST_RECORDER_ARTIFACT_ROOT%"
set "RECORDER_HEADLESS=false"
node dist\server.js
