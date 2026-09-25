const execution = require("@hellotest/knowledge/backend/services/knowledgeExecution.service");

const assertRetrievalActive = (signal) => {
  if (signal?.aborted) throw execution.abortError();
};

const retrievalTimeout = (value, fallback = 6_000) => Number.isFinite(Number(value))
  ? Math.max(0, Math.min(60_000, Number(value))) : fallback;

const stageTimeoutError = (code) => Object.assign(new Error("A knowledge retrieval stage exceeded its time budget."), {
  code, statusCode: 504
});

const boundedRetrievalStage = async (task, { timeoutMs, signal, code = "RETRIEVAL_STAGE_TIMEOUT" } = {}) => {
  assertRetrievalActive(signal);
  if (Number(timeoutMs) <= 0) throw stageTimeoutError(code);
  try {
    return await execution.bounded(task, { timeoutMs, signal });
  } catch (error) {
    assertRetrievalActive(signal);
    if (error?.code === "DEADLINE_EXCEEDED") throw stageTimeoutError(code);
    throw error;
  }
};

module.exports = { assertRetrievalActive, boundedRetrievalStage, retrievalTimeout };
