"use strict";

// The Knowledge graph ontology, defined once.
//
// Node kinds, relation types, provenance levels and the kind-to-permission map
// used to be repeated across several services and two SQL CHECK constraints, so
// adding a relation meant editing each copy by hand and writing an ALTER the
// create-if-not-exists schema files could not express. Everything that needs the
// lists now derives them from here: the graph contracts, the Zod enums in the
// MCP layer, and the SQL constraint migration below.

const NODE_KINDS = Object.freeze(["requirement", "test_case", "execution", "execution_result", "bug", "test_suite", "test_module", "release", "sprint", "knowledge_item", "text", "chat", "file", "url"]);
// Kinds that mirror native application records and are indexed from them.
const NATIVE_KINDS = Object.freeze(["requirement", "test_case", "execution", "execution_result", "bug", "test_suite", "test_module", "release", "sprint"]);
// Kinds a person or integration supplies as free-form material.
const DOCUMENT_KINDS = Object.freeze(NODE_KINDS.filter((kind) => !NATIVE_KINDS.includes(kind)));
// Retrieval can also search the curated product guide, which is not a graph node.
const RETRIEVAL_SOURCE_KINDS = Object.freeze([...NODE_KINDS, "product_help"]);

const RELATION_TYPES = Object.freeze(["TESTS", "EXECUTED_IN", "HAS_DEFECT", "RELATED_TO", "DEPENDS_ON", "DERIVED_FROM", "USES", "PART_OF", "MENTIONS"]);
const CURATABLE_RELATION_TYPES = Object.freeze(RELATION_TYPES.filter((type) => type !== "MENTIONS"));
const PROVENANCE_TYPES = Object.freeze(["DETERMINISTIC", "SOURCE_EXPLICIT", "HUMAN_VERIFIED", "LLM_CANDIDATE"]);
// Provenance levels that may establish a graph fact. An LLM candidate never does.
const TRUSTED_PROVENANCE = Object.freeze(PROVENANCE_TYPES.filter((type) => type !== "LLM_CANDIDATE"));
const EDGE_STATUSES = Object.freeze(["ACTIVE", "CANDIDATE", "REJECTED", "TOMBSTONED"]);

const PERMISSION_BY_KIND = Object.freeze({
  requirement: "requirement.view", test_case: "testcase.view", execution: "run.view", execution_result: "run.view", bug: "feedback.view",
  test_suite: "testcase.view", test_module: "testcase.view", release: "requirement.view", sprint: "requirement.view"
});

const RELATION_DEFINITIONS = Object.freeze({
  TESTS: { label: "Tests", description: "A Test Case explicitly covers the linked Story.", source_kinds: ["test_case"], target_kinds: ["requirement"] },
  EXECUTED_IN: { label: "Executed in", description: "A Test Case is explicitly included in the recorded Run; this link alone does not mean the test passed.", source_kinds: ["test_case"], target_kinds: ["execution"] },
  HAS_DEFECT: { label: "Has Defect", description: "A Story, Test Case or Run is explicitly linked to a Defect.", source_kinds: ["requirement", "test_case", "execution"], target_kinds: ["bug"] },
  RELATED_TO: { label: "Related to", description: "A source-supported association; no dependency or causal claim is implied." },
  DEPENDS_ON: { label: "Depends on", description: "The source evidence explicitly establishes a directional dependency." },
  DERIVED_FROM: { label: "Derived from", description: "The source evidence identifies the material from which this source was derived." },
  USES: { label: "Uses", description: "The source evidence establishes use of the target entity." },
  PART_OF: { label: "Part of", description: "The source evidence establishes membership or containment in the target entity." },
  MENTIONS: {
    label: "Mentions",
    description: "A document contains the exact display ID of the target record. This is a textual reference, weaker than a verified product link; it does not establish coverage, dependency or cause.",
    source_kinds: DOCUMENT_KINDS, target_kinds: NATIVE_KINDS
  }
});

// Relation types implied by the kinds at the two ends of a trace: those that
// involve either kind, plus the generic ones that connect anything. A trace
// uses this only to PREFER such edges when a node's fanout is capped, never to
// exclude others, so a path through an unexpected relation is still found.
const impliedRelations = (...kinds) => {
  const wanted = kinds.filter(Boolean);
  return RELATION_TYPES.filter((type) => {
    const { source_kinds: sources, target_kinds: targets } = RELATION_DEFINITIONS[type];
    if (!sources && !targets) return true;
    return wanted.some((kind) => (sources || []).includes(kind) || (targets || []).includes(kind));
  });
};

const quote = (values) => values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(",");

// --- SQL ------------------------------------------------------------------

/** Stable short hash of the lists a constraint is generated from. */
const ontologyVersion = () => {
  const text = JSON.stringify({ n: NODE_KINDS, r: RELATION_TYPES, p: PROVENANCE_TYPES, s: EDGE_STATUSES });
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  return hash.toString(16).padStart(8, "0");
};

/** CHECK expressions for CREATE TABLE statements. */
const checks = () => ({
  nodeKinds: `CHECK (entity_type IN (${quote(NODE_KINDS)}))`,
  relationTypes: `CHECK (relation_type IN (${quote(RELATION_TYPES)}))`,
  edgeStatuses: `CHECK (status IN (${quote(EDGE_STATUSES)}))`,
  provenanceTypes: `CHECK (provenance_type IN (${quote(PROVENANCE_TYPES)}))`
});

/**
 * One idempotent statement that brings the generated CHECK constraints of
 * existing databases up to the current ontology exactly once per ontology
 * version. It is recorded in knowledge_schema_migrations, so it does not
 * re-validate (and lock) the whole graph on every start, and adding a node kind
 * or relation type is a one-line edit above.
 */
const constraintMigrationStatements = () => {
  const id = `ontology-constraints-${ontologyVersion()}`;
  return [
    `CREATE TABLE IF NOT EXISTS knowledge_schema_migrations (
      id TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `DO $migration$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM knowledge_schema_migrations WHERE id = '${id}') THEN
        ALTER TABLE ai_knowledge_graph_nodes DROP CONSTRAINT IF EXISTS ai_knowledge_graph_nodes_entity_type_check;
        ALTER TABLE ai_knowledge_graph_nodes ADD CONSTRAINT ai_knowledge_graph_nodes_entity_type_check CHECK (entity_type IN (${quote(NODE_KINDS)}));
        ALTER TABLE ai_knowledge_graph_edges DROP CONSTRAINT IF EXISTS ai_knowledge_graph_edges_relation_type_check;
        ALTER TABLE ai_knowledge_graph_edges ADD CONSTRAINT ai_knowledge_graph_edges_relation_type_check CHECK (relation_type IN (${quote(RELATION_TYPES)}));
        ALTER TABLE ai_knowledge_graph_edges DROP CONSTRAINT IF EXISTS ai_knowledge_graph_edges_status_check;
        ALTER TABLE ai_knowledge_graph_edges ADD CONSTRAINT ai_knowledge_graph_edges_status_check CHECK (status IN (${quote(EDGE_STATUSES)}));
        ALTER TABLE ai_knowledge_graph_edges DROP CONSTRAINT IF EXISTS ai_knowledge_graph_edges_provenance_type_check;
        ALTER TABLE ai_knowledge_graph_edges ADD CONSTRAINT ai_knowledge_graph_edges_provenance_type_check CHECK (provenance_type IN (${quote(PROVENANCE_TYPES)}));
        ALTER TABLE ai_knowledge_graph_edge_evidence DROP CONSTRAINT IF EXISTS ai_knowledge_graph_edge_evidence_provenance_type_check;
        ALTER TABLE ai_knowledge_graph_edge_evidence ADD CONSTRAINT ai_knowledge_graph_edge_evidence_provenance_type_check CHECK (provenance_type IN (${quote(PROVENANCE_TYPES)}));
        INSERT INTO knowledge_schema_migrations(id, description) VALUES ('${id}', 'Graph node kinds and relation types generated from knowledgeOntology.js');
      END IF;
    END
    $migration$`
  ];
};

module.exports = {
  CURATABLE_RELATION_TYPES, DOCUMENT_KINDS, EDGE_STATUSES, NATIVE_KINDS, NODE_KINDS, PERMISSION_BY_KIND, PROVENANCE_TYPES,
  RELATION_DEFINITIONS, RELATION_TYPES, RETRIEVAL_SOURCE_KINDS, TRUSTED_PROVENANCE, checks, constraintMigrationStatements,
  impliedRelations, ontologyVersion, quote
};
