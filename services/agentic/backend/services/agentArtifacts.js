const CONTRACT = 'Additionally return artifacts (at most 8). Each artifact requires kind (story|test_case|defect), title, description, citation_ids (exact supplied sources), priority (P1|P2|P3|P4). Stories require acceptance_criteria (nonempty concrete Given/When/Then strings). Test cases require prerequisites (strings) and steps [{action,expected_result}] with complete observable assertions. Defects require reproduction_steps (strings), expected_result, actual_result, severity (critical|high|medium|low). Distinguish proposed behavior from observed facts. Never invent executed results or save artifacts. Artifacts must address the supplied task and review findings. Unsupported expectations must be explicit evidence gaps.';
const fail=()=>Object.assign(new Error('The model returned an invalid structured artifact.'),{code:'AI_INVALID_RESPONSE'});
const text=(v,max=8000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw fail();return v.trim();};
const strings=(v,max=30)=>{if(!Array.isArray(v)||!v.length||v.length>max)throw fail();return v.map(s=>text(s,4000));};
function normalizeArtifacts(value,citations) {
 if(value==null)return [];
 if(!Array.isArray(value)||value.length>8)throw fail();
 const allowed=new Set(citations.map(c=>c.id));
 return value.map(a=>{
  if(!a||!['story','test_case','defect'].includes(a.kind))throw fail();
  const ids=strings(a.citation_ids,36);if(ids.some(id=>!allowed.has(id)))throw fail();
  const artifact={kind:a.kind,title:text(a.title,300),description:text(a.description,12000),citation_ids:[...new Set(ids)],priority:['P1','P2','P3','P4'].includes(a.priority)?a.priority:'P3'};
  if(a.kind==='story')artifact.acceptance_criteria=strings(a.acceptance_criteria);
  if(a.kind==='test_case'){artifact.prerequisites=Array.isArray(a.prerequisites)&&a.prerequisites.length<=20?a.prerequisites.map(s=>text(s,2000)):[];if(!Array.isArray(a.steps)||!a.steps.length||a.steps.length>40)throw fail();artifact.steps=a.steps.map(s=>({action:text(s.action,4000),expected_result:text(s.expected_result,4000)}));}
  if(a.kind==='defect'){artifact.reproduction_steps=strings(a.reproduction_steps);artifact.expected_result=text(a.expected_result,4000);artifact.actual_result=text(a.actual_result,4000);artifact.severity=['critical','high','medium','low'].includes(a.severity)?a.severity:'medium';}
  return artifact;
 });
}
// One follow-up specialist, selected by domain and evidence, never recursively by model output.
function followup(agentId,scopes,result,prompt) {
 if(!result.findings?.length||!result.citation_ids?.length)return null;
 const scope=new Set(scopes),has=regex=>regex.test([prompt,...result.recommendations,...result.findings.map(f=>`${f.title} ${f.detail}`)].join(' '));
 if(['story-assurance','story-grooming'].includes(agentId)&&scope.has('stories'))return 'story-completion';
 if(['failure-analyst','bug-triage','flaky-test-intelligence'].includes(agentId)&&scope.has('bugs'))return 'bug-reporter';
 if(['automation-engineer','repository-curator','automation-repair'].includes(agentId)&&scope.has('test-cases'))return 'test-designer';
 if(['quality-orchestrator','quality-evaluator','release-readiness','coverage-assurance','impact-analysis','risk-prediction','release-risk-simulation','quality-graph','run-planner'].includes(agentId)) {
  if(scope.has('stories')&&has(/story|stories|acceptance|requirement|ambigu/i))return 'story-architect';
  if(scope.has('test-cases')&&has(/test|coverage|scenario|assertion/i))return 'test-designer';
  if(scope.has('bugs')&&has(/defect|bug|failure/i))return 'bug-reporter';
 }
 return null;
}
module.exports={CONTRACT,normalizeArtifacts,followup};
