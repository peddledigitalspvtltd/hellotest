# Workflow operation editors

`registry.ts` binds concrete editor components to the canonical node-kind
metadata, including `ui.panel`. Every registered kind has an explicit owner.
Seventeen kinds provide operation fields here; specialist, repository-agent,
trigger and output controls remain owned by `WorkflowNodeInspector` and have no
additional operation fields.

A kind owns its dependent state patches and resource queries. Shared modules
provide stateless input rendering, managed connection presentation and HTTP
request primitives; they do not dispatch node kinds. Merge matching defaults,
loop mapping defaults and wait timeout adjustment stay with their kind editors.
Native artifact subtask controls remain together because they share one native
task contract.

`workflowOperationEditors.test.mjs` checks completeness, canonical metadata,
query ownership, permission-aware MCP controls, managed credential replacement,
Sprint scope, literal values and dependent patches. Workflow browser tests cover
native guidance persistence and real loop, merge, condition and data-operation
controls. The split was also compared once against the exact pre-extraction
source: 49 rendered variants and every control patch matched; the old
implementation is not retained as a duplicate production or test module.
