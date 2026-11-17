const ontology = require('./knowledgeOntology');
// Kinds, relations and permissions are defined once, in knowledgeOntology.js.
const KINDS = ontology.NODE_KINDS;
const RELATIONS = ontology.RELATION_TYPES;
const PERMISSIONS = ontology.PERMISSION_BY_KIND;
const LIMITS = Object.freeze({max_hops:3,max_fanout:12,max_nodes:120,max_edges:160,max_evidence:30,max_seeds:6,max_paths:5,max_tokens:8000,max_bytes:8000,max_timeout_ms:20000});
const fail = (message, code = 'KNOWLEDGE_GRAPH_INPUT_INVALID', statusCode = 400) => Object.assign(new Error(message), {code,statusCode,publicMessage:message});
const text = (value, max=255) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const list = (value,max=100) => Array.isArray(value) ? value.slice(0,max) : [];
const number = (value,fallback,min,max) => value == null ? fallback : Number.isSafeInteger(Number(value)) && Number(value)>=min && Number(value)<=max ? Number(value) : (()=>{throw fail(`Use an integer from ${min} to ${max}.`);})();
const RELATION_DEFINITIONS = ontology.RELATION_DEFINITIONS;
const describe = () => ({schema_version:'knowledge-graph/1',layer:'knowledge',budget_unit:'utf8_bytes',budget_note:'Graph budgets are UTF-8 bytes of the serialized graph (about four per model token), not model tokens.',node_kinds:[...KINDS],relation_types:[...RELATIONS],relation_definitions:structuredClone(RELATION_DEFINITIONS),limits:{...LIMITS},identity:'Canonical Knowledge source IDs; exact native keys and curated aliases. No fuzzy entity merges.',evidence:'Active relationships require current immutable chunk/version witnesses and fetch-time source, document, fragment and domain authorization.',temporal_scope:'Current authorized source versions and active assertions only. Timestamps describe stored observations; this endpoint does not reconstruct historical snapshots.',confidence:'Unknown unless explicitly recorded; provenance and source witnesses are not probability scores.',limitations:['Source-level semantic graph; repository symbols are not inferred from filenames.','LLM candidates and unreviewed relations never establish graph facts.','A bounded no-path result does not prove that no relationship exists.']});
module.exports = {KINDS,RELATIONS,PERMISSIONS,LIMITS,RELATION_DEFINITIONS,fail,text,list,number,describe};
