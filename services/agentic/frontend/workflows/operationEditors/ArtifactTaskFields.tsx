import {useQuery} from "@tanstack/react-query";
import {IconRefresh} from "@tabler/icons-react";
import {agenticApi} from "../../api.client";
import {nativeTaskDefaults,nativeTaskProfiles,nativeTaskResetPatch} from "../nativeTaskProfiles";
import type { WorkflowOperationEditorProps } from "./operationEditorTypes";
import { workflowFieldInputs } from "./shared/fieldInputs";
export function ArtifactTaskFields(props:WorkflowOperationEditorProps){
const {data,projectId,appTypeId,triggerInput,onChange}=props;
const {field, select}=workflowFieldInputs(data,onChange);
const automation=data.artifactTask==='automation-engineer';
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
return (<>
        <label><span>Native task</span><select aria-label="Native task" value={String(data.artifactTask || "story-assurance")} onChange={event => onChange({ ...nativeTaskDefaults(event.target.value), prompt: "" })}>
          {Object.entries(nativeTaskProfiles).map(([value, profile]) => <option key={value} value={value}>{profile.label}</option>)}
        </select></label>
        <div className="studio-parameter-group">
          {field("task", "Task", true)}
          {field("instructions", "Instructions", true)}
          {field("guardrails", "Guardrails", true)}
          <button type="button" className="ghost-button" onClick={() => onChange(nativeTaskResetPatch(String(data.artifactTask || "story-assurance")))}>Restore task defaults</button>
          <p className="studio-caption">This saved node owns its instructions, guardrails and model settings. Admin AI Controls do not change this task. Project access, source traceability and native output validation are always enforced.</p>
        </div>
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
          <label><span>Test Environment</span><select aria-label="Test Environment" value={String(data.testEnvironmentId || "")} onChange={event => onChange({ testEnvironmentId: event.target.value })}>
            <option value="">Choose a Test Environment</option>
            {data.testEnvironmentId && !selectedEnvironment ? <option value={String(data.testEnvironmentId)}>Unavailable environment · choose another</option> : null}
            {(testEnvironments.data || []).map(item => <option key={item.id} value={item.id}>{item.name}{item.base_url ? ` · ${item.base_url}` : item.app_type_id ? " · application" : " · shared"}</option>)}
          </select></label>
          <div className="studio-parameter-actions"><button type="button" className="ghost-button compact" disabled={testEnvironments.isFetching} onClick={() => void testEnvironments.refetch()}><IconRefresh size={14} />Refresh</button></div>
          {testEnvironments.isError ? <p role="alert">Test Environments could not be loaded. Refresh to retry.</p> : !testEnvironments.isFetching && !testEnvironments.data?.length ? <p role="status">No Test Environments are available for this project and application.</p> : null}
          {selectedEnvironment ? <p className="studio-caption">{selectedEnvironment.base_url || "No base URL configured"}{selectedEnvironment.variables?.length ? ` · ${selectedEnvironment.variables.length} variables, including protected values` : " · no environment variables"}</p> : null}
          <p className="studio-caption">The environment provides the application URL and scoped variables such as @t.username and @t.password. The Test Data Generator supplies case-specific values to this node; secrets stay protected in the environment.</p>
        </div>}
        {automation && <>
          {select("automationBrowserMode", "Browser generation", [["perform_steps", "Perform the test steps"], ["read_only", "Inspect the starting page only"], ["offline", "Generate without a browser"]], data.inspectBrowser === false ? "offline" : "read_only")}
          <p className="studio-caption">Performing steps uses a background browser to carry out this case, including its form submissions, and returns the finished script. Use a test environment and test data. Inspection and offline modes produce unverified drafts. API-only cases use their contracts directly.</p>
        </>}
        {automation && <>
          {select("readinessPolicy", "Readiness handling", [["verify-inputs", "Automation Engineer verifies inputs"], ["require-ready", "Require a ready assurance assessment"]], "verify-inputs")}
          <p className="studio-caption">The builder checks prior findings against the selected Story. Missing dependencies and invalid automation remain explicit failures.</p>
        </>}
      </>);
}
