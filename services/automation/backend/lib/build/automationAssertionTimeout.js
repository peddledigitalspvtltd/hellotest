const DEFAULT_ASSERTION_TIMEOUT_MS=10_000;
const fixedNativePredicates=new Set(['valid','invalid','field_valid','input_type']);

// Match TestEngine Run's existing integer parsing and bounds. An absent value
// stays absent on the wire so older/default clients retain their 10s policy.
function configuredAssertionTimeoutMs(value){
 if(value===undefined||value===null||typeof value==='string'&&!value.trim())return undefined;
 const parsed=typeof value==='number'&&Number.isFinite(value)?Math.trunc(value)
  :typeof value==='string'?Number.parseInt(value.trim(),10):NaN;
 return Math.max(250,Math.min(120_000,Number.isFinite(parsed)?parsed:DEFAULT_ASSERTION_TIMEOUT_MS));
}

function configuredNavigationTimeoutMs(value){
 if(value===undefined||value===null||typeof value==='string'&&!value.trim())return undefined;
 const parsed=typeof value==='number'&&Number.isFinite(value)?Math.trunc(value)
  :typeof value==='string'?Number.parseInt(value.trim(),10):NaN;
 return Math.max(1_000,Math.min(600_000,Number.isFinite(parsed)?parsed:30_000));
}

function browserTransportTimeoutMs(method,params,assertionTimeoutMs,navigationTimeoutMs){
 if(method==='tools/call'&&params?.name==='browser_navigate'&&navigationTimeoutMs!==undefined)return Math.max(30_000,navigationTimeoutMs+10_000);
 return method==='tools/call'&&params?.name==='browser_assert'&&!fixedNativePredicates.has(params.arguments?.assertion)&&assertionTimeoutMs!==undefined
  ?Math.max(30_000,assertionTimeoutMs+10_000):30_000;
}

function verificationRequestWithAssertionTimeout(request,integration){
 const {assertion_timeout_ms:ignored,navigation_timeout_ms:ignoredNavigation,...input}=request;
 const timeout=configuredAssertionTimeoutMs(integration?.config?.assertion_timeout_ms);
 const navigation=configuredNavigationTimeoutMs(integration?.config?.navigation_timeout_ms);
 return {...input,...(timeout!==undefined?{assertion_timeout_ms:timeout}:{}),...(navigation!==undefined?{navigation_timeout_ms:navigation}:{})};
}

module.exports={configuredAssertionTimeoutMs,configuredNavigationTimeoutMs,browserTransportTimeoutMs,verificationRequestWithAssertionTimeout};
