import { type ReactNode } from "react";
import { type AssigneeOption } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import type { TestCase, TestStep } from "@hellotest/platform/frontend/src/types";

export type TestCaseDraft = {
  ai_generation_source?: "interactive";
  title: string;
  description: string;
  externalReferencesText: string;
  labelsText: string;
  automated: "yes" | "no";
  priority: number;
  status: string;
  requirement_id: string;
  module_id: string;
  author_id: string;
  reviewer_id: string;
  authoring_mode: "structured" | "gherkin";
  test_case_type: NonNullable<TestCase["test_case_type"]>;
  gherkin_document: string;
};

export type ExecutionStartMode = "manual" | "local" | "remote";

export type TestCaseDeliveryContext = { release?: string; sprint?: string };

export type StepDraft = {
  action: string;
  expected_result: string;
  step_type: TestStep["step_type"];
  automation_code: string;
  api_request: TestStep["api_request"];
};

export type TestCaseAuthoringLens = "manual" | "ui-script" | "api-script";

export type AuthoringStepProjection = Pick<TestStep, "id" | "step_order" | "action" | "expected_result" | "step_type" | "automation_code" | "api_request">;

export type DraftTestStep = {
  id: string;
  action: string;
  expected_result: string;
  step_type: TestStep["step_type"];
  automation_code: string;
  api_request: TestStep["api_request"];
  group_id: string | null;
  group_name: string | null;
  group_kind: "local" | "reusable" | null;
  reusable_group_id: string | null;
};

export type CopiedTestStep = {
  action: string;
  expected_result: string;
  step_type: TestStep["step_type"];
  automation_code: string;
  api_request: TestStep["api_request"];
  group_id: string | null;
  group_name: string | null;
  group_kind: "local" | "reusable" | null;
  reusable_group_id: string | null;
};

export type StepInsertionGroupContext = Pick<CopiedTestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id">;

export type CutStepSource = {
  stepIds: string[];
  testCaseId: string | null;
  isDraft: boolean;
};

export type StepActionMenuAction = {
  label: string;
  description?: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary";
};

export type CaseStepFilter = "all" | "with-steps" | "no-steps";

export type CaseRunFilter = "all" | "with-runs" | "no-runs";

export type TestCaseExecutionAssigneeOption = AssigneeOption;

export type TestCaseEditorSectionKey = "case" | "preconditions" | "steps" | "dataSets" | "automation" | "history";

export type TestCaseDetailTab = "details" | "automation" | "assurance" | "suites" | "history" | "defects" | "evidence";
