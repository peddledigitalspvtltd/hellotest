import assert from "node:assert/strict";
import test from "node:test";
import { automationCaseMappingStatus, automationMappingFieldsEqual, buildAutomationEditorStep, cacheCreatedAutomationStep, getAutomationStepInsertion, getAutomationStepReorder, isAutomationStepMapped, refreshCreatedAutomationStep, resolveAutomationMappingSave } from "../../frontend/lib/automationStepPersistence.ts";

const step = (id, overrides = {}) => ({ id, step_order: Number(id) || 1, test_case_id: "case", action: "Describe a behavior", expected_result: "It works", step_type: "web", automation_code: "", api_request: null, ...overrides });

test("a plan is ready only when every step has a real mapping", () => {
  const mapped = step("1", { automation_code: 'await web.click("Login.Submit");' });
  const prose = step("2");
  assert.equal(automationCaseMappingStatus([]), "incomplete");
  assert.equal(automationCaseMappingStatus([mapped]), "ready");
  assert.equal(automationCaseMappingStatus([mapped, prose]), "incomplete");
  assert.equal(isAutomationStepMapped(step("3", { automation_code: "// @hellotest-options optional\n/* mapping pending */" })), false);
  assert.equal(isAutomationStepMapped(step("4", { step_type: "api", api_request: { method: "GET", url: "@t.baseUrl/orders" } })), true);
  assert.equal(isAutomationStepMapped(step("4", { step_type: "api", api_request: { method: "GET", url: "" } })), false);
});

test("prose changes preserve mapping identity, while executable argument changes are detected", () => {
  const original = { name: "Before", expected_result: "Before result", step_type: "web", keyword: "web.fill", objectRef: "Login.Email", value: "@t.email" };
  assert.equal(automationMappingFieldsEqual(original, { ...original, name: "After", expected_result: "After result" }), true);
  for (const changed of [{ keyword: "web.click" }, { objectRef: "Login.Password" }, { value: "literal" }, { step_type: "api" }]) assert.equal(automationMappingFieldsEqual(original, { ...original, ...changed }), false);
});

test("new preconditions reuse their group and are inserted before main steps", () => {
  const steps = [step("1", { group_id: "setup", group_name: "Preconditions", group_kind: "local" }), step("2", { group_id: "setup", group_name: "Preconditions", group_kind: "local" }), step("3")];
  const insertion = getAutomationStepInsertion(steps, { mode: "end", stepId: "" }, true);
  assert.equal(insertion.insertionIndex, 2);
  assert.equal(insertion.groupSource.group_id, "setup");
  assert.equal(getAutomationStepInsertion(steps, { mode: "before", stepId: "1" }, true).insertionIndex, 0);
  assert.equal(getAutomationStepInsertion(steps, { mode: "before", stepId: "1" }, false).insertionIndex, 2);
});

test("insertion preserves selected group identity without grouping standalone steps implicitly", () => {
  const shared = step("2", { group_id: "checkout", group_name: "Checkout", group_kind: "reusable", reusable_group_id: "shared-checkout" });
  const steps = [step("1"), shared];
  const insertion = getAutomationStepInsertion(steps, { mode: "after", stepId: "2" }, false);
  assert.equal(insertion.insertionIndex, 2);
  assert.equal(insertion.groupSource.reusable_group_id, "shared-checkout");
  assert.equal(getAutomationStepInsertion(steps, { mode: "after", stepId: "1" }, false).groupSource.group_id, undefined);
  assert.equal(getAutomationStepInsertion(steps, { mode: "end", stepId: "" }, true).insertionIndex, 0);
});

test("scalar edits cannot erase a recorded instruction sequence or a handwritten expression", () => {
  const previousMappingCode = 'await web.fill("Login.Email", "@t.email");';
  const nextMappingCode = 'await web.fill("Login.Email", "@t.otherEmail");';
  for (const currentCode of [
    `${previousMappingCode}\nawait web.click("Login.Submit");`,
    'const email = params["t.email"].toLowerCase();\nawait web.fill("Login.Email", email);',
    'await web.fill("Login.Email", account.email);',
    `// Preserve this instruction's context\n${previousMappingCode}`,
    `if (enabled) { ${previousMappingCode} }`
  ]) {
    assert.deepEqual(resolveAutomationMappingSave({ currentCode, previousMappingCode, nextMappingCode, mappingUnchanged: false }), {
      code: currentCode, requiresProgramEditor: true
    });
    assert.deepEqual(resolveAutomationMappingSave({ currentCode, previousMappingCode, nextMappingCode, mappingUnchanged: true }), {
      code: currentCode, requiresProgramEditor: false
    }, "changing a section name or expected result retains the complete program byte for byte");
  }
});

test("scalar edits safely regenerate their original program and tolerate owned options metadata", () => {
  const previousMappingCode = 'await web.click("Login.Submit");';
  const nextMappingCode = 'await web.click("Login.Cancel");';
  for (const currentCode of ["", " \n ", previousMappingCode, `// @hellotest-options optional skip\r\n${previousMappingCode}\r\n`, "// @hellotest-options skip\n"]) {
    assert.deepEqual(resolveAutomationMappingSave({ currentCode, previousMappingCode, nextMappingCode, mappingUnchanged: false }), {
      code: nextMappingCode, requiresProgramEditor: false
    });
  }
  const custom = 'await web.fill("Note", "// @hellotest-options skip\\ncustom value");';
  assert.equal(resolveAutomationMappingSave({ currentCode: custom, previousMappingCode, nextMappingCode, mappingUnchanged: false }).requiresProgramEditor, true);
});

test("opening the instruction editor carries unsaved mapping, platform, prose, and API settings", () => {
  const currentCode = 'await web.click("Login.Submit");';
  const saved = step("1", { automation_code: currentCode, group_id: "checkout" });
  const apiRequest = { method: "POST", url: "/draft-orders", query_params: [{ key: "tenant", value: "@t.tenant" }], validations: [{ kind: "status", expected: "201" }], timeout_ms: 45000 };
  const nextMappingCode = 'await api.request("POST /draft-orders");';
  const editor = buildAutomationEditorStep({ step: saved, draft: { name: "Create draft order", expected_result: "Order created", step_type: "api" }, currentCode, previousMappingCode: currentCode, nextMappingCode, mappingUnchanged: false, apiRequest });
  assert.equal(editor.action, "Create draft order");
  assert.equal(editor.expected_result, "Order created");
  assert.equal(editor.step_type, "api");
  assert.equal(editor.automation_code, nextMappingCode);
  assert.deepEqual(editor.api_request, apiRequest);
  assert.equal(editor.group_id, "checkout");
  assert.equal(saved.automation_code, currentCode, "opening the editor never mutates the saved row");
  const mobile = buildAutomationEditorStep({ step: editor, draft: { name: "Tap submit", expected_result: "Submitted", step_type: "ios" }, currentCode: nextMappingCode, previousMappingCode: nextMappingCode, nextMappingCode: 'await android.tap("Submit");', mappingUnchanged: false, apiRequest });
  assert.equal(mobile.step_type, "ios");
  assert.equal(mobile.api_request, null);
});

test("opening either full editor preserves source drafts and complete recorded programs", () => {
  const previousMappingCode = 'await web.click("Login.Submit");';
  const apiRequest = { method: "POST", url: "/orders", auth: { type: "bearer", credential_reference: "orders-token" } };
  for (const currentCode of ['await web.click("Draft.Target");', `${previousMappingCode}\nawait web.expectText("Order created");`, 'const order = buildOrder();\nawait api.request("POST /orders", order);']) {
    const editor = buildAutomationEditorStep({ step: step("1", { automation_code: previousMappingCode }), draft: { name: "Unsaved section name", expected_result: "Unsaved result", step_type: "api" }, currentCode, previousMappingCode, nextMappingCode: 'await api.request("POST /orders");', mappingUnchanged: false, apiRequest });
    assert.equal(editor.automation_code, currentCode);
    assert.equal(editor.action, "Unsaved section name");
    assert.equal(editor.expected_result, "Unsaved result");
    assert.deepEqual(editor.api_request, apiRequest);
  }
});

test("moving a group boundary preserves both groups as contiguous ordered blocks", () => {
  const steps = [
    step("1", { group_id: "login" }), step("2", { group_id: "login" }),
    step("3", { group_id: "checkout" }), step("4", { group_id: "checkout" }), step("5")
  ];
  assert.deepEqual(getAutomationStepReorder(steps, "2", "down"), {
    stepIds: ["3", "4", "1", "2", "5"], movedStepIds: ["1", "2"]
  });
  assert.deepEqual(getAutomationStepReorder(steps, "3", "up"), {
    stepIds: ["3", "4", "1", "2", "5"], movedStepIds: ["3", "4"]
  });
  assert.deepEqual(getAutomationStepReorder(steps, "5", "up"), {
    stepIds: ["1", "2", "5", "3", "4"], movedStepIds: ["5"]
  });
  assert.deepEqual(steps.map((item) => item.id), ["1", "2", "3", "4", "5"], "the cached step array is not mutated");
});

test("reordering inside a group retains membership and cannot cross the precondition boundary", () => {
  const steps = [
    step("1", { group_id: "setup", group_name: "Preconditions" }),
    step("2", { group_id: "setup", group_name: "Preconditions" }),
    step("3", { group_id: "login" }), step("4", { group_id: "login" }), step("5")
  ];
  assert.deepEqual(getAutomationStepReorder(steps, "3", "down"), {
    stepIds: ["1", "2", "4", "3", "5"], movedStepIds: ["3"]
  });
  assert.equal(getAutomationStepReorder(steps, "2", "down"), null);
  assert.equal(getAutomationStepReorder(steps, "3", "up"), null);
  assert.equal(getAutomationStepReorder(steps, "1", "up"), null);
  assert.equal(getAutomationStepReorder(steps, "5", "down"), null);
  assert.equal(getAutomationStepReorder(steps, "missing", "up"), null);
});

test("reordering rejects split or mixed precondition groups before synchronization can corrupt order", () => {
  assert.equal(getAutomationStepReorder([
    step("1", { group_id: "shared" }), step("2"), step("3", { group_id: "shared" })
  ], "1", "down"), null);
  assert.equal(getAutomationStepReorder([
    step("1", { group_id: "mixed", group_name: "Preconditions" }), step("2", { group_id: "mixed", group_name: "Login" })
  ], "1", "down"), null);
  assert.equal(getAutomationStepReorder([
    step("1"), step("2", { group_name: "Preconditions" })
  ], "2", "up"), null);
  assert.equal(getAutomationStepReorder([step("1"), step("1")], "1", "down"), null);
});

test("a durable insertion stays cached once, in order, when refreshing its list or readiness fails", async () => {
  const original = [step("1"), step("2"), step("3")];
  const created = step("new-id", {
    step_order: 2, action: "<p>Submit @t.account</p>", expected_result: "<p>The account is saved</p>",
    group_id: "checkout", group_name: "Checkout", group_kind: "local",
    automation_code: 'await web.fill("Account.Name", "@t.account");\nawait web.click("Account.Save");'
  });
  const cached = cacheCreatedAutomationStep(original, created);
  for (const failure of [new Error("List unavailable"), new Error("Readiness update failed")]) {
    let refreshCalls = 0;
    const result = await refreshCreatedAutomationStep(created, async (durable) => {
      refreshCalls += 1;
      assert.equal(durable.id, "new-id");
      throw failure;
    });
    assert.equal(result.step, created, "the durable ID and authored content remain available after a follow-up failure");
    assert.equal(result.refreshError, failure, "refresh errors are warnings attached to the successful insertion");
    assert.equal(refreshCalls, 1);
    assert.equal(cacheCreatedAutomationStep(cached, result.step), cached, "reprocessing the saved result neither inserts twice nor shifts the list again");
  }
  assert.deepEqual(cached.map((item) => [item.id, item.step_order]), [["1", 1], ["new-id", 2], ["2", 3], ["3", 4]]);
  assert.deepEqual(cached[1], created, "prose, parameters, full program and group fields are retained");
  assert.deepEqual(original.map((item) => [item.id, item.step_order]), [["1", 1], ["2", 2], ["3", 3]]);
});

test("a successful post-insertion refresh supplies the authoritative step without another create", async () => {
  const created = step("saved-id", { step_order: 100 });
  const authoritative = { ...created, step_order: 2 };
  assert.deepEqual(cacheCreatedAutomationStep([step("1")], created).map((item) => item.step_order), [1, 2]);
  assert.deepEqual(await refreshCreatedAutomationStep(created, async () => authoritative), {
    step: authoritative, refreshError: null
  });
});
