const test=require('node:test');
const assert=require('node:assert/strict');
const {safeAssertionDiagnostics}=require('../../backend/lib/automationProgressDiagnostics');
const {browserReadDiagnostic}=require('../../backend/services/automationAgentActivity.service');

const facts={same_origin:true,document_state:'loading',authentication_form_visible:false,document_busy:false,visible_alert_count:0};
const diagnostic=(overrides={})=>browserReadDiagnostic({testCaseId:'case-assertion',observation:{tool:'browser_assert',
  arguments:{assertion:'url_contains',value:'PRIVATE_EXPECTED',locator:'PRIVATE_SELECTOR'},
  result:{isError:true,content:[{type:'text',text:JSON.stringify({source:'playwright',code:'BROWSER_ASSERTION_NOT_SATISFIED',
    action_outcome:'not_attempted',assertion_outcome:'not_satisfied',url:'https://private.test/?token=PRIVATE_TOKEN',
    message:'PRIVATE_MESSAGE',assertion_diagnostics:{...facts,url:'PRIVATE_URL',value:'PRIVATE_VALUE'},...overrides})}]}}});

test('native assertion failure facts survive durable projection without becoming page evidence or disclosing data',()=>{
  const result=diagnostic();
  assert.deepEqual(result.assertion_diagnostics,facts);
  assert.equal(result.error_code,'BROWSER_ASSERTION_NOT_SATISFIED');
  assert.equal(result.current_page_evidence,false);
  assert.equal(result.expected_result_verified,false);
  assert.equal(result.verification_status,'unverified');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|private\.test/);
  assert.equal(diagnostic({source:'model'}),null);
});

test('failure fact projection accepts only bounded typed classifications and leaves input untouched',()=>{
  const input={same_origin:'true',document_state:'PRIVATE_STATE',authentication_form_visible:1,document_busy:null,
    visible_alert_count:1001,url:'PRIVATE_URL'};
  assert.equal(safeAssertionDiagnostics(input),undefined);
  assert.equal(safeAssertionDiagnostics([]),undefined);
  assert.equal(safeAssertionDiagnostics(null),undefined);
  for(const count of [-1,1.5,Number.MAX_SAFE_INTEGER])assert.equal(safeAssertionDiagnostics({visible_alert_count:count}),undefined);
  const original=JSON.stringify(facts);
  assert.deepEqual(safeAssertionDiagnostics(facts),facts);
  assert.equal(JSON.stringify(facts),original);
  const projected=diagnostic({assertion_diagnostics:input});
  assert.equal(projected.assertion_diagnostics,undefined);
  assert.doesNotMatch(JSON.stringify(projected),/PRIVATE/);
});
