# HelloTest agent experience: market research and product direction

## Executive decision

HelloTest should not present AI as a collection of unrelated generation buttons. The product now uses one shared interaction contract across Story design, Test Case design, automation, Smart Runs, failure analysis, Bug reporting, Bug triage, repository curation, and quality evaluation:

1. The user chooses **Chat** for a focused review or **Agent** for a multi-step delegated task.
2. The user can see and constrain the workspace context.
3. HelloTest names the specialist responsible for the task.
4. The interface exposes an activity trace without exposing private chain-of-thought.
5. Guardrails and the human approval boundary are visible before the output is accepted.
6. The outcome is evaluated for grounding, completeness, traceability, risk control, and overall maturity.
7. The session and its evidence remain inspectable after completion.

This keeps the strongest n8n-style composability already present in HelloTest while adopting the best session and governance patterns from current agent products.

## Primary-source market comparison

| Product pattern | What the market demonstrates | HelloTest product decision |
| --- | --- | --- |
| GitHub Copilot agent sessions | A centralized session surface, explicit modes, model choice, scoped context, live session logs, steering, and durable session history make delegated work legible. | One prompt composer supports Chat and Agent, specialist choice, workspace scope, provider choice, live trace, and recent sessions. |
| Atlassian Rovo agents | Agents are easier to trust when objectives, knowledge sources, permissions, tools, live conversations, and evaluation are explicit. A catalog of specialists makes agent selection concrete. | Ten named QA specialists are first-class actions. Each has an objective, capabilities, bounded context, and a shared evaluation contract. |
| n8n executions and human-in-the-loop | Visual workflows become operationally useful when executions are inspectable, retryable, filtered by status, and risky tools can require approval. | The existing visual workflow builder remains the composition layer. Agent outcomes can be converted into a governed graph with a guardrail gate, evaluator, and human review output. |
| BrowserStack AI testing | Test generation, test data, selection, failure analysis, low-code authoring, and design-source context work best as distinct capabilities connected to testing evidence. | Story, Test Case, automation, run planning, and failure agents stay specialized but share one Workbench and trace model. |
| Katalon self-healing | Recovery suggestions are credible when broken and proposed locators, the recovery method, screenshots, and approve/discard controls remain visible. | Repository curation and automation use approval-ready recommendations, locator evidence, stability signals, and human review instead of silent repair. |
| mabl generative creation and auto-heal | Natural-language intent can accelerate authoring, while semantic healing should depend on prior successful evidence. | HelloTest separates intent from evidence, retrieves bounded history, and lowers maturity when evidence is absent. |
| OpenAI Agents SDK | Production agent systems need input, output, and tool guardrails; traces across generations, tools, handoffs, and guardrails; human intervention; and continuous evaluation. | Every Agent Workbench session records intake, context, guardrails, specialist analysis, outcome, and evaluation as durable events. Private reasoning is not displayed; decision summaries and evidence are. |

## Sources

- GitHub Copilot agent management: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management
- GitHub Copilot agent sessions: https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions
- GitHub Copilot session chronicle: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/chronicle
- GitHub Copilot hooks: https://docs.github.com/en/copilot/concepts/agents/hooks
- Atlassian Rovo agents: https://support.atlassian.com/rovo/docs/agents/
- Atlassian Rovo knowledge sources: https://support.atlassian.com/rovo/docs/knowledge-sources-for-agents/
- Atlassian out-of-box agents: https://support.atlassian.com/rovo/docs/atlassian-agents/
- n8n executions: https://docs.n8n.io/workflows/executions/all-executions/
- n8n human approval for tools: https://github.com/n8n-io/n8n-docs/blob/main/docs/build/integrate-ai/ai-examples/human-in-the-loop-for-tools.md
- BrowserStack AI agents: https://www.browserstack.com/docs/test-management/browserstack-ai
- BrowserStack Smart Test Selection: https://www.browserstack.com/docs/automate/selenium/smart-test-selection
- BrowserStack Test Companion generation: https://www.browserstack.com/docs/test-companion/mobile-testing/generate-test-cases
- Katalon self-healing: https://docs.katalon.com/katalon-studio/maintain-tests/self-healing-tests-in-katalon-studio
- Katalon StudioAssist: https://docs.katalon.com/katalon-studio/studioassist/studioassist-overview
- mabl generative test creation: https://help.mabl.com/hc/en-us/articles/31649455424660-Create-tests-with-generative-AI
- mabl auto-heal: https://help.mabl.com/hc/en-us/articles/19078583792404-How-auto-heal-works
- OpenAI Agents guardrails: https://openai.github.io/openai-agents-js/guides/guardrails/
- OpenAI Agents tracing: https://openai.github.io/openai-agents-js/guides/tracing/
- OpenAI Agents orchestration: https://openai.github.io/openai-agents-js/guides/multi-agent/
- OpenAI Agents human-in-the-loop: https://openai.github.io/openai-agents-js/guides/human-in-the-loop/

## HelloTest specialist catalog

| Specialist | Primary jobs | Evidence focus | Required boundary |
| --- | --- | --- | --- |
| Quality Orchestrator | Plan, coordinate, hand off, evaluate | Cross-artifact release context | Cannot publish specialist recommendations automatically |
| Story Architect | Create, complete, groom | Jira Story fields, acceptance criteria, links, Gherkin | Accepted Story fields remain human-selected |
| Test Design Agent | Generate, improve, trace | Stories, existing tests, steps, data, coverage | Generated cases remain review drafts |
| Automation Engineer | Build, review, repair | Manual cases, groups, steps, repository, recorder | Publishing and low-confidence locator replacement require approval |
| Smart Run Planner | Impact, select, prioritize | Delivery scope, traceability, run history | A person owns final run scope and execution |
| Failure Analyst | Analyze, cluster, explain | Results, logs, media, Bugs, run context | Facts and hypotheses remain separated |
| Bug Reporter | Draft, link, evidence | Run, Test Case, Story, observed evidence | Generates a draft; does not create the Bug |
| Bug Triage Agent | Classify, prioritize, sequence | Bug fields, links, release and execution evidence | A person owns priority and status changes |
| Quality Evaluator | Score, challenge, guard | Provenance, gaps, maturity dimensions | Does not approve its own output |
| Object Repository Curator | Inspect, reuse, heal | DOM, locators, screenshots, stability and learning history | Repository changes remain selected and committed by a person |

## Trace contract

Each persisted agent session contains these phases:

- `intake`: selected mode, specialist, prompt fingerprint, and objective.
- `context`: bounded source counts and citations.
- `guardrails`: project/app scope, untrusted-context policy, approved tools, secret redaction, and approval boundary.
- `specialist`: provider/model or deterministic fallback and a concise decision summary.
- `outcome`: recommendation, assumption, and handoff counts.
- `evaluation`: grounding, completeness, traceability, risk control, maturity score, and rationale.

The trace intentionally does not expose hidden chain-of-thought. It shows observable activity, evidence, decisions, tool/policy boundaries, and evaluation—the information a reviewer needs to trust or challenge the result.

## Implemented product architecture

- `agenticAssistant.service.js` runs a read-only, evidence-grounded Chat or Agent session and persists its trace as workspace transaction events.
- `AgenticExperience.tsx` supplies the shared composer, specialist catalog, process rail, activity timeline, maturity outcome, and lifecycle visualization.
- `AgenticWorkflowsPage.tsx` is the central Agent Workbench and retains the existing n8n-compatible workflow builder and immutable run snapshots.
- Story/Test generation, AI insight previews, Bug drafting, automation building, and Run analysis reuse the process rail so state and guardrails are recognizable everywhere.

## Review-first UI contract

The second design pass applies one visible interaction contract to every AI surface:

1. **Compose:** a compact GitHub-style command box exposes Chat or Agent, the named specialist, real context summary, provider selection where supported, and one send action.
2. **Trace:** Intent, Context, Guardrails, Specialist, Output, Evaluation, and Review are clickable stages. Each stage shows an observable decision summary; private model reasoning is never exposed.
3. **Propose:** generated content remains separate from the saved artifact. Current and proposed versions stay comparable wherever both exist.
4. **Edit and select:** Story/Test drafts, recommendations, Bug fields, Smart Run cases, run summaries, locator changes, and inline rephrases can be edited or selected before acceptance.
5. **Accept:** a named acceptance action is required. Discard/reset remains adjacent. Agent output never silently replaces authored content.

This contract now covers Story creation/completion, Test Case generation/improvement, inline content improvement, Smart Run planning, run analysis and failure clustering, Bug drafting and triage, automation mission planning, object-repository suggestions/healing, and the central Agent Workbench.

## Story Creation reference product flow

AI Story Creation is the reference interaction because it has the widest authoring input set and the clearest irreversible boundary. The interface organizes those inputs by product purpose instead of exposing them as a flat configuration form:

| Product question | Story Creation inputs | UI treatment |
| --- | --- | --- |
| What outcome is wanted? | User outcome, persona, business rules, acceptance boundaries, examples, exclusions, risks, and delivery constraints | One primary mission composer. Chat explores; Agent delegates a bounded draft task. Prompt templates update this same mission instead of creating a second prompt field. |
| What may the agent use? | Current Story for completion, project knowledge, safe text files, external links, screenshots, app type, and Jira delivery scope | A collapsible evidence pane plus a compact evidence summary in the run brief. The user can inspect or change context without losing the draft workspace. |
| What should be returned? | Draft count, title, description, acceptance criteria, priority/properties, optional Gherkin, rationale, risks, and open questions | An explicit output contract in the composer, a selectable draft queue, and an editable inspector. |
| Which controls govern the run? | Chat/Agent mode, provider/model, Jira permissions, required fields, untrusted-context handling, and acceptance policy | Controls remain visible near the composer; the seven-stage contract exposes decision summaries without pretending to reveal private reasoning. |
| What can change saved data? | Selected drafts for creation or selected fields for completion | Generated data stays separate. A named acceptance action is the only path into the Story library or existing Story. |

The reference layout uses progressive disclosure: the mission and run brief remain primary; evidence and advanced provider controls can collapse; the draft queue and editable proposal remain visible together. This same information architecture now shapes Test Case generation/improvement, Bug drafting, Smart Runs, run analysis, and automation planning with feature-specific evidence and acceptance language.

## Next product increments

1. Stream persisted events over SSE/WebSocket so backend progress replaces the current optimistic activity animation while the request is running.
2. Add explicit pause, stop, steer, and approval APIs for long-running agent sessions.
3. Let each artifact surface attach the current entity as a structured citation rather than only relying on project/app retrieval.
4. Add benchmark datasets and evaluator calibration for each specialist, including false-grounding and unsupported-action tests.
5. Add execution replay and retry-from-stage for long-running workflow nodes.
