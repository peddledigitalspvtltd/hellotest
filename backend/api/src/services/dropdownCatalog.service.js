const db = require('../db');
const { DROPDOWN_FIELDS, DROPDOWN_FIELDS_BY_KEY } = require('../domain/dropdownCatalog');
const SETTINGS_KEY = 'dropdown_catalog';
const fail = (message, statusCode = 400, code = 'INVALID_DROPDOWN_OPTIONS') => Object.assign(new Error(message), { statusCode, code });
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};
const definitionFor = key => {
  const definition = DROPDOWN_FIELDS_BY_KEY.get(key);
  if (!definition) throw fail('This dropdown field is not registered.', 404, 'DROPDOWN_FIELD_NOT_FOUND');
  return definition;
};
const readState = async () => {
  const row = await db.prepare('SELECT value, updated_at FROM app_settings WHERE key = ?').get(SETTINGS_KEY);
  const saved = object(row?.value);
  return { revision: Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0,
    fields: object(saved.fields), updated_at: row?.updated_at || null };
};

function resolveField(definition, state) {
  const saved = definition.can_edit ? object(state.fields[definition.key]) : {};
  const builtins = new Map(definition.options.map(option => [option.value, option]));
  const stored = Array.isArray(saved.options) ? saved.options : [];
  const known = new Set();
  const options = [];
  for (const option of [...stored, ...definition.options]) {
    if (!option || typeof option.value !== 'string' || known.has(option.value)) continue;
    known.add(option.value);
    options.push({ value: option.value, label: option.label || builtins.get(option.value)?.label || option.value,
      description: option.description || '', active: option.active !== false, builtin: builtins.has(option.value) });
  }
  return { ...clone(definition), options, default_value: definition.supports_default
    ? Object.hasOwn(saved, 'default_value') ? saved.default_value : definition.default_value : null };
}
function catalogFrom(state) {
  return { revision: state.revision, updated_at: state.updated_at, fields: DROPDOWN_FIELDS.map(definition => resolveField(definition,state)) };
}
async function getCatalog() { return catalogFrom(await readState()); }
async function getField(key) { return resolveField(definitionFor(key), await readState()); }
async function getOptions(key, { includeInactive = false } = {}) {
  return (await getField(key)).options.filter(option => includeInactive || option.active);
}
async function getDefaultValue(key) { return (await getField(key)).default_value; }

function normalizeOptions(definition, input, previous) {
  if (!Array.isArray(input) || input.length > 200) throw fail('A dropdown supports at most 200 options.');
  const valueKeys = new Set(), labelKeys = new Set();
  const existing = new Map(previous.options.map(option => [option.value,option]));
  const normalized = input.map(option => {
    if (!option || typeof option !== 'object' || Array.isArray(option) || typeof option.active !== 'boolean') throw fail('Every option needs a value, display label and active state.');
    if (typeof option.value !== 'string' || typeof option.label !== 'string') throw fail('Option values and display labels must be text.');
    const value = option.value.trim(), label = option.label.trim();
    const description = option.description == null ? '' : option.description;
    if (!value || value.length > 120 || !label || label.length > 120 || /[\u0000-\u001f\u007f]/.test(value+label)) throw fail('Values and labels must contain 1–120 characters without control characters.');
    if (typeof description !== 'string' || description.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) throw fail('Descriptions support up to 500 characters.');
    if (definition.value_format === 'slug' && !/^[a-z][a-z0-9_-]{0,119}$/.test(value)) throw fail('Use a lowercase code starting with a letter, followed by letters, numbers, underscores or hyphens.');
    if (definition.value_format === 'integer' && (!/^[1-9][0-9]{0,2}$/.test(value))) throw fail('Story point estimates must be whole numbers from 1 to 999.');
    const valueKey = value.toLowerCase(), labelKey = label.toLowerCase();
    if (valueKeys.has(valueKey) || labelKeys.has(labelKey)) throw fail('Option codes and display labels must be unique, ignoring letter case.');
    valueKeys.add(valueKey); labelKeys.add(labelKey);
    return { value, label, description: description.trim(), active: option.active };
  });
  for (const value of existing.keys()) if (!normalized.some(option => option.value === value)) {
    throw fail('Saved option codes cannot be changed or deleted. Deactivate an option to keep historical records readable.');
  }
  if (definition.required && !normalized.some(option => option.active)) throw fail('This field must retain at least one active option.');
  return normalized;
}

async function updateField(key, input, { actorId = null, ipAddress = null } = {}) {
  const definition = definitionFor(key);
  if (!definition.can_edit) throw fail(definition.reason || 'This dropdown is managed by its source.', 400, 'DROPDOWN_SYSTEM_MANAGED');
  if (!Number.isSafeInteger(input?.expected_revision) || input.expected_revision < 0) throw fail('Reload the catalog and provide its current revision.');
  return db.transaction(async () => {
    // Also locks the first publication, when no settings row exists yet.
    await db.query('SELECT pg_advisory_xact_lock(hashtext(?))', ['hellotest:dropdown-catalog']);
    const state = await readState();
    if (state.revision !== input.expected_revision) throw fail('Dropdown values changed since you opened this catalog. Reload the latest catalog before saving.', 409, 'DROPDOWN_REVISION_CONFLICT');
    const previous = resolveField(definition,state);
    const options = normalizeOptions(definition,input.options,previous);
    const defaultValue = Object.hasOwn(input,'default_value') ? input.default_value : previous.default_value;
    if (!definition.supports_default && defaultValue != null) throw fail('This dropdown does not have a configurable default.');
    if (definition.supports_default && !options.some(option => option.active && option.value === defaultValue)) throw fail('Choose an active option as the default.');
    const saved = { options, default_value: definition.supports_default ? defaultValue : null };
    const previousSaved = { options: previous.options.map(({builtin,...option}) => option), default_value: previous.default_value };
    if (JSON.stringify(saved) === JSON.stringify(previousSaved)) return catalogFrom(state);
    const next = { revision: state.revision + 1, fields: { ...state.fields, [key]: saved } };
    const row = await db.prepare(`INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at RETURNING updated_at`).get(SETTINGS_KEY,next);
    await require('./adminPortal.service').recordAudit({ actorId, ipAddress, action: 'dropdown_values.update', targetType: 'dropdown', targetId: key,
      summary: `Updated ${definition.label} dropdown values.`, metadata: { field:key, revision:next.revision,
        before:previousSaved, after:saved } });
    return catalogFrom({ ...next, updated_at: row.updated_at });
  })();
}

async function validateValue(key, value, { existingValue, allowEmpty = true } = {}) {
  definitionFor(key);
  // Unchanged retired/imported values stay readable and editable on old records.
  if (existingValue !== undefined && value === existingValue) return value;
  if (value == null || value === '') { if (allowEmpty) return null; throw fail('Choose a value for this field.',400,'INVALID_DROPDOWN_VALUE'); }
  if (typeof value !== 'string' || value.trim().length > 120) throw fail('Choose a configured dropdown value.',400,'INVALID_DROPDOWN_VALUE');
  const normalized = value.trim();
  const field = await getField(key);
  const selected = field.options.find(option => option.value.toLowerCase() === normalized.toLowerCase());
  if (selected?.active) return selected.value;
  if (existingValue !== undefined && normalized === String(existingValue ?? '').trim()) return existingValue;
  throw fail(`Choose an active ${field.label} value configured by an administrator.`,400,'INVALID_DROPDOWN_VALUE');
}

function applyToDomainMetadata(metadata,catalog) {
  const result = clone(metadata);
  for (const field of catalog.fields.filter(item => item.can_edit)) {
    const [section,key] = field.key.split('.');
    result[section] = result[section] || {};
    result[section][key] = field.options.filter(option => option.active).map(option => ({...option}));
  }
  result.test_cases.default_type = catalog.fields.find(field => field.key === 'test_cases.types').default_value;
  result.feedback = { ...result.feedback, ...result.issues };
  result.dropdowns = { revision: catalog.revision, updated_at:catalog.updated_at,
    fields:Object.fromEntries(catalog.fields.map(field => [field.key,{ options:field.options,default_value:field.default_value,kind:field.kind }])) };
  return result;
}

module.exports = { SETTINGS_KEY, getCatalog, getField, getOptions, getDefaultValue, updateField, validateValue, applyToDomainMetadata, normalizeOptions };
