// Compatibility for internal readers and verification. No sample records are generated at runtime.
const repository = require('./repository');
module.exports = {
  buildRecords: repository.buildRecords,
  get PROJECT() { return repository.loadManifest().manifest.project_id; },
  get APP() {
    const apps = repository.buildRecords(null).workspace.filter(record => record.table === 'app_types').map(record => record.values);
    return Object.fromEntries(apps.map(app => [app.type === 'unified' ? 'mobile' : app.type, app.id]));
  }
};
