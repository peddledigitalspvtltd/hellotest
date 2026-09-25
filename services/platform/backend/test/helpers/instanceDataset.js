const { readFileSync } = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../instance-setup-data");
const read = file => JSON.parse(readFileSync(path.join(root, file), "utf8"));
module.exports = table => read("manifest.json").files.filter(file => file.table === table)
  .flatMap(file => read(file.path).records);
