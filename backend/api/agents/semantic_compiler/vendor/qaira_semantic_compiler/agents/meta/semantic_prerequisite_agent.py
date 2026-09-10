from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.core.agent_contracts import RobustAgentMixin, AgentCapability
class SemanticPrerequisiteAgent(RobustAgentMixin):
    name="SemanticPrerequisiteAgent"
    capability=AgentCapability(writes=["runtime/semantic_prerequisites.json"], critical=True, phase="preflight")
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        dirs=["src","frontend","backend","apps","packages"]
        present=[d for d in dirs if (self.ctx.source/d).exists()]
        report={"source":str(self.ctx.source),"presentRoots":present,"hasPackageJson":(self.ctx.source/'package.json').exists(),"hasPyproject":(self.ctx.source/'pyproject.toml').exists(),"llmKeyPresent":self.ctx.has_openai_key(),"mode":"fail-open-with-evidence"}
        self.ctx.write_json('runtime/semantic_prerequisites.json',report)
        return AgentResult(self.name,"success",0.95,{"presentRoots":len(present)}, {"prerequisites":"runtime/semantic_prerequisites.json"})
