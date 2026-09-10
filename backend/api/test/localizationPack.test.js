const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../src/db');
const settings = require('../src/services/settings.service');
test('invalid language packs reject atomically without changing workspace settings', async()=>{
 const original = db.prepare; let writes = 0;
 db.prepare = () => ({run: async()=>{writes+=1;}});
 try {
  for(const value of [[], {'nav.home':{}}, {'meta.direction':'sideways'}, {'meta.language':'not_a_tag'}, JSON.parse('{"__proto__":"text"}'), {'nav.home':'x'.repeat(10001)},Object.fromEntries(Array.from({length:2001},(_,i)=>['key'+i,'text']))]) {
   await assert.rejects(settings.updateLocalizationStrings(value), error=>error.statusCode===400);
  }
  assert.equal(writes,0);
  const result=await settings.updateLocalizationStrings({'meta.language':'es','meta.direction':'ltr','nav.home':'Inicio'});
  assert.equal(result.strings['nav.home'],'Inicio');assert.equal(writes,1);
 } finally {db.prepare=original;}
});
