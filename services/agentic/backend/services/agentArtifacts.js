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
  if(!a||!['story','test_case','defect','run'].includes(a.kind))throw fail();
  const ids=strings(a.citation_ids,36);if(ids.some(id=>!allowed.has(id)))throw fail();
  const artifact={kind:a.kind,title:text(a.title,255),description:text(a.description,12000),citation_ids:[...new Set(ids)],priority:['P1','P2','P3','P4','P5'].includes(a.priority)?a.priority:'P3'};
  if(a.kind==='story') {
   artifact.acceptance_criteria=strings(a.acceptance_criteria);
   if(a.target_id != null) {
    const target = targets.find(t => t.id === a.target_id && t.kind !== 'test_case' && ids.includes(t.citation_id));
    if(!target) throw fail();
    artifact.target_id = target.id; artifact.target_revision = target.revision;
   }
  }
  if(a.kind==='test_case'){
   artifact.requirement_ids = a.requirement_ids == null || (Array.isArray(a.requirement_ids) && !a.requirement_ids.length) ? [] : strings(a.requirement_ids,16);
   if (artifact.requirement_ids.some(id => !targets.some(target => target.id === id && target.kind !== 'test_case' && ids.includes(target.citation_id)))) throw fail();
   artifact.test_data = Array.isArray(a.test_data) && a.test_data.length <= 20 ? a.test_data.map(s => text(s,2000)) : [];
   artifact.cleanup = Array.isArray(a.cleanup) && a.cleanup.length <= 20 ? a.cleanup.map(s => text(s,2000)) : [];
   artifact.prerequisites=Array.isArray(a.prerequisites)&&a.prerequisites.length<=20?a.prerequisites.map(s=>text(s,2000)):[];
   artifact.authoring_mode = a.authoring_mode || 'structured';
   if(!['structured','gherkin'].includes(artifact.authoring_mode))throw fail();
   if(artifact.authoring_mode === 'gherkin') {
    artifact.gherkin_document = text(a.gherkin_document,16000);
    let delimiter = ''; const structural = artifact.gherkin_document.split(/\r?\n/).filter(line => {const marker=line.trim().match(/^("""|```)/)?.[1];if(marker){delimiter=delimiter?delimiter===marker?'':delimiter:marker;return false;}return !delimiter;}).join('\n');
    if(delimiter || !/^[ \t]*Feature[ \t]*:[ \t]*\S/im.test(structural) || !/^[ \t]*Scenario(?: Outline| Template)?[ \t]*:[ \t]*\S/im.test(structural) || !/^[ \t]*(?:Given|When)[ \t]+\S/im.test(structural) || !/^[ \t]*Then[ \t]+\S/im.test(structural) || (structural.match(/^\s*(?:Given|When|Then|And|But|\*)[ \t]+\S/gim)||[]).length > 30)throw fail();
    artifact.steps = [];
   } else { if(!Array.isArray(a.steps)||!a.steps.length||a.steps.length>30)throw fail();artifact.steps=a.steps.map(s=>{if(s.step_type != null && !['web','api','android','ios'].includes(s.step_type))throw fail();return {action:text(s.action,4000),expected_result:text(s.expected_result,4000),...(s.step_type?{step_type:s.step_type}:{})};}); }}
  if(a.kind==='run') { artifact.test_case_ids = strings(a.test_case_ids,50); if(artifact.test_case_ids.some(id => !targets.some(target => target.kind === 'test_case' && target.id === id && ids.includes(target.citation_id)))) throw fail(); artifact.exit_criteria = strings(a.exit_criteria,20); }
  if(a.kind==='defect'){artifact.reproduction_steps=strings(a.reproduction_steps);artifact.expected_result=text(a.expected_result,4000);artifact.actual_result=text(a.actual_result,4000);artifact.severity=['critical','high','medium','low'].includes(a.severity)?a.severity:'medium';}
  return artifact;
 });
}
// Route only evidence-backed work from the review, never arbitrary agent IDs supplied by a model.
const AUTHOR_KINDS = { 'story-completion': 'story', 'story-architect': 'story', 'test-designer': 'test_case', 'bug-reporter': 'defect', 'run-planner': 'run' };
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
 if (scope.has('runs') && scope.has('test-cases') && /(?:select|plan|prepare|create|prioriti[sz]e).{0,60}(?:run|regression|execution)|run (?:selection|plan)/i.test(text)) add('run-planner', 'Prepare a manual Run draft with evidenced case selection and explicit exit criteria.');
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
   if(snapshot.evidence_type === 'authoritative_live_test_case_snapshot') { for(const record of snapshot.records || []) if(typeof record.id === 'string') targets.push({id:record.id,title:record.title,kind:'test_case',citation_id:item.citation.id}); continue; }
   if(snapshot.evidence_type !== 'authoritative_live_story_snapshot') continue;
   for(const record of snapshot.records || []) {
    if(typeof record.id==='string' && Number.isInteger(record.revision) && record.revision>0) targets.push({id:record.id,title:record.title,revision:record.revision,citation_id:item.citation.id});
   }
  } catch { /* Shortened or unverified passages cannot identify mutation targets. */ }
 }
 return targets.slice(0,50);
}
module.exports = { CONTRACT, normalizeArtifacts, followup, planFollowups, storyTargets, remainingRecommendations };
