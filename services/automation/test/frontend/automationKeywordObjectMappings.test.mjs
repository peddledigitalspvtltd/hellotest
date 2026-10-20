import assert from 'node:assert/strict';
import test from 'node:test';
import {buildAutomationKeywordMappings} from '../../frontend/lib/stepAutomation.ts';

const field = (id,locator,screenName='Login',objectName='Customer email',metadata={}) => ({
  id,locator,page_key:screenName,locator_intent:objectName,
  metadata:{screen_name:screenName,object_name:objectName,...metadata}
});

test('keyword mapping preserves the unique curated field and never borrows a substring match',()=>{
 const repository=[field('email','#email')],original=structuredClone(repository);
 const [matched,other]=buildAutomationKeywordMappings('await web.fill("#email", "one"); await web.fill("#email_secondary", "two");',repository);
 assert.equal(matched.objectName,'Customer email');assert.equal(matched.screenName,'Login');assert.equal(matched.displayTarget,'Customer email');
 assert.equal(other.target,'#email_secondary');assert.equal(other.displayTarget,'#email_secondary');assert.equal(other.objectName,undefined);
 assert.deepEqual(repository,original);
});

test('same selectors on different screens or routes stay explicit until an unambiguous binding exists',()=>{
 const repository=[field('first','#email','Sign in'),field('second','#email','Sign up','New account email',{observed_route_sha256:'b'.repeat(64)})];
 for(const rows of [repository,[...repository].reverse()]){
  const [mapping]=buildAutomationKeywordMappings('await web.fill("#email", "one");',rows);
  assert.equal(mapping.displayTarget,'#email');assert.equal(mapping.objectName,undefined);assert.equal(mapping.screenName,undefined);
 }
});

test('retired redirects do not create false ambiguity or replace the active curated field',()=>{
 const repository=[field('old','#email','Old login','Retired email',{merged_into_entry_id:'active'}),field('active','#email','Account','Primary email')];
 const [mapping]=buildAutomationKeywordMappings('const email=page.locator("#email");\nawait email.fill("one");',repository);
 assert.equal(mapping.displayTarget,'Primary email');assert.equal(mapping.screenName,'Account');
});
