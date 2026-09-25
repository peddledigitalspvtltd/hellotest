const INSECURE_DEFAULTS = new Set([
  "admin",
  "hellotest-dev-secret",
  "hellotest-local-dev-secret",
  "hellotest-mobile-engine-dev-secret",
  "hellotest-testengine-dev-secret",
  "hellotest-verification-secret",
  "change-me"
]);

const isProduction = () => process.env.NODE_ENV === "production";

const validateProductionSecret = (value, label, minimumLength = 32) => {
  const normalized = String(value || "").trim();

  if (!normalized) {
    throw new Error(`${label} is required when NODE_ENV=production`);
  }

  if (INSECURE_DEFAULTS.has(normalized.toLowerCase()) || normalized.length < minimumLength) {
    throw new Error(`${label} must be a non-default secret of at least ${minimumLength} characters in production`);
  }

  return normalized;
};

const resolveSecret = ({ names, label, developmentFallback, minimumLength = 32, candidates = [] }) => {
  const configured = [
    ...candidates,
    ...names.map((name) => process.env[name])
  ].map((value) => String(value || "").trim()).find(Boolean);

  if (isProduction()) {
    return validateProductionSecret(configured, label, minimumLength);
  }

  return configured || developmentFallback;
};

const resolveSessionSecret = () => resolveSecret({
  names: ["SESSION_SECRET"],
  label: "SESSION_SECRET",
  developmentFallback: "hellotest-dev-secret"
});

const resolveTestEngineSecret = (...candidates) => resolveSecret({
  names: ["TESTENGINE_SHARED_SECRET", "HELLOTEST_TESTENGINE_SECRET"],
  label: "Test Engine shared secret",
  developmentFallback: "hellotest-testengine-dev-secret",
  candidates
});

const resolveMobileEngineSecret = (...candidates) => resolveSecret({
  names: ["MOBILE_ENGINE_SHARED_SECRET", "HELLOTEST_MOBILE_ENGINE_SECRET"],
  label: "Mobile Engine shared secret",
  developmentFallback: "hellotest-mobile-engine-dev-secret",
  candidates
});

module.exports = {
  INSECURE_DEFAULTS,
  isProduction,
  resolveSecret,
  resolveSessionSecret,
  resolveMobileEngineSecret,
  resolveTestEngineSecret,
  validateProductionSecret
};
