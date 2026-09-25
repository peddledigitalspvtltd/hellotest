from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel
from qaira_semantic_compiler.qsg.normalization import normalize_facts, safe_str
import json, collections

class AccessibilityAgent:
    name="AccessibilityAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        kernel=GraphKernel(self.ctx.output/(self.ctx.config.get("qsg",{}).get("db_path","graph/qsg.sqlite")))
        issues=[]; names=collections.defaultdict(list); scanned=0; normalized_values=0
        heading_levels=[]
        for n in kernel.nodes("UI_ELEMENT"):
            scanned += 1
            raw = kernel.facts_flat(n["logical_id"])
            f=normalize_facts(raw)
            if raw != f: normalized_values += 1
            meta=normalize_facts(n.get("metadata") or json.loads(n.get("metadata_json") or "{}"))
            tag=safe_str(f.get("tagName")).lower()
            role=safe_str(f.get("role")).lower()
            name=safe_str(f.get("ariaLabel") or f.get("label") or f.get("text") or f.get("name"))
            if role in ["button","link"] and not name:
                issues.append(issue("icon-only-control",n,meta,"Interactive element has no accessible name. Add aria-label or visible text.","high"))
            if tag in ["button", "a"] and not name:
                issues.append(issue("unnamed-native-control",n,meta,"Native interactive element has no accessible name.","high"))
            if tag in ["input","select","textarea"] and not (safe_str(f.get("label")) or safe_str(f.get("ariaLabel")) or safe_str(f.get("placeholder"))):
                issues.append(issue("input-without-label",n,meta,"Input has no label/aria-label/placeholder evidence.","high"))
            if tag == "div" and f.get("onClick") and not role:
                issues.append(issue("clickable-div",n,meta,"Clickable div lacks semantic role. Use button or add role and keyboard handling.","medium"))
            if tag in {"h1","h2","h3","h4","h5","h6"}:
                try: heading_levels.append((int(tag[1]), n["logical_id"], meta))
                except Exception: pass
            if name:
                names[(role or tag or "element", name)].append(n["logical_id"])
        for (role,name), ids in names.items():
            if role in ["button","link","textbox","input","a"] and len(ids)>1:
                issues.append({"kind":"duplicate-accessible-name","severity":"medium","role":role,"name":name,"logicalIds":ids[:50],"duplicateCount":len(ids),"recommendation":"Scope locators or make accessible names unique."})
        prev = None
        for level, lid, meta in heading_levels:
            if prev is not None and level - prev > 1:
                issues.append({"kind":"heading-structure-skip","severity":"low","logicalId":lid,"file":meta.get("file"),"line":meta.get("line"),"message":f"Heading jumps from h{prev} to h{level}."})
            prev = level
        kernel.close()
        by_kind = dict(collections.Counter(i.get("kind") for i in issues))
        self.ctx.write_json("reports/accessibility_report.json", {"scannedElements":scanned,"issueCount":len(issues),"issuesByKind":by_kind,"normalizedFactObjects":normalized_values,"issues":issues})
        return AgentResult(self.name,"success",0.9,{"scanned":scanned,"issues":len(issues),"normalized":normalized_values,"issuesByKind":by_kind}, {"report":"reports/accessibility_report.json"})

def issue(kind,n,meta,msg,severity):
    return {"kind":kind,"severity":severity,"logicalId":n["logical_id"],"file":meta.get("file"),"line":meta.get("line"),"message":msg}
