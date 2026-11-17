const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parseDocument}=require('yaml');
test('authentication OpenAPI retains legacy login and documents the new-password, privacy and recovery contracts',()=>{
 const document=parseDocument(fs.readFileSync(path.resolve(__dirname,'../../../../openapi.yaml'),'utf8'),{uniqueKeys:true});assert.deepEqual(document.errors,[]);const api=document.toJS(),schemas=api.components.schemas;
 for(const [schema,field] of [['SignupRequest','password'],['CreateUserRequest','password'],['UpdateUserRequest','password'],['PasswordResetCodeRequest','newPassword']])assert.equal(schemas[schema].properties[field].minLength,10);
 assert.equal(schemas.LoginRequest.properties.password.minLength,6);assert.ok(api.paths['/auth/signup/request-code'].post.responses['200']);assert.equal(api.paths['/auth/signup/request-code'].post.responses['409'],undefined);
 assert.deepEqual(schemas.VerificationDispatchResponse.required,['success','message','expiresAt']);
 assert.equal(api.paths['/auth/login'].post.responses['429'].headers['Retry-After'].schema.maximum,900);assert.ok(api.paths['/users/{id}/unlock-login'].post.responses['403']);assert.match(api.paths['/users/{id}/unlock-login'].post.description,/user.manage/);
 assert.equal(schemas.AuthSetupResponse.properties.policy.$ref,'#/components/schemas/AuthPolicy');assert.ok(schemas.AuthPolicy.required.includes('passwordResetAcknowledgement'));
});
