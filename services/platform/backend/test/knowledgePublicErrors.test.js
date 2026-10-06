const test=require('node:test'),assert=require('node:assert/strict');
const {publicKnowledgeError}=require('../src/utils/knowledgeAssistantErrors');
test('model failures expose safe actionable categories rather than provider text or false evidence availability',()=>{
 const message=publicKnowledgeError({code:'MODEL_INVALID_RESPONSE',statusCode:502,message:'PRIVATE_PROVIDER_BODY'});
 assert.match(message,/could not be validated/);assert.match(message,/configured model/);assert.ok(!message.includes('PRIVATE_PROVIDER_BODY'));assert.ok(!message.includes('available below'));
 assert.match(publicKnowledgeError({code:'MODEL_AUTHENTICATION_FAILED',statusCode:502}),/connection credentials/);
 assert.equal(publicKnowledgeError({statusCode:500,message:'database password private'}),'The knowledge request could not be completed. Try again.');
});
