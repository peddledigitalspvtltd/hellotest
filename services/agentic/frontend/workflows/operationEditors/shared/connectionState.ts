import {useQuery} from '@tanstack/react-query';
import {agenticApi} from '../../../api.client';
import {sprintStoriesUrl} from '../../sprintStoriesUrl';
import type {WorkflowOperationEditorProps} from '../operationEditorTypes';
export function useWorkflowConnections(projectId:string){return useQuery({queryKey:['workflow-connections',projectId],queryFn:()=>agenticApi.agenticWorkflows.connections(projectId),enabled:Boolean(projectId),staleTime:30000,refetchOnWindowFocus:'always',refetchOnMount:'always'});}
export function useHttpConnection(props:WorkflowOperationEditorProps,readOnly:boolean){
const {data,projectId,triggerInput,onChange}=props;const connections=useWorkflowConnections(projectId);const connection=connections.data?.find(item=>item.id===data.connectionId);
const onConnectionChange=(id:string)=>{const selected=connections.data?.find(item=>item.id===id);onChange({connectionId:id,apiAuth:'',credentialId:'',...(selected?.timeoutMs?{timeoutMs:String(selected.timeoutMs)}:{}),apiUrl:data.apiResource==='sprintStories'?sprintStoriesUrl(selected?.url||'',projectId,String(triggerInput?.sprint_id||'')):selected?.url||'',apiMethod:data.apiResource==='sprintStories'||readOnly?'GET':selected?.methods[0]||'GET'});};
return {connections,connection,onConnectionChange};}
