const { cloneDomainMetadata } = require("../domain/catalog");
const {
  PAGE_ACCESS,
  PERMISSION_GROUPS,
  ROUTE_PERMISSION_RULES
} = require("../security/permissions.catalog");
const featureFlagService = require("./featureFlag.service");

const clone = (value) => JSON.parse(JSON.stringify(value));

const routePermissionCatalog = () => ROUTE_PERMISSION_RULES.map(([method, path, permission]) => ({
  method,
  path,
  permission
}));

exports.getDomainMetadata = async () => ({
  ...cloneDomainMetadata(),
  access: {
    default_permissions: ["workspace.view"],
    pages: clone(PAGE_ACCESS),
    permission_groups: clone(PERMISSION_GROUPS),
    route_permissions: routePermissionCatalog()
  },
  feature_flags: {
    groups: clone(featureFlagService.FEATURE_GROUPS)
  }
});
