import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const repository = new URL("../../../", import.meta.url);
const service = (compose, name) => {
  const block = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z][a-zA-Z0-9_-]*:|^networks:|^volumes:|$(?![\\s\\S]))`, "m"));
  assert.ok(block, `Expected ${name} to be configured.`);
  return block[1];
};

test("quality API has one persistent worker independent of scaled automation queues", async () => {
  const [source, images, gateway, dockerfile, single] = await Promise.all([
    "local-run/docker-compose.yml", "local-run/docker-compose.images.yml",
    "local-run/testengine-gateway/haproxy.cfg", "testengine/backend/Dockerfile",
    "docker-compose.microservices.yml"
  ].map(name => readFile(new URL(name, repository), "utf8")));
  for (const compose of [source, images]) {
    const worker = service(compose, "testengine-quality-worker");
    assert.match(worker, /QUALITY_AGENT_DATA_DIR:\s*\/quality-data/);
    assert.match(worker, /hellotest-local-quality-data:\/quality-data/);
    assert.match(worker, /TESTENGINE_QUEUE_REQUIRED:\s*"false"/);
    assert.doesNotMatch(worker, /HELLOTEST_API_BASE_URL|TESTENGINE_WORKER_CLASS|TESTENGINE_POLL_CONCURRENCY/);
    assert.match(worker, /deploy:\s*\n\s+replicas:\s*1\s*(?:\n|$)/);
    assert.match(worker, /host\.docker\.internal:host-gateway/);
    assert.match(service(compose, "testengine"), /depends_on:\s*\n\s+testengine-quality-worker:\s*\n\s+condition:\s*service_healthy/);
    assert.match(compose, /^  hellotest-local-quality-data:\s*$/m);
  }
  assert.match(gateway, /acl quality_agents path_beg \/api\/v1\/quality-agents/);
  assert.match(gateway, /use_backend testengine_quality if quality_agents/);
  const qualityBackend = gateway.match(/backend testengine_quality\n([\s\S]*?)(?=\nbackend|$)/)[1];
  assert.match(qualityBackend, /server quality testengine-quality-worker:4301/);
  assert.doesNotMatch(qualityBackend, /server-template|leastconn/);
  assert.match(dockerfile, /FROM mcr\.microsoft\.com\/playwright:v1\.59\.1-jammy/);
  assert.match(dockerfile, /ENV QUALITY_AGENT_DATA_DIR=\/quality-data/);
  const singleEngine = service(single, "testengine-backend");
  assert.match(singleEngine, /QUALITY_AGENT_DATA_DIR:\s*\/quality-data/);
  assert.match(singleEngine, /microservices-quality-data:\/quality-data/);
  assert.match(single, /^  microservices-quality-data:\s*$/m);
});
