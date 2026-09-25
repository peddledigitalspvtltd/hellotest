import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compile = source => ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const loadLinks = (runtime={},environment={}) => {
  const exports={};
  const source=readFileSync(new URL('../src/platform/lib/adminFeatureLinks.ts',import.meta.url),'utf8').replaceAll('import.meta.env','environment');
  new Function('exports','window','environment',compile(source))(exports,{location:{origin:'https://workspace.example.test'},__HELLOTEST_CONFIG__:runtime},environment);
  return exports.getAdminFeatureUrl;
};

test('feature deep links use configured administration paths and encode the feature key',()=>{
  const link=loadLinks({ADMIN_BASE_URL:'https://admin.example.test/control/?old=value#section'});
  const url=new URL(link('hellotest.manual.run_gherkin'));
  assert.equal(url.origin,'https://admin.example.test');
  assert.equal(url.pathname,'/control/');
  assert.equal(url.searchParams.get('section'),'features');
  assert.equal(url.searchParams.get('feature'),'hellotest.manual.run_gherkin');
  assert.equal(url.searchParams.has('old'),false);
  assert.equal(url.hash,'');
  const encoded=new URL(link('test&section=security'));
  assert.equal(encoded.searchParams.get('section'),'features');
  assert.equal(encoded.searchParams.get('feature'),'test&section=security');
});

test('runtime configuration overrides build configuration and invalid targets use known admin locations',()=>{
  assert.equal(new URL(loadLinks({}, {VITE_ADMIN_BASE_URL:'https://build.example.test'} )('feature')).host,'build.example.test');
  assert.equal(new URL(loadLinks({ADMIN_BASE_URL:'https://runtime.example.test'}, {VITE_ADMIN_BASE_URL:'https://build.example.test'})('feature')).host,'runtime.example.test');
  const link=loadLinks();
  for (const configuredBaseUrl of ['javascript:alert(1)','https://user:secret@example.test','http://[invalid']) {
    assert.equal(new URL(link('feature',{origin:'http://localhost:5173',configuredBaseUrl})).origin,'http://localhost:5174');
  }
  assert.equal(new URL(link('feature',{origin:'http://localhost:8080'})).origin,'http://localhost:8081');
  assert.equal(new URL(link('feature',{origin:'https://workspace.example.test'})).pathname,'/admin/');
});

test('the admin dev server preserves section and feature queries when serving its entry point',()=>{
  const exports={};
  new Function('exports','require','process',compile(readFileSync(new URL('../vite.admin.config.ts',import.meta.url),'utf8')))(exports,name=>name==='vite'?{defineConfig:value=>value}:name==='./vite.feature-sources'?{featureSourceConfig:{resolve:{},fs:{}}}:{default:()=>({})},{env:{}});
  let middleware;
  exports.default.plugins.find(plugin=>plugin.name==='hellotest-admin-root').configureServer({middlewares:{use:callback=>{middleware=callback}}});
  for (const pathname of ['/','/admin/']) {
    const request={url:pathname+'?section=features&feature=hellotest.manual.run_gherkin'};
    let next=false;
    middleware(request,{},()=>{next=true});
    assert.equal(request.url,'/admin.html?section=features&feature=hellotest.manual.run_gherkin');
    assert.equal(next,true);
  }
});
