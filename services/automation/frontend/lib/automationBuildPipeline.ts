export type AutomationBuildVerificationMode = "generate_only" | "verify" | "verify_repair";
export type AutomationBuildVerificationChoice = AutomationBuildVerificationMode | "verify_cli" | "verify_repair_cli" | "auto";
export type AutomationBuildVerificationDriver = "native" | "playwright_test_cli";
export type AutomationBuildBrowserDriver = "mcp";

export function resolveBuildVerificationChoice(mode: AutomationBuildVerificationChoice, canRun: boolean, hasEnvironment: boolean, browserLocation: "local" | "remote" = "remote") {
  if (!canRun || (browserLocation === "local" && (mode === "verify_cli" || mode === "verify_repair_cli"))) return "generate_only";
  return mode === "auto" ? hasEnvironment ? "verify" : "generate_only" : mode;
}

export function automationBuildPipelineRequest({ mode, driver, canVerify, interactive, hasEnvironment = false }: {
  mode: AutomationBuildVerificationChoice; driver: AutomationBuildBrowserDriver; canVerify: boolean; interactive: boolean; hasEnvironment?: boolean;
}) {
  const choice = resolveBuildVerificationChoice(mode, canVerify && interactive, hasEnvironment);
  const verificationMode: AutomationBuildVerificationMode = choice === "verify_cli" ? "verify" : choice === "verify_repair_cli" ? "verify_repair" : choice;
  const verificationDriver: AutomationBuildVerificationDriver = verificationMode !== "generate_only" && (mode === "verify_cli" || mode === "verify_repair_cli")
    ? "playwright_test_cli" : "native";
  return { verification_mode: verificationMode, verification_driver: verificationDriver, browser_driver: driver };
}

export function automationBuildRuntimeRequest(runtimes: readonly string[], browserLocation: "local" | "remote", interactive: boolean, pipeline: ReturnType<typeof automationBuildPipelineRequest>) {
  if (!runtimes.includes("web")) return {};
  const browser = { browser_location: browserLocation, allow_browser_actions: interactive };
  if (runtimes.every(runtime => runtime === "web")) {
    const options = browserLocation === "local" && pipeline.verification_driver === "playwright_test_cli"
      ? { ...pipeline, verification_mode: "generate_only" as const, verification_driver: "native" as const }
      : pipeline;
    return { ...browser, ...options };
  }
  return {
    ...browser, browser_driver: pipeline.browser_driver, verification_mode: "generate_only" as const
  };
}
