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

test('legacy defect labels normalize on read and import without changing custom text or keys', async (t) => {
 const original = {
  'nav.reportIssue':'Report an Issue', 'nav.feedback':'Bugs', 'page.issues':'issue',
  'page.feedback':'Issues', 'capability.bugs.name':'Bug',
  'page.custom':'Issues', 'nav.home':'Inicio', 'meta.language':'es'
 };
 let persisted;
 t.mock.method(db, 'prepare', () => ({
  get: async () => ({value: original}),
  run: async (_key, value) => {persisted = value;}
 }));
 const read = await settings.getLocalizationStrings();
 for (const key of ['nav.reportIssue','nav.feedback','page.issues','page.feedback','capability.bugs.name']) {
  assert.equal(read[key], 'Defects');
 }
 assert.equal(original['nav.reportIssue'], 'Report an Issue', 'Reads must not mutate stored settings');
 assert.equal(read['page.custom'], 'Issues');
 assert.equal(read['meta.language'], 'es');
 const saved = await settings.updateLocalizationStrings({
  ...original, 'nav.feedback':'Incidencias', 'page.issues':'Customer Issues', 'page.feedback':' Defects '
 });
 assert.equal(saved.strings['nav.reportIssue'], 'Defects');
 assert.equal(saved.strings['nav.feedback'], 'Incidencias');
 assert.equal(saved.strings['page.issues'], 'Customer Issues');
 assert.equal(saved.strings['page.feedback'], ' Defects ');
 assert.deepEqual(persisted, saved.strings);
 assert.deepEqual(Object.keys(persisted), Object.keys(original));
});
