import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const modules = new Map();
function load(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const exports = {}; modules.set(url.href, exports);
  const require = createRequire(url);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','require',code)(exports, id => {
    // Rendering rich text is orthogonal to the actual data resolver/emitter.
    if (id.endsWith('/RichTextEditor')) return {richTextToPlainText: value => String(value || '')};
    const filename = require.resolve(id.startsWith('.') && !/\.[a-z]+$/i.test(id) ? `${id}.ts` : id);
    return filename.endsWith('.ts') ? load(pathToFileURL(filename)) : require(filename);
  });
  return exports;
}
const {buildPlaywrightExport} = load(new URL('../../frontend/lib/playwrightExport.ts',import.meta.url));
const section = {id:'current',step_order:1,step_type:'web',action:'Enter the configured data',automation_code:'await page.locator("#name").fill("@t.public");'};
const data = source => ({rows:JSON.parse(source.match(/const rows: DataValues\[\] = ([\s\S]*?);\nconst sectionRows:/)[1]),
  sections:JSON.parse(source.match(/const sectionRows: DataValues\[\]\[\] = ([\s\S]*?);\n\/\/ #endregion/)[1])});

test('download privacy survives removed source resources with opaque own and inherited markers and exact public aliases', () => {
  const options = {testCase:{id:'case',title:'Private reviewed data',test_data_options:{parameter_overrides:['r.opaque_input'],private_parameter_names:['@R.opaque_input','r.empty']},effective_private_parameter_names:['t.inherited']},
    values:{'r.opaque_input':'OWN_PRIVATE_SENTINEL','t.alias':'OWN_PRIVATE_SENTINEL','t.inherited':'INHERITED_PRIVATE_SENTINEL','s.alias':'INHERITED_PRIVATE_SENTINEL','r.empty':'','t.otherempty':'','t.public':'Visible'},steps:[section]};
  const before = structuredClone(options);
  const source = buildPlaywrightExport(options);
  assert.doesNotMatch(source,/OWN_PRIVATE_SENTINEL|INHERITED_PRIVATE_SENTINEL/);
  const emitted=data(source);
  assert.deepEqual(emitted.rows,[{'r.empty':'','t.otherempty':'','t.public':'Visible'}]);
  for(const row of emitted.sections.flat()){
    assert.equal(row['t.public'],'Visible');assert.equal(Object.hasOwn(row,'r.opaque_input'),false);assert.equal(Object.hasOwn(row,'t.inherited'),false);
    assert.equal(Object.hasOwn(row,'t.alias'),false);assert.equal(Object.hasOwn(row,'s.alias'),false);
  }
  assert.match(source,/QAIRA_DATA_JSON/);
  assert.deepEqual(options,before);
});

test('private aliases are classified from raw layers before replacement, including datasets and environment bindings', () => {
  const source=buildPlaywrightExport({testCase:{id:'case',title:'Raw source aliases',test_data_options:{private_parameter_names:['t.opaque']}},
    values:{'t.opaque':'REPLACED_PRIVATE_SENTINEL','t.rawalias':'REPLACED_PRIVATE_SENTINEL','t.envalias':'ENV_PRIVATE_SENTINEL','t.datasetalias':'DATA_PRIVATE_SENTINEL','t.public':'Visible'},
    configuration:{id:'config',variables:[{key:'t.opaque',value:'Replacement'}]},
    environment:{id:'env',variables:[{key:'r.opaque',value:'ENV_PRIVATE_SENTINEL',is_secret:true}]},
    dataSet:{id:'data',mode:'key_value',columns:[],rows:[{key:'r.opaque_data',value:'DATA_PRIVATE_SENTINEL',is_secret:true}]},steps:[section]});
  assert.doesNotMatch(source,/REPLACED_PRIVATE_SENTINEL|ENV_PRIVATE_SENTINEL|DATA_PRIVATE_SENTINEL/);
  const emitted=data(source);
  assert.deepEqual(emitted.rows,[{'t.public':'Visible'}]);
  assert.deepEqual(emitted.sections,[[{'t.public':'Visible'}]]);
});
