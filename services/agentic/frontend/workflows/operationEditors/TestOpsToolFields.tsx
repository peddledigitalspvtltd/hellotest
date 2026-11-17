import type { WorkflowOperationEditorProps } from "./operationEditorTypes";
import { workflowFieldInputs } from "./shared/fieldInputs";
export function TestOpsToolFields(props:WorkflowOperationEditorProps){
const {data,onChange}=props;
const {field}=workflowFieldInputs(data,onChange);

return (<>
          {field("knowledgeQuery", "Search question", true)}
          <p className="studio-caption">
            Retrieves current permitted project evidence. Results include source
            IDs and evidence limits.
          </p>
          {data.testOpsAction !== "read-runs" ? (
            <button
              type="button"
              onClick={() => onChange({ testOpsAction: "read-runs" })}
            >
              Use Read runs
            </button>
          ) : null}
        </>);
}
