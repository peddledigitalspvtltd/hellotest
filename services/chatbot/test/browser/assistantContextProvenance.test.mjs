import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);
const fixture=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from '/src/auth/AuthContext';import {api,sessionStorage} from '/src/lib/api';
import {chatbotApi} from '/services/chatbot/frontend/api.client';
import {GroundedAssistant} from '/services/chatbot/frontend/components/GroundedAssistant';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/product-experience.css';
const session={token:'fixture-only',user:{id:'reviewer',role:'admin',name:'Reviewer'}};
sessionStorage.write(session);localStorage.setItem('hellotest.current_project_id','project');
api.auth.session=async()=>session;
api.featureFlags.snapshot=async()=>({flags:{'hellotest.ai.knowledge':true,'hellotest.ai.chatbot':true}});
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
chatbotApi.assistant.listIntegrations=async()=>[];
chatbotApi.assistant.listSessions=async()=>[{id:'history',project_id:'project',title:'Checkout context review',status:'active'}];
const evidence=[{id:'e1',evidence_id:'e1',source_id:'checkout',document_id:'checkout-revision-2',source_kind:'requirement',title:'Checkout contract',visibility:{state:'FULL'},freshness:{current:true}},
{id:'e2',evidence_id:'e2',source_id:'refund',document_id:'refund-revision-1',source_kind:'requirement',title:'Refund contract',visibility:{state:'FULL'},freshness:{current:true}}];
const context_packet={contract_version:'1.0',packet_id:'packet',evidence,relationships:[{source:'checkout',target:'refund',type:'DEPENDS_ON',provenance_type:'SOURCE_EXPLICIT',evidence_ids:['e1']}],retrieval:{status:'COMPLETE',context_graph:{status:'recorded',trace_id:'trace:checkout-review'}}};
const answer_contract={contract_type:'AnswerContract',contract_version:'1.0',status:'answered',summary:'Checkout depends on the refund contract.',claims:[{statement:'Checkout depends on the supplied refund contract.',classification:'SUPPORTED',evidence_ids:['e1','e2']}],citation_ids:['e1','e2'],evidence_gaps:[],presentation:{recommended_type:'TEXT',structured_payload:{}}};
chatbotApi.assistant.getSession=async()=>({id:'history',project_id:'project',title:'Checkout context review',status:'active',messages:[
{id:'question',role:'user',content:'Which contract does checkout depend on?',status:'answered',citations:[]},
{id:'answer',role:'assistant',content:answer_contract.summary,status:'answered',citations:evidence,retrieval:{context_transport:'mcp',intent_planning_model_used:true,context_graph_outcome:{status:'recorded',trace_id:'trace:checkout-review',event_id:'saved-answer'},context_packet,answer_contract,retrieval_strategy:{requested:'graph_expand',applied:'graph_expand',graph_expansion_status:'completed',graph_tool_calls:1,graph_evidence_count:2,graph_relationship_count:1},processing_trace:[{stage:'RETRIEVAL_PLANNING',message:'Prepared the evidence plan.',status:'COMPLETE'},{stage:'RELATIONSHIP_SEARCH',message:'Loaded one source-supported relationship.',status:'COMPLETE'}]}}
]});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><GroundedAssistant/></AuthProvider></QueryClientProvider>);
`;
test('saved chatbot context exposes actual retrieval, versioned evidence and the exact task graph on desktop and mobile',{timeout:60000},async()=>{
 const name='chatbot-context-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try{
  await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx,fixture);browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Unexpected fixture request'})}));
  const restore=async()=>{
   await page.getByRole('button',{name:'Open HelloTest grounded assistant',exact:true}).click();
   await page.getByLabel('Conversation history',{exact:true}).click();
   await page.getByRole('button',{name:'Checkout context review',exact:true}).click();
   await page.getByText('Checkout depends on the supplied refund contract.',{exact:true}).waitFor();
   await page.getByText('How this answer was built',{exact:false}).click();
   await page.getByRole('region',{name:'Context for this answer',exact:true}).waitFor();
  };
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);await restore();
  const context=page.getByRole('region',{name:'Context for this answer',exact:true});
  await context.getByText('MCP · hellotest_context_build',{exact:true}).waitFor();
  await context.getByText('Model-assisted evidence plan',{exact:true}).waitFor();
  await context.getByText('Expand witnessed graph links',{exact:true}).waitFor();
  await context.getByText('Expand witnessed graph links · graph read completed',{exact:true}).waitFor();
  await context.getByText('2 items · 2 sources · 2 document versions',{exact:true}).waitFor();
  await context.getByText('1 witnessed link in this context',{exact:true}).waitFor();
  await context.getByText('Recorded task context · response outcome recorded',{exact:true}).waitFor();
  assert.equal(await page.locator('.grounding-chip').innerText(),'Grounded','A saved supported answer must retain its grounded status.');
  assert.equal(await context.getByRole('link',{name:'Open this task’s Context Graph',exact:true}).getAttribute('href'),'/knowledge?view=context&trace_id=trace%3Acheckout-review');
  await mkdir('/tmp/qaira-chatbot-context-ui',{recursive:true});
  await context.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/qaira-chatbot-context-ui/context-provenance-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await context.scrollIntoViewIfNeeded();
  assert.ok(await context.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'/tmp/qaira-chatbot-context-ui/context-provenance-mobile.png',fullPage:true});
  await page.reload();await restore();
  await page.getByRole('region',{name:'Context for this answer',exact:true}).getByText('Recorded task context · response outcome recorded',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)]);}
});
