export type AutomationBuildVerificationMode = "generate_only" | "verify" | "verify_repair";
export type AutomationBuildVerificationChoice = AutomationBuildVerificationMode | "verify_cli" | "verify_repair_cli";
export type AutomationBuildVerificationDriver = "native" | "playwright_test_cli";
export type AutomationBuildBrowserDriver = "mcp";

export function automationBuildPipelineRequest({ mode, driver, canVerify, interactive }: {
  mode: AutomationBuildVerificationChoice; driver: AutomationBuildBrowserDriver; canVerify: boolean; interactive: boolean;
}) {
  const verificationMode: AutomationBuildVerificationMode = !canVerify || !interactive ? "generate_only"
    : mode === "verify_cli" ? "verify" : mode === "verify_repair_cli" ? "verify_repair" : mode;
  const verificationDriver: AutomationBuildVerificationDriver = verificationMode !== "generate_only" && (mode === "verify_cli" || mode === "verify_repair_cli")
    ? "playwright_test_cli" : "native";
  return { verification_mode: verificationMode, verification_driver: verificationDriver, browser_driver: driver };
}
