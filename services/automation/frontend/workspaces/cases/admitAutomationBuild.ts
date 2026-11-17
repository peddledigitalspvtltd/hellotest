import type { useAutomationAuthoring } from '../../hooks/AutomationAuthoringProvider';
type BuildCommands=Pick<ReturnType<typeof useAutomationAuthoring>,'beginBuild'|'buildAccepted'|'buildRejected'>;
/** Reserve the case before the only admission POST. A missing/uncertain receipt
 * stays unresolved in the shared authoring state instead of permitting a replay. */
export async function admitAutomationBuild<T extends {transaction_id:string}>(commands:BuildCommands,caseIds:string[],scheduledAt:string|undefined,submit:()=>Promise<T>):Promise<T>{
  const operationId=commands.beginBuild(caseIds,scheduledAt||null);
  try{
    const response=await submit();
    if(typeof response.transaction_id!=='string'||!response.transaction_id.trim())throw Object.assign(new Error('The build admission did not return a saved activity reference. Reconcile its activity before retrying.'),{code:'AUTOMATION_BUILD_ADMISSION_UNKNOWN'});
    commands.buildAccepted(operationId,response.transaction_id,'queued');
    return response;
  }catch(error){commands.buildRejected(operationId,error);throw error;}
}
