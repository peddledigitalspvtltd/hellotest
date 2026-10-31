const assert=require('node:assert/strict');
const mcpRequire=require('node:module').createRequire(require.resolve('@hellotest/mcp/backend/registry'));
exports.verify=async({db,obsDb})=>{
 const features=mcpRequire('./featureOperations');
 const scopes=Object.entries(features.scopeQueries);
 // Query the real migrated schema. A unit stub cannot reveal a misspelled
 // table, wrong foreign-key column or a stale join in a scope adapter.
 for(const [entity,sql]of scopes){
  const selected=features.scopeDatabases[entity]==='observability'?obsDb:db;
  const result=await selected.prepare(sql).get('mcp-schema-check-not-a-record');
  assert.equal(result,undefined,`Fixed ${entity} scope query must execute against the real schema.`);
 }
 for(const [name,definition]of Object.entries(features.memberships)){
  const values=[...Array(definition.targetCount||1).fill('mcp-schema-check-not-a-record'),...Array(definition.projectCount||(definition.project?1:0)).fill('mcp-p-a')];
  const rows=await db.prepare(definition.sql).all(...values);
  assert.deepEqual(rows,[],`Fixed ${name} membership query must execute against the real schema.`);
 }
 const projections=mcpRequire('./projections');
 for(const definition of Object.values(projections.entities)){
  const selected=definition.database==='observability'?obsDb:db;
  const table=await selected.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=?").get(definition.table);
  assert.ok(table,`Projection table ${definition.table} must be migrated.`);
  // Project predicates and code-owned correlated expressions are exercised as
  // SQL with values, never interpolated user identifiers or arbitrary joins.
  const fields=definition.expressions?Object.entries(definition.expressions).map(([name,expression])=>`${expression} AS "${name}"`).join(','):'t.id';
  assert.deepEqual(await selected.prepare(`SELECT ${fields} FROM "${definition.table}" t WHERE ${definition.scope} LIMIT 1`).all('mcp-schema-check-not-a-project',...(definition.application_scope_fallback?[[]]:[])),[]);
 }
};
