import type { WorkflowOperationEditorProps } from "./operationEditorTypes";
import {useHttpConnection} from './shared/connectionState';
import {ManagedConnectionFields} from './shared/ManagedConnectionFields';
import {HttpRequestFields} from './shared/HttpRequestFields';
export function WebAgentFields(props:WorkflowOperationEditorProps){
const {connections,connection,onConnectionChange}=useHttpConnection(props,true);
return <><ManagedConnectionFields data={props.data} protocol="http" connections={connections} onConnectionChange={onConnectionChange}/><HttpRequestFields {...props} connection={connection} readOnly={true}/></>;
}
