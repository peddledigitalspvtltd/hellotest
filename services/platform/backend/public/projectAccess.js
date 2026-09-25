// Shared Platform reads for every API profile. The public surface remains
// narrow; membership checks and query behavior stay in the owning service.
module.exports = {
  getProject: (...args) => require("../services/project.service").getProject(...args),
  getProjectCatalog: (...args) => require("../services/project.service").getProjectCatalog(...args)
};
