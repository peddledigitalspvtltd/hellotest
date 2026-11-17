"use strict";

// The link lines the native-record serializers write into a source's text and
// the graph projection later looks for as relationship witnesses.
//
// The projection used to re-parse the serializer's own output ("Linked Test Case
// IDs: ...") using string literals duplicated in both places, so renaming a label
// in a serializer silently turned every edge into "unresolved". Both sides now
// import this table, a contract test builds real serializer output and checks the
// projection can find every declared link in it, and an edge whose witness cannot
// be found is recorded with an explicit reason instead of being dropped quietly.

const LINK_LABELS = Object.freeze({
  linkedTestCaseIds: "Linked Test Case IDs",
  requirementIds: "Requirement IDs",
  linkedStoryIds: "Linked Story IDs",
  linkedTestRunId: "Linked Test Run ID",
  linkedTestSuiteIds: "Linked Test Suite IDs",
  linkedModuleIds: "Linked Module IDs",
  testCaseIds: "Test Case IDs",
  moduleIds: "Module IDs",
  suiteId: "Suite ID",
  releaseIds: "Release IDs",
  sprintIds: "Sprint IDs",
  executionId: "Test Run ID",
  parentSuiteId: "Parent Suite ID"
});
// Special witnessed links whose endpoints come from a result row rather than
// its generic relationship fields (the graph projects Case -> Run, not Result -> Run).
const SPECIAL_LINK_LABELS = Object.freeze([LINK_LABELS.executionId]);

/**
 * For each native source kind: which metadata field holds the linked ids, the
 * serializer label that witnesses them in the text, what kind of record they
 * identify, and how the edge is directed (`reverse`: the linked record is the
 * edge source, this record the target).
 */
const LINK_FIELDS = Object.freeze({
  requirement: Object.freeze([
    { field: "linked_test_case_ids", countField: "linked_test_case_count", label: LINK_LABELS.linkedTestCaseIds, kind: "test_case", type: "TESTS", reverse: true },
    { field: "release_ids", countField: "release_count", label: LINK_LABELS.releaseIds, kind: "release", type: "PART_OF", reverse: false },
    { field: "sprint_ids", countField: "sprint_count", label: LINK_LABELS.sprintIds, kind: "sprint", type: "PART_OF", reverse: false }
  ]),
  test_case: Object.freeze([
    { field: "requirement_ids", countField: "requirement_count", label: LINK_LABELS.requirementIds, kind: "requirement", type: "TESTS", reverse: false },
    { field: "suite_id", countField: null, label: LINK_LABELS.suiteId, kind: "test_suite", type: "PART_OF", reverse: false },
    { field: "module_ids", countField: "module_count", label: LINK_LABELS.moduleIds, kind: "test_module", type: "PART_OF", reverse: false }
  ]),
  test_suite: Object.freeze([
    { field: "test_case_ids", countField: "test_case_count", label: LINK_LABELS.testCaseIds, kind: "test_case", type: "PART_OF", reverse: true },
    { field: "parent_suite_id", countField: null, label: LINK_LABELS.parentSuiteId, kind: "test_suite", type: "PART_OF", reverse: false }
  ]),
  test_module: Object.freeze([
    { field: "test_case_ids", countField: "test_case_count", label: LINK_LABELS.testCaseIds, kind: "test_case", type: "PART_OF", reverse: true },
    { field: "requirement_ids", countField: "requirement_count", label: LINK_LABELS.requirementIds, kind: "requirement", type: "PART_OF", reverse: true }
  ]),
  release: Object.freeze([
    { field: "requirement_ids", countField: "requirement_count", label: LINK_LABELS.requirementIds, kind: "requirement", type: "PART_OF", reverse: true },
    { field: "sprint_ids", countField: "sprint_count", label: LINK_LABELS.sprintIds, kind: "sprint", type: "PART_OF", reverse: false }
  ]),
  sprint: Object.freeze([
    { field: "requirement_ids", countField: "requirement_count", label: LINK_LABELS.requirementIds, kind: "requirement", type: "PART_OF", reverse: true }
  ]),
  bug: Object.freeze([
    { field: "linked_requirement_ids", countField: "linked_requirement_count", label: LINK_LABELS.linkedStoryIds, kind: "requirement", type: "HAS_DEFECT", reverse: true },
    { field: "linked_test_case_ids", countField: "linked_test_case_count", label: LINK_LABELS.linkedTestCaseIds, kind: "test_case", type: "HAS_DEFECT", reverse: true },
    { field: "linked_test_suite_ids", countField: null, label: LINK_LABELS.linkedTestSuiteIds, kind: "test_suite", type: "HAS_DEFECT", reverse: true },
    { field: "linked_module_ids", countField: null, label: LINK_LABELS.linkedModuleIds, kind: "test_module", type: "HAS_DEFECT", reverse: true },
    { field: "linked_test_run_id", countField: null, label: LINK_LABELS.linkedTestRunId, kind: "execution", type: "HAS_DEFECT", reverse: true }
  ])
});

/** One witness line exactly as it appears in a serialized source. */
const linkLine = (label, id) => `${label}: ${id}`;

module.exports = { LINK_FIELDS, LINK_LABELS, SPECIAL_LINK_LABELS, linkLine };
