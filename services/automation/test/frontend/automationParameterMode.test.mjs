import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {PARAMETER_EXPRESSIONS_MARKER as marker,markExpressionParameterBindings,usesExpressionParameterBindings} from '../../shared/automationParameterMode.mjs';
import {automationSourceSha256} from '../../shared/automationInstructionMapping.mjs';
import {automationNumericArgument,automationParameterArgument,automationStringArgument} from '../../frontend/lib/automationKeywordInputs.ts';
import {readAutomationInstructions,joinAutomationInstructions} from '../../frontend/lib/automationInstructions.ts';
import {resolveAutomationMappingSave} from '../../frontend/lib/automationStepPersistence.ts';

test('only the portable leading comment enables expression mode, including preceding ordinary comments and BOM',()=>{
 for(const prefix of ['', '\ufeff \n', '// ordinary\n', '/* ordinary block */\n'])for(const newline of ['\n','\r\n','\r'])assert.equal(usesExpressionParameterBindings(prefix+marker+newline+'await next();'),true);
 for(const code of [JSON.stringify(marker),`/* ${marker} */`, `await next();\n${marker}`,marker+'-extra',`const data=\`\n${marker}\n\`;`])assert.equal(usesExpressionParameterBindings(code),false);
 assert.equal(markExpressionParameterBindings(marker+'\nawait next();'),marker+'\nawait next();');
});

test('native keyword arguments bind exact/scoped composites once and preserve literal email, quotes, escapes and legacy inputs',async()=>{
 assert.equal(automationStringArgument('@r.[url]',true),'params["r.url"]');
 assert.equal(automationStringArgument('@r.name',false),'"@r.name"');
 for(const value of ['reader@r.first.test','quoted "value"\nnext \\ line','plain literal'])assert.equal(automationStringArgument(value,true),JSON.stringify(value));
 const expression=automationStringArgument('@r.[url]client/@t.name',true);
 const result=new Function('params',`return ${expression};`)({'r.url':'https://app.test/','t.name':'@r.other'});
 assert.equal(result,'https://app.test/client/@r.other');
 assert.throws(()=>automationStringArgument('x'.repeat(2001)+' @r.name',true),/bounded instructions/);
});

test('instruction moves/removals preserve marker, exact source bytes and source hash while replacement cannot downgrade mode',()=>{
 const code=marker+'\nawait page.goto(params["r.url"] + "client");\nawait page.getByLabel("Name").fill(params["r.name"]);';
 const document=readAutomationInstructions(code,{unwrapEntry:true});
 assert.equal(document.prefix,marker+'\n');assert.equal(document.instructions.length,2);
 assert.equal(joinAutomationInstructions(document),code);
 assert.equal(automationSourceSha256(joinAutomationInstructions(document)),createHash('sha256').update(code).digest('hex'));
 const changed=joinAutomationInstructions(document,[document.instructions[1]]);
 assert.equal(usesExpressionParameterBindings(changed),true);assert.match(changed,/fill\(params\["r.name"\]\)/);
 assert.notEqual(automationSourceSha256(changed),automationSourceSha256(code));
 assert.deepEqual(resolveAutomationMappingSave({currentCode:code,previousMappingCode:code,nextMappingCode:'await web.fill("#name","@r.name");',mappingUnchanged:false}),{code,requiresProgramEditor:true});
});

test('actual StepAutomationEditor keyword append uses native expressions for a marked current program and leaves legacy source unchanged',async()=>{
 const source=readFileSync(new URL('../../frontend/components/StepAutomationEditor.tsx',import.meta.url),'utf8');
 const tree=ts.createSourceFile('editor.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const names=['buildWebKeywordSnippet','playwrightLocatorExpression','quoteCodeString','formatOptionsObject'];
 const selected=tree.statements.filter(node=>names.includes(node.name?.text)||ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>names.includes(declaration.name.getText(tree))));
 const script=ts.transpileModule(selected.map(node=>node.getText(tree)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const snippet=new Function('automationStringArgument','automationParameterArgument','automationNumericArgument',`${script};return buildWebKeywordSnippet;`)(automationStringArgument,automationParameterArgument,automationNumericArgument);
 for(const native of [false,true]){
  const code=snippet({id:'fill'},'#name','@r.name',native);
  assert.match(code,native?/fill\(params\["r.name"\]\)/:/fill\("@r.name"\)/);
  const calls=[];const target={waitFor:async()=>{},fill:async value=>calls.push(value)};
  await new (Object.getPrototypeOf(async function(){}).constructor)('page','params',code)({locator:()=>target},{'r.name':'reader@r.other.test'});
  assert.deepEqual(calls,[native?'reader@r.other.test':'@r.name']);
 }
 assert.match(source,/buildWebKeywordSnippet\([\s\S]*?usesExpressionParameterBindings\(automationCode\)/);
});
