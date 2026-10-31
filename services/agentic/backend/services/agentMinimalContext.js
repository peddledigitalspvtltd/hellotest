const { compactEvidenceText } = require('@hellotest/platform/backend/src/utils/llmContextFallback');
function minimalContext(payload) {
  const exactScopes=new Set(['automation_repair','case_intent','workflow_input','task_input']);
  const entries = Object.entries(payload.bounded_workspace_context || {}).flatMap(([scope,items]) => (items || []).map(item => ({scope,item})));
  const selected = entries.sort((a,b) => Number(b.scope === 'automation_repair') - Number(a.scope === 'automation_repair')
    || Number(b.scope === 'case_intent') - Number(a.scope === 'case_intent')
    || Number(exactScopes.has(b.scope)) - Number(exactScopes.has(a.scope))
    || Number(b.item.source_kind === 'live_project') - Number(a.item.source_kind === 'live_project'));
  const context = {}, ids = new Set();
  const retainedLimit=Math.max(3,entries.filter(entry=>exactScopes.has(entry.scope)).length);
  for(const {scope,item} of selected) {
    if(!exactScopes.has(scope)&&ids.size>=retainedLimit)continue;
    const id = item.citation?.id || item.id; if(id) ids.add(id);
    (context[scope] ||= []).push(exactScopes.has(scope) ? {...item}
      : {...item,content:compactEvidenceText(item.content,1200),excerpt_truncated:true});
  }
  const output = {...payload,bounded_workspace_context:context,citation_contract:(payload.citation_contract || []).filter(citation=>ids.has(citation.id)),
    context_reduction:{reason:'Provider rejected the context size.',limitations:['Only the included excerpts support claims; omitted fields and sources are unknown.'],retained_evidence_count:ids.size}};
  for(const key of ['story_targets','story_link_targets','test_case_targets']) if(Array.isArray(output[key])) output[key]=output[key].filter(target=>ids.has(target.citation_id));
  if(output.previous_specialist_review) output.previous_specialist_review={...output.previous_specialist_review,findings:(output.previous_specialist_review.findings || []).map(item=>({...item,detail:String(item.detail||'').slice(0,500)}))};
  if(output.completed_proposals)output.completed_proposals=output.completed_proposals.map(item=>({kind:item.kind,title:item.title,citation_ids:item.citation_ids,proposed_only:true}));
  return {payload:output,ids};
}
module.exports={minimalContext};
