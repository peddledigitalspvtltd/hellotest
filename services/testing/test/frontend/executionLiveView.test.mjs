import test from "node:test";
import assert from "node:assert/strict";
import { caseLiveViewSession } from "../../frontend/lib/executionLiveView.ts";

const session = (test_case_id, engine_run_id, index = null, key = null) => ({ test_case_id, engine_run_id, provider: "playwright", data_set_iteration_index: index, data_set_iteration_key: key, url: `http://localhost:4313/api/v1/live-session?provider=playwright&run_id=${engine_run_id}` });
test("case Live View follows the selected case and exact data row, regardless of dispatch order", () => {
  const execution = { status: "running", live_sessions: [session("other", "other-run"), session("case", "row-two", 1, "data:2"), session("case", "row-one", 0, "data:1")] };
  assert.equal(caseLiveViewSession(execution, { test_case_id: "case", data_set_iteration_index: 0, data_set_iteration_key: "data:1" }).engine_run_id, "row-one");
  assert.equal(caseLiveViewSession(execution, { test_case_id: "case", data_set_iteration_index: 1, data_set_iteration_key: "data:2" }).engine_run_id, "row-two");
  assert.equal(caseLiveViewSession(execution, { test_case_id: "case" }), null);
  assert.equal(caseLiveViewSession(execution, { test_case_id: "not-running" }), null);
  assert.equal(caseLiveViewSession({ ...execution, status: "completed" }, { test_case_id: "other" }), null);
});

test("case Live View rejects a missing engine scope, shared VNC desktop and URLs with credentials", () => {
  for (const url of ["http://localhost:4313/api/v1/live-session", "http://localhost:7900/?run_id=run", "http://user:private@localhost:4313/api/v1/live-session?run_id=run"]) {
    assert.equal(caseLiveViewSession({ status: "running", live_sessions: [{ ...session("case", "run"), url }] }, { test_case_id: "case" }), null);
  }
});
