import {WorkflowDataOperationFields} from "../WorkflowDataOperationFields";
import type { WorkflowOperationEditorProps } from "./operationEditorTypes";

export function DataOperationFields(props:WorkflowOperationEditorProps){
const {data,onChange}=props;


return (<WorkflowDataOperationFields data={data} onChange={onChange} />);
}
