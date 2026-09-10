from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel
import json

class RuntimeOverlayAgent:
    name="RuntimeOverlayAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        # Static placeholder overlay: runtime verification is browser-second; this records pending verification safely.
        kernel=GraphKernel(self.ctx.qsg_db_path())
        locs=self.ctx.read_json("generated/html_page_locators.json", {"locators":[]}) or {"locators":[]}
        count=0
        for l in locs.get("locators",[])[:500]:
            kernel.add_overlay("runtime-verification-plan", l["logicalId"], {"status":"pending", "preferredLocator": (l.get("candidates") or [{}])[0].get("locator"), "reason":"static-QSG-generated; verify during Playwright CT/runtime run"})
            count += 1
        kernel.finalize(); kernel.close()
        self.ctx.write_json("reports/runtime_overlay_plan.json", {"overlayType":"runtime-verification-plan","count":count})
        return AgentResult(self.name,"success",0.8,{"overlays":count}, {"report":"reports/runtime_overlay_plan.json"})
