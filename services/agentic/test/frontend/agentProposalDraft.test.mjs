import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../../../platform/frontend/src/lib/agentProposalDraft.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('exports', compiled)(mod.exports);
const { stageAgentProposal, takeAgentProposal } = mod.exports;
const artifact = { kind: 'story', title: 'Private checkout title', description: 'Private contract', priority: 'P2', citation_ids: ['source'], acceptance_criteria: ['One order after retry'] };
test('native draft transfer keeps content out of URLs, isolates scope, expires and consumes once', () => {
 const values = new Map(); globalThis.window = { sessionStorage: { setItem: (k,v)=>values.set(k,v), getItem:k=>values.get(k)||null, removeItem:k=>values.delete(k) } };
 const url = new URL(stageAgentProposal(artifact,'p','app'),'http://fixture'); const id=url.searchParams.get('agent_proposal');
 assert.equal(url.pathname,'/stories');assert.equal(url.searchParams.get('create'),'1');assert.ok(!url.href.includes('Private'));
 assert.equal(takeAgentProposal(id,'other','app','story'),null);assert.equal(takeAgentProposal(id,'p','other','story'),null);
 assert.deepEqual(takeAgentProposal(id,'p','app','story'),artifact);assert.equal(takeAgentProposal(id,'p','app','story'),null);
 const expired=new URL(stageAgentProposal(artifact,'p','app'),'http://fixture').searchParams.get('agent_proposal');
 const key=[...values.keys()][0];const envelope=JSON.parse(values.get(key));envelope.createdAt=Date.now()-31*60*1000;values.set(key,JSON.stringify(envelope));assert.equal(takeAgentProposal(expired,'p','app','story'),null);
 const update = new URL(stageAgentProposal({...artifact,target_id:'existing-story',target_revision:4},'p','app'),'http://fixture');assert.equal(update.searchParams.get('requirement'),'existing-story');assert.equal(update.searchParams.get('create'),null);
 for(const [kind,destination] of [['test_case','/test-cases'],['defect','/issues']]) {const route=new URL(stageAgentProposal({...artifact,kind},'p','app'),'http://fixture');assert.equal(route.pathname,destination);}
 delete globalThis.window;
});
