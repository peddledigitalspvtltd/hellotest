import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const require=createRequire(new URL('../../../platform/frontend/package.json',import.meta.url));
const ts=require('typescript');
const source=await readFile(new URL('../../frontend/lib/attachmentChecksum.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
test('attachment content identity matches SHA-256 across native Web Crypto and private HTTP fallback',async()=>{
 for(const crypto of [{},webcrypto]){
  const context={exports:{},crypto,setTimeout};runInNewContext(compiled,context);
  for(const bytes of [Buffer.alloc(0),Buffer.from('abc'),Buffer.from('Résumé: delivery 🚚'),...[55,56,63,64,65,127,128,4096,1024*1024].map(size=>randomBytes(size))]){
   const original=Uint8Array.from(bytes).buffer;
   assert.equal(await context.exports.attachmentChecksum(original),createHash('sha256').update(bytes).digest('hex'));
  }
 }
});
