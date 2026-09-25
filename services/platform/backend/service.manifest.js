const { defineRoute } = require("./src/routes/routeDefinition");
module.exports = {
  id: "platform",
  routes: [
    defineRoute("platform", "workspace", "domainMetadata.routes.js"),
    defineRoute("platform", "workspace", "admin.routes.js"),
    defineRoute("platform", "workspace", "adminUi.routes.js"),
    defineRoute("platform", "workspace", "adminPortal.routes.js"),
    defineRoute("platform", "auth", "auth.routes.js"),
    defineRoute("platform", "people", "users.routes.js"),
    defineRoute("platform", "people", "roles.routes.js"),
    defineRoute("platform", "workspace", "projects.routes.js"),
    defineRoute("platform", "people", "projectMembers.routes.js"),
    defineRoute("platform", "environment", "appTypes.routes.js"),
    defineRoute("platform", "workspace", "settings.routes.js"),
    defineRoute("platform", "workspace", "featureFlags.routes.js"),
    defineRoute("platform", "ops", "notifications.routes.js"),
    defineRoute("platform", "execution", "attachments.routes.js"),
    defineRoute("platform", "workspace", "comments.routes.js"),
    defineRoute("platform", "ops", "workspaceTransactions.routes.js")
  ]
};
