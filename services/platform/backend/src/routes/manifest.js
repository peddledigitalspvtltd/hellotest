const path = require("node:path");

// Containers preserve the repository layout for capability-owned implementations.
const serviceRoot = path.resolve(__dirname, "../../../..");
const loadServiceManifest = (service) => require(path.join(serviceRoot, service, "backend", "service.manifest.js"));

const { routeEnabled } = require("../runtime/serviceProfile");
const { capabilityNames } = require("../runtime/capabilities");
// Disabled capabilities need not be present in a selected-profile image.
const serviceManifests = capabilityNames.filter(service => routeEnabled({ service })).map(loadServiceManifest);

const routeModules = serviceManifests.flatMap((manifest) => manifest.routes);

module.exports = {
  routeModules,
  serviceManifests
};
