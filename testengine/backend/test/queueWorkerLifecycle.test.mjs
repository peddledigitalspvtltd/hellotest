import assert from "node:assert/strict";
import test from "node:test";
import { startQueueWorker } from "../dist/lib/queueWorker.js";

const logger = {
  info() {},
  error() {}
};

const telemetry = {
  captureLocalEvent() {}
};

test("queue readiness starts only after a successful lease poll and recovers after a poll error", async () => {
  let shouldFail = true;
  const worker = startQueueWorker(logger, telemetry, {
    isConfigured: () => true,
    queueRequired: true,
    pollIntervalMs: 60_000,
    leaseNextJob: async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("central API unavailable with sensitive multiline detail\nsecond line");
      }
      return null;
    },
    executeJob: async () => undefined
  });

  await worker.pollNow();
  const degraded = worker.getHealthSnapshot();
  assert.equal(degraded.ready, false);
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.consecutive_failures, 1);
  assert.doesNotMatch(degraded.last_error || "", /\n/);
  assert.doesNotMatch(degraded.last_error || "", /sensitive|second line/);

  await worker.pollNow();
  const recovered = worker.getHealthSnapshot();
  assert.equal(recovered.ready, true);
  assert.equal(recovered.status, "ready");
  assert.equal(recovered.consecutive_failures, 0);
  assert.equal(recovered.last_error, null);

  await worker.stop();
  assert.equal(worker.getHealthSnapshot().status, "stopped");
});

test("queue worker stop prevents new leases and drains an active execution", async () => {
  let leaseCount = 0;
  let resolveExecution;
  const executionFinished = new Promise((resolve) => {
    resolveExecution = resolve;
  });
  const worker = startQueueWorker(logger, telemetry, {
    isConfigured: () => true,
    queueRequired: true,
    pollIntervalMs: 60_000,
    pollConcurrency: 1,
    leaseNextJob: async () => {
      leaseCount += 1;
      return leaseCount === 1 ? { id: "job-1", payload: {} } : null;
    },
    executeJob: async () => executionFinished
  });

  await worker.pollNow();
  assert.equal(worker.getHealthSnapshot().active_jobs, 1);
  assert.equal(worker.getHealthSnapshot().ready, true);

  const stopping = worker.stop({ timeoutMs: 2_000 });
  assert.equal(worker.getHealthSnapshot().status, "stopping");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(leaseCount, 1);

  resolveExecution();
  await stopping;
  const stopped = worker.getHealthSnapshot();
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.ready, false);
  assert.equal(stopped.active_jobs, 0);
});

test("disabled direct-dispatch mode is ready, but a required unconfigured queue is not", async () => {
  const directOnly = startQueueWorker(logger, telemetry, {
    isConfigured: () => false,
    queueRequired: false
  });
  assert.equal(directOnly.getHealthSnapshot().status, "disabled");
  assert.equal(directOnly.getHealthSnapshot().ready, true);
  await directOnly.stop();

  const required = startQueueWorker(logger, telemetry, {
    isConfigured: () => false,
    queueRequired: true
  });
  assert.equal(required.getHealthSnapshot().status, "misconfigured");
  assert.equal(required.getHealthSnapshot().ready, false);
  await required.stop();
});


test("idle polling emits bounded summaries and immediate recovery", async () => {
  let timestamp = Date.now();
  let fail = false;
  const captured = [];
  const worker = startQueueWorker(logger, { captureLocalEvent: event => captured.push(event) }, {
    isConfigured: () => true, queueRequired: true, pollIntervalMs: 60_000,
    now: () => new Date(timestamp),
    leaseNextJob: async () => { if (fail) throw new Error("offline"); return null; },
    executeJob: async () => undefined
  });
  try {
    await worker.pollNow();
    const summaries = () => captured.filter(event => event.event_type === "testengine.queue.poll.summary");
    assert.equal(summaries().length, 1);
    for (let index = 0; index < 20; index++) { timestamp += 1000; await worker.pollNow(); }
    assert.equal(summaries().length, 1, "do not store every poll");
    timestamp += 300_000;
    await worker.pollNow();
    assert.equal(summaries().length, 2);
    assert.equal(summaries()[1].metadata.successful_polls, 21);
    assert.equal(summaries()[1].metadata.jobs_leased, 0);
    fail = true;
    await worker.pollNow();
    fail = false;
    await worker.pollNow();
    assert.equal(captured.filter(event => event.event_type === "testengine.queue.poll.recovered").length, 1);
  } finally { await worker.stop(); }
});
