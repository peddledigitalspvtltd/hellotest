const failure = (message, code = "AUTOMATION_RECORDER_SCOPE_MISMATCH", statusCode = 403) => Object.assign(new Error(message), { code, statusCode });

/** Paired capture is user-authored input; it never supplies executable code or authority. */
exports.validatePairedRecording = ({ transaction, metadata, testCase, sessionId, recordingId, capture, userId }) => {
  if (!transaction || metadata.local_transport !== "paired-agent" || transaction.created_by !== userId || transaction.project_id !== testCase.project_id
    || metadata.test_case_id !== testCase.id || metadata.recorder_session_id !== recordingId || capture?.id !== sessionId
    || capture.purpose !== "automation-recording" || capture.status !== "stopped" || !Array.isArray(capture.actions)
    || Buffer.byteLength(JSON.stringify(capture), "utf8") > 4 * 1024 * 1024) {
    throw failure("The paired recording does not belong to this user, case and recording session.");
  }
  if (metadata.recorder_case_revision !== (Number(testCase.revision) || 0)) throw failure("The case changed while recording. Existing instructions were retained; review the case before importing this recording.", "AUTOMATION_RECORDER_CASE_CHANGED", 409);
  if (capture.start_url) {
    let url; try { url = new URL(capture.start_url); } catch { throw failure("The recording start URL is invalid.", "AUTOMATION_RECORDER_INPUT_INVALID", 422); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw failure("The recording start URL must use HTTP(S) without embedded credentials.", "AUTOMATION_RECORDER_INPUT_INVALID", 422);
  }
  return { id: sessionId, purpose: "automation-recording", status: "stopped", start_url: capture.start_url || null, actions: capture.actions, network: Array.isArray(capture.network) ? capture.network : [], action_count: capture.action_count, started_at: capture.started_at, stopped_at: capture.stopped_at };
};
