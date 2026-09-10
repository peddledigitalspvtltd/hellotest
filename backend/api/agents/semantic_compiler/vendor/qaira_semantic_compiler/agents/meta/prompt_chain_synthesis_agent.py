from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.core.agent_contracts import RobustAgentMixin, AgentCapability
from qaira_semantic_compiler.core.llm_client import LLMClient

class PromptChainSynthesisAgent(RobustAgentMixin):
    name="PromptChainSynthesisAgent"
    capability=AgentCapability(reads=["runtime/framework_patterns.json","runtime/execution_plan.json"], writes=["prompts/prompt_chain_manifest.json","prompts/api_prompt_chain.json","prompts/webui_prompt_chain.json","prompts/component_prompt_chain.json"], critical=False, phase="prompting")
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        frameworks=self.ctx.read_json("runtime/framework_patterns.json",{}) or self.ctx.state.get("frameworkPatterns",{}) or {}
        plan=self.ctx.read_json("runtime/execution_plan.json",{}) or {}
        chains={
          "api": build_chain("api", frameworks, ["route evidence", "request body evidence", "response evidence", "auth evidence", "contract confidence"]),
          "webui": build_chain("webui", frameworks, ["route/page evidence", "component kind", "locator evidence", "a11y/testability risk", "object repository import safety"]),
          "component": build_chain("component", frameworks, ["component inventory", "page mapping", "API dependency", "state/event/validation", "Playwright maturity"]),
        }
        self.ctx.write_json("prompts/api_prompt_chain.json", chains["api"])
        self.ctx.write_json("prompts/webui_prompt_chain.json", chains["webui"])
        self.ctx.write_json("prompts/component_prompt_chain.json", chains["component"])
        manifest={"executionPlan":plan,"chains":[{"name":k,"steps":len(v["steps"]),"artifact":f"prompts/{k}_prompt_chain.json"} for k,v in chains.items()],"note":"Prompts are deterministic review chains. LLM calls remain fail-open and network-off unless explicitly enabled."}
        self.ctx.write_json("prompts/prompt_chain_manifest.json", manifest)
        try:
            client=LLMClient(self.ctx,self.logger)
            client.review("PromptChainSynthesisAgent", {"manifest":manifest,"frameworks":frameworks}, default={"accepted":True,"score":85,"reason":"prompt_chain_recorded"}, purpose="prompt_chain_review")
        except Exception:
            pass
        return AgentResult(self.name,"success",0.9,{"chains":len(chains)},{"manifest":"prompts/prompt_chain_manifest.json"})

def build_chain(domain, frameworks, evidence_requirements):
    return {
      "domain":domain,
      "system":"You are a QAira deterministic semantic reviewer. Return JSON only. Never invent routes, pages, locators, schemas, or tests without evidence.",
      "steps":[
        {"name":"evidence_compaction","goal":"select only repo-visible facts and generated graph facts","requiredEvidence":evidence_requirements},
        {"name":"gap_detection","goal":"classify unsupported framework, DI, dynamic, or runtime-only gaps","supportGaps":frameworks.get("supportGaps",[])},
        {"name":"deterministic_generation","goal":"generate only assets with evidence-backed confidence and fallback states"},
        {"name":"guardrail_validation","goal":"reject code-expression locators, hidden dynamic routes, missing assertions, and unmocked API dependencies"},
        {"name":"repair_plan","goal":"produce safe next actions: config mapping, data-testid/aria-label, mock, route adapter, or runtime codegen"}
      ],
      "outputSchema":{"accepted":"boolean","score":"number","issues":"array","missingEvidence":"array","suggestedAgentDeltas":"array","retryAdvice":"array"}
    }
