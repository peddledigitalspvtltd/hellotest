// Store actionable categories, never the provider response body (which may
// echo prompts, credentials, account identifiers or retrieved evidence).
const modelHttpError = (status, responseText = "", retryAfterMs = null) => {
  let code = "MODEL_UNAVAILABLE";
  if ([401, 403].includes(status)) code = "MODEL_AUTHENTICATION_FAILED";
  else if ([408, 504].includes(status)) code = "MODEL_TIMEOUT";
  else if (status === 404) code = "MODEL_NOT_FOUND";
  else if (status === 402) code = "MODEL_QUOTA_EXCEEDED";
  else if (status === 429) code = /insufficient_quota|quota_exceeded|billing_hard_limit|billing_not_active|payment_required|credits?[_\s]+(?:exhausted|insufficient)/i.test(responseText) ? "MODEL_QUOTA_EXCEEDED" : "MODEL_RATE_LIMITED";
  else if (status === 413 || ([400, 422].includes(status) && /context_length_exceeded|maximum context length|context window|tokens per minute/i.test(responseText))) code = "MODEL_CONTEXT_LIMIT";
  else if ([400, 422].includes(status)) code = /model_not_found|invalid_model/i.test(responseText) ? "MODEL_NOT_FOUND" : "MODEL_REQUEST_REJECTED";
  return Object.assign(new Error(`The answer provider returned HTTP ${status}.`), { code, upstreamStatus: status,
    ...(Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? { retryAfterMs } : {}) });
};

const modelFailureCode = (error) => {
  if (/TIMEOUT|TIMED_OUT|DEADLINE_EXCEEDED/.test(error?.code || "") || error?.name === "TimeoutError") return "MODEL_TIMEOUT";
  if (error?.code === "ERR_CONTRACT_VALIDATION") return "MODEL_INVALID_RESPONSE";
  return /^MODEL_[A-Z_]+$/.test(error?.code || "") ? error.code : "MODEL_UNAVAILABLE";
};

const modelFailureMessage = (code) => ({
  MODEL_TIMEOUT: "Sources were found, but the answer model took too long. The retrieved evidence is available below.",
  MODEL_AUTHENTICATION_FAILED: "Sources were found, but the answer provider rejected the connection credentials. Check the selected model connection.",
  MODEL_NOT_FOUND: "Sources were found, but the selected answer model is unavailable. Check the model in the selected connection.",
  MODEL_CONFIGURATION_ERROR: "Sources were found, but the answer provider URL is invalid. Check the selected model connection.",
  MODEL_RATE_LIMITED: "Sources were found, but the answer provider is limiting requests. Try again shortly; the evidence is available below.",
  MODEL_QUOTA_EXCEEDED: "Sources were found, but the answer provider's quota is exhausted. Check the selected connection's quota.",
  MODEL_REQUEST_REJECTED: "Sources were found, but the selected model rejected the answer request. Check its connection and model compatibility.",
  MODEL_CONTEXT_LIMIT: "Sources were found, but they exceed the selected model's request limit. Narrow the source selection or choose a model connection with a larger limit.",
  MODEL_EMPTY_RESPONSE: "Sources were found, but the model returned no answer. The retrieved evidence is available below.",
  MODEL_OUTPUT_TRUNCATED: "Sources were found, but the model's answer was incomplete. The retrieved evidence is available below.",
  MODEL_INVALID_RESPONSE: "Sources were found, but the model's answer could not be validated. The retrieved evidence is available below."
})[code] || "Sources were found, but the answer model is currently unavailable. The retrieved evidence is available below.";

const publicKnowledgeError = (error) => {
  if (/^MODEL_[A-Z_]+$/.test(error?.code || "")) {
    return modelFailureMessage(error.code).replace("The retrieved evidence is available below.", "Try again or select another configured model.").replace("the evidence is available below.", "try again shortly.");
  }
  return ({
  ASSISTANT_SETUP_TIMEOUT: "The conversation could not be prepared in time. Try again with the same question.",
  ANSWER_AUTHORIZATION_TIMEOUT: "The source access check took too long. Try again to verify current access before showing an answer.",
  DEADLINE_EXCEEDED: "The request took too long. Try again or narrow the selected sources."
})[error?.code] || (error?.statusCode && error.statusCode < 500 ? error.message : "The knowledge request could not be completed. Try again.");
};

module.exports = { modelHttpError, modelFailureCode, modelFailureMessage, publicKnowledgeError };
