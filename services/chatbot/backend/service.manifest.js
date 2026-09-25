const { defineRoute } = require("@hellotest/platform/backend/src/routes/routeDefinition");
module.exports = { id: "chatbot", routes: [defineRoute("chatbot", "chatbot", "chatbot.routes.js")] };
