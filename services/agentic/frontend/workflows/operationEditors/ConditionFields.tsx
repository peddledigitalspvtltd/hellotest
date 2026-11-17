import {WorkflowConditionFields} from "../WorkflowConditionFields";
import type { WorkflowOperationEditorProps } from "./operationEditorTypes";

export function ConditionFields(props:WorkflowOperationEditorProps){
const {data,onChange}=props;


return (<WorkflowConditionFields data={data} onChange={onChange} />);
}
