import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as permissions from '../src/platform/lib/permissions.ts';
import {readSidebarMode} from '../src/platform/lib/workspacePreferences.ts';
const navigation = {};
new Function('require', 'exports', ts.transpileModule(
 readFileSync(new URL('../src/platform/lib/navigation.ts', import.meta.url), 'utf8'),
 {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}
).outputText)(() => permissions, navigation);
const {isNavigationDestinationActive} = navigation;
test('active destinations retain their identity when filters and selections change',()=>{
 assert.equal(isNavigationDestinationActive('/?view=analytics','/','?days=90&view=analytics'),true);
 assert.equal(isNavigationDestinationActive('/?view=readiness','/','?view=analytics&days=90'),false);
 assert.equal(isNavigationDestinationActive('/?view=readiness','/','?release=Autumn&view=readiness'),true);
 assert.equal(isNavigationDestinationActive('/executions?view=suite-runs','/executions','?execution=case-run'),true);
 assert.equal(isNavigationDestinationActive('/executions?view=local-runs','/executions','?execution=case-run'),false);
 assert.equal(isNavigationDestinationActive('/agentic-workflows?view=quality','/agentic-workflows',''),true);
 assert.equal(isNavigationDestinationActive('/agentic-workflows?view=workflows','/agentic-workflows',''),false);
 assert.equal(isNavigationDestinationActive('/agentic-workflows?view=quality','/agentic-workflows','?surface=quality&run=one'),true);
 assert.equal(isNavigationDestinationActive('/test-cases','/test-cases','?case=case-1'),true);
 assert.equal(isNavigationDestinationActive('/test-cases','/design',''),false);
});
test('new browsers show navigation labels while explicit preferences remain respected',()=>{
 const old=globalThis.window;
 try{for(const [value,expected] of [[null,'expanded'],['false','expanded'],['true','collapsed']]){
 globalThis.window={localStorage:{getItem:()=>value}};assert.equal(readSidebarMode(),expected);
 }}finally{if(old===undefined)delete globalThis.window;else globalThis.window=old;}
});
