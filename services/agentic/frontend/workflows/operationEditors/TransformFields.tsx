import {FieldMappingFields} from "./shared/FieldMappingFields";
import type { WorkflowOperationEditorProps } from "./operationEditorTypes";

export function TransformFields(props:WorkflowOperationEditorProps){
const {data,onChange}=props;


return (<FieldMappingFields data={data} onChange={onChange}/>);
}
