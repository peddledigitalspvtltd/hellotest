import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Configuration models and API preserve an ordered typed target matrix", async () => {
  const [types, api] = await Promise.all([
    readSource("../src/types.ts"),
    readSource("../src/lib/api.ts")
  ]);
  const targetTypeStart = types.indexOf("export type TestConfigurationTarget");
  const configurationTypeStart = types.indexOf("export type TestConfiguration =", targetTypeStart);
  const targetType = types.slice(targetTypeStart, configurationTypeStart);
  const configurationType = types.slice(configurationTypeStart, types.indexOf("export type TestDataSetMode", configurationTypeStart));
  const configurationApiStart = api.indexOf("testConfigurations:");
  const configurationApi = api.slice(configurationApiStart, api.indexOf("testDataSets:", configurationApiStart));

  assert.ok(targetTypeStart >= 0 && configurationTypeStart > targetTypeStart);
  for (const field of ["id", "os", "browser", "mobile_os", "version"]) {
    assert.match(targetType, new RegExp(`${field}: string`));
  }
  assert.match(configurationType, /targets: TestConfigurationTarget\[\]/);
  assert.match(configurationApi, /create:[\s\S]*targets\?: TestConfiguration\["targets"\]/);
  assert.match(configurationApi, /update:[\s\S]*targets: TestConfiguration\["targets"\]/);
});

test("Configuration authoring uses a semantic, operable target-row matrix", async () => {
  const page = await readSource("../src/pages/TestEnvironmentPage.tsx");
  const formStart = page.indexOf("function ConfigurationForm");
  const formEnd = page.indexOf("function DataSetForm", formStart);
  const form = page.slice(formStart, formEnd > formStart ? formEnd : undefined);

  assert.ok(formStart >= 0);
  assert.match(form, /className="configuration-matrix"/);
  assert.match(form, /<table className="configuration-matrix-table">/);
  assert.match(form, /<caption className="sr-only">Configuration target rows<\/caption>/);
  for (const heading of ["Host OS", "Browser", "Mobile OS", "Version", "Actions"]) {
    assert.match(form, new RegExp(`<th[^>]*>${heading}<\\/th>`));
  }
  for (const label of [
    "Add target row",
    "Duplicate target row",
    "Move target row",
    "Remove target row"
  ]) {
    assert.match(form, new RegExp(`aria-label=\\{?[^\\n]*${label}`));
  }
  assert.match(form, /data-label="Host OS"/);
  assert.match(form, /data-label="Browser"/);
  assert.match(form, /data-label="Mobile OS"/);
  assert.match(form, /data-label="Version"/);
  assert.match(form, /configuration-matrix-default/);
});

test("Configuration search and save payloads include every target row", async () => {
  const page = await readSource("../src/pages/TestEnvironmentPage.tsx");
  const searchStart = page.indexOf("const filteredConfigurations");
  const searchEnd = page.indexOf("const filteredDataSets", searchStart);
  const search = page.slice(searchStart, searchEnd);
  const createStart = page.indexOf("const handleCreateConfiguration");
  const updateStart = page.indexOf("const handleUpdateConfiguration", createStart);
  const create = page.slice(createStart, updateStart);
  const deleteStart = page.indexOf("const handleDeleteConfiguration", updateStart);
  const update = page.slice(updateStart, deleteStart);

  assert.ok(searchStart >= 0 && searchEnd > searchStart);
  assert.match(search, /getConfigurationTargets\(configuration\)/);
  for (const field of ["target.os", "target.browser", "target.mobile_os", "target.version"]) {
    assert.match(search, new RegExp(field.replace(".", "\\.")));
  }

  assert.ok(createStart >= 0 && updateStart > createStart && deleteStart > updateStart);
  assert.match(create, /normalizeConfigurationTargets\(createConfigurationDraft\.targets\)/);
  assert.match(create, /targets,/);
  assert.match(update, /normalizeConfigurationTargets\(configurationDraft\.targets\)/);
  assert.match(update, /targets,/);
});

test("Configuration matrix and cards remain responsive, accessible, and theme-aware", async () => {
  const styles = await readSource("../src/styles.css");

  assert.match(styles, /\.resource-modal-card--configuration\s*\{[^}]*width:\s*min\(76rem,/);
  assert.match(styles, /\.configuration-matrix-table\s*\{[^}]*width:\s*100%/);
  assert.match(styles, /\.configuration-matrix-action,[\s\S]*min-width:\s*2\.75rem;[\s\S]*min-height:\s*2\.75rem;/);
  assert.match(styles, /\.configuration-matrix-action:focus-visible,[\s\S]*outline:/);
  assert.match(styles, /:root\[data-theme="dark"\] \.configuration-matrix/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.configuration-matrix-table td\[data-label\]::before[\s\S]*content:\s*attr\(data-label\)/);
  assert.match(styles, /\.configuration-card-open\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*text-align:\s*left;/);
  assert.match(styles, /\.configuration-card-open:focus-visible/);
});
