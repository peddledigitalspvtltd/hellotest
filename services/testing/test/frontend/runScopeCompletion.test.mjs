import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRunScopeCompletion } from "../../frontend/lib/runScopeCompletion.ts";

test("scope completion counts finalized instances, including failures and blockers", () => {
  const result = summarizeRunScopeCompletion(["passed", "failed", "blocked", "running", "queued", "passed"]);
  assert.deepEqual({ total: result.total, finalized: result.finalized, percent: result.percent }, { total: 6, finalized: 4, percent: 67 });
  assert.match(result.description, /4 of 6 case instances finalized \(67%\)/);
  assert.match(result.description, /running, paused and unexecuted are incomplete/);
});

test("N/A, aborted and cancelled are final while paused and unexecuted remain incomplete", () => {
  const result = summarizeRunScopeCompletion(["skipped", "aborted", "cancelled", "paused", "pending"]);
  assert.equal(result.finalized, 3);
  assert.equal(result.percent, 60);
});

test("all failed instances are fully executed and an empty module has no completion", () => {
  assert.equal(summarizeRunScopeCompletion(["failed", "blocked"]).percent, 100);
  const empty = summarizeRunScopeCompletion([]);
  assert.equal(empty.percent, 0);
  assert.equal(empty.total, 0);
  assert.match(empty.description, /No case instances/);
});
