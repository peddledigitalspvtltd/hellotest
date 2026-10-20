import type { TestCase } from '@hellotest/platform/frontend/src/types';

export function hasAutomationCoverage(testCase: Pick<TestCase, 'automated' | 'automation_test_case_ids'>) {
  return testCase.automated === 'yes' || Boolean(testCase.automation_test_case_ids?.length);
}
