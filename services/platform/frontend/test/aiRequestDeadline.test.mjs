import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_REQUEST_TIMEOUT_MS, getRequestTimeout } from '../src/platform/lib/requestTimeout.ts';

test('all synchronous AI authoring and review requests wait for the provider and validation budget', () => {
  for (const route of [
    '/requirements/ai-create-preview', '/requirements/story/ai-optimize-preview',
    '/requirements/ai-description-rephrase', '/requirements/ai-gherkin-preview',
    '/requirements/story/ai-groom-preview', '/requirements/story/ai-impact-preview',
    '/requirements/story/design-test-cases-preview', '/requirements/story/generate-test-cases',
    '/test-cases/design-test-cases-preview', '/test-cases/ai-authoring-preview',
    '/test-cases/ai-step-rephrase', '/test-cases/case/ai-impact-preview',
    '/test-cases/automation/learning-cache/object/ai-improve',
    '/feedback/ai-draft-preview', '/feedback/ai-triage-preview', '/executions/smart-plan-preview',
    '/executions/run/cases/case/ai-analysis', '/quality-gates/gate/ai-assessment',
    '/test-data-sets/ai-generate-preview', '/ai/rich-text-rephrase',
    '/analytics/dashboard-design-preview', '/requirement-releases/release/release-notes',
    '/agentic-assistant/sessions', '/knowledge/assistant/sessions/session/messages'
  ]) {
    assert.equal(getRequestTimeout(`${route}?project_id=project`, 'POST'), AI_REQUEST_TIMEOUT_MS, route);
  }
  assert.ok(AI_REQUEST_TIMEOUT_MS > 150_000 && AI_REQUEST_TIMEOUT_MS < 210_000);
});

test('catalog reads, saved results, queued jobs and ordinary mutations keep their short deadlines', () => {
  for (const [route, method] of [
    ['/test-cases', 'GET'], ['/ai-prompt-templates', 'POST'], ['/requirements', 'POST'],
    ['/requirements/ai-create-jobs', 'POST'], ['/test-cases/ai-generation-jobs', 'POST'],
    ['/requirements/story/ai-impact-preview', 'GET'], ['/agentic-assistant/sessions', 'GET'],
    ['/test-cases/automation/learning-cache/object/ai-improve/apply', 'PUT']
  ]) assert.equal(getRequestTimeout(route, method), 30_000, route);
});
