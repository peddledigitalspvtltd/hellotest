export type RunHookType = "BEFORE_ALL" | "AFTER_ALL" | "BEFORE_SUITE" | "AFTER_SUITE" | "BEFORE_TEST" | "AFTER_TEST";
export type RunHookItemType = "suite" | "test";

export type RunHookSelection = {
  id: string;
  hookType: RunHookType;
  itemType: RunHookItemType;
  itemId: string;
  name: string;
};

const hookTypeToExecutionHookMeta = (hookType: RunHookType) => {
  switch (hookType) {
    case "BEFORE_ALL":
      return { scope: "run", phase: "pre", name: "Before Run", fail_behavior: "fail-run" };
    case "AFTER_ALL":
      return { scope: "run", phase: "post", name: "After Run", fail_behavior: "continue" };
    case "BEFORE_SUITE":
      return { scope: "suite", phase: "pre", name: "Before Suite", fail_behavior: "fail-run" };
    case "AFTER_SUITE":
      return { scope: "suite", phase: "post", name: "After Suite", fail_behavior: "continue" };
    case "BEFORE_TEST":
      return { scope: "test", phase: "pre", name: "Before Test", fail_behavior: "fail-run" };
    case "AFTER_TEST":
      return { scope: "test", phase: "post", name: "After Test", fail_behavior: "continue" };
    default:
      return { scope: "test", phase: "pre", name: "Run Hook", fail_behavior: "fail-run" };
  }
};

export function mapRunHooksToExecutionHooks(hooks: RunHookSelection[]) {
  return hooks.map((hook, index) => {
    const meta = hookTypeToExecutionHookMeta(hook.hookType);
    return {
      id: hook.id,
      name: `${meta.name}: ${hook.name}`,
      hook_type: hook.hookType,
      scope: meta.scope,
      phase: meta.phase,
      fail_behavior: meta.fail_behavior,
      target_kind: hook.itemType,
      target_id: hook.itemId,
      execution_order: index + 1
    };
  });
}


/** Restore saved case references, excluding frozen execution payloads. */
export function mapExecutionHooksToRunHooks(hooks: Array<{id:string;name?:string;scope:string;phase:string;target_kind:string;target_id:string}> = []): RunHookSelection[] {
  return hooks.filter(hook => hook.scope === "test" && ["pre","post"].includes(hook.phase) && ["test","suite"].includes(hook.target_kind)).map(hook => ({
    id:hook.id, hookType:hook.phase === "post" ? "AFTER_TEST" : "BEFORE_TEST", itemType:hook.target_kind as RunHookItemType, itemId:hook.target_id,
    name:(hook.name || hook.target_id).replace(/^(?:Before|After) Test: /, "")
  }));
}

export function mapCaseHooksToExecutionHooks(hooks: RunHookSelection[]) {
  if (hooks.some(hook => hook.hookType !== "BEFORE_TEST" && hook.hookType !== "AFTER_TEST")) throw new Error("Case hooks support Before Test and After Test only.");
  return mapRunHooksToExecutionHooks(hooks).map(hook => ({...hook,scope:"test" as const,phase:hook.phase as "pre" | "post",fail_behavior:hook.fail_behavior as "continue" | "fail-run" | "mark-blocked"}));
}
