const { createHash } = require("node:crypto");

const stable = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
  : item);

/** Save once, then attempt dispatch. A rejected start still gives the caller
 * an execution to inspect or resume. Concurrent recovery uses its normal Run
 * revision transition, which prevents dispatching a saved Run twice. */
async function createRecoverableRemoteExecution({ input, actorId, requestId, create, start, onDispatchError }) {
  if (typeof requestId !== "string" || !/^[\w-]{8,200}$/.test(requestId)) {
    throw Object.assign(new Error("Supply a valid Run request identifier."), { statusCode: 400, code: "EXECUTION_REQUEST_INVALID" });
  }
  const requestHash = createHash("sha256").update(stable([actorId, requestId, input])).digest("hex");
  const created = await create({
    ...input, created_by: actorId, execution_mode: "manual", source_idempotency_key: `remote-run:${requestHash}`
  });
  if (created.idempotent_replay) return created;
  try {
    const dispatch = await start(created.id, { initiated_by: actorId, execution_mode: "remote", engine_base_url: input.engine_base_url });
    return { ...created, ...dispatch };
  } catch (error) {
    onDispatchError?.(error, created.id);
    return {
      ...created,
      dispatch_notice: error?.code === "TESTENGINE_REQUIRED"
        ? "Configure an active Test Engine integration for this project."
        : "Check the saved Run’s execution profile and Test Engine connection."
    };
  }
}

module.exports = { createRecoverableRemoteExecution };
