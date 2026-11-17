import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { AI_FAILURE_MESSAGES, resolveAiFailurePresentation } from "../../shared/generationFailure.mjs";
const require = createRequire(import.meta.url);
const { SERVICE_ERROR_CODES } = require("../../../platform/backend/src/utils/serviceErrors");

test("each service boundary failure has a user-facing cause and recovery action", () => {
  for (const code of Object.values(SERVICE_ERROR_CODES)) {
    assert.ok(AI_FAILURE_MESSAGES[code], `${code} needs explicit recovery guidance`);
    const result = resolveAiFailurePresentation({ code });
    assert.ok(result.title.length > 8); assert.ok(result.action.length > 15);
    assert.notEqual(result.title, "Generation needs attention", code);
  }
  assert.match(resolveAiFailurePresentation({ code: "LLM_QUOTA_EXCEEDED" }).action, /another configured integration|billing/);
  assert.match(resolveAiFailurePresentation({ code: "LLM_AUTHENTICATION_FAILED" }).action, /credentials/);
  assert.match(resolveAiFailurePresentation({ code: "AI_STORY_BRIEF_TOO_SHORT" }).action, /actor.*behavior.*outcome/);
  assert.match(resolveAiFailurePresentation({ code: "AI_JOB_INTERRUPTED" }).action, /trace.*explicitly/);
});

test("the breaker retry deadline counts down to zero instead of offering an immediate replay", () => {
  const failure = { code: "DEPENDENCY_CIRCUIT_OPEN", retry_at: "2026-11-17T10:00:20.000Z", retry_after_seconds: 20 };
  assert.equal(resolveAiFailurePresentation(failure, Date.parse("2026-11-17T10:00:01Z")).remainingSeconds, 19);
  assert.equal(resolveAiFailurePresentation(failure, Date.parse("2026-11-17T10:00:21Z")).remainingSeconds, 0);
  assert.equal(resolveAiFailurePresentation({ code: "LLM_RATE_LIMITED", retryAfterSeconds: 12 }).remainingSeconds, 12);
});

test("a new platform code keeps its diagnostic visible and discloses missing specific guidance", () => {
  const result = resolveAiFailurePresentation({ code: "NEW_PLATFORM_ERROR", message: "Safe diagnostic" });
  assert.equal(result.code, "NEW_PLATFORM_ERROR"); assert.equal(result.message, "Safe diagnostic");
  assert.match(result.action, /provider trace/);
});
