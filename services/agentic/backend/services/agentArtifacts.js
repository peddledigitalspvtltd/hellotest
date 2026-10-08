const {aiInstructionBlock}=require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const CONTRACT = aiInstructionBlock("ai.agentic.workflow", "agentArtifacts.nativeProposalContract");
const fail=()=>Object.assign(new Error('The model returned an invalid structured artifact.'),{code:'AI_INVALID_RESPONSE'});
const text=(v,max=8000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw fail();return v.trim();};
const strings=(v,max=30)=>{if(!Array.isArray(v)||!v.length||v.length>max)throw fail();return v.map(s=>text(s,4000));};
function normalizeArtifacts(value,citations,targets = []) {
 if(value==null)return [];
 if(!Array.isArray(value)||value.length>8)throw fail();
 const allowed=new Set(citations.map(c=>c.id));
 return value.map(a=>{
  if(!a||!['story','test_case','defect'].includes(a.kind))throw fail();
  const ids=strings(a.citation_ids,36);if(ids.some(id=>!allowed.has(id)))throw fail();
  const artifact={kind:a.kind,title:text(a.title,255),description:text(a.description,12000),citation_ids:[...new Set(ids)],priority:['P1','P2','P3','P4'].includes(a.priority)?a.priority:'P3'};
  if(a.kind==='story') {
   artifact.acceptance_criteria=strings(a.acceptance_criteria);
   if(a.target_id != null) {
    const target = targets.find(t => t.id === a.target_id && ids.includes(t.citation_id));
    if(!target) throw fail();
    artifact.target_id = target.id; artifact.target_revision = target.revision;
   }
  }
  if(a.kind==='test_case'){artifact.prerequisites=Array.isArray(a.prerequisites)&&a.prerequisites.length<=20?a.prerequisites.map(s=>text(s,2000)):[];if(!Array.isArray(a.steps)||!a.steps.length||a.steps.length>40)throw fail();artifact.steps=a.steps.map(s=>({action:text(s.action,4000),expected_result:text(s.expected_result,4000)}));}
  if(a.kind==='defect'){artifact.reproduction_steps=strings(a.reproduction_steps);artifact.expected_result=text(a.expected_result,4000);artifact.actual_result=text(a.actual_result,4000);artifact.severity=['critical','high','medium','low'].includes(a.severity)?a.severity:'medium';}
  return artifact;
 });
}
// Route only evidence-backed work from the review, never arbitrary agent IDs supplied by a model.
const AUTHOR_KINDS = { 'story-completion': 'story', 'story-architect': 'story', 'test-designer': 'test_case', 'bug-reporter': 'defect' };
function planFollowups(agentId, scopes, result) {
 if (agentId === 'repository-curator' || agentId.startsWith('browser-')) return [];
 const scope = new Set(scopes);
 const supported = new Set(result.citation_ids || []);
 const findings = (result.findings || []).filter(f => (f.citation_ids || []).some(id => supported.has(id)) && !/^(?:no (?:gaps?|changes?|issues?|defects?|bugs?|failures?|missing)|complete(?:d)? (?:coverage|story)|all .* (?:covered|satisfied)|.*needs no (?:changes?|follow.up))/i.test(`${f.title || ''} ${f.detail || ''}`));
 if (!findings.length) return [];
 const text = [...findings.map(f => `${f.title} ${f.detail}`), ...(result.recommendations || [])].join(' ');
 const actionable = /missing|gap|omit|ambig|incomplete|improv|clarif|add|fix|fail|defect|bug|inadequate|untested|insufficient|recommend|need/i.test(text);
 if (!actionable) return [];
 const planned = [];
 const add = (id, reason) => {
  const kind = AUTHOR_KINDS[id];
  if (!kind || planned.some(p => p.kind === kind) || result.artifacts?.some(a => a.kind === kind)) return;
  planned.push({ agent_id: id, kind, reason, citation_ids: [...new Set(findings.flatMap(f => f.citation_ids || []))] });
 };
 const storyGap = /story|stories|acceptance|requirement|ambigu/i.test(text);
 const testGap = /test|coverage|scenario|assertion|untested/i.test(text);
 const defectGap = /defect|bug|failure|failed|reproduc/i.test(text);
 if (scope.has('stories') && (storyGap || ['story-assurance', 'story-grooming'].includes(agentId)))
  add('story-completion', 'Complete the Story using the acceptance gaps and findings from this review.');
 if (scope.has('test-cases') && testGap)
  add('test-designer', 'Prepare complete Test Cases for the uncovered behaviors and assertions.');
 if (scope.has('bugs') && defectGap)
  add('bug-reporter', 'Prepare a Defect proposal using the observed failure evidence and reproduction details.');
 return planned.slice(0, 3);
}
function remainingRecommendations(original, authored, completedKinds) {
 const kinds=new Set(completedKinds);
 return [...new Set([...original.filter(item => !(
  kinds.has('story') && /(?:complete|clarif|improv|add|fix).*(?:story|stories|acceptance|requirement)/i.test(item)
  || kinds.has('test_case') && /(?:design|create|add|generat|prepare).*(?:test|coverage|scenario|assertion)/i.test(item)
  || kinds.has('defect') && /(?:create|record|prepare|report|file).*(?:defect|bug|failure)/i.test(item)
 )), ...authored])].slice(0,8);
}
function followup(agentId, scopes, result) { return planFollowups(agentId, scopes, result)[0]?.agent_id || null; }
function storyTargets(boundedContext) {
 const targets=[];
 for (const item of Object.values(boundedContext || {}).flat()) {
  if(item.source_kind !== 'live_project' || !item.citation?.id) continue;
  try {
   const snapshot=JSON.parse(item.content);
   if(snapshot.evidence_type !== 'authoritative_live_story_snapshot') continue;
   for(const record of snapshot.records || []) {
    if(typeof record.id==='string' && Number.isInteger(record.revision) && record.revision>0) targets.push({id:record.id,title:record.title,revision:record.revision,citation_id:item.citation.id});
   }
  } catch { /* Shortened or unverified passages cannot identify mutation targets. */ }
 }
 return targets.slice(0,16);
}
module.exports = { CONTRACT, normalizeArtifacts, followup, planFollowups, storyTargets, remainingRecommendations };
