import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const distDirectory = path.resolve(packageDirectory, "dist");

if (path.dirname(distDirectory) !== packageDirectory || path.basename(distDirectory) !== "dist") {
  throw new Error(`Refusing to clean an unexpected path: ${distDirectory}`);
}

await rm(distDirectory, { recursive: true, force: true });
