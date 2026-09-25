from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel
from qaira_semantic_compiler.qsg.normalization import normalize_facts, is_interactive_facts, route_from_logical, safe_str
import json
from collections import defaultdict

class TestabilityAgent:
    name="TestabilityAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        kernel=GraphKernel(self.ctx.qsg_db_path())
        gaps=[]; page_summary=defaultdict(lambda: {"interactive":0,"stableInteractive":0,"gaps":0})
        total_interactive=0; stable_interactive=0; total_elements=0; stable_all=0
        for n in kernel.nodes("UI_ELEMENT"):
            total_elements += 1
            raw_f=kernel.facts_flat(n["logical_id"])
            f=normalize_facts(raw_f)
            meta=n.get("metadata") or json.loads(n.get("metadata_json") or "{}")
            meta=normalize_facts(meta)
            page=f.get("route") or meta.get("route") or route_from_logical(n["logical_id"])
            stable = bool(f.get("testId") or f.get("ariaLabel") or f.get("label") or (f.get("role") and (f.get("text") or f.get("name"))))
            interactive = is_interactive_facts({**f, **meta})
            if stable: stable_all += 1
            if interactive:
                total_interactive += 1
                page_summary[page]["interactive"] += 1
                if stable:
                    stable_interactive += 1
                    page_summary[page]["stableInteractive"] += 1
                else:
                    page_summary[page]["gaps"] += 1
                    gaps.append({
                        "kind":"unstable-interactive-locator",
                        "logicalId":n["logical_id"],
                        "page":page,
                        "component":meta.get("component"),
                        "file":meta.get("file"),
                        "line":meta.get("line"),
                        "tagName":f.get("tagName"),
                        "role":f.get("role"),
                        "priority":"high",
                        "recommendation":"Add data-testid or accessible role/name for this interactive element."
                    })
            if f.get("tagName") == "input" and not f.get("name"):
                gaps.append({"kind":"input-missing-name","logicalId":n["logical_id"],"page":page,"component":meta.get("component"),"priority":"medium","recommendation":"Bind input to a form field name for field intelligence."})
        kernel.close()
        interactive_score = round((stable_interactive/total_interactive)*100,2) if total_interactive else 100
        all_score = round((stable_all/total_elements)*100,2) if total_elements else 0
        grouped_pages=[]
        for page, v in page_summary.items():
            score=round((v["stableInteractive"]/v["interactive"])*100,2) if v["interactive"] else 100
            grouped_pages.append({"page":page, **v, "interactiveTestabilityScore":score})
        grouped_pages=sorted(grouped_pages, key=lambda x:(x["interactiveTestabilityScore"], -x["gaps"]))
        report={
            "testabilityScore":interactive_score,
            "allElementSignalScore":all_score,
            "interactiveElementCount":total_interactive,
            "stableInteractiveElementCount":stable_interactive,
            "totalUiElements":total_elements,
            "stableUiElements":stable_all,
            "gapCount":len(gaps),
            "topGaps":gaps[:250],
            "gaps":gaps,
            "pages":grouped_pages,
            "note":"Primary score is interactive-only to reduce WebUI noise. Non-interactive/static elements are tracked separately."
        }
        self.ctx.write_json("reports/testability_report.json", report)
        return AgentResult(self.name,"success" if interactive_score>=50 else "partial",interactive_score/100,{"score":interactive_score,"interactive":total_interactive,"stableInteractive":stable_interactive,"gaps":len(gaps)}, {"report":"reports/testability_report.json"})
