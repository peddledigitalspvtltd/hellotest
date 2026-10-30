const { parameterReference, referenceKey } = require('./automationBrowserParameters');
const { validateAutomationParameterBindings } = require('./automationParameterBindings');
const { browserReceipt } = require('./automationInteractiveEvidence');
const { isNativeTextEntryControl } = require('./automationBrowserAssertionSubject');
const { recordedSectionRequests } = require('./automationBrowserRecording');
const { isNavigationPrerequisite } = require('./automationActionReconciliation');
const {canonicalNavigationUrl,navigationParameterNames}=require('./automationNavigationParameters');
const {parameterTemplateParts}=require('./automationParameterTemplates');

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => Object.assign(new Error('The current input could not be bound to its original manual parameters.'), {
  code: 'AUTOMATION_INPUT_PARAMETER_BINDING_INVALID', statusCode: 422, nonRetryable: true
});

/** Bind inputs from original active-obligation provenance, never a global
 * reverse-value lookup. Values remain host-private and are frozen per build. */
function createAutomationInputParameterBinding({ stepId, obligations, bindings, parameterValues, privateParameterNames = [] } = {}) {
  if (typeof stepId !== 'string' || !stepId || !Array.isArray(obligations) || !obligations.some(row => row?.id === stepId && row.source === 'section')
    || new Set(obligations.map(row => row?.id)).size !== obligations.length || !record(parameterValues)
    || !Array.isArray(privateParameterNames) || privateParameterNames.some(name => typeof name !== 'string')) throw invalid();
  let selected;
  try { selected = validateAutomationParameterBindings({ bindings, obligations, values: parameterValues }); }
  catch { throw invalid(); }
  const privateNames = new Set(privateParameterNames), publicValues = new Map();
  const actionNames = new Set(selected.flatMap(row => row.action_parameters));
  const expectedNames = new Set(selected.flatMap(row => row.action_parameters.filter(name => row.expected_result_parameters.includes(name))));
  for (const name of actionNames) if (!privateNames.has(name) && typeof parameterValues[name] === 'string') publicValues.set(name, parameterValues[name]);
  const navigationNames=navigationParameterNames(obligations,rows=>rows.flatMap(row=>{
    const key=referenceKey(row.action);
    return key&&actionNames.has(key)?[key]:key&&/^@(?![tsr]\.)/i.test(row.action)&&actionNames.has(`t.${key.slice(2)}`)?[`t.${key.slice(2)}`]:[];
  }));
  const bind = (request, name) => ({ ...request, arguments: { ...request.arguments, value: parameterReference(name) } });
  const expectedSources=selected.flatMap(binding=>{
    const row=obligations.find(row=>row.id===binding.obligation_id);
    if(!row||!binding.expected_result_parameters.length)return [];
    // Preserve only original authored reference spans, not apparent @tokens
    // inside a frozen value or a second source field.
    const source=String(row.expected_result).replace(/<[^>]*>/g,' '),parts=[],pattern=/(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
    let offset=0;
    for(const match of source.matchAll(pattern)){
      if(/^@[tsr]$/i.test(match[0])&&source[match.index+match[0].length]==='.')continue;
      const initial=referenceKey(match[0]),name=binding.expected_result_parameters.includes(initial)?initial:initial&&binding.expected_result_parameters.includes(`t.${initial.slice(2)}`)&&!/^@[tsr]\./i.test(match[0])?`t.${initial.slice(2)}`:null;
      if(!name||privateNames.has(name)||typeof parameterValues[name]!=='string')continue;
      if(match.index>offset)parts.push({literal:source.slice(offset,match.index)});
      parts.push({key:name,value:parameterValues[name]});offset=match.index+match[0].length;
    }
    if(!parts.length)return [];
    if(offset<source.length)parts.push({literal:source.slice(offset)});
    let projected='',spans=[];
    for(const part of parts){const start=projected.length;projected+=part.key?part.value:part.literal;if(part.key)spans.push({start,end:projected.length,key:part.key});}
    return [{projected,spans}];
  });

  function expectedTemplate(value){
    if(!value)return null;
    const candidates=new Set();let occurrences=0;
    for(const {projected,spans}of expectedSources){
      let start=projected.indexOf(value);
      while(start!==-1){
        occurrences++;const end=start+value.length,inside=spans.filter(span=>span.start>=start&&span.end<=end);
        if(inside.length&&!spans.some(span=>span.start<end&&span.end>start&&!inside.includes(span))){
          let template='',offset=start;
          for(const span of inside){template+=projected.slice(offset,span.start)+parameterReference(span.key);offset=span.end;}
          template+=projected.slice(offset,end);
          const parts=parameterTemplateParts(template);
          if(parts?.some(part=>part.literal?.trim()))candidates.add(template);
        }
        start=projected.indexOf(value,start+1);
      }
    }
    // Equal configured values and independently literal occurrences cannot
    // choose a variable oracle. A single original expected span grants it.
    return occurrences===1&&candidates.size===1?[...candidates][0]:null;
  }

  function canonicalize(request, { snapshot, observations = [] } = {}) {
    const args = request?.arguments;
    if(request?.name==='browser_navigate'&&record(args)&&!referenceKey(args.url)){
      const url=canonicalNavigationUrl(args.url),names=url?navigationNames.filter(name=>publicValues.has(name)&&canonicalNavigationUrl(publicValues.get(name))===url):[];
      return names.length===1?{...request,arguments:{...args,url:parameterReference(names[0])}}:request;
    }
    if(request?.name==='browser_assert'&&record(args)&&typeof args.value==='string'&&args.value.length<=2000
      &&['text','text_contains','text_content','text_content_contains','title','title_normalized'].includes(args.assertion)){
      const template=expectedTemplate(args.value);
      if(template){
        const page=snapshot?.tool==='browser_snapshot'&&!snapshot.result?.isError?browserReceipt(snapshot):null,targets=Array.isArray(page?.elements)?page.elements.filter(element=>element?.locators_validated===true&&element.locator_candidates?.includes(args.locator)):[];
        if(snapshot?.tool==='browser_snapshot'&&!snapshot.result?.isError&&(['title','title_normalized'].includes(args.assertion)||targets.length===1))return {...request,arguments:{...args,value:template}};
      }
      return request;
    }
    if (!record(args) || typeof args.value !== 'string' || args.value.length > 2000 || referenceKey(args.value)
      || typeof args.locator !== 'string' || (!['browser_fill', 'browser_select_option'].includes(request.name) && !(request.name === 'browser_assert' && args.assertion === 'value'))
      || snapshot?.tool !== 'browser_snapshot' || snapshot.result?.isError) return request;
    const page = browserReceipt(snapshot);
    const matches = Array.isArray(page?.elements) ? page.elements.filter(element => element?.locators_validated === true
      && Array.isArray(element.locator_candidates) && element.locator_candidates.includes(args.locator)) : [];
    if (matches.length !== 1) return request;
    const select = String(matches[0].tag || '').toLowerCase() === 'select';
    const inputTool = select ? 'browser_select_option' : 'browser_fill';
    if ((!select && !isNativeTextEntryControl(matches[0])) || (request.name !== 'browser_assert' && request.name !== inputTool)) return request;

    if (request.name === inputTool) {
      const names = [...publicValues].filter(([, value]) => value === args.value).map(([name]) => name);
      return names.length === 1 ? bind(request, names[0]) : request;
    }

    // A content oracle can vary only with an explicitly authored expected-result
    // binding and that same field's latest actual fill/selection. Generic
    // outcome prose, proposed inputs, copied receipts and another field supply
    // no such grant. An old textbox fill cannot bind a newly rendered select.
    if (!Array.isArray(observations)) return request;
    const transition = observations.findLastIndex(isNavigationPrerequisite);
    const recorded = recordedSectionRequests(observations.slice(transition + 1), stepId);
    const navigation = recorded.findLastIndex(operation => operation.name === 'browser_navigate');
    const aliases = new Set(matches[0].locator_candidates);
    const input = recorded.slice(navigation + 1).findLast(operation => operation.name === inputTool && aliases.has(operation.arguments.locator));
    const name = input ? referenceKey(input.arguments.value) : null;
    return name && expectedNames.has(name) && publicValues.has(name) && publicValues.get(name) === args.value ? bind(request, name) : request;
  }
  return Object.freeze({ canonicalize });
}

module.exports = { createAutomationInputParameterBinding };
