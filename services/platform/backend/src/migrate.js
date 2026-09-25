// Explicit deployment job. API profiles can start in verify mode without
// importing any capability's schema implementation or running DDL.
const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");
const obsDb = require("./obsDb");
async function migrate() {
  await db.transaction(async () => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext(?))", ["hellotest:base-schema:v1"]);
    const existing = await db.prepare("SELECT to_regclass('public.users') AS name").get();
    if (!existing?.name) await db.query(fs.readFileSync(path.resolve(__dirname, "../instance-setup-data/schema-setup/schema.sql"), "utf8"));
  })();
  await require("./db/bootstrap").ensureRuntimeSchema();
  await require("./obsDb/bootstrap").ensureRuntimeSchema();
}
if (require.main === module) {
  migrate().then(() => console.log("Database migrations completed."))
    .catch(error => { console.error("Database migration failed:", error.code || error.message); process.exitCode = 1; })
    .finally(() => Promise.allSettled([db.close(), obsDb.close()]));
}
module.exports = { migrate };
