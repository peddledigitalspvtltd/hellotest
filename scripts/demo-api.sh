#!/bin/sh

set -eu

BASE_URL="${BASE_URL:-http://localhost:3000}"
CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-5}"
CURL_MAX_TIME="${CURL_MAX_TIME:-20}"
RUN_ID="${RUN_ID:-$(date +%s)}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but was not found in PATH."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but was not found in PATH."
  exit 1
fi

post_json() {
  endpoint="$1"
  payload="$2"

  response="$(curl -sS \
    --connect-timeout "$CURL_CONNECT_TIMEOUT" \
    --max-time "$CURL_MAX_TIME" \
    -X POST "$BASE_URL$endpoint" \
    -H "Content-Type: application/json" \
    -d "$payload")"

  echo "$response"
}

put_json() {
  endpoint="$1"
  payload="$2"

  response="$(curl -sS \
    --connect-timeout "$CURL_CONNECT_TIMEOUT" \
    --max-time "$CURL_MAX_TIME" \
    -X PUT "$BASE_URL$endpoint" \
    -H "Content-Type: application/json" \
    -d "$payload")"

  echo "$response"
}

delete_call() {
  endpoint="$1"
  curl -sS \
    --connect-timeout "$CURL_CONNECT_TIMEOUT" \
    --max-time "$CURL_MAX_TIME" \
    -X DELETE "$BASE_URL$endpoint"
}

get_call() {
  endpoint="$1"
  curl -sS \
    --connect-timeout "$CURL_CONNECT_TIMEOUT" \
    --max-time "$CURL_MAX_TIME" \
    "$BASE_URL$endpoint"
}

extract_id() {
  id="$(echo "$1" | jq -r '.id // empty')"

  if [ -z "$id" ] || [ "$id" = "null" ]; then
    echo "API request failed:"
    echo "$1" | jq '.'
    exit 1
  fi

  echo "$id"
}

ensure_success_response() {
  response="$1"

  if echo "$response" | jq -e '.statusCode?' >/dev/null 2>&1; then
    echo "API request failed:"
    echo "$response" | jq '.'
    exit 1
  fi
}

echo "Using API base URL: $BASE_URL"
echo "Using run ID: $RUN_ID"

echo "Creating users..."
USER1_RESPONSE="$(post_json "/users" '{
  "email": "admin-'$RUN_ID'@example.com",
  "password_hash": "hashed_pw_admin",
  "name": "Admin User '$RUN_ID'"
}')"
ensure_success_response "$USER1_RESPONSE"
USER1_ID="$(extract_id "$USER1_RESPONSE")"

USER2_RESPONSE="$(post_json "/users" '{
  "email": "qa-'$RUN_ID'@example.com",
  "password_hash": "hashed_pw_qa",
  "name": "QA User '$RUN_ID'"
}')"
ensure_success_response "$USER2_RESPONSE"
USER2_ID="$(extract_id "$USER2_RESPONSE")"

echo "Creating roles..."
ROLE_ADMIN_RESPONSE="$(post_json "/roles" '{"name":"admin-'$RUN_ID'"}')"
ensure_success_response "$ROLE_ADMIN_RESPONSE"
ROLE_ADMIN_ID="$(extract_id "$ROLE_ADMIN_RESPONSE")"

ROLE_MEMBER_RESPONSE="$(post_json "/roles" '{"name":"member-'$RUN_ID'"}')"
ensure_success_response "$ROLE_MEMBER_RESPONSE"
ROLE_MEMBER_ID="$(extract_id "$ROLE_MEMBER_RESPONSE")"

echo "Creating project..."
PROJECT_RESPONSE="$(post_json "/projects" "{
  \"name\": \"E-Commerce System $RUN_ID\",
  \"description\": \"End-to-end QA project $RUN_ID\",
  \"created_by\": \"$USER1_ID\"
}")"
ensure_success_response "$PROJECT_RESPONSE"
PROJECT_ID="$(extract_id "$PROJECT_RESPONSE")"

echo "Creating project members..."
PROJECT_MEMBER1_RESPONSE="$(post_json "/project-members" "{
  \"project_id\": \"$PROJECT_ID\",
  \"user_id\": \"$USER1_ID\",
  \"role_id\": \"$ROLE_ADMIN_ID\"
}")"
ensure_success_response "$PROJECT_MEMBER1_RESPONSE"
PROJECT_MEMBER1_ID="$(extract_id "$PROJECT_MEMBER1_RESPONSE")"

PROJECT_MEMBER2_RESPONSE="$(post_json "/project-members" "{
  \"project_id\": \"$PROJECT_ID\",
  \"user_id\": \"$USER2_ID\",
  \"role_id\": \"$ROLE_MEMBER_ID\"
}")"
ensure_success_response "$PROJECT_MEMBER2_RESPONSE"
PROJECT_MEMBER2_ID="$(extract_id "$PROJECT_MEMBER2_RESPONSE")"

echo "Creating app types..."
WEB_APP_RESPONSE="$(post_json "/app-types" "{
  \"project_id\": \"$PROJECT_ID\",
  \"name\": \"Web App $RUN_ID\",
  \"type\": \"web\",
  \"is_unified\": false
}")"
ensure_success_response "$WEB_APP_RESPONSE"
WEB_APP_ID="$(extract_id "$WEB_APP_RESPONSE")"

API_APP_RESPONSE="$(post_json "/app-types" "{
  \"project_id\": \"$PROJECT_ID\",
  \"name\": \"API Layer $RUN_ID\",
  \"type\": \"api\",
  \"is_unified\": false
}")"
ensure_success_response "$API_APP_RESPONSE"
API_APP_ID="$(extract_id "$API_APP_RESPONSE")"

echo "Creating requirement..."
REQUIREMENT_RESPONSE="$(post_json "/requirements" "{
  \"project_id\": \"$PROJECT_ID\",
  \"title\": \"User Login $RUN_ID\",
  \"description\": \"User should log in successfully $RUN_ID\",
  \"priority\": 1,
  \"status\": \"open\"
}")"
ensure_success_response "$REQUIREMENT_RESPONSE"
REQUIREMENT_ID="$(extract_id "$REQUIREMENT_RESPONSE")"

echo "Creating test suite..."
SUITE_RESPONSE="$(post_json "/test-suites" "{
  \"app_type_id\": \"$WEB_APP_ID\",
  \"name\": \"Authentication $RUN_ID\"
}")"
ensure_success_response "$SUITE_RESPONSE"
SUITE_ID="$(extract_id "$SUITE_RESPONSE")"

echo "Creating test case..."
TEST_CASE_RESPONSE="$(post_json "/test-cases" "{
  \"suite_id\": \"$SUITE_ID\",
  \"title\": \"Login with valid credentials $RUN_ID\",
  \"description\": \"Verify successful login $RUN_ID\",
  \"priority\": 1,
  \"status\": \"active\",
  \"requirement_id\": \"$REQUIREMENT_ID\"
}")"
ensure_success_response "$TEST_CASE_RESPONSE"
TEST_CASE_ID="$(extract_id "$TEST_CASE_RESPONSE")"

echo "Creating test steps..."
TEST_STEP1_RESPONSE="$(post_json "/test-steps" "{
  \"test_case_id\": \"$TEST_CASE_ID\",
  \"step_order\": 1,
  \"action\": \"Open app\",
  \"expected_result\": \"App loads\"
}")"
ensure_success_response "$TEST_STEP1_RESPONSE"
TEST_STEP1_ID="$(extract_id "$TEST_STEP1_RESPONSE")"

TEST_STEP2_RESPONSE="$(post_json "/test-steps" "{
  \"test_case_id\": \"$TEST_CASE_ID\",
  \"step_order\": 2,
  \"action\": \"Enter valid credentials\",
  \"expected_result\": \"Credentials accepted\"
}")"
ensure_success_response "$TEST_STEP2_RESPONSE"
TEST_STEP2_ID="$(extract_id "$TEST_STEP2_RESPONSE")"

echo "Creating execution..."
EXECUTION_RESPONSE="$(post_json "/executions" "{
  \"project_id\": \"$PROJECT_ID\",
  \"name\": \"Smoke Run $RUN_ID\",
  \"created_by\": \"$USER1_ID\"
}")"
ensure_success_response "$EXECUTION_RESPONSE"
EXECUTION_ID="$(extract_id "$EXECUTION_RESPONSE")"

echo "Starting execution..."
START_RESPONSE="$(post_json "/executions/$EXECUTION_ID/start" '{}')"
ensure_success_response "$START_RESPONSE"

echo "Creating execution result..."
EXECUTION_RESULT_RESPONSE="$(post_json "/execution-results" "{
  \"execution_id\": \"$EXECUTION_ID\",
  \"test_case_id\": \"$TEST_CASE_ID\",
  \"app_type_id\": \"$WEB_APP_ID\",
  \"status\": \"passed\",
  \"duration_ms\": 1200,
  \"logs\": \"Test passed\",
  \"executed_by\": \"$USER2_ID\"
}")"
ensure_success_response "$EXECUTION_RESULT_RESPONSE"
EXECUTION_RESULT_ID="$(extract_id "$EXECUTION_RESULT_RESPONSE")"

echo "Completing execution..."
COMPLETE_RESPONSE="$(post_json "/executions/$EXECUTION_ID/complete" '{"status":"completed"}')"
ensure_success_response "$COMPLETE_RESPONSE"

echo
echo "CRUD examples"
echo "-------------"
echo "GET /projects"
get_call "/projects" | jq '.'

echo
echo "GET /projects/$PROJECT_ID"
get_call "/projects/$PROJECT_ID" | jq '.'

echo
echo "PUT /projects/$PROJECT_ID"
put_json "/projects/$PROJECT_ID" '{
  "name": "Updated E-Commerce System",
  "description": "Updated project description"
}' | jq '.'

echo
echo "GET /test-cases?suite_id=$SUITE_ID"
get_call "/test-cases?suite_id=$SUITE_ID" | jq '.'

echo
echo "PUT /test-cases/$TEST_CASE_ID"
put_json "/test-cases/$TEST_CASE_ID" '{
  "title": "Updated login test case",
  "priority": 2,
  "status": "active"
}' | jq '.'

echo
echo "PUT /execution-results/$EXECUTION_RESULT_ID"
put_json "/execution-results/$EXECUTION_RESULT_ID" '{
  "status": "failed",
  "duration_ms": 1800,
  "error": "Assertion failed",
  "logs": "Failure details"
}' | jq '.'

echo
echo "GET /execution-results/$EXECUTION_RESULT_ID"
get_call "/execution-results/$EXECUTION_RESULT_ID" | jq '.'

echo
echo "Created IDs"
echo "-----------"
echo "USER1_ID=$USER1_ID"
echo "USER2_ID=$USER2_ID"
echo "ROLE_ADMIN_ID=$ROLE_ADMIN_ID"
echo "ROLE_MEMBER_ID=$ROLE_MEMBER_ID"
echo "PROJECT_ID=$PROJECT_ID"
echo "PROJECT_MEMBER1_ID=$PROJECT_MEMBER1_ID"
echo "PROJECT_MEMBER2_ID=$PROJECT_MEMBER2_ID"
echo "WEB_APP_ID=$WEB_APP_ID"
echo "API_APP_ID=$API_APP_ID"
echo "REQUIREMENT_ID=$REQUIREMENT_ID"
echo "SUITE_ID=$SUITE_ID"
echo "TEST_CASE_ID=$TEST_CASE_ID"
echo "TEST_STEP1_ID=$TEST_STEP1_ID"
echo "TEST_STEP2_ID=$TEST_STEP2_ID"
echo "EXECUTION_ID=$EXECUTION_ID"
echo "EXECUTION_RESULT_ID=$EXECUTION_RESULT_ID"

echo
echo "Delete sequence"
echo "---------------"
echo "Run these in order if you want to clean up:"
echo "curl -X DELETE $BASE_URL/execution-results/$EXECUTION_RESULT_ID"
echo "curl -X DELETE $BASE_URL/executions/$EXECUTION_ID"
echo "curl -X DELETE $BASE_URL/test-steps/$TEST_STEP1_ID"
echo "curl -X DELETE $BASE_URL/test-steps/$TEST_STEP2_ID"
echo "curl -X DELETE $BASE_URL/test-cases/$TEST_CASE_ID"
echo "curl -X DELETE $BASE_URL/test-suites/$SUITE_ID"
echo "curl -X DELETE $BASE_URL/requirements/$REQUIREMENT_ID"
echo "curl -X DELETE $BASE_URL/app-types/$API_APP_ID"
echo "curl -X DELETE $BASE_URL/app-types/$WEB_APP_ID"
echo "curl -X DELETE $BASE_URL/project-members/$PROJECT_MEMBER1_ID"
echo "curl -X DELETE $BASE_URL/project-members/$PROJECT_MEMBER2_ID"
echo "curl -X DELETE $BASE_URL/projects/$PROJECT_ID"
echo "curl -X DELETE $BASE_URL/roles/$ROLE_ADMIN_ID"
echo "curl -X DELETE $BASE_URL/roles/$ROLE_MEMBER_ID"
echo "curl -X DELETE $BASE_URL/users/$USER1_ID"
echo "curl -X DELETE $BASE_URL/users/$USER2_ID"

echo
echo "Execution state responses"
echo "-------------------------"
echo "START_RESPONSE=$START_RESPONSE"
echo "COMPLETE_RESPONSE=$COMPLETE_RESPONSE"
