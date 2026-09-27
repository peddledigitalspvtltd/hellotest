// Pure recorder decisions: no database, browser, provider or transaction access.
const text = (value) => typeof value === "string" ? value.trim() : "";
const nativeType = (value) => ["android", "ios"].includes(text(value).toLowerCase()) ? text(value).toLowerCase() : null;
const invalid = (message, code = "AUTOMATION_RECORDER_INPUT_INVALID", statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

function resolveMobileRecorderPlatform({ applicationPlatform, steps = [], targetStepId, configuration, recordedPlatform } = {}) {
  const target = targetStepId ? steps.find((step) => step.id === targetStepId) : null;
  if (targetStepId && !target) throw invalid("The selected recorder target step no longer belongs to this case. Refresh the plan before saving.", "AUTOMATION_RECORDER_TARGET_CHANGED", 409);
  const targetPlatform = nativeType(target?.step_type);
  const recorded = nativeType(recordedPlatform);
  if (recordedPlatform && !recorded) throw invalid("The mobile recording has an unsupported platform.");
  if (target && !targetPlatform) throw invalid("Select an Android or iOS step to receive this mobile recording.");
  if (recorded && targetPlatform && recorded !== targetPlatform) throw invalid("The recording platform does not match the selected step. Restore its original platform or choose a matching target.", "AUTOMATION_RECORDER_TARGET_CHANGED", 409);
  if (recorded || targetPlatform) return recorded || targetPlatform;

  const platforms = [...new Set(steps.map((step) => nativeType(step.step_type)).filter(Boolean))];
  if (platforms.length === 1) return platforms[0];
  const targets = Array.isArray(configuration?.targets) ? configuration.targets : [];
  const configuredPlatforms = [...new Set(targets.map((target) => nativeType(target?.mobile_os)).filter(Boolean))];
  const configured = configuredPlatforms.length === 1 ? configuredPlatforms[0]
    : configuredPlatforms.length > 1 ? null : nativeType(configuration?.mobile_os || configuration?.platform_name || configuration?.platformName);
  if (configured) return configured;
  if (platforms.length > 1) throw invalid("This plan includes Android and iOS. Select a native target step or a configuration for one mobile platform before recording.");
  if (nativeType(applicationPlatform)) return nativeType(applicationPlatform);
  throw invalid("Select an Android or iOS step, or a mobile platform configuration, before recording this plan.");
}

const quote = (value) => JSON.stringify(String(value ?? ""));
const keywordComment = (keyword, args = []) => `// Keyword: ${keyword}(${args.map(quote).join(", ")})`;
const elementBlock = (selector, lines) => ["{", `  const element = await driver.$(${quote(selector)});`, ...lines.map((line) => `  ${line}`), "}"].join("\n");

function resolveTarget(action, repositoryReferences) {
  const member = repositoryReferences?.get(Number(action.index));
  if (text(member?.reference) && !text(member.locator).startsWith("point:")) return member.reference;
  if (text(action.locator)) return action.locator;
  if (action.x != null && action.y != null) return `point:${action.x},${action.y}`;
  throw invalid("A recorded tap is missing its locator or coordinates. Record the action again.");
}

function compileAction(action, platform, repositoryReferences) {
  const type = text(action?.type).toLowerCase();
  const label = platform === "ios" ? "iOS" : "Android";
  if (type === "tap") {
    const target = resolveTarget(action, repositoryReferences);
    const keyword = `${platform}.tap`;
    let code;
    if (target.startsWith("point:")) {
      const coordinates = target.slice(6).split(",");
      const [x, y] = coordinates.map(Number);
      if (coordinates.length !== 2 || coordinates.some((value) => !value.trim()) || ![x, y].every((value) => Number.isFinite(value) && value >= 0)) {
        throw invalid("Recorded tap coordinates must be finite, non-negative numbers. Record the action again.");
      }
      code = `await driver.action("pointer").move({ x: ${x}, y: ${y} }).down().up().perform();`;
    } else {
      code = elementBlock(target, ['await element.waitForDisplayed({ timeout: 10000 });', 'await element.click();']);
    }
    return { action: `Tap ${label} screen at ${action.locator || `${action.x},${action.y}`}`, expected_result: `The ${label} app accepts the tap and continues the flow.`, keyword,
      automation_code: `${keywordComment(keyword, [target])}\n${code}` };
  }
  if (type === "type") {
    const target = text(action.locator) ? resolveTarget(action, repositoryReferences) : "focused";
    const value = String(action.value ?? "");
    const keyword = `${platform}.type`;
    const code = target === "focused" ? `await driver.keys(${quote(value)});`
      : elementBlock(target, ['await element.waitForDisplayed({ timeout: 10000 });', 'await element.clearValue();', `await element.setValue(${quote(value)});`]);
    return { action: `Type text into the focused ${label} field`, expected_result: `The value is entered in the ${label} app.`, keyword,
      automation_code: `${keywordComment(keyword, [target, value])}\n${code}` };
  }
  if (type === "pressback" && platform === "android") return { action: "Press Android back", expected_result: "The Android app navigates back.", keyword: "android.pressBack",
    automation_code: `${keywordComment("android.pressBack")}\nawait driver.back();` };
  throw invalid(type === "pressback" ? "Android Back cannot be replayed on iOS." : "The recording contains an unsupported native action. Its steps were not changed.");
}

/** Build all writes before persistence, preserving other runtimes and manual prose. */
function buildMobileRecorderPlan({ caseId, applicationPlatform, existingSteps = [], capturedActions = [], targetStepId, repositoryReferences, platform }) {
  const resolvedPlatform = resolveMobileRecorderPlatform({ applicationPlatform, steps: existingSteps, targetStepId, recordedPlatform: platform });
  const candidates = capturedActions.map((action) => compileAction(action, resolvedPlatform, repositoryReferences));
  if (!candidates.length) return [];
  const matchingSteps = targetStepId ? existingSteps.filter((step) => step.id === targetStepId)
    : existingSteps.filter((step) => nativeType(step.step_type || applicationPlatform) === resolvedPlatform);
  const lastOrder = Math.max(0, ...existingSteps.map((step) => Number(step.step_order) || 0));
  let createdCount = 0;
  const groups = targetStepId ? [candidates] : candidates.map((candidate) => [candidate]);
  return groups.map((group, index) => {
    const candidate = group[0];
    const existing = matchingSteps[index];
    const code = group.map((entry) => entry.automation_code).join("\n");
    const mapping = { step_type: resolvedPlatform, automation_code: code, api_request: null };
    return {
      operation: existing ? "updated" : "created",
      stepId: existing?.id || null,
      input: existing ? mapping : { test_case_id: caseId, step_order: lastOrder + ++createdCount, action: candidate.action, expected_result: candidate.expected_result, ...mapping },
      result: {
        step_order: existing ? existing.step_order : lastOrder + createdCount,
        step_type: resolvedPlatform,
        action: existing?.action || candidate.action,
        expected_result: existing?.expected_result || candidate.expected_result,
        automation_code: code,
        keywords: [...new Set(group.map((entry) => entry.keyword))],
        has_code: true,
        has_api_request: false
      }
    };
  });
}

module.exports = { resolveMobileRecorderPlatform, buildMobileRecorderPlan };
