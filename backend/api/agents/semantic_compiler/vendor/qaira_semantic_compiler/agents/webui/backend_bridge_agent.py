from __future__ import annotations
import json, re
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel

class BackendBridgeAgent:
    name="BackendBridgeAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        kernel=GraphKernel(self.ctx.qsg_db_path())
        endpoints=kernel.nodes("API_ENDPOINT")
        mutations=kernel.nodes("STATE_MUTATION")
        entities=kernel.nodes("BUSINESS_ENTITY")
        bridges=[]; entity_links=[]
        for m in mutations:
            mf=kernel.facts_flat(m["logical_id"]); meta=m.get("metadata") or json.loads(m.get("metadata_json") or "{}")
            handler=str(meta.get("handler") or mf.get("handler") or "")
            for ep in endpoints:
                emeta=ep.get("metadata") or json.loads(ep.get("metadata_json") or "{}")
                path=emeta.get("path") or ""
                if path and (path in handler or path.split("/")[-1] in handler):
                    bridges.append({"stateMutation":m["logical_id"],"apiEndpoint":ep["logical_id"],"confidence":0.65,"reason":"handler/path textual match"})
                    try: kernel.upsert_edge({"source_logical_id":m["logical_id"],"target_logical_id":ep["logical_id"],"type":"CALLS_ENDPOINT","confidence_score":0.65,"metadata":{"reason":"backend-bridge-agent"}})
                    except Exception as e: self.logger.log("WARN", self.name, "CALLS_ENDPOINT rejected", error=str(e))
        for ep in endpoints:
            emeta=ep.get("metadata") or json.loads(ep.get("metadata_json") or "{}")
            path = str(emeta.get("path") or ep.get("logical_id") or "").lower()
            for ent in entities:
                n = str((ent.get("metadata") or {}).get("name") or (ent.get("metadata") or {}).get("schema") or ent["logical_id"].split("/")[-1]).lower()
                if n and len(n)>2 and (n in path or singular(n) in path):
                    entity_links.append({"apiEndpoint":ep["logical_id"],"businessEntity":ent["logical_id"],"confidence":0.58,"reason":"path/entity textual match"})
                    try: kernel.upsert_edge({"source_logical_id":ep["logical_id"],"target_logical_id":ent["logical_id"],"type":"USES_ENTITY","confidence_score":0.58,"metadata":{"reason":"backend-bridge-agent"}})
                    except Exception as e: self.logger.log("WARN", self.name, "USES_ENTITY rejected", error=str(e))
        kernel.finalize(); kernel.close()
        self.ctx.write_json("reports/backend_bridge_report.json", {"bridgeCount":len(bridges),"entityLinkCount":len(entity_links),"bridges":bridges,"entityLinks":entity_links})
        return AgentResult(self.name,"success",0.76,{"bridges":len(bridges),"entityLinks":len(entity_links)}, {"report":"reports/backend_bridge_report.json"})

def singular(s):
    return s[:-1] if s.endswith('s') else s
