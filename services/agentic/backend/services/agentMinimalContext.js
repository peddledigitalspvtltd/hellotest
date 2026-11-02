const { compactEvidenceText } = require('@hellotest/platform/backend/src/utils/llmContextFallback');
const { EXACT_INPUT_SCOPES: exactScopes } = require('./agentTaskBrief');
function minimalContext(payload) {
  const entries = Object.entries(payload.bounded_workspace_context || {}).flatMap(([scope,items]) => (items || []).map(item => ({scope,item})));
  const selected = entries.sort((a,b) => Number(b.scope === 'automation_repair') - Number(a.scope === 'automation_repair')
    || Number(b.scope === 'case_intent') - Number(a.scope === 'case_intent')
    || Number(exactScopes.has(b.scope)) - Number(exactScopes.has(a.scope))
    || Number(b.item.source_kind === 'live_project') - Number(a.item.source_kind === 'live_project'));
  const context = {}, ids = new Set();
  // Complete task inputs must not consume every available slot for current
  // product evidence when several supplied brief sections are present.
  const retainedLimit=Math.max(3,entries.filter(entry=>exactScopes.has(entry.scope)).length+1);
  for(const {scope,item} of selected) {
    if(!exactScopes.has(scope)&&ids.size>=retainedLimit)continue;
    const id = item.citation?.id || item.id; if(id) ids.add(id);
    (context[scope] ||= []).push(exactScopes.has(scope) ? {...item}
      : {...item,content:compactEvidenceText(item.content,1200),excerpt_truncated:true});
  }
  const output = {...payload,bounded_workspace_context:context,citation_contract:(payload.citation_contract || []).filter(citation=>ids.has(citation.id)),
    context_reduction:{reason:'Provider rejected the context size.',limitations:['Only the included excerpts support claims; omitted fields and sources are unknown.'],retained_evidence_count:ids.size}};
  for(const key of ['story_targets','story_link_targets','test_case_targets']) if(Array.isArray(output[key])) output[key]=output[key].filter(target=>ids.has(target.citation_id));
  // Assigned findings and drafts being refined are part of the handoff task.
  // Retain their full content and untrusted provenance when shrinking evidence.
  return {payload:output,ids};
}
module.exports={minimalContext};
