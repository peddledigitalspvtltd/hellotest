import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
