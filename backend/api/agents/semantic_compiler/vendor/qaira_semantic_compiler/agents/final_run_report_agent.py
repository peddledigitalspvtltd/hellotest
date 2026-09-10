from qaira_semantic_compiler.core.context import AgentResult
import json

class FinalRunReportAgent:
    name="FinalRunReportAgent"
    def __init__(self,ctx,logger):
        self.ctx=ctx
        self.logger=logger
    def run(self):
        webui_index=self.ctx.read_json("generated/webui/index.json",{})
        report={
            "status":"completed",
            "testType":self.ctx.state.get("testType"),
            "bestIteration":self.ctx.state.get("bestIteration"),
            "finalSummary":self.ctx.read_json("summary/scan_summary.json",{}),
            "quality":self.ctx.read_json("quality/quality_gate_report.json",{}),
            "analysis":self.ctx.read_json("analysis/results_analysis.json",{}),
            "apiGeneratedTests": self.ctx.read_json("generated/qaira_tests.json", self.ctx.read_json("generated/postman_collection.json", {})),
            "webuiGeneratedTests": self.ctx.read_json("generated/webui_qaira_tests.json", {}),
            "webuiArtifacts": webui_index,
            "qsgSummary": self.ctx.read_json("graph/qsg_summary.json", {}),
            "git":self.ctx.read_json("git/finalization_report.json",{}),
            "traces": {
                "verbose":"verbose/trace.jsonl",
                "agentProgress":"runtime/agent_progress.jsonl",
                "phaseProgress":"runtime/phase_progress.jsonl",
                "agentResults":"runtime/agent_results.jsonl",
                "artifactManifest":"runtime/artifact_manifest.json",
                "webuiGenerationTrace":"generated/webui/webui_generation_trace.json",
                "apiGenerationTrace":"generated/api_test_generation_trace.json"
            },
            "agents":[r.to_dict() for r in self.ctx.results]
        }
        self.ctx.write_json("runtime/final_run_report.json",report)
        return AgentResult(self.name,"success",0.95,{"agents":len(self.ctx.results), "webuiPages": len((webui_index or {}).get("pages", []))}, {"report":"runtime/final_run_report.json"})
