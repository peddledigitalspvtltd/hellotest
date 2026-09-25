from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
import json
from collections import defaultdict

class RiskAgent:
    name="RiskAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        a11y=self.ctx.read_json("reports/accessibility_report.json", {"issues":[]}) or {"issues":[]}
        testability=self.ctx.read_json("reports/testability_report.json", {"gaps":[],"testabilityScore":0}) or {}
        impact=self.ctx.read_json("reports/impact_report.json", {"impactedNodes":[]}) or {}
        patch=self.ctx.read_json("reports/patch_recommendations.grouped.json", {"groups":[]}) or {"groups":[]}
        risks=[]
        for g in patch.get("groups",[])[:200]:
            sev=g.get("severity","low")
            base={"high":90,"medium":60,"low":30}.get(sev,30)
            risks.append({"area":"webui-patch-group","severity":sev,"score":base + min(10, g.get("count",0)//10),"item":g})
        for issue in a11y.get("issues",[])[:500]:
            sev=issue.get("severity","medium")
            risks.append({"area":"accessibility","severity":sev,"score":85 if sev=="high" else 55,"item":issue})
        for gap in testability.get("topGaps", testability.get("gaps",[]))[:250]:
            risks.append({"area":"testability","severity":gap.get("priority","medium"),"score":75 if gap.get("priority")=="high" else 50,"item":gap})
        for node in impact.get("impactedNodes",[])[:100]:
            risks.append({"area":"impact","severity":"medium","score":50,"item":node})
        risks=sorted(risks,key=lambda r:r["score"], reverse=True)
        page_risk=defaultdict(lambda:{"page":"","riskCount":0,"maxScore":0,"topAreas":defaultdict(int)})
        for r in risks:
            item=r.get("item") or {}; page=item.get("page") or "/"
            pr=page_risk[page]; pr["page"]=page; pr["riskCount"]+=1; pr["maxScore"]=max(pr["maxScore"], r["score"]); pr["topAreas"][r["area"]]+=1
        page_summary=[]
        for p in page_risk.values():
            p["topAreas"]=[{"area":k,"count":v} for k,v in sorted(p["topAreas"].items(), key=lambda x:-x[1])[:5]]
            page_summary.append(dict(p))
        report={"riskCount":len(risks),"topRisks":risks[:100],"pageRiskSummary":sorted(page_summary,key=lambda x:(-x["maxScore"],-x["riskCount"])),"summary":{"a11yIssues":len(a11y.get("issues",[])),"testabilityGaps":len(testability.get("gaps",[])),"patchGroups":len(patch.get("groups",[])),"impactedNodes":len(impact.get("impactedNodes",[]))}}
        self.ctx.write_json("reports/risk_report.json", report)
        return AgentResult(self.name,"success",0.86,{"risks":len(risks),"pages":len(page_summary)}, {"report":"reports/risk_report.json"})
