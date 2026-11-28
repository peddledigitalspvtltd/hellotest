import {useQuery} from "@tanstack/react-query";
import {useState} from "react";
import {IconRefresh} from "@tabler/icons-react";
import {agenticApi} from "../../api.client";
import {automationAgentPresets,nativeTaskDefaults,nativeTaskProfiles,nativeTaskResetPatch} from "../nativeTaskProfiles";
import type { WorkflowOperationEditorProps } from "./operationEditorTypes";
import { workflowFieldInputs } from "./shared/fieldInputs";
export function ArtifactTaskFields(props:WorkflowOperationEditorProps){
const {data,projectId,appTypeId,triggerInput,onChange}=props;
const {field, select}=workflowFieldInputs(data,onChange);
const automation=data.artifactTask==='automation-engineer';
const apiAutomation=automation && data.automationRuntime==='api';
const manualSource=automation && data.automationSource==='manual_case';
const browserMode=String(data.automationBrowserMode || (data.inspectBrowser === false ? "offline" : "read_only"));
const canVerifyWeb=browserMode === "perform_steps" && Boolean(data.testEnvironmentId);
const verifiesAfterBuild = ["verify", "verify_cli", "verify_repair"].includes(String(data.automationVerificationMode));
const [caseSearch,setCaseSearch]=useState('');
const manualCases=useQuery({
    queryKey:['workflow-manual-test-cases',projectId,appTypeId,caseSearch],
    queryFn:({signal})=>agenticApi.workflowManualCases.list({project_id:projectId,app_type_id:appTypeId,search:caseSearch.trim() || undefined},{signal}),
    enabled:Boolean(manualSource && projectId && appTypeId),retry:false,staleTime:30000
  });
const testDataGenerator=data.artifactTask==='test-data-generator';
const testDataSets = useQuery({
    queryKey: ["workflow-test-data-sets", projectId, appTypeId],
    queryFn: ({ signal }) => agenticApi.workflowTestDataSets.list({ project_id: projectId, ...(appTypeId ? { app_type_id: appTypeId } : {}) }, { signal }),
    enabled: Boolean(projectId && appTypeId && testDataGenerator),
    retry: false,
    staleTime: 30000,
  });
const testEnvironments = useQuery({
    queryKey: ["workflow-test-environments", projectId, appTypeId],
    queryFn: ({ signal }) => agenticApi.workflowTestEnvironments.list({ project_id: projectId, ...(appTypeId ? { app_type_id: appTypeId } : {}) }, { signal }),
    enabled: Boolean(projectId && appTypeId && automation),
    retry: false,
    staleTime: 30000,
  });
const selectedEnvironment = testEnvironments.data?.find(item => item.id === data.testEnvironmentId);
const guidance = <>
  {field("task", "Task", true)}
  {field("instructions", "Instructions", true)}
  {field("guardrails", "Guardrails", true)}
  <button type="button" className="ghost-button" onClick={() => onChange(nativeTaskResetPatch(String(data.artifactTask || "story-assurance")))}>Restore task defaults</button>
</>;
return (<>
        <label><span>Native task</span><select aria-label="Native task" value={String(data.artifactTask || "story-assurance")} onChange={event => onChange({ ...nativeTaskDefaults(event.target.value), prompt: "" })}>
          {Object.entries(nativeTaskProfiles).map(([value, profile]) => <option key={value} value={value}>{profile.label}</option>)}
        </select></label>
        {!automation && <div className="studio-parameter-group">{guidance}</div>}
        {automation && <div className="studio-parameter-group">
          <h4>Test Case and runtime</h4>
          {select('automationRuntime', 'Automation Agent', [['auto', 'Automatic (Web, API or mixed)'], ...automationAgentPresets.map(preset => [preset.runtime, preset.label] as [string, string])], 'auto')}
          <p className="studio-caption">{apiAutomation
            ? "Builds HTTP requests, response assertions and captures from the API contract. Verify them in Test Runs."
            : data.automationRuntime === "web"
              ? "Builds Playwright source and mapped instructions from the case’s browser steps."
              : "Uses the case’s saved steps to build Playwright source, API requests, or both."}</p>
          {select('automationSource','Test Case source', [['manual_case','Saved manual Test Case'],['sprint','Upstream Sprint Test Case']], 'sprint')}
          {manualSource && <>
            <label><span>Find a manual Test Case</span><input type="search" aria-label="Find a manual Test Case" value={caseSearch} onChange={event=>setCaseSearch(event.target.value)}/></label>
            <label><span>Manual Test Case</span><select aria-label="Manual Test Case" value={String(data.automationManualCaseId || '')} onChange={event=>onChange({automationManualCaseId:event.target.value})}>
              <option value="">Use manual_test_case_id from the trigger</option>
              {Boolean(data.automationManualCaseId) && !manualCases.data?.items.some(item=>item.id===data.automationManualCaseId) && <option value={String(data.automationManualCaseId)}>Current saved selection</option>}
              {manualCases.data?.items.map(item=><option key={item.id} value={item.id}>{item.display_id ? `${item.display_id} · ` : ''}{item.title}</option>)}
            </select></label>
            {manualCases.isError && <p role="alert">Manual Test Cases could not be loaded. Check your application and Test Case access.</p>}
          </>}
        </div>}
        {data.artifactTask === "test-case-generation" && <div className="studio-parameter-group">
          <h4>Case generation</h4>
          <label><span>Test Cases per Story</span><input type="number" aria-label="Test Cases per Story" min={1} max={10} step={1}
            value={String(data.maxCasesPerStory ?? triggerInput?.max_cases_per_story ?? 5)}
            onChange={event => onChange({ maxCasesPerStory: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
          {select("authoringMode", "Test Case format", [["structured", "Structured steps"], ["gherkin", "Gherkin scenarios"]], String(triggerInput?.authoring_mode || "structured"))}
          {field("generationInstructions", "Generation guidance (optional)", true, "Additional coverage or test data requirements")}
          <p className="studio-caption">Uses the current Story title, description and acceptance criteria. Saved cases are AI generated and pending review.</p>
        </div>}
        {testDataGenerator && <div className="studio-parameter-group">
          <h4>Case test data</h4>
          {select("testDataSource", "Data source", [["synthetic", "Generate synthetic data"], ["dataset", "Use a Test Data Set"]], "synthetic")}
          {data.testDataSource === "dataset" && <>
            <label><span>Test Data Set</span><select aria-label="Test Data Set" value={String(data.testDataSetId || "")} onChange={event => onChange({ testDataSetId: event.target.value })}>
              <option value="">Choose a Test Data Set</option>
              {data.testDataSetId && !testDataSets.data?.some(item => item.id === data.testDataSetId) ? <option value={String(data.testDataSetId)}>Unavailable Test Data Set · choose another</option> : null}
              {(testDataSets.data || []).map(item => <option key={item.id} value={item.id}>{item.name}{item.app_type_id ? " · application" : " · shared"}</option>)}
            </select></label>
            <div className="studio-parameter-actions"><button type="button" className="ghost-button compact" disabled={testDataSets.isFetching} onClick={() => void testDataSets.refetch()}><IconRefresh size={14} />Refresh</button></div>
            {testDataSets.isError ? <p role="alert">Test Data Sets could not be loaded. Refresh to retry.</p> : !testDataSets.isFetching && !testDataSets.data?.length ? <p role="status">No Test Data Sets are available for this project and application.</p> : null}
          </>}
          <p className="studio-caption">Runs once per selected Test Case. Dataset mode maps a matching row and keeps secret values protected; synthetic mode creates safe sample values. Missing fixtures and credentials remain visible for review.</p>
        </div>}
        {automation && <div className="studio-parameter-group">
          <h4>Test environment</h4>
          <label><span>Test Environment</span><select aria-label="Test Environment" value={String(data.testEnvironmentId || "")} onChange={event => {
            const testEnvironmentId = event.target.value;
            onChange({ testEnvironmentId, ...(!testEnvironmentId && !apiAutomation && verifiesAfterBuild ? { automationVerificationMode: "generate_only" } : {}) });
          }}>
            <option value="">No Test Environment selected</option>
            {data.testEnvironmentId && !selectedEnvironment ? <option value={String(data.testEnvironmentId)}>Unavailable environment · choose another</option> : null}
            {(testEnvironments.data || []).map(item => <option key={item.id} value={item.id}>{item.name}{item.base_url ? ` · ${item.base_url}` : item.app_type_id ? " · application" : " · shared"}</option>)}
          </select></label>
          <div className="studio-parameter-actions"><button type="button" className="ghost-button compact" disabled={testEnvironments.isFetching} onClick={() => void testEnvironments.refetch()}><IconRefresh size={14} />Refresh</button></div>
          {testEnvironments.isError ? <p role="alert">Test Environments could not be loaded. Refresh to retry.</p> : !testEnvironments.isFetching && !testEnvironments.data?.length ? <p role="status">No Test Environments are available for this project and application.</p> : null}
          {selectedEnvironment ? <p className="studio-caption">{selectedEnvironment.base_url || "No base URL configured"}{selectedEnvironment.variables?.length ? ` · ${selectedEnvironment.variables.length} variables, including protected values` : " · no environment variables"}</p> : null}
          {field('automationStartUrl',apiAutomation ? 'Base URL for relative API requests' : 'Start URL (optional fallback)',false,'https://test.example.com/')}
          <p className="studio-caption">The environment provides the primary URL and protected values through references such as @r.username.</p>
        </div>}
        {automation && !apiAutomation && <div className="studio-parameter-group">
          <h4>Browser and verification</h4>
          <label><span>Browser generation</span><select aria-label="Browser generation" value={browserMode} onChange={event => {
            const mode = event.target.value;
            onChange({ automationBrowserMode: mode, ...(mode !== "perform_steps" && verifiesAfterBuild ? { automationVerificationMode: "generate_only" } : {}) });
          }}>
            <option value="read_only">Inspect the starting page only</option>
            <option value="perform_steps">Perform the test steps</option>
            <option value="offline">Generate without a browser</option>
          </select></label>
          <p className="studio-caption">{browserMode === "perform_steps"
            ? "Playwright runs the authored actions, including submissions, against the test application. An uncertain action stops the build for review."
            : browserMode === "offline"
              ? "Use the supplied evidence and produce a draft for review."
              : "Inspect the starting page and produce a draft for review."}</p>
          <label><span>After generating</span><select aria-label="After generating" value={String(data.automationVerificationMode || "generate_only")}
            onChange={event => onChange({ automationVerificationMode: event.target.value })}>
            <option value="generate_only">Generate source</option>
            <option value="verify" disabled={!canVerifyWeb}>Run generated web test</option>
            <option value="verify_repair" disabled={!canVerifyWeb}>Run with locator recovery</option>
            <option value="verify_cli" disabled={!canVerifyWeb}>Run with Playwright Test CLI</option>
          </select></label>
          {canVerifyWeb && verifiesAfterBuild && <p className="studio-caption">Runs the generated web test in fresh Chromium with the same data. Authored actions run again.</p>}
          {canVerifyWeb && data.automationVerificationMode === "verify_repair" && <p className="studio-caption">If a locator fails before any interaction, the agent can propose one correction from the failure snapshot and keep it only after a passing replay.</p>}
          {!canVerifyWeb && <p className="studio-caption">Web verification requires Perform the test steps and a Test Environment.</p>}
        </div>}
        {automation && !manualSource && <>
          {select("readinessPolicy", "Readiness handling", [["verify-inputs", "Build Agent verifies inputs"], ["require-ready", "Require a ready assurance assessment"]], "verify-inputs")}
        </>}
        {automation && <details className="studio-parameter-group">
          <summary>Build instructions and guardrails</summary>
          <div className="studio-build-guidance">{guidance}</div>
        </details>}
      </>);
}
