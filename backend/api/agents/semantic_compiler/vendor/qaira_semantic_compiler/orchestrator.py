from __future__ import annotations
from pathlib import Path
import argparse, yaml, shutil, json, os

from qaira_semantic_compiler.core.context import RunContext
from qaira_semantic_compiler.core.logger import Logger
from qaira_semantic_compiler.core.runner import AgentRunner

# Existing API semantic compiler agents. Keep API first and untouched as the base capability.
from qaira_semantic_compiler.agents.source_repo_clone_agent import SourceRepoCloneAgent
from qaira_semantic_compiler.agents.repository_index_agent import RepositoryIndexAgent
from qaira_semantic_compiler.agents.source_detection_agent import SourceDetectionAgent
from qaira_semantic_compiler.agents.route_discovery_agent import RouteDiscoveryAgent
from qaira_semantic_compiler.agents.body_discovery_agent import BodyDiscoveryAgent
from qaira_semantic_compiler.agents.params_discovery_agent import ParamsDiscoveryAgent
from qaira_semantic_compiler.agents.param_type_discovery_agent import ParamTypeDiscoveryAgent
from qaira_semantic_compiler.agents.validation_schema_agent import ValidationSchemaAgent
from qaira_semantic_compiler.agents.import_graph_agent import ImportGraphAgent
from qaira_semantic_compiler.agents.service_graph_agent import ServiceGraphAgent
from qaira_semantic_compiler.agents.service_body_field_agent import ServiceBodyFieldAgent
from qaira_semantic_compiler.agents.db_write_field_agent import DbWriteFieldAgent
from qaira_semantic_compiler.agents.service_body_propagation_agent import ServiceBodyPropagationAgent
from qaira_semantic_compiler.agents.inferred_schema_registry_agent import InferredSchemaRegistryAgent
from qaira_semantic_compiler.agents.schema_attachment_agent import SchemaAttachmentAgent
from qaira_semantic_compiler.agents.required_field_confidence_agent import RequiredFieldConfidenceAgent
from qaira_semantic_compiler.agents.response_discovery_agent import ResponseDiscoveryAgent
from qaira_semantic_compiler.agents.contract_builder_agent import ContractBuilderAgent
from qaira_semantic_compiler.agents.relationship_agent import RelationshipAgent
from qaira_semantic_compiler.agents.test_generation_agent import TestGenerationAgent
from qaira_semantic_compiler.agents.quality_gate_agent import QualityGateAgent
from qaira_semantic_compiler.agents.llm_gateway_agent import LLMGatewayAgent
from qaira_semantic_compiler.agents.artifact_manifest_agent import ArtifactManifestAgent
from qaira_semantic_compiler.agents.api_documentation_agent import ApiDocumentationAgent
from qaira_semantic_compiler.agents.self_healing_code_delta_agent import SelfHealingCodeDeltaAgent
from qaira_semantic_compiler.agents.patch_library_agent import PatchLibraryAgent
from qaira_semantic_compiler.agents.patch_effectiveness_agent import PatchEffectivenessAgent
from qaira_semantic_compiler.agents.self_healing_llm_advisor_agent import SelfHealingLLMAdvisorAgent
from qaira_semantic_compiler.agents.agent_performance_evaluator_agent import AgentPerformanceEvaluatorAgent
from qaira_semantic_compiler.agents.results_analyzer_agent import ResultsAnalyzerAgent
from qaira_semantic_compiler.agents.final_run_report_agent import FinalRunReportAgent
from qaira_semantic_compiler.agents.meta import SemanticPrerequisiteAgent, FrameworkPatternIntelligenceAgent, PromptChainSynthesisAgent, AgentOutcomeReviewAgent, CriticalPathReviewAgent, SelfLearningMemoryAgent, PipelineRobustnessGateAgent

# New QRIP/QSG WebUI intelligence agents.
from qaira_semantic_compiler.agents.webui import (
    QsgBuildAgent, FactNormalizationAgent, QsgValidationAgent, QsgDiffAgent, QueryExportAgent,
    LocatorAgent, AccessibilityAgent, TestabilityAgent, FormIntelligenceAgent,
    MockStateAgent, BackendBridgeAgent, PlaywrightSpecAgent, ImpactAnalysisAgent,
    RiskAgent, RuntimeOverlayAgent, PatchRecommendationAgent, WebUiArtifactPackagingAgent,
)

# Component test generation agents. These consume API/WebUI graph artifacts and generate Component Test Contracts first.
from qaira_semantic_compiler.agents.component import (
    ComponentDiscoveryAgent, PageComponentMappingAgent, ComponentApiMappingAgent,
    ComponentElementDiscoveryAgent, ComponentLocatorRankingAgent, ComponentStateDiscoveryAgent,
    ComponentEventDiscoveryAgent, ComponentValidationDiscoveryAgent, ComponentAssertionMiningAgent,
    ComponentFixtureMockDataAgent, ComponentTestContractAgent, ComponentPlaywrightGenerationAgent,
    ComponentExecutionPlanAgent, ComponentAutoRepairAgent, ComponentSemanticQualityGateAgent, ComponentArtifactPackagingAgent,
)

def deep_merge(base, override):
    if not isinstance(base, dict):
        return override
    if not isinstance(override, dict):
        return override if override is not None else base
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out

def package_config_path() -> Path:
    # /app/src/qaira_semantic_compiler/orchestrator.py -> /app/config/config.yml in Docker/source tree.
    return Path(__file__).resolve().parents[2] / "config" / "config.yml"

def load_config(path=None):
    default_path = package_config_path()
    cfg = {}
    if default_path.exists():
        cfg = yaml.safe_load(default_path.read_text(encoding="utf-8")) or {}
    p = Path(path or os.environ.get("QAIRA_CONFIG", "")) if (path or os.environ.get("QAIRA_CONFIG")) else None
    if p and p.exists() and p.is_file():
        override = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        cfg = deep_merge(cfg, override)
        cfg.setdefault("config_resolution", {})["custom_config_loaded"] = str(p)
    elif p:
        cfg.setdefault("config_resolution", {})["custom_config_missing_using_default"] = str(p)
    cfg.setdefault("config_resolution", {})["default_config"] = str(default_path)
    # Backward compatibility: repo checkout old section.
    repo_old = cfg.get("repository_input") or {}
    if repo_old:
        cfg.setdefault("source", {}).setdefault("checkout", {})
        cfg["source"]["checkout"].setdefault("enabled", bool(repo_old.get("enabled", False)))
        cfg["source"]["checkout"].setdefault("repo_url", repo_old.get("repo_url", ""))
    cfg = apply_env_overrides(cfg)
    return cfg


def env_bool(name: str, default=None):
    val = os.environ.get(name)
    if val is None or str(val).strip() == "":
        return default
    return str(val).strip().lower() in {"1", "true", "yes", "y", "on"}

def env_str(name: str, default=None):
    val = os.environ.get(name)
    if val is None or str(val).strip() == "":
        return default
    return str(val).strip()

def apply_env_overrides(cfg: dict) -> dict:
    """Keep the config file clean while allowing Docker/VS Code/CI users to pass runtime knobs externally.

    Supported environment variables:
      QAIRA_TEST_TYPE=api|webui|both|auto
      QAIRA_ENABLE_LLM=true|false|auto
      OPENAI_API_KEY=<secret>
      QAIRA_LLM_MODEL=<model>
      QAIRA_GIT_ENABLED=true|false
      QAIRA_GIT_REPO_URL=<url>
      QAIRA_GIT_BRANCH=<branch>
      QAIRA_GIT_USERNAME=<username>
      QAIRA_GIT_TOKEN=<secret>
      QAIRA_AGENT_TIMEOUT_SECONDS=<seconds>
      QAIRA_AGENT_RETRIES=<n>
      QAIRA_FAIL_OPEN=true|false
      QAIRA_WEBUI_OUTPUT_MODE=nested|flat|both
      QAIRA_COMPONENT_EXECUTE=true|false
      QAIRA_COMPONENT_BASE_URL=http://localhost:8080
    """
    cfg = cfg or {}
    if env_str("QAIRA_TEST_TYPE"):
        cfg.setdefault("execution", {})["test_type"] = env_str("QAIRA_TEST_TYPE")
    if env_str("QAIRA_ENABLE_LLM"):
        cfg.setdefault("llm", {})["enabled"] = env_str("QAIRA_ENABLE_LLM")
    if env_str("QAIRA_LLM_MODEL"):
        cfg.setdefault("llm", {})["model"] = env_str("QAIRA_LLM_MODEL")
    # OPENAI_API_KEY is intentionally not copied into config. Only presence is recorded.
    llm = cfg.setdefault("llm", {})
    llm.setdefault("api_key_env", "OPENAI_API_KEY")
    llm["api_key_present"] = bool(os.environ.get(llm.get("api_key_env", "OPENAI_API_KEY")) or os.environ.get("OPENAI_API_KEY"))

    if env_str("QAIRA_AGENT_TIMEOUT_SECONDS"):
        cfg.setdefault("runtime", {})["agent_timeout_seconds"] = int(env_str("QAIRA_AGENT_TIMEOUT_SECONDS"))
    if env_str("QAIRA_AGENT_RETRIES"):
        cfg.setdefault("runtime", {})["retries"] = int(env_str("QAIRA_AGENT_RETRIES"))
    if env_str("QAIRA_FAIL_OPEN"):
        cfg.setdefault("runtime", {})["fail_open"] = env_bool("QAIRA_FAIL_OPEN", True)

    if env_str("QAIRA_WEBUI_OUTPUT_MODE"):
        cfg.setdefault("webui", {})["output_mode"] = env_str("QAIRA_WEBUI_OUTPUT_MODE")
    if env_str("QAIRA_COMPONENT_EXECUTE"):
        cfg.setdefault("component", {})["execute"] = env_bool("QAIRA_COMPONENT_EXECUTE", False)
    if env_str("QAIRA_COMPONENT_BASE_URL"):
        cfg.setdefault("component", {})["base_url"] = env_str("QAIRA_COMPONENT_BASE_URL")
    if env_str("QAIRA_MATURE_GUARDS"):
        cfg.setdefault("runtime", {})["mature_guards"] = env_bool("QAIRA_MATURE_GUARDS", True)
    if env_str("QAIRA_ALLOW_MISSING_CRITICAL_ARTIFACTS"):
        cfg.setdefault("runtime", {})["allow_missing_critical_artifacts"] = env_bool("QAIRA_ALLOW_MISSING_CRITICAL_ARTIFACTS", False)
    if env_str("QAIRA_LLM_EXECUTE_NETWORK_CALLS"):
        cfg.setdefault("llm", {})["execute_network_calls"] = env_bool("QAIRA_LLM_EXECUTE_NETWORK_CALLS", False)
    if env_str("QAIRA_LLM_CALLS_PER_RUN"):
        cfg.setdefault("llm", {})["calls_per_run"] = int(env_str("QAIRA_LLM_CALLS_PER_RUN"))

    git_enabled = env_bool("QAIRA_GIT_ENABLED", None)
    if git_enabled is not None:
        cfg.setdefault("agents", {}).setdefault("git", {})["enabled"] = git_enabled
        cfg.setdefault("agents", {}).setdefault("git", {})["checkout"] = git_enabled
        cfg.setdefault("source", {}).setdefault("checkout", {})["enabled"] = git_enabled
    if env_str("QAIRA_GIT_REPO_URL"):
        cfg.setdefault("source", {}).setdefault("checkout", {})["repo_url"] = env_str("QAIRA_GIT_REPO_URL")
        cfg.setdefault("source", {}).setdefault("checkout", {})["enabled"] = True
        cfg.setdefault("agents", {}).setdefault("git", {})["enabled"] = True
        cfg.setdefault("agents", {}).setdefault("git", {})["checkout"] = True
    if env_str("QAIRA_GIT_BRANCH"):
        cfg.setdefault("source", {}).setdefault("checkout", {})["branch"] = env_str("QAIRA_GIT_BRANCH")
    if env_str("QAIRA_GIT_TOKEN"):
        cfg.setdefault("source", {}).setdefault("checkout", {})["token_env"] = "QAIRA_GIT_TOKEN"
    if env_str("QAIRA_GIT_USERNAME"):
        cfg.setdefault("source", {}).setdefault("checkout", {})["username_env"] = "QAIRA_GIT_USERNAME"
    return cfg

class Orchestrator:
    def __init__(self, source, output, learning, config):
        self.ctx = RunContext(Path(source), Path(output), Path(learning), config or {})
        self.ctx.output.mkdir(parents=True, exist_ok=True)
        self.ctx.learning.mkdir(parents=True, exist_ok=True)
        self.logger = Logger(self.ctx.output, console=self.ctx.config.get("logging", {}).get("console", True))
        self.runner = AgentRunner(self.ctx, self.logger)

    def api_agents(self):
        return [
            SourceRepoCloneAgent,
            RepositoryIndexAgent,
            SourceDetectionAgent,
            RouteDiscoveryAgent,
            BodyDiscoveryAgent,
            ParamsDiscoveryAgent,
            ParamTypeDiscoveryAgent,
            ValidationSchemaAgent,
            ImportGraphAgent,
            ServiceGraphAgent,
            ServiceBodyFieldAgent,
            DbWriteFieldAgent,
            ServiceBodyPropagationAgent,
            InferredSchemaRegistryAgent,
            SchemaAttachmentAgent,
            RequiredFieldConfidenceAgent,
            ResponseDiscoveryAgent,
            ContractBuilderAgent,
            RelationshipAgent,
            TestGenerationAgent,
            QualityGateAgent,
            AgentPerformanceEvaluatorAgent,
            SelfHealingLLMAdvisorAgent,
            SelfHealingCodeDeltaAgent,
            PatchLibraryAgent,
            PatchEffectivenessAgent,
            ApiDocumentationAgent,
            LLMGatewayAgent,
            ArtifactManifestAgent,
            ResultsAnalyzerAgent,
        ]

    def webui_agents(self):
        wcfg = ((self.ctx.config.get("agents") or {}).get("webui") or {})
        ordered = [
            ("qsg_build", QsgBuildAgent),
            ("fact_normalization", FactNormalizationAgent),
            ("qsg_validation", QsgValidationAgent),
            ("qsg_diff", QsgDiffAgent),
            ("query_export", QueryExportAgent),
            ("locator", LocatorAgent),
            ("accessibility", AccessibilityAgent),
            ("testability", TestabilityAgent),
            ("form_intelligence", FormIntelligenceAgent),
            ("mock_state", MockStateAgent),
            ("backend_bridge", BackendBridgeAgent),
            ("playwright_spec", PlaywrightSpecAgent),
            ("impact_analysis", ImpactAnalysisAgent),
            ("risk", RiskAgent),
            ("runtime_overlay", RuntimeOverlayAgent),
            ("patch_recommendation", PatchRecommendationAgent),
            ("artifact_packaging", WebUiArtifactPackagingAgent),
        ]
        return [cls for key, cls in ordered if bool(wcfg.get(key, True))]

    def component_agents(self):
        ccfg = ((self.ctx.config.get("agents") or {}).get("component") or {})
        ordered = [
            ("component_discovery", ComponentDiscoveryAgent),
            ("page_component_mapping", PageComponentMappingAgent),
            ("component_api_mapping", ComponentApiMappingAgent),
            ("component_element_discovery", ComponentElementDiscoveryAgent),
            ("locator_ranking", ComponentLocatorRankingAgent),
            ("state_discovery", ComponentStateDiscoveryAgent),
            ("event_discovery", ComponentEventDiscoveryAgent),
            ("validation_discovery", ComponentValidationDiscoveryAgent),
            ("assertion_mining", ComponentAssertionMiningAgent),
            ("fixture_mock_data", ComponentFixtureMockDataAgent),
            ("test_contract", ComponentTestContractAgent),
            ("playwright_generation", ComponentPlaywrightGenerationAgent),
            ("execution_plan", ComponentExecutionPlanAgent),
            ("auto_repair", ComponentAutoRepairAgent),
            ("semantic_quality_gate", ComponentSemanticQualityGateAgent),
            ("artifact_packaging", ComponentArtifactPackagingAgent),
        ]
        return [cls for key, cls in ordered if bool(ccfg.get(key, True))]

    def detect_test_type(self) -> str:
        configured = str(((self.ctx.config.get("execution") or {}).get("test_type") or "auto")).lower()
        if configured in ["api", "webui", "component", "both", "all"]:
            return configured
        has_ui = False; has_api = False
        for p in self.ctx.source.rglob("*"):
            if not p.is_file(): continue
            s = p.suffix.lower()
            rel = str(p.relative_to(self.ctx.source)) if p.is_relative_to(self.ctx.source) else str(p)
            if any(x in rel for x in ["node_modules/", ".git/", "dist/", "build/", ".next/"]): continue
            if s in [".tsx", ".jsx", ".html", ".vue", ".svelte"]: has_ui = True
            if s in [".ts", ".js", ".tsx", ".jsx", ".json", ".yaml", ".yml"]:
                try: text = p.read_text(encoding="utf-8", errors="ignore")[:20000]
                except Exception: text = ""
                if any(x in text for x in ["router.get", "router.post", "app.get", "app.post", "fastify", "openapi", "export async function GET", "export function POST"]): has_api = True
            if has_api and has_ui: return "all"
        if has_api: return "api"
        if has_ui: return "webui"
        return "api"

    def run_agent_classes(self, classes, phase):
        self.logger.log("PHASE", "Orchestrator", f"{phase} started", count=len(classes))
        self.ctx.append_jsonl("runtime/phase_progress.jsonl", {"phase": phase, "event": "started", "count": len(classes)})
        for index, cls in enumerate(classes, start=1):
            self.ctx.append_jsonl("runtime/phase_progress.jsonl", {"phase": phase, "event": "agent_started", "index": index, "total": len(classes), "agent": cls.__name__})
            result = self.runner.run(cls(self.ctx, self.logger))
            self.ctx.append_jsonl("runtime/phase_progress.jsonl", {"phase": phase, "event": "agent_completed", "index": index, "total": len(classes), "agent": cls.__name__, "status": result.status, "confidence": result.confidence, "metrics": result.metrics, "outputs": result.outputs})
        self.ctx.append_jsonl("runtime/phase_progress.jsonl", {"phase": phase, "event": "completed", "count": len(classes)})
        self.logger.log("PHASE", "Orchestrator", f"{phase} completed")

    def run(self):
        self.logger.log("START", "Orchestrator", "QAira Repository Intelligence Platform started")
        self.runner.run(SemanticPrerequisiteAgent(self.ctx, self.logger))
        self.runner.run(FrameworkPatternIntelligenceAgent(self.ctx, self.logger))
        self.runner.run(PromptChainSynthesisAgent(self.ctx, self.logger))
        self.ctx.write_json("config/effective_config.json", self.ctx.config)
        test_type = self.detect_test_type()
        self.ctx.state["testType"] = test_type
        self.ctx.write_json("runtime/execution_plan.json", {
            "requestedTestType": ((self.ctx.config.get("execution") or {}).get("test_type") or "auto"),
            "resolvedTestType": test_type,
            "apiFirst": test_type in ["api", "both", "all"],
            "webui": test_type in ["webui", "both", "all"],
            "component": test_type in ["component", "all"],
            "llmKeyPresent": bool((self.ctx.config.get("llm") or {}).get("api_key_present")),
            "source": str(self.ctx.source),
            "output": str(self.ctx.output),
        })

        if test_type in ["api", "both", "all"] and bool(((self.ctx.config.get("agents") or {}).get("api") or {}).get("enabled", True)):
            self.run_agent_classes(self.api_agents(), "api-test-generation")
        else:
            self.logger.log("SKIP", "Orchestrator", "API agents skipped by test_type/config")

        if test_type in ["webui", "both", "all"] and bool(((self.ctx.config.get("agents") or {}).get("webui") or {}).get("enabled", True)):
            self.run_agent_classes(self.webui_agents(), "webui-qsg-locator-generation")
        else:
            self.logger.log("SKIP", "Orchestrator", "WebUI/QSG agents skipped by test_type/config")

        if test_type in ["component", "all"] and bool(((self.ctx.config.get("agents") or {}).get("component") or {}).get("enabled", True)):
            self.run_agent_classes(self.component_agents(), "component-test-generation")
        else:
            self.logger.log("SKIP", "Orchestrator", "Component agents skipped by test_type/config")

        self.runner.run(AgentOutcomeReviewAgent(self.ctx, self.logger))
        self.runner.run(CriticalPathReviewAgent(self.ctx, self.logger))
        self.runner.run(PipelineRobustnessGateAgent(self.ctx, self.logger))
        self.runner.run(SelfLearningMemoryAgent(self.ctx, self.logger))
        self.runner.run(ArtifactManifestAgent(self.ctx, self.logger))
        self.runner.run(FinalRunReportAgent(self.ctx, self.logger))
        self.ctx.write_json("runtime/orchestrator_report.json", {"status":"completed", "testType": test_type, "agents":[r.to_dict() for r in self.ctx.results], "artifactManifest":"runtime/artifact_manifest.json", "progress":"runtime/agent_progress.jsonl"})
        self.logger.log("DONE", "Orchestrator", "completed", testType=test_type, agents=len(self.ctx.results))
        return 0

def main():
    ap = argparse.ArgumentParser(description="QAira Repository Intelligence Platform semantic compiler")
    ap.add_argument("--source", default=os.environ.get("QAIRA_SOURCE", "/workspace/source"))
    ap.add_argument("--output", default=os.environ.get("QAIRA_OUTPUT", "/output"))
    ap.add_argument("--learning", default=os.environ.get("QAIRA_LEARNING", "/learning"))
    ap.add_argument("--config", default=os.environ.get("QAIRA_CONFIG", ""))
    a = ap.parse_args()
    return Orchestrator(a.source, a.output, a.learning, load_config(a.config)).run()

if __name__ == "__main__":
    raise SystemExit(main())
