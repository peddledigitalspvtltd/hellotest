const fs = require('node:fs');
const path = require('node:path');
// Fixed native choices come from the same new-install contract used by runtime
// bootstrap. Configurable dropdowns without SQL constraints remain configurable.
const sql = fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
const contracts = new Map();
for (const table of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\);/gi)) {
  const fields = contracts.get(table[1]) || new Map();
  for (const choice of table[2].matchAll(/CHECK\s*\(\s*([a-z_][a-z0-9_]*)\s+IN\s*\(\s*((?:'[^']*'\s*,?\s*)+)\)\s*\)/gi)) {
    fields.set(choice[1], { values: new Set([...choice[2].matchAll(/'([^']*)'/g)].map(value => value[1])), required: new RegExp(`^\\s*${choice[1]}\\s+[^\\n]*NOT NULL`, 'mi').test(table[2]) });
  }
  contracts.set(table[1], fields);
}
// Later bootstrap migrations can add or replace a fixed choice constraint.
for (const statement of sql.matchAll(/ALTER TABLE\s+([a-z_][a-z0-9_]*)\s+ADD CONSTRAINT\s+[a-z_][a-z0-9_]*\s+CHECK\s*\(\s*([a-z_][a-z0-9_]*)\s+IN\s*\(\s*((?:'[^']*'\s*,?\s*)+)\)\s*\)/gi)) {
  const fields = contracts.get(statement[1]) || new Map();
  fields.set(statement[2], { values: new Set([...statement[3].matchAll(/'([^']*)'/g)].map(value => value[1])), required: fields.get(statement[2])?.required || false });
  contracts.set(statement[1], fields);
}
// Runtime bootstrap extends integration choices from the shared domain catalog.
contracts.get('integrations').set('type', { values: new Set(require('../../src/domain/catalog').INTEGRATION_TYPE_VALUES), required: true });
function validateRecordContract(file, row) {
  for (const [column, contract] of contracts.get(file.table) || []) {
    if (row[column] === undefined || row[column] === null && !contract.required) continue;
    if (!contract.values.has(row[column])) throw Object.assign(new Error(`Setup file ${file.path} has an unsupported native ${file.table}.${column} value. Review the file against the application schema.`), { code:'SETUP_RECORD_CONTRACT', publicMessage:`Unsupported native ${file.table}.${column} value in ${file.path}.`, statusCode:409, retryable:false, file:file.path });
  }
}
module.exports = { validateRecordContract };
