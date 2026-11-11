import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { AUTOMATION_PLAYWRIGHT_VERSION, assertAutomationPlaywrightVersions } from '../dist/lib/automationPlaywrightMcp.js';
import { PLAYWRIGHT_ARTIFACT_RUNTIME_VERSION, buildPlaywrightArtifact } from '../../../services/automation/shared/playwrightArtifact.mjs';
const require = createRequire(import.meta.url);
const upstream = createRequire(require.resolve('@playwright/mcp/package.json'));

test('Build, Run, installer, lockfile and standalone all pin the same upstream runtime', () => {
  const { runtimeDependencies } = require('../../../services/agentic/backend/services/inspectionAgentInstaller.js');
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  for (const version of [require('playwright/package.json').version, upstream('playwright/package.json').version,
    manifest.dependencies.playwright, lock.packages['node_modules/playwright'].version,
    runtimeDependencies.playwright, PLAYWRIGHT_ARTIFACT_RUNTIME_VERSION]) assert.equal(version, AUTOMATION_PLAYWRIGHT_VERSION);
  assert.equal(require('playwright').chromium.executablePath(), upstream('playwright').chromium.executablePath());
  assert.doesNotThrow(() => assertAutomationPlaywrightVersions(AUTOMATION_PLAYWRIGHT_VERSION, AUTOMATION_PLAYWRIGHT_VERSION));
  for (const versions of [['1.59.1', AUTOMATION_PLAYWRIGHT_VERSION], [AUTOMATION_PLAYWRIGHT_VERSION, '1.59.1']]) assert.throws(() => assertAutomationPlaywrightVersions(...versions), /Build and Run require Playwright/);
  const artifact = buildPlaywrightArtifact({ testCase: { id: 'v', title: 'Pinned' }, steps: [] });
  assert.ok(artifact.includes(`npm i -D @playwright/test@${AUTOMATION_PLAYWRIGHT_VERSION}`));
  assert.match(artifact, /testInfo\.config\.version !== playwrightRuntime\.version/);
});
