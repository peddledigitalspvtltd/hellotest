import type { WorkflowOperationEditorProps } from "./operationEditorTypes";
import {useHttpConnection} from './shared/connectionState';
import {ManagedConnectionFields} from './shared/ManagedConnectionFields';
import {HttpRequestFields} from './shared/HttpRequestFields';
function HttpApiToolFields(props:WorkflowOperationEditorProps){
const {connections,connection,onConnectionChange}=useHttpConnection(props,false);
return <><ManagedConnectionFields data={props.data} protocol="http" connections={connections} onConnectionChange={onConnectionChange}/><HttpRequestFields {...props} connection={connection} readOnly={false}/></>;
}

export function ApiToolFields(props:WorkflowOperationEditorProps){
  if (props.data.apiResource === "workspaceSprintStories") return <p className="studio-caption">
    Reads all Stories for the selected Sprint in this project using the workflow actor's current access.
  </p>;
  return <HttpApiToolFields {...props}/>;
}
