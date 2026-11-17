import type { WorkflowOperationEditorProps } from "./operationEditorTypes";
import { workflowFieldInputs } from "./shared/fieldInputs";
export function LogFields(props:WorkflowOperationEditorProps){
const {data,onChange}=props;
const {field}=workflowFieldInputs(data,onChange);

return (field("logMessage", "Log message", true));
}
