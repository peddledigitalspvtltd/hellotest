type ActivationRecoverySignal = {
  code?: string | null;
  message?: string | null;
  recovery?: {
    type?: string | null;
    action?: string | null;
    field_id?: string | null;
  } | null;
};

const STRUCTURED_SCREEN_RECONCILIATION_CODES = new Set([
  "JIRA_SCREEN_FIELD_RECONCILIATION_REQUIRED",
  "SCREEN_ASSIGNMENT_ALREADY_PRESENT",
  "SCREEN_ASSIGNMENT_RECONCILED",
  "SCREEN_CONFIGURATION_RECONCILED",
  "SCREEN_FIELD_ALREADY_PRESENT",
  "SCREEN_FIELD_ASSIGNMENT_RECONCILED",
  "SCREEN_FIELD_RECONCILED",
  "SCREEN_FIELD_RECONCILED_AFTER_ERROR"
]);

// Compatibility path for activation records written before the backend
// published a dedicated reconciliation code. Keep this deliberately exact so
// unrelated Jira 400 responses never receive a reassuring presentation.
const LEGACY_SCREEN_ASSIGNMENT_MESSAGE = /^POST Jira request failed \(400\): The field with id customfield_[0-9]+ already exists on the screen[.!]?(?: \(reference [A-Za-z0-9._:-]{1,120}\))?$/i;

// Compatibility is intentionally narrow: a generic 401 may be a user session
// problem, while Jira's "scope does not match" response requires an app
// installation upgrade and cannot be fixed by retrying the setup worker.
const INSTALLATION_SCOPE_UPGRADE_MESSAGE = /^(?:\[JIRA_REQUEST_FAILED\]\s*)?(?:GET|POST|PUT|DELETE|PATCH) Jira request failed \(401\):[\s\S]{0,1600}\bscope does not match\b/i;
const STRUCTURED_INSTALLATION_SCOPE_MESSAGE = /^\[JIRA_INSTALLATION_SCOPE_UPGRADE_REQUIRED\](?:\s|$)/i;

const FIELD_CONTEXT_REVIEW_CODES = new Set([
  "FIELD_CONTEXT_COHORT_CONFLICT",
  "GLOBAL_FIELD_CONTEXT_INCOMPATIBLE",
  "UNVERIFIED_FIELD_CONTEXT_OWNERSHIP",
  "UNVERIFIED_GLOBAL_FIELD_CONTEXT"
]);

export function isScreenFieldReconciliationSignal(
  value?: ActivationRecoverySignal | string | null
) {
  if (!value) return false;
  if (typeof value === "string") return LEGACY_SCREEN_ASSIGNMENT_MESSAGE.test(value);

  if (String(value.recovery?.type || "").trim() === "jira-screen-field-reconciliation") {
    return true;
  }

  const code = String(value.code || "").trim().toUpperCase();
  if (STRUCTURED_SCREEN_RECONCILIATION_CODES.has(code)) return true;
  return LEGACY_SCREEN_ASSIGNMENT_MESSAGE.test(String(value.message || ""));
}

export function durableActivationProgress(value: unknown, ready: boolean) {
  const numeric = Number(value || 0);
  const normalized = Number.isFinite(numeric) ? Math.round(numeric) : 0;
  // 100 communicates a committed ready marker, not a best-effort estimate.
  return Math.max(0, Math.min(ready ? 100 : 99, normalized));
}

export function isFieldContextReviewRequired(
  value?: ActivationRecoverySignal | string | null
) {
  if (!value || typeof value === "string") return false;
  return FIELD_CONTEXT_REVIEW_CODES.has(String(value.code || "").trim().toUpperCase());
}

export function isGlobalFieldContextReconciliationSignal(
  value?: ActivationRecoverySignal | string | null
) {
  if (!value || typeof value === "string") return false;
  return String(value.recovery?.type || "").trim() === "jira-global-field-context-reconciliation"
    && String(value.recovery?.action || "").trim() === "retry";
}

export function isInstallationScopeUpgradeRequired(
  value?: ActivationRecoverySignal | string | null
) {
  if (!value) return false;
  if (typeof value === "string") {
    return STRUCTURED_INSTALLATION_SCOPE_MESSAGE.test(value.trim())
      || INSTALLATION_SCOPE_UPGRADE_MESSAGE.test(value.trim());
  }
  if (String(value.recovery?.type || "").trim() === "jira-installation-scope-upgrade"
    && String(value.recovery?.action || "").trim() === "upgrade-installation") return true;
  if (String(value.code || "").trim().toUpperCase() === "JIRA_INSTALLATION_SCOPE_UPGRADE_REQUIRED") return true;
  return INSTALLATION_SCOPE_UPGRADE_MESSAGE.test(String(value.message || "").trim());
}
