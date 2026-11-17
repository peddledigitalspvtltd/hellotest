import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
function load(path, imports) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => Object.hasOwn(imports, name) ? imports[name] : require(name), module, module.exports);
  return module.exports;
}

test("synchronous pending processing shares the server stages and confirms no unseen work", () => {
  const contract = require("../../shared/generationStages.json");
  const { pendingAuthoringProcessing } = load("../../frontend/lib/authoringLifecycle.ts", { "../../shared/generationStages.json": contract });
  const pending = pendingAuthoringProcessing();
  const backend = require("../../backend/services/generationLifecycle").processing();
  assert.deepEqual(pending.stages.map(stage => stage.id), backend.stages.map(stage => stage.id));
  assert.equal(pending.completed_stage_count, 0);
  assert.equal(pending.progress_mode, "indeterminate");
  assert.equal(pending.active_stage_id, "intake");
  assert.ok(pending.stages.every(stage => stage.status !== "complete" && !stage.evidence));
  assert.match(pending.status_label, /awaiting server-reported stages/);
});

test("the actual Draft/Improve modal forwards server success and failure processing to the shared workbench", () => {
  const studio = () => null;
  const { AiCaseAuthoringModal } = load("../../frontend/components/AiCaseAuthoringModal.tsx", {
    react: { useMemo: callback => callback() },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
    "./AiDesignStudioModal": { AiDesignStudioModal: studio },
    "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy": { casePrivateParameterNames: () => [] },
    "@hellotest/testing/frontend/lib/gherkin": { parseSharedStepGherkin: () => [] }
  });
  const processing = require("../../backend/services/generationLifecycle").processing({ status: "completed", stage: "review", profile: "case-authoring", outputCount: 1 });
  const sourceDraft = { title: "Approve an invoice", description: "Confirm the recorded approval.", parameter_values: {}, steps: [] };
  const props = { requirements: [], requirementId: "", sourceDraft, preview: null, processing };
  const success = AiCaseAuthoringModal(props);
  assert.equal(success.type, studio);
  assert.equal(success.props.processing, processing);
  const failure = { code: "LLM_QUOTA_EXCEEDED", message: "Provider quota is exhausted.", stage_id: "specialist", retry_after_seconds: 13 };
  const failedProcessing = require("../../backend/services/generationLifecycle").processing({ status: "failed", stage: "specialist", profile: "case-authoring" });
  const failed = AiCaseAuthoringModal({ ...props, processing: failedProcessing, failure });
  assert.equal(failed.props.processing, failedProcessing);
  assert.equal(failed.props.failure, failure);
});
