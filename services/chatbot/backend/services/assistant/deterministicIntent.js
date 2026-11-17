"use strict";

const analyticalSignal = /\b(?:why|root cause|investigate|trace|correlat\w*|timeline|regression|impact|compare|trend|coverage|readiness|risk|aggregate|count|how many|distribution|breakdown|what changed|across)\b/i;
// Display identifiers carry a numeric sequence; prose such as "requirements",
// "bugs" or "running" must never be mistaken for a direct record lookup.
const exactRecordId = /\b(?:AT|BUG|TC|TS|STORY|RUN|REQ)[-_]?\d+(?:[-_][A-Z0-9]+)*\b/i;

function plannerSkipReason({ question, responseMode, retrievalDisabled = false } = {}) {
  if (responseMode === "evidence") return "EVIDENCE_MODE";
  if (retrievalDisabled) return "RETRIEVAL_DISABLED";
  const text = String(question || "").trim();
  if (text.length <= 240 && exactRecordId.test(text) && !analyticalSignal.test(text)) return "DETERMINISTIC_LOOKUP";
  return null;
}

module.exports = { plannerSkipReason };
