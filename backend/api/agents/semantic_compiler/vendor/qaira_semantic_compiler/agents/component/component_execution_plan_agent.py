from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
class ComponentExecutionPlanAgent:
    name='ComponentExecutionPlanAgent'
    def __init__(self,ctx,logger): self.ctx=ctx; self.logger=logger
    def run(self):
        plan={
          'testDir':'generated/component-tests',
          'htmlReport':'component-html-report',
          'resultsDir':'component-test-results',
          'recommendedCommand':'PLAYWRIGHT_HTML_REPORT=qaira-output/component-html-report npx playwright test qaira-output/generated/component-tests --reporter=html,json --output=qaira-output/component-test-results',
          'screenshotPolicy':'only-on-failure',
          'tracePolicy':'retain-on-failure',
          'videoPolicy':'retain-on-failure',
          'codegenCommand':'npx playwright codegen <APP_URL>'
        }
        self.ctx.write_json('runtime/component_execution_plan.json', plan)
        self.ctx.write_text('generated/component-tests/run-component-tests.sh', '#!/usr/bin/env bash\nset -euo pipefail\nROOT="$(cd "$(dirname "$0")/../../.." && pwd)"\ncd "$ROOT"\nexport PLAYWRIGHT_HTML_REPORT="${PLAYWRIGHT_HTML_REPORT:-$ROOT/qaira-output/component-html-report}"\nnpx playwright test "$ROOT/qaira-output/generated/component-tests" --reporter=html,json --output="$ROOT/qaira-output/component-test-results"\n')
        return AgentResult(self.name,'success',0.95,{'executionPlan':1},{'executionPlan':'runtime/component_execution_plan.json','runScript':'generated/component-tests/run-component-tests.sh'})
