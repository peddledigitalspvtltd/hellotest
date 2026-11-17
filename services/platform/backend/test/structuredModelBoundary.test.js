const test=require('node:test');const assert=require('node:assert/strict');const {decodeStructuredCompletion}=require('../src/utils/structuredModelBoundary');
const payload=(content,finish_reason='stop')=>({choices:[{message:{content},finish_reason}]});
test('shared structured completion boundary rejects truncation/refusal/incomplete JSON and preserves valid object',()=>{
 assert.deepEqual(decodeStructuredCompletion(payload('```json\n{"draft":{"value":"braces {}"}}\n```')),{draft:{value:'braces {}'}});
 assert.throws(()=>decodeStructuredCompletion(payload('{"draft":','length')),{code:'AI_OUTPUT_TRUNCATED'});
 assert.throws(()=>decodeStructuredCompletion(payload('[]')),{code:'AI_INVALID_OUTPUT'});
 assert.throws(()=>decodeStructuredCompletion({choices:[{message:{refusal:'cannot'},finish_reason:'stop'}]}),{code:'AI_MODEL_REFUSAL'});
 assert.throws(()=>decodeStructuredCompletion(payload('{"draft":')),{code:'AI_INVALID_OUTPUT'});
});
