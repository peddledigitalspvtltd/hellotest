import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtimeUrl = process.env.HELLOTEST_RUNTIME_TEST_BUILD
  ? pathToFileURL(path.join(process.env.HELLOTEST_RUNTIME_TEST_BUILD, "lib/runtimeContext.js"))
  : new URL("../dist/lib/runtimeContext.js", import.meta.url);
const { buildInitialContext, interpolateText, registerContextValue } = await import(runtimeUrl.href);

test("data-set column references resolve spaces, dots, numeric prefixes and escaped delimiters", () => {
  const context = buildInitialContext({ data_set: { mode: "table", rows: [{
    "First Name": "Jay", "account.email": "jay@example.test", "2FA": "enabled", "choice]value": "yes", "folder\\name": "docs"
  }] } });
  assert.equal(interpolateText("@t.[First Name] <@t.[account.email]> @t.[2FA] @t.[choice\\]value] @t.[folder\\\\name]", context),
    "Jay <jay@example.test> enabled yes docs");
});

test("quoted suite/run captures keep their scope and do not fall back to test parameters", () => {
  const context = { values: { "t.build number": "test" } };
  registerContextValue(context, "@s.[Build Number]", "suite");
  registerContextValue(context, "@r.[Build Number]", "run");
  assert.equal(interpolateText("@t.[Build Number] @s.[Build Number] @r.[Build Number]", context), "test suite run");
  assert.equal(interpolateText("@s.[Missing Value]", context), "");
});

test("resolved column contents remain literal and ordinary references remain compatible", () => {
  const context = { values: { "t.first name": "@t.email", "t.email": "resolved", "s.tenant": "Acme", "t.t": "unintended" } };
  assert.equal(interpolateText("@t.[First Name] @t.email @s.tenant", context), "@t.email resolved Acme");
  assert.equal(interpolateText("mail@t.email", context), "mail@t.email");
  assert.equal(interpolateText("@t. @s. @r.", context), "@t. @s. @r.");
});

test("case-linked data keeps explicit case overrides for quoted columns", () => {
  const context = buildInitialContext({
    case_parameters: { "first name": "override" },
    data_set: { source: "test_case", mode: "table", rows: [{ "First Name": "inherited" }] }
  });
  assert.equal(interpolateText("@t.[First Name]", context), "override");
});
