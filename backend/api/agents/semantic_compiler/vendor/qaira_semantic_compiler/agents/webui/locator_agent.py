from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel
from qaira_semantic_compiler.qsg.normalization import normalize_facts, safe_str, route_from_logical, is_actionable_locator, is_interactive_facts, locator_priority, is_bad_accessible_name
import json, re

class LocatorAgent:
    name = "LocatorAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        db_path = self.ctx.output / (self.ctx.config.get("qsg",{}).get("db_path","graph/qsg.sqlite"))
        kernel = GraphKernel(db_path)
        locators=[]; warnings=[]; stable=[]; unstable=[]
        for n in kernel.nodes("UI_ELEMENT"):
            logical = n["logical_id"]
            facts = normalize_facts(kernel.facts_flat(logical))
            meta = n.get("metadata") or json.loads(n.get("metadata_json") or "{}")
            meta = normalize_facts(meta)
            candidates = build_locators(facts)
            primary_strategy = candidates[0]["strategy"] if candidates else "none"
            if candidates and primary_strategy in ["getByTestId","getByRole","getByLabel"]:
                risk = "low"
            elif candidates and primary_strategy == "getByText":
                risk = "medium"
            elif candidates:
                risk = "medium"
            else:
                risk = "high"
                warnings.append({"logicalId":logical,"warning":"No stable locator candidate found. Add data-testid or accessible name."})
            item = {
                "logicalId": logical,
                "file": meta.get("file"),
                "line": meta.get("line"),
                "page": facts.get("route") or meta.get("route") or route_from_logical(logical),
                "component": meta.get("component"),
                "tagName": facts.get("tagName"),
                "role": facts.get("role"),
                "text": facts.get("text"),
                "label": facts.get("label"),
                "name": facts.get("name"),
                "locatorRisk": risk,
                "actionable": False,
                "interactive": is_interactive_facts({**facts, **meta}),
                "priority": 0,
                "candidates": candidates,
                "evidence": {**facts, "route": meta.get("route") or facts.get("route"), "component": meta.get("component") or facts.get("component")}
            }
            item["actionable"] = is_actionable_locator(item)
            item["priority"] = locator_priority(item)
            locators.append(item)
            (stable if item["actionable"] else unstable).append(item)
        kernel.close()
        payload = {"source":"QSG", "count": len(locators), "stableCount": len(stable), "unstableCount": len(unstable), "locators": locators, "warnings": warnings}
        self.ctx.write_json("generated/html_page_locators.json", payload)
        self.ctx.write_json("generated/html_page_locators.summary.json", {"count": len(locators), "stableCount": len(stable), "unstableCount": len(unstable), "warnings": len(warnings), "byPage": count_by_page(locators), "stableByPage": count_by_page(stable), "interactiveCount": sum(1 for l in locators if l.get("interactive")), "interactiveStableCount": sum(1 for l in stable if l.get("interactive"))})
        self.ctx.write_json("generated/webui/unstable_locators.json", {"count": len(unstable), "locators": unstable, "recommendation":"Unstable locators are intentionally excluded from generated page classes. Add data-testid, aria-label, label association, or stable role/name evidence."})
        self.ctx.write_text("generated/playwright_locators.js", render_locator_module(stable, include_todo=False))
        return AgentResult(self.name,"success" if locators else "partial",0.9 if locators else 0.3,{"locators":len(locators),"stable":len(stable),"unstable":len(unstable),"warnings":len(warnings)}, {"json":"generated/html_page_locators.json","stableJs":"generated/playwright_locators.js","unstable":"generated/webui/unstable_locators.json"})

def esc(s): return safe_str(s).replace("\\","\\\\").replace("'","\\'")

def build_locators(f):
    f = normalize_facts(f)
    out=[]
    if f.get("testId") and not is_bad_accessible_name(f.get("testId")):
        out.append({"strategy":"getByTestId","locator":f"page.getByTestId('{esc(f['testId'])}')","confidence":0.98})
    label = f.get("label") or f.get("ariaLabel") or f.get("placeholder")
    if label and not is_bad_accessible_name(label):
        out.append({"strategy":"getByLabel","locator":f"page.getByLabel('{esc(label)}')","confidence":0.93})
    role = f.get("role")
    name = f.get("ariaLabel") or f.get("text") or f.get("label") or f.get("name")
    if role and name and not is_bad_accessible_name(name):
        out.append({"strategy":"getByRole","locator":f"page.getByRole('{esc(role)}', {{ name: '{esc(name)}' }})","confidence":0.91})
    if f.get("text") and f.get("tagName") not in ["input","select","textarea"] and not is_bad_accessible_name(f.get("text")):
        out.append({"strategy":"getByText","locator":f"page.getByText('{esc(f['text'])}')","confidence":0.72})
    if f.get("id"):
        out.append({"strategy":"css-id","locator":f"page.locator('#{esc(f['id'])}')","confidence":0.62,"warning":"CSS id can be unstable if generated."})
    if f.get("name"):
        out.append({"strategy":"css-name","locator":f"page.locator('[name=\"{esc(f['name'])}\"]')","confidence":0.58,"warning":"Name selector is fallback."})
    return out

def render_locator_module(locators, include_todo=False):
    lines=["// Generated by QAira Locator Agent. Only stable/actionable locators are exported by default.","export const qairaLocators = {"]
    used=set()
    for item in locators:
        name = re.sub(r"[^A-Za-z0-9_]", "_", item["logicalId"].split("/")[-1]) or "element"
        if name[0].isdigit(): name="el_"+name
        base=name; i=2
        while name in used: name=f"{base}_{i}"; i+=1
        used.add(name)
        loc = item["candidates"][0]["locator"] if item.get("candidates") else ("page.locator('/* TODO stable locator */')" if include_todo else None)
        if not loc:
            continue
        lines.append(f"  {name}: (page) => {loc}, // {item['logicalId']}")
    lines.append("};\n")
    return "\n".join(lines)

def count_by_page(locators):
    out = {}
    for l in locators:
        p = l.get("page") or route_from_logical(l.get("logicalId", ""))
        out[p] = out.get(p, 0) + 1
    return out
