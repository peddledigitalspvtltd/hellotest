const tracing = require("./tracing"); // Must load before instrumented modules.
const app = require("./app");
const db = require("./db");
const obsDb = require("./obsDb");
const cache = require("./utils/cache");
const { config } = require("./config");
const { createRuntimeLifecycle } = require("./services/runtimeLifecycle.service");

const lifecycle = createRuntimeLifecycle({
  app,
  resources: [
    { close: () => cache.close() },
    { close: () => db.close() },
    { close: () => obsDb.close() },
    { close: () => tracing.shutdown() }
  ]
});

lifecycle.registerProcessHandlers();

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => app.log.info({ port: config.port }, "HelloTest API is ready"))
  .catch((error) => lifecycle.shutdown({ reason: error, exitCode: 1, fatal: true }));
