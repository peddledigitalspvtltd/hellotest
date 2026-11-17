import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { initializationImports } = createRequire(import.meta.url)('../lib/initialization-imports.cjs');

test('initialization analysis distinguishes deferred adapters and comments from actual eager loaders', () => {
  const source = `// require('./comment')
    const text = "require('./text')";
    const load = require;load('./direct-alias');
    function adapter(){ require('./deferred'); }
    const callback=()=>require('./callback');setTimeout(callback,1);
    function eager(loader){loader('./local-function');}eager(require);
    function shadow(require){require('./shadowed');}shadow(()=>{});
    (()=>require('./iife'))();
    exports.recover=()=>require('./recovery');`;
  assert.deepEqual(initializationImports(source).sort(), ['./direct-alias','./iife','./local-function']);
});

test('static class initialization and constructed instance initialization are eager while unused instance methods are deferred', () => {
  assert.deepEqual(initializationImports(`class Unused { static value=require('./static');static {require('./static-block');} value=require('./unused-field');method(){require('./method');} }
    class Used {value=require('./instance');constructor(){require('./constructor');}}new Used();`).sort(),
    ['./constructor','./instance','./static','./static-block']);
});

test('ES module imports and reexports participate in initialization without executing source', () => {
  assert.deepEqual(initializationImports(`import value from './imported.js';export {value} from './reexport.js';export function deferred(){return require('./later');}`), ['./imported.js','./reexport.js']);
});
