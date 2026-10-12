const assert=require('node:assert/strict');
exports.verify=async()=>{
 const actor=await require('@hellotest/mcp/backend/auth').principal('mcp-a','mcp-p-a','scope-fixture');
 const context=require('@hellotest/ai/backend/services/aiContextOrchestrator.service');
 const route=context.planContext({prompt:'Review the exact selected Test Case',agentId:'test-designer',requestedScopes:['test-cases']});
 const scoped=await context.buildLiveProjectEvidence({projectId:'mcp-p-a',appTypeId:'mcp-app-a',user:actor.user,prompt:'Review the exact selected Test Case',route,evidenceScope:{test_case_id:'mcp-case-a'}});
 assert.equal(scoped.counts.test_cases,1,'The current native reader must apply exact case scope to counts');
 const snapshot=JSON.parse(scoped.hits.find(hit=>hit.source_id.endsWith('-test-cases')).content);
 assert.deepEqual(snapshot.records.map(item=>item.id),['mcp-case-a']);
 const foreign=await context.buildLiveProjectEvidence({projectId:'mcp-p-a',appTypeId:'mcp-app-a',user:actor.user,prompt:'Review the exact selected Test Case',route,evidenceScope:{test_case_id:'mcp-case-b'}});
 assert.equal(foreign.counts.test_cases,0,'An identifier cannot escape the current project/application');
 const result=await require('@hellotest/knowledge/backend/services/knowledgeRetrieval.service').retrieveSearch({projectId:'mcp-p-a',appTypeId:'mcp-app-a',user:actor.user,query:'A visible case',filters:{agent_id:'test-designer',requested_scopes:['test-cases'],evidence_scope:{test_case_id:'mcp-case-a'},source_kinds:['test_case']},budgets:{max_context_tokens:5000,deadline_ms:12000}});
 assert.equal(result.retrieval.context_transport,'mcp');
 assert.equal(result.retrieval.live_context_counts.test_cases,1,'Typed evidence scope must survive MCP, normalization, contract validation and retrieval');
};
