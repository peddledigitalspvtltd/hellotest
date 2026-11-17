import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, existsSync, mkdirSync, cpSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {checkRuntimeExports}=require('../build/check-runtime-exports.cjs');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'hellotest-runtime-exports-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'services/platform/backend'),{recursive:true});
 await mkdir(join(root,'services/platform/shared'),{recursive:true});
 await mkdir(join(root,'node_modules/@hellotest'),{recursive:true});
 await writeFile(join(root,'package.json'),'{}');
 await writeFile(join(root,'services/platform/package.json'),JSON.stringify({name:'@hellotest/platform',exports:{'./backend':'./backend/index.js','./shared/metricCatalog.json':'./shared/metricCatalog.json','./frontend':'./frontend/entry.ts'}}));
 await writeFile(join(root,'services/platform/backend/index.js'),'module.exports={};');
 await symlink(join(root,'services/platform'),join(root,'node_modules/@hellotest/platform'));
 return root;
}
test('runtime build verification rejects a missing shared metric catalog before startup',async t=>{
 const root=await fixture(t);
 assert.throws(()=>checkRuntimeExports(root),/Runtime exports are missing[\s\S]*@hellotest\/platform\/shared\/metricCatalog\.json/);
});
test('runtime build verification resolves packaged backend/shared exports without requiring frontend source',async t=>{
 const root=await fixture(t);
 await writeFile(join(root,'services/platform/shared/metricCatalog.json'),'[]');
 assert.equal(checkRuntimeExports(root),2);
});

async function contractsFixture(t) {
 const root=await fixture(t);
 await writeFile(join(root,'services/platform/shared/metricCatalog.json'),'[]');
 await mkdir(join(root,'services/contracts/agents'),{recursive:true});
 await mkdir(join(root,'services/contracts/runtime'),{recursive:true});
 await writeFile(join(root,'services/contracts/package.json'),JSON.stringify({name:'@hellotest/contracts',exports:{
  './agents':{types:'./agents/index.d.ts',default:'./agents/index.js'},'./agents/*':'./agents/*.js','./runtime/retry':'./runtime/retry.js'
 }}));
 await symlink(join(root,'services/contracts'),join(root,'node_modules/@hellotest/contracts'));
 await writeFile(join(root,'services/contracts/agents/index.js'),'module.exports={};');
 await writeFile(join(root,'services/contracts/agents/helper.js'),'module.exports={};');
 await writeFile(join(root,'services/contracts/runtime/retry.js'),'module.exports={};');
 return root;
}

test('runtime verification follows short public ports and conditional contracts without requiring declaration files',async t=>{
 const root=await contractsFixture(t);
 assert.equal(checkRuntimeExports(root),6);
 await rm(join(root,'services/contracts/runtime/retry.js'));
 assert.throws(()=>checkRuntimeExports(root),/@hellotest\/contracts\/runtime\/retry/);
});

test('a missing concrete wildcard consumer is detected even when another wildcard member was packaged',async t=>{
 const root=await contractsFixture(t);
 await writeFile(join(root,'services/platform/backend/index.js'),"const helper=require('@hellotest/contracts/agents/missing'); module.exports=helper;");
 assert.throws(()=>checkRuntimeExports(root),/@hellotest\/contracts\/agents\/missing/);
});

test('runtime verification rejects a missing workspace manifest before optional runtime startup',async t=>{
 const root=await fixture(t);
 await writeFile(join(root,'services/platform/shared/metricCatalog.json'),'[]');
 const filename=join(root,'services/platform/package.json');
 const manifest=JSON.parse(await import('node:fs/promises').then(fs=>fs.readFile(filename,'utf8')));
 manifest.dependencies={'@hellotest/contracts':'^1.0.0'};await writeFile(filename,JSON.stringify(manifest));
 assert.throws(()=>checkRuntimeExports(root),/@hellotest\/contracts: workspace manifest missing/);
});

test('the API Dockerfile runtime copy surface contains all public runtime ports without frontend source or service evaluation', async t => {
 const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
 const image = await mkdtemp(join(tmpdir(), 'hellotest-api-copy-surface-'));t.after(()=>rm(image,{recursive:true,force:true}));
 const dockerfile = readFileSync(join(root, 'services/platform/backend/Dockerfile'), 'utf8').split('FROM node:20-alpine AS runtime')[1];
 assert.ok(dockerfile, 'Use the real API runtime stage.');
 const filter = filename => !filename.split('/').some(part=>['node_modules','dist','dist-admin','coverage','data'].includes(part))
  && !/(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|env|tsbuildinfo)$/.test(filename);
 for (const line of dockerfile.split('\n').filter(line=>line.startsWith('COPY ')&&!line.includes('--from='))) {
  const args = line.split(/\s+/).slice(1).filter(arg=>!arg.startsWith('--')), destination = args.pop();
  for (const pattern of args) {
   const sources = pattern.includes('*') ? readdirSync(join(root,dirname(pattern))).filter(name=>name.startsWith('package')&&name.endsWith('.json')).map(name=>join(dirname(pattern),name)) : [pattern];
   for (const source of sources) {
    const from=join(root,source),to=join(image,destination.endsWith('/')?join(destination,basename(source)):destination);
    mkdirSync(dirname(to),{recursive:true});cpSync(from,to,{recursive:true,filter});
   }
  }
 }
 mkdirSync(join(image,'node_modules/@hellotest'),{recursive:true});
 for (const owner of readdirSync(join(image,'services'))) if (existsSync(join(image,'services',owner,'package.json'))) symlinkSync(join(image,'services',owner),join(image,'node_modules/@hellotest',owner));
 assert.ok(existsSync(join(image,'services/contracts/evidence/index.js')));
 assert.equal(existsSync(join(image,'services/automation/frontend')),false);
 assert.ok(checkRuntimeExports(image)>200,'Exercise the actual short, conditional and consumed runtime surface.');
});
