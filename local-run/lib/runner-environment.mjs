import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Use the same credentials as the API stack. Explicit terminal variables win,
// followed by the generated development configuration and local-run/.env.
export function createLocalRunnerEnvironment(environment = process.env, configurationFiles = [
  fileURLToPath(new URL("../../.hellotest/local.env", import.meta.url)),
  fileURLToPath(new URL("../.env", import.meta.url))
]) {
  const result = { ...environment, TESTENGINE_QUEUE_REQUIRED: "false", HELLOTEST_API_BASE_URL: "", TESTENGINE_WORKER_CLASS: "", TESTENGINE_ENGINE_CLASS: "" };
  let engineSecret = environment.TESTENGINE_SHARED_SECRET || environment.HELLOTEST_TESTENGINE_SECRET;
  for (const file of configurationFiles) {
    let contents;
    try { contents = readFileSync(file, "utf8"); }
    catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error("The local runner credential configuration could not be read.");
    }
    const credentials = {};
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?(HELLOTEST_TESTENGINE_SECRET|TESTENGINE_SHARED_SECRET|TESTENGINE_CALLBACK_SECRET)=(.*)$/);
      if (!match) continue;
      let value = match[2].trim();
      if (value.startsWith('"')) {
        const quoted = value.match(/^"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/);
        if (!quoted) throw new Error("A local runner credential has invalid quoting.");
        try { value = JSON.parse(`"${quoted[1]}"`); }
        catch { throw new Error("A local runner credential has invalid quoting."); }
      } else if (value.startsWith("'")) {
        const quoted = value.match(/^'([^']*)'\s*(?:#.*)?$/);
        if (!quoted) throw new Error("A local runner credential has invalid quoting.");
        value = quoted[1];
      } else value = value.replace(/\s+#.*$/, "").trim();
      if (value) credentials[match[1]] = value;
    }
    engineSecret ||= credentials.TESTENGINE_SHARED_SECRET || credentials.HELLOTEST_TESTENGINE_SECRET;
    for (const [name, value] of Object.entries(credentials)) if (!result[name]) result[name] = value;
  }
  // These are aliases for one credential; a lower-priority file must not
  // override a terminal HELLOTEST_TESTENGINE_SECRET through the other alias.
  if (engineSecret) result.TESTENGINE_SHARED_SECRET = engineSecret;
  return result;
}
