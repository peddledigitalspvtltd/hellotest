from __future__ import annotations
import json
from collections import defaultdict
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg.normalization import normalize_locator_record, is_interactive_facts, safe_str, route_from_logical, page_component_key

class PatchRecommendationAgent:
    name="PatchRecommendationAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        issues_path=self.ctx.output/"reports/accessibility_report.json"
        loc_path=self.ctx.output/"generated/html_page_locators.json"
        testability=self.ctx.read_json("reports/testability_report.json", {"gaps":[]}) or {"gaps":[]}
        raw=[]
        # A11y issues, only actionable groups with severity and dedupe keys.
        if issues_path.exists():
            for i in json.loads(issues_path.read_text()).get("issues",[]):
                kind=i.get("kind")
                if kind in ["icon-only-control","input-without-label","unnamed-native-control"]:
                    raw.append(_rec(i, kind, "high", "Add accessible name/label. Add data-testid when this control is part of a testable flow."))
                elif kind=="clickable-div":
                    raw.append(_rec(i, kind, "high", "Replace clickable div with <button> or add role='button', tabIndex, and keyboard handlers."))
                elif kind=="duplicate-accessible-name":
                    raw.append(_rec(i, kind, "medium", "Make accessible names unique within the component or scope locators by region/container."))
        # Locator gaps: interactive first; non-interactive summarized but not spammed.
        if loc_path.exists():
            for l in json.loads(loc_path.read_text()).get("locators",[]):
                l=normalize_locator_record(l)
                if l.get("locatorRisk") == "high":
                    interactive=is_interactive_facts({**(l.get("evidence") or {}), **l})
                    raw.append(_rec(l, "unstable-interactive-locator" if interactive else "unstable-static-locator", "high" if interactive else "low", "Add data-testid, aria-label, label association, or stable role/name evidence."))
        for g in testability.get("gaps",[]):
            if g.get("kind") == "input-missing-name":
                raw.append(_rec(g, "input-missing-name", "medium", "Bind input to a stable form field name and validation schema."))
        grouped=group_recommendations(raw)
        priority_groups=sorted(grouped.values(), key=lambda g:(-g["score"], -g["count"], g["page"]))
        page_rollup=rollup_pages(priority_groups)
        report={
            "rawRecommendationCount":len(raw),
            "groupCount":len(priority_groups),
            "topGroups":priority_groups[:100],
            "groups":priority_groups,
            "pageRollup":page_rollup,
            "summary":{
                "highPriorityGroups":sum(1 for g in priority_groups if g["severity"]=="high"),
                "mediumPriorityGroups":sum(1 for g in priority_groups if g["severity"]=="medium"),
                "lowPriorityGroups":sum(1 for g in priority_groups if g["severity"]=="low"),
                "message":"Recommendations are grouped by page/component/kind to reduce noise. Fix high-priority interactive groups first."
            }
        }
        self.ctx.write_json("reports/patch_recommendations.json", report)
        self.ctx.write_json("reports/patch_recommendations.grouped.json", report)
        self.ctx.write_json("reports/patch_recommendations.raw.json", {"count":len(raw),"recommendations":raw})
        return AgentResult(self.name,"success",0.88,{"rawRecommendations":len(raw),"groups":len(priority_groups),"topGroups":len(priority_groups[:100])}, {"grouped":"reports/patch_recommendations.grouped.json","raw":"reports/patch_recommendations.raw.json"})

def _rec(item, kind, severity, recommendation):
    ev=item.get("evidence") or {}
    page=safe_str(item.get("page") or ev.get("route") or route_from_logical(item.get("logicalId", "")), "/") or "/"
    component=safe_str(item.get("component") or ev.get("component") or "unknown") or "unknown"
    return {
        "kind":kind, "severity":severity, "page":page, "component":component,
        "target":item.get("logicalId") or item.get("target"), "file":item.get("file"), "line":item.get("line"),
        "tagName":item.get("tagName"), "role":item.get("role"), "recommendation":recommendation,
        "interactive": is_interactive_facts({**ev, **item})
    }

def group_recommendations(raw):
    out={}
    severity_score={"high":100,"medium":60,"low":25}
    for r in raw:
        # Static non-interactive unstable locators are grouped at low severity, not emitted as separate action items.
        key=(r.get("page") or "/", r.get("component") or "unknown", r.get("kind"))
        k="::".join(key)
        g=out.setdefault(k,{
            "page":key[0],"component":key[1],"kind":key[2],"severity":r.get("severity","low"),
            "score":severity_score.get(r.get("severity","low"),25),"count":0,"examples":[],"files":{},"recommendation":r.get("recommendation")
        })
        g["count"] += 1
        if severity_score.get(r.get("severity","low"),25) > g["score"]:
            g["severity"]=r.get("severity"); g["score"]=severity_score.get(r.get("severity"),25); g["recommendation"]=r.get("recommendation")
        f=r.get("file") or "unknown"
        g["files"][f]=g["files"].get(f,0)+1
        if len(g["examples"]) < 5:
            g["examples"].append({"target":r.get("target"),"file":r.get("file"),"line":r.get("line"),"tagName":r.get("tagName"),"role":r.get("role")})
    for g in out.values():
        g["files"]=[{"file":f,"count":c} for f,c in sorted(g["files"].items(), key=lambda x:-x[1])[:10]]
    return out

def rollup_pages(groups):
    pages=defaultdict(lambda:{"page":"","groupCount":0,"issueCount":0,"high":0,"medium":0,"low":0,"topKinds":defaultdict(int)})
    for g in groups:
        p=pages[g["page"]]; p["page"]=g["page"]; p["groupCount"]+=1; p["issueCount"]+=g["count"]; p[g["severity"]]+=1; p["topKinds"][g["kind"]]+=g["count"]
    result=[]
    for p in pages.values():
        p["topKinds"]=[{"kind":k,"count":v} for k,v in sorted(p["topKinds"].items(), key=lambda x:-x[1])[:10]]
        result.append(dict(p))
    return sorted(result, key=lambda x:(-x["high"], -x["issueCount"], x["page"]))
