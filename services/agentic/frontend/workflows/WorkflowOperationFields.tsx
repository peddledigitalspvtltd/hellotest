import {workflowOperationEditor} from './operationEditors/registry';
import type {WorkflowOperationEditorProps} from './operationEditors/operationEditorTypes';
export type {WorkflowOperationEditorProps} from './operationEditors/operationEditorTypes';
/** Select one concrete kind editor; the descriptor retains its canonical panel metadata. */
export function WorkflowOperationFields(props:WorkflowOperationEditorProps){
const editor=workflowOperationEditor(String(props.data.kind));
const Fields=editor?.Fields;
return Fields?<Fields {...props}/>:null;
}
