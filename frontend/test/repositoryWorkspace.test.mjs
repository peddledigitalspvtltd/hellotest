import assert from "node:assert/strict";
import test from "node:test";
import { mergeInspectedFields, mergeRepositoryEntries, persistRepositoryScreenBundle, retainUnsavedInspectedFields } from "../src/lib/repositoryWorkspace.ts";

test("saving one screen and its fields preserves other loaded screens", () => {
  assert.deepEqual(mergeRepositoryEntries([{ id: "existing" }, { id: "screen", name: "old" }], [{ id: "screen", name: "saved" }, { id: "field" }]), [
    { id: "screen", name: "saved" }, { id: "field" }, { id: "existing" }
  ]);
});

test("screen save confirms every selected field and retains partial failures and new captures for retry", async () => {
  const fields = [{ locator: "#email" }, { locator: "#submit" }];
  const savedOrder = [];
  const result = await persistRepositoryScreenBundle({
    fields,
    saveScreen: async () => { savedOrder.push("screen"); return { id: "screen" }; },
    saveField: async (field) => {
      assert.equal(savedOrder[0], "screen");
      if (field.locator === "#submit") throw new Error("Temporarily unavailable");
      return { id: field.locator };
    }
  });
  assert.deepEqual(result.saved, [{ id: "#email" }]);
  assert.equal(result.failed[0].message, "Temporarily unavailable");
  assert.deepEqual(retainUnsavedInspectedFields([...fields, { locator: "#new" }], result.attempted, result.failed.map((item) => item.field)), [{ locator: "#submit" }, { locator: "#new" }]);
  assert.deepEqual(mergeInspectedFields(fields, [{ locator: "#email", validated: true }]), [{ locator: "#email", validated: true }, { locator: "#submit" }]);
});

test("an unconfirmed screen or field save never silently clears selected fields", async () => {
  let fieldAttempts = 0;
  await assert.rejects(persistRepositoryScreenBundle({ fields: [{ locator: "#email" }], saveScreen: async () => null, saveField: async () => { fieldAttempts += 1; return { id: "field" }; } }), /screen save was not confirmed/);
  assert.equal(fieldAttempts, 0);
  const result = await persistRepositoryScreenBundle({ fields: [{ locator: "#email" }], saveScreen: async () => ({ id: "screen" }), saveField: async () => null });
  assert.equal(result.failed.length, 1);
  assert.deepEqual(retainUnsavedInspectedFields(result.attempted, result.attempted, result.failed.map((item) => item.field)), [{ locator: "#email" }]);
});

test("captured fields save against the confirmed screen with honest validation state after the browser moves", async () => {
  const fields = [
    { locator: "#email", name: "Email", pageUrl: "https://app.test/login", validationStatus: "unverified", dom: '<input id="email">' },
    { locator: "#continue", name: "Continue", pageUrl: "https://app.test/login", validationStatus: "missing", validationWarning: "The browser has navigated to the next page." }
  ];
  const screen = { id: "screen-login", app_type_id: "app-a", metadata: { screen_name: "Login" } };
  const result = await persistRepositoryScreenBundle({
    fields,
    saveScreen: async () => screen,
    saveField: async (field, confirmedScreen) => {
      assert.equal(confirmedScreen, screen, "each field uses the durable screen identity, not a stale form name");
      return { id: field.locator, app_type_id: confirmedScreen.app_type_id, metadata: {
        screen_entry_id: confirmedScreen.id, screen_name: confirmedScreen.metadata.screen_name,
        last_validated_status: field.validationStatus, validation_warning: field.validationWarning, dom_structure: field.dom
      } };
    }
  });
  assert.equal(result.failed.length, 0);
  assert.equal(result.saved.length, 2);
  assert.deepEqual(result.saved.map((field) => field.metadata.last_validated_status), ["unverified", "missing"]);
  assert.ok(result.saved.every((field) => field.metadata.screen_entry_id === "screen-login"));
  assert.deepEqual(retainUnsavedInspectedFields(fields, result.attempted, []), []);
});

test("editing a selected field while a save is pending retains the newer draft on success or failure", () => {
  const original = { locator: "#email", name: "Email", description: "Original" };
  const edited = { ...original, name: "Account email", description: "Edited while saving" };
  assert.deepEqual(retainUnsavedInspectedFields([edited], [original], []), [edited]);
  assert.deepEqual(retainUnsavedInspectedFields([edited], [original], [original]), [edited]);
  assert.deepEqual(retainUnsavedInspectedFields([original], [original], []), []);
});
