const { defineRoute } = require("@hellotest/platform/backend/src/routes/routeDefinition");
module.exports = { id: "knowledge", routes: [defineRoute("knowledge", "knowledge", "knowledge.routes.js")] };
