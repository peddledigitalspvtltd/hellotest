const test=require('node:test'),assert=require('node:assert/strict');
const {fixtureTestIdCheck}=require('../debug/agent-source-semantics.cjs');
const files={'ProductCard.tsx':'<h2>Field notebook</h2><p data-testid="product-price">$42</p><a data-testid="product-details" href="/product">Details</a>'};
test('the actual source title supplies no invented test ID even when requested prose contains one',()=>{
 const result=fixtureTestIdCheck(files,[{response:'Locate the title using `getByTestId("product-title")` and assert Field notebook.'}]);
 assert.equal(result.valid,false);assert.deepEqual(result.unknown_test_ids,['product-title']);
 assert.match(result.message,/Undeclared model test IDs: product-title/);
 assert.deepEqual(result.declared_test_ids,['product-details','product-price']);
});
test('nested native artifact and CSS selectors are checked against declarations without executing them',()=>{
 const valid=fixtureTestIdCheck(files,[{artifacts:[{steps:[{action:"page.getByTestId('product-price')",expected_result:'Visible $42'}]}],response:'Check `[data-testid="product-details"]`.'}]);
 assert.equal(valid.valid,true);
 const invalid=fixtureTestIdCheck(files,[{artifacts:[{steps:[{action:'page.locator(`[data-testid="product-title"]`)',expected_result:'Visible heading'}]}]}]);
 assert.equal(invalid.valid,false);assert.deepEqual(invalid.unknown_test_ids,['product-title']);
});
