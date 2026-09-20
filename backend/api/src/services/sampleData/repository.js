const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ACTOR_TOKEN = '__SETUP_ACTOR_ID__';
const sqlName = /^[a-z_][a-z0-9_]*$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const isIdentifier = value => typeof value === 'string' && sqlName.test(value);
const isTextList = value => Array.isArray(value) && value.every(isText);
const error = (code, message, file) => Object.assign(new Error(message), { code, publicMessage: message, statusCode: 409, retryable: false, ...(file ? { file } : {}) });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function rootDirectory() {
  const configured = process.env.HELLOTEST_INSTANCE_SETUP_DATA_DIR;
  const candidates = configured ? [configured] : [path.resolve(__dirname, '../../../../instance-setup-data'), path.resolve(__dirname, '../../../instance-setup-data')];
  for (const candidate of candidates) {
    try { if (fs.statSync(path.join(candidate, 'manifest.json')).isFile()) return fs.realpathSync(candidate); }
    catch (cause) { if (cause.code !== 'ENOENT') throw error('SETUP_FILE_UNREADABLE', 'The instance setup manifest cannot be read. Check the deployment file permissions.'); }
  }
  throw error('SETUP_DATA_MISSING', 'Repository instance setup files are missing. Restore backend/instance-setup-data or rebuild the API image.');
}
function readJson(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || !relative.endsWith('.json')) throw error('SETUP_FILE_PATH', 'Invalid instance setup file path.', relative);
  const filename = path.resolve(root, relative);
  try {
    const resolved = fs.realpathSync(filename);
    if (!resolved.startsWith(root + path.sep)) throw error('SETUP_FILE_PATH', 'Instance setup files must remain inside the dataset directory.', relative);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw error('SETUP_FILE_SIZE', 'Instance setup files must be regular JSON files of at most 16 MB.', relative);
    const bytes = fs.readFileSync(resolved);
    return { value: JSON.parse(bytes.toString('utf8')), sha256: hash(bytes) };
  } catch (cause) {
    if (cause.code?.startsWith('SETUP_')) throw cause;
    throw error(cause instanceof SyntaxError ? 'SETUP_INVALID_JSON' : 'SETUP_FILE_UNREADABLE', `Unable to read valid setup data from ${relative}. Restore the versioned file and retry.`, relative);
  }
}
function loadManifest() {
  const root = rootDirectory();
  const { value: manifest, sha256 } = readJson(root, 'manifest.json');
  if (!isObject(manifest) || manifest.schema_version !== 1 || !Number.isInteger(manifest.version) || manifest.version < 1 || !isText(manifest.dataset_id) || !Array.isArray(manifest.modules) || !manifest.modules.length || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 1024) throw error('SETUP_MANIFEST_INVALID', 'Unsupported or incomplete instance setup manifest.');
  const modules = new Map(), files = new Map();
  for (const module of manifest.modules) {
    if (!isObject(module) || !isIdentifier(module.key) || modules.has(module.key) || !isTextList(module.depends_on) || !isTextList(module.features) || !isTextList(module.routes) || !isTextList(module.feature_keys)) throw error('SETUP_MANIFEST_INVALID', 'Invalid or duplicate setup module.');
    modules.set(module.key, module);
  }
  const visiting = new Set(), visited = new Set();
  const visit = key => {
    if (!modules.has(key) || visiting.has(key)) throw error('SETUP_DEPENDENCY_INVALID', 'Setup module dependencies contain a cycle or unknown module.');
    if (visited.has(key)) return;
    visiting.add(key); modules.get(key).depends_on.forEach(visit); visiting.delete(key); visited.add(key);
  };
  modules.forEach((_, key) => visit(key));
  for (const file of manifest.files) {
    if (!isObject(file) || !isText(file.key) || !isText(file.path) || files.has(file.key) || !modules.has(file.module) || !isTextList(file.depends_on) || file.depends_on.some(key => !files.has(key)) || !Number.isInteger(file.record_count) || file.record_count < 1 || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw error('SETUP_MANIFEST_INVALID', 'Setup files must have unique keys, checksums and ordered dependencies.', file?.path);
    if (file.kind !== 'role_presets' && (!isIdentifier(file.table) || !Array.isArray(file.keys) || !file.keys.length || file.keys.some(key => !isIdentifier(key)) || new Set(file.keys).size !== file.keys.length)) throw error('SETUP_MANIFEST_INVALID', 'Invalid setup object table or identity columns.', file.path);
    files.set(file.key, file);
  }
  return { manifest, root, manifest_hash: sha256 };
}
function bindActor(value, actorId) {
  if (value === ACTOR_TOKEN) return actorId;
  if (typeof value === 'string') {
    if (value.includes(ACTOR_TOKEN) && /^[{[]/.test(value.trim())) {
      let parsed;
      try { parsed = JSON.parse(value); } catch { /* Authored prose can start with punctuation. */ }
      if (parsed && typeof parsed === 'object') return JSON.stringify(bindActor(parsed, actorId));
    }
    return value.split(ACTOR_TOKEN).join(actorId || '');
  }
  if (Array.isArray(value)) return value.map(item => bindActor(item, actorId));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.split(ACTOR_TOKEN).join(actorId || ''), bindActor(item, actorId)]));
  return value;
}
function loadFile(dataset, file, actorId = null) {
  const { value, sha256 } = readJson(dataset.root, file.path);
  if (sha256 !== file.sha256) throw error('SETUP_CHECKSUM_MISMATCH', `Setup file ${file.path} does not match the manifest checksum. Review the file and publish its manifest together.`, file.path);
  if (!isObject(value) || value.schema_version !== 1 || !Array.isArray(value.records) || value.records.length !== file.record_count) throw error('SETUP_RECORD_COUNT', `Setup file ${file.path} does not match its declared structure or record count.`, file.path);
  const identities = new Set();
  for (const record of value.records) {
    if (!isObject(record)) throw error('SETUP_RECORD_INVALID', 'Every setup record must be an object.', file.path);
    if (file.kind === 'role_presets') {
      if (!isText(record.id) || !isText(record.key) || !isText(record.name) || !isTextList(record.permission_codes) || !record.permission_codes.length) throw error('SETUP_ROLE_INVALID', 'A setup role is missing its identity or permission codes.', file.path);
    } else if (Object.keys(record).some(key => !sqlName.test(key)) || file.keys.some(key => record[key] === null || record[key] === undefined || typeof record[key] === 'object')) throw error('SETUP_RECORD_INVALID', 'A setup object has invalid columns or missing identity values.', file.path);
    const identity = JSON.stringify(file.kind === 'role_presets' ? record.name.trim().toLowerCase() : file.keys.map(key => record[key]));
    if (identities.has(identity)) throw error('SETUP_DUPLICATE_IDENTITY', 'Duplicate object identity in setup file.', file.path);
    identities.add(identity);
  }
  return bindActor(value.records, actorId);
}
function resolveModules(requested, manifest = loadManifest().manifest) {
  if (requested !== undefined && (!Array.isArray(requested) || !requested.length || requested.length > 64 || requested.some(key => typeof key !== 'string'))) throw Object.assign(new Error('Select between 1 and 64 sample modules.'), { statusCode: 400 });
  const selected = [...new Set(requested === undefined ? manifest.modules.map(module => module.key) : requested)];
  const known = new Map(manifest.modules.map(module => [module.key, module]));
  if (selected.some(key => !known.has(key))) throw Object.assign(new Error('Unknown sample modules selected.'), { statusCode: 400 });
  const ordered = [], visited = new Set();
  const visit = key => { if (visited.has(key)) return; visited.add(key); known.get(key).depends_on.forEach(visit); ordered.push(key); };
  selected.forEach(visit);
  return { requested: selected, installed: ordered, dependencies_added: ordered.filter(key => !selected.includes(key)) };
}
function getInstallPlan(requested) {
  const dataset = loadManifest(), selection = resolveModules(requested, dataset.manifest);
  const files = dataset.manifest.files.filter(file => selection.installed.includes(file.module));
  const included = new Set(files.map(file => file.key));
  for (const file of files) if (file.depends_on.some(key => !included.has(key))) throw error('SETUP_DEPENDENCY_INVALID', 'A selected object requires a module missing from its dependency declaration.', file.path);
  return { selection, manifest_hash: dataset.manifest_hash, dataset_version: dataset.manifest.version, files, total_files: files.length };
}
function buildRecords(actorId) {
  const dataset = loadManifest(), packs = Object.fromEntries(dataset.manifest.modules.map(module => [module.key, []]));
  for (const file of dataset.manifest.files) {
    if (file.kind === 'role_presets') continue;
    packs[file.module].push(...loadFile(dataset, file, actorId).map(values => ({ table: file.table, keys: file.keys, values })));
  }
  return packs;
}
function getRolePresets(dataset = loadManifest()) {
  return dataset.manifest.files.filter(file => file.kind === 'role_presets').flatMap(file => loadFile(dataset, file));
}
module.exports = { loadManifest, loadFile, resolveModules, getInstallPlan, buildRecords, getRolePresets, bindActor, error, ACTOR_TOKEN };
