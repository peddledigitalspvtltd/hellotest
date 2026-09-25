from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel
import json

class QueryExportAgent:
    name="QueryExportAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        kernel=GraphKernel(self.ctx.qsg_db_path())
        ui_to_fields=[]; api_to_entities=[]
        for e in kernel.edges("BINDS_FIELD"):
            ui_to_fields.append({"uiElement":e["source_logical_id"],"businessField":e["target_logical_id"],"confidence":e.get("confidence_score")})
        for e in kernel.edges("USES_ENTITY"):
            api_to_entities.append({"apiEndpoint":e["source_logical_id"],"businessEntity":e["target_logical_id"],"confidence":e.get("confidence_score")})
        kernel.close()
        payload={"queries":{"uiToFields":ui_to_fields,"apiToEntities":api_to_entities},"counts":{"uiToFields":len(ui_to_fields),"apiToEntities":len(api_to_entities)}}
        self.ctx.write_json("graph/qsg_query_export.json", payload)
        return AgentResult(self.name,"success",0.85,payload["counts"], {"artifact":"graph/qsg_query_export.json"})
