const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const file=require.resolve('../../backend/services/requirementDesign.service'),local=createRequire(file);

function fixture({deny=false,failCopy=false}={}){
  const events=[];
  const references={
    referenceIds:ids=>ids||[],
    verifyReferences:async({ids})=>{events.push(['verify',...ids]);if(deny)throw Object.assign(new Error('Denied source'),{statusCode:403});},
    retainReferences:async({ids,entityId})=>{events.push(['retain',entityId,...ids]);if(failCopy)throw new Error('Storage unavailable');return ids.map(id=>({id:'copy-'+id}));}
  };
  const overrides={
    '@hellotest/platform/backend/services/aiAttachmentAccess.service':references,
    '@hellotest/testing/backend/services/testCase.service':{createTestCase:async input=>{events.push(['create',input.title]);return{id:'case-'+events.length};}}
  };
  const module={exports:{}};new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>overrides[id]||local(id),module,module.exports);
  return{service:module.exports,events};
}
const candidate={title:'Checkout retains delivery address',description:'Preserve the chosen delivery address.',priority:3,test_case_type:'functional',steps:[{action:'Submit the checkout',expected_result:'The order uses the chosen address'}],reference_attachment_ids:['source-file']};
const request={requirements:[],appType:{id:'app',project_id:'project'},created_by:'author',cases:[candidate]};

test('accepted cases retain the supplied source evidence and validate all sources before any creation',async()=>{
  const{service,events}=fixture();const result=await service.acceptGeneratedTestCases({...request,cases:[candidate,{...candidate,title:'Other checkout'}]});
  assert.deepEqual(events.slice(0,2),[['verify','source-file'],['verify','source-file']]);
  assert.equal(result.accepted,2);assert.deepEqual(result.created[0].attachment_ids,['copy-source-file']);assert.deepEqual(result.created[0].pending_reference_attachment_ids,[]);
  assert.equal(events.filter(event=>event[0]==='retain').length,2);
});
test('denied reference evidence prevents any case from being created',async()=>{
  const{service,events}=fixture({deny:true});await assert.rejects(service.acceptGeneratedTestCases(request),{statusCode:403});assert.equal(events.some(event=>event[0]==='create'),false);
});
test('a storage interruption returns the saved case and exact pending evidence instead of replaying creation',async()=>{
  const{service,events}=fixture({failCopy:true});const result=await service.acceptGeneratedTestCases(request);
  assert.equal(result.accepted,1);assert.deepEqual(result.created[0].attachment_ids,[]);assert.deepEqual(result.created[0].pending_reference_attachment_ids,['source-file']);assert.equal(events.filter(event=>event[0]==='create').length,1);
});
