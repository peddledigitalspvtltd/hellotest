// Kept as a compatibility entry point; authored module metadata lives in the repository dataset.
const repository = require('./repository');
module.exports = { get modules() { return repository.loadManifest().manifest.modules; }, resolveModules: repository.resolveModules };
