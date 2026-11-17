# Portable evidence contracts

This directory is the single runtime owner of the versioned `KnowledgeObject`,
`RetrievalRequest`, `RetrievalEvent`, `ContextPacket` and `AnswerContract` JSON
schemas and their bounded validator. It also owns the model-answer candidate
schema. `@hellotest/contracts/evidence` imports no application/service package.
Its shared evidence-scope keys come from `../agents/evidenceScopeFields.json`.

Knowledge continues to own packet/request builders, retrieval authorization,
source freshness, witness packing, grounding, cache admission and answer
verification. The former Knowledge schema module is a compatibility export of
this exact module object. It does not retain a second schema or validator.
Chatbot, MCP and agents still reach these same runtime boundaries through the
existing Knowledge builders and services.

`index.d.ts` is generated mechanically from these runtime schemas, rather than
maintained as a second packet definition. Runtime validation additionally
checks numeric/text limits, safe keys, evidence identity, relationship witnesses
and claim/citation consistency; TypeScript types cannot establish authorization,
current source access or factual support. `validateContract` validates and
returns the original value. Legacy-version acceptance does not normalize it.

Regenerate declarations with:

```sh
node scripts/build/generate-evidence-contract-types.mjs
node scripts/build/generate-evidence-contract-types.mjs --check
```

Changes to a public contract require its version/compatibility review and the
existing Knowledge/Chatbot executable contract and privacy tests. The portable
move preserves version1.0 and its exact pre-move schema fingerprint.

The move also closes one preexisting enforcement gap: when both relationship
aliases were present, an empty `relationship_evidence` array previously hid
`relationships` from the witness check. The validator now checks both arrays.
Valid version1 packets are unchanged; foreign/missing witnesses are rejected
regardless of which compatible alias carries them.
