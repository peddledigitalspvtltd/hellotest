import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../../../../../testengine/backend/package.json',import.meta.url));
export async function assertAccessibleControls(page,context) {
  if (!await page.evaluate(()=>Boolean(window.axe))) await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  const result=await page.evaluate(context=>window.axe.run(context,{runOnly:{type:'rule',values:['button-name','link-name','select-name','label','aria-command-name','aria-dialog-name','aria-input-field-name','aria-toggle-field-name','aria-valid-attr-value','aria-required-attr','aria-allowed-attr','label-content-name-mismatch','aria-required-children','aria-required-parent']}}),context || "body");
  assert.deepEqual(result.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})),[]);
}
