const KINDS = Object.freeze(['requirement','test_case','execution','bug','knowledge_item','text','chat','file','url']);
const RELATIONS = Object.freeze(['TESTS','EXECUTED_IN','HAS_DEFECT','RELATED_TO','DEPENDS_ON','DERIVED_FROM','USES','PART_OF']);
const PERMISSIONS = Object.freeze({requirement:'requirement.view',test_case:'testcase.view',execution:'run.view',bug:'feedback.view'});
const LIMITS = Object.freeze({max_hops:3,max_fanout:12,max_nodes:120,max_edges:160,max_evidence:30,max_seeds:6,max_paths:5,max_tokens:8000,max_timeout_ms:20000});
const fail = (message, code = 'KNOWLEDGE_GRAPH_INPUT_INVALID', statusCode = 400) => Object.assign(new Error(message), {code,statusCode,publicMessage:message});
const text = (value, max=255) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const list = (value,max=100) => Array.isArray(value) ? value.slice(0,max) : [];
const number = (value,fallback,min,max) => value == null ? fallback : Number.isSafeInteger(Number(value)) && Number(value)>=min && Number(value)<=max ? Number(value) : (()=>{throw fail(`Use an integer from ${min} to ${max}.`);})();
const RELATION_DEFINITIONS = Object.freeze({
  TESTS: { label:'Tests', description:'A Test Case explicitly covers the linked Story.', source_kinds:['test_case'], target_kinds:['requirement'] },
  EXECUTED_IN: { label:'Executed in', description:'A Test Case is explicitly included in the recorded Run; this link alone does not mean the test passed.', source_kinds:['test_case'], target_kinds:['execution'] },
  HAS_DEFECT: { label:'Has Defect', description:'A Story, Test Case or Run is explicitly linked to a Defect.', source_kinds:['requirement','test_case','execution'], target_kinds:['bug'] },
  RELATED_TO: { label:'Related to', description:'A source-supported association; no dependency or causal claim is implied.' },
  DEPENDS_ON: { label:'Depends on', description:'The source evidence explicitly establishes a directional dependency.' },
  DERIVED_FROM: { label:'Derived from', description:'The source evidence identifies the material from which this source was derived.' },
  USES: { label:'Uses', description:'The source evidence establishes use of the target entity.' },
  PART_OF: { label:'Part of', description:'The source evidence establishes membership or containment in the target entity.' }
});
const describe = () => ({schema_version:'knowledge-graph/1',layer:'knowledge',node_kinds:[...KINDS],relation_types:[...RELATIONS],relation_definitions:structuredClone(RELATION_DEFINITIONS),limits:{...LIMITS},identity:'Canonical Knowledge source IDs; exact native keys and curated aliases. No fuzzy entity merges.',evidence:'Active relationships require current immutable chunk/version witnesses and fetch-time source, document, fragment and domain authorization.',temporal_scope:'Current authorized source versions and active assertions only. Timestamps describe stored observations; this endpoint does not reconstruct historical snapshots.',confidence:'Unknown unless explicitly recorded; provenance and source witnesses are not probability scores.',limitations:['Source-level semantic graph; repository symbols are not inferred from filenames.','LLM candidates and unreviewed relations never establish graph facts.','A bounded no-path result does not prove that no relationship exists.']});
module.exports = {KINDS,RELATIONS,PERMISSIONS,LIMITS,RELATION_DEFINITIONS,fail,text,list,number,describe};
