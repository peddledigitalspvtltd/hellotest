from __future__ import annotations
import re, json
from qaira_semantic_compiler.core.context import AgentResult
from .utils import slug, pascal
class ComponentPlaywrightGenerationAgent:
    name='ComponentPlaywrightGenerationAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        contracts=self.ctx.state.get('component_test_contracts') or self.ctx.read_json('generated/components/component_test_contracts.json',{}).get('contracts',[])
        generated=[]; index=[]
        for c in contracts:
            s=slug(c['component']); class_name=pascal(s)+'ComponentSpec'
            rel=f'generated/component-tests/{s}.spec.ts'
            self.ctx.write_text(rel, render_spec(c))
            generated.append(rel); index.append({'component':c['component'],'file':rel,'testCount':len(c.get('testCases',[])),'maturityScore':c.get('maturityScore')})
        self.ctx.write_json('generated/components/component_playwright_tests.json',{'testFileCount':len(generated),'files':index})
        self.ctx.write_text('generated/component-tests/README.md', README)
        return AgentResult(self.name,'success' if generated else 'partial',0.88 if generated else 0.4,{'testFiles':len(generated),'tests':sum(i['testCount'] for i in index)},{'testsIndex':'generated/components/component_playwright_tests.json','testDir':'generated/component-tests'})

def q(s): return str(s or '').replace('\\','\\\\').replace("'","\\'")
def call(locator): return 'page.'+locator if locator and not locator.startswith('page.') else locator

def render_spec(c):
    route = c.get('page') or '/'
    primary = None
    for e in c.get('elements') or []:
        if e.get('primaryLocator'):
            primary=e['primaryLocator']; break
    primary_call = call(primary or "getByRole('main')")
    lines=["import { test, expect } from '@playwright/test';", "", "test.use({ screenshot: 'only-on-failure', trace: 'retain-on-failure', video: 'retain-on-failure' });", "", f"test.describe('{q(c['component'])}', () => {{"]
    mocks=c.get('fixtures',{}).get('apiMocks',[]) or []
    lines.append("  test.beforeEach(async ({ page }) => {")
    for m in mocks[:5]:
        endpoint=q(m.get('endpoint') or '**/api/**')
        status=int(m.get('status') or 200); body=json.dumps(m.get('body') or {'ok':True})
        lines.append(f"    await page.route('**{endpoint}', async route => route.fulfill({{ status: {status}, contentType: 'application/json', body: JSON.stringify({body}) }}));")
    lines.append('  });')
    for t in c.get('testCases') or []:
        name=q(t.get('name'))
        lines.append(f"\n  test('{name}', async ({{ page }}) => {{")
        lines.append(f"    await page.goto('{q(route)}');")
        if t.get('type') in {'validation','negative'}:
            btn = next((e for e in c.get('elements',[]) if (e.get('role')=='button' and e.get('primaryLocator'))), None)
            if btn: lines.append(f"    await {call(btn['primaryLocator'])}.click();")
            lines.append("    await expect(page.getByText(/required|invalid|error|failed/i).first()).toBeVisible({ timeout: 5000 });")
        elif t.get('type') in {'happy_path','api_error'}:
            for e in (c.get('elements') or [])[:6]:
                if e.get('role') in {'textbox','combobox'} and e.get('primaryLocator'):
                    val='qa.user@example.com' if 'email' in (e.get('name','')+e.get('displayName','')).lower() else 'QAira Test'
                    lines.append(f"    await {call(e['primaryLocator'])}.fill('{q(val)}').catch(() => undefined);")
            btn = next((e for e in c.get('elements',[]) if (e.get('role')=='button' and e.get('primaryLocator'))), None)
            if btn: lines.append(f"    await {call(btn['primaryLocator'])}.click();")
            lines.append("    await expect(page).not.toHaveURL(/error$/, { timeout: 5000 });")
        else:
            lines.append(f"    await expect({primary_call}).toBeVisible({{ timeout: 10000 }});")
        lines.append("  });")
    lines.append('});\n')
    return '\n'.join(lines)
README='''# QAira generated component tests\n\nRun from your repository root after installing Playwright:\n\n```bash\nnpx playwright test qaira-output/generated/component-tests --reporter=html,json --output=qaira-output/component-test-results\n```\n\nHTML report output is controlled by Playwright. The VS Code extension sets `PLAYWRIGHT_HTML_REPORT=qaira-output/component-html-report`.\n'''
