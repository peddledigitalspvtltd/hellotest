const { compactEvidenceText } = require('@hellotest/platform/backend/src/utils/llmContextFallback');
function minimalContext(payload) {
  const entries = Object.entries(payload.bounded_workspace_context || {}).flatMap(([scope,items]) => (items || []).map(item => ({scope,item})));
  const selected = entries.sort((a,b) => Number(b.scope === 'automation_repair') - Number(a.scope === 'automation_repair')
    || Number(b.item.source_kind === 'live_project') - Number(a.item.source_kind === 'live_project')).slice(0,3);
  const context = {}, ids = new Set();
  for(const {scope,item} of selected) {
    const id = item.citation?.id || item.id; if(id) ids.add(id);
    (context[scope] ||= []).push(scope === 'automation_repair' ? {...item}
      : {...item,content:compactEvidenceText(item.content,1200),excerpt_truncated:true});
  }
  const output = {...payload,bounded_workspace_context:context,citation_contract:(payload.citation_contract || []).filter(citation=>ids.has(citation.id)),
    context_reduction:{reason:'Provider rejected the context size.',limitations:['Only the included excerpts support claims; omitted fields and sources are unknown.'],retained_evidence_count:ids.size}};
  for(const key of ['story_targets','test_case_targets']) if(Array.isArray(output[key])) output[key]=output[key].filter(target=>ids.has(target.citation_id));
  if(output.previous_specialist_review) output.previous_specialist_review={...output.previous_specialist_review,findings:(output.previous_specialist_review.findings || []).map(item=>({...item,detail:String(item.detail||'').slice(0,500)}))};
  if(output.completed_proposals)output.completed_proposals=output.completed_proposals.map(item=>({kind:item.kind,title:item.title,citation_ids:item.citation_ids,proposed_only:true}));
  return {payload:output,ids};
}
module.exports={minimalContext};
