const { capabilityNames, isCapabilityEnabled, enabledCapabilities } = require("./capabilities");
const normalizeProfile = (value) => {
  const normalized = String(value ?? "all").trim().toLowerCase() || "all";
  if (normalized !== "all" && !capabilityNames.includes(normalized)) {
    throw new Error(`Invalid HELLOTEST_SERVICE_PROFILE; expected all or ${capabilityNames.join(", ")}`);
  }
  return normalized;
};

const profile = normalizeProfile(process.env.HELLOTEST_SERVICE_PROFILE || process.env.SERVICE_PROFILE);

const isRouteEnabledFor = (profileName, route) => {
  const normalized = normalizeProfile(profileName);
  return normalized === "all" || normalized === (route.service || "manual");
};

const routeEnabled = (route) => isRouteEnabledFor(profile, route) && isCapabilityEnabled(route.service || "manual");

const metadata = () => ({
  name: `hellotest-${profile === "all" ? "api" : `${profile}-api`}`,
  profile,
  capabilities: [...enabledCapabilities],
  deployable: true
});

module.exports = { normalizeProfile, profile, isRouteEnabledFor, routeEnabled, metadata };
