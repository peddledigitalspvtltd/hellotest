const test = require("node:test");
const assert = require("node:assert/strict");
const { validateDataSetParameters, assertDataSetValidation } = require("../../backend/services/runParameterPlan.service");

test("dataset compatibility compares canonical input names and allows intentionally empty values", () => {
  const validation = validateDataSetParameters({ id: "customers", mode: "table", columns: ["@T.[First Name]", "email", "s.tenant"],
    rows: [{ "@T.[First Name]": "", email: "", "s.tenant": "" }] }, [{ name: "t.first name" }, { name: "r.email" }]);
  assert.equal(validation.valid, true);
  assert.equal(validation.iteration_count, 1);
  assert.deepEqual(validation.missing_parameters, []);
  assert.deepEqual(validation.available_parameters, ["r.email", "s.tenant", "t.first name"]);
});

test("key/value data is one iteration and private values never appear in compatibility output", () => {
  const validation = validateDataSetParameters({ id: "secrets", mode: "key_value", columns: ["key", "value"],
    rows: [{ key: "@r.token", value: "PRIVATE_TOKEN", is_secret: true }, { key: "t.customer", value: "" }] }, ["r.token", "t.customer"]);
  assert.equal(validation.valid, true);
  assert.equal(validation.iteration_count, 1);
  assert.doesNotMatch(JSON.stringify(validation), /PRIVATE_TOKEN|is_secret/);
});

test("missing inputs and empty datasets fail with actionable client errors", () => {
  const validation = validateDataSetParameters({ mode: "table", columns: ["r.email"], rows: [{ "r.email": "a" }] }, ["r.email", "t.password"]);
  assert.deepEqual(validation.missing_parameters, ["t.password"]);
  assert.throws(() => assertDataSetValidation(validation), error => error.statusCode === 422
    && error.code === "TEST_DATA_MISSING_PARAMETERS" && error.message.includes("@t.password"));
  assert.throws(() => assertDataSetValidation(validateDataSetParameters({ mode: "table", columns: [], rows: [] }, [])),
    { statusCode: 422, code: "TEST_DATA_EMPTY" });
  assert.equal(validateDataSetParameters(null, ["t.password"]), null);
  assert.doesNotThrow(() => assertDataSetValidation(null));
});
