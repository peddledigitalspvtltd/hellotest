# AI feature contracts and budgets

The September 2026 audit found that Story and Test Case **Analyse with AI** called a deterministic impact preview without invoking a model. They now request an evidence-grounded narrative for the current draft. Existing deterministic scores remain unchanged. Failed model reviews show an explicit fallback reason; they are not presented as completed AI reviews.

## Inputs and expected outputs

| Feature | Relevant input | Output contract |
| --- | --- | --- |
| Story creation | User intent, selected delivery scope, reviewed context and image references | Reviewable Story fields, acceptance criteria, assumptions, gaps and evidence references |
| Complete Story | Bounded current Story, acceptance criteria, specification, planning fields and relevant linked cases | Supported Story improvements in the existing Story schema |
| Groom Story | Current Story and bounded, authorized delivery evidence | Distinct purpose, journey, business impact, solution, implementation and validation sections, with citations and readiness gaps |
| Story Assurance | Current unsaved draft, linked evidence, organizational criteria and locked score baseline | Cited explanations, prioritized improvements and limitations; no generated scores |
| Test Case Assurance | Current structured steps or current Gherkin, metadata, linked Story acceptance and locked baseline | Cited explanations and actionable design improvements; no generated execution results or scores |
| Test Case generation | Selected Stories, criteria, specification, relevant knowledge, authoring mode and requested count | Distinct cases with exact Story references, executable steps and observable expected outcomes |
| Case authoring / step rephrase | Current case, selected Story, platform, data tokens and selected step when applicable | Full case or one selected step using the requested schema; preserve data tokens and intent |
| Defect creation | Reporter brief, selected run/cases/Stories, observed results and reviewed context | Editable Defect fields, factual field citations, unsupported-field gaps and assumptions |
| Defect triage | Selected Defects and supporting evidence | Cited category refinements; deterministic priority and readiness remain locked |
| Automation | Manual case, available keyword catalog, object bindings and reviewed evidence | Existing keyword/step schema, valid references and explicit missing bindings |
| Execution analysis / planning / reports | Selected run evidence or delivery scope, available case IDs and bounded logs | Feature-specific analysis, plan or report; distinguish observed results from inferred causes |
| Synthetic data | Requested format, boundaries, field context and relevant reviewed constraints | Distinct fictional values and a concise summary |
| Rich-text rewrite | Current field, entity context and reviewed terminology | Allowed semantic HTML preserving facts and uncertainty |
| Knowledge / specialist assistants | Authorized, scoped retrieval, bounded history and current objective | Existing cited answer or specialist contract, with explicit evidence gaps |

Default editorial guidance is maintained in `frontend/src/lib/aiPromptRegistry.ts`, with a 4,000-character limit per configurable template. The backend retains the feature's authoritative schema and grounding rules. Regression, access-control and mobile generation packs live in `aiPromptTemplate.service.js`. Custom guidance does not replace the response contract.

## Context and provider selection

Smart Context applies feature-specific source-kind filters, deduplicates results, and builds a bounded reviewed pack with intact citation boundaries. The preview and submitted pack use the same included sources. Explicit context scopes no longer expand implicitly from the prompt's keywords. The artifact snapshot helpers select meaningful fields instead of serializing complete hydrated database records. Current Gherkin takes precedence over cached structured rows.

Provider precedence is explicit user selection, active configured feature preference, last successful provider for the same project/feature, last successful provider for that project, then the existing active fallback. A sole active provider is selected automatically in the shared selector. Retired implicit preferences are skipped; an unavailable explicit selection stays visible. Opening a selector or making a failed request does not record a success.

## Spending and failure bounds

`llmRequestPolicy.js` bounds every chat request using `llmHttpClient`. These are application limits, not a claim about a particular provider's context window or tokenizer.

| Operation | Maximum output tokens per call |
| --- | ---: |
| Story creation, completion, grooming; full-case authoring | 6,144 |
| Test Case generation; automation generation | 8,192 |
| Story / Test Case Assurance; Defect draft; execution analysis, plan and reports; release notes; rich-text rewrite | 4,096 |
| Dashboard design | 3,072 |
| Defect category triage; synthetic data | 2,048 |
| Selected manual-step rewrite | 1,024 |
| Other chat calls | 4,096 |

A lower caller-supplied limit is retained. Knowledge assistant calls retain their existing gateway budgets and usage accounting. The shared text-input ceiling is 96,000 UTF-8 bytes, including the schema and instructions; oversized inputs are rejected before dispatch rather than cutting serialized JSON or tool messages. Feature-level snapshots impose smaller field and record limits. Images retain their separate feature admission limits.

Direct Test Case previews accept at most ten Stories and ten requested cases per call. Background generation remains bounded per Story. Defect drafting includes at most ten selected cases, ten Stories and ten failure results, with omissions disclosed in its evidence boundaries.

Explicit provider parameter or context-size rejections may receive bounded corrections under one deadline. Truncated, refused, empty or invalid structured responses are rejected with actionable errors. The shared transport does not replay successful or uncertain billable generations. The specialist workflow retains its existing single JSON/citation repair attempt; the knowledge gateway retains its independently bounded retry and cost policy.

JSON-object mode is used for compatibility with configured providers, with schema instructions and feature-level validation. JSON mode alone does not guarantee schema adherence; this distinction follows the [OpenAI structured output documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

## Verification scope

Automated checks cover request contents, scope and citation boundaries, current structured/Gherkin drafts, provider-default precedence, input/output budgets, explicit compatibility handling, and failure behavior. UI regressions cover the shared Story/Defect studio and Smart Context/provider selection.

Live checks used only synthetic data against the configured `openai/gpt-oss-20b` integration: a small Story JSON contract completed with 165 input and 655 completion tokens under a 1,024-token output ceiling; actual Story and Test Case Assurance calls both returned cited reviews without fallback. These checks establish compatibility for that configuration, not every model or every real project scenario.
