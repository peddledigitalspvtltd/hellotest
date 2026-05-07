#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCAL_RUN_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$LOCAL_RUN_DIR"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

LOCAL_FRONTEND_PORT=${FRONTEND_PORT:-8080}
LOCAL_API_PORT=${API_PORT:-3000}
LOCAL_TESTENGINE_PORT=${TESTENGINE_PORT:-4301}
LOCAL_MOBILE_ENGINE_PORT=${MOBILE_ENGINE_PORT:-4312}
LOCAL_HOST_RECORDER_PORT=${QAIRA_HOST_RECORDER_PORT:-4311}

check_url() {
  label=$1
  url=$2

  if curl -fsS "$url" >/dev/null; then
    echo "OK   $label $url"
  else
    echo "FAIL $label $url"
    return 1
  fi
}

check_url "frontend" "http://localhost:$LOCAL_FRONTEND_PORT"
check_url "api" "http://localhost:$LOCAL_API_PORT/health"
check_url "testengine" "http://localhost:$LOCAL_TESTENGINE_PORT/health"
check_url "capabilities" "http://localhost:$LOCAL_TESTENGINE_PORT/api/v1/capabilities"
check_url "mobile-engine" "http://localhost:$LOCAL_MOBILE_ENGINE_PORT/health"
check_url "mobile-capabilities" "http://localhost:$LOCAL_MOBILE_ENGINE_PORT/api/v1/capabilities"
if curl -fsS "http://localhost:$LOCAL_HOST_RECORDER_PORT/health" >/dev/null; then
  echo "OK   host-recorder http://localhost:$LOCAL_HOST_RECORDER_PORT/health"
else
  echo "SKIP host-recorder http://localhost:$LOCAL_HOST_RECORDER_PORT/health"
  echo "     Optional visible local recorder is not running. Start it with: bin/start-host-recorder.sh"
fi

if curl -fsS "http://localhost:${LLM_PORT:-11434}/api/tags" >/dev/null; then
  echo "OK   local-llm http://localhost:${LLM_PORT:-11434}/api/tags"
else
  echo "SKIP local-llm http://localhost:${LLM_PORT:-11434}/api/tags"
  echo "     Optional local LLM is not ready yet. Start the stack and pull a model with: docker exec qaira-local-llm ollama pull ${LLM_MODEL:-llama3.2}"
fi
