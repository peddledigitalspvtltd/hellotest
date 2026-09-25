# Knowledge boundary evaluation

Run the executable fixture suite from the repository root:

```sh
node services/platform/backend/eval/knowledge/run.js /tmp/knowledge-contract-evaluation.json
node --test services/knowledge/test/backend/knowledgeExecutableContracts.test.js services/platform/backend/test/knowledgeModelBoundary.test.js
```

The evaluator exits nonzero when a fixture exposes forbidden evidence or fails its expected grounding or instruction-separation check. Its JSON report measures recall, precision, reciprocal rank, nDCG and hit rate on the explicitly identified deterministic context-assembly fixtures. It reports unauthorized exposure separately, with a target of zero.

The fixtures cover tenant boundaries, revocation, denied parent expansion, current and historical revisions, candidate limits, invented citations, unsupported summary fields and hostile retrieved instructions. Model-facing helper tests also execute the planning and synthesis boundaries with a mocked provider.

This is a small engineering regression set, not a production retrieval benchmark. It makes no claim about calibrated semantic entailment, provider prompt-injection resistance, latency isolation or real-corpus recall. Those measurements require a separately labeled corpus and actual provider/load runs. Valid citations alone produce a labeled interpretation; only extractive, independently verified or explicitly server-derived claims receive supported classification.

The schema definitions are exported by `knowledgeContractSchemas.service.js`. External contracts use `contract_type`, `contract_version: "1.0"` and a stable `schema_id`. The version gateway also recognizes the previous `*.v1` version spelling when the supplied fields satisfy the supported schema. Incoming authorization groups and unknown contract fields are rejected.
