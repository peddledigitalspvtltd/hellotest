# AI workspace design QA

## QA status

- Source visual truth: `/Users/jayarajumetta/Downloads/stitch_the_executive_editor_prd/screen.png` (2560 × 1744), showing a compact three-column AI authoring workspace with Context, a large editable canvas, and Generation Flow.
- Implementation screenshot: unavailable. The configured in-app browser reports `Browser is not available: iab`; local Playwright capture is awaiting explicit user permission.
- Intended comparison viewports: desktop 1440 × 1000, tablet 1024 × 768, and mobile 390 × 844 CSS pixels.
- Required combined source-and-implementation comparison: not yet possible because a browser-rendered implementation capture is unavailable. The source image itself has been opened and inspected at original resolution.

## Implemented source-level corrections

- Story creation, Story completion, Test creation, and Test improvement now share a compact Context / editable Draft / Generation Flow workbench.
- Context inputs use accessible Text, Files, Links, and Images tabs, with inactive panels retained so selections are not lost.
- Provider, count, and feature setup are grouped into disclosures; optional source types render one at a time.
- Draft queues are closed by default and open as an overlay instead of permanently consuming a fourth column.
- Duplicate Generate/Regenerate actions were removed; acceptance controls appear only after a reviewable proposal exists.
- Existing Test coverage, Story properties, Gherkin, review notes, Bug evidence, and Bug reasoning are collapsed until requested.
- AI triage uses Findings, Actions, and Run details tabs and a single-column review list.
- User-facing generation flow is reduced from seven persistent technical stages to Brief, Context, Generate, and Review, with the detailed trace available on demand.
- AI Bug authoring and AI triage use the same compact run-and-review rail and explicit human gate.
- Story creation and Complete Story now use feature-specific Story brief / Grounding / Compose-or-Complete / Review phases. Creation is a genuinely persisted queued-to-running job, while completed processing keeps Review current until a person accepts or discards the proposal.
- Story creation retrieves a bounded, relevance-ranked project-knowledge set with stable source references; Story creation and completion discard unsupported model fields, expose request fingerprints, and show per-field grounding only inside the evidence flyout.
- AI Bug creation uses feature-specific Incident brief / Evidence / Draft Bug / Create phases, configured `ai.bug.draft` guidance, bounded run/Test Case/Story/result context, field-level evidence, explicit gaps, and disclosed record and text omissions.
- AI Bug triage uses Bug set / Signals / Recommend / Apply phases. A configured `ai.bug.triage` model may refine only cited category explanations; issue membership, priority, readiness, and review actions remain deterministic and human-owned.
- AI Smart Run now retrieves bounded Stories, Bugs, execution results, Test Cases, modules, and mappings; case membership and risk ranking are deterministic, while a configured model can only refine a citation-valid explanation.
- Smart Run acceptance uses a signed, reviewer-bound preview proof. The selected cases must be a subset of the reviewed proposal, `run.ai` is rechecked at creation, and the accepted review snapshot is persisted in workspace transaction metadata linked to the created execution.
- All target evidence details now open in one shared fixed side sheet with Escape/outside close, focus containment and return, keyboard-scrollable content, mobile full-width behavior, dark-theme tokens, and reduced-motion fallback. Inline evidence expansion was removed from process stages, activity events, Story fields, Bug findings, triage provenance, and Smart Run cases.
- Tablet and mobile breakpoints move the four-phase flow below the workbench before the context and draft panes become unusably narrow.
- Unsupported Chat/Agent choices are hidden from focused artifact studios; provider selection remains in the settings rail instead of being duplicated in the composer.
- Inert Drafts/Review/Templates navigation is hidden where a flow does not implement those views.
- Nested `main` landmarks were replaced with labelled regions.
- Read-only triage uses `Acknowledge review`, including valid empty-result reviews, and states that no Bug field changed.
- Numeric or citation-count-derived confidence language was replaced with neutral review/evidence wording.
- Compact run-brief and generation-rail text was increased for laptop and zoom readability.
- External links are disclosed as pointer-only context; supported PNG/JPEG/WebP data images reach multimodal providers, while fallbacks and unsupported analysis are disclosed.
- AI Grooming now uses six focused tabs—Story, Business, Solution, Validation, Remaining, and Evidence—with roving keyboard navigation and inactive panels retained in the DOM.
- Story combines the plain-language purpose, why the feature is needed, actors, trigger, ordered journey, alternate paths, and a collapsed categorical planning-readiness review.
- Business separates affected stakeholders, value outcomes, and measurable success while suppressing duplicated Story content and unsupported filler.
- Solution visibly separates evidenced behavior, rules, dependencies, constraints, and scope from evidenced implementation components, data, integrations, and quality requirements.
- Validation groups acceptance criteria, test and edge scenarios, and linked Test Case coverage; Remaining prioritizes definition, delivery, and validation gaps, questions, decisions, actions, and observed risks.
- The Grooming backend preserves the legacy response while adding a seven-part walkthrough, nine evidence-checked readiness checks, source-type allow-lists, strict bounded normalization, exact source-omission counts, and a conservative evidence-only fallback.
- Common `As a … I want … so that …` syntax is separated into actor, intended behavior, and outcome without inventing journey steps; only explicitly headed bounded comment content can enrich deterministic fallback sections.
- Grooming results retain the last successful brief if a refresh fails, and mark it stale after local Story, comment, attachment, Test Case-link, or Bug-link changes; attachment metadata remains distinct from unread attachment bodies and external-link contents.
- Grooming processing now uses the configured usage-key model and saved prompt guidance with strict JSON, citation allow-listing, bounded arrays, and a conservative evidence-only fallback when model output is unavailable or invalid.
- Provider output is classified as AI-assisted, hybrid, or evidence-only. Hybrid responses expose exactly which sections were replaced by conservative fallback content, while readiness rows keep their own source references.
- Evidence rows use human-readable Story, Test Case, and Bug identifiers and are grouped into keyboard-scrollable Story evidence, linked work, and pointer/metadata disclosures instead of one unbounded visual list.
- The compact layout now queries a dedicated wrapper so initial, loading, and generated states reflow correctly; dark-theme accent text uses a contrast-safe blue.
- Saved Grooming guidance has a visible 4,000-character limit aligned with the API contract, while evidence and safety rules remain immutable.

## Automated verification

- Frontend source and interaction contracts: 45/45 passing.
- Frontend TypeScript project check: passing.
- Frontend production Vite build: passing; generated bundle files were removed afterward so the tracked build output was not changed.
- Backend service, route, evidence, acceptance, and processing contracts: 66/66 passing.
- Target backend JavaScript syntax checks: passing.
- `git diff --check`: passing.
- Local implementation URL responds successfully at `http://127.0.0.1:5173/`; browser-rendered screenshot capture remains unavailable.

## Required visual comparison pass

1. Capture Story creation in initial, generating, proposal-ready, context-collapsed, and Review states at 1440 × 1000.
2. Capture Story completion, Test creation, Test improvement, AI Bug authoring, and AI triage at the same density.
3. Capture tablet and mobile stacking behavior, keyboard focus, and 200% zoom readability.
4. Capture AI Grooming in initial, generating, ready, needs-alignment, not-ready, stale, and each focused tab state.
5. Put the conversation reference and each implementation screenshot into the same comparison input.
6. Check typography, spacing, pane proportions, sticky actions, overflow, focus visibility, dark theme, and all primary interactions; fix and recapture any P0/P1/P2 mismatch.

## Open blocker

Explicit permission is required to use local Playwright because the preferred in-app browser is unavailable. Until browser capture and combined-image comparison are completed, visual QA cannot be marked passed.

final result: blocked
