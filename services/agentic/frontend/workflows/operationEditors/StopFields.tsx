import type { WorkflowOperationEditorProps } from "./operationEditorTypes";
import { workflowFieldInputs } from "./shared/fieldInputs";
export function StopFields(props:WorkflowOperationEditorProps){
const {data,onChange}=props;
const {field}=workflowFieldInputs(data,onChange);

return (<>{field("stopMessage", "Error message", true)}<p className="studio-caption">Stops execution with this message. Connect it to a condition or switch branch that should fail.</p></>);
}
