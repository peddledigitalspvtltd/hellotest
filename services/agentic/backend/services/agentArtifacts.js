const {aiInstructionBlock}=require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { normalizeParameterKey } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const { normalizeAutomationStartUrl } = require('@hellotest/platform/backend/src/utils/automationStartUrl');
const { validGherkinCase } = require('@hellotest/platform/backend/src/utils/aiGenerationContracts');
const { outcomeContract } = require('./agentOutcomeContracts');
const profiles = require('../../shared/workflowSpecialists.json');
const artifactKinds = new Set(require('../../shared/agentOutcomeContracts.json').artifact_kinds);
const CONTRACT = aiInstructionBlock("ai.agentic.workflow", "agentArtifacts.nativeProposalContract");
const fail=validation_path=>Object.assign(new Error('The model returned an invalid structured artifact.'),{code:'AI_INVALID_RESPONSE',...(validation_path?{validation_path}:{})});
const text=(v,max=8000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw fail();return v.trim();};
const strings=(v,max=30)=>{if(!Array.isArray(v)||!v.length||v.length>max)throw fail();return v.map(s=>text(s,4000));};
function normalizeArtifacts(value,citations,targets = [], {requireMetadata = false,testCaseTypes,pinnedStoryId} = {}) {
 if(value==null)return [];
 if(!Array.isArray(value)||value.length>8)throw fail();
 const allowed=new Set(citations.map(c=>c.id));
 return value.map((a,index)=>{
  const path=key=>`artifacts[${index}].${key}`;
  if(!a||!['story','test_case','defect','run','automation'].includes(a.kind))throw fail();
  const ids=strings(a.citation_ids,36);if(ids.some(id=>!allowed.has(id)))throw fail();
  const priority=Number.isInteger(a.priority)&&a.priority>=1&&a.priority<=5?`P${a.priority}`:a.priority;
  if((requireMetadata||a.priority!=null)&&!['P1','P2','P3','P4','P5'].includes(priority))throw fail(path('priority'));
  const artifact={kind:a.kind,title:text(a.title,255),description:text(a.description,12000),citation_ids:[...new Set(ids)],priority:priority||'P3'};
  if(a.kind!=='story'&&a.target_id!=null)throw fail(path('target_id'));
  if(a.addressed_finding_ids!=null){if(!Array.isArray(a.addressed_finding_ids)||a.addressed_finding_ids.length>20)throw fail();artifact.addressed_finding_ids=[...new Set(a.addressed_finding_ids.map(id=>text(id,120)))];}
  if(a.kind==='story') {
   artifact.acceptance_criteria=strings(a.acceptance_criteria);
   const targetId = a.target_id ?? pinnedStoryId;
   if (pinnedStoryId && targetId !== pinnedStoryId) throw fail(path('target_id'));
   if(targetId != null) {
    const target = targets.find(t => t.id === targetId && t.kind !== 'test_case' && ids.includes(t.citation_id));
    if(!target || !Number.isInteger(target.revision) || target.revision < 1) throw fail();
    artifact.target_id = target.id; artifact.target_revision = target.revision;
   }
  }
  if(a.kind==='test_case'||a.kind==='automation'){
   for(const key of ['test_data','cleanup','prerequisites'])if(a[key]!=null&&(!Array.isArray(a[key])||a[key].length>20))throw fail(path(key));
   if(requireMetadata&&a.test_case_type==null)throw fail(path('test_case_type'));
   if(a.test_case_type!=null){artifact.test_case_type=text(a.test_case_type,120).toLowerCase();if(!/^[a-z][a-z0-9_-]{0,119}$/.test(artifact.test_case_type)||Array.isArray(testCaseTypes)&&!testCaseTypes.includes(artifact.test_case_type))throw fail();}
   if(requireMetadata&&a.parameter_values==null)throw fail(path('parameter_values'));
   if(a.parameter_values!=null){
    if(typeof a.parameter_values!=='object'||Array.isArray(a.parameter_values)||Object.keys(a.parameter_values).length>40)throw fail();
    artifact.parameter_values={};
    for(const [raw,value] of Object.entries(a.parameter_values)){
     const key=normalizeParameterKey(raw,'t');
     if(!key.startsWith('t.')||key.length>130||/[\x00-\x1f]/.test(key)||typeof value!=='string'||value.length>4000||Object.hasOwn(artifact.parameter_values,key))throw fail();
     Object.defineProperty(artifact.parameter_values,key,{value,enumerable:true,writable:true,configurable:true});
    }
   }
   artifact.requirement_ids = a.requirement_ids == null || (Array.isArray(a.requirement_ids) && !a.requirement_ids.length) ? [] : strings(a.requirement_ids,16);
   if (artifact.requirement_ids.some(id => !targets.some(target => target.id === id && target.kind !== 'test_case' && ids.includes(target.citation_id)))) throw fail();
   artifact.test_data = Array.isArray(a.test_data) && a.test_data.length <= 20 ? a.test_data.map(s => text(s,2000)) : [];
   artifact.cleanup = Array.isArray(a.cleanup) && a.cleanup.length <= 20 ? a.cleanup.map(s => text(s,2000)) : [];
   artifact.prerequisites=Array.isArray(a.prerequisites)&&a.prerequisites.length<=20?a.prerequisites.map(s=>text(s,2000)):[];
   artifact.authoring_mode = a.authoring_mode || 'structured';
   if(a.kind==='automation'&&artifact.authoring_mode!=='structured')throw fail();
   if(!['structured','gherkin'].includes(artifact.authoring_mode))throw fail();
   if(artifact.authoring_mode === 'gherkin') {
    artifact.gherkin_document = text(a.gherkin_document,16000);
    if(!validGherkinCase(artifact.gherkin_document))throw fail(path('gherkin_document'));
    artifact.steps = [];
   } else { if(!Array.isArray(a.steps)||!a.steps.length||a.steps.length>30)throw fail();artifact.steps=a.steps.map(s=>{if(!s||s.automation_code!=null||s.api_request!=null||s.step_type != null && !['web','api','android','ios'].includes(s.step_type))throw fail();return {action:text(s.action,4000),expected_result:text(s.expected_result,4000),...(s.step_type?{step_type:s.step_type}:{})};}); }
   if(a.kind==='automation'){
    artifact.manual_test_case_ids=a.manual_test_case_ids==null||Array.isArray(a.manual_test_case_ids)&&!a.manual_test_case_ids.length?[]:strings(a.manual_test_case_ids,16);
    if(artifact.manual_test_case_ids.some(id=>!targets.some(target=>target.kind==='test_case'&&target.id===id&&ids.includes(target.citation_id))))throw fail();
    try{artifact.start_url=normalizeAutomationStartUrl(a.start_url,{required:artifact.steps.some(step=>(step.step_type||'web')==='web')});}catch{throw fail();}
   }
  }
  if(a.kind==='run') { artifact.test_case_ids = strings(a.test_case_ids,50); if(artifact.test_case_ids.some(id => !targets.some(target => target.kind === 'test_case' && target.id === id && ids.includes(target.citation_id)))) throw fail(); artifact.exit_criteria = strings(a.exit_criteria,20); }
  if(a.kind==='defect'){artifact.reproduction_steps=strings(a.reproduction_steps);artifact.expected_result=text(a.expected_result,4000);artifact.actual_result=text(a.actual_result,4000);if((requireMetadata||a.severity!=null)&&!['critical','high','medium','low'].includes(a.severity))throw fail();artifact.severity=a.severity||'medium';}
  return artifact;
 });
}
// Route only evidence-backed work from the review, never arbitrary agent IDs supplied by a model.
const AUTHOR_KINDS = { 'story-completion': 'story', 'story-architect': 'story', 'test-designer': 'test_case', 'bug-reporter': 'defect', 'run-planner': 'run', 'automation-engineer': 'automation' };
function planFollowups(agentId, scopes, result, {max=3,refineExisting=false} = {}) {
 if (agentId === 'repository-curator' || agentId.startsWith('browser-')) return [];
 const scope = new Set(scopes);
 const supported = new Set(result.citation_ids || []);
 const findingText = f => [f.title, f.detail, f.observation, f.gap, f.proposed_action].filter(Boolean).join(' ');
 const findings = (result.findings || []).filter(f => (f.citation_ids || []).some(id => supported.has(id)) && (artifactKinds.has(f.artifact_kind)||!/^(?:no (?:gaps?|changes?|issues?|defects?|bugs?|failures?|missing)|complete(?:d)? (?:coverage|story)|all .* (?:covered|satisfied)|.*needs no (?:changes?|follow.up))/i.test(findingText(f))));
 if (!findings.length) return [];
 // A recommendation alone is not evidence for a new work item. Each handoff
 // carries only the cited findings that support that domain's proposed change.
 const actionable = findings.filter(f => f.requires_proposal!==false&&(artifactKinds.has(f.artifact_kind)||/missing|gap|omit|ambig|incomplete|improv|clarif|add|fix|fail|defect|bug|inadequate|untested|insufficient|recommend|need|select|plan|prepare|create|prioriti[sz]e/i.test(findingText(f))));
 const matches=(finding,kind,pattern)=>finding.artifact_kind!=null?finding.artifact_kind===kind:pattern.test(findingText(finding));
 const planned = [];
 const add = (id, matching) => {
  const kind = AUTHOR_KINDS[id];
  const existing = result.artifacts?.filter(a => a.kind === kind) || [];
  if (id===agentId || !matching.length || !kind || planned.some(p => p.kind === kind) || (existing.length && !refineExisting)) return;
  const finding_ids=[...new Set(matching.map(f=>f.id).filter(id=>typeof id==='string'&&id))];
  planned.push({ agent_id: id, kind, reason:profiles[id]?.description||id, ...(existing.length ? {refine_existing:true} : {}), citation_ids: [...new Set(matching.flatMap(f => (f.citation_ids || []).filter(id => supported.has(id))))],...(finding_ids.length?{finding_ids}:{}),typed:matching.some(f=>f.artifact_kind===kind) });
 };
 if (scope.has('stories'))
  add('story-completion', actionable.filter(f => matches(f,'story',/story|stories|acceptance|requirement|ambigu/i)));
 if (scope.has('test-cases'))
  add('test-designer', actionable.filter(f => matches(f,'test_case',/test|coverage|scenario|assertion|untested/i)));
 if (scope.has('bugs'))
  add('bug-reporter', actionable.filter(f => {
   if(f.artifact_kind!=null&&f.artifact_kind!=='defect')return false;
   const detail = findingText(f);
   if (!/defect|bug|failure|failed|reproduc/i.test(detail)) return false;
   if (/\b(?:missing|unknown|unverified|without|no)\b.{0,35}\b(?:reproduction|expected (?:result|behavior)|oracle|failure evidence|product evidence)\b/i.test(detail)) return false;
   const observed = /\b(?:observed|reproducible|confirmed|recorded|actual)\b/i.test(detail);
   if (/\b(?:hypothesis|suspected|unconfirmed|possible|may|might)\b/i.test(detail) && !observed) return false;
   if (/\b(?:automation|environment|fixture|infrastructure|test data)\b.{0,35}\b(?:failure|issue)\b/i.test(detail) && !/\b(?:product|application)\b.{0,25}\b(?:defect|bug|failure)\b/i.test(detail)) return false;
   return observed || /\b(?:create|record|prepare|report|file|needs?)\b.{0,35}\b(?:defect|bug)\b/i.test(detail);
  }));
 if (scope.has('runs') && scope.has('test-cases')) add('run-planner', actionable.filter(f => matches(f,'run',/(?:select|plan|prepare|create|prioriti[sz]e).{0,60}(?:run|regression|execution)|run (?:selection|plan)/i)));
 if (scope.has('automation') && scope.has('test-cases')) add('automation-engineer',actionable.filter(f=>matches(f,'automation',/\b(?:create|prepare|generate|missing|add)\b.{0,50}\bautomation (?:plan|case|coverage)\b/i)));
 return planned.sort((left,right)=>Number(right.typed)-Number(left.typed)).slice(0,Number.isInteger(max)?Math.min(5,Math.max(1,max)):3).map(({typed,...item})=>item);
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
function outcomeIssues(result, contract) {
 const issues=[],artifacts=Array.isArray(result?.artifacts)?result.artifacts:[],findings=Array.isArray(result?.findings)?result.findings:[];
 const concreteGap=(result?.evidence_gaps||[]).some(value=>typeof value==='string'&&value.trim().length>=20&&!/^(?:insufficient (?:evidence|context)|more (?:information|details)(?: needed)?|need more (?:information|details)|missing (?:data|context|evidence))[.!\s]*$/i.test(value.trim()));
 const blocked=artifacts.length===0&&concreteGap;
 const add=(code,message,extra={})=>issues.push({code,message,...extra,...(blocked&&['AGENT_OUTCOME_PROPOSAL_REQUIRED','AGENT_OUTCOME_FINDING_UNRESOLVED'].includes(code)?{blocked:true}:{})});
 const clean=contract.allow_clean_review===true&&result?.no_changes_required===true&&!findings.length&&!(result?.evidence_gaps||[]).length&&(result?.citation_ids||[]).length>0;
 if(contract.mode==='author'&&!clean){
  const allowed=new Set(contract.artifact_kinds||[]),count=artifacts.filter(item=>allowed.has(item.kind)).length;
  if(count<(contract.minimum_artifacts||1))add('AGENT_OUTCOME_PROPOSAL_REQUIRED',`The requested ${[...allowed].join('/')} output requires at least ${contract.minimum_artifacts||1} complete structured proposal(s), or specific missing evidence. Review comments do not satisfy this output.`,{kind:[...allowed][0]});
  const supplemental=new Set(contract.supplemental_artifact_kinds||[]);
  if(artifacts.some(item=>!allowed.has(item.kind)&&!supplemental.has(item.kind)))add('AGENT_OUTCOME_KIND_MISMATCH','Return only the selected artifact kind or an independently validated successor proposal.');
 }
 const byId=new Map(findings.filter(f=>typeof f.id==='string'&&f.id).map(f=>[f.id,f]));
 if(byId.size!==findings.filter(f=>typeof f.id==='string'&&f.id).length)add('AGENT_OUTCOME_FINDING_CONTRACT_INVALID','Each finding must have a unique identity so its evidence and proposal coverage remain unambiguous.');
 for(const finding of findings)if(finding.artifact_kind!=null&&!artifactKinds.has(finding.artifact_kind)||finding.requires_proposal!=null&&typeof finding.requires_proposal!=='boolean')add('AGENT_OUTCOME_FINDING_CONTRACT_INVALID','Finding proposal kinds and completion flags must use the declared typed contract.',{finding_ids:finding.id?[finding.id]:[]});
 for(const artifact of artifacts)for(const id of artifact.addressed_finding_ids||[]){
  const finding=byId.get(id);
  if(!finding||(finding.citation_ids||[]).every(source=>!(artifact.citation_ids||[]).includes(source)))add('AGENT_OUTCOME_FINDING_REFERENCE_INVALID','A proposal must address an exact recorded finding and cite evidence supporting that finding.',{finding_ids:[id],kind:artifact.kind});
 }
 if(contract.findings_require_proposals||contract.mode==='author'){
  const required=planFollowups('quality-orchestrator',contract.context_scopes||[],{...result,artifacts:[]},{max:5});
  for(const handoff of required){
   if(contract.mode==='author'&&!contract.artifact_kinds.includes(handoff.kind))continue;
   const matching=artifacts.filter(item=>item.kind===handoff.kind);
   if(!matching.length){add('AGENT_OUTCOME_FINDING_UNRESOLVED',`The cited ${handoff.kind} gap requires a complete reviewable proposal or specific missing evidence.`,{kind:handoff.kind,finding_ids:handoff.finding_ids||[]});continue;}
   const uncovered=(handoff.finding_ids||[]).filter(id=>!matching.some(item=>(item.addressed_finding_ids||[]).includes(id)&&(byId.get(id)?.citation_ids||[]).some(source=>(item.citation_ids||[]).includes(source))));
   if(uncovered.length)add('AGENT_OUTCOME_FINDING_UNRESOLVED','Every cited actionable finding must be addressed by the relevant proposal, with its exact finding ID and supporting source.',{kind:handoff.kind,finding_ids:uncovered});
  }
 }
 return issues;
}
function storyTargets(boundedContext) {
 const targets=[];
 for (const item of Object.values(boundedContext || {}).flat()) {
  if(item.source_kind !== 'live_project' || !item.citation?.id) continue;
  try {
   const snapshot=JSON.parse(item.content);
   if(snapshot.evidence_type === 'authoritative_full_test_case_intent') {
    for(const record of snapshot.records || []) {
     if(typeof record.id === 'string') targets.push({id:record.id,title:record.title,kind:'test_case',citation_id:item.citation.id});
     if(snapshot.completeness?.story_traceability_included===true && snapshot.evidence_permissions?.includes('requirement.view')) for(const id of record.requirement_ids || []) if(typeof id==='string') targets.push({id,kind:'story_link',citation_id:item.citation.id});
    }
    continue;
   }
   if(snapshot.evidence_type === 'authoritative_live_test_case_snapshot') { for(const record of snapshot.records || []) if(typeof record.id === 'string') targets.push({id:record.id,title:record.title,kind:'test_case',citation_id:item.citation.id}); continue; }
   if(snapshot.evidence_type !== 'authoritative_live_story_snapshot') continue;
   for(const record of snapshot.records || []) {
    if(typeof record.id==='string' && Number.isInteger(record.revision) && record.revision>0) targets.push({id:record.id,title:record.title,revision:record.revision,citation_id:item.citation.id});
   }
  } catch { /* Shortened or unverified passages cannot identify mutation targets. */ }
 }
 return targets.slice(0,50);
}
module.exports = { CONTRACT, normalizeArtifacts, followup, planFollowups, storyTargets, remainingRecommendations, outcomeContract, outcomeIssues };
