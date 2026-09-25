import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const catalog = JSON.parse(await readFile(resolve(root, "services/catalog.json"), "utf8"));
const capabilities = JSON.parse(await readFile(resolve(root, "services/capabilities.json"), "utf8"));
const requiredProfiles = new Set(Object.keys(capabilities.dependencies));
const services = catalog.services;
const failures = [];

if (!Array.isArray(services) || services.length === 0) failures.push("services catalog is empty");
const ids = new Set();
const ports = new Set();
for (const service of services) {
  if (!service.id || ids.has(service.id)) failures.push(`duplicate or missing service id: ${service.id || "<empty>"}`);
  ids.add(service.id);
  if (!Number.isInteger(service.port) || ports.has(service.port)) failures.push(`duplicate or invalid port for ${service.id}`);
  ports.add(service.port);
  if (!service.source || !service.health) failures.push(`missing source/health contract for ${service.id}`);
  if (service.profile) requiredProfiles.delete(service.profile);
  try {
    await access(resolve(root, service.source));
  } catch {
    failures.push(`service source does not exist for ${service.id}: ${service.source}`);
  }
}
for (const profile of requiredProfiles) failures.push(`missing API profile in catalog: ${profile}`);

const trackedDependencies = execFileSync("git", ["ls-files", "--", "**/node_modules/**"], { cwd: root, encoding: "utf8" }).trim();
if (trackedDependencies) failures.push("node_modules files are tracked; run git rm --cached -r **/node_modules");
const trackedGenerated = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((file) => /(^|\/)(?:dist|coverage|\.cache)(\/|$)|\.tsbuildinfo$/.test(file));
if (trackedGenerated.length) failures.push(`generated files are tracked: ${trackedGenerated.slice(0, 5).join(", ")}`);
const routeManifest = await readFile(resolve(root, "services/platform/backend/src/routes/manifest.js"), "utf8");
if (!routeManifest.includes("serviceManifests.flatMap")) failures.push("API route manifest does not aggregate service manifests");
const apiDockerfile = await readFile(resolve(root, "services/platform/backend/Dockerfile"), "utf8");
for (const service of services.filter(entry => entry.profile)) {
  if (!apiDockerfile.includes(`${service.source} ./${service.source}`)) failures.push(`API image does not package ${service.source}`);
}
for (const service of new Set(services.map((entry) => entry.profile).filter(Boolean))) {
  const serviceManifestPath = resolve(root, `services/${service}/backend/service.manifest.js`);
  try {
    const serviceManifest = await readFile(serviceManifestPath, "utf8");
    if (!serviceManifest.includes(`id: "${service}"`) && !serviceManifest.includes(`const service = "${service}"`)) failures.push(`profile ${service} manifest has the wrong id`);
    if (!serviceManifest.includes("routes:")) failures.push(`profile ${service} has no route list`);
  } catch {
    failures.push(`profile ${service} has no service source manifest`);
  }
  try {
    await access(resolve(root, `services/${service}/frontend/index.ts`));
    await access(resolve(root, `services/${service}/frontend/api.client.ts`));
  } catch {
    failures.push(`profile ${service} has no frontend service source root`);
  }
  const catalogEntry = services.find((entry) => entry.profile === service);
  if (catalogEntry?.frontend_source !== `services/${service}/frontend`) {
    failures.push(`profile ${service} has an invalid frontend source mapping`);
  }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, services: services.length, profiles: [...new Set(services.map((service) => service.profile).filter(Boolean))] }, null, 2));
