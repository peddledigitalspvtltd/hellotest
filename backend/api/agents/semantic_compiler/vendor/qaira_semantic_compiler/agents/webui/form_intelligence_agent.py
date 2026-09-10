from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel
from qaira_semantic_compiler.qsg.normalization import normalize_facts, safe_str
import json

class FormIntelligenceAgent:
    name="FormIntelligenceAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        kernel=GraphKernel(self.ctx.output/(self.ctx.config.get("qsg",{}).get("db_path","graph/qsg.sqlite")))
        fields=[]; normalized=0
        binds=kernel.edges("BINDS_FIELD")
        has_rules=kernel.edges("HAS_RULE")
        rules_by_field = {}
        for re in has_rules:
            rules_by_field.setdefault(re["source_logical_id"], []).append(re["target_logical_id"])
        for e in binds:
            field_id=e["target_logical_id"]; ui_id=e["source_logical_id"]
            raw_ff=kernel.facts_flat(field_id); raw_uf=kernel.facts_flat(ui_id)
            ff=normalize_facts(raw_ff); uf=normalize_facts(raw_uf)
            if raw_ff != ff or raw_uf != uf: normalized += 1
            rules=[]
            for rid in rules_by_field.get(field_id, []):
                rules.append(normalize_facts(kernel.facts_flat(rid)))
            field_name=safe_str(ff.get("name") or uf.get("name") or field_id.split("/")[-1])
            fields.append({
                "uiElement":ui_id,
                "businessField":field_id,
                "fieldName":field_name,
                "uiFacts":uf,
                "fieldFacts":ff,
                "validValue":valid_value(ff,uf,rules),
                "invalidValues":invalid_values(ff,uf,rules),
                "boundaryValues":boundary_values(ff,uf,rules),
                "rules":rules
            })
        kernel.close()
        self.ctx.write_json("generated/form_intelligence.json", {"fieldCount":len(fields),"normalizedBindings":normalized,"fields":fields})
        return AgentResult(self.name,"success" if fields else "partial",0.88 if fields else 0.25,{"fields":len(fields),"normalizedBindings":normalized}, {"artifact":"generated/form_intelligence.json"})

def valid_value(ff,uf,rules):
    name=safe_str(ff.get("name") or uf.get("name")).lower(); typ=safe_str(uf.get("type") or ff.get("dataType")).lower()
    if "email" in name or typ == "email": return "user@example.com"
    if "password" in name or typ == "password": return "ValidPass123!"
    if typ == "checkbox": return True
    if typ in {"number", "range"} or "number" in typ or "count" in name or "amount" in name: return 1
    if typ == "date" or "date" in name: return "2026-01-01"
    if typ == "tel" or "phone" in name: return "+919999999999"
    return "valid-value"

def invalid_values(ff,uf,rules):
    name=safe_str(ff.get("name") or uf.get("name")).lower(); typ=safe_str(uf.get("type") or ff.get("dataType")).lower(); out=[""]
    if "email" in name or typ == "email": out.append("not-an-email")
    if "password" in name or typ == "password": out.append("short")
    if typ in {"number", "range"} or "number" in typ: out.append("not-a-number")
    if typ == "date": out.append("invalid-date")
    return list(dict.fromkeys(out))

def boundary_values(ff,uf,rules):
    name=safe_str(ff.get("name") or uf.get("name")).lower(); typ=safe_str(uf.get("type") or ff.get("dataType")).lower()
    if typ in {"number", "range"} or "number" in typ:
        return [0, 1, -1, 999999]
    return ["", "a", "A"*255]
