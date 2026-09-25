const test = require("node:test");
const assert = require("node:assert/strict");
const { isRouteEnabledFor, normalizeProfile, metadata } = require("../src/runtime/serviceProfile");
const { capabilityNames } = require("../src/runtime/capabilities");
const { routeModules, serviceManifests } = require("../src/routes/manifest");

test("service profiles normalize safely and keep the all profile backward compatible", () => {
  assert.equal(normalizeProfile(" AI "), "ai");
  assert.equal(normalizeProfile(undefined), "all");
  assert.equal(normalizeProfile(""), "all");
  assert.throws(() => normalizeProfile("unknown-profile"), /Invalid HELLOTEST_SERVICE_PROFILE/);
  assert.equal(isRouteEnabledFor("all", { service: "manual" }), true);
  assert.equal(isRouteEnabledFor("all", { service: "chatbot" }), true);
  assert.equal(metadata().deployable, true);
});

test("each bounded profile registers only its owned routes", () => {
  for (const profile of capabilityNames) {
    assert.equal(normalizeProfile(profile), profile);
    assert.equal(isRouteEnabledFor(profile, { service: profile }), true, `${profile} route should be enabled`);
    for (const other of capabilityNames.filter(name => name !== profile)) {
      assert.equal(isRouteEnabledFor(profile, { service: other }), false, `${profile} must not register ${other}`);
    }
  }
});

test("route ownership is lazy and every manifest entry has one loader", () => {
  assert.deepEqual(serviceManifests.map(manifest => manifest.id), capabilityNames);
  assert.ok(routeModules.length > 0);
  assert.ok(routeModules.every((route) => typeof route.load === "function" && typeof route.service === "string"));
  assert.equal(routeModules.filter((route) => route.service === "chatbot").length, 1);
  assert.equal(routeModules.filter((route) => route.service === "ai").length, 1);
  assert.deepEqual(serviceManifests.map((manifest) => manifest.id), ["platform", "testing", "knowledge", "manual", "dashboard", "automation", "agentic", "chatbot", "ai", "trace", "integration"]);
});
