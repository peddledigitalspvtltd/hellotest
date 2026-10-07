import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);
const source=await readFile(new URL('agentWorkspace.test.mjs',import.meta.url),'utf8');
let fixture=source.match(/const fixture = `([\s\S]*?)`;\nconst specialists/)[1];
fixture += `\nimport '/src/catalog-list.css';`;
fixture=fixture.replace("import { AgenticWorkflowsPage } from '/services/agentic/frontend/pages/AgenticWorkflowsPage';", "import { McpServersPage } from '/services/agentic/frontend/pages/McpServersPage';\nimport {agenticApi} from '/services/agentic/frontend/api.client';").replace('<AgenticWorkflowsPage />','<McpServersPage />');
fixture=fixture.replace('const client = new QueryClient', `
window.mcpCalls=[];
agenticApi.mcp.server=async()=>({id:'hellotest',name:'HelloTest',builtin:true,endpoint:'/api/mcp',tools:[{name:'hellotest_context_build',description:'Retrieve authorized project evidence',read_only:true}]});
agenticApi.mcp.credentials=async()=>window.mcpCredential?[{id:'credential',client_id:'external-host',expires_at:new Date(Date.now()+3600000).toISOString(),revoked_at:window.revoked?'2026-10-06':null}]:[];
agenticApi.mcp.issue=async projectId=>{window.mcpCalls.push(['issue',projectId]);window.mcpCredential=true;return {id:'credential',token:'fixture-secret',expires_at:new Date(Date.now()+3600000).toISOString()};};
agenticApi.mcp.revoke=async(projectId,id)=>{window.revoked=true;window.mcpCalls.push(['revoke',projectId,id]);};
agenticApi.mcp.plans=async()=>[{id:'plan-review',client_id:'external-host',state:window.approved?'authorized':'requires_authorization',operation:{method:'POST',path:'/test-cases',permission:'testcase.create'},arguments:{body:{title:'Reviewed case'}},digest:'fixed-digest',expires_at:new Date(Date.now()+600000).toISOString()}];
agenticApi.mcp.authorize=async(projectId,id,digest)=>{window.approved=true;window.mcpCalls.push(['authorize',projectId,id,digest]);};
window.savedMcpServers=[{id:'remote',kind:'mcp',name:'Remote QA tools',url:'https://tools.example.test/mcp',tools:['lookup'],enabled:true,authenticated:true,transport:'streamable-http',authType:'none',methods:[],headers:{},project_id:'project'}];
agenticApi.workflowConnections.list=async()=>structuredClone(window.savedMcpServers);
agenticApi.workflowConnections.discoverDraft=async()=>({tools:[{name:'lookup',description:'Lookup',inputSchema:{type:'object'}}],serverInfo:{name:'Fixture'},protocolVersion:'2025-11-25',discovered_at:new Date().toISOString()});
agenticApi.workflowConnections.create=async input=>{window.mcpCalls.push(['create',input]);const row={...input,id:'new'};window.savedMcpServers.push(row);return row;};
const client = new QueryClient`);
test('MCP directory supports search, external creation, project credentials and exact-plan review across layouts',{timeout:90000},async()=>{
 const name='mcp-directory-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try{
  await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);await page.getByRole('button',{name:'Connect & inspect'}).waitFor();assert.equal(await page.locator('.mcp-server-card').count(),2);const tileBox=await page.locator('.mcp-server-card').first().boundingBox();assert.ok(tileBox.width<=321,'Tiles keep their compact card width');
  const toolbarButtons=[page.getByLabel('Search MCP servers'),page.getByRole('button',{name:'Create MCP server',exact:true}),page.getByRole('button',{name:'Select all',exact:true}),page.getByRole('button',{name:'Clear all',exact:true})];const toolbarBounds=await Promise.all(toolbarButtons.map(control=>control.boundingBox()));const toolbarCenters=toolbarBounds.map(box=>box.y+box.height/2);assert.ok(Math.max(...toolbarCenters)-Math.min(...toolbarCenters)<2,'MCP search, creation and selection share one centered line: '+JSON.stringify(toolbarBounds));
  assert.equal(await page.getByRole('navigation',{name:'Agent workspace navigation'}).count(),0);
  await page.getByRole('button',{name:'Select all',exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:'Select HelloTest'}).isChecked(),true);
  await page.getByRole('button',{name:'Clear all',exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:'Select HelloTest'}).isChecked(),false);
  await page.getByRole('button',{name:'List view',exact:true}).click();assert.equal(await page.locator('.mcp-server-catalog.is-list').count(),1);await page.getByRole('columnheader').filter({hasText:'Server'}).waitFor();await page.getByRole('button',{name:'Select all',exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:'Select row 1',exact:true}).isChecked(),true);await page.getByRole('button',{name:'Clear all',exact:true}).click();
  await page.getByRole('button',{name:'Tile view',exact:true}).click();
  await mkdir('/tmp/qaira-mcp-ui',{recursive:true});await page.screenshot({path:'/tmp/qaira-mcp-ui/directory-desktop.png',fullPage:true});
  await page.getByLabel('Search MCP servers').fill('Remote');assert.equal(await page.locator('.mcp-server-card').count(),1);await page.getByLabel('Search MCP servers').fill('');
  await page.getByRole('button',{name:'Connect & inspect'}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Create host credential'}).click();await dialog.locator('input[type=password]').waitFor();assert.equal(await dialog.locator('input[type=password]').inputValue(),'fixture-secret');
  await dialog.getByText('requires_authorization · plan-rev · external-host').click();await dialog.getByRole('button',{name:'Authorize this exact plan'}).click();await dialog.getByText('This exact plan is authorized.',{exact:false}).waitFor();assert.deepEqual(await page.evaluate(()=>window.mcpCalls.find(call=>call[0]==='authorize')),['authorize','project','plan-review','fixed-digest']);
  await dialog.getByRole('button',{name:'Revoke external-host'}).click();await dialog.getByText('external-host · Revoked').waitFor();
  for(const width of [768,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:`/tmp/qaira-mcp-ui/dialog-${width}.png`,fullPage:true});}
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'/tmp/qaira-mcp-ui/directory-mobile.png',fullPage:true});await page.setViewportSize({width:390,height:500});await page.getByRole('button',{name:'Create MCP server',exact:true}).click();const createDialog=page.getByRole('dialog',{name:'Create MCP server',exact:true});await createDialog.getByRole('button',{name:'Save connection',exact:true}).scrollIntoViewIfNeeded();assert.ok(await createDialog.evaluate(node=>node.scrollHeight>node.clientHeight&&node.scrollTop>0),'Long creation form scrolls to Save');const saveBox=await createDialog.getByRole('button',{name:'Save connection',exact:true}).boundingBox();assert.ok(saveBox.y>=0&&saveBox.y+saveBox.height<=500,'Save is reachable inside the viewport');await page.getByLabel('Connection name').fill('New server');await page.getByLabel('Server endpoint').fill('https://new.example.test/mcp');await page.getByRole('button',{name:'Test connection and discover tools'}).click();await page.getByLabel('Enable lookup').check();await page.getByRole('button',{name:'Save connection',exact:true}).click();await page.locator('.mcp-server-card .tile-card-title-group strong').filter({hasText:'New server'}).waitFor();
  await page.getByRole('button',{name:'Connect & inspect'}).click();await page.evaluate(()=>window.changeSpecialistProject());await page.getByRole('dialog').waitFor({state:'hidden'});assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([unlink(html).catch(()=>{}),unlink(tsx).catch(()=>{})]);}
});
