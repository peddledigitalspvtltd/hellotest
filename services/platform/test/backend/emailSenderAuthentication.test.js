const test=require('node:test');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const servicePath=require.resolve('../../backend/src/services/email.service');
const serviceRequire=createRequire(servicePath);
const nodemailer=serviceRequire('nodemailer');
const integration=serviceRequire('@hellotest/integration/backend/services/integration.service');
const email=require(servicePath);

function fixture(t,send){
  let sends=0;
  t.mock.method(integration,'getActiveIntegrationByType',async()=>({username:'sender@example.test',config:{host:'smtp.example.test',port:587,password:'FIXTURE_PRIVATE_PASSWORD'}}));
  t.mock.method(nodemailer,'createTransport',()=>({sendMail:async message=>{sends++;return send(message);}}));
  return ()=>sends;
}
const message={to:'recipient@example.test',subject:'Fixture verification',text:'Fixture content'};

test('SMTP authentication rejection identifies Email Sender without exposing the provider exception',async t=>{
  const sends=fixture(t,async()=>{throw Object.assign(new Error('Invalid login FIXTURE_PRIVATE_PASSWORD provider-private-response'),{code:'EAUTH',response:'provider-private-response'});});
  await assert.rejects(email.sendMail(message),error=>{
    assert.equal(error.code,'EMAIL_SENDER_AUTHENTICATION_FAILED');assert.equal(error.statusCode,503);
    assert.match(error.message,/Email Sender authentication was rejected/);
    assert.doesNotMatch(String(error.stack)+JSON.stringify(error),/FIXTURE_PRIVATE_PASSWORD|provider-private-response|Invalid login/);
    return true;
  });
  assert.equal(sends(),1,'a rejected submission is never retried automatically');
});

test('other delivery failures retain their outcome rather than being reported as an authentication rejection',async t=>{
  const failure=Object.assign(new Error('Delivery acknowledgement unavailable'),{code:'ETIMEDOUT'});
  const sends=fixture(t,async()=>{throw failure;});
  await assert.rejects(email.sendMail(message),error=>error===failure);
  assert.equal(sends(),1);
});

test('successful mail still requires the actual provider acknowledgement',async t=>{
  const sends=fixture(t,async payload=>{assert.equal(payload.to,message.to);assert.equal(payload.text,message.text);return {accepted:[message.to]};});
  assert.deepEqual(await email.sendMail(message),{sent:true});assert.equal(sends(),1);
});
