require("./tracing"); // Must be loaded before other modules
const app = require("./app");

const port = Number(process.env.PORT || 3000);

process.on("unhandledRejection", (reason) => {
  app.log.error({ error: reason }, "Unhandled promise rejection captured; API process remains alive.");
});

process.on("uncaughtException", (error) => {
  app.log.fatal({ error }, "Uncaught exception captured; API process remains alive.");
});

app.listen({ port, host: "0.0.0.0" })
  .then(() => console.log("API running"))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
