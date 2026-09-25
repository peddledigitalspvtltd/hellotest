const { dependencies, feature_owners: featureOwners } = require('../../../../capabilities.json');
const capabilityNames = Object.freeze(Object.keys(dependencies));

// Deployment availability is an upper bound on administrator feature flags.
// Dependencies are explicit foundations; selecting Automation never starts Manual.
const resolveCapabilities = (value) => {
  const requested = String(value ?? 'all').trim().toLowerCase();
  if (!requested || requested === 'all') return new Set(capabilityNames);
  const enabled = new Set();
  const visiting = new Set();
  const include = (name) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unknown deployment capability: ${name}`);
    if (visiting.has(name)) throw new Error(`Circular capability dependency: ${name}`);
    if (enabled.has(name)) return;
    visiting.add(name);
    for (const dependency of dependencies[name]) include(dependency);
    visiting.delete(name);
    enabled.add(name);
  };
  include('platform');
  for (const name of requested.split(',').map(name => name.trim())) include(name);
  return enabled;
};
const enabledCapabilities = resolveCapabilities(process.env.HELLOTEST_ENABLED_CAPABILITIES);
const isCapabilityEnabled = (name) => enabledCapabilities.has(name);
const applyCapabilityAvailability = (flags, enabled = enabledCapabilities) => Object.fromEntries(
  Object.entries(flags).map(([key, value]) => [key, value === true && Boolean(featureOwners[key]) && enabled.has(featureOwners[key])])
);
module.exports = { capabilityNames, resolveCapabilities, enabledCapabilities, isCapabilityEnabled, applyCapabilityAvailability, featureOwners };
