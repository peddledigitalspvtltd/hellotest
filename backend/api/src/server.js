require("./tracing"); // Must be loaded before other modules
const app = require("./app");

const port = Number(process.env.PORT || 3000);

app.listen({ port, host: "0.0.0.0" })
  .then(() => console.log("API running"))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
