'use strict';

// Tool sets: the unit of delegation for an MCP credential.
//
// Every host used to see every tool its user's permissions allowed, including
// the ones that prepare changes. A credential now carries the sets it was issued
// for and only those tools are published to it and callable with it. Sets narrow
// what a credential may reach; they never widen it, because every tool still
// runs the user's own permission, feature-flag and project checks.
//
//   knowledge   read cited evidence, graph paths and recorded task contexts
//   records     read project records, discovery and typed projections
//   actions     prepare, and after human approval execute, a reviewed change
//   automation  prepare and read automation builds and browser missions
//
// `knowledge` and `records` are read-only and are the default. `actions` and
// `automation` can prepare effects, so a credential has them only when it was
// asked for them, and they imply `records` because preparing a change starts
// from discovering the operation to call.
//
// A tool that belongs to no set is published to no scoped credential: a new tool
// must be classified before an external host can see it. The unit test for this
// module fails until it is, and a tool that can write can never be served from a
// read-only set whatever its name suggests.

const SETS = Object.freeze({
  knowledge: Object.freeze({
    title: 'Knowledge',
    description: 'Cited evidence from live project facts and authorized knowledge, graph traversal and recorded task contexts. Read only.',
    read_only: true, requires: Object.freeze([])
  }),
  records: Object.freeze({
    title: 'Records',
    description: 'Project records, operation discovery and typed read-only projections of requirements, Test Cases, runs and defects. Read only.',
    read_only: true, requires: Object.freeze([])
  }),
  actions: Object.freeze({
    title: 'Actions',
    description: 'Prepare a change for your review. Nothing is applied until you approve the exact plan, and a person approves it in HelloTest.',
    read_only: false, requires: Object.freeze(['records'])
  }),
  automation: Object.freeze({
    title: 'Automation',
    description: 'Prepare Automation Engineer builds and browser missions for your review and read their results.',
    read_only: false, requires: Object.freeze(['records'])
  })
});

const SET_IDS = Object.freeze(Object.keys(SETS));
const DEFAULT_SCOPES = Object.freeze(SET_IDS.filter(id => SETS[id].read_only));

const KNOWLEDGE_TOOLS = new Set([
  'hellotest_context_build', 'hellotest_knowledge_fetch', 'hellotest_knowledge_source_get',
  'hellotest_knowledge_collections_list', 'hellotest_knowledge_collections_get',
  'hellotest_graph_resolve', 'hellotest_graph_context', 'hellotest_graph_trace', 'hellotest_graph_schema',
  'hellotest_context_graph_list', 'hellotest_context_graph_explore'
]);
const RECORD_TOOLS = new Set([
  'hellotest_capabilities', 'hellotest_operation_describe', 'hellotest_operation_read',
  'hellotest_database_schema', 'hellotest_database_query', 'hellotest_project_get', 'hellotest_test_case_steps_get'
]);
const ACTION_TOOLS = new Set(['hellotest_operation_prepare', 'hellotest_operation_execute', 'hellotest_operation_status']);
const AUTOMATION_TOOLS = new Set([
  'hellotest_automation_engineer_prepare', 'hellotest_automation_parameter_plan_prepare', 'hellotest_automation_engineer_status',
  'hellotest_browser_mission_prepare', 'hellotest_browser_mission_status'
]);
// Curated domain tools are generated per resource. Only the exact generated shapes
// are recognised, so a differently named write tool is unclassified, not read.
const RESOURCE_READ = /^hellotest_[a-z0-9_]+_(?:list|get)$/;
const RESOURCE_PREPARE = /^hellotest_[a-z0-9_]+_(?:create|update)_prepare$/;

// Tools that were removed. Naming them lets a caller that still uses one learn what
// replaced it instead of receiving a generic "not found".
const RETIRED_TOOLS = Object.freeze({
  hellotest_graph_expand: 'hellotest_graph_resolve to find the entity, then hellotest_graph_context or hellotest_graph_trace for its witnessed relationships'
});

/** The set a tool belongs to, or null when it is unclassified. */
const setOf = name => {
  if (KNOWLEDGE_TOOLS.has(name)) return 'knowledge';
  if (ACTION_TOOLS.has(name) || RESOURCE_PREPARE.test(name)) return 'actions';
  if (AUTOMATION_TOOLS.has(name)) return 'automation';
  if (RECORD_TOOLS.has(name) || RESOURCE_READ.test(name)) return 'records';
  return null;
};

/** `scopes` completed with the sets they require, in catalog order. Throws on an unknown set. */
const normalizeScopes = (scopes = DEFAULT_SCOPES) => {
  const list = Array.isArray(scopes) ? scopes : [scopes];
  const unknown = list.filter(id => typeof id !== 'string' || !SET_IDS.includes(id));
  if (!list.length || unknown.length || list.length > SET_IDS.length * 2) {
    throw Object.assign(new Error(`Choose tool sets from: ${SET_IDS.join(', ')}.`), { statusCode: 400, code: 'MCP_INVALID_SCOPE', publicMessage: `Choose tool sets from: ${SET_IDS.join(', ')}.` });
  }
  const wanted = new Set(list);
  for (const id of list) for (const required of SETS[id].requires) wanted.add(required);
  return SET_IDS.filter(id => wanted.has(id));
};

/** Whether a credential with `scopes` may see and call this tool. `tool` is the descriptor, when known. */
const permits = (scopes, name, tool) => {
  const set = setOf(name);
  if (!set || !Array.isArray(scopes) || !scopes.includes(set)) return false;
  // A tool that can write is never served from a read-only set, whatever it is called.
  return !(tool?.write && SETS[set].read_only);
};

/** The scopes an internal call to this tool needs: its own set plus what that set requires. */
const scopesFor = name => {
  const set = setOf(name);
  return set ? normalizeScopes([set]) : null;
};

/** The catalog, for discovery: each set with the tools of `catalog` that it publishes. */
const describe = catalog => SET_IDS.map(id => {
  const tools = Object.keys(catalog).filter(name => setOf(name) === id && !(catalog[name]?.write && SETS[id].read_only)).sort();
  return { id, title: SETS[id].title, description: SETS[id].description, read_only: SETS[id].read_only, requires: [...SETS[id].requires], default: DEFAULT_SCOPES.includes(id), tool_count: tools.length, tools };
});

/** Every tool of `catalog` that no set publishes, or that would put a write tool in a read-only set. */
const problems = catalog => Object.entries(catalog).flatMap(([name, tool]) => {
  const set = setOf(name);
  if (!set) return [`${name} belongs to no tool set`];
  return tool?.write && SETS[set].read_only ? [`${name} can write but is classified into the read-only ${set} set`] : [];
});

const retiredReplacement = name => RETIRED_TOOLS[name] || null;

module.exports = { DEFAULT_SCOPES, RETIRED_TOOLS, SETS, SET_IDS, describe, normalizeScopes, permits, problems, retiredReplacement, scopesFor, setOf };
