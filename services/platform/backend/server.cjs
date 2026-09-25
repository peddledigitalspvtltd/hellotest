// Dedicated process entry; shared lifecycle and infrastructure remain in the API runtime.
process.env.HELLOTEST_SERVICE_PROFILE = "platform";
require("./src/server");
