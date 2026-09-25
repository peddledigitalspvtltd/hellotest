const path = require("node:path");

const defineRoute = (service, area, filename) => {
  const load = () => require(path.resolve(__dirname, "../../../..", service, "backend", "routes", filename));
  return {
    service,
    area,
    source: `services/${service}/backend/routes/${filename}`,
    load,
    // Compatibility for internal tools that historically read route.module.
    get module() {
      return load();
    }
  };
};

module.exports = { defineRoute };
