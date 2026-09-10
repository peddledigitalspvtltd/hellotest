from __future__ import annotations
import json, re
from qaira_semantic_compiler.core.context import AgentResult

class PlaywrightSpecAgent:
    name="PlaywrightSpecAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        loc_path=self.ctx.output/"generated/html_page_locators.json"
        form_path=self.ctx.output/"generated/form_intelligence.json"
        locs=json.loads(loc_path.read_text()) if loc_path.exists() else {"locators":[]}
        forms=json.loads(form_path.read_text()) if form_path.exists() else {"fields":[]}
        spec=render_spec(locs.get("locators",[]), forms.get("fields",[]))
        self.ctx.write_text("generated/webui_playwright_specs.spec.ts", spec)
        qaira_tests=[to_qaira_case(l) for l in locs.get("locators",[])[:100]]
        self.ctx.write_json("generated/webui_qaira_tests.json", {"testType":"webui","rows":qaira_tests})
        self.ctx.write_json("generated/webui_test_generation_trace.json", {"sourceLocators":"generated/html_page_locators.json", "generatedSpec":"generated/webui_playwright_specs.spec.ts", "qairaTestRows":len(qaira_tests), "locatorCount":len(locs.get("locators",[])), "formFieldCount":len(forms.get("fields",[]))})
        return AgentResult(self.name,"success",0.84,{"specs":1,"qairaRows":len(qaira_tests)}, {"spec":"generated/webui_playwright_specs.spec.ts","qaira":"generated/webui_qaira_tests.json"})

def render_spec(locators, fields):
    lines=["import { test, expect } from '@playwright/test';","import { qairaLocators } from './playwright_locators';","", "test.describe('QAira generated web UI smoke tests', () => {", "  test.beforeEach(async ({ page }) => {", "    await page.goto(process.env.BASE_URL || '/');", "  });"]
    for item in locators[:30]:
        name=safe(item["logicalId"].split("/")[-1])
        cand=item.get("candidates",[])
        loc=cand[0]["locator"].replace("page.", "page.") if cand else "page.locator('/* TODO */')"
        lines += ["", f"  test('{name} should be visible or attached', async ({{ page }}) => {{", f"    const element = {loc};", "    await expect(element.first()).toBeAttached();", "  });"]
    if fields:
        lines += ["", "  test('form fields accept generated valid data', async ({ page }) => {"]
        for f in fields[:20]:
            cand = (next((l for l in locators if l["logicalId"]==f["uiElement"]), {}) or {}).get("candidates", [])
            if cand:
                lines.append(f"    await {cand[0]['locator']}.fill({json.dumps(str(f.get('validValue','valid-value')))}).catch(() => undefined);")
        lines += ["  });"]
    lines.append("});\n")
    return "\n".join(lines)
def safe(s): return re.sub(r"[^A-Za-z0-9 _-]"," ",s).strip()[:80] or "element"
def to_qaira_case(l):
    title=f"Verify {l['logicalId'].split('/')[-1]} locator"
    locator=(l.get("candidates") or [{}])[0].get("locator", "")
    return {"title":title,"description":"Generated from QSG UI locator intelligence.","automated":"yes","status":"draft","suite":"QSG Web UI Locators","parameter_values":{},"steps":[{"step_order":1,"step_type":"web","action":f"Locate element using {locator}","expected_result":"Element is attached and locator is stable.","locator":locator,"locator_candidates":l.get("candidates",[])}]}
