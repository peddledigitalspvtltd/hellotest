# AI platform deep-research source record

Canonical deliverable: `docs/ai-platform-production-architecture.md`  
Audience: HelloTest engineering, security, product, and operations  
Date: 2026-09-05

Scope: production architecture for knowledge ingestion, hybrid retrieval, grounded conversational continuity, shared LLM invocation, and specialist agents. Assumptions: retain PostgreSQL/pgvector and existing configured LLM integrations; no separate vendor or infrastructure migration was requested.

## Executive answer

The production direction is retrieval-first and evidence-governed, not an unbounded autonomous agent. Knowledge ingestion must preserve document structure and provenance; Ask HelloTest should use bounded query planning, hybrid retrieval, evidence-sufficiency checks, structured synthesis, and citation verification; specialist agents should share the same authorized retrieval and LLM runtime while enforcing purpose-specific output contracts. The application now implements these controls with truthful deterministic fallbacks when no LLM or compatible embedding endpoint is available.

## Current implementation analysis

- Document processing validates extraction, sanitizes sensitive and instruction-like content, chunks at structural boundaries, records context-quality diagnostics, and now enriches retrieval representations with document title and section identity.
- Ask HelloTest resolves conversational references, accepts reviewed Smart Context, searches live and indexed project evidence, permits up to two model-planned context rounds, stops on saturation or sufficiency, produces structured output, and verifies citations.
- All inspected LLM-backed capabilities resolve integrations through the shared usage-aware selector and use the bounded provider HTTP client. No separate embedding integration is required.
- Specialist agents already define distinct decision questions, priority scopes, deliverable sections, human-review boundaries, and exact-citation validation. This pass adds a shared evidence-sufficiency signal so weak context becomes an explicit evidence gap.

## Material limitations

- Evidence-sufficiency is a retrieval diagnostic, not a correctness probability; thresholds require calibration on reviewed HelloTest questions.
- Document-title and section enrichment is a low-cost hierarchical context technique, not a full recursive-summary or knowledge-graph implementation.
- Images, audio, video, diagrams, and spatially meaningful tables still require trustworthy captions, transcripts, OCR, or a governed multimodal extraction provider.
- Local hash embeddings and keyword retrieval are availability fallbacks, not semantic equivalents to provider embeddings.

## Recommendation

Before further architectural expansion, create a versioned evaluation corpus covering project overview, traceability, failure analysis, configuration, release readiness, and multi-turn follow-ups. Gate releases on retrieval recall, answer completeness, sentence-level citation support, cross-project isolation, provider degradation, and latency. Add recursive summaries or graph extraction only if measured failures show that document/section-enriched hybrid retrieval cannot answer the target question class.

Claim ledger:

- Hybrid vector and PostgreSQL full-text search, RRF/cross-encoder fusion, iterative scans, filtering/recall considerations, and HNSW operational guidance — “pgvector README,” pgvector maintainers, accessed 2026-09-05, https://github.com/pgvector/pgvector
- Generative AI lifecycle risk management and evaluation — “Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile,” NIST, published 2024-07-26 and updated 2026-04-08, https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
- RAG does not eliminate direct or indirect prompt-injection risk — “OWASP Top 10 for LLM Applications 2025,” OWASP GenAI Security Project, accessed 2026-09-05, https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf
- Retrieval-grounded generation combines parametric generation with retrieved non-parametric memory — “Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks,” Lewis et al., 2020, https://arxiv.org/abs/2005.11401
- Adaptive retrieval and model reflection can improve factuality and citation behavior — “Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection,” Asai et al., ICLR 2024, https://arxiv.org/abs/2310.11511
- Retrieval quality can govern corrective retrieval behavior — “Corrective Retrieval Augmented Generation,” Yan et al., 2024, https://arxiv.org/abs/2401.15884
- RAG evaluation should separately measure faithfulness, answer relevance, and context relevance — “RAGAS: Automated Evaluation of Retrieval Augmented Generation,” Es et al., EACL 2024, https://arxiv.org/abs/2309.15217
- Long documents benefit from retrieval representations that preserve multiple levels of abstraction — “RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval,” Sarthi et al., ICLR 2024, https://arxiv.org/abs/2401.18059
- Longer context does not guarantee that the model uses centrally positioned evidence reliably — “Lost in the Middle: How Language Models Use Long Contexts,” Liu et al., TACL 2024, https://arxiv.org/abs/2307.03172
- Long-form generated outputs should be evaluated for completeness, accuracy, and claim-to-source verifiability — “On the Evaluation of Machine-Generated Reports,” NIST / Mayfield et al., SIGIR 2024, https://www.nist.gov/publications/evaluation-machine-generated-reports

Repository evidence inspected: knowledge processing, source lifecycle, RAG, context orchestration, knowledge assistant, agentic assistant, LLM selection, shared provider HTTP client, database bootstrap, frontend assistant and context studio, and their contract tests.

Research stopped after the architecture’s consequential external claims had first-party support and repository inspection showed that broad replacement was unwarranted. The implementation focused on the remaining verified usability and observability gaps.

## Automation authoring and Object Spy UX addendum

Audience: HelloTest automation authors, QA engineers, and product engineering  
Date: 2026-09-05

Scope: restructuring the Automation case workspace, making steps readable as business behavior while retaining executable platform commands, adding dedicated API authoring, and improving Object Spy capture and locator validation. The implementation keeps the existing runtime and repository model rather than introducing a parallel automation format.

### Executive answer

Automation authoring works best as progressive disclosure: case metadata, behavior steps, test data, hooks, build tools, repository objects, and execution history are distinct top-level tasks. A behavior step should remain readable in Gherkin terms while its executable action, target object, and data binding are edited alongside it. Web and mobile commands should prefer repository-backed, user-facing locators; API steps need a request-specific editor rather than being forced through a browser-action form. Inspection should emphasize the currently targeted element briefly and unobtrusively, then validate locator uniqueness before capture.

### Implementation decisions

- The Automation detail workspace now uses the same top-tab interaction as manual cases: Details, Steps, Test Data, Before / After, Build, Objects, and Runs.
- Steps separate the colored Gherkin keyword and business description from the platform command. Web, API, Android, and iOS expose focused action catalogs; browser/mobile steps bind repository objects and data tokens, while API steps expose method, URL, headers, body mode, body, and expected status.
- Drag is supported end to end by the authoring catalog and both Playwright and Selenium web runtimes. iOS-authored steps retain iOS target identity while dispatching through the existing shared Appium mobile worker.
- Object Spy now provides a compact selected-element editor, primary-locator choice, explicit live uniqueness validation, and a one-second thin rectangular highlight. Pointer movement is deduplicated and capture scrolling occurs only when the target is off screen, reducing visual flicker.

### Material limitations

- Action availability remains bounded by the existing HelloTest runtime contract; adding a catalog entry alone cannot guarantee every native-driver capability.
- Locator validation is live-session validation. Dynamic pages may still require stable test IDs or accessible roles supplied by the application team.
- A one-second highlight reduces distraction but does not eliminate redraws caused by the inspected application itself.

Claim ledger:

- Gherkin’s `Feature`, `Background`, scenario, step, and examples structure is intended to document executable behavior in a business-readable form — “Gherkin Reference,” Cucumber, accessed 2026-09-05, https://cucumber.io/docs/gherkin/reference/
- Playwright recommends user-facing locators and explicit test IDs over brittle CSS/XPath chains, and its generator prioritizes role, text, and test-id locators — “Locators” and “Test generator,” Playwright, accessed 2026-09-05, https://playwright.dev/docs/locators and https://playwright.dev/docs/codegen
- Browser automation supports distinct interaction classes including fill, click, drag, keyboard, file, and focus operations — “Actions,” Playwright, accessed 2026-09-05, https://playwright.dev/docs/next/input
- API automation benefits from a dedicated request context with method, headers, body/data, and response assertions — “API testing,” Playwright, accessed 2026-09-05, https://playwright.dev/docs/api-testing
- Appium’s official inspection ecosystem includes screenshots, hierarchy/source, element search, commands, recording, and locator-building tools — “Official Appium-related tools,” Appium, accessed 2026-09-05, https://appium.io/docs/en/3.0/ecosystem/tools/
- Page objects reduce selector duplication by keeping element locators and interaction services behind a reusable application-facing abstraction — “Page object models,” Selenium, accessed 2026-09-05, https://www.selenium.dev/documentation/test_practices/encouraged/page_object_models/

Repository evidence inspected: Automation case authoring, shared detail tabs, execution-context data binding, API request contracts, Object Repository capture and validation, recorder overlays, and Playwright/Selenium execution bindings. Research stopped when the consequential interaction and runtime decisions were supported by first-party documentation and the implementation preserved the existing application contracts.
