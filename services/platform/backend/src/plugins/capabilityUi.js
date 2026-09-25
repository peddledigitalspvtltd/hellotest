const fs = require("node:fs");
const path = require("node:path");
const { routeEnabled } = require("../runtime/serviceProfile");
const { capabilityNames } = require("../runtime/capabilities");

const types = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

// This route serves build artifacts only. Product data and mutations continue
// through the authenticated API routes and their project permission checks.
module.exports = async function capabilityUi(fastify, options = {}) {
  fastify.get("/capability-ui/:owner/*", async (req, reply) => {
    const { owner } = req.params;
    const asset = req.params["*"];
    if (!capabilityNames.includes(owner) || !routeEnabled({ service: owner })
      || !asset || !/^[A-Za-z0-9_./-]+$/.test(asset) || asset.split("/").some(part => !part || part.startsWith("."))) {
      return reply.code(404).send({ error: "Capability interface not found" });
    }
    const extension = path.extname(asset);
    if (!types[extension] || (extension === ".json" && asset !== "manifest.json")) {
      return reply.code(404).send({ error: "Capability asset not found" });
    }
    const packagedRoot = path.resolve(options.uiRoot || path.resolve(__dirname, "../../../../../capability-ui"), owner);
    const directory = fs.existsSync(packagedRoot) ? packagedRoot : path.resolve(__dirname, "../../../..", owner, "dist/ui");
    try {
      const [base, file] = await Promise.all([fs.promises.realpath(directory), fs.promises.realpath(path.join(directory, asset))]);
      if (!file.startsWith(`${base}${path.sep}`)) return reply.code(404).send({ error: "Capability asset not found" });
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024) return reply.code(404).send({ error: "Capability asset not found" });
      reply.header("Cache-Control", asset === "manifest.json" ? "no-store" : "public, max-age=31536000, immutable");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cross-Origin-Resource-Policy", "same-origin");
      return reply.type(types[extension]).send(fs.createReadStream(file));
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      return reply.code(404).send({ error: "Capability interface has not been built" });
    }
  });
};
