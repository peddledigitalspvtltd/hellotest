import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';

const invalidationsFor = (file, callback) => {
  const source = readFileSync(new URL('../src/pages/'+file,import.meta.url),'utf8');
  const tree = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let body;
  const locate = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === callback) body = node.initializer;
    ts.forEachChild(node,locate);
  };
  locate(tree);
  assert.ok(body,callback+' exists');
  const options=[];
  const collect = node => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'queryClient.invalidateQueries') {
      const argument = node.arguments[0].getText(tree);
      const exports={};
      new Function('exports','projectId','appTypeId','selectedTestCaseId','executionId','sprintChildrenPrefix','moduleChildrenPrefix','reviewSummaryQueryKey',
        ts.transpileModule('export const options='+argument,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
      )(exports,'project','app','case','run',['sprint-requirement-children','project'],['test-case-module-children','project','app'],['test-case-review-summary','reader','project','app']);
      options.push(exports.options);
    }
    ts.forEachChild(node,collect);
  };
  collect(body);
  return options;
};

for (const [file,callback,evidenceKey] of [
  ['RequirementsPage.tsx','refresh','release-review-stories'],
  ['TestCasesPage.tsx','refreshCases','release-review-cases'],
  ['IssuesPage.tsx','refresh','release-review-bugs'],
  ['ExecutionsPage.tsx','refreshExecutionScope','release-review-runs']
]) {
  test(file+' mutations expire cached product metrics only in the affected project',async()=>{
    const client=new QueryClient({defaultOptions:{queries:{staleTime:60000}}});
    const keys=project=>[
      ['requirement-release-readiness','project',project,'reader'],
      ['requirements',project,'metrics',{}],
      ['requirements',project,'pages','all',{}],
      ['requirement-detail',project,'story',true],
      ['sprint-requirement-children',project,'sprint',0,'first',{}],
      [evidenceKey,'reader',project],
      ['test-case-metrics',project==='project'?'app':'foreign-app',project,true]
    ];
    for (const key of [...keys('project'),...keys('foreign')]) client.setQueryData(key,{value:42});
    for (const options of invalidationsFor(file,callback)) await client.invalidateQueries(options);
    for (const key of keys('project')) assert.equal(client.getQueryState(key).isInvalidated,true,JSON.stringify(key));
    for (const key of keys('foreign')) assert.equal(client.getQueryState(key).isInvalidated,false,'Preserve '+JSON.stringify(key));
    client.clear();
  });
}

test('Release edits expire all changed Story scopes and readiness only within the affected project',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{staleTime:60000}}});
  const keys=project=>[
    ['requirement-releases',project],
    ['requirement-release-readiness','project',project,'reader'],
    ['requirements',project,'metrics',{}],
    ['requirement-detail',project,'story',true],
    ['requirement-route-detail',project,'story'],
    ['requirement-iterations',project],
    ['sprint-requirement-children',project,'sprint',0,'first',{}],
    ['release-story-picker',project],
    ['release-review-context','reader',project],
    ['release-review-stories','reader',project]
  ];
  for(const key of [...keys('project'),...keys('foreign')]) client.setQueryData(key,{value:42});
  for(const options of invalidationsFor('ReleasesPage.tsx','refresh')) await client.invalidateQueries(options);
  for(const key of keys('project')) assert.equal(client.getQueryState(key).isInvalidated,true,JSON.stringify(key));
  for(const key of keys('foreign')) assert.equal(client.getQueryState(key).isInvalidated,false,JSON.stringify(key));
  client.clear();
});
