import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../../frontend/lib/aiPromptFiles.ts', import.meta.url), 'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText;
function fixture({excerpts='',accessError}={}) {
  const uploads=[];const documents=[];
  const dependencies={
    '@hellotest/platform/client':{platformApi:{attachments:{meta:async()=>({enabled:true,uploadLimit:1000000}),upload:async(scope,file)=>{uploads.push({scope,file});return{id:'private-original'}},aiAccess:async()=>{if(accessError)throw accessError;return{url:'https://evidence.example.test/temporary?signature=fixture',expires_at:'2026-10-22T12:00:00Z'}}}}},
    '@hellotest/ai/frontend/lib/aiDesignStudio':{SMART_CONTEXT_START:'[HELLOTEST_SMART_CONTEXT_START]',SMART_CONTEXT_END:'[HELLOTEST_SMART_CONTEXT_END]',buildFileContextSection:async files=>{documents.push(files);return{section:excerpts,overLimit:false,skipped:[]}}},
    '@hellotest/manual/frontend/lib/attachmentChecksum':{attachmentChecksum:async()=> 'a'.repeat(64)}
  };
  const exports={};new Function('exports','require',compiled)(exports,id=>{assert.ok(dependencies[id],id);return dependencies[id]});
  const image={name:'checkout.png',type:'image/png',size:68,arrayBuffer:async()=>new ArrayBuffer(68)};
  return {...exports,uploads,documents,image};
}

test('image-only sources retain original upload objects and bounded signed reference metadata',async()=>{
  const {prepareAiPromptFiles,uploads,documents,image}=fixture();
  const result=await prepareAiPromptFiles({projectId:'project-1',files:[image],additionalContext:'',maxContextChars:12000});
  assert.equal(uploads[0].file,image);
  assert.deepEqual(uploads[0].scope,{project_id:'project-1',entity_type:'project',entity_id:'project-1'});
  assert.deepEqual(documents,[[]],'Image bytes are sent through the vision payload instead of text extraction');
  assert.deepEqual(result.attachmentIds,['private-original']);
  assert.match(result.additionalContext,/https:\/\/evidence.example.test\/temporary\?signature=fixture/);
  assert.match(result.additionalContext,/URL text alone does not prove the model fetched a document/);
});

test('Defect 12000-character limit rejects oversized packed evidence while other authoring retains 18000',async()=>{
  const {prepareAiPromptFiles,image}=fixture({excerpts:'source '.repeat(80)});
  await assert.rejects(prepareAiPromptFiles({projectId:'project-1',files:[image],additionalContext:'x'.repeat(11800),maxContextChars:12000}),/12,000 character authoring limit/);
  const standard=await prepareAiPromptFiles({projectId:'project-1',files:[image],additionalContext:'x'.repeat(11800)});
  assert.ok(standard.additionalContext.length>12000&&standard.additionalContext.length<18000);
});

test('oversized manual context is rejected even with no files before any source upload',async()=>{
  const {prepareAiPromptFiles,uploads}=fixture();
  await assert.rejects(prepareAiPromptFiles({projectId:'project-1',files:[],additionalContext:'x'.repeat(12001),maxContextChars:12000}),/12,000 character authoring limit/);
  assert.deepEqual(uploads,[]);
});

test('local deployments retain private originals without provider URLs and access denial remains actionable',async()=>{
  const local=fixture({accessError:Object.assign(new Error('Public evidence access is not configured'),{status:503})});
  const result=await local.prepareAiPromptFiles({projectId:'project-1',files:[local.image],additionalContext:''});
  assert.deepEqual(result.attachmentIds,['private-original']);
  assert.doesNotMatch(result.additionalContext,/https?:\/\//);
  const denied=fixture({accessError:Object.assign(new Error('Attachment access denied'),{status:403})});
  await assert.rejects(denied.prepareAiPromptFiles({projectId:'project-1',files:[denied.image],additionalContext:''}),/Attachment access denied/);
});
