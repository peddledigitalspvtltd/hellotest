const test=require('node:test'),assert=require('node:assert/strict');
const {projectModelSnapshot}=require('../../backend/lib/automationBrowserModelTargets');
const {compactBrowserModelContext}=require('../../backend/lib/automationBrowserModelContext');
const element=(id,tag,readonly)=>({tag,attributes:{id,type:'text','aria-readonly':'true'},displayed:true,disabled:false,locators_validated:true,locator_candidates:['#'+id],...(readonly===undefined?{}:{readonly})});
test('readonly is a native scalar hint for inputs/textarea, never inferred editability or assertion proof',()=>{
 const observation={tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://fixture.test/',observation_id:'readonly-controls',scope:'body',elements:[
  element('location','input',true),element('text','textarea',false),element('unknown','input'),element('select','select',true),element('aria-only','div',true),element('wrong-type','input','true')
 ]})}]}};
 const snapshot=projectModelSnapshot(observation);assert.equal(snapshot.targets[0].readonly,true);assert.equal(snapshot.targets[1].readonly,false);
 for(const target of snapshot.targets.slice(2))assert.equal(Object.hasOwn(target,'readonly'),false);
 assert.ok(snapshot.targets.every(target=>!Object.hasOwn(target,'editable')&&!Object.hasOwn(target,'assertion_outcome')));
 const packed=compactBrowserModelContext({current_snapshot:snapshot}).current_snapshot;
 assert.equal(packed.targets[0].readonly,true);assert.equal(packed.targets[1].readonly,false);
 assert.equal(Object.hasOwn(packed.targets[2],'readonly'),false,'missing readonly never inherits another target flag');
});
