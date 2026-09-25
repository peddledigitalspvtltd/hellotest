const { cloneDomainMetadata } = require("../src/domain/catalog");
const {
  PAGE_ACCESS,
  PERMISSION_GROUPS,
  ROUTE_PERMISSION_RULES
} = require("../src/security/permissions.catalog");
const featureFlagService = require("./featureFlag.service");
const dropdownCatalogService = require("./dropdownCatalog.service");

const clone = (value) => JSON.parse(JSON.stringify(value));

const routePermissionCatalog = () => ROUTE_PERMISSION_RULES.map(([method, path, permission]) => ({
  method,
  path,
  permission
}));

exports.getDomainMetadata = async () => {
  const [permissionGroups, dropdownCatalog] = await Promise.all([
    featureFlagService.filterPermissionGroupsByEnabledFeatures(PERMISSION_GROUPS),
    dropdownCatalogService.getCatalog()
  ]);
  const routePermissions = routePermissionCatalog();
  const disabledRoutePermissionCodes = new Set(await featureFlagService.getDisabledPermissionCodes(routePermissions.map((route) => route.permission)));

  return {
    ...dropdownCatalogService.applyToDomainMetadata(cloneDomainMetadata(), dropdownCatalog),
    access: {
      default_permissions: ["workspace.view"],
      pages: clone(PAGE_ACCESS),
      permission_groups: clone(permissionGroups),
      route_permissions: routePermissions.filter((route) => !disabledRoutePermissionCodes.has(route.permission))
    },
    feature_flags: {
      groups: clone(featureFlagService.FEATURE_GROUPS)
    }
  };
};
