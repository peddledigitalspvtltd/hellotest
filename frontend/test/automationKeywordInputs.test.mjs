import assert from "node:assert/strict";
import test from "node:test";
import { buildAutomationRepositoryFields, getAutomationKeywordInputSpec, resolveAutomationRepositoryTarget } from "../src/lib/automationKeywordInputs.ts";

test("click, visibility checks, and mobile taps do not ask for an unused value", () => {
  for (const keyword of ["web.click", "web.hover", "web.clear", "web.check", "web.expectVisible", "web.expectHidden", "android.tap", "mobile.expectDisplayed"]) {
    const input = getAutomationKeywordInputSpec(keyword);
    assert.equal(input.target, "repository", keyword);
    assert.equal(input.showValue, false, keyword);
  }
});

test("typing, uploads, assertions, and captures retain their required value control", () => {
  for (const keyword of ["web.fill", "web.select", "web.expectText", "web.uploadFile", "web.uploadRemoteFile", "web.captureText", "android.type", "mobile.expectValue", "android.pushRemoteFile"]) {
    assert.equal(getAutomationKeywordInputSpec(keyword).showValue, true, keyword);
    assert.equal(getAutomationKeywordInputSpec(keyword).valueRequired, true, keyword);
  }
  assert.equal(getAutomationKeywordInputSpec("web.drag").valueTarget, "repository");
  assert.equal(getAutomationKeywordInputSpec("mobile.drag").valueTarget, "repository");
});

test("navigation, browser controls, and mobile system actions do not require repository objects", () => {
  assert.equal(getAutomationKeywordInputSpec("web.goto").target, "text");
  assert.equal(getAutomationKeywordInputSpec("web.goto").showValue, false);
  for (const keyword of ["web.reload", "web.goBack", "android.hideKeyboard", "mobile.pressBack", "codedJS"]) assert.equal(getAutomationKeywordInputSpec(keyword).target, "none");
  assert.equal(getAutomationKeywordInputSpec("android.startActivity").target, "text");
  assert.equal(getAutomationKeywordInputSpec("android.startActivity").valueLabel, "Activity");
  assert.equal(getAutomationKeywordInputSpec("tap", "ios").showValue, false);
  assert.equal(getAutomationKeywordInputSpec("android.waitForDisplayed").valueRequired, false);
});

test("repository selection lists usable fields with screen identities and resolves executable locators", () => {
  const repository = [
    { id: "screen", locator: "__screen__", locator_intent: "__screen__", page_key: "Login", metadata: { record_kind: "screen" } },
    { id: "email", locator: '[data-testid="email"]', locator_intent: "Login.Email", page_key: "Login", metadata: { screen_name: "Login", object_name: "Login.Email", object_role: "input" } },
    { id: "button", locator: "~continue", locator_intent: "Continue", page_key: "Checkout", metadata: { screen_name: "Checkout", object_name: "Continue" } }
  ];
  const original = structuredClone(repository);
  assert.deepEqual(buildAutomationRepositoryFields(repository).map((field) => [field.reference, field.objectName]), [["Login.Email", "Email"], ["Checkout.Continue", "Continue"]]);
  assert.equal(resolveAutomationRepositoryTarget("Login.Email", repository), '[data-testid="email"]');
  assert.equal(resolveAutomationRepositoryTarget("Checkout.Continue", repository), "~continue");
  assert.equal(resolveAutomationRepositoryTarget("#manual", repository), "#manual");
  assert.deepEqual(repository, original);
});
