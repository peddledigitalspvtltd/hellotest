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
