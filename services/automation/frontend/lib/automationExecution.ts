import type { api } from "@hellotest/platform/frontend/src/lib/api";

export type AutomationRunMode = "local" | "remote";
type RunInput = Parameters<typeof api.executions.createLocalRun>[0];
type ExecutionClient = Pick<typeof api.executions, "createLocalRun" | "create">;

/** Execution creation owns dispatch; starting a remote run again is a duplicate. */
export async function handoverAutomationRun(client: ExecutionClient, mode: AutomationRunMode, input: RunInput) {
  const test_case_ids = [...new Set(input.test_case_ids)];
  if (!test_case_ids.length) throw new Error("Select at least one automation case before running.");
  const payload = { ...input, test_case_ids };
  if (mode === "local") return client.createLocalRun(payload);
  return client.create({ ...payload, execution_mode: "remote" });
}
