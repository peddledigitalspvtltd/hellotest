const permissionService = require("./permission.service");
const featureFlagService = require("./featureFlag.service");

// An optional evidence source is omitted before it is queried. An enabled host
// action does not confer permission to read another product's records.
async function getOptionalEvidenceAccess(user, projectId, permissionCodes) {
  const codes = [...new Set(permissionCodes)];
  if (!user?.id || !projectId) return Object.fromEntries(codes.map(code => [code, false]));
  const disabled = new Set(await featureFlagService.getDisabledPermissionCodes(codes));
  return Object.fromEntries(await Promise.all(codes.map(async code => [code,
    !disabled.has(code) && await permissionService.hasPermission(user, code, projectId)
  ])));
}

module.exports = { getOptionalEvidenceAccess };
