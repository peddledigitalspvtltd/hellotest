const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {resolve}=require('node:path');
const root=resolve(__dirname,'../../../..');

test('source inventory reconciles callable contracts, aliases, dynamic native declarations and dedicated evidence wrappers',()=>{
 const report=JSON.parse(execFileSync(process.execPath,['scripts/checks/mcp-feature-inventory.mjs'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}));
 assert.deepEqual(report.failures,[]);
 assert.equal(report.counts.unresolved_route_declarations,0);
 const operation=route=>report.operations.find(item=>item.route===route);
 for(const route of ['POST /admin-portal/metric-governance/:id/publish','POST /admin-portal/ai-configuration/:id/rollback','POST /execution-results/ensure','POST /projects/:project_id/knowledge/graph/resolve','POST /ops-telemetry/grafana/*'])assert.ok(operation(route)?.sources.length,route);
 assert.equal(operation('POST /agentic-workflows/:id/runs').callable,false);
 assert.match(operation('POST /agentic-workflows/:id/runs').reason,/synthesizes a completed workflow preview/);
 assert.equal(operation('POST /agentic-workflows/:id/executions').callable,true);
 for(const item of report.operations.filter(item=>item.alias_of))assert.ok(operation(item.alias_of),item.route);
 assert.ok(report.dedicated_tools.some(item=>item.tool==='hellotest_graph_trace'));
 assert.ok(report.feature_catalog.find(item=>item.key==='hellotest.ai.chatbot').canonical_callable>0);
 assert.ok(report.feature_catalog.find(item=>item.key==='hellotest.ai.bug_triage').canonical_callable>0);
 const connections=report.projections.find(item=>item.entity==='integrations');
 assert.ok(connections.fields.includes('model'));
 assert.equal(connections.fields.includes('config'),false);
 assert.equal(connections.fields.includes('api_key'),false);
});
