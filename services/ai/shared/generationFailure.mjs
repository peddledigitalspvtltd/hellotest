const messages = {
  LLM_AUTHENTICATION_FAILED: ["Provider credentials were rejected", "Check the integration credentials, model access and endpoint, or choose another integration."],
  LLM_QUOTA_EXCEEDED: ["Provider quota is exhausted", "Choose another configured integration or restore the provider billing allowance."],
  LLM_RATE_LIMITED: ["Provider rate limit reached", "Wait for the retry window, then retry this request."],
  DEPENDENCY_CIRCUIT_OPEN: ["Provider connection is recovering", "Wait for the recovery countdown before retrying."],
  DEPENDENCY_NETWORK_ERROR: ["Provider connection failed", "Check the configured endpoint and network connection, then retry."],
  DEPENDENCY_TIMEOUT: ["Provider response timed out", "Review the saved progress. Use a smaller scope or another configured model."],
  LLM_TIMEOUT: ["Provider response timed out", "Review the saved progress. Use a smaller scope or another configured model."],
  DEPENDENCY_UNAVAILABLE: ["Provider is temporarily unavailable", "Check the integration status or choose another configured model."],
  LLM_PROVIDER_UNAVAILABLE: ["Provider is temporarily unavailable", "Check the integration status or choose another configured model."],
  DEPENDENCY_CONFIGURATION_ERROR: ["Provider connection needs configuration", "Check the provider endpoint and request configuration before retrying."],
  REQUEST_CANCELLED: ["Generation was stopped", "Review any saved proposals before starting a new request."],
  AI_JOB_CANCELLED: ["Generation was stopped", "Review any saved proposals before starting a new request."],
  AI_JOB_INTERRUPTED: ["The previous request has an uncertain outcome", "Review saved proposals and the provider trace before explicitly starting a new request."],
  AI_PERMISSION_REVOKED: ["AI access changed", "Ask a project administrator to restore access before retrying."],
  AI_STORY_BRIEF_TOO_SHORT: ["The Story brief needs more detail", "Add the actor, intended behavior and observable expected outcome."],
  AI_STORY_EVIDENCE_REQUIRED: ["More Story evidence is needed", "Add the actor, intended behavior and expected outcome, or provide a clearer reference image."],
  AI_AUTHORING_CONTEXT_REQUIRED: ["More case context is needed", "Select a Story or describe the behavior and expected outcome to test."],
  AI_DEFECT_EVIDENCE_REQUIRED: ["More incident evidence is needed", "Describe what happened and what should happen, or attach a clearer screenshot."],
  AI_AUTHORING_STORY_MISMATCH: ["The brief does not match the selected Story", "Select the matching Story or update your instructions."],
  AI_AUTHORING_TASK_MISMATCH: ["The brief is outside this feature", "Describe the test authoring task to complete."],
  LLM_MODEL_NOT_FOUND: ["The configured model was not found", "Check the integration model name and endpoint, or select another integration."],
  AI_VISION_UNSUPPORTED: ["This model cannot read the supplied image", "Select a vision capable integration or remove the image."],
  LLM_JSON_INSTRUCTION_REQUIRED: ["JSON instructions are missing", "Review this feature’s saved output instructions in AI Controls."],
  LLM_REQUEST_REJECTED: ["Provider rejected the request settings", "Review the model, output format and AI Controls configuration."],
  AI_INSTRUCTION_MISSING: ["AI instructions are incomplete", "Restore the missing feature instruction in AI Controls before retrying."],
  AI_FEATURE_UNMAPPED: ["This feature has no AI configuration", "Configure the feature in AI Controls before retrying."],
  AI_MCP_QUERY_REQUIRED: ["Project context could not be retrieved", "Check the project context connection and retry after it recovers."],
};
for (const [code, pair] of Object.entries({
  DEPENDENCY_REQUEST_CANCELLED: messages.AI_JOB_CANCELLED,
  DEPENDENCY_INVALID_RESPONSE: ["Provider returned an invalid response", "Check the integration endpoint and provider status before retrying."],
  DEPENDENCY_OVERLOADED: ["Provider capacity is busy", "Wait for capacity to recover or choose another integration."],
  DEPENDENCY_RESPONSE_TOO_LARGE: ["Provider response exceeded the safety limit", "Generate fewer proposals or narrow the requested output."],
  DEPENDENCY_REQUEST_REJECTED: messages.LLM_REQUEST_REJECTED,
  AI_MODEL_REQUIRED: ["No model is configured", "Choose an active integration before generating a proposal."],
  AI_ASSESSMENT_FAILED: ["The configured model could not complete the assessment", "Review the provider trace or choose another active integration."],
  AI_TEST_CASE_RESPONSE_INVALID: ["The case proposal was incomplete", "Narrow the requested cases or choose another configured model."],
  DEADLINE_EXCEEDED: messages.DEPENDENCY_TIMEOUT
})) messages[code] = pair;
for (const code of ["LLM_REQUEST_TOO_LARGE", "LLM_RATE_LIMIT_REQUEST_TOO_LARGE", "LLM_CONTEXT_LIMIT", "AI_INPUT_BUDGET_EXCEEDED", "AI_INSTRUCTION_BUDGET"]) messages[code] = ["The request exceeds the model budget", "Reduce attachments, linked records or brief length, or choose an integration with enough capacity."];
for (const code of ["AI_OUTPUT_TRUNCATED", "AI_AUTHORING_VALIDATION_TRUNCATED"]) messages[code] = ["The model reached its output limit", "Generate fewer proposals or review the feature’s output token budget in AI Controls."];
for (const code of ["AI_INVALID_JSON", "AI_OUTPUT_SCHEMA_VIOLATION", "AI_MANAGED_SCHEMA_INVALID", "AI_NATIVE_CONTRACT_INVALID", "AI_STORY_RESPONSE_INVALID", "AI_STORY_REVIEW_INCOMPLETE", "AI_GROOMING_OUTPUT_INVALID", "AI_DEFECT_RESPONSE_INVALID", "AI_AUTHORING_VALIDATION_FAILED"]) messages[code] = ["The returned proposal was incomplete", "The bounded output correction did not produce a valid proposal. Narrow the brief or choose another configured model."];
export const AI_FAILURE_MESSAGES = Object.freeze(messages);
export function resolveAiFailurePresentation(value, now = Date.now()) {
  const item = value && typeof value === "object" ? value : {};
  const code = item.code || item.error_code || "AI_GENERATION_FAILED";
  const [title, action] = messages[code] || ["Generation needs attention", "Review the diagnostic message and provider trace before retrying."];
  const retryAt = Date.parse(item.retry_at || "");
  const seconds = Number.isFinite(retryAt) ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : Math.max(0, Math.ceil(Number(item.retry_after_seconds ?? item.retryAfterSeconds ?? item.details?.retry_after_seconds ?? 0) || 0));
  return { code, title, action, message: typeof item.message === "string" ? item.message : "", remainingSeconds: seconds };
}
