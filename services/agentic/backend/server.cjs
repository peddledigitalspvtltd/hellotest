// Dedicated process entry; shared lifecycle and infrastructure remain in the API runtime.
process.env.HELLOTEST_SERVICE_PROFILE = "agentic";
require("@hellotest/platform/backend/src/server");
